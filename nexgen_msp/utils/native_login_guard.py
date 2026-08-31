"""`before_login` guard closing Frappe's own username and password endpoint.

The application signs people in in two steps: the password buys a pending token
and nothing else, and the session is opened only once a code has been verified.
Frappe's built-in endpoint knows nothing of that — it authenticates and opens a
session by itself — so while it stayed reachable, any account with a valid
password could skip the second factor by posting straight to `/api/method/login`.

`before_login` fires inside `LoginManager.login()` before `authenticate()`, so
the request dies before the password is even checked: no session row, no cookie,
nothing to unwind. A `before_request` guard would be too late — the session is
built earlier than those hooks run.

`login_as()` never goes through `login()`, so our own flow is untouched.
"""

import frappe
from frappe import _

from nexgen_msp.utils.auth_constants import ALLOW_NATIVE_LOGIN_KEY


def block_native_login(login_manager=None):
    """Refuse `cmd=login` and `/api/method/login`, whatever the credentials.

    Refusing ahead of `authenticate()` also means the answer is identical for a
    right and a wrong password, so this leaves no oracle behind.

    Deliberately silent: the endpoint is unauthenticated, and a row per hit would
    hand an anonymous caller a way to grow the database at will.
    """
    if frappe.conf.get(ALLOW_NATIVE_LOGIN_KEY):
        # Recovery valve, and it means editing site_config.json on the server —
        # not a door anyone can open from the network. It does drop the second
        # factor for every account, so it must stay off outside recovery.
        return

    frappe.throw(_("Please sign in through the Nexgen application."), frappe.AuthenticationError)
