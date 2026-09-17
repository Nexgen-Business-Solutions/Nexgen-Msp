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


def has_expired(data):
    """Whether a session has sat idle past its own limit, or past the end it was given."""
    from datetime import UTC, datetime

    from frappe.sessions import get_expiry_in_seconds

    if not data:
        return False

    period, last = data.get("session_expiry"), data.get("last_updated")

    if period and last:
        idle = frappe.utils.time_diff_in_seconds(frappe.utils.now(), last)

        if idle > get_expiry_in_seconds(period):
            return True

    session_end = data.get("session_end")

    return bool(session_end) and datetime.now(tz=UTC) > datetime.fromisoformat(session_end)


def expire_idle_session():
    """End a session that went idle past its own limit, however it was read back.

    Frappe holds a session's idle limit in the session itself and checks it only when the
    session comes out of the cache. When the cache has been emptied — a restart, a deploy —
    it reads the session from the table instead and weighs it against the site-wide limit,
    so a customer idle for a day came back to life as long as they were under a week. This
    runs before anything else in the request and ends such a session exactly as the cache
    would have: the session is deleted, the cookies cleared, and the request goes on as a
    guest.
    """
    from frappe.auth import clear_cookies
    from frappe.sessions import delete_session

    manager = getattr(frappe.local, "login_manager", None)
    session = getattr(frappe.local, "session", None)

    if not manager or not session or session.user in (None, "Guest"):
        return

    if not has_expired(session.data):
        return

    delete_session(session.sid, reason="Session Expired")
    frappe.response["session_expired"] = 1
    clear_cookies()

    manager.user = "Guest"
    manager.get_user_info()
    manager.make_session()
    manager.set_user_info()


def refresh_live_sessions():
    """Hand every open customer session the limit in force right now.

    The limit is written into a session when it opens, so a session opened before the
    setting existed — or before it changed — would keep its old one until the next login.
    Called when the setting is saved and at every deployment.
    """
    import json

    from frappe.sessions import get_expiry_period

    seconds = customer_timeout_seconds()
    period = as_period(seconds) if seconds else get_expiry_period()
    touched = 0

    for row in frappe.db.sql(
        "select sid, user, sessiondata from `tabSessions` where user not in ('Guest', 'Administrator')",
        as_dict=True,
    ):
        if not is_customer_account(row.user):
            continue

        data = frappe.parse_json(row.sessiondata or "{}")
        if data.get("session_expiry") == period:
            continue

        data["session_expiry"] = period
        frappe.db.sql(
            "update `tabSessions` set sessiondata = %s where sid = %s",
            (json.dumps(data, default=str), row.sid),
        )
        cached = frappe.cache.hget("session", row.sid)
        if cached:
            cached["data"]["session_expiry"] = period
            frappe.cache.hset("session", row.sid, cached)
        touched += 1

    frappe.db.commit()

    return touched
