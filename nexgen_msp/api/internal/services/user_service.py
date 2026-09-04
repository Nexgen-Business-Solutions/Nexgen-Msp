import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils import identifiers
from nexgen_msp.utils import remarks as remarks_util

from nexgen_msp.utils.meta import select_options


from nexgen_msp.api.internal.services.request_service import (
    ADMIN_ROLES,
    CUSTOMER_STATUS,
    RequestService,
)
from nexgen_msp.utils.errors import NotFoundError, ValidationError
from nexgen_msp.utils.assignments import OPEN_ASSIGNMENT_STATUSES


LIFECYCLE_STATUSES = ("Pending", "Active", "Disabled", "Archived")

MAX_PAGE_LENGTH = 200

COVERAGE_FILTERS = ("no_device", "no_service", "disabled_with_services")


class UserService:
    @staticmethod
    def get_filter_options():
        """Options for the user register filter bar."""
        RequestService._guard_internal()

        departments = frappe.db.sql_list(
            """
            select distinct department from `tabMSP Client User`
            where department is not null and department != ''
            order by department asc
            """
        )

        services = frappe.db.sql(
            """
            select distinct sa.service_item as value,
                   coalesce(item.item_name, sa.service_item) as label
            from `tabMSP Service Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            order by label asc
            """,
            as_dict=True,
        )

        return {
            "customers": frappe.get_all("Customer", pluck="name", order_by="name asc"),
            "departments": departments,
            "services": services,
            "statuses": select_options("MSP Client User", "lifecycle_status"),
            "coverage": list(COVERAGE_FILTERS),
        }

    @staticmethod
    def get_stats(
        search=None,
        customer=None,
        status=None,
        department=None,
        service=None,
        coverage=None,
        portal=None,
    ):
        """Counters a technician acts on, over the same scope the list is showing.

        They share the list's own WHERE clause: a figure that ignored the filters would
        contradict the rows underneath it, and the cards double as shortcuts into that very
        list.
        """
        RequestService._guard_internal()

        where, params = UserService._conditions(
            search, customer, status, department, service, coverage, portal
        )
        params = {**params}

        def count(predicate):
            clause = f"{where} and {predicate}" if where else f" where {predicate}"
            return frappe.db.sql(
                f"select count(distinct cu.name) from `tabMSP Client User` cu {clause}", params
            )[0][0]

        active = count("cu.lifecycle_status = 'Active'")

        without_device = count(
            """cu.lifecycle_status = 'Active'
               and not exists (
                   select 1 from `tabMSP Managed Device` device
                   where device.assigned_client_user = cu.name and device.status = 'Active'
               )"""
        )

        disabled_with_services = count(
            """cu.lifecycle_status in ('Disabled', 'Archived')
               and exists (
                   select 1 from `tabMSP Service Assignment` sa
                   left join `tabMSP Managed Device` device on device.name = sa.managed_device
                   where sa.operational_status in %(open)s
                     and (sa.client_user = cu.name or device.assigned_client_user = cu.name)
               )"""
        )

        # this one counts machines, so it is scoped through the people the filter kept
        devices_without_services = frappe.db.sql(
            f"""
            select count(*)
            from `tabMSP Managed Device` device
            join `tabMSP Client User` cu on cu.name = device.assigned_client_user
            {where.replace(' where ', ' where ') if where else ''}
            {'and' if where else 'where'} device.status = 'Active'
              and not exists (
                  select 1 from `tabMSP Service Assignment` sa
                  where sa.managed_device = device.name
                    and sa.operational_status in %(open)s
              )
            """,
            params,
        )[0][0]

        return {
            "active_users": active,
            "without_device": without_device,
            "disabled_with_services": disabled_with_services,
            "devices_without_services": devices_without_services,
        }

    @staticmethod
    def _conditions(search, customer, status, department, service, coverage, portal):
        conditions = []
        params = {"open": OPEN_ASSIGNMENT_STATUSES}

        if customer:
            conditions.append("cu.customer = %(customer)s")
            params["customer"] = customer

        if status:
            conditions.append("cu.lifecycle_status = %(status)s")
            params["status"] = status

        if department:
            # a sub-account carries its entity as a prefix, so "Avittal" has to reach
            # "Avittal — Accounting" as well
            conditions.append("cu.department like %(department)s")
            params["department"] = f"%{department}%"

        if service:
            conditions.append(
                """exists (
                    select 1 from `tabMSP Service Assignment` sa
                    left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                    where sa.service_item = %(service)s
                      and sa.operational_status in %(open)s
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name)
                )"""
            )
            params["service"] = service

        if portal == "yes":
            conditions.append("ifnull(cu.portal_user, '') != ''")
        elif portal == "no":
            conditions.append("ifnull(cu.portal_user, '') = ''")

        if coverage == "no_device":
            conditions.append("cu.lifecycle_status = 'Active'")
            conditions.append(
                """not exists (
                    select 1 from `tabMSP Managed Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active'
                )"""
            )
        elif coverage == "no_service":
            conditions.append("cu.lifecycle_status = 'Active'")
            conditions.append(
                """exists (
                    select 1 from `tabMSP Managed Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active'
                      and not exists (
                          select 1 from `tabMSP Service Assignment` sa
                          where sa.managed_device = device.name
                            and sa.operational_status in %(open)s
                      )
                )"""
            )
        elif coverage == "disabled_with_services":
            conditions.append("cu.lifecycle_status in ('Disabled', 'Archived')")
            conditions.append(
                """exists (
                    select 1 from `tabMSP Service Assignment` sa
                    left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                    where sa.operational_status in %(open)s
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name)
                )"""
            )

        if search:
            conditions.append(
                """(
                    cu.full_name like %(search)s
                    or cu.username like %(search)s
                    or cu.email like %(search)s
                    or cu.department like %(search)s
                    or exists (
                        select 1 from `tabMSP Managed Device` device
                        where device.assigned_client_user = cu.name
                          and (
                            device.hostname like %(search)s
                            or device.serial_number like %(search)s
                          )
                    )
                )"""
            )
            params["search"] = f"%{search}%"

        return (" where " + " and ".join(conditions)) if conditions else "", params

    @staticmethod
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
        """The user register: one row per person, with their device and service footprint."""
        RequestService._guard_internal()

        start = max(frappe.utils.cint(start), 0)
        page_length = min(max(frappe.utils.cint(page_length) or 20, 1), MAX_PAGE_LENGTH)

        where, params = UserService._conditions(
            search, customer, status, department, service, coverage, portal
        )

        total = frappe.db.sql(f"select count(*) from `tabMSP Client User` cu {where}", params)[0][0]

        rows = frappe.db.sql(
            f"""
            select
                cu.name, cu.full_name, cu.username, cu.department, cu.customer, cu.lifecycle_status,
                cu.start_date, cu.disabled_date, cu.email,
                cu.last_billed_on, cu.covered_until,
                (select r.note from `tabMSP Remark` r
                    where r.parent = cu.name and r.parenttype = 'MSP Client User'
                    order by r.idx desc limit 1) as remarks,
                (select group_concat(device.hostname separator ', ')
                    from `tabMSP Managed Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active')
                    as hostnames,
                -- what is engraved on those machines: the export is read next to the
                -- vendor's own list, where the serial is what the two are matched on
                (select group_concat(device.serial_number separator ', ')
                    from `tabMSP Managed Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active'
                      and ifnull(device.serial_number, '') != '')
                    as serial_numbers,
                (select device.device_type from `tabMSP Managed Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active'
                    limit 1) as device_type,
                (select count(*) from `tabMSP Service Assignment` sa
                    left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                    where sa.operational_status = 'Active'
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name))
                    as active_services,
                (select count(*) from `tabMSP Service Assignment` sa
                    left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                    where sa.operational_status != 'Active'
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name))
                    as inactive_services,
                (select group_concat(distinct coalesce(item.item_name, sa.service_item)
                        order by item.item_name separator ', ')
                    from `tabMSP Service Assignment` sa
                    left join `tabItem` item on item.name = sa.service_item
                    left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                    where sa.operational_status in %(open)s
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name))
                    as services,
                (select group_concat(distinct coalesce(item.item_name, sa.service_item)
                        order by item.item_name separator ', ')
                    from `tabMSP Service Assignment` sa
                    left join `tabItem` item on item.name = sa.service_item
                    left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                    where sa.operational_status not in %(open)s
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name))
                    as inactive_service_names
            from `tabMSP Client User` cu
            {where}
            order by cu.full_name asc
            limit {page_length} offset {start}
            """,
            params,
            as_dict=True,
        )

        return {
            "rows": rows,
            "start": start,
            "page_length": page_length,
            "total": total,
            "has_more": start + len(rows) < total,
        }

    @staticmethod
    def get_user(name=None):
        """Everything known about one person: devices, services and request history."""
        RequestService._guard_internal()

        if not name:
            raise ValidationError("name is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Client User", name):
            raise NotFoundError(f"Client User {name} not found.", "NOT_FOUND")

        user = frappe.db.get_value(
            "MSP Client User",
            name,
            [
                "name",
                "full_name",
                "department",
                "customer",
                "email",
                "username",
                "lifecycle_status",
                "start_date",
                "disabled_date",
                "portal_user",
                "remarks",
                "covered_until",
                "last_billed_on",
            ],
            as_dict=True,
        )

        user["remark_log"] = remarks_util.log("MSP Client User", name)

        # said before the button is pressed, so the refusal is never a surprise
        blockers = UserService.deletion_blockers(name)
        user["delete_blockers"] = blockers
        user["can_delete"] = not blockers

        # the stored date is what the engine restates on every posted invoice and what the
        # sheet seeds; the query below only covers records neither has touched yet
        if not user.get("last_billed_on"):
            user["last_billed_on"] = frappe.db.sql(
                """
                select max(br.billing_period_end)
                from `tabMSP Billing Run Line` brl
                join `tabMSP Billing Run` br on br.name = brl.parent
                left join `tabMSP Managed Device` device on device.name = brl.managed_device
                where br.docstatus = 1
                  and (brl.client_user = %(user)s or device.assigned_client_user = %(user)s)
                """,
                {"user": name},
            )[0][0]

        devices = frappe.db.sql(
            """
            select name, hostname, device_type, status, serial_number, assigned_date,
                   retired_date
            from `tabMSP Managed Device`
            where assigned_client_user = %(user)s
            order by field(status, 'Active') desc, hostname asc
            """,
            {"user": name},
            as_dict=True,
        )

        if devices:
            interfaces = frappe.get_all(
                "MSP Network Interface",
                filters={"parent": ("in", [device.name for device in devices])},
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
            for device in devices:
                device["interfaces"] = grouped.get(device.name, [])

        services = frappe.db.sql(
            """
            select
                sa.name, sa.service_item,
                coalesce(item.item_name, sa.service_item) as service_name,
                sa.assignment_scope, sa.managed_device, device.hostname,
                sa.operational_status, sa.billing_status,
                sa.effective_start_date, sa.effective_end_date,
                sa.internal_notes,
                sa.source_request,
                (
                    select max(br.billing_period_end)
                    from `tabMSP Billing Run Line` brl
                    join `tabMSP Billing Run` br on br.name = brl.parent
                    where brl.service_assignment = sa.name and br.docstatus = 1
                ) as last_billed_on
            from `tabMSP Service Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            left join `tabMSP Managed Device` device on device.name = sa.managed_device
            where sa.client_user = %(user)s
               or device.assigned_client_user = %(user)s
            order by field(sa.operational_status, 'Ended', 'Cancelled') asc,
                     sa.effective_start_date desc
            """,
            {"user": name},
            as_dict=True,
        )

        requests = frappe.db.sql(
            """
            select distinct sr.name, sr.status, sr.priority, sr.request_type, sr.creation
            from `tabMSP Service Request` sr
            join `tabMSP Service Request Line` srl on srl.parent = sr.name
            where srl.client_user = %(user)s
              and sr.status != %(customer_status)s
            order by sr.creation desc
            limit 10
            """,
            {"user": name, "customer_status": CUSTOMER_STATUS},
            as_dict=True,
        )

        return {
            "user": user,
            "devices": devices,
            "services": services,
            "requests": requests,
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
                {"customer": user.customer, "customer_status": CUSTOMER_STATUS},
                as_dict=True,
            ),
            "device_types": frappe.get_meta("MSP Managed Device")
            .get_field("device_type")
            .options.split("\n"),
            "interface_types": frappe.get_meta("MSP Network Interface")
            .get_field("interface_type")
            .options.split("\n"),
            "catalogue": [
                {
                    "name": item.name,
                    "item_name": item.item_name,
                    "scope": RequestService._service_scope(item.name),
                }
                for item in frappe.get_all(
                    "Item",
                    filters={"disabled": 0, "is_stock_item": 0},
                    fields=["name", "item_name"],
                    order_by="item_name asc",
                )
            ],
        }

    @staticmethod
    def add_device(
        client_user=None,
        hostname=None,
        device_type=None,
        interfaces=None,
        assigned_date=None,
        serial_number=None,
        remarks=None,
        source_request=None,
    ):
        """Register hardware for a user. No billing impact until a service is attached to it."""
        from nexgen_msp.api.internal.services.device_service import DeviceService

        if not client_user:
            raise ValidationError("client_user is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Client User", client_user):
            raise NotFoundError(f"Client User {client_user} not found.", "NOT_FOUND")

        DeviceService.create_device(
            hostname=hostname,
            device_type=device_type,
            serial_number=serial_number,
            assigned_client_user=client_user,
            assigned_date=assigned_date,
            interfaces=interfaces,
            remarks=remarks,
            source_request=source_request,
        )

        return UserService.get_user(client_user)

    @staticmethod
    def _end_date_for(assignment, effective_date):
        """The day a service stops, refusing a date that rewrites an issued invoice.

        A service often stops before anyone gets round to recording it, so the date has to
        be allowed into the past. What it may not cross is a period already billed: the
        customer has the invoice, and moving the end date behind it would silently claim
        back days that were charged.

        Backdating is the administrator's call, since it is the invoice it touches.
        """
        end_on = frappe.utils.getdate(effective_date or frappe.utils.today())
        today = frappe.utils.getdate(frappe.utils.today())

        if assignment.effective_start_date and end_on < frappe.utils.getdate(
            assignment.effective_start_date
        ):
            raise ValidationError(
                f"The service started on {frappe.utils.formatdate(assignment.effective_start_date)}; "
                "it cannot end before it began.",
                "VALIDATION_ERROR",
            )

        if end_on > today:
            raise ValidationError("A service cannot be ended in the future.", "VALIDATION_ERROR")

        if end_on < today:
            if not RequestService._roles().intersection(ADMIN_ROLES):
                raise ValidationError(
                    "Only an administrator can end a service on a past date.",
                    "PERMISSION_DENIED",
                    403,
                )

            billed_to = UserService._billed_to(assignment.name)

            if billed_to and end_on < frappe.utils.getdate(billed_to):
                raise ValidationError(
                    f"This service is invoiced up to {frappe.utils.formatdate(billed_to)}. "
                    "It cannot be ended before that day — issue a credit note instead.",
                    "VALIDATION_ERROR",
                )

        return end_on

    @staticmethod
    def _billed_to(assignment):
        """The last day this assignment has been invoiced for, if it ever was."""
        return frappe.db.sql(
            """
            select max(br.billing_period_end)
            from `tabMSP Billing Run Line` brl
            join `tabMSP Billing Run` br on br.name = brl.parent
            where brl.service_assignment = %s
              and br.docstatus = 1
              and ifnull(br.credit_note_of, '') = ''
            """,
            assignment,
        )[0][0]

    @staticmethod
    def _checked_request(source_request, customer):
        """A reference is only meaningful if it belongs to the same customer."""
        if not source_request:
            return None

        owner = frappe.db.get_value("MSP Service Request", source_request, "customer")

        if not owner:
            raise NotFoundError(f"Service Request {source_request} not found.", "NOT_FOUND")

        if owner != customer:
            raise ValidationError(
                f"Service Request {source_request} belongs to {owner}, not {customer}.",
                "VALIDATION_ERROR",
            )

        return source_request

    @staticmethod
    def assign_service(
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
        """Open a service for a user directly. The rate stays the contract's business, not ours."""
        RequestService._guard_internal()

        if not client_user or not service_item:
            raise ValidationError("client_user and service_item are required.", "VALIDATION_ERROR")

        user = frappe.db.get_value("MSP Client User", client_user, ["name", "customer"], as_dict=True)

        if not user:
            raise NotFoundError(f"Client User {client_user} not found.", "NOT_FOUND")

        source_request = UserService._checked_request(source_request, user.customer)
        declared = RequestService._service_scope(service_item)

        if declared == "Both":
            scope = target_scope or "User"
            if scope not in ("User", "Device"):
                raise ValidationError(
                    f"'{scope}' is not a valid target for this service.", "VALIDATION_ERROR"
                )
        else:
            scope = declared

        # a per-device service is unique per machine, not per person: two laptops, two licences
        if scope != "Device":
            existing = RequestService._find_open_assignment(user.customer, user.name, service_item)

            if existing:
                raise ValidationError(
                    f"This user already holds an open {service_item} assignment ({existing}).",
                    "VALIDATION_ERROR",
                )

        interfaces = frappe.parse_json(interfaces) if isinstance(interfaces, str) else interfaces
        interfaces = [
            interface
            for interface in (interfaces or [])
            if (interface.get("mac_address") or "").strip()
        ]

        device = RequestService._resolve_device(
            user.customer,
            user.name,
            device_mode,
            managed_device,
            hostname,
            device_type,
            interfaces,
            serial_number,
        )

        if scope == "Device":
            if not device:
                raise ValidationError(
                    f"{service_item} is a device service — select or create a device.",
                    "VALIDATION_ERROR",
                )

            on_device = frappe.db.exists(
                "MSP Service Assignment",
                {
                    "managed_device": device,
                    "service_item": service_item,
                    "operational_status": (
                        "in",
                        ("Pending Setup", "Active", "Suspended", "Pending Removal"),
                    ),
                },
            )

            if on_device:
                raise ValidationError(
                    f"This device already holds an open {service_item} assignment ({on_device}).",
                    "VALIDATION_ERROR",
                )

        assignment = frappe.get_doc(
            {
                "doctype": "MSP Service Assignment",
                "customer": user.customer,
                "service_item": service_item,
                "assignment_scope": scope,
                "client_user": user.name if scope == "User" else None,
                "managed_device": device if scope == "Device" else None,
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

        # what the service will later be refused a closure for not having, taken while the
        # technician still has the machine and the licence in front of them
        UserService._record_identifiers(user.name, device, serial_number, username)

        reference = f" in reference to {source_request}" if source_request else ""
        assignment.add_comment("Comment", f"Opened by {frappe.session.user}{reference}.")
        remarks_util.on_assignment(assignment, "granted", notes)
        frappe.db.commit()

        return UserService.get_user(client_user)

    @staticmethod
    def _record_identifiers(client_user, device, serial_number, username):
        """Fill the serial and the account name the closure will ask for.

        Only where nothing is on file: a value already recorded was put there by someone
        who had the machine in their hands, and is not overwritten from a form.
        """
        identifiers.record_serial(device, serial_number)
        identifiers.record_username(client_user, username)

    @staticmethod
    def change_service(
        assignment=None, action=None, effective_date=None, notes=None, source_request=None
    ):
        """Suspend, resume or end a running service, leaving a trace of who did it."""
        RequestService._guard_internal()

        if not assignment or not action:
            raise ValidationError("assignment and action are required.", "VALIDATION_ERROR")

        if action not in ("Suspend", "Resume", "End"):
            raise ValidationError(f"Unknown action '{action}'.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Service Assignment", assignment):
            raise NotFoundError(f"Service Assignment {assignment} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Service Assignment", assignment)

        if doc.operational_status in ("Ended", "Cancelled"):
            raise ValidationError(
                f"This service is already {doc.operational_status.lower()}.", "INVALID_TRANSITION"
            )

        if action == "Suspend":
            if doc.operational_status == "Suspended":
                raise ValidationError("This service is already suspended.", "INVALID_TRANSITION")
            doc.operational_status = "Suspended"
            doc.billing_status = "On Hold"
        elif action == "Resume":
            if doc.operational_status != "Suspended":
                raise ValidationError("Only a suspended service can be resumed.", "INVALID_TRANSITION")
            doc.operational_status = "Active"
            doc.billing_status = "Billable"
        else:
            doc.operational_status = "Ended"
            doc.billing_status = "Ended"
            doc.effective_end_date = UserService._end_date_for(doc, effective_date)

        if notes:
            doc.internal_notes = notes

        source_request = UserService._checked_request(source_request, doc.customer)
        reference = f" in reference to {source_request}" if source_request else ""

        doc.save()
        doc.add_comment("Comment", f"{action} applied by {frappe.session.user}{reference}.")
        remarks_util.on_assignment(doc, action, notes)
        frappe.db.commit()

        client_user = doc.client_user or frappe.db.get_value(
            "MSP Managed Device", doc.managed_device, "assigned_client_user"
        )

        return UserService.get_user(client_user)

    @staticmethod
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
        """Create the person a request asked for, and tie the line back to them."""
        RequestService._guard_internal()

        if not full_name:
            raise ValidationError("full_name is required.", "VALIDATION_ERROR")

        if source_request and not customer:
            customer = frappe.db.get_value("MSP Service Request", source_request, "customer")

        if not customer:
            raise ValidationError("customer is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        source_request = UserService._checked_request(source_request, customer)

        doc = frappe.get_doc(
            {
                "doctype": "MSP Client User",
                "full_name": full_name,
                "customer": customer,
                "department": department or None,
                "email": email or None,
                # the account name a licence is issued against, when the service needs one
                "username": (username or "").strip() or None,
                "lifecycle_status": "Active",
                "start_date": start_date or frappe.utils.today(),
                "portal_visible": 1,
                "remarks": remarks or None,
            }
        ).insert()

        if source_request and request_line:
            request = frappe.get_doc("MSP Service Request", source_request)
            row = next(
                (line for line in request.lines if line.idx == frappe.utils.cint(request_line)),
                None,
            )
            if row:
                # the customer wrote this person once and asked for several things: every
                # line describing them is now about the record just created, or the next
                # line would offer to create them a second time
                same_person = (row.new_user_full_name or "").strip().lower()
                was_new = bool(row.is_new_user)

                for line in request.lines:
                    if line.client_user:
                        continue
                    if line.idx == row.idx or (
                        was_new
                        and line.is_new_user
                        and (line.new_user_full_name or "").strip().lower() == same_person
                    ):
                        # no longer "new": the request must still save once they exist,
                        # and a line on an existing machine names it, not them
                        line.db_set("is_new_user", 0)
                        if line.target_scope != "Device" or line.is_new_device:
                            line.db_set("client_user", doc.name)

        reference = f" for {source_request}" if source_request else ""
        doc.add_comment("Comment", f"Created by {frappe.session.user}{reference}.")
        frappe.db.commit()

        return {"name": doc.name, "full_name": doc.full_name, "customer": doc.customer}

    @staticmethod
    def update_client_user(
        name=None,
        full_name=None,
        department=None,
        email=None,
        username=None,
        start_date=None,
        remarks=None,
    ):
        """Correct what we hold about a person. Their customer and lifecycle never move here.

        Moving someone between customers would orphan their services, and the lifecycle is
        driven by the services themselves — both are deliberately out of reach.
        """
        RequestService._guard_internal()

        if not name or not frappe.db.exists("MSP Client User", name):
            raise NotFoundError(f"Client User {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Client User", name)

        if full_name is not None:
            if not str(full_name).strip():
                raise ValidationError("A person needs a name.", "VALIDATION_ERROR")
            doc.full_name = str(full_name).strip()

        for field, value in (
            ("department", department),
            ("email", email),
            ("username", username),
            ("start_date", start_date),
        ):
            if value is not None:
                doc.set(field, value or None)

        # a remark is added to the log, never written over: the point is to follow what was
        # noted and when, which a single overwritten field cannot do
        remarks_util.add(doc, remarks)

        doc.save()
        frappe.db.commit()

        return UserService.get_user(name)

    @staticmethod
    def deletion_blockers(name):
        """What stands in the way of erasing a person, named so it can be acted on.

        Anything that ties them to work done or money owed keeps them: a service they hold,
        a request they appear in, a billed line, a device in their hands, a portal account.
        Erasing those would leave documents pointing at nothing.
        """
        checks = (
            (
                "service assignment(s)",
                frappe.db.count("MSP Service Assignment", {"client_user": name}),
            ),
            (
                "device(s) in their hands",
                frappe.db.count("MSP Managed Device", {"assigned_client_user": name}),
            ),
            (
                "request line(s)",
                frappe.db.count("MSP Service Request Line", {"client_user": name}),
            ),
            (
                "billed line(s)",
                frappe.db.count("MSP Billing Run Line", {"client_user": name}),
            ),
            (
                "past device holding(s)",
                frappe.db.count("MSP Device Holder", {"client_user": name}),
            ),
        )

        blockers = [f"{count} {label}" for label, count in checks if count]

        if frappe.db.get_value("MSP Client User", name, "portal_user"):
            blockers.append("a portal account — revoke it first")

        return blockers

    @staticmethod
    def delete_client_user(name=None):
        """Erase a person who never carried anything — a test record, a typo."""
        ContractService._guard_admin()

        if not name or not frappe.db.exists("MSP Client User", name):
            raise NotFoundError(f"Client User {name} not found.", "NOT_FOUND")

        blockers = UserService.deletion_blockers(name)

        if blockers:
            raise ValidationError(
                frappe.db.get_value("MSP Client User", name, "full_name")
                + " cannot be deleted: "
                + ", ".join(blockers)
                + ".",
                "VALIDATION_ERROR",
            )

        frappe.delete_doc("MSP Client User", name, ignore_permissions=True)
        frappe.db.commit()

        return {"deleted": name}
