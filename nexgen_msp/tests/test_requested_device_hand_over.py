"""A Requested Device reaches its intended holder when no line of the request hands it over."""

import frappe

from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService
from nexgen_msp.api.internal.services.requested_entity_presentation import RequestedEntityPresentation
from nexgen_msp.api.internal.services.user_service import UserService

from nexgen_msp.utils.errors import ValidationError as Refused

from .test_requested_execution import RequestedWorkCase
from .writer_case import REQUESTED_DEVICE

DEVICE = "MSP Managed Device"
HOLDER = "MSP Device Holder"


class TestTheIntendedHolderReceivesTheMachine(RequestedWorkCase):
    def sophos_on_the_laptop(self, subject, handed_over=False, **laptop):
        on_it = {"device_requirement_key": "new-device:laptop"}
        groups = [self.group("grp:sophos", "service.add", [self.target(subject, "Device", **on_it)], service=self.sophos)]

        if handed_over:
            groups.append(
                self.group(
                    "grp:assign",
                    "device.assign",
                    [self.target(subject, "Device", requested_holder=subject["client_user"], **on_it)],
                )
            )

        name = self.approved([subject], groups, requested_devices=[self.new_laptop(**laptop)])

        return name, self.requested(name, REQUESTED_DEVICE)[0]

    def holder(self, device):
        return frappe.db.get_value(DEVICE, device, "assigned_client_user")

    def spells(self, device):
        return frappe.db.count(HOLDER, {"parent": device})

    def test_a_registered_machine_goes_to_the_person_it_was_asked_for_once(self):
        _name, rdev = self.sophos_on_the_laptop(
            self.existing(self.helen), intended_holder_subject_key=None, intended_holder_client_user=self.helen
        )
        values = {"hostname": f"ZZHO{self.tag[:4]}", "serial_number": f"ZZTEST-HO-{self.tag}"}

        device = self.as_tech(lambda: RequestedDeviceService.resolve_new(rdev, values))

        self.assertEqual(self.holder(device), self.helen)
        self.assertEqual(frappe.db.get_value(DEVICE, device, "status"), "Active")
        self.assertEqual(self.spells(device), 1)

        again = self.as_tech(lambda: RequestedDeviceService.resolve_new(rdev, values))

        self.assertEqual(again, device)
        self.assertEqual(self.spells(device), 1)
        self.assertEqual(frappe.db.count(DEVICE, {"serial_number": values["serial_number"]}), 1)

    def test_a_machine_somebody_else_holds_changes_hands(self):
        _name, rdev = self.sophos_on_the_laptop(
            self.existing(self.helen), intended_holder_subject_key=None, intended_holder_client_user=self.helen
        )
        self.assertEqual(self.holder(self.laptop), self.franck)

        self.as_tech(lambda: RequestedDeviceService.resolve_existing(rdev, self.laptop))

        self.assertEqual(self.holder(self.laptop), self.helen)
        self.assertEqual(frappe.db.count(HOLDER, {"parent": self.laptop, "client_user": self.franck, "is_current": 0}), 1)
        self.assertEqual(frappe.db.count(HOLDER, {"parent": self.laptop, "client_user": self.helen, "is_current": 1}), 1)

        self.as_tech(lambda: RequestedDeviceService.resolve_existing(rdev, self.laptop))
        self.assertEqual(self.spells(self.laptop), 2)

    def test_a_machine_its_person_already_holds_is_left_alone(self):
        _name, rdev = self.sophos_on_the_laptop(
            self.existing(self.franck), intended_holder_subject_key=None, intended_holder_client_user=self.franck
        )
        before = self.spells(self.laptop)

        self.as_tech(lambda: RequestedDeviceService.resolve_existing(rdev, self.laptop))

        self.assertEqual(self.holder(self.laptop), self.franck)
        self.assertEqual(self.spells(self.laptop), before)

    def blocked_by(self, rdev):
        return RequestedEntityPresentation.device(rdev)["blocked_by"]

    def refused_until_created(self, fn, marie):
        with self.assertRaises(Refused) as caught:
            self.as_tech(fn)

        self.assertEqual(caught.exception.message, f"Create {marie} first: this Device is intended for them.")
        self.assertEqual(caught.exception.code, "HOLDER_NOT_RESOLVED")

    def test_a_machine_for_a_future_person_waits_for_that_person(self):
        marie = self.marie()
        name, rdev = self.sophos_on_the_laptop(marie)
        rcu = self.requested(name)[0]
        values = {"hostname": f"ZZHM{self.tag[:4]}", "serial_number": f"ZZTEST-HM-{self.tag}"}
        machines = frappe.db.count(DEVICE, {"customer": self.customer})

        self.assertEqual(self.blocked_by(rdev), {"name": rcu, "label": marie["full_name"]})
        self.assertEqual(RequestedEntityPresentation.device(rdev)["intended_holder_requested_client_user"], rcu)
        self.refused_until_created(lambda: RequestedDeviceService.resolve_new(rdev, values), marie["full_name"])
        self.refused_until_created(
            lambda: RequestedDeviceService.resolve_existing(rdev, self.laptop), marie["full_name"]
        )
        self.as_tech(lambda: RequestedDeviceService.mark_reviewed(rdev, values))

        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, rdev, ["status", "hostname"]), ("Open", values["hostname"]))
        self.assertEqual(frappe.db.count(DEVICE, {"customer": self.customer}), machines)
        self.assertEqual(self.holder(self.laptop), self.franck)

        person = self.as_tech(lambda: RequestedClientUserService.resolve_create(rcu))

        self.assertIsNone(self.blocked_by(rdev))
        self.assertEqual(frappe.db.count(DEVICE, {"customer": self.customer}), machines)

        device = self.as_tech(lambda: RequestedDeviceService.resolve_new(rdev, values))

        self.assertEqual(self.holder(device), person)
        self.assertEqual(frappe.db.get_value(DEVICE, device, "status"), "Active")
        self.assertEqual(self.spells(device), 1)
        self.assertIsNone(self.blocked_by(rdev))

        self.as_tech(lambda: RequestedDeviceService.resolve_new(rdev, values))
        self.as_tech(lambda: RequestedClientUserService.resolve_create(rcu))
        self.assertEqual(self.spells(device), 1)

    def test_a_machine_for_a_person_who_will_not_come_can_be_prepared(self):
        marie = self.marie()
        name, rdev = self.sophos_on_the_laptop(marie)
        rcu = self.requested(name)[0]
        shelf = self.make_device(self.customer, hostname=f"HC{self.tag[:4]}", serial=f"ZZTEST-HC-{self.tag}")

        self.as_tech(lambda: RequestedClientUserService.cancel(rcu, "Not coming"))

        self.assertIsNone(self.blocked_by(rdev))
        self.assertEqual(self.as_tech(lambda: RequestedDeviceService.resolve_existing(rdev, shelf)), shelf)
        self.assertIsNone(self.holder(shelf))

    def test_a_machine_intended_for_nobody_is_never_held_back(self):
        _name, rdev = self.sophos_on_the_laptop(self.existing(self.helen), intended_holder_subject_key=None)
        shelf = self.make_device(self.customer, hostname=f"HN{self.tag[:4]}", serial=f"ZZTEST-HN-{self.tag}")

        self.assertIsNone(self.blocked_by(rdev))
        self.assertIsNone(RequestedEntityPresentation.device(rdev)["intended_holder_requested_client_user"])
        self.assertEqual(self.as_tech(lambda: RequestedDeviceService.resolve_existing(rdev, shelf)), shelf)
        self.assertIsNone(self.holder(shelf))

    def test_a_line_that_hands_the_machine_over_keeps_the_hand_over_to_itself(self):
        shelf = self.make_device(self.customer, hostname=f"HS{self.tag[:4]}", serial=f"ZZTEST-HS-{self.tag}")
        _name, rdev = self.sophos_on_the_laptop(
            self.existing(self.helen),
            handed_over=True,
            intended_holder_subject_key=None,
            intended_holder_client_user=self.helen,
        )

        self.as_tech(lambda: RequestedDeviceService.resolve_existing(rdev, shelf))

        self.assertIsNone(self.holder(shelf))
        self.assertEqual(self.spells(shelf), 0)

    def test_a_holder_who_cannot_receive_the_machine_leaves_it_where_it_is_and_the_request_says_why(self):
        name, rdev = self.sophos_on_the_laptop(
            self.existing(self.helen), intended_holder_subject_key=None, intended_holder_client_user=self.helen
        )
        self.as_tech(lambda: UserService.disable_client_user(name=self.helen))
        helen = frappe.db.get_value("MSP Client User", self.helen, "full_name")
        before = self.spells(self.laptop)

        resolved = self.as_tech(lambda: RequestedDeviceService.resolve_existing(rdev, self.laptop))

        self.assertEqual(resolved, self.laptop)
        self.assertEqual(
            frappe.db.get_value(REQUESTED_DEVICE, rdev, ["status", "resolved_managed_device"]), ("Resolved", self.laptop)
        )
        self.assertEqual(self.holder(self.laptop), self.franck)
        self.assertEqual(self.spells(self.laptop), before)
        hostname = frappe.db.get_value(DEVICE, self.laptop, "hostname")
        self.assertEqual(
            frappe.get_all(
                "Comment",
                filters={"reference_doctype": "MSP Request", "reference_name": name, "content": ("like", "% was not handed to %")},
                pluck="content",
            ),
            [f"{hostname} was not handed to {helen}: {helen} is disabled and cannot be given a device."],
        )
