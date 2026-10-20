"""What the Ready to bill table reads from each proposed action.

A line on that table says which contract it belongs to and on what terms, and whether
somebody has already started the run it proposes. A run already open is continued, never
drawn a second time.
"""

import frappe
from frappe.utils import flt, getdate

from nexgen_msp.api.internal.services.billing_service import BillingService

from .test_billing_history import BillingHistoryCase


class ReadyToBillCase(BillingHistoryCase):
    def setUp(self):
        super().setUp()
        self.service = self.offering("RTB")
        self.assignment = self.running(self.service, client_user=self.john)
        frappe.db.set_value("Customer", self.customer, "msp_last_billed_on", self.days_ago(400))
        frappe.db.commit()

    def mine(self):
        return [
            action
            for action in BillingService.due(horizon_days=3650)["actions"]
            if action["customer"] == self.customer
        ]

    def period_action(self):
        return next(action for action in self.mine() if action["kind"] == "period")


class TestEachActionSaysWhoseTermsItFollows(ReadyToBillCase):
    def test_it_carries_the_contract_frequency_and_timing(self):
        action = self.period_action()

        self.assertEqual(action["frequency"], "Monthly")
        self.assertEqual(action["timing"], "In Arrears")

    def test_it_follows_a_change_of_terms(self):
        frappe.db.set_value(
            "MSP Contract",
            self.contract,
            {"billing_frequency": "Quarterly", "billing_timing": "In Advance"},
        )
        frappe.db.commit()

        action = self.period_action()

        self.assertEqual(action["frequency"], "Quarterly")
        self.assertEqual(action["timing"], "In Advance")


class TestARunAlreadyStartedIsSaidSo(ReadyToBillCase):
    def test_nothing_started_leaves_it_empty(self):
        self.assertIsNone(self.period_action()["open_run"])

    def test_a_draft_on_the_same_window_is_the_run_to_continue(self):
        action = self.period_action()
        run = self.drawn(start=action["period_start"], end=action["period_end"])

        self.assertEqual(self.period_action()["open_run"], run)

    def test_a_draft_on_an_earlier_window_is_the_one_to_finish(self):
        """A run left unfinished is the next thing to do, not the window after it."""
        action = self.period_action()
        start = getdate(action["period_start"])
        other_end = frappe.utils.add_days(start, -1)
        other_start = frappe.utils.add_months(other_end, -1)
        run = self.drawn(start=str(other_start), end=str(other_end))

        proposed = self.period_action()

        self.assertEqual(proposed["open_run"], run)
        self.assertEqual(getdate(proposed["period_start"]), getdate(other_start))
        self.assertEqual(getdate(proposed["period_end"]), getdate(other_end))

    def test_the_line_says_what_that_run_already_holds(self):
        action = self.period_action()
        run = self.drawn(start=action["period_start"], end=action["period_end"])
        doc = frappe.get_doc("MSP Billing Run", run)

        proposed = self.period_action()

        self.assertEqual(proposed["lines"], len(doc.lines))
        self.assertEqual(proposed["amount"], flt(doc.total_amount, 2))

    def test_a_run_already_invoiced_is_not_one_to_continue(self):
        action = self.period_action()
        run = self.drawn(start=action["period_start"], end=action["period_end"])
        frappe.db.set_value("MSP Billing Run", run, "status", "Invoiced")
        frappe.db.commit()

        later = [
            entry
            for entry in self.mine()
            if entry["kind"] == "period" and entry["period_start"] != getdate(action["period_start"])
        ]

        for entry in later:
            self.assertIsNone(entry["open_run"])

    def test_a_cancelled_run_is_not_one_to_continue(self):
        action = self.period_action()
        run = self.drawn(start=action["period_start"], end=action["period_end"])
        frappe.db.set_value("MSP Billing Run", run, "status", "Cancelled")
        frappe.db.commit()

        self.assertIsNone(self.period_action()["open_run"])


class TestTheCountIsWhatIsOwed(ReadyToBillCase):
    """A proposal counts the services that still owe days, not the ones that are live.

    Counting what runs over a window says nothing about whether it was already paid for.
    A line held by a run being prepared, or already invoiced, is covered, and counting it
    sends somebody to a screen that has nothing for them to do.
    """

    def setUp(self):
        super().setUp()
        self.mary = self.make_person(self.customer, "Mary", department="Accounting")
        self.second = self.running(self.service, client_user=self.mary)
        frappe.db.commit()

    def owed(self, start, end):
        return BillingService._billable_over(self.contract, self.customer, start, end)

    def test_both_services_owe_the_window_before_anything_is_drawn(self):
        start, end = self.month()

        self.assertEqual(self.owed(start, end), 2)

    def test_a_line_held_by_a_run_being_prepared_is_not_owed_again(self):
        start, end = self.month()
        self.drawn(start=start, end=end, include=[self.assignment])

        self.assertEqual(self.owed(start, end), 1)

    def test_a_line_already_invoiced_is_not_owed_again(self):
        start, end = self.month()
        run = self.drawn(start=start, end=end, include=[self.assignment])
        frappe.db.set_value("MSP Billing Run", run, "status", "Invoiced")
        frappe.db.commit()

        self.assertEqual(self.owed(start, end), 1)

    def test_a_window_entirely_covered_owes_nothing(self):
        start, end = self.month()
        self.drawn(start=start, end=end)

        self.assertEqual(self.owed(start, end), 0)
