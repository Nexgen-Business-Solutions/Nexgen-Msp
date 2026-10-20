"""The one preparation path, and the three operations that stay apart on it.

Each step is asked for on its own: what the operation is about, which services it carries,
where it posts, and then the one call that prepares it. Nothing here submits a document.
"""

import frappe
from frappe.utils import getdate

from nexgen_msp.api.internal.services.billing import wizard
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

    def test_a_credit_with_nothing_charged_before_asks_for_the_coverage_first(self):
        answer = wizard.services(kind="credit_note", contract=self.contract)

        self.assertIsNone(answer["source_run"])
        self.assertEqual(answer["lines"], [])
        self.assertIn("record the past coverage", (answer["note"] or "").lower())


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
