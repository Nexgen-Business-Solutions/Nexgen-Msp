"""What the product claims about a person, a machine or a service has to be what the data says.

A metric may state an absence; only an explicit business rule may call that absence a risk. The
figures checked here are the ones that used to claim more than their predicate proved: a machine
with no service was called insecure, a Device service on a person who left was called a licence
billed for nothing, and a missing username was called an incomplete service.
"""

import frappe

from nexgen_msp.api.internal.services.dashboard_service import DashboardService
from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import ValidationError as REFUSED

from .base import MSPTestCase


class MetricCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", self.customer)
        self.leaver = self.make_person(self.customer, "Leaver")
        self.stayer = self.make_person(self.customer, "Stayer")
        self.tech = self.make_account("internal", "MSP Technician", suffix=f"mt{self.tag[:3]}")
        self.admin = self.make_account("internal", "MSP System Admin", suffix=f"ma{self.tag[:3]}")
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"mm{self.tag[:3]}"
        )

    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def offering(self, suffix, scope="User"):
        service = self.make_service(f"{suffix}{self.tag[:3]}", scope=scope)
        self.cover_service(self.customer, service)

        return service

    def running(self, service, scope="User", client_user=None, managed_device=None):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope=scope,
            client_user=client_user,
            managed_device=managed_device,
        )

        return self.track("MSP Service Assignment", outcome["name"])

    def user_stats(self):
        return self.as_user(self.tech, lambda: UserService.get_stats(customer=self.customer))

    def listed(self, coverage):
        return self.as_user(
            self.tech,
            lambda: UserService.list_users(
                customer=self.customer, coverage=coverage, page_length=200
            ),
        )


class TestAMachineWithNoServiceIsJustThat(MetricCase):
    def test_no_dashboard_figure_speaks_about_a_machine_without_services(self):
        board = self.as_user(self.tech, DashboardService.get_dashboard)

        self.assertNotIn("hygiene", board)

        for gone in ("devices_without_services", "reclaimable_licences"):
            with self.assertRaises(REFUSED):
                self.as_user(self.admin, lambda: DashboardService.list_kpi_rows(gone, 0, 10))

    def test_the_factual_filter_still_lists_it(self):
        machine = self.make_device(
            self.customer, hostname=f"BARE-{self.tag[:4]}", holder=self.stayer, serial=f"ZZTEST-B{self.tag}"
        )

        listed = self.as_user(
            self.tech,
            lambda: DeviceService.list_devices(
                customer=self.customer, coverage="no_service", page_length=200
            ),
        )

        self.assertIn(machine, [row["name"] for row in listed["rows"]])

    def test_a_missing_mac_raises_no_dashboard_figure(self):
        self.make_device(
            self.customer, hostname=f"NOMAC-{self.tag[:4]}", holder=self.stayer, serial=f"ZZTEST-M{self.tag}"
        )

        with self.assertRaises(REFUSED):
            self.as_user(self.admin, lambda: DashboardService.list_kpi_rows("devices_without_mac", 0, 10))

        stats = self.as_user(self.tech, lambda: DeviceService.get_stats(customer=self.customer))

        self.assertGreaterEqual(stats["devices_without_mac"], 1, "the list filter still counts it")


class TestWhatALeaverStillHas(MetricCase):
    def setUp(self):
        super().setUp()
        self.personal = self.offering("MP1")
        self.on_machine = self.offering("MD1", scope="Device")
        self.machine = self.make_device(
            self.customer, hostname=f"LEFT-{self.tag[:4]}", holder=self.leaver, serial=f"ZZTEST-L{self.tag}"
        )

    def disable(self):
        frappe.db.set_value("MSP Client User", self.leaver, "lifecycle_status", "Disabled")
        frappe.db.commit()

    def test_a_device_service_of_a_leaver_is_not_a_personal_service(self):
        self.running(self.on_machine, "Device", managed_device=self.machine)
        self.disable()

        stats = self.user_stats()

        self.assertEqual(stats["disabled_with_personal_services"], 0)
        self.assertEqual(self.listed("disabled_with_personal_services")["total"], 0)

    def test_a_machine_still_in_a_leavers_hands_is_its_own_signal(self):
        self.disable()

        stats = self.user_stats()
        listed = self.listed("disabled_holding_device")

        self.assertEqual(stats["disabled_holding_device"], 1)
        self.assertEqual([row["name"] for row in listed["rows"]], [self.leaver])

    def test_a_leaver_with_a_service_of_their_own_is_counted(self):
        self.running(self.personal, "User", client_user=self.leaver)
        self.disable()

        stats = self.user_stats()
        listed = self.listed("disabled_with_personal_services")

        self.assertEqual(stats["disabled_with_personal_services"], 1)
        self.assertEqual([row["name"] for row in listed["rows"]], [self.leaver])

    def test_needs_attention_no_longer_rests_on_a_missing_username(self):
        self.running(self.personal, "User", client_user=self.stayer)

        listed = self.listed("needs_attention")

        self.assertNotIn(self.stayer, [row["name"] for row in listed["rows"]])


class TestTheCustomerReadsOnlyFacts(MetricCase):
    def test_the_portal_summary_carries_no_heuristic_counter(self):
        summary = self.as_user(self.manager, lambda: PortalService.get_summary(self.customer))

        for gone in ("reclaimable_licences", "devices_without_services"):
            self.assertNotIn(gone, summary)

            with self.assertRaises(REFUSED):
                self.as_user(
                    self.manager, lambda: PortalService.list_kpi_rows(gone, self.customer, 0, 10)
                )

    def test_every_portal_card_matches_the_rows_behind_it(self):
        self.running(self.offering("MP2"), "User", client_user=self.stayer)

        summary = self.as_user(self.manager, lambda: PortalService.get_summary(self.customer))

        for kpi in ("active_services", "open_requests"):
            rows = self.as_user(
                self.manager, lambda: PortalService.list_kpi_rows(kpi, self.customer, 0, 500)
            )
            self.assertEqual(rows["total"], summary[kpi], kpi)

        self.assertEqual(
            summary["active_client_users"],
            frappe.db.count(
                "MSP Client User", {"customer": self.customer, "lifecycle_status": "Active"}
            ),
        )
        self.assertEqual(
            summary["active_devices"],
            frappe.db.count("MSP Managed Device", {"customer": self.customer, "status": "Active"}),
        )
