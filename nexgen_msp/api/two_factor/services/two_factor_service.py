"""TOTP enrolment and verification.

The secret is minted when enrolment starts but only written once a first code
has proven the phone holds it — so a scan that never completes leaves nothing
behind, and nobody is locked out by an abandoned setup.

The gate that says "this session has passed 2FA" is bound to the session and
nothing else. Frappe already expires a session according to System Settings, so
when it goes the gate goes with it and the next sign-in asks for a code again.
That is the whole timeout: no second clock of our own to drift out of step.
"""

from urllib.parse import urlparse

import frappe
import pyotp
from frappe import _
from frappe.sessions import clear_sessions, get_expiry_in_seconds
from frappe.utils import get_url, now_datetime
from frappe.utils.password import decrypt, encrypt

from nexgen_msp.utils.auth_audit import (
    EVENT_REAUTH_OTP_INVALID,
    EVENT_SETUP_CONTEXT_INVALID,
    EVENT_SETUP_OTP_INVALID,
    record_auth_failure,
)
from nexgen_msp.utils.auth_constants import (
    DEFAULTS_PARENT_2FA,
    OTP_ISSUER_NAME,
    PENDING_LOGIN_PREFIX,
    PENDING_SETUP_PREFIX,
    PENDING_SETUP_TTL,
    TOTP_VALID_WINDOW,
)
from nexgen_msp.utils.errors import ValidationError

SESSION_GATE_KEY = "msp_totp_gate"


class TwoFactorService:
    # ------------------------------------------------------------------ state

    @staticmethod
    def get_status():
        """What the signed-in user's own security screen shows."""
        user = TwoFactorService._require_user()

        return {
            "user": user,
            "enabled": TwoFactorService.has_secret(user),
            "method": "totp",
            "gate_passed": TwoFactorService.gate_passed(user),
            "session_expiry_seconds": TwoFactorService.session_expiry_seconds(),
        }

    @staticmethod
    def has_secret(user):
        return bool(frappe.db.get_default(TwoFactorService._key(user), DEFAULTS_PARENT_2FA))

    @staticmethod
    def gate_passed(user=None):
        """True when this very session verified a code when it was opened."""
        user = user or frappe.session.user

        if not user or user == "Guest":
            return False

        data = getattr(frappe.session, "data", None)

        return bool(isinstance(data, (dict, frappe._dict)) and data.get(SESSION_GATE_KEY))

    @staticmethod
    def mark_gate_passed():
        """Stamp the session as having cleared the second factor.

        Stored in the session itself rather than in a cache entry with a TTL of
        its own: the session's own expiry is the deadline, so there is nothing
        to keep in step.
        """
        data = getattr(frappe.session, "data", None)

        if data is None:
            return False

        data[SESSION_GATE_KEY] = now_datetime().isoformat()

        session = getattr(frappe.local, "session_obj", None)

        if session and hasattr(session, "update"):
            session.update(force=True)

        return True

    @staticmethod
    def session_expiry_seconds():
        """How long Frappe lets a session sit idle, from System Settings.

        Read from Frappe rather than from a setting of our own, so the moment a
        second code is demanded again is the moment the session dies.
        """
        try:
            return int(get_expiry_in_seconds())
        except Exception:
            return 6 * 60 * 60

    # ------------------------------------------------------------- enrolment

    @staticmethod
    def start_setup(pending_token=None):
        """Mint a secret and hand back what a phone needs to scan it."""
        user = TwoFactorService._setup_user(pending_token)

        if TwoFactorService.has_secret(user):
            return {"already_enabled": True}

        secret = pyotp.random_base32()
        issuer = TwoFactorService._issuer()
        account = frappe.db.get_value("User", user, "email") or user

        frappe.cache().set_value(
            f"{PENDING_SETUP_PREFIX}{user}",
            {"secret": encrypt(secret)},
            expires_in_sec=PENDING_SETUP_TTL,
        )

        return {
            "issuer": issuer,
            "account": account,
            "secret": secret,
            "otpauth_uri": pyotp.TOTP(secret).provisioning_uri(
                name=account, issuer_name=issuer
            ),
            "expires_in": PENDING_SETUP_TTL,
        }

    @staticmethod
    def verify_setup(otp, pending_token=None):
        """Prove the phone holds the secret, and only then keep it."""
        user = TwoFactorService._setup_user(pending_token)
        otp = (otp or "").strip()

        if not otp.isdigit() or len(otp) != 6:
            raise ValidationError(_("Enter the 6-digit code."), "OTP_INVALID_FORMAT")

        pending = frappe.cache().get_value(f"{PENDING_SETUP_PREFIX}{user}")

        if not isinstance(pending, (dict, frappe._dict)) or not pending.get("secret"):
            record_auth_failure(EVENT_SETUP_CONTEXT_INVALID, user, detail="setup expired")
            raise ValidationError(
                _("Setup expired. Start again from the sign-in screen."),
                "SETUP_EXPIRED",
            )

        secret = TwoFactorService._decode(pending["secret"])

        if not pyotp.TOTP(secret).verify(otp, valid_window=TOTP_VALID_WINDOW):
            record_auth_failure(EVENT_SETUP_OTP_INVALID, user)
            raise ValidationError(_("Invalid or expired code."), "OTP_INVALID")

        # kept only now that it is proven
        frappe.db.set_default(TwoFactorService._key(user), encrypt(secret), parent=DEFAULTS_PARENT_2FA)
        frappe.cache().delete_value(f"{PENDING_SETUP_PREFIX}{user}")
        frappe.cache().delete_value(f"{PENDING_LOGIN_PREFIX}{(pending_token or '').strip()}")
        frappe.db.commit()

        return {"ok": True, "enabled": True}

    # ------------------------------------------------------- reauthentication

    @staticmethod
    def verify_code(code, user=None):
        """Check a code against the stored secret. Used by login and by reauth."""
        user = user or frappe.session.user
        secret = TwoFactorService.secret(user)

        if not secret:
            raise ValidationError(
                _("Two-factor authentication is not configured for this account."),
                "TWO_FA_NOT_CONFIGURED",
            )

        code = (code or "").strip()

        if not code.isdigit() or len(code) != 6:
            raise ValidationError(_("Enter the 6-digit code."), "OTP_INVALID_FORMAT")

        return bool(pyotp.TOTP(secret).verify(code, valid_window=TOTP_VALID_WINDOW))

    @staticmethod
    def verify_current(code):
        """Re-prove the second factor inside a live session."""
        user = TwoFactorService._require_user()

        if not TwoFactorService.verify_code(code, user):
            record_auth_failure(EVENT_REAUTH_OTP_INVALID, user)
            raise ValidationError(_("Invalid code. Please try again."), "OTP_INVALID")

        TwoFactorService.mark_gate_passed()

        return {
            "ok": True,
            "user": user,
            "session_expiry_seconds": TwoFactorService.session_expiry_seconds(),
        }

    @staticmethod
    def reset(user=None):
        """Drop someone's secret and close their sessions, so they enrol again."""
        from nexgen_msp.api.internal.services.contract_service import ContractService

        ContractService._guard_admin()

        user = (user or "").strip()

        if not user or not frappe.db.exists("User", user):
            raise ValidationError(_("User not found."), "NOT_FOUND")

        # through frappe.defaults, not a raw delete: the values are cached per
        # parent, and a row removed behind the cache's back still reads as set
        frappe.defaults.clear_default(
            key=TwoFactorService._key(user), parent=DEFAULTS_PARENT_2FA
        )

        frappe.cache().delete_value(f"{PENDING_SETUP_PREFIX}{user}")
        frappe.db.commit()

        # whatever they still had open stops being trusted
        clear_sessions(user=user, keep_current=False, force=True)
        frappe.clear_cache(user=user)

        return {"ok": True, "user": user, "enabled": False}

    # --------------------------------------------------------------- helpers

    @staticmethod
    def secret(user):
        stored = frappe.db.get_default(TwoFactorService._key(user), DEFAULTS_PARENT_2FA)

        if not stored:
            return None

        return TwoFactorService._decode(stored)

    @staticmethod
    def _decode(value):
        try:
            return decrypt(value)
        except Exception:
            # tolerate a secret written before encryption was in place
            return value

    @staticmethod
    def _key(user):
        return f"{user}_msp_otpsecret".lower()

    @staticmethod
    def _require_user():
        user = frappe.session.user

        if not user or user == "Guest":
            frappe.throw(_("Not permitted"), frappe.PermissionError)

        return user

    @staticmethod
    def _setup_user(pending_token=None):
        """Who is enrolling: the holder of a pending login, or the signed-in user."""
        pending_token = (pending_token or "").strip()

        if pending_token:
            data = frappe.cache().get_value(f"{PENDING_LOGIN_PREFIX}{pending_token}")

            if not isinstance(data, (dict, frappe._dict)) or not data.get("username"):
                record_auth_failure(EVENT_SETUP_CONTEXT_INVALID, detail="pending login expired")
                raise ValidationError(
                    _("Sign-in expired. Please start again."), "PENDING_LOGIN_INVALID"
                )

            if data.get("has_2fa"):
                raise ValidationError(
                    _("Two-factor authentication is already configured."),
                    "TWO_FA_ALREADY_SET",
                )

            return data["username"]

        return TwoFactorService._require_user()

    @staticmethod
    def _issuer():
        """The label above the code in the phone, narrowed to this site."""
        for candidate in (
            getattr(getattr(frappe.local, "request", None), "host", None),
            _safe_url(),
            getattr(frappe.local, "site", None),
        ):
            label = _host_label(candidate)

            if label:
                return f"{OTP_ISSUER_NAME} ({label})"

        return OTP_ISSUER_NAME


def _safe_url():
    try:
        return get_url()
    except Exception:
        return None


def _host_label(value):
    raw = (value or "").strip()

    if not raw:
        return ""

    parsed = urlparse(raw if "://" in raw else f"//{raw}")
    host = (parsed.hostname or parsed.path.split("/", 1)[0]).strip().lower().rstrip(".")

    if host.startswith("www."):
        host = host[4:]

    return host.split(".", 1)[0] if host else ""
