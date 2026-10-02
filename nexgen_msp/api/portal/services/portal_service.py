import frappe

from nexgen_msp.api.internal.services.service_definition_service import (
    ServiceDefinitionService,
)

from nexgen_msp.utils.meta import select_options


from nexgen_msp.api.internal.services.request_service import effective_line_status
from nexgen_msp.nexgen_msp.doctype.msp_request.msp_request import (
    MODIFIED_COMMENT,
    requested_date_refusal,
    requester_edit_refusal,
)
from nexgen_msp.utils import approval, operations, permissions, request_intents, request_targets
from nexgen_msp.utils.errors import NotFoundError, ValidationError

# "no row like this yet", told apart from a row whose action group is None
_UNSEEN = object()

CLIENT_USER_FIELDS = [
    "name",
    "full_name",
    "username",
    "department",
    "email",
    "lifecycle_status",
    "start_date",
    "disabled_date",
    "customer",
]

DEVICE_FIELDS = [
    "name",
    "hostname",
    "device_type",
    "status",
    "assigned_client_user",
    "assigned_date",
    "retired_date",
    "serial_number",
    "manufacturer",
    "model",
    "operating_system",
    "customer",
]

ASSIGNMENT_FIELDS = [
    "name",
    "service_item",
    "assignment_scope",
    "client_user",
    "managed_device",
    "customer_site",
    "quantity",
    "uom",
    "operational_status",
    "billing_status",
    "effective_start_date",
    "effective_end_date",
    "customer_visible_notes",
    "customer",
]

REQUEST_FIELDS = [
    "name",
    "request_type",
    "status",
    "priority",
    "source",
    "requester",
    "customer",
    "creation",
    "modified",
]

REQUEST_LINE_FIELDS = [
    "idx",
    "action",
    "target_scope",
    "client_user",
    "requested_client_user",
    "managed_device",
    "requested_device",
    "customer_site",
    "requested_service",
    "requested_quantity",
    "requested_effective_date",
    "comment",
    "line_status",
    "rejection_reason",
]

MAX_PAGE_LENGTH = 200


ASSIGNMENT_HOLDER_JOIN = """
    from `tabMSP Service Assignment` sa
    left join `tabItem` item on item.name = sa.service_item
    left join `tabMSP Client User` holder on holder.name = sa.client_user
    left join `tabMSP Managed Device` device on device.name = sa.managed_device
    left join `tabMSP Client User` device_holder on device_holder.name = device.assigned_client_user
"""

HOLDER_NAME = "coalesce(holder.full_name, device_holder.full_name)"

KPI_SOURCES = {
    "active_services": {
        "title": "Active services",
        "fields": [
            ("user_name", "User", HOLDER_NAME),
            ("service", "Service", "coalesce(item.item_name, sa.service_item)"),
            ("hostname", "Device", "device.hostname"),
            ("since", "Since", "sa.effective_start_date"),
            ("status", "Status", "sa.operational_status"),
        ],
        "body": ASSIGNMENT_HOLDER_JOIN
        + """
            where sa.customer = %(customer)s
              and sa.operational_status = 'Active'
        """,
        "order_by": "sa.effective_start_date desc, sa.name desc",
        "key": "sa.name",
    },
    "open_requests": {
        "title": "Open requests",
        "fields": [
            ("request", "Request", "sr.name"),
            ("request_type", "Type", "sr.request_type"),
            ("priority", "Priority", "sr.priority"),
            ("created", "Created", "sr.creation"),
            ("status", "Status", "sr.status"),
        ],
        "body": """
            from `tabMSP Request` sr
            where sr.customer = %(customer)s
              and sr.status not in ('Completed', 'Rejected', 'Cancelled')
              -- a colleague's unfinished request is not theirs to count nor to read
              and (sr.status != 'Draft' or sr.requester = %(me)s)
        """,
        "order_by": "sr.creation desc",
        "key": "sr.name",
    },
}


SELECTION_ORIGIN = {"All": "Company", "Department": "Department", "Person": "Individual"}

FORMER_INPUT_KEYS = ("is_new_user", "is_new_device")
FORMER_INPUT_PREFIXES = ("new_user_", "new_device_")

SUBJECT_KINDS = ("existing", "new", "device")

NOT_THE_REQUESTER = "Only the person who raised this request can modify it."
REQUEST_LOCKED = "This request can no longer be modified: work on it has started."

REQUESTED_PERSON_FIELDS = (
    "full_name",
    "department",
    "email",
    "username",
    "external_employee_id",
    "start_date",
)

REQUESTED_DEVICE_FIELDS = (
    "display_label",
    "device_type",
    "hostname",
    "serial_number",
    "asset_tag",
    "manufacturer",
    "model",
    "operating_system",
)


def _selection_origin(scope_type):
    return SELECTION_ORIGIN.get(scope_type or "All", "Individual")


def _parsed(value):
    if isinstance(value, str):
        value = frappe.parse_json(value)

    return value or []


class PortalService:
    @staticmethod
    def get_context():
        customers = permissions.get_allowed_customers()

        if not customers:
            raise ValidationError(
                "No customer is linked to your account. Contact Nexgen support.",
                "PERMISSION_DENIED",
                403,
            )

        user = frappe.db.get_value(
            "User", frappe.session.user, ["full_name", "user_image"], as_dict=True
        )

        return {
            "user": frappe.session.user,
            "full_name": user.full_name if user else frappe.session.user,
            "user_image": user.user_image if user else None,
            "customers": customers,
            "customer": customers[0],
            "roles": frappe.get_roles(),
        }

    @staticmethod
    def get_summary(customer=None):
        customer = PortalService._resolve_customer(customer)
        base = {"customer": customer}

        return {
            "customer": customer,
            "client_users": frappe.db.count("MSP Client User", base),
            "active_client_users": frappe.db.count(
                "MSP Client User", {**base, "lifecycle_status": "Active"}
            ),
            "devices": frappe.db.count("MSP Managed Device", base),
            "active_devices": frappe.db.count("MSP Managed Device", {**base, "status": "Active"}),
            # the cards that filter by one status count that very status, nothing broader
            "retired_devices": frappe.db.count("MSP Managed Device", {**base, "status": "Retired"}),
            "disabled_client_users": frappe.db.count(
                "MSP Client User", {**base, "lifecycle_status": "Disabled"}
            ),
            "service_assignments": frappe.db.count("MSP Service Assignment", base),
            "active_services": PortalService._count_kpi("active_services", customer),
            "open_requests": PortalService._count_kpi("open_requests", customer),
            # waiting for someone at the company to agree, before it ever reaches Nexgen
            "awaiting_approval": frappe.db.count(
                "MSP Request", {**base, "status": "Awaiting Customer Approval"}
            ),
            # what this customer may order, not the whole catalogue of the site
            "catalogue_size": PortalService.list_catalogue(customer=customer)["count"],
        }

    @staticmethod
    def _kpi_source(kpi):
        source = KPI_SOURCES.get(kpi)

        if not source:
            raise ValidationError(f"Unknown KPI '{kpi}'.", "VALIDATION_ERROR")

        return source

    @staticmethod
    def _count_kpi(kpi, customer):
        source = PortalService._kpi_source(kpi)
        rows = frappe.db.sql(
            f"select count(*) {source['body']}",
            {
                "customer": customer,
                "me": frappe.session.user,
            },
        )
        return rows[0][0] if rows else 0

    @staticmethod
    def list_kpi_rows(kpi=None, customer=None, start=0, page_length=20):
        """Rows behind a dashboard KPI, using the very predicate that produced its number."""
        source = PortalService._kpi_source(kpi)
        customer = PortalService._resolve_customer(customer)

        start = max(frappe.utils.cint(start), 0)
        page_length = min(max(frappe.utils.cint(page_length) or 20, 1), MAX_PAGE_LENGTH)

        selected = ", ".join(f"{expression} as `{key}`" for key, _label, expression in source["fields"])
        params = {
            "customer": customer,
            "me": frappe.session.user,
        }

        rows = frappe.db.sql(
            f"""
            select {source['key']} as `name`, {selected}
            {source['body']}
            order by {source['order_by']}
            limit {page_length} offset {start}
            """,
            params,
            as_dict=True,
        )

        total = PortalService._count_kpi(kpi, customer)

        return {
            "kpi": kpi,
            "title": source["title"],
            "columns": [{"key": key, "label": label} for key, label, _expression in source["fields"]],
            "rows": rows,
            "start": start,
            "page_length": page_length,
            "total": total,
            "has_more": start + len(rows) < total,
        }

    @staticmethod
    def _holders_of(service, customer, field):
        """Who or what currently holds one service at this customer.

        A person holds a service either in their own name or through the machine in their
        hands — the same way the catalogue counts them — so "see the people" shows both.
        """
        if field == "client_user":
            return frappe.db.sql_list(
                """
                select distinct coalesce(nullif(sa.client_user, ''), device.assigned_client_user)
                from `tabMSP Service Assignment` sa
                left join `tabMSP Managed Device` device on device.name = sa.managed_device
                where sa.customer = %(customer)s
                  and sa.service_item = %(service)s
                  and ifnull(coalesce(nullif(sa.client_user, ''), device.assigned_client_user), '') != ''
                """,
                {"customer": customer, "service": service},
            )

        return frappe.db.sql_list(
            f"""
            select distinct sa.{field}
            from `tabMSP Service Assignment` sa
            where sa.customer = %(customer)s
              and sa.service_item = %(service)s
              and ifnull(sa.{field}, '') != ''
            """,
            {"customer": customer, "service": service},
        )

    @staticmethod
    def portal_filter_options(customer=None):
        """The axes a customer may narrow their own people and machines on.

        Read from the doctypes rather than written out here: a status added to a Select was
        invisible to the portal while these lists were typed by hand, and half a device
        register could not be filtered to.
        """
        PortalService._resolve_customer(customer)

        return {
            "user_statuses": select_options("MSP Client User", "lifecycle_status"),
            "device_statuses": select_options("MSP Managed Device", "status"),
            "device_types": select_options("MSP Managed Device", "device_type"),
        }

    @staticmethod
    def list_client_users(customer=None, search=None, status=None, service=None, start=0, page_length=20):
        filters = PortalService._base_filters(customer)
        if status:
            filters["lifecycle_status"] = status

        if service:
            # arriving from the services listing: show only the people who hold that one
            held = PortalService._holders_of(service, filters["customer"], "client_user")
            filters["name"] = ["in", held or [""]]

        result = PortalService._paginated(
            "MSP Client User",
            CLIENT_USER_FIELDS,
            filters,
            search,
            ["full_name", "username", "email"],
            start,
            page_length,
        )

        PortalService._add_service_counts(result["rows"])
        PortalService._add_held_devices(result["rows"])
        # the customer sees everything we do about their own people, bar our notes
        from nexgen_msp.utils import export_columns

        export_columns.fill_people_extras(result["rows"])

        return result

    @staticmethod
    def _add_held_devices(rows):
        """The machines each person holds, so the register reads without opening anyone."""
        people = [row["name"] for row in rows]

        if not people:
            return

        held = frappe.db.sql(
            """
            select
                assigned_client_user as person,
                group_concat(hostname separator ', ') as hostnames,
                min(device_type) as device_type
            from `tabMSP Managed Device`
            where assigned_client_user in %(people)s and status = 'Active'
            group by assigned_client_user
            """,
            {"people": people},
            as_dict=True,
        )

        machines = {row.person: row for row in held}

        for row in rows:
            entry = machines.get(row["name"])
            row["hostnames"] = entry.hostnames if entry else None
            row["device_type"] = entry.device_type if entry else None

    @staticmethod
    def _add_service_counts(rows):
        """How much each person actually runs, counted once for the whole page.

        A customer reads their register to see who has what; a row without that number
        forces them to open every person one by one.
        """
        people = [row["name"] for row in rows]

        if not people:
            return

        # what is running is read under whoever holds the machine now; what ended is read
        # under whoever held it while it ran, which is rarely the same person
        counts = frappe.db.sql(
            """
            select
                coalesce(sa.client_user, device.assigned_client_user) as person,
                sum(sa.operational_status = 'Active') as active,
                sum(sa.operational_status = 'Suspended') as suspended,
                group_concat(distinct case when sa.operational_status = 'Active'
                    then coalesce(item.item_name, sa.service_item) end separator ', ') as services
            from `tabMSP Service Assignment` sa
            left join `tabMSP Managed Device` device on device.name = sa.managed_device
            left join `tabItem` item on item.name = sa.service_item
            where coalesce(sa.client_user, device.assigned_client_user) in %(people)s
            group by person
            """,
            {"people": people},
            as_dict=True,
        )
        over = frappe.db.sql(
            """
            select person, count(distinct assignment) as ended from (
                select sa.client_user as person, sa.name as assignment
                from `tabMSP Service Assignment` sa
                where sa.operational_status = 'Ended' and sa.assignment_scope = 'User'
                  and sa.client_user in %(people)s
                union all
                select h.client_user as person, sa.name as assignment
                from `tabMSP Service Assignment` sa
                join `tabMSP Device Holder` h
                  on h.parent = sa.managed_device and h.parenttype = 'MSP Managed Device'
                where sa.operational_status = 'Ended' and sa.assignment_scope = 'Device'
                  and h.client_user in %(people)s
                  and (sa.effective_end_date is null or h.from_date is null
                       or sa.effective_end_date >= h.from_date)
                  and (h.to_date is null or sa.effective_start_date is null
                       or sa.effective_start_date <= h.to_date)
            ) theirs group by person
            """,
            {"people": people},
            as_dict=True,
        )

        held = {row.person: row for row in counts}
        finished = {row.person: int(row.ended) for row in over}

        for row in rows:
            entry = held.get(row["name"])
            row["active_services"] = int(entry.active) if entry else 0
            row["suspended_services"] = int(entry.suspended) if entry else 0
            row["ended_services"] = finished.get(row["name"], 0)
            row["inactive_services"] = row["suspended_services"] + row["ended_services"]
            row["services"] = entry.services if entry else None

    @staticmethod
    def list_user_choices(customer=None):
        """Every person of one customer, for a picker.

        Not paginated on purpose: a page cap silently hid the people beyond the first two
        hundred, and a picker that cannot offer someone who exists is worse than a long
        list. It stays bounded because it only ever covers a single customer.
        """
        customer = PortalService._resolve_customer(customer)

        rows = frappe.get_all(
            "MSP Client User",
            filters={"customer": customer},
            fields=[
                "name",
                "full_name",
                "email",
                "username",
                "department",
                "lifecycle_status",
                "disabled_date",
            ],
            order_by="full_name asc",
            limit_page_length=0,
        )

        # the machines they hold, so the picker can say which one is being talked about
        # before anyone opens another screen to find out
        machines = {}

        for device in frappe.get_all(
            "MSP Managed Device",
            filters={"customer": customer, "status": "Active"},
            fields=["assigned_client_user", "hostname", "serial_number"],
            order_by="hostname asc",
        ):
            if device.assigned_client_user:
                machines.setdefault(device.assigned_client_user, []).append(device)

        for row in rows:
            held = machines.get(row.name, [])
            row["hostnames"] = ", ".join(d.hostname for d in held) or None
            row["serial_numbers"] = (
                ", ".join(d.serial_number for d in held if d.serial_number) or None
            )

        return rows

    @staticmethod
    def list_departments(customer=None):
        """The department catalogue as this company sees it, for a Select.

        Almost all of it is global. A department belonging to one company alone is offered
        to that company and to nobody else.
        """
        from nexgen_msp.api.internal.services.department_service import DepartmentService

        customer = PortalService._resolve_customer(customer)

        return [
            {"value": row.department_name, "label": row.department_name}
            for row in DepartmentService.list_departments(enabled_only=True, customer=customer)
        ]

    @staticmethod
    def list_device_choices(customer=None):
        """Every machine of one customer, for a picker — same reasoning as the people.

        Who holds each one comes with it: a request often concerns a machine somebody else
        has, and a picker that hid those left nothing to choose from.
        """
        customer = PortalService._resolve_customer(customer)

        return frappe.db.sql(
            """
            select
                d.name, d.hostname, d.device_type, d.status, d.serial_number,
                d.assigned_client_user,
                holder.full_name as assigned_user_name
            from `tabMSP Managed Device` d
            left join `tabMSP Client User` holder on holder.name = d.assigned_client_user
            where d.customer = %(customer)s
            order by d.hostname asc
            """,
            {"customer": customer},
            as_dict=True,
        )

    @staticmethod
    def list_selectable_client_users(customer=None, search=None, limit=None):
        """Every person of the caller's customer, the ones who cannot be chosen greyed with the reason."""
        from nexgen_msp.api.internal.services.requested_client_user_service import (
            RequestedClientUserService,
        )

        customer = PortalService._resolve_customer(customer)

        return RequestedClientUserService.selectable_client_user_page(customer, search, limit)

    @staticmethod
    def list_selectable_devices(customer=None, search=None, limit=None):
        """Every machine of the caller's customer with its status and holder, Retired ones greyed."""
        from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService

        customer = PortalService._resolve_customer(customer)

        return RequestedDeviceService.selectable_device_page(customer, search, limit)

    @staticmethod
    def list_devices(
        customer=None, search=None, status=None, service=None, coverage=None, start=0, page_length=20
    ):
        filters = PortalService._base_filters(customer)
        if status:
            filters["status"] = status

        if service:
            held = PortalService._holders_of(service, filters["customer"], "managed_device")
            filters["name"] = ["in", held or [""]]

        if coverage == "no_service":
            # the card's own predicate, so the list is exactly what the card counted
            idle = frappe.db.sql_list(
                """
                select device.name
                from `tabMSP Managed Device` device
                where device.customer = %(customer)s
                  and device.status = 'Active'
                  and not exists (
                      select 1 from `tabMSP Service Assignment` sa
                      where sa.managed_device = device.name
                        and sa.operational_status in ('Pending Setup', 'Active', 'Suspended')
                  )
                """,
                {"customer": filters["customer"]},
            )
            if "name" in filters:
                idle = [name for name in idle if name in set(filters["name"][1])]
            filters["name"] = ["in", idle or [""]]

        result = PortalService._paginated(
            "MSP Managed Device", DEVICE_FIELDS, filters, search, ["hostname", "serial_number"], start, page_length
        )

        # a hostname means nothing to a customer — the type and who holds it do
        holders = {row["assigned_client_user"] for row in result["rows"] if row.get("assigned_client_user")}

        names = (
            {
                row.name: row.full_name
                for row in frappe.get_all(
                    "MSP Client User", filters={"name": ("in", list(holders))}, fields=["name", "full_name"]
                )
            }
            if holders
            else {}
        )

        for row in result["rows"]:
            row["assigned_user_name"] = names.get(row.get("assigned_client_user"))

        PortalService._add_device_service_counts(result["rows"])
        PortalService._add_interfaces(result["rows"])
        # the customer sees everything we do about their own machines, bar our notes
        from nexgen_msp.utils import export_columns

        export_columns.fill_device_extras(result["rows"], with_history=False)

        return result

    @staticmethod
    def _add_interfaces(rows):
        """The MAC addresses a machine answers on, read the same way we read them."""
        devices = [row["name"] for row in rows]

        if not devices:
            return

        grouped = {}

        for row in frappe.get_all(
            "MSP Network Interface",
            filters={"parent": ("in", devices)},
            fields=["parent", "interface_type", "mac_address"],
        ):
            grouped.setdefault(row.parent, []).append(
                {"interface_type": row.interface_type, "mac_address": row.mac_address}
            )

        for row in rows:
            row["interfaces"] = grouped.get(row["name"], [])

    @staticmethod
    def _add_device_service_counts(rows):
        """What each machine actually runs, counted once for the whole page."""
        devices = [row["name"] for row in rows]

        if not devices:
            return

        counts = frappe.db.sql(
            """
            select
                sa.managed_device as device,
                sum(sa.operational_status = 'Active') as active,
                sum(sa.operational_status != 'Active') as inactive,
                group_concat(distinct case when sa.operational_status = 'Active'
                    then coalesce(item.item_name, sa.service_item) end separator ', ') as services
            from `tabMSP Service Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            where sa.managed_device in %(devices)s
            group by sa.managed_device
            """,
            {"devices": devices},
            as_dict=True,
        )

        held = {row.device: row for row in counts}

        for row in rows:
            entry = held.get(row["name"])
            row["active_services"] = int(entry.active) if entry else 0
            row["inactive_services"] = int(entry.inactive) if entry else 0
            row["services"] = entry.services if entry else None

    @staticmethod
    def list_service_assignments(
        customer=None, search=None, status=None, client_user=None, start=0, page_length=20
    ):
        filters = PortalService._base_filters(customer)
        if status:
            filters["operational_status"] = status
        if client_user:
            filters["client_user"] = client_user

        return PortalService._paginated(
            "MSP Service Assignment", ASSIGNMENT_FIELDS, filters, search, ["service_item"], start, page_length
        )

    @staticmethod
    def list_requests(
        customer=None,
        search=None,
        status=None,
        priority=None,
        request_type=None,
        start=0,
        page_length=20,
    ):
        filters = PortalService._base_filters(customer)

        if status:
            filters["status"] = status

        if priority:
            filters["priority"] = priority

        # a colleague's unfinished request is not theirs to read
        filters["name"] = [
            "not in",
            frappe.db.sql_list(
                """
                select name from `tabMSP Request`
                where customer = %(customer)s and status = 'Draft' and requester != %(me)s
                """,
                {"customer": filters["customer"], "me": frappe.session.user},
            )
            or [""],
        ]

        if request_type:
            filters["request_type"] = request_type

        return PortalService._paginated(
            "MSP Request", REQUEST_FIELDS, filters, search, ["name"], start, page_length
        )

    @staticmethod
    def request_filter_options(customer=None):
        """The axes the customer can narrow their own request queue on."""
        customer = PortalService._resolve_customer(customer)
        meta = frappe.get_meta("MSP Request")

        def select(fieldname):
            field = meta.get_field(fieldname)
            return [value for value in (field.options or "").split("\n") if value]

        return {
            "statuses": select("status"),
            "priorities": select("priority"),
            "request_types": select("request_type"),
            "used_types": frappe.db.sql_list(
                """
                select distinct request_type from `tabMSP Request`
                where customer = %(customer)s and request_type is not null
                order by request_type asc
                """,
                {"customer": customer},
            ),
        }

    @staticmethod
    def get_request(name=None):
        """A customer sees their own request and the answer to it — never who internally decided."""
        if not name:
            raise ValidationError("name is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Request", name):
            raise NotFoundError(f"Request {name} does not exist.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Request", name)
        PortalService._resolve_customer(doc.customer)

        if doc.status == "Draft" and doc.requester != frappe.session.user:
            raise NotFoundError(f"Request {name} does not exist.", "NOT_FOUND")

        person = request_targets.line_person_sql("srl")
        lines = frappe.db.sql(
            f"""
            select
                srl.idx, srl.action, srl.line_status, srl.rejection_reason,
                -- the raw links as well as their names: a draft is reopened from these
                srl.operation_code, srl.operation_label_snapshot,
                srl.operation_payload, srl.state_snapshot, srl.requested_holder,
                srl.selection_origin, srl.selection_group_key, srl.selection_label,
                srl.target_scope, srl.subject_key, srl.device_requirement_key,
                srl.client_user, srl.managed_device,
                srl.requested_client_user, srl.requested_device,
                srl.requested_for_requested_client_user,
                srl.requested_holder_requested_client_user,
                srl.source_service_assignment, srl.requested_for_user,
                srl.requested_service,
                coalesce(cu.full_name, rcu.full_name, holder.full_name, for_rcu.full_name) as user_name,
                coalesce(cu.department, rcu.department, holder.department, for_rcu.department) as department,
                coalesce(cu.username, holder.username) as username,
                coalesce(item.item_name, srl.requested_service) as service_name,
                coalesce(srl.operation_label_snapshot, srl.action) as action_label,
                coalesce(requested.full_name, holder_rcu.full_name) as requested_holder_name,
                rdev.display_label as requested_device_label,
                device.hostname, device.serial_number, device.device_type,
                device.assigned_client_user as device_holder,
                srl.requested_effective_date, srl.comment,
                sa.operational_status as service_status,
                sa.effective_start_date as service_start_date,
                sa_device.hostname as delivered_on
            from `tabMSP Request Line` srl
            left join `tabMSP Client User` cu on cu.name = {person}
            left join `tabMSP Managed Device` device on device.name = {request_targets.line_device_sql("srl")}
            left join `tabMSP Client User` holder on holder.name = device.assigned_client_user
            left join `tabItem` item on item.name = srl.requested_service
            left join `tabMSP Client User` requested on requested.name = srl.requested_holder
            left join `tabMSP Requested Client User` rcu on rcu.name = srl.requested_client_user
            left join `tabMSP Requested Client User` for_rcu
                on for_rcu.name = srl.requested_for_requested_client_user
            left join `tabMSP Requested Client User` holder_rcu
                on holder_rcu.name = srl.requested_holder_requested_client_user
            left join `tabMSP Requested Device` rdev on rdev.name = srl.requested_device
            left join `tabMSP Service Assignment` sa
                on sa.source_request = srl.parent
               and sa.service_item = srl.requested_service
               and ({person} is null or sa.client_user = {person})
            left join `tabMSP Managed Device` sa_device on sa_device.name = sa.managed_device
            where srl.parent = %(parent)s
            order by srl.idx asc
            """,
            {"parent": name},
            as_dict=True,
        )

        for line in lines:
            line["service_scope"] = (
                ServiceDefinitionService.scope_of(line.get("requested_service"))
            )
            line["line_status"] = effective_line_status(line.get("line_status"), doc.status)

        subjects = PortalService._drafted_subject_rows(doc)
        requested_devices = PortalService._drafted_device_rows(doc)

        return {
            "name": doc.name,
            "customer": doc.customer,
            "request_type": doc.request_type,
            "status": doc.status,
            "priority": doc.priority,
            "details": doc.details,
            "source": doc.source,
            "creation": doc.creation,
            "modified": doc.modified,
            "rejection_reason": doc.rejection_reason,
            "refused_by_customer": bool(doc.get("refused_by_customer")),
            "reviewed_on": doc.technical_approved_at,
            "can_decide": PortalService._may_decide(doc),
            "can_edit": requester_edit_refusal(doc.name) is None,
            # a request waiting on an accord nobody at the company can yet give is stuck, and
            # the page has to say so rather than promise an approval that will never come
            "has_approver": approval.has_approvers(doc.customer),
            "lines": lines,
            "requested_date": doc.get("requested_date"),
            # what the customer actually built: their people, and the acts they asked for
            "subjects": subjects,
            "requested_devices": requested_devices,
            "restorable": PortalService._restorable(doc, subjects, requested_devices),
            "action_groups": [
                {
                    "group_key": row.group_key,
                    "operation_code": row.operation_code,
                    "operation_label_snapshot": row.operation_label_snapshot,
                    "domain": row.domain,
                    "service_item": row.service_item,
                    "group_origin": row.group_origin,
                    "source_scope_type": row.source_scope_type,
                    "source_scope_key": row.source_scope_key,
                    "source_scope_label": row.source_scope_label,
                    "selected_subject_count": row.selected_subject_count,
                    "applicable_target_count": row.applicable_target_count,
                    "excluded_subject_count": row.excluded_subject_count,
                    "impact": frappe.parse_json(row.impact_snapshot_json or "[]"),
                    "configuration": frappe.parse_json(row.configuration_snapshot_json or "{}"),
                }
                for row in doc.get("action_groups") or []
            ],
        }

    @staticmethod
    def _restorable(doc, subjects, requested_devices):
        """Whether a saved request can be given back to the builder exactly as it was saved."""
        if doc.get("lines") and not doc.get("action_groups"):
            return False

        people = {row["subject_key"] for row in subjects}
        machines = {row["device_requirement_key"] for row in requested_devices}

        if any(row["kind"] == "new" and not row["requested_client_user"] for row in subjects):
            return False

        if any(
            row.get("intended_holder_requested_client_user") and not row.get("intended_holder_subject_key")
            for row in requested_devices
        ):
            return False

        for group in doc.get("action_groups") or []:
            configuration = frappe.parse_json(group.configuration_snapshot_json or "{}") or {}

            if "targets" not in configuration:
                return False

            for target in configuration["targets"]:
                if target.get("subject_key") not in people:
                    return False

                if target.get("device_requirement_key") and target["device_requirement_key"] not in machines:
                    return False

                holder = target.get("requested_holder_subject_key")

                if holder and holder not in people:
                    return False

        return True

    @staticmethod
    def _requested_values(doctype, name, fields):
        """What the requester gave for a Requested record, as its snapshot keeps it."""
        row = frappe.db.get_value(doctype, name, ["requested_snapshot_json", *fields], as_dict=True)

        if not row:
            return {}

        snapshot = frappe.parse_json(row.requested_snapshot_json or "{}") or {}

        return {field: snapshot.get(field, row.get(field)) for field in fields}

    @staticmethod
    def _drafted_subject_rows(doc):
        """The people of a request as the builder holds them."""
        rows = []

        for row in doc.get("subjects") or []:
            machine = row.get("managed_device") or row.get("requested_device")
            entry = {
                "subject_key": row.subject_key,
                "kind": "device"
                if machine
                else "new"
                if row.requested_client_user
                else "existing",
                "client_user": row.client_user,
                "requested_client_user": row.requested_client_user,
                "managed_device": row.get("managed_device"),
                "requested_device": row.get("requested_device"),
                "device_requirement_key": frappe.db.get_value(
                    "MSP Requested Device", row.requested_device, "device_requirement_key"
                )
                if row.get("requested_device")
                else None,
                "full_name": row.full_name_snapshot,
                "department": row.department_snapshot,
                "email": row.email_snapshot,
                "username": row.username_snapshot,
                "external_employee_id": None,
                "start_date": None,
                "added_via": row.added_via,
                "selection_label": row.selection_label,
            }

            if row.requested_client_user:
                entry.update(
                    PortalService._requested_values(
                        "MSP Requested Client User", row.requested_client_user, REQUESTED_PERSON_FIELDS
                    )
                )

            rows.append(entry)

        return rows

    @staticmethod
    def _drafted_device_rows(doc):
        """The requested Devices of a request as the builder holds them."""
        records = frappe.get_all(
            "MSP Requested Device",
            filters={"request": doc.name},
            fields=[
                "name",
                "device_requirement_key",
                "status",
                "intended_holder_client_user",
                "intended_holder_requested_client_user",
            ],
            order_by="creation asc, name asc",
        )
        holders = {
            row.requested_client_user: row.subject_key
            for row in doc.get("subjects") or []
            if row.requested_client_user
        }

        return [
            {
                "device_requirement_key": row.device_requirement_key,
                "requested_device": row.name,
                "status": row.status,
                **PortalService._requested_values(
                    "MSP Requested Device", row.name, REQUESTED_DEVICE_FIELDS
                ),
                "intended_holder_client_user": row.intended_holder_client_user,
                "intended_holder_requested_client_user": row.intended_holder_requested_client_user,
                "intended_holder_subject_key": holders.get(row.intended_holder_requested_client_user)
                if row.intended_holder_requested_client_user
                else None,
            }
            for row in records
        ]

    @staticmethod
    def _may_decide(doc):
        """Whether the caller is the one this request is waiting on.

        The same rule _decide enforces, answered before the fact so the portal only offers
        the accord to whoever can actually give it.
        """
        if doc.status != "Awaiting Customer Approval":
            return False

        rights = approval.rights_of(doc.customer)

        if not rights.get("can_approve"):
            return False

        return all(approval.covers_line(rights, row) for row in doc.lines)

    @staticmethod
    def get_user_detail(client_user=None):
        """One of our people, read the same way our own team reads them.

        The ownership rule is the same on both sides — their own services are theirs, the
        services on the machine they hold are the machine's. What differs is only how much
        of it a customer has any business seeing.
        """
        from nexgen_msp.api.internal.services.user_360_service import User360Service

        if not client_user:
            raise ValidationError("client_user is required.", "VALIDATION_ERROR")

        customer = frappe.db.get_value("MSP Client User", client_user, "customer")

        if not customer:
            raise NotFoundError(f"Client User {client_user} does not exist.", "NOT_FOUND")

        PortalService._resolve_customer(customer)

        return User360Service.read_user(client_user, internal=False)

    @staticmethod
    def get_user_history(client_user=None, limit=50):
        """The same past our own team reads, for one of their own people."""
        from nexgen_msp.api.internal.services.user_360_service import User360Service

        if not client_user:
            raise ValidationError("client_user is required.", "VALIDATION_ERROR")

        customer = frappe.db.get_value("MSP Client User", client_user, "customer")

        if not customer:
            raise NotFoundError(f"Client User {client_user} does not exist.", "NOT_FOUND")

        PortalService._resolve_customer(customer)

        return User360Service.read_history(client_user, limit=limit)

    @staticmethod
    def get_device_detail(device=None):
        """One of their machines, read the same way our own team reads it, bar our notes."""
        from nexgen_msp.api.internal.services.device_service import DeviceService

        if not device:
            raise ValidationError("device is required.", "VALIDATION_ERROR")

        customer = frappe.db.get_value("MSP Managed Device", device, "customer")

        if not customer:
            raise NotFoundError(f"Managed Device {device} does not exist.", "NOT_FOUND")

        PortalService._resolve_customer(customer)

        return DeviceService.read_device(device, internal=False)

    @staticmethod
    def _acknowledge(doc):
        from nexgen_msp.utils import notifications

        notifications.send(
            "MSP Request Received",
            [doc.requester],
            {
                "full_name": frappe.db.get_value("User", doc.requester, "full_name") or doc.requester,
                "request": doc.name,
                "summary": notifications.summary_table(
                    [
                        ("Request", doc.name),
                        ("Services requested", str(len(doc.lines))),
                        ("Priority", doc.priority or "Medium"),
                    ]
                ),
                "link": notifications.portal_url(f"/requests/{doc.name}"),
            },
            reference_doctype="MSP Request",
            reference_name=doc.name,
        )

        PortalService._tell_our_team(doc)

    @staticmethod
    def _tell_our_team(doc):
        """Tell the people who will carry it out that a request has come in.

        Only when it has actually reached us: a request still waiting for the customer's own
        accord is not ours yet, and the queue would fill with work nobody may start.

        Everyone who can act on it is told, because nobody is assigned at this point — the
        first to open it takes it.
        """
        from nexgen_msp.utils import notifications

        if doc.status == "Awaiting Customer Approval":
            return

        # whoever raised it has already had their own acknowledgement
        recipients = [
            address for address in PortalService._our_team() if address != doc.requester
        ]

        if not recipients:
            return

        briefing = notifications.request_briefing(doc)

        for address in recipients:
            notifications.send(
                "MSP Request For Our Team",
                [address],
                {
                    "full_name": frappe.db.get_value("User", address, "full_name") or address,
                    "request": doc.name,
                    "customer": doc.customer,
                    "headline": notifications.request_headline(doc),
                    **briefing,
                    "link": notifications.portal_url(f"/requests/{doc.name}"),
                },
                reference_doctype="MSP Request",
                reference_name=doc.name,
            )

    @staticmethod
    def _device_owner(device, customer):
        """The customer and holder of a machine a line names, refused when it is not this customer's."""
        owner = frappe.db.get_value(
            "MSP Managed Device", device, ["customer", "assigned_client_user"], as_dict=True
        )

        if not owner:
            raise NotFoundError(f"Managed Device {device} not found.", "NOT_FOUND")

        if owner.customer != customer:
            raise ValidationError(
                f"Device {device} does not belong to {customer}.", "PERMISSION_DENIED", 403
            )

        return owner

    @staticmethod
    def _scoped_line(line, customer):
        """A device service is requested against a device; a user service against a person."""
        line = dict(line)
        service = line.get("requested_service")
        scope = ServiceDefinitionService.scope_of(service)
        device = line.get("managed_device")
        future = request_intents.requested_subject_of(line)

        # a machine nobody has registered yet is still a machine: the line stays about the
        # Device, and says the Device is the one still to be prepared
        if line.get("requested_device"):
            line["target_scope"] = "Device"
            line["managed_device"] = None

            if future:
                line["requested_for_requested_client_user"] = future
                line["requested_for_user"] = None
            else:
                line["requested_for_user"] = (
                    line.get("requested_for_user") or line.get("client_user")
                )

            line["client_user"] = None
            line["requested_client_user"] = None

            return line

        if future:
            # a machine act for somebody who does not exist yet is still about the machine.
            # The one they were shown in stock stays on the line: it is what they asked for,
            # and fulfilment stays free to hand over a different one and say so
            if request_intents.is_device_operation(line):
                line["target_scope"] = "Device"
                line["requested_for_requested_client_user"] = future
                line["requested_client_user"] = None

                return line

            if scope in ("Device", "Both") and device:
                PortalService._device_owner(device, customer)
                line["target_scope"] = "Device"
                line["requested_for_requested_client_user"] = future
                line["requested_client_user"] = None
                line["client_user"] = None

                return line

            line["target_scope"] = "User"
            line["managed_device"] = None
            line["requested_client_user"] = future
            line["requested_for_requested_client_user"] = None

            return line

        # a device service named against a machine is about that machine; named against a
        # person only, it stays about the person and the machine is "not specified" — the
        # technician settles it when delivering. Nobody is made to pick a machine.
        if scope in ("Device", "Both") and device:
            owner = PortalService._device_owner(device, customer)

            # the machine owns the service, but the request was still raised for somebody:
            # that person is kept beside it so the line does not lose them the day the
            # machine changes hands
            line["requested_for_user"] = (
                line.get("requested_for_user") or line.get("client_user") or owner.assigned_client_user
            )
            line["target_scope"] = "Device"
            line["client_user"] = None
            return line

        if not line.get("client_user"):
            raise ValidationError(
                f"{service}: say who it is for, or which machine.", "VALIDATION_ERROR"
            )

        line["target_scope"] = "User"
        line["managed_device"] = None
        return line

    @staticmethod
    def _resolved_operation(line, customer, ignore=None):
        """Which operation this line asks for, read against what the application performs.

        A new person can only be granted something, whatever was sent.
        """
        code = (line.get("operation_code") or "").strip()
        future = request_intents.requested_subject_of(line)

        if not code:
            # a line written before operations had codes still says what it wants
            code = operations.from_legacy_action(line.get("action") or "Add") or "service.add"

        definition = operations.require_customer_requestable(code)
        line["operation_code"] = code
        line["operation_label_snapshot"] = definition["label"]

        if definition["domain"] == operations.SERVICE:
            line["action"] = definition["legacy_action"]

            if future and line["action"] != "Add":
                raise ValidationError(
                    "A new person can only be granted a service, not have one changed or removed.",
                    "VALIDATION_ERROR",
                )

            return line

        # asking for a machine names a person, not a machine: which one it turns out to be is
        # settled during fulfilment, so there is nothing here to check it against
        if code == "device.assign" and not line.get("managed_device"):
            if not line.get("requested_device"):
                raise ValidationError(
                    "Say which Device, or describe the one still to be settled.", "VALIDATION_ERROR"
                )

            # the same word every machine operation writes on a line: what changed is the
            # machine, and the operation code is what says which change it was
            line["action"] = "Change"
            line["target_scope"] = "Device"

            if not line.get("requested_holder") and not line.get(
                "requested_holder_requested_client_user"
            ):
                if future:
                    line["requested_holder_requested_client_user"] = future
                else:
                    line["requested_holder"] = line.get("requested_for_user")

            line["client_user"] = None
            line["requested_client_user"] = None
            line["requested_service"] = None
            line["operation_payload"] = frappe.as_json(PortalService._holder_payload(line))

            return line

        # a machine that already belongs to somebody is still a legitimate answer to "which
        # one": what was asked for is that this person end up with it, and the act that does
        # that is a change of holder. The customer said what they want, not how we do it.
        if code == "device.assign" and line.get("managed_device"):
            holder = frappe.db.get_value(
                "MSP Managed Device", line["managed_device"], "assigned_client_user"
            )

            if holder and holder != line.get("requested_holder"):
                code = "device.transfer"
                line["operation_code"] = code
                line["operation_label_snapshot"] = operations.get(code)["label"]

        return PortalService._scoped_device_operation(line, customer, code, ignore)

    @staticmethod
    def _holder_payload(line):
        """The holder a machine line asks for, as its operation payload says it."""
        if line.get("requested_holder"):
            return {"requested_holder": line["requested_holder"]}

        if line.get("requested_holder_requested_client_user"):
            return {
                "requested_holder_requested_client_user": line["requested_holder_requested_client_user"]
            }

        return {}

    @staticmethod
    def _scoped_device_operation(line, customer, code, ignore=None):
        """A Device operation: the machine, the people, and what the machine is doing now.

        Nothing is written to the Device here. The line records what was asked and what the
        Device looked like when it was asked, and execution does the rest.
        """
        device = line.get("managed_device")
        future = request_intents.requested_subject_of(line)

        if not device or not frappe.db.exists("MSP Managed Device", device):
            raise NotFoundError("This Device does not belong to this Customer.", "NOT_FOUND")

        card = frappe.db.get_value(
            "MSP Managed Device",
            device,
            ["customer", "assigned_client_user", "status"],
            as_dict=True,
        )

        if card.customer != customer:
            raise ValidationError(
                "This Device does not belong to this Customer.", "PERMISSION_DENIED", 403
            )

        holder = card.assigned_client_user
        wanted = line.get("requested_holder")

        if code == "device.assign" and holder:
            raise ValidationError(
                "This Device already has a holder. Request a holder change instead.",
                "VALIDATION_ERROR",
            )

        if code in ("device.transfer", "device.repossess") and not holder:
            raise ValidationError(
                "This Device has no current holder. Request an assignment instead.",
                "VALIDATION_ERROR",
            )

        if code in ("device.assign", "device.transfer"):
            # the person meant to hold it may be one this request still has to create: there
            # is no name to check yet, and the line already says who they are
            if not wanted and not line.get("requested_holder_requested_client_user") and future:
                line["requested_holder_requested_client_user"] = future

            awaited = bool(line.get("requested_holder_requested_client_user")) and not wanted

            if not wanted and not awaited:
                raise ValidationError("Say who should hold this Device.", "VALIDATION_ERROR")

            if not awaited:
                person = frappe.db.get_value(
                    "MSP Client User", wanted, ["customer", "lifecycle_status"], as_dict=True
                )

                if not person or person.customer != customer:
                    raise ValidationError(
                        "The selected person does not belong to this Customer.",
                        "VALIDATION_ERROR",
                    )

                if person.lifecycle_status not in ("Pending", "Active"):
                    raise ValidationError(
                        "The selected person cannot receive this Device in their current "
                        "lifecycle state.",
                        "VALIDATION_ERROR",
                    )

                if wanted == holder:
                    raise ValidationError(
                        "The selected person already holds this Device.", "VALIDATION_ERROR"
                    )

        pending = PortalService._pending_holder_request(device, ignore)

        if pending:
            raise ValidationError(
                f"This Device already has a pending holder change in request {pending}.",
                "DEVICE_REQUEST_CONFLICT",
            )

        line["target_scope"] = "Device"
        line["client_user"] = None
        line["requested_client_user"] = None
        # who the machine is leaving, when it is leaving somebody. A line raised for a person
        # this request has yet to create names nobody here: they have no record to name, and
        # the machine's own history is in the snapshot below
        line["requested_for_user"] = None if future else holder
        line["requested_for_requested_client_user"] = future or None
        line["requested_service"] = None
        line["action"] = "Change"
        line["operation_payload"] = frappe.as_json(PortalService._holder_payload(line))
        line["state_snapshot"] = frappe.as_json(operations.snapshot_device(device))

        return line

    @staticmethod
    def _request_type_of(rows, asked=None):
        """What this request is, read from the operations its lines carry."""
        return operations.request_type_of(rows, asked)

    @staticmethod
    def _pending_holder_request(device, ignore=None):
        """The request already asking for this Device to change hands, if there is one."""
        return request_intents.pending_holder_request(device, exclude=ignore)

    @staticmethod
    def _line_rows(lines, customer, request_type, requested_date=None, strict=True, ignore=None):
        """The child rows of a request, built the same way whether it is saved or sent.

        A draft is not checked: it is a half-written page, and telling someone which machine
        they forgot is what the moment of sending is for.
        """
        lines = frappe.parse_json(lines) if isinstance(lines, str) else lines

        if not lines:
            raise ValidationError("At least one line is required.", "VALIDATION_ERROR")

        if strict:
            lines = [PortalService._scoped_line(line, customer) for line in lines]
            lines = [PortalService._resolved_operation(line, customer, ignore) for line in lines]

        return lines, [
            {
                "operation_code": line.get("operation_code"),
                "operation_label_snapshot": line.get("operation_label_snapshot"),
                "operation_payload": line.get("operation_payload"),
                "state_snapshot": line.get("state_snapshot"),
                "requested_holder": line.get("requested_holder"),
                "requested_holder_requested_client_user": line.get(
                    "requested_holder_requested_client_user"
                ),
                "action": line.get("action") or request_type or "Add",
                "target_scope": line.get("target_scope") or "User",
                "subject_key": line.get("subject_key"),
                "action_group_key": line.get("action_group_key"),
                "device_requirement_key": line.get("device_requirement_key"),
                "client_user": line.get("client_user"),
                "requested_client_user": line.get("requested_client_user"),
                "requested_for_user": line.get("requested_for_user"),
                "requested_for_requested_client_user": line.get(
                    "requested_for_requested_client_user"
                ),
                "source_service_assignment": line.get("source_service_assignment"),
                "managed_device": line.get("managed_device"),
                "requested_device": line.get("requested_device"),
                "customer_site": line.get("customer_site"),
                "requested_service": line.get("requested_service"),
                "requested_quantity": line.get("requested_quantity") or 1,
                "requested_effective_date": requested_date or line.get("requested_effective_date"),
                "comment": line.get("comment"),
                # how this subject came to be in the request, kept exactly as it was selected
                "selection_origin": line.get("selection_origin") or "Individual",
                "selection_group_key": line.get("selection_group_key"),
                "selection_label": line.get("selection_label"),
                "selection_snapshot_at": line.get("selection_snapshot_at"),
            }
            for line in lines
        ]

    @staticmethod
    def _refuse_former_keys(*collections):
        """Refuse a payload that still describes a person or a machine through the former flags."""
        for rows in collections:
            for row in rows or []:
                if not isinstance(row, dict):
                    continue

                for key in row:
                    if key in FORMER_INPUT_KEYS or key.startswith(FORMER_INPUT_PREFIXES):
                        raise ValidationError(
                            f"{key} is no longer accepted. Describe a future person in subjects "
                            "and a Device still to be settled in requested_devices.",
                            "VALIDATION_ERROR",
                        )

    @staticmethod
    def _drafted_subjects(subjects):
        """The people of a request, each with its kind, by subject key."""
        from nexgen_msp.api.internal.services.department_service import DepartmentService

        people = {}

        for row in subjects or []:
            key = (row.get("subject_key") or "").strip()

            if not key:
                raise ValidationError("Every person of a request needs a subject_key.", "VALIDATION_ERROR")

            if key in people:
                raise ValidationError(f"{key} is named twice among the people of this request.", "VALIDATION_ERROR")

            kind = row.get("kind") or (
                "device"
                if row.get("managed_device") or row.get("requested_device")
                else "existing"
                if row.get("client_user")
                else "new"
            )

            if kind not in SUBJECT_KINDS:
                raise ValidationError(f"{kind} is not a kind of person.", "VALIDATION_ERROR")

            if kind == "existing" and not row.get("client_user"):
                raise ValidationError("Choose the Client User this person is.", "VALIDATION_ERROR")

            if kind == "device":
                if row.get("client_user") or row.get("requested_client_user"):
                    raise ValidationError(
                        "A Device subject is a machine, not a person.", "VALIDATION_ERROR"
                    )

                if not (row.get("managed_device") or row.get("device_requirement_key")):
                    raise ValidationError(
                        "Choose the Device this subject is.", "VALIDATION_ERROR"
                    )

            if kind == "new":
                if row.get("client_user"):
                    raise ValidationError(
                        "A new person cannot also be an existing one.", "VALIDATION_ERROR"
                    )

                if not (row.get("full_name") or "").strip():
                    raise ValidationError("A full name is required.", "VALIDATION_ERROR")

                row = {**row, "department": DepartmentService.validate_department(row.get("department"))}

            people[key] = {**row, "subject_key": key, "kind": kind}

        return people

    @staticmethod
    def _drafted_devices(requested_devices, people):
        """The Devices still to be settled that a request describes, by device requirement key."""
        machines = {}

        for row in requested_devices or []:
            key = (row.get("device_requirement_key") or "").strip()

            if not key:
                raise ValidationError(
                    "Every requested Device needs a device_requirement_key.", "VALIDATION_ERROR"
                )

            if key in machines:
                raise ValidationError(
                    f"{key} is named twice among the requested Devices of this request.",
                    "VALIDATION_ERROR",
                )

            holder = row.get("intended_holder_subject_key")

            if holder and holder not in people:
                raise ValidationError(f"{holder} is not a person of this request.", "VALIDATION_ERROR")

            if holder and row.get("intended_holder_client_user"):
                raise ValidationError(request_targets.BOTH_TARGETS, "VALIDATION_ERROR")

            machines[key] = {**row, "device_requirement_key": key}

        return machines

    @staticmethod
    def _keyed_device(row, machines):
        """Name the requested Device a target or a line points at by its key."""
        name = row.get("requested_device")

        if not name or row.get("device_requirement_key"):
            return

        key = next(
            (key for key, machine in machines.items() if machine.get("requested_device") == name),
            None,
        )

        if not key:
            raise ValidationError(request_targets.CROSS_REQUEST, "VALIDATION_ERROR")

        row["device_requirement_key"] = key

    @staticmethod
    def _describe_minted(machines, key, holder):
        if key in machines:
            return

        machines[key] = {
            "device_requirement_key": key,
            "display_label": "New device",
            "intended_holder_subject_key": holder.get("subject_key") if holder.get("kind") == "new" else None,
            "intended_holder_client_user": holder.get("client_user") if holder.get("kind") == "existing" else None,
        }

    @staticmethod
    def _free_key(machines, key):
        """The key itself, or the first numbered one no machine of this request uses yet."""
        if key not in machines:
            return key

        count = 2

        while f"{key}:{count}" in machines:
            count += 1

        return f"{key}:{count}"

    @staticmethod
    def _mint_group_devices(groups, people, machines):
        """Give a requested Device to every machine target of an act that names none."""
        for group in groups:
            code = group.get("operation_code")

            for target in group.get("targets") or []:
                PortalService._keyed_device(target, machines)

                if target.get("managed_device") or target.get("device_requirement_key"):
                    continue

                if code != "device.assign" and target.get("target_scope") != "Device":
                    continue

                subject = people.get(target.get("subject_key")) or {}
                key = (
                    PortalService._free_key(
                        machines, f"new-device:{group.get('group_key')}:{target.get('subject_key')}"
                    )
                    if code == "device.assign"
                    else f"new-device:{target.get('subject_key')}"
                )
                PortalService._describe_minted(machines, key, subject)
                target["device_requirement_key"] = key

    @staticmethod
    def _mint_line_devices(lines, people, machines):
        """Give a requested Device to every machine asked for by a line that names none."""
        counted = {}

        for line in lines:
            PortalService._keyed_device(line, machines)

            if line.get("managed_device") or line.get("device_requirement_key"):
                continue

            if (line.get("operation_code") or "") != "device.assign":
                continue

            subject_key = line.get("subject_key") or (
                f"user:{line['client_user']}" if line.get("client_user") else "request"
            )
            subject = people.get(subject_key) or (
                {"kind": "existing", "client_user": line.get("client_user")}
                if line.get("client_user")
                else {}
            )

            if line.get("action_group_key"):
                key = PortalService._free_key(machines, f"new-device:{line['action_group_key']}:{subject_key}")
            else:
                counted[subject_key] = counted.get(subject_key, 0) + 1
                key = f"new-device:{subject_key}:{counted[subject_key]}"

            PortalService._describe_minted(machines, key, subject)
            line["device_requirement_key"] = key

    @staticmethod
    def _canonical(given, actual):
        """The canonical Requested record, refused when the caller named a different one."""
        if given and given != actual:
            raise ValidationError(request_targets.CROSS_REQUEST, "VALIDATION_ERROR")

        return actual

    @staticmethod
    def _link_requested(line, people, machines, written):
        """Point a line at the Requested records of its request, from the keys it carries."""
        line = dict(line)
        key = line.get("subject_key")
        subject = people.get(key)

        if subject and subject["kind"] == "new":
            if line.get("client_user"):
                raise ValidationError("A new person cannot also be an existing one.", "VALIDATION_ERROR")

            line["requested_client_user"] = PortalService._canonical(
                line.get("requested_client_user"), written["people"][key]
            )
        elif line.get("requested_client_user"):
            raise ValidationError(request_targets.CROSS_REQUEST, "VALIDATION_ERROR")
        elif subject and not line.get("client_user") and line.get("target_scope") != "Device":
            line["client_user"] = subject.get("client_user")
        elif key and not subject and not line.get("client_user") and not key.startswith("user:"):
            raise ValidationError(f"{key} is not a person of this request.", "VALIDATION_ERROR")

        device_key = line.get("device_requirement_key")

        if device_key:
            if line.get("managed_device"):
                raise ValidationError(request_targets.BOTH_TARGETS, "VALIDATION_ERROR")

            if device_key not in written["machines"]:
                raise ValidationError(
                    f"{device_key} is not a requested Device of this request.", "VALIDATION_ERROR"
                )

            line["requested_device"] = PortalService._canonical(
                line.get("requested_device"), written["machines"][device_key]
            )
        elif line.get("requested_device"):
            raise ValidationError(request_targets.CROSS_REQUEST, "VALIDATION_ERROR")

        holder_key = line.pop("requested_holder_subject_key", None)

        if holder_key:
            holder = people.get(holder_key)

            if not holder:
                raise ValidationError(f"{holder_key} is not a person of this request.", "VALIDATION_ERROR")

            if holder["kind"] == "new":
                if line.get("requested_holder"):
                    raise ValidationError(request_targets.BOTH_TARGETS, "VALIDATION_ERROR")

                line["requested_holder_requested_client_user"] = PortalService._canonical(
                    line.get("requested_holder_requested_client_user"), written["people"][holder_key]
                )
            else:
                if line.get("requested_holder_requested_client_user"):
                    raise ValidationError(request_targets.BOTH_TARGETS, "VALIDATION_ERROR")

                line["requested_holder"] = PortalService._canonical(
                    line.get("requested_holder"), holder.get("client_user")
                )
        elif line.get("requested_holder_requested_client_user") not in (
            None,
            "",
            *written["people"].values(),
        ):
            raise ValidationError(request_targets.CROSS_REQUEST, "VALIDATION_ERROR")

        return line

    @staticmethod
    def compose_from_groups(customer, subjects, action_groups, requested_date=None):
        """Turn what the customer built into the atomic lines it stands for.

        The builder hands over people and grouped actions, never lines: a group names the
        scope it was chosen from and the exact targets the customer kept, and one line is
        written per target. A subject the group could not reach contributes nothing here —
        the request says what is to be done, and there is nothing to do for them.
        """
        subjects = frappe.parse_json(subjects) if isinstance(subjects, str) else (subjects or [])
        groups = (
            frappe.parse_json(action_groups)
            if isinstance(action_groups, str)
            else (action_groups or [])
        )
        by_key = {row.get("subject_key"): row for row in subjects}
        lines = []

        for group in groups:
            code = group.get("operation_code")
            definition = operations.require_customer_requestable(code)
            label = group.get("operation_label_snapshot") or definition["label"]

            for target in group.get("targets") or []:
                subject = by_key.get(target.get("subject_key")) or {}
                is_new = subject.get("kind") == "new"
                lines.append(
                    {
                        "operation_code": code,
                        "operation_label_snapshot": label,
                        "action": definition.get("legacy_action") or "Change",
                        "target_scope": target.get("target_scope") or "User",
                        "subject_key": target.get("subject_key"),
                        "action_group_key": group.get("group_key"),
                        "client_user": None if is_new else subject.get("client_user"),
                        "requested_client_user": target.get("requested_client_user"),
                        "managed_device": target.get("managed_device"),
                        "device_requirement_key": target.get("device_requirement_key"),
                        "requested_device": target.get("requested_device"),
                        # a machine asked for somebody names them here, the way every machine
                        # line does: the person it is wanted for, not the holder of a service
                        "requested_for_user": target.get("client_user")
                        if code == "device.assign" and not is_new
                        else None,
                        "requested_service": group.get("service_item"),
                        "source_service_assignment": target.get("source_service_assignment"),
                        "requested_holder": target.get("requested_holder"),
                        "requested_holder_subject_key": target.get("requested_holder_subject_key"),
                        "requested_holder_requested_client_user": target.get(
                            "requested_holder_requested_client_user"
                        ),
                        "requested_effective_date": requested_date,
                        "comment": group.get("comment"),
                        "selection_origin": _selection_origin(group.get("source_scope_type")),
                        "selection_group_key": group.get("source_scope_key"),
                        "selection_label": group.get("source_scope_label"),
                        "selection_snapshot_at": group.get("snapshot_at"),
                    }
                )

        if not lines:
            raise ValidationError(
                "Add at least one requested action before continuing.", "VALIDATION_ERROR"
            )

        return lines

    @staticmethod
    def _subject_context(customer, subjects):
        """What each person really held when the request was made, read from the database.

        The browser is not authoritative for this. It shows the customer a picture, and that
        picture is what the snapshot has to keep — but the picture has to be taken here, or a
        stale tab could write a version of the past that never happened.
        """
        if not subjects:
            return {}

        from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

        try:
            projected = RequestScopeService.scope_projection(customer=customer, subjects=subjects)
        except Exception:
            # a snapshot is worth having, but never at the cost of the request itself
            return {}

        return {
            row["subject_key"]: {
                "devices": row.get("devices") or [],
                "current_services": row.get("current_services") or [],
                "last_billed": row.get("last_billed"),
                "department": row.get("department"),
                "taken_at": frappe.utils.now(),
            }
            for row in projected.get("subjects") or []
        }

    @staticmethod
    def _canonical_target(target, people, written):
        """A target as the saved configuration keeps it: with the Requested records it names."""
        target = dict(target)
        subject = people.get(target.get("subject_key")) or {}
        holder = people.get(target.get("requested_holder_subject_key")) or {}

        target["requested_client_user"] = (
            written["people"].get(target.get("subject_key")) if subject.get("kind") == "new" else None
        )
        target["requested_device"] = written["machines"].get(target.get("device_requirement_key"))

        if holder.get("kind") == "new":
            target["requested_holder_requested_client_user"] = written["people"].get(
                target.get("requested_holder_subject_key")
            )

        return target

    @staticmethod
    def _snapshot_rows(people, action_groups, customer, written):
        """The two child tables that keep the customer's own view of what they asked."""
        groups = (
            frappe.parse_json(action_groups)
            if isinstance(action_groups, str)
            else (action_groups or [])
        )
        context = PortalService._subject_context(customer, list(people.values()))
        subject_rows = [
            {
                "subject_key": key,
                "client_user": row.get("client_user") if row["kind"] == "existing" else None,
                "requested_client_user": written["people"].get(key) if row["kind"] == "new" else None,
                "managed_device": row.get("managed_device") if row["kind"] == "device" else None,
                "requested_device": (
                    written["machines"].get(row.get("device_requirement_key"))
                    if row["kind"] == "device" and row.get("device_requirement_key")
                    else None
                ),
                "full_name_snapshot": row.get("full_name") or row.get("client_user") or "Unknown",
                "department_snapshot": row.get("department"),
                "email_snapshot": row.get("email"),
                "username_snapshot": row.get("username"),
                "added_via": row.get("added_via")
                or {"new": "New", "device": "Device"}.get(row["kind"], "Existing"),
                "selection_label": row.get("selection_label"),
                # written here, from the database, and not from whatever the browser sent:
                # the snapshot is what we can stand behind six months later
                "context_snapshot_json": frappe.as_json(context.get(key) or {}),
            }
            for key, row in people.items()
        ]
        group_rows = []

        for group in groups:
            targets = [
                PortalService._canonical_target(target, people, written)
                for target in group.get("targets") or []
            ]
            exclusions = group.get("exclusions") or []
            reached = {target.get("subject_key") for target in targets}
            group_rows.append(
                {
                    "group_key": group.get("group_key"),
                    "operation_code": group.get("operation_code"),
                    "operation_label_snapshot": group.get("operation_label_snapshot"),
                    "domain": group.get("domain") or "Service",
                    "service_item": group.get("service_item"),
                    "group_origin": "Customer",
                    "source_scope_type": group.get("source_scope_type") or "All",
                    "source_scope_key": group.get("source_scope_key"),
                    "source_scope_label": group.get("source_scope_label"),
                    "selected_subject_count": group.get("selected_subject_count") or 0,
                    "applicable_target_count": len(targets),
                    "excluded_subject_count": len(
                        {row.get("subject_key") for row in exclusions} - reached
                    ),
                    # the impact snapshot below says who was reached and why the others were
                    # not; this one keeps the configuration itself, so a draft reopened weeks
                    # later is the draft that was saved and not an approximation of it
                    "configuration_snapshot_json": frappe.as_json(
                        {
                            "comment": group.get("comment"),
                            "targets": targets,
                            "exclusions": exclusions,
                        }
                    ),
                    "impact_snapshot_json": frappe.as_json(
                        [
                            {
                                "subject_key": target.get("subject_key"),
                                "status": "selected",
                                "targets": [
                                    {
                                        "target_type": "Device"
                                        if target.get("managed_device") or target.get("requested_device")
                                        else "ServiceAssignment",
                                        "target": target.get("managed_device")
                                        or target.get("requested_device")
                                        or target.get("source_service_assignment")
                                        or target.get("client_user")
                                        or target.get("requested_client_user"),
                                    }
                                ],
                            }
                            for target in targets
                        ]
                        + [
                            {
                                "subject_key": row.get("subject_key"),
                                "status": "inapplicable",
                                "reason_code": row.get("reason_code"),
                            }
                            for row in exclusions
                            if row.get("subject_key") not in reached
                        ]
                    ),
                }
            )

        return subject_rows, group_rows

    @staticmethod
    def _guard_selection_still_stands(rows, customer):
        """The people this request was written for, read again at the moment it is sent.

        A selection is a snapshot: people added to a Department afterwards are never pulled in.
        But somebody who left, was archived, or moved to another company since cannot be the
        subject of work, and that is said rather than quietly dropped.
        """
        people = sorted(
            {row.get("client_user") or row.get("requested_for_user") for row in rows} - {None, ""}
        )

        if not people:
            return

        known = {
            row.name: row
            for row in frappe.get_all(
                "MSP Client User",
                filters={"name": ("in", people)},
                fields=["name", "full_name", "customer", "lifecycle_status"],
            )
        }
        changed = []

        for person in people:
            card = known.get(person)

            if not card:
                changed.append({"client_user": person, "full_name": person, "reason": "No longer on file"})
            elif card.customer != customer:
                changed.append(
                    {
                        "client_user": person,
                        "full_name": card.full_name,
                        "reason": "One or more selected people no longer belong to this Customer.",
                    }
                )
            elif card.lifecycle_status not in ("Pending", "Active"):
                changed.append(
                    {
                        "client_user": person,
                        "full_name": card.full_name,
                        "reason": f"{card.lifecycle_status} since this request was written",
                    }
                )

        if changed:
            raise ValidationError(
                "Some selected people changed after they were added to this request.",
                "REQUEST_SCOPE_CHANGED",
                detail={
                    "people": changed,
                    "message": (
                        "Review the affected people before submitting. Newly added people are "
                        "never included automatically."
                    ),
                },
            )

    @staticmethod
    def _guard_one_destination(rows):
        """Refuse a machine that the same request hands to two different people."""
        for machine, holders in request_intents.handed_over(rows).items():
            if len(holders) > 1:
                raise ValidationError(
                    f"{request_intents.machine_label(machine)}: {request_intents.ONE_DESTINATION}",
                    "VALIDATION_ERROR",
                )

    @staticmethod
    def _collapse_duplicates(rows):
        """The same operation on the same target belongs in the request once.

        A person can be picked by hand and again through their Department; the request says
        what is to be done, and doing it twice is not a second thing to do. That holds inside
        one act. Across two it does not: two acts are two deliberate asks, and folding them
        together here is how a request came to announce four actions and carry three.

        So: silent inside one act; two lines when two acts each ask for a machine without
        naming one, because that is two machines; and a refusal for everything else, since
        the one thing this may not do is decide by itself that the customer meant it once.
        """
        seen = {}
        kept = []

        for row in rows:
            key = request_intents.target_key(row)
            first = seen.get(key, _UNSEEN)

            if first is _UNSEEN:
                seen[key] = row.get("action_group_key")
                kept.append(row)
                continue

            if first == row.get("action_group_key"):
                # one act reaching the same person twice over: still one thing to do
                continue

            # two acts asking for a machine without naming one are two machines: that is
            # what the requirement key already prepares for. Named twice, it is one machine
            # asked for twice, and that is the duplicate this refuses
            if (
                request_intents.is_device_operation(row)
                and not row.get("managed_device")
                and not row.get("requested_device")
            ):
                kept.append(row)
                continue

            raise ValidationError(
                f"{row.get('operation_label_snapshot') or row.get('operation_code')}: this "
                "request asks for the same thing twice for the same person. Remove one of "
                "the two actions.",
                "VALIDATION_ERROR",
            )

        return kept

    @staticmethod
    def _guard_approval_scope(rows, customer):
        """A request reaching more than one Department needs somebody who decides for all of it.

        No Department approver covers it, and this release does not split a request or ask
        several Department approvers to agree to their own part of it.
        """
        if permissions.is_internal():
            return

        if not approval.reaches_several_departments(rows):
            return

        if approval.company_wide_approver(customer):
            return

        raise ValidationError(
            "This request affects multiple Departments and requires a company-wide approver. "
            "Configure one before submitting this request.",
            "COMPANY_APPROVER_REQUIRED",
        )

    @staticmethod
    def _own_draft(name):
        """A draft belongs to whoever started it, and to nobody else."""
        if not frappe.db.exists("MSP Request", name):
            raise NotFoundError(f"Request {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Request", name)

        if doc.status != "Draft":
            raise ValidationError(
                f"{name} has already been submitted and can no longer be edited as a draft.",
                "INVALID_TRANSITION",
            )

        if doc.requester != frappe.session.user:
            raise ValidationError(
                "This draft belongs to someone else.", "PERMISSION_DENIED", 403
            )

        PortalService._resolve_customer(doc.customer)

        return doc

    @staticmethod
    def _own_sent_request(name):
        """A sent request its requester may still modify, its row locked until the change is written."""
        if not name or not frappe.db.exists("MSP Request", name):
            raise NotFoundError(f"Request {name} not found.", "NOT_FOUND")

        PortalService._resolve_customer(frappe.db.get_value("MSP Request", name, "customer"))
        refusal = requester_edit_refusal(name, for_update=True)

        if refusal == "not_requester":
            raise ValidationError(NOT_THE_REQUESTER, "PERMISSION_DENIED", 403)

        if refusal:
            raise ValidationError(REQUEST_LOCKED, "REQUEST_LOCKED")

        return frappe.get_doc("MSP Request", name, for_update=True)

    @staticmethod
    def _write_requested(request, people, machines):
        """Write the Requested Client Users and Requested Devices a draft describes."""
        from nexgen_msp.api.internal.services.requested_client_user_service import (
            RequestedClientUserService,
        )
        from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService

        written = {"people": {}, "machines": {}}

        for key, subject in people.items():
            if subject["kind"] != "new":
                continue

            name = RequestedClientUserService.create_or_update_draft(
                request, key, {field: subject.get(field) for field in REQUESTED_PERSON_FIELDS}
            )
            written["people"][key] = PortalService._canonical(subject.get("requested_client_user"), name)

        for key, machine in machines.items():
            holder_key = machine.get("intended_holder_subject_key")
            holder = people.get(holder_key) if holder_key else None
            values = {field: machine.get(field) for field in REQUESTED_DEVICE_FIELDS}
            values["intended_holder_client_user"] = (
                holder.get("client_user")
                if holder and holder["kind"] == "existing"
                else machine.get("intended_holder_client_user")
            )
            values["intended_holder_requested_client_user"] = (
                written["people"].get(holder_key) if holder and holder["kind"] == "new" else None
            )
            name = RequestedDeviceService.create_or_update_draft(
                request, key, values, subject_key=holder_key or ""
            )
            written["machines"][key] = PortalService._canonical(machine.get("requested_device"), name)

        return written

    @staticmethod
    def _discard_requested(request, keep=None):
        """Delete the Requested records of a draft that are not among the ones kept."""
        keep = keep or {"people": {}, "machines": {}}

        for doctype, kept in (
            ("MSP Requested Device", set(keep["machines"].values())),
            ("MSP Requested Client User", set(keep["people"].values())),
        ):
            for name in frappe.get_all(doctype, filters={"request": request}, pluck="name"):
                if name not in kept:
                    frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)

    @staticmethod
    def _write(
        name,
        customer,
        request_type,
        priority,
        details,
        requested_date,
        lines,
        subjects,
        requested_devices,
        action_groups,
        submit,
        modify=False,
    ):
        """Write a request from its people, its requested Devices and its acts, in one transaction."""
        from nexgen_msp.api.internal.services.requested_client_user_service import (
            RequestedClientUserService,
        )
        from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService

        subjects = _parsed(subjects)
        requested_devices = _parsed(requested_devices)
        groups = _parsed(action_groups)
        lines = _parsed(lines)
        requested_date = requested_date or None

        PortalService._refuse_former_keys(
            subjects,
            requested_devices,
            lines,
            groups,
            [target for group in groups for target in group.get("targets") or []],
        )

        people = PortalService._drafted_subjects(subjects)
        machines = PortalService._drafted_devices(requested_devices, people)

        if groups:
            PortalService._mint_group_devices(groups, people, machines)
            # the customer built people and grouped actions; the lines are ours to derive
            lines = PortalService.compose_from_groups(
                customer, list(people.values()), groups, requested_date
            )
        else:
            PortalService._mint_line_devices(lines, people, machines)

        if not lines:
            raise ValidationError("At least one line is required.", "VALIDATION_ERROR")

        refusal = requested_date_refusal(
            requested_date, frappe.db.get_value("MSP Request", name, "creation") if name else None
        )

        if refusal:
            raise ValidationError(refusal, "VALIDATION_ERROR")

        strict = submit or modify
        savepoint = "write_request"
        frappe.db.savepoint(savepoint)

        try:
            if modify:
                doc = PortalService._own_sent_request(name)
                frappe.flags.requester_edit = doc.name
            elif name:
                # a draft being sent: the same document grows up rather than a second one
                doc = PortalService._own_draft(name)
            else:
                _, first_rows = PortalService._line_rows(
                    lines, customer, request_type, requested_date, strict=False
                )
                first_rows = [
                    {**row, **{field: None for field in request_targets.REQUESTED_LINKS}}
                    for row in first_rows
                ]
                # the scoped service above is the permission boundary; generic document access
                # is deliberately closed to customer accounts
                doc = frappe.get_doc(
                    {
                        "doctype": "MSP Request",
                        "customer": customer,
                        "request_type": request_type,
                        "priority": priority or "Medium",
                        # a request opened by the team is not a request from the customer
                        "source": "Internal" if permissions.is_internal() else "Portal",
                        "status": "Draft",
                        "requester": frappe.session.user,
                        "requested_date": requested_date,
                        "lines": first_rows,
                    }
                ).insert(ignore_permissions=True)

            written = PortalService._write_requested(doc.name, people, machines)
            linked = [PortalService._link_requested(line, people, machines, written) for line in lines]
            _, rows = PortalService._line_rows(
                linked, customer, request_type, requested_date, strict=strict, ignore=doc.name
            )
            subject_rows, group_rows = PortalService._snapshot_rows(people, groups, customer, written)
            opening_status, approved_by = None, None

            if strict:
                PortalService._guard_selection_still_stands(rows, customer)
                PortalService._guard_one_destination(rows)
                rows = PortalService._collapse_duplicates(rows)
                PortalService._guard_approval_scope(rows, customer)
                request_type = PortalService._request_type_of(rows, request_type)

            if submit:
                opening_status, approved_by = PortalService._opening_status(customer, rows)

            doc.request_type = request_type or doc.request_type
            doc.priority = priority or doc.priority
            # one note for the whole request, never one per line
            doc.details = (details or "").strip() or None
            doc.requested_date = requested_date
            doc.set("lines", rows)
            doc.set("subjects", subject_rows)
            doc.set("action_groups", group_rows)

            PortalService._discard_requested(doc.name, written)

            if strict:
                RequestedClientUserService.freeze(doc.name)
                RequestedDeviceService.freeze(doc.name)

            if submit:
                doc.status = opening_status

            doc.save(ignore_permissions=True)

            if modify:
                doc.add_comment("Comment", MODIFIED_COMMENT)

            if approved_by:
                # raised by someone who may approve their own: the accord is theirs, recorded
                # rather than left implicit
                doc.db_set("customer_approved_by", approved_by, update_modified=False)
                doc.db_set("customer_approved_at", frappe.utils.now(), update_modified=False)
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise
        finally:
            frappe.flags.requester_edit = None

        frappe.db.commit()

        return doc

    @staticmethod
    def save_draft(
        name=None,
        customer=None,
        request_type=None,
        priority=None,
        lines=None,
        details=None,
        subjects=None,
        action_groups=None,
        requested_devices=None,
        requested_date=None,
    ):
        """Put a half-written request aside and come back to it.

        A draft reaches nobody: not our queue, not the approvers, not the colleagues at the
        customer. It is the author's own until they send it.
        """
        customer = PortalService._resolve_customer(customer)
        # a draft is the start of a request: whoever may not raise one may not start one
        PortalService._guard_may_submit(customer)

        doc = PortalService._write(
            name,
            customer,
            request_type,
            priority,
            details,
            requested_date,
            lines,
            subjects,
            requested_devices,
            action_groups,
            submit=False,
        )

        return PortalService.get_request(doc.name)

    @staticmethod
    def discard_draft(name=None):
        """Throw away a draft. Only ever a draft, and only ever the author's own."""
        doc = PortalService._own_draft(name)
        frappe.delete_doc("MSP Request", doc.name, force=True, ignore_permissions=True)
        PortalService._discard_requested(doc.name)
        frappe.db.commit()

        return {"discarded": name}

    @staticmethod
    def create_request(
        name=None,
        customer=None,
        request_type=None,
        priority=None,
        lines=None,
        details=None,
        subjects=None,
        action_groups=None,
        requested_devices=None,
        requested_date=None,
    ):
        customer = PortalService._resolve_customer(customer)
        PortalService._guard_may_submit(customer)

        doc = PortalService._write(
            name,
            customer,
            request_type,
            priority,
            details,
            requested_date,
            lines,
            subjects,
            requested_devices,
            action_groups,
            submit=True,
        )

        if doc.status == "Awaiting Customer Approval":
            PortalService._ask_for_approval(doc)
        else:
            PortalService._acknowledge(doc)

        return PortalService.get_request(doc.name)

    @staticmethod
    def update_request(
        name=None,
        customer=None,
        request_type=None,
        priority=None,
        lines=None,
        details=None,
        subjects=None,
        action_groups=None,
        requested_devices=None,
        requested_date=None,
    ):
        """The requester rewrites a request already sent, until work on it starts; its status stays."""
        doc = PortalService._own_sent_request(name)

        if customer and customer != doc.customer:
            raise ValidationError("This request belongs to another Customer.", "VALIDATION_ERROR")

        PortalService._guard_may_submit(doc.customer)

        PortalService._write(
            doc.name,
            doc.customer,
            request_type,
            priority,
            details,
            requested_date,
            lines,
            subjects,
            requested_devices,
            action_groups,
            submit=False,
            modify=True,
        )

        PortalService._tell_of_modification(frappe.get_doc("MSP Request", doc.name))

        return PortalService.get_request(doc.name)

    @staticmethod
    def _tell_of_modification(doc):
        """Tell whoever the request is waiting on that what they are holding has changed."""
        from nexgen_msp.utils import notifications

        if doc.status == "Awaiting Customer Approval":
            recipients = PortalService._approvers_of(doc)
        else:
            recipients = PortalService._our_team()

        recipients = [address for address in recipients if address != frappe.session.user]

        if not recipients:
            return

        summary = notifications.summary_table(
            [
                ("Request", doc.name),
                ("Customer", doc.customer),
                ("Services requested", str(len(doc.lines))),
                ("Requested for", frappe.utils.formatdate(doc.requested_date)
                 if doc.requested_date else "-"),
            ]
        )

        for address in recipients:
            notifications.send(
                "MSP Request Modified",
                [address],
                {
                    "full_name": frappe.db.get_value("User", address, "full_name") or address,
                    "request": doc.name,
                    "customer": doc.customer,
                    "modified_by": frappe.utils.get_fullname(frappe.session.user),
                    "summary": summary,
                    "link": notifications.portal_url(f"/requests/{doc.name}"),
                },
                reference_doctype="MSP Request",
                reference_name=doc.name,
            )

    @staticmethod
    def my_approval_rights(customer=None):
        """What the signed-in person may do, so the portal knows what to offer."""
        # our own team, before it has said which customer it acts for
        if not customer and permissions.is_internal():
            return {
                "customer": None,
                "has_authority": False,
                "can_submit": True,
                "can_approve": False,
                "department": None,
                "awaiting": 0,
            }

        customer = PortalService._resolve_customer(customer)
        rights = approval.rights_of(customer)

        return {
            "customer": customer,
            "has_authority": approval.has_approvers(customer),
            # our own team raises on a customer's behalf and answers to no customer matrix
            "can_submit": bool(rights.get("can_submit")) or permissions.is_internal(),
            "can_approve": bool(rights.get("can_approve")),
            "department": rights.get("department"),
            "awaiting": frappe.db.count(
                "MSP Request",
                {"customer": customer, "status": "Awaiting Customer Approval"},
            )
            if rights.get("can_approve")
            else 0,
        }

    @staticmethod
    def approve_request(name=None, reason=None):
        """The customer's own accord, which is what sends the request to Nexgen."""
        return PortalService._decide(name, approve=True, reason=reason)

    @staticmethod
    def reject_request(name=None, reason=None):
        """Refused inside the company: it stops here and never reaches Nexgen."""
        return PortalService._decide(name, approve=False, reason=reason)

    @staticmethod
    def _decide(name, approve, reason=None):
        if not name or not frappe.db.exists("MSP Request", name):
            raise NotFoundError(f"Request {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Request", name)

        # a portal caller only ever sees their own company; this makes it explicit
        PortalService._resolve_customer(doc.customer)

        if doc.status != "Awaiting Customer Approval":
            raise ValidationError(
                f"This request is {doc.status.lower()} and is no longer waiting for an accord.",
                "INVALID_TRANSITION",
            )

        rights = approval.rights_of(doc.customer)

        if not rights.get("can_approve"):
            raise ValidationError(
                "You are not allowed to approve requests for this company.",
                "PERMISSION_DENIED",
                403,
            )

        # an approver limited to a department decides for that department only — for every
        # line, whether it names a person, a machine they hold, or somebody not yet created
        for row in doc.lines:
            if not approval.covers_line(rights, row):
                raise ValidationError(
                    "This request also contains people outside your approval scope.",
                    "PERMISSION_DENIED",
                    403,
                )

        reason = (reason or "").strip()

        if not approve and not reason:
            raise ValidationError("A reason is required to refuse.", "VALIDATION_ERROR")

        doc.status = "Submitted" if approve else "Rejected"

        # a request the company itself turned down never reached us, and must not appear in
        # our queue as though we had refused it
        if not approve:
            doc.refused_by_customer = 1
        doc.customer_approved_by = frappe.session.user
        doc.customer_approved_at = frappe.utils.now()

        if reason:
            doc.rejection_reason = reason

        doc.save(ignore_permissions=True)
        doc.add_comment(
            "Comment",
            f"{'Approved' if approve else 'Refused'} by {frappe.session.user}"
            + (f": {reason}" if reason else ""),
        )
        frappe.db.commit()

        PortalService._tell_requester(doc, approve, reason)

        # approved, so it is ours now: whoever will carry it out has to hear of it
        if approve:
            PortalService._tell_our_team(doc)

        return PortalService.get_request(doc.name)

    @staticmethod
    def _our_team():
        """Every enabled Nexgen account that may act on a request."""
        return frappe.db.sql_list(
            """
            select distinct u.name
            from `tabUser` u
            join `tabHas Role` r on r.parent = u.name and r.parenttype = 'User'
            where u.enabled = 1
              and u.name not in ('Administrator', 'Guest')
              and r.role in %(roles)s
            """,
            {"roles": permissions.INTERNAL_ROLES},
        )

    @staticmethod
    def _approvers_of(doc):
        """The accounts that may approve this request, leaving out whoever raised it."""
        authority = approval.authority_for(doc.customer)

        if not authority:
            return []

        # the matrix names accounts now: the address is the account itself
        return [
            row.user
            for row in authority.approvers
            if row.can_approve and row.user and row.user != doc.requester
        ]

    @staticmethod
    def _ask_for_approval(doc):
        """Tell the people who can decide that something is waiting for them."""
        from nexgen_msp.utils import notifications

        if not approval.authority_for(doc.customer):
            approval.warn_admins_of_gaps(doc.customer, request=doc.name)
            return

        recipients = PortalService._approvers_of(doc)

        if not recipients:
            # waiting on an accord nobody can give: our administrators hear of it
            approval.warn_admins_of_gaps(doc.customer, request=doc.name)
            return

        notifications.send(
            "MSP Request Awaiting Approval",
            recipients,
            {
                "full_name": "",
                "request": doc.name,
                "customer": doc.customer,
                "raised_by": frappe.db.get_value("User", doc.requester, "full_name")
                or doc.requester,
                "summary": notifications.summary_table(
                    [
                        ("Request", doc.name),
                        ("Services requested", str(len(doc.lines))),
                        ("Raised on", frappe.utils.format_datetime(doc.creation)),
                    ]
                ),
                "link": notifications.portal_url(f"/requests/{doc.name}"),
            },
            reference_doctype="MSP Request",
            reference_name=doc.name,
        )

    @staticmethod
    def _tell_requester(doc, approve, reason):
        from nexgen_msp.utils import notifications

        if doc.requester == frappe.session.user:
            return

        approver = frappe.utils.get_fullname(frappe.session.user)

        if approve:
            notifications.send(
                "MSP Request Approved By Customer",
                [doc.requester],
                {
                    "full_name": frappe.db.get_value("User", doc.requester, "full_name")
                    or doc.requester,
                    "request": doc.name,
                    "approver": approver,
                    "summary": notifications.summary_table(
                        [("Request", doc.name), ("Approved by", approver)]
                    ),
                    "link": notifications.portal_url(f"/requests/{doc.name}"),
                },
                reference_doctype="MSP Request",
                reference_name=doc.name,
            )
            return

        notifications.send(
            "MSP Request Decision",
            [doc.requester],
            {
                "full_name": frappe.db.get_value("User", doc.requester, "full_name")
                or doc.requester,
                "request": doc.name,
                "outcome": "refused",
                "headline": f"{approver} did not approve this request.",
                "summary": notifications.summary_table(
                    [("Request", doc.name), ("Refused by", approver)]
                ),
                "reason_block": f"<p>{frappe.utils.escape_html(reason)}</p>" if reason else "",
                "link": notifications.portal_url(f"/requests/{doc.name}"),
            },
            reference_doctype="MSP Request",
            reference_name=doc.name,
        )

    @staticmethod
    def _guard_may_submit(customer):
        """Refuse a request from anyone the matrix does not name with the right to raise one.

        Not being in the matrix is not a quiet yes: an account nobody has decided about may
        look at the portal, and nothing more.
        """
        if permissions.is_internal():
            return

        if not approval.may("can_submit", customer):
            raise ValidationError(
                "You are not allowed to raise requests for this company.",
                "PERMISSION_DENIED",
                403,
            )

    @staticmethod
    def _opening_status(customer, rows=None):
        """Where a new request starts, and who has already agreed to it.

        A request from the customer's side reaches Nexgen only once someone holding the
        right to approve has agreed to it. Whether anyone at that company holds the right
        yet changes nothing about the rule: without it the request waits inside the company,
        and the page says so, rather than slipping through to our team.

        Someone who may both raise and approve does both in one gesture — the request is
        agreed the moment they open it, and the accord is recorded in their name.
        """
        if permissions.is_internal():
            return "Submitted", None

        rights = approval.rights_of(customer)

        if rights.get("can_approve"):
            # a Department approver's accord does not cover a request reaching several of them
            if rights.get("department") and approval.reaches_several_departments(rows or []):
                return "Awaiting Customer Approval", None

            return "Submitted", frappe.session.user

        return "Awaiting Customer Approval", None

    @staticmethod
    def list_catalogue(customer=None):
        """Only what the customer's live contracts cover today — they cannot order the rest.

        A contract that starts next year offers nothing yet, and one whose dates are over
        offers nothing any more. Whether a contract exists at all is reported alongside, so
        an empty list can say why it is empty instead of looking like a fault.
        """
        customer = PortalService._resolve_customer(customer)

        covered = frappe.db.sql_list(
            """
            select distinct cs.service_item
            from `tabMSP Contract` c
            join `tabMSP Contract Service` cs on cs.parent = c.name
            where c.customer = %(customer)s and c.status in ('Active', 'Suspended')
              and c.start_date <= %(today)s and ifnull(c.end_date, '9999-12-31') >= %(today)s
            """,
            {"customer": customer, "today": frappe.utils.today()},
        )

        has_contract = bool(
            frappe.db.exists(
                "MSP Contract", {"customer": customer, "status": ["in", ("Active", "Suspended")]}
            )
        )

        if not covered:
            return {"items": [], "count": 0, "has_contract": has_contract}

        items = [
            {**row, "scope": row.pop("service_scope", None) or "Both"}
            for row in ServiceDefinitionService.available_rows()
            if row["name"] in covered
        ]

        return {"items": items, "count": len(items), "has_contract": has_contract}

    @staticmethod
    def list_users_with_services(customer=None, search=None, status=None, start=0, page_length=20):
        customer = PortalService._resolve_customer(customer)

        start = max(0, frappe.utils.cint(start))
        page_length = min(MAX_PAGE_LENGTH, max(1, frappe.utils.cint(page_length) or 20))

        conditions = ["cu.customer = %(customer)s"]
        values = {"customer": customer, "start": start, "page_length": page_length}

        if status:
            conditions.append("cu.lifecycle_status = %(status)s")
            values["status"] = status

        if search:
            conditions.append(
                "(cu.full_name like %(search)s or cu.username like %(search)s"
                " or cu.email like %(search)s)"
            )
            values["search"] = f"%{search}%"

        where = " and ".join(conditions)

        base_from = """
            from `tabMSP Client User` cu
            left join `tabMSP Managed Device` d
                on d.assigned_client_user = cu.name and d.status = 'Active'
            left join `tabMSP Service Assignment` sa
                on (sa.client_user = cu.name or sa.managed_device = d.name)
                and sa.operational_status in ('Pending Setup', 'Active', 'Suspended')
        """

        rows = frappe.db.sql(
            f"""
            select
                cu.name as name,
                cu.full_name as full_name,
                cu.department as department,
                cu.email as email,
                cu.lifecycle_status as lifecycle_status,
                cu.start_date as start_date,
                max(d.hostname) as hostname,
                max(d.device_type) as device_type,
                count(distinct sa.name) as service_count
            {base_from}
            where {where}
            group by cu.name
            order by count(distinct sa.name) desc, cu.full_name asc
            limit %(page_length)s offset %(start)s
            """,
            values,
            as_dict=True,
        )

        counted = frappe.db.sql(
            f"select count(distinct cu.name) from `tabMSP Client User` cu where {where}", values
        )
        total = counted[0][0] if counted else 0

        return {
            "rows": rows,
            "start": start,
            "page_length": page_length,
            "total": total,
            "has_more": start + len(rows) < total,
        }

    @staticmethod
    def list_subscribed_services(customer=None):
        customer = PortalService._resolve_customer(customer)

        rows = frappe.db.sql(
            """
            select
                sa.service_item as service_item,
                coalesce(i.item_name, sa.service_item) as item_name,
                sa.assignment_scope as assignment_scope,
                count(*) as total,
                cast(sum(case when sa.operational_status = 'Active' then 1 else 0 end) as unsigned) as active,
                cast(sum(case when sa.operational_status in ('Ended', 'Cancelled') then 1 else 0 end) as unsigned) as ended
            from `tabMSP Service Assignment` sa
            left join `tabItem` i on i.name = sa.service_item
            where sa.customer = %s
            group by sa.service_item, i.item_name, sa.assignment_scope
            order by count(*) desc
            """,
            (customer,),
            as_dict=True,
        )

        return {"services": rows, "count": len(rows)}

    @staticmethod
    def service_portfolio(customer=None):
        """Every service this company can ask for, already runs, or ever ran.

        A service used in the past stays on the list even when the contract no longer covers
        it and every assignment has ended: it is part of what this company has had. What can
        be asked for today is said separately, as availability.
        """
        customer = PortalService._resolve_customer(customer)
        today = frappe.utils.today()

        covered = set(
            frappe.db.sql_list(
                """
                select distinct cs.service_item
                from `tabMSP Contract` c
                join `tabMSP Contract Service` cs on cs.parent = c.name
                where c.customer = %(customer)s and c.status in ('Active', 'Suspended')
                  and c.start_date <= %(today)s and ifnull(c.end_date, '9999-12-31') >= %(today)s
                """,
                {"customer": customer, "today": today},
            )
        )

        counted = frappe.db.sql(
            """
            select
                sa.service_item,
                cast(sum(sa.operational_status = 'Active') as unsigned) as active,
                cast(sum(sa.operational_status = 'Suspended') as unsigned) as suspended,
                cast(sum(sa.operational_status = 'Pending Setup') as unsigned) as pending_setup,
                cast(sum(sa.operational_status = 'Ended') as unsigned) as ended,
                cast(sum(sa.operational_status = 'Cancelled') as unsigned) as cancelled,
                cast(count(*) as unsigned) as total
            from `tabMSP Service Assignment` sa
            where sa.customer = %(customer)s and sa.operational_status != 'Draft'
            group by sa.service_item
            """,
            {"customer": customer},
            as_dict=True,
        )
        history = {row.service_item: row for row in counted}

        ready = set(ServiceDefinitionService.available_items())
        labels = ServiceDefinitionService.labels_by_item(sorted(covered | set(history)))
        rows = []

        for service in sorted(covered | set(history)):
            counts = history.get(service)
            in_contract = service in covered

            if in_contract and service in ready:
                availability = "Available to request"
            elif in_contract:
                availability = "Temporarily unavailable"
            else:
                availability = "History only"

            rows.append(
                {
                    "service_item": service,
                    "service_name": labels.get(service, service),
                    "scope": ServiceDefinitionService.scope_of(service),
                    "availability": availability,
                    "active": frappe.utils.cint(counts.active) if counts else 0,
                    "suspended": frappe.utils.cint(counts.suspended) if counts else 0,
                    "pending_setup": frappe.utils.cint(counts.pending_setup) if counts else 0,
                    "ended": frappe.utils.cint(counts.ended) if counts else 0,
                    "cancelled": frappe.utils.cint(counts.cancelled) if counts else 0,
                    "total": frappe.utils.cint(counts.total) if counts else 0,
                }
            )

        return {
            "rows": rows,
            "count": len(rows),
            "has_contract": bool(
                frappe.db.exists(
                    "MSP Contract", {"customer": customer, "status": ["in", ("Active", "Suspended")]}
                )
            ),
        }

    @staticmethod
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
        """Every service line the customer holds, on one axis or all of them."""
        customer = PortalService._resolve_customer(customer)

        start = max(0, frappe.utils.cint(start))
        page_length = min(MAX_PAGE_LENGTH, max(1, frappe.utils.cint(page_length) or 20))

        conditions = ["sa.customer = %(customer)s"]
        values = {
            "customer": customer,
            "start": start,
            "page_length": page_length,
        }

        if service_item:
            conditions.append("sa.service_item = %(service_item)s")
            values["service_item"] = service_item

        if status:
            conditions.append("sa.operational_status = %(status)s")
            values["status"] = status

        if department:
            conditions.append("coalesce(cu.department, dcu.department) = %(department)s")
            values["department"] = department

        if user_status:
            conditions.append("coalesce(cu.lifecycle_status, dcu.lifecycle_status) = %(user_status)s")
            values["user_status"] = user_status

        billed = """
            (
                select max(br.billing_period_end)
                from `tabMSP Billing Run Line` brl
                join `tabMSP Billing Run` br on br.name = brl.parent
                where brl.service_assignment = sa.name and br.docstatus = 1
            )
        """

        if last_billed_after:
            conditions.append(f"{billed} >= %(last_billed_after)s")
            values["last_billed_after"] = last_billed_after

        if last_billed_before:
            conditions.append(f"{billed} <= %(last_billed_before)s")
            values["last_billed_before"] = last_billed_before

        if search:
            conditions.append(
                "(cu.full_name like %(search)s or dcu.full_name like %(search)s"
                " or cu.username like %(search)s or dcu.username like %(search)s"
                " or d.hostname like %(search)s or d.serial_number like %(search)s"
                " or own.hostname like %(search)s or own.serial_number like %(search)s)"
            )
            values["search"] = f"%{search}%"

        where = " and ".join(conditions)

        base_from = """
            from `tabMSP Service Assignment` sa
            left join `tabMSP Client User` cu on cu.name = sa.client_user
            left join `tabMSP Managed Device` d on d.name = sa.managed_device
            left join `tabMSP Managed Device` own on own.assigned_client_user = sa.client_user
                and own.status = 'Active'
            left join `tabMSP Client User` dcu on dcu.name = d.assigned_client_user
            left join `tabItem` item on item.name = sa.service_item
        """

        rows = frappe.db.sql(
            f"""
            select
                sa.name as name,
                sa.client_user as client_user,
                coalesce(cu.full_name, dcu.full_name) as user_name,
                coalesce(cu.department, dcu.department) as department,
                coalesce(cu.email, dcu.email) as email,
                coalesce(cu.lifecycle_status, dcu.lifecycle_status) as user_status,
                coalesce(d.hostname, own.hostname) as hostname,
                coalesce(sa.managed_device, own.name) as device,
                sa.quantity as quantity,
                sa.uom as uom,
                sa.operational_status as operational_status,
                sa.billing_status as billing_status,
                sa.effective_start_date as effective_start_date,
                sa.effective_end_date as effective_end_date,
                sa.service_item as service_item,
                coalesce(item.item_name, sa.service_item) as service_name,
                {billed} as last_billed_on
            {base_from}
            where {where}
            group by sa.name
            order by coalesce(cu.full_name, dcu.full_name, d.hostname) asc
            limit %(page_length)s offset %(start)s
            """,
            values,
            as_dict=True,
        )

        counted = frappe.db.sql(
            f"select count(distinct sa.name) {base_from} where {where}", values
        )
        total = counted[0][0] if counted else 0

        return {
            "rows": rows,
            "start": start,
            "page_length": page_length,
            "total": total,
            "has_more": start + len(rows) < total,
        }

    @staticmethod
    def _resolve_customer(customer=None):
        """Which company this call is acting for, decided by the access policy.

        Left unsaid, it is filled in only when the account can reach exactly one. Somebody
        who is a contact at two companies has to say which: choosing whichever sorts first
        would quietly act on the wrong one.
        """
        from nexgen_msp.utils import access

        return access.resolve_customer(customer)

    @staticmethod
    def _base_filters(customer=None):
        return {"customer": PortalService._resolve_customer(customer)}

    @staticmethod
    def _paginated(doctype, fields, filters, search, search_fields, start, page_length):
        start = max(0, frappe.utils.cint(start))
        page_length = min(MAX_PAGE_LENGTH, max(1, frappe.utils.cint(page_length) or 20))

        or_filters = None
        if search:
            or_filters = [[field, "like", f"%{search}%"] for field in search_fields]

        # Permission and customer scope were already proved by ``_base_filters`` before
        # reaching this helper. Customer accounts deliberately have no generic DocType
        # access, so this service performs its own constrained query explicitly.
        rows = frappe.get_all(
            doctype,
            filters=filters,
            or_filters=or_filters,
            fields=fields,
            limit_start=start,
            limit_page_length=page_length,
            order_by="creation desc",
        )

        counted = frappe.get_all(
            doctype,
            filters=filters,
            or_filters=or_filters,
            fields=[{"COUNT": "*"}],
            as_list=True,
        )
        total = counted[0][0] if counted else 0

        return {
            "rows": rows,
            "start": start,
            "page_length": page_length,
            "total": total,
            "has_more": start + len(rows) < total,
        }


    @staticmethod
    def list_billing(customer=None):
        """Every invoiced period this customer can review."""
        PortalService._guard_invoices()
        customer = PortalService._resolve_customer(customer)

        return frappe.db.sql(
            """
            select
                br.name, br.billing_period_start, br.billing_period_end,
                br.total_amount, br.currency, br.sales_invoice,
                br.adjustment_of, br.approved_at,
                br.disputed, br.dispute_reason, br.disputed_on,
                si.status as invoice_status, si.docstatus as invoice_docstatus,
                si.posting_date,
                (select count(*) from `tabMSP Billing Run Line` brl
                    where brl.parent = br.name and (brl.exception_code is null or brl.exception_code = ''))
                    as line_count
            from `tabMSP Billing Run` br
            left join `tabSales Invoice` si on si.name = br.sales_invoice
            where br.customer = %(customer)s
              and br.status = 'Invoiced'
            order by br.billing_period_end desc
            """,
            {"customer": customer},
            as_dict=True,
        )

    @staticmethod
    def get_billing_detail(name=None):
        """What is behind an invoice: who, on which machine, and over which period."""
        PortalService._guard_invoices()

        if not name:
            raise ValidationError("name is required.", "VALIDATION_ERROR")

        run = frappe.db.get_value(
            "MSP Billing Run",
            name,
            [
                "name",
                "customer",
                "status",
                "billing_period_start",
                "billing_period_end",
                "total_amount",
                "currency",
                "sales_invoice",
                "adjustment_of",
                "disputed",
                "dispute_reason",
                "disputed_on",
                "dispute_request",
            ],
            as_dict=True,
        )

        if not run:
            raise NotFoundError(f"Billing Run {name} does not exist.", "NOT_FOUND")

        PortalService._resolve_customer(run.customer)

        if run.status != "Invoiced":
            raise ValidationError(
                "This period has not been invoiced yet.", "PERMISSION_DENIED", 403
            )

        rows = frappe.db.sql(
            """
            select
                brl.service_item,
                coalesce(brl.service_name_snapshot, item.item_name, brl.service_item)
                    as service_name,
                coalesce(brl.user_name_snapshot, legacy_user.full_name) as user_name,
                coalesce(brl.department_snapshot, legacy_user.department) as department,
                coalesce(brl.hostname_snapshot, legacy_device.hostname) as hostname,
                coalesce(brl.serial_snapshot, legacy_device.serial_number) as serial_number,
                coalesce(brl.device_type_snapshot, legacy_device.device_type) as device_type,
                brl.holder_context_snapshot as holder_context,
                brl.quantity, brl.billable_days, brl.period_days, brl.billable_months,
                brl.unit_rate, brl.amount, brl.proration_method,
                sa.effective_start_date, sa.effective_end_date
            from `tabMSP Billing Run Line` brl
            left join `tabItem` item on item.name = brl.service_item
            -- These joins are only fallbacks for billing lines created before snapshots.
            left join `tabMSP Client User` legacy_user on legacy_user.name = brl.client_user
            left join `tabMSP Managed Device` legacy_device
                on legacy_device.name = brl.managed_device
            left join `tabMSP Service Assignment` sa on sa.name = brl.service_assignment
            where brl.parent = %(parent)s
              and (brl.exception_code is null or brl.exception_code = '')
            order by service_name asc, user_name asc
            """,
            {"parent": name},
            as_dict=True,
        )

        groups = {}

        for row in rows:
            bucket = groups.setdefault(
                row.service_name,
                {
                    "service_name": row.service_name,
                    "lines": [],
                    "quantity": 0,
                    "months": 0.0,
                    "amount": 0.0,
                },
            )
            bucket["lines"].append(
                {
                    "user_name": row.user_name,
                    "department": row.department,
                    "hostname": row.hostname,
                    "serial_number": row.serial_number,
                    "device_type": row.device_type,
                    "holder_context": row.holder_context,
                    "started_on": row.effective_start_date,
                    "stopped_on": row.effective_end_date,
                    "state": "Ended" if row.effective_end_date else "Active",
                    "billable_days": row.billable_days,
                    "period_days": row.period_days,
                    "billable_months": row.billable_months,
                    "unit_rate": row.unit_rate,
                    "amount": row.amount,
                }
            )
            bucket["quantity"] += 1
            bucket["months"] += frappe.utils.flt(row.billable_months)
            bucket["amount"] += frappe.utils.flt(row.amount)

        invoice = (
            frappe.db.get_value(
                "Sales Invoice",
                run.sales_invoice,
                ["name", "posting_date", "grand_total", "status", "docstatus"],
                as_dict=True,
            )
            if run.sales_invoice
            else None
        )

        window = PortalService._dispute_window(invoice)

        return {
            "run": run,
            "invoice": invoice,
            "services": sorted(groups.values(), key=lambda group: group["service_name"]),
            "line_count": len(rows),
            "dispute_window": window,
            "can_dispute": bool(window["open"]) and not run.disputed,
            "dispute_outcome": PortalService._dispute_outcome(run),
        }

    @staticmethod
    def _dispute_outcome(run):
        """What came of a dispute, for the customer who raised it.

        Settling clears the flag, so without this the whole episode disappears from the invoice
        the moment it is answered: the customer is left with an invoice that never says it was
        argued with, nor what we replied.
        """
        if not run.get("dispute_request"):
            return None

        request = frappe.db.get_value(
            "MSP Request",
            run.dispute_request,
            ["name", "status", "rejection_reason"],
            as_dict=True,
        )

        if not request:
            return None

        return {
            "request": request.name,
            "settled": bool(not run.disputed and request.status == "Completed"),
            "note": request.rejection_reason,
        }

    @staticmethod
    def _dispute_window(invoice):
        """When the right to contest an invoice runs out, counted from its own date.

        The clock starts on the invoice date rather than the day it was drafted, which is
        the date the customer sees and the only one they can check against.
        """
        from nexgen_msp.api.internal.services.settings_service import SettingsService

        days = SettingsService.dispute_window()

        if not invoice or not invoice.get("posting_date"):
            return {"days": days, "closes_on": None, "open": True}

        closes_on = frappe.utils.add_days(frappe.utils.getdate(invoice["posting_date"]), days)

        return {
            "days": days,
            "closes_on": closes_on,
            "open": frappe.utils.getdate() <= closes_on,
        }

    @staticmethod
    def _guard_invoices():
        """Who may come near the money on this door.

        A customer contact, unless their company put them on the role that leaves the
        invoices out. Of our own people, only an administrator: a technician has no billing
        screen internally either, and this door must not become the way around that.
        """
        if permissions.is_internal():
            if not set(frappe.get_roles()).intersection(permissions.MANAGE_ACCESS_ROLES):
                raise ValidationError(
                    "Billing is not part of your access.", "PERMISSION_DENIED", 403
                )

            return

        if not permissions.may_see_invoices():
            raise ValidationError(
                "Invoices are not part of your access.", "PERMISSION_DENIED", 403
            )

    @staticmethod
    def _billing_run_for_customer(name):
        """Resolve a run the caller is actually entitled to see, or refuse."""
        PortalService._guard_invoices()

        if not name:
            raise ValidationError("name is required.", "VALIDATION_ERROR")

        run = frappe.db.get_value(
            "MSP Billing Run", name, ["name", "customer", "status", "sales_invoice"], as_dict=True
        )

        if not run:
            raise NotFoundError(f"Billing Run {name} does not exist.", "NOT_FOUND")

        PortalService._resolve_customer(run.customer)

        if run.status != "Invoiced":
            raise ValidationError("This period has not been invoiced yet.", "PERMISSION_DENIED", 403)

        return run

    @staticmethod
    def download_invoice(name=None):
        """The printed invoice for a period, as a PDF the customer can save."""
        run = PortalService._billing_run_for_customer(name)

        if not run.sales_invoice:
            raise NotFoundError("This period has no invoice document.", "NOT_FOUND")

        from nexgen_msp.utils import invoice_pdf

        # _billing_run_for_customer has already proved this invoice is theirs
        invoice_pdf.respond(run.sales_invoice, elevated=True)

    @staticmethod
    def download_breakdown(name=None):
        """The supporting detail behind the invoice, as a spreadsheet.

        Built under an administrator like the PDF is: the figures are read across Billing
        Run, Sales Invoice and Service Assignment, none of which a portal contact may open.
        _billing_run_for_customer has already proved the run is theirs.
        """
        from nexgen_msp.api.internal.services.billing_service import BillingService
        from nexgen_msp.utils.billing_export import breakdown_workbook

        run = PortalService._billing_run_for_customer(name)

        asking = frappe.session.user

        try:
            frappe.set_user("Administrator")
            data = BillingService.breakdown(run.name, guard=False)
            content = breakdown_workbook(data)
        finally:
            frappe.set_user(asking)

        frappe.local.response.filename = (
            f"Breakdown-{data['customer']}-{data['period_label']}.xlsx".replace(" ", "-")
        )
        frappe.local.response.filecontent = content
        frappe.local.response.type = "download"

    @staticmethod
    def report_filter_options(customer=None):
        """The axes the report table can be narrowed on, for this customer alone."""
        customer = PortalService._resolve_customer(customer)

        return {
            "services": frappe.db.sql(
                """
                select distinct sa.service_item as value,
                       coalesce(item.item_name, sa.service_item) as label
                from `tabMSP Service Assignment` sa
                left join `tabItem` item on item.name = sa.service_item
                where sa.customer = %(customer)s
                order by label asc
                """,
                {"customer": customer},
                as_dict=True,
            ),
            "statuses": frappe.db.sql_list(
                """
                select distinct operational_status from `tabMSP Service Assignment`
                where customer = %(customer)s and operational_status is not null
                order by operational_status asc
                """,
                {"customer": customer},
            ),
            "departments": frappe.db.sql_list(
                """
                select distinct department from `tabMSP Client User`
                where customer = %(customer)s and department is not null and department != ''
                order by department asc
                """,
                {"customer": customer},
            ),
            "user_statuses": frappe.db.sql_list(
                """
                select distinct lifecycle_status from `tabMSP Client User`
                where customer = %(customer)s and lifecycle_status is not null
                order by lifecycle_status asc
                """,
                {"customer": customer},
            ),
        }

    @staticmethod
    def dispute_invoice(name=None, reason=None):
        """Raise a dispute on an issued invoice, and tell the team about it.

        Nothing is reversed here: the invoice stands until someone reviews it and decides
        whether a credit note is due.
        """
        from nexgen_msp.utils import notifications

        if not reason or not str(reason).strip():
            raise ValidationError(
                "Tell us what is wrong with this invoice.", "VALIDATION_ERROR"
            )

        run = PortalService._billing_run_for_customer(name)
        doc = frappe.get_doc("MSP Billing Run", run.name)

        if doc.disputed:
            raise ValidationError(
                "This invoice has already been disputed and is being reviewed.",
                "INVALID_TRANSITION",
            )

        invoice = (
            frappe.db.get_value(
                "Sales Invoice", doc.sales_invoice, ["posting_date"], as_dict=True
            )
            if doc.sales_invoice
            else None
        )
        window = PortalService._dispute_window(invoice)

        if not window["open"]:
            raise ValidationError(
                f"This invoice could be contested until {window['closes_on']}, "
                f"{window['days']} days after its date. Raise a request instead.",
                "INVALID_TRANSITION",
            )

        # a dispute travels as a request, so it lands in the same queue as everything else
        request = frappe.get_doc(
            {
                "doctype": "MSP Request",
                "customer": doc.customer,
                "request_type": "Billing Dispute",
                "priority": "High",
                "source": "Portal",
                "status": "Submitted",
                "requester": frappe.session.user,
                "billing_run": doc.name,
            }
        ).insert(ignore_permissions=True)

        doc.db_set("disputed", 1)
        doc.db_set("dispute_reason", reason)
        doc.db_set("disputed_on", frappe.utils.now())
        doc.db_set("disputed_by", frappe.session.user)
        doc.db_set("dispute_request", request.name)
        frappe.db.commit()

        period = frappe.utils.formatdate(doc.billing_period_end, "MMMM yyyy")
        context = {
            "customer": doc.customer,
            "invoice": doc.sales_invoice or doc.name,
            "period": period,
            "reason": reason,
            "request": request.name,
        }

        admins = frappe.db.sql_list(
            """
            select distinct u.name
            from `tabHas Role` r
            join `tabUser` u on u.name = r.parent
            where r.role = 'MSP System Admin' and u.enabled = 1
            """
        )

        if admins:
            notifications.send(
                "MSP Invoice Disputed",
                admins,
                {**context, "link": f"/msp/requests/{request.name}"},
                reference_doctype="MSP Billing Run",
                reference_name=doc.name,
            )

        notifications.send(
            "MSP Dispute Acknowledged",
            [frappe.session.user],
            {
                **context,
                "full_name": frappe.db.get_value("User", frappe.session.user, "full_name") or "there",
                "link": notifications.portal_url(f"/invoices/{doc.name}"),
            },
            reference_doctype="MSP Billing Run",
            reference_name=doc.name,
        )

        return {"disputed": True, "run": doc.name}

    @staticmethod
    def recent_activity(customer=None, limit=12):
        """What actually happened lately: joiners, leavers, machines, requests, invoices.

        Each source is capped on its own before the merge, so one noisy month of one kind
        cannot crowd the others out of the feed.
        """
        customer = PortalService._resolve_customer(customer)
        limit = min(50, max(1, frappe.utils.cint(limit) or 12))
        per_source = limit

        params = {"customer": customer, "cap": per_source}
        events = []

        def collect(kind, rows, title, detail, link=None):
            for row in rows:
                events.append(
                    {
                        "kind": kind,
                        "on": row.get("on"),
                        "title": title(row),
                        "detail": detail(row),
                        "link": link(row) if link else None,
                    }
                )

        invoices = frappe.db.sql(
            """
            select br.name, br.total_amount, br.currency, br.sales_invoice,
                   br.billing_period_start, br.billing_period_end, br.credit_note_of,
                   br.disputed, br.modified as `on`
            from `tabMSP Billing Run` br
            where br.customer = %(customer)s and br.status = 'Invoiced'
            order by br.modified desc limit %(cap)s
            """,
            params,
            as_dict=True,
        )

        for row in invoices:
            events.append(
                {
                    "kind": "credit_note" if row.credit_note_of else "invoice",
                    "on": row.get("on"),
                    "title": (
                        f"Credit note {row.sales_invoice or row.name} issued"
                        if row.credit_note_of
                        else f"Invoice {row.sales_invoice or row.name} issued"
                    ),
                    "detail": (
                        f"{frappe.utils.fmt_money(abs(row.total_amount or 0), currency=row.currency)}"
                        f" for {row.billing_period_start} → {row.billing_period_end}"
                        + (" · disputed" if row.disputed else "")
                    ),
                    "link": f"/invoices/{row.name}",
                }
            )

        collect(
            "request",
            frappe.db.sql(
                """
                select name, request_type, status, modified as `on`
                from `tabMSP Request`
                where customer = %(customer)s
                order by modified desc limit %(cap)s
                """,
                params,
                as_dict=True,
            ),
            lambda row: f"Request {row.name} is {row.status.lower()}",
            lambda row: f"{row.request_type} request",
            lambda row: f"/requests/{row.name}",
        )

        collect(
            "user",
            frappe.db.sql(
                """
                select name, full_name, department, start_date, creation as `on`
                from `tabMSP Client User`
                where customer = %(customer)s
                order by creation desc limit %(cap)s
                """,
                params,
                as_dict=True,
            ),
            lambda row: f"{row.full_name} joined",
            lambda row: row.department or "No department recorded",
            lambda row: f"/users/{row.name}",
        )

        collect(
            "device",
            frappe.db.sql(
                """
                select name, hostname, device_type, creation as `on`
                from `tabMSP Managed Device`
                where customer = %(customer)s
                order by creation desc limit %(cap)s
                """,
                params,
                as_dict=True,
            ),
            lambda row: f"{row.hostname} added",
            lambda row: row.device_type or "Device",
        )

        collect(
            "service_started",
            frappe.db.sql(
                """
                select sa.name, sa.effective_start_date as `on`,
                       coalesce(item.item_name, sa.service_item) as service_name,
                       coalesce(cu.full_name, d.hostname) as holder
                from `tabMSP Service Assignment` sa
                left join `tabItem` item on item.name = sa.service_item
                left join `tabMSP Client User` cu on cu.name = sa.client_user
                left join `tabMSP Managed Device` d on d.name = sa.managed_device
                where sa.customer = %(customer)s and sa.effective_start_date is not null
                order by sa.effective_start_date desc limit %(cap)s
                """,
                params,
                as_dict=True,
            ),
            lambda row: f"{row.service_name} activated",
            lambda row: row.holder or "Unassigned",
        )

        collect(
            "service_ended",
            frappe.db.sql(
                """
                select sa.name, sa.effective_end_date as `on`,
                       coalesce(item.item_name, sa.service_item) as service_name,
                       coalesce(cu.full_name, d.hostname) as holder
                from `tabMSP Service Assignment` sa
                left join `tabItem` item on item.name = sa.service_item
                left join `tabMSP Client User` cu on cu.name = sa.client_user
                left join `tabMSP Managed Device` d on d.name = sa.managed_device
                where sa.customer = %(customer)s and sa.effective_end_date is not null
                order by sa.effective_end_date desc limit %(cap)s
                """,
                params,
                as_dict=True,
            ),
            lambda row: f"{row.service_name} ended",
            lambda row: row.holder or "Unassigned",
        )

        events = [event for event in events if event["on"]]
        events.sort(key=lambda event: str(event["on"]), reverse=True)

        return {"rows": events[:limit], "count": len(events[:limit])}

    @staticmethod
    def service_state(service_item=None, client_user=None, managed_device=None, customer=None):
        """What this service already looks like for that person or machine.

        Shown as soon as the service is picked, so nobody asks for something they have.
        """
        customer = PortalService._resolve_customer(customer)

        if not service_item:
            raise ValidationError("service_item is required.", "VALIDATION_ERROR")

        if not client_user and not managed_device:
            return {"held": False}

        conditions = ["sa.customer = %(customer)s", "sa.service_item = %(service_item)s"]
        values = {"customer": customer, "service_item": service_item}

        if client_user:
            conditions.append("sa.client_user = %(client_user)s")
            values["client_user"] = client_user
        else:
            conditions.append("sa.managed_device = %(managed_device)s")
            values["managed_device"] = managed_device

        row = frappe.db.sql(
            f"""
            select
                sa.name, sa.operational_status, sa.billing_status,
                sa.effective_start_date, sa.effective_end_date,
                (
                    select max(br.billing_period_end)
                    from `tabMSP Billing Run Line` brl
                    join `tabMSP Billing Run` br on br.name = brl.parent
                    where brl.service_assignment = sa.name and br.docstatus = 1
                ) as last_billed_on
            from `tabMSP Service Assignment` sa
            where {" and ".join(conditions)}
            order by (sa.operational_status not in ('Ended', 'Cancelled')) desc,
                     sa.effective_start_date desc
            limit 1
            """,
            values,
            as_dict=True,
        )

        if not row:
            return {"held": False}

        found = row[0]
        live = found.operational_status not in ("Ended", "Cancelled")

        return {
            "held": True,
            "live": live,
            "status": found.operational_status,
            "billing_status": found.billing_status,
            "since": found.effective_start_date,
            "until": found.effective_end_date,
            "last_billed_on": found.last_billed_on,
        }
