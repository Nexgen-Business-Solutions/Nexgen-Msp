"""A MAC address is written one way, whatever way it was typed.

Issue #22. Parallels RAS reads `AA-BB-CC-DD-EE-FF` and nothing else, so that is what this
application stores — from a form, from the API, from the import, from a service request —
and what it refuses is said in words somebody can act on.
"""

import frappe

from nexgen_msp.api.excel_import.services import excel_parser
from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.patches import normalize_managed_device_macs as backfill
from nexgen_msp.utils.mac_address import REFUSAL, normalize_mac_address

from .base import MSPTestCase

WRITTEN = "0A-EA-31-1A-95-BB"


class TestTheOneFormat(MSPTestCase):
    def test_the_three_forms_people_type_give_the_same_address(self):
        for written in ("0A:EA:31:1A:95:BB", "0A-EA-31-1A-95-BB", "0aea311a95bb"):
            self.assertEqual(normalize_mac_address(written), WRITTEN, written)

    def test_outer_spaces_and_case_are_the_typist_s_business(self):
        self.assertEqual(normalize_mac_address("  0a-ea-31-1a-95-bb  "), WRITTEN)

    def test_running_it_on_its_own_answer_changes_nothing(self):
        self.assertEqual(normalize_mac_address(normalize_mac_address(WRITTEN)), WRITTEN)

    def test_what_is_not_a_mac_is_refused_in_words(self):
        for written in (
            None,
            "",
            "   ",
            "0A-EA-31-1A-95",
            "0A-EA-31-1A-95-BB-CC",
            "0A-EA-31-1A-95-BG",
            "0A:EA-31:1A-95:BB",
            "0A EA 31 1A 95 BB",
            "0aea311a95b",
            "0aea311a95bbb",
            "0A.EA.31.1A.95.BB",
        ):
            with self.assertRaises(ValueError, msg=written) as refusal:
                normalize_mac_address(written)

            self.assertEqual(str(refusal.exception), REFUSAL)


class TestWhatTheRecordSaves(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)

    def device(self, hostname, interfaces):
        made = DeviceService.create_device(
            customer=self.customer,
            hostname=f"{hostname}{self.tag[:3]}",
            device_type="Laptop",
            serial_number=f"SN-{hostname}-{self.tag}",
            interfaces=interfaces,
        )

        return self.track("MSP Managed Device", made["name"])

    def macs_of(self, device):
        return frappe.get_all(
            "MSP Network Interface",
            filters={"parent": device},
            pluck="mac_address",
            order_by="idx asc",
        )

    def test_a_colon_address_is_saved_the_parallels_way(self):
        device = self.device("MACA", [{"interface_type": "Wi-Fi", "mac_address": "0A:EA:31:1A:95:BB"}])

        self.assertEqual(self.macs_of(device), [WRITTEN])

    def test_twelve_bare_digits_are_saved_the_same_way(self):
        device = self.device("MACB", [{"interface_type": "LAN", "mac_address": "0aea311a95bb"}])

        self.assertEqual(self.macs_of(device), [WRITTEN])

    def test_a_malformed_address_is_refused_by_the_record_itself(self):
        with self.assertRaises(Exception) as refusal:
            self.device("MACC", [{"interface_type": "LAN", "mac_address": "0A-EA-31-1A-95"}])

        self.assertIn("MAC address", str(refusal.exception))

    def test_the_same_card_written_two_ways_is_one_card(self):
        with self.assertRaises(Exception) as refusal:
            self.device(
                "MACD",
                [
                    {"interface_type": "LAN", "mac_address": "0A:EA:31:1A:95:BB"},
                    {"interface_type": "Wi-Fi", "mac_address": "0a-ea-31-1a-95-bb"},
                ],
            )

        self.assertIn("duplicated", str(refusal.exception))

    def test_editing_it_through_the_api_lands_on_the_same_form(self):
        device = self.device("MACE", [{"interface_type": "LAN", "mac_address": WRITTEN}])

        DeviceService.update_device(
            device=device,
            interfaces=[{"interface_type": "LAN", "mac_address": "0a:ea:31:1a:95:cc"}],
        )

        self.assertEqual(self.macs_of(device), ["0A-EA-31-1A-95-CC"])

    def test_a_whole_mac_finds_its_machine_however_it_is_typed(self):
        device = self.device("MACF", [{"interface_type": "LAN", "mac_address": WRITTEN}])

        for asked in (WRITTEN, "0A:EA:31:1A:95:BB", "0aea311a95bb"):
            rows = DeviceService.list_devices(customer=self.customer, search=asked)["rows"]

            self.assertIn(device, [row["name"] for row in rows], asked)

    def test_a_partial_search_still_works_as_text(self):
        device = self.device("MACG", [{"interface_type": "LAN", "mac_address": WRITTEN}])

        rows = DeviceService.list_devices(customer=self.customer, search="31-1A")["rows"]

        self.assertIn(device, [row["name"] for row in rows])


class TestWhatAServiceRequestSaves(MSPTestCase):
    """A request that brings a machine in goes through the same rule as a form."""

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.john = self.make_person(self.customer, "John", department="Accounting")

    def macs_of(self, device):
        return frappe.get_all(
            "MSP Network Interface",
            filters={"parent": device},
            pluck="mac_address",
            order_by="idx asc",
        )

    def test_a_new_machine_arrives_in_the_canonical_form(self):
        from nexgen_msp.api.internal.services.request_service import RequestService

        device = RequestService._resolve_device(
            customer=self.customer,
            client_user=self.john,
            device_mode="new",
            managed_device=None,
            hostname=f"REQ{self.tag[:3]}",
            device_type="Laptop",
            interfaces=[{"interface_type": "LAN", "mac_address": "0a:ea:31:1a:95:bb"}],
            serial_number=f"SN-REQ-{self.tag}",
        )
        self.track("MSP Managed Device", device)

        self.assertEqual(self.macs_of(device), [WRITTEN])

    def test_adding_the_same_card_to_a_machine_twice_adds_nothing(self):
        from nexgen_msp.api.internal.services.request_service import RequestService

        device = RequestService._resolve_device(
            customer=self.customer,
            client_user=self.john,
            device_mode="new",
            managed_device=None,
            hostname=f"REQB{self.tag[:3]}",
            device_type="Laptop",
            interfaces=[{"interface_type": "LAN", "mac_address": WRITTEN}],
            serial_number=f"SN-REQB-{self.tag}",
        )
        self.track("MSP Managed Device", device)

        RequestService._resolve_device(
            customer=self.customer,
            client_user=self.john,
            device_mode="existing",
            managed_device=device,
            hostname=None,
            device_type=None,
            interfaces=[{"interface_type": "Wi-Fi", "mac_address": "0A:EA:31:1A:95:BB"}],
        )

        self.assertEqual(
            self.macs_of(device), [WRITTEN], "one card, however its separators are typed"
        )


class TestWhatTheImportReads(MSPTestCase):
    def test_a_blank_cell_is_silence_and_a_bad_one_is_reported(self):
        self.assertIsNone(excel_parser.normalize_mac(None))
        self.assertIsNone(excel_parser.normalize_mac("   "))
        self.assertFalse(excel_parser.normalize_mac("not-a-mac"))

    def test_the_file_cannot_bring_in_a_form_the_record_would_refuse(self):
        self.assertEqual(excel_parser.normalize_mac("0A:EA:31:1A:95:BB"), WRITTEN)
        self.assertEqual(excel_parser.normalize_mac("0aea311a95bb"), WRITTEN)


class TestTheBackfill(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)

    def machine(self, hostname, written):
        """A machine whose interfaces were saved before the rule existed."""
        made = DeviceService.create_device(
            customer=self.customer,
            hostname=f"{hostname}{self.tag[:3]}",
            device_type="Laptop",
            serial_number=f"SN-{hostname}-{self.tag}",
            interfaces=[{"interface_type": "LAN", "mac_address": WRITTEN}],
        )
        device = self.track("MSP Managed Device", made["name"])
        row = frappe.db.get_value("MSP Network Interface", {"parent": device}, "name")
        # straight onto the row: what is under test is the reading of old data
        frappe.db.set_value("MSP Network Interface", row, "mac_address", written, update_modified=False)
        frappe.db.commit()

        return device, row

    def test_the_inventory_writes_nothing(self):
        device, row = self.machine("OLDA", "0a:ea:31:1a:95:bb")

        report = backfill.inventory()

        self.assertIn(row, [entry["row"] for entry in report["canonical"]])
        self.assertEqual(
            frappe.db.get_value("MSP Network Interface", row, "mac_address"),
            "0a:ea:31:1a:95:bb",
            "a dry run that writes is not a dry run",
        )

    def test_it_rewrites_the_rows_there_is_no_doubt_about(self):
        device, row = self.machine("OLDB", "0a:ea:31:1a:95:bb")

        backfill.execute()

        self.assertEqual(
            frappe.db.get_value("MSP Network Interface", row, "mac_address"), WRITTEN
        )

    def test_it_leaves_an_unreadable_value_alone_and_says_so(self):
        device, row = self.machine("OLDC", "whatever-this-is")

        backfill.execute()
        report = backfill.inventory()

        self.assertEqual(
            frappe.db.get_value("MSP Network Interface", row, "mac_address"), "whatever-this-is"
        )
        self.assertIn(row, [entry["row"] for entry in report["invalid"]])

    def test_a_second_pass_changes_nothing(self):
        device, row = self.machine("OLDD", "0aea311a95bb")

        backfill.execute()
        first = frappe.db.get_value(
            "MSP Network Interface", row, ["mac_address", "modified"], as_dict=True
        )
        backfill.execute()
        second = frappe.db.get_value(
            "MSP Network Interface", row, ["mac_address", "modified"], as_dict=True
        )

        self.assertEqual(first, second)
        self.assertEqual(first.mac_address, WRITTEN)

    def test_two_rows_that_would_become_one_are_both_left_alone(self):
        device, row = self.machine("OLDE", "0a:ea:31:1a:95:bb")
        twin = frappe.get_doc(
            {
                "doctype": "MSP Network Interface",
                "parenttype": "MSP Managed Device",
                "parentfield": "network_interfaces",
                "parent": device,
                "interface_type": "Wi-Fi",
                "mac_address": "0AEA311A95BB",
                "idx": 2,
            }
        )
        twin.db_insert()
        frappe.db.commit()

        backfill.execute()
        report = backfill.inventory()

        self.assertEqual(
            frappe.db.get_value("MSP Network Interface", row, "mac_address"),
            "0a:ea:31:1a:95:bb",
            "neither row is rewritten while the collision stands",
        )
        self.assertTrue(report["collisions"], report)
