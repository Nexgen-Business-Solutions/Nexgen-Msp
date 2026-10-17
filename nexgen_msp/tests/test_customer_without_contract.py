"""A customer with people, services and a billing history, and no contract to bill against.

Kakivu Mousse USD was onboarded by importing its history: 52 people, 96 services running
since 2023, and the date its previous biller last charged it. Nobody created the contract,
and without one there is nothing to bill against — no frequency, no timing, no proration and
no prices. The checkpoint resolution lives in test_billing_checkpoint, and the catch-up it
feeds in test_kakivu_catch_up; what is kept here is the state that makes both pointless.
"""

import frappe
from nexgen_msp.api.internal.services.billing_service import BillingService

from .test_billing_history import BillingHistoryCase


class CheckpointCase(BillingHistoryCase):
    def mine_in(self, due):
        return [row for row in due["rows"] if row["customer"] == self.customer]

    def stamp(self, on):
        frappe.db.set_value("Customer", self.customer, "msp_last_billed_on", on)
        frappe.db.commit()


class TestACustomerWithNoContract(CheckpointCase):
    """Kakivu's situation: people, services, a checkpoint — and nothing to bill against."""

    def test_billing_never_proposes_a_customer_that_has_no_contract(self):
        service = self.offering("NOCON")
        self.running(service, client_user=self.john)
        # the contract the fixture made for the service is what Kakivu never had
        frappe.delete_doc("MSP Contract", self.contract, force=True, ignore_permissions=True)
        frappe.db.commit()
        self.stamp("2026-07-24")

        self.assertEqual(
            self.mine_in(BillingService.due(horizon_days=3650)),
            [],
            "a customer with no contract is invisible to billing, checkpoint or not",
        )

    def test_the_assignments_are_there_all_the_same(self):
        """Which is what makes it look wrong: the work exists, the billing cannot see it."""
        service = self.offering("NOCON2")
        assignment = self.running(service, client_user=self.john)
        frappe.delete_doc("MSP Contract", self.contract, force=True, ignore_permissions=True)
        frappe.db.commit()

        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", assignment, "billing_status"),
            "Billable",
        )
        self.assertTrue(frappe.db.exists("MSP Service Assignment", assignment))
