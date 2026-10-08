"""A line of the matrix outlives the account's link to the company it sits in.

The matrix is one document per company, so saving one person's rights revalidates every
line it holds. A line left behind by an account that moved on therefore blocks the whole
company — for everybody — and the refusal names somebody the reader never touched.
"""

import frappe

from nexgen_msp.api.internal.services.authority_service import AuthorityService
from nexgen_msp.utils import approval, permissions

from .base import MSPTestCase


def lines_of(customer):
    doc = frappe.db.get_value("MSP Approval Authority", {"customer": customer}, "name")

    return (
        [row.user for row in frappe.get_doc("MSP Approval Authority", doc).approvers]
        if doc
        else []
    )


class TestALineGoesWithTheCompanyItWasGivenFor(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.first = self.make_customer("STALE1")
        self.second = self.make_customer("STALE2")
        self.email = self.make_account(
            "customer", "MSP Customer Manager", customer=self.first, suffix="stale"
        )
        self.grant(self.email, can_submit=1, can_approve=1)

    def test_taking_the_company_away_takes_the_line_with_it(self):
        self.assertEqual(lines_of(self.first), [self.email])

        permissions.remove_customer_permission(self.email, self.first)

        self.assertEqual(lines_of(self.first), [])

    def test_moving_an_account_to_another_company_leaves_nothing_behind(self):
        """The move an administrator actually makes, from the account screen."""
        from nexgen_msp.api.internal.services.team_service import TeamService

        TeamService.resolve_access_references(email=self.email, customers=[self.second])
        AuthorityService.set_account_rights(self.email, {"can_submit": 1, "can_approve": 1})

        self.assertEqual(permissions.get_allowed_customers(self.email), [self.second])
        self.assertEqual(lines_of(self.first), [])
        self.assertEqual(lines_of(self.second), [self.email])

    def test_the_company_left_behind_can_be_saved_again_afterwards(self):
        """The point of all this: the abandoned matrix is usable by whoever remains."""
        from nexgen_msp.api.internal.services.team_service import TeamService

        resident = self.make_account(
            "customer", "MSP Customer Manager", customer=self.first, suffix="remains"
        )
        TeamService.resolve_access_references(email=self.email, customers=[self.second])

        AuthorityService.set_account_rights(resident, {"can_submit": 1, "can_approve": 1})

        self.assertEqual(lines_of(self.first), [resident])

    def test_a_line_kept_where_the_account_still_answers_is_not_touched(self):
        approval.withdraw_from_elsewhere(self.email, [self.first])

        self.assertEqual(lines_of(self.first), [self.email])

    def test_withdrawing_says_which_companies_it_left(self):
        permissions.add_customer_permission(self.email, self.second)
        AuthorityService.set_account_rights(self.email, {"can_submit": 1, "can_approve": 1})

        left = approval.withdraw_from_elsewhere(self.email, [self.second])

        self.assertEqual(left, [self.first])
        self.assertEqual(lines_of(self.first), [])

    def test_withdrawing_from_a_matrix_that_never_named_it_changes_nothing(self):
        self.assertFalse(approval.withdraw(self.email, self.second))


class TestWhatTheRefusalSaysWhenOneSurvives(MSPTestCase):
    def test_it_names_the_matrix_the_line_sits_in_and_what_to_do(self):
        first = self.make_customer("SAYS1")
        second = self.make_customer("SAYS2")
        stranger = self.make_account(
            "customer", "MSP Customer Manager", customer=first, suffix="stranger"
        )
        resident = self.make_account(
            "customer", "MSP Customer Manager", customer=second, suffix="resident"
        )

        # a line written straight to the table, as an older release left behind
        doc = frappe.get_doc(
            {
                "doctype": "MSP Approval Authority",
                "customer": second,
                "enabled": 1,
                "approvers": [{"user": resident, "can_submit": 1, "can_approve": 1}],
            }
        ).insert(ignore_permissions=True)
        self.track("MSP Approval Authority", doc.name)
        frappe.db.sql(
            "insert into `tabMSP Approver` (name, parent, parenttype, parentfield, user,"
            " can_submit, can_approve, idx, creation, modified, owner, modified_by)"
            " values (%s, %s, 'MSP Approval Authority', 'approvers', %s, 1, 1, 2, now(), now(),"
            " 'Administrator', 'Administrator')",
            ("zztest-stale-line", doc.name, stranger),
        )
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError) as refusal:
            AuthorityService.set_account_rights(resident, {"can_submit": 1, "can_approve": 0})

        said = str(refusal.exception)

        self.assertIn(second, said, "it says which matrix holds the line")
        self.assertIn(first, said, "it says which company the stranger answers for")
        self.assertIn("Remove that line from this matrix", said)
        self.assertNotIn("is not an account of", said)

    def test_an_account_that_answers_for_nothing_is_said_so(self):
        customer = self.make_customer("SAYS3")
        orphan = self.make_account(
            "customer", "MSP Customer Manager", customer=customer, suffix="orphan"
        )
        doc = frappe.get_doc(
            {
                "doctype": "MSP Approval Authority",
                "customer": customer,
                "enabled": 1,
                "approvers": [{"user": orphan, "can_submit": 1, "can_approve": 1}],
            }
        ).insert(ignore_permissions=True)
        self.track("MSP Approval Authority", doc.name)
        frappe.db.commit()

        # the link goes behind the matrix's back, the way a data repair would
        frappe.db.sql(
            "delete from `tabUser Permission` where user = %s and allow = 'Customer'", orphan
        )
        frappe.db.sql("delete from `tabDynamic Link` where link_name = %s", customer)
        frappe.db.commit()
        frappe.clear_cache(user=orphan)

        with self.assertRaises(frappe.ValidationError) as refusal:
            frappe.get_doc("MSP Approval Authority", doc.name).save(ignore_permissions=True)

        self.assertIn("no company", str(refusal.exception))
