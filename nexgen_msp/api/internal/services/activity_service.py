import frappe

from nexgen_msp.api.internal.services.request_service import ADMIN_ROLES, RequestService

KINDS = (
    "invoice",
    "credit_note",
    "request",
    "user",
    "device",
    "service_started",
    "service_ended",
)

# billing history is a commercial matter, so a technician does not see it
ADMIN_ONLY_KINDS = ("invoice", "credit_note")


class ActivityService:
    @staticmethod
    def _is_admin():
        return bool(RequestService._roles().intersection(ADMIN_ROLES))

    @staticmethod
    def options():
        """The axes the history can be narrowed on."""
        RequestService._guard_internal()

        kinds = KINDS if ActivityService._is_admin() else [
            kind for kind in KINDS if kind not in ADMIN_ONLY_KINDS
        ]

        return {
            "kinds": [
                {"value": kind, "label": kind.replace("_", " ").capitalize()} for kind in kinds
            ],
            "customers": frappe.get_all("Customer", pluck="name", order_by="name"),
        }

    @staticmethod
    def _clause(customers, alias="customer"):
        if not customers:
            return "", {}

        return f" and {alias} in %(customers)s", {"customers": customers}

    @staticmethod
    def list_activity(
        customers=None, kinds=None, date_from=None, date_to=None, start=0, page_length=25
    ):
        """One history across every customer, merged from what actually happened.

        Each source is capped before the merge so a single noisy source cannot crowd the
        others out, which also means the total is a count of what was gathered rather than
        of everything that ever occurred.

        The history spans every customer, so it never leaves the staff workspace.
        """
        RequestService._guard_internal()

        def as_list(value):
            value = frappe.parse_json(value) if isinstance(value, str) else value
            if value in (None, "", []):
                return []
            return value if isinstance(value, list) else [value]

        is_admin = ActivityService._is_admin()

        customers = as_list(customers)
        wanted = set(as_list(kinds)) or set(KINDS)

        if not is_admin:
            wanted -= set(ADMIN_ONLY_KINDS)

        start = max(0, frappe.utils.cint(start))
        page_length = min(100, max(1, frappe.utils.cint(page_length) or 25))
        cap = start + page_length + 25

        events = []
        base = {"cap": cap}

        def window(column):
            clause = ""
            if date_from:
                clause += f" and {column} >= %(date_from)s"
                base["date_from"] = date_from
            if date_to:
                clause += f" and {column} <= %(date_to)s"
                base["date_to"] = date_to
            return clause

        def run(sql, alias="customer", column="creation"):
            where, params = ActivityService._clause(customers, alias)
            return frappe.db.sql(
                sql.format(customers=where, window=window(column)),
                {**base, **params},
                as_dict=True,
            )

        if {"invoice", "credit_note"} & wanted:
            for row in run(
                """
                select br.name, br.customer, br.total_amount, br.currency, br.sales_invoice,
                       br.billing_period_start, br.billing_period_end, br.credit_note_of,
                       br.disputed, br.modified as `on`
                from `tabBilling Run` br
                where br.status = 'Invoiced'{customers}{window}
                order by br.modified desc limit %(cap)s
                """,
                alias="br.customer",
                column="br.modified",
            ):
                kind = "credit_note" if row.credit_note_of else "invoice"

                if kind not in wanted:
                    continue

                events.append(
                    {
                        "kind": kind,
                        "on": row.get("on"),
                        "customer": row.customer,
                        "title": f"{'Credit note' if row.credit_note_of else 'Invoice'} "
                        f"{row.sales_invoice or row.name} issued",
                        "detail": f"{frappe.utils.fmt_money(abs(row.total_amount or 0), currency=row.currency)}"
                        f" for {row.billing_period_start} → {row.billing_period_end}"
                        + (" · disputed" if row.disputed else ""),
                        "link": f"/msp/billing/{row.name}",
                    }
                )

        if "request" in wanted:
            for row in run(
                """
                select name, customer, request_type, status, modified as `on`
                from `tabService Request`
                where 1 = 1{customers}{window}
                order by modified desc limit %(cap)s
                """,
                column="modified",
            ):
                events.append(
                    {
                        "kind": "request",
                        "on": row.get("on"),
                        "customer": row.customer,
                        "title": f"Request {row.name} is {row.status.lower()}",
                        "detail": f"{row.request_type} request",
                        "link": f"/msp/requests/{row.name}",
                    }
                )

        if "user" in wanted:
            for row in run(
                """
                select name, customer, full_name, department, creation as `on`
                from `tabClient User`
                where 1 = 1{customers}{window}
                order by creation desc limit %(cap)s
                """
            ):
                events.append(
                    {
                        "kind": "user",
                        "on": row.get("on"),
                        "customer": row.customer,
                        "title": f"{row.full_name} joined",
                        "detail": row.department or "No department recorded",
                        "link": f"/msp/users/{row.name}",
                    }
                )

        if "device" in wanted:
            for row in run(
                """
                select name, customer, hostname, device_type, creation as `on`
                from `tabManaged Device`
                where 1 = 1{customers}{window}
                order by creation desc limit %(cap)s
                """
            ):
                events.append(
                    {
                        "kind": "device",
                        "on": row.get("on"),
                        "customer": row.customer,
                        "title": f"{row.hostname} added",
                        "detail": row.device_type or "Device",
                        "link": f"/msp/devices?q={row.hostname}",
                    }
                )

        for kind, column, verb in (
            ("service_started", "sa.effective_start_date", "activated"),
            ("service_ended", "sa.effective_end_date", "ended"),
        ):
            if kind not in wanted:
                continue

            for row in run(
                f"""
                select sa.name, sa.customer, {column} as `on`,
                       coalesce(item.item_name, sa.service_item) as service_name,
                       coalesce(cu.full_name, d.hostname) as holder,
                       sa.client_user
                from `tabService Assignment` sa
                left join `tabItem` item on item.name = sa.service_item
                left join `tabClient User` cu on cu.name = sa.client_user
                left join `tabManaged Device` d on d.name = sa.managed_device
                where {column} is not null{{customers}}{{window}}
                order by {column} desc limit %(cap)s
                """,
                alias="sa.customer",
                column=column,
            ):
                events.append(
                    {
                        "kind": kind,
                        "on": row.get("on"),
                        "customer": row.customer,
                        "title": f"{row.service_name} {verb}",
                        "detail": row.holder or "Unassigned",
                        "link": f"/msp/users/{row.client_user}" if row.client_user else None,
                    }
                )

        events = [event for event in events if event["on"]]
        events.sort(key=lambda event: str(event["on"]), reverse=True)

        page = events[start : start + page_length]

        return {
            "rows": page,
            "start": start,
            "page_length": page_length,
            "total": len(events),
            "has_more": len(events) > start + page_length,
            "shows_billing": is_admin,
        }
