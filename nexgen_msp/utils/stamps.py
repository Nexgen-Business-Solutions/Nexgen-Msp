"""How a moment leaves this application, so every reader puts it where it happened."""

import frappe


def stamped(value):
    """One stored moment, said with the offset the site was on when it happened.

    Frappe writes its timestamps on the site's own clock and with no offset at all, so
    `2026-11-20 09:30:00` means nine thirty in Douala and nothing anywhere else. A reader
    in another country has no way to place it, and a browser handed it raw reads it as its
    own local time — an hour nobody ever wrote.

    What leaves here is the same instant with the site's offset on it. Whoever reads it
    can then show it on their own clock, or on the site's, and both will be the moment the
    thing actually happened.
    """
    if not value:
        return None

    moment = frappe.utils.get_datetime(value)

    if moment.tzinfo is None:
        from zoneinfo import ZoneInfo

        moment = moment.replace(tzinfo=ZoneInfo(frappe.utils.get_system_timezone()))

    return moment.isoformat()
