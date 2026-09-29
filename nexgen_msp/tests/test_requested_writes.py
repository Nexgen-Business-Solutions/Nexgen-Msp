"""A request names a future person or an unsettled machine through its Requested records, and only so."""

import json

import frappe

from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService
from nexgen_msp.utils import request_targets
from nexgen_msp.utils.errors import ValidationError

from .writer_case import LINE, REQUESTED_CLIENT_USER, REQUESTED_DEVICE, WriterCase

HOLDER_OPERATIONS = ("device.assign", "device.transfer")


class TestNewRowsNameOneTargetOfEachPair(WriterCase):
    def setUp(self):
        super().setUp()
        self.name = self.send(**self.scenario())["name"]
        self.doc = frappe.get_doc("MSP Request", self.name)

    def exactly_one(self, row, existing, requested):
        return bool(row.get(existing)) != bool(row.get(requested))

    def test_every_subject_names_one_person(self):
        self.assertEqual(len(self.doc.subjects), 3)

        for row in self.doc.subjects:
            self.assertTrue(self.exactly_one(row, "client_user", "requested_client_user"), row.subject_key)

    def test_every_line_names_one_person_one_machine_and_one_holder(self):
        self.assertEqual(len(self.doc.lines), 4)

        for row in self.doc.lines:
            if row.target_scope == "User":
                self.assertTrue(self.exactly_one(row, "client_user", "requested_client_user"), row.idx)

            if row.target_scope == "Device":
                self.assertTrue(self.exactly_one(row, "managed_device", "requested_device"), row.idx)

            if row.operation_code in HOLDER_OPERATIONS:
                self.assertTrue(
                    self.exactly_one(row, "requested_holder", "requested_holder_requested_client_user"),
                    row.idx,
                )

            self.assertFalse(row.requested_for_user and row.requested_for_requested_client_user)

    def test_the_lines_point_at_the_requested_records_of_this_request(self):
        marie = frappe.db.get_value(REQUESTED_CLIENT_USER, {"request": self.name}, "name")
        laptop = frappe.db.get_value(REQUESTED_DEVICE, {"request": self.name}, "name")
        lines = {row.action_group_key: row for row in self.doc.lines}

        self.assertEqual(lines["grp:m365"].requested_client_user, marie)
        self.assertEqual(lines["grp:sophos"].requested_device, laptop)
        self.assertEqual(lines["grp:sophos"].requested_for_requested_client_user, marie)
        self.assertEqual(lines["grp:assign"].requested_device, laptop)
        self.assertEqual(lines["grp:assign"].requested_holder_requested_client_user, marie)
        self.assertEqual(lines["grp:transfer"].managed_device, self.laptop)
        self.assertEqual(lines["grp:transfer"].requested_for_user, self.franck)
        self.assertEqual(lines["grp:transfer"].requested_holder_requested_client_user, marie)

    def test_a_line_carries_the_key_of_its_subject_and_of_its_requested_device(self):
        lines = {row.action_group_key: row for row in self.doc.lines}

        self.assertEqual(lines["grp:m365"].subject_key, "new:marie")
        self.assertEqual(lines["grp:sophos"].subject_key, "new:marie")
        self.assertEqual(lines["grp:sophos"].device_requirement_key, "new-device:laptop")
        self.assertEqual(lines["grp:assign"].device_requirement_key, "new-device:laptop")
        self.assertEqual(lines["grp:transfer"].device_requirement_key, f"device:{self.laptop}")
        self.assertEqual(lines["grp:transfer"].subject_key, f"user:{self.franck}")

    def test_submitted_lines_stay_unchanged_after_resolution(self):
        marie = frappe.db.get_value(REQUESTED_CLIENT_USER, {"request": self.name}, "name")
        RequestService.run_action(name=self.name, action="start_review")
        for row in self.doc.lines:
            RequestService.set_line_status(name=self.name, idx=row.idx, line_status="Approved")
        RequestService.run_action(name=self.name, action="approve")
        before = frappe.get_all(
            LINE,
            filters={"parent": self.name},
            fields=["idx", "client_user", "requested_client_user", "requested_holder", "requested_holder_requested_client_user"],
            order_by="idx asc",
        )

        created = RequestedClientUserService.resolve_create(marie)
        self.track("MSP Client User", created)

        after = frappe.get_all(
            LINE,
            filters={"parent": self.name},
            fields=["idx", "client_user", "requested_client_user", "requested_holder", "requested_holder_requested_client_user"],
            order_by="idx asc",
        )

        self.assertEqual(after, before)


class TestForeignRequestedRecordsAreRefused(WriterCase):
    def test_a_requested_person_of_another_request_is_refused(self):
        first = self.save(**self.scenario())
        stolen = first["subjects"][0]["requested_client_user"]
        payload = self.scenario()
        payload["subjects"][0]["requested_client_user"] = stolen

        with self.assertRaises(ValidationError) as caught:
            self.send(**payload)

        self.assertIn(request_targets.CROSS_REQUEST, str(caught.exception))
        self.assertEqual(frappe.db.count("MSP Request", {"customer": self.customer}), 1)

    def test_a_requested_device_of_another_request_is_refused(self):
        first = self.save(**self.scenario())
        stolen = first["requested_devices"][0]["requested_device"]
        payload = self.scenario()
        payload["requested_devices"][0]["requested_device"] = stolen

        with self.assertRaises(ValidationError):
            self.save(**payload)

        self.assertEqual(frappe.db.count(REQUESTED_DEVICE, {"customer": self.customer}), 1)

    def test_a_requested_device_the_request_does_not_describe_is_refused(self):
        payload = self.scenario()
        payload["requested_devices"] = []

        with self.assertRaises(ValidationError) as caught:
            self.send(**payload)

        self.assertIn("is not a requested Device of this request", str(caught.exception))

    def test_a_machine_of_another_customer_is_refused(self):
        other = self.make_customer(f"WX{self.tag[:4]}")
        theirs = self.make_device(other, hostname=f"WX{self.tag[:4]}", serial=f"ZZTEST-WX-{self.tag}")
        payload = self.scenario()
        payload["action_groups"][3]["targets"][0]["managed_device"] = theirs

        with self.assertRaises(ValidationError) as caught:
            self.send(**payload)

        self.assertIn("does not belong to", str(caught.exception))


class TestTheFormerFlagsAreRefused(WriterCase):
    def test_a_person_described_by_the_former_flag_is_refused(self):
        payload = self.scenario()
        payload["subjects"][0]["is_new_user"] = True

        with self.assertRaises(ValidationError) as caught:
            self.save(**payload)

        self.assertIn("is_new_user is no longer accepted", str(caught.exception))

    def test_a_line_describing_a_machine_by_the_former_fields_is_refused(self):
        with self.assertRaises(ValidationError) as caught:
            self.send(
                lines=[
                    {
                        "operation_code": "service.add",
                        "target_scope": "Device",
                        "client_user": self.helen,
                        "requested_service": self.sophos,
                        "new_device_serial": "SN-OLD",
                    }
                ]
            )

        self.assertIn("new_device_serial is no longer accepted", str(caught.exception))
        self.assertEqual(frappe.db.count("MSP Request", {"customer": self.customer}), 0)


class TestTheRequestedRecordsFollowTheDraft(WriterCase):
    def test_a_person_removed_from_the_draft_loses_their_requested_record(self):
        first = self.save(**self.scenario())
        name = first["name"]
        marie = first["subjects"][0]["requested_client_user"]
        payload = self.scenario()
        payload["subjects"] = payload["subjects"][1:]
        payload["requested_devices"] = []
        payload["action_groups"] = payload["action_groups"][:1]
        payload["action_groups"][0]["targets"] = [self.target(self.existing(self.helen))]
        payload["action_groups"][0]["exclusions"] = []

        self.save(name=name, **payload)

        self.assertFalse(frappe.db.exists(REQUESTED_CLIENT_USER, marie))
        self.assertEqual(self.count(REQUESTED_CLIENT_USER, name), 0)
        self.assertEqual(self.count(REQUESTED_DEVICE, name), 0)

    def test_a_requested_device_removed_from_the_draft_is_deleted(self):
        first = self.save(**self.scenario())
        name = first["name"]
        laptop = first["requested_devices"][0]["requested_device"]
        payload = self.scenario()
        payload["requested_devices"] = []
        payload["action_groups"] = [payload["action_groups"][0], payload["action_groups"][3]]

        self.save(name=name, **payload)

        self.assertFalse(frappe.db.exists(REQUESTED_DEVICE, laptop))
        self.assertEqual(self.count(REQUESTED_CLIENT_USER, name), 1, "Marie is still asked for")

    def test_discarding_a_draft_leaves_no_requested_record(self):
        from nexgen_msp.api.portal.services.portal_service import PortalService

        name = self.save(**self.scenario())["name"]

        self.assertEqual(self.count(REQUESTED_CLIENT_USER, name), 1)
        self.assertEqual(self.count(REQUESTED_DEVICE, name), 1)

        self.as_manager(lambda: PortalService.discard_draft(name))

        self.assertFalse(frappe.db.exists("MSP Request", name))
        self.assertEqual(self.count(REQUESTED_CLIENT_USER, name), 0)
        self.assertEqual(self.count(REQUESTED_DEVICE, name), 0)

    def test_a_refused_submission_writes_nothing(self):
        payload = self.scenario()
        payload["action_groups"].append(
            self.group("grp:twice", "service.add", [self.target(self.marie())], service=self.m365)
        )

        with self.assertRaises(ValidationError):
            self.send(**payload)

        self.assertEqual(frappe.db.count("MSP Request", {"customer": self.customer}), 0)
        self.assertEqual(frappe.db.count(REQUESTED_CLIENT_USER, {"customer": self.customer}), 0)
        self.assertEqual(frappe.db.count(REQUESTED_DEVICE, {"customer": self.customer}), 0)


class TestASubmittedSnapshotIsFrozen(WriterCase):
    def setUp(self):
        super().setUp()
        self.name = self.send(**self.scenario())["name"]
        self.person = frappe.db.get_value(REQUESTED_CLIENT_USER, {"request": self.name}, "name")
        self.device = frappe.db.get_value(REQUESTED_DEVICE, {"request": self.name}, "name")

    def test_the_snapshot_holds_what_was_submitted(self):
        snapshot = json.loads(frappe.db.get_value(REQUESTED_CLIENT_USER, self.person, "requested_snapshot_json"))

        self.assertEqual(snapshot["full_name"], f"ZZTEST Marie {self.tag}")
        self.assertEqual(snapshot["department"], self.department)

    def test_the_draft_writer_can_no_longer_touch_it(self):
        with self.assertRaises(ValidationError):
            RequestedClientUserService.create_or_update_draft(
                self.name, "new:marie", {"full_name": "Somebody Else"}
            )

        with self.assertRaises(ValidationError):
            RequestedDeviceService.create_or_update_draft(
                self.name, "new-device:laptop", {"display_label": "Another laptop"}
            )

    def test_the_snapshot_itself_cannot_be_rewritten(self):
        doc = frappe.get_doc(REQUESTED_CLIENT_USER, self.person)
        doc.requested_snapshot_json = json.dumps({"full_name": "Somebody Else"})

        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

        frappe.db.rollback()

        device = frappe.get_doc(REQUESTED_DEVICE, self.device)
        device.requested_snapshot_json = json.dumps({"display_label": "Another laptop"})

        with self.assertRaises(frappe.ValidationError):
            device.save(ignore_permissions=True)

        frappe.db.rollback()

    def test_the_request_can_no_longer_be_rewritten_as_a_draft(self):
        with self.assertRaises(ValidationError):
            self.save(name=self.name, **self.scenario())
