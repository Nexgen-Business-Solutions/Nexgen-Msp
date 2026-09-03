import frappe

from nexgen_msp.api.core.services.session_service import SessionService
from nexgen_msp.utils.wrapper_error_decorator import handle_errors


@frappe.whitelist()
@handle_errors
def get_session_context():
    return SessionService.get_session_context()


@frappe.whitelist(allow_guest=True)
@handle_errors
def get_csrf_token():
    """The token the current session expects on a write.

    The page carries one from the moment it was served, and a session that is renewed or
    replaced leaves it stale — every write then fails with Frappe's bare "Invalid Request".
    The client fetches this and tries once more rather than showing that to anyone.

    Open to a signed-out caller on purpose: the login page goes stale the same way, and
    this only ever hands back the token of the session already asking — the same value its
    own page was served with.
    """
    return {
        "csrf_token": frappe.session.data.csrf_token,
        "authenticated": frappe.session.user not in (None, "Guest"),
    }
