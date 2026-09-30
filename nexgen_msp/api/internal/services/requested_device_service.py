import json

import frappe

from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.requested_entity_presentation import RequestedEntityPresentation
from nexgen_msp.nexgen_msp.doctype.msp_requested_device.msp_requested_device import (
    source_key_for,
)
from nexgen_msp.nexgen_msp.doctype.msp_request.msp_request import requester_edit_open
from nexgen_msp.utils import identifiers, request_targets
from nexgen_msp.utils.errors import NotFoundError, ValidationError

DOCTYPE = "MSP Requested Device"

REQUESTER_FIELDS = (
    "display_label",
    "hostname",
    "device_type",
    "serial_number",
    "asset_tag",
    "manufacturer",
    "model",
    "operating_system",
    "intended_holder_client_user",
    "intended_holder_requested_client_user",
)

PREPARED_FIELDS = REQUESTER_FIELDS + ("notes",)

RESOLUTION_MODES = ("Use Existing", "Register New")

UNSELECTABLE_STATUSES = ("Retired",)

NOT_IN_PROGRESS = "This requested target belongs to a request that is not being carried out."

HOLDER_FIRST = "Create {0} first: this Device is intended for them."

REFERENCING_FIELDS = {
    "MSP Requested Client User": (
        "requested_client_user",
        "requested_for_requested_client_user",
        "requested_holder_requested_client_user",
    ),
    DOCTYPE: ("requested_device",),
}

SELECTOR_LIMIT = 50
SELECTOR_MAX = 200


def guard_request_work(doctype, doc, review=False):
    """Refuse work on a Requested entity whose request is not being carried out."""
    from nexgen_msp.api.internal.services.request_execution_service import (
        REVIEWABLE_STATUSES,
        WORKABLE_STATUSES,
    )

    status = frappe.db.get_value("MSP Request", doc.request, "status")

    if review:
        if status in REVIEWABLE_STATUSES:
            return
    elif status in WORKABLE_STATUSES:
        clauses = " or ".join(f"line.`{field}` = %(name)s" for field in REFERENCING_FIELDS[doctype])
        approved = frappe.db.sql(
            f"""
            select line.name from `tabMSP Request Line` line
            where line.parent = %(request)s and line.parenttype = 'MSP Request'
              and line.line_status = 'Approved' and ({clauses})
            limit 1
            """,
            {"request": doc.request, "name": doc.name},
        )

        if approved:
            return

    raise ValidationError(NOT_IN_PROGRESS, "REQUEST_NOT_IN_PROGRESS")


def selector_limit(limit):
    """The number of selector rows asked for, 50 by default and never more than 200."""
    if limit in (None, ""):
        return SELECTOR_LIMIT

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        raise ValidationError("limit must be a whole number.", "VALIDATION_ERROR")

    if limit < 1:
        raise ValidationError("limit must be at least 1.", "VALIDATION_ERROR")

    return min(limit, SELECTOR_MAX)


def hands_over_by_line(doc):
    """Whether a line of the request hands this Requested Device over."""
    return bool(
        frappe.db.sql(
            """
            select line.name from `tabMSP Request Line` line
            where line.parent = %(request)s and line.parenttype = 'MSP Request'
              and line.requested_device = %(name)s
              and line.operation_code in ('device.assign', 'device.transfer')
            limit 1
            """,
            {"request": doc.request, "name": doc.name},
        )
    )


def hand_to_intended_holder(doc, effective_date=None):
    """Give a resolved Requested Device to its intended holder when no line of the request does."""
    from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService

    device = doc.resolved_managed_device

    if doc.status != "Resolved" or not device or hands_over_by_line(doc):
        return None

    holder = doc.intended_holder_client_user

    if not holder and doc.intended_holder_requested_client_user:
        holder = request_targets.resolve_client_user_target(
            requested_client_user=doc.intended_holder_requested_client_user
        )["resolved"]

    if not holder:
        return None

    current = frappe.db.get_value("MSP Managed Device", device, "assigned_client_user")

    if current == holder:
        return None

    note = f"Handed over as requested in {doc.request}."
    savepoint = "hand_to_intended_holder"
    frappe.db.savepoint(savepoint)

    try:
        if current:
            DeviceLifecycleService.transfer(
                device=device, client_user=holder, effective_date=effective_date, note=note,
                _commit=False, _within_request=doc.request,
            )
        else:
            DeviceLifecycleService.assign(
                device=device, client_user=holder, effective_date=effective_date, note=note,
                _commit=False, _within_request=doc.request,
            )
    except (ValidationError, NotFoundError, frappe.ValidationError) as refusal:
        frappe.db.rollback(save_point=savepoint)
        reason = getattr(refusal, "message", None) or str(refusal)
        machine = frappe.db.get_value("MSP Managed Device", device, "hostname") or device
        person = frappe.db.get_value("MSP Client User", holder, "full_name") or holder
        frappe.get_doc("MSP Request", doc.request).add_comment(
            "Comment", f"{machine} was not handed to {person}: {frappe.utils.strip_html(reason)}"
        )
        return None

    return holder


class RequestedDeviceService:
    @staticmethod
    def _load(name):
        if not name or not frappe.db.exists(DOCTYPE, name):
            raise NotFoundError(f"Requested Device {name} not found.", "NOT_FOUND")

        frappe.db.get_value(DOCTYPE, name, "name", for_update=True)

        return frappe.get_doc(DOCTYPE, name)

    @staticmethod
    def _request(request):
        row = frappe.db.get_value(
            "MSP Request", request, ["name", "customer", "status"], as_dict=True
        ) if request else None

        if not row:
            raise NotFoundError(f"Request {request} not found.", "NOT_FOUND")

        return row

    @staticmethod
    def _hand_over_day(doc, effective_date):
        """A hand-over day said out loud is the request's to allow, before anything is written."""
        if effective_date:
            from nexgen_msp.api.internal.services.user_service import UserService

            UserService._request_day(effective_date, doc.request)

    @staticmethod
    def _open(doc):
        if doc.status == "Cancelled":
            raise ValidationError(request_targets.CANCELLED_TARGET, "VALIDATION_ERROR")

        if doc.status == "Resolved":
            raise ValidationError(
                "This requested target has already been resolved.", "VALIDATION_ERROR"
            )

    @staticmethod
    def _holder_ready(doc):
        blocked = request_targets.blocking_holder(doc)

        if blocked:
            raise ValidationError(HOLDER_FIRST.format(blocked["label"]), "HOLDER_NOT_RESOLVED")

    @staticmethod
    def _label(values):
        if values.get("display_label"):
            return values["display_label"]

        if values.get("hostname"):
            return values["hostname"]

        if values.get("device_type"):
            return f"New {values['device_type']}"

        return "New device"

    @staticmethod
    def create_or_update_draft(request, device_requirement_key, requester_values, subject_key=None):
        """Write the Device need a draft request describes, once per device requirement key."""
        row = RequestedDeviceService._request(request)

        if row.status != "Draft" and not requester_edit_open(request):
            raise ValidationError(
                "A requested Device can only be written while the request is a draft.",
                "VALIDATION_ERROR",
            )

        if not device_requirement_key:
            raise ValidationError("device_requirement_key is required.", "VALIDATION_ERROR")

        values = request_targets.cleaned(requester_values, REQUESTER_FIELDS)
        values["display_label"] = RequestedDeviceService._label(values)

        existing = frappe.db.get_value(
            DOCTYPE, {"source_key": source_key_for(request, device_requirement_key)}, "name"
        )

        if existing:
            doc = frappe.get_doc(DOCTYPE, existing)
        else:
            doc = frappe.get_doc(
                {
                    "doctype": DOCTYPE,
                    "request": request,
                    "customer": row.customer,
                    "device_requirement_key": device_requirement_key,
                    "status": "Open",
                }
            )

        for field in REQUESTER_FIELDS:
            doc.set(field, values.get(field))

        if subject_key is not None:
            doc.subject_key = subject_key or None

        doc.requested_snapshot_json = request_targets.snapshot_of(values, REQUESTER_FIELDS)

        if existing:
            doc.save(ignore_permissions=True)
        else:
            doc.insert(ignore_permissions=True)

        return doc.name

    @staticmethod
    def freeze(request):
        """Refresh the requested snapshot of every open Requested Device from its final values."""
        row = RequestedDeviceService._request(request)

        if row.status != "Draft" and not requester_edit_open(request):
            raise ValidationError(
                "The requested snapshot can only be refreshed while the request is a draft.",
                "VALIDATION_ERROR",
            )

        frozen = []

        for name in frappe.get_all(
            DOCTYPE, filters={"request": request, "status": "Open"}, pluck="name"
        ):
            doc = frappe.get_doc(DOCTYPE, name)
            snapshot = request_targets.snapshot_of(
                {field: doc.get(field) for field in REQUESTER_FIELDS}, REQUESTER_FIELDS
            )

            if json.loads(snapshot) != json.loads(doc.requested_snapshot_json or "{}"):
                doc.requested_snapshot_json = snapshot
                doc.save(ignore_permissions=True)

            frozen.append(name)

        return frozen

    @staticmethod
    def mark_reviewed(name, prepared_values=None):
        """Record the technician's review and the values prepared so far."""
        RequestService._guard_internal()

        doc = RequestedDeviceService._load(name)
        guard_request_work(DOCTYPE, doc, review=True)
        RequestedDeviceService._open(doc)

        doc.update(request_targets.cleaned(prepared_values, PREPARED_FIELDS))

        mode = request_targets.cleaned(prepared_values, ("resolution_mode",)).get("resolution_mode")

        if mode:
            if mode not in RESOLUTION_MODES:
                raise ValidationError(f"{mode} is not a resolution mode.", "VALIDATION_ERROR")
            doc.resolution_mode = mode

        doc.reviewed_by = frappe.session.user
        doc.reviewed_at = frappe.utils.now_datetime()
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        return RequestedEntityPresentation.device(name)

    @staticmethod
    def _resolve(doc, managed_device, mode, effective_date=None):
        doc.resolution_mode = mode
        doc.resolved_managed_device = managed_device
        doc.status = "Resolved"
        doc.resolved_by = frappe.session.user
        doc.resolved_at = frappe.utils.now_datetime()
        doc.save(ignore_permissions=True)

        request_targets.refresh_work_orders(
            doc.request,
            doc.name,
            managed_device,
            (("requested_device", "managed_device"),),
        )
        request_targets.settle_retired_work(DOCTYPE, doc, managed_device)
        hand_to_intended_holder(doc, effective_date)

    @staticmethod
    def resolve_existing(name, managed_device, effective_date=None):
        """Resolve to a Managed Device a person deliberately chose."""
        RequestService._guard_internal()

        doc = RequestedDeviceService._load(name)
        guard_request_work(DOCTYPE, doc)

        if not managed_device:
            raise ValidationError("Select a Device.", "VALIDATION_ERROR")

        if doc.status == "Resolved":
            if doc.resolved_managed_device == managed_device:
                return managed_device

            raise ValidationError(request_targets.CONFLICTING_RESOLUTION, "VALIDATION_ERROR")

        RequestedDeviceService._open(doc)
        RequestedDeviceService._holder_ready(doc)
        RequestedDeviceService._hand_over_day(doc, effective_date)

        device = frappe.db.get_value(
            "MSP Managed Device", managed_device, ["customer", "status"], as_dict=True
        )

        if not device:
            raise NotFoundError(f"Device {managed_device} not found.", "NOT_FOUND")

        if device.customer != doc.customer:
            raise ValidationError(request_targets.CROSS_CUSTOMER, "VALIDATION_ERROR")

        if device.status in UNSELECTABLE_STATUSES:
            raise ValidationError(request_targets.RETIRED_DEVICE, "VALIDATION_ERROR")

        savepoint = "resolve_requested_device"
        frappe.db.savepoint(savepoint)

        try:
            identifiers.record_serial(managed_device, doc.serial_number)
            RequestedDeviceService._resolve(doc, managed_device, "Use Existing", effective_date)
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise

        frappe.db.commit()

        return managed_device

    @staticmethod
    def resolve_new(name, prepared_values=None, effective_date=None, interfaces=None):
        """Register the Managed Device this Requested Device stands for, once."""
        RequestService._guard_internal()

        doc = RequestedDeviceService._load(name)
        guard_request_work(DOCTYPE, doc)

        if doc.status == "Resolved":
            if doc.resolution_mode == "Register New":
                return doc.resolved_managed_device

            raise ValidationError(request_targets.CONFLICTING_RESOLUTION, "VALIDATION_ERROR")

        RequestedDeviceService._open(doc)
        RequestedDeviceService._holder_ready(doc)
        RequestedDeviceService._hand_over_day(doc, effective_date)

        doc.update(request_targets.cleaned(prepared_values, PREPARED_FIELDS))

        savepoint = "resolve_requested_device"
        frappe.db.savepoint(savepoint)

        try:
            created = DeviceService.create_device(
                customer=doc.customer,
                hostname=doc.hostname,
                device_type=doc.device_type,
                serial_number=doc.serial_number,
                manufacturer=doc.manufacturer,
                model=doc.model,
                operating_system=doc.operating_system,
                # the MAC addresses are read off the machine in hand, so they arrive with the
                # registration and never with what the customer asked for
                interfaces=interfaces,
                source_request=doc.request,
                _commit=False,
            )

            if doc.asset_tag:
                frappe.db.set_value("MSP Managed Device", created["name"], "asset_tag", doc.asset_tag)

            doc.hostname = created["hostname"]
            RequestedDeviceService._resolve(doc, created["name"], "Register New", effective_date)
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise

        frappe.db.commit()

        return created["name"]

    @staticmethod
    def cancel(name, reason=None):
        """Cancel a Requested Device that has not been resolved."""
        RequestService._guard_internal()

        doc = RequestedDeviceService._load(name)
        guard_request_work(DOCTYPE, doc)

        if doc.status == "Cancelled":
            return RequestedEntityPresentation.device(name)

        if doc.status == "Resolved":
            raise ValidationError(
                "A resolved requested target cannot be cancelled.", "VALIDATION_ERROR"
            )

        reason = (reason or "").strip()

        if not reason:
            raise ValidationError("A reason is required to cancel.", "VALIDATION_ERROR")

        doc.status = "Cancelled"
        doc.cancel_reason = reason
        doc.cancelled_by = frappe.session.user
        doc.cancelled_at = frappe.utils.now_datetime()
        doc.save(ignore_permissions=True)
        request_targets.cancel_dependent_work(DOCTYPE, doc, reason)
        frappe.db.commit()

        return RequestedEntityPresentation.device(name)

    @staticmethod
    def selectable_device_page(customer, search=None, limit=None):
        """The first Managed Devices of a customer matching a search, with how many match in all."""
        if not customer:
            raise ValidationError("customer is required.", "VALIDATION_ERROR")

        conditions = ""
        params = {"customer": customer, "limit": selector_limit(limit)}
        search = (search or "").strip()

        if search:
            params["search"] = f"%{search}%"
            conditions = """
              and (
                d.name like %(search)s or d.hostname like %(search)s
                or d.serial_number like %(search)s or d.asset_tag like %(search)s
                or cu.full_name like %(search)s
              )
            """

        rows = frappe.db.sql(
            f"""
            select
                d.name, d.hostname, d.serial_number, d.asset_tag, d.device_type, d.status,
                d.assigned_client_user as current_holder,
                cu.full_name as current_holder_name
            from `tabMSP Managed Device` d
            left join `tabMSP Client User` cu on cu.name = d.assigned_client_user
            where d.customer = %(customer)s
            {conditions}
            order by d.creation desc
            limit %(limit)s
            """,
            params,
            as_dict=True,
        )

        for row in rows:
            row["selectable"] = row.status not in UNSELECTABLE_STATUSES
            row["unavailable_reason"] = None if row["selectable"] else request_targets.RETIRED_DEVICE

        total = frappe.db.sql(
            f"""
            select count(*)
            from `tabMSP Managed Device` d
            left join `tabMSP Client User` cu on cu.name = d.assigned_client_user
            where d.customer = %(customer)s
            {conditions}
            """,
            params,
        )[0][0]

        return {"rows": rows, "total": total, "truncated": total > len(rows)}
