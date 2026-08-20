import frappe

from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.utils.errors import NotFoundError, ValidationError

SECURITY_ITEM = "SVC-SOPHOS"

OPEN_ASSIGNMENT_STATUSES = ("Pending Setup", "Active", "Suspended", "Pending Removal")

LIFECYCLE_STATUSES = ("Pending", "Active", "Disabled", "Archived")

MAX_PAGE_LENGTH = 200

COVERAGE_FILTERS = ("no_device", "no_security", "disabled_with_services")


class UserService:
    @staticmethod
    def get_filter_options():
        """Options for the user register filter bar."""
        RequestService._guard_internal()

        departments = frappe.db.sql_list(
            """
            select distinct department from `tabClient User`
            where department is not null and department != ''
            order by department asc
            """
        )

        services = frappe.db.sql(
            """
            select distinct sa.service_item as value,
                   coalesce(item.item_name, sa.service_item) as label
            from `tabService Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            order by label asc
            """,
            as_dict=True,
        )

        return {
            "customers": frappe.get_all("Customer", pluck="name", order_by="name asc"),
            "departments": departments,
            "services": services,
            "statuses": list(LIFECYCLE_STATUSES),
            "coverage": list(COVERAGE_FILTERS),
        }

    @staticmethod
    def get_stats():
        """Counters a technician acts on, not vanity metrics."""
        RequestService._guard_internal()

        active = frappe.db.count("Client User", {"lifecycle_status": "Active"})

        without_device = frappe.db.sql(
            """
            select count(*) from `tabClient User` cu
            where cu.lifecycle_status = 'Active'
              and not exists (
                  select 1 from `tabManaged Device` device
                  where device.assigned_client_user = cu.name and device.status = 'Active'
              )
            """
        )[0][0]

        disabled_with_services = frappe.db.sql(
            """
            select count(distinct cu.name) from `tabClient User` cu
            where cu.lifecycle_status in ('Disabled', 'Archived')
              and exists (
                  select 1 from `tabService Assignment` sa
                  left join `tabManaged Device` device on device.name = sa.managed_device
                  where sa.operational_status in %(open)s
                    and (sa.client_user = cu.name or device.assigned_client_user = cu.name)
              )
            """,
            {"open": OPEN_ASSIGNMENT_STATUSES},
        )[0][0]

        unprotected_devices = frappe.db.sql(
            """
            select count(*) from `tabManaged Device` device
            where device.status = 'Active'
              and not exists (
                  select 1 from `tabService Assignment` sa
                  where sa.managed_device = device.name
                    and sa.service_item = %(item)s
                    and sa.operational_status in %(open)s
              )
            """,
            {"item": SECURITY_ITEM, "open": OPEN_ASSIGNMENT_STATUSES},
        )[0][0]

        return {
            "active_users": active,
            "without_device": without_device,
            "disabled_with_services": disabled_with_services,
            "unprotected_devices": unprotected_devices,
        }

    @staticmethod
    def _conditions(search, customer, status, department, service, coverage):
        conditions = []
        params = {"open": OPEN_ASSIGNMENT_STATUSES, "item": SECURITY_ITEM}

        if customer:
            conditions.append("cu.customer = %(customer)s")
            params["customer"] = customer

        if status:
            conditions.append("cu.lifecycle_status = %(status)s")
            params["status"] = status

        if department:
            conditions.append("cu.department = %(department)s")
            params["department"] = department

        if service:
            conditions.append(
                """exists (
                    select 1 from `tabService Assignment` sa
                    left join `tabManaged Device` sad on sad.name = sa.managed_device
                    where sa.service_item = %(service)s
                      and sa.operational_status in %(open)s
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name)
                )"""
            )
            params["service"] = service

        if coverage == "no_device":
            conditions.append("cu.lifecycle_status = 'Active'")
            conditions.append(
                """not exists (
                    select 1 from `tabManaged Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active'
                )"""
            )
        elif coverage == "no_security":
            conditions.append("cu.lifecycle_status = 'Active'")
            conditions.append(
                """exists (
                    select 1 from `tabManaged Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active'
                      and not exists (
                          select 1 from `tabService Assignment` sa
                          where sa.managed_device = device.name
                            and sa.service_item = %(item)s
                            and sa.operational_status in %(open)s
                      )
                )"""
            )
        elif coverage == "disabled_with_services":
            conditions.append("cu.lifecycle_status in ('Disabled', 'Archived')")
            conditions.append(
                """exists (
                    select 1 from `tabService Assignment` sa
                    left join `tabManaged Device` sad on sad.name = sa.managed_device
                    where sa.operational_status in %(open)s
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name)
                )"""
            )

        if search:
            conditions.append(
                """(
                    cu.full_name like %(search)s
                    or cu.department like %(search)s
                    or exists (
                        select 1 from `tabManaged Device` device
                        where device.assigned_client_user = cu.name
                          and device.hostname like %(search)s
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
        start=0,
        page_length=20,
    ):
        """The user register: one row per person, with their device and service footprint."""
        RequestService._guard_internal()

        start = max(frappe.utils.cint(start), 0)
        page_length = min(max(frappe.utils.cint(page_length) or 20, 1), MAX_PAGE_LENGTH)

        where, params = UserService._conditions(
            search, customer, status, department, service, coverage
        )

        total = frappe.db.sql(f"select count(*) from `tabClient User` cu {where}", params)[0][0]

        rows = frappe.db.sql(
            f"""
            select
                cu.name, cu.full_name, cu.department, cu.customer, cu.lifecycle_status,
                cu.start_date, cu.disabled_date,
                (select group_concat(device.hostname separator ', ')
                    from `tabManaged Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active')
                    as hostnames,
                (select device.device_type from `tabManaged Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active'
                    limit 1) as device_type,
                (select count(*) from `tabService Assignment` sa
                    left join `tabManaged Device` sad on sad.name = sa.managed_device
                    where sa.operational_status = 'Active'
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name))
                    as active_services,
                (select count(*) from `tabService Assignment` sa
                    left join `tabManaged Device` sad on sad.name = sa.managed_device
                    where sa.operational_status != 'Active'
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name))
                    as inactive_services
            from `tabClient User` cu
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

        if not frappe.db.exists("Client User", name):
            raise NotFoundError(f"Client User {name} not found.", "NOT_FOUND")

        user = frappe.db.get_value(
            "Client User",
            name,
            [
                "name",
                "full_name",
                "department",
                "customer",
                "email",
                "lifecycle_status",
                "start_date",
                "disabled_date",
                "portal_user",
                "remarks",
            ],
            as_dict=True,
        )

        devices = frappe.db.sql(
            """
            select name, hostname, device_type, status, assigned_date, retired_date
            from `tabManaged Device`
            where assigned_client_user = %(user)s
            order by field(status, 'Active') desc, hostname asc
            """,
            {"user": name},
            as_dict=True,
        )

        if devices:
            interfaces = frappe.get_all(
                "Network Interface",
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
                    from `tabBilling Run Line` brl
                    join `tabBilling Run` br on br.name = brl.parent
                    where brl.service_assignment = sa.name and br.docstatus = 1
                ) as last_billed_on
            from `tabService Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            left join `tabManaged Device` device on device.name = sa.managed_device
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
            from `tabService Request` sr
            join `tabService Request Line` srl on srl.parent = sr.name
            where srl.client_user = %(user)s
            order by sr.creation desc
            limit 10
            """,
            {"user": name},
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
                from `tabService Request` sr
                left join `tabUser` requester on requester.name = sr.requester
                where sr.customer = %(customer)s
                order by field(sr.status, 'Completed', 'Rejected', 'Cancelled') asc,
                         sr.creation desc
                limit 30
                """,
                {"customer": user.customer},
                as_dict=True,
            ),
            "device_types": frappe.get_meta("Managed Device")
            .get_field("device_type")
            .options.split("\n"),
            "interface_types": frappe.get_meta("Network Interface")
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

        if not frappe.db.exists("Client User", client_user):
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
    def _checked_request(source_request, customer):
        """A reference is only meaningful if it belongs to the same customer."""
        if not source_request:
            return None

        owner = frappe.db.get_value("Service Request", source_request, "customer")

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
        notes=None,
        source_request=None,
        target_scope=None,
    ):
        """Open a service for a user directly. The rate stays the contract's business, not ours."""
        RequestService._guard_internal()

        if not client_user or not service_item:
            raise ValidationError("client_user and service_item are required.", "VALIDATION_ERROR")

        user = frappe.db.get_value("Client User", client_user, ["name", "customer"], as_dict=True)

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
            user.customer, user.name, device_mode, managed_device, hostname, device_type, interfaces
        )

        if scope == "Device":
            if not device:
                raise ValidationError(
                    f"{service_item} is a device service — select or create a device.",
                    "VALIDATION_ERROR",
                )

            on_device = frappe.db.exists(
                "Service Assignment",
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
                "doctype": "Service Assignment",
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

        reference = f" in reference to {source_request}" if source_request else ""
        assignment.add_comment("Comment", f"Opened by {frappe.session.user}{reference}.")
        frappe.db.commit()

        return UserService.get_user(client_user)

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

        if not frappe.db.exists("Service Assignment", assignment):
            raise NotFoundError(f"Service Assignment {assignment} not found.", "NOT_FOUND")

        doc = frappe.get_doc("Service Assignment", assignment)

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
            doc.effective_end_date = effective_date or frappe.utils.today()

        if notes:
            doc.internal_notes = notes

        source_request = UserService._checked_request(source_request, doc.customer)
        reference = f" in reference to {source_request}" if source_request else ""

        doc.save()
        doc.add_comment("Comment", f"{action} applied by {frappe.session.user}{reference}.")
        frappe.db.commit()

        client_user = doc.client_user or frappe.db.get_value(
            "Managed Device", doc.managed_device, "assigned_client_user"
        )

        return UserService.get_user(client_user)

    @staticmethod
    def create_client_user(
        customer=None,
        full_name=None,
        department=None,
        email=None,
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
            customer = frappe.db.get_value("Service Request", source_request, "customer")

        if not customer:
            raise ValidationError("customer is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        source_request = UserService._checked_request(source_request, customer)

        doc = frappe.get_doc(
            {
                "doctype": "Client User",
                "full_name": full_name,
                "customer": customer,
                "department": department or None,
                "email": email or None,
                "lifecycle_status": "Active",
                "start_date": start_date or frappe.utils.today(),
                "portal_visible": 1,
                "remarks": remarks or None,
            }
        ).insert()

        if source_request and request_line:
            request = frappe.get_doc("Service Request", source_request)
            row = next(
                (line for line in request.lines if line.idx == frappe.utils.cint(request_line)),
                None,
            )
            if row:
                row.db_set("client_user", doc.name)

        reference = f" for {source_request}" if source_request else ""
        doc.add_comment("Comment", f"Created by {frappe.session.user}{reference}.")
        frappe.db.commit()

        return {"name": doc.name, "full_name": doc.full_name, "customer": doc.customer}
