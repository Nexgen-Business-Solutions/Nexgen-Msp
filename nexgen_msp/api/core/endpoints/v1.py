import frappe

from nexgen_msp.api.core.services.session_service import SessionService
from nexgen_msp.utils.wrapper_error_decorator import handle_errors


@frappe.whitelist()
@handle_errors
def get_session_context():
    return SessionService.get_session_context()
