import frappe

from nexgen_msp.utils import device_holders as holders
from nexgen_msp.utils import remarks as remarks_util

from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.utils.errors import NotFoundError
from nexgen_msp.utils.wrapper_error_decorator import handle_errors


@frappe.whitelist()
@handle_errors
def get_request_filter_options():
    return RequestService.get_filter_options()


@frappe.whitelist()
@handle_errors
def get_request_stats(
    search=None, status=None, priority=None, request_type=None, customer=None, scope=None
):
    return RequestService.get_stats(
        search=search,
        status=status,
        priority=priority,
        request_type=request_type,
        customer=customer,
        scope=scope,
    )


@frappe.whitelist()
@handle_errors
def list_requests(
    search=None,
    status=None,
    priority=None,
    request_type=None,
    customer=None,
    scope=None,
    start=0,
    page_length=20,
):
    return RequestService.list_requests(
        search=search,
        status=status,
        priority=priority,
        request_type=request_type,
        customer=customer,
        scope=scope,
        start=start,
        page_length=page_length,
    )


@frappe.whitelist()
@handle_errors
def get_request(name=None):
    return RequestService.get_request(name=name)


@frappe.whitelist()
@handle_errors
def run_request_action(name=None, action=None, reason=None):
    return RequestService.run_action(name=name, action=action, reason=reason)


@frappe.whitelist()
@handle_errors
def set_request_delivery_detail(name=None, idx=None, serial_number=None, username=None):
    return RequestService.set_delivery_detail(
        name=name, idx=idx, serial_number=serial_number, username=username
    )


@frappe.whitelist()
@handle_errors
def set_request_line_status(name=None, idx=None, line_status=None, reason=None):
    return RequestService.set_line_status(
        name=name, idx=idx, line_status=line_status, reason=reason
    )


@frappe.whitelist()
@handle_errors
def get_dashboard():
    from nexgen_msp.api.internal.services.dashboard_service import DashboardService

    return DashboardService.get_dashboard()


@frappe.whitelist()
@handle_errors
def get_user_filter_options():
    from nexgen_msp.api.internal.services.user_service import UserService

    return UserService.get_filter_options()


EXPORT_COLUMNS = {
    "users": [
        ("full_name", "User"),
        ("email", "Email"),
        ("department", "Department"),
        ("customer", "Customer"),
        ("lifecycle_status", "Status"),
        ("hostnames", "Devices"),
        ("device_type", "Device type"),
        # each side reads count, then names, then the date it started or ended
        ("active_services", "Active services"),
        ("services", "Services"),
        ("start_date", "In service since"),
        ("last_billed_on", "Last billed on"),
        ("covered_until", "Billed up to"),
        ("inactive_services", "Inactive services"),
        ("inactive_service_names", "Ended services"),
        ("disabled_date", "Disabled on"),
        ("remarks", "Remarks"),
    ],
    "devices": [
        ("hostname", "Device"),
        ("device_type", "Type"),
        ("customer", "Customer"),
        ("user_name", "Held by"),
        ("user_department", "Department"),
        ("status", "Status"),
        ("serial_number", "Serial number"),
        ("assigned_date", "In service since"),
        ("last_billed_on", "Last billed on"),
        ("covered_until", "Billed up to"),
        ("previous_holders", "Previous holders"),
        ("services", "Services"),
        ("inactive_service_names", "Ended services"),
        ("active_services", "Active services"),
        ("inactive_services", "Inactive services"),
        ("remarks", "Remarks"),
    ],
    "requests": [
        ("name", "Request"),
        ("customer", "Customer"),
        ("request_type", "Type"),
        ("status", "Status"),
        ("priority", "Priority"),
        ("source", "Source"),
        ("requester", "Raised by"),
        ("users", "People"),
        ("line_count", "Lines"),
        ("pending_lines", "Pending"),
        ("creation", "Raised on"),
    ],
}

# a sheet is read once and kept, so it carries the whole filtered set, not one page.
# The listing services cap a page on purpose, so the export walks the pages instead of
# asking for a size they would clamp back down.
EXPORT_LIMIT = 20000
EXPORT_PAGE = 200


def _collect(fetch, **filters):
    rows = []

    while len(rows) < EXPORT_LIMIT:
        page = fetch(start=len(rows), page_length=EXPORT_PAGE, **filters)
        batch = page["rows"]
        rows.extend(batch)

        if len(batch) < EXPORT_PAGE or not page.get("has_more"):
            break

    return rows


@frappe.whitelist()
@handle_errors
def export_users(
    search=None, customer=None, status=None, department=None, service=None, coverage=None,
    portal=None,
):
    from nexgen_msp.api.internal.services.user_service import UserService
    from nexgen_msp.utils import listing_export

    rows = _collect(
        UserService.list_users, search=search, customer=customer, status=status,
        department=department, service=service, coverage=coverage, portal=portal,
    )

    for row in rows:
        row["remarks"] = remarks_util.joined("MSP Client User", row["name"])

    return listing_export.respond(
        "users.xlsx", "Users", EXPORT_COLUMNS["users"], rows
    )


@frappe.whitelist()
@handle_errors
def export_devices(search=None, customer=None, status=None, device_type=None, coverage=None):
    from nexgen_msp.utils import listing_export

    rows = _collect(
        _devices().list_devices, search=search, customer=customer, status=status,
        device_type=device_type, coverage=coverage,
    )

    for row in rows:
        row["remarks"] = remarks_util.joined("MSP Managed Device", row["name"])
        # who held it before, so a sheet tells the whole story of the machine
        row["previous_holders"] = " | ".join(
            f"{spell.full_name or spell.client_user}"
            f" ({spell.from_date or '?'} → {spell.to_date or 'now'})"
            for spell in holders.history(row["name"])
        )

    return listing_export.respond(
        "devices.xlsx", "Devices", EXPORT_COLUMNS["devices"], rows
    )


@frappe.whitelist()
@handle_errors
def export_requests(
    search=None, status=None, priority=None, request_type=None, customer=None, scope=None
):
    from nexgen_msp.utils import listing_export

    rows = _collect(
        RequestService.list_requests, search=search, status=status, priority=priority,
        request_type=request_type, customer=customer, scope=scope,
    )

    return listing_export.respond(
        "requests.xlsx", "Requests", EXPORT_COLUMNS["requests"], rows
    )


@frappe.whitelist()
@handle_errors
def get_user_stats(search=None, customer=None, status=None, department=None, service=None,
                   coverage=None, portal=None):
    from nexgen_msp.api.internal.services.user_service import UserService

    return UserService.get_stats(search=search, customer=customer, status=status,
                                 department=department, service=service, coverage=coverage,
                                 portal=portal)


@frappe.whitelist()
@handle_errors
def list_users(
    search=None,
    customer=None,
    status=None,
    department=None,
    service=None,
    coverage=None,
    portal=None,
    start=0,
    page_length=20,
):
    from nexgen_msp.api.internal.services.user_service import UserService

    return UserService.list_users(
        search=search,
        customer=customer,
        status=status,
        department=department,
        service=service,
        coverage=coverage,
        portal=portal,
        start=start,
        page_length=page_length,
    )


@frappe.whitelist()
@handle_errors
def delete_client_user(name=None):
    from nexgen_msp.api.internal.services.user_service import UserService

    return UserService.delete_client_user(name=name)


@frappe.whitelist()
@handle_errors
def get_user(name=None):
    from nexgen_msp.api.internal.services.user_service import UserService

    return UserService.get_user(name=name)


@frappe.whitelist()
@handle_errors
def assign_user_service(
    client_user=None,
    service_item=None,
    effective_date=None,
    device_mode=None,
    managed_device=None,
    hostname=None,
    device_type=None,
    interfaces=None,
    serial_number=None,
    username=None,
    notes=None,
    source_request=None,
    target_scope=None,
):
    from nexgen_msp.api.internal.services.user_service import UserService

    return UserService.assign_service(
        client_user=client_user,
        service_item=service_item,
        effective_date=effective_date,
        device_mode=device_mode,
        managed_device=managed_device,
        hostname=hostname,
        device_type=device_type,
        interfaces=interfaces,
        serial_number=serial_number,
        username=username,
        notes=notes,
        source_request=source_request,
        target_scope=target_scope,
    )


@frappe.whitelist()
@handle_errors
def change_user_service(
    assignment=None, action=None, effective_date=None, notes=None, source_request=None
):
    from nexgen_msp.api.internal.services.user_service import UserService

    return UserService.change_service(
        assignment=assignment,
        action=action,
        effective_date=effective_date,
        notes=notes,
        source_request=source_request,
    )


@frappe.whitelist()
@handle_errors
def get_contract_options():
    from nexgen_msp.api.internal.services.contract_service import ContractService

    return ContractService.get_options()


@frappe.whitelist()
@handle_errors
def list_contracts():
    from nexgen_msp.api.internal.services.contract_service import ContractService

    return ContractService.list_contracts()


@frappe.whitelist()
@handle_errors
def get_contract(customer=None):
    from nexgen_msp.api.internal.services.contract_service import ContractService

    return ContractService.get_contract(customer=customer)


@frappe.whitelist()
@handle_errors
def save_contract(customer=None, profile=None, services=None):
    from nexgen_msp.api.internal.services.contract_service import ContractService

    return ContractService.save_contract(customer=customer, profile=profile, services=services)


def _billing():
    from nexgen_msp.api.internal.services.billing_service import BillingService

    return BillingService


@frappe.whitelist()
@handle_errors
def preview_billing_run(
    contract=None,
    period_start=None,
    period_end=None,
    adjustment_of=None,
    filters=None,
    discount_percent=0,
):
    return _billing().preview(
        contract=contract,
        period_start=period_start,
        period_end=period_end,
        adjustment_of=adjustment_of,
        filters=filters,
        discount_percent=discount_percent,
    )


@frappe.whitelist()
@handle_errors
def get_billing_filter_options(customer=None):
    return _billing().filter_options(customer=customer)


@frappe.whitelist()
@handle_errors
def generate_billing_run(
    contract=None,
    period_start=None,
    period_end=None,
    adjustment_of=None,
    include=None,
    discount_percent=0,
):
    return _billing().generate(
        contract=contract,
        period_start=period_start,
        period_end=period_end,
        adjustment_of=adjustment_of,
        include=include,
        discount_percent=discount_percent,
    )


@frappe.whitelist()
@handle_errors
def list_billing_runs(
    customer=None,
    customers=None,
    status=None,
    statuses=None,
    contract=None,
    period_from=None,
    period_to=None,
    search=None,
    start=0,
    page_length=20,
):
    return _billing().list_runs(
        customer=customer,
        customers=customers,
        status=status,
        statuses=statuses,
        contract=contract,
        period_from=period_from,
        period_to=period_to,
        search=search,
        start=start,
        page_length=page_length,
    )


@frappe.whitelist()
@handle_errors
def get_billing_run(name=None):
    return _billing().get_run(name=name)


@frappe.whitelist()
@handle_errors
def revalidate_billing_run(name=None):
    return _billing().revalidate(name=name)


@frappe.whitelist()
@handle_errors
def approve_billing_run(name=None):
    return _billing().approve(name=name)


@frappe.whitelist()
@handle_errors
def cancel_billing_run(name=None):
    return _billing().cancel(name=name)


@frappe.whitelist()
@handle_errors
def get_billing_invoice(name=None):
    return _billing().invoice_view(name=name)


@frappe.whitelist()
@handle_errors
def billing_period_status(contract=None, period_start=None, period_end=None):
    return _billing().period_status(
        contract=contract, period_start=period_start, period_end=period_end
    )


@frappe.whitelist()
@handle_errors
def get_exchange_preview(name=None):
    return _billing().exchange_preview(name=name)


@frappe.whitelist()
@handle_errors
def finalise_billing_run(name=None, dimensions=None, exchange_rate=None):
    return _billing().finalise(name=name, dimensions=dimensions, exchange_rate=exchange_rate)


@frappe.whitelist()
@handle_errors
def invoice_billing_run(name=None, dimensions=None, exchange_rate=None):
    return _billing().create_invoice(
        name=name, dimensions=dimensions, exchange_rate=exchange_rate
    )


def _dimensions():
    from nexgen_msp.api.internal.services.accounting_dimension_service import (
        AccountingDimensionService,
    )

    return AccountingDimensionService


@frappe.whitelist()
@handle_errors
def get_invoice_dimensions():
    return _dimensions().catalogue()


@frappe.whitelist()
@handle_errors
def create_cost_center(cost_center_name=None):
    return _dimensions().create_cost_center(cost_center_name=cost_center_name)


@frappe.whitelist()
@handle_errors
def add_user_device(
    client_user=None,
    hostname=None,
    device_type=None,
    interfaces=None,
    assigned_date=None,
    serial_number=None,
    remarks=None,
    source_request=None,
):
    from nexgen_msp.api.internal.services.user_service import UserService

    return UserService.add_device(
        client_user=client_user,
        hostname=hostname,
        device_type=device_type,
        interfaces=interfaces,
        assigned_date=assigned_date,
        serial_number=serial_number,
        remarks=remarks,
        source_request=source_request,
    )


@frappe.whitelist()
@handle_errors
def create_client_user(
    customer=None,
    full_name=None,
    department=None,
    email=None,
    username=None,
    start_date=None,
    remarks=None,
    source_request=None,
    request_line=None,
):
    from nexgen_msp.api.internal.services.user_service import UserService

    return UserService.create_client_user(
        customer=customer,
        full_name=full_name,
        department=department,
        email=email,
        username=username,
        start_date=start_date,
        remarks=remarks,
        source_request=source_request,
        request_line=request_line,
    )


def _devices():
    from nexgen_msp.api.internal.services.device_service import DeviceService

    return DeviceService


@frappe.whitelist()
@handle_errors
def get_device_filter_options():
    return _devices().get_filter_options()


@frappe.whitelist()
@handle_errors
def get_device_stats(search=None, customer=None, status=None, device_type=None, coverage=None):
    return _devices().get_stats(
        search=search,
        customer=customer,
        status=status,
        device_type=device_type,
        coverage=coverage,
    )


@frappe.whitelist()
@handle_errors
def list_devices(
    search=None, customer=None, status=None, device_type=None, coverage=None, start=0, page_length=20
):
    return _devices().list_devices(
        search=search,
        customer=customer,
        status=status,
        device_type=device_type,
        coverage=coverage,
        start=start,
        page_length=page_length,
    )


@frappe.whitelist()
@handle_errors
def get_device_context(device=None):
    return _devices().get_device_context(device=device)


@frappe.whitelist()
@handle_errors
def add_remark(doctype=None, name=None, note=None):
    return remarks_util.append(doctype=doctype, name=name, note=note)


@frappe.whitelist()
@handle_errors
def delete_device(device=None):
    return _devices().delete_device(device=device)


@frappe.whitelist()
@handle_errors
def get_device(device=None):
    return _devices().get_device(device=device)


@frappe.whitelist()
@handle_errors
def assign_device_service(
    device=None, service_item=None, effective_date=None, notes=None, source_request=None
):
    return _devices().assign_device_service(
        device=device,
        service_item=service_item,
        effective_date=effective_date,
        notes=notes,
        source_request=source_request,
    )


@frappe.whitelist()
@handle_errors
def update_managed_device(
    device=None,
    hostname=None,
    device_type=None,
    serial_number=None,
    assigned_date=None,
    interfaces=None,
    remarks=None,
):
    return _devices().update_device(
        device=device,
        hostname=hostname,
        device_type=device_type,
        serial_number=serial_number,
        assigned_date=assigned_date,
        interfaces=interfaces,
        remarks=remarks,
    )


@frappe.whitelist()
@handle_errors
def list_customer_devices(customer=None, exclude_holder=None):
    return _devices().list_customer_devices(customer=customer, exclude_holder=exclude_holder)


@frappe.whitelist()
@handle_errors
def find_device_hostname(customer=None, hostname=None):
    return _devices().find_hostname(customer=customer, hostname=hostname)


def _authority():
    from nexgen_msp.api.internal.services.authority_service import AuthorityService

    return AuthorityService


@frappe.whitelist()
@handle_errors
def get_person_rights(client_user=None):
    return _authority().rights_of_person(client_user=client_user)


@frappe.whitelist()
@handle_errors
def set_person_rights(client_user=None, rights=None):
    return _authority().set_rights_of_person(client_user=client_user, rights=rights)


@frappe.whitelist()
@handle_errors
def get_customer_authority(customer=None):
    return _authority().get_authority(customer=customer)


@frappe.whitelist()
@handle_errors
def save_customer_authority(customer=None, enabled=1, approvers=None):
    return _authority().save_authority(customer=customer, enabled=enabled, approvers=approvers)


@frappe.whitelist()
@handle_errors
def find_device_serial(serial_number=None, exclude=None):
    return _devices().find_serial(serial_number=serial_number, exclude=exclude)


@frappe.whitelist()
@handle_errors
def hand_over_device(device=None, client_user=None, on_date=None, note=None):
    return _devices().hand_over_device(
        device=device, client_user=client_user, on_date=on_date, note=note
    )


@frappe.whitelist()
@handle_errors
def change_device_status(
    device=None, action=None, status=None, effective_date=None, assigned_client_user=None, notes=None
):
    return _devices().change_device_status(
        device=device,
        action=action,
        status=status,
        effective_date=effective_date,
        assigned_client_user=assigned_client_user,
        notes=notes,
    )


@frappe.whitelist()
@handle_errors
def create_managed_device(
    customer=None,
    hostname=None,
    device_type=None,
    serial_number=None,
    assigned_client_user=None,
    assigned_date=None,
    interfaces=None,
    remarks=None,
    source_request=None,
):
    return _devices().create_device(
        customer=customer,
        hostname=hostname,
        device_type=device_type,
        serial_number=serial_number,
        assigned_client_user=assigned_client_user,
        assigned_date=assigned_date,
        interfaces=interfaces,
        remarks=remarks,
        source_request=source_request,
    )


@frappe.whitelist()
@handle_errors
def list_customer_users(customer=None):
    return _devices().list_customer_users(customer=customer)


@frappe.whitelist()
@handle_errors
def list_dashboard_kpi_rows(kpi=None, start=0, page_length=20):
    from nexgen_msp.api.internal.services.dashboard_service import DashboardService

    return DashboardService.list_kpi_rows(kpi=kpi, start=start, page_length=page_length)


def _catalogue():
    from nexgen_msp.api.internal.services.catalogue_service import CatalogueService

    return CatalogueService


@frappe.whitelist()
@handle_errors
def get_catalogue_options():
    return _catalogue().get_options()


@frappe.whitelist()
@handle_errors
def list_services():
    return _catalogue().list_services()


@frappe.whitelist()
@handle_errors
def save_service(
    name=None,
    item_code=None,
    item_name=None,
    scope=None,
    description=None,
    uom=None,
    disabled=None,
    invoice_label=None,
):
    return _catalogue().save_service(
        name=name,
        item_code=item_code,
        item_name=item_name,
        scope=scope,
        description=description,
        uom=uom,
        disabled=disabled,
        invoice_label=invoice_label,
    )


@frappe.whitelist()
@handle_errors
def get_service(name=None):
    return _catalogue().get_service(name=name)


@frappe.whitelist()
@handle_errors
def list_contract_rates(customer=None, service_item=None):
    from nexgen_msp.api.internal.services.contract_service import ContractService

    return ContractService.list_rates(customer=customer, service_item=service_item)


@frappe.whitelist()
@handle_errors
def save_contract_rate(
    customer=None,
    service_item=None,
    rate=None,
    valid_from=None,
    valid_upto=None,
    note=None,
    name=None,
    discount_percent=0,
):
    from nexgen_msp.api.internal.services.contract_service import ContractService

    return ContractService.save_rate(
        customer=customer,
        service_item=service_item,
        rate=rate,
        valid_from=valid_from,
        valid_upto=valid_upto,
        note=note,
        name=name,
        discount_percent=discount_percent,
    )


@frappe.whitelist()
@handle_errors
def delete_contract_rate(name=None):
    from nexgen_msp.api.internal.services.contract_service import ContractService

    return ContractService.delete_rate(name=name)


@frappe.whitelist()
@handle_errors
def set_service_eligibility(customer=None, service_item=None, is_eligible=None):
    from nexgen_msp.api.internal.services.contract_service import ContractService

    return ContractService.set_eligibility(
        customer=customer, service_item=service_item, is_eligible=is_eligible
    )


@frappe.whitelist()
@handle_errors
def submit_invoice_billing_run(name=None, notify=1):
    return _billing().submit_invoice(name=name, notify=notify)


def _agreements():
    from nexgen_msp.api.internal.services.msp_contract_service import MSPContractService

    return MSPContractService


@frappe.whitelist()
@handle_errors
def get_msp_contract_options(customer=None):
    return _agreements().options(customer=customer)


@frappe.whitelist()
@handle_errors
def list_msp_contracts(customer=None, status=None, billable_only=0):
    return _agreements().list_contracts(
        customer=customer, status=status, billable_only=billable_only
    )


@frappe.whitelist()
@handle_errors
def get_msp_contract(name=None):
    return _agreements().get_contract(name=name)


@frappe.whitelist()
@handle_errors
def save_msp_contract(name=None, contract=None, services=None):
    return _agreements().save_contract(name=name, contract=contract, services=services)


@frappe.whitelist()
@handle_errors
def set_msp_contract_status(name=None, status=None):
    return _agreements().set_status(name=name, status=status)


@frappe.whitelist()
@handle_errors
def get_billing_breakdown(name=None):
    return _billing().breakdown(name=name)


@frappe.whitelist()
@handle_errors
def build_billing_breakdown_file(name=None):
    from nexgen_msp.utils.billing_export import attach_breakdown

    _billing()._guard_admin()

    return attach_breakdown(name)


@frappe.whitelist()
@handle_errors
def get_creditable_lines(name=None):
    return _billing().creditable_lines(name=name)


@frappe.whitelist()
@handle_errors
def create_credit_note(name=None, lines=None, reason=None):
    return _billing().create_credit_note(name=name, lines=lines, reason=reason)


@frappe.whitelist()
@handle_errors
def download_billing_invoice(name=None):
    from nexgen_msp.utils import invoice_pdf

    _billing()._guard_admin()

    run = _billing().get_run(name=name)

    if not run["sales_invoice"]:
        raise NotFoundError(f"Billing Run {name} has no invoice yet.", "NOT_FOUND")

    invoice_pdf.respond(run["sales_invoice"])


@frappe.whitelist()
@handle_errors
def download_billing_breakdown(name=None):
    from nexgen_msp.utils.billing_export import breakdown_workbook

    data = _billing().breakdown(name=name)

    frappe.local.response.filename = (
        f"Breakdown-{data['customer']}-{data['period_label']}.xlsx".replace(" ", "-")
    )
    frappe.local.response.filecontent = breakdown_workbook(data)
    frappe.local.response.type = "download"


@frappe.whitelist()
@handle_errors
def get_billing_due(horizon_days=30):
    return _billing().due(horizon_days=horizon_days)


@frappe.whitelist()
@handle_errors
def discard_billing_invoice(name=None):
    return _billing().discard_invoice(name=name)


def _customers():
    from nexgen_msp.api.internal.services.customer_service import CustomerService

    return CustomerService


@frappe.whitelist()
@handle_errors
def get_customer_options():
    return _customers().options()


@frappe.whitelist()
@handle_errors
def get_customer_details(customer=None):
    return _customers().get_customer(customer=customer)


@frappe.whitelist()
@handle_errors
def save_customer_details(customer=None, details=None, address=None):
    return _customers().save_customer(customer=customer, details=details, address=address)


@frappe.whitelist()
@handle_errors
def reopen_billing_run(name=None):
    return _billing().reopen(name=name)


def _activity():
    from nexgen_msp.api.internal.services.activity_service import ActivityService

    return ActivityService


@frappe.whitelist()
@handle_errors
def get_activity_options():
    return _activity().options()


@frappe.whitelist()
@handle_errors
def list_activity(
    customers=None, kinds=None, date_from=None, date_to=None, start=0, page_length=25
):
    return _activity().list_activity(
        customers=customers,
        kinds=kinds,
        date_from=date_from,
        date_to=date_to,
        start=start,
        page_length=page_length,
    )


def _settings():
    from nexgen_msp.api.internal.services.settings_service import SettingsService

    return SettingsService


@frappe.whitelist()
@handle_errors
def get_settings_options():
    return _settings().options()


@frappe.whitelist()
@handle_errors
def list_request_actions():
    return _settings().list_request_actions()


@frappe.whitelist()
@handle_errors
def save_request_action(name=None, action=None):
    return _settings().save_request_action(name=name, action=action)


@frappe.whitelist()
@handle_errors
def delete_request_action(name=None):
    return _settings().delete_request_action(name=name)


def _team():
    from nexgen_msp.api.internal.services.team_service import TeamService

    return TeamService


@frappe.whitelist()
@handle_errors
def list_team(search=None, role=None, status=None, kind=None):
    return _team().list_members(search=search, role=role, status=status, kind=kind)


@frappe.whitelist()
@handle_errors
def get_team_member(email=None):
    return _team().get_member(email=email)


@frappe.whitelist()
@handle_errors
def get_team_options():
    return _team().options()


@frappe.whitelist()
@handle_errors
def invite_team_member(email=None, first_name=None, last_name=None, role=None, send_email=1):
    return _team().invite(
        email=email,
        first_name=first_name,
        last_name=last_name,
        role=role,
        send_email=send_email,
    )


@frappe.whitelist()
@handle_errors
def resend_team_invitation(email=None):
    return _team().send_invitation(email=email)


@frappe.whitelist()
@handle_errors
def set_team_role(email=None, role=None):
    return _team().set_role(email=email, role=role)


@frappe.whitelist()
@handle_errors
def set_team_enabled(email=None, enabled=None):
    return _team().set_enabled(email=email, enabled=enabled)


@frappe.whitelist()
@handle_errors
def get_invoice_settings():
    return _settings().get_invoice_settings()


@frappe.whitelist()
@handle_errors
def get_import_mappings():
    return _settings().get_import_mappings()


@frappe.whitelist()
@handle_errors
def save_import_mappings(customers=None, services=None):
    return _settings().save_import_mappings(customers=customers, services=services)


@frappe.whitelist()
@handle_errors
def upload_user_list():
    return _settings().upload_user_list()


@frappe.whitelist()
@handle_errors
def describe_asset_file(file_url=None):
    return _settings().describe_asset_file(file_url=file_url)


@frappe.whitelist()
@handle_errors
def run_asset_import(file_url=None, dry_run=1, fill_blanks_only=1):
    return _settings().run_asset_import(
        file_url=file_url, dry_run=dry_run, fill_blanks_only=fill_blanks_only
    )


@frappe.whitelist()
@handle_errors
def run_user_import(file_url=None, dry_run=1, fill_blanks_only=1):
    return _settings().run_user_import(
        file_url=file_url, dry_run=dry_run, fill_blanks_only=fill_blanks_only
    )


@frappe.whitelist()
@handle_errors
def save_invoice_settings(settings=None):
    return _settings().save_invoice_settings(settings=settings)


@frappe.whitelist()
@handle_errors
def resolve_billing_dispute(name=None, note=None):
    return _billing().resolve_dispute(name=name, note=note)


@frappe.whitelist()
@handle_errors
def update_client_user(
    name=None,
    full_name=None,
    department=None,
    email=None,
    username=None,
    start_date=None,
    remarks=None,
):
    from nexgen_msp.api.internal.services.user_service import UserService

    return UserService.update_client_user(
        name=name,
        full_name=full_name,
        department=department,
        email=email,
        username=username,
        start_date=start_date,
        remarks=remarks,
    )


@frappe.whitelist()
@handle_errors
def set_billing_line_discount(name=None, service_assignment=None, discount_percent=0):
    return _billing().set_line_discount(
        name=name, service_assignment=service_assignment, discount_percent=discount_percent
    )


@frappe.whitelist()
@handle_errors
def invite_client_user_to_portal(name=None, email=None):
    from nexgen_msp.api.internal.services.user_service import UserService

    return UserService.invite_to_portal(name=name, email=email)


@frappe.whitelist()
@handle_errors
def revoke_client_user_portal(name=None):
    from nexgen_msp.api.internal.services.user_service import UserService

    return UserService.revoke_portal_access(name=name)
