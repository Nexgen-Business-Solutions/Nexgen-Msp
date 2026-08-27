import re

import frappe

from nexgen_msp.utils.catalogue import BILLING_UOM

from nexgen_msp.api.excel_import.services import excel_parser
from nexgen_msp.utils import permissions
from nexgen_msp.utils.errors import NotFoundError, ValidationError

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$")

ASSIGNMENT_STATUS = {
    "Active": ("Active", "Billable"),
    "Ended": ("Ended", "Ended"),
}



class ExcelImportService:
    # filled per import so the check below costs one query per customer
    _billed_customers = {}

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

        ExcelImportService._billed_customers = {}

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
                "assignments_active": 0,
                "assignments_ended": 0,
                "portal_users": 0,
                "portal_contacts": 0,
                "user_permissions": 0,
                "invitations_sent": 0,
                "customers_stamped": 0,
            },
            "updated": {
                "client_users": 0,
                "managed_devices": 0,
                "network_interfaces": 0,
            },
            "skipped": {
                "rows_failed": 0,
                "rows_unmapped": 0,
                "devices_without_hostname": 0,
                "duplicate_hostname": 0,
                "assignments_existing": 0,
                "invalid_macs": 0,
                "inconsistent_dates": 0,
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
            customer_map, service_map = ExcelImportService._mapping()
            customers = ExcelImportService._ensure_customers(records, report, customer_map)
            items = ExcelImportService._ensure_items(service_map, report)
            scopes = {key: (row.scope or "User") for key, row in service_map.items()}

            hostname_seen = {}
            email_seen = {}

            for record in records:
                if not record["full_name"] or not record["company"]:
                    report["exceptions"].append(
                        {"row": record["row_number"], "reason": "Missing full name or company"}
                    )
                    report["skipped"]["rows_failed"] += 1
                    continue

                if record["company"].lower() not in customers:
                    report["exceptions"].append(
                        {
                            "row": record["row_number"],
                            "name": record["full_name"],
                            "reason": f"No customer mapped for '{record['company']}' — "
                            "add it in Settings before importing.",
                        }
                    )
                    report["skipped"]["rows_unmapped"] += 1
                    continue

                savepoint = f"row_{record['row_number']}"
                frappe.db.savepoint(savepoint)
                counters_before = (dict(report["created"]), dict(report["updated"]))

                try:
                    customer = customers.get(record["company"].lower())
                    prefix = customer_map[record["company"].lower()].department_prefix
                    client_user = ExcelImportService._create_client_user(
                        record, customer, report, prefix
                    )
                    device = ExcelImportService._create_device(
                        record, customer, client_user, hostname_seen, report
                    )
                    ExcelImportService._create_assignments(
                        record, customer, client_user, device, items, scopes, report
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
                    report["created"], report["updated"] = counters_before
                    report["skipped"]["rows_failed"] += 1
                    report["exceptions"].append(
                        {
                            "row": record["row_number"],
                            "name": record["full_name"],
                            "reason": ExcelImportService._clean_message(e),
                        }
                    )

            ExcelImportService._stamp_customers(records, customers, report)

            if dry_run:
                frappe.db.rollback()
            else:
                frappe.db.commit()

        except Exception:
            frappe.db.rollback()
            raise

        return report

    @staticmethod
    def _stamp_customers(records, customers, report):
        """Carry the latest imported billing date up onto the customer."""
        latest = {}

        for record in records:
            billed = record.get("last_billed_on")
            customer = customers.get((record["company"] or "").lower())

            if not billed or not customer:
                continue

            billed = frappe.utils.getdate(billed)

            if customer not in latest or billed > latest[customer]:
                latest[customer] = billed

        for customer, billed in latest.items():
            if ExcelImportService._has_own_billing(customer):
                continue

            frappe.db.set_value("Customer", customer, "msp_last_billed_on", billed)
            report["created"]["customers_stamped"] += 1

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
    def _mapping():
        """What the file calls a company or a service, and what it is on this site.

        The site was populated long before this app existed, so nothing here is matched on
        a label: a row reaches a customer by its id or it does not reach one at all.
        """
        doc = frappe.get_single("MSP Import Settings")

        return (
            {
                (row.excel_label or "").strip().lower(): row
                for row in doc.customer_mappings
                if row.excel_label
            },
            {
                (row.service_key or "").strip().lower(): row
                for row in doc.service_mappings
                if row.service_key
            },
        )

    @staticmethod
    def _ensure_customers(records, report, mapping):
        """Resolve every company in the file to a customer that already exists.

        A company with no mapping is left unresolved on purpose: the rows that carry it are
        rejected and named in the report, rather than quietly opening a second customer next
        to the real one.
        """
        customers = {}

        for record in records:
            company = (record["company"] or "").strip()
            key = company.lower()

            if not company or key in customers:
                continue

            row = mapping.get(key)

            if not row:
                continue

            if frappe.db.exists("Customer", row.customer_id):
                customers[key] = row.customer_id
                continue

            if not row.create_as:
                continue

            doc = frappe.get_doc(
                {"doctype": "Customer", "customer_name": row.create_as}
            ).insert()
            customers[key] = doc.name
            report["created"]["customers"] += 1

        return customers

    @staticmethod
    def _ensure_items(mapping, report):
        """The item each service column stands for, taken from the mapping and never created.

        The catalogue on this site predates the app, so an unmapped service is skipped for
        every row rather than opening a fourth article next to the three real ones.
        """
        items = {}

        for key, row in mapping.items():
            if row.item_id and frappe.db.exists("Item", row.item_id):
                items[key] = row.item_id
                continue

            report["exceptions"].append(
                {
                    "row": 0,
                    "reason": f"Service '{key}' maps to item '{row.item_id}', which does not "
                    "exist here — nothing was assigned for it.",
                }
            )

        return items

    @staticmethod
    def _assigned_services(record):
        return [service for service in record["services"].values() if service["assigned"]]

    @staticmethod
    def _lifecycle_status(record):
        if record["ad_disabled"]:
            return "Disabled"
        if record["ad_marked_active"] or record["ad_created"]:
            return "Active"
        return ExcelImportService._status_from_services(record)

    @staticmethod
    def _status_from_services(record):
        """Fall back on the services held when the AD columns say nothing."""
        statuses = {service["status"] for service in ExcelImportService._assigned_services(record)}

        if not statuses:
            return "Pending"

        return "Active" if "Active" in statuses else "Disabled"

    @staticmethod
    def _lifecycle_dates(record, status):
        """Borrow the service timeline when the AD columns carry no date."""
        start = record["ad_created"]
        end = record["ad_disabled"] if status == "Disabled" else None

        services = ExcelImportService._assigned_services(record)

        if not start:
            starts = [service["start"] for service in services if service["start"]]
            start = min(starts) if starts else None

        if status == "Disabled" and not end:
            ends = [service["end"] for service in services if service["end"]]
            end = max(ends) if ends else None

        return start, end

    @staticmethod
    def _reconcile_start(start, end, record, report, label):
        """Drop a start date that sits after its end date so the row still imports."""
        if not (start and end and end < start):
            return start

        report["skipped"]["inconsistent_dates"] += 1
        report["exceptions"].append(
            {
                "row": record["row_number"],
                "reason": f"{label}: end date precedes start date, start date dropped",
            }
        )
        return None

    @staticmethod
    def _department(record, prefix):
        """A sub-account keeps its own department behind the entity it belongs to.

        Its people are billed on the parent's contract, so the company they answer to would
        otherwise be lost the moment the two are merged under one customer.
        """
        department = (record["department"] or "").strip()

        if not prefix:
            return department or None

        return f"{prefix} — {department}" if department else prefix

    @staticmethod
    def _create_client_user(record, customer, report, prefix=None):
        status = ExcelImportService._lifecycle_status(record)
        start_date, disabled_date = ExcelImportService._lifecycle_dates(record, status)

        values = {
                "doctype": "Client User",
                "full_name": record["full_name"],
                "customer": customer,
                "department": ExcelImportService._department(record, prefix),
                "email": record["email"],
                "lifecycle_status": status,
                "start_date": ExcelImportService._reconcile_start(
                    start_date, disabled_date, record, report, "Client User"
                ),
                "disabled_date": disabled_date,
                "ad_status": "Active" if record["ad_marked_active"] else "Not Managed",
                "portal_visible": 1,
                "remark_log": (
                    [{"note": record["remarks"].strip(), "noted_on": frappe.utils.now(),
                      "noted_by": frappe.session.user}]
                    if (record["remarks"] or "").strip()
                    else []
                ),
                **ExcelImportService._imported_billing(record, customer, dates_only=True),
        }

        existing = frappe.db.get_value(
            "Client User", {"customer": customer, "full_name": record["full_name"]}, "name"
        )

        if existing:
            ExcelImportService._refresh(existing, values, report, "client_users")
            return existing

        doc = frappe.get_doc(values).insert()

        report["created"]["client_users"] += 1
        return doc.name

    @staticmethod
    def _refresh(name, values, report, counter):
        """Fill in what the record is still missing, and restate the billing dates.

        A spreadsheet re-import must not undo what the app or a person has since decided,
        so a field that already holds something is left alone. The billing dates are the
        exception: they are what the sheet is authoritative about, and `_imported_billing`
        has already withheld them for a customer this app bills itself.
        """
        doc = frappe.get_doc(values["doctype"], name)
        touched = False

        for field, value in values.items():
            if field == "doctype" or value in (None, "", []):
                continue

            # a note the sheet still carries is appended once, never stacked on re-import
            if field == "remark_log":
                held = {(row.note or "").strip() for row in doc.get("remark_log")}

                for row in value:
                    if row["note"] not in held:
                        doc.append("remark_log", row)
                        touched = True

                continue

            if field in ("covered_until", "last_billed_on") or not doc.get(field):
                if doc.get(field) != value:
                    doc.set(field, value)
                    touched = True

        if touched:
            doc.save()
            report["updated"][counter] += 1

        return doc

    @staticmethod
    def _imported_billing(record, customer, dates_only=False):
        """What the spreadsheet knows about billing, kept only while this app has billed nothing
        itself — once a run is invoiced the engine restates these from its own records."""
        if ExcelImportService._has_own_billing(customer):
            return {}

        values = {"covered_until": record.get("covered_until")}

        if not dates_only:
            values["last_billed_on"] = record.get("last_billed_on")

        return values

    @staticmethod
    def _has_own_billing(customer):
        """Whether this app has billed the customer itself, in which case it knows better."""
        if customer not in ExcelImportService._billed_customers:
            ExcelImportService._billed_customers[customer] = bool(
                frappe.db.exists("Billing Run", {"customer": customer, "status": "Invoiced"})
            )

        return ExcelImportService._billed_customers[customer]

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
        retired_date = record["device_disabled"] if status == "Retired" else None

        values = {
                "doctype": "Managed Device",
                "customer": customer,
                "assigned_client_user": client_user,
                "hostname": record["hostname"],
                "device_type": record["device_type"] or "Other",
                "status": status,
                "assigned_date": ExcelImportService._reconcile_start(
                    record["device_created"], retired_date, record, report, "Managed Device"
                ),
                "retired_date": retired_date,
                "network_interfaces": record["macs"],
                "remark_log": (
                    [{"note": record["remarks"].strip(), "noted_on": frappe.utils.now(),
                      "noted_by": frappe.session.user}]
                    if (record["remarks"] or "").strip()
                    else []
                ),
                **ExcelImportService._imported_billing(record, customer),
        }

        existing = frappe.db.get_value(
            "Managed Device", {"customer": customer, "hostname": record["hostname"]}, "name"
        )

        if existing:
            macs = values.pop("network_interfaces")
            ExcelImportService._refresh(existing, values, report, "managed_devices")
            ExcelImportService._add_interfaces(existing, macs, report)
            return existing

        doc = frappe.get_doc(values).insert()

        report["created"]["managed_devices"] += 1
        report["created"]["network_interfaces"] += len(record["macs"])
        return doc.name

    @staticmethod
    def _add_interfaces(device, macs, report):
        """Append the MAC addresses the device does not already carry."""
        doc = frappe.get_doc("Managed Device", device)
        held = {(row.mac_address or "").lower() for row in doc.network_interfaces}
        added = 0

        for mac in macs:
            address = (mac.get("mac_address") or "").lower()

            if not address or address in held:
                continue

            doc.append("network_interfaces", mac)
            held.add(address)
            added += 1

        if added:
            doc.save()
            report["updated"]["network_interfaces"] += added

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

        user, user_created = permissions.ensure_portal_user(email, first_name, last_name, 0)
        permissions.add_role(user, permissions.PORTAL_ROLES[0])

        permission_added = permissions.add_customer_permission(email, customer)
        contact, contact_created = permissions.ensure_customer_contact(user, customer)

        frappe.db.set_value("Client User", client_user, "portal_user", user.name)

        if user_created:
            report["created"]["portal_users"] += 1
        if contact_created:
            report["created"]["portal_contacts"] += 1
        if permission_added:
            report["created"]["user_permissions"] += 1

        if send_welcome_email and user_created:
            permissions.send_portal_invitation(user, customer)
            report["created"]["invitations_sent"] += 1

    @staticmethod
    def _create_assignments(record, customer, client_user, device, items, scopes, report):
        for key, lifecycle in record["services"].items():
            if not lifecycle["assigned"] or key not in items:
                continue

            scope = scopes.get(key, "User")

            if scope == "Device" and not device:
                report["exceptions"].append(
                    {
                        "row": record["row_number"],
                        "reason": f"{key.title()} skipped: no device on this row",
                    }
                )
                continue

            if lifecycle["inconsistent_start"]:
                report["skipped"]["inconsistent_dates"] += 1
                report["exceptions"].append(
                    {
                        "row": record["row_number"],
                        "reason": f"{key.title()}: end date precedes start date, start date dropped",
                    }
                )

            operational_status, billing_status = ASSIGNMENT_STATUS[lifecycle["status"]]

            held = {
                "customer": customer,
                "service_item": items[key],
                "client_user": client_user if scope == "User" else None,
                "managed_device": device if scope == "Device" else None,
            }

            if frappe.db.exists("Service Assignment", held):
                report["skipped"]["assignments_existing"] += 1
                continue

            frappe.get_doc(
                {
                    "doctype": "Service Assignment",
                    "customer": customer,
                    "service_item": items[key],
                    "assignment_scope": scope,
                    "client_user": client_user if scope == "User" else None,
                    "managed_device": device if scope == "Device" else None,
                    "quantity": 1,
                    "uom": BILLING_UOM,
                    "operational_status": operational_status,
                    "billing_status": billing_status,
                    "effective_start_date": lifecycle["start"],
                    "effective_end_date": lifecycle["end"],
                    "price_source": "Contract",
                }
            ).insert()

            report["created"]["service_assignments"] += 1
            report["created"][f"assignments_{lifecycle['status'].lower()}"] += 1
