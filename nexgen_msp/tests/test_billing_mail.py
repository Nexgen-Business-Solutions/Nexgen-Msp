"""Which way billing mail travels.

A customer is told that an invoice was issued through **one named billing contact** and
nobody else — issue #21, after a notice addressed to every portal account reached people it
was never meant for. Mail towards Nexgen is untouched, because a dispute nobody is told
about is a dispute nobody answers.

Who that contact is, and what happens when none is named, lives in test_billing_contact.
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


class TestInvoiceMailReachesOneNamedContact(MSPTestCase):
    def test_issuing_an_invoice_writes_through_the_billing_contact(self):
        source = live_source(BillingService.submit_invoice)

        self.assertIn(
            "erpnext_bridge.submit(invoice)", source, "the invoice is still posted"
        )
        self.assertIn("_notify_customer", source, "and the notice goes out again")
        self.assertIn("cint(notify)", source, "only when the run asked for it")

    def test_the_sender_and_its_template_are_kept_so_it_can_be_put_back(self):
        notifications.ensure_templates()

        self.assertTrue(hasattr(BillingService, "_notify_customer"))
        self.assertIn("MSP Invoice Issued", live_source(BillingService._notify_customer))
        self.assertTrue(frappe.db.exists("Email Template", "MSP Invoice Issued"))

    def test_only_the_posting_of_an_invoice_writes_to_the_customer(self):
        callers = [
            name
            for name, member in vars(BillingService).items()
            if isinstance(member, staticmethod)
            and name != "_notify_customer"
            and "_notify_customer" in live_source(member.__func__)
        ]

        self.assertEqual(callers, ["submit_invoice"], "one path, and one only")


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

    def test_the_broad_recipient_query_is_gone_for_good(self):
        """Not commented out — removed: a permission is not a reason to be told about money."""
        whole = inspect.getsource(billing_service.BillingService._notify_customer)

        self.assertNotIn("User Permission", whole)
        self.assertNotIn("up.for_value", whole)
