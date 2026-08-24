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
def list_requests(
    customer=None,
    search=None,
    status=None,
    priority=None,
    request_type=None,
    start=0,
    page_length=20,
):
    return PortalService.list_requests(
        customer=customer,
        search=search,
        status=status,
        priority=priority,
        request_type=request_type,
        start=start,
        page_length=page_length,
    )


@frappe.whitelist()
@handle_errors
def get_request_filter_options(customer=None):
    return PortalService.request_filter_options(customer=customer)


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


@frappe.whitelist()
@handle_errors
def list_subscribed_services(customer=None):
    return PortalService.list_subscribed_services(customer=customer)


@frappe.whitelist()
@handle_errors
def list_service_rows(
    customer=None,
    service_item=None,
    search=None,
    status=None,
    department=None,
    user_status=None,
    last_billed_after=None,
    last_billed_before=None,
    start=0,
    page_length=20,
):
    return PortalService.list_service_rows(
        customer=customer,
        service_item=service_item,
        search=search,
        status=status,
        department=department,
        user_status=user_status,
        last_billed_after=last_billed_after,
        last_billed_before=last_billed_before,
        start=start,
        page_length=page_length,
    )


@frappe.whitelist()
@handle_errors
def get_report_filter_options(customer=None):
    return PortalService.report_filter_options(customer=customer)


@frappe.whitelist()
@handle_errors
def list_kpi_rows(kpi=None, customer=None, start=0, page_length=20):
    return PortalService.list_kpi_rows(
        kpi=kpi, customer=customer, start=start, page_length=page_length
    )


@frappe.whitelist()
@handle_errors
def list_users_with_services(customer=None, search=None, status=None, start=0, page_length=20):
    return PortalService.list_users_with_services(
        customer=customer, search=search, status=status, start=start, page_length=page_length
    )


@frappe.whitelist()
@handle_errors
def get_user_detail(client_user=None):
    return PortalService.get_user_detail(client_user=client_user)


@frappe.whitelist()
@handle_errors
def list_billing(customer=None):
    return PortalService.list_billing(customer=customer)


@frappe.whitelist()
@handle_errors
def get_billing_detail(name=None):
    return PortalService.get_billing_detail(name=name)


@frappe.whitelist()
@handle_errors
def download_invoice(name=None):
    return PortalService.download_invoice(name=name)


@frappe.whitelist()
@handle_errors
def download_breakdown(name=None):
    return PortalService.download_breakdown(name=name)


@frappe.whitelist()
@handle_errors
def dispute_invoice(name=None, reason=None):
    return PortalService.dispute_invoice(name=name, reason=reason)


@frappe.whitelist()
@handle_errors
def get_recent_activity(customer=None, limit=12):
    return PortalService.recent_activity(customer=customer, limit=limit)


@frappe.whitelist()
@handle_errors
def list_request_actions(for_new_user=None):
    return PortalService.list_request_actions(for_new_user=for_new_user)


@frappe.whitelist()
@handle_errors
def get_service_state(
    service_item=None, client_user=None, managed_device=None, customer=None
):
    return PortalService.service_state(
        service_item=service_item,
        client_user=client_user,
        managed_device=managed_device,
        customer=customer,
    )
