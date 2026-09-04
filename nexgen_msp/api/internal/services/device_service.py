import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils import device_holders as holders
from nexgen_msp.utils import remarks as remarks_util

from nexgen_msp.utils.catalogue import security_item

from nexgen_msp.api.internal.services.request_service import CUSTOMER_STATUS, RequestService
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.utils.errors import NotFoundError, ValidationError


OPEN_ASSIGNMENT_STATUSES = ("Pending Setup", "Active", "Suspended", "Pending Removal")

COVERAGE_FILTERS = ("no_security", "unassigned", "no_mac")

MAX_PAGE_LENGTH = 200


class DeviceService:
    @staticmethod
    def get_filter_options():
        RequestService._guard_internal()

        return {
            "customers": frappe.get_all("Customer", pluck="name", order_by="name asc"),
            "device_types": [
                option
                for option in (
                    frappe.get_meta("MSP Managed Device").get_field("device_type").options or ""
                ).split("\n")
                if option
            ],
            "statuses": [
                option
                for option in (
                    frappe.get_meta("MSP Managed Device").get_field("status").options or ""
                ).split("\n")
                if option
            ],
            "coverage": list(COVERAGE_FILTERS),
        }

    @staticmethod
    def get_stats(search=None, customer=None, status=None, device_type=None, coverage=None):
        """The same figures the list is showing, over the same scope."""
        RequestService._guard_internal()

        where, params = DeviceService._conditions(search, customer, status, device_type, coverage)
        params = {**params, "item": security_item(), "open": OPEN_ASSIGNMENT_STATUSES}

        def count(predicate):
            clause = f"{where} and {predicate}" if where else f" where {predicate}"
            return frappe.db.sql(
                f"select count(*) from `tabMSP Managed Device` device {clause}", params
            )[0][0]

        return {
            "active_devices": count("device.status = 'Active'"),
            "unprotected_devices": count(
                """device.status = 'Active'
                   and not exists (
                       select 1 from `tabMSP Service Assignment` sa
                       where sa.managed_device = device.name
                         and sa.service_item = %(item)s
                         and sa.operational_status in %(open)s
                   )"""
            ),
            "unassigned_devices": count(
                """device.status = 'Active'
                   and (device.assigned_client_user is null or device.assigned_client_user = '')"""
            ),
            "devices_without_mac": count(
                """device.status = 'Active'
                   and not exists (
                       select 1 from `tabMSP Network Interface` ni where ni.parent = device.name
                   )"""
            ),
        }

    @staticmethod
    def _conditions(search, customer, status, device_type, coverage):
        conditions = []
        params = {"item": security_item(), "open": OPEN_ASSIGNMENT_STATUSES}

        if customer:
            conditions.append("device.customer = %(customer)s")
            params["customer"] = customer

        if status:
            conditions.append("device.status = %(status)s")
            params["status"] = status

        if device_type:
            conditions.append("device.device_type = %(device_type)s")
            params["device_type"] = device_type

        if coverage == "no_security":
            conditions.append("device.status = 'Active'")
            conditions.append(
                """not exists (
                    select 1 from `tabMSP Service Assignment` sa
                    where sa.managed_device = device.name
                      and sa.service_item = %(item)s
                      and sa.operational_status in %(open)s
                )"""
            )
        elif coverage == "unassigned":
            conditions.append("device.status = 'Active'")
            conditions.append(
                "(device.assigned_client_user is null or device.assigned_client_user = '')"
            )
        elif coverage == "no_mac":
            conditions.append("device.status = 'Active'")
            conditions.append(
                "not exists (select 1 from `tabMSP Network Interface` ni where ni.parent = device.name)"
            )

        if search:
            conditions.append(
                """(
                    device.hostname like %(search)s
                    or device.serial_number like %(search)s
                    or holder.full_name like %(search)s
                    or holder.username like %(search)s
                    or exists (
                        select 1 from `tabMSP Network Interface` ni
                        where ni.parent = device.name and ni.mac_address like %(search)s
                    )
                )"""
            )
            params["search"] = f"%{search}%"

        return (" where " + " and ".join(conditions)) if conditions else "", params

    @staticmethod
    def list_devices(
        search=None,
        customer=None,
        status=None,
        device_type=None,
        coverage=None,
        start=0,
        page_length=20,
    ):
        """The device register: hostname first, with the person currently holding it underneath."""
        RequestService._guard_internal()

        start = max(frappe.utils.cint(start), 0)
        page_length = min(max(frappe.utils.cint(page_length) or 20, 1), MAX_PAGE_LENGTH)

        where, params = DeviceService._conditions(search, customer, status, device_type, coverage)

        base_from = """
            from `tabMSP Managed Device` device
            left join `tabMSP Client User` holder on holder.name = device.assigned_client_user
        """

        total = frappe.db.sql(f"select count(*) {base_from} {where}", params)[0][0]

        rows = frappe.db.sql(
            f"""
            select
                device.name, device.hostname, device.device_type, device.status,
                device.assigned_date, device.serial_number, device.customer,
                device.last_billed_on, device.covered_until,
                device.assigned_client_user,
                holder.full_name as user_name,
                holder.username as holder_username,
                holder.department as user_department,
                holder.lifecycle_status as user_status,
                (select count(*) from `tabMSP Service Assignment` sa
                    where sa.managed_device = device.name
                      and sa.operational_status = 'Active') as active_services,
                (select count(*) from `tabMSP Service Assignment` sa
                    where sa.managed_device = device.name
                      and sa.operational_status != 'Active') as inactive_services,
                (select group_concat(distinct coalesce(item.item_name, sa.service_item)
                        order by item.item_name separator ', ')
                    from `tabMSP Service Assignment` sa
                    left join `tabItem` item on item.name = sa.service_item
                    where sa.managed_device = device.name
                      and sa.operational_status in %(open)s) as services,
                (select group_concat(distinct coalesce(item.item_name, sa.service_item)
                        order by item.item_name separator ', ')
                    from `tabMSP Service Assignment` sa
                    left join `tabItem` item on item.name = sa.service_item
                    where sa.managed_device = device.name
                      and sa.operational_status not in %(open)s) as inactive_service_names,
                (select r.note from `tabMSP Remark` r
                    where r.parent = device.name and r.parenttype = 'MSP Managed Device'
                    order by r.idx desc limit 1) as remarks,
                exists (
                    select 1 from `tabMSP Service Assignment` sa
                    where sa.managed_device = device.name
                      and sa.service_item = %(item)s
                      and sa.operational_status in %(open)s
                ) as protected
            {base_from}
            {where}
            order by device.hostname asc
            limit {page_length} offset {start}
            """,
            params,
            as_dict=True,
        )

        if rows:
            interfaces = frappe.get_all(
                "MSP Network Interface",
                filters={"parent": ("in", [row.name for row in rows])},
                fields=["parent", "interface_type", "mac_address"],
            )
            grouped = {}
            for interface in interfaces:
                grouped.setdefault(interface.parent, []).append(
                    {
                        "interface_type": interface.interface_type,
                        "mac_address": interface.mac_address,
                    }
                )
            for row in rows:
                row["interfaces"] = grouped.get(row.name, [])

        return {
            "rows": rows,
            "start": start,
            "page_length": page_length,
            "total": total,
            "has_more": start + len(rows) < total,
        }

    @staticmethod
    def get_device_context(device=None):
        """What the "add a service to this device" modal needs."""
        RequestService._guard_internal()

        if not device:
            raise ValidationError("device is required.", "VALIDATION_ERROR")

        doc = frappe.db.get_value(
            "MSP Managed Device",
            device,
            ["name", "hostname", "device_type", "status", "customer", "assigned_client_user"],
            as_dict=True,
        )

        if not doc:
            raise NotFoundError(f"Managed Device {device} not found.", "NOT_FOUND")

        open_items = frappe.db.sql_list(
            """
            select sa.service_item from `tabMSP Service Assignment` sa
            where sa.managed_device = %(device)s and sa.operational_status in %(open)s
            """,
            {"device": device, "open": OPEN_ASSIGNMENT_STATUSES},
        )

        catalogue = [
            {
                "name": item.name,
                "item_name": item.item_name,
                "scope": RequestService._service_scope(item.name),
                "already_open": item.name in open_items,
            }
            for item in frappe.get_all(
                "Item",
                filters={"disabled": 0, "is_stock_item": 0},
                fields=["name", "item_name"],
                order_by="item_name asc",
            )
        ]

        return {
            "device": doc,
            "user_name": frappe.db.get_value("MSP Client User", doc.assigned_client_user, "full_name")
            if doc.assigned_client_user
            else None,
            "catalogue": [item for item in catalogue if item["scope"] in ("Device", "Both")],
            "customer_requests": frappe.db.sql(
                """
                select sr.name, sr.request_type, sr.status, sr.priority, sr.source,
                       coalesce(requester.full_name, sr.requester) as requester,
                       sr.creation, sr.customer
                from `tabMSP Service Request` sr
                left join `tabUser` requester on requester.name = sr.requester
                where sr.customer = %(customer)s
                  and sr.status != %(customer_status)s
                order by field(sr.status, 'Completed', 'Rejected', 'Cancelled') asc,
                         sr.creation desc
                limit 30
                """,
                {"customer": doc.customer, "customer_status": CUSTOMER_STATUS},
                as_dict=True,
            ),
        }

    @staticmethod
    def get_device(device=None):
        """Everything known about one machine: what runs on it, and what can be done to it."""
        RequestService._guard_internal()

        if not device:
            raise ValidationError("device is required.", "VALIDATION_ERROR")

        doc = frappe.db.get_value(
            "MSP Managed Device",
            device,
            [
                "name",
                "hostname",
                "device_type",
                "status",
                "customer",
                "assigned_client_user",
                "assigned_date",
                "retired_date",
                "serial_number",
                "asset_tag",
                "manufacturer",
                "model",
                "operating_system",
                "remarks",
                "last_billed_on",
                "covered_until",
            ],
            as_dict=True,
        )

        if not doc:
            raise NotFoundError(f"Managed Device {device} not found.", "NOT_FOUND")

        doc["remark_log"] = remarks_util.log("MSP Managed Device", device)

        blockers = DeviceService.deletion_blockers(device)
        doc["delete_blockers"] = blockers
        doc["can_delete"] = not blockers

        doc["user_name"] = (
            frappe.db.get_value("MSP Client User", doc.assigned_client_user, "full_name")
            if doc.assigned_client_user
            else None
        )

        interfaces = frappe.get_all(
            "MSP Network Interface",
            filters={"parent": device},
            fields=["interface_type", "mac_address"],
            order_by="idx asc",
        )

        services = frappe.db.sql(
            """
            select
                sa.name, sa.service_item,
                coalesce(item.item_name, sa.service_item) as service_name,
                sa.assignment_scope, sa.operational_status, sa.billing_status,
                sa.effective_start_date, sa.effective_end_date,
                sa.internal_notes, sa.source_request,
                (
                    select max(br.billing_period_end)
                    from `tabMSP Billing Run Line` brl
                    join `tabMSP Billing Run` br on br.name = brl.parent
                    where brl.service_assignment = sa.name and br.docstatus = 1
                ) as last_billed_on
            from `tabMSP Service Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            where sa.managed_device = %(device)s
            order by field(sa.operational_status, 'Ended', 'Cancelled') asc,
                     sa.effective_start_date desc
            """,
            {"device": device},
            as_dict=True,
        )

        requests = frappe.db.sql(
            """
            select distinct sr.name, sr.status, sr.priority, sr.request_type, sr.creation
            from `tabMSP Service Request` sr
            join `tabMSP Service Request Line` srl on srl.parent = sr.name
            where srl.managed_device = %(device)s
              and sr.status != %(customer_status)s
            order by sr.creation desc
            limit 10
            """,
            {"device": device, "customer_status": CUSTOMER_STATUS},
            as_dict=True,
        )

        open_items = {
            row.service_item
            for row in services
            if row.operational_status in OPEN_ASSIGNMENT_STATUSES
        }

        catalogue = [
            {
                "name": item.name,
                "item_name": item.item_name,
                "scope": RequestService._service_scope(item.name),
                "already_open": item.name in open_items,
            }
            for item in frappe.get_all(
                "Item",
                filters={"disabled": 0, "is_stock_item": 0},
                fields=["name", "item_name"],
                order_by="item_name asc",
            )
        ]

        return {
            "device": doc,
            "holder_log": holders.history(device),
            "interfaces": interfaces,
            "services": services,
            "requests": requests,
            "catalogue": [item for item in catalogue if item["scope"] in ("Device", "Both")],
            "customer_requests": frappe.db.sql(
                """
                select sr.name, sr.request_type, sr.status, sr.priority, sr.source,
                       coalesce(requester.full_name, sr.requester) as requester,
                       sr.creation, sr.customer
                from `tabMSP Service Request` sr
                left join `tabUser` requester on requester.name = sr.requester
                where sr.customer = %(customer)s
                  and sr.status != %(customer_status)s
                order by field(sr.status, 'Completed', 'Rejected', 'Cancelled') asc,
                         sr.creation desc
                limit 30
                """,
                {"customer": doc.customer, "customer_status": CUSTOMER_STATUS},
                as_dict=True,
            ),
            "device_types": frappe.get_meta("MSP Managed Device")
            .get_field("device_type")
            .options.split("\n"),
            "interface_types": frappe.get_meta("MSP Network Interface")
            .get_field("interface_type")
            .options.split("\n"),
        }

    @staticmethod
    def deletion_blockers(device):
        """What stands in the way of erasing a machine, named so it can be acted on.

        A past holder counts as history worth keeping; the current one does not, or a
        machine could never be deleted the day after it was handed to someone.
        """
        checks = (
            (
                "service assignment(s)",
                frappe.db.count("MSP Service Assignment", {"managed_device": device}),
            ),
            (
                "billed line(s)",
                frappe.db.count("MSP Billing Run Line", {"managed_device": device}),
            ),
            (
                "request line(s)",
                frappe.db.count("MSP Service Request Line", {"managed_device": device}),
            ),
            (
                "past holder(s)",
                frappe.db.count(
                    "MSP Device Holder",
                    {"parent": device, "parenttype": "MSP Managed Device", "is_current": 0},
                ),
            ),
        )

        return [f"{count} {label}" for label, count in checks if count]

    @staticmethod
    def delete_device(device=None):
        """Erase a machine that never carried anything — a test record, a typo."""
        ContractService._guard_admin()

        if not device or not frappe.db.exists("MSP Managed Device", device):
            raise NotFoundError(f"Managed Device {device} not found.", "NOT_FOUND")

        blockers = DeviceService.deletion_blockers(device)

        if blockers:
            raise ValidationError(
                frappe.db.get_value("MSP Managed Device", device, "hostname")
                + " cannot be deleted: "
                + ", ".join(blockers)
                + ".",
                "VALIDATION_ERROR",
            )

        frappe.delete_doc("MSP Managed Device", device, ignore_permissions=True)
        frappe.db.commit()

        return {"deleted": device}

    @staticmethod
    def assign_device_service(
        device=None, service_item=None, effective_date=None, notes=None, source_request=None
    ):
        """Open a device-scoped service straight on the machine."""
        RequestService._guard_internal()

        if not device or not service_item:
            raise ValidationError("device and service_item are required.", "VALIDATION_ERROR")

        doc = frappe.db.get_value(
            "MSP Managed Device", device, ["name", "customer", "status"], as_dict=True
        )

        if not doc:
            raise NotFoundError(f"Managed Device {device} not found.", "NOT_FOUND")

        if doc.status != "Active":
            raise ValidationError(
                f"{device} is {doc.status.lower()} — only an active device can take a service.",
                "VALIDATION_ERROR",
            )

        scope = RequestService._service_scope(service_item)

        if scope == "User":
            raise ValidationError(
                f"{service_item} is billed per user — assign it from the user's profile.",
                "VALIDATION_ERROR",
            )

        existing = frappe.db.exists(
            "MSP Service Assignment",
            {
                "managed_device": device,
                "service_item": service_item,
                "operational_status": ("in", OPEN_ASSIGNMENT_STATUSES),
            },
        )

        if existing:
            raise ValidationError(
                f"This device already holds an open {service_item} assignment ({existing}).",
                "VALIDATION_ERROR",
            )

        source_request = UserService._checked_request(source_request, doc.customer)

        assignment = frappe.get_doc(
            {
                "doctype": "MSP Service Assignment",
                "customer": doc.customer,
                "service_item": service_item,
                "assignment_scope": "Device",
                "managed_device": device,
                "quantity": 1,
                "uom": frappe.db.get_value("Item", service_item, "stock_uom") or "Unit",
                "operational_status": "Active",
                "billing_status": "Billable",
                "effective_start_date": effective_date or frappe.utils.today(),
                "price_source": "Contract",
                "source_request": source_request,
                "internal_notes": notes or None,
            }
        ).insert()

        reference = f" in reference to {source_request}" if source_request else ""
        assignment.add_comment("Comment", f"Opened by {frappe.session.user}{reference}.")
        remarks_util.on_assignment(assignment, "granted", notes)
        frappe.db.commit()

        return DeviceService.get_device_context(device)

    @staticmethod
    def update_device(
        device=None,
        hostname=None,
        device_type=None,
        serial_number=None,
        assigned_date=None,
        interfaces=None,
        remarks=None,
    ):
        """Edit the machine itself. Its holder and its services are handed over separately."""
        RequestService._guard_internal()

        if not device:
            raise ValidationError("device is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Managed Device", device):
            raise NotFoundError(f"Managed Device {device} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Managed Device", device)

        if hostname:
            doc.hostname = hostname
        if device_type:
            doc.device_type = device_type

        doc.serial_number = serial_number or None
        remarks_util.add(doc, remarks)

        if assigned_date:
            doc.assigned_date = assigned_date

        interfaces = frappe.parse_json(interfaces) if isinstance(interfaces, str) else interfaces

        if interfaces is not None:
            doc.network_interfaces = []
            for interface in interfaces:
                mac = (interface.get("mac_address") or "").strip().upper()
                if not mac:
                    continue
                doc.append(
                    "network_interfaces",
                    {
                        "interface_type": interface.get("interface_type") or "Other",
                        "mac_address": mac,
                    },
                )

        doc.save()
        doc.add_comment("Comment", f"Updated by {frappe.session.user}.")
        frappe.db.commit()

        return {"name": doc.name, "hostname": doc.hostname}

    @staticmethod
    def find_serial(serial_number=None, exclude=None):
        """The machine already carrying this serial number, if there is one."""
        RequestService._guard_internal()

        serial_number = (serial_number or "").strip()

        if not serial_number:
            return None

        found = frappe.db.get_value(
            "MSP Managed Device",
            {"serial_number": serial_number},
            ["name", "hostname", "customer", "status", "assigned_client_user"],
            as_dict=True,
        )

        if not found or found.name == exclude:
            return None

        if found.assigned_client_user:
            found["holder_name"] = frappe.db.get_value(
                "MSP Client User", found.assigned_client_user, "full_name"
            )

        return found

    @staticmethod
    def hand_over_device(device=None, client_user=None, on_date=None, note=None):
        """Hand a machine to someone else on a stated day.

        A hand-over is its own act, dated on its own day: reading it off the date the machine
        entered service is what wrote yesterday's changes into 2024.
        """
        RequestService._guard_internal()

        if not device:
            raise ValidationError("device is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Managed Device", device):
            raise NotFoundError(f"Managed Device {device} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Managed Device", device)
        on_date = on_date or frappe.utils.today()

        if frappe.utils.getdate(on_date) > frappe.utils.getdate(frappe.utils.today()):
            raise ValidationError(
                "A hand-over cannot be dated in the future.", "VALIDATION_ERROR"
            )

        if client_user:
            owner = frappe.db.get_value("MSP Client User", client_user, "customer")

            if not owner:
                raise NotFoundError(f"Client User {client_user} not found.", "NOT_FOUND")

            if owner != doc.customer:
                raise ValidationError(
                    f"{client_user} belongs to {owner}, not {doc.customer}.",
                    "VALIDATION_ERROR",
                )

        current = holders._open_row(doc)

        if current and current.client_user == (client_user or None):
            raise ValidationError(
                f"{current.full_name or current.client_user} already holds this device.",
                "VALIDATION_ERROR",
            )

        if current and frappe.utils.getdate(on_date) < frappe.utils.getdate(current.from_date):
            raise ValidationError(
                f"They took it on {frappe.utils.formatdate(current.from_date)}, so it cannot "
                "change hands before that day.",
                "VALIDATION_ERROR",
            )

        if not current and not client_user:
            raise ValidationError("Nobody holds this device.", "VALIDATION_ERROR")

        holders.hand_over(doc, client_user or None, on_date, note=note)

        # the hand-over is written in the history; the log says it in words
        taker = frappe.db.get_value("MSP Client User", client_user, "full_name") if client_user else None
        line = f"Handed over to {taker}" if taker else "Left in nobody's hands"
        remarks_util.add(
            doc,
            f"{line} on {frappe.utils.formatdate(on_date)}" + (f" — {note}" if note else ""),
        )

        doc.save()
        doc.add_comment("Comment", f"Handed over by {frappe.session.user} on {on_date}.")
        frappe.db.commit()

        return DeviceService.get_device_context(device)

    @staticmethod
    def change_device_status(
        device=None,
        action=None,
        status=None,
        effective_date=None,
        assigned_client_user=None,
        notes=None,
    ):
        """Retire a machine or bring it back. Retiring also closes what it was still billing."""
        RequestService._guard_internal()

        if not device or action not in ("Retire", "Reinstate"):
            raise ValidationError("device and a valid action are required.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Managed Device", device):
            raise NotFoundError(f"Managed Device {device} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Managed Device", device)
        effective_date = effective_date or frappe.utils.today()
        closed = []

        if action == "Retire":
            if doc.status != "Active":
                raise ValidationError(
                    f"{doc.hostname} is already {doc.status.lower()}.", "INVALID_TRANSITION"
                )

            target = status or "Retired"
            if target not in ("Returned", "Damaged", "Retired", "Lost"):
                raise ValidationError(f"'{target}' is not a retirement status.", "VALIDATION_ERROR")

            for name in frappe.get_all(
                "MSP Service Assignment",
                filters={
                    "managed_device": device,
                    "operational_status": ("in", OPEN_ASSIGNMENT_STATUSES),
                },
                pluck="name",
            ):
                assignment = frappe.get_doc("MSP Service Assignment", name)
                assignment.operational_status = "Ended"
                assignment.billing_status = "Ended"
                # a retirement backdated before the service started still ends it, on its own day
                assignment.effective_end_date = max(
                    frappe.utils.getdate(effective_date),
                    frappe.utils.getdate(assignment.effective_start_date),
                ) if assignment.effective_start_date else effective_date
                assignment.save()
                assignment.add_comment(
                    "Comment", f"Ended with device {doc.hostname} by {frappe.session.user}."
                )
                closed.append(name)

            doc.status = target
            doc.retired_date = effective_date
            # the machine leaves service, so nobody holds it any more
            holders.hand_over(doc, None, effective_date, note=f"{target.lower()}")
        else:
            if doc.status == "Active":
                raise ValidationError(f"{doc.hostname} is already active.", "INVALID_TRANSITION")

            doc.status = "Active"
            doc.retired_date = None
            doc.assigned_date = effective_date

            if assigned_client_user:
                owner = frappe.db.get_value("MSP Client User", assigned_client_user, "customer")
                if owner != doc.customer:
                    raise ValidationError(
                        f"{assigned_client_user} belongs to {owner}, not {doc.customer}.",
                        "VALIDATION_ERROR",
                    )
                holders.hand_over(doc, assigned_client_user, effective_date, note="reinstated")

        # why a machine was retired or reinstated belongs in its history, not on top of it
        remarks_util.add(doc, notes)

        doc.save()
        doc.add_comment("Comment", f"{action} applied by {frappe.session.user}.")
        frappe.db.commit()

        return {
            "name": doc.name,
            "hostname": doc.hostname,
            "status": doc.status,
            "closed_assignments": closed,
        }

    @staticmethod
    def create_device(
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
        """Register a machine for a customer, with or without a holder."""
        RequestService._guard_internal()

        if not hostname:
            raise ValidationError("hostname is required.", "VALIDATION_ERROR")

        # the serial number is what tells two machines apart, so a new one arrives with it
        serial_number = (serial_number or "").strip()

        if not serial_number:
            raise ValidationError(
                "A serial number is required: it is what identifies the machine.",
                "VALIDATION_ERROR",
            )

        twin = frappe.db.get_value(
            "MSP Managed Device",
            {"serial_number": serial_number},
            ["name", "hostname", "customer"],
            as_dict=True,
        )

        if twin:
            raise ValidationError(
                f"Serial number {serial_number} is already on {twin.hostname} "
                f"({twin.customer}).",
                "VALIDATION_ERROR",
            )

        if assigned_client_user and not customer:
            customer = frappe.db.get_value("MSP Client User", assigned_client_user, "customer")

        if not customer:
            raise ValidationError("customer is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        if assigned_client_user:
            owner = frappe.db.get_value("MSP Client User", assigned_client_user, "customer")
            if owner != customer:
                raise ValidationError(
                    f"{assigned_client_user} belongs to {owner}, not {customer}.",
                    "VALIDATION_ERROR",
                )

        interfaces = frappe.parse_json(interfaces) if isinstance(interfaces, str) else interfaces
        rows = []

        for interface in interfaces or []:
            mac = (interface.get("mac_address") or "").strip().upper()
            if not mac:
                continue
            rows.append(
                {
                    "interface_type": interface.get("interface_type") or "Other",
                    "mac_address": mac,
                }
            )

        doc = frappe.get_doc(
            {
                "doctype": "MSP Managed Device",
                "customer": customer,
                "holder_log": (
                    [{
                        "client_user": assigned_client_user,
                        "full_name": frappe.db.get_value(
                            "MSP Client User", assigned_client_user, "full_name"
                        ),
                        "from_date": assigned_date or frappe.utils.today(),
                    }]
                    if assigned_client_user
                    else []
                ),
                "hostname": hostname,
                "device_type": device_type or "Other",
                "status": "Active",
                "assigned_date": assigned_date or frappe.utils.today(),
                "serial_number": serial_number or None,
                "network_interfaces": rows,
                "remark_log": (
                    [{"note": remarks.strip(), "noted_on": frappe.utils.now(),
                      "noted_by": frappe.session.user}]
                    if (remarks or "").strip()
                    else []
                ),
            }
        ).insert()

        source_request = UserService._checked_request(source_request, customer)
        reference = f" in reference to {source_request}" if source_request else ""
        doc.add_comment("Comment", f"Registered by {frappe.session.user}{reference}.")
        frappe.db.commit()

        return {"name": doc.name, "hostname": doc.hostname, "customer": doc.customer}

    @staticmethod
    def list_customer_devices(customer=None, exclude_holder=None):
        """Every machine this customer owns, with who holds it and since when.

        Handing a machine over is a decision about a machine somebody already has, so the
        picker has to say whose it is before the choice, not after.
        """
        RequestService._guard_internal()

        if not customer:
            raise ValidationError("customer is required.", "VALIDATION_ERROR")

        rows = frappe.db.sql(
            """
            select
                d.name, d.hostname, d.device_type, d.status, d.serial_number,
                d.assigned_client_user, d.assigned_date,
                cu.full_name as holder_name,
                cu.lifecycle_status as holder_status,
                cu.department as holder_department,
                (select h.from_date
                   from `tabMSP Device Holder` h
                  where h.parent = d.name and h.is_current = 1
                  limit 1) as held_since,
                (select count(*)
                   from `tabMSP Service Assignment` sa
                  where sa.managed_device = d.name
                    and sa.operational_status in %(open)s) as open_services
            from `tabMSP Managed Device` d
            left join `tabMSP Client User` cu on cu.name = d.assigned_client_user
            where d.customer = %(customer)s
            order by d.hostname asc
            """,
            {"customer": customer, "open": OPEN_ASSIGNMENT_STATUSES},
            as_dict=True,
        )

        if exclude_holder:
            rows = [row for row in rows if row.assigned_client_user != exclude_holder]

        for row in rows:
            row["interfaces"] = frappe.get_all(
                "MSP Network Interface",
                filters={"parent": row.name, "parenttype": "MSP Managed Device"},
                fields=["interface_type", "mac_address"],
                order_by="idx asc",
            )

        return rows

    @staticmethod
    def find_hostname(customer=None, hostname=None):
        """The machine already carrying this hostname, whoever owns it.

        Asked while the name is being typed, so the answer is a machine to open rather than
        a refusal at save time. The search spans every customer because the name does.
        """
        RequestService._guard_internal()

        hostname = (hostname or "").strip().upper()

        if not hostname:
            return None

        found = frappe.db.get_value(
            "MSP Managed Device",
            {"hostname": hostname},
            [
                "name",
                "hostname",
                "customer",
                "status",
                "device_type",
                "assigned_client_user",
                "assigned_date",
            ],
            as_dict=True,
        )

        if not found:
            return None

        if found.assigned_client_user:
            holder = frappe.db.get_value(
                "MSP Client User",
                found.assigned_client_user,
                ["full_name", "lifecycle_status", "department"],
                as_dict=True,
            )
            found["holder_name"] = holder.full_name if holder else None
            found["holder_status"] = holder.lifecycle_status if holder else None
            found["holder_department"] = holder.department if holder else None

        found["held_since"] = frappe.db.get_value(
            "MSP Device Holder", {"parent": found.name, "is_current": 1}, "from_date"
        )
        found["same_customer"] = bool(customer) and found.customer == customer

        return found

    @staticmethod
    def list_customer_users(customer=None):
        """Who a device can be handed to, inside its own customer."""
        RequestService._guard_internal()

        if not customer:
            raise ValidationError("customer is required.", "VALIDATION_ERROR")

        return frappe.get_all(
            "MSP Client User",
            filters={"customer": customer, "lifecycle_status": ("in", ("Pending", "Active"))},
            fields=["name", "full_name", "username", "department"],
            order_by="full_name asc",
            limit_page_length=0,
        )
