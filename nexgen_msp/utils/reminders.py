"""Reminders for the requests nobody has moved yet.

Two things stall a request, and neither of them is anybody's fault: an approver who has not
opened their mail, and a request that reached us while everybody was busy. Every three hours
the ones still in that state are pointed out again, to the same people the first mail went to.

Nothing is sent about a request somebody is already working on, and nothing is sent twice in
the same run: one mail per person per request, and then silence until the next run.
"""

import frappe

from nexgen_msp.utils import notifications

REQUEST = "MSP Request"

WAITING_FOR_CUSTOMER = "Awaiting Customer Approval"

# reached us and nobody has opened it: "Under Review" already means somebody has
WAITING_FOR_US = "Submitted"


def every_three_hours():
    """Remind whoever a request is waiting on, approvers first, then our own team."""
    return {
        "approvals": remind_approvers(),
        "queue": remind_our_team(),
    }


def _waiting(status):
    return frappe.get_all(
        REQUEST,
        filters={"status": status, "refused_by_customer": 0},
        fields=["name", "customer", "requester", "creation", "priority"],
        order_by="creation asc",
    )


def _summary(row, lines):
    return notifications.summary_table(
        [
            ("Request", row.name),
            ("Customer", row.customer),
            ("Services requested", str(lines)),
            ("Priority", row.priority or "Medium"),
        ]
    )


def _since(creation):
    return f"{frappe.utils.format_datetime(creation)} ({frappe.utils.time_diff_in_hours(frappe.utils.now(), creation):.0f}h ago)"


def _tell(template, address, row, lines, briefing=None):
    notifications.send(
        template,
        [address],
        {
            "full_name": frappe.db.get_value("User", address, "full_name") or address,
            "request": row.name,
            "customer": row.customer,
            "waiting_since": _since(row.creation),
            "summary": _summary(row, lines),
            "acts": "",
            "headline": "",
            **(briefing or {}),
            "link": notifications.portal_url(f"/requests/{row.name}"),
        },
        reference_doctype=REQUEST,
        reference_name=row.name,
    )


def remind_approvers():
    """Every request still waiting for its own company's accord."""
    from nexgen_msp.api.portal.services.portal_service import PortalService

    sent = 0

    for row in _waiting(WAITING_FOR_CUSTOMER):
        doc = frappe.get_doc(REQUEST, row.name)
        lines = len(doc.lines)

        for address in PortalService._approvers_of(doc):
            _tell("MSP Request Approval Reminder", address, row, lines)
            sent += 1

    return sent


def remind_our_team():
    """Every request that reached us and that nobody has started."""
    from nexgen_msp.api.portal.services.portal_service import PortalService

    rows = _waiting(WAITING_FOR_US)

    if not rows:
        return 0

    team = PortalService._our_team()
    sent = 0

    for row in rows:
        doc = frappe.get_doc(REQUEST, row.name)
        # read once per request, not once per technician
        briefing = {
            **notifications.request_briefing(doc),
            "headline": notifications.request_headline(doc),
        }

        for address in team:
            if address == row.requester:
                continue

            _tell("MSP Request Waiting Reminder", address, row, len(doc.lines), briefing)
            sent += 1

    return sent
