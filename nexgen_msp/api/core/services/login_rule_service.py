"""Where a login lands. One decision, taken here and nowhere else.

Signing in says who somebody is. It does not say where they belong, and on a site that
hosts more than this application the two answers stopped being the same: an account with
no role of ours was being carried into our internal screens because that is where the
login happened to point.

So destination is decided on its own, from rules an administrator writes, and the order it
is decided in is fixed here rather than discovered by whoever asks next. **A destination is
never a permission.** Landing on ``/msp`` still has to get past this application's own
verdict, and landing on the desk still has to get past Frappe's; the registry asks both at
the moment of the answer.

Two things the order protects against. A direct assignment marked default beats every role
no matter its priority — it is the explicit exception somebody wrote down, so a role rule
must never quietly take it back, and a direct assignment on a rule that has been switched
off is a refusal, not a reason to fall through to the roles. And nothing is ever decided by
a tie: two rules of equal priority are two answers, and picking whichever sorted first is
how an account ends up somewhere nobody chose.
"""

import frappe

from nexgen_msp.utils import login_route_registry as routes

RULE = "Nexgen Login Rule"

NOT_AUTHENTICATED = "NOT_AUTHENTICATED"
USER_DISABLED = "USER_DISABLED"
NO_RULE = "NO_LOGIN_RULE"
AMBIGUOUS_DIRECT = "AMBIGUOUS_DIRECT_RULE"
AMBIGUOUS_ROLE = "AMBIGUOUS_ROLE_RULE"
DISABLED = "RULE_DISABLED"

# the roles every account carries whether anybody gave them or not. A rule hung on one of
# them would be a destination for the whole site, which is not something to arrive at by
# accident
BLANKET_ROLES = ("All", "Guest")

DIRECT = "direct_user"
BY_ROLE = "role"


def _denied(error):
    return {"success": False, "rule": None, "source": None, "path": None, "error": error}


class LoginRuleService:
    @staticmethod
    def resolve_for_user(user=None):
        """The effective rule for this account, with its destination already authorised."""
        user = user or frappe.session.user

        if not user or user == "Guest":
            return _denied(NOT_AUTHENTICATED)

        if not frappe.db.get_value("User", user, "enabled"):
            return _denied(USER_DISABLED)

        direct = LoginRuleService._direct_assignments(user)

        if len(direct) > 1:
            return _denied(AMBIGUOUS_DIRECT)

        if direct:
            rule = direct[0]

            if not rule.enabled:
                return _denied(DISABLED)

            return LoginRuleService._authorize(rule, user, DIRECT)

        matched = LoginRuleService._role_matches(user)

        if not matched:
            return _denied(NO_RULE)

        highest = max(rule.priority or 0 for rule in matched)
        winners = [rule for rule in matched if (rule.priority or 0) == highest]

        if len(winners) != 1:
            return _denied(AMBIGUOUS_ROLE)

        return LoginRuleService._authorize(winners[0], user, BY_ROLE)

    @staticmethod
    def validate_home_route(path, user=None):
        """Whether a route is local, registered, and open to this account."""
        return routes.authorize(path, user)

    @staticmethod
    def eligible_for_msp(user=None):
        """Asks the access policy. It never reads a rule's name to decide this."""
        return routes.can_enter_msp(user)

    # ------------------------------------------------------------------ the two modes
    @staticmethod
    def _direct_assignments(user):
        """Every rule naming this account as its default, switched off ones included.

        A rule somebody switched off is read here on purpose: it is an explicit block, and
        it has to be reported as one rather than disappear and let the roles answer.
        """
        return frappe.db.sql(
            """
            select rule.name as rule, rule.enabled, rule.home_route, rule.priority
            from `tabNexgen Login Applicable User` line
            join `tabNexgen Login Rule` rule on rule.name = line.parent
            where line.parenttype = %s
              and line.user = %s
              and ifnull(line.`default`, 0) = 1
            """,
            (RULE, user),
            as_dict=True,
        )

    @staticmethod
    def _role_matches(user):
        """The live rules this account's roles reach, counted once each.

        One rule naming two roles the same account holds is one match, not a conflict, so
        the rows are collapsed by rule before anything is compared.
        """
        held = tuple(
            role for role in frappe.get_roles(user) if role and role not in BLANKET_ROLES
        )

        if not held:
            return []

        return frappe.db.sql(
            """
            select distinct rule.name as rule, rule.enabled, rule.home_route, rule.priority
            from `tabNexgen Login Applicable Role` line
            join `tabNexgen Login Rule` rule on rule.name = line.parent
            where line.parenttype = %(doctype)s
              and line.role in %(roles)s
              and rule.enabled = 1
            """,
            {"doctype": RULE, "roles": held},
            as_dict=True,
        )

    @staticmethod
    def _authorize(rule, user, source):
        verdict = routes.authorize(rule.home_route, user)

        if not verdict["ok"]:
            return _denied(verdict["error"])

        return {
            "success": True,
            "rule": rule.rule,
            "source": source,
            "path": verdict["path"],
            "error": None,
        }
