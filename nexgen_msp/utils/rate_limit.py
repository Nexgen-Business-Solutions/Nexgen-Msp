"""Caps on the authentication endpoints, answering in the app's own error shape.

Frappe's `rate_limit` can only key on a request parameter, and it raises an
exception whose body carries neither `success` nor `code` — which the frontend
can only report as a bare server error. These two decorators key the same way
and refuse the same way the rest of the API does.
"""

from functools import wraps

import frappe
from frappe import _

from nexgen_msp.utils import response

PREFIX = "msp_authrl"


def request_rate_limit(
    limit=5, seconds=60, key=None, scope="default", audit_event=None, audit_identity=None
):
    """Cap calls per (IP, request field), for endpoints reached before a session.

    `scope` keeps one endpoint's bucket out of another's — Frappe gets that from
    `form_dict.cmd`, which is absent when a method is reached by its REST path.

    `audit_event` files the refusal in the Activity Log, once per window: the
    trail must show that an account was being hammered, and a row per blocked
    request would let the caller decide how big the table gets. `audit_identity`
    resolves the key into an account, and is mandatory whenever the key is not
    itself one — a pending token is a live credential and must never be written
    into a table System Managers can read.
    """

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not frappe.request:
                # same escape hatch as Frappe's limiter, so console, jobs and
                # tests are left untouched
                return fn(*args, **kwargs)

            value = _form_value(key)
            identity = f"{frappe.local.request_ip}:{value}"
            cache_key = frappe.cache.make_key(f"{PREFIX}:{scope}:{identity}:{seconds}")

            count = bump_window_counter(cache_key, seconds)

            if count <= limit:
                return fn(*args, **kwargs)

            if count == limit + 1 and audit_event:
                _record_refusal(audit_event, value, scope, audit_identity)

            retry_after = window_retry_after(cache_key, seconds)

            return response.error(
                _("Too many attempts. Please try again in {0} seconds.").format(retry_after),
                code="RATE_LIMITED",
                retry_after=retry_after,
            )

        return wrapper

    return decorator


def user_rate_limit(limit=10, seconds=60, scope="default"):
    """Cap calls per (IP, session user), for endpoints behind a session."""

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not frappe.request:
                return fn(*args, **kwargs)

            user = getattr(frappe.session, "user", None)

            if not user or user == "Guest":
                return fn(*args, **kwargs)

            identity = f"{frappe.local.request_ip}:{user}"
            cache_key = frappe.cache.make_key(f"{PREFIX}:{scope}:{identity}:{seconds}")

            if bump_window_counter(cache_key, seconds) <= limit:
                return fn(*args, **kwargs)

            retry_after = window_retry_after(cache_key, seconds)

            return response.error(
                _("Too many attempts. Please try again in {0} seconds.").format(retry_after),
                code="RATE_LIMITED",
                retry_after=retry_after,
            )

        return wrapper

    return decorator


def bump_window_counter(cache_key, seconds):
    """Increment a fixed window, arming its TTL on the first hit.

    Incrementing before arming is what makes the window atomic: a get-then-set
    would let two concurrent requests both reset the counter and re-arm the TTL.

    Returns 0 when the counter is unreachable, so callers fail open. A cap is
    defence in depth — the TOTP secret is what actually protects the account —
    and a Redis hiccup must not lock everyone out of their own login screen.
    """
    try:
        count = frappe.cache.incrby(cache_key, 1)

        if count == 1:
            frappe.cache.expire(cache_key, seconds)

        return count
    except Exception:
        frappe.log_error(
            title="MSP rate limit counter unavailable", message=frappe.get_traceback()
        )
        return 0


def window_retry_after(cache_key, seconds):
    """Seconds before the window reopens, so the refusal can say how long.

    Overstating the wait is harmless; a zero would invite the client to retry
    straight into another refusal.
    """
    try:
        ttl = frappe.cache.ttl(cache_key)
    except Exception:
        return seconds

    return ttl if isinstance(ttl, int) and ttl > 0 else seconds


def _form_value(key):
    if not key or not frappe.form_dict:
        return ""

    value = frappe.form_dict.get(key)

    return value if isinstance(value, str) else ""


def _record_refusal(event, value, scope, resolver):
    # imported here: the audit module reaches into a doctype, and this file is
    # imported by endpoint modules loaded while the registry is still building
    from nexgen_msp.utils.auth_audit import record_auth_failure

    identity = None

    if resolver is not None:
        try:
            identity = resolver(value)
        except Exception:
            # an audit lookup must not turn a clean 429 into a 500
            identity = None

    record_auth_failure(event, identity, detail=scope)
