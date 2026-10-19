"""A service billed ahead that stops early owes the days back.

Issue #19. Billed in advance, a customer pays for a period before it is served. When a
service stops inside that period, the days nobody was served for were charged and must be
returned — detected from the assignment as it stands now, not from the run's own snapshot,
which still shows the service running because it was drawn before the end was known.

The share given back is exact. A charge rounds a partial month up to the next five-day
block so that a service that really ran is never billed at nothing; a credit rounding up
the same way would hand back more than was charged for those days, which the issue forbids.
"""

import frappe
from frappe.utils import getdate

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.utils.errors import ValidationError as ServiceRefused

from .test_billing_history import BillingHistoryCase


class AdvanceCase(BillingHistoryCase):
    """A quarter paid for before it was served, on the thirty-day convention."""

    RATE = 3000.0
    START = "2026-07-01"
    END = "2026-09-30"

    def setUp(self):
        super().setUp()
        self.service = self.offering("CRED")
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
        frappe.db.commit()

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

    def billed_ahead(self, who=None):
        """A quarter drawn, approved and posted while the service was still running."""
        assignment = self.running(self.service, client_user=who or self.john, started=0)
        frappe.db.set_value(
            "MSP Service Assignment", assignment, "effective_start_date", "2023-01-01"
        )
        frappe.db.commit()
        run = self.drawn(start=self.START, end=self.END)
        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)

        return run, assignment

    def stops(self, assignment, on):
        frappe.db.set_value("MSP Service Assignment", assignment, "effective_end_date", on)
        frappe.db.set_value("MSP Service Assignment", assignment, "billing_status", "Ended")
        frappe.db.set_value("MSP Service Assignment", assignment, "operational_status", "Ended")
        frappe.db.commit()

    def owed(self, run, assignment):
        source = BillingService.creditable_lines(run)
        line = next(l for l in source["lines"] if l["service_assignment"] == assignment)

        return source, line


class TestWhatIsOwedBack(AdvanceCase):
    def test_six_unused_days_of_a_thirty_day_month_are_six_thirtieths(self):
        """The issue's own worked example: ends 24-09, quarter paid to 30-09."""
        run, assignment = self.billed_ahead()
        self.stops(assignment, "2026-09-24")

        _, line = self.owed(run, assignment)

        self.assertIsNotNone(line["owed_back"])
        self.assertEqual(getdate(line["owed_back"]["ended_on"]), getdate("2026-09-24"))
        self.assertEqual(getdate(line["owed_back"]["unused_from"]), getdate("2026-09-25"))
        self.assertEqual(getdate(line["owed_back"]["unused_to"]), getdate("2026-09-30"))
        self.assertEqual(line["owed_back"]["unused_days"], 6)
        self.assertEqual(line["owed_back"]["months"], 0.2)

    def test_the_credit_is_not_rounded_up_the_way_a_charge_is(self):
        """Six days charged would be two five-day blocks; six days credited are six days."""
        self.assertEqual(BillingService._billed_days(6, 30) / 30.0, 10 / 30.0)
        self.assertEqual(BillingService._unused_months("30-Day Convention", "2026-09-25", "2026-09-30"), 0.2)

    def test_a_service_running_to_the_end_owes_nothing(self):
        run, assignment = self.billed_ahead()
        self.stops(assignment, self.END)

        _, line = self.owed(run, assignment)

        self.assertIsNone(line["owed_back"])

    def test_a_service_still_running_owes_nothing(self):
        run, assignment = self.billed_ahead()

        _, line = self.owed(run, assignment)

        self.assertIsNone(line["owed_back"])

    def test_a_whole_unused_month_is_one_month(self):
        run, assignment = self.billed_ahead()
        self.stops(assignment, "2026-08-31")

        _, line = self.owed(run, assignment)

        self.assertEqual(line["owed_back"]["months"], 1.0)
        self.assertEqual(line["owed_back"]["unused_days"], 30)

    def test_the_run_total_says_how_much_of_it_stopped_being_served(self):
        run, assignment = self.billed_ahead()
        self.stops(assignment, "2026-09-24")

        source, _ = self.owed(run, assignment)

        self.assertEqual(source["owed_back_months"], 0.2)
        self.assertTrue(source["billed_in_advance"])

    def test_a_contract_billed_in_arrears_proposes_nothing(self):
        """Served first, paid after: there is no unused advance to give back."""
        run, assignment = self.billed_ahead()
        frappe.db.set_value("MSP Contract", self.contract, "billing_timing", "In Arrears")
        frappe.db.commit()
        self.stops(assignment, "2026-09-24")

        source, line = self.owed(run, assignment)

        self.assertIsNone(line["owed_back"])
        self.assertFalse(source["billed_in_advance"])

    def test_several_people_ending_separately_are_proposed_separately(self):
        run, first = self.billed_ahead()
        second = self.running(
            self.service, client_user=self.make_person(self.customer, "Bob"), started=0
        )
        frappe.db.set_value(
            "MSP Service Assignment", second, "effective_start_date", "2023-01-01"
        )
        frappe.db.commit()
        self.stops(first, "2026-09-24")

        source, line = self.owed(run, first)

        self.assertEqual(line["owed_back"]["months"], 0.2)
        self.assertEqual(
            [l["service_assignment"] for l in source["lines"] if l["owed_back"]], [first]
        )


    def test_two_services_of_the_same_person_are_owed_back_separately(self):
        """One person, two components: each is its own line and its own adjustment."""
        run, first = self.billed_ahead()
        other = self.offering("CRED2")
        second = self.running(other, client_user=self.john, started=0)
        frappe.db.set_value(
            "MSP Service Assignment", second, "effective_start_date", "2023-01-01"
        )
        frappe.db.commit()
        second_run = self.drawn(start="2026-10-01", end="2026-12-31")
        BillingService.finalise(second_run)
        BillingService.submit_invoice(name=second_run, notify=0)

        self.stops(first, "2026-09-24")
        self.stops(second, "2026-11-20")

        owed_first = self.owed(run, first)[1]["owed_back"]
        owed_second = self.owed(second_run, second)[1]["owed_back"]

        self.assertEqual(owed_first["months"], 0.2)
        self.assertEqual(owed_second["unused_days"], 41)
        self.assertNotEqual(owed_first["unused_from"], owed_second["unused_from"])


class TestGivingItBack(AdvanceCase):
    def test_the_proposal_can_be_accepted_as_it_stands(self):
        run, assignment = self.billed_ahead()
        self.stops(assignment, "2026-09-24")
        _, line = self.owed(run, assignment)

        note = BillingService.create_credit_note(
            name=run,
            lines=[{"service_assignment": assignment, "months": line["owed_back"]["months"]}],
            reason="Service ended on 24 September; the quarter was paid to 30 September.",
        )

        doc = frappe.get_doc("MSP Billing Run", note["name"])
        self.track("MSP Billing Run", doc.name)
        self.assertEqual(doc.credit_note_of, run)
        self.assertEqual(doc.lines[0].billable_months, -0.2)

    def test_it_can_be_asked_for_as_the_stretch_that_was_not_served(self):
        """The operator knows the dates, not the months: the conversion belongs here."""
        run, assignment = self.billed_ahead()

        note = BillingService.create_credit_note(
            name=run,
            lines=[{"service_assignment": assignment, "from": "2026-09-05", "to": "2026-09-13"}],
            reason="Their server was down from the 5th to the 13th.",
        )

        doc = frappe.get_doc("MSP Billing Run", note["name"])
        self.track("MSP Billing Run", doc.name)
        # nine days of a thirty-day month, given back exactly
        self.assertEqual(doc.lines[0].billable_months, -0.3)

    def test_a_stretch_outside_what_was_billed_is_refused(self):
        run, assignment = self.billed_ahead()

        with self.assertRaises(ServiceRefused) as refusal:
            BillingService.create_credit_note(
                name=run,
                lines=[{"service_assignment": assignment, "from": "2026-10-01", "to": "2026-10-05"}],
                reason="October was never on this invoice.",
            )

        self.assertIn("A credit cannot give back what was never billed", str(refusal.exception))

    def test_a_period_the_wrong_way_round_is_refused(self):
        run, assignment = self.billed_ahead()

        with self.assertRaises(ServiceRefused):
            BillingService.create_credit_note(
                name=run,
                lines=[{"service_assignment": assignment, "from": "2026-09-13", "to": "2026-09-05"}],
                reason="Backwards.",
            )

    def test_crediting_twice_never_gives_back_more_than_was_charged(self):
        run, assignment = self.billed_ahead()
        self.stops(assignment, "2026-09-24")

        first = BillingService.create_credit_note(
            name=run, lines=[{"service_assignment": assignment, "months": 0.2}],
            reason="Ended early.",
        )
        self.track("MSP Billing Run", first["name"])

        source, line = self.owed(run, assignment)

        self.assertEqual(line["credited_months"], 0.2)
        self.assertEqual(line["remaining_months"], flt_round(line["billable_months"] - 0.2))
        self.assertLessEqual(line["owed_back"]["months"] if line["owed_back"] else 0, line["remaining_months"])

    def test_what_is_proposed_never_exceeds_what_is_still_creditable(self):
        run, assignment = self.billed_ahead()
        self.stops(assignment, "2026-07-01")

        _, line = self.owed(run, assignment)

        self.assertLessEqual(line["owed_back"]["months"], line["remaining_months"])


class TestTheQuarterAfterwards(AdvanceCase):
    """#19 Fix 5: what stopped is not billed again, and the rest carries on."""

    def test_a_terminated_service_is_absent_from_the_next_quarter(self):
        run, assignment = self.billed_ahead()
        self.stops(assignment, "2026-09-24")

        lines, _ = BillingService.build_lines(self.contract, "2026-10-01", "2026-12-31")

        self.assertNotIn(assignment, [line["service_assignment"] for line in lines])

    def test_while_the_others_are_billed_as_usual(self):
        run, ended = self.billed_ahead()
        still = self.running(
            self.service, client_user=self.make_person(self.customer, "Carla"), started=0
        )
        frappe.db.set_value(
            "MSP Service Assignment", still, "effective_start_date", "2023-01-01"
        )
        frappe.db.commit()
        self.stops(ended, "2026-09-24")

        lines, _ = BillingService.build_lines(self.contract, "2026-10-01", "2026-12-31")
        kept = {line["service_assignment"]: line for line in lines}

        self.assertNotIn(ended, kept)
        self.assertIn(still, kept)
        self.assertEqual(kept[still]["billable_months"], 3.0)

    def test_one_that_stops_inside_the_next_quarter_is_billed_up_to_its_end(self):
        run, assignment = self.billed_ahead()
        self.stops(assignment, "2026-11-15")

        lines, _ = BillingService.build_lines(self.contract, "2026-10-01", "2026-12-31")
        line = next(l for l in lines if l["service_assignment"] == assignment)

        self.assertEqual(getdate(line["covered_to"]), getdate("2026-11-15"))
        self.assertLess(line["billable_months"], 3.0)


def flt_round(value):
    from frappe.utils import flt

    return flt(value, 2)


class TestACustomerBilledBeforeThisApplication(AdvanceCase):
    """The Kakivu case of the issue: the quarter was charged, but nothing here says so.

    No MSP Billing Run exists, and the charge was raised by whatever served the customer
    before, so there is no Sales Invoice in this ledger either. The coverage is therefore
    recorded by a named person against stated evidence, and from that moment the ordinary
    machinery works: the six unused days are owed back, the credit cannot exceed them, and
    the quarter ahead is billed without the service that stopped.
    """

    STATEMENT = "Charged by the previous system, invoice KAK-2026-Q3 of 2026-07-24."

    def running_since(self, start, who=None):
        assignment = self.running(self.service, client_user=who or self.john, started=0)
        frappe.db.set_value("MSP Service Assignment", assignment, "effective_start_date", start)
        frappe.db.commit()

        return assignment

    def recorded(self):
        return BillingService.record_past_coverage(
            contract=self.contract,
            period_start=self.START,
            period_end=self.END,
            statement=self.STATEMENT,
        )

    def test_nothing_in_the_application_knows_about_the_charge_to_begin_with(self):
        self.running_since("2023-01-01")

        self.assertEqual(
            BillingService.coverage_evidence(self.customer, self.START, self.END)["runs"], []
        )

    def test_the_evidence_search_offers_the_contract_and_what_it_found(self):
        self.running_since("2023-01-01")

        found = BillingService.coverage_evidence(self.customer, self.START, self.END)

        self.assertEqual(getdate(found["period_start"]), getdate(self.START))
        self.assertIn(self.contract, [row["name"] for row in found["contracts"]])

    def test_it_prices_the_period_as_the_charge_could_have_known_it(self):
        """The whole point: the original charge did not know of an end recorded later.

        Reconstructed from today's dates, a service that stopped on the 24th would be
        recorded as charged to the 24th — and then nothing would be owed back, which is
        the very bug. Billed in advance, the charge went out on the first day and knew
        nothing of that end.
        """
        assignment = self.running_since("2023-01-01")
        self.stops(assignment, "2026-09-24")

        preview = BillingService.coverage_preview(self.contract, self.START, self.END)
        line = next(l for l in preview["lines"] if l["service_assignment"] == assignment)

        self.assertEqual(getdate(preview["as_known_on"]), getdate(self.START))
        self.assertEqual(line["billable_months"], 3.0)
        self.assertEqual(line["amount"], self.RATE * 3)

    def test_an_end_recorded_before_the_charge_went_out_is_respected(self):
        """What the charge did know, it charged: a service already over was not billed on."""
        assignment = self.running_since("2023-01-01")
        self.stops(assignment, "2026-06-15")

        preview = BillingService.coverage_preview(self.contract, self.START, self.END)
        line = next((l for l in preview["lines"] if l["service_assignment"] == assignment), None)

        self.assertTrue(line is None or line["amount"] == 0.0)

    def test_the_six_days_are_owed_back_on_a_full_quarter_recorded_this_way(self):
        assignment = self.running_since("2023-01-01")
        self.stops(assignment, "2026-09-24")
        run = self.recorded()

        source, line = self.owed(run["name"], assignment)

        self.assertEqual(line["billable_months"], 3.0)
        self.assertEqual(line["owed_back"]["unused_days"], 6)
        self.assertEqual(line["owed_back"]["months"], 0.2)
        self.assertEqual(source["owed_back_months"], 0.2)

    def test_the_preview_shows_what_that_period_would_have_held(self):
        assignment = self.running_since("2023-01-01")

        preview = BillingService.coverage_preview(self.contract, self.START, self.END)
        line = next(l for l in preview["lines"] if l["service_assignment"] == assignment)

        self.assertIsNone(line["exception_code"])
        self.assertEqual(line["billable_months"], 3.0)
        self.assertEqual(preview["total_amount"], self.RATE * 3)

    def test_recording_it_writes_a_run_marked_as_a_reconstruction(self):
        self.running_since("2023-01-01")

        run = self.recorded()

        self.assertTrue(run["reconstructed"])
        self.assertEqual(run["status"], "Invoiced")
        self.assertIsNone(run["sales_invoice"], "it raises no invoice of its own")
        self.assertEqual(run["coverage_evidence"], self.STATEMENT)
        self.assertEqual(getdate(run["billing_period_end"]), getdate(self.END))

    def test_it_says_nothing_without_a_statement_of_where_the_charge_came_from(self):
        self.running_since("2023-01-01")

        with self.assertRaisesRegex(ServiceRefused, "where the original charge came from"):
            BillingService.record_past_coverage(
                contract=self.contract,
                period_start=self.START,
                period_end=self.END,
                statement="  ",
            )

    def test_a_period_already_covered_cannot_be_recorded_again(self):
        self.running_since("2023-01-01")
        self.recorded()

        with self.assertRaisesRegex(ServiceRefused, "cannot be recorded as charged twice"):
            self.recorded()

    def test_a_period_nothing_was_running_in_is_refused(self):
        with self.assertRaisesRegex(ServiceRefused, "nothing that charge could have covered"):
            BillingService.record_past_coverage(
                contract=self.contract,
                period_start=self.START,
                period_end=self.END,
                statement=self.STATEMENT,
            )

    def test_an_invoice_of_another_customer_cannot_be_named_as_the_evidence(self):
        self.running_since("2023-01-01")
        theirs = self.make_customer(f"OTH{self.tag}")

        with self.assertRaisesRegex(ServiceRefused, "not a posted invoice"):
            BillingService.record_past_coverage(
                contract=self.contract,
                period_start=self.START,
                period_end=self.END,
                statement=self.STATEMENT,
                sales_invoice=f"SINV-NOPE-{theirs}",
            )

    def test_the_six_unused_days_are_owed_back_from_the_recorded_coverage(self):
        """The worked example of the issue, reached without a run ever having existed."""
        assignment = self.running_since("2023-01-01")
        run = self.recorded()
        self.stops(assignment, "2026-09-24")

        source, line = self.owed(run["name"], assignment)

        self.assertTrue(source["billed_in_advance"])
        self.assertEqual(line["owed_back"]["unused_days"], 6)
        self.assertEqual(line["owed_back"]["months"], 0.2)
        self.assertEqual(getdate(line["owed_back"]["unused_from"]), getdate("2026-09-25"))
        self.assertEqual(getdate(line["owed_back"]["unused_to"]), getdate("2026-09-30"))

    def test_each_terminated_component_is_owed_its_own_six_days(self):
        """Two services of the same person, as the issue lists for Abbas Skaiki."""
        second = self.offering("CRE2")
        first = self.running_since("2023-01-01")
        other = self.running(second, client_user=self.john, started=0)
        frappe.db.set_value(
            "MSP Service Assignment", other, "effective_start_date", "2023-01-01"
        )
        frappe.db.commit()

        run = self.recorded()
        self.stops(first, "2026-09-24")
        self.stops(other, "2026-09-24")

        source = BillingService.creditable_lines(run["name"])
        owed = {
            line["service_assignment"]: line["owed_back"]
            for line in source["lines"]
            if line["owed_back"]
        }

        self.assertEqual(sorted(owed), sorted([first, other]))
        self.assertEqual([row["unused_days"] for row in owed.values()], [6, 6])
        self.assertEqual(source["owed_back_months"], 0.4)

    def test_the_credit_note_is_written_and_cannot_exceed_the_unused_days(self):
        assignment = self.running_since("2023-01-01")
        run = self.recorded()
        self.stops(assignment, "2026-09-24")

        with self.assertRaisesRegex(ServiceRefused, "falls outside"):
            BillingService.create_credit_note(
                name=run["name"],
                reason="More than was ever charged",
                lines=[
                    {
                        "service_assignment": assignment,
                        "from": "2026-09-25",
                        "to": "2026-10-15",
                    }
                ],
            )

        note = BillingService.create_credit_note(
            name=run["name"],
            reason="Service ended 2026-09-24; six days of the quarter were not served.",
            lines=[
                {"service_assignment": assignment, "from": "2026-09-25", "to": "2026-09-30"}
            ],
        )

        self.assertEqual(note["credit_note_of"], run["name"])
        self.assertEqual(note["lines"][0]["billable_months"], -0.2)
        self.assertEqual(note["lines"][0]["amount"], -self.RATE * 0.2)

    def test_one_stretch_over_several_lines_pays_each_only_what_it_owes(self):
        """The ordinary case: a handful of people who stopped within days of each other.

        The screen offers the widest window they span, because that is the stretch being
        talked about. A line that stopped later is still credited only for its own unused
        days — the long window must never pay back more than was charged for nothing.
        """
        early = self.running_since("2023-01-01")
        late = self.running_since("2023-01-01", who=self.make_person(self.customer, "Late"))
        run = self.recorded()
        self.stops(early, "2026-09-20")
        self.stops(late, "2026-09-28")

        note = BillingService.create_credit_note(
            name=run["name"],
            reason="Both stopped in the last fortnight of September.",
            lines=[
                {"service_assignment": early, "from": "2026-09-21", "to": "2026-09-30"},
                {"service_assignment": late, "from": "2026-09-21", "to": "2026-09-30"},
            ],
        )
        months = {
            line["service_assignment"]: line["billable_months"] for line in note["lines"]
        }

        # ten days for the one that stopped on the 20th, two for the one that stopped later
        self.assertAlmostEqual(months[early], -10 / 30, places=2)
        self.assertAlmostEqual(months[late], -2 / 30, places=2)
        self.assertGreater(abs(months[early]), abs(months[late]))

    def test_a_credit_with_nothing_said_still_says_what_it_did(self):
        """The reason is the operator's to give or not; the record is not optional."""
        assignment = self.running_since("2023-01-01")
        run = self.recorded()
        self.stops(assignment, "2026-09-24")

        note = BillingService.create_credit_note(
            name=run["name"],
            reason="",
            lines=[{"service_assignment": assignment, "from": "2026-09-25", "to": "2026-09-30"}],
        )

        self.assertEqual(
            note["credit_note_reason"], "Days not served, 2026-09-25 to 2026-09-30."
        )

    def test_a_period_earlier_than_a_run_already_on_file_can_still_be_recorded(self):
        """Taking a customer on, their history arrives in whatever order somebody has it.

        Recording the quarter before one already recorded must not be refused because the
        later quarter exists: the whole point of reconstructing a period is to read it as
        it stood, not through coverage established after it.
        """
        self.running_since("2023-01-01")
        self.recorded()

        earlier = BillingService.record_past_coverage(
            contract=self.contract,
            period_start="2026-04-01",
            period_end="2026-06-30",
            statement="The quarter before, also charged by the previous system.",
        )

        self.assertGreater(len(earlier["lines"]), 0)
        self.assertEqual(getdate(earlier["billing_period_end"]), getdate("2026-06-30"))

    def test_a_stretch_that_was_served_in_full_is_refused_rather_than_moved(self):
        """A window outside what a line owes is a question, not a rounding error."""
        assignment = self.running_since("2023-01-01")
        run = self.recorded()
        self.stops(assignment, "2026-09-24")

        with self.assertRaisesRegex(ServiceRefused, "served in full"):
            BillingService.create_credit_note(
                name=run["name"],
                reason="A fortnight nobody mentioned",
                lines=[
                    {"service_assignment": assignment, "from": "2026-09-01", "to": "2026-09-10"}
                ],
            )

    def test_a_shared_window_credits_the_days_of_it_that_were_not_served(self):
        """The cap keeps the days asked for, only fewer — never a different stretch."""
        assignment = self.running_since("2023-01-01")
        run = self.recorded()
        self.stops(assignment, "2026-09-24")

        note = BillingService.create_credit_note(
            name=run["name"],
            reason="September was poor all round.",
            lines=[{"service_assignment": assignment, "from": "2026-09-15", "to": "2026-09-30"}],
        )
        line = note["lines"][0]

        # the asked window overlaps the unused days on 25–30 September, and only those
        self.assertEqual(getdate(line["covered_from"]), getdate("2026-09-25"))
        self.assertEqual(getdate(line["covered_to"]), getdate("2026-09-30"))
        self.assertEqual(line["billable_months"], -0.2)

    def test_the_same_days_cannot_be_given_back_twice(self):
        assignment = self.running_since("2023-01-01")
        run = self.recorded()
        self.stops(assignment, "2026-09-24")

        BillingService.create_credit_note(
            name=run["name"],
            reason="Six unused days of the quarter.",
            lines=[{"service_assignment": assignment, "from": "2026-09-25", "to": "2026-09-30"}],
        )

        source, line = self.owed(run["name"], assignment)

        self.assertEqual(line["credited_months"], 0.2)
        with self.assertRaisesRegex(ServiceRefused, "same days cannot be given back twice"):
            BillingService.create_credit_note(
                name=run["name"],
                reason="Again",
                lines=[
                    {"service_assignment": assignment, "from": "2026-09-25", "to": "2026-09-30"}
                ],
            )

    def test_the_recorded_coverage_stops_the_quarter_being_charged_again(self):
        assignment = self.running_since("2023-01-01")
        self.recorded()

        lines, _ = BillingService.build_lines(self.contract, self.START, self.END)
        line = next(l for l in lines if l["service_assignment"] == assignment)

        self.assertIsNotNone(line["exception_code"])
        self.assertEqual(line["amount"], 0.0)

    def test_the_service_that_stopped_is_left_out_of_the_quarter_ahead(self):
        assignment = self.running_since("2023-01-01")
        self.recorded()
        self.stops(assignment, "2026-09-24")

        lines, _ = BillingService.build_lines(self.contract, "2026-10-01", "2026-12-31")
        line = next((l for l in lines if l["service_assignment"] == assignment), None)

        self.assertTrue(line is None or line["amount"] == 0.0)
