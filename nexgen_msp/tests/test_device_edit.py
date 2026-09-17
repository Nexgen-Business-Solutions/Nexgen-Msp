"""What editing a machine may change about it, and what it leaves alone."""

import frappe

from nexgen_msp.api.internal.services.device_service import DeviceService

from .base import MSPTestCase


class TestEditingAMachine(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", self.customer)
        self.box = self.make_device(self.customer, hostname=f"ED{self.tag[:3]}", serial=f"ED-{self.tag}")

    def saved(self, **changes):
        DeviceService.update_device(device=self.box, serial_number=f"ED-{self.tag}", **changes)

        return frappe.db.get_value(
            "MSP Managed Device", self.box, ["manufacturer", "model", "operating_system"], as_dict=True
        )

    def test_the_manufacturer_model_and_system_are_written(self):
        box = self.saved(manufacturer="Lenovo", model="ThinkPad T14", operating_system="Windows 11")

        self.assertEqual((box.manufacturer, box.model, box.operating_system), ("Lenovo", "ThinkPad T14", "Windows 11"))

    def test_a_field_left_out_is_left_as_it_was(self):
        self.saved(manufacturer="Lenovo", model="ThinkPad T14")

        box = self.saved(operating_system="Windows 11")

        self.assertEqual((box.manufacturer, box.model), ("Lenovo", "ThinkPad T14"))

    def test_a_field_sent_empty_is_cleared(self):
        self.saved(manufacturer="Lenovo")

        self.assertIsNone(self.saved(manufacturer="").manufacturer)


class TestRegisteringAMachine(MSPTestCase):
    """Wherever a machine is registered from, what its case says is kept."""

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", self.customer)
        self.john = self.make_person(self.customer, "John")

    def hardware(self, device):
        return frappe.db.get_value(
            "MSP Managed Device", device, ["manufacturer", "model", "operating_system", "status"], as_dict=True
        )

    def test_from_the_devices_list_for_a_customer_it_goes_to_stock(self):
        out = DeviceService.create_device(
            customer=self.customer,
            hostname=f"NEW{self.tag[:3]}",
            serial_number=f"NW-{self.tag}",
            manufacturer="HP",
            model="EliteBook 840",
            operating_system="Windows 11",
        )
        self.track("MSP Managed Device", out["name"])
        card = self.hardware(out["name"])

        self.assertEqual((card.manufacturer, card.model, card.operating_system), ("HP", "EliteBook 840", "Windows 11"))
        self.assertEqual(card.status, "Stock")

    def test_from_the_devices_list_with_a_holder_it_is_handed_over(self):
        out = DeviceService.create_device(
            customer=self.customer,
            hostname=f"HLD{self.tag[:3]}",
            serial_number=f"HD-{self.tag}",
            assigned_client_user=self.john,
            model="Latitude 5440",
        )
        self.track("MSP Managed Device", out["name"])

        self.assertEqual(frappe.db.get_value("MSP Managed Device", out["name"], "assigned_client_user"), self.john)
        self.assertEqual(self.hardware(out["name"]).model, "Latitude 5440")

    def test_from_a_person_it_is_kept_too(self):
        from nexgen_msp.api.internal.services.user_service import UserService

        UserService.add_device(
            client_user=self.john,
            hostname=f"PER{self.tag[:3]}",
            serial_number=f"PR-{self.tag}",
            manufacturer="Dell",
            operating_system="Ubuntu 24.04",
        )
        device = self.track(
            "MSP Managed Device", frappe.db.get_value("MSP Managed Device", {"serial_number": f"PR-{self.tag}"})
        )
        card = self.hardware(device)

        self.assertEqual((card.manufacturer, card.operating_system), ("Dell", "Ubuntu 24.04"))

