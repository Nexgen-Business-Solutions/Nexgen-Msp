"""Stretches of days, and the arithmetic of what is owed over them.

Billing asks the same question again and again: of the days a service was due, which ones
has somebody already paid for? Answered with two dates it is always wrong somewhere — a
quarter with a fortnight already billed in the middle of it is neither "covered" nor
"uncovered". Answered with sets of day stretches it is simply arithmetic, and that is what
lives here.

Every stretch includes both of its days. Nothing in this module touches the database: it
takes dates and gives dates back, so it can be read and tested on its own.
"""

from frappe.utils import add_days, getdate


def span(first, last):
    """One stretch, or nothing when the dates say nothing."""
    first, last = getdate(first), getdate(last)

    return [(first, last)] if last >= first else []


def merge(stretches):
    """The same days, said once: overlapping and touching stretches become one."""
    ordered = sorted((getdate(first), getdate(last)) for first, last in stretches if last >= first)
    merged = []

    for first, last in ordered:
        if merged and first <= add_days(merged[-1][1], 1):
            merged[-1] = (merged[-1][0], max(merged[-1][1], last))
        else:
            merged.append((first, last))

    return merged


def subtract(stretches, taken):
    """The days of the first set that the second does not already hold."""
    left = []

    for first, last in merge(stretches):
        cursor = first

        for gone_from, gone_to in merge(taken):
            if gone_to < cursor or gone_from > last:
                continue

            if gone_from > cursor:
                left.append((cursor, add_days(gone_from, -1)))

            cursor = max(cursor, add_days(gone_to, 1))

            if cursor > last:
                break

        if cursor <= last:
            left.append((cursor, last))

    return merge(left)


def intersect(stretches, other):
    """The days both sets hold."""
    kept = []

    for first, last in merge(stretches):
        for start, stop in merge(other):
            begins, ends = max(first, start), min(last, stop)

            if ends >= begins:
                kept.append((begins, ends))

    return merge(kept)


def days(stretches):
    """How many days these stretches hold, counting both ends of each."""
    return sum((last - first).days + 1 for first, last in merge(stretches))


def as_dicts(stretches):
    """The shape a run line and an API answer carry them in."""
    return [{"from": str(first), "to": str(last)} for first, last in merge(stretches)]


def from_dicts(rows):
    """Read them back from that shape, whatever the keys were stored as."""
    return merge(
        (getdate(row["from"]), getdate(row["to"]))
        for row in rows or []
        if row.get("from") and row.get("to")
    )
