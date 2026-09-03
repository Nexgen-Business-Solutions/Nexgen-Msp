import frappe

from nexgen_msp.utils import permissions

INTERNAL_ROLES = (
    "MSP System Admin",
    "MSP Technician",
    "System Manager",
    "Administrator",
)


class SessionService:
    @staticmethod
    def get_session_context():
        from nexgen_msp.api.two_factor.services.two_factor_service import TwoFactorService

        user = frappe.session.user

        if user == "Guest":
            return {"user": "Guest", "authenticated": False, "roles": [], "customers": []}

        roles = frappe.get_roles()
        customers = permissions.get_allowed_customers(user) if user != "Administrator" else []

        details = frappe.db.get_value(
            "User",
            user,
            ["full_name", "first_name", "last_name", "user_image", "user_type"],
            as_dict=True,
        )

        is_portal = bool(set(roles).intersection(permissions.CUSTOMER_ROLES))
        is_internal = any(role in roles for role in INTERNAL_ROLES) and not (
            permissions.is_customer_contact(user)
        )

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
            "department": profile.department if profile else None,
            "client_user": profile.name if profile else None,
            "is_portal_user": is_portal and not is_internal,
            "is_internal_user": is_internal,
            "can_see_invoices": permissions.may_see_invoices(user),
            # the second factor, and the deadline it is bound to: the client
            # counts down to the moment Frappe drops the session and a fresh
            # code will be asked for
            "two_factor_enabled": TwoFactorService.has_secret(user),
            "two_factor_passed": TwoFactorService.gate_passed(user),
            "session_expiry_seconds": TwoFactorService.session_expiry_seconds(),
        }
