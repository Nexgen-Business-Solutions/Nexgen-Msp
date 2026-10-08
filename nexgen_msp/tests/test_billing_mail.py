"""Which way billing mail travels.

A customer is no longer told by email that an invoice was issued: they read it in their portal.
Mail towards Nexgen is untouched, because a dispute nobody is told about is a dispute nobody
answers.
"""

import inspect

import frappe

from nexgen_msp.api.internal.services import billing_service
from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.utils import notifications

from .base import MSPTestCase


def live_source(function):
    """The body of a function with its comments taken out: what actually runs."""
    return "\n".join(
        line
        for line in inspect.getsource(function).splitlines()
        if not line.strip().startswith("#")
    )


class TestInvoiceMailNoLongerReachesTheCustomer(MSPTestCase):
    def test_issuing_an_invoice_tells_nobody_at_the_customer(self):
        source = live_source(BillingService.submit_invoice)

        self.assertIn("invoice.submit()", source, "the invoice is still posted")
        self.assertNotIn(
            "_notify_customer",
            source,
            "issuing an invoice must not mail the customer any more",
        )

    def test_the_sender_and_its_template_are_kept_so_it_can_be_put_back(self):
        notifications.ensure_templates()

        self.assertTrue(hasattr(BillingService, "_notify_customer"))
        self.assertIn("MSP Invoice Issued", live_source(BillingService._notify_customer))
        self.assertTrue(frappe.db.exists("Email Template", "MSP Invoice Issued"))

    def test_nothing_else_in_billing_still_calls_it(self):
        callers = [
            name
            for name, member in vars(BillingService).items()
            if isinstance(member, staticmethod)
            and name != "_notify_customer"
            and "_notify_customer" in live_source(member.__func__)
        ]

        self.assertEqual(callers, [], "no live path mails the customer about an invoice")


class TestMailTowardsNexgenIsUntouched(MSPTestCase):
    def test_a_disputed_invoice_still_reaches_our_administrators(self):
        source = live_source(
            __import__(
                "nexgen_msp.api.portal.services.portal_service", fromlist=["PortalService"]
            ).PortalService.dispute_invoice
        )

        self.assertIn("MSP Invoice Disputed", source)
        self.assertIn("MSP System Admin", source, "our administrators are the ones told")

    def test_settling_a_dispute_still_answers_whoever_raised_it(self):
        self.assertIn("MSP Dispute Settled", live_source(BillingService._notify_dispute_settled))

    def test_every_template_still_exists_whether_it_is_sent_or_not(self):
        notifications.ensure_templates()

        for name in (
            "MSP Invoice Issued",
            "MSP Invoice Disputed",
            "MSP Dispute Acknowledged",
            "MSP Dispute Settled",
        ):
            self.assertTrue(frappe.db.exists("Email Template", name), name)

    def test_the_withdrawal_is_a_comment_and_not_a_deletion(self):
        whole = inspect.getsource(billing_service.BillingService.submit_invoice)

        self.assertIn("# if frappe.utils.cint(notify):", whole)
        self.assertIn("#     BillingService._notify_customer(", whole)
