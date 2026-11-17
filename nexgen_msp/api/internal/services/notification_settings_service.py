"""What the administrator may change about our notifications, and nothing more.

Two readers use this file. The settings screen asks it what the rules are and saves edits
to them, under the administrator's own permissions. The send paths ask it one question —
"is this notification on, and how is it addressed today?" — and must get an answer even
when nobody has ever opened the screen, because a site that was never configured still has
to send its mail.
"""

import json

import frappe

from nexgen_msp.api.internal.services import notification_registry as registry
from nexgen_msp.utils import access
from nexgen_msp.utils.errors import NotFoundError, ValidationError

RULE = "MSP Notification Rule"
AUDIT = "MSP Notification Audit"
DISPATCH = "MSP Notification Dispatch"

# what an administrator is allowed to change. Everything else about a rule is the
# application's, and arrives from the registry rather than from the browser
EDITABLE = (
    "display_name",
    "enabled",
    "template_name",
    "audience_key",
    "initial_delay_value",
    "initial_delay_unit",
    "repeat_interval_value",
    "repeat_interval_unit",
    "max_sends",
    "condition_key",
    "stop_condition_key",
    "timezone",
    "quiet_hours_enabled",
    "quiet_start",
    "quiet_end",
    "escalation_after_iteration",
    "escalation_audience_key",
)

UNITS = ("Hours", "Days", "Weeks")

MAX_PAGE = 200


class NotificationSettingsService:
    # ------------------------------------------------------------------ permissions
    @staticmethod
    def _guard():
        """Administration of our own mail, which is not a technician's job and never a customer's."""
        access.require("manage_settings")

    # ------------------------------------------------------------------ seeding
    @staticmethod
    def seed(_commit=True):
        """Put every notification we own on the record, without touching one already there.

        Run on every migration. A rule the administrator has configured is theirs: the seed
        adds what is missing and reads what exists, it never restores a default over a
        decision somebody made.

        The two reminders this application already sends are seeded switched on, because
        they are already being sent today and a migration that silences them would be a
        regression dressed as a feature. Their cadence, on the other hand, becomes the
        configured one — which is the whole point of the issue, and is stated in the
        handoff rather than applied quietly.
        """
        created = []

        for rule_key, declared in registry.RULES.items():
            if frappe.db.exists(RULE, rule_key):
                continue

            doc = frappe.new_doc(RULE)
            doc.rule_key = rule_key
            doc.display_name = declared["display_name"]
            doc.category = declared["category"]
            doc.kind = declared["kind"]
            doc.trigger_key = declared["trigger_key"]
            doc.template_name = declared["template_name"]
            doc.audience_key = declared["audience_key"]
            doc.enabled = 1
            doc.revision = 1
            # nothing eligible before this instant is owed a reminder: the boundary is what
            # stops a brand new rule mailing a year of history on its first tick
            doc.schedule_effective_at = frappe.utils.now()

            if declared["kind"] == registry.REMINDER:
                for field, value in declared["suggested"].items():
                    doc.set(field, value)

                doc.timezone = frappe.utils.get_system_timezone()

            doc.insert(ignore_permissions=True)
            created.append(rule_key)

        if created and _commit:
            frappe.db.commit()

        return created

    # ------------------------------------------------------------------ runtime read
    @staticmethod
    def effective(rule_key):
        """How this notification is configured right now, read fresh on every send.

        Never cached: the issue asks that a change reaches the next send, and a process
        holding yesterday's answer would keep sending what the administrator switched off.

        A rule missing from the table is read from the registry as enabled. That is what
        keeps a site that has never been configured — or one whose settings table is
        momentarily unreachable — sending the mail it has always sent.
        """
        declared = registry.require(rule_key)
        stored = frappe.db.get_value(
            RULE,
            rule_key,
            [
                "enabled",
                "display_name",
                "template_name",
                "audience_key",
                "revision",
                "initial_delay_value",
                "initial_delay_unit",
                "repeat_interval_value",
                "repeat_interval_unit",
                "max_sends",
                "condition_key",
                "stop_condition_key",
                "timezone",
                "quiet_hours_enabled",
                "quiet_start",
                "quiet_end",
                "escalation_after_iteration",
                "escalation_audience_key",
                "schedule_effective_at",
            ],
            as_dict=True,
        )

        if not stored:
            return {
                "rule_key": rule_key,
                "kind": declared["kind"],
                "enabled": True,
                "protected": declared["protected"],
                "template_name": declared["template_name"],
                "audience_key": declared["audience_key"],
                "revision": 0,
                "configured": False,
                "extra": [],
                "cc": [],
            }

        # read for every other rule, and for a protected one never: a row written before
        # this was refused, or straight into the database, must not reach a send either
        extra, cc = (
            ([], [])
            if declared["protected"]
            else NotificationSettingsService._extra_recipients(rule_key)
        )

        return {
            "rule_key": rule_key,
            "kind": declared["kind"],
            # a protected notification is on whatever the row says: the registry decides,
            # and a row edited straight in the database cannot switch it off
            "enabled": True if declared["protected"] else bool(stored.enabled),
            "protected": declared["protected"],
            "configured": True,
            "extra": extra,
            "cc": cc,
            **{key: stored.get(key) for key in stored if key != "enabled"},
        }

    @staticmethod
    def _extra_recipients(rule_key):
        rows = frappe.get_all(
            "MSP Notification Recipient",
            filters={"parenttype": RULE, "parent": rule_key},
            fields=["email", "kind"],
            order_by="idx asc",
        )

        return (
            [row.email for row in rows if row.kind == "To"],
            [row.email for row in rows if row.kind == "CC"],
        )

    # ------------------------------------------------------------------ the list
    @staticmethod
    def overview(
        search=None, kind=None, category=None, enabled=None, page=0, page_length=50
    ):
        """Every managed notification, with the figures counted over the same filter."""
        NotificationSettingsService._guard()
        NotificationSettingsService.seed()

        page = max(0, frappe.utils.cint(page))
        page_length = min(MAX_PAGE, max(1, frappe.utils.cint(page_length) or 50))

        rows = [
            NotificationSettingsService._row(rule_key)
            for rule_key in registry.RULES
        ]
        rows = [
            row
            for row in rows
            if NotificationSettingsService._matches(row, search, kind, category, enabled)
        ]
        rows.sort(key=lambda row: (row["category"], row["display_name"]))

        return {
            "figures": NotificationSettingsService._figures(),
            "rules": rows[page * page_length : (page + 1) * page_length],
            "total": len(rows),
            "page": page,
            "page_length": page_length,
            "filters": {
                "categories": list(registry.CATEGORIES),
                "kinds": [registry.EVENT, registry.REMINDER],
            },
            # a rule may only be created for something this application already owns, so
            # once all of them are configured there is nothing left to create
            "can_create": sorted(
                key for key in registry.RULES if not frappe.db.exists(RULE, key)
            ),
        }

    @staticmethod
    def _matches(row, search, kind, category, enabled):
        if kind and kind != "all" and row["kind"] != kind:
            return False

        if category and category != "all" and row["category"] != category:
            return False

        if enabled not in (None, "", "all"):
            if enabled == "protected":
                return row["protected"]
            if enabled in ("enabled", "1", 1, True) and not row["enabled"]:
                return False
            if enabled in ("disabled", "0", 0, False) and row["enabled"]:
                return False

        if search:
            haystack = " ".join(
                str(row.get(field) or "")
                for field in ("display_name", "category", "trigger_key", "template_name", "audience_label")
            ).lower()

            if search.strip().lower() not in haystack:
                return False

        return True

    @staticmethod
    def _figures():
        """The counters above the table, counted from the records and never from a sample."""
        managed = len(registry.RULES)
        configured = frappe.get_all(RULE, fields=["rule_key", "enabled", "kind"])
        on = sum(
            1
            for row in configured
            if row.enabled or registry.is_protected(row.rule_key)
        )
        # one counter per state the record really holds: waiting to be taken, handed to the
        # mail queue, gone out, refused, unanswered. Counting the first two together said
        # mail was queued that nothing had yet picked up
        tally = {
            row.status: row.total
            for row in frappe.db.sql(
                """
                select status, count(*) as total
                from `tabMSP Notification Dispatch`
                group by status
                """,
                as_dict=True,
            )
        }

        return {
            "managed": managed,
            "enabled": on,
            "reminders": len(registry.keys(registry.REMINDER)),
            "pending": frappe.utils.cint(tally.get("Pending")),
            "queued": frappe.utils.cint(tally.get("Queued")),
            "sent": frappe.utils.cint(tally.get("Sent")),
            "failed": frappe.utils.cint(tally.get("Failed")),
            "unknown": frappe.utils.cint(tally.get("Unknown")),
        }

    @staticmethod
    def _row(rule_key):
        declared = registry.require(rule_key)
        current = NotificationSettingsService.effective(rule_key)
        audience = registry.audience(current["audience_key"]) or {}
        # the latest moment this rule actually reached the queue, which is the later of the
        # two stamps rather than whichever row was written last
        last = frappe.db.sql(
            """
            select max(coalesce(sent_at, queued_at)) as moment
            from `tabMSP Notification Dispatch`
            where rule = %(rule)s and status in ('Queued', 'Sent')
            """,
            {"rule": rule_key},
            as_dict=True,
        )

        return {
            "rule_key": rule_key,
            "display_name": current.get("display_name") or declared["display_name"],
            "category": declared["category"],
            "kind": declared["kind"],
            "enabled": bool(current["enabled"]),
            "protected": declared["protected"],
            "configured": current["configured"],
            "trigger_key": declared["trigger_key"],
            "trigger_label": registry.trigger_label(
                registry.effective_condition_key(rule_key, current.get("condition_key"))
                if declared["kind"] == registry.REMINDER
                else declared["trigger_key"]
            ),
            "template_name": current["template_name"],
            "audience_key": current["audience_key"],
            "audience_label": audience.get("label")
            or registry.reason_label(current["audience_key"]),
            "cc": current.get("cc") or [],
            "extra": current.get("extra") or [],
            "frequency": NotificationSettingsService._frequency(declared, current),
            "last_sent": last[0].moment if last else None,
            "health": NotificationSettingsService._health(rule_key),
            **NotificationSettingsService._schedule_summary(declared, current),
        }

    @staticmethod
    def _frequency(declared, current):
        """What this notification's cadence is, said in words the table can print.

        An event has none, and saying "every 3 days" of an event would be a lie the screen
        tells about the engine.
        """
        if declared["kind"] == registry.EVENT:
            return "Event-triggered"

        return (
            f"After {current.get('initial_delay_value')} "
            f"{(current.get('initial_delay_unit') or '').lower()}, then every "
            f"{current.get('repeat_interval_value')} "
            f"{(current.get('repeat_interval_unit') or '').lower()}"
        )

    @staticmethod
    def _schedule_summary(declared, current):
        if declared["kind"] == registry.EVENT:
            return {
                "next_due": None,
                "next_due_label": "On next valid event",
                "eligible_count": None,
                "max_sends": None,
            }

        from nexgen_msp.api.internal.services.notification_reminder_service import (
            NotificationReminderService,
        )

        if not current["enabled"]:
            return {
                "next_due": None,
                "next_due_label": "Disabled",
                "eligible_count": 0,
                "max_sends": current.get("max_sends"),
            }

        summary = NotificationReminderService.summary(declared["rule_key"])

        return {
            "next_due": summary["next_due"],
            "next_due_label": summary["next_due_label"],
            "eligible_count": summary["eligible_count"],
            "max_sends": current.get("max_sends"),
        }

    @staticmethod
    def _health(rule_key):
        """What is actually known about this rule's deliveries, or that nothing is.

        "Unknown" is a real answer here. Reading no news as good news is how a mail server
        that stopped accepting anything reads as healthy for a month.
        """
        counts = frappe.db.sql(
            """
            select status, count(*) as total
            from `tabMSP Notification Dispatch`
            where rule = %(rule)s
            group by status
            """,
            {"rule": rule_key},
            as_dict=True,
        )
        by_status = {row.status: row.total for row in counts}

        if not by_status:
            return {"state": "No activity", "failed": 0, "unknown": 0, "queued": 0}

        if by_status.get("Failed"):
            return {
                "state": "Failures",
                "failed": by_status.get("Failed", 0),
                "unknown": by_status.get("Unknown", 0),
                "queued": by_status.get("Queued", 0),
            }

        if by_status.get("Unknown"):
            return {
                "state": "Unknown",
                "failed": 0,
                "unknown": by_status["Unknown"],
                "queued": by_status.get("Queued", 0),
            }

        return {
            "state": "Healthy",
            "failed": 0,
            "unknown": 0,
            "queued": by_status.get("Queued", 0),
        }

    # ------------------------------------------------------------------ one rule
    @staticmethod
    def detail(rule_key):
        """One rule as its editor needs it: what it is, what it may become, what it did."""
        NotificationSettingsService._guard()
        registry.require(rule_key)
        NotificationSettingsService.seed()

        row = NotificationSettingsService._row(rule_key)
        current = NotificationSettingsService.effective(rule_key)

        return {
            "rule": {
                **row,
                **{
                    field: current.get(field)
                    for field in (
                        "initial_delay_value",
                        "initial_delay_unit",
                        "repeat_interval_value",
                        "repeat_interval_unit",
                        "max_sends",
                        "condition_key",
                        "stop_condition_key",
                        "timezone",
                        "quiet_hours_enabled",
                        "quiet_start",
                        "quiet_end",
                        "escalation_after_iteration",
                        "escalation_audience_key",
                        "revision",
                        "schedule_effective_at",
                    )
                },
            },
            "choices": registry.choices(rule_key, current.get("condition_key")),
            "audit": NotificationSettingsService._recent_audit(rule_key),
        }

    @staticmethod
    def _recent_audit(rule_key, limit=20):
        rows = frappe.get_all(
            AUDIT,
            filters={"rule": rule_key},
            fields=[
                "name",
                "creation",
                "action",
                "actor",
                "reason_code",
                "detail",
                "attempt",
                "rule_revision",
                "business_doctype",
                "business_name",
            ],
            order_by="creation desc",
            limit=limit,
        )

        for row in rows:
            row["reason_label"] = registry.reason_label(row.get("reason_code"))

        return rows

    # ------------------------------------------------------------------ saving
    @staticmethod
    def save(rule_key, expected_revision=None, changes=None):
        """Write an administrator's decision, or refuse it whole.

        The revision is what stops two administrators overwriting each other: whoever saves
        second is told the rule moved under them rather than silently winning.
        """
        NotificationSettingsService._guard()
        declared = registry.require(rule_key)
        NotificationSettingsService.seed()

        if isinstance(changes, str):
            try:
                changes = json.loads(changes or "{}")
            except ValueError:
                raise ValidationError("The changes could not be read.", "VALIDATION_ERROR")

        changes = changes or {}

        if not frappe.db.exists(RULE, rule_key):
            raise NotFoundError(f"{rule_key} is not configured.", "NOT_FOUND")

        doc = frappe.get_doc(RULE, rule_key)
        wanted = frappe.utils.cint(expected_revision)

        if expected_revision is not None and wanted != frappe.utils.cint(doc.revision):
            raise ValidationError(
                "This notification was changed by somebody else while you were editing it. "
                "Reload it and apply your change again.",
                "VERSION_CONFLICT",
            )

        if declared["protected"] and "enabled" in changes and not frappe.utils.cint(
            changes["enabled"]
        ):
            raise ValidationError(
                f"{declared['display_name']} keeps people's access to their own account and "
                "cannot be switched off.",
                "VALIDATION_ERROR",
            )

        # a protected notification carries the means of getting into somebody's account: a
        # password reset link, an invitation. Copying one to another address hands that
        # account to whoever holds the copy, and no reason for wanting it is good enough
        if declared["protected"] and changes.get("recipients"):
            raise ValidationError(
                f"{declared['display_name']} reaches the account holder and nobody else. "
                "It carries the means of signing in as them, so it cannot be copied.",
                "PERMISSION_DENIED",
                403,
            )

        refused = sorted(set(changes) - set(EDITABLE) - {"recipients"})

        if refused:
            raise ValidationError(
                f"These are not settings of a notification: {', '.join(refused)}.",
                "VALIDATION_ERROR",
            )

        if "condition_key" in changes and changes["condition_key"] not in (
            None,
            *registry.allowed_conditions(rule_key),
        ):
            raise ValidationError(
                f"{changes['condition_key']} is not a condition {declared['display_name']} can watch.",
                "VALIDATION_ERROR",
            )

        if declared["kind"] == registry.REMINDER and changes.get("stop_condition_key") not in (
            None,
            *(
                stop["key"]
                for stop in registry.choices(
                    rule_key, changes.get("condition_key") or doc.get("condition_key")
                )["stop_conditions"]
            ),
        ):
            raise ValidationError(
                f"{changes['stop_condition_key']} is not a way {declared['display_name']} can stop.",
                "VALIDATION_ERROR",
            )

        before = {field: doc.get(field) for field in EDITABLE}
        was_enabled = bool(doc.enabled)

        for field in EDITABLE:
            if field in changes:
                doc.set(field, changes[field])

        if "recipients" in changes:
            doc.set("recipients", [])

            for entry in changes["recipients"] or []:
                doc.append(
                    "recipients",
                    {
                        "email": (entry or {}).get("email"),
                        "kind": "CC" if (entry or {}).get("kind") == "CC" else "To",
                    },
                )

        doc.revision = frappe.utils.cint(doc.revision) + 1

        # a rule switched on, or whose schedule changed, starts from now: the records that
        # were already eligible are not owed the reminders nobody sent them
        if NotificationSettingsService._schedule_moved(before, changes) or (
            not was_enabled and frappe.utils.cint(doc.enabled)
        ):
            doc.schedule_effective_at = frappe.utils.now()

        if any(
            field in changes and f"{changes[field]}" != f"{before.get(field)}"
            for field in ("condition_key", "stop_condition_key")
        ):
            from nexgen_msp.api.internal.services.notification_reminder_service import (
                NotificationReminderService,
            )

            frappe.db.set_default(NotificationReminderService._cursor_key(rule_key), "")

        doc.save(ignore_permissions=True)

        NotificationSettingsService._write_audit(
            action="Rule Enabled"
            if not was_enabled and doc.enabled
            else "Rule Disabled"
            if was_enabled and not doc.enabled
            else "Rule Edited",
            rule=rule_key,
            rule_revision=doc.revision,
            reason_code="settings_saved",
            detail=NotificationSettingsService._diff(before, doc),
        )
        frappe.db.commit()

        return NotificationSettingsService.detail(rule_key)

    @staticmethod
    def _schedule_moved(before, changes):
        timing = (
            "initial_delay_value",
            "initial_delay_unit",
            "repeat_interval_value",
            "repeat_interval_unit",
            "max_sends",
            "quiet_hours_enabled",
            "quiet_start",
            "quiet_end",
            "timezone",
            "condition_key",
            "stop_condition_key",
        )

        return any(
            field in changes and f"{changes[field]}" != f"{before.get(field)}"
            for field in timing
        )

    @staticmethod
    def _diff(before, doc):
        moved = [
            f"{field}: {before.get(field)} -> {doc.get(field)}"
            for field in EDITABLE
            if f"{before.get(field)}" != f"{doc.get(field)}"
        ]

        return "; ".join(moved) if moved else "no field changed"

    # ------------------------------------------------------------------ preview and test
    # what a template is shown with when there is no real record to show: recognisable as
    # a sample at a glance, and carrying nobody's actual data
    SAMPLE = {
        "full_name": "Sample Recipient",
        "customer": "Sample Customer Ltd",
        "role": "MSP Technician",
        "request": "SR-0000-00000",
        "invoice": "INV-0000-00000",
        "period": "January 2026",
        "reason": "This is sample text, not a real dispute.",
        "waiting_since": "1 January 2026 09:00 (24h ago)",
        "headline": "Sample action",
        "acts": "",
        "summary": "",
        "link": "https://example.invalid/sample",
    }

    @staticmethod
    def preview(rule_key):
        """What this notification looks like, rendered from the template it really uses.

        Rendered with sample context rather than a real record: a preview that reaches for
        the first request it can find shows one customer's business to whoever opened the
        screen, and a preview is not a reason to widen what anybody can see.
        """
        NotificationSettingsService._guard()
        registry.require(rule_key)
        current = NotificationSettingsService.effective(rule_key)

        from nexgen_msp.utils import notifications

        subject, message = notifications.render(
            current["template_name"], dict(NotificationSettingsService.SAMPLE)
        )

        return {
            "subject": subject,
            "message": message,
            "template_name": current["template_name"],
            "context_note": "Rendered with sample values. A real send uses the record's own "
            "data and the recipient's own language.",
        }

    @staticmethod
    def test_send(rule_key, recipient):
        """Send this notification, once, to an address an administrator is allowed to use.

        A test is marked as one everywhere it is recorded, and it never counts as a
        reminder iteration: using the test button three times must not exhaust somebody's
        three reminders.
        """
        NotificationSettingsService._guard()
        registry.require(rule_key)

        address = NotificationSettingsService._allowed_test_address(recipient)

        from nexgen_msp.api.internal.services.notification_dispatch_service import (
            NotificationDispatchService,
        )

        return NotificationDispatchService.deliver(
            rule_key,
            address,
            context=dict(NotificationSettingsService.SAMPLE),
            business_doctype=None,
            business_name=None,
            is_test=True,
        )

    @staticmethod
    def _allowed_test_address(recipient):
        """The administrator's own address, or another administrator's. Nobody else's.

        Otherwise the test button is a way to make this application send mail to any
        address somebody types, which is a different feature and a worse one.
        """
        address = (recipient or "").strip().lower()

        if not address:
            raise ValidationError("Say which address the test should go to.", "VALIDATION_ERROR")

        from frappe.utils import validate_email_address

        validate_email_address(address, throw=True)

        if address == (frappe.session.user or "").lower():
            return address

        enabled = frappe.db.get_value("User", address, "enabled")

        if enabled and access.can_manage_settings(address):
            return address

        raise ValidationError(
            "A test can only be sent to your own address or to another administrator's.",
            "PERMISSION_DENIED",
            403,
        )

    # ------------------------------------------------------------------ audit
    @staticmethod
    def _write_audit(action, **fields):
        """One line of what happened, inserted and never touched again."""
        doc = frappe.new_doc(AUDIT)
        doc.action = action
        doc.actor = frappe.session.user

        for field, value in fields.items():
            doc.set(field, value)

        doc.insert(ignore_permissions=True)

        return doc.name
