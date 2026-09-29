import json

import frappe

from nexgen_msp.utils.errors import NotFoundError, ValidationError

REQUESTED_CLIENT_USER = "MSP Requested Client User"
REQUESTED_DEVICE = "MSP Requested Device"

CROSS_CUSTOMER = "This target does not belong to this Customer."
CROSS_REQUEST = "This requested target belongs to another request."
CONFLICTING_RESOLUTION = (
    "This requested target has already been resolved to a different record. "
    "Refresh the request before continuing."
)
DISABLED_SELECTION = "This record is disabled and cannot be selected."
RETIRED_DEVICE = "This Device is retired and cannot be selected."
CANCELLED_TARGET = "This requested target has been cancelled."
BOTH_TARGETS = "Choose either the existing record or the requested one, not both."
TARGET_REQUIRED = "A target is required."

PAIRS = (
    ("client_user", "requested_client_user"),
    ("managed_device", "requested_device"),
    ("requested_holder", "requested_holder_requested_client_user"),
)

REQUESTED_LINKS = {
    "requested_client_user": REQUESTED_CLIENT_USER,
    "requested_device": REQUESTED_DEVICE,
    "requested_for_requested_client_user": REQUESTED_CLIENT_USER,
    "requested_holder_requested_client_user": REQUESTED_CLIENT_USER,
}

RESOLVED_FIELD = {
    REQUESTED_CLIENT_USER: "resolved_client_user",
    REQUESTED_DEVICE: "resolved_managed_device",
}


def line_person_sql(alias="srl"):
    """The Client User a request line targets, directly or through its resolved Requested Client User."""
    return f"""coalesce(
        nullif({alias}.client_user, ''),
        (select line_rcu.resolved_client_user from `tabMSP Requested Client User` line_rcu
         where line_rcu.name = {alias}.requested_client_user and line_rcu.status = 'Resolved')
    )"""


def line_device_sql(alias="srl"):
    """The Managed Device a request line targets, directly or through its resolved Requested Device."""
    return f"""coalesce(
        nullif({alias}.managed_device, ''),
        (select line_rd.resolved_managed_device from `tabMSP Requested Device` line_rd
         where line_rd.name = {alias}.requested_device and line_rd.status = 'Resolved')
    )"""


def line_of_person_sql(alias, value):
    """The condition that a request line is about a person, directly or through a resolved Requested Client User."""
    return f"""(
        {alias}.client_user = {value}
        or {alias}.requested_for_user = {value}
        or exists (
            select 1 from `tabMSP Requested Client User` line_rcu
            where line_rcu.name in ({alias}.requested_client_user, {alias}.requested_for_requested_client_user)
              and line_rcu.status = 'Resolved'
              and line_rcu.resolved_client_user = {value}
        )
    )"""


def line_of_device_sql(alias, value):
    """The condition that a request line is about a machine, directly or through a resolved Requested Device."""
    return f"""(
        {alias}.managed_device = {value}
        or exists (
            select 1 from `tabMSP Requested Device` line_rd
            where line_rd.name = {alias}.requested_device
              and line_rd.status = 'Resolved'
              and line_rd.resolved_managed_device = {value}
        )
    )"""


def _resolved_of(doctype, name):
    if not name:
        return None

    row = frappe.db.get_value(doctype, name, ["status", RESOLVED_FIELD[doctype]], as_dict=True)

    return row.get(RESOLVED_FIELD[doctype]) if row and row.status == "Resolved" else None


def person_of_line(row):
    """The Client User a request line targets, directly or through its resolved Requested Client User."""
    return row.get("client_user") or _resolved_of(REQUESTED_CLIENT_USER, row.get("requested_client_user"))


def device_of_line(row):
    """The Managed Device a request line targets, directly or through its resolved Requested Device."""
    return row.get("managed_device") or _resolved_of(REQUESTED_DEVICE, row.get("requested_device"))


def blocking_holder(doc):
    """The open Requested Client User a Requested Device is intended for, as {name, label}, or None."""
    name = doc.get("intended_holder_requested_client_user")

    if not name:
        return None

    row = frappe.db.get_value(REQUESTED_CLIENT_USER, name, ["status", "full_name"], as_dict=True)

    if not row or row.status != "Open":
        return None

    return {"name": name, "label": row.full_name or name}


def _empty():
    return {"resolved": None, "requested": None, "waiting": False, "label": None}


def _resolve(existing, requested, requested_doctype, existing_doctype, existing_label, requested_label, required):
    if existing and requested:
        raise ValidationError(BOTH_TARGETS, "VALIDATION_ERROR")

    if existing:
        return {
            "resolved": existing,
            "requested": None,
            "waiting": False,
            "label": frappe.db.get_value(existing_doctype, existing, existing_label) or existing,
        }

    if requested:
        row = frappe.db.get_value(
            requested_doctype,
            requested,
            ["status", RESOLVED_FIELD[requested_doctype], requested_label],
            as_dict=True,
        )

        if not row:
            raise NotFoundError(f"{requested_doctype} {requested} not found.", "NOT_FOUND")

        resolved = row.get(RESOLVED_FIELD[requested_doctype]) if row.status == "Resolved" else None
        label = row.get(requested_label)

        if resolved:
            label = frappe.db.get_value(existing_doctype, resolved, existing_label) or label

        return {
            "resolved": resolved,
            "requested": requested,
            "waiting": row.status == "Open",
            "label": label,
        }

    if required:
        raise ValidationError(TARGET_REQUIRED, "VALIDATION_ERROR")

    return _empty()


def resolve_client_user_target(client_user=None, requested_client_user=None, required=False):
    """The person a row acts on: an existing Client User or a Requested Client User."""
    return _resolve(
        client_user,
        requested_client_user,
        REQUESTED_CLIENT_USER,
        "MSP Client User",
        "full_name",
        "full_name",
        required,
    )


def resolve_device_target(managed_device=None, requested_device=None, required=False):
    """The machine a row acts on: an existing Managed Device or a Requested Device."""
    return _resolve(
        managed_device,
        requested_device,
        REQUESTED_DEVICE,
        "MSP Managed Device",
        "hostname",
        "display_label",
        required,
    )


def resolve_holder_target(requested_holder=None, requested_holder_requested_client_user=None, required=False):
    """The holder a row hands a machine to: an existing Client User or a Requested Client User."""
    return _resolve(
        requested_holder,
        requested_holder_requested_client_user,
        REQUESTED_CLIENT_USER,
        "MSP Client User",
        "full_name",
        "full_name",
        required,
    )


def check_requested_link(doctype, name, request, customer):
    """Refuse a Requested entity that belongs to another request or another customer."""
    row = frappe.db.get_value(doctype, name, ["request", "customer"], as_dict=True)

    if not row:
        frappe.throw(frappe._("{0} {1} not found.").format(doctype, name))

    if row.customer != customer:
        frappe.throw(frappe._(CROSS_CUSTOMER))

    if row.request != request:
        frappe.throw(frappe._(CROSS_REQUEST))


def watched(row):
    """The target links of a row, as a comparable tuple."""
    return tuple(row.get(field) for pair in PAIRS for field in pair) + (
        row.get("requested_for_requested_client_user"),
    )


def validate_request_rows(rows, previous_rows, request, customer):
    """Check the rows of a request whose target links were written in this save."""
    before = {watched(row) for row in previous_rows or []}

    for row in rows:
        if watched(row) in before:
            continue

        for existing, requested in PAIRS:
            if row.get(existing) and row.get(requested):
                frappe.throw(frappe._("Row {0}: {1}").format(row.idx, frappe._(BOTH_TARGETS)))

        for field, doctype in REQUESTED_LINKS.items():
            if row.meta.has_field(field) and row.get(field):
                check_requested_link(doctype, row.get(field), request, customer)


def refresh_work_orders(request, requested_name, resolved, links):
    """Write a resolved target on the open work orders of a request that reference its Requested entity."""
    from nexgen_msp.api.internal.services.request_execution_service import FINISHED_STATUSES
    from nexgen_msp.nexgen_msp.doctype.msp_work_order.msp_work_order import SCOPE_FIELD

    refreshed = []

    for requested_field, real_field in links:
        orders = frappe.get_all(
            "MSP Work Order",
            filters={
                "request": request,
                requested_field: requested_name,
                "status": ("not in", FINISHED_STATUSES),
            },
            pluck="name",
            order_by="creation asc",
        )

        for name in orders:
            order = frappe.get_doc("MSP Work Order", name)

            if real_field != "requested_holder" and SCOPE_FIELD.get(order.target_scope) != real_field:
                continue

            if order.get(real_field) == resolved:
                continue

            order.set(real_field, resolved)
            order.save(ignore_permissions=True)
            refreshed.append(name)

    return refreshed


RETIRED_WORK = {
    REQUESTED_CLIENT_USER: ("User Setup", "subject_key", "requested_client_user", "client_user", "resulting_client_user"),
    REQUESTED_DEVICE: ("Device Provisioning", "device_requirement_key", "requested_device", "managed_device", "resulting_device"),
}

DEPENDENT_FIELDS = {
    REQUESTED_CLIENT_USER: ("requested_client_user", "requested_holder_requested_client_user"),
    REQUESTED_DEVICE: ("requested_device",),
}


def _key_of(doctype, doc):
    return doc.subject_key if doctype == REQUESTED_CLIENT_USER else doc.device_requirement_key


def _unfinished():
    from nexgen_msp.api.internal.services.request_execution_service import FINISHED_STATUSES

    return FINISHED_STATUSES + ("Awaiting Verification",)


def _retired_orders(doctype, doc):
    work_type, key_field, requested_field, _real, _result = RETIRED_WORK[doctype]
    names = set()
    key = _key_of(doctype, doc)
    filters = {
        "request": doc.request,
        "work_type": work_type,
        "status": ("not in", _unfinished()),
    }

    if key:
        names.update(frappe.get_all("MSP Work Order", filters={**filters, key_field: key}, pluck="name"))

    names.update(
        frappe.get_all("MSP Work Order", filters={**filters, requested_field: doc.name}, pluck="name")
    )

    return sorted(names)


def settle_retired_work(doctype, doc, resolved):
    """Complete the open work orders of a retired kind that stood for this Requested entity."""
    _work_type, _key, _requested, real_field, result_field = RETIRED_WORK[doctype]
    settled = []

    for name in _retired_orders(doctype, doc):
        order = frappe.get_doc("MSP Work Order", name)
        order.set(real_field, resolved)
        order.set(result_field, resolved)
        order.execution_notes = f"Settled when {doc.name} was resolved."
        order.status = "Completed"
        order.completed_by = frappe.session.user
        order.completed_at = frappe.utils.now_datetime()
        order.save(ignore_permissions=True)
        settled.append(name)

    return settled


def cancel_dependent_work(doctype, doc, reason):
    """Cancel the open work that can no longer happen because its Requested entity was cancelled."""
    names = set(_retired_orders(doctype, doc))

    for field in DEPENDENT_FIELDS[doctype]:
        names.update(
            frappe.get_all(
                "MSP Work Order",
                filters={
                    "request": doc.request,
                    field: doc.name,
                    "status": ("not in", _unfinished()),
                },
                pluck="name",
            )
        )

    for name in sorted(names):
        order = frappe.get_doc("MSP Work Order", name)
        order.status = "Cancelled"
        order.failure_reason = f"{CANCELLED_TARGET} {reason}".strip()
        order.save(ignore_permissions=True)
        order.add_comment("Comment", f"Cancelled: {order.failure_reason}")

    return sorted(names)


def snapshot_of(values, fields):
    """The requester's values as the JSON text stored on a Requested entity."""
    return json.dumps({field: values.get(field) for field in fields}, sort_keys=True, default=str)


def cleaned(values, fields):
    """The given values restricted to the named fields, text trimmed and blanks as None."""
    if isinstance(values, str):
        values = frappe.parse_json(values)

    out = {}

    for field in fields:
        if field not in (values or {}):
            continue

        value = values.get(field)

        if isinstance(value, str):
            value = value.strip() or None

        out[field] = value

    return out
