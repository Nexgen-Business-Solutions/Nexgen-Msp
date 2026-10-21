"""What is left to bill, counted in days rather than in periods.

The engine used to read coverage off the period of a run: a run touching these months
holding a line for this assignment meant the assignment was covered for all of them. A
quarter with a fortnight billed inside it therefore read as fully covered, and the rest of
it was never charged to anybody.

These are the scenarios P01–P08 of the Billing V2 specification: a hole in the middle, a
line carried as an exception, pauses, and a service that stops. Each one is a case the old
reading got wrong.
"""

import frappe
from frappe.utils import getdate

from nexgen_msp.api.internal.services import coverage_resolver
from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.utils import intervals

from .test_billing_history import BillingHistoryCase


class DayCase(BillingHistoryCase):
    """A monthly contract in arrears, which is what most contracts here are."""

    def setUp(self):
        super().setUp()
        self.service = self.offering("DAY")
        frappe.db.set_value(
            "MSP Contract",
            self.contract,
            {
                "billing_frequency": "Monthly",
                "billing_timing": "In Arrears",
                "proration_method": "Daily Actual Days",
                "start_date": "2023-01-01",
            },
        )
        frappe.db.commit()

    def live_since(self, start, who=None):
        assignment = self.running(self.service, client_user=who or self.john, started=0)
        frappe.db.set_value(
            "MSP Service Assignment", assignment, "effective_start_date", start
        )
        frappe.db.commit()

        return assignment

    def charged(self, start, end):
        """A run really posted over that window."""
        run = self.drawn(start=start, end=end)
        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)

        return run

    def line_for(self, assignment, start, end):
        lines, _ = BillingService.build_lines(self.contract, start, end)

        return next(line for line in lines if line["service_assignment"] == assignment)


class TestAHoleInTheMiddle(DayCase):
    def test_a_fortnight_billed_inside_a_quarter_leaves_the_rest_billable(self):
        """P01. The reading the old engine could not do at all."""
        assignment = self.live_since("2023-01-01")
        self.charged("2026-08-01", "2026-08-15")

        line = self.line_for(assignment, "2026-08-01", "2026-08-31")

        self.assertIsNone(line["exception_code"], "the month is not covered, only half of it")
        self.assertEqual(line["billable_days"], 16, "the 16th to the 31st")
        self.assertEqual(getdate(line["covered_from"]), getdate("2026-08-16"))
        self.assertEqual(getdate(line["covered_to"]), getdate("2026-08-31"))

    def test_the_days_already_charged_are_not_charged_again(self):
        assignment = self.live_since("2023-01-01")
        self.charged("2026-08-01", "2026-08-15")

        line = self.line_for(assignment, "2026-08-01", "2026-08-31")
        billed = intervals.from_dicts(frappe.parse_json(line["billable_segments_json"]))

        self.assertEqual(
            intervals.intersect(billed, [(getdate("2026-08-01"), getdate("2026-08-15"))]),
            [],
        )

    def test_a_month_charged_in_full_is_covered(self):
        assignment = self.live_since("2023-01-01")
        self.charged("2026-08-01", "2026-08-31")

        line = self.line_for(assignment, "2026-08-01", "2026-08-31")

        self.assertEqual(line["exception_code"], "Already Covered")
        self.assertEqual(line["amount"], 0.0)

    def test_two_separate_fortnights_leave_the_middle(self):
        assignment = self.live_since("2023-01-01")
        self.charged("2026-08-01", "2026-08-10")
        self.charged("2026-08-21", "2026-08-31")

        line = self.line_for(assignment, "2026-08-01", "2026-08-31")

        self.assertIsNone(line["exception_code"])
        self.assertEqual(line["billable_days"], 10, "the 11th to the 20th")


class TestWhatDoesNotCountAsCharged(DayCase):
    def test_a_line_carried_as_an_exception_was_never_charged(self):
        """P02. A run holds the lines it could not price; holding is not charging."""
        assignment = self.live_since("2023-01-01")
        run = self.charged("2026-08-01", "2026-08-31")
        frappe.db.sql(
            "update `tabMSP Billing Run Line` set exception_code = 'Missing Rate'"
            " where parent = %s and service_assignment = %s",
            (run, assignment),
        )
        frappe.db.commit()

        covered = coverage_resolver.coverage_of(
            [{"name": assignment, "baseline_covered_to": None}]
        )

        self.assertEqual(covered[assignment]["charged"], [])

    def test_a_credit_note_is_not_a_charge(self):
        assignment = self.live_since("2023-01-01")
        run = self.charged("2026-08-01", "2026-08-31")
        note = BillingService.create_credit_note(
            name=run,
            reason="All of it back.",
            lines=[{"service_assignment": assignment, "from": "2026-08-01", "to": "2026-08-31"}],
            # the days were served: giving them back is a decision, not a detection
            only_unserved=False,
        )
        self.track("MSP Billing Run", note["name"])

        covered = coverage_resolver.coverage_of(
            [{"name": assignment, "baseline_covered_to": None}]
        )

        self.assertEqual(
            intervals.days(covered[assignment]["credited"]), 31, "the whole month is back"
        )


class TestTheCoverageSomebodyArrivedWith(DayCase):
    def test_a_frozen_baseline_covers_the_days_it_names(self):
        assignment = self.live_since("2023-01-01")
        frappe.db.set_value(
            "MSP Service Assignment",
            assignment,
            {
                "baseline_covered_from": "2023-01-01",
                "baseline_covered_to": "2026-08-20",
                "baseline_source": "Migrated Baseline",
                "baseline_state": "Confirmed",
            },
        )
        frappe.db.commit()

        line = self.line_for(assignment, "2026-08-01", "2026-08-31")

        self.assertIsNone(line["exception_code"])
        self.assertEqual(line["billable_days"], 11, "the 21st to the 31st")

    def test_a_baseline_that_ends_before_the_service_starts_covers_nothing(self):
        """Somebody who arrived after the historical invoice went out owes from day one."""
        assignment = self.live_since("2026-08-10")
        frappe.db.set_value(
            "MSP Service Assignment",
            assignment,
            {"baseline_covered_to": "2026-07-31", "baseline_state": "Confirmed"},
        )
        frappe.db.commit()

        line = self.line_for(assignment, "2026-08-01", "2026-08-31")

        self.assertIsNone(line["exception_code"])
        self.assertEqual(line["billable_days"], 22, "the 10th to the 31st")


class TestABaselineNobodyConfirmed(DayCase):
    """A date nobody checked against the original invoice settles nothing.

    Counting it as paid risks losing money that was never invoiced; ignoring it risks
    billing a period somebody else already charged for. The line says so instead and waits
    for the baseline to be confirmed.
    """

    def arrived_with(self, state):
        assignment = self.live_since("2023-01-01")
        frappe.db.set_value(
            "MSP Service Assignment",
            assignment,
            {
                "baseline_covered_from": "2023-01-01",
                "baseline_covered_to": "2026-08-20",
                "baseline_source": "Migrated Baseline",
                "baseline_state": state,
            },
        )
        frappe.db.commit()

        return assignment, self.line_for(assignment, "2026-08-01", "2026-08-31")

    def test_an_ambiguous_baseline_neither_pays_nor_bills(self):
        _assignment, line = self.arrived_with("Ambiguous")

        self.assertEqual(line["exception_code"], "Unverified Coverage")
        self.assertEqual(line["amount"], 0.0)

    def test_a_baseline_waiting_for_review_says_the_same(self):
        _assignment, line = self.arrived_with("Needs Review")

        self.assertEqual(line["exception_code"], "Unverified Coverage")

    def test_a_baseline_with_no_state_at_all_is_not_taken_as_paid(self):
        _assignment, line = self.arrived_with("")

        self.assertEqual(line["exception_code"], "Unverified Coverage")

    def test_confirming_it_puts_the_days_back_where_they_belong(self):
        assignment, line = self.arrived_with("Needs Review")

        self.assertEqual(line["exception_code"], "Unverified Coverage")

        frappe.db.set_value(
            "MSP Service Assignment", assignment, "baseline_state", "Confirmed"
        )
        frappe.db.commit()

        after = self.line_for(assignment, "2026-08-01", "2026-08-31")

        self.assertIsNone(after["exception_code"])
        self.assertEqual(after["billable_days"], 11, "the 21st to the 31st")

    def test_a_period_the_baseline_never_reached_is_billed_as_usual(self):
        assignment = self.live_since("2023-01-01")
        frappe.db.set_value(
            "MSP Service Assignment",
            assignment,
            {"baseline_covered_to": "2026-07-31", "baseline_state": "Ambiguous"},
        )
        frappe.db.commit()

        line = self.line_for(assignment, "2026-08-01", "2026-08-31")

        self.assertIsNone(line["exception_code"])
        self.assertEqual(line["billable_days"], 31)


class TestPausesStillCutTheirDays(DayCase):
    def test_a_pause_from_the_tenth_to_the_fifteenth(self):
        """P04. The resume day is billable again; the pause ends the day before."""
        assignment = self.live_since("2023-01-01")
        self.paused(assignment, "2026-08-10", "2026-08-16")

        line = self.line_for(assignment, "2026-08-01", "2026-08-31")

        self.assertEqual(line["billable_days"], 25, "31 days less the 10th to the 15th")

    def test_a_pause_and_a_charge_both_come_off(self):
        assignment = self.live_since("2023-01-01")
        self.paused(assignment, "2026-08-10", "2026-08-16")
        self.charged("2026-08-01", "2026-08-05")

        line = self.line_for(assignment, "2026-08-01", "2026-08-31")

        self.assertEqual(line["billable_days"], 20, "31 days less 6 paused less 5 charged")
