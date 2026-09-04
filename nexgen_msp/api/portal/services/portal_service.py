import frappe

from nexgen_msp.utils.meta import select_options

from nexgen_msp.utils.catalogue import security_item

from nexgen_msp.api.internal.services.request_service import effective_line_status
from nexgen_msp.utils import approval, permissions
from nexgen_msp.utils.errors import NotFoundError, ValidationError

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
    "is_new_user",
    "client_user",
    "new_user_full_name",
    "new_user_department",
    "needs_portal_access",
    "new_user_email",
    "new_user_username",
    "new_device_type",
    "new_device_serial",
    "managed_device",
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
HOLDER_STATUS = "coalesce(holder.lifecycle_status, device_holder.lifecycle_status)"

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
            from `tabMSP Service Request` sr
            where sr.customer = %(customer)s
              and sr.status not in ('Completed', 'Rejected', 'Cancelled')
              -- a colleague's unfinished request is not theirs to count nor to read
              and (sr.status != 'Draft' or sr.requester = %(me)s)
        """,
        "order_by": "sr.creation desc",
        "key": "sr.name",
    },
    "reclaimable_licences": {
        "title": "Licences to reclaim",
        "fields": [
            ("user_name", "User", HOLDER_NAME),
            ("service", "Service", "coalesce(item.item_name, sa.service_item)"),
            ("hostname", "Device", "device.hostname"),
            ("left_on", "User disabled on", "coalesce(holder.disabled_date, device_holder.disabled_date)"),
            ("status", "Status", "sa.operational_status"),
        ],
        "body": ASSIGNMENT_HOLDER_JOIN
        + f"""
            where sa.customer = %(customer)s
              and sa.operational_status not in ('Ended', 'Cancelled')
              and {HOLDER_STATUS} in ('Disabled', 'Archived')
        """,
        "order_by": "coalesce(holder.disabled_date, device_holder.disabled_date) desc",
        "key": "sa.name",
    },
    "unprotected_devices": {
        "title": "Unprotected devices",
        "fields": [
            ("hostname", "Device", "device.hostname"),
            ("device_type", "Type", "device.device_type"),
            ("user_name", "Assigned to", "holder.full_name"),
            ("since", "In service since", "device.assigned_date"),
            ("status", "Status", "device.status"),
        ],
        "body": """
            from `tabMSP Managed Device` device
            left join `tabMSP Client User` holder on holder.name = device.assigned_client_user
            where device.customer = %(customer)s
              and device.status = 'Active'
              and not exists (
                  select 1 from `tabMSP Service Assignment` sa
                  where sa.managed_device = device.name
                    and sa.service_item = %(security_item)s
                    and sa.operational_status not in ('Ended', 'Cancelled')
              )
        """,
        "order_by": "device.assigned_date desc, device.hostname asc",
        "key": "device.name",
    },
}


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
            "service_assignments": frappe.db.count("MSP Service Assignment", base),
            "active_services": PortalService._count_kpi("active_services", customer),
            "open_requests": PortalService._count_kpi("open_requests", customer),
            "awaiting_approval": frappe.db.count(
                "MSP Service Request",
                {**base, "status": ["in", ["Submitted", "Under Review"]]},
            ),
            "reclaimable_licences": PortalService._count_kpi("reclaimable_licences", customer),
            "unprotected_devices": PortalService._count_kpi("unprotected_devices", customer),
            "catalogue_size": frappe.db.count("Item", {"disabled": 0, "is_stock_item": 0}),
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
                "security_item": security_item(),
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
            "security_item": security_item(),
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
        """Who or what currently holds one service at this customer."""
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

        counts = frappe.db.sql(
            """
            select
                coalesce(sa.client_user, device.assigned_client_user) as person,
                sum(sa.operational_status = 'Active') as active,
                sum(sa.operational_status != 'Active') as inactive,
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

        held = {row.person: row for row in counts}

        for row in rows:
            entry = held.get(row["name"])
            row["active_services"] = int(entry.active) if entry else 0
            row["inactive_services"] = int(entry.inactive) if entry else 0
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
    def list_devices(customer=None, search=None, status=None, service=None, start=0, page_length=20):
        filters = PortalService._base_filters(customer)
        if status:
            filters["status"] = status

        if service:
            held = PortalService._holders_of(service, filters["customer"], "managed_device")
            filters["name"] = ["in", held or [""]]

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
                select name from `tabMSP Service Request`
                where customer = %(customer)s and status = 'Draft' and requester != %(me)s
                """,
                {"customer": filters["customer"], "me": frappe.session.user},
            )
            or [""],
        ]

        if request_type:
            filters["request_type"] = request_type

        return PortalService._paginated(
            "MSP Service Request", REQUEST_FIELDS, filters, search, ["name"], start, page_length
        )

    @staticmethod
    def request_filter_options(customer=None):
        """The axes the customer can narrow their own request queue on."""
        customer = PortalService._resolve_customer(customer)
        meta = frappe.get_meta("MSP Service Request")

        def select(fieldname):
            field = meta.get_field(fieldname)
            return [value for value in (field.options or "").split("\n") if value]

        return {
            "statuses": select("status"),
            "priorities": select("priority"),
            "request_types": select("request_type"),
            "used_types": frappe.db.sql_list(
                """
                select distinct request_type from `tabMSP Service Request`
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

        if not frappe.db.exists("MSP Service Request", name):
            raise NotFoundError(f"Service Request {name} does not exist.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Service Request", name)
        doc.check_permission("read")

        PortalService._resolve_customer(doc.customer)

        if doc.status == "Draft" and doc.requester != frappe.session.user:
            raise NotFoundError(f"Service Request {name} does not exist.", "NOT_FOUND")

        lines = frappe.db.sql(
            """
            select
                srl.idx, srl.action, srl.line_status, srl.rejection_reason,
                -- the raw links as well as their names: a draft is reopened from these
                srl.request_action, srl.target_scope, srl.client_user, srl.managed_device,
                srl.requested_service, srl.needs_portal_access,
                srl.is_new_user, srl.new_user_full_name, srl.new_user_department,
                srl.new_user_email, srl.new_user_username,
                srl.is_new_device, srl.new_device_label, srl.new_device_type,
                srl.new_device_serial,
                coalesce(cu.full_name, holder.full_name, srl.new_user_full_name) as user_name,
                coalesce(cu.department, holder.department, srl.new_user_department) as department,
                coalesce(item.item_name, srl.requested_service) as service_name,
                device.hostname,
                srl.requested_effective_date, srl.comment,
                sa.operational_status as service_status,
                sa.effective_start_date as service_start_date,
                sa_device.hostname as delivered_on
            from `tabMSP Service Request Line` srl
            left join `tabMSP Client User` cu on cu.name = srl.client_user
            left join `tabMSP Managed Device` device on device.name = srl.managed_device
            left join `tabMSP Client User` holder on holder.name = device.assigned_client_user
            left join `tabItem` item on item.name = srl.requested_service
            left join `tabMSP Service Assignment` sa
                on sa.source_request = srl.parent
               and sa.service_item = srl.requested_service
               and (srl.client_user is null or srl.client_user = '' or sa.client_user = srl.client_user)
            left join `tabMSP Managed Device` sa_device on sa_device.name = sa.managed_device
            where srl.parent = %(parent)s
            order by srl.idx asc
            """,
            {"parent": name},
            as_dict=True,
        )

        for line in lines:
            line["line_status"] = effective_line_status(line.get("line_status"), doc.status)

        return {
            "name": doc.name,
            "customer": doc.customer,
            "request_type": doc.request_type,
            "status": doc.status,
            "priority": doc.priority,
            "source": doc.source,
            "creation": doc.creation,
            "modified": doc.modified,
            "rejection_reason": doc.rejection_reason,
            "reviewed_on": doc.technical_approved_at,
            "can_decide": PortalService._may_decide(doc),
            "lines": lines,
        }

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

        return all(
            approval.covers(rights, row.client_user) for row in doc.lines if row.client_user
        )

    @staticmethod
    def get_user_detail(client_user=None):
        """What one of our people actually uses: services, device, dates and billing."""
        if not client_user:
            raise ValidationError("client_user is required.", "VALIDATION_ERROR")

        user = frappe.db.get_value(
            "MSP Client User",
            client_user,
            [
                "name",
                "full_name",
                "department",
                "customer",
                "lifecycle_status",
                "start_date",
                "disabled_date",
            ],
            as_dict=True,
        )

        if not user:
            raise NotFoundError(f"Client User {client_user} does not exist.", "NOT_FOUND")

        PortalService._resolve_customer(user.customer)

        devices = frappe.db.sql(
            """
            select hostname, device_type, status, assigned_date
            from `tabMSP Managed Device`
            where assigned_client_user = %(user)s
            order by field(status, 'Active') desc, hostname asc
            """,
            {"user": client_user},
            as_dict=True,
        )

        services = frappe.db.sql(
            """
            select
                coalesce(item.item_name, sa.service_item) as service_name,
                device.hostname,
                sa.operational_status,
                sa.effective_start_date,
                sa.effective_end_date,
                sa.customer_visible_notes,
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
            {"user": client_user},
            as_dict=True,
        )

        requests = frappe.db.sql(
            """
            select distinct sr.name, sr.status, sr.priority, sr.request_type, sr.creation
            from `tabMSP Service Request` sr
            join `tabMSP Service Request Line` srl on srl.parent = sr.name
            where srl.client_user = %(user)s
            order by sr.creation desc
            limit 10
            """,
            {"user": client_user},
            as_dict=True,
        )

        return {
            "user": user,
            "devices": devices,
            "services": services,
            "requests": requests,
        }

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
            reference_doctype="MSP Service Request",
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

        recipients = frappe.db.sql_list(
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

        # whoever raised it has already had their own acknowledgement
        recipients = [address for address in recipients if address != doc.requester]

        if not recipients:
            return

        summary = notifications.summary_table(
            [
                ("Request", doc.name),
                ("Customer", doc.customer),
                ("Services requested", str(len(doc.lines))),
                ("Priority", doc.priority or "Medium"),
            ]
        )

        for address in recipients:
            notifications.send(
                "MSP Request For Our Team",
                [address],
                {
                    "full_name": frappe.db.get_value("User", address, "full_name") or address,
                    "request": doc.name,
                    "customer": doc.customer,
                    "summary": summary,
                    "link": f"{frappe.utils.get_url()}/msp/requests/{doc.name}",
                },
                reference_doctype="MSP Service Request",
                reference_name=doc.name,
            )

    @staticmethod
    def _scoped_line(line, customer):
        """A device service is requested against a device; a user service against a person."""
        line = dict(line)
        service = line.get("requested_service")
        scope = frappe.db.get_value("Item", service, "msp_service_scope") or "User"
        device = line.get("managed_device")

        if line.get("is_new_device"):
            line["target_scope"] = "User"
            line["managed_device"] = None
            return line

        if line.get("is_new_user"):
            line["target_scope"] = "User"
            line["managed_device"] = None
            return line

        if scope == "Device" or (scope == "Both" and device):
            if not device:
                raise ValidationError(
                    f"{service} applies to a device — pick which one.", "VALIDATION_ERROR"
                )

            owner = frappe.db.get_value(
                "MSP Managed Device", device, ["customer", "assigned_client_user"], as_dict=True
            )

            if not owner:
                raise NotFoundError(f"Managed Device {device} not found.", "NOT_FOUND")

            if owner.customer != customer:
                raise ValidationError(
                    f"Device {device} does not belong to {customer}.", "PERMISSION_DENIED", 403
                )

            line["target_scope"] = "Device"
            line["client_user"] = None
            return line

        line["target_scope"] = "User"
        line["managed_device"] = None
        return line

    @staticmethod
    def _resolved_action(line):
        """Take the mechanical action type from the chosen action record.

        A new person can only be granted something, whatever was sent.
        """
        chosen = line.get("request_action")

        if chosen:
            action = frappe.db.get_value(
                "MSP Request Action", chosen, ["action_type", "enabled"], as_dict=True
            )

            if not action or not action.enabled:
                raise ValidationError(
                    f"'{chosen}' is not an action you can ask for.", "VALIDATION_ERROR"
                )

            line["action"] = action.action_type

        if line.get("is_new_user") and line.get("action") not in (None, "", "Add"):
            raise ValidationError(
                "A new person can only be granted a service, not have one changed or removed.",
                "VALIDATION_ERROR",
            )

        return line

    @staticmethod
    def _line_rows(lines, customer, request_type, strict=True):
        """The child rows of a request, built the same way whether it is saved or sent.

        A draft is not checked: it is a half-written page, and telling someone which machine
        they forgot is what the moment of sending is for.
        """
        lines = frappe.parse_json(lines) if isinstance(lines, str) else lines

        if not lines:
            raise ValidationError("At least one line is required.", "VALIDATION_ERROR")

        if strict:
            lines = [PortalService._scoped_line(line, customer) for line in lines]
            lines = [PortalService._resolved_action(line) for line in lines]

        return lines, [
            {
                "request_action": line.get("request_action"),
                "action": line.get("action") or request_type or "Add",
                "target_scope": line.get("target_scope") or "User",
                "is_new_user": 1 if line.get("is_new_user") else 0,
                "client_user": line.get("client_user"),
                "new_user_full_name": line.get("new_user_full_name"),
                "new_user_department": line.get("new_user_department"),
                "needs_portal_access": 1 if line.get("needs_portal_access") else 0,
                "new_user_email": line.get("new_user_email"),
                # neither is asked of the customer, but both save the technician a
                # phone call when they happen to know them
                "new_user_username": line.get("new_user_username"),
                "is_new_device": 1 if line.get("is_new_device") else 0,
                "new_device_label": line.get("new_device_label"),
                "new_device_type": line.get("new_device_type"),
                "new_device_serial": line.get("new_device_serial"),
                "managed_device": line.get("managed_device"),
                "customer_site": line.get("customer_site"),
                "requested_service": line.get("requested_service"),
                "requested_quantity": line.get("requested_quantity") or 1,
                "requested_effective_date": line.get("requested_effective_date"),
                "comment": line.get("comment"),
            }
            for line in lines
        ]

    @staticmethod
    def _own_draft(name):
        """A draft belongs to whoever started it, and to nobody else."""
        if not frappe.db.exists("MSP Service Request", name):
            raise NotFoundError(f"Service Request {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Service Request", name)

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
    def save_draft(name=None, customer=None, request_type=None, priority=None, lines=None):
        """Put a half-written request aside and come back to it.

        A draft reaches nobody: not our queue, not the approvers, not the colleagues at the
        customer. It is the author's own until they send it.
        """
        customer = PortalService._resolve_customer(customer)
        _, rows = PortalService._line_rows(lines, customer, request_type, strict=False)

        if name:
            doc = PortalService._own_draft(name)
            doc.request_type = request_type or doc.request_type
            doc.priority = priority or doc.priority
            doc.set("lines", rows)
            doc.save(ignore_permissions=True)
        else:
            doc = frappe.get_doc(
                {
                    "doctype": "MSP Service Request",
                    "customer": customer,
                    "request_type": request_type,
                    "priority": priority or "Medium",
                    "source": "Internal" if permissions.is_internal() else "Portal",
                    "status": "Draft",
                    "requester": frappe.session.user,
                    "lines": rows,
                }
            ).insert(ignore_permissions=True)

        frappe.db.commit()

        return PortalService.get_request(doc.name)

    @staticmethod
    def discard_draft(name=None):
        """Throw away a draft. Only ever a draft, and only ever the author's own."""
        doc = PortalService._own_draft(name)
        frappe.delete_doc("MSP Service Request", doc.name, force=True, ignore_permissions=True)
        frappe.db.commit()

        return {"discarded": name}

    @staticmethod
    def create_request(name=None, customer=None, request_type=None, priority=None, lines=None):
        customer = PortalService._resolve_customer(customer)

        lines, rows = PortalService._line_rows(lines, customer, request_type)

        PortalService._guard_may_submit(customer)

        opening_status, approved_by = PortalService._opening_status(customer)

        if name:
            # a draft being sent: the same document grows up rather than a second one
            doc = PortalService._own_draft(name)
            doc.request_type = request_type or doc.request_type
            doc.priority = priority or doc.priority
            doc.set("lines", rows)
            doc.status = opening_status
            doc.save(ignore_permissions=True)
        else:
            doc = frappe.get_doc(
                {
                    "doctype": "MSP Service Request",
                    "customer": customer,
                    "request_type": request_type,
                    "priority": priority or "Medium",
                    # a request opened by the team is not a request from the customer
                    "source": "Internal" if permissions.is_internal() else "Portal",
                    "status": opening_status,
                    "requester": frappe.session.user,
                    "lines": rows,
                }
            ).insert()

        PortalService._record_supplied_facts(doc)

        if approved_by:
            # raised by someone who may approve their own: the accord is theirs, recorded
            # rather than left implicit
            doc.db_set("customer_approved_by", approved_by, update_modified=False)
            doc.db_set("customer_approved_at", frappe.utils.now(), update_modified=False)

        frappe.db.commit()

        if doc.status == "Awaiting Customer Approval":
            PortalService._ask_for_approval(doc)
        else:
            PortalService._acknowledge(doc)

        return PortalService.get_request(doc.name)

    @staticmethod
    def _record_supplied_facts(doc):
        """Keep the username and serial the customer happened to know.

        Neither is asked of them, but when they do supply one for a person or a machine we
        already hold, it is a fact about that record and belongs on it — it is also what
        the technician is later refused a closure for not having.

        Only ever fills a blank: a value already on file was put there by someone who had
        the machine in their hands, and is not overwritten from a form.
        """
        for row in doc.lines:
            username = (row.new_user_username or "").strip()

            if username and row.client_user:
                held = frappe.db.get_value("MSP Client User", row.client_user, "username")
                if not (held or "").strip():
                    frappe.db.set_value("MSP Client User", row.client_user, "username", username)

            serial = (row.new_device_serial or "").strip()

            if not serial or not row.managed_device:
                continue

            held = frappe.db.get_value("MSP Managed Device", row.managed_device, "serial_number")

            if (held or "").strip():
                continue

            clash = frappe.db.get_value(
                "MSP Managed Device", {"serial_number": serial, "name": ["!=", row.managed_device]}, "hostname"
            )

            if clash:
                raise ValidationError(
                    f"Serial {serial} is already recorded against {clash}.", "VALIDATION_ERROR"
                )

            frappe.db.set_value("MSP Managed Device", row.managed_device, "serial_number", serial)

    @staticmethod
    def my_approval_rights(customer=None):
        """What the signed-in person may do, so the portal knows what to offer."""
        customer = PortalService._resolve_customer(customer)
        rights = approval.rights_of(customer)

        return {
            "customer": customer,
            "has_authority": approval.has_approvers(customer),
            "can_submit": rights.get("can_submit", True) if rights else True,
            "can_approve": bool(rights.get("can_approve")),
            "department": rights.get("department"),
            "awaiting": frappe.db.count(
                "MSP Service Request",
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
        if not name or not frappe.db.exists("MSP Service Request", name):
            raise NotFoundError(f"Service Request {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Service Request", name)

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

        # an approver limited to a department decides for that department only
        for row in doc.lines:
            if row.client_user and not approval.covers(rights, row.client_user):
                raise ValidationError(
                    "This request concerns someone outside the department you decide for.",
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

        return PortalService.get_request(doc.name)

    @staticmethod
    def _ask_for_approval(doc):
        """Tell the people who can decide that something is waiting for them."""
        from nexgen_msp.utils import notifications

        authority = approval.authority_for(doc.customer)

        if not authority:
            return

        recipients = []

        for row in authority.approvers:
            if not row.can_approve:
                continue

            # the matrix names accounts now: the address is the account itself
            if row.user and row.user != doc.requester:
                recipients.append(row.user)

        if not recipients:
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
            reference_doctype="MSP Service Request",
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
                reference_doctype="MSP Service Request",
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
            reference_doctype="MSP Service Request",
            reference_name=doc.name,
        )

    @staticmethod
    def _guard_may_submit(customer):
        """Refuse a request from someone whose line says they may not raise one.

        Only bites on people the matrix names. Anyone not in it keeps what they have always
        had, because naming someone is a deliberate act and switching the matrix on must not
        silently take the portal away from every other employee.
        """
        if permissions.is_internal():
            return

        rights = approval.rights_of(customer)

        if rights and not rights.get("can_submit"):
            raise ValidationError(
                "You are not allowed to raise requests for this company.",
                "PERMISSION_DENIED",
                403,
            )

    @staticmethod
    def _opening_status(customer):
        """Where a new request starts, and who has already agreed to it.

        Nothing changes for a customer who has named no approver: their request reaches
        Nexgen as it always did.

        Someone who may both raise and approve does both in one gesture — the request is
        agreed the moment they open it, and the accord is recorded in their name. Giving
        both rights to one person is itself the decision; there is nothing more to switch on.
        """
        if permissions.is_internal() or not approval.has_approvers(customer):
            return "Submitted", None

        if approval.may("can_approve", customer):
            return "Submitted", frappe.session.user

        return "Awaiting Customer Approval", None

    @staticmethod
    def list_catalogue(customer=None):
        """Only what the customer's live contract covers — they cannot order the rest.

        Whether a contract exists at all is reported alongside, so an empty list can say why
        it is empty instead of looking like a fault.
        """
        customer = PortalService._resolve_customer(customer)

        covered = frappe.db.sql_list(
            """
            select distinct cs.service_item
            from `tabMSP Contract` c
            join `tabMSP Contract Service` cs on cs.parent = c.name
            where c.customer = %(customer)s and c.status in ('Active', 'Suspended')
            """,
            {"customer": customer},
        )

        has_contract = bool(
            frappe.db.exists(
                "MSP Contract", {"customer": customer, "status": ["in", ("Active", "Suspended")]}
            )
        )

        if not covered:
            return {"items": [], "count": 0, "has_contract": has_contract}

        items = frappe.get_all(
            "Item",
            filters={"disabled": 0, "is_stock_item": 0, "name": ["in", covered]},
            fields=["name", "item_name", "stock_uom", "description", "msp_service_scope"],
            order_by="item_name asc",
            limit_page_length=0,
        )

        for item in items:
            item["scope"] = item.pop("msp_service_scope", None) or "User"

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
                and sa.operational_status not in ('Ended', 'Cancelled')
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
                " or d.hostname like %(search)s"
                " or own.hostname like %(search)s)"
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
                coalesce(sa.client_user, d.assigned_client_user) as client_user,
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
        allowed = permissions.get_allowed_customers()

        if not allowed:
            raise ValidationError(
                "No customer is linked to your account.", "PERMISSION_DENIED", 403
            )

        if not customer:
            # a contact has exactly one; staff serve them all, so picking the first would
            # silently act on whoever sorts first
            if permissions.is_internal():
                raise ValidationError(
                    "Say which customer you are acting for.", "VALIDATION_ERROR"
                )

            # the company on their own record, so the portal and the profile menu never
            # disagree about who the caller is working for
            profile = permissions.contact_profile(frappe.session.user, allowed)

            return profile.customer if profile and profile.customer in allowed else allowed[0]

        if customer not in allowed:
            raise ValidationError(
                f"You are not allowed to access customer {customer}.", "PERMISSION_DENIED", 403
            )

        return customer

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

        rows = frappe.get_list(
            doctype,
            filters=filters,
            or_filters=or_filters,
            fields=fields,
            limit_start=start,
            limit_page_length=page_length,
            order_by="modified desc",
        )

        counted = frappe.get_list(
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
                coalesce(item.item_name, brl.service_item) as service_name,
                coalesce(cu.full_name, dcu.full_name) as user_name,
                coalesce(cu.department, dcu.department) as department,
                device.hostname,
                device.device_type,
                brl.quantity, brl.billable_days, brl.period_days, brl.billable_months,
                brl.unit_rate, brl.amount, brl.proration_method,
                sa.effective_start_date, sa.effective_end_date
            from `tabMSP Billing Run Line` brl
            left join `tabItem` item on item.name = brl.service_item
            left join `tabMSP Client User` cu on cu.name = brl.client_user
            left join `tabMSP Managed Device` device on device.name = brl.managed_device
            left join `tabMSP Client User` dcu on dcu.name = device.assigned_client_user
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
                    "device_type": row.device_type,
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
                "doctype": "MSP Service Request",
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
                from `tabMSP Service Request`
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
    def list_request_actions(for_new_user=None):
        """The actions a customer may ask for.

        A brand new person has nothing to change, suspend or remove, so only the actions
        that grant something make sense for them.
        """
        filters = {"enabled": 1}

        if frappe.utils.cint(for_new_user):
            filters["action_type"] = "Add"

        return frappe.get_all(
            "MSP Request Action",
            filters=filters,
            fields=["name", "title", "action_type", "description"],
            order_by="action_type asc, title asc",
        )

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
