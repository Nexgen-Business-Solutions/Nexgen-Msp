import frappe

from nexgen_msp.utils import permissions

PORTAL_ROLE = "Customer Portal Manager"
INTERNAL_ROLES = ("MSP System Admin", "MSP Technician", "System Manager", "Administrator")


class SessionService:
    @staticmethod
    def get_session_context():
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

        is_portal = PORTAL_ROLE in roles
        is_internal = any(role in roles for role in INTERNAL_ROLES)

        profile = frappe.db.get_value(
            "Client User", {"portal_user": user}, ["name", "department"], as_dict=True
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
            "customer": customers[0] if customers else None,
            "department": profile.department if profile else None,
            "client_user": profile.name if profile else None,
            "is_portal_user": is_portal and not is_internal,
            "is_internal_user": is_internal,
        }
