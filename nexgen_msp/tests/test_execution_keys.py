"""Every request line says which person and which machine it is about, in the same words.

The technician's workbench works per person and per machine, not per line: someone the
customer wrote once and asked three things for is created once, and three device services
for that same person go onto one machine. Those groupings are what these two keys carry.

They are derived from the line itself rather than sent by the screen that raised the
request, so a request opened by any door groups the same way.
"""

import frappe

from nexgen_msp.api.portal.services.portal_service import PortalService

from .base import MSPTestCase


class ExecutionKeyCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", self.customer)
        self.john = self.make_person(self.customer, "John")
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"ek{self.tag[:3]}"
        )
        self.grant(self.asker, can_submit=1, can_approve=0)

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

    def new_person_line(self, service, full_name="Marie Dupont", **fields):
        return self.line(
            service,
            client_user=None,
            is_new_user=1,
            new_user_full_name=full_name,
            new_user_department=self.make_department("Human Resources"),
            **fields,
        )

    def keys_of(self, name):
        return frappe.get_all(
            "MSP Service Request Line",
            filters={"parent": name},
            fields=["idx", "subject_key", "device_requirement_key"],
            order_by="idx asc",
        )


class TestWhoALineIsAbout(ExecutionKeyCase):
    def test_a_line_for_somebody_on_file_names_their_record(self):
        name = self.raise_request(self.line(self.offering("SKA")))

        self.assertEqual(self.keys_of(name)[0].subject_key, f"user:{self.john}")

    def test_three_things_asked_for_one_person_share_one_key(self):
        name = self.raise_request(
            self.line(self.offering("SKB1")),
            self.line(self.offering("SKB2")),
            self.line(self.offering("SKB3")),
        )

        self.assertEqual(len({row.subject_key for row in self.keys_of(name)}), 1)

    def test_two_different_people_do_not_share_a_key(self):
        bob = self.make_person(self.customer, "Bob")
        service = self.offering("SKC")

        name = self.raise_request(
            self.line(service),
            self.line(service, client_user=bob),
        )

        self.assertEqual(len({row.subject_key for row in self.keys_of(name)}), 2)

    def test_a_person_still_to_be_created_is_keyed_by_the_name_written_for_them(self):
        name = self.raise_request(self.new_person_line(self.offering("SKD")))

        self.assertEqual(self.keys_of(name)[0].subject_key, "new-user:marie dupont")

    def test_the_same_new_person_asked_three_things_is_one_subject(self):
        name = self.raise_request(
            self.new_person_line(self.offering("SKE1")),
            self.new_person_line(self.offering("SKE2")),
            self.new_person_line(self.offering("SKE3")),
        )

        self.assertEqual(len({row.subject_key for row in self.keys_of(name)}), 1)

    def test_two_new_people_in_one_request_are_two_subjects(self):
        service = self.offering("SKF")

        name = self.raise_request(
            self.new_person_line(service, full_name="Marie Dupont"),
            self.new_person_line(service, full_name="Paul Martin"),
        )

        self.assertEqual(len({row.subject_key for row in self.keys_of(name)}), 2)

    def test_a_device_line_is_still_about_the_person_it_was_raised_for(self):
        device = self.make_device(self.customer, hostname="LAPTOP-JD", holder=self.john)
        service = self.offering("SKG", scope="Device")

        name = self.raise_request(
            self.line(service, client_user=None, target_scope="Device", managed_device=device)
        )

        self.assertEqual(self.keys_of(name)[0].subject_key, f"user:{self.john}")


class TestWhichMachineALineNeeds(ExecutionKeyCase):
    def test_a_line_that_needs_no_machine_asks_for_none(self):
        name = self.raise_request(self.line(self.offering("DKA")))

        self.assertIsNone(self.keys_of(name)[0].device_requirement_key)

    def test_a_line_on_a_machine_on_file_names_it(self):
        device = self.make_device(self.customer, hostname="LAPTOP-DKB", holder=self.john)
        service = self.offering("DKB", scope="Device")

        name = self.raise_request(
            self.line(service, client_user=None, target_scope="Device", managed_device=device)
        )

        self.assertEqual(self.keys_of(name)[0].device_requirement_key, f"device:{device}")

    def test_three_services_for_one_machine_yet_to_be_found_share_one_key(self):
        name = self.raise_request(
            self.line(self.offering("DKC1", scope="Device"), is_new_device=1),
            self.line(self.offering("DKC2", scope="Device"), is_new_device=1),
            self.line(self.offering("DKC3", scope="Device"), is_new_device=1),
        )

        keys = {row.device_requirement_key for row in self.keys_of(name)}

        self.assertEqual(len(keys), 1)
        self.assertTrue(keys.pop().startswith("new-device:"))

    def test_a_machine_for_a_new_person_is_keyed_to_that_person(self):
        name = self.raise_request(
            self.new_person_line(self.offering("DKD", scope="Device"), is_new_device=1)
        )

        self.assertEqual(
            self.keys_of(name)[0].device_requirement_key, "new-device:new-user:marie dupont"
        )

    def test_two_people_each_owed_a_machine_do_not_share_one(self):
        bob = self.make_person(self.customer, "Bob")
        service = self.offering("DKE", scope="Device")

        name = self.raise_request(
            self.line(service, is_new_device=1),
            self.line(service, client_user=bob, is_new_device=1),
        )

        self.assertEqual(len({row.device_requirement_key for row in self.keys_of(name)}), 2)


class TestTheKeysFollowTheLine(ExecutionKeyCase):
    def test_they_are_written_on_a_draft_too(self):
        service = self.offering("DRAFT")

        saved = self.as_user(
            self.asker,
            lambda: PortalService.save_draft(
                customer=self.customer,
                request_type="Add",
                lines=[self.line(service)],
            ),
        )
        name = self.track("MSP Service Request", saved["name"])

        self.assertEqual(self.keys_of(name)[0].subject_key, f"user:{self.john}")

    def test_nobody_can_hand_us_a_key_of_their_own(self):
        name = self.raise_request(self.line(self.offering("FORGE"), subject_key="user:someone-else"))

        self.assertEqual(self.keys_of(name)[0].subject_key, f"user:{self.john}")
