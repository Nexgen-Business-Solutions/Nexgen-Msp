"""Naming somebody to decide, putting them aside, and taking them off — issue #18.

Until now a line of the matrix could only be written or deleted, so there was no way to
stand somebody down for a month, to hand over on an agreed day, or to keep any trace of who
decided last year. The line now carries its own state and its own dates, independently of
the account behind it, which never changes when the relationship does.

What matters is that a line that does not decide today decides nothing anywhere: the portal,
the warnings and the request flow all read the same few lines, and a line merely listed on a
screen must never be one of them.
"""

import frappe

from nexgen_msp.api.internal.services.authority_service import AuthorityService
from nexgen_msp.utils import approval, permissions

from .base import MSPTestCase


class MatrixCase(MSPTestCase):
    """One company and two accounts of it, one of them deciding."""

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=4)
        self.customer = self.make_customer(f"DM{self.tag}")
        self.boss = self.make_account(
            "customer", "MSP Customer Manager", customer=self.customer, suffix=f"boss{self.tag}"
        )
        self.clerk = self.make_account(
            "customer", "MSP Customer Operator", customer=self.customer, suffix=f"clerk{self.tag}"
        )
        AuthorityService.set_account_rights(self.boss, {"can_submit": 1, "can_approve": 1})

    def line_of(self, user, **fields):
        """Write the whole matrix with this one account's line changed."""
        rows = AuthorityService.get_authority(self.customer)["approvers"]

        for row in rows:
            if row["user"] == user:
                row.update(fields)

        return AuthorityService.save_authority(customer=self.customer, enabled=1, approvers=rows)

    def named(self):
        return {
            row["user"]: row for row in AuthorityService.get_authority(self.customer)["approvers"]
        }


class TestALinePutAside(MatrixCase):
    def test_it_decides_nothing_while_it_is_inactive(self):
        self.line_of(self.boss, status="Inactive")

        self.assertEqual(approval.rights_of(self.customer, self.boss), {})
        self.assertFalse(approval.has_approvers(self.customer))
        self.assertIsNone(approval.company_wide_approver(self.customer))
        self.assertTrue(approval.gaps(self.customer)["nobody_may_approve"])
        self.assertTrue(approval.gaps(self.customer)["nobody_may_raise"])

    def test_it_is_still_listed_with_its_rights_and_its_state(self):
        """Put aside is not gone: the screen must be able to show what was decided before."""
        self.line_of(self.boss, status="Inactive")

        row = self.named()[self.boss]

        self.assertEqual(row["status"], "Inactive")
        self.assertFalse(row["deciding"])
        self.assertTrue(row["can_approve"])

    def test_putting_it_back_restores_what_it_held(self):
        self.line_of(self.boss, status="Inactive")
        self.line_of(self.boss, status="Active")

        self.assertTrue(approval.may("can_approve", self.customer, self.boss))
        self.assertTrue(self.named()[self.boss]["deciding"])

    def test_the_account_behind_it_is_untouched(self):
        self.line_of(self.boss, status="Inactive")

        self.assertTrue(frappe.db.get_value("User", self.boss, "enabled"))
        self.assertIn(self.customer, permissions.get_allowed_customers(self.boss))


class TestADatedLine(MatrixCase):
    def test_a_line_that_starts_later_decides_nothing_yet(self):
        self.line_of(self.boss, effective_from=frappe.utils.add_days(frappe.utils.nowdate(), 3))

        self.assertEqual(approval.rights_of(self.customer, self.boss), {})
        self.assertFalse(self.named()[self.boss]["deciding"])

    def test_it_decides_on_its_first_day(self):
        starts = frappe.utils.add_days(frappe.utils.nowdate(), 3)
        self.line_of(self.boss, effective_from=starts)

        doc = approval.authority_for(self.customer)
        row = next(line for line in doc.approvers if line.user == self.boss)

        self.assertTrue(approval.is_live(row, on=starts))

    def test_a_line_that_ended_yesterday_decides_nothing_today(self):
        self.line_of(self.boss, effective_to=frappe.utils.add_days(frappe.utils.nowdate(), -1))

        self.assertEqual(approval.rights_of(self.customer, self.boss), {})
        self.assertFalse(approval.has_approvers(self.customer))

    def test_it_decided_on_its_last_day(self):
        ended = frappe.utils.add_days(frappe.utils.nowdate(), -1)
        self.line_of(self.boss, effective_to=ended)

        doc = approval.authority_for(self.customer)
        row = next(line for line in doc.approvers if line.user == self.boss)

        self.assertTrue(approval.is_live(row, on=ended))

    def test_a_line_ending_before_it_starts_is_refused(self):
        with self.assertRaisesRegex(frappe.ValidationError, "before they start"):
            self.line_of(
                self.boss,
                effective_from=frappe.utils.nowdate(),
                effective_to=frappe.utils.add_days(frappe.utils.nowdate(), -5),
            )


class TestTakingALineOff(MatrixCase):
    def test_removing_it_leaves_the_person_and_their_account_alone(self):
        AuthorityService.save_authority(customer=self.customer, enabled=1, approvers=[])

        self.assertEqual(self.named(), {})
        self.assertTrue(frappe.db.exists("User", self.boss))
        self.assertTrue(frappe.db.get_value("User", self.boss, "enabled"))
        self.assertIn(self.customer, permissions.get_allowed_customers(self.boss))

    def test_the_same_account_cannot_hold_two_lines(self):
        rows = AuthorityService.get_authority(self.customer)["approvers"]

        with self.assertRaisesRegex(frappe.ValidationError, "appears twice"):
            AuthorityService.save_authority(
                customer=self.customer, enabled=1, approvers=rows + rows
            )

    def test_an_account_of_another_company_cannot_be_named_here(self):
        theirs = self.make_customer(f"DM{self.tag}X")
        stranger = self.make_account(
            "customer", "MSP Customer Manager", customer=theirs, suffix=f"str{self.tag}"
        )

        with self.assertRaisesRegex(frappe.ValidationError, "answers for"):
            AuthorityService.save_authority(
                customer=self.customer,
                enabled=1,
                approvers=[{"user": stranger, "can_submit": 1, "can_approve": 1}],
            )


class TestWhoMayTouchTheMatrix(MatrixCase):
    """The gate, stated as a refusal rather than assumed from the code path."""

    def as_them(self, email):
        self.addCleanup(frappe.set_user, "Administrator")
        frappe.set_user(email)

    def test_a_customer_account_cannot_read_the_matrix(self):
        self.as_them(self.boss)

        with self.assertRaises(Exception):
            AuthorityService.get_authority(self.customer)

    def test_a_customer_account_cannot_write_the_matrix(self):
        self.as_them(self.boss)

        with self.assertRaises(Exception):
            AuthorityService.save_authority(customer=self.customer, enabled=1, approvers=[])

    def test_a_technician_cannot_write_the_matrix(self):
        technician = self.make_account("internal", "MSP Technician", suffix=f"tech{self.tag}")
        self.as_them(technician)

        with self.assertRaises(Exception):
            AuthorityService.save_authority(customer=self.customer, enabled=1, approvers=[])


class TestTwoPeopleWritingAtOnce(MatrixCase):
    def test_the_second_save_of_a_stale_copy_is_refused(self):
        """Two administrators naming somebody at the same moment.

        Both read the matrix, both add their own line, and both save. Without the check
        the later save would write its own list over the other's, silently dropping a
        decision-maker somebody had just named.
        """
        first = AuthorityService._authority_for(self.customer)
        second = AuthorityService._authority_for(self.customer)

        first.append("approvers", {"user": self.clerk, "can_submit": 1, "can_approve": 0})
        first.save(ignore_permissions=True)
        frappe.db.commit()

        second.append("approvers", {"user": self.clerk, "can_submit": 1, "can_approve": 1})

        with self.assertRaises(frappe.TimestampMismatchError):
            second.save(ignore_permissions=True)

        frappe.db.rollback()
        self.assertEqual(sorted(self.named()), sorted([self.boss, self.clerk]))


class TestTheAccountPageAgrees(MatrixCase):
    """The customer screen and the account's own page read the same line."""

    def test_it_shows_the_same_standing_and_dates(self):
        ends = frappe.utils.add_days(frappe.utils.nowdate(), 30)
        self.line_of(self.boss, effective_to=ends)

        seen = AuthorityService.get_account_rights(self.boss)

        self.assertTrue(seen["named"])
        self.assertTrue(seen["deciding"])
        self.assertEqual(str(seen["effective_to"]), ends)
        self.assertEqual(seen["customer"], self.customer)

    def test_a_line_stood_down_reads_as_deciding_nothing_there_too(self):
        self.line_of(self.boss, status="Inactive")

        seen = AuthorityService.get_account_rights(self.boss)

        self.assertTrue(seen["named"])
        self.assertFalse(seen["deciding"])
        self.assertEqual(seen["status"], "Inactive")
        # the rights are still written down; they simply decide nothing while it is aside
        self.assertTrue(seen["can_approve"])


class TestNamingSomebodyAlreadyThere(MatrixCase):
    """A decision-maker is one of the customer's own portal accounts, chosen and given rights."""

    def test_only_the_company_s_own_accounts_can_be_offered(self):
        theirs = self.make_customer(f"DM{self.tag}Y")
        stranger = self.make_account(
            "customer", "MSP Customer Manager", customer=theirs, suffix=f"off{self.tag}"
        )

        offered = [
            row["user"] for row in AuthorityService.get_authority(self.customer)["candidates"]
        ]

        self.assertIn(self.clerk, offered)
        self.assertNotIn(stranger, offered)

    def test_a_disabled_account_is_not_offered(self):
        frappe.db.set_value("User", self.clerk, "enabled", 0)
        frappe.db.commit()

        offered = [
            row["user"] for row in AuthorityService.get_authority(self.customer)["candidates"]
        ]

        self.assertNotIn(self.clerk, offered)

    def test_naming_one_grants_them_no_further_access(self):
        """The line gives the right to decide, never a second permission.

        What an account may reach is settled when it is opened; the matrix only says what
        it decides, and must not quietly widen it.
        """
        before = frappe.db.count("User Permission", {"user": self.clerk, "allow": "Customer"})

        AuthorityService.save_authority(
            customer=self.customer,
            enabled=1,
            approvers=[
                {"user": self.boss, "can_submit": 1, "can_approve": 1},
                {"user": self.clerk, "can_submit": 1, "can_approve": 0},
            ],
        )

        self.assertEqual(
            frappe.db.count("User Permission", {"user": self.clerk, "allow": "Customer"}), before
        )
        self.assertEqual(permissions.get_allowed_customers(self.clerk), [self.customer])
        self.assertTrue(approval.may("can_submit", self.customer, self.clerk))
        self.assertFalse(approval.may("can_approve", self.customer, self.clerk))
