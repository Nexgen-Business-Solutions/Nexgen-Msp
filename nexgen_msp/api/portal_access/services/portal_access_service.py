import frappe

from nexgen_msp.utils import permissions
from nexgen_msp.utils.errors import NotFoundError, ValidationError


class PortalAccessService:
    @staticmethod
    def grant(customer=None, email=None, first_name=None, last_name=None, send_welcome_email=0):
        permissions.guard_can_manage_access()

        if not customer or not email:
            raise ValidationError("customer and email are required.", "VALIDATION_ERROR")

        email = email.strip().lower()

        if not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} does not exist.", "NOT_FOUND")

        user, user_created = permissions.ensure_portal_user(
            email, first_name, last_name, send_welcome_email
        )
        role_added = permissions.add_role(user, permissions.PORTAL_ROLES[0])
        contact, contact_created = permissions.ensure_customer_contact(user, customer)
        permission_added = permissions.add_customer_permission(email, customer)

        frappe.db.commit()

        return {
            "user": user.name,
            "customer": customer,
            "contact": contact,
            "created": {
                "user": user_created,
                "role": role_added,
                "contact": contact_created,
                "user_permission": permission_added,
            },
            "allowed_customers": permissions.get_allowed_customers(email),
        }

    @staticmethod
    def revoke(email=None, customer=None):
        permissions.guard_can_manage_access()

        if not email:
            raise ValidationError("email is required.", "VALIDATION_ERROR")

        email = email.strip().lower()

        if not frappe.db.exists("User", email):
            raise NotFoundError(f"User {email} does not exist.", "NOT_FOUND")

        removed = permissions.remove_customer_permission(email, customer)
        remaining = len(permissions.get_allowed_customers(email))

        user = frappe.get_doc("User", email)
        if not remaining:
            permissions.remove_roles(user, permissions.PORTAL_ROLES)
            user.enabled = 0
            user.save(ignore_permissions=True)

        frappe.db.commit()

        return {
            "user": email,
            "permissions_removed": removed,
            "permissions_left": remaining,
            "user_disabled": not remaining,
        }

    @staticmethod
    def list_access(customer=None):
        permissions.guard_can_manage_access()

        filters = {"allow": "Customer"}
        if customer:
            filters["for_value"] = customer

        rows = frappe.db.get_all(
            "User Permission", filters=filters, fields=["user", "for_value"], limit_page_length=0
        )

        access = []
        for row in rows:
            user = frappe.db.get_value(
                "User", row.user, ["full_name", "enabled", "user_type"], as_dict=True
            )
            if not user:
                continue
            access.append(
                {
                    "user": row.user,
                    "customer": row.for_value,
                    "full_name": user.full_name,
                    "enabled": user.enabled,
                    "user_type": user.user_type,
                }
            )

        return {"access": access, "count": len(access)}
