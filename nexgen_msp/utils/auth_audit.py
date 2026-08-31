"""Failed sign-ins, written into Frappe's own Activity Log.

Successful logins are already recorded there — Frappe wires `login_feed` onto
`on_session_creation`. Only the failures were missing, which is the worse half
to miss: the trail showed who got in and never who tried.

The row is built by hand rather than through `add_authentication_log` because
that helper discards the document it inserts, and the inserted name is what
lets the row be attributed to the account that was attempted.
"""

import re

import frappe

SUBJECT_PREFIX = "MSP_AUTH_FAILED"

# the same codes the endpoints answer with, so a support ticket quoting a code
# maps onto rows without anyone keeping a translation table
EVENT_BAD_PASSWORD = "BAD_PASSWORD"
EVENT_USER_DISABLED = "USER_DISABLED"
EVENT_PENDING_LOGIN_INVALID = "PENDING_LOGIN_INVALID"
EVENT_OTP_REQUIRED = "OTP_REQUIRED"
EVENT_OTP_INVALID_FORMAT = "OTP_INVALID_FORMAT"
EVENT_OTP_INVALID = "OTP_INVALID"
EVENT_REAUTH_OTP_INVALID = "REAUTH_OTP_INVALID"
EVENT_SETUP_OTP_INVALID = "SETUP_OTP_INVALID"
EVENT_SETUP_CONTEXT_INVALID = "SETUP_CONTEXT_INVALID"
# a refusal is an outcome too: the limiter answers before the endpoint runs, so
# without this the trail stops exactly where an account starts being hammered
EVENT_RATE_LIMITED = "RATE_LIMITED"

# `user` and the full name derived from it are both Data columns
MAX_IDENTITY_LEN = 140

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


def record_auth_failure(event, user=None, detail=None):
    """Record one failed attempt without disturbing the caller.

    Committed on the spot, deliberately: `handle_errors` rolls the transaction
    back before answering, and that rollback would erase the row a line after it
    was decided. Frappe's own `LoginManager.fail` commits for the same reason.

    Only safe because every call site is an authentication decision taken before
    the request has written anything of its own. Never call it after a business
    write. It never raises — an audit failure must not turn a clean 401 into a
    500.
    """
    try:
        identity = _clean_identity(user)
        row = frappe.get_doc(
            {
                "doctype": "Activity Log",
                "user": identity,
                "subject": _subject(event, identity, detail),
                # "Login" even for setup and reauth failures: the Select is
                # closed, and the controller fills `ip_address` only for that
                # operation. The distinction lives in the event token.
                "operation": "Login",
                "status": "Failed",
            }
        ).insert(
            ignore_permissions=True,
            # a failed attempt against an address with no User row behind it is
            # the common case here, not the exception
            ignore_links=True,
        )
        _attribute(row.name, identity)
        frappe.db.commit()
    except Exception:
        frappe.log_error(title="MSP auth audit failed", message=frappe.get_traceback())


def _attribute(row_name, identity):
    """Point `owner` at the account that was tried, not at the anonymous caller.

    These endpoints are `allow_guest`, so the session user is Guest while the row
    is written and `insert()` stamps `owner` from it. An address nobody owns
    stays with Guest rather than inventing a link.
    """
    if not identity or identity == "Guest":
        return

    if not frappe.db.exists("User", identity):
        return

    frappe.db.set_value("Activity Log", row_name, "owner", identity, update_modified=False)


def _clean_identity(user):
    identity = (user or "").strip() or getattr(frappe.session, "user", None) or "Guest"
    return _CONTROL_CHARS.sub("", identity)[:MAX_IDENTITY_LEN]


def _subject(event, identity, detail):
    """One greppable line: the prefix finds every row, the token narrows it."""
    parts = [f"{SUBJECT_PREFIX} {event}: identity={identity}"]

    cmd = frappe.form_dict.get("cmd") if frappe.form_dict else None

    if cmd:
        parts.append(f"cmd={cmd}")

    if detail:
        parts.append(f"— {detail}")

    return " ".join(parts)
