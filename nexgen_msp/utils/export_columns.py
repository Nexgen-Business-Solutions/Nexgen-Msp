"""What a sheet may carry: the columns a listing offers, and one block per service.

The screen decides what to take away; this only says what each pick means. A key the
catalogue does not know is dropped rather than refused, so a selection saved in a browser
months ago still opens a file.

Services are written side by side rather than crammed into one cell: each service gets its
own consecutive columns, headed by its own name, so a spreadsheet can sort and filter on the
day one started or the day it was last invoiced.
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
MAX_BLOCKS = 25


def parse(value):
    """A list of keys, however the browser sent it."""
    if not value:
        return []

    if isinstance(value, str):
        value = frappe.parse_json(value)

    return [str(key) for key in value if key]


def chosen(catalogue, requested):
    """The columns to write, in the order they were asked for.

    The picker hands them over in the order it lists them, so the sheet reads like the modal
    rather than like whatever was ticked first. Nothing asked for, everything written: an
    export that never opened the picker stays exactly what it was.
    """
    keys = parse(requested)

    if not keys:
        return list(catalogue)

    labels = dict(catalogue)
    picked = [(key, labels[key]) for key in keys if key in labels]

    return picked or list(catalogue)


def _named(service):
    return service.get("service_name") or service.get("service_item") or "Service"


def _by_name(held):
    """The services of one row, gathered under the name they are read by."""
    grouped = {}

    for service in held:
        grouped.setdefault(_named(service), []).append(service)

    return grouped


def service_columns(rows, services, fields):
    """One block of columns per service, each headed by the name of that service.

    A column has one heading for the whole sheet, so the blocks are the services the sheet
    covers rather than a numbered slot per row: everyone's Microsoft 365 is read down the
    same column. Somebody holding the same service twice gets a second block beside it.
    """
    fields = [key for key in parse(fields) if key in SERVICE_LABELS]

    if not fields:
        return []

    # how many times one service can appear on a single row
    most = {}

    for row in rows:
        for name, held in _by_name(services.get(row.get("name")) or []).items():
            most[name] = max(most.get(name, 0), len(held))

    blocks = [(name, index) for name in sorted(most) for index in range(1, most[name] + 1)][:MAX_BLOCKS]

    if not blocks:
        return []

    columns = []

    for name, index in blocks:
        head = name if index == 1 else f"{name} ({index})"

        for key in fields:
            columns.append(
                (
                    f"service::{name}::{index}::{key}",
                    head if key == "service_name" else f"{head} · {SERVICE_LABELS[key]}",
                )
            )

    for row in rows:
        held = _by_name(services.get(row.get("name")) or [])

        for name, index in blocks:
            theirs = held.get(name) or []

            if len(theirs) < index:
                continue

            for key in fields:
                row[f"service::{name}::{index}::{key}"] = theirs[index - 1].get(key)

    return columns


def fill_people_extras(rows):
    """The facts a person's register does not need on screen, but a sheet is asked for.

    The portal listing stays as light as the page that reads it; an export is read next to
    a vendor's own list, so it carries the serials, the counts and the billing dates too.
    """
    names = [row.get("name") for row in rows if row.get("name")]

    if not names:
        return

    facts = frappe.db.sql(
        """
        select
            cu.name,
            cu.last_billed_on, cu.covered_until,
            (select group_concat(device.serial_number separator ', ')
                from `tabMSP Managed Device` device
                where device.assigned_client_user = cu.name and device.status = 'Active'
                  and ifnull(device.serial_number, '') != '') as serial_numbers,
            (select count(*) from `tabMSP Managed Device` device
                where device.assigned_client_user = cu.name) as current_devices,
            (select count(*) from `tabMSP Service Assignment` sa
                where sa.client_user = cu.name and sa.assignment_scope = 'User'
                  and sa.operational_status in %(open)s) as personal_services,
            (select count(*) from `tabMSP Service Assignment` sa
                join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                where sad.assigned_client_user = cu.name and sa.assignment_scope = 'Device'
                  and sa.operational_status in %(open)s) as device_services,
            (select group_concat(distinct coalesce(item.item_name, sa.service_item)
                    order by item.item_name separator ', ')
                from `tabMSP Service Assignment` sa
                left join `tabItem` item on item.name = sa.service_item
                left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                where sa.operational_status not in %(open)s
                  and (sa.client_user = cu.name or sad.assigned_client_user = cu.name))
                as inactive_service_names,
            (select count(distinct sr.name)
                from `tabMSP Service Request Line` srl
                join `tabMSP Service Request` sr on sr.name = srl.parent
                where (srl.client_user = cu.name or srl.requested_for_user = cu.name)
                  and sr.status in ('Submitted', 'Under Review', 'Approved', 'In Progress'))
                as open_requests
        from `tabMSP Client User` cu
        where cu.name in %(people)s
        """,
        {"people": names, "open": OPEN_ASSIGNMENT_STATUSES},
        as_dict=True,
    )
    known = {row.name: row for row in facts}

    for row in rows:
        found = known.get(row.get("name"))

        if found:
            row.update({key: value for key, value in found.items() if key != "name"})


def fill_device_extras(rows):
    """The same, for machines: who holds one, who held it before, and up to when it is billed."""
    from nexgen_msp.utils import device_holders

    names = [row.get("name") for row in rows if row.get("name")]

    if not names:
        return

    facts = frappe.db.sql(
        """
        select
            device.name, device.last_billed_on, device.covered_until,
            holder.username as holder_username,
            holder.department as user_department,
            holder.lifecycle_status as user_status,
            holder.full_name as user_name,
            (select group_concat(distinct coalesce(item.item_name, sa.service_item)
                    order by item.item_name separator ', ')
                from `tabMSP Service Assignment` sa
                left join `tabItem` item on item.name = sa.service_item
                where sa.managed_device = device.name
                  and sa.operational_status not in %(open)s) as inactive_service_names
        from `tabMSP Managed Device` device
        left join `tabMSP Client User` holder on holder.name = device.assigned_client_user
        where device.name in %(devices)s
        """,
        {"devices": names, "open": OPEN_ASSIGNMENT_STATUSES},
        as_dict=True,
    )
    known = {row.name: row for row in facts}

    for row in rows:
        found = known.get(row.get("name"))

        if found:
            row.update({key: value for key, value in found.items() if key != "name"})

        # who held it before, so a sheet tells the whole story of the machine
        row["previous_holders"] = " | ".join(
            f"{spell.full_name or spell.client_user}"
            f" ({spell.from_date or '?'} → {spell.to_date or 'now'})"
            for spell in device_holders.history(row["name"])
        )


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
