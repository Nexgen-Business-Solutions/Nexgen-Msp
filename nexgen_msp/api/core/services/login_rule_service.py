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

A rule also says whether its accounts may open the Frappe desk. That is a door this routing
opens or leaves shut; it is not a seat. Frappe still decides who it admits — only a System
User gets in, and some of our own technicians are deliberately not one — so the box can shut
the desk to somebody Frappe would let in, and never the other way round. Whoever the box
shuts out is sent to their own home rather than to the site's front door.

Two things the order protects against. A direct assignment marked default beats every role
no matter its priority — it is the explicit exception somebody wrote down, so a role rule
must never quietly take it back, and a direct assignment on a rule that has been switched
off is a refusal, not a reason to fall through to the roles. And nothing is ever decided by
a tie: two rules of equal priority are two answers, and picking whichever sorted first is
how an account ends up somewhere nobody chose.
"""

import frappe
from frappe.utils import cint

from nexgen_msp.utils import access
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

# the switch that hands the login over to these rules, and takes it back without deleting one
ROUTING_FLAG = "route_login_by_rules"


def _denied(error):
    return {"success": False, "rule": None, "source": None, "path": None, "error": error}


class LoginRuleService:
    @staticmethod
    def resolve_for_user(user=None):
        """The effective rule for this account, with its destination already authorised."""
        user = user or frappe.session.user
        rule, source, error = LoginRuleService._winning(user)

        if error:
            return _denied(error)

        return LoginRuleService._authorize(rule, user, source)

    @staticmethod
    def home_for(user=None):
        """The authorised home of this account, or nothing where it has none."""
        verdict = LoginRuleService.resolve_for_user(user)

        return verdict["path"] if verdict["success"] else None

    @staticmethod
    def desk_allowed(user=None):
        """Whether this account's rule opens the desk to it.

        A rule that decides nothing opens nothing: an account with no rule, or one caught
        between two, is not handed the desk by default.
        """
        rule, _source, error = LoginRuleService._winning(user or frappe.session.user)

        return bool(rule) and not error and bool(cint(rule.desk_access))

    @staticmethod
    def routing_enabled():
        """Whether this site hands the login over to the rules at all.

        Off, nothing here decides anything: the destination is left out of the session and
        the desk guard goes back to the rule it applied before there were any. A switch
        that only half took effect would not be a way back.
        """
        try:
            return bool(frappe.db.get_single_value("MSP Portal Settings", ROUTING_FLAG))
        except Exception:
            return False

    @staticmethod
    def desk_reachable(user=None):
        """Whether this account can actually get into the desk.

        Both halves, because either alone misleads: the rule has to open the door, and
        Frappe has to be willing to let them through it. Asked in exactly one place so that
        a screen cannot offer a door the request guard will shut — which is what happened
        while the screen read the roles and the guard read the rule.

        While the switch is off this is the question it was before the rules existed.
        """
        user = user or frappe.session.user

        if access.is_administrator(user):
            return True

        # Frappe admits only a System User, and no rule of ours changes that
        if not routes.can_enter_desk(user):
            return False

        # while the switch is off that is the whole question, exactly as it was before any
        # rule existed: a seat gets you in, and the absence of one does not
        if not LoginRuleService.routing_enabled():
            return True

        return LoginRuleService.desk_allowed(user)

    # ------------------------------------------------------------------ the order itself
    @staticmethod
    def _winning(user):
        """The rule that decides for this account, as (rule, source, refusal)."""
        if not user or user == "Guest":
            return None, None, NOT_AUTHENTICATED

        if not frappe.db.get_value("User", user, "enabled"):
            return None, None, USER_DISABLED

        direct = LoginRuleService._direct_assignments(user)

        if len(direct) > 1:
            return None, None, AMBIGUOUS_DIRECT

        if direct:
            rule = direct[0]

            if not rule.enabled:
                return None, None, DISABLED

            return rule, DIRECT, None

        matched = LoginRuleService._role_matches(user)

        if not matched:
            return None, None, NO_RULE

        highest = max(rule.priority or 0 for rule in matched)
        winners = [rule for rule in matched if (rule.priority or 0) == highest]

        if len(winners) != 1:
            return None, None, AMBIGUOUS_ROLE

        return winners[0], BY_ROLE, None

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
            select rule.name as rule, rule.enabled, rule.home_route, rule.priority,
                   rule.desk_access
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
            select distinct rule.name as rule, rule.enabled, rule.home_route, rule.priority,
                   rule.desk_access
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
        # a rule cannot send anybody to the desk without the box that opens it
        if routes.is_desk(rule.home_route) and not cint(rule.desk_access):
            return _denied(routes.DESK_REFUSED)

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
