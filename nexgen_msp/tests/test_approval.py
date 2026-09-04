"""Who decides at a customer, now that deciding is something an account does."""

import frappe

from nexgen_msp.api.internal.services.authority_service import AuthorityService
from nexgen_msp.api.portal.services.portal_service import PortalService
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


class TestACompanyNobodyCanActFor(MSPTestCase):
    """Our administrators hear when a company has nobody to raise, or nobody to agree."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.marker = f"msp_authority_gap::{self.customer}"
        self.admin = self.make_account("internal", "MSP System Admin", suffix="gpa")
        self.operator = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="gpo")
        # opening the account already warned once; each test starts from silence
        frappe.db.set_default(self.marker, "")
        frappe.db.delete("Email Queue")
        frappe.db.commit()

    def tearDown(self):
        frappe.db.set_default(self.marker, "")
        super().tearDown()

    def mails_to_admin(self):
        return frappe.db.sql(
            """
            select eq.name from `tabEmail Queue` eq
            join `tabEmail Queue Recipient` r on r.parent = eq.name
            where r.recipient = %s and eq.message like %s
            """,
            (self.admin, "%A company is stuck%"),
        )

    def test_an_unnamed_account_may_raise_but_nobody_may_approve(self):
        state = approval.gaps(self.customer)

        self.assertEqual(state["accounts"], 1)
        self.assertFalse(state["nobody_may_raise"])
        self.assertTrue(state["nobody_may_approve"])

    def test_naming_the_only_account_approve_only_leaves_nobody_to_raise(self):
        self.grant(self.operator, can_submit=0, can_approve=1)

        state = approval.gaps(self.customer)
        self.assertTrue(state["nobody_may_raise"])
        self.assertFalse(state["nobody_may_approve"])

    def test_both_rights_on_one_account_close_every_gap(self):
        self.grant(self.operator, can_submit=1, can_approve=1)

        state = approval.gaps(self.customer)
        self.assertFalse(state["nobody_may_raise"])
        self.assertFalse(state["nobody_may_approve"])

    def test_a_disabled_approver_no_longer_counts(self):
        self.grant(self.operator, can_submit=1, can_approve=1)
        frappe.db.set_value("User", self.operator, "enabled", 0)

        state = approval.gaps(self.customer)
        self.assertEqual(state["accounts"], 0)
        self.assertTrue(state["nobody_may_raise"])
        self.assertTrue(state["nobody_may_approve"])

    def test_the_administrator_is_told_once_per_state(self):
        self.assertTrue(approval.warn_admins_of_gaps(self.customer))
        self.assertEqual(len(self.mails_to_admin()), 1)

        # the same gap is not repeated
        self.assertFalse(approval.warn_admins_of_gaps(self.customer))
        self.assertEqual(len(self.mails_to_admin()), 1)

        # closed, nothing is said; reopened, it is said again
        self.grant(self.operator, can_submit=1, can_approve=1)
        self.assertEqual(len(self.mails_to_admin()), 1)
        self.grant(self.operator, can_submit=1, can_approve=0)
        self.assertEqual(len(self.mails_to_admin()), 2)

    def test_a_request_waiting_on_nobody_tells_the_administrator_which_one(self):
        person = self.make_person(self.customer, "Subject")
        service = self.make_service("GP", scope="User")

        frappe.set_user(self.operator)
        try:
            out = PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=[
                    {
                        "request_action": self.action(),
                        "action": "Add",
                        "target_scope": "User",
                        "client_user": person,
                        "requested_service": service,
                    }
                ],
            )
        finally:
            frappe.set_user("Administrator")
        name = self.track("MSP Service Request", out["name"])

        self.assertEqual(out["status"], "Awaiting Customer Approval")
        mails = self.mails_to_admin()
        self.assertEqual(len(mails), 1)
        self.assertIn(name, frappe.db.get_value("Email Queue", mails[0][0], "message"))
