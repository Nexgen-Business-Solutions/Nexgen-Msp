"""Signing in, in two steps, with no session opened until the second one passes.

The password alone opens nothing. It buys a short-lived pending token, and only
a correct code turns that token into a Frappe session. An account that has never
enrolled cannot get a session at all: it is sent to enrolment first, and signs
in afterwards.
"""

import secrets

import frappe
from frappe import _
from frappe.utils.password import check_password

from nexgen_msp.api.two_factor.services.two_factor_service import TwoFactorService
from nexgen_msp.utils import response
from nexgen_msp.utils.auth_audit import (
    EVENT_BAD_PASSWORD,
    EVENT_OTP_INVALID,
    EVENT_OTP_INVALID_FORMAT,
    EVENT_OTP_REQUIRED,
    EVENT_PENDING_LOGIN_INVALID,
    EVENT_USER_DISABLED,
    record_auth_failure,
)
from nexgen_msp.utils.auth_constants import (
    MAX_OTP_FAILURES,
    OTP_FAILURE_PREFIX,
    OTP_FAILURE_WINDOW,
    PENDING_LOGIN_PREFIX,
    PENDING_LOGIN_TTL,
)
from nexgen_msp.utils.errors import ValidationError
from nexgen_msp.utils.rate_limit import bump_window_counter, window_retry_after


class AuthService:
    @staticmethod
    def pre_login(username=None, password=None):
        """Check the credentials and open nothing.

        Returns a token that is worth a session only once a code has been
        verified against it.
        """
        if not username or not password:
            raise ValidationError(_("Username and password are required."), "VALIDATION_ERROR")

        try:
            # the typed identifier, not a resolved one: check_password raises
            # before it hands back the canonical name
            username = check_password(username, password)
        except frappe.AuthenticationError:
            record_auth_failure(EVENT_BAD_PASSWORD, username)
            raise ValidationError(_("Invalid credentials."), "AUTHENTICATION_FAILED")

        AuthService._reject_if_disabled(username)

        has_2fa = TwoFactorService.has_secret(username)
        required = AuthService._two_factor_required(username)
        token = secrets.token_urlsafe(32)

        frappe.cache().set_value(
            f"{PENDING_LOGIN_PREFIX}{token}",
            {"username": username, "has_2fa": has_2fa, "required": required},
            expires_in_sec=PENDING_LOGIN_TTL,
        )

        return {
            "pending_token": token,
            "requires_2fa": has_2fa,
            "needs_setup": required and not has_2fa,
            "full_name": frappe.db.get_value("User", username, "full_name") or username,
            "expires_in": PENDING_LOGIN_TTL,
        }

    @staticmethod
    def complete_login(pending_token=None, otp=None, username=None):
        """Verify the code and, only then, open the session.

        `username` is an audit hint and nothing else: the identity that decides
        anything comes from the pending entry the server itself minted. Never
        read it for an authorization decision.
        """
        if not pending_token:
            raise ValidationError(_("Invalid sign-in token."), "PENDING_LOGIN_INVALID")

        cache_key = f"{PENDING_LOGIN_PREFIX}{pending_token}"
        data = frappe.cache().get_value(cache_key)

        if not isinstance(data, (dict, frappe._dict)) or not data.get("username"):
            # expired, forged or already consumed: the server has no identity
            # left to name, so the row falls back to the client's hint
            record_auth_failure(EVENT_PENDING_LOGIN_INVALID, username)
            raise ValidationError(
                _("Sign-in expired. Please start again."), "PENDING_LOGIN_INVALID"
            )

        account = data["username"]

        # checked again rather than trusted from pre_login: the token runs for
        # five minutes and an account can be closed inside them
        AuthService._reject_if_disabled(account)

        if not data.get("has_2fa"):
            if data.get("required", True):
                # the password was right, but a session must not exist before
                # the second factor does
                return response.error(
                    _("Two-factor authentication must be set up before signing in."),
                    code="TWO_FA_SETUP_REQUIRED",
                    needs_setup=True,
                    pending_token=pending_token,
                )

            # only reachable once the exemption below is switched on: an account
            # that is not required to hold a second factor, and has not chosen
            # one, signs in on its password alone
            frappe.cache().delete_value(cache_key)
            frappe.local.login_manager.login_as(account)
            frappe.db.commit()

            return {
                "ok": True,
                "user": account,
                "full_name": frappe.utils.get_fullname(account),
                "roles": frappe.get_roles(account),
                "session_expiry_seconds": TwoFactorService.session_expiry_seconds(),
            }

        if not otp:
            record_auth_failure(EVENT_OTP_REQUIRED, account)
            raise ValidationError(_("The 6-digit code is required."), "OTP_REQUIRED")

        otp = (otp or "").strip()

        if not otp.isdigit() or len(otp) != 6:
            record_auth_failure(EVENT_OTP_INVALID_FORMAT, account)
            raise ValidationError(_("Enter the 6-digit code."), "OTP_INVALID_FORMAT")

        if not TwoFactorService.verify_code(otp, account):
            record_auth_failure(EVENT_OTP_INVALID, account)

            exhausted, retry_after = AuthService._otp_attempts_exhausted(account)

            if exhausted:
                frappe.cache().delete_value(cache_key)
                # answered as a rate limit because that is what it is: signing
                # in again mints a new token, but the window belongs to the
                # account and outlives it
                return response.error(
                    _("Too many invalid codes. Please try again in {0} seconds.").format(
                        retry_after
                    ),
                    code="RATE_LIMITED",
                    retry_after=retry_after,
                )

            raise ValidationError(_("Invalid or expired code."), "OTP_INVALID")

        # one-time use
        frappe.cache().delete_value(cache_key)

        frappe.local.login_manager.login_as(account)
        TwoFactorService.mark_gate_passed()
        frappe.db.commit()

        return {
            "ok": True,
            "user": account,
            "full_name": frappe.utils.get_fullname(account),
            "roles": frappe.get_roles(account),
            # the deadline is Frappe's own, so the client can count down to the
            # moment it will have to sign in again
            "session_expiry_seconds": TwoFactorService.session_expiry_seconds(),
        }

    @staticmethod
    def _two_factor_required(username):
        """Whether this account must hold a second factor to be let in.

        Everyone, today — staff and customers alike. The commented branch is the
        other policy: internal staff must enrol, while a customer signing in to
        their own portal is left alone until they choose to enrol. Uncommenting
        it is the whole switch; both the sign-in and the refusal below read this
        one answer, and an account that has already enrolled is still asked for
        its code either way.
        """
        return True

        # from nexgen_msp.utils.permissions import INTERNAL_ROLES
        #
        # return bool(set(frappe.get_roles(username)).intersection(INTERNAL_ROLES))

    @staticmethod
    def _reject_if_disabled(username):
        """Refuse an account whose User row is disabled or gone.

        Frappe refuses these inside `LoginManager.authenticate`, which this flow
        never reaches: `check_password` only reads the Auth table and `login_as`
        trusts its caller. Without this, disabling an account left its password
        and its secret working.

        Called only once the password has been verified, so it stays silent for
        anyone who cannot already tell the account exists.
        """
        if frappe.db.get_value("User", username, "enabled"):
            return

        record_auth_failure(EVENT_USER_DISABLED, username)
        raise ValidationError(_("This account is disabled."), "USER_DISABLED")

    @staticmethod
    def username_for_pending_token(pending_token=None):
        """Resolve a token to its account, for the audit trail only.

        The token is a live credential with five minutes to run and the Activity
        Log is readable by every System Manager, which is why the limiter takes
        a resolver instead of logging its key.
        """
        if not pending_token:
            return None

        data = frappe.cache().get_value(f"{PENDING_LOGIN_PREFIX}{pending_token}")

        if not isinstance(data, (dict, frappe._dict)):
            return None

        return data.get("username") or None

    @staticmethod
    def _otp_attempts_exhausted(username):
        """True once this account has burned its code attempts for the window.

        Keyed on the account, not on the token, and that is the point: a wrong
        code does not consume the token, so counting per token would buy a fresh
        set of guesses with every sign-in — a two-click operation.
        """
        cache_key = frappe.cache.make_key(f"{OTP_FAILURE_PREFIX}{username}")
        failures = bump_window_counter(cache_key, OTP_FAILURE_WINDOW)

        if failures < MAX_OTP_FAILURES:
            return False, 0

        return True, window_retry_after(cache_key, OTP_FAILURE_WINDOW)
