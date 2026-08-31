import frappe

from nexgen_msp.api.auth.services.auth_service import AuthService
from nexgen_msp.api.two_factor.services.two_factor_service import TwoFactorService
from nexgen_msp.utils.auth_audit import EVENT_RATE_LIMITED
from nexgen_msp.utils.rate_limit import request_rate_limit, user_rate_limit
from nexgen_msp.utils.wrapper_error_decorator import handle_errors


@frappe.whitelist()
@handle_errors
def get_two_factor_status():
    return TwoFactorService.get_status()


@frappe.whitelist(allow_guest=True)
# This mints the secret and hands it back. Uncapped, whoever holds a stolen
# pending token could re-roll it in a loop and invalidate the QR the legitimate
# user has just scanned.
@request_rate_limit(key="pending_token", limit=5, seconds=60, scope="totp_setup_start")
@handle_errors
def start_two_factor_setup(pending_token=None):
    return TwoFactorService.start_setup(pending_token=pending_token)


@frappe.whitelist(allow_guest=True)
# Abuse control rather than credential protection: whoever is here already holds
# the pending secret and the account's password. The caps that protect a
# credential are on complete_login and verify_two_factor.
@request_rate_limit(
    key="pending_token",
    limit=10,
    seconds=60,
    scope="totp_setup_verify",
    audit_event=EVENT_RATE_LIMITED,
    audit_identity=AuthService.username_for_pending_token,
)
@handle_errors
def verify_two_factor_setup(otp=None, pending_token=None):
    return TwoFactorService.verify_setup(otp=otp, pending_token=pending_token)


@frappe.whitelist()
# Keyed on the session user, not the address, so colleagues behind one office
# connection do not starve each other out of the screen.
@user_rate_limit(limit=10, seconds=60, scope="totp_reauth")
@handle_errors
def verify_two_factor(code=None):
    return TwoFactorService.verify_current(code=code)


@frappe.whitelist()
@handle_errors
def reset_two_factor(user=None):
    return TwoFactorService.reset(user=user)
