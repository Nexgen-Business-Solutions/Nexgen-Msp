"""The invoices the accounting desk holds, whether this application drew them or not.

Most of what a customer was charged before this application existed carries no billing
run, and was therefore invisible here. Reading them is the point of the second tab; the
rules are that nothing is invented about them, and that nobody sees a document of a
company they may not act for.
"""

import frappe

from nexgen_msp.api.internal.services import sales_invoice_service as invoices
from nexgen_msp.utils.errors import NotFoundError, ValidationError as ServiceRefused

from .test_billing_history import BillingHistoryCase


class InvoiceCase(BillingHistoryCase):
    def an_invoice(self, customer=None, is_return=0, total=1000.0):
        """A posted invoice written straight in the desk, with no run behind it."""
        company = frappe.defaults.get_global_default("company")
        doc = frappe.get_doc(
            {
                "doctype": "Sales Invoice",
                "company": company,
                "customer": customer or self.customer,
                "posting_date": "2026-08-31",
                "set_posting_time": 1,
                "due_date": "2026-09-30",
                "is_return": is_return,
                "items": [
                    {
                        "item_code": self.offering("INV"),
                        "qty": -1 if is_return else 1,
                        "rate": total,
                        "income_account": frappe.db.get_value(
                            "Company", company, "default_income_account"
                        ),
                    }
                ],
            }
        )
        doc.flags.ignore_permissions = True
        doc.insert(ignore_permissions=True)
        self.track("Sales Invoice", doc.name)

        return doc.name


class TestReadingTheDesk(InvoiceCase):
    def test_an_invoice_with_no_run_is_listed(self):
        name = self.an_invoice()

        rows = invoices.list_invoices(customer=self.customer)["rows"]

        found = next(row for row in rows if row["name"] == name)
        self.assertEqual(found["origin"], "ERPNext")
        self.assertIsNone(found["billing_run"], "nothing invents a run to explain it")

    def test_an_invoice_a_run_drew_says_so(self):
        self.running(self.offering("RUN"), client_user=self.john)
        start, end = self.month()
        run = self.drawn(start=start, end=end)
        from nexgen_msp.api.internal.services.billing_service import BillingService

        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)
        invoice = frappe.db.get_value("MSP Billing Run", run, "sales_invoice")

        rows = invoices.list_invoices(customer=self.customer)["rows"]
        found = next(row for row in rows if row["name"] == invoice)

        self.assertEqual(found["origin"], "MSP")
        self.assertEqual(found["billing_run"], run)

    def test_the_detail_carries_the_document_and_nothing_else(self):
        name = self.an_invoice(total=1234.0)

        card = invoices.invoice_detail(name)

        self.assertEqual(card["customer"], self.customer)
        self.assertEqual(len(card["items"]), 1)
        self.assertEqual(card["items"][0]["rate"], 1234.0)
        self.assertIsNone(card["billing_run"])
        self.assertEqual(card["returns"], [])

    def test_a_search_narrows_the_list(self):
        name = self.an_invoice()

        rows = invoices.list_invoices(search=name)["rows"]

        self.assertEqual([row["name"] for row in rows], [name])

    def test_credit_notes_can_be_asked_for_on_their_own(self):
        self.an_invoice()

        rows = invoices.list_invoices(customer=self.customer, kind="returns")["rows"]

        self.assertEqual(rows, [], "no return was written for this company")


class TestWhatMustNotLeak(InvoiceCase):
    def test_a_company_the_reader_may_not_act_for_is_refused(self):
        with self.assertRaisesRegex(ServiceRefused, "not a company you act for"):
            invoices.list_invoices(customer="NO SUCH COMPANY")

    def test_an_invoice_that_cannot_be_reached_reads_as_missing(self):
        """Saying "not permitted" would already say that it exists."""
        with self.assertRaises(NotFoundError):
            invoices.invoice_detail("SINV-NOT-A-DOCUMENT")

    def test_a_customer_account_cannot_read_the_desk_at_all(self):
        account = self.make_account(
            "customer", "MSP Customer Manager", customer=self.customer, suffix=f"inv{self.tag}"
        )
        self.addCleanup(frappe.set_user, "Administrator")
        frappe.set_user(account)

        with self.assertRaises(Exception):
            invoices.list_invoices()
