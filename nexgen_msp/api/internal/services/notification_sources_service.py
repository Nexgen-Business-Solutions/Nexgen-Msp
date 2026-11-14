"""Everything on this site that can send mail, and which of it is ours to manage.

A settings screen that shows only our own notifications invites the wrong conclusion: that
they are the only ones. They are not. Frappe sends its own alerts, ERPNext has digests and
campaigns and project reminders, and any installed app may have added a timer of its own.
An administrator asking "why did this customer get mail on a Sunday" needs to see all of
it, and needs to be told plainly which parts this screen can change.

Nothing here writes anything. Every external source is reported exactly as discovered and
offered no controls at all: enrolling somebody else's notification into our engine is a
decision for a person, not a side effect of opening a page.
"""

import frappe

from nexgen_msp.api.internal.services import notification_registry as registry
from nexgen_msp.api.internal.services.notification_settings_service import (
    NotificationSettingsService,
)
from nexgen_msp.utils import notifications

MANAGED = "MSP-managed"
EXTERNAL = "External / read-only"


class NotificationSourcesService:
    @staticmethod
    def inventory():
        """What is installed and sending, read from this site and not from a list in code."""
        NotificationSettingsService._guard()

        rows = (
            NotificationSourcesService._ours()
            + NotificationSourcesService._frappe_notifications()
            + NotificationSourcesService._auto_email_reports()
            + NotificationSourcesService._scheduled_jobs()
        )

        return {
            "rows": rows,
            "generated_at": frappe.utils.now(),
            "apps": frappe.get_installed_apps(),
            # templates whose stored wording no longer matches the shipped one. Reported,
            # never corrected: almost always somebody's own edit, and the point of leaving
            # it alone is that nobody can tell it from a stale default without being told
            "drifted_templates": notifications.drifted_templates(),
        }

    @staticmethod
    def _ours():
        configured = {
            row.rule_key: row
            for row in frappe.get_all(
                "MSP Notification Rule", fields=["rule_key", "enabled", "kind"]
            )
        }
        rows = []

        for rule_key, declared in registry.RULES.items():
            stored = configured.get(rule_key)
            on = bool(stored and stored.enabled) or declared["protected"]
            rows.append(
                {
                    "source": declared["display_name"],
                    "provider": "Nexgen MSP",
                    "trigger_mode": "Business event"
                    if declared["kind"] == registry.EVENT
                    else "Recurring reminder",
                    "management": MANAGED,
                    "notes": f"{declared['source']} · {declared['template_name']}"
                    + (" · protected" if declared["protected"] else "")
                    + ("" if on else " · switched off"),
                    "enabled": on,
                    "rule_key": rule_key,
                }
            )

        return sorted(rows, key=lambda row: row["source"])

    @staticmethod
    def _frappe_notifications():
        try:
            found = frappe.get_all(
                "Notification",
                fields=["name", "document_type", "event", "enabled", "channel"],
                limit=200,
            )
        except Exception:
            return []

        return [
            {
                "source": row.name,
                "provider": "Frappe",
                "trigger_mode": f"{row.event or 'Alert'} on {row.document_type or '—'}",
                "management": EXTERNAL,
                "notes": f"{row.channel or 'Email'} · "
                + ("enabled" if row.enabled else "disabled"),
                "enabled": bool(row.enabled),
                "rule_key": None,
            }
            for row in found
        ]

    @staticmethod
    def _auto_email_reports():
        try:
            found = frappe.get_all(
                "Auto Email Report",
                fields=["name", "report", "enabled", "frequency"],
                limit=200,
            )
        except Exception:
            return []

        return [
            {
                "source": row.name,
                "provider": "Frappe",
                "trigger_mode": f"Scheduled · {row.frequency or '—'}",
                "management": EXTERNAL,
                "notes": f"Report {row.report}"
                + (" · enabled" if row.enabled else " · disabled"),
                "enabled": bool(row.enabled),
                "rule_key": None,
            }
            for row in found
        ]

    @staticmethod
    def _scheduled_jobs():
        """The timers this site actually runs, which is the only honest answer about mail.

        A hook file says what an app asked for; this says what the site does. They differ
        whenever somebody stopped a job by hand, and the one that matters is this one.
        """
        try:
            found = frappe.get_all(
                "Scheduled Job Type",
                fields=["name", "method", "frequency", "cron_format", "stopped"],
                limit=500,
            )
        except Exception:
            return []

        rows = []

        for row in found:
            method = row.method or ""

            if not any(
                word in method.lower()
                for word in ("mail", "email", "notif", "remind", "digest", "campaign")
            ):
                continue

            ours = method.startswith("nexgen_msp.")
            rows.append(
                {
                    "source": method,
                    "provider": "Nexgen MSP" if ours else method.split(".")[0] or "Frappe",
                    "trigger_mode": f"{row.frequency or 'Cron'}"
                    + (f" · {row.cron_format}" if row.cron_format else ""),
                    "management": MANAGED if ours else EXTERNAL,
                    "notes": "stopped" if row.stopped else "running",
                    "enabled": not row.stopped,
                    "rule_key": None,
                }
            )

        return sorted(rows, key=lambda row: (row["provider"], row["source"]))
