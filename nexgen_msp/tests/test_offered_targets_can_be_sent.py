"""What the builder is offered for an act can be sent as it was offered."""

import frappe

from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService
from nexgen_msp.utils import request_intents
from nexgen_msp.utils.errors import ValidationError

from .writer_case import WriterCase


class TestOfferedTargetsCanBeSent(WriterCase):
    def offered(self, subjects, groups, service, code="service.add"):
        options = self.as_manager(
            lambda: RequestScopeService.operation_options(
                customer=self.customer, subjects=subjects, action_groups=groups
            )
        )

        for domain in options["domains"]:
            if domain["key"] != "Service":
                continue

            for card in domain["options"]:
                if card["object_key"] != service:
                    continue

                for action in card["actions"]:
                    if action["operation_code"] == code:
                        return action["targets"]

        return []

    def test_a_machine_changing_hands_is_offered_once_for_its_service(self):
        franck = self.existing(self.franck)
        helen = self.existing(self.helen)
        moving = self.group(
            "grp:move",
            "device.transfer",
            [
                self.target(
                    franck,
                    scope="Device",
                    managed_device=self.laptop,
                    requested_holder=self.helen,
                )
            ],
        )
        targets = self.offered([franck, helen], [moving], self.sophos)

        self.assertEqual(
            [target["managed_device"] for target in targets],
            [self.laptop],
            "one machine is one target, whoever holds it today and whoever receives it",
        )

    def test_the_service_offered_with_a_transfer_can_be_sent_with_it(self):
        franck = self.existing(self.franck)
        helen = self.existing(self.helen)
        moving = self.group(
            "grp:move",
            "device.transfer",
            [
                self.target(
                    franck,
                    scope="Device",
                    managed_device=self.laptop,
                    requested_holder=self.helen,
                )
            ],
        )
        targets = self.offered([franck, helen], [moving], self.sophos)
        covering = self.group("grp:cover", "service.add", targets, service=self.sophos)

        sent = self.send(subjects=[franck, helen], action_groups=[moving, covering])
        lines = frappe.get_doc("MSP Request", sent["name"]).lines

        self.assertEqual(
            sorted((row.operation_code, row.managed_device) for row in lines),
            [("device.transfer", self.laptop), ("service.add", self.laptop)],
        )

    def test_the_same_service_for_two_people_to_come_is_two_lines(self):
        marie = self.marie()
        paul = self.marie(subject_key="new:paul", full_name=f"ZZTEST Paul {self.tag}")
        adding = self.group(
            "grp:add", "service.add", [self.target(marie), self.target(paul)], service=self.m365
        )

        sent = self.send(subjects=[marie, paul], action_groups=[adding])
        lines = frappe.get_doc("MSP Request", sent["name"]).lines

        self.assertEqual(len(lines), 2)
        self.assertEqual(len({row.requested_client_user for row in lines}), 2)

    def test_a_machine_asked_for_two_people_to_come_is_two_lines(self):
        marie = self.marie()
        paul = self.marie(subject_key="new:paul", full_name=f"ZZTEST Paul {self.tag}")
        asking = self.group(
            "grp:ask",
            "device.assign",
            [
                self.target(marie, scope="Device", requested_holder_subject_key="new:marie"),
                self.target(paul, scope="Device", requested_holder_subject_key="new:paul"),
            ],
        )

        sent = self.send(subjects=[marie, paul], action_groups=[asking])
        lines = frappe.get_doc("MSP Request", sent["name"]).lines

        self.assertEqual(len(lines), 2)
        self.assertEqual(len({row.requested_device for row in lines}), 2)

    def test_a_service_on_two_machines_of_one_person_can_be_ended_on_both(self):
        second = self.make_device(
            self.customer,
            hostname=f"W2{self.tag[:4]}",
            holder=self.franck,
            serial=f"ZZTEST-W2-{self.tag}",
        )

        for device in (self.laptop, second):
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=self.sophos,
                target_scope="Device",
                managed_device=device,
                effective_date=str(frappe.utils.add_days(frappe.utils.today(), -30)),
            )

        franck = self.existing(self.franck)
        targets = self.offered([franck], [], self.sophos, code="service.end")

        self.assertEqual(
            sorted(target["managed_device"] for target in targets), sorted([self.laptop, second])
        )

        ending = self.group("grp:end", "service.end", targets, service=self.sophos)
        sent = self.send(subjects=[franck], action_groups=[ending])
        lines = frappe.get_doc("MSP Request", sent["name"]).lines

        self.assertEqual(
            sorted(row.managed_device for row in lines), sorted([self.laptop, second])
        )
        self.assertEqual(len({row.source_service_assignment for row in lines}), 2)

    def test_one_machine_asked_for_two_people_is_refused_in_plain_words(self):
        spare = self.make_device(
            self.customer, hostname=f"SP{self.tag[:4]}", serial=f"ZZTEST-SP-{self.tag}"
        )
        franck = self.existing(self.franck)
        helen = self.existing(self.helen)
        asking = self.group(
            "grp:ask",
            "device.assign",
            [
                self.target(franck, scope="Device", managed_device=spare, requested_holder=self.franck),
                self.target(helen, scope="Device", managed_device=spare, requested_holder=self.helen),
            ],
        )
        before = frappe.db.count("MSP Request", {"customer": self.customer})

        with self.assertRaises(ValidationError) as caught:
            self.send(subjects=[franck, helen], action_groups=[asking])

        self.assertIn(request_intents.ONE_DESTINATION, str(caught.exception))
        self.assertIn(
            frappe.db.get_value("MSP Managed Device", spare, "hostname"), str(caught.exception)
        )
        self.assertEqual(frappe.db.count("MSP Request", {"customer": self.customer}), before)

    def test_one_requested_machine_asked_for_two_people_is_refused_in_plain_words(self):
        franck = self.existing(self.franck)
        helen = self.existing(self.helen)
        laptop = self.new_laptop(intended_holder_subject_key=None)
        asking = self.group(
            "grp:ask",
            "device.assign",
            [
                self.target(
                    franck,
                    scope="Device",
                    device_requirement_key=laptop["device_requirement_key"],
                    requested_holder=self.franck,
                ),
                self.target(
                    helen,
                    scope="Device",
                    device_requirement_key=laptop["device_requirement_key"],
                    requested_holder=self.helen,
                ),
            ],
        )

        with self.assertRaises(ValidationError) as caught:
            self.send(
                subjects=[franck, helen], requested_devices=[laptop], action_groups=[asking]
            )

        self.assertIn(request_intents.ONE_DESTINATION, str(caught.exception))
        self.assertEqual(frappe.db.count("MSP Requested Device", {"customer": self.customer}), 0)

    def test_one_machine_asked_twice_for_the_same_person_in_one_act_is_one_line(self):
        spare = self.make_device(
            self.customer, hostname=f"SQ{self.tag[:4]}", serial=f"ZZTEST-SQ-{self.tag}"
        )
        helen = self.existing(self.helen)
        once = self.target(helen, scope="Device", managed_device=spare, requested_holder=self.helen)
        asking = self.group("grp:ask", "device.assign", [once, dict(once)])

        sent = self.send(subjects=[helen], action_groups=[asking])

        self.assertEqual(len(frappe.get_doc("MSP Request", sent["name"]).lines), 1)

    def test_what_runs_on_a_machine_changing_hands_follows_the_machine(self):
        ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.sophos,
            target_scope="Device",
            managed_device=self.laptop,
            effective_date=str(frappe.utils.add_days(frappe.utils.today(), -30)),
        )
        franck = self.existing(self.franck)
        helen = self.existing(self.helen)
        moving = self.group(
            "grp:move",
            "device.transfer",
            [
                self.target(
                    franck,
                    scope="Device",
                    managed_device=self.laptop,
                    requested_holder=self.helen,
                )
            ],
        )

        for subjects in ([franck, helen], [helen], [franck]):
            adding = self.offered(subjects, [moving], self.sophos)
            ending = self.offered(subjects, [moving], self.sophos, code="service.end")

            self.assertEqual(adding, [], "what already runs on the machine is not offered again")
            self.assertEqual([target["managed_device"] for target in ending], [self.laptop])

        ending = self.group("grp:end", "service.end", ending, service=self.sophos)
        sent = self.send(subjects=[franck, helen], action_groups=[moving, ending])
        lines = frappe.get_doc("MSP Request", sent["name"]).lines

        self.assertEqual(
            sorted((row.operation_code, row.managed_device) for row in lines),
            [("device.transfer", self.laptop), ("service.end", self.laptop)],
        )
