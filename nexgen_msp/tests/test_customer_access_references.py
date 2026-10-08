"""A customer role is a promise that the account answers for a company; these check it holds."""

import frappe

from nexgen_msp.api.internal.services.team_service import TeamService
from nexgen_msp.utils import permissions

from .base import MSPTestCase


class AccessCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.mine = self.make_customer(f"AC{self.tag[:4]}")
        self.theirs = self.make_customer(f"AD{self.tag[:4]}")
        self.track("MSP Approval Authority", self.mine)
        self.track("MSP Approval Authority", self.theirs)

    def account(self, role="MSP Customer Manager", customer=None, suffix=None):
        return self.make_account(
            "customer" if role in permissions.CUSTOMER_ROLES else "internal",
            role,
            (customer or self.mine) if role in permissions.CUSTOMER_ROLES else None,
            suffix=suffix or f"ar{self.tag[:3]}",
        )

    def strip_contacts(self, user):
        for contact in frappe.get_all("Contact", filters={"user": user}, pluck="name"):
            frappe.db.sql("delete from `tabDynamic Link` where parenttype='Contact' and parent=%s", contact)
        frappe.db.commit()

    def strip_permissions(self, user):
        for row in frappe.get_all("User Permission", filters={"user": user, "allow": "Customer"}, pluck="name"):
            frappe.delete_doc("User Permission", row, ignore_permissions=True)
        frappe.db.commit()


class TestWhatReconciliationConcludes(AccessCase):
    def test_references_that_already_agree_are_left_alone(self):
        user = self.account()

        outcome = permissions.reconcile_customer_permissions(user)

        self.assertEqual(outcome["status"], permissions.HEALTHY)
        self.assertEqual(outcome["contact_customers"], [self.mine])
        self.assertEqual(outcome["permission_customers"], [self.mine])
        self.assertEqual(outcome["added_contact_links"], [])
        self.assertEqual(outcome["added_permissions"], [])
        self.assertEqual(outcome["removed_permissions"], [])

    def test_a_permission_with_no_contact_behind_it_writes_the_contact(self):
        user = self.account()
        self.strip_contacts(user)

        outcome = permissions.reconcile_customer_permissions(user)

        self.assertEqual(outcome["status"], permissions.REPAIRED_CONTACT_LINK)
        self.assertEqual(outcome["added_contact_links"], [self.mine])
        self.assertEqual(permissions.customers_from_contacts(user), {self.mine})
        self.assertEqual(outcome["removed_permissions"], [])

    def test_a_contact_with_no_permission_behind_it_writes_the_permission(self):
        user = self.account()
        self.strip_permissions(user)

        outcome = permissions.reconcile_customer_permissions(user)

        self.assertEqual(outcome["status"], permissions.REPAIRED_USER_PERMISSION)
        self.assertEqual(outcome["added_permissions"], [self.mine])
        self.assertEqual(permissions.customer_permissions_of(user), {self.mine})

    def test_neither_reference_is_never_invented(self):
        user = self.account()
        self.strip_contacts(user)
        self.strip_permissions(user)

        outcome = permissions.reconcile_customer_permissions(user)

        self.assertEqual(outcome["status"], permissions.MISSING_CUSTOMER_REFERENCE)
        self.assertEqual(permissions.customers_from_contacts(user), set())
        self.assertEqual(permissions.customer_permissions_of(user), set())
        self.assertIn("not linked to any Customer", permissions.STATUS_TEXT[outcome["status"]])

    def test_two_references_that_disagree_are_never_merged_or_trimmed(self):
        user = self.account()
        permissions.add_customer_permission(user, self.theirs)
        frappe.db.commit()

        outcome = permissions.reconcile_customer_permissions(user)

        self.assertEqual(outcome["status"], permissions.CUSTOMER_REFERENCE_CONFLICT)
        self.assertEqual(outcome["removed_permissions"], [])
        self.assertEqual(permissions.customer_permissions_of(user), {self.mine, self.theirs})
        self.assertEqual(permissions.customers_from_contacts(user), {self.mine})

    def test_an_account_holding_both_families_is_refused(self):
        user = self.account()
        user_doc = frappe.get_doc("User", user)
        user_doc.append("roles", {"role": "MSP Technician"})
        user_doc.save(ignore_permissions=True)
        frappe.db.commit()

        outcome = permissions.reconcile_customer_permissions(user)

        self.assertEqual(outcome["status"], permissions.ROLE_FAMILY_CONFLICT)
        self.assertIn("both customer and Nexgen staff roles", permissions.STATUS_TEXT[outcome["status"]])

    def test_an_account_with_no_customer_role_is_not_reconciled(self):
        tech = self.account(role="MSP Technician", suffix=f"at{self.tag[:3]}")

        outcome = permissions.reconcile_customer_permissions(tech)

        self.assertEqual(outcome["status"], permissions.NOT_CUSTOMER_ACCOUNT)
        self.assertEqual(outcome["added_contact_links"], [])
        self.assertEqual(outcome["added_permissions"], [])

    def test_a_person_of_two_companies_is_healthy_when_both_agree(self):
        user = self.account()
        user_doc = frappe.get_doc("User", user)
        permissions.ensure_customer_contact(user_doc, self.theirs)
        permissions.add_customer_permission(user, self.theirs)
        frappe.db.commit()

        outcome = permissions.reconcile_customer_permissions(user)

        self.assertEqual(outcome["status"], permissions.HEALTHY)
        self.assertEqual(outcome["contact_customers"], sorted([self.mine, self.theirs]))

    def test_a_person_of_two_companies_gets_both_contact_links_written(self):
        user = self.account()
        permissions.add_customer_permission(user, self.theirs)
        self.strip_contacts(user)

        outcome = permissions.reconcile_customer_permissions(user)

        self.assertEqual(outcome["status"], permissions.REPAIRED_CONTACT_LINK)
        self.assertEqual(permissions.customers_from_contacts(user), {self.mine, self.theirs})

    def test_a_client_user_with_the_same_address_is_never_consulted(self):
        user = self.account()
        self.strip_contacts(user)
        self.strip_permissions(user)
        person = self.make_person(self.theirs, "Namesake")
        frappe.db.set_value("MSP Client User", person, "email", user)
        frappe.db.commit()

        outcome = permissions.reconcile_customer_permissions(user)

        self.assertEqual(outcome["status"], permissions.MISSING_CUSTOMER_REFERENCE)
        self.assertEqual(permissions.customer_permissions_of(user), set())


class TestTheSweep(AccessCase):
    def test_it_finds_an_account_by_its_role_even_with_no_contact(self):
        user = self.account()
        self.strip_contacts(user)

        self.assertIn(user, permissions.customer_role_accounts())

        permissions.reconcile_all_customer_permissions()

        self.assertEqual(permissions.customers_from_contacts(user), {self.mine})

    def test_runtime_access_stays_the_intersection(self):
        user = self.account()
        permissions.add_customer_permission(user, self.theirs)
        frappe.db.commit()

        self.assertEqual(permissions.get_allowed_customers(user), [self.mine])


class TestTheAccountsScreen(AccessCase):
    def test_an_account_carries_its_access_state(self):
        user = self.account()

        card = TeamService.get_member(user)

        self.assertEqual(card["access"]["status"], permissions.HEALTHY)
        self.assertEqual(card["access"]["contact_customers"], [self.mine])
        self.assertEqual(card["access"]["permission_customers"], [self.mine])

    def test_a_conflict_is_reported_rather_than_resolved(self):
        user = self.account()
        permissions.add_customer_permission(user, self.theirs)
        frappe.db.commit()

        card = TeamService.get_member(user)

        self.assertEqual(card["access"]["status"], permissions.CUSTOMER_REFERENCE_CONFLICT)
        self.assertIn("references disagree", card["access"]["message"])

    def test_an_administrator_settles_it_by_naming_the_side_that_is_right(self):
        user = self.account()
        permissions.add_customer_permission(user, self.theirs)
        frappe.db.commit()

        card = TeamService.resolve_access_references(email=user, source="contact")

        self.assertEqual(card["access"]["status"], permissions.HEALTHY)
        self.assertEqual(permissions.customer_permissions_of(user), {self.mine})
        self.assertEqual(permissions.customers_from_contacts(user), {self.mine})


class TestMovingAnAccountToAnotherCompany(AccessCase):
    """Naming one company must move every reference, or the account ends up half moved.

    Four records say which company an account answers for, and a screen reads a different
    one depending on the question. A move that writes some of them leaves the account
    reachable where it no longer belongs.
    """

    def references(self, user):
        return {
            "permission": frappe.get_all(
                "User Permission",
                filters={"user": user, "allow": "Customer"},
                pluck="for_value",
            ),
            "contact": sorted(permissions.customers_from_contacts(user)),
            "allowed": permissions.get_allowed_customers(user),
            "matrix": frappe.db.sql_list(
                "select parent from `tabMSP Approver` where user = %s", user
            ),
        }

    def test_it_writes_the_user_permission_and_the_contact_link_together(self):
        user = self.account(suffix=f"mv{self.tag[:3]}")

        TeamService.resolve_access_references(email=user, customers=[self.theirs])

        told = self.references(user)
        self.assertEqual(told["permission"], [self.theirs])
        self.assertEqual(told["contact"], [self.theirs])
        self.assertEqual(told["allowed"], [self.theirs])

    def test_the_company_left_behind_keeps_no_reference_at_all(self):
        user = self.account(suffix=f"ml{self.tag[:3]}")

        TeamService.resolve_access_references(email=user, customers=[self.theirs])

        told = self.references(user)
        for side, value in told.items():
            self.assertNotIn(self.mine, value, f"{self.mine} still named by {side}")

    def test_the_authority_line_moves_with_the_rest(self):
        from nexgen_msp.api.internal.services.authority_service import AuthorityService

        user = self.account(suffix=f"ma{self.tag[:3]}")
        AuthorityService.set_account_rights(user, {"can_submit": 1, "can_approve": 1})
        self.assertEqual(self.references(user)["matrix"], [self.mine])

        TeamService.resolve_access_references(email=user, customers=[self.theirs])

        self.assertEqual(self.references(user)["matrix"], [])

    def test_the_contact_itself_survives_the_move(self):
        """The link changes company; the person is not deleted and recreated."""
        user = self.account(suffix=f"mc{self.tag[:3]}")
        before = frappe.get_all("Contact", filters={"user": user}, pluck="name")

        TeamService.resolve_access_references(email=user, customers=[self.theirs])

        self.assertEqual(frappe.get_all("Contact", filters={"user": user}, pluck="name"), before)
        self.assertEqual(len(before), 1, "one person, one contact")
