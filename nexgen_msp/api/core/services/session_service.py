import frappe

from nexgen_msp.utils import access, permissions

def login_destination(user):
    """Navigation only: an existing Desk seat wins before the MSP entry verdict.

    The configured Desk restriction still applies. This adds no portal capabilities
    and leaves the endpoint authorization policy untouched.
    """
    from nexgen_msp.api.core.services.login_rule_service import LoginRuleService

    if LoginRuleService.desk_reachable(user):
        return {"success": True, "rule": None, "source": "desk_access", "path": "/app", "error": None}

    if not LoginRuleService.routing_enabled():
        return None

    return LoginRuleService.resolve_for_user(user)


INTERNAL_ROLES = (
    "MSP System Admin",
    "MSP Technician",
    "Administrator",
)


class SessionService:
    @staticmethod
    def get_session_context():
        from nexgen_msp.api.core.services.login_rule_service import LoginRuleService
        from nexgen_msp.api.two_factor.services.two_factor_service import TwoFactorService

        user = frappe.session.user

        enabled = user != "Guest" and bool(frappe.db.get_value("User", user, "enabled"))

        if not enabled:
            return {
                "user": user,
                "authenticated": False,
                "roles": [],
                "customers": [],
                "access": access.entry(user) if user == "Guest" else {
                    "ok": False, "code": "USER_DISABLED", "message": "This account is disabled."
                },
                "can_open_desk": False,
                "login_destination": None,
            }

        roles = frappe.get_roles()
        customers = permissions.get_allowed_customers(user) if user != "Administrator" else []

        details = frappe.db.get_value(
            "User",
            user,
            ["full_name", "first_name", "last_name", "user_image", "user_type"],
            as_dict=True,
        )

        is_portal = bool(set(roles).intersection(permissions.CUSTOMER_ROLES))
        is_internal = access.is_staff(user)

        profile = permissions.contact_profile(user, customers)

        # a contact's company is the one on their own record, not whichever permission
        # happened to sort first — the two can disagree, and the record is the truth
        here = (profile.customer if profile and profile.customer in customers else None) or (
            customers[0] if customers else None
        )

        return {
            "user": user,
            "authenticated": True,
            "full_name": details.full_name if details else user,
            "first_name": details.first_name if details else None,
            "last_name": details.last_name if details else None,
            "user_image": details.user_image if details else None,
            "user_type": details.user_type if details else None,
            "roles": roles,
            "customers": customers,
            "customer": here,
            "is_portal_user": is_portal and not is_internal,
            "is_internal_user": is_internal,
            "scoped_msp": access.is_scoped_staff(user),
            # whether this account may be in the application at all, decided in one place
            # and merely applied by the route guard
            "access": access.entry(user),
            # a destination, which is not a permission: the two are asked separately and the
            # login screen applies the home; deliberate MSP navigation asks access.entry
            "login_destination": login_destination(user),
            # the same question the request guard asks, so the denial screen cannot offer a
            # door that guard will shut
            "can_open_desk": LoginRuleService.desk_reachable(user),
            "can_see_invoices": permissions.may_see_invoices(user),
            # the second factor, and the deadline it is bound to: the client
            # counts down to the moment Frappe drops the session and a fresh
            # code will be asked for
            "two_factor_enabled": TwoFactorService.has_secret(user),
            "two_factor_passed": TwoFactorService.gate_passed(user),
            "session_expiry_seconds": TwoFactorService.session_expiry_seconds(),
        }
