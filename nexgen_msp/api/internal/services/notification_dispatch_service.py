"""One mail, sent once, whatever the worker does afterwards.

The hard part of a notification engine is not sending; it is not sending twice. A worker
that crashes between queueing a mail and recording that it did must, on its next run, find
the mail it already queued rather than queue another one. So identity comes first: the row
that says "this rule, this record, this occurrence, this address" is written before the
mail exists, under a unique index, and everything else hangs off it.

What this file deliberately does not do is deliver anything itself. Frappe's own email
queue does that, and a second queue beside it would be two half-truths about one mail.
"""

import hashlib

import frappe

from nexgen_msp.api.internal.services import notification_registry as registry
from nexgen_msp.api.internal.services.notification_settings_service import (
    NotificationSettingsService,
)
from nexgen_msp.utils import notifications

DISPATCH = "MSP Notification Dispatch"
QUEUE = "Email Queue"

NUL = "\0"

# what the queue says, said in our words. Neither of the first two means anybody read it
FROM_QUEUE = {
    "Not Sent": "Queued",
    "Sending": "Queued",
    "Sent": "Sent",
    "Partially Sent": "Sent",
    "Error": "Failed",
    "Expired": "Failed",
}


class NotificationDispatchService:
    # ------------------------------------------------------------------ identity
    @staticmethod
    def dedup_key(rule_key, business_doctype, business_name, occurrence, recipient):
        """The identity of one delivery, which is what makes sending it twice impossible.

        Never the record's `modified` timestamp: that changes for reasons that have nothing
        to do with this notification, and an identity that drifts is no identity at all.
        """
        parts = (
            rule_key or "",
            business_doctype or "",
            business_name or "",
            f"{occurrence}" if occurrence is not None else "",
            NotificationDispatchService.normalise(recipient),
        )

        return hashlib.sha256(NUL.join(parts).encode("utf-8")).hexdigest()

    @staticmethod
    def normalise(recipient):
        return (recipient or "").strip().lower()

    # ------------------------------------------------------------------ sending
    @staticmethod
    def deliver(
        rule_key,
        recipient,
        context,
        business_doctype=None,
        business_name=None,
        occurrence=None,
        iteration=0,
        cc=None,
        is_test=False,
        attachments=None,
    ):
        """Queue this notification for this address, once.

        Returns what happened, so a caller can tell "queued" from "already queued" from
        "refused", and so the screens can say which it was instead of guessing.
        """
        declared = registry.require(rule_key)
        current = NotificationSettingsService.effective(rule_key)
        address = NotificationDispatchService.normalise(recipient)

        if not address:
            return {"status": "Skipped", "reason": "no_recipient"}

        if not current["enabled"]:
            NotificationSettingsService._write_audit(
                action="Skipped",
                rule=rule_key,
                rule_revision=current.get("revision"),
                business_doctype=business_doctype,
                business_name=business_name,
                recipients=address,
                reason_code="rule_disabled",
                detail="The administrator has switched this notification off.",
            )

            return {"status": "Skipped", "reason": "rule_disabled"}

        key = NotificationDispatchService.dedup_key(
            rule_key,
            business_doctype,
            business_name,
            f"test:{frappe.generate_hash(length=10)}" if is_test else occurrence,
            address,
        )
        held = NotificationDispatchService._reserve(
            key,
            rule_key=rule_key,
            revision=current.get("revision"),
            business_doctype=business_doctype,
            business_name=business_name,
            occurrence=occurrence,
            iteration=iteration,
            recipient=address,
            cc=cc,
            template_name=current["template_name"],
            is_test=is_test,
        )

        if not held["reserved"]:
            # somebody already holds this delivery. If it never reached the queue, this is
            # the retry that finishes it; otherwise there is nothing left to do
            existing = held["dispatch"]

            if existing.status in ("Queued", "Sent", "Skipped"):
                return {
                    "status": existing.status,
                    "reason": "already_dispatched",
                    "dispatch": existing.name,
                }

        return NotificationDispatchService._queue(
            held["dispatch"], current, context, cc=cc, attachments=attachments
        )

    @staticmethod
    def _reserve(key, **fields):
        """Claim this delivery, or find out who already has.

        The claim is a row with a unique `dedup_key`. Two workers racing both try to write
        it; the database lets exactly one through, and the loser is handed the winner's row
        rather than an error to swallow.
        """
        existing = frappe.db.get_value(DISPATCH, {"dedup_key": key}, "name")

        if existing:
            return {"reserved": False, "dispatch": frappe.get_doc(DISPATCH, existing)}

        doc = frappe.new_doc(DISPATCH)
        doc.dedup_key = key
        doc.rule = fields["rule_key"]
        doc.rule_revision_at_decision = fields.get("revision") or 0
        doc.business_doctype = fields.get("business_doctype")
        doc.business_name = fields.get("business_name")
        doc.event_occurrence_key = (
            f"{fields.get('occurrence')}" if fields.get("occurrence") is not None else None
        )
        doc.reminder_iteration = frappe.utils.cint(fields.get("iteration"))
        doc.recipient = fields["recipient"]
        doc.cc_snapshot = ", ".join(fields.get("cc") or [])
        doc.template_name = fields.get("template_name")
        doc.is_test = 1 if fields.get("is_test") else 0
        doc.status = "Pending"
        doc.reserved_at = frappe.utils.now()
        doc.attempt = 1

        try:
            doc.insert(ignore_permissions=True)
        except frappe.exceptions.DuplicateEntryError:
            # the race, resolved by the database rather than by us
            frappe.db.rollback()
            found = frappe.db.get_value(DISPATCH, {"dedup_key": key}, "name")

            return {"reserved": False, "dispatch": frappe.get_doc(DISPATCH, found)}

        return {"reserved": True, "dispatch": doc}

    @staticmethod
    def _queue(dispatch, current, context, cc=None, attachments=None):
        """Render the administrator's template and hand the mail to Frappe's own queue."""
        try:
            subject, message = notifications.render(current["template_name"], context or {})
        except Exception as error:
            NotificationDispatchService._mark(
                dispatch, "Failed", failure_reason=f"{error}"[:500]
            )
            NotificationSettingsService._write_audit(
                action="Failed",
                rule=dispatch.rule,
                rule_revision=dispatch.rule_revision_at_decision,
                dispatch=dispatch.name,
                business_doctype=dispatch.business_doctype,
                business_name=dispatch.business_name,
                recipients=dispatch.recipient,
                template_name=dispatch.template_name,
                attempt=dispatch.attempt,
                reason_code="render_failed",
                detail=f"{error}"[:500],
            )

            return {"status": "Failed", "reason": "render_failed", "dispatch": dispatch.name}

        copies = [
            address
            for address in (cc or [])
            if address and NotificationDispatchService.normalise(address) != dispatch.recipient
        ]

        try:
            queued = frappe.sendmail(
                recipients=[dispatch.recipient],
                cc=copies or None,
                subject=f"[Test] {subject}" if dispatch.is_test else subject,
                message=message,
                reference_doctype=dispatch.business_doctype or None,
                reference_name=dispatch.business_name or None,
                attachments=attachments or None,
                # an automated send is never immediate: the queue is what makes a crash
                # recoverable, and `now` would send outside it
                now=False,
            )
        except Exception as error:
            # an unknown outcome stays unknown. Resending here is exactly how one mail
            # becomes two
            NotificationDispatchService._mark(
                dispatch, "Unknown", failure_reason=f"{error}"[:500]
            )
            NotificationSettingsService._write_audit(
                action="Failed",
                rule=dispatch.rule,
                rule_revision=dispatch.rule_revision_at_decision,
                dispatch=dispatch.name,
                recipients=dispatch.recipient,
                attempt=dispatch.attempt,
                reason_code="enqueue_failed",
                detail=f"{error}"[:500],
            )

            return {"status": "Unknown", "reason": "enqueue_failed", "dispatch": dispatch.name}

        NotificationDispatchService._mark(
            dispatch,
            "Queued",
            subject_snapshot=subject[:140],
            email_queue_id=getattr(queued, "name", None) or (queued if isinstance(queued, str) else None),
            queued_at=frappe.utils.now(),
        )
        NotificationSettingsService._write_audit(
            action="Test Sent" if dispatch.is_test else "Queued",
            rule=dispatch.rule,
            rule_revision=dispatch.rule_revision_at_decision,
            dispatch=dispatch.name,
            business_doctype=dispatch.business_doctype,
            business_name=dispatch.business_name,
            recipients=dispatch.recipient,
            template_name=dispatch.template_name,
            subject_snapshot=subject[:140],
            attempt=dispatch.attempt,
            reason_code="queued",
        )

        return {"status": "Queued", "dispatch": dispatch.name}

    @staticmethod
    def _mark(dispatch, status, **fields):
        values = {"status": status, **fields}
        frappe.db.set_value(DISPATCH, dispatch.name, values, update_modified=True)
        dispatch.reload()

        return dispatch

    # ------------------------------------------------------------------ reconciling
    @staticmethod
    def reconcile(limit=200):
        """Read back what the mail infrastructure did with what we handed it.

        Our own status is a claim about the queue, and a claim has to be checked: a mail
        accepted this morning and rejected by the server this afternoon reads as queued
        until somebody looks.
        """
        rows = frappe.get_all(
            DISPATCH,
            filters={"status": ("in", ("Queued", "Unknown")), "email_queue_id": ("is", "set")},
            fields=["name", "email_queue_id", "status", "rule", "recipient", "attempt"],
            order_by="modified asc",
            limit=limit,
        )
        moved = 0

        for row in rows:
            state = frappe.db.get_value(QUEUE, row.email_queue_id, "status")

            if not state:
                continue

            reads = FROM_QUEUE.get(state)

            if not reads or reads == row.status:
                continue

            frappe.db.set_value(
                DISPATCH,
                row.name,
                {
                    "status": reads,
                    "sent_at": frappe.utils.now() if reads == "Sent" else None,
                    "failure_reason": f"The mail queue reports {state}."
                    if reads == "Failed"
                    else None,
                },
                update_modified=True,
            )
            NotificationSettingsService._write_audit(
                action="Status Changed",
                rule=row.rule,
                dispatch=row.name,
                recipients=row.recipient,
                attempt=row.attempt,
                reason_code=f"queue_{state.lower().replace(' ', '_')}",
                detail=f"{row.status} -> {reads}",
            )
            moved += 1

        if moved:
            frappe.db.commit()

        return moved

    # ------------------------------------------------------------------ the history
    @staticmethod
    def history(
        rule_key=None, status=None, search=None, business_name=None, page=0, page_length=50
    ):
        """What was attempted, for an administrator and nobody else."""
        NotificationSettingsService._guard()

        page = max(0, frappe.utils.cint(page))
        page_length = min(200, max(1, frappe.utils.cint(page_length) or 50))
        filters = {}

        if rule_key:
            filters["rule"] = rule_key

        if status and status != "all":
            filters["status"] = status

        if business_name:
            filters["business_name"] = business_name

        if search:
            filters["recipient"] = ("like", f"%{search.strip()}%")

        fields = [
            "name",
            "creation",
            "rule",
            "business_doctype",
            "business_name",
            "recipient",
            "cc_snapshot",
            "template_name",
            "subject_snapshot",
            "reminder_iteration",
            "attempt",
            "status",
            "email_queue_id",
            "failure_reason",
            "skip_reason",
            "is_test",
            "queued_at",
            "sent_at",
        ]

        return {
            "rows": frappe.get_all(
                DISPATCH,
                filters=filters,
                fields=fields,
                order_by="creation desc",
                start=page * page_length,
                page_length=page_length,
            ),
            "total": frappe.db.count(DISPATCH, filters),
            "page": page,
            "page_length": page_length,
            "statuses": ["Pending", "Queued", "Sent", "Failed", "Skipped", "Unknown"],
        }
