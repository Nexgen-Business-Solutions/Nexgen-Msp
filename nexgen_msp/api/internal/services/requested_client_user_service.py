import json

import frappe

from nexgen_msp.api.internal.services.department_service import DepartmentService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.requested_device_service import (
    guard_request_work,
    hand_to_intended_holder,
    selector_limit,
)
from nexgen_msp.api.internal.services.requested_entity_presentation import RequestedEntityPresentation
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.nexgen_msp.doctype.msp_requested_client_user.msp_requested_client_user import (
    source_key_for,
)
from nexgen_msp.nexgen_msp.doctype.msp_request.msp_request import requester_edit_open
from nexgen_msp.utils import identifiers, request_targets
from nexgen_msp.utils.errors import NotFoundError, ValidationError

DOCTYPE = "MSP Requested Client User"

REQUESTER_FIELDS = (
    "full_name",
    "department",
    "email",
    "username",
    "external_employee_id",
    "start_date",
)

PREPARED_FIELDS = REQUESTER_FIELDS + ("notes",)

RESOLUTION_MODES = ("Create New", "Use Existing")

UNSELECTABLE_STATUSES = ("Disabled", "Archived")


class RequestedClientUserService:
    @staticmethod
    def _load(name):
        if not name or not frappe.db.exists(DOCTYPE, name):
            raise NotFoundError(f"Requested Client User {name} not found.", "NOT_FOUND")

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
    def _open(doc):
        if doc.status == "Cancelled":
            raise ValidationError(request_targets.CANCELLED_TARGET, "VALIDATION_ERROR")

        if doc.status == "Resolved":
            raise ValidationError(
                "This requested target has already been resolved.", "VALIDATION_ERROR"
            )

    @staticmethod
    def create_or_update_draft(request, subject_key, requester_values):
        """Write the person a draft request describes, once per subject key."""
        row = RequestedClientUserService._request(request)

        if row.status != "Draft" and not requester_edit_open(request):
            raise ValidationError(
                "A requested person can only be written while the request is a draft.",
                "VALIDATION_ERROR",
            )

        if not subject_key:
            raise ValidationError("subject_key is required.", "VALIDATION_ERROR")

        values = request_targets.cleaned(requester_values, REQUESTER_FIELDS)

        if not values.get("full_name"):
            raise ValidationError("A full name is required.", "VALIDATION_ERROR")

        existing = frappe.db.get_value(
            DOCTYPE, {"source_key": source_key_for(request, subject_key)}, "name"
        )

        if existing:
            doc = frappe.get_doc(DOCTYPE, existing)
        else:
            doc = frappe.get_doc(
                {
                    "doctype": DOCTYPE,
                    "request": request,
                    "customer": row.customer,
                    "subject_key": subject_key,
                    "status": "Open",
                }
            )

        for field in REQUESTER_FIELDS:
            doc.set(field, values.get(field))

        doc.requested_snapshot_json = request_targets.snapshot_of(values, REQUESTER_FIELDS)

        if existing:
            doc.save(ignore_permissions=True)
        else:
            doc.insert(ignore_permissions=True)

        return doc.name

    @staticmethod
    def freeze(request):
        """Refresh the requested snapshot of every open Requested Client User from its final values."""
        row = RequestedClientUserService._request(request)

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

        doc = RequestedClientUserService._load(name)
        guard_request_work(DOCTYPE, doc, review=True)
        RequestedClientUserService._open(doc)

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

        return RequestedEntityPresentation.client_user(name)

    @staticmethod
    def _resolve(doc, client_user, mode):
        doc.resolution_mode = mode
        doc.resolved_client_user = client_user
        doc.status = "Resolved"
        doc.resolved_by = frappe.session.user
        doc.resolved_at = frappe.utils.now_datetime()
        doc.save(ignore_permissions=True)

        request_targets.refresh_work_orders(
            doc.request,
            doc.name,
            client_user,
            (
                ("requested_client_user", "client_user"),
                ("requested_holder_requested_client_user", "requested_holder"),
            ),
        )
        request_targets.settle_retired_work(DOCTYPE, doc, client_user)

        for device in frappe.get_all(
            "MSP Requested Device",
            filters={
                "request": doc.request,
                "intended_holder_requested_client_user": doc.name,
                "status": "Resolved",
            },
            pluck="name",
            order_by="creation asc",
        ):
            hand_to_intended_holder(frappe.get_doc("MSP Requested Device", device))

    @staticmethod
    def resolve_create(name, prepared_values=None):
        """Create the Client User this Requested Client User stands for, once."""
        RequestService._guard_internal()

        doc = RequestedClientUserService._load(name)
        guard_request_work(DOCTYPE, doc)

        if doc.status == "Resolved":
            if doc.resolution_mode == "Create New":
                return doc.resolved_client_user

            raise ValidationError(request_targets.CONFLICTING_RESOLUTION, "VALIDATION_ERROR")

        RequestedClientUserService._open(doc)

        doc.update(request_targets.cleaned(prepared_values, PREPARED_FIELDS))

        asked = json.loads(doc.requested_snapshot_json or "{}").get("department")
        agreed = bool(asked) and DepartmentService._normalized(asked) == DepartmentService._normalized(
            doc.department
        )
        doc.department = DepartmentService.validate_department(
            doc.department, required=True, allow_disabled=agreed
        )

        savepoint = "resolve_requested_client_user"
        frappe.db.savepoint(savepoint)

        try:
            created = UserService.create_client_user(
                customer=doc.customer,
                full_name=doc.full_name,
                department=doc.department,
                email=doc.email,
                username=doc.username,
                start_date=doc.start_date,
                source_request=doc.request,
                department_already_agreed=agreed,
                _commit=False,
            )

            if doc.external_employee_id:
                frappe.db.set_value(
                    "MSP Client User", created["name"], "external_employee_id", doc.external_employee_id
                )

            doc.flags.department_already_agreed = agreed
            RequestedClientUserService._resolve(doc, created["name"], "Create New")
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise

        frappe.db.commit()

        return created["name"]

    @staticmethod
    def resolve_existing(name, client_user):
        """Resolve to a Client User a person deliberately chose."""
        RequestService._guard_internal()

        doc = RequestedClientUserService._load(name)
        guard_request_work(DOCTYPE, doc)

        if not client_user:
            raise ValidationError("Select a Client User.", "VALIDATION_ERROR")

        if doc.status == "Resolved":
            if doc.resolved_client_user == client_user:
                return client_user

            raise ValidationError(request_targets.CONFLICTING_RESOLUTION, "VALIDATION_ERROR")

        RequestedClientUserService._open(doc)

        person = frappe.db.get_value(
            "MSP Client User", client_user, ["customer", "lifecycle_status"], as_dict=True
        )

        if not person:
            raise NotFoundError(f"Client User {client_user} not found.", "NOT_FOUND")

        if person.customer != doc.customer:
            raise ValidationError(request_targets.CROSS_CUSTOMER, "VALIDATION_ERROR")

        if person.lifecycle_status in UNSELECTABLE_STATUSES:
            raise ValidationError(request_targets.DISABLED_SELECTION, "VALIDATION_ERROR")

        savepoint = "resolve_requested_client_user"
        frappe.db.savepoint(savepoint)

        try:
            identifiers.record_username(client_user, doc.username)
            RequestedClientUserService._resolve(doc, client_user, "Use Existing")
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise

        frappe.db.commit()

        return client_user

    @staticmethod
    def cancel(name, reason=None):
        """Cancel a Requested Client User that has not been resolved."""
        RequestService._guard_internal()

        doc = RequestedClientUserService._load(name)
        guard_request_work(DOCTYPE, doc)

        if doc.status == "Cancelled":
            return RequestedEntityPresentation.client_user(name)

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

        return RequestedEntityPresentation.client_user(name)

    @staticmethod
    def selectable_client_user_page(customer, search=None, limit=None):
        """The first Client Users of a customer matching a search, with how many match in all."""
        if not customer:
            raise ValidationError("customer is required.", "VALIDATION_ERROR")

        or_filters = None
        search = (search or "").strip()

        if search:
            pattern = f"%{search}%"
            or_filters = [
                ["name", "like", pattern],
                ["full_name", "like", pattern],
                ["username", "like", pattern],
                ["email", "like", pattern],
                ["department", "like", pattern],
            ]

        rows = frappe.get_all(
            "MSP Client User",
            filters={"customer": customer},
            or_filters=or_filters,
            fields=["name", "full_name", "department", "username", "email", "lifecycle_status"],
            order_by="creation desc",
            limit_page_length=selector_limit(limit),
        )

        for row in rows:
            row["selectable"] = row.lifecycle_status not in UNSELECTABLE_STATUSES
            row["disabled_reason"] = None if row["selectable"] else request_targets.DISABLED_SELECTION

        total = len(
            frappe.get_all(
                "MSP Client User",
                filters={"customer": customer},
                or_filters=or_filters,
                pluck="name",
                limit_page_length=0,
            )
        )

        return {"rows": rows, "total": total, "truncated": total > len(rows)}
