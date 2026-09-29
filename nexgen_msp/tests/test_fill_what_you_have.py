"""A requester says what they know: a name is enough for a person, and nothing is needed for a machine."""

import json

import frappe

from nexgen_msp.utils.errors import ValidationError

from .writer_case import LINE, REQUESTED_CLIENT_USER, REQUESTED_DEVICE, WriterCase


class TestFillWhatYouHave(WriterCase):
    def only_marie(self, **values):
        marie = {
            "subject_key": "new:marie",
            "kind": "new",
            "full_name": f"ZZTEST Marie {self.tag}",
            **values,
        }

        return marie, self.group("grp:m365", "service.add", [self.target(marie)], service=self.m365)

    def test_a_full_name_is_all_a_new_person_needs(self):
        marie, group = self.only_marie()
        out = self.send(subjects=[marie], action_groups=[group])

        self.assertEqual(out["status"], "Submitted")

        person = frappe.db.get_value(
            REQUESTED_CLIENT_USER,
            {"request": out["name"]},
            ["full_name", "department", "email", "username", "external_employee_id", "start_date", "requested_snapshot_json"],
            as_dict=True,
        )

        self.assertEqual(person.full_name, f"ZZTEST Marie {self.tag}")
        self.assertEqual(
            (person.department, person.email, person.username, person.external_employee_id, person.start_date),
            (None, None, None, None, None),
        )
        self.assertEqual(json.loads(person.requested_snapshot_json)["full_name"], f"ZZTEST Marie {self.tag}")

    def test_a_new_person_without_a_name_is_refused(self):
        marie, group = self.only_marie(full_name="  ")

        with self.assertRaises(ValidationError) as caught:
            self.send(subjects=[marie], action_groups=[group])

        self.assertIn("A full name is required.", str(caught.exception))

    def test_a_service_that_uses_a_username_does_not_make_it_required(self):
        marie, group = self.only_marie()
        out = self.send(subjects=[marie], action_groups=[group])

        line = frappe.db.get_value(
            LINE, {"parent": out["name"]}, ["requested_client_user", "line_status"], as_dict=True
        )

        self.assertTrue(line.requested_client_user)
        self.assertIsNone(frappe.db.get_value(REQUESTED_CLIENT_USER, line.requested_client_user, "username"))

    def test_the_other_values_are_kept_when_they_are_given(self):
        marie, group = self.only_marie(
            department=self.department,
            email=f"marie.{self.tag}@example.invalid",
            username=f"m.{self.tag}",
            external_employee_id=f"E-{self.tag}",
            start_date="2026-10-05",
        )
        out = self.send(subjects=[marie], action_groups=[group])
        person = frappe.get_doc(
            REQUESTED_CLIENT_USER,
            frappe.db.get_value(REQUESTED_CLIENT_USER, {"request": out["name"]}, "name"),
        )

        self.assertEqual(person.department, self.department)
        self.assertEqual(person.username, f"m.{self.tag}")
        self.assertEqual(person.external_employee_id, f"E-{self.tag}")
        self.assertEqual(str(person.start_date), "2026-10-05")

    def test_a_requested_device_needs_nothing_at_all(self):
        helen = self.existing(self.helen)
        out = self.send(
            subjects=[helen],
            requested_devices=[{"device_requirement_key": "new-device:any"}],
            action_groups=[
                self.group(
                    "grp:assign",
                    "device.assign",
                    [self.target(helen, "Device", device_requirement_key="new-device:any", requested_holder=self.helen)],
                ),
                self.group(
                    "grp:sophos",
                    "service.add",
                    [self.target(helen, "Device", device_requirement_key="new-device:any")],
                    service=self.sophos,
                ),
            ],
        )

        self.assertEqual(out["status"], "Submitted")

        device = frappe.db.get_value(
            REQUESTED_DEVICE,
            {"request": out["name"]},
            ["display_label", "hostname", "serial_number", "device_type"],
            as_dict=True,
        )

        self.assertEqual(device.display_label, "New device")
        self.assertEqual((device.hostname, device.serial_number), (None, None))
        self.assertFalse(device.device_type)

    def test_a_machine_asked_for_without_naming_one_becomes_a_requested_device(self):
        helen = self.existing(self.helen)
        out = self.send(
            subjects=[helen],
            action_groups=[
                self.group(
                    "grp:any",
                    "device.assign",
                    [self.target(helen, "Device", requested_holder=self.helen)],
                )
            ],
        )

        self.assertEqual(frappe.db.count(REQUESTED_DEVICE, {"request": out["name"]}), 1)
        self.assertEqual(out["requested_devices"][0]["intended_holder_client_user"], self.helen)
        self.assertEqual(out["lines"][0]["requested_device"], out["requested_devices"][0]["requested_device"])
