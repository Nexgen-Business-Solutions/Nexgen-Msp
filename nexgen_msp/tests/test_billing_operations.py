"""The one preparation path, and the three operations that stay apart on it.

Each step is asked for on its own: what the operation is about, which services it carries,
where it posts, and then the one call that prepares it. Nothing here submits a document.
"""

import frappe
from frappe.utils import add_days, flt, getdate

from nexgen_msp.api.internal.services.billing import run_view, wizard, workspace
from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.utils.errors import ValidationError as ServiceRefused

from .test_billing_history import BillingHistoryCase


class OperationCase(BillingHistoryCase):
    def setUp(self):
        super().setUp()
        self.service = self.offering("OPS")
        self.assignment = self.running(self.service, client_user=self.john)
        frappe.db.set_value("Customer", self.customer, "msp_last_billed_on", self.days_ago(400))
        frappe.db.commit()


class TestWhatTheFirstStepSays(OperationCase):
    def test_it_carries_the_contract_terms_and_a_window(self):
        context = wizard.context(kind="period", contract=self.contract)

        self.assertEqual(context["customer"], self.customer)
        self.assertEqual(context["billing_frequency"], "Monthly")
        self.assertEqual(context["billing_timing"], "In Arrears")
        self.assertTrue(context["period_start"])
        self.assertTrue(context["period_end"])

    def test_billing_in_arrears_is_explained_on_the_first_step(self):
        context = wizard.context(kind="period", contract=self.contract)

        self.assertIn("arrears", (context["note"] or "").lower())

    def test_a_credit_says_what_it_stands_against(self):
        context = wizard.context(kind="credit_note", contract=self.contract)

        self.assertEqual(context["label"], "Credit note")
        self.assertIn("credit", (context["note"] or "").lower())

    def test_an_unknown_contract_is_refused(self):
        with self.assertRaises(Exception):
            wizard.context(kind="period", contract="CON-does-not-exist")


class TestWhatTheSecondStepOffers(OperationCase):
    def test_every_candidate_says_why_it_is_there(self):
        start, end = self.month()
        answer = wizard.services(
            kind="period", contract=self.contract, period_start=start, period_end=end
        )

        self.assertTrue(answer["lines"])
        for line in answer["lines"]:
            self.assertTrue(line["reason"])
            self.assertTrue(line["eligible"])

    def test_a_line_that_cannot_be_billed_is_held_apart(self):
        start, end = self.month()
        frappe.db.delete("Item Price", {"item_code": self.service, "customer": self.customer})
        frappe.db.commit()

        answer = wizard.services(
            kind="period", contract=self.contract, period_start=start, period_end=end
        )

        self.assertEqual(answer["lines"], [])
        self.assertTrue(answer["blocked"])
        self.assertEqual(answer["blocked"][0]["exception_code"], "Missing Rate")

    def test_a_credit_started_from_scratch_offers_every_service_to_configure(self):
        """Nothing on file says what was charged, which does not mean nothing is owed."""
        start, end = self.month()
        answer = wizard.services(
            kind="credit_note",
            contract=self.contract,
            period_start=start,
            period_end=end,
            scope="all",
        )

        self.assertIsNone(answer["source_run"])
        self.assertIsNone(answer["note"])
        self.assertIn(self.assignment, [line["assignment"] for line in answer["lines"]])
        self.assertTrue(all(line["editable"] for line in answer["lines"]))

    def test_a_detected_credit_with_no_charge_on_file_offers_nothing_to_configure(self):
        """A proposal is read, not composed: with nothing detected it says so."""
        start, end = self.month()
        answer = wizard.services(
            kind="credit_note",
            contract=self.contract,
            period_start=start,
            period_end=end,
            scope="detected",
        )

        self.assertIsNone(answer["source_run"])
        self.assertEqual(answer["lines"], [])
        self.assertIn("nothing detected", (answer["note"] or "").lower())


class TestWhatTheLastStepPrepares(OperationCase):
    def test_it_draws_a_run_with_only_the_lines_chosen(self):
        start, end = self.month()
        made = wizard.create(
            kind="period",
            contract=self.contract,
            period_start=start,
            period_end=end,
            include=[self.assignment],
        )
        self.track("MSP Billing Run", made["run"])

        lines = frappe.get_all(
            "MSP Billing Run Line", filters={"parent": made["run"]}, pluck="service_assignment"
        )

        self.assertEqual(lines, [self.assignment])

    def test_nothing_is_sent_to_erpnext_unless_it_was_asked_for(self):
        start, end = self.month()
        made = wizard.create(
            kind="period",
            contract=self.contract,
            period_start=start,
            period_end=end,
            include=[self.assignment],
            draft_invoice=0,
        )
        self.track("MSP Billing Run", made["run"])

        self.assertFalse(frappe.db.get_value("MSP Billing Run", made["run"], "sales_invoice"))

    def test_a_credit_without_a_charge_behind_it_is_refused(self):
        with self.assertRaises(ServiceRefused):
            wizard.create(kind="credit_note", contract=self.contract, include=[self.assignment])

    def test_the_run_it_draws_belongs_to_the_window_it_was_given(self):
        start, end = self.month()
        made = wizard.create(
            kind="period",
            contract=self.contract,
            period_start=start,
            period_end=end,
            include=[self.assignment],
        )
        self.track("MSP Billing Run", made["run"])

        row = frappe.db.get_value(
            "MSP Billing Run",
            made["run"],
            ["billing_period_start", "billing_period_end"],
            as_dict=True,
        )

        self.assertEqual(getdate(row.billing_period_start), getdate(start))
        self.assertEqual(getdate(row.billing_period_end), getdate(end))


class TestWhatTheThirdStepAsksFor(OperationCase):
    def test_it_reads_the_dimensions_erpnext_actually_wants(self):
        answer = wizard.accounting(contract=self.contract)

        self.assertIsInstance(answer["dimensions"], list)
        for dimension in answer["dimensions"]:
            self.assertIn("fieldname", dimension)
            self.assertIn("options", dimension)

    def test_it_names_one_address_and_only_one(self):
        answer = wizard.accounting(contract=self.contract)

        self.assertIn("billing_contact", answer)
        self.assertNotIn("recipients", answer)


class CreditCase(BillingHistoryCase):
    """A quarter paid ahead, served short: the shape issue #19 asks the wizard to carry."""

    RATE = 3000.0
    START = "2026-07-01"
    END = "2026-09-30"

    def setUp(self):
        super().setUp()
        self.service = self.offering("WCRD")
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
        self.mary = self.make_person(self.customer, "Mary", department="Accounting")

    def tearDown(self):
        for doctype in ("Sales Invoice", "Sales Order"):
            for name in frappe.get_all(doctype, filters={"customer": self.customer}, pluck="name"):
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

        super().tearDown()

    def billed_ahead(self, who=None):
        assignment = self.running(self.service, client_user=who or self.john, started=0)
        frappe.db.set_value(
            "MSP Service Assignment", assignment, "effective_start_date", "2023-01-01"
        )
        frappe.db.commit()

        return assignment

    def charge(self):
        run = self.drawn(start=self.START, end=self.END)
        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)

        return run

    def stops(self, assignment, on):
        frappe.db.set_value(
            "MSP Service Assignment",
            assignment,
            {"effective_end_date": on, "billing_status": "Ended", "operational_status": "Ended"},
        )
        frappe.db.commit()


class TestTheCreditTheWizardPrepares(CreditCase):
    def test_it_offers_the_days_paid_for_and_not_served(self):
        first = self.billed_ahead()
        run = self.charge()
        self.stops(first, "2026-09-24")

        answer = wizard.services(kind="credit_note", contract=self.contract, against=run)

        self.assertEqual(answer["source_run"], run)
        self.assertEqual(len(answer["lines"]), 1)
        line = answer["lines"][0]
        self.assertEqual(getdate(line["covered_from"]), getdate("2026-09-25"))
        self.assertEqual(getdate(line["covered_to"]), getdate("2026-09-30"))
        self.assertLess(line["amount"], 0)
        self.assertTrue(line["proof"])

    def test_it_creates_the_credit_note_from_the_lines_chosen(self):
        first = self.billed_ahead()
        run = self.charge()
        self.stops(first, "2026-09-24")

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            include=[first],
            against=run,
            reason="Service ended on 24 September.",
        )
        self.track("MSP Billing Run", made["run"])

        note = frappe.get_doc("MSP Billing Run", made["run"])

        self.assertEqual(note.credit_note_of, run)
        self.assertEqual(len(note.lines), 1)
        self.assertEqual(note.lines[0].service_assignment, first)
        self.assertLess(note.lines[0].billable_months, 0)

    def test_two_lines_of_the_same_charge_are_credited_together(self):
        first = self.billed_ahead()
        second = self.billed_ahead(who=self.mary)
        run = self.charge()
        self.stops(first, "2026-09-24")
        self.stops(second, "2026-09-24")

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            include=[first, second],
            against=run,
            reason="Both services ended on 24 September.",
        )
        self.track("MSP Billing Run", made["run"])

        note = frappe.get_doc("MSP Billing Run", made["run"])

        self.assertEqual(
            sorted(line.service_assignment for line in note.lines), sorted([first, second])
        )

    def test_a_line_nobody_chose_is_left_out_of_the_credit(self):
        first = self.billed_ahead()
        second = self.billed_ahead(who=self.mary)
        run = self.charge()
        self.stops(first, "2026-09-24")
        self.stops(second, "2026-09-24")

        made = wizard.create(
            kind="credit_note", contract=self.contract, include=[second], against=run
        )
        self.track("MSP Billing Run", made["run"])

        note = frappe.get_doc("MSP Billing Run", made["run"])

        self.assertEqual([line.service_assignment for line in note.lines], [second])

    def test_a_charge_of_another_contract_is_refused_as_a_source(self):
        self.billed_ahead()
        run = self.charge()
        other = self.make_customer(f"{self.tag}B")

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="credit_note",
                contract=other,
                include=[],
                against=run,
            )

    def test_nothing_owed_back_is_refused_rather_than_credited_at_zero(self):
        self.billed_ahead()
        run = self.charge()

        with self.assertRaises(ServiceRefused):
            wizard.create(kind="credit_note", contract=self.contract, against=run)


class TestNothingChosenIsNotEverything(CreditCase):
    def test_an_empty_selection_is_refused_on_a_charge(self):
        assignment = self.billed_ahead()

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="period",
                contract=self.contract,
                period_start="2026-10-01",
                period_end="2026-12-31",
                include=[],
            )

        self.assertTrue(assignment)


class TestTheAdditionsRunStaysItsOwn(CreditCase):
    """A catch-up completes a charge: its window is the gap, never the next cycle."""

    def test_it_is_drawn_on_the_window_it_was_given_and_says_what_it_completes(self):
        self.billed_ahead()
        run = self.charge()
        late = self.running(self.service, client_user=self.mary)
        frappe.db.set_value(
            "MSP Service Assignment", late, "effective_start_date", "2026-08-04"
        )
        frappe.db.commit()

        made = wizard.create(
            kind="additions",
            contract=self.contract,
            period_start="2026-08-04",
            period_end=self.END,
            include=[late],
            against=run,
        )
        self.track("MSP Billing Run", made["run"])

        doc = frappe.get_doc("MSP Billing Run", made["run"])

        self.assertEqual(doc.adjustment_of, run)
        self.assertEqual(getdate(doc.billing_period_start), getdate("2026-08-04"))
        self.assertEqual(getdate(doc.billing_period_end), getdate(self.END))
        self.assertEqual([line.service_assignment for line in doc.lines], [late])

    def test_the_listing_calls_it_additions_and_not_regular_billing(self):
        self.billed_ahead()
        run = self.charge()
        late = self.running(self.service, client_user=self.mary)
        frappe.db.set_value(
            "MSP Service Assignment", late, "effective_start_date", "2026-08-04"
        )
        frappe.db.commit()

        made = wizard.create(
            kind="additions",
            contract=self.contract,
            period_start="2026-08-04",
            period_end=self.END,
            include=[late],
            against=run,
        )
        self.track("MSP Billing Run", made["run"])

        row = workspace._runs(made["run"], None, 1, 20)[0][0]

        self.assertEqual(row["kind"], "Additions")


class TestWhatTheServicesStepShowsOfAPause(OperationCase):
    def test_a_service_paused_mid_period_comes_back_as_two_stretches(self):
        start, end = self.month()
        self.paused(self.assignment, add_days(start, 9), add_days(start, 14))

        answer = wizard.services(
            kind="period", contract=self.contract, period_start=start, period_end=end
        )
        line = next(row for row in answer["lines"] if row["id"] == self.assignment)

        self.assertEqual(len(line["segments"]), 2)
        self.assertIn("suspend", line["reason"].lower())

    def test_a_service_paused_throughout_is_not_offered_as_due(self):
        start, end = self.month()
        self.paused(self.assignment, start, add_days(end, 1))

        self.assertEqual(
            BillingService._billable_over(self.contract, self.customer, start, end), 0
        )


class TestTheChargeOpenedForSomebodyToCut(CreditCase):
    """A dispute is settled on the lines of the charge, not only on what was detected."""

    def test_every_line_still_creditable_is_offered(self):
        first = self.billed_ahead()
        second = self.billed_ahead(who=self.mary)
        run = self.charge()

        answer = wizard.services(
            kind="credit_note", contract=self.contract, against=run, scope="all"
        )

        self.assertEqual(answer["scope"], "all")
        # the candidate is the billed line, which is what a credit answers
        self.assertEqual(
            sorted(line["assignment"] for line in answer["lines"]), sorted([first, second])
        )
        for line in answer["lines"]:
            self.assertTrue(line["editable"])
            self.assertTrue(line["line"])

    def test_a_charge_in_arrears_has_nothing_detected_but_is_still_creditable(self):
        """What the operator hit on BR-…-165: nothing owed back, everything creditable."""
        self.billed_ahead()
        frappe.db.set_value("MSP Contract", self.contract, "billing_timing", "In Arrears")
        frappe.db.commit()
        run = self.charge()

        detected = wizard.services(kind="credit_note", contract=self.contract, against=run)
        whole = wizard.services(
            kind="credit_note", contract=self.contract, against=run, scope="all"
        )

        self.assertEqual(detected["lines"], [])
        self.assertIn("stopped being served", detected["note"])
        self.assertEqual(len(whole["lines"]), 1)

    def test_the_operator_cuts_the_days_themselves(self):
        first = self.billed_ahead()
        run = self.charge()

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            include=[{"service_assignment": first, "from": "2026-09-05", "to": "2026-09-13"}],
            reason="Their server was down from the 5th to the 13th.",
        )
        self.track("MSP Billing Run", made["run"])

        note = frappe.get_doc("MSP Billing Run", made["run"])

        self.assertEqual(note.credit_note_of, run)
        # nine days of a thirty-day month, given back exactly
        self.assertEqual(note.lines[0].billable_months, -0.3)

    def test_days_outside_what_was_charged_are_refused(self):
        first = self.billed_ahead()
        run = self.charge()

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="credit_note",
                contract=self.contract,
                against=run,
                scope="all",
                reason="Settled by agreement with the customer.",
                include=[{"service_assignment": first, "from": "2026-10-01", "to": "2026-10-05"}],
            )

    def test_the_same_days_cannot_be_given_back_twice(self):
        first = self.billed_ahead()
        run = self.charge()

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=[{"service_assignment": first, "from": "2026-09-05", "to": "2026-09-13"}],
        )
        self.track("MSP Billing Run", made["run"])

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="credit_note",
                contract=self.contract,
                against=run,
                scope="all",
                reason="Settled by agreement with the customer.",
                include=[{"service_assignment": first, "from": "2026-09-10", "to": "2026-09-20"}],
            )

    def test_a_line_without_days_or_months_is_refused(self):
        first = self.billed_ahead()
        run = self.charge()

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="credit_note",
                contract=self.contract,
                against=run,
                scope="all",
                reason="Settled by agreement with the customer.",
                include=[{"service_assignment": first}],
            )


class TestWhatTheRunPageSaysAboutCrediting(CreditCase):
    def test_it_reports_the_credit_it_detects(self):
        first = self.billed_ahead()
        run = self.charge()
        self.stops(first, "2026-09-24")

        view = run_view.run_view(run)

        self.assertIsNotNone(view["credit_detected"])
        self.assertEqual(view["credit_detected"]["lines"], 1)
        self.assertLess(view["credit_detected"]["amount"], 0)

    def test_it_reports_nothing_when_nothing_stopped_early(self):
        self.billed_ahead()
        run = self.charge()

        self.assertIsNone(run_view.run_view(run)["credit_detected"])


class TestACreditGivesBackWhatWasTaken(CreditCase):
    """A credit answers the invoice, not the price list."""

    def discounted(self, assignment, percent):
        frappe.db.set_value(
            "MSP Service Assignment", assignment, "msp_discount_percent", percent
        )
        frappe.db.commit()

    def test_the_credit_carries_the_discount_the_charge_was_given(self):
        first = self.billed_ahead()
        run = self.charge()
        frappe.db.set_value("MSP Billing Run Line", {"parent": run}, "discount_percent", 20)
        frappe.db.set_value(
            "MSP Billing Run Line",
            {"parent": run},
            "amount",
            flt(
                frappe.db.get_value("MSP Billing Run Line", {"parent": run}, "gross_amount") * 0.8,
                2,
            ),
        )
        frappe.db.commit()

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled: the service was unusable in September.",
            include=[{"service_assignment": first, "from": "2026-09-01", "to": "2026-09-30"}],
        )
        self.track("MSP Billing Run", made["run"])

        line = frappe.get_doc("MSP Billing Run", made["run"]).lines[0]

        self.assertEqual(line.discount_percent, 20)
        # the net the invoice took, not the gross the price list says
        self.assertEqual(line.amount, flt(line.gross_amount * 0.8, 2))

    def test_days_the_line_was_never_billed_for_are_refused(self):
        """A run wider than its line: the days before the service started are not owed."""
        late = self.running(self.service, client_user=self.mary)
        frappe.db.set_value(
            "MSP Service Assignment", late, "effective_start_date", "2026-09-16"
        )
        frappe.db.commit()
        run = self.charge()

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="credit_note",
                contract=self.contract,
                against=run,
                scope="all",
                reason="Settled by agreement with the customer.",
                include=[{"service_assignment": late, "from": "2026-07-01", "to": "2026-07-31"}],
            )

    def test_a_window_overlapping_what_was_billed_is_cut_to_it(self):
        late = self.running(self.service, client_user=self.mary)
        frappe.db.set_value(
            "MSP Service Assignment", late, "effective_start_date", "2026-09-16"
        )
        frappe.db.commit()
        run = self.charge()

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=[{"service_assignment": late, "from": "2026-09-01", "to": "2026-09-30"}],
        )
        self.track("MSP Billing Run", made["run"])

        line = frappe.get_doc("MSP Billing Run", made["run"]).lines[0]

        self.assertEqual(getdate(line.covered_from), getdate("2026-09-16"))
        self.assertEqual(getdate(line.covered_to), getdate("2026-09-30"))

    def test_a_line_of_another_charge_is_refused(self):
        self.billed_ahead()
        run = self.charge()
        stranger = self.running(self.service, client_user=self.mary)

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="credit_note",
                contract=self.contract,
                against=run,
                scope="all",
                reason="Settled by agreement with the customer.",
                include=[
                    {"service_assignment": stranger, "from": "2026-09-01", "to": "2026-09-30"}
                ],
            )


class TestWhatTheReturnDocumentCarries(CreditCase):
    """The return posts the net the charge took, never the list price."""

    def discounted_charge(self, percent):
        assignment = self.billed_ahead()
        run = self.drawn(start=self.START, end=self.END)
        BillingService.set_line_discount(
            name=run, service_assignment=assignment, discount_percent=percent
        )
        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)

        return run, assignment

    def test_the_erpnext_return_carries_the_original_discount(self):
        run, assignment = self.discounted_charge(20)

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=[{"service_assignment": assignment, "from": "2026-09-01", "to": "2026-09-30"}],
        )
        self.track("MSP Billing Run", made["run"])

        note = frappe.get_doc("MSP Billing Run", made["run"])
        document = frappe.get_doc("Sales Invoice", note.sales_invoice)
        item = document.items[0]

        self.assertEqual(flt(item.discount_percentage), 20)
        # the net rate, so the return never gives back more than the invoice took
        self.assertEqual(flt(item.rate, 2), flt(flt(item.price_list_rate) * 0.8, 2))

    def test_the_document_total_matches_the_run_total(self):
        run, assignment = self.discounted_charge(20)

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=[{"service_assignment": assignment, "from": "2026-09-01", "to": "2026-09-30"}],
        )
        self.track("MSP Billing Run", made["run"])

        note = frappe.get_doc("MSP Billing Run", made["run"])
        document = frappe.get_doc("Sales Invoice", note.sales_invoice)

        self.assertEqual(flt(document.net_total, 2), flt(note.total_amount, 2))


class TestTheDetectedCreditGoesThroughThePreview(CreditCase):
    """The step that prices a credit must accept the proposal as it was detected."""

    def test_a_detected_line_is_priced_by_name(self):
        first = self.billed_ahead()
        run = self.charge()
        self.stops(first, "2026-09-24")

        priced = wizard.credit_preview(contract=self.contract, against=run, include=[first])

        self.assertEqual(len(priced["lines"]), 1)
        self.assertEqual(priced["lines"][0]["service_assignment"], first)
        self.assertLess(priced["total"], 0)

    def test_the_preview_prices_what_the_creation_writes(self):
        first = self.billed_ahead()
        run = self.charge()
        self.stops(first, "2026-09-24")

        priced = wizard.credit_preview(contract=self.contract, against=run, include=[first])
        made = wizard.create(
            kind="credit_note", contract=self.contract, against=run, include=[first]
        )
        self.track("MSP Billing Run", made["run"])

        note = frappe.get_doc("MSP Billing Run", made["run"])

        self.assertEqual(flt(priced["total"], 2), flt(note.total_amount, 2))

    def test_an_operator_cut_is_priced_on_the_days_given(self):
        first = self.billed_ahead()
        run = self.charge()

        whole = wizard.credit_preview(
            contract=self.contract,
            against=run,
            scope="all",
            include=[{"service_assignment": first, "from": "2026-09-01", "to": "2026-09-30"}],
        )
        shorter = wizard.credit_preview(
            contract=self.contract,
            against=run,
            scope="all",
            include=[{"service_assignment": first, "from": "2026-09-05", "to": "2026-09-13"}],
        )

        self.assertGreater(abs(whole["total"]), abs(shorter["total"]))


class TestTheReturnPostsWhereTheChargePosted(CreditCase):
    def credited(self):
        assignment = self.billed_ahead()
        run = self.charge()
        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=[{"service_assignment": assignment, "from": "2026-09-01", "to": "2026-09-30"}],
        )
        self.track("MSP Billing Run", made["run"])
        note = frappe.get_doc("MSP Billing Run", made["run"])
        original = frappe.db.get_value("MSP Billing Run", run, "sales_invoice")

        return frappe.get_doc("Sales Invoice", original), frappe.get_doc(
            "Sales Invoice", note.sales_invoice
        )

    def test_it_carries_the_cost_centre_of_the_charge(self):
        charge, back = self.credited()

        self.assertEqual(back.cost_center or back.items[0].cost_center,
                         charge.cost_center or charge.items[0].cost_center)

    def test_it_carries_the_rate_the_charge_was_converted_at(self):
        charge, back = self.credited()

        self.assertEqual(flt(back.conversion_rate), flt(charge.conversion_rate))

    def test_each_credited_service_answers_its_own_line_of_the_charge(self):
        """Two services on one invoice, each with its own cost centre: each goes back home."""
        first = self.billed_ahead()
        other = self.offering("WCR2")
        second = self.running(other, client_user=self.mary)
        frappe.db.set_value(
            "MSP Service Assignment", second, "effective_start_date", "2023-01-01"
        )
        frappe.db.commit()
        run = self.charge()
        charge = frappe.get_doc(
            "Sales Invoice", frappe.db.get_value("MSP Billing Run", run, "sales_invoice")
        )
        centres = {row.item_code: row.cost_center for row in charge.items}

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=[
                {"service_assignment": first, "from": "2026-09-01", "to": "2026-09-30"},
                {"service_assignment": second, "from": "2026-09-01", "to": "2026-09-30"},
            ],
        )
        self.track("MSP Billing Run", made["run"])

        back = frappe.get_doc(
            "Sales Invoice",
            frappe.db.get_value("MSP Billing Run", made["run"], "sales_invoice"),
        )

        for row in back.items:
            self.assertEqual(row.cost_center, centres.get(row.item_code))

    def test_it_stands_against_the_charge_it_answers(self):
        charge, back = self.credited()

        self.assertEqual(back.return_against, charge.name)
        self.assertEqual(back.is_return, 1)


class TestACreditAnswersTheLineItWasBilledOn(CreditCase):
    """A charge can carry the same service twice, at two rates. A credit answers one."""

    def two_rates(self):
        assignment = self.billed_ahead()
        # the price changes inside the quarter, so the engine draws two lines for it
        self.price(self.service, 6000.0, valid_from="2026-09-01")
        run = self.drawn(start=self.START, end=self.END)
        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)

        return run, assignment

    def test_the_charge_really_carries_two_lines_for_it(self):
        run, assignment = self.two_rates()

        lines = [
            line
            for line in BillingService.creditable_lines(run)["lines"]
            if line["service_assignment"] == assignment
        ]

        self.assertEqual(len(lines), 2)
        self.assertNotEqual(lines[0]["unit_rate"], lines[1]["unit_rate"])

    def test_a_credit_is_cut_on_the_stretch_its_days_fall_in(self):
        run, assignment = self.two_rates()
        lines = [
            line
            for line in BillingService.creditable_lines(run)["lines"]
            if line["service_assignment"] == assignment
        ]
        later = max(lines, key=lambda line: getdate(line["covered_from"]))

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=[
                {
                    "service_assignment": assignment,
                    "from": str(later["covered_from"]),
                    "to": str(later["covered_to"]),
                }
            ],
        )
        self.track("MSP Billing Run", made["run"])

        credited = frappe.get_doc("MSP Billing Run", made["run"]).lines

        self.assertEqual(len(credited), 1)
        self.assertEqual(flt(credited[0].unit_rate), flt(later["unit_rate"]))

    def test_crediting_one_stretch_leaves_the_other_creditable(self):
        run, assignment = self.two_rates()
        lines = [
            line
            for line in BillingService.creditable_lines(run)["lines"]
            if line["service_assignment"] == assignment
        ]
        first = min(lines, key=lambda line: getdate(line["covered_from"]))
        later = max(lines, key=lambda line: getdate(line["covered_from"]))

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=[
                {
                    "service_assignment": assignment,
                    "from": str(later["covered_from"]),
                    "to": str(later["covered_to"]),
                }
            ],
        )
        self.track("MSP Billing Run", made["run"])

        again = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=[
                {
                    "service_assignment": assignment,
                    "from": str(first["covered_from"]),
                    "to": str(first["covered_to"]),
                }
            ],
        )
        self.track("MSP Billing Run", again["run"])

        credited = frappe.get_doc("MSP Billing Run", again["run"]).lines

        self.assertEqual(len(credited), 1)
        self.assertEqual(flt(credited[0].unit_rate), flt(first["unit_rate"]))

    def test_the_same_stretch_is_still_refused_twice(self):
        run, assignment = self.two_rates()
        lines = [
            line
            for line in BillingService.creditable_lines(run)["lines"]
            if line["service_assignment"] == assignment
        ]
        later = max(lines, key=lambda line: getdate(line["covered_from"]))
        asked = [
            {
                "service_assignment": assignment,
                "from": str(later["covered_from"]),
                "to": str(later["covered_to"]),
            }
        ]

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=asked,
        )
        self.track("MSP Billing Run", made["run"])

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="credit_note",
                contract=self.contract,
                against=run,
                scope="all",
                reason="Settled by agreement with the customer.",
                include=asked,
            )

    def test_the_credited_stretches_are_written_down(self):
        first = self.billed_ahead()
        run = self.charge()

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=[{"service_assignment": first, "from": "2026-09-05", "to": "2026-09-13"}],
        )
        self.track("MSP Billing Run", made["run"])

        line = frappe.get_doc("MSP Billing Run", made["run"]).lines[0]

        self.assertTrue(line.billable_segments_json)
        self.assertEqual(
            frappe.parse_json(line.billable_segments_json),
            [{"from": "2026-09-05", "to": "2026-09-13"}],
        )


class TestOnlyTheFigureThatWasReviewedIsWritten(CreditCase):
    def test_a_credit_matching_what_was_reviewed_goes_through(self):
        first = self.billed_ahead()
        run = self.charge()
        asked = [{"service_assignment": first, "from": "2026-09-05", "to": "2026-09-13"}]
        priced = wizard.credit_preview(
            contract=self.contract, against=run, scope="all", include=asked
        )

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=asked,
            expected_total=priced["total"],
        )
        self.track("MSP Billing Run", made["run"])

        self.assertTrue(frappe.db.exists("MSP Billing Run", made["run"]))

    def test_a_credit_worth_something_else_is_refused(self):
        first = self.billed_ahead()
        run = self.charge()

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="credit_note",
                contract=self.contract,
                against=run,
                scope="all",
                reason="Settled by agreement with the customer.",
                include=[{"service_assignment": first, "from": "2026-09-05", "to": "2026-09-13"}],
                expected_total=-1.0,
            )


class TestACreditThatStraddlesTwoRates(CreditCase):
    """Days asked for across a price change are cut, each part at the rate it was billed."""

    def two_rates(self):
        assignment = self.billed_ahead()
        self.price(self.service, 6000.0, valid_from="2026-09-01")
        run = self.drawn(start=self.START, end=self.END)
        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)

        return run, assignment

    def test_one_request_produces_one_credit_line_per_rate(self):
        run, assignment = self.two_rates()

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=[
                {"service_assignment": assignment, "from": "2026-08-20", "to": "2026-09-10"}
            ],
        )
        self.track("MSP Billing Run", made["run"])

        lines = frappe.get_doc("MSP Billing Run", made["run"]).lines

        self.assertEqual(len(lines), 2)
        self.assertEqual(len({flt(line.unit_rate) for line in lines}), 2)

    def test_each_part_keeps_the_days_it_was_billed_over(self):
        run, assignment = self.two_rates()

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            reason="Settled by agreement with the customer.",
            include=[
                {"service_assignment": assignment, "from": "2026-08-20", "to": "2026-09-10"}
            ],
        )
        self.track("MSP Billing Run", made["run"])

        for line in frappe.get_doc("MSP Billing Run", made["run"]).lines:
            self.assertGreaterEqual(getdate(line.covered_from), getdate("2026-08-20"))
            self.assertLessEqual(getdate(line.covered_to), getdate("2026-09-10"))

    def test_the_preview_prices_both_parts(self):
        run, assignment = self.two_rates()
        asked = [{"service_assignment": assignment, "from": "2026-08-20", "to": "2026-09-10"}]

        priced = wizard.credit_preview(
            contract=self.contract, against=run, scope="all", include=asked
        )

        self.assertEqual(len(priced["lines"]), 2)

    def test_a_service_that_stops_owes_only_the_line_that_billed_those_days(self):
        """The July–August line never billed 25–30 September, so it owes nothing for them."""
        run, assignment = self.two_rates()
        self.stops(assignment, "2026-09-24")

        owing = [
            line
            for line in BillingService.creditable_lines(run)["lines"]
            if line["service_assignment"] == assignment and line.get("owed_back")
        ]

        self.assertEqual(len(owing), 1)
        self.assertEqual(getdate(owing[0]["owed_back"]["unused_from"]), getdate("2026-09-25"))


class TestWhatIsLeftToGiveBack(CreditCase):
    """A proposal answers what is still owed, never what was once owed."""

    def test_a_partial_credit_shrinks_the_proposal(self):
        first = self.billed_ahead()
        run = self.charge()
        self.stops(first, "2026-09-24")

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            include=[{"service_assignment": first, "from": "2026-09-25", "to": "2026-09-27"}],
        )
        self.track("MSP Billing Run", made["run"])

        left = next(
            line["owed_back"]
            for line in BillingService.creditable_lines(run)["lines"]
            if line["service_assignment"] == first
        )

        self.assertEqual(getdate(left["unused_from"]), getdate("2026-09-28"))
        self.assertEqual(getdate(left["unused_to"]), getdate("2026-09-30"))

    def test_a_full_credit_leaves_nothing_to_propose(self):
        first = self.billed_ahead()
        run = self.charge()
        self.stops(first, "2026-09-24")

        made = wizard.create(
            kind="credit_note", contract=self.contract, against=run, include=[first]
        )
        self.track("MSP Billing Run", made["run"])

        line = next(
            entry
            for entry in BillingService.creditable_lines(run)["lines"]
            if entry["service_assignment"] == first
        )

        self.assertIsNone(line["owed_back"])

    def test_the_detected_step_offers_nothing_once_it_is_all_back(self):
        first = self.billed_ahead()
        run = self.charge()
        self.stops(first, "2026-09-24")

        made = wizard.create(
            kind="credit_note", contract=self.contract, against=run, include=[first]
        )
        self.track("MSP Billing Run", made["run"])

        answer = wizard.services(kind="credit_note", contract=self.contract, against=run)

        self.assertEqual(answer["lines"], [])


class TestADisputeIsNotATermination(CreditCase):
    """Days that were served can still be given back, when somebody decides to."""

    def test_served_days_can_be_credited_when_the_operator_settles_a_dispute(self):
        first = self.billed_ahead()
        run = self.charge()
        self.stops(first, "2026-09-24")

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            scope="all",
            include=[{"service_assignment": first, "from": "2026-09-01", "to": "2026-09-15"}],
            reason="Settled: the service was unusable in the first half of September.",
        )
        self.track("MSP Billing Run", made["run"])

        line = frappe.get_doc("MSP Billing Run", made["run"]).lines[0]

        self.assertEqual(getdate(line.covered_from), getdate("2026-09-01"))
        self.assertEqual(getdate(line.covered_to), getdate("2026-09-15"))

    def test_the_detected_path_still_only_gives_back_unserved_days(self):
        first = self.billed_ahead()
        run = self.charge()
        self.stops(first, "2026-09-24")

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="credit_note",
                contract=self.contract,
                against=run,
                include=[
                    {"service_assignment": first, "from": "2026-09-01", "to": "2026-09-15"}
                ],
            )

    def test_a_settled_dispute_still_cannot_exceed_what_was_billed(self):
        first = self.billed_ahead()
        run = self.charge()

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="credit_note",
                contract=self.contract,
                against=run,
                scope="all",
                include=[
                    {"service_assignment": first, "from": "2026-10-01", "to": "2026-10-15"}
                ],
            )


class TestWhatIsLeftEitherSideOfACredit(CreditCase):
    """Two days credited in the middle leave two stretches, not one wide window."""

    def remaining(self, run, assignment):
        return next(
            line["owed_back"]
            for line in BillingService.creditable_lines(run)["lines"]
            if line["service_assignment"] == assignment
        )

    def test_crediting_the_middle_leaves_two_stretches(self):
        first = self.billed_ahead()
        run = self.charge()
        self.stops(first, "2026-09-24")

        made = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            include=[{"service_assignment": first, "from": "2026-09-27", "to": "2026-09-28"}],
        )
        self.track("MSP Billing Run", made["run"])

        left = self.remaining(run, first)

        self.assertEqual(
            left["segments"],
            [{"from": "2026-09-25", "to": "2026-09-26"}, {"from": "2026-09-29", "to": "2026-09-30"}],
        )

    def test_the_rest_can_be_given_back_in_one_go(self):
        first = self.billed_ahead()
        run = self.charge()
        self.stops(first, "2026-09-24")

        middle = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            include=[{"service_assignment": first, "from": "2026-09-27", "to": "2026-09-28"}],
        )
        self.track("MSP Billing Run", middle["run"])

        rest = wizard.create(
            kind="credit_note", contract=self.contract, against=run, include=[first]
        )
        self.track("MSP Billing Run", rest["run"])

        line = frappe.get_doc("MSP Billing Run", rest["run"]).lines[0]

        self.assertEqual(
            frappe.parse_json(line.billable_segments_json),
            [{"from": "2026-09-25", "to": "2026-09-26"}, {"from": "2026-09-29", "to": "2026-09-30"}],
        )

    def test_nothing_is_proposed_once_both_sides_are_back(self):
        first = self.billed_ahead()
        run = self.charge()
        self.stops(first, "2026-09-24")

        middle = wizard.create(
            kind="credit_note",
            contract=self.contract,
            against=run,
            include=[{"service_assignment": first, "from": "2026-09-27", "to": "2026-09-28"}],
        )
        self.track("MSP Billing Run", middle["run"])
        rest = wizard.create(
            kind="credit_note", contract=self.contract, against=run, include=[first]
        )
        self.track("MSP Billing Run", rest["run"])

        self.assertEqual(
            wizard.services(kind="credit_note", contract=self.contract, against=run)["lines"],
            [],
        )


class TestTheDetectedModeIsAContract(CreditCase):
    def test_served_days_are_refused_even_when_nothing_was_detected(self):
        first = self.billed_ahead()
        run = self.charge()

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="credit_note",
                contract=self.contract,
                against=run,
                include=[
                    {"service_assignment": first, "from": "2026-09-01", "to": "2026-09-15"}
                ],
            )

    def test_an_unknown_scope_is_refused(self):
        first = self.billed_ahead()
        run = self.charge()

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="credit_note",
                contract=self.contract,
                against=run,
                scope="whatever",
                include=[first],
            )

    def test_a_commercial_credit_has_to_say_why(self):
        first = self.billed_ahead()
        run = self.charge()

        with self.assertRaises(ServiceRefused):
            wizard.create(
                kind="credit_note",
                contract=self.contract,
                against=run,
                scope="all",
                include=[
                    {"service_assignment": first, "from": "2026-09-01", "to": "2026-09-15"}
                ],
            )
