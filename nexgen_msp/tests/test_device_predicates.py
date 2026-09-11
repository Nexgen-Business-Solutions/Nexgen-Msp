"""What the screens claim about a machine's status, asked of the screens themselves.

Two claims the whole lifecycle rests on are checked here from the read paths a human
actually looks at: a machine on the shelf is not a machine that left service, and what a
machine is billed for stays with the machine when it changes hands. The figures on the
internal dashboard and the ones in the customer's portal must both say so.
"""

from collections import defaultdict

import frappe

from nexgen_msp.api.excel_import.services.excel_import_service import ExcelImportService
from nexgen_msp.api.internal.services.dashboard_service import DashboardService
from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import device_holders as holders
from nexgen_msp.utils.device_status import TERMINAL_STATUSES, UNAVAILABLE_STATUSES

from .base import MSPTestCase


class TestDevicePredicates(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.alice = self.make_person(self.customer, "Alice")
        self.bob = self.make_person(self.customer, "Bob")

        self.idle = self.make_device(self.customer, hostname="IDLE", holder=self.bob, serial="SN-P-IDLE")
        self.stock = self.make_device(self.customer, hostname="SHELF", serial="SN-P-SHELF")
        self.dead = self.make_device(self.customer, hostname="DEAD", serial="SN-P-DEAD")
        self.served = self.make_device(
            self.customer, hostname="SERVED", holder=self.alice, serial="SN-P-SERVED"
        )

        self.tech = self.make_account("internal", "MSP Technician", suffix="dpt")
        self.admin = self.make_account("internal", "MSP System Admin", suffix="dpa")
        self.manager = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="dpm")

        DeviceLifecycleService.retire(device=self.dead)

        self.service = self.make_service("DP", scope="Device")
        self.cover_service(self.customer, self.service)
        UserService.assign_service(
            client_user=self.alice,
            service_item=self.service,
            device_mode="existing",
            managed_device=self.served,
        )

        for name in frappe.get_all(
            "MSP Service Assignment", filters={"customer": self.customer}, pluck="name"
        ):
            self.track("MSP Service Assignment", name)

        frappe.db.commit()

    # ------------------------------------------------------------------ helpers
    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def kpi_names(self, listed):
        return [row["name"] for row in listed["rows"]]

    def assignment(self):
        return frappe.get_all(
            "MSP Service Assignment",
            filters={"managed_device": self.served, "service_item": self.service},
            pluck="name",
        )[0]

    # ------------------------------------------------- a machine on the shelf, on our side
    def test_a_machine_on_the_shelf_is_not_out_of_service_on_the_dashboard(self):
        rows = self.as_user(
            self.tech, lambda: DashboardService.list_kpi_rows("devices_without_services", 0, 200)
        )
        listed = self.kpi_names(rows)

        self.assertIn(self.idle, listed, "a machine somebody holds that runs nothing is idle")
        self.assertNotIn(self.stock, listed, "a machine on the shelf is not an idle machine")
        self.assertNotIn(self.dead, listed, "a machine out of service is not an idle machine")

        shelf = frappe.get_doc("MSP Managed Device", self.stock)
        self.assertEqual(shelf.status, "Stock")
        self.assertNotIn(shelf.status, UNAVAILABLE_STATUSES)
        self.assertNotIn(shelf.status, TERMINAL_STATUSES)
        self.assertIsNone(shelf.retired_date)

    def test_the_idle_card_and_the_rows_behind_it_count_the_same_machines(self):
        board = self.as_user(self.tech, DashboardService.get_dashboard)
        rows = self.as_user(
            self.tech, lambda: DashboardService.list_kpi_rows("devices_without_services", 0, 500)
        )

        self.assertEqual(board["hygiene"]["devices_without_services"], rows["total"])

    def test_the_portfolio_never_counts_a_shelved_machine_as_in_service(self):
        board = self.as_user(self.admin, DashboardService.get_dashboard)
        deployed = frappe.db.count("MSP Managed Device", {"status": "Active"})

        self.assertEqual(board["portfolio"]["devices"], deployed)
        self.assertNotIn(
            self.stock,
            frappe.get_all("MSP Managed Device", filters={"status": "Active"}, pluck="name"),
        )

    # --------------------------------------------------- a machine on the shelf, in the portal
    def test_a_machine_on_the_shelf_is_not_out_of_service_in_the_portal(self):
        summary = self.as_user(self.manager, lambda: PortalService.get_summary(self.customer))

        self.assertEqual(summary["devices"], 4, "every machine of the customer, whatever its status")
        self.assertEqual(summary["active_devices"], 2)
        self.assertEqual(summary["retired_devices"], 1, "only the machine that really left service")

        rows = self.as_user(
            self.manager,
            lambda: PortalService.list_kpi_rows("devices_without_services", self.customer, 0, 200),
        )
        listed = self.kpi_names(rows)

        self.assertIn(self.idle, listed)
        self.assertNotIn(self.stock, listed)
        self.assertNotIn(self.dead, listed)

    def test_a_machine_on_the_shelf_still_shows_in_the_customers_own_register(self):
        listed = self.as_user(
            self.manager, lambda: PortalService.list_devices(self.customer, page_length=200)
        )
        names = [row["name"] for row in listed["rows"]]

        self.assertIn(self.stock, names, "a machine on the shelf is still one of theirs")
        self.assertIn(self.dead, names)
        self.assertIn(self.idle, names)

        on_shelf = self.as_user(
            self.manager,
            lambda: PortalService.list_devices(self.customer, status="Stock", page_length=200),
        )
        self.assertEqual([row["name"] for row in on_shelf["rows"]], [self.stock])

    def test_the_portal_idle_filter_lists_exactly_what_its_card_counted(self):
        summary = self.as_user(self.manager, lambda: PortalService.get_summary(self.customer))
        listed = self.as_user(
            self.manager,
            lambda: PortalService.list_devices(self.customer, coverage="no_service", page_length=200),
        )

        self.assertEqual(listed["total"], summary["devices_without_services"])
        self.assertEqual([row["name"] for row in listed["rows"]], [self.idle])

    # ------------------------------------------------- a service follows the machine
    def test_a_device_service_is_reported_against_whoever_holds_the_machine_now(self):
        name = self.assignment()

        before = self.as_user(
            self.tech, lambda: DashboardService.list_kpi_rows("services_added", 0, 500)
        )
        mine = [row for row in before["rows"] if row["name"] == name]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["user_name"], "ZZTEST Alice")
        self.assertEqual(mine[0]["hostname"], "ZZTEST-SERVED")

        DeviceLifecycleService.transfer(device=self.served, client_user=self.bob)

        after = self.as_user(
            self.tech, lambda: DashboardService.list_kpi_rows("services_added", 0, 500)
        )
        moved = [row for row in after["rows"] if row["name"] == name]

        self.assertEqual(len(moved), 1, "the service is still open, it only changed hands")
        self.assertEqual(moved[0]["user_name"], "ZZTEST Bob")
        self.assertEqual(moved[0]["hostname"], "ZZTEST-SERVED")
        self.assertNotIn(moved[0]["status"], ("Ended", "Cancelled"))

        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", name, "managed_device"),
            self.served,
            "the assignment names the machine, and the machine has not changed",
        )

    def test_the_portal_reads_a_device_service_under_whoever_holds_the_machine_now(self):
        def services_of(person):
            detail = self.as_user(
                self.manager, lambda: PortalService.get_user_detail(person)
            )
            return [row["service_name"] for row in detail["services"]]

        item_name = frappe.db.get_value("Item", self.service, "item_name")

        self.assertIn(item_name, services_of(self.alice))
        self.assertNotIn(item_name, services_of(self.bob))

        DeviceLifecycleService.transfer(device=self.served, client_user=self.bob)

        self.assertNotIn(item_name, services_of(self.alice), "it went with the machine")
        self.assertIn(item_name, services_of(self.bob))

        rows = self.as_user(
            self.manager,
            lambda: PortalService.list_service_rows(
                customer=self.customer, service_item=self.service, page_length=200
            ),
        )
        mine = [row for row in rows["rows"] if row["name"] == self.assignment()]

        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["user_name"], "ZZTEST Bob")
        self.assertEqual(mine[0]["device"], self.served)
        self.assertNotIn(mine[0]["operational_status"], ("Ended", "Cancelled"))

    # ---------------------------------------------- the figure that could never be anything
    def test_no_figure_asks_for_a_machine_that_is_active_with_nobody_holding_it(self):
        impossible = frappe.db.count(
            "MSP Managed Device", {"status": "Active", "assigned_client_user": ("is", "not set")}
        )
        self.assertEqual(impossible, 0, "the invariant: Active means exactly one holder")

        stats = DeviceService.get_stats(customer=self.customer)

        self.assertEqual(stats["unassigned_devices"], 1, "the machine on the shelf")
        self.assertEqual(stats["devices_in_stock"], stats["unassigned_devices"])
        self.assertEqual(
            DeviceService.list_devices(customer=self.customer, coverage="unassigned", page_length=200)[
                "total"
            ],
            stats["unassigned_devices"],
        )

        board = self.as_user(self.tech, DashboardService.get_dashboard)
        self.assertGreaterEqual(board["hygiene"]["devices_without_services"], 1)

        portal = self.as_user(self.manager, lambda: PortalService.get_summary(self.customer))
        self.assertEqual(portal["devices_without_services"], 1)
        self.assertEqual(stats["devices_without_services"], 1)

    # ------------------------------------------------------- what the spreadsheet imports
    def record(self, **overrides):
        row = {
            "row_number": 2,
            "full_name": "ZZTEST Alice",
            "hostname": "ZZTEST-IMPORTED",
            "device_type": "PC",
            "device_created": frappe.utils.add_days(frappe.utils.today(), -90),
            "device_disabled": None,
            "macs": [],
            "invalid_macs": [],
            "remarks": None,
        }
        row.update(overrides)
        return row

    def report(self):
        return {
            "created": defaultdict(int),
            "updated": defaultdict(int),
            "skipped": defaultdict(int),
            "exceptions": [],
        }

    def imported(self, record):
        ExcelImportService._billed_customers = {}
        ExcelImportService._fill_blanks_only = 1

        name = ExcelImportService._create_device(
            record, self.customer, self.alice, {}, self.report()
        )

        if name:
            self.track("MSP Managed Device", name)

        return name

    def test_a_machine_imported_as_disabled_arrives_out_of_service_with_nobody_on_it(self):
        left_on = frappe.utils.add_days(frappe.utils.today(), -10)
        name = self.imported(self.record(device_disabled=left_on))

        self.assertIsNotNone(name, "the row must not be refused")

        doc = frappe.get_doc("MSP Managed Device", name)
        self.assertEqual(doc.status, "Retired")
        self.assertIsNone(doc.assigned_client_user)

        spells = holders.history(name)
        self.assertEqual(len(spells), 1, "who had it is not lost, the spell is closed")
        self.assertEqual(spells[0].client_user, self.alice)
        self.assertEqual(frappe.utils.getdate(spells[0].to_date), frappe.utils.getdate(left_on))
        self.assertFalse(spells[0].is_current)

    def test_a_machine_imported_in_service_arrives_active_in_its_holders_hands(self):
        name = self.imported(self.record())

        doc = frappe.get_doc("MSP Managed Device", name)
        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.alice)

        spells = holders.history(name)
        self.assertEqual(len(spells), 1)
        self.assertIsNone(spells[0].to_date)

    def test_re_importing_a_shelved_machine_as_held_puts_it_back_in_service(self):
        ExcelImportService._billed_customers = {}
        ExcelImportService._fill_blanks_only = 1

        hostname = frappe.db.get_value("MSP Managed Device", self.stock, "hostname")
        ExcelImportService._create_device(
            self.record(hostname=hostname), self.customer, self.alice, {}, self.report()
        )

        doc = frappe.get_doc("MSP Managed Device", self.stock)
        self.assertEqual(doc.status, "Active", "the sheet says somebody has it")
        self.assertEqual(doc.assigned_client_user, self.alice)

    def test_re_importing_a_retired_machine_never_hands_it_to_anybody_again(self):
        ExcelImportService._billed_customers = {}
        ExcelImportService._fill_blanks_only = 1

        hostname = frappe.db.get_value("MSP Managed Device", self.dead, "hostname")
        ExcelImportService._create_device(
            self.record(hostname=hostname), self.customer, self.alice, {}, self.report()
        )

        doc = frappe.get_doc("MSP Managed Device", self.dead)
        self.assertEqual(doc.status, "Retired", "what this app decided outlives the photograph")
        self.assertIsNone(doc.assigned_client_user)
