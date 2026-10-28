"""Posting is shared with ERPNext; undoing a posting is not.

A document this application drew can be posted from either side, and the run it belongs to
has to say so whichever side did it. Cancelling is the other way round: ERPNext refuses to
cancel a document that belongs to a run, and the run cancels both at once or neither, so
there is never a cancelled document under a run that still counts it as billed.
"""

import frappe

from nexgen_msp.api.internal.services.billing import accounting, run_view
from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.utils.errors import NotFoundError, ValidationError as ServiceRefused

from .test_billing_history import BillingHistoryCase

RUN = "MSP Billing Run"
INVOICE = "Sales Invoice"


class CancellationCase(BillingHistoryCase):
    def setUp(self):
        super().setUp()
        self.service = self.offering("CAN")
        self.assignment = self.running(self.service, client_user=self.john)
        frappe.db.set_value("Customer", self.customer, "msp_last_billed_on", self.days_ago(400))
        frappe.db.commit()

    def approved(self, back=None):
        """A run frozen with its invoice drafted, which is where posting starts.

        Each run bills a month of its own: the same assignment cannot be billed twice for
        one period, which is the engine's own rule and not something to work around.
        """
        start, end = self.month(back=back) if back else self.month()
        run = self.drawn(start=start, end=end)
        BillingService.finalise(run)

        return run

    def posted(self, back=None):
        """A run whose invoice this application posted."""
        run = self.approved(back=back)
        BillingService.submit_invoice(name=run, notify=0)

        return run

    def credit_for(self, charge):
        """A credit note that gives the whole of a posted charge back."""
        period = frappe.db.get_value(
            RUN, charge, ["billing_period_start", "billing_period_end"], as_dict=True
        )
        note = BillingService.create_credit_note(
            name=charge,
            reason="ZZTEST credit",
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

        return note

    def invoice_of(self, run):
        return frappe.db.get_value(RUN, run, "sales_invoice")

    def docstatus_of(self, invoice):
        return frappe.db.get_value(INVOICE, invoice, "docstatus")

    def status_of(self, run):
        return frappe.db.get_value(RUN, run, "status")

    def cancel_in_erpnext(self, invoice):
        """What an accountant does in the Desk, through the document's own lifecycle."""
        doc = frappe.get_doc(INVOICE, invoice)
        doc.flags.ignore_permissions = True
        doc.cancel()


class TestWhoOwnsTheDocument(CancellationCase):
    def test_a_document_drawn_here_names_the_run_it_belongs_to(self):
        run = self.approved()
        invoice = self.invoice_of(run)

        self.assertEqual(accounting.runs_of(invoice), [run])
        self.assertEqual(accounting.owner_of(invoice), run)

    def test_a_document_nobody_here_drew_belongs_to_nobody(self):
        company = frappe.defaults.get_global_default("company")
        theirs = frappe.get_doc(
            {
                "doctype": INVOICE,
                "company": company,
                "customer": self.customer,
                "posting_date": self.today,
                "set_posting_time": 1,
                "due_date": self.today,
                "items": [
                    {
                        "item_code": self.service,
                        "qty": 1,
                        "rate": 100,
                        "income_account": frappe.db.get_value(
                            "Company", company, "default_income_account"
                        ),
                    }
                ],
            }
        )
        theirs.flags.ignore_permissions = True
        theirs.insert(ignore_permissions=True)
        self.track(INVOICE, theirs.name)

        self.assertEqual(accounting.runs_of(theirs.name), [])
        self.assertIsNone(accounting.owner_of(theirs.name))

    def test_two_runs_claiming_one_document_is_refused_rather_than_resolved(self):
        run = self.approved()
        invoice = self.invoice_of(run)
        other = self.approved(back=9)
        frappe.db.set_value(RUN, other, "sales_invoice", invoice)
        frappe.db.commit()

        with self.assertRaises(ServiceRefused) as refused:
            accounting.owner_of(invoice)

        self.assertEqual(refused.exception.code, "AMBIGUOUS_OWNER")

        # and nothing is cancelled on a link nobody has repaired
        with self.assertRaises(ServiceRefused):
            BillingService.cancel(name=run)

        self.assertNotEqual(self.status_of(run), "Cancelled")
        frappe.db.set_value(RUN, other, "sales_invoice", None)
        frappe.db.commit()


class TestPostingFromEitherSide(CancellationCase):
    def test_posting_in_erpnext_brings_the_run_with_it(self):
        run = self.approved()
        invoice = self.invoice_of(run)

        self.assertEqual(self.status_of(run), "Invoice Drafted")

        doc = frappe.get_doc(INVOICE, invoice)
        doc.flags.ignore_permissions = True
        doc.set_posting_time = 1
        doc.submit()

        self.assertEqual(self.status_of(run), "Invoiced")
        self.assertEqual(run_view.run_view(run)["stage"], 3)
        self.assertIsNone(run_view.run_view(run)["accounting_mismatch"])

    def test_posting_here_still_works_and_says_the_same_thing(self):
        run = self.posted()
        view = run_view.run_view(run)

        self.assertEqual(view["status"], "Invoiced")
        self.assertTrue(view["invoice_submitted"])
        self.assertEqual(view["accounting_state"], "Posted")
        self.assertIsNone(view["accounting_mismatch"])

    def test_a_credit_note_posted_in_erpnext_brings_its_run_with_it(self):
        charge = self.posted()
        credit = self.credit_for(charge)
        note = self.invoice_of(credit)

        self.assertTrue(note)
        self.assertEqual(self.status_of(credit), "Invoice Drafted")

        doc = frappe.get_doc(INVOICE, note)
        doc.flags.ignore_permissions = True
        doc.set_posting_time = 1
        doc.submit()

        self.assertEqual(self.status_of(credit), "Invoiced")

    def test_posting_in_erpnext_writes_to_nobody(self):
        run = self.approved()
        invoice = self.invoice_of(run)
        frappe.db.delete("Email Queue")

        doc = frappe.get_doc(INVOICE, invoice)
        doc.flags.ignore_permissions = True
        doc.set_posting_time = 1
        doc.submit()

        self.assertEqual(self.status_of(run), "Invoiced")
        self.assertEqual(
            frappe.db.count("Email Queue"),
            0,
            "the run is brought up to date; writing to the customer is somebody's decision",
        )

    def test_a_document_two_runs_claim_is_not_posted_by_a_guess(self):
        run = self.approved()
        invoice = self.invoice_of(run)
        other = self.approved(back=9)
        frappe.db.set_value(RUN, other, "sales_invoice", invoice, update_modified=False)
        frappe.db.commit()

        try:
            with self.assertRaises(frappe.ValidationError) as refused:
                doc = frappe.get_doc(INVOICE, invoice)
                doc.flags.ignore_permissions = True
                doc.submit()

            said = frappe.utils.strip_html(str(refused.exception))

            self.assertIn("claimed by more than one Billing Run", said)
            self.assertIn(run, said)
            self.assertIn(other, said)
            self.assertEqual(self.docstatus_of(invoice), 0, "nothing was posted")
            self.assertEqual(self.status_of(run), "Invoice Drafted")
            self.assertEqual(self.status_of(other), "Invoice Drafted")
        finally:
            frappe.db.set_value(RUN, other, "sales_invoice", None, update_modified=False)
            frappe.db.commit()

    def test_saying_it_twice_changes_nothing(self):
        run = self.posted()
        before = frappe.db.get_value(RUN, run, "modified")

        self.assertFalse(accounting.mark_posted(run), "a run already posted is left alone")
        self.assertEqual(frappe.db.get_value(RUN, run, "modified"), before)


class TestErpnextMayNotCancelOurDocument(CancellationCase):
    def test_cancelling_a_posted_invoice_in_erpnext_is_refused(self):
        run = self.posted()
        invoice = self.invoice_of(run)

        with self.assertRaises(frappe.ValidationError) as refused:
            self.cancel_in_erpnext(invoice)

        said = frappe.utils.strip_html(str(refused.exception))

        self.assertIn("Cancellation not allowed", said)
        self.assertIn(f"This invoice is linked to Billing Run {run}", said)
        self.assertIn("please cancel the Billing Run in Nexgen MSP", said)
        self.assertEqual(self.docstatus_of(invoice), 1, "the document is untouched")
        self.assertEqual(self.status_of(run), "Invoiced")

    def test_cancelling_a_posted_credit_note_in_erpnext_is_refused_as_a_credit_note(self):
        charge = self.posted()
        credit = self.credit_for(charge)
        BillingService.submit_invoice(name=credit, notify=0)
        note = self.invoice_of(credit)

        with self.assertRaises(frappe.ValidationError) as refused:
            self.cancel_in_erpnext(note)

        said = frappe.utils.strip_html(str(refused.exception))

        self.assertIn("Cancellation not allowed", said)
        self.assertIn(f"This credit note is linked to Billing Run {credit}", said)
        self.assertEqual(self.docstatus_of(note), 1)

    def test_the_refusal_names_the_run_the_document_actually_belongs_to(self):
        first = self.posted()
        second = self.posted(back=9)

        with self.assertRaises(frappe.ValidationError) as refused:
            self.cancel_in_erpnext(self.invoice_of(second))

        said = frappe.utils.strip_html(str(refused.exception))

        self.assertIn(second, said)
        self.assertNotIn(first, said)

    def test_a_document_of_ours_still_drafted_is_deleted_rather_than_cancelled(self):
        run = self.approved()
        invoice = self.invoice_of(run)

        self.assertEqual(self.docstatus_of(invoice), 0)

        BillingService.discard_invoice(name=run)

        self.assertFalse(frappe.db.exists(INVOICE, invoice))
        self.assertEqual(self.status_of(run), "Approved")

    def test_the_same_restriction_holds_through_the_api_rather_than_the_desk(self):
        from frappe.client import cancel as api_cancel

        run = self.posted()
        invoice = self.invoice_of(run)

        with self.assertRaises(frappe.ValidationError) as refused:
            api_cancel("Sales Invoice", invoice)

        said = frappe.utils.strip_html(str(refused.exception))

        self.assertIn("Cancellation not allowed", said)
        self.assertIn(run, said)
        self.assertEqual(self.docstatus_of(invoice), 1)

    def test_an_invoice_nothing_here_drew_is_cancelled_in_erpnext_as_before(self):
        company = frappe.defaults.get_global_default("company")
        theirs = frappe.get_doc(
            {
                "doctype": INVOICE,
                "company": company,
                "customer": self.customer,
                "posting_date": self.today,
                "set_posting_time": 1,
                "due_date": self.today,
                "items": [
                    {
                        "item_code": self.service,
                        "qty": 1,
                        "rate": 100,
                        "income_account": frappe.db.get_value(
                            "Company", company, "default_income_account"
                        ),
                    }
                ],
            }
        )
        theirs.flags.ignore_permissions = True
        theirs.insert(ignore_permissions=True)
        self.track(INVOICE, theirs.name)
        theirs.submit()

        self.cancel_in_erpnext(theirs.name)

        self.assertEqual(self.docstatus_of(theirs.name), 2)

    def test_the_permission_names_one_document_and_cannot_be_borrowed(self):
        run = self.posted()
        invoice = self.invoice_of(run)

        self.assertFalse(accounting.permitted(invoice, run))

        with accounting.cancelling(run, invoice):
            self.assertTrue(accounting.permitted(invoice, run))
            self.assertFalse(accounting.permitted(invoice, "BR-somebody-else"))
            self.assertFalse(accounting.permitted("ACC-SINV-elsewhere", run))

        self.assertFalse(accounting.permitted(invoice, run), "it is taken away again")

    def test_the_permission_is_taken_away_even_when_the_operation_fails(self):
        run = self.posted()
        invoice = self.invoice_of(run)

        with self.assertRaises(RuntimeError):
            with accounting.cancelling(run, invoice):
                raise RuntimeError("the ledger refused")

        self.assertFalse(accounting.permitted(invoice, run))

        with self.assertRaises(frappe.ValidationError):
            self.cancel_in_erpnext(invoice)


class TestErpnextMayNotCancelTheRunEither(CancellationCase):
    """Cancelling the run itself in the Desk leaves the document it posted standing.

    That is the same half-cancelled state the refusal on the document exists to prevent,
    reached from the other end, so the run refuses it too and names where it is done.
    """

    def cancel_natively(self, run):
        doc = frappe.get_doc(RUN, run)
        doc.flags.ignore_permissions = True
        doc.cancel()

    def test_cancelling_the_run_in_the_desk_is_refused_while_its_document_stands(self):
        run = self.posted()
        invoice = self.invoice_of(run)

        with self.assertRaises(frappe.ValidationError) as refused:
            self.cancel_natively(run)

        said = frappe.utils.strip_html(str(refused.exception))

        self.assertIn("cancelled in Nexgen MSP", said)
        self.assertEqual(frappe.db.get_value(RUN, run, "docstatus"), 1, "the run is untouched")
        self.assertEqual(self.status_of(run), "Invoiced")
        self.assertEqual(self.docstatus_of(invoice), 1, "and so is its document")

    def test_the_same_restriction_holds_through_the_api_rather_than_the_desk(self):
        from frappe.client import cancel as api_cancel

        run = self.posted()

        with self.assertRaises(frappe.ValidationError):
            api_cancel(RUN, run)

        self.assertEqual(frappe.db.get_value(RUN, run, "docstatus"), 1)
        self.assertEqual(self.status_of(run), "Invoiced")

    def test_a_run_that_carries_no_document_is_cancelled_where_the_others_are(self):
        run = self.approved()
        BillingService.discard_invoice(name=run)

        with self.assertRaises(frappe.ValidationError):
            self.cancel_natively(run)

        out = BillingService.cancel(name=run, reason="ZZTEST drawn by mistake")

        self.assertEqual(out["status"], "Cancelled")

    def test_the_permission_names_one_run_and_cannot_be_borrowed(self):
        run = self.posted()
        other = self.approved(back=9)

        self.assertFalse(accounting.run_cancellation_permitted(run))

        with accounting.cancelling_run(run):
            self.assertTrue(accounting.run_cancellation_permitted(run))
            self.assertFalse(accounting.run_cancellation_permitted(other))

        self.assertFalse(accounting.run_cancellation_permitted(run), "it is taken away again")

    def test_the_permission_is_taken_away_even_when_the_operation_fails(self):
        run = self.posted()

        with self.assertRaises(RuntimeError):
            with accounting.cancelling_run(run):
                raise RuntimeError("the ledger refused")

        self.assertFalse(accounting.run_cancellation_permitted(run))

        with self.assertRaises(frappe.ValidationError):
            self.cancel_natively(run)

    def test_cancelling_from_here_still_takes_the_run_and_its_document_together(self):
        run = self.posted()
        invoice = self.invoice_of(run)

        BillingService.cancel(name=run, reason="ZZTEST billing correction")

        self.assertEqual(self.status_of(run), "Cancelled")
        self.assertEqual(frappe.db.get_value(RUN, run, "docstatus"), 2)
        self.assertEqual(self.docstatus_of(invoice), 2)

    def test_a_permitted_cancellation_is_the_one_door_that_opens(self):
        """What reopening an approved run goes through, which the guard must not close."""
        start, end = self.month()
        run = self.drawn(start=start, end=end)
        BillingService.approve(name=run)

        with accounting.cancelling_run(run):
            self.cancel_natively(run)

        self.assertEqual(frappe.db.get_value(RUN, run, "docstatus"), 2)
        self.assertEqual(self.status_of(run), "Cancelled")


class TestCancellingFromHere(CancellationCase):
    def test_a_posted_run_cancels_its_document_and_itself(self):
        run = self.posted()
        invoice = self.invoice_of(run)

        out = BillingService.cancel(name=run, reason="ZZTEST billing correction")

        self.assertEqual(out["status"], "Cancelled")
        self.assertEqual(self.docstatus_of(invoice), 2)
        self.assertEqual(self.status_of(run), "Cancelled")
        self.assertEqual(
            frappe.db.get_value(RUN, run, "sales_invoice"),
            invoice,
            "what was posted and undone stays readable from the run",
        )

    def test_the_cancellation_says_who_undid_it_and_why(self):
        run = self.posted()

        BillingService.cancel(name=run, reason="ZZTEST billing correction")
        written = accounting.cancellation_of(run)

        self.assertEqual(written["reason"], "ZZTEST billing correction")
        self.assertEqual(written["by"], frappe.session.user)
        self.assertEqual(written["before"]["run"], "Invoiced")
        self.assertEqual(written["before"]["invoice_docstatus"], 1)
        self.assertEqual(written["after"]["run"], "Cancelled")
        self.assertEqual(written["after"]["invoice_docstatus"], 2)

        events = [event["label"] for event in run_view.run_view(run)["activity"]]

        self.assertTrue(any("Billing run cancelled" in label for label in events))
        self.assertTrue(any("ZZTEST billing correction" in label for label in events))

    def test_a_cancelled_run_is_no_longer_billed_for_anything(self):
        run = self.posted()
        billed = {row.service_assignment for row in BillingService.net_billed_periods(self.customer)}

        self.assertIn(self.assignment, billed)

        BillingService.cancel(name=run, reason="ZZTEST billing correction")
        after = {row.service_assignment for row in BillingService.net_billed_periods(self.customer)}

        self.assertNotIn(self.assignment, after)
        self.assertIsNone(
            frappe.db.get_value("MSP Client User", self.john, "last_billed_on"),
            "a charge that was undone stops counting as covered",
        )

    def test_cancelling_a_run_that_posted_nothing_still_works(self):
        start, end = self.month()
        run = self.drawn(start=start, end=end)

        out = BillingService.cancel(name=run, reason="ZZTEST drawn by mistake")

        self.assertEqual(out["status"], "Cancelled")
        self.assertIsNone(self.invoice_of(run))

    def test_cancelling_a_run_whose_invoice_is_still_a_draft_takes_the_draft_with_it(self):
        run = self.approved()
        invoice = self.invoice_of(run)

        out = BillingService.cancel(name=run, reason="ZZTEST drafted by mistake")

        self.assertEqual(out["status"], "Cancelled")
        self.assertFalse(frappe.db.exists(INVOICE, invoice), "a draft is deleted, not cancelled")
        self.assertIsNone(self.invoice_of(run))

    def test_cancelling_twice_is_cancelling_once(self):
        run = self.posted()
        invoice = self.invoice_of(run)

        BillingService.cancel(name=run, reason="ZZTEST billing correction")
        first = accounting.cancellation_of(run)

        again = BillingService.cancel(name=run, reason="ZZTEST again")

        self.assertEqual(again["status"], "Cancelled")
        self.assertEqual(self.docstatus_of(invoice), 2)
        self.assertEqual(
            accounting.cancellation_of(run)["at"], first["at"], "nothing happened a second time"
        )

    def test_a_credit_note_run_cancels_the_note_it_posted(self):
        charge = self.posted()
        credit = self.credit_for(charge)
        BillingService.submit_invoice(name=credit, notify=0)
        note = self.invoice_of(credit)

        out = BillingService.cancel(name=credit, reason="ZZTEST credited twice")

        self.assertEqual(out["status"], "Cancelled")
        self.assertEqual(self.docstatus_of(note), 2)
        self.assertEqual(self.status_of(charge), "Invoiced", "the charge it answered is untouched")
        self.assertEqual(self.docstatus_of(self.invoice_of(charge)), 1)

    def test_an_unknown_run_is_not_found(self):
        with self.assertRaises(NotFoundError):
            BillingService.cancel(name="BR-does-not-exist")

    def test_the_page_offers_the_cancellation_and_names_what_goes_with_it(self):
        run = self.posted()
        view = run_view.run_view(run)
        moves = {move["action"]: move["label"] for move in view["moves"]}

        self.assertTrue(view["can_cancel"])
        self.assertIsNone(view["cancel_blocked"])
        self.assertIn("cancel", moves)
        self.assertIn("invoice", moves["cancel"].lower())

        BillingService.cancel(name=run, reason="ZZTEST billing correction")
        after = run_view.run_view(run)

        self.assertFalse(after["can_cancel"])
        self.assertTrue(after["settled"])
        self.assertNotIn("cancel", [move["action"] for move in after["moves"]])


class TestWhenTheLedgerRefuses(CancellationCase):
    def test_a_refused_cancellation_leaves_both_records_as_they_were(self):
        run = self.posted()
        invoice = self.invoice_of(run)
        original = frappe.get_doc(INVOICE, invoice)

        def refuse(self, *args, **kwargs):
            frappe.throw("ZZTEST the ledger refused this cancellation")

        held = frappe.get_doc(INVOICE, invoice).__class__.cancel
        frappe.get_doc(INVOICE, invoice).__class__.cancel = refuse

        try:
            with self.assertRaises(Exception):
                BillingService.cancel(name=run, reason="ZZTEST billing correction")
        finally:
            original.__class__.cancel = held

        frappe.db.rollback()

        self.assertEqual(self.docstatus_of(invoice), 1, "the posted document is preserved")
        self.assertEqual(self.status_of(run), "Invoiced", "and so is the run")
        self.assertIsNone(accounting.cancellation_of(run), "nothing claims it was cancelled")

    def test_an_accounting_dependency_refuses_the_cancellation_and_keeps_everything(self):
        charge = self.posted()
        invoice = self.invoice_of(charge)
        credit = self.credit_for(charge)
        BillingService.submit_invoice(name=credit, notify=0)
        note = self.invoice_of(credit)

        # the ledger's own rule: a posted return stands against this invoice
        with self.assertRaises(Exception) as refused:
            BillingService.cancel(name=charge, reason="ZZTEST billing correction")

        self.assertIn(note, str(refused.exception))
        frappe.db.rollback()

        self.assertEqual(self.docstatus_of(invoice), 1, "the charge is preserved")
        self.assertEqual(self.docstatus_of(note), 1, "and so is the credit note")
        self.assertEqual(self.status_of(charge), "Invoiced")
        self.assertEqual(self.status_of(credit), "Invoiced")
        self.assertIsNone(accounting.cancellation_of(charge))

    def test_a_document_that_went_missing_blocks_the_cancellation(self):
        run = self.posted()
        frappe.db.set_value(RUN, run, "sales_invoice", "ACC-SINV-gone", update_modified=False)
        frappe.db.commit()

        view = run_view.run_view(run)

        self.assertFalse(view["can_cancel"])
        self.assertEqual(view["accounting_mismatch"]["code"], "MISSING_DOCUMENT")

        with self.assertRaises(ServiceRefused) as refused:
            BillingService.cancel(name=run, reason="ZZTEST missing")

        self.assertEqual(refused.exception.code, "INVALID_TRANSITION")

    def test_a_document_of_another_customer_blocks_the_cancellation(self):
        run = self.posted()
        invoice = self.invoice_of(run)
        other = self.make_customer(f"OTH{self.tag[:4]}")
        frappe.db.set_value(INVOICE, invoice, "customer", other, update_modified=False)
        frappe.db.commit()

        with self.assertRaises(ServiceRefused) as refused:
            BillingService.cancel(name=run, reason="ZZTEST wrong customer")

        self.assertEqual(refused.exception.code, "INVALID_TRANSITION")
        self.assertEqual(self.docstatus_of(invoice), 1)
        frappe.db.set_value(INVOICE, invoice, "customer", self.customer, update_modified=False)
        frappe.db.commit()


class TestOnlyTheBillingDeskMayCancel(CancellationCase):
    def test_a_customer_account_cannot_cancel_a_run(self):
        run = self.posted()
        account = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"cc{self.tag[:3]}"
        )
        frappe.set_user(account)

        try:
            with self.assertRaises(Exception):
                BillingService.cancel(name=run, reason="ZZTEST not mine")
        finally:
            frappe.set_user("Administrator")

        self.assertEqual(self.status_of(run), "Invoiced")
        self.assertEqual(self.docstatus_of(self.invoice_of(run)), 1)


class TestRepairingWhatWasLeftBehind(CancellationCase):
    def test_a_run_posted_before_the_events_existed_is_detected_and_repaired(self):
        run = self.posted()
        # exactly what a direct posting left behind on a site without the document events
        frappe.db.set_value(RUN, run, "status", "Invoice Drafted", update_modified=False)
        frappe.db.commit()

        view = run_view.run_view(run)

        self.assertEqual(view["accounting_mismatch"]["code"], "POSTED_ELSEWHERE")
        self.assertTrue(view["can_reconcile"])

        planned = accounting.reconcile_run(name=run)

        self.assertFalse(planned["applied"])
        self.assertEqual(planned["would"], "Invoiced")
        self.assertEqual(self.status_of(run), "Invoice Drafted", "a dry run writes nothing")

        done = accounting.reconcile_run(name=run, apply=1)

        self.assertTrue(done["applied"])
        self.assertEqual(self.status_of(run), "Invoiced")
        self.assertIsNone(run_view.run_view(run)["accounting_mismatch"])

    def test_a_cancelled_document_no_longer_leaves_its_run_reading_invoiced(self):
        run = self.posted()
        invoice = self.invoice_of(run)
        BillingService.cancel(name=run, reason="ZZTEST billing correction")
        frappe.db.set_value(RUN, run, "status", "Invoiced", update_modified=False)
        frappe.db.commit()

        view = run_view.run_view(run)

        self.assertEqual(view["accounting_mismatch"]["code"], "CANCELLED_DOCUMENT")

        done = accounting.reconcile_run(name=run, apply=1)

        self.assertTrue(done["applied"])
        self.assertEqual(self.status_of(run), "Cancelled")
        self.assertEqual(self.docstatus_of(invoice), 2, "nothing was posted again")

    def test_a_cancelled_run_against_a_posted_document_is_not_called_repaired(self):
        """Two records that contradict each other, which no repair can reconcile.

        The run was undone and the document was not, so bringing the run back to `Invoiced`
        would say it was billed and bringing the document down is not something a status
        write does. Reporting it as applied is what must not happen.
        """
        run = self.posted()
        invoice = self.invoice_of(run)
        frappe.db.set_value(RUN, run, "status", "Cancelled", update_modified=False)
        frappe.db.commit()

        planned = accounting.reconcile_run(name=run)

        self.assertEqual(planned["mismatch"]["code"], "POSTED_ELSEWHERE")

        with self.assertRaises(ServiceRefused) as refused:
            accounting.reconcile_run(name=run, apply=1)

        self.assertIn(invoice, str(refused.exception))
        self.assertIn(run, str(refused.exception))
        self.assertEqual(self.status_of(run), "Cancelled", "nothing was written")
        self.assertEqual(self.docstatus_of(invoice), 1)
        self.assertEqual(
            run_view.run_view(run)["accounting_mismatch"]["code"],
            "POSTED_ELSEWHERE",
            "and the contradiction is still reported",
        )

    def test_a_repair_that_reaches_nothing_says_so_rather_than_reporting_success(self):
        run = self.posted()
        frappe.db.set_value(RUN, run, "status", "Invoice Drafted", update_modified=False)
        frappe.db.commit()

        done = accounting.reconcile_run(name=run, apply=1)

        self.assertTrue(done["applied"])
        self.assertIsNone(done["mismatch"], "what was repaired is no longer reported as found")
        self.assertEqual(done["status"], "Invoiced")

    def test_repairing_the_same_thing_twice_changes_nothing(self):
        run = self.posted()
        frappe.db.set_value(RUN, run, "status", "Invoice Drafted", update_modified=False)
        frappe.db.commit()

        accounting.reconcile_run(name=run, apply=1)
        again = accounting.reconcile_run(name=run, apply=1)

        self.assertFalse(again["applied"])
        self.assertIsNone(again["mismatch"])
        self.assertEqual(self.status_of(run), "Invoiced")

    def test_a_contested_link_is_reported_rather_than_guessed(self):
        run = self.posted()
        invoice = self.invoice_of(run)
        other = self.approved(back=9)
        frappe.db.set_value(RUN, other, "sales_invoice", invoice, update_modified=False)
        frappe.db.commit()

        try:
            planned = accounting.reconcile_run(name=run, apply=1)

            self.assertFalse(planned["applied"])
            self.assertEqual(planned["mismatch"]["code"], "AMBIGUOUS_OWNER")
            self.assertIsNone(planned["would"])
        finally:
            frappe.db.set_value(RUN, other, "sales_invoice", None, update_modified=False)
            frappe.db.commit()


class TestWhatWasBilledIsKept(CancellationCase):
    def test_an_edited_document_never_rewrites_the_run_it_came_from(self):
        run = self.approved()
        invoice = self.invoice_of(run)
        original = frappe.db.get_value(
            RUN, run, ["total_amount", "currency", "billing_period_start", "billing_period_end"], as_dict=True
        )

        doc = frappe.get_doc(INVOICE, invoice)
        doc.flags.ignore_permissions = True
        doc.items[0].rate = frappe.utils.flt(doc.items[0].rate) - 10
        doc.set_posting_time = 1
        doc.save()
        doc.submit()

        kept = frappe.db.get_value(
            RUN, run, ["total_amount", "currency", "billing_period_start", "billing_period_end"], as_dict=True
        )
        view = run_view.run_view(run)

        self.assertEqual(kept, original, "the frozen calculation is the run's own")
        self.assertEqual(view["status"], "Invoiced")
        self.assertEqual(view["accounting_state"], "Posted")
        self.assertNotEqual(
            frappe.utils.flt(frappe.db.get_value(INVOICE, invoice, "grand_total"), 2),
            frappe.utils.flt(original.total_amount, 2),
        )
