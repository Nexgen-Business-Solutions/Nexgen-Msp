"""A line left on the wrong matrix misinforms a screen; it opens no door.

Issue #17 asks the question outright and refuses to assume the answer: is the discrepancy
display-only, or does it also let somebody act on a company that is not theirs? These answer
it by signing in as that account and trying.

The distinction matters because the two facts come from different places. What an account may
*reach* is the Customer permission on its own record. What it may *decide* is the matrix. A
stale line writes the second without the first, and every portal path resolves the company
from the first.
"""

import frappe

from nexgen_msp.api.internal.services.authority_service import AuthorityService
from nexgen_msp.utils import access, approval, permissions
from nexgen_msp.utils.errors import ValidationError as ServiceRefused

from .base import MSPTestCase


class StaleLineCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=4)
        self.theirs = self.make_customer(f"GRA{self.tag}A")
        self.mine = self.make_customer(f"GRA{self.tag}B")
        self.person = self.make_person(self.theirs, "Someone Else")
        self.stranger = self.make_account(
            "customer", "MSP Customer Manager", customer=self.mine, suffix=f"gra{self.tag}"
        )
        self.plant()

    def plant(self):
        """The stranger named on a matrix it does not belong to."""
        AuthorityService.set_account_rights(
            self.make_account(
                "customer", "MSP Customer Manager", customer=self.theirs, suffix=f"own{self.tag}"
            ),
            {"can_submit": 1, "can_approve": 1},
        )
        parent = frappe.db.get_value(
            "MSP Approval Authority", {"customer": self.theirs}, "name"
        )
        frappe.db.sql(
            "insert into `tabMSP Approver` (name, parent, parenttype, parentfield, user,"
            " full_name, can_submit, can_approve, idx, creation, modified, owner, modified_by)"
            " values (%s, %s, 'MSP Approval Authority', 'approvers', %s, 'A Stranger', 1, 1, 9,"
            " now(), now(), 'Administrator', 'Administrator')",
            (f"zzgrant-{self.tag}", parent, self.stranger),
        )
        frappe.db.commit()
        frappe.clear_cache(doctype="MSP Approval Authority")

    def as_stranger(self):
        frappe.set_user(self.stranger)


class TestWhatTheLineDoesGive(StaleLineCase):
    def test_the_matrix_answers_yes_on_paper(self):
        """The rights really are written there — which is why the screen shows them."""
        rights = approval.rights_of(self.theirs, self.stranger)

        self.assertTrue(rights.get("can_submit"))
        self.assertTrue(rights.get("can_approve"))


class TestWhatItDoesNotGive(StaleLineCase):
    def test_the_account_cannot_reach_that_company_at_all(self):
        self.as_stranger()

        self.assertEqual(permissions.get_allowed_customers(self.stranger), [self.mine])
        self.assertNotIn(self.theirs, access.allowed_customers())
        self.assertFalse(access.may_reach(self.theirs))

    def test_naming_that_company_outright_is_refused(self):
        self.as_stranger()

        with self.assertRaises(ServiceRefused):
            access.resolve_customer(self.theirs)

    def test_asking_for_nothing_in_particular_gives_its_own_company(self):
        """The company is resolved from the account, never taken from the request."""
        self.as_stranger()

        self.assertEqual(access.resolve_customer(None), self.mine)

    def test_it_may_not_read_the_other_company_operations(self):
        self.as_stranger()

        self.assertFalse(access.allows("view_customer_operations", customer=self.theirs))

    def test_it_may_not_edit_the_other_company_details(self):
        self.as_stranger()

        self.assertFalse(access.allows("edit_customer_profile", customer=self.theirs))

    def test_the_people_of_that_company_stay_out_of_reach(self):
        """The person really exists there; the query is scoped to the account's own company."""
        self.as_stranger()
        from nexgen_msp.api.portal.services.portal_service import PortalService

        try:
            answer = PortalService.list_client_users()
        except Exception as refusal:
            self.assertIsInstance(refusal, ServiceRefused)
            return

        names = [row.get("name") for row in answer["rows"]]

        self.assertNotIn(self.person, names)
        self.assertEqual(
            names, [], "its own company has nobody, and the other one is not consulted"
        )


class TestTheRightOnPaperCanNeverBeUsed(StaleLineCase):
    def test_a_request_of_that_company_cannot_even_be_opened(self):
        """Approving needs a request, and a request needs a company it may reach."""
        self.as_stranger()

        self.assertFalse(access.may_reach(self.theirs))
        self.assertNotIn(self.theirs, access.allowed_customers())

    def test_so_the_damage_is_what_the_screen_says_and_nothing_more(self):
        """Stated as the conclusion of #17: display-only, and still worth removing."""
        self.as_stranger()
        reachable = access.allowed_customers()

        self.assertEqual(reachable, [self.mine])
        self.assertTrue(approval.rights_of(self.theirs, self.stranger).get("can_approve"))
