"""Whether this application shows itself to an account, in Frappe's own navigation.

The apps screen, the workspace rail and the desk icon are three separate lists, each with
its own idea of who may see an entry, and all three default to showing it to everybody with
a desk seat. That default was wrong here: an account that runs the site but holds no role of
ours would be shown a door it cannot walk through, and clicking it would land on the refusal
screen.

So visibility asks the same question entry does, and nothing else. A destination configured
towards ``/msp`` is deliberately not consulted: somebody else's rule, or an administrator's
slip, must not put this application on their screen.
"""

from nexgen_msp.utils import access


def can_show_msp_app(user=None):
    """Called by Frappe with no argument, for the account asking for the apps screen.

    The builtin Administrator is included outright. It runs the site, and the entry policy
    already says so in the same words rather than through a role.
    """
    return access.is_administrator(user) or bool(access.entry(user).get("ok"))
