import frappe

from nexgen_msp.api.portal_access.services.portal_access_service import PortalAccessService
from nexgen_msp.utils.wrapper_error_decorator import handle_errors


@frappe.whitelist()
@handle_errors
def grant_access(customer=None, email=None, first_name=None, last_name=None, send_welcome_email=0):
    return PortalAccessService.grant(
        customer=customer,
        email=email,
        first_name=first_name,
        last_name=last_name,
        send_welcome_email=send_welcome_email,
    )


@frappe.whitelist()
@handle_errors
def revoke_access(email=None, customer=None):
    return PortalAccessService.revoke(email=email, customer=customer)


@frappe.whitelist()
@handle_errors
def list_access(customer=None):
    return PortalAccessService.list_access(customer=customer)
