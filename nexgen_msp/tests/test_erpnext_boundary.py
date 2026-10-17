"""Everything we hand ERPNext, in the shape ERPNext asks for.

A document read back from the database carries its dates as `datetime.date`. ERPNext's own
helpers are annotated for `str`, and Frappe enforces those annotations inside a request, so
on 15 October 2026 an upgrade turned a value that had travelled for a year into a refusal
and invoice posting stopped. Nothing of ours had changed.

These tests hold the boundary from both sides: the shape we produce, and a run that really
reaches the ledger — the second is the one that would have said so the next morning.
"""

import datetime
import inspect

import frappe
from frappe.utils import add_days, getdate

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.utils import erpnext_bridge

from .base import MSPTestCase
from .test_billing_history import BillingHistoryCase


class TestTheShapeWeProduce(MSPTestCase):
    def test_a_date_object_becomes_an_iso_string(self):
        self.assertEqual(
            erpnext_bridge.as_date_string(datetime.date(2026, 10, 1)), "2026-10-01"
        )

    def test_a_string_already_in_shape_survives_it(self):
        self.assertEqual(erpnext_bridge.as_date_string("2026-10-01"), "2026-10-01")

    def test_nothing_stays_nothing_and_never_becomes_the_word(self):
        self.assertIsNone(erpnext_bridge.as_date_string(None))
        self.assertIsNone(erpnext_bridge.as_date_string(""))

    def test_every_date_field_of_a_document_is_restated(self):
        invoice = frappe.new_doc("Sales Invoice")
        invoice.posting_date = datetime.date(2026, 10, 1)
        invoice.due_date = datetime.date(2026, 10, 31)

        erpnext_bridge.normalise_dates(invoice)

        self.assertEqual(invoice.posting_date, "2026-10-01")
        self.assertEqual(invoice.due_date, "2026-10-31")

    def test_a_field_that_carries_nothing_is_left_as_it_is(self):
        invoice = frappe.new_doc("Sales Invoice")
        invoice.posting_date = None

        erpnext_bridge.normalise_dates(invoice)

        self.assertIsNone(invoice.posting_date)


class TestTheRuleWeAreHeldTo(MSPTestCase):
    """ERPNext's own annotation is the rule; ours is only useful while it satisfies theirs."""

    def annotation(self):
        from erpnext.controllers.accounts_controller import get_payment_term_details

        return inspect.get_annotations(get_payment_term_details).get("posting_date")

    def test_what_we_produce_satisfies_what_erpnext_declares(self):
        declared = self.annotation()

        if declared is None:
            self.skipTest("ERPNext no longer annotates posting_date")

        from pydantic import TypeAdapter

        adapter = TypeAdapter(declared)
        ours = erpnext_bridge.as_date_string(datetime.date(2026, 10, 1))

        self.assertEqual(adapter.validate_python(ours), "2026-10-01")
        self.assertIsNone(adapter.validate_python(erpnext_bridge.as_date_string(None)))

    def test_the_raw_date_object_is_what_it_refuses(self):
        """Why the bridge exists, stated as the failure it prevents."""
        declared = self.annotation()

        if declared is None:
            self.skipTest("ERPNext no longer annotates posting_date")

        from pydantic import TypeAdapter

        with self.assertRaises(Exception):
            TypeAdapter(declared).validate_python(datetime.date(2026, 10, 1))


class TestAnInvoiceReallyReachesTheLedger(BillingHistoryCase):
    """The end-to-end run. It posts to the ledger, so it clears up after itself."""

    def tearDown(self):
        """Posting writes to the ledger, and the ledger does not roll back with the test.

        Order matters: the run points at the invoice, a submitted document refuses to be
        deleted, and the order it was drawn from holds it in turn. Each one is taken down on
        its own so that a single stubborn record cannot leave the rest behind.
        """
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
                    doc.flags.ignore_permissions = True

                    if doc.docstatus == 1:
                        doc.cancel()
                        frappe.db.commit()

                    frappe.delete_doc(
                        doctype, name, force=True, ignore_permissions=True, delete_permanently=True
                    )
                    frappe.db.commit()
                except Exception:
                    frappe.db.rollback()
                    # said out loud rather than swallowed: residue on a shared site is a
                    # finding, not a detail
                    print(f"  could not remove {doctype} {name}")

        super().tearDown()

    def posted(self):
        service = self.offering("BOUND")
        self.running(service, client_user=self.john)
        start, end = self.month()
        run = self.drawn(start=start, end=end)

        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)

        return run, frappe.get_doc(
            "Sales Invoice", frappe.db.get_value("MSP Billing Run", run, "sales_invoice")
        )

    def test_approve_and_invoice_completes_with_payment_terms(self):
        run, invoice = self.posted()

        self.assertEqual(invoice.docstatus, 1, "the invoice is posted")
        self.assertEqual(frappe.db.get_value("MSP Billing Run", run, "status"), "Invoiced")
        self.assertTrue(invoice.payment_terms_template, "the terms were applied")

    def test_the_due_date_follows_the_terms_and_not_the_posting_date(self):
        _, invoice = self.posted()

        self.assertEqual(
            getdate(invoice.due_date), add_days(getdate(invoice.posting_date), 30)
        )

    def test_the_posting_date_left_our_hands_as_a_string(self):
        """What the bridge is for, observed on the document that went through it."""
        _, invoice = self.posted()

        self.assertEqual(len(invoice.payment_schedule), 1)
        self.assertEqual(
            getdate(invoice.payment_schedule[0].due_date),
            add_days(getdate(invoice.posting_date), 30),
        )
