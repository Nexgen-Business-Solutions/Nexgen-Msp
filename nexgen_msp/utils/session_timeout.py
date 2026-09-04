"""How long a customer's session may sit idle, chosen by the administrator.

Frappe copies the site-wide idle limit into every session the moment it opens, and reads
it back from there on every request. A customer session is therefore handed its own limit
at that same moment, and Frappe enforces it exactly as it enforces any other — nothing is
checked twice, nothing lives outside the session. Staff keep the site-wide value.
"""

import frappe

from nexgen_msp.utils import permissions

# what the administrator can pick, and what each choice means in seconds
TIMEOUTS = {
    "1 hour": 60 * 60,
    "2 hours": 2 * 60 * 60,
    "4 hours": 4 * 60 * 60,
    "8 hours": 8 * 60 * 60,
    "1 day": 24 * 60 * 60,
    "3 days": 3 * 24 * 60 * 60,
    "7 days": 7 * 24 * 60 * 60,
}


def customer_timeout_seconds():
    """The configured limit, or nothing when the administrator left it to the site."""
    choice = frappe.db.get_single_value("MSP Portal Settings", "customer_session_timeout")

    return TIMEOUTS.get(choice)


def as_period(seconds):
    """The `HH:MM:SS` form Frappe keeps its session expiry in; hours run past 24."""
    hours, rest = divmod(int(seconds), 3600)
    minutes, secs = divmod(rest, 60)

    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def is_customer_account(user):
    if not user or user in ("Guest", "Administrator"):
        return False

    return permissions.is_customer_contact(user) or bool(
        set(frappe.get_roles(user)).intersection(permissions.CUSTOMER_ROLES)
    )


def on_session_creation(login_manager=None):
    """Give a customer's fresh session the administrator's limit, then let Frappe keep it."""
    seconds = customer_timeout_seconds()

    if not seconds or not is_customer_account(frappe.session.user):
        return

    frappe.session.data.session_expiry = as_period(seconds)

    # written straight into the cache and the sessions table, where every later request
    # reads it from
    session = getattr(frappe.local, "session_obj", None)
    if session is not None:
        session.update(force=True)
