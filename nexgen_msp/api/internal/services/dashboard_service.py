import frappe


from nexgen_msp.utils.errors import ValidationError
from nexgen_msp.api.internal.services.request_service import (
    ADMIN_ROLES,
    OPEN_STATUSES,
    RequestService,
)
from nexgen_msp.utils.assignments import OPEN_ASSIGNMENT_STATUSES


ACTIONABLE_STATUSES = ("Submitted", "Under Review", "Approved", "In Progress")

ASSIGNMENT_JOIN = """
    from `tabMSP Service Assignment` sa
    left join `tabItem` item on item.name = sa.service_item
    left join `tabMSP Client User` holder on holder.name = sa.client_user
    left join `tabMSP Managed Device` device on device.name = sa.managed_device
    left join `tabMSP Client User` device_holder on device_holder.name = device.assigned_client_user
"""

HOLDER = "coalesce(holder.full_name, device_holder.full_name)"

KPI_SOURCES = {
    "reclaimable_licences": {
        "title": "Licences to reclaim",
        "description": "Services still open on users who have left. Every one of these is billed for nothing.",
        "fields": [
            ("customer", "Customer", "sa.customer"),
            ("user_name", "User", HOLDER),
            ("service", "Service", "coalesce(item.item_name, sa.service_item)"),
            ("hostname", "Device", "device.hostname"),
            ("left_on", "User disabled on", "coalesce(holder.disabled_date, device_holder.disabled_date)"),
            ("status", "Status", "sa.operational_status"),
        ],
        "body": ASSIGNMENT_JOIN
        + """
            where sa.operational_status not in ('Ended', 'Cancelled')
              and coalesce(holder.lifecycle_status, device_holder.lifecycle_status)
                  in ('Disabled', 'Archived')
        """,
        "order_by": "coalesce(holder.disabled_date, device_holder.disabled_date) desc",
        "key": "sa.name",
        "route": "concat('/msp/users/', coalesce(holder.name, device_holder.name))",
    },
    "devices_without_services": {
        "title": "Devices without services",
        "description": "Active machines with no active service.",
        "fields": [
            ("customer", "Customer", "device.customer"),
            ("hostname", "Device", "device.hostname"),
            ("device_type", "Type", "device.device_type"),
            ("user_name", "Held by", "holder.full_name"),
            ("since", "In service since", "device.assigned_date"),
            ("status", "Status", "device.status"),
        ],
        "body": """
            from `tabMSP Managed Device` device
            left join `tabMSP Client User` holder on holder.name = device.assigned_client_user
            where device.status = 'Active'
              and not exists (
                  select 1 from `tabMSP Service Assignment` sa
                  where sa.managed_device = device.name
                    and sa.operational_status in ('Pending Setup', 'Active', 'Suspended', 'Pending Removal')
              )
        """,
        "order_by": "device.customer asc, device.hostname asc",
        "key": "device.name",
        "route": "concat('/msp/devices/', device.name)",
    },
    "billable_services": {
        "title": "Billable services",
        "description": "Every assignment currently flagged as billable.",
        "fields": [
            ("customer", "Customer", "sa.customer"),
            ("user_name", "User", HOLDER),
            ("service", "Service", "coalesce(item.item_name, sa.service_item)"),
            ("hostname", "Device", "device.hostname"),
            ("since", "Since", "sa.effective_start_date"),
            ("status", "Status", "sa.operational_status"),
        ],
        "body": ASSIGNMENT_JOIN + " where sa.billing_status = 'Billable' ",
        "order_by": "sa.customer asc, sa.effective_start_date desc",
        "key": "sa.name",
        "route": "concat('/msp/users/', coalesce(holder.name, device_holder.name))",
    },
    "services_added": {
        "title": "Services started this month",
        "description": "Assignments whose service began inside the current month.",
        "fields": [
            ("customer", "Customer", "sa.customer"),
            ("user_name", "User", HOLDER),
            ("service", "Service", "coalesce(item.item_name, sa.service_item)"),
            ("hostname", "Device", "device.hostname"),
            ("since", "Started", "sa.effective_start_date"),
            ("status", "Status", "sa.operational_status"),
        ],
        "body": ASSIGNMENT_JOIN
        + """
            where sa.effective_start_date >= %(month_start)s
              and sa.operational_status != 'Cancelled'
        """,
        "order_by": "sa.effective_start_date desc",
        "key": "sa.name",
        "route": "concat('/msp/users/', coalesce(holder.name, device_holder.name))",
    },
    "services_removed": {
        "title": "Services ended this month",
        "description": "Assignments closed inside the current month.",
        "fields": [
            ("customer", "Customer", "sa.customer"),
            ("user_name", "User", HOLDER),
            ("service", "Service", "coalesce(item.item_name, sa.service_item)"),
            ("hostname", "Device", "device.hostname"),
            ("left_on", "Ended", "sa.effective_end_date"),
            ("status", "Status", "sa.operational_status"),
        ],
        "body": ASSIGNMENT_JOIN + " where sa.effective_end_date >= %(month_start)s ",
        "order_by": "sa.effective_end_date desc",
        "key": "sa.name",
        "route": "concat('/msp/users/', coalesce(holder.name, device_holder.name))",
    },
}


class DashboardService:
    @staticmethod
    def get_dashboard():
        """Operational picture for a technician; an admin gets the same plus the portfolio block."""
        RequestService._guard_internal()

        is_admin = bool(set(frappe.get_roles()).intersection(ADMIN_ROLES))

        payload = {
            "is_admin": is_admin,
            "requests": DashboardService._request_counters(),
            "queue": DashboardService._queue(),
            "pending_lines": DashboardService._pending_lines(),
            "hygiene": DashboardService._hygiene(),
        }

        if is_admin:
            payload["portfolio"] = DashboardService._portfolio()

        return payload

    @staticmethod
    def _request_counters():
        rows = frappe.db.sql(
            """
            select status, priority,
                   count(*) as total,
                   sum(timestampdiff(hour, creation, now()) > 48) as ageing
            from `tabMSP Service Request`
            -- a draft is still being written and a refused one never reached us: neither is
            -- work waiting on this team
            where status != 'Draft' and ifnull(refused_by_customer, 0) = 0
            group by status, priority
            """,
            as_dict=True,
        )

        by_status = {}
        counters = {"open": 0, "urgent_open": 0, "ageing_open": 0}

        for row in rows:
            by_status[row.status] = by_status.get(row.status, 0) + row.total

            if row.status in OPEN_STATUSES:
                counters["open"] += row.total
                counters["ageing_open"] += frappe.utils.cint(row.ageing)
                if row.priority in ("Urgent", "High"):
                    counters["urgent_open"] += row.total

        counters["awaiting_review"] = by_status.get("Submitted", 0)
        counters["under_review"] = by_status.get("Under Review", 0)
        counters["in_progress"] = by_status.get("In Progress", 0)
        counters["completed"] = by_status.get("Completed", 0)
        # the card lists requests, so it counts requests too — the lines are its caption
        counters["requests_to_execute"] = frappe.db.sql(
            """
            select count(distinct sr.name)
            from `tabMSP Service Request Line` srl
            join `tabMSP Service Request` sr on sr.name = srl.parent
            where sr.status in ('Approved', 'In Progress')
              and ifnull(sr.refused_by_customer, 0) = 0
              and srl.line_status = 'Approved'
              and not exists (
                  select 1 from `tabMSP Service Assignment` sa
                  left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                  where sa.source_request = srl.parent
                    and sa.service_item = srl.requested_service
                    and (srl.client_user is null or srl.client_user = ''
                         or sa.client_user = srl.client_user
                         or sad.assigned_client_user = srl.client_user)
              )
            """
        )[0][0]

        counters["lines_to_execute"] = frappe.db.sql(
            """
            select count(*)
            from `tabMSP Service Request Line` srl
            join `tabMSP Service Request` sr on sr.name = srl.parent
            where sr.status in ('Approved', 'In Progress')
              and ifnull(sr.refused_by_customer, 0) = 0
              and srl.line_status = 'Approved'
              and not exists (
                  select 1 from `tabMSP Service Assignment` sa
                  left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                  where sa.source_request = srl.parent
                    and sa.service_item = srl.requested_service
                    and (srl.client_user is null or srl.client_user = ''
                         or sa.client_user = srl.client_user
                         or sad.assigned_client_user = srl.client_user)
              )
            """
        )[0][0]

        return counters

    @staticmethod
    def _queue():
        return frappe.db.sql(
            """
            select
                sr.name, sr.customer, sr.request_type, sr.status, sr.priority,
                sr.creation,
                timestampdiff(hour, sr.creation, now()) as age_hours,
                (select count(*) from `tabMSP Service Request Line` srl where srl.parent = sr.name)
                    as line_count,
                (select group_concat(distinct coalesce(cu.full_name, srl.new_user_full_name)
                    order by srl.idx separator ', ')
                    from `tabMSP Service Request Line` srl
                    left join `tabMSP Client User` cu on cu.name = srl.client_user
                    where srl.parent = sr.name) as users
            from `tabMSP Service Request` sr
            where sr.status in %(statuses)s and ifnull(sr.refused_by_customer, 0) = 0
            order by field(sr.priority, 'Urgent', 'High', 'Medium', 'Low'), sr.creation asc
            limit 8
            """,
            {"statuses": ACTIONABLE_STATUSES},
            as_dict=True,
        )

    @staticmethod
    def _pending_lines():
        """The actual bench work: approved lines with no assignment behind them yet."""
        return frappe.db.sql(
            """
            select
                srl.parent as request, srl.idx, srl.action,
                sr.customer, sr.priority,
                coalesce(cu.full_name, srl.new_user_full_name) as user_name,
                coalesce(item.item_name, srl.requested_service) as service,
                device.hostname,
                srl.requested_effective_date,
                srl.comment
            from `tabMSP Service Request Line` srl
            join `tabMSP Service Request` sr on sr.name = srl.parent
            left join `tabMSP Client User` cu on cu.name = srl.client_user
            left join `tabMSP Managed Device` device on device.name = srl.managed_device
            left join `tabItem` item on item.name = srl.requested_service
            where sr.status in ('Approved', 'In Progress')
              and ifnull(sr.refused_by_customer, 0) = 0
              and srl.line_status = 'Approved'
              and not exists (
                  select 1 from `tabMSP Service Assignment` sa
                  left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                  where sa.source_request = srl.parent
                    and sa.service_item = srl.requested_service
                    and (srl.client_user is null or srl.client_user = ''
                         or sa.client_user = srl.client_user
                         or sad.assigned_client_user = srl.client_user)
              )
            order by field(sr.priority, 'Urgent', 'High', 'Medium', 'Low'),
                     srl.requested_effective_date asc
            limit 10
            """,
            as_dict=True,
        )

    @staticmethod
    def _hygiene():
        idle = frappe.db.sql(
            """
            select count(*)
            from `tabMSP Managed Device` device
            where device.status = 'Active'
              and not exists (
                  select 1 from `tabMSP Service Assignment` sa
                  where sa.managed_device = device.name
                    and sa.operational_status not in ('Ended', 'Cancelled')
              )
            """,
            {},
        )[0][0]

        reclaimable = frappe.db.sql(
            """
            select count(*)
            from `tabMSP Service Assignment` sa
            left join `tabMSP Client User` holder on holder.name = sa.client_user
            left join `tabMSP Managed Device` device on device.name = sa.managed_device
            left join `tabMSP Client User` device_holder on device_holder.name = device.assigned_client_user
            where sa.operational_status not in ('Ended', 'Cancelled')
              and coalesce(holder.lifecycle_status, device_holder.lifecycle_status)
                  in ('Disabled', 'Archived')
            """
        )[0][0]

        return {"devices_without_services": idle, "reclaimable_licences": reclaimable}

    @staticmethod
    def _portfolio():
        month_start = frappe.utils.get_first_day(frappe.utils.today())

        added = frappe.db.count(
            "MSP Service Assignment",
            {"effective_start_date": (">=", month_start), "operational_status": ("!=", "Cancelled")},
        )
        removed = frappe.db.count(
            "MSP Service Assignment", {"effective_end_date": (">=", month_start)}
        )

        by_service = frappe.db.sql(
            """
            select coalesce(item.item_name, sa.service_item) as service,
                   count(*) as total,
                   sum(sa.billing_status = 'Billable') as billable
            from `tabMSP Service Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            where sa.operational_status in %(open)s
            group by 1
            order by total desc
            """,
            {"open": OPEN_ASSIGNMENT_STATUSES},
            as_dict=True,
        )

        return {
            "customers": frappe.db.count("Customer"),
            "client_users": frappe.db.count("MSP Client User"),
            "active_client_users": frappe.db.count("MSP Client User", {"lifecycle_status": "Active"}),
            "devices": frappe.db.count("MSP Managed Device", {"status": "Active"}),
            "active_services": frappe.db.count(
                "MSP Service Assignment", {"operational_status": "Active"}
            ),
            "billable_services": frappe.db.count(
                "MSP Service Assignment", {"billing_status": "Billable"}
            ),
            "added_this_month": added,
            "removed_this_month": removed,
            "by_service": by_service,
            "rated_services": frappe.db.count(
                "MSP Service Assignment", {"agreed_rate": (">", 0)}
            ),
        }


    @staticmethod
    def list_kpi_rows(kpi=None, start=0, page_length=20):
        """Rows behind a dashboard figure, from the very predicate that produced it."""
        RequestService._guard_internal()

        source = KPI_SOURCES.get(kpi)

        if not source:
            raise ValidationError(f"Unknown KPI '{kpi}'.", "VALIDATION_ERROR")

        if kpi == "billable_services" and not set(frappe.get_roles()).intersection(ADMIN_ROLES):
            raise ValidationError(
                "Only an MSP administrator can review the billable portfolio.",
                "PERMISSION_DENIED",
                403,
            )

        start = max(frappe.utils.cint(start), 0)
        page_length = min(max(frappe.utils.cint(page_length) or 20, 1), 200)

        params = {
            "month_start": frappe.utils.get_first_day(frappe.utils.today()),
        }

        total = frappe.db.sql(f"select count(*) {source['body']}", params)[0][0]

        selected = ", ".join(
            f"{expression} as `{key}`" for key, _label, expression in source["fields"]
        )

        if source.get("route"):
            selected += f", {source['route']} as `route`"

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

        return {
            "kpi": kpi,
            "title": source["title"],
            "description": source["description"],
            "columns": [{"key": key, "label": label} for key, label, _e in source["fields"]],
            "rows": rows,
            "start": start,
            "page_length": page_length,
            "total": total,
            "has_more": start + len(rows) < total,
        }
