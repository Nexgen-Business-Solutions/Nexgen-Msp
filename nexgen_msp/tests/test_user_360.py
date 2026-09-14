"""One person's page answers what is theirs, what they hold, and what is moving — separately.

The rule under all of it: a person owns their own services and holds machines; the machine
owns the services running on it. Hand the machine over and the services go with the machine.
Nobody's personal history ever gains or loses a service that was always the laptop's.
"""

import frappe

from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.user_360_service import User360Service
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import device_holders as holders
from nexgen_msp.utils.errors import NexgenError

from .base import MSPTestCase


class User360Case(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", self.customer)
        self.john = self.make_person(self.customer, "John", department="Accounting")
        self.bob = self.make_person(self.customer, "Bob")

        self.personal = self.offering("U360U", scope="User")
        self.on_device = self.offering("U360D", scope="Device")

    # ------------------------------------------------------------------ helpers
    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def offering(self, suffix, scope="User"):
        service = self.make_service(f"{suffix}{self.tag[:3]}", scope=scope)
        self.cover_service(self.customer, service)

        return service

    def day(self, offset):
        return frappe.utils.add_days(frappe.utils.today(), offset)

    def laptop(self, hostname, holder=None, since=-90, serial=None):
        device = self.make_device(
            self.customer, hostname=f"{hostname}{self.tag[:3]}", serial=serial
        )

        if holder:
            doc = frappe.get_doc("MSP Managed Device", device)
            holders.hand_over(doc, holder, on_date=self.day(since))
            doc.status = "Active"
            doc.save(ignore_permissions=True)
            frappe.db.commit()

        return device

    def running(self, service, scope, started=-60, **target):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope=scope,
            effective_date=self.day(started),
            **target,
        )
        frappe.db.commit()

        return self.track("MSP Service Assignment", outcome["name"])

    def reading(self, person=None):
        return User360Service.get_user(person or self.john)

    def history(self, person=None):
        return User360Service.get_user_history(person or self.john)

    def slot(self, reading, device):
        return next(slot for slot in reading["devices"] if slot["device"]["name"] == device)


class TestWhatIsTheirsAndWhatIsTheMachines(User360Case):
    def test_their_own_service_is_read_as_theirs(self):
        assignment = self.running(self.personal, "User", client_user=self.john)

        reading = self.reading()

        self.assertEqual(
            [row["name"] for row in reading["personal_services"]["current"]], [assignment]
        )

    def test_a_service_on_their_machine_is_read_under_that_machine_alone(self):
        device = self.laptop("M1", holder=self.john, serial=f"S1-{self.tag}")
        assignment = self.running(self.on_device, "Device", managed_device=device)

        reading = self.reading()

        self.assertEqual(reading["personal_services"]["current"], [])
        self.assertEqual(
            [row["name"] for row in self.slot(reading, device)["services"]["current"]],
            [assignment],
        )

    def test_two_machines_keep_their_own_services_apart(self):
        first = self.laptop("M2A", holder=self.john, serial=f"S2A-{self.tag}")
        second = self.laptop("M2B", holder=self.john, serial=f"S2B-{self.tag}")
        other = self.offering("U360E", scope="Device")

        one = self.running(self.on_device, "Device", managed_device=first)
        two = self.running(other, "Device", managed_device=second)

        reading = self.reading()

        self.assertEqual(
            [row["name"] for row in self.slot(reading, first)["services"]["current"]], [one]
        )
        self.assertEqual(
            [row["name"] for row in self.slot(reading, second)["services"]["current"]], [two]
        )

    def test_the_count_says_which_are_theirs_and_which_the_machines(self):
        device = self.laptop("M3", holder=self.john, serial=f"S3-{self.tag}")
        self.running(self.personal, "User", client_user=self.john)
        self.running(self.on_device, "Device", managed_device=device)

        summary = self.reading()["summary"]

        self.assertEqual(summary["active_personal_services"], 1)
        self.assertEqual(summary["active_device_services"], 1)
        self.assertEqual(summary["current_devices"], 1)


class TestWhenAMachineChangesHands(User360Case):
    def test_the_service_follows_the_machine_and_never_the_person(self):
        device = self.laptop("T1", holder=self.john, serial=f"T1-{self.tag}")
        assignment = self.running(self.on_device, "Device", managed_device=device)

        DeviceLifecycleService.transfer(device=device, client_user=self.bob)
        frappe.db.commit()

        theirs = self.reading(self.bob)
        hers = self.reading(self.john)

        self.assertEqual(
            [row["name"] for row in self.slot(theirs, device)["services"]["current"]],
            [assignment],
        )
        self.assertEqual(hers["devices"], [])
        self.assertEqual(hers["personal_services"]["current"], [])
        self.assertEqual(theirs["personal_services"]["current"], [])

    def test_the_previous_holder_keeps_the_holding_period_and_nothing_else(self):
        device = self.laptop("T2", holder=self.john, serial=f"T2-{self.tag}")
        self.running(self.on_device, "Device", managed_device=device)

        DeviceLifecycleService.transfer(device=device, client_user=self.bob)
        frappe.db.commit()

        past = self.history(self.john)["past_devices"]

        self.assertEqual([row["name"] for row in past], [device])
        self.assertTrue(past[0]["held_until"])
        self.assertEqual(self.history(self.john)["past_personal_services"], [])

    def test_a_machine_taken_back_to_the_shelf_leaves_their_hands(self):
        device = self.laptop("T3", holder=self.john, serial=f"T3-{self.tag}")

        DeviceLifecycleService.repossess(device=device)
        frappe.db.commit()

        self.assertEqual(self.reading()["devices"], [])
        self.assertEqual([row["name"] for row in self.history()["past_devices"]], [device])

    def test_holding_the_same_machine_twice_reads_as_two_periods(self):
        device = self.laptop("T4", holder=self.john, since=-200, serial=f"T4-{self.tag}")

        DeviceLifecycleService.repossess(device=device, effective_date=self.day(-100))
        DeviceLifecycleService.assign(
            device=device, client_user=self.john, effective_date=self.day(-30)
        )
        frappe.db.commit()

        reading = self.reading()

        self.assertEqual(
            str(self.slot(reading, device)["holder_since"]),
            str(frappe.utils.getdate(self.day(-30))),
            "held since the period they are in now, not the first one ever",
        )
        self.assertEqual(len(self.history()["past_devices"]), 1)

    def test_the_machine_says_when_it_entered_service_and_when_they_took_it(self):
        device = self.laptop("T5", holder=self.john, since=-40, serial=f"T5-{self.tag}")

        slot = self.slot(self.reading(), device)

        self.assertEqual(str(slot["holder_since"]), str(frappe.utils.getdate(self.day(-40))))
        self.assertIn("in_service_since", slot["device"])
        self.assertEqual(slot["device"]["serial_number"], f"T5-{self.tag}")


class TestWhatIsMoving(User360Case):
    def setUp(self):
        super().setUp()
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"u3{self.tag[:3]}"
        )
        self.grant(self.asker)

    def raise_request(self, *lines):
        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer, request_type="Add", lines=list(lines)
            ),
        )

        return self.track("MSP Service Request", out["name"])

    def line(self, service, **fields):
        action = fields.pop("action", "Add")

        return {
            "request_action": self.action(action),
            "action": action,
            "target_scope": "User",
            "client_user": self.john,
            "requested_service": service,
            **fields,
        }

    def test_a_request_naming_them_is_read_on_their_page(self):
        name = self.raise_request(self.line(self.personal))

        self.assertEqual([row["name"] for row in self.reading()["open_requests"]], [name])

    def test_a_request_about_their_machine_is_read_on_their_page_too(self):
        device = self.laptop("R1", holder=self.john, serial=f"R1-{self.tag}")
        name = self.raise_request(
            self.line(
                self.on_device, client_user=None, target_scope="Device", managed_device=device
            )
        )

        self.assertEqual([row["name"] for row in self.reading()["open_requests"]], [name])

    def test_an_open_request_is_never_mixed_into_the_past(self):
        name = self.raise_request(self.line(self.personal))

        self.assertIn(name, [row["name"] for row in self.reading()["open_requests"]])
        self.assertNotIn(name, [row["name"] for row in self.history()["past_requests"]])

    def test_it_says_only_the_lines_that_are_about_them(self):
        name = self.raise_request(
            self.line(self.personal),
            self.line(self.offering("U360F"), client_user=self.bob),
        )

        mine = next(row for row in self.reading()["open_requests"] if row["name"] == name)

        self.assertEqual(len(mine["lines"]), 1)

    def test_a_service_already_being_changed_offers_no_second_change(self):
        assignment = self.running(self.personal, "User", client_user=self.john)
        name = self.raise_request(
            self.line(
                self.personal, action="Suspend", source_service_assignment=assignment
            )
        )

        service = self.reading()["personal_services"]["current"][0]

        self.assertEqual(service["pending_request"], name)
        self.assertEqual(service["allowed_actions"], [])

    def test_a_service_nobody_is_touching_offers_what_its_state_allows(self):
        self.running(self.personal, "User", client_user=self.john)

        service = self.reading()["personal_services"]["current"][0]

        self.assertIsNone(service["pending_request"])
        self.assertEqual(set(service["allowed_actions"]), {"Change", "Suspend", "Remove"})


class TestWhatNeedsLookingAt(User360Case):
    def test_a_machine_without_a_serial_is_named_as_such(self):
        device = self.laptop("A1", holder=self.john)

        signals = self.reading()["attention"]

        self.assertEqual([row["code"] for row in signals], ["DEVICE_SERIAL_MISSING"])
        self.assertEqual(signals[0]["entity"], device)
        self.assertEqual(signals[0]["entity_type"], "Device")

    def test_somebody_disabled_who_still_has_things_open_is_flagged(self):
        self.laptop("A2", holder=self.john, serial=f"A2-{self.tag}")
        self.running(self.personal, "User", client_user=self.john)
        frappe.db.set_value("MSP Client User", self.john, "lifecycle_status", "Disabled")

        codes = {row["code"] for row in self.reading()["attention"]}

        self.assertIn("DISABLED_WITH_OPEN_SERVICES", codes)
        self.assertIn("DISABLED_WITH_DEVICE", codes)

    def test_licences_with_nobody_to_issue_them_to_are_flagged(self):
        self.running(self.personal, "User", client_user=self.john)

        codes = {row["code"] for row in self.reading()["attention"]}

        self.assertIn("ACCOUNT_NAME_MISSING", codes)

    def test_a_tidy_situation_raises_nothing(self):
        frappe.db.set_value("MSP Client User", self.john, "username", f"j.{self.tag}")
        self.laptop("A3", holder=self.john, serial=f"A3-{self.tag}")
        self.running(self.personal, "User", client_user=self.john)

        self.assertEqual(self.reading()["attention"], [])


class TestWhatIsOnOfferHere(User360Case):
    def test_the_offer_comes_from_the_service_rules_and_not_from_the_catalogue(self):
        uncovered = self.make_service(f"U360X{self.tag[:3]}", scope="User")

        offered = [row["service_item"] for row in self.reading()["personal_services"]["available"]]

        self.assertIn(self.personal, offered)
        self.assertNotIn(uncovered, offered, "nothing the contract does not cover")

    def test_a_service_they_already_have_is_not_offered_again(self):
        self.running(self.personal, "User", client_user=self.john)

        offered = [row["service_item"] for row in self.reading()["personal_services"]["available"]]

        self.assertNotIn(self.personal, offered)

    def test_the_offer_is_read_machine_by_machine(self):
        first = self.laptop("O1", holder=self.john, serial=f"O1-{self.tag}")
        second = self.laptop("O2", holder=self.john, serial=f"O2-{self.tag}")
        self.running(self.on_device, "Device", managed_device=first)

        reading = self.reading()

        self.assertNotIn(
            self.on_device,
            [row["service_item"] for row in self.slot(reading, first)["services"]["available"]],
        )
        self.assertIn(
            self.on_device,
            [row["service_item"] for row in self.slot(reading, second)["services"]["available"]],
            "one laptop having it says nothing about the next",
        )

    def test_an_archived_person_is_offered_nothing_and_told_why(self):
        frappe.db.set_value("MSP Client User", self.john, "lifecycle_status", "Archived")

        offer = self.reading()["personal_services"]

        self.assertEqual(offer["available"], [])
        self.assertIn("archived", (offer["target_reason"] or "").lower())


class TestThePageCarriesOnlyWhatItShows(User360Case):
    def test_the_whole_catalogue_no_longer_travels_with_the_person(self):
        reading = self.reading()

        for gone in ("catalogue", "customer_requests", "device_types", "interface_types"):
            self.assertNotIn(gone, reading)

    def test_the_past_is_asked_for_separately(self):
        reading = self.reading()

        self.assertNotIn("past_devices", reading)
        self.assertIn("past_devices", self.history())

    def test_the_story_is_told_from_the_records_that_hold_it(self):
        device = self.laptop("H1", holder=self.john, since=-20, serial=f"H1-{self.tag}")
        self.running(self.personal, "User", client_user=self.john, started=-10)
        self.running(self.on_device, "Device", managed_device=device, started=-5)

        said = [event["what"] for event in self.reading()["recent_activity"]]

        self.assertTrue(any("handed over" in entry for entry in said))
        self.assertTrue(
            any(entry.endswith("activated") for entry in said), "their own service, activated"
        )
        self.assertTrue(
            any(" activated on " in entry for entry in said), "and the one on their machine"
        )

    def test_what_happened_on_a_machine_before_they_had_it_is_not_their_story(self):
        device = self.laptop("H2", holder=self.bob, since=-100, serial=f"H2-{self.tag}")
        self.running(self.on_device, "Device", managed_device=device, started=-90)

        DeviceLifecycleService.transfer(
            device=device, client_user=self.john, effective_date=self.day(-10)
        )
        frappe.db.commit()

        said = [event["what"] for event in self.reading()["recent_activity"]]

        self.assertFalse(
            any("activated on" in entry for entry in said),
            "it was already running when the machine reached them",
        )


class TestTheCustomerReadsTheSameThing(User360Case):
    def setUp(self):
        super().setUp()
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"pu{self.tag[:3]}"
        )

    def portal(self, person=None):
        return self.as_user(
            self.manager, lambda: PortalService.get_user_detail(person or self.john)
        )

    def test_the_same_ownership_rule_applies_on_their_side(self):
        device = self.laptop("P1", holder=self.john, serial=f"P1-{self.tag}")
        mine = self.running(self.personal, "User", client_user=self.john)
        machines = self.running(self.on_device, "Device", managed_device=device)

        reading = self.portal()

        self.assertEqual([row["name"] for row in reading["personal_services"]["current"]], [mine])
        self.assertEqual(
            [row["name"] for row in reading["devices"][0]["services"]["current"]], [machines]
        )

    def test_the_customer_is_shown_nothing_that_is_ours(self):
        reading = self.portal()

        for internal_only in ("notes", "billing", "delete_blockers", "can_delete"):
            self.assertNotIn(internal_only, reading)

        self.assertNotIn("portal_access", reading["user"])

    def test_the_customer_is_offered_no_catalogue_of_their_own(self):
        self.laptop("P2", holder=self.john, serial=f"P2-{self.tag}")

        reading = self.portal()

        self.assertEqual(reading["personal_services"]["available"], [])
        self.assertEqual(reading["devices"][0]["services"]["available"], [])

    def test_somebody_at_another_company_is_refused(self):
        elsewhere = self.make_customer(f"{self.tag}B")
        stranger = self.make_person(elsewhere, "Stranger")

        with self.assertRaises(NexgenError):
            self.portal(stranger)
