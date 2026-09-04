"""A serial names one machine, a username one account at a customer — from every door.

Both rules live on the records. The three places that write these identifiers without
going through `save()` must still ask them, or the next edit of the record is refused for
something a form did months earlier.
"""

import frappe

from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import identifiers
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase


class TestIdentifiersKeepTheirRules(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.service = self.make_service("ID", scope="Both")
        self.alice = self.make_person(self.customer, "Alice")
        self.bob = self.make_person(self.customer, "Bob")
        frappe.db.set_value("MSP Client User", self.alice, "username", "taken")
        self.box_a = self.make_device(self.customer, hostname="BOXA", serial="SN-TAKEN")
        self.box_b = self.make_device(self.customer, hostname="BOXB")
        self.asker = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="ida")
        self.grant(self.asker)
        self.tech = self.make_account("internal", "MSP Technician", suffix="idt")

    def as_user(self, email, fn):
        frappe.set_user(email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    # ------------------------------------------------------------- the door itself
    def test_a_username_already_used_at_the_customer_is_refused(self):
        with self.assertRaises(ValidationError):
            identifiers.record_username(self.bob, "taken")

        self.assertFalse(frappe.db.get_value("MSP Client User", self.bob, "username"))

    def test_the_same_username_at_another_customer_is_fine(self):
        elsewhere = self.make_customer(suffix="B")
        carol = self.make_person(elsewhere, "Carol")

        self.assertTrue(identifiers.record_username(carol, "taken"))
        frappe.get_doc("MSP Client User", carol).save(ignore_permissions=True)

    def test_a_serial_already_on_another_machine_is_refused(self):
        with self.assertRaises(ValidationError):
            identifiers.record_serial(self.box_b, "SN-TAKEN")

        self.assertFalse(frappe.db.get_value("MSP Managed Device", self.box_b, "serial_number"))

    def test_a_value_on_file_is_kept_unless_told_otherwise(self):
        self.assertFalse(identifiers.record_username(self.alice, "other"))
        self.assertEqual(frappe.db.get_value("MSP Client User", self.alice, "username"), "taken")

        self.assertTrue(identifiers.record_username(self.alice, "other", overwrite=True))
        self.assertEqual(frappe.db.get_value("MSP Client User", self.alice, "username"), "other")

    def test_what_was_written_still_saves_afterwards(self):
        identifiers.record_username(self.bob, "  fresh  ")
        identifiers.record_serial(self.box_b, " SN-NEW ")

        frappe.get_doc("MSP Client User", self.bob).save(ignore_permissions=True)
        frappe.get_doc("MSP Managed Device", self.box_b).save(ignore_permissions=True)

        self.assertEqual(frappe.db.get_value("MSP Client User", self.bob, "username"), "fresh")
        self.assertEqual(frappe.db.get_value("MSP Managed Device", self.box_b, "serial_number"), "SN-NEW")

    # ------------------------------------------------ the customer, when raising
    def test_the_customer_cannot_hand_a_person_a_colleagues_username(self):
        with self.assertRaises(ValidationError):
            self.as_user(
                self.asker,
                lambda: PortalService.create_request(
                    customer=self.customer,
                    request_type="Add",
                    lines=[
                        {
                            "request_action": self.action(),
                            "action": "Add",
                            "target_scope": "User",
                            "client_user": self.bob,
                            "new_user_username": "taken",
                            "requested_service": self.service,
                        }
                    ],
                ),
            )

        self.assertFalse(frappe.db.get_value("MSP Client User", self.bob, "username"))

    def test_the_customer_cannot_hand_a_machine_another_machines_serial(self):
        with self.assertRaises(ValidationError):
            self.as_user(
                self.asker,
                lambda: PortalService.create_request(
                    customer=self.customer,
                    request_type="Add",
                    lines=[
                        {
                            "request_action": self.action(),
                            "action": "Add",
                            "target_scope": "Device",
                            "managed_device": self.box_b,
                            "new_device_serial": "SN-TAKEN",
                            "requested_service": self.service,
                        }
                    ],
                ),
            )

        self.assertFalse(frappe.db.get_value("MSP Managed Device", self.box_b, "serial_number"))

    # ------------------------------------------ the technician, when delivering
    def test_the_technician_is_refused_a_duplicate_username_at_closure(self):
        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=[
                    {
                        "request_action": self.action(),
                        "action": "Add",
                        "target_scope": "User",
                        "client_user": self.bob,
                        "requested_service": self.service,
                    }
                ],
            ),
        )
        name = self.track("MSP Service Request", out["name"])

        with self.assertRaises(ValidationError):
            self.as_user(
                self.tech, lambda: RequestService.set_delivery_detail(name, 1, username="taken")
            )

        self.as_user(self.tech, lambda: RequestService.set_delivery_detail(name, 1, username="b.bob"))
        self.assertEqual(frappe.db.get_value("MSP Client User", self.bob, "username"), "b.bob")

    def test_delivery_from_the_profile_asks_the_same_rules(self):
        with self.assertRaises(ValidationError):
            UserService._record_identifiers(self.bob, self.box_b, "SN-TAKEN", None)

        with self.assertRaises(ValidationError):
            UserService._record_identifiers(self.bob, None, None, "taken")

        UserService._record_identifiers(self.bob, self.box_b, "SN-OK", "b.bob")
        self.assertEqual(frappe.db.get_value("MSP Managed Device", self.box_b, "serial_number"), "SN-OK")
        self.assertEqual(frappe.db.get_value("MSP Client User", self.bob, "username"), "b.bob")
