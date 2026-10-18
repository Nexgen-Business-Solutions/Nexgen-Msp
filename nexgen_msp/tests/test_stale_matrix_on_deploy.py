"""What deploying the fix does, and does not do, to a matrix already spoilt.

The rule that takes a line off the matrix fires when an account's company changes. A line
written before that rule existed never changes company again, so nothing fires for it: the
customer screen keeps naming somebody whose own account answers elsewhere, and that company's
matrix refuses every later save, for everybody.

These simulate the online site: a stale line planted the way an older release left one, the
deploy on its own, and then the patch that heals it.
"""

import frappe

from nexgen_msp.api.internal.services.authority_service import AuthorityService
from nexgen_msp.api.internal.services.team_service import TeamService
from nexgen_msp.patches import withdraw_stale_approvers
from nexgen_msp.utils import permissions

from .base import MSPTestCase


class StaleMatrixCase(MSPTestCase):
    """Two companies, an account of the second, and a line of it left on the first."""

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=4)
        self.theirs = self.make_customer(f"ONL{self.tag}A")
        self.mine = self.make_customer(f"ONL{self.tag}B")
        self.resident = self.make_account(
            "customer", "MSP Customer Manager", customer=self.theirs, suffix=f"res{self.tag}"
        )
        self.stranger = self.make_account(
            "customer", "MSP Customer Manager", customer=self.mine, suffix=f"str{self.tag}"
        )
        AuthorityService.set_account_rights(self.resident, {"can_submit": 1, "can_approve": 1})
        self.plant_stale_line()

    def plant_stale_line(self):
        """A line an older release left behind, written straight to the table.

        Not through the service: the service is exactly what refuses it today, and what has
        to be simulated is a row that is already there.
        """
        doc = frappe.db.get_value(
            "MSP Approval Authority", {"customer": self.theirs}, "name"
        )
        frappe.db.sql(
            "insert into `tabMSP Approver` (name, parent, parenttype, parentfield, user,"
            " full_name, can_submit, can_approve, idx, creation, modified, owner, modified_by)"
            " values (%s, %s, 'MSP Approval Authority', 'approvers', %s, %s, 1, 1, 9, now(),"
            " now(), 'Administrator', 'Administrator')",
            (f"zzstale-{self.tag}", doc, self.stranger, "A Stranger"),
        )
        frappe.db.commit()
        frappe.clear_cache(doctype="MSP Approval Authority")

    def named_on(self, customer):
        return [row["user"] for row in AuthorityService.get_authority(customer)["approvers"]]


class TestWhatTheOnlineSiteLooksLike(StaleMatrixCase):
    def test_the_customer_screen_names_somebody_from_another_company(self):
        """The symptom reported: Kakivu's screen naming an account of SUPPLY SOLUTIONS."""
        self.assertIn(self.stranger, self.named_on(self.theirs))

    def test_while_that_account_answers_for_the_other_one(self):
        """The contradiction: the account's own screen never mentions the first company."""
        account = TeamService.get_member(email=self.stranger)

        self.assertEqual(account["customers"], [self.mine])
        self.assertEqual(account["abilities"]["scope"], self.mine)
        self.assertEqual(permissions.get_allowed_customers(self.stranger), [self.mine])

    def test_and_nobody_can_change_that_company_rights_any_more(self):
        """Why it matters beyond display: the whole matrix is frozen, for everybody.

        The refusal comes from the document, so it is Frappe's own ValidationError and not
        one of ours — the services never get to see this one.
        """
        with self.assertRaises(frappe.ValidationError) as refusal:
            AuthorityService.set_account_rights(self.resident, {"can_submit": 1, "can_approve": 0})

        said = str(refusal.exception)

        self.assertIn("Remove that line from this matrix", said)
        self.assertIn(self.theirs, said, "it names the matrix holding the line")
        self.assertIn(self.mine, said, "and the company the stranger really answers for")


class TestWhatDeployingAloneChanges(StaleMatrixCase):
    def test_reading_the_screens_heals_nothing(self):
        """The fix fires on a change of company; reading never changes one."""
        AuthorityService.get_authority(self.theirs)
        TeamService.get_member(email=self.stranger)

        self.assertIn(self.stranger, self.named_on(self.theirs))

    def test_but_settling_that_account_access_does_heal_it(self):
        """The one manual way out: the fix withdraws from every matrix but the one kept.

        It fires on settling the account's references, even when those references already
        agreed — so an administrator can clear a spoilt matrix account by account. What
        nobody can do is clear them all without visiting each one.
        """
        TeamService.resolve_access_references(email=self.stranger, customers=[self.mine])

        self.assertEqual(permissions.get_allowed_customers(self.stranger), [self.mine])
        self.assertNotIn(self.stranger, self.named_on(self.theirs))

    def test_nothing_heals_it_on_its_own_at_deploy_time(self):
        """Which is why the patch exists: a deploy visits no account."""
        before = self.named_on(self.theirs)

        AuthorityService.get_authority(self.theirs)
        TeamService.get_member(email=self.stranger)
        TeamService.list_members()

        self.assertEqual(self.named_on(self.theirs), before)
        self.assertIn(self.stranger, before)


class TestWhatThePatchChanges(StaleMatrixCase):
    def test_it_takes_the_stranger_off_and_leaves_the_resident_alone(self):
        withdraw_stale_approvers.execute()

        named = self.named_on(self.theirs)

        self.assertNotIn(self.stranger, named)
        self.assertIn(self.resident, named)

    def test_the_company_can_be_administered_again(self):
        withdraw_stale_approvers.execute()

        AuthorityService.set_account_rights(self.resident, {"can_submit": 1, "can_approve": 0})

        rights = AuthorityService.get_account_rights(self.resident)
        self.assertTrue(rights["can_submit"])
        self.assertFalse(rights["can_approve"])

    def test_the_two_screens_agree_afterwards(self):
        withdraw_stale_approvers.execute()

        for customer in (self.mine, self.theirs):
            for user in self.named_on(customer):
                self.assertIn(
                    customer,
                    permissions.get_allowed_customers(user),
                    f"{user} is still named at {customer}",
                )

    def test_running_it_twice_changes_nothing_the_second_time(self):
        withdraw_stale_approvers.execute()
        before = self.named_on(self.theirs)

        withdraw_stale_approvers.execute()

        self.assertEqual(self.named_on(self.theirs), before)

    def test_an_account_that_lost_its_customer_role_goes_too(self):
        """A line can be stale for the other reason: the account stopped being a customer one."""
        permissions.remove_roles(
            frappe.get_doc("User", self.resident), list(permissions.CUSTOMER_ROLES)
        )
        frappe.db.commit()
        frappe.clear_cache(user=self.resident)

        withdraw_stale_approvers.execute()

        self.assertEqual(self.named_on(self.theirs), [])


class TestItCannotHappenAgain(StaleMatrixCase):
    """The durable half of the fix: the line goes whatever took the company away.

    Removing it when a service drops a rattachement covers the services. A permission can
    also go from the Frappe desk, from a script, or from an import — and those paths know
    nothing about the matrix. The deletion itself is hooked, so they are all covered.
    """

    def named_at_mine(self):
        return self.named_on(self.mine)

    def test_a_permission_deleted_straight_from_the_desk_takes_the_line_with_it(self):
        AuthorityService.set_account_rights(self.stranger, {"can_submit": 1, "can_approve": 1})
        self.assertIn(self.stranger, self.named_at_mine())

        for name in frappe.get_all(
            "User Permission",
            filters={"user": self.stranger, "allow": "Customer", "for_value": self.mine},
            pluck="name",
        ):
            frappe.delete_doc("User Permission", name, ignore_permissions=True)

        frappe.db.commit()

        self.assertNotIn(self.stranger, self.named_at_mine())

    def test_a_permission_for_something_else_leaves_the_matrix_alone(self):
        AuthorityService.set_account_rights(self.stranger, {"can_submit": 1, "can_approve": 1})

        other = frappe.get_doc(
            {
                "doctype": "User Permission",
                "user": self.stranger,
                "allow": "MSP Department",
                "for_value": self.make_department("Sales"),
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        frappe.delete_doc("User Permission", other.name, ignore_permissions=True)
        frappe.db.commit()

        self.assertIn(self.stranger, self.named_at_mine())

    def test_the_company_it_still_answers_for_keeps_its_line(self):
        """Only what it left is withdrawn, never what it kept.

        The resident was named in setUp, before the stale line was planted. Naming them
        again here would be refused by that very line, which is the blockage under test
        elsewhere — so the matrix is read as it stands rather than rewritten.
        """
        self.assertIn(self.resident, self.named_on(self.theirs))

        for name in frappe.get_all(
            "User Permission",
            filters={"user": self.stranger, "allow": "Customer"},
            pluck="name",
        ):
            frappe.delete_doc("User Permission", name, ignore_permissions=True)

        frappe.db.commit()

        self.assertIn(self.resident, self.named_on(self.theirs))
