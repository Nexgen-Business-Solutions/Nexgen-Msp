"""A credit is money going back, and every screen reads it the same way.

ERPNext stores what each document stores, so the direction is settled once on the way out:
a posted credit note deducts, a posted invoice adds, and the net of the two is what the
customer was really billed. Nothing here touches a posted document — the figures are read,
pointed the right way and handed on.
"""

import frappe

from nexgen_msp.api.internal.services import sales_invoice_service as invoices
from nexgen_msp.api.internal.services.billing import money, run_view, workspace
from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.api.portal.services.portal_service import PortalService

from .test_billing_history import BillingHistoryCase

RUN = "MSP Billing Run"
INVOICE = "Sales Invoice"


class SignCase(BillingHistoryCase):
    def setUp(self):
        super().setUp()
        self.service = self.offering("SGN")
        self.assignment = self.running(self.service, client_user=self.john)
        frappe.db.set_value("Customer", self.customer, "msp_last_billed_on", self.days_ago(400))
        frappe.db.commit()

    def charge(self, back=None):
        """A posted invoice of this customer's."""
        start, end = self.month(back=back) if back else self.month()
        run = self.drawn(start=start, end=end)
        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)

        return run

    def credit(self, charge, post=True):
        """A credit note that gives the whole of a posted charge back."""
        period = frappe.db.get_value(
            RUN, charge, ["billing_period_start", "billing_period_end"], as_dict=True
        )
        note = BillingService.create_credit_note(
            name=charge,
            reason="ZZTEST all of it back",
            lines=[
                {
                    "service_assignment": self.assignment,
                    "from": str(period.billing_period_start),
                    "to": str(period.billing_period_end),
                }
            ],
            only_unserved=False,
        )["name"]
        self.track(RUN, note)

        if post:
            BillingService.submit_invoice(name=note, notify=0)

        return note

    def listed_run(self, name):
        rows, _ = workspace._runs(search=name, status=None, page=1, page_length=20)

        return next(row for row in rows if row["name"] == name)

    def listed_invoice(self, name):
        rows, _ = workspace._invoices(search=name, status=None, page=1, page_length=20)

        return next(row for row in rows if row["name"] == name)

    def totals(self):
        return {row["currency"]: row["amount"] for row in workspace._figures()["invoiced_totals"]}


class TestTheOneRule(SignCase):
    def test_a_credit_deducts_and_a_charge_stands_as_recorded(self):
        self.assertEqual(money.signed(100, credit=False), 100)
        self.assertEqual(money.signed(100, credit=True), -100)

    def test_a_figure_already_negative_is_not_negated_twice(self):
        self.assertEqual(money.signed(-23.48, credit=True), -23.48)
        self.assertEqual(money.signed(-23.48, credit=False), -23.48)

    def test_two_currencies_stay_two_totals(self):
        totals = money.totals_by_currency([("USD", 100), ("XAF", 50000), ("USD", -23.48)])

        self.assertEqual(
            {row["currency"]: row["amount"] for row in totals},
            {"USD": 76.52, "XAF": 50000.0},
        )


class TestWhatTheHistoryShows(SignCase):
    def test_a_posted_charge_reads_positive_on_both_lists(self):
        run = self.charge()
        invoice = frappe.db.get_value(RUN, run, "sales_invoice")

        self.assertGreater(self.listed_run(run)["amount"], 0)
        self.assertFalse(self.listed_run(run)["is_credit_note"])
        self.assertGreater(self.listed_invoice(invoice)["amount"], 0)
        self.assertFalse(self.listed_invoice(invoice)["is_return"])

    def test_a_posted_credit_note_reads_negative_on_both_lists(self):
        charge = self.charge()
        note = self.credit(charge)
        document = frappe.db.get_value(RUN, note, "sales_invoice")
        row = self.listed_run(note)

        self.assertLess(row["amount"], 0, "a credit never reads as a charge")
        self.assertTrue(row["is_credit_note"])
        self.assertEqual(row["kind"], "Credit note", "what it is, beside what state it is in")
        self.assertEqual(row["status"], "Invoiced")

        document_row = self.listed_invoice(document)

        self.assertLess(document_row["amount"], 0)
        self.assertTrue(document_row["is_return"])

    def test_the_two_lists_point_the_same_way_for_the_same_money(self):
        charge = self.charge()
        note = self.credit(charge)

        for name in (charge, note):
            document = frappe.db.get_value(RUN, name, "sales_invoice")
            run_amount = self.listed_run(name)["amount"]
            document_amount = self.listed_invoice(document)["amount"]

            self.assertEqual(
                run_amount < 0,
                document_amount < 0,
                f"{name} and {document} must not disagree about which way the money goes",
            )

    def test_a_credit_note_is_obvious_without_opening_it(self):
        note = self.credit(self.charge())
        row = self.listed_run(note)
        document = self.listed_invoice(frappe.db.get_value(RUN, note, "sales_invoice"))

        self.assertEqual(row["kind"], "Credit note")
        self.assertTrue(document["is_return"])

    def test_the_run_page_and_its_export_read_the_same_way(self):
        note = self.credit(self.charge())
        view = run_view.run_view(note)
        exported = BillingService.breakdown(note)

        self.assertLess(view["figures"]["amount"], 0)
        self.assertEqual(view["kind"], "Credit note")
        self.assertLess(exported["total_amount"], 0, "the file the customer reconciles against")
        self.assertTrue(all(row["amount"] <= 0 for row in exported["summary"]))


class TestWhatWasReallyBilled(SignCase):
    def test_a_credit_comes_off_the_invoiced_total_rather_than_adding_to_it(self):
        charge = self.charge()
        currency = frappe.db.get_value(RUN, charge, "currency")
        charged = frappe.utils.flt(frappe.db.get_value(RUN, charge, "total_amount"), 2)
        before = self.totals().get(currency, 0)

        note = self.credit(charge)
        credited = abs(frappe.utils.flt(frappe.db.get_value(RUN, note, "total_amount"), 2))
        after = self.totals().get(currency, 0)

        self.assertEqual(
            frappe.utils.flt(before - after, 2),
            credited,
            "the credit is taken off, never added on",
        )
        self.assertEqual(credited, charged, "and all of this charge was given back")

    def test_a_cancelled_credit_note_counts_for_nothing(self):
        charge = self.charge()
        currency = frappe.db.get_value(RUN, charge, "currency")
        note = self.credit(charge)
        credited = abs(frappe.utils.flt(frappe.db.get_value(RUN, note, "total_amount"), 2))
        with_credit = self.totals().get(currency, 0)

        BillingService.cancel(name=note, reason="ZZTEST credited by mistake")
        without = self.totals().get(currency, 0)

        self.assertEqual(
            frappe.utils.flt(without - with_credit, 2),
            credited,
            "undoing a credit puts exactly that charge back, and nothing else",
        )

    def test_a_credit_still_only_drafted_is_not_counted_as_posted(self):
        charge = self.charge()
        currency = frappe.db.get_value(RUN, charge, "currency")
        posted = self.totals().get(currency, 0)

        self.credit(charge, post=False)

        self.assertEqual(
            self.totals().get(currency, 0),
            posted,
            "nothing is netted off until the document is posted",
        )

    def test_what_was_posted_moves_the_total_and_what_is_only_pending_does_not(self):
        start, end = self.month()
        drawn = self.drawn(start=start, end=end)
        currency = frappe.db.get_value(RUN, drawn, "currency")
        charged = frappe.utils.flt(frappe.db.get_value(RUN, drawn, "total_amount"), 2)
        before = self.totals().get(currency, 0)

        BillingService.finalise(drawn)

        self.assertEqual(
            self.totals().get(currency, 0), before, "a drafted invoice is not a posted one"
        )

        BillingService.submit_invoice(name=drawn, notify=0)
        posted = self.totals().get(currency, 0)

        self.assertEqual(frappe.utils.flt(posted - before, 2), charged)

        self.credit(drawn, post=False)

        self.assertEqual(
            self.totals().get(currency, 0), posted, "a credit nobody posted nets nothing off"
        )


class TestTheTwoAmountsAreNotTheSame(SignCase):
    def test_the_run_keeps_its_own_figure_and_the_document_its_own(self):
        run = self.charge()
        view = run_view.run_view(run)
        reconciliation = view["reconciliation"]
        invoice = frappe.db.get_value(
            INVOICE,
            view["sales_invoice"],
            ["net_total", "grand_total", "total_taxes_and_charges", "currency"],
            as_dict=True,
        )

        self.assertEqual(reconciliation["run_amount"], frappe.utils.flt(view["total_amount"], 2))
        self.assertEqual(reconciliation["net_total"], frappe.utils.flt(invoice.net_total, 2))
        self.assertEqual(reconciliation["taxes"], frappe.utils.flt(invoice.total_taxes_and_charges, 2))
        self.assertEqual(reconciliation["currency"], invoice.currency)
        self.assertIn("before taxes", reconciliation["basis"])
        self.assertFalse(reconciliation["material"])

    def test_an_edit_in_the_ledger_shows_up_as_a_difference_and_rewrites_nothing(self):
        start, end = self.month()
        run = self.drawn(start=start, end=end)
        BillingService.finalise(run)
        invoice = frappe.db.get_value(RUN, run, "sales_invoice")
        original = frappe.utils.flt(frappe.db.get_value(RUN, run, "total_amount"), 2)

        doc = frappe.get_doc(INVOICE, invoice)
        doc.flags.ignore_permissions = True
        doc.items[0].rate = frappe.utils.flt(doc.items[0].rate) - 5
        doc.set_posting_time = 1
        doc.save()
        doc.submit()

        view = run_view.run_view(run)

        self.assertEqual(frappe.utils.flt(view["total_amount"], 2), original)
        self.assertTrue(view["reconciliation"]["material"])
        self.assertLess(view["reconciliation"]["difference"], 0)
        self.assertEqual(view["status"], "Invoiced", "an edited document is still a posted one")

    def test_a_credit_notes_two_amounts_both_read_as_deductions(self):
        note = self.credit(self.charge())
        reconciliation = run_view.run_view(note)["reconciliation"]

        self.assertLess(reconciliation["run_amount"], 0)
        self.assertLess(reconciliation["net_total"], 0)
        self.assertLess(reconciliation["grand_total"], 0)


class TestNothingIsRewritten(SignCase):
    def test_reading_the_history_leaves_every_document_exactly_as_it_was(self):
        charge = self.charge()
        note = self.credit(charge)
        documents = {
            name: frappe.db.get_value(
                INVOICE,
                frappe.db.get_value(RUN, name, "sales_invoice"),
                ["docstatus", "grand_total", "net_total", "is_return", "modified"],
                as_dict=True,
            )
            for name in (charge, note)
        }

        workspace.workspace()
        workspace.workspace(tab="invoices")
        run_view.run_view(charge)
        run_view.run_view(note)
        invoices.list_invoices(customer=self.customer)
        invoices.invoice_detail(frappe.db.get_value(RUN, note, "sales_invoice"))

        for name, before in documents.items():
            self.assertEqual(
                frappe.db.get_value(
                    INVOICE,
                    frappe.db.get_value(RUN, name, "sales_invoice"),
                    ["docstatus", "grand_total", "net_total", "is_return", "modified"],
                    as_dict=True,
                ),
                before,
                f"the document behind {name} was not touched by reading it",
            )

    def test_one_document_is_never_counted_twice(self):
        charge = self.charge()
        note = self.credit(charge)
        rows, total = workspace._runs(search=None, status="posted", page=1, page_length=100)
        posted = [row["name"] for row in rows]

        self.assertEqual(len(posted), len(set(posted)))
        self.assertIn(charge, posted)
        self.assertIn(note, posted)

        documents = [row["sales_invoice"] for row in rows if row["sales_invoice"]]

        self.assertEqual(len(documents), len(set(documents)), "two runs never share a document")


class TestTheInvoiceItself(SignCase):
    def test_a_credit_note_detail_reads_as_a_deduction_throughout(self):
        note = self.credit(self.charge())
        document = frappe.db.get_value(RUN, note, "sales_invoice")
        read = invoices.invoice_detail(document)

        self.assertTrue(read["is_credit_note"])
        self.assertLess(read["signed_total"], 0)
        self.assertLess(read["signed_net_total"], 0)
        self.assertEqual(read["billing_run"], note)
        self.assertEqual(read["origin"], "MSP")
        self.assertEqual(
            read["grand_total"],
            frappe.db.get_value(INVOICE, document, "grand_total"),
            "what ERPNext stores is still said as ERPNext stores it",
        )

    def test_a_plain_invoice_detail_reads_as_a_charge(self):
        run = self.charge()
        read = invoices.invoice_detail(frappe.db.get_value(RUN, run, "sales_invoice"))

        self.assertFalse(read["is_credit_note"])
        self.assertGreater(read["signed_total"], 0)
        self.assertGreater(read["signed_net_total"], 0)


class TestWhatTheCustomerSees(SignCase):
    """The company's own reading of its history: a credit is money coming back to them."""

    def setUp(self):
        super().setUp()
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"sg{self.tag[:3]}"
        )

    def as_manager(self, call):
        frappe.set_user(self.manager)
        frappe.clear_cache(user=self.manager)
        try:
            return call()
        finally:
            frappe.set_user("Administrator")

    def test_the_portal_history_reads_a_credit_as_a_deduction_and_names_it(self):
        charge = self.charge()
        note = self.credit(charge)
        rows = {row["name"]: row for row in self.as_manager(lambda: PortalService.list_billing(self.customer))}

        self.assertFalse(rows[charge]["is_credit_note"])
        self.assertGreater(rows[charge]["signed_amount"], 0)
        self.assertTrue(rows[note]["is_credit_note"])
        self.assertLess(rows[note]["signed_amount"], 0)

    def test_the_portal_detail_of_a_credit_says_which_way_the_money_went(self):
        note = self.credit(self.charge())
        read = self.as_manager(lambda: PortalService.get_billing_detail(note))

        self.assertTrue(read["run"]["is_credit_note"])
        self.assertLess(read["run"]["signed_amount"], 0)
        self.assertEqual(
            read["run"]["total_amount"],
            frappe.db.get_value(RUN, note, "total_amount"),
            "the stored figure is still said as it is stored",
        )
