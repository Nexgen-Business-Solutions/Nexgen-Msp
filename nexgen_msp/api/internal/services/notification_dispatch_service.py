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
from nexgen_msp.api.internal.services.notification_template_service import (
    NotificationTemplateService,
)
from nexgen_msp.utils import notifications
from nexgen_msp.utils.errors import ValidationError

# the only outcomes of `deliver` that prove nothing was handed to the mail queue. Every
# other one — queued, held by another worker, or an outcome nobody can confirm — may have
# put a message in front of somebody, and a caller deciding what else to send has to treat
# it that way. `Unknown` exists precisely because the answer is not known
QUEUED_NOTHING = ("no_recipient", "rule_disabled", "render_failed")

DISPATCH = "MSP Notification Dispatch"
RULE = "MSP Notification Rule"
QUEUE = "Email Queue"

NUL = "\0"

RECONCILE_CURSOR = "msp_notification_reconcile"

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
        bcc=None,
        is_test=False,
        attachments=None,
        rendered=None,
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
            bcc=bcc,
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

            # a failure that is known to have queued nothing: the template would not render,
            # which happens before any mail exists, or an administrator attested that none
            # exists. Once it can be sent, this is the delivery that was always owed, and
            # refusing it for ever would mean it never reaches the person waiting for it
            retryable = existing.status == "Failed" and existing.skip_reason in (
                RENDER_FAILED,
                ATTESTED_NOT_SENT,
            )

            if existing.status in ("Unknown", "Failed") and not retryable:
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
            held["dispatch"],
            current,
            context,
            cc=cc,
            bcc=bcc,
            attachments=attachments,
            rendered=rendered,
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
        doc.channel = "To"
        # who this attempt intends to reach, written before anything is sent. An outcome
        # nobody can confirm leaves this row as the only evidence of what was attempted,
        # and an administrator reconciling it against the queue needs every address on it
        doc.cc_snapshot = ", ".join(fields.get("cc") or [])
        doc.bcc_snapshot = ", ".join(fields.get("bcc") or [])
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

        retryable = fresh.status == "Failed" and fresh.skip_reason in (
            RENDER_FAILED,
            ATTESTED_NOT_SENT,
        )

        if (
            not retryable
            and fresh.reserved_at
            and frappe.utils.time_diff_in_seconds(frappe.utils.now(), fresh.reserved_at)
            < lease_seconds
        ):
            return False

        # a reservation this old was left by a worker that stopped, and the dangerous
        # moment is the one between the mail being written to the queue and this row being
        # told about it. A mail queued from here does carry our mark, but a worker that
        # stopped before the mail existed leaves nothing to find, and one that stopped
        # after it still needs somebody to look, so the answer is not guessed either way.
        # Sending again would send twice and adopting the wrong entry loses the reminder.
        #
        # So neither. It is recorded as unknown, which is what it is, and somebody looks.
        if fresh.status == "Pending":
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
                detail="Left as Unknown: the reservation was abandoned before it was recorded.",
            )

            return False

        taken = {
            "reserved_at": frappe.utils.now(),
            "attempt": frappe.utils.cint(fresh.attempt) + 1,
        }

        if retryable:
            taken.update({"status": "Pending", "skip_reason": None, "failure_reason": None})

        frappe.db.set_value(DISPATCH, dispatch.name, taken, update_modified=True)
        dispatch.reload()

        return True

    @staticmethod
    def _queue(dispatch, current, context, cc=None, bcc=None, attachments=None, rendered=None):
        """Render the administrator's template and hand the mail to Frappe's own queue.

        `rendered` is wording somebody is testing from the template editor, handed down
        rather than looked up. It still goes through the reservation, the queue and the
        audit below: a test that took a shortcut would prove nothing about a real send.
        """
        # what the choice of wording was, carried into whichever outcome below is recorded
        # rather than written on its own. A row is marked exactly once per attempt, and an
        # extra write here would be a second one on the hot path of every mail
        language = {}

        try:
            built = rendered or NotificationTemplateService.for_delivery(
                current["template_name"],
                dispatch.recipient,
                NotificationDispatchService._customer_of(
                    dispatch.business_doctype, dispatch.business_name
                ),
                context or {},
            )
            subject, message = built["subject"], built["html"]
            language = {
                "resolved_locale": built.get("locale"),
                "template_revision": frappe.utils.cint(built.get("revision")),
                "language_source": built.get("language_source"),
                "fallback_reason": built.get("fallback_reason"),
            }
        except Exception as error:
            NotificationDispatchService._mark(
                dispatch,
                "Failed",
                **language,
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
        blind = [
            address
            for address in (bcc or [])
            if address and NotificationDispatchService.normalise(address) != dispatch.recipient
        ]

        try:
            queued = frappe.sendmail(
                recipients=[dispatch.recipient],
                cc=copies or None,
                bcc=blind or None,
                subject=f"[Test] {subject}" if dispatch.is_test else subject,
                message=message,
                reference_doctype=dispatch.business_doctype or None,
                reference_name=dispatch.business_name or None,
                attachments=attachments or None,
                # the one durable tie between this delivery and its queue entry. Opaque on
                # purpose: the dispatch name carries no address and no record. It names this
                # delivery's own recipient only; a cc'd address shares the entry without
                # being what the marker is about
                message_id=dispatch.name,
                # an automated send is never immediate: the queue is what makes a crash
                # recoverable, and `now` would send outside it
                now=False,
            )
        except Exception as error:
            # an unknown outcome stays unknown. Resending here is exactly how one mail
            # becomes two
            NotificationDispatchService._mark(
                dispatch, "Unknown", **language, failure_reason=f"{error}"[:500]
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
                dispatch, "Unknown", **language, subject_snapshot=subject[:140], failure_reason=reason
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
            **language,
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
    def _customer_of(business_doctype, business_name):
        """The company a delivery is about, when its record names one.

        Asked of the record rather than carried along, because the one caller that could
        carry it is the one that has it already. An account notification names no company
        at all, and that is an answer rather than a gap.
        """
        if not business_doctype or not business_name:
            return None

        try:
            if not frappe.get_meta(business_doctype).has_field("customer"):
                return None
        except Exception:
            return None

        return frappe.db.get_value(business_doctype, business_name, "customer")

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
        bcc=None,
        business_doctype=None,
        business_name=None,
        language=None,
        channel="To",
        iteration=0,
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
        # the channel is part of neither the key nor the identity: the question a delivery
        # answers is "was this person told", and being told twice over on two channels is
        # one telling. The precedence rule has already settled which channel that was
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
        doc.reminder_iteration = frappe.utils.cint(iteration)
        doc.recipient = address
        doc.channel = channel
        doc.cc_snapshot = ", ".join(cc or [])
        doc.bcc_snapshot = ", ".join(bcc or [])
        doc.template_name = template_name
        doc.resolved_locale = (language or {}).get("locale")
        doc.template_revision = frappe.utils.cint((language or {}).get("revision"))
        doc.language_source = (language or {}).get("language_source")
        doc.fallback_reason = (language or {}).get("fallback_reason")
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
    def marker_of(stored):
        """The dispatch a queue entry was written for, or nothing if it says none.

        Frappe keeps the `message_id` it was given as it is, and only wraps it in angle
        brackets and a domain on the wire, so what is read back is normally the bare name.
        It is still unwrapped, because the same header comes back that way from a mail that
        has travelled, and only a name that really is one of ours counts: any other
        message id is somebody else's and says nothing about us.
        """
        name = (stored or "").strip().strip("<>").split("@", 1)[0].strip()

        if not name or not frappe.db.exists(DISPATCH, name):
            return None

        return name

    @staticmethod
    def evidence(dispatch_name):
        """The queue entries that could be the mail this delivery was going to send.

        Shown rather than chosen. An entry that carries this delivery's own mark is proof
        and is listed first, flagged `matched`. An entry written before the mark existed has
        only the address, the record and the moment to go on, which is enough for a person
        looking at them and was never enough for this application to pick one on its own,
        so those are flagged unmatched. An entry marked for another delivery is not offered
        at all: it is that delivery's mail, even where this address was a cc on it.
        """
        NotificationSettingsService._guard()
        doc = frappe.get_doc(DISPATCH, dispatch_name)

        rows = frappe.db.sql(
            """
            select queue.name, queue.status, queue.creation, queue.reference_doctype,
                   queue.reference_name, queue.message_id
            from `tabEmail Queue` queue
            join `tabEmail Queue Recipient` person on person.parent = queue.name
            where person.recipient = %(recipient)s
              and queue.creation >= %(since)s
              and not exists (
                select 1 from `tabMSP Notification Dispatch` other
                where other.email_queue_id = queue.name
                  and (
                    other.rule != %(rule)s
                    or ifnull(other.business_doctype, '') != %(business_doctype)s
                    or ifnull(other.business_name, '') != %(business_name)s
                    or ifnull(other.event_occurrence_key, '') != %(occurrence)s
                  )
              )
            order by queue.message_id = %(name)s desc, queue.creation desc
            limit 20
            """,
            {
                "name": doc.name,
                "recipient": doc.recipient,
                "rule": doc.rule,
                "business_doctype": doc.business_doctype or "",
                "business_name": doc.business_name or "",
                "occurrence": doc.event_occurrence_key or "",
                "since": doc.reserved_at
                or frappe.utils.add_to_date(doc.creation, hours=-1),
            },
            as_dict=True,
        )

        candidates = []

        for row in rows:
            marker = NotificationDispatchService.marker_of(row.message_id)
            # the mark names the delivery the message was built for. On a copy that is the
            # direct recipient's delivery, not this one, so the question is whether the
            # mark belongs to this same attempt rather than to this same row
            ours = NotificationDispatchService._same_attempt(doc, marker) if marker else False

            if marker and not ours:
                continue

            candidates.append(
                {
                    "email_queue": row.name,
                    "status": row.status,
                    "created": row.creation,
                    "reference": f"{row.reference_doctype or ''} {row.reference_name or ''}".strip(),
                    "matched": ours,
                }
            )

        candidates.sort(key=lambda candidate: not candidate["matched"])

        return {
            "dispatch": {
                "name": doc.name,
                "rule": doc.rule,
                "rule_label": registry.rule_label(
                    doc.rule, frappe.db.get_value(RULE, doc.rule, "display_name")
                ),
                "status": doc.status,
                "recipient": doc.recipient,
                "channel": doc.channel or "To",
                "business_doctype": doc.business_doctype,
                "business_name": doc.business_name,
                "reminder_iteration": doc.reminder_iteration,
                "subject_snapshot": doc.subject_snapshot,
                "reserved_at": doc.reserved_at,
                "failure_reason": doc.failure_reason,
                "reason_label": registry.reason_label(doc.skip_reason) or doc.failure_reason,
                "template_name": doc.template_name,
                "resolved_locale": doc.resolved_locale,
                "locale_label": (
                    registry.locale_label(doc.resolved_locale) if doc.resolved_locale else None
                ),
                "template_revision": doc.template_revision,
                "language_source_label": registry.language_source_label(doc.language_source),
                "fallback_label": registry.reason_label(doc.fallback_reason),
            },
            "candidates": candidates,
            "decisions": ["link", "not_sent"],
        }

    @staticmethod
    def _same_attempt(doc, other_name):
        """Whether another delivery is this same attempt, reached at a different address.

        One message carries a direct recipient and its copies, so one queue entry really is
        the mail of several deliveries — but only of the ones that message was: same rule,
        same record, same occurrence. Anything else is another message's mail, and wearing
        its outcome would report a letter as having gone to somebody who never got one.
        """
        if not other_name or other_name == doc.name:
            return True

        other = frappe.db.get_value(
            DISPATCH,
            other_name,
            ["rule", "business_doctype", "business_name", "event_occurrence_key"],
            as_dict=True,
        )

        if not other:
            return False

        return all(
            (other.get(field) or "") == (doc.get(field) or "")
            for field in ("rule", "business_doctype", "business_name", "event_occurrence_key")
        )

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

            shared = frappe.get_all(
                DISPATCH,
                filters={"email_queue_id": email_queue, "name": ("!=", doc.name)},
                pluck="name",
            )
            taken = next(
                (
                    name
                    for name in shared
                    if not NotificationDispatchService._same_attempt(doc, name)
                ),
                None,
            )

            if taken:
                raise ValidationError(
                    f"That queue entry already belongs to {taken}.", "VALIDATION_ERROR"
                )

            # an entry marked for another delivery is that delivery's mail, whatever the
            # address and the record say; an unmarked one predates the mark and is judged
            # by the checks below, exactly as it always was
            marked = NotificationDispatchService.marker_of(
                frappe.db.get_value(QUEUE, email_queue, "message_id")
            )

            if marked and not NotificationDispatchService._same_attempt(doc, marked):
                raise ValidationError(
                    f"That queue entry was written for {marked}, not for this delivery.",
                    "VALIDATION_ERROR",
                )

            # the entry has to be a mail to this person: attached to one addressed to
            # somebody else, this delivery would wear that mail's outcome and report a
            # letter as having gone to a customer who never received one
            written_to = {
                (address or "").strip().lower()
                for address in frappe.get_all(
                    "Email Queue Recipient",
                    filters={"parent": email_queue, "parenttype": QUEUE},
                    pluck="recipient",
                )
            }

            if doc.recipient not in written_to:
                raise ValidationError(
                    f"That queue entry was not written to {doc.recipient}.",
                    "VALIDATION_ERROR",
                )

            # and about the same record. Where this delivery names one, the entry has to
            # name the same one — the same doctype as well as the same name, since two
            # records of different kinds can share a name. An entry that names nothing is
            # not evidence either: it could be any mail to this person
            about = frappe.db.get_value(
                QUEUE, email_queue, ["reference_doctype", "reference_name", "creation"], as_dict=True
            )

            if doc.business_name and (
                not about
                or about.reference_name != doc.business_name
                or (doc.business_doctype and about.reference_doctype != doc.business_doctype)
            ):
                raise ValidationError(
                    "That queue entry is not about "
                    f"{doc.business_doctype or ''} {doc.business_name}.".replace("  ", " "),
                    "VALIDATION_ERROR",
                )

            # and written after this delivery was claimed: a mail that existed before
            # cannot be the one this worker was about to send
            if (
                doc.reserved_at
                and about
                and frappe.utils.get_datetime(about.creation)
                < frappe.utils.get_datetime(doc.reserved_at)
            ):
                raise ValidationError(
                    "That queue entry was written before this delivery was claimed.",
                    "VALIDATION_ERROR",
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
            # attested as never sent, so the delivery is owed again. It is not sent from
            # here: whatever raises it next goes through under the same identity, so it
            # still cannot go twice
            NotificationDispatchService._mark(
                doc,
                "Failed",
                email_queue_id=None,
                failure_reason="An administrator attested that no mail exists for this delivery.",
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

        return {
            "status": frappe.db.get_value(DISPATCH, doc.name, "status"),
            "retry": NotificationDispatchService._retry_of(doc)
            if decision == "not_sent"
            else None,
        }

    @staticmethod
    def _retry_of(dispatch):
        """Who will raise this delivery again: the scheduler, or a person repeating the action."""
        declared = registry.rule(dispatch.rule)

        if not declared or declared.get("kind") != registry.REMINDER:
            return "manual"

        current = NotificationSettingsService.effective(dispatch.rule)

        if not current["enabled"]:
            return "manual"

        adapter = registry.condition(
            registry.effective_condition_key(dispatch.rule, current.get("condition_key"))
        )

        if not adapter or not dispatch.business_doctype or not dispatch.business_name:
            return "manual"

        if not frappe.db.exists(adapter["doctype"], dispatch.business_name):
            return "manual"

        for field, wanted in registry.watch_filters(
            adapter, current.get("stop_condition_key")
        ).items():
            if frappe.db.get_value(adapter["doctype"], dispatch.business_name, field) != wanted:
                return "manual"

        return "scheduled"

    # ------------------------------------------------------------------ reconciling
    @staticmethod
    def reconcile(limit=200):
        """Read back what the mail infrastructure did with what we handed it.

        Our own status is a claim about the queue, and a claim has to be checked: a mail
        accepted this morning and rejected by the server this afternoon reads as queued
        until somebody looks.
        """
        after = NotificationDispatchService._cursor()
        rows = frappe.db.sql(
            f"""
            select name, email_queue_id, status, rule, recipient, attempt, creation
            from `tabMSP Notification Dispatch`
            where status in ('Queued', 'Unknown')
              and ifnull(email_queue_id, '') != ''
              {"and (creation > %(moment)s or (creation = %(moment)s and name > %(last)s))" if after else ""}
            order by creation asc, name asc
            limit %(limit)s
            """,
            {
                "moment": after[0] if after else None,
                "last": after[1] if after else None,
                "limit": frappe.utils.cint(limit),
            },
            as_dict=True,
        )
        moved = 0
        recipients_of = {}

        for row in rows:
            after = (str(row.creation), row.name)

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

        NotificationDispatchService._remember(after if rows else None)
        frappe.db.commit()

        return moved

    @staticmethod
    def _cursor():
        """Where the last pass stopped, kept across restarts.

        Ordering by `modified` would read the same first rows for ever, since a row whose
        status has not changed keeps its timestamp and stays at the head. Both halves of the
        creation order are kept: rows written in the same second share a timestamp.
        """
        stored = frappe.db.get_default(RECONCILE_CURSOR)

        if not stored or "\t" not in stored:
            return None

        moment, last = stored.split("\t", 1)

        return (moment, last) if moment and last else None

    @staticmethod
    def _remember(place):
        frappe.db.set_default(RECONCILE_CURSOR, f"{place[0]}\t{place[1]}" if place else "")

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
            "channel",
            "cc_snapshot",
            "bcc_snapshot",
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
            "resolved_locale",
            "template_revision",
            "language_source",
            "fallback_reason",
        ]

        rows = frappe.get_all(
            DISPATCH,
            filters=filters,
            fields=fields,
            order_by="creation desc",
            start=page * page_length,
            page_length=page_length,
        )
        # the names an administrator gave the rules, read once for the page: a delivery and
        # the rule it came from must be called the same thing on both tables
        named = dict(frappe.get_all(RULE, fields=["name", "display_name"], as_list=True))

        for row in rows:
            row["rule_label"] = registry.rule_label(row["rule"], named.get(row["rule"]))
            row["reason_label"] = registry.reason_label(row.get("skip_reason")) or row.get(
                "failure_reason"
            )
            row["locale_label"] = (
                registry.locale_label(row["resolved_locale"]) if row.get("resolved_locale") else None
            )
            row["language_source_label"] = registry.language_source_label(row.get("language_source"))
            row["fallback_label"] = registry.reason_label(row.get("fallback_reason"))

        return {
            "rows": rows,
            "total": frappe.db.count(DISPATCH, filters),
            "page": page,
            "page_length": page_length,
            "statuses": ["Pending", "Queued", "Sent", "Failed", "Skipped", "Unknown"],
        }
