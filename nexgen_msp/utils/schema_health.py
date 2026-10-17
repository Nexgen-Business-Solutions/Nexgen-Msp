"""Whether the database is as new as the code that reads it.

An app upgraded without `bench migrate` leaves the code asking for columns the tables do not
have. What reaches the screen then is a raw SQL error — "Unknown column 'send_read_receipt'"
is what signing in answered on 17 October 2026 — and nothing in it says what to do.

The question is only asked once something has already failed, so the answer costs nothing
and is never stale.
"""

import frappe

MESSAGE = (
    "This site is running code newer than its database: {apps}. "
    "Run `bench --site {site} migrate` before using it again."
)


def _recorded():
    return {
        row.app_name: row.app_version
        for row in frappe.get_all("Installed Application", fields=["app_name", "app_version"])
    }


def apps_behind():
    """The apps whose recorded version is not the one on disk."""
    behind = []

    for app, recorded in _recorded().items():
        try:
            on_disk = frappe.get_attr(f"{app}.__version__")
        except Exception:
            continue

        if recorded and on_disk and recorded != on_disk:
            behind.append(f"{app} {recorded} → {on_disk}")

    return behind


def warning():
    """One sentence naming what to do, or None when the site is in step.

    Asked only once something has already failed, so three rows and a few attribute lookups
    cost nothing: no cache stands between the question and the answer.
    """
    behind = apps_behind()

    if not behind:
        return None

    return MESSAGE.format(apps=", ".join(behind), site=frappe.local.site)
