"""Who, at a customer, may decide — read and written from the customer's own page."""

import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils import approval
from nexgen_msp.utils.errors import NotFoundError, ValidationError

RIGHTS = approval.RIGHTS


class AuthorityService:
    @staticmethod
    def get_authority(customer=None):
        """The people who decide at this customer, and everyone who could be named."""
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
                    "client_user": row.client_user,
                    "full_name": row.full_name,
                    "department": row.department,
                    **{right: bool(row.get(right)) for right in RIGHTS},
                }
                for row in (doc.approvers if doc else [])
            ],
            # only someone with a portal account can decide: the accord is given by signing in
            "candidates": frappe.db.sql(
                """
                select name, full_name, department, portal_user
                from `tabMSP Client User`
                where customer = %(customer)s
                  and lifecycle_status in ('Pending', 'Active')
                order by full_name asc
                """,
                {"customer": customer},
                as_dict=True,
            ),
        }

    @staticmethod
    def rights_of_person(client_user=None):
        """One person's line in their company's matrix, read from their own page."""
        ContractService._guard_admin()

        person = frappe.db.get_value(
            "MSP Client User", client_user, ["name", "customer", "portal_user"], as_dict=True
        )

        if not person:
            raise NotFoundError(f"Client User {client_user} not found.", "NOT_FOUND")

        name = frappe.db.get_value(approval.AUTHORITY, {"customer": person.customer}, "name")
        row = None

        if name:
            doc = frappe.get_doc(approval.AUTHORITY, name)
            row = next((r for r in doc.approvers if r.client_user == person.name), None)

        return {
            "client_user": person.name,
            "customer": person.customer,
            "has_portal": bool(person.portal_user),
            "named": bool(row),
            "department": row.department if row else None,
            **{right: bool(row.get(right)) if row else False for right in RIGHTS},
        }

    @staticmethod
    def set_rights_of_person(client_user=None, rights=None):
        """Give or take one person's rights without opening the customer's page.

        Writes into the same document the customer page shows — there is one matrix per
        customer, and this is another door onto it, not a second copy.
        """
        ContractService._guard_admin()

        person = frappe.db.get_value(
            "MSP Client User", client_user, ["name", "customer", "full_name"], as_dict=True
        )

        if not person:
            raise NotFoundError(f"Client User {client_user} not found.", "NOT_FOUND")

        rights = frappe.parse_json(rights) if isinstance(rights, str) else (rights or {})
        wanted = {right: 1 if rights.get(right) else 0 for right in RIGHTS}
        department = (rights.get("department") or "").strip() or None

        name = frappe.db.get_value(approval.AUTHORITY, {"customer": person.customer}, "name")
        doc = (
            frappe.get_doc(approval.AUTHORITY, name)
            if name
            else frappe.get_doc({"doctype": approval.AUTHORITY, "customer": person.customer})
        )

        row = next((r for r in doc.approvers if r.client_user == person.name), None)

        if not any(wanted.values()):
            # nothing left to grant: the line goes rather than lingering with every box off
            if row:
                doc.approvers.remove(row)
                doc.save(ignore_permissions=True)
                frappe.db.commit()

            return AuthorityService.rights_of_person(person.name)

        if wanted.get("can_approve") and not frappe.db.get_value(
            "MSP Client User", person.name, "portal_user"
        ):
            raise ValidationError(
                f"{person.full_name} has no portal access yet — they cannot sign in to approve "
                "anything. Invite them first.",
                "VALIDATION_ERROR",
            )

        if row:
            row.update({**wanted, "department": department})
        else:
            doc.append("approvers", {"client_user": person.name, "department": department, **wanted})

        doc.enabled = 1
        doc.save(ignore_permissions=True)
        doc.add_comment("Comment", f"{person.full_name} updated by {frappe.session.user}.")
        frappe.db.commit()

        return AuthorityService.rights_of_person(person.name)

    @staticmethod
    def save_authority(customer=None, enabled=1, approvers=None):
        """Replace the matrix of one customer, in one gesture."""
        ContractService._guard_admin()

        if not customer or not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        approvers = frappe.parse_json(approvers) if isinstance(approvers, str) else (approvers or [])
        name = frappe.db.get_value(approval.AUTHORITY, {"customer": customer}, "name")

        doc = (
            frappe.get_doc(approval.AUTHORITY, name)
            if name
            else frappe.get_doc({"doctype": approval.AUTHORITY, "customer": customer})
        )

        doc.enabled = frappe.utils.cint(enabled)
        doc.approvers = []

        for row in approvers:
            person = (row.get("client_user") or "").strip()

            if not person:
                continue

            if not frappe.db.get_value("MSP Client User", person, "portal_user"):
                full_name = frappe.db.get_value("MSP Client User", person, "full_name") or person
                raise ValidationError(
                    f"{full_name} has no portal access yet — they cannot sign in to approve "
                    "anything. Invite them first.",
                    "VALIDATION_ERROR",
                )

            doc.append(
                "approvers",
                {
                    "client_user": person,
                    "department": (row.get("department") or "").strip() or None,
                    **{right: 1 if row.get(right) else 0 for right in RIGHTS},
                },
            )

        doc.save(ignore_permissions=True)
        doc.add_comment("Comment", f"Updated by {frappe.session.user}.")
        frappe.db.commit()

        return AuthorityService.get_authority(customer)
