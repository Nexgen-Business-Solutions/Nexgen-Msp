"""A Requested entity is resolved, cancelled or prepared only while its request is being carried out."""

import frappe

from nexgen_msp.api.internal.endpoints import v1
from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService
from nexgen_msp.utils.errors import ValidationError as Refused

from .test_requested_execution import RequestedWorkCase
from .writer_case import LINE, REQUESTED_CLIENT_USER, REQUESTED_DEVICE

REFUSAL = "This requested target belongs to a request that is not being carried out."
CLOSED = ("Draft", "Awaiting Customer Approval", "Submitted", "Rejected", "Cancelled", "Completed")


class TestResolutionFollowsTheRequest(RequestedWorkCase):
    def setUp(self):
        super().setUp()
        frappe.db.set_value("MSP Client User", self.helen, "username", f"zz.g{self.tag[:4]}")
        marie = self.marie()
        helen = self.existing(self.helen)
        self.name = self.approved(
            [marie, helen],
            [
                self.group("grp:m365", "service.add", [self.target(marie), self.target(helen)], service=self.m365),
                self.group(
                    "grp:sophos",
                    "service.add",
                    [self.target(helen, "Device", device_requirement_key="new-device:laptop")],
                    service=self.sophos,
                ),
            ],
            requested_devices=[self.new_laptop(intended_holder_subject_key=None, intended_holder_client_user=self.helen)],
        )
        self.rcu = self.requested(self.name)[0]
        self.rdev = self.requested(self.name, REQUESTED_DEVICE)[0]
        self.shelf = self.make_device(self.customer, hostname=f"GS{self.tag[:4]}", serial=f"ZZTEST-GS-{self.tag}")
        frappe.db.commit()

    def status(self, value):
        frappe.db.set_value("MSP Request", self.name, "status", value)
        frappe.db.commit()

    def refused(self, fn):
        with self.assertRaises(Refused) as caught:
            self.as_tech(fn)

        self.assertEqual(caught.exception.message, REFUSAL)
        self.assertEqual(caught.exception.code, "REQUEST_NOT_IN_PROGRESS")

    def untouched(self):
        self.assertEqual(frappe.db.get_value(REQUESTED_CLIENT_USER, self.rcu, "status"), "Open")
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, self.rdev, "status"), "Open")
        self.assertEqual(frappe.db.count("MSP Client User", {"full_name": f"ZZTEST Marie {self.tag}"}), 0)

    def test_nothing_is_resolved_or_cancelled_outside_the_work(self):
        for status in CLOSED:
            self.status(status)

            with self.subTest(status=status):
                self.refused(lambda: RequestedClientUserService.resolve_create(self.rcu))
                self.refused(lambda: RequestedClientUserService.resolve_existing(self.rcu, self.franck))
                self.refused(lambda: RequestedClientUserService.cancel(self.rcu, "No"))
                self.refused(lambda: RequestedDeviceService.resolve_existing(self.rdev, self.shelf))
                self.refused(lambda: RequestedDeviceService.resolve_new(self.rdev, {"hostname": f"ZZG{self.tag[:4]}"}))
                self.refused(lambda: RequestedDeviceService.cancel(self.rdev, "No"))
                self.untouched()

        self.assertIsNone(frappe.db.get_value("MSP Managed Device", self.shelf, "assigned_client_user"))

    def test_the_endpoints_answer_the_refusal_code(self):
        self.status("Submitted")

        out = self.as_tech(lambda: v1.resolve_requested_client_user(name=self.rcu, mode="create"))

        self.assertFalse(out["success"])
        self.assertIn(REFUSAL, str(out))
        self.assertIn("REQUEST_NOT_IN_PROGRESS", str(out))
        self.untouched()

    def test_saving_progress_opens_at_review_and_closes_with_the_work(self):
        for status in ("Draft", "Awaiting Customer Approval", "Submitted", "Rejected", "Cancelled", "Completed"):
            self.status(status)

            with self.subTest(status=status):
                self.refused(lambda: RequestedClientUserService.mark_reviewed(self.rcu, {"email": "x@example.invalid"}))
                self.refused(lambda: RequestedDeviceService.mark_reviewed(self.rdev, {"hostname": "zz-x"}))

        self.assertFalse(frappe.db.get_value(REQUESTED_CLIENT_USER, self.rcu, "reviewed_at"))
        self.assertFalse(frappe.db.get_value(REQUESTED_DEVICE, self.rdev, "reviewed_at"))

        for status in ("Under Review", "Approved", "In Progress"):
            self.status(status)
            self.as_tech(lambda: RequestedDeviceService.mark_reviewed(self.rdev, {"hostname": f"zz-{status[:2]}"}))
            self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, self.rdev, "hostname"), f"zz-{status[:2]}")

        self.assertTrue(frappe.db.get_value(REQUESTED_DEVICE, self.rdev, "reviewed_at"))

    def test_an_entity_whose_lines_were_all_rejected_is_not_worked_on(self):
        frappe.db.set_value(LINE, {"parent": self.name, "requested_client_user": self.rcu}, "line_status", "Rejected")
        frappe.db.set_value(LINE, {"parent": self.name, "requested_device": self.rdev}, "line_status", "Rejected")
        frappe.db.commit()

        self.refused(lambda: RequestedClientUserService.resolve_create(self.rcu))
        self.refused(lambda: RequestedClientUserService.cancel(self.rcu, "No"))
        self.refused(lambda: RequestedDeviceService.resolve_existing(self.rdev, self.shelf))
        self.untouched()

    def test_while_the_work_runs_resolution_and_cancellation_go_through(self):
        for status in ("Approved", "In Progress"):
            self.status(status)
            self.assertEqual(
                self.as_tech(lambda: RequestedClientUserService.resolve_existing(self.rcu, self.franck)), self.franck
            )

        self.as_tech(lambda: RequestedDeviceService.cancel(self.rdev, "Not needed"))

        self.assertEqual(frappe.db.get_value(REQUESTED_CLIENT_USER, self.rcu, "status"), "Resolved")
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, self.rdev, "status"), "Cancelled")
