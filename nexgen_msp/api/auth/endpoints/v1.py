import frappe

from nexgen_msp.api.auth.services.auth_service import AuthService
from nexgen_msp.utils.auth_audit import EVENT_RATE_LIMITED
from nexgen_msp.utils.rate_limit import request_rate_limit
from nexgen_msp.utils.wrapper_error_decorator import handle_errors


@frappe.whitelist(allow_guest=True)
# Two windows, both load-bearing. The inner one is keyed per account because an
# office leaves through a single outbound address, and a shared bucket would let
# one person's typos lock out their colleagues. The outer per-IP ceiling is what
# stops that from becoming unlimited password spraying across many accounts.
@request_rate_limit(limit=60, seconds=300, scope="pre_login_ip")
@request_rate_limit(
    key="username",
    limit=5,
    seconds=60,
    scope="pre_login",
    audit_event=EVENT_RATE_LIMITED,
    audit_identity=lambda username: username,
)
@handle_errors
def pre_login(username=None, password=None):
    """Check credentials without opening a session. Returns a pending token."""
    return AuthService.pre_login(username=username, password=password)


@frappe.whitelist(allow_guest=True)
@request_rate_limit(
    key="pending_token",
    limit=10,
    seconds=60,
    scope="complete_login",
    audit_event=EVENT_RATE_LIMITED,
    audit_identity=AuthService.username_for_pending_token,
)
@handle_errors
def complete_login(pending_token=None, otp=None, username=None):
    """Verify the code and open the session."""
    return AuthService.complete_login(
        pending_token=pending_token, otp=otp, username=username
    )
