"""The Kakivu Mousse USD scenario of issue #15, run end to end.

Quarterly, in advance, on the thirty-day convention. The customer was billed on 24 July 2026
by whatever served it before this application, and carries that date and nothing else: no
run was ever drawn here. Billed in advance, that payment covered the quarter it fell in, so
everything live at the time is paid for through 30 September.

What is left to charge is the catch-up — what started after 24 July, prorated to 30 September
— and then the quarter ahead, 1 October to 31 December.
"""

import frappe
from frappe.utils import getdate

from nexgen_msp.api.internal.services.billing_service import BillingService

from .test_billing_history import BillingHistoryCase

MARK = "2026-07-24"
QUARTER_END = "2026-09-30"
NEXT_START = "2026-10-01"
NEXT_END = "2026-12-31"


class KakivuCase(BillingHistoryCase):
    """A contract on Kakivu's terms, with its history already behind it."""

    def setUp(self):
        super().setUp()
        self.service = self.offering("KAKI")
        frappe.db.set_value(
            "MSP Contract",
            self.contract,
            {
                "billing_frequency": "Quarterly",
                "billing_timing": "In Advance",
                "proration_method": "30-Day Convention",
                "start_date": "2023-01-01",
            },
        )
        frappe.db.set_value("Customer", self.customer, "msp_last_billed_on", MARK)
        frappe.db.commit()

    def since(self, start, end=None, who=None):
        """A service running from this date, the way the import left them."""
        assignment = self.running(self.service, client_user=who or self.john, started=0)
        frappe.db.set_value(
            "MSP Service Assignment",
            assignment,
            {"effective_start_date": start, "effective_end_date": end},
        )
        frappe.db.commit()

        return assignment

    def catch_up(self):
        lines, _ = BillingService.build_lines(self.contract, "2026-07-25", QUARTER_END)

        return {line["service_assignment"]: line for line in lines}

    def quarter_ahead(self):
        lines, _ = BillingService.build_lines(self.contract, NEXT_START, NEXT_END)

        return {line["service_assignment"]: line for line in lines}


class TestTheCatchUpQuarter(KakivuCase):
    def test_a_service_running_since_before_the_mark_is_not_charged_again(self):
        old = self.since("2023-03-06")

        line = self.catch_up()[old]

        self.assertEqual(line["billable_months"], 0.0)
        self.assertEqual(line["amount"], 0.0)
        self.assertEqual(line["exception_code"], "Already Covered")
        self.assertIn(QUARTER_END, line["exception_detail"])

    def test_a_service_started_the_day_after_the_mark_is_prorated_to_the_quarter_end(self):
        new = self.since("2026-07-25")

        line = self.catch_up()[new]

        self.assertIsNone(line["exception_code"])
        self.assertEqual(getdate(line["covered_from"]), getdate("2026-07-25"))
        self.assertEqual(getdate(line["covered_to"]), getdate(QUARTER_END))
        self.assertGreater(line["billable_months"], 2.0)

    def test_a_service_started_in_september_is_charged_only_for_september(self):
        new = self.since("2026-09-04")

        line = self.catch_up()[new]

        self.assertEqual(getdate(line["covered_from"]), getdate("2026-09-04"))
        self.assertEqual(getdate(line["covered_to"]), getdate(QUARTER_END))
        # 27 days of a thirty-day month, in blocks of five, rounded up
        self.assertEqual(line["billable_months"], 1.0)

    def test_a_service_started_after_the_mark_and_ended_stops_at_its_end_date(self):
        short = self.since("2026-08-01", end="2026-08-15")

        line = self.catch_up()[short]

        self.assertEqual(getdate(line["covered_to"]), getdate("2026-08-15"))
        self.assertEqual(line["billable_months"], 0.5)

    def test_new_employees_mid_period_are_charged_and_the_old_ones_are_not(self):
        """The quantity question of #15, in the shape this product actually takes.

        Three people were served and paid for when the quarter was billed; two more arrive
        on 15 August. There is no quantity to raise here — a person is an assignment — so
        what has to be true is that only the two new ones are charged, each from the day
        they arrived through the end of the quarter, and the three already covered are
        charged nothing a second time.
        """
        served = [self.since("2026-05-01", who=self.make_person(self.customer, f"Old{n}")) for n in range(3)]
        arrived = [
            self.since("2026-08-15", who=self.make_person(self.customer, f"New{n}")) for n in range(2)
        ]

        lines = self.catch_up()

        for assignment in served:
            self.assertEqual(lines[assignment]["exception_code"], "Already Covered")
            self.assertEqual(lines[assignment]["amount"], 0.0)

        for assignment in arrived:
            line = lines[assignment]
            self.assertIsNone(line["exception_code"])
            self.assertEqual(getdate(line["covered_from"]), getdate("2026-08-15"))
            self.assertEqual(getdate(line["covered_to"]), getdate(QUARTER_END))
            # 17 days of August billed as 20 in blocks of five, then the whole of September
            self.assertEqual(line["billable_months"], 1.667)
            self.assertGreater(line["amount"], 0.0)

        billed = sum(line["amount"] for line in lines.values())
        self.assertEqual(billed, sum(lines[assignment]["amount"] for assignment in arrived))

    def test_the_mark_itself_is_the_last_day_already_paid_for(self):
        """A service that started on the mark was part of that billing, not after it."""
        on_the_day = self.since(MARK)

        self.assertEqual(self.catch_up()[on_the_day]["exception_code"], "Already Covered")


class TestTheQuarterAhead(KakivuCase):
    def test_a_continuing_service_is_billed_in_full_for_october_to_december(self):
        old = self.since("2023-03-06")

        line = self.quarter_ahead()[old]

        self.assertIsNone(line["exception_code"])
        self.assertEqual(line["billable_months"], 3.0)
        self.assertEqual(getdate(line["covered_from"]), getdate(NEXT_START))
        self.assertEqual(getdate(line["covered_to"]), getdate(NEXT_END))

    def test_a_service_added_during_the_catch_up_is_billed_in_full_too(self):
        added = self.since("2026-09-04")

        self.assertEqual(self.quarter_ahead()[added]["billable_months"], 3.0)

    def test_a_service_already_ended_is_not_billed_for_the_quarter_ahead(self):
        gone = self.since("2026-08-01", end="2026-08-15")

        self.assertNotIn(gone, self.quarter_ahead())


class TestWhatBillingProposesOnItsOwn(KakivuCase):
    def proposal(self):
        rows = BillingService.due(horizon_days=3650)["rows"]

        return next(row for row in rows if row["customer"] == self.customer)

    def test_it_proposes_the_catch_up_first(self):
        self.since("2023-03-06")

        row = self.proposal()

        self.assertEqual(getdate(row["covered_upto"]), getdate(MARK))
        self.assertEqual(getdate(row["next_period_start"]), getdate("2026-07-25"))
        self.assertEqual(getdate(row["next_period_end"]), getdate(QUARTER_END))

    def test_it_does_not_treat_the_customer_as_never_billed(self):
        self.since("2023-03-06")

        self.assertNotEqual(self.proposal()["state"], "Never billed")

    def test_once_the_catch_up_is_posted_it_proposes_the_calendar_quarter(self):
        """A real catch-up carries both: what was already paid for, and what came after."""
        self.since("2023-03-06")
        self.since("2026-08-01", who=self.make_person(self.customer, "Bob"))
        run = self.drawn(start="2026-07-25", end=QUARTER_END)
        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)

        row = self.proposal()

        self.assertEqual(getdate(row["next_period_start"]), getdate(NEXT_START))
        self.assertEqual(getdate(row["next_period_end"]), getdate(NEXT_END))

    def tearDown(self):
        for doctype in ("Sales Invoice", "Sales Order"):
            for name in frappe.get_all(
                doctype, filters={"customer": self.customer}, pluck="name"
            ):
                try:
                    for run in frappe.get_all(
                        "MSP Billing Run", filters={"sales_invoice": name}, pluck="name"
                    ):
                        frappe.db.set_value("MSP Billing Run", run, "sales_invoice", None)
                    frappe.db.commit()
                    doc = frappe.get_doc(doctype, name)
                    doc.flags.ignore_links = True
                    if doc.docstatus == 1:
                        doc.cancel()
                        frappe.db.commit()
                    frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
                    frappe.db.commit()
                except Exception:
                    frappe.db.rollback()
                    print(f"  could not remove {doctype} {name}")

        super().tearDown()


class TestAnArrearsContractIsLeftAlone(KakivuCase):
    """The two contracts already running are in arrears: nothing above may touch them."""

    def test_its_mark_covers_only_up_to_the_day_it_was_billed(self):
        frappe.db.set_value("MSP Contract", self.contract, "billing_timing", "In Arrears")
        frappe.db.commit()

        self.assertEqual(
            BillingService.covered_through(self.customer, "Quarterly", "In Arrears"),
            getdate(MARK),
        )

    def test_its_periods_still_run_from_the_anniversary(self):
        frappe.db.set_value("MSP Contract", self.contract, "billing_timing", "In Arrears")
        frappe.db.commit()
        self.since("2023-03-06")

        rows = BillingService.due(horizon_days=3650)["rows"]
        row = next(r for r in rows if r["customer"] == self.customer)

        self.assertEqual(getdate(row["next_period_start"]), getdate("2026-07-25"))
        self.assertEqual(
            getdate(row["next_period_end"]),
            getdate("2026-10-24"),
            "three months from where it picked up, not the calendar quarter",
        )
