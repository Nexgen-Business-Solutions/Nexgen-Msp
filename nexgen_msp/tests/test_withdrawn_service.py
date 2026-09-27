"""A service Nexgen stops offering is not a service that stops.

Withdrawing one from the MSP catalogue answers one question and one only: may this be taken
up by somebody new? What a customer already has is theirs — it keeps running, it keeps being
billed, and they can still ask for it to be stopped. What changes is that nobody can ask for
it any more, and nobody on our side can open it for anybody.

Ending what is already running is a separate decision, made in as many words.
"""

import frappe
from frappe.utils import add_days, add_months, getdate

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.api.internal.services.catalogue_service import CatalogueService
from nexgen_msp.api.internal.services.service_definition_service import ServiceDefinitionService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.portal.services.request_v3_service import RequestV3Service
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase


class WithdrawnServiceCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(f"WD{self.tag[:4]}")
        self.track("MSP Approval Authority", self.customer)
        self.alice = self.make_person(self.customer, "Alice")
        self.bob = self.make_person(self.customer, "Bob")
        self.service = self.make_service(f"WD{self.tag[:3]}")
        self.contract = self.cover_service(self.customer, self.service)
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"wd{self.tag[:3]}"
        )
        self.grant(self.asker)

        started = str(add_months(getdate(frappe.utils.today()), -2))
        self.running = self.track(
            "MSP Service Assignment",
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=self.service,
                target_scope="User",
                client_user=self.alice,
                effective_date=started,
            )["name"],
        )

    def withdraw(self):
        """Stop offering it, and leave what is running exactly where it is."""
        return CatalogueService.remove_service_from_msp(item=self.service, mode="keep")

    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def subjects(self, *people):
        return [
            {
                "subject_key": f"user:{person}",
                "client_user": person,
                "full_name": frappe.db.get_value("MSP Client User", person, "full_name"),
            }
            for person in people
        ]

    def offered_actions(self, *people):
        options = self.as_user(
            self.asker,
            lambda: RequestV3Service.operation_options(
                customer=self.customer, subjects=self.subjects(*people)
            ),
        )
        services = next(
            (domain for domain in options["domains"] if domain["key"] == "Service"), None
        )

        if not services:
            return {}

        card = next(
            (row for row in services["options"] if row["object_key"] == self.service), None
        )

        return (
            {action["operation_code"]: action for action in card["actions"]} if card else {}
        )


class TestWhatWithdrawingChanges(WithdrawnServiceCase):
    def test_the_catalogue_stops_offering_it(self):
        self.withdraw()

        self.assertFalse(ServiceDefinitionService.is_ready(self.service))

        definition = ServiceDefinitionService.for_item(self.service)

        self.assertEqual(frappe.utils.cint(definition.enabled), 0)
        self.assertEqual(
            ServiceDefinitionService.compatibility(self.service), "Historical Only"
        )

    def test_nobody_can_be_given_it_any_more(self):
        self.withdraw()

        with self.assertRaises(ValidationError) as refused:
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=self.service,
                target_scope="User",
                client_user=self.bob,
            )

        self.assertIn("not available", refused.exception.message.lower())

    def test_the_customer_can_no_longer_ask_for_it(self):
        before = self.offered_actions(self.alice, self.bob)

        self.assertIn("service.add", before, "it was on offer before it was withdrawn")

        self.withdraw()
        after = self.offered_actions(self.alice, self.bob)

        self.assertNotIn("service.add", after, "a withdrawn service cannot be asked for")


class TestWhatWithdrawingLeavesAlone(WithdrawnServiceCase):
    def test_what_is_running_keeps_running(self):
        self.withdraw()
        card = frappe.db.get_value(
            "MSP Service Assignment",
            self.running,
            ["operational_status", "billing_status", "effective_end_date"],
            as_dict=True,
        )

        self.assertEqual(card.operational_status, "Active")
        self.assertEqual(card.billing_status, "Billable")
        self.assertIsNone(card.effective_end_date)

    def test_it_is_still_billed(self):
        self.withdraw()

        first = getdate(frappe.utils.today()).replace(day=1)
        start = str(add_months(first, -1))
        end = str(getdate(add_days(add_months(getdate(start), 1), -1)))

        run = self.track(
            "MSP Billing Run",
            BillingService.generate(
                contract=self.contract, period_start=start, period_end=end
            )["name"],
        )
        billed = [
            row
            for row in BillingService.get_run(run)["lines"]
            if row["service_assignment"] == self.running
        ]

        self.assertEqual(len(billed), 1, "a withdrawn service is still owed for")
        self.assertGreater(float(billed[0]["billable_months"] or 0), 0)

    def test_the_customer_can_still_ask_for_it_to_stop(self):
        self.withdraw()
        offered = self.offered_actions(self.alice)

        self.assertIn(
            "service.end",
            offered,
            "a service nobody may take up must still be one they can stop",
        )
        self.assertEqual(offered["service.end"]["applicable_target_count"], 1)

    def test_our_own_side_can_still_end_it(self):
        self.withdraw()
        ServiceLifecycleService.end(assignment=self.running)

        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", self.running, "operational_status"),
            "Ended",
        )
