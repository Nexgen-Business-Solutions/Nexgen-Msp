"""Who decides at a customer, now that deciding is something an account does."""

import frappe

from nexgen_msp.api.internal.services.authority_service import AuthorityService
from nexgen_msp.utils import approval
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase


class TestApproval(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.account = self.make_account("customer", "MSP Customer Manager", self.customer)
        self.track(approval.AUTHORITY, self.customer)

    def test_an_account_starts_with_nothing(self):
        rights = AuthorityService.get_account_rights(self.account)

        self.assertFalse(rights["named"])
        self.assertFalse(rights["can_approve"])
        self.assertEqual(rights["customer"], self.customer)

    def test_rights_are_given_and_read_back(self):
        AuthorityService.set_account_rights(self.account, {"can_submit": 1, "can_approve": 1})
        rights = AuthorityService.get_account_rights(self.account)

        self.assertTrue(rights["named"])
        self.assertTrue(rights["can_approve"])

    def test_the_signed_in_account_sees_its_own_rights(self):
        AuthorityService.set_account_rights(self.account, {"can_submit": 1, "can_approve": 1})

        frappe.set_user(self.account)
        held = approval.rights_of(self.customer)
        frappe.set_user("Administrator")

        self.assertEqual(held["user"], self.account)
        self.assertTrue(held["can_approve"])

    def test_a_line_granting_nothing_is_removed(self):
        AuthorityService.set_account_rights(self.account, {"can_submit": 1})
        AuthorityService.set_account_rights(self.account, {})

        self.assertFalse(AuthorityService.get_account_rights(self.account)["named"])
        self.assertFalse(approval.has_approvers(self.customer))

    def test_an_internal_account_has_nothing_to_decide(self):
        staff = self.make_account("internal", "MSP Technician", suffix="staff")

        with self.assertRaises(ValidationError):
            AuthorityService.set_account_rights(staff, {"can_approve": 1})

    def test_the_matrix_only_offers_accounts_of_that_customer(self):
        other = self.make_customer("B")
        stranger = self.make_account("customer", "MSP Customer Operator", other, suffix="other")

        candidates = [row["user"] for row in AuthorityService.get_authority(self.customer)["candidates"]]

        self.assertIn(self.account, candidates)
        self.assertNotIn(stranger, candidates)

    def test_an_account_of_another_customer_cannot_be_named(self):
        other = self.make_customer("B")
        stranger = self.make_account("customer", "MSP Customer Operator", other, suffix="other")

        with self.assertRaises(frappe.ValidationError):
            AuthorityService.save_authority(
                customer=self.customer,
                approvers=[{"user": stranger, "can_submit": 1, "can_approve": 1}],
            )

    def test_the_same_account_cannot_be_named_twice(self):
        with self.assertRaises(frappe.ValidationError):
            AuthorityService.save_authority(
                customer=self.customer,
                approvers=[
                    {"user": self.account, "can_submit": 1},
                    {"user": self.account, "can_approve": 1},
                ],
            )

    def test_a_customer_with_no_approver_changes_nothing(self):
        self.assertFalse(approval.has_approvers(self.customer))
