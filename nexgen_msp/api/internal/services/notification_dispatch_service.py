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
from nexgen_msp.utils.errors import ValidationError

DISPATCH = "MSP Notification Dispatch"
QUEUE = "Email Queue"

NUL = "\0"

# the one failure that is known to have queued nothing, and so is safe to try again
RENDER_FAILED = "render_failed"

# somebody looked at the queue, found nothing, and said so with their name against it
ATTESTED_NOT_SENT = "attested_not_sent"

# what the queue says, said in our words. Neither of the first two means anybody read it.
# "Partially Sent" is deliberately absent: one queue entry can carry several addresses, so
# the entry alone cannot say what became of this one, and only that address's own
# `Email Queue Recipient` row can. Frappe records "Not Sent" or "Sent" there and nothing finer
FROM_QUEUE = {
    "Not Sent": "Queued",
    "Sending": "Queued",
    "Sent": "Sent",
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
            # somebody already holds this delivery, and what may be done about it depends
            # entirely on how far they got
            existing = held["dispatch"]

            if existing.status in ("Queued", "Sent", "Skipped"):
                return {
                    "status": existing.status,
                    "reason": "already_dispatched",
                    "dispatch": existing.name,
                }

            if existing.status == "Failed" and existing.skip_reason == RENDER_FAILED:
                # nothing was ever handed to the queue: the template would not render, which
                # happens before any mail exists. Once it renders, this is the delivery that
                # was always owed, and refusing it for ever would mean a corrected template
                # never reaches the person waiting for it
                if not NotificationDispatchService._claim(existing, lease_seconds=0):
                    return {
                        "status": existing.status,
                        "reason": "held_by_another_worker",
                        "dispatch": existing.name,
                    }
            elif existing.status in ("Unknown", "Failed"):
                # the mail may already be in the queue — that is precisely what Unknown
                # means — and sending again to find out would send it twice. It stays as it
                # is until somebody reconciles it against the queue
                return {
                    "status": existing.status,
                    "reason": "needs_investigation",
                    "dispatch": existing.name,
                }

            if not NotificationDispatchService._claim(existing):
                # either somebody is still working on it, or it was abandoned and has just
                # been recorded as unknown. The row itself says which
                reads = frappe.db.get_value(DISPATCH, existing.name, "status")

                return {
                    "status": reads,
                    "reason": "needs_investigation"
                    if reads == "Unknown"
                    else "held_by_another_worker",
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

        # the claim is attempted inside a savepoint. Losing the race must undo this one
        # insert and nothing else: a business transaction that happened to send a mail is
        # not rolled back because two workers reached for the same delivery
        savepoint = "notification_reserve"
        frappe.db.savepoint(savepoint)

        try:
            doc.insert(ignore_permissions=True)
        except (
            # a duplicate unique *field* raises UniqueValidationError; DuplicateEntryError
            # is what a duplicate *name* raises. Catching only the second meant the worker
            # that lost the race raised instead of being handed the winner's delivery
            frappe.exceptions.UniqueValidationError,
            frappe.exceptions.DuplicateEntryError,
        ):
            frappe.db.rollback(save_point=savepoint)
            found = frappe.db.get_value(DISPATCH, {"dedup_key": key}, "name")

            return {"reserved": False, "dispatch": frappe.get_doc(DISPATCH, found)}

        return {"reserved": True, "dispatch": doc}

    @staticmethod
    def _claim(dispatch, lease_seconds=900):
        """Take over a reservation nobody finished, and only one worker ever may.

        A row left at Pending is a worker that stopped between claiming the delivery and
        queueing the mail. Someone has to finish it, and exactly one someone: the row is
        locked, so of two workers reaching for it the second waits and then finds it is no
        longer theirs to take.

        A reservation younger than the lease is left alone. Its worker is in all likelihood
        still in `sendmail`, and racing them is how one mail becomes two.
        """
        frappe.db.sql(
            "select name from `tabMSP Notification Dispatch` where name = %(name)s for update",
            {"name": dispatch.name},
        )
        fresh = frappe.db.get_value(
            DISPATCH,
            dispatch.name,
            ["status", "reserved_at", "attempt", "skip_reason"],
            as_dict=True,
        )

        if not fresh or fresh.status not in ("Pending", "Failed"):
            return False

        if fresh.reserved_at and frappe.utils.time_diff_in_seconds(
            frappe.utils.now(), fresh.reserved_at
        ) < lease_seconds:
            return False

        # a reservation this old was left by a worker that stopped, and the dangerous
        # moment is the one between the mail being written to the queue and this row being
        # told about it. Nothing durable ties the two together — Frappe's queue carries no
        # mark of ours — so whether that mail exists cannot be established, only guessed at
        # by address and reference. Two notifications to one person about one request fit
        # that guess equally well, and adopting the wrong one loses the reminder while
        # sending again would send twice.
        #
        # So neither. It is recorded as unknown, which is what it is, and somebody looks.
        if fresh.status == "Pending" and fresh.skip_reason != ATTESTED_NOT_SENT:
            NotificationDispatchService._mark(
                dispatch,
                "Unknown",
                failure_reason="Reserved and never finished. Whether a mail was queued "
                "cannot be established from the queue, so it is left for review rather "
                "than risked either way.",
            )
            NotificationSettingsService._write_audit(
                action="Retry Decided",
                rule=dispatch.rule,
                dispatch=dispatch.name,
                recipients=dispatch.recipient,
                attempt=frappe.utils.cint(fresh.attempt),
                reason_code="reservation_abandoned",
                detail="Left as Unknown: no durable link between a dispatch and a queue entry.",
            )

            return False

        frappe.db.set_value(
            DISPATCH,
            dispatch.name,
            {
                "reserved_at": frappe.utils.now(),
                "attempt": frappe.utils.cint(fresh.attempt) + 1,
            },
            update_modified=True,
        )
        dispatch.reload()

        return True

    @staticmethod
    def _queue(dispatch, current, context, cc=None, attachments=None):
        """Render the administrator's template and hand the mail to Frappe's own queue."""
        try:
            subject, message = notifications.render(current["template_name"], context or {})
        except Exception as error:
            NotificationDispatchService._mark(
                dispatch,
                "Failed",
                failure_reason=f"{error}"[:500],
                # said on the record, because this is the one failure that is safe to try
                # again: it happened before anything was handed to the mail queue
                skip_reason=RENDER_FAILED,
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

        queue_id = getattr(queued, "name", None) or (queued if isinstance(queued, str) else None)

        if not queue_id:
            # `sendmail` returned nothing we can trace. Without a queue id the row can never be
            # reconciled, so calling it Queued would be a claim nobody can ever check
            reason = "The mail was handed to the queue but no queue entry could be identified."
            NotificationDispatchService._mark(
                dispatch, "Unknown", subject_snapshot=subject[:140], failure_reason=reason
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
                subject_snapshot=subject[:140],
                attempt=dispatch.attempt,
                reason_code="queue_id_unknown",
                detail=reason,
            )

            return {"status": "Unknown", "reason": "queue_id_unknown", "dispatch": dispatch.name}

        NotificationDispatchService._mark(
            dispatch,
            "Queued",
            subject_snapshot=subject[:140],
            email_queue_id=queue_id,
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

    @staticmethod
    def record_event(
        rule_key,
        recipient,
        template_name,
        subject,
        occurrence,
        queue_id=None,
        revision=None,
        cc=None,
        business_doctype=None,
        business_name=None,
    ):
        """Write down a mail an event already queued, so the history is not only reminders.

        The send itself is the business event's own, and keeps its shape: one message may
        carry several addresses, and this records each of them against the one queue entry
        rather than pretending each was a separate mail.
        """
        address = NotificationDispatchService.normalise(recipient)

        if not address:
            return None

        key = NotificationDispatchService.dedup_key(
            rule_key, business_doctype, business_name, occurrence, address
        )
        # a caller-supplied occurrence can be recorded twice; the second is the same delivery
        held = frappe.db.get_value(DISPATCH, {"dedup_key": key}, "name")

        if held:
            return held

        doc = frappe.new_doc(DISPATCH)
        doc.dedup_key = key
        doc.rule = rule_key
        doc.rule_revision_at_decision = revision or 0
        doc.business_doctype = business_doctype
        doc.business_name = business_name
        doc.event_occurrence_key = occurrence
        doc.reminder_iteration = 0
        doc.recipient = address
        doc.cc_snapshot = ", ".join(cc or [])
        doc.template_name = template_name
        doc.subject_snapshot = (subject or "")[:140]
        doc.status = "Queued" if queue_id else "Unknown"
        doc.email_queue_id = queue_id
        doc.reserved_at = frappe.utils.now()
        doc.queued_at = frappe.utils.now() if queue_id else None
        doc.attempt = 1
        doc.insert(ignore_permissions=True)

        NotificationSettingsService._write_audit(
            action="Queued" if queue_id else "Failed",
            rule=rule_key,
            rule_revision=revision,
            dispatch=doc.name,
            business_doctype=business_doctype,
            business_name=business_name,
            recipients=address,
            template_name=template_name,
            subject_snapshot=(subject or "")[:140],
            attempt=1,
            reason_code="queued" if queue_id else "queue_id_unknown",
        )

        return doc.name

    # ------------------------------------------------------------------ resolving by hand
    @staticmethod
    def evidence(dispatch_name):
        """The queue entries that could be the mail this delivery was going to send.

        Shown rather than chosen. Nothing durable ties a dispatch to an entry in Frappe's
        queue, so these are candidates on the strength of the address, the record and the
        moment — which is enough for a person looking at them, and was never enough for
        this application to pick one on its own.
        """
        NotificationSettingsService._guard()
        doc = frappe.get_doc(DISPATCH, dispatch_name)

        rows = frappe.db.sql(
            """
            select queue.name, queue.status, queue.creation, queue.reference_doctype,
                   queue.reference_name, queue.message
            from `tabEmail Queue` queue
            join `tabEmail Queue Recipient` person on person.parent = queue.name
            where person.recipient = %(recipient)s
              and queue.creation >= %(since)s
              and not exists (
                select 1 from `tabMSP Notification Dispatch` other
                where other.email_queue_id = queue.name
              )
            order by queue.creation desc
            limit 20
            """,
            {
                "recipient": doc.recipient,
                "since": doc.reserved_at
                or frappe.utils.add_to_date(doc.creation, hours=-1),
            },
            as_dict=True,
        )

        return {
            "dispatch": {
                "name": doc.name,
                "rule": doc.rule,
                "status": doc.status,
                "recipient": doc.recipient,
                "business_doctype": doc.business_doctype,
                "business_name": doc.business_name,
                "reminder_iteration": doc.reminder_iteration,
                "subject_snapshot": doc.subject_snapshot,
                "reserved_at": doc.reserved_at,
                "failure_reason": doc.failure_reason,
            },
            "candidates": [
                {
                    "email_queue": row.name,
                    "status": row.status,
                    "created": row.creation,
                    "reference": f"{row.reference_doctype or ''} {row.reference_name or ''}".strip(),
                    # enough of the mail to recognise it, never the whole of it: a reset
                    # link lives in that body
                    "about": (row.message or "")[:0] or None,
                }
                for row in rows
            ],
            "decisions": ["link", "not_sent"],
        }

    @staticmethod
    def resolve(dispatch_name, decision, email_queue=None, note=None):
        """Settle a delivery nobody could settle automatically, on an administrator's word.

        Two answers are possible and both are theirs to give. Either the mail is there and
        this is which one it is, or it never went and the delivery is owed again. Whichever
        they say is written down with their name against it, because an automatic engine
        that cannot know something should not be the thing that decided it.
        """
        NotificationSettingsService._guard()

        if decision not in ("link", "not_sent"):
            raise ValidationError(
                "Say whether the mail was found or was never sent.", "VALIDATION_ERROR"
            )

        reason = str(note or "").strip()

        if not reason:
            raise ValidationError(
                "Say what you looked at before deciding.", "VALIDATION_ERROR"
            )

        # held while it is settled, so two administrators cannot each resolve it their way
        frappe.db.sql(
            "select name from `tabMSP Notification Dispatch` where name = %(name)s for update",
            {"name": dispatch_name},
        )
        doc = frappe.get_doc(DISPATCH, dispatch_name)

        if doc.status not in ("Unknown", "Failed"):
            raise ValidationError(
                f"{doc.name} is {doc.status.lower()} and needs nobody to settle it.",
                "INVALID_TRANSITION",
            )

        if decision == "link":
            if not email_queue or not frappe.db.exists(QUEUE, email_queue):
                raise ValidationError("Name the queue entry to attach.", "VALIDATION_ERROR")

            taken = frappe.db.get_value(
                DISPATCH, {"email_queue_id": email_queue, "name": ("!=", doc.name)}, "name"
            )

            if taken:
                raise ValidationError(
                    f"That queue entry already belongs to {taken}.", "VALIDATION_ERROR"
                )

            state = frappe.db.get_value(QUEUE, email_queue, "status")
            NotificationDispatchService._mark(
                doc,
                FROM_QUEUE.get(state, "Unknown"),
                email_queue_id=email_queue,
                queued_at=doc.queued_at or frappe.utils.now(),
                failure_reason=None,
            )
        else:
            # attested as never sent, so the delivery is owed again. It goes back to being
            # reserved rather than being sent from here: the ordinary path sends it, under
            # the same identity, so it still cannot go twice
            NotificationDispatchService._mark(
                doc,
                "Pending",
                reserved_at=frappe.utils.add_to_date(frappe.utils.now(), seconds=-3600),
                failure_reason=None,
                # marked, or the guard above would read this as another abandoned
                # reservation and put it straight back to unknown
                skip_reason=ATTESTED_NOT_SENT,
            )

        NotificationSettingsService._write_audit(
            action="Retry Decided",
            rule=doc.rule,
            dispatch=doc.name,
            business_doctype=doc.business_doctype,
            business_name=doc.business_name,
            recipients=doc.recipient,
            attempt=frappe.utils.cint(doc.attempt),
            reason_code=f"resolved_{decision}",
            detail=f"{reason}"[:500] + (f" · {email_queue}" if email_queue else ""),
        )
        frappe.db.commit()

        return {"status": frappe.db.get_value(DISPATCH, doc.name, "status")}

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
        recipients_of = {}

        for row in rows:
            state = frappe.db.get_value(QUEUE, row.email_queue_id, "status")

            if not state:
                continue

            if state == "Partially Sent":
                if row.email_queue_id not in recipients_of:
                    recipients_of[row.email_queue_id] = (
                        NotificationDispatchService._queue_recipients(row.email_queue_id)
                    )

                reads, reason = NotificationDispatchService._read_recipient(
                    recipients_of[row.email_queue_id], row.recipient
                )
            else:
                reads, reason = FROM_QUEUE.get(state), None

                if reads == "Failed":
                    reason = f"The mail queue reports {state}."

            if not reads or reads == row.status:
                continue

            frappe.db.set_value(
                DISPATCH,
                row.name,
                {
                    "status": reads,
                    "sent_at": frappe.utils.now() if reads == "Sent" else None,
                    "failure_reason": reason,
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

    @staticmethod
    def _queue_recipients(queue_id):
        """What Frappe recorded for each address of one queue entry, keyed by address."""
        rows = frappe.get_all(
            "Email Queue Recipient",
            filters={"parent": queue_id, "parenttype": QUEUE},
            fields=["recipient", "status", "error"],
        )

        return {NotificationDispatchService.normalise(row.recipient): row for row in rows}

    @staticmethod
    def _read_recipient(recipients, address):
        """This address's own outcome inside a partially sent entry.

        Never `Sent` unless this address's row says so. An address whose row is missing, or
        still "Not Sent" with nothing said about why, is `Unknown`: the entry did go out in
        part, and nothing here says it was this part.
        """
        found = recipients.get(NotificationDispatchService.normalise(address))

        if not found:
            return "Unknown", "The mail queue partly sent this message and holds no record for this address."

        if found.status == "Sent":
            return "Sent", None

        if found.error:
            return "Failed", f"{found.error}"[:500]

        return "Unknown", "The mail queue partly sent this message and this address was not marked sent."

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
