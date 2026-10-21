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

    def test_it_proposes_the_catch_up_when_somebody_arrived_after_the_payment(self):
        """The short window is work only when it owes something."""
        self.since("2023-03-06")
        self.since("2026-08-01", who=self.make_person(self.customer, "Newcomer"))

        row = self.proposal()

        self.assertEqual(getdate(row["covered_upto"]), getdate(MARK))
        self.assertEqual(getdate(row["next_period_start"]), getdate("2026-07-25"))
        self.assertEqual(getdate(row["next_period_end"]), getdate(QUARTER_END))
        self.assertGreater(row["billable_assignments"], 0)

    def test_a_catch_up_nobody_owes_is_skipped_for_the_quarter_ahead(self):
        """Everybody there was paid for through 30 September: the work is October."""
        self.since("2023-03-06")

        row = self.proposal()

        self.assertEqual(getdate(row["covered_upto"]), getdate(QUARTER_END))
        self.assertEqual(getdate(row["next_period_start"]), getdate(NEXT_START))
        self.assertEqual(getdate(row["next_period_end"]), getdate(NEXT_END))
        self.assertGreater(row["billable_assignments"], 0)

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


class TestWhatTheChargedQuarterLeftBehind(KakivuCase):
    """Who arrived after the invoice went out, and who stopped before it ran out.

    Both are read from the periods actually charged, per assignment. The company-wide mark
    is no answer for somebody who was never on that invoice: treating it as theirs is how a
    mid-quarter arrival lost their first weeks without anybody noticing.
    """

    def attest(self, period_start, period_end, invoice_date):
        """The lines of the proposal, as somebody who read the original document."""
        preview = BillingService.coverage_preview(
            self.contract, period_start, period_end, invoice_date=invoice_date
        )

        return [
            line["service_assignment"]
            for line in preview["lines"]
            if not line["exception_code"]
        ]

    def charged_quarter(self):
        """The quarter recorded as charged, the way a customer arriving with history is."""
        return BillingService.record_past_coverage(
            contract=self.contract,
            period_start="2026-07-01",
            period_end=QUARTER_END,
            statement="Charged by the previous system.",
            invoice_date=MARK,
            attested=self.attest("2026-07-01", QUARTER_END, MARK),
        )

    def pending(self):
        return BillingService.pending_adjustments(self.contract, self.customer)

    def test_somebody_who_arrived_after_the_invoice_was_not_on_it(self):
        self.since("2023-01-01")
        newcomer = self.since("2026-08-15", who=self.make_person(self.customer, "Newcomer"))

        run = self.charged_quarter()

        self.assertNotIn(
            newcomer, [line["service_assignment"] for line in run["lines"]],
            "the July invoice could not have charged an August arrival",
        )

    def test_they_are_proposed_for_catching_up(self):
        self.since("2023-01-01")
        self.since("2026-08-15", who=self.make_person(self.customer, "Newcomer"))
        self.charged_quarter()

        catch_up = self.pending()["catch_up"]

        self.assertEqual(catch_up["lines"], 1)
        self.assertEqual(getdate(catch_up["from"]), getdate("2026-08-15"))
        self.assertEqual(getdate(catch_up["to"]), getdate(QUARTER_END))
        self.assertGreater(catch_up["amount"], 0.0)

    def test_the_catch_up_rides_on_a_run_that_reaches_back_to_them(self):
        """One invoice: the quarter ahead for everybody, their own days for the newcomer."""
        old = self.since("2023-01-01")
        newcomer = self.since("2026-08-15", who=self.make_person(self.customer, "Newcomer"))
        self.charged_quarter()

        lines, _ = BillingService.build_lines(self.contract, "2026-08-15", NEXT_END)
        found = {line["service_assignment"]: line for line in lines}

        self.assertEqual(getdate(found[old]["covered_from"]), getdate(NEXT_START),
                         "already paid through September, so it starts in October")
        self.assertEqual(getdate(found[newcomer]["covered_from"]), getdate("2026-08-15"),
                         "never charged, so it starts the day they arrived")
        self.assertEqual(getdate(found[newcomer]["covered_to"]), getdate(NEXT_END))

    def test_nobody_is_caught_up_twice(self):
        self.since("2023-01-01")
        self.since("2026-08-15", who=self.make_person(self.customer, "Newcomer"))
        self.charged_quarter()

        run = BillingService.record_past_coverage(
            contract=self.contract, period_start=NEXT_START, period_end=NEXT_END,
            statement="The quarter ahead, charged.",
            invoice_date=NEXT_START,
            attested=self.attest(NEXT_START, NEXT_END, NEXT_START),
        )
        self.assertGreater(len(run["lines"]), 0)

        again = self.pending()["catch_up"]
        self.assertEqual(again["lines"], 0, "their days are now on a run of their own")

    def test_a_line_a_run_could_not_price_was_never_charged_by_it(self):
        """A run carries the lines it could not price; carrying is not charging.

        Read otherwise, somebody whose rate was missing in July would be treated as paid
        for through September and could never be billed at all.
        """
        assignment = self.since("2023-01-01")
        run = self.charged_quarter()
        frappe.db.sql(
            """
            insert into `tabMSP Billing Run Line`
                (name, parent, parenttype, parentfield, service_assignment, service_item,
                 quantity, billable_months, unit_rate, amount, exception_code, idx,
                 creation, modified, owner, modified_by)
            values (%s, %s, 'MSP Billing Run', 'lines', %s, %s, 1, 0, 0, 0, 'Missing Rate',
                    99, now(), now(), 'Administrator', 'Administrator')
            """,
            (f"zzexc-{self.tag}", run["name"], f"NOPE-{self.tag}", self.service),
        )
        frappe.db.commit()

        lines, _ = BillingService.build_lines(self.contract, NEXT_START, NEXT_END)
        carried = next(
            (line for line in lines if line["service_assignment"] == f"NOPE-{self.tag}"), None
        )

        self.assertIsNone(carried, "the planted line stands for an assignment of its own")
        self.assertIsNotNone(
            next(line for line in lines if line["service_assignment"] == assignment)
        )

    def test_somebody_who_stopped_early_is_proposed_for_a_credit(self):
        assignment = self.since("2023-01-01")
        self.charged_quarter()
        frappe.db.set_value(
            "MSP Service Assignment", assignment, "effective_end_date", "2026-09-24"
        )
        frappe.db.commit()

        owed = self.pending()["owed_back"]

        self.assertEqual(owed["lines"], 1)
        self.assertEqual(owed["months"], 0.2)
        self.assertIsNotNone(owed["run"], "the run to open to give the days back")

    def test_a_quarter_nothing_happened_in_leaves_nothing_behind(self):
        self.since("2023-01-01")
        self.charged_quarter()

        pending = self.pending()

        self.assertEqual(pending["catch_up"]["lines"], 0)
        self.assertEqual(pending["owed_back"]["lines"], 0)

    def test_a_contract_never_charged_proposes_neither(self):
        self.since("2023-01-01")

        pending = self.pending()

        self.assertEqual(pending["catch_up"]["lines"], 0)
        self.assertEqual(pending["owed_back"]["lines"], 0)


class TestWhatTheBaselineSaysOutranksTheDate(KakivuCase):
    """A date on the customer says a period was paid for, never by whom.

    The reconciliation of the import writes what it found against each service: days
    confirmed on the original invoice, a service that was not on it at all, or a question
    nobody has answered. Each of those outranks the company-wide date, which is the only
    thing stopping a service nobody charged from reading as paid.
    """

    def says(self, assignment, **baseline):
        frappe.db.set_value("MSP Service Assignment", assignment, baseline)
        frappe.db.commit()

    def line_for(self, assignment, start="2026-07-25", end=QUARTER_END):
        lines, _ = BillingService.build_lines(self.contract, start, end)

        return next(
            (line for line in lines if line["service_assignment"] == assignment), None
        )

    def test_a_service_the_invoice_never_carried_is_owed_from_its_first_day(self):
        """Started before the charge went out, absent from it: nobody has been paid."""
        absent = self.since("2026-07-20")
        self.says(
            absent,
            baseline_state="Absent / Never Billed",
            baseline_source="Manual Attestation",
        )

        line = self.line_for(absent, start="2026-07-20")

        self.assertIsNone(line["exception_code"])
        self.assertGreater(line["billable_months"], 0.0)
        self.assertEqual(getdate(line["covered_from"]), getdate("2026-07-20"))

    def test_a_service_confirmed_to_an_earlier_day_is_not_stretched_to_the_quarter(self):
        """The mark reaches 30 September; this baseline attests only to 31 July."""
        shorter = self.since("2023-01-01")
        self.says(
            shorter,
            baseline_covered_from="2023-01-01",
            baseline_covered_to="2026-07-31",
            baseline_state="Confirmed",
            baseline_source="ERPNext Invoice",
        )

        line = self.line_for(shorter, start="2026-07-01")

        self.assertIsNone(line["exception_code"])
        self.assertEqual(getdate(line["covered_from"]), getdate("2026-08-01"))
        self.assertEqual(getdate(line["covered_to"]), getdate(QUARTER_END))

    def test_a_question_nobody_answered_is_neither_billed_nor_presumed_paid(self):
        unsure = self.since("2023-01-01")
        self.says(unsure, baseline_state="Needs Review")

        line = self.line_for(unsure, start="2026-07-01")

        self.assertEqual(line["exception_code"], "Unverified Coverage")
        self.assertEqual(line["amount"], 0.0)

    def test_a_service_confirmed_over_the_whole_quarter_is_covered(self):
        settled = self.since("2023-01-01")
        self.says(
            settled,
            baseline_covered_from="2023-01-01",
            baseline_covered_to=QUARTER_END,
            baseline_state="Confirmed",
        )

        line = self.line_for(settled, start="2026-07-01")

        self.assertEqual(line["exception_code"], "Already Covered")
        self.assertEqual(line["amount"], 0.0)

    def test_a_service_that_began_in_september_is_prorated_to_the_quarter_end(self):
        later = self.since("2026-09-05", who=self.make_person(self.customer, "September"))

        line = self.line_for(later, start="2026-09-05")

        self.assertIsNone(line["exception_code"])
        self.assertEqual(getdate(line["covered_from"]), getdate("2026-09-05"))
        self.assertEqual(getdate(line["covered_to"]), getdate(QUARTER_END))

    def test_and_the_ready_to_bill_count_says_the_same_as_the_run_would(self):
        """The counter and the preview answer the same question or one of them is lying."""
        self.since("2023-01-01")
        absent = self.since(
            "2026-07-20", who=self.make_person(self.customer, "AbsentOne")
        )
        self.says(absent, baseline_state="Absent / Never Billed")

        owed = BillingService._billable_over(
            self.contract, self.customer, "2026-07-25", QUARTER_END
        )
        lines, _ = BillingService.build_lines(self.contract, "2026-07-25", QUARTER_END)
        billed = [line for line in lines if not line["exception_code"] and line["amount"]]

        self.assertEqual(owed, len(billed))
