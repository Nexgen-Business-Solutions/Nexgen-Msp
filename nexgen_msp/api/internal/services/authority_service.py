"""Who, at a customer, may decide — read and written from the account's own page."""

import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils import approval, permissions
from nexgen_msp.utils.errors import NotFoundError, ValidationError

RIGHTS = approval.RIGHTS


def _accounts_of(customer):
    """Every account that answers for this customer, which is who could decide for it."""
    users = frappe.db.sql_list(
        """
        select distinct up.user
        from `tabUser Permission` up
        join `tabUser` u on u.name = up.user
        where up.allow = 'Customer' and up.for_value = %(customer)s and u.enabled = 1
        """,
        {"customer": customer},
    )

    rows = []

    for user in users:
        if not set(frappe.get_roles(user)).intersection(permissions.CUSTOMER_ROLES):
            continue

        rows.append(
            {
                "user": user,
                "full_name": frappe.db.get_value("User", user, "full_name") or user,
            }
        )

    return sorted(rows, key=lambda row: (row["full_name"] or "").lower())


class AuthorityService:
    @staticmethod
    def get_authority(customer=None):
        """The accounts that decide at this customer, and everyone who could be named."""
        ContractService._guard_admin()

        if not customer or not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        name = frappe.db.get_value(approval.AUTHORITY, {"customer": customer}, "name")
        doc = frappe.get_doc(approval.AUTHORITY, name) if name else None

        return {
            "customer": customer,
            "enabled": bool(doc.enabled) if doc else True,
            "approvers": [
                {
                    "user": row.user,
                    "full_name": row.full_name,
                    "department": row.department,
                    **{right: bool(row.get(right)) for right in RIGHTS},
                }
                for row in (doc.approvers if doc else [])
            ],
            "candidates": _accounts_of(customer),
            # said on the page as well as by mail: a company nobody can raise for, or
            # nobody can agree for, is stuck
            "gaps": approval.gaps(customer),
        }

    @staticmethod
    def _authority_for(customer):
        name = frappe.db.get_value(approval.AUTHORITY, {"customer": customer}, "name")

        if name:
            return frappe.get_doc(approval.AUTHORITY, name)

        return frappe.get_doc({"doctype": approval.AUTHORITY, "customer": customer, "enabled": 1})

    @staticmethod
    def get_account_rights(user=None):
        """What one account may decide, read from its own page."""
        ContractService._guard_admin()

        if not user or not frappe.db.exists("User", user):
            raise NotFoundError(f"User {user} not found.", "NOT_FOUND")

        customers = permissions.get_allowed_customers(user)
        is_customer = bool(set(frappe.get_roles(user)).intersection(permissions.CUSTOMER_ROLES))
        customer = customers[0] if (is_customer and customers) else None

        row = None

        if customer:
            doc = approval.authority_for(customer)
            row = next((line for line in doc.approvers if line.user == user), None) if doc else None

        return {
            "user": user,
            "customer": customer,
            "is_customer_account": is_customer,
            "named": bool(row),
            "department": row.department if row else None,
            **{right: bool(row.get(right)) if row else False for right in RIGHTS},
        }

    @staticmethod
    def set_account_rights(user=None, rights=None):
        """Give or take what this account decides for its company."""
        ContractService._guard_admin()

        if not user or not frappe.db.exists("User", user):
            raise NotFoundError(f"User {user} not found.", "NOT_FOUND")

        if not set(frappe.get_roles(user)).intersection(permissions.CUSTOMER_ROLES):
            raise ValidationError(
                f"{user} is not a customer account, so it has nothing to decide.",
                "VALIDATION_ERROR",
            )

        customers = permissions.get_allowed_customers(user)

        if not customers:
            raise ValidationError(
                f"{user} is not linked to a customer.", "VALIDATION_ERROR"
            )

        customer = customers[0]
        rights = frappe.parse_json(rights) if isinstance(rights, str) else (rights or {})
        wanted = {right: 1 if rights.get(right) else 0 for right in RIGHTS}
        department = (rights.get("department") or "").strip() or None

        doc = AuthorityService._authority_for(customer)
        row = next((line for line in doc.approvers if line.user == user), None)

        # a line that grants nothing is a line that says nothing: it is removed rather than
        # left behind as an approver who cannot approve
        if not any(wanted.values()):
            if row:
                doc.remove(row)
                doc.save(ignore_permissions=True)
                frappe.db.commit()

            approval.warn_admins_of_gaps(customer)

            return AuthorityService.get_account_rights(user)

        if row:
            row.update(wanted)
            row.department = department
        else:
            doc.append("approvers", {"user": user, "department": department, **wanted})

        doc.save(ignore_permissions=True)
        frappe.db.commit()

        approval.warn_admins_of_gaps(customer)

        return AuthorityService.get_account_rights(user)

    @staticmethod
    def save_authority(customer=None, enabled=1, approvers=None):
        """Write the whole matrix of a customer at once."""
        ContractService._guard_admin()

        if not customer or not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        approvers = frappe.parse_json(approvers) if isinstance(approvers, str) else (approvers or [])

        doc = AuthorityService._authority_for(customer)
        doc.enabled = 1 if frappe.utils.cint(enabled) else 0
        doc.set("approvers", [])

        for row in approvers:
            account = (row.get("user") or "").strip()

            if not account:
                continue

            doc.append(
                "approvers",
                {
                    "user": account,
                    "department": (row.get("department") or "").strip() or None,
                    **{right: 1 if row.get(right) else 0 for right in RIGHTS},
                },
            )

        doc.save(ignore_permissions=True)
        frappe.db.commit()

        return AuthorityService.get_authority(customer)
