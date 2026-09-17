"""What a customer reads about their own people and machines: our page, without our notes."""

import frappe

from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.user_360_service import User360Service
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase


class TestTheFilesACustomerReads(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.mine = self.make_customer(f"MINE{self.tag[:4]}")
        self.theirs = self.make_customer(f"THRS{self.tag[:4]}")
        self.track("MSP Approval Authority", self.mine)
        self.track("MSP Approval Authority", self.theirs)

        self.john = self.make_person(self.mine, "John")
        self.stranger = self.make_person(self.theirs, "Stranger")
        self.laptop = self.make_device(
            self.mine, hostname=f"PF{self.tag[:3]}", holder=self.john, serial=f"PF-{self.tag}"
        )
        frappe.db.set_value(
            "MSP Managed Device", self.laptop, {"model": "ThinkPad T14", "remarks": "ours to keep"}
        )
        self.other_box = self.make_device(self.theirs, hostname=f"TH{self.tag[:3]}", serial=f"TH-{self.tag}")

        self.service = self.make_service(f"PF{self.tag[:3]}", scope="Device")
        self.cover_service(self.mine, self.service)
        opened = ServiceLifecycleService.activate(
            customer=self.mine,
            service_item=self.service,
            target_scope="Device",
            managed_device=self.laptop,
        )
        self.track("MSP Service Assignment", opened["name"])
        frappe.db.set_value("MSP Service Assignment", opened["name"], "internal_notes", "for us only")
        frappe.db.commit()

        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.mine, suffix=f"pf{self.tag[:3]}"
        )

    def as_manager(self, fn):
        frappe.set_user(self.manager)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    # ---------------------------------------------------------------- one of their people
    def test_a_person_reads_like_ours_without_our_notes(self):
        reading = self.as_manager(lambda: PortalService.get_user_detail(self.john))
        ours = User360Service.read_user(self.john)

        for section in ("user", "summary", "personal_services", "devices", "open_requests", "attention", "recent_activity"):
            self.assertIn(section, reading)

        # what they are billed for is theirs to read
        self.assertEqual(reading["billing"], ours["billing"])
        self.assertNotIn("notes", reading)
        self.assertNotIn("can_delete", reading)
        self.assertNotIn("delete_blockers", reading)
        self.assertIn("notes", ours)

    def test_the_past_of_one_of_their_people_is_theirs_too(self):
        history = self.as_manager(lambda: PortalService.get_user_history(self.john))

        for section in ("past_devices", "past_personal_services", "past_requests", "activity"):
            self.assertIn(section, history)

    def test_somebody_of_another_company_is_refused(self):
        with self.assertRaises(ValidationError):
            self.as_manager(lambda: PortalService.get_user_detail(self.stranger))

        with self.assertRaises(ValidationError):
            self.as_manager(lambda: PortalService.get_user_history(self.stranger))

    # ---------------------------------------------------------------- one of their machines
    def test_a_machine_reads_like_ours_without_our_notes(self):
        reading = self.as_manager(lambda: PortalService.get_device_detail(self.laptop))

        self.assertEqual(reading["device"]["model"], "ThinkPad T14")
        self.assertEqual(reading["device"]["hostname"], frappe.db.get_value("MSP Managed Device", self.laptop, "hostname"))
        self.assertTrue(reading["holder_log"])
        self.assertTrue(reading["services"])
        self.assertEqual(reading["services"][0]["last_billed_on"], None)

        self.assertNotIn("remarks", reading["device"])
        self.assertNotIn("remark_log", reading["device"])
        self.assertNotIn("can_delete", reading["device"])
        self.assertNotIn("internal_notes", reading["services"][0])
        # the forms are ours: a customer is offered no catalogue to act with
        self.assertNotIn("catalogue", reading)
        self.assertNotIn("customer_requests", reading)

    def test_our_own_reading_still_carries_our_notes(self):
        ours = DeviceService.get_device(self.laptop)

        self.assertEqual(ours["device"]["remarks"], "ours to keep")
        self.assertIn("remark_log", ours["device"])
        self.assertIn("catalogue", ours)
        self.assertEqual(ours["services"][0]["internal_notes"], "for us only")

    def test_another_company_machine_is_refused(self):
        with self.assertRaises(ValidationError):
            self.as_manager(lambda: PortalService.get_device_detail(self.other_box))
