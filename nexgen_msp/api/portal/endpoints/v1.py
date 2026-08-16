import frappe

from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.wrapper_error_decorator import handle_errors


@frappe.whitelist()
@handle_errors
def get_context():
    return PortalService.get_context()


@frappe.whitelist()
@handle_errors
def get_summary(customer=None):
    return PortalService.get_summary(customer=customer)


@frappe.whitelist()
@handle_errors
def list_client_users(customer=None, search=None, status=None, start=0, page_length=20):
    return PortalService.list_client_users(
        customer=customer, search=search, status=status, start=start, page_length=page_length
    )


@frappe.whitelist()
@handle_errors
def list_devices(customer=None, search=None, status=None, start=0, page_length=20):
    return PortalService.list_devices(
        customer=customer, search=search, status=status, start=start, page_length=page_length
    )


@frappe.whitelist()
@handle_errors
def list_service_assignments(
    customer=None, search=None, status=None, client_user=None, start=0, page_length=20
):
    return PortalService.list_service_assignments(
        customer=customer,
        search=search,
        status=status,
        client_user=client_user,
        start=start,
        page_length=page_length,
    )


@frappe.whitelist()
@handle_errors
def list_requests(customer=None, search=None, status=None, start=0, page_length=20):
    return PortalService.list_requests(
        customer=customer, search=search, status=status, start=start, page_length=page_length
    )


@frappe.whitelist()
@handle_errors
def get_request(name=None):
    return PortalService.get_request(name=name)


@frappe.whitelist()
@handle_errors
def create_request(customer=None, request_type=None, priority=None, lines=None):
    return PortalService.create_request(
        customer=customer, request_type=request_type, priority=priority, lines=lines
    )


@frappe.whitelist()
@handle_errors
def list_catalogue(customer=None):
    return PortalService.list_catalogue(customer=customer)
