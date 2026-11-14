"""What is true of a service assignment across the app, written once."""

# a service that is still on somebody's hands, in whatever stage of its life
OPEN_ASSIGNMENT_STATUSES = ("Pending Setup", "Active", "Suspended")

# where the catalogue says a service may be provided, and so where a period of it may be
# opened. "Both" is the one entry that is not its own name: it means a person or a machine,
# never the company, which is why it cannot be read as "anywhere"
SCOPES_FOR_CATALOGUE = {
    "User": ("User",),
    "Device": ("Device",),
    "Both": ("User", "Device"),
    "Customer": ("Customer",),
}

SCOPE_PHRASE = {
    "User": "per-user",
    "Device": "per-device",
    "Both": "per-user or per-device",
    "Customer": "customer-level",
}


def scopes_allowed_for(item_scope):
    """The assignment scopes a catalogue entry permits, or None when it restricts nothing.

    An Item with no scope on file, or one carrying a scope this application does not
    recognise, is a legacy record: it is left unrestricted rather than retroactively made
    invalid.
    """
    return SCOPES_FOR_CATALOGUE.get(item_scope)


# billing follows the operational life of a service, it never runs a state machine of its own
OPERATIONAL_TO_BILLING = {
    "Draft": "Not Billable",
    "Pending Setup": "Pending",
    "Active": "Billable",
    "Suspended": "On Hold",
    "Ended": "Ended",
    "Cancelled": "Not Billable",
}


def status_as_of(status, end_date, pauses=None, on_date=None):
    """What a service is really doing on a given day.

    A change decided for a day to come is written the moment it is decided: the end date
    goes on the record and the status reads Ended, the pause is logged and the status
    reads Suspended. That is right for the record and wrong for today — and what may be
    asked of a service is decided by what it is doing today, not by what it will do.

    Only the two future cases are answered here. Everything else is its own status, which
    already describes the present.
    """
    import frappe

    today = frappe.utils.getdate(on_date or frappe.utils.today())

    if status == "Ended" and end_date and frappe.utils.getdate(end_date) > today:
        # it stops at the end of that day, so until then it is still being provided —
        # paused, if a pause of its own is in force
        return "Suspended" if _paused_on(pauses, today) else "Active"

    if status == "Suspended" and not _paused_on(pauses, today):
        return "Active"

    return status


def _paused_on(pauses, day):
    """Whether an open pause covers this day. The day of a resume is served again."""
    import frappe

    for pause in pauses or []:
        started = pause.get("suspended_on")

        if not started or frappe.utils.getdate(started) > day:
            continue

        back = pause.get("resumed_on")

        if not back or frappe.utils.getdate(back) > day:
            return True

    return False
