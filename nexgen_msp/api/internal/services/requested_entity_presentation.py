import json

import frappe

from nexgen_msp.utils import operations, request_targets

CLIENT_USER = "MSP Requested Client User"
DEVICE = "MSP Requested Device"

READINESS_BADGE = {
    "needs_review": "NEEDS REVIEW",
    "needs_information": "NEEDS INFORMATION",
    "ready": "READY",
    "resolved": "RESOLVED",
    "cancelled": "CANCELLED",
}

CLIENT_USER_FIELDS = (
    "full_name",
    "department",
    "email",
    "username",
    "external_employee_id",
    "start_date",
    "notes",
)

DEVICE_FIELDS = (
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
    "notes",
)


class RequestedEntityPresentation:
    @staticmethod
    def of(kind, name):
        """The presentation of one Requested entity, by kind."""
        if kind == "client_user":
            return RequestedEntityPresentation.client_user(name)

        return RequestedEntityPresentation.device(name)

    @staticmethod
    def client_user(name):
        """One Requested Client User, as every screen reads it."""
        doc = frappe.get_doc(CLIENT_USER, name)
        readiness = RequestedEntityPresentation._readiness(doc, doc.full_name and doc.department)
        department = doc.department
        resolved_to = None

        if doc.resolved_client_user:
            resolved_to = {
                "doctype": "MSP Client User",
                "name": doc.resolved_client_user,
                "label": frappe.db.get_value("MSP Client User", doc.resolved_client_user, "full_name")
                or doc.resolved_client_user,
                "mode": doc.resolution_mode,
            }

        work = RequestedEntityPresentation._lines(CLIENT_USER, doc)

        return {
            "kind": "client_user",
            "name": doc.name,
            "key": doc.subject_key,
            "display_name": doc.full_name,
            "context_label": "Requested Client User" + (f" · {department}" if department else ""),
            "status": doc.status,
            "readiness": readiness,
            "badge": RequestedEntityPresentation._badge(doc, readiness, "NEW"),
            "resolved_to": resolved_to,
            "requested_snapshot": json.loads(doc.requested_snapshot_json or "{}"),
            "prepared_values": {field: doc.get(field) for field in CLIENT_USER_FIELDS},
            "requested_work_count": len(work),
            "relationship_summary": [
                f"{RequestedEntityPresentation._machine_label(line)}: "
                f"{RequestedEntityPresentation._holder_before(line) or 'Unassigned'} → {doc.full_name}"
                for line in work
                if line.requested_holder_requested_client_user == doc.name
            ],
            **RequestedEntityPresentation._cancellation(doc),
        }

    @staticmethod
    def device(name):
        """One Requested Device, as every screen reads it."""
        doc = frappe.get_doc(DEVICE, name)
        readiness = RequestedEntityPresentation._readiness(doc, doc.hostname and doc.serial_number)
        resolved_to = None

        if doc.resolved_managed_device:
            resolved_to = {
                "doctype": "MSP Managed Device",
                "name": doc.resolved_managed_device,
                "label": frappe.db.get_value(
                    "MSP Managed Device", doc.resolved_managed_device, "hostname"
                )
                or doc.resolved_managed_device,
                "mode": doc.resolution_mode,
            }

        work = RequestedEntityPresentation._lines(DEVICE, doc)
        holder = RequestedEntityPresentation._person_label(
            doc.intended_holder_client_user, doc.intended_holder_requested_client_user
        )

        return {
            "kind": "device",
            "name": doc.name,
            "key": doc.device_requirement_key,
            "display_name": doc.display_label,
            "context_label": "Requested Device" + (f" · {doc.device_type}" if doc.device_type else ""),
            "status": doc.status,
            "readiness": readiness,
            "badge": RequestedEntityPresentation._badge(doc, readiness, "UNRESOLVED"),
            "resolved_to": resolved_to,
            "requested_snapshot": json.loads(doc.requested_snapshot_json or "{}"),
            "prepared_values": {field: doc.get(field) for field in DEVICE_FIELDS},
            "requested_work_count": len(work),
            "relationship_summary": [f"Intended for {holder}"] if holder else [],
            "intended_holder_requested_client_user": doc.intended_holder_requested_client_user or None,
            "blocked_by": request_targets.blocking_holder(doc) if doc.status == "Open" else None,
            **RequestedEntityPresentation._cancellation(doc),
        }

    @staticmethod
    def for_request(request):
        """Every Requested entity of a request: people first, then Devices, newest first in each."""
        people = frappe.get_all(
            CLIENT_USER, filters={"request": request}, pluck="name", order_by="creation desc"
        )
        machines = frappe.get_all(
            DEVICE, filters={"request": request}, pluck="name", order_by="creation desc"
        )

        return [RequestedEntityPresentation.client_user(name) for name in people] + [
            RequestedEntityPresentation.device(name) for name in machines
        ]

    @staticmethod
    def requested_work(kind, name):
        """The requested work that references a Requested entity, with the work order carrying each line."""
        doctype = CLIENT_USER if kind == "client_user" else DEVICE
        doc = frappe.get_doc(doctype, name)
        lines = RequestedEntityPresentation._lines(doctype, doc)
        orders = {
            row.request_line_name: row
            for row in frappe.get_all(
                "MSP Work Order",
                filters={
                    "request": doc.request,
                    "request_line_name": ("in", [line.name for line in lines] or [""]),
                },
                fields=["name", "request_line_name", "status"],
            )
        }

        rows = []

        for line in lines:
            order = orders.get(line.name)
            rows.append(
                {
                    "work_order": order.name if order else None,
                    "line_idx": line.idx,
                    "operation_code": line.operation_code,
                    "operation_label": line.operation_label_snapshot or operations.label(line.operation_code),
                    "target_label": RequestedEntityPresentation._work_target(line),
                    "role": RequestedEntityPresentation._role(doctype, doc.name, line),
                    "line_status": line.line_status,
                    "status": order.status if order else line.line_status,
                }
            )

        return rows

    @staticmethod
    def _cancellation(doc):
        """Why, when and by whom a Requested entity was cancelled, when it was."""
        if doc.status != "Cancelled":
            return {"cancel_reason": None, "cancelled_at": None, "cancelled_by": None}

        return {
            "cancel_reason": doc.cancel_reason,
            "cancelled_at": str(doc.cancelled_at) if doc.cancelled_at else None,
            "cancelled_by": frappe.db.get_value("User", doc.cancelled_by, "full_name") or doc.cancelled_by,
        }

    @staticmethod
    def _readiness(doc, complete):
        if doc.status == "Resolved":
            return "resolved"

        if doc.status == "Cancelled":
            return "cancelled"

        if not doc.reviewed_at:
            return "needs_review"

        if doc.resolution_mode == "Use Existing" or not complete:
            return "needs_information"

        return "ready"

    @staticmethod
    def _badge(doc, readiness, draft_badge):
        status = frappe.db.get_value("MSP Request", doc.request, "status")

        if status == "Draft" and doc.status == "Open":
            return draft_badge

        return READINESS_BADGE[readiness]

    @staticmethod
    def _lines(doctype, doc):
        fields = (
            ("requested_client_user", "requested_for_requested_client_user", "requested_holder_requested_client_user")
            if doctype == CLIENT_USER
            else ("requested_device",)
        )

        return frappe.db.sql(
            f"""
            select
                line.name, line.idx, line.operation_code, line.operation_label_snapshot,
                line.requested_service, line.line_status, line.target_scope,
                line.client_user, line.requested_client_user,
                line.managed_device, line.requested_device, line.state_snapshot,
                line.requested_holder, line.requested_holder_requested_client_user,
                line.requested_for_requested_client_user
            from `tabMSP Request Line` line
            where line.parent = %(request)s
              and line.parenttype = 'MSP Request'
              and ({" or ".join(f"line.{field} = %(name)s" for field in fields)})
            order by line.idx asc
            """,
            {"request": doc.request, "name": doc.name},
            as_dict=True,
        )

    @staticmethod
    def _role(doctype, name, line):
        if doctype == DEVICE or line.requested_client_user == name:
            return "target"

        if line.requested_holder_requested_client_user == name:
            return "holder"

        return "requested_for"

    @staticmethod
    def _work_target(line):
        if line.requested_service:
            return frappe.db.get_value("Item", line.requested_service, "item_name") or line.requested_service

        return RequestedEntityPresentation._machine_label(line)

    @staticmethod
    def _machine_label(line):
        if line.managed_device:
            return frappe.db.get_value("MSP Managed Device", line.managed_device, "hostname") or line.managed_device

        if line.requested_device:
            return frappe.db.get_value(DEVICE, line.requested_device, "display_label") or line.requested_device

        return "Device"

    @staticmethod
    def _holder_before(line):
        snapshot = json.loads(line.state_snapshot or "{}") if line.state_snapshot else {}
        holder = snapshot.get("current_holder")

        return frappe.db.get_value("MSP Client User", holder, "full_name") if holder else None

    @staticmethod
    def _person_label(client_user, requested_client_user):
        if client_user:
            return frappe.db.get_value("MSP Client User", client_user, "full_name") or client_user

        if requested_client_user:
            return frappe.db.get_value(CLIENT_USER, requested_client_user, "full_name") or requested_client_user

        return None
