"""Reaching a company takes two proofs, and neither one alone will do.

A Contact record naming the account and linked to the company is the declaration. A User
Permission is the enforcement. An account reaches a company only where the two agree.

That is not pedantry. A permission left behind when somebody moved companies is the most
ordinary way an access outlives the reason for it, and on its own it must open nothing.

The second rule is that a customer's person is never one of ours, whatever roles the account
also happens to carry. Only the builtin Administrator is the exception, and it is written out
rather than arrived at through a role.
"""

import frappe

from nexgen_msp.utils import access
from nexgen_msp.utils.errors import ValidationError as Refused

from .base import MSPTestCase


class AccessCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.acme = self.make_customer(self.tag)
        self.beta = self.make_customer(f"{self.tag}B")

        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.acme, suffix=f"ca{self.tag[:3]}"
        )
        self.technician = self.make_account(
            "internal", "MSP Technician", suffix=f"ct{self.tag[:3]}"
        )
        self.admin = self.make_account(
            "internal", "MSP System Admin", suffix=f"cs{self.tag[:3]}"
        )

    # ------------------------------------------------------------------ the two proofs
    def declare(self, user, customer):
        """A contact naming the account and linked to the company."""
        from nexgen_msp.utils import permissions

        permissions.ensure_customer_contact(frappe.get_doc("User", user), customer)
        frappe.db.commit()

    def permit(self, user, customer):
        # declaring a contact already writes the permission, so this only fills a gap
        existing = frappe.db.get_value(
            "User Permission",
            {"user": user, "allow": "Customer", "for_value": customer},
            "name",
        )

        if existing:
            return self.track("User Permission", existing)

        doc = frappe.get_doc(
            {
                "doctype": "User Permission",
                "user": user,
                "allow": "Customer",
                "for_value": customer,
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()

        return self.track("User Permission", doc.name)

    def undeclare(self, user, customer):
        for contact in frappe.get_all("Contact", filters={"user": user}, pluck="name"):
            doc = frappe.get_doc("Contact", contact)
            doc.links = [row for row in doc.links if row.link_name != customer]
            doc.save(ignore_permissions=True)

        frappe.db.commit()

    def unpermit(self, user, customer):
        for row in frappe.get_all(
            "User Permission",
            filters={"user": user, "allow": "Customer", "for_value": customer},
            pluck="name",
        ):
            frappe.delete_doc("User Permission", row, ignore_permissions=True)

        frappe.db.commit()

    def reach(self, user):
        frappe.clear_cache(user=user)

        return access.allowed_customers(user)


class TestBothProofsAreNeeded(AccessCase):
    def test_an_account_set_up_properly_reaches_its_own_company(self):
        self.assertEqual(self.reach(self.manager), [self.acme])

    def test_a_permission_left_behind_opens_nothing(self):
        """The classic: somebody moved companies and the old row was never cleaned up."""
        self.permit(self.manager, self.beta)

        self.assertEqual(self.reach(self.manager), [self.acme])

    def test_a_contact_relationship_alone_is_not_enough(self):
        self.declare(self.manager, self.beta)
        self.unpermit(self.manager, self.beta)

        self.assertEqual(self.reach(self.manager), [self.acme])

    def test_a_permission_alone_is_not_enough(self):
        self.undeclare(self.manager, self.acme)

        self.assertEqual(self.reach(self.manager), [])

    def test_naming_a_company_they_cannot_reach_is_refused(self):
        frappe.clear_cache(user=self.manager)

        with self.assertRaises(Refused) as caught:
            access.resolve_customer(self.beta, user=self.manager)

        self.assertIn("not allowed", str(caught.exception))

    def test_a_company_that_does_not_exist_is_refused_the_same_way(self):
        """Telling the two apart would answer a question nobody asked."""
        frappe.clear_cache(user=self.manager)

        with self.assertRaises(Refused) as caught:
            access.resolve_customer(f"ZZTEST Nowhere {self.tag}", user=self.manager)

        self.assertIn("not allowed", str(caught.exception))


class TestSomebodyAtTwoCompanies(AccessCase):
    def setUp(self):
        super().setUp()
        self.declare(self.manager, self.beta)
        self.permit(self.manager, self.beta)

    def test_they_reach_both_and_nothing_else(self):
        third = self.make_customer(f"{self.tag}C")

        self.assertEqual(self.reach(self.manager), sorted([self.acme, self.beta]))
        self.assertNotIn(third, self.reach(self.manager))

    def test_they_must_say_which_one_they_are_acting_for(self):
        """Choosing whichever sorts first would quietly act on the wrong company."""
        frappe.clear_cache(user=self.manager)

        with self.assertRaises(Refused) as caught:
            access.resolve_customer(user=self.manager)

        self.assertIn("Say which customer", str(caught.exception))

    def test_saying_which_one_is_accepted(self):
        frappe.clear_cache(user=self.manager)

        self.assertEqual(access.resolve_customer(self.beta, user=self.manager), self.beta)

    def test_somebody_at_one_company_never_has_to_say(self):
        frappe.clear_cache(user=self.technician)

        self.assertEqual(access.resolve_customer(self.acme, user=self.technician), self.acme)


class TestACustomersPersonIsNeverOneOfOurs(AccessCase):
    def test_a_staff_role_added_by_mistake_widens_nothing(self):
        account = frappe.get_doc("User", self.manager)
        account.append("roles", {"role": "MSP Technician"})
        account.save(ignore_permissions=True)
        frappe.db.commit()

        self.assertEqual(self.reach(self.manager), [self.acme])
        self.assertFalse(access.is_staff(self.manager))

    def test_even_the_commercial_role_added_by_mistake_widens_nothing(self):
        account = frappe.get_doc("User", self.manager)
        account.append("roles", {"role": "MSP System Admin"})
        account.save(ignore_permissions=True)
        frappe.db.commit()

        self.assertEqual(self.reach(self.manager), [self.acme])
        self.assertFalse(access.can_view_all_customers(self.manager))

    def test_our_own_people_reach_every_company(self):
        frappe.clear_cache(user=self.technician)

        self.assertIn(self.acme, access.allowed_customers(self.technician))
        self.assertIn(self.beta, access.allowed_customers(self.technician))
        self.assertTrue(access.is_staff(self.technician))

    def test_the_builtin_administrator_is_the_written_exception(self):
        self.assertTrue(access.is_administrator("Administrator"))
        self.assertTrue(access.is_staff("Administrator"))
        self.assertIn(self.acme, access.allowed_customers("Administrator"))

    def test_an_account_halfway_through_being_removed_is_still_theirs(self):
        """Records disagreeing is not a reason to fall through into the staff branch."""
        self.unpermit(self.manager, self.acme)

        self.assertTrue(access.is_customer_account(self.manager))
        self.assertFalse(access.is_staff(self.manager))
        self.assertEqual(self.reach(self.manager), [])


class TestWhatEachRoleMayDo(AccessCase):
    def test_an_administrator_may_add_a_company(self):
        self.assertTrue(access.can_create_customer(self.admin))

    def test_a_technician_may_not(self):
        self.assertFalse(access.can_create_customer(self.technician))

    def test_a_technician_may_read_a_company_s_operations(self):
        self.assertTrue(
            access.can_view_customer_operations(customer=self.acme, user=self.technician)
        )

    def test_a_manager_may_read_only_their_own(self):
        frappe.clear_cache(user=self.manager)

        self.assertTrue(
            access.can_view_customer_operations(customer=self.acme, user=self.manager)
        )
        self.assertFalse(
            access.can_view_customer_operations(customer=self.beta, user=self.manager)
        )

    def test_a_manager_may_not_touch_commercial_terms(self):
        self.assertFalse(access.can_edit_customer_commercial(self.manager))
        self.assertFalse(access.can_manage_contracts(self.manager))
        self.assertFalse(access.can_manage_pricing(self.manager))

    def test_a_manager_may_correct_their_own_company_details(self):
        frappe.clear_cache(user=self.manager)

        self.assertTrue(
            access.can_edit_customer_profile(customer=self.acme, user=self.manager)
        )
        self.assertFalse(
            access.can_edit_customer_profile(customer=self.beta, user=self.manager)
        )

    def test_a_customer_never_carries_work_out(self):
        self.assertFalse(access.can_execute_requests(self.manager))
        self.assertTrue(access.can_execute_requests(self.technician))

    def test_settings_belong_to_the_administrator(self):
        self.assertTrue(access.can_manage_settings(self.admin))
        self.assertFalse(access.can_manage_settings(self.technician))
        self.assertFalse(access.can_manage_settings(self.manager))

    def test_a_capability_nobody_declared_is_an_error_not_a_yes(self):
        with self.assertRaises(Refused):
            access.allows("do_whatever")

    def test_asking_for_one_they_lack_refuses_in_its_own_words(self):
        with self.assertRaises(Refused) as caught:
            access.require("manage_pricing", user=self.technician)

        self.assertIn("pricing", str(caught.exception).lower())


class TestTheServicesAskThePolicy(AccessCase):
    def test_the_portal_reads_the_same_answer(self):
        from nexgen_msp.api.portal.services.portal_service import PortalService

        frappe.set_user(self.manager)
        frappe.clear_cache(user=self.manager)
        try:
            self.assertEqual(PortalService._resolve_customer(), self.acme)

            with self.assertRaises(Refused):
                PortalService._resolve_customer(self.beta)
        finally:
            frappe.set_user("Administrator")

    def test_a_stale_permission_reaches_nothing_through_the_portal_either(self):
        from nexgen_msp.api.portal.services.portal_service import PortalService

        self.permit(self.manager, self.beta)
        stranger = self.make_person(self.beta, "Stranger")

        frappe.set_user(self.manager)
        frappe.clear_cache(user=self.manager)
        try:
            with self.assertRaises(Refused):
                PortalService.get_user_detail(stranger)
        finally:
            frappe.set_user("Administrator")
