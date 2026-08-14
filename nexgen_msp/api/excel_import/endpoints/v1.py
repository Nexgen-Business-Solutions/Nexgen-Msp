import frappe

from nexgen_msp.api.excel_import.services.excel_import_service import ExcelImportService
from nexgen_msp.utils.wrapper_error_decorator import handle_errors


@frappe.whitelist()
@handle_errors
def import_users(
    file_url=None,
    dry_run=1,
    company=None,
    create_items=1,
    create_portal_users=0,
    send_welcome_email=0,
):
    return ExcelImportService.import_users(
        file_url=file_url,
        dry_run=dry_run,
        company=company,
        create_items=create_items,
        create_portal_users=create_portal_users,
        send_welcome_email=send_welcome_email,
    )
