"""What a sheet may carry: the columns a listing offers, and one block per service.

The screen decides what to take away; this only says what each pick means. A key the
catalogue does not know is dropped rather than refused, so a selection saved in a browser
months ago still opens a file.

Services are written side by side rather than crammed into one cell: each service gets its
own consecutive columns, so a spreadsheet can sort and filter on the day one started or the
day it was last invoiced.
"""

import frappe

from nexgen_msp.utils.assignments import OPEN_ASSIGNMENT_STATUSES

# what can be written about one service, in the order the columns come out
SERVICE_FIELDS = [
    ("service_name", "Service"),
    ("operational_status", "Status"),
    ("assignment_scope", "Scope"),
    ("hostname", "On machine"),
    ("holder_name", "Held by"),
    ("effective_start_date", "Since"),
    ("effective_end_date", "Ended on"),
    ("last_billed_on", "Last billed on"),
    ("billing_status", "Billing status"),
    ("source_request", "Request"),
]

SERVICE_LABELS = dict(SERVICE_FIELDS)

# a sheet nobody can open is worse than a wide one, so the blocks stop somewhere
MAX_BLOCKS = 12


def parse(value):
    """A list of keys, however the browser sent it."""
    if not value:
        return []

    if isinstance(value, str):
        value = frappe.parse_json(value)

    return [str(key) for key in value if key]


def chosen(catalogue, requested):
    """The columns to write, in the order the catalogue names them.

    Nothing asked for, everything written: an export that never opened the picker stays
    exactly what it was.
    """
    keys = parse(requested)

    if not keys:
        return list(catalogue)

    wanted = set(keys)
    picked = [(key, label) for key, label in catalogue if key in wanted]

    return picked or list(catalogue)


def service_columns(rows, services, fields):
    """Fill one block of columns per service and say what those columns are called."""
    fields = [key for key in parse(fields) if key in SERVICE_LABELS]

    if not fields:
        return []

    blocks = min(max((len(services.get(row.get("name")) or []) for row in rows), default=0), MAX_BLOCKS)

    if not blocks:
        return []

    columns = []

    for index in range(1, blocks + 1):
        for key in fields:
            label = SERVICE_LABELS[key]
            columns.append(
                (
                    f"service_{index}_{key}",
                    f"Service {index}" if key == "service_name" else f"Service {index} · {label}",
                )
            )

    for row in rows:
        held = (services.get(row.get("name")) or [])[:blocks]

        for index, service in enumerate(held, start=1):
            for key in fields:
                row[f"service_{index}_{key}"] = service.get(key)

    return columns


def _billed_through(assignments):
    """The last day each of these services was invoiced for, in one query."""
    from nexgen_msp.api.internal.services.user_360_service import User360Service

    return User360Service._billed_through(assignments)


def _with_billing(rows):
    billed = _billed_through([row["name"] for row in rows])

    for row in rows:
        row["last_billed_on"] = billed.get(row["name"])

    return rows


def _grouped(rows, key):
    grouped = {}

    for row in rows:
        grouped.setdefault(row.get(key), []).append(row)

    return grouped


def of_people(names, open_only=True):
    """Every service these people are billed for: their own, and their machines'."""
    names = [name for name in names if name]

    if not names:
        return {}

    status = "in" if open_only else "not in"
    rows = frappe.db.sql(
        f"""
        select sa.name, coalesce(item.item_name, sa.service_item) as service_name,
               sa.operational_status, sa.billing_status, sa.assignment_scope,
               sa.effective_start_date, sa.effective_end_date, sa.source_request,
               device.hostname,
               coalesce(sa.client_user, device.assigned_client_user) as person
        from `tabMSP Service Assignment` sa
        left join `tabItem` item on item.name = sa.service_item
        left join `tabMSP Managed Device` device on device.name = sa.managed_device
        where sa.operational_status {status} %(open)s
          and (sa.client_user in %(people)s or device.assigned_client_user in %(people)s)
        order by sa.effective_start_date asc, item.item_name asc
        """,
        {"people": names, "open": OPEN_ASSIGNMENT_STATUSES},
        as_dict=True,
    )

    return _grouped(_with_billing(rows), "person")


def of_devices(names, open_only=True):
    """Every service running on these machines."""
    names = [name for name in names if name]

    if not names:
        return {}

    status = "in" if open_only else "not in"
    rows = frappe.db.sql(
        f"""
        select sa.name, coalesce(item.item_name, sa.service_item) as service_name,
               sa.operational_status, sa.billing_status, sa.assignment_scope,
               sa.effective_start_date, sa.effective_end_date, sa.source_request,
               device.hostname, holder.full_name as holder_name,
               sa.managed_device as device
        from `tabMSP Service Assignment` sa
        left join `tabItem` item on item.name = sa.service_item
        left join `tabMSP Managed Device` device on device.name = sa.managed_device
        left join `tabMSP Client User` holder on holder.name = device.assigned_client_user
        where sa.operational_status {status} %(open)s
          and sa.managed_device in %(devices)s
        order by sa.effective_start_date asc, item.item_name asc
        """,
        {"devices": names, "open": OPEN_ASSIGNMENT_STATUSES},
        as_dict=True,
    )

    return _grouped(_with_billing(rows), "device")
