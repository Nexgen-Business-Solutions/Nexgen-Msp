"""Posting an invoice is one step, and a failed attempt leaves nothing half done.

Issue #16 asks for it in those words: no partial invoice, no duplicate on a retry, and a
failure for any other reason reported rather than swallowed. The run that broke carried 374
lines, so there is no room for a half-written one.
"""

from unittest.mock import patch

import frappe

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.utils import erpnext_bridge
from nexgen_msp.utils.errors import ValidationError as ServiceRefused

from .test_billing_history import BillingHistoryCase


class RetryCase(BillingHistoryCase):
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

    def invoices(self):
        return frappe.get_all(
            "Sales Invoice", filters={"customer": self.customer}, fields=["name", "docstatus"]
        )

    def run_of(self, suffix, people=1):
        service = self.offering(suffix)
        self.running(service, client_user=self.john)

        for index in range(people - 1):
            self.running(
                service,
                client_user=self.make_person(self.customer, f"Extra{index}"),
            )

        start, end = self.month()

        return self.drawn(start=start, end=end), start, end


class TestOneRunMakesOneInvoice(RetryCase):
    def test_a_run_of_several_lines_posts_a_single_invoice(self):
        run, _, _ = self.run_of("RETRYA", people=3)

        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)

        posted = self.invoices()
        self.assertEqual(len(posted), 1, posted)
        self.assertEqual(posted[0]["docstatus"], 1)
        self.assertEqual(
            len(frappe.get_doc("MSP Billing Run", run).lines), 3, "three lines, one invoice"
        )

    def test_posting_twice_is_refused_rather_than_doubled(self):
        run, _, _ = self.run_of("RETRYB")

        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)

        with self.assertRaises(ServiceRefused) as refusal:
            BillingService.submit_invoice(name=run, notify=0)

        self.assertIn("already submitted", str(refusal.exception))
        self.assertEqual(len(self.invoices()), 1)


class TestWhenPostingFails(RetryCase):
    def test_a_failure_leaves_the_draft_and_posts_nothing(self):
        run, _, _ = self.run_of("RETRYC")
        BillingService.finalise(run)

        with patch.object(erpnext_bridge, "submit", side_effect=RuntimeError("ERPNext said no")):
            with self.assertRaises(RuntimeError):
                BillingService.submit_invoice(name=run, notify=0)

        frappe.db.rollback()
        posted = self.invoices()

        self.assertEqual(len(posted), 1, "the draft is still the only one")
        self.assertEqual(posted[0]["docstatus"], 0, "and it is still a draft")
        self.assertEqual(
            frappe.db.get_value("MSP Billing Run", run, "status"), "Invoice Drafted"
        )

    def test_and_the_retry_afterwards_succeeds_without_duplicating(self):
        run, _, _ = self.run_of("RETRYD")
        BillingService.finalise(run)

        with patch.object(erpnext_bridge, "submit", side_effect=RuntimeError("ERPNext said no")):
            with self.assertRaises(RuntimeError):
                BillingService.submit_invoice(name=run, notify=0)

        frappe.db.rollback()
        BillingService.submit_invoice(name=run, notify=0)

        posted = self.invoices()
        self.assertEqual(len(posted), 1, posted)
        self.assertEqual(posted[0]["docstatus"], 1)
        self.assertEqual(frappe.db.get_value("MSP Billing Run", run, "status"), "Invoiced")

    def test_a_failure_for_another_reason_is_reported_in_its_own_words(self):
        """Not every refusal is about a date: whatever ERPNext says has to reach the screen."""
        run, _, _ = self.run_of("RETRYE")
        BillingService.finalise(run)

        with patch.object(
            BillingService,
            "_payment_terms_template",
            side_effect=RuntimeError("Payment Term is misconfigured"),
        ):
            with self.assertRaises(RuntimeError) as refusal:
                BillingService.submit_invoice(name=run, notify=0)

        self.assertIn("Payment Term is misconfigured", str(refusal.exception))

    def test_a_run_whose_invoice_cannot_be_drawn_is_not_left_frozen(self):
        """finalise is one step: freezing without an invoice would strand the run."""
        service = self.offering("RETRYF")
        self.running(service, client_user=self.john)
        start, end = self.month()
        run = self.drawn(start=start, end=end)

        with patch.object(
            BillingService, "create_invoice", side_effect=RuntimeError("no invoice today")
        ):
            with self.assertRaises(RuntimeError):
                BillingService.finalise(run)

        self.assertEqual(
            frappe.db.get_value("MSP Billing Run", run, "docstatus"),
            0,
            "the run is still open, not frozen with nothing to show",
        )
