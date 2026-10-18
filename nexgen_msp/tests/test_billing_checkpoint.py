"""Billing picks up where the customer was really left, whatever its contract says.

Issue #15: a customer onboarded with billing history carries a mark on its record and no
run on file. Reading only the runs made it look brand new and would have charged it again
for a quarter already paid.

Three contract settings decide the answer, and all three are read here: how long a period
lasts, whether it is paid before or after it is served, and how a partial month is cut.
"""

import frappe
from frappe.utils import add_days, getdate

from nexgen_msp.api.internal.services.billing_service import BillingService

from .test_billing_history import BillingHistoryCase


class CheckpointCase(BillingHistoryCase):
    def contract_says(self, **values):
        for field, value in values.items():
            frappe.db.set_value("MSP Contract", self.contract, field, value)
        frappe.db.commit()

    def stamp(self, mark):
        frappe.db.set_value("Customer", self.customer, "msp_last_billed_on", mark)
        frappe.db.commit()

    def mine_in_due(self):
        rows = BillingService.due(horizon_days=3650)["rows"]

        return next(row for row in rows if row["customer"] == self.customer)


class TestWhereTheMarkComesFrom(CheckpointCase):
    def test_a_customer_with_no_run_is_read_from_its_own_record(self):
        self.offering("MARK1")
        self.stamp("2026-07-24")

        self.assertEqual(BillingService.checkpoint(self.customer), getdate("2026-07-24"))

    def test_a_customer_with_neither_has_no_mark_at_all(self):
        self.offering("MARK2")

        self.assertIsNone(BillingService.checkpoint(self.customer))

    def test_when_both_exist_the_later_one_wins(self):
        service = self.offering("MARK3")
        self.running(service, client_user=self.john)
        start, end = self.month()
        run = self.drawn(start=start, end=end)
        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)
        self.stamp(add_days(getdate(end), -400))

        self.assertEqual(BillingService.checkpoint(self.customer), getdate(end))

    def test_a_run_still_open_does_not_count_as_billed(self):
        service = self.offering("MARK4")
        self.running(service, client_user=self.john)
        start, end = self.month()
        self.drawn(start=start, end=end)
        self.stamp("2026-07-24")

        self.assertEqual(BillingService.checkpoint(self.customer), getdate("2026-07-24"))


class TestWhatThatMarkCovers(CheckpointCase):
    """In arrears the mark is the coverage; in advance it paid for the period it falls in."""

    def covered(self, frequency, timing, mark="2026-07-24"):
        self.offering(f"COV{frequency[:3]}{timing[3:6]}")
        self.contract_says(billing_frequency=frequency, billing_timing=timing)
        self.stamp(mark)

        return BillingService.covered_through(self.customer, frequency, timing)

    def test_billed_in_arrears_it_covers_only_up_to_the_mark(self):
        self.assertEqual(self.covered("Quarterly", "In Arrears"), getdate("2026-07-24"))

    def test_billed_quarterly_in_advance_it_covers_to_the_end_of_that_quarter(self):
        self.assertEqual(self.covered("Quarterly", "In Advance"), getdate("2026-09-30"))

    def test_billed_monthly_in_advance_it_covers_to_the_end_of_that_month(self):
        self.assertEqual(self.covered("Monthly", "In Advance"), getdate("2026-07-31"))

    def test_billed_annually_in_advance_it_covers_to_the_end_of_that_year(self):
        self.assertEqual(self.covered("Annually", "In Advance"), getdate("2026-12-31"))

    def test_a_customer_with_no_mark_is_covered_through_nothing(self):
        self.offering("COVNONE")

        self.assertIsNone(
            BillingService.covered_through(self.customer, "Quarterly", "In Advance")
        )


class TestTheQuarterEndsOnTheCalendar(CheckpointCase):
    def test_every_month_of_a_quarter_ends_it_on_the_same_day(self):
        for day in ("2026-07-01", "2026-07-24", "2026-08-15", "2026-09-30"):
            self.assertEqual(
                BillingService._period_end_of(day, "Quarterly"), getdate("2026-09-30"), day
            )

    def test_the_four_quarters_of_a_year(self):
        self.assertEqual(
            [
                BillingService._period_end_of(day, "Quarterly")
                for day in ("2026-02-10", "2026-05-10", "2026-08-10", "2026-11-10")
            ],
            [getdate(d) for d in ("2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31")],
        )

    def test_a_month_ends_on_its_own_last_day_however_long_it_is(self):
        self.assertEqual(BillingService._period_end_of("2026-02-10", "Monthly"), getdate("2026-02-28"))
        self.assertEqual(BillingService._period_end_of("2026-07-10", "Monthly"), getdate("2026-07-31"))


class TestWhatTheMarkForbids(CheckpointCase):
    """Exactly how far the mark reaches, because it reaches further than #15 asks.

    The issue says one thing: do not charge again for coverage already paid for. A mark is
    a watermark, so everything behind it counts as paid — including a stretch no run of
    ours ever billed. That is the intent for a customer onboarded with history, and it is
    a restriction on every other customer too. Written down here rather than discovered.
    """

    def line_for(self, start, end):
        lines, _ = BillingService.build_lines(self.contract, start, end)

        return lines[0]

    def test_a_period_behind_the_mark_yields_nothing_even_with_no_run_against_it(self):
        service = self.offering("PAST1")
        self.running(service, client_user=self.john, started=-1000)
        self.contract_says(billing_frequency="Quarterly", billing_timing="In Arrears")
        self.stamp("2026-07-24")

        line = self.line_for("2026-02-01", "2026-02-28")

        self.assertEqual(line["exception_code"], "Already Covered")
        self.assertEqual(line["amount"], 0.0)

    def test_a_period_straddling_the_mark_is_billed_from_the_day_after_it(self):
        service = self.offering("PAST2")
        self.running(service, client_user=self.john, started=-1000)
        self.contract_says(billing_frequency="Quarterly", billing_timing="In Arrears")
        self.stamp("2026-07-24")

        line = self.line_for("2026-07-01", "2026-07-31")

        self.assertIsNone(line["exception_code"])
        self.assertEqual(getdate(line["covered_from"]), getdate("2026-07-25"))
        self.assertEqual(getdate(line["covered_to"]), getdate("2026-07-31"))

    def test_a_customer_with_no_mark_at_all_can_still_be_billed_for_any_past_period(self):
        """Nothing new is forbidden where nothing says the period was paid for."""
        service = self.offering("PAST3")
        self.running(service, client_user=self.john, started=-1000)
        self.contract_says(billing_frequency="Quarterly", billing_timing="In Arrears")

        line = self.line_for("2026-02-01", "2026-02-28")

        self.assertIsNone(line["exception_code"])
        self.assertEqual(line["billable_months"], 1.0)

    def test_a_service_that_began_after_the_mark_is_never_held_back_by_it(self):
        service = self.offering("PAST4")
        assignment = self.running(service, client_user=self.john, started=0)
        frappe.db.set_value(
            "MSP Service Assignment", assignment, "effective_start_date", "2026-08-01"
        )
        frappe.db.commit()
        self.contract_says(billing_frequency="Quarterly", billing_timing="In Arrears")
        self.stamp("2026-07-24")

        line = self.line_for("2026-08-01", "2026-08-31")

        self.assertIsNone(line["exception_code"])
        self.assertEqual(line["billable_months"], 1.0)
