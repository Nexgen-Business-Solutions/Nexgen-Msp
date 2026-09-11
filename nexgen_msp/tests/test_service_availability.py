"""What a target may be given today, read the way a detail page reads it.

Availability is a commercial answer, not a catalogue listing: the service has to be sold at
this scope, covered by a live contract, priced, and not already held by this exact target.
These tests ask the same questions from both ends — a person and a machine — and check that
holding a service on one of them never uses it up on the other.
"""

import frappe

from nexgen_msp.api.internal.services.service_availability_service import (
    ServiceAvailabilityService,
)
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService

from .base import MSPTestCase


class TestServiceAvailability(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.john = self.make_person(self.customer, "John")

    # ------------------------------------------------------------------ helpers
    def open_service(self, service, scope, client_user=None, managed_device=None):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope=scope,
            client_user=client_user,
            managed_device=managed_device,
        )
        self.track("MSP Service Assignment", outcome["name"])

        return outcome

    def codes(self, rows):
        return [row["service_item"] for row in rows]

    def reason_for(self, rows, service):
        return next((row["reason"] for row in rows if row["service_item"] == service), None)

    # ------------------------------------------------------------------ the readings
    def test_covered_and_priced_service_is_available_to_both_kinds_of_target(self):
        personal = self.make_service("AVAIL-U", scope="User")
        machine = self.make_service("AVAIL-D", scope="Device")
        self.cover_service(self.customer, personal)
        self.cover_service(self.customer, machine)
        device = self.make_device(self.customer, "AVAIL", holder=self.john, serial="ZZAVAIL1")

        person_view = ServiceAvailabilityService.for_user(self.john)
        device_view = ServiceAvailabilityService.for_device(device)

        self.assertIn(personal, self.codes(person_view["available"]))
        self.assertNotIn(personal, self.codes(person_view["current"]))
        self.assertIn(machine, self.codes(device_view["available"]))
        self.assertNotIn(machine, self.codes(device_view["current"]))

    def test_a_service_already_open_is_current_and_not_offered_again(self):
        service = self.make_service("HELD", scope="User")
        self.cover_service(self.customer, service)

        opened = self.open_service(service, "User", client_user=self.john)

        view = ServiceAvailabilityService.for_user(self.john)

        self.assertNotIn(service, self.codes(view["available"]))
        self.assertNotIn(service, self.codes(view["blocked"]))

        row = next(row for row in view["current"] if row["service_item"] == service)
        self.assertEqual(row["name"], opened["name"])
        self.assertEqual(row["operational_status"], "Active")
        self.assertIsNotNone(row["effective_start_date"])
        self.assertTrue(row["item_name"])

    def test_a_service_of_the_wrong_scope_is_never_current_or_available(self):
        personal = self.make_service("SCOPE-U", scope="User")
        machine = self.make_service("SCOPE-D", scope="Device")
        self.cover_service(self.customer, personal)
        self.cover_service(self.customer, machine)
        device = self.make_device(self.customer, "SCOPE", holder=self.john, serial="ZZAVAIL2")

        person_view = ServiceAvailabilityService.for_user(self.john)
        device_view = ServiceAvailabilityService.for_device(device)

        self.assertNotIn(machine, self.codes(person_view["available"]))
        self.assertNotIn(machine, self.codes(person_view["current"]))
        self.assertNotIn(personal, self.codes(device_view["available"]))
        self.assertNotIn(personal, self.codes(device_view["current"]))

        # an administrator is told why it is not even an option
        self.assertEqual(self.reason_for(person_view["blocked"], machine), "Device only")
        self.assertEqual(self.reason_for(device_view["blocked"], personal), "User only")

    def test_a_both_service_held_by_a_device_stays_available_to_its_holder(self):
        service = self.make_service("BOTH", scope="Both")
        self.cover_service(self.customer, service)
        device = self.make_device(self.customer, "BOTH", holder=self.john, serial="ZZAVAIL3")

        self.open_service(service, "Device", managed_device=device)

        device_view = ServiceAvailabilityService.for_device(device)
        person_view = ServiceAvailabilityService.for_user(self.john)

        self.assertIn(service, self.codes(device_view["current"]))
        self.assertNotIn(service, self.codes(device_view["available"]))

        # the same service was never opened for John himself
        self.assertIn(service, self.codes(person_view["available"]))
        self.assertNotIn(service, self.codes(person_view["current"]))

    def test_a_service_no_contract_covers_is_blocked_rather_than_offered(self):
        service = self.make_service("NOCONTRACT", scope="Both")
        device = self.make_device(self.customer, "NOCON", holder=self.john, serial="ZZAVAIL4")

        person_view = ServiceAvailabilityService.for_user(self.john)
        device_view = ServiceAvailabilityService.for_device(device)

        self.assertNotIn(service, self.codes(person_view["available"]))
        self.assertNotIn(service, self.codes(device_view["available"]))

        self.assertTrue(person_view["is_admin"])
        self.assertIn("contract", (self.reason_for(person_view["blocked"], service) or "").lower())
        self.assertIn("contract", (self.reason_for(device_view["blocked"], service) or "").lower())

    def test_a_machine_that_cannot_take_a_service_offers_none(self):
        service = self.make_service("RETIRED", scope="Device")
        self.cover_service(self.customer, service)
        device = self.make_device(self.customer, "RETIRED", serial="ZZAVAIL5")

        frappe.db.set_value("MSP Managed Device", device, "status", "Retired")
        frappe.db.commit()

        view = ServiceAvailabilityService.for_device(device)

        self.assertEqual(view["available"], [])
        self.assertIn("retired", (view["target_reason"] or "").lower())
        self.assertIn("retired", (self.reason_for(view["blocked"], service) or "").lower())

    def test_a_covered_service_without_a_rate_is_blocked_rather_than_offered(self):
        service = self.make_service("NORATE", scope="User")
        self.cover_service(self.customer, service, rate=None)

        view = ServiceAvailabilityService.for_user(self.john)

        self.assertNotIn(service, self.codes(view["available"]))
        self.assertIn("rate", (self.reason_for(view["blocked"], service) or "").lower())
