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


class TestWhatAChargedPeriodLeftBehindIsShownWhateverComesNext(ReadyToBillCase):
    """A period already charged can owe something while the next one is still far off.

    Ready to bill read the adjustments only for the contracts whose next period was near
    enough, so a quantity that dropped inside a period paid in advance waited for the
    following cycle to come into view before anybody was told to give the days back.
    """

    def setUp(self):
        super().setUp()
        frappe.db.set_value(
            "MSP Contract",
            self.contract,
            {"billing_frequency": "Quarterly", "billing_timing": "In Advance"},
        )
        charged = self.drawn(
            start=self.today,
            end=frappe.utils.add_days(self.today, 90),
            include=[self.assignment],
        )
        frappe.db.set_value("MSP Billing Run", charged, "status", "Invoiced")
        self.newcomer = self.make_person(self.customer, "Newcomer")
        self.running(self.service, started=0, client_user=self.newcomer)
        frappe.db.commit()

    def row(self, horizon):
        return next(
            row
            for row in BillingService.due(horizon_days=horizon)["rows"]
            if row["customer"] == self.customer
        )

    def test_the_catch_up_is_read_whether_the_next_period_is_near_or_months_away(self):
        near, far = self.row(3650), self.row(1)

        self.assertEqual(far["state"], "Scheduled")
        self.assertGreater(near["catch_up"]["lines"], 0)
        self.assertEqual(far["catch_up"], near["catch_up"])

    def test_it_is_a_thing_to_do_although_nothing_is_due_yet(self):
        answer = BillingService.due(horizon_days=1)
        mine = [
            action for action in answer["actions"] if action["customer"] == self.customer
        ]

        self.assertTrue([action for action in mine if action["kind"] == "additions"])
        self.assertGreater(answer["action_needed"], 0)


class TestAQuantityDroppedInsideAPaidPeriodIsOwedBack(ReadyToBillCase):
    """#33: a quantity reduced inside a quarter paid in advance owes the days nobody held.

    The credit and the charge for the smaller quantity are two separate things to do, and
    both have to be proposed while the period they belong to is the one already paid for —
    not when the following quarter finally comes into view.
    """

    def setUp(self):
        super().setUp()
        frappe.db.set_value(
            "MSP Contract",
            self.contract,
            {"billing_frequency": "Quarterly", "billing_timing": "In Advance"},
        )
        self.company_service = self.offering("RTBQ", scope="Customer")
        self.held = self.running(
            self.company_service, scope="Customer", started=0, quantity=10
        )
        charged = self.drawn(
            start=self.today,
            end=frappe.utils.add_days(self.today, 90),
            include=[self.assignment, self.held],
        )
        BillingService.finalise(charged)
        BillingService.submit_invoice(name=charged, notify=0)
        frappe.db.commit()

    def reduce_to(self, quantity, on_day):
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        ServiceLifecycleService.change(
            assignment=self.held,
            quantity=quantity,
            effective_date=frappe.utils.add_days(self.today, on_day),
        )
        frappe.db.commit()

    def answer(self):
        out = BillingService.due(horizon_days=1)

        return (
            next(row for row in out["rows"] if row["customer"] == self.customer),
            [action for action in out["actions"] if action["customer"] == self.customer],
        )

    def test_the_days_paid_for_at_the_old_quantity_are_proposed_as_a_credit(self):
        self.reduce_to(8, on_day=30)

        row, actions = self.answer()
        credits = [action for action in actions if action["kind"] == "credit_note"]

        self.assertEqual(row["state"], "Scheduled", "the next quarter is still far off")
        self.assertGreater(row["owed_back"]["lines"], 0)
        self.assertTrue(credits, "a credit note is proposed for the days nobody will hold")
        self.assertLess(credits[0]["amount"], 0)

    def test_the_days_already_paid_for_are_not_charged_a_second_time(self):
        """Only the difference comes back: the quarter's money already covers those days."""
        self.reduce_to(8, on_day=30)

        _row, actions = self.answer()

        self.assertEqual(
            [action["kind"] for action in actions if action["kind"] == "additions"], []
        )

    def test_nothing_is_owed_back_while_the_quantity_stands(self):
        row, actions = self.answer()

        self.assertEqual(row["owed_back"]["lines"], 0)
        self.assertEqual(
            [action["kind"] for action in actions if action["kind"] == "credit_note"], []
        )
