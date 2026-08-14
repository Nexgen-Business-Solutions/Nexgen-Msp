import re

import frappe

from nexgen_msp.api.excel_import.services import excel_parser
from nexgen_msp.utils import permissions
from nexgen_msp.utils.errors import NotFoundError, ValidationError

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$")

SERVICE_CATALOGUE = {
    "parallels": {
        "item_code": "SVC-PARALLELS",
        "item_name": "Parallels User License",
        "scope": "User",
    },
    "nextcloud": {
        "item_code": "SVC-NEXTCLOUD",
        "item_name": "Nextcloud User Account",
        "scope": "User",
    },
    "sophos": {
        "item_code": "SVC-SOPHOS",
        "item_name": "Sophos Endpoint Protection",
        "scope": "Device",
    },
}

ITEM_GROUP = "Services"
DEFAULT_UOM = "Unit"
MIGRATION_TAG = "list of users.xlsx"


class ExcelImportService:
    @staticmethod
    def import_users(
        file_url=None,
        dry_run=1,
        company=None,
        create_items=1,
        create_portal_users=0,
        send_welcome_email=0,
    ):
        dry_run = frappe.utils.cint(dry_run)
        create_items = frappe.utils.cint(create_items)
        create_portal_users = frappe.utils.cint(create_portal_users)
        send_welcome_email = frappe.utils.cint(send_welcome_email)

        if not frappe.has_permission("Client User", "create"):
            raise ValidationError("You are not allowed to import client users.", "PERMISSION_DENIED", 403)

        path = ExcelImportService._resolve_path(file_url)
        rows = excel_parser.load_rows(path)

        report = {
            "dry_run": bool(dry_run),
            "rows_read": len(rows),
            "created": {
                "customers": 0,
                "items": 0,
                "client_users": 0,
                "managed_devices": 0,
                "network_interfaces": 0,
                "service_assignments": 0,
                "portal_users": 0,
                "portal_contacts": 0,
            },
            "skipped": {
                "rows_failed": 0,
                "devices_without_hostname": 0,
                "duplicate_hostname": 0,
                "invalid_macs": 0,
                "rows_without_email": 0,
                "invalid_emails": 0,
                "duplicate_emails": 0,
                "portal_access_failed": 0,
            },
            "exceptions": [],
        }

        records = [excel_parser.parse_row(row, index + 2) for index, row in enumerate(rows)]

        if company:
            wanted = company.strip().lower()
            records = [r for r in records if (r["company"] or "").lower() == wanted]
            report["rows_read"] = len(records)

        try:
            customers = ExcelImportService._ensure_customers(records, report)

            items = {}
            if create_items:
                items = ExcelImportService._ensure_items(report)

            hostname_seen = {}
            email_seen = {}

            for record in records:
                if not record["full_name"] or not record["company"]:
                    report["exceptions"].append(
                        {"row": record["row_number"], "reason": "Missing full name or company"}
                    )
                    report["skipped"]["rows_failed"] += 1
                    continue

                savepoint = f"row_{record['row_number']}"
                frappe.db.savepoint(savepoint)
                counters_before = dict(report["created"])

                try:
                    customer = customers.get(record["company"].lower())
                    client_user = ExcelImportService._create_client_user(record, customer, report)
                    device = ExcelImportService._create_device(
                        record, customer, client_user, hostname_seen, report
                    )
                    ExcelImportService._create_assignments(
                        record, customer, client_user, device, items, report
                    )

                    if create_portal_users:
                        portal_savepoint = f"portal_{record['row_number']}"
                        frappe.db.savepoint(portal_savepoint)
                        try:
                            ExcelImportService._create_portal_access(
                                record, customer, client_user, email_seen, send_welcome_email, report
                            )
                        except Exception as portal_error:
                            frappe.db.rollback(save_point=portal_savepoint)
                            frappe.clear_messages()
                            report["skipped"]["portal_access_failed"] += 1
                            report["exceptions"].append(
                                {
                                    "row": record["row_number"],
                                    "name": record["full_name"],
                                    "reason": "Portal access skipped: "
                                    + ExcelImportService._clean_message(portal_error),
                                }
                            )
                except Exception as e:
                    frappe.db.rollback(save_point=savepoint)
                    frappe.clear_messages()
                    report["created"] = counters_before
                    report["skipped"]["rows_failed"] += 1
                    report["exceptions"].append(
                        {
                            "row": record["row_number"],
                            "name": record["full_name"],
                            "reason": ExcelImportService._clean_message(e),
                        }
                    )

            if dry_run:
                frappe.db.rollback()
            else:
                frappe.db.commit()

        except Exception:
            frappe.db.rollback()
            raise

        return report

    @staticmethod
    def _clean_message(exception):
        import re

        text = re.sub(r"<[^>]+>", "", str(exception)).strip()
        return text[:200] or type(exception).__name__

    @staticmethod
    def _resolve_path(file_url):
        if not file_url:
            raise ValidationError("file_url is required.", "VALIDATION_ERROR")

        name = frappe.db.get_value("File", {"file_url": file_url}, "name")
        if not name:
            raise NotFoundError(f"No File record found for {file_url}.", "FILE_NOT_FOUND")

        return frappe.get_doc("File", name).get_full_path()

    @staticmethod
    def _ensure_customers(records, report):
        customers = {}

        for record in records:
            company = record["company"]
            if not company or company.lower() in customers:
                continue

            existing = frappe.db.get_value("Customer", {"customer_name": company}, "name")
            if existing:
                customers[company.lower()] = existing
                continue

            doc = frappe.get_doc({"doctype": "Customer", "customer_name": company}).insert()
            customers[company.lower()] = doc.name
            report["created"]["customers"] += 1

        return customers

    @staticmethod
    def _ensure_items(report):
        items = {}

        if not frappe.db.exists("Item Group", ITEM_GROUP):
            frappe.get_doc(
                {
                    "doctype": "Item Group",
                    "item_group_name": ITEM_GROUP,
                    "parent_item_group": "All Item Groups",
                    "is_group": 0,
                }
            ).insert()

        for key, spec in SERVICE_CATALOGUE.items():
            code = spec["item_code"]
            if frappe.db.exists("Item", code):
                items[key] = code
                continue

            frappe.get_doc(
                {
                    "doctype": "Item",
                    "item_code": code,
                    "item_name": spec["item_name"],
                    "item_group": ITEM_GROUP,
                    "stock_uom": DEFAULT_UOM,
                    "is_stock_item": 0,
                    "is_sales_item": 1,
                    "is_purchase_item": 0,
                }
            ).insert()
            items[key] = code
            report["created"]["items"] += 1

        return items

    @staticmethod
    def _lifecycle_status(record):
        if record["ad_disabled"]:
            return "Disabled"
        if record["ad_marked_active"] or record["ad_created"]:
            return "Active"
        return "Pending"

    @staticmethod
    def _create_client_user(record, customer, report):
        status = ExcelImportService._lifecycle_status(record)

        doc = frappe.get_doc(
            {
                "doctype": "Client User",
                "full_name": record["full_name"],
                "customer": customer,
                "department": record["department"],
                "email": record["email"],
                "lifecycle_status": status,
                "start_date": record["ad_created"],
                "disabled_date": record["ad_disabled"] if status == "Disabled" else None,
                "ad_status": "Active" if record["ad_marked_active"] else "Not Managed",
                "portal_visible": 1,
                "remarks": record["remarks"],
            }
        ).insert()

        report["created"]["client_users"] += 1
        return doc.name

    @staticmethod
    def _create_device(record, customer, client_user, hostname_seen, report):
        if not record["hostname"]:
            report["skipped"]["devices_without_hostname"] += 1
            return None

        key = (customer, record["hostname"])
        if key in hostname_seen:
            report["skipped"]["duplicate_hostname"] += 1
            report["exceptions"].append(
                {
                    "row": record["row_number"],
                    "reason": f"Hostname {record['hostname']} already used by row {hostname_seen[key]}",
                }
            )
            return None

        hostname_seen[key] = record["row_number"]

        if record["invalid_macs"]:
            report["skipped"]["invalid_macs"] += len(record["invalid_macs"])
            report["exceptions"].append(
                {
                    "row": record["row_number"],
                    "reason": f"Invalid MAC ignored: {', '.join(record['invalid_macs'])}",
                }
            )

        status = "Retired" if record["device_disabled"] else "Active"

        doc = frappe.get_doc(
            {
                "doctype": "Managed Device",
                "customer": customer,
                "assigned_client_user": client_user,
                "hostname": record["hostname"],
                "device_type": record["device_type"] or "Other",
                "status": status,
                "assigned_date": record["device_created"],
                "retired_date": record["device_disabled"] if status == "Retired" else None,
                "network_interfaces": record["macs"],
                "remarks": record["remarks"],
            }
        ).insert()

        report["created"]["managed_devices"] += 1
        report["created"]["network_interfaces"] += len(record["macs"])
        return doc.name

    @staticmethod
    def _create_portal_access(record, customer, client_user, email_seen, send_welcome_email, report):
        email = (record["email"] or "").strip().lower()

        if not email:
            report["skipped"]["rows_without_email"] += 1
            return

        if not EMAIL_PATTERN.match(email):
            report["skipped"]["invalid_emails"] += 1
            report["exceptions"].append(
                {"row": record["row_number"], "reason": f"Invalid email ignored: {email}"}
            )
            return

        if email in email_seen:
            report["skipped"]["duplicate_emails"] += 1
            report["exceptions"].append(
                {
                    "row": record["row_number"],
                    "reason": f"Email {email} already used by row {email_seen[email]}",
                }
            )
            return

        email_seen[email] = record["row_number"]

        names = (record["full_name"] or "").split()
        first_name = names[0] if names else email
        last_name = " ".join(names[1:]) or None

        user, user_created = permissions.ensure_portal_user(
            email, first_name, last_name, send_welcome_email
        )
        permissions.add_role(user, permissions.PORTAL_ROLES[0])

        contact, contact_created = permissions.ensure_customer_contact(user, customer)

        frappe.db.set_value("Client User", client_user, "portal_user", user.name)

        if user_created:
            report["created"]["portal_users"] += 1
        if contact_created:
            report["created"]["portal_contacts"] += 1

    @staticmethod
    def _create_assignments(record, customer, client_user, device, items, report):
        for key, active in record["services"].items():
            if not active or key not in items:
                continue

            spec = SERVICE_CATALOGUE[key]

            if spec["scope"] == "Device" and not device:
                report["exceptions"].append(
                    {
                        "row": record["row_number"],
                        "reason": f"{spec['item_name']} skipped: no device on this row",
                    }
                )
                continue

            start = record["nextcloud_activated"] if key == "nextcloud" else None
            end = record["nextcloud_disabled"] if key == "nextcloud" else None

            frappe.get_doc(
                {
                    "doctype": "Service Assignment",
                    "customer": customer,
                    "service_item": items[key],
                    "assignment_scope": spec["scope"],
                    "client_user": client_user if spec["scope"] == "User" else None,
                    "managed_device": device if spec["scope"] == "Device" else None,
                    "quantity": 1,
                    "uom": DEFAULT_UOM,
                    "operational_status": "Pending Setup",
                    "billing_status": "Pending",
                    "effective_start_date": start,
                    "effective_end_date": end,
                    "price_source": "Contract",
                    "migration_source": MIGRATION_TAG,
                }
            ).insert()

            report["created"]["service_assignments"] += 1
