"""Where a login may land, and who is actually allowed to be there.

A destination is two things, never one: a route the server recognises, and the function
that decides who may reach it. A route on its own is a string an administrator typed, and
a string is not a permission — writing ``/desk`` into a rule must not open the desk to an
account Frappe would turn away, any more than writing ``/msp`` opens this application to
somebody holding none of its roles.

So nothing resolves to a destination that is not registered here. Adding an application
means adding its prefix *and* its check together; a prefix without a check cannot be
registered, which is the only way to be sure every landing has been thought about.

The checks are asked at the moment somebody is sent somewhere, not when the rule was
saved. A role taken away this morning has to count this afternoon.
"""

import re

import frappe

from nexgen_msp.utils import access

INVALID_ROUTE = "INVALID_HOME_ROUTE"
NOT_REGISTERED = "TARGET_NOT_REGISTERED"
MSP_REFUSED = "MSP_ACCESS_DENIED"
DESK_REFUSED = "DESK_ACCESS_DENIED"

MSP = "/msp"
DESK = "/desk"

# the routes that exist to get somebody in or out. Landing on one of them is a loop: the
# login screen sends them on again, and the denial screen has nothing to report
RESERVED = (
    "/msp/login",
    "/msp/unauthorized",
    "/login",
    "/logout",
    "/update-password",
    "/reset-password",
)

# fetched by the page rather than navigated to
MACHINE = ("/api", "/assets", "/files", "/private", "/socket.io", "/.well-known")

# control characters and the backslash, which some clients read as a separator
UNSAFE = re.compile(r"[\x00-\x1f\x7f\\]")

# a separator smuggled past the segment check, and the escape that rebuilds one
ENCODED = re.compile(r"%2f|%5c|%25", re.IGNORECASE)

# a scheme, a query or a fragment: none of them belong in a stored destination
FOREIGN = (":", "?", "#")


def can_enter_msp(user=None):
    """This application's own verdict, asked rather than restated."""
    return bool(access.entry(user).get("ok"))


def can_enter_desk(user=None):
    """Frappe's own answer.

    A Website User stays out of the desk however a rule is written, and some of our own
    technicians are deliberately kept as Website Users.
    """
    from frappe.permissions import is_system_user

    user = user or frappe.session.user

    if not user or user == "Guest":
        return False

    return bool(is_system_user(user))


# Frappe answers to all three and rewrites the last two onto the first, so a rule written
# either way reaches the same place and is checked the same way
DESTINATIONS = {
    MSP: (can_enter_msp, MSP_REFUSED),
    DESK: (can_enter_desk, DESK_REFUSED),
    "/app": (can_enter_desk, DESK_REFUSED),
    "/apps": (can_enter_desk, DESK_REFUSED),
}


def _is_reserved(route):
    return any(
        route == prefix or route.startswith(prefix + "/") for prefix in RESERVED + MACHINE
    )


def normalize(route):
    """The route a rule holds, cleaned, or the reason it cannot be a destination.

    Returns a pair: the route and no problem, or no route and a code. Only local paths
    relative to this origin get through — one leading slash, no scheme, no host, no query,
    nothing that resolves elsewhere once a browser or a proxy has had its say.
    """
    path = (route or "").strip()

    if not path or not path.startswith("/") or path.startswith("//"):
        return None, INVALID_ROUTE

    if UNSAFE.search(path) or ENCODED.search(path):
        return None, INVALID_ROUTE

    if any(token in path for token in FOREIGN):
        return None, INVALID_ROUTE

    segments = [segment for segment in path.split("/") if segment]

    if any(segment in (".", "..") for segment in segments):
        return None, INVALID_ROUTE

    path = "/" + "/".join(segments)

    if _is_reserved(path):
        return None, INVALID_ROUTE

    return path, None


def registered(route):
    """The destination a route belongs to, which is also its family for a deep link.

    The longest prefix wins, so a narrower destination added later is not swallowed by a
    broader one registered before it.
    """
    for prefix in sorted(DESTINATIONS, key=len, reverse=True):
        if route == prefix or route.startswith(prefix + "/"):
            return prefix

    return None


def authorize(route, user=None):
    """Whether this account may be sent to this route, and why not when it may not."""
    path, problem = normalize(route)

    if problem:
        return {"ok": False, "path": None, "error": problem}

    prefix = registered(path)

    if not prefix:
        return {"ok": False, "path": None, "error": NOT_REGISTERED}

    check, refusal = DESTINATIONS[prefix]

    if not check(user):
        return {"ok": False, "path": None, "error": refusal}

    return {"ok": True, "path": path, "error": None}
