"""A draft reopened is the draft that was saved, and saving it again changes nothing."""

import frappe

from .writer_case import LINE, REQUEST, REQUESTED_CLIENT_USER, REQUESTED_DEVICE, WriterCase


class TestADraftComesBackAsItWasSaved(WriterCase):
    def setUp(self):
        super().setUp()
        self.first = self.save(**self.scenario())
        self.name = self.first["name"]
        self.reopened = self.reopen(self.name)
        self.second = self.save(name=self.name, **self.payload_of(self.reopened))
        self.again = self.reopen(self.name)

    def groups(self, reading):
        return {group["group_key"]: group for group in reading["action_groups"]}

    def test_the_same_requested_person_and_device_are_kept(self):
        marie = self.first["subjects"][0]["requested_client_user"]
        laptop = self.first["requested_devices"][0]["requested_device"]

        self.assertTrue(marie)
        self.assertTrue(laptop)
        self.assertEqual(self.reopened["subjects"][0]["requested_client_user"], marie)
        self.assertEqual(self.again["subjects"][0]["requested_client_user"], marie)
        self.assertEqual(self.again["requested_devices"][0]["requested_device"], laptop)
        self.assertEqual(self.count(REQUESTED_CLIENT_USER, self.name), 1, "no second person after saving twice")
        self.assertEqual(self.count(REQUESTED_DEVICE, self.name), 1, "no second Device after saving twice")

    def test_the_people_come_back_with_their_kind_and_values(self):
        subjects = {row["subject_key"]: row for row in self.again["subjects"]}

        self.assertEqual(subjects["new:marie"]["kind"], "new")
        self.assertIsNone(subjects["new:marie"]["client_user"])
        self.assertEqual(subjects["new:marie"]["full_name"], f"ZZTEST Marie {self.tag}")
        self.assertEqual(subjects["new:marie"]["department"], self.department)
        self.assertEqual(subjects[f"user:{self.helen}"]["kind"], "existing")
        self.assertEqual(subjects[f"user:{self.helen}"]["client_user"], self.helen)
        self.assertIsNone(subjects[f"user:{self.helen}"]["requested_client_user"])
        self.assertNotIn("is_new_user", subjects["new:marie"])

    def test_the_requested_device_comes_back_with_what_was_given(self):
        laptop = self.again["requested_devices"][0]

        self.assertEqual(laptop["device_requirement_key"], "new-device:laptop")
        self.assertEqual(laptop["display_label"], "New laptop")
        self.assertEqual(laptop["device_type"], "Laptop")
        self.assertEqual(laptop["intended_holder_subject_key"], "new:marie")
        self.assertEqual(
            laptop["intended_holder_requested_client_user"],
            self.first["subjects"][0]["requested_client_user"],
        )

    def test_the_same_groups_and_targets_come_back(self):
        before = self.groups(self.first)
        after = self.groups(self.again)

        self.assertEqual(list(before), ["grp:m365", "grp:assign", "grp:sophos", "grp:transfer"])
        self.assertEqual(list(after), list(before))

        for key in before:
            self.assertEqual(
                after[key]["configuration"]["targets"],
                before[key]["configuration"]["targets"],
                f"{key}: the targets saved are the targets reopened",
            )

    def test_the_saved_targets_hold_canonical_requested_references(self):
        marie = self.first["subjects"][0]["requested_client_user"]
        laptop = self.first["requested_devices"][0]["requested_device"]
        groups = self.groups(self.again)

        self.assertEqual(groups["grp:m365"]["configuration"]["targets"][0]["requested_client_user"], marie)
        self.assertEqual(groups["grp:sophos"]["configuration"]["targets"][0]["requested_device"], laptop)
        self.assertEqual(groups["grp:assign"]["configuration"]["targets"][0]["requested_device"], laptop)

    def test_the_transfer_still_goes_to_the_same_person(self):
        marie = self.first["subjects"][0]["requested_client_user"]
        target = self.groups(self.again)["grp:transfer"]["configuration"]["targets"][0]

        self.assertEqual(target["requested_holder_subject_key"], "new:marie")
        self.assertEqual(target["requested_holder_requested_client_user"], marie)
        self.assertEqual(target["managed_device"], self.laptop)

        line = frappe.db.get_value(
            LINE,
            {"parent": self.name, "action_group_key": "grp:transfer"},
            ["managed_device", "requested_holder", "requested_holder_requested_client_user"],
            as_dict=True,
        )

        self.assertEqual(line.requested_holder_requested_client_user, marie)
        self.assertIsNone(line.requested_holder)

    def test_a_target_left_out_by_hand_stays_left_out(self):
        m365 = self.groups(self.again)["grp:m365"]

        self.assertEqual(
            [row["subject_key"] for row in m365["configuration"]["exclusions"]],
            [f"user:{self.helen}"],
        )
        self.assertEqual(m365["configuration"]["exclusions"][0]["reason_code"], "UNCHECKED")
        self.assertEqual(len(m365["configuration"]["targets"]), 1)

    def test_the_request_level_values_come_back(self):
        self.assertEqual(str(self.again["requested_date"]), str(self.scenario()["requested_date"]))
        self.assertEqual(self.again["priority"], "High")
        self.assertEqual(self.again["details"], "Marie starts on Monday.")
        self.assertEqual(frappe.db.get_value(REQUEST, self.name, "status"), "Draft")

    def test_every_line_takes_the_date_of_the_request(self):
        dates = set(
            frappe.get_all(LINE, filters={"parent": self.name}, pluck="requested_effective_date")
        )

        self.assertEqual({str(day) for day in dates}, {str(self.scenario()["requested_date"])})

    def test_it_says_it_can_be_restored(self):
        self.assertTrue(self.first["restorable"])
        self.assertTrue(self.again["restorable"])

    def test_the_reopened_draft_can_be_sent(self):
        sent = self.send(name=self.name, **self.payload_of(self.again))

        self.assertEqual(sent["name"], self.name)
        self.assertEqual(sent["status"], "Submitted")
        self.assertEqual(self.count(REQUESTED_CLIENT_USER, self.name), 1)
        self.assertEqual(self.count(REQUESTED_DEVICE, self.name), 1)


class TestADraftThatCannotBeRestored(WriterCase):
    def test_a_draft_written_as_lines_only_is_not_restorable(self):
        out = self.save(
            lines=[
                {
                    "operation_code": "service.add",
                    "target_scope": "User",
                    "client_user": self.helen,
                    "requested_service": self.m365,
                }
            ]
        )

        self.assertFalse(out["restorable"])

    def test_a_group_without_its_configuration_is_not_restorable(self):
        name = self.save(**self.scenario())["name"]
        frappe.db.set_value(
            "MSP Request Action Group", {"parent": name, "group_key": "grp:m365"}, "configuration_snapshot_json", None
        )
        frappe.db.commit()

        self.assertFalse(self.reopen(name)["restorable"])
