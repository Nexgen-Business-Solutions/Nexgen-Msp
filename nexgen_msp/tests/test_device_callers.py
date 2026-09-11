"""Everything that used to move a machine by hand now goes through the lifecycle service.

The acts themselves are covered next door; what is asked here is that the older doors —
registering a machine, handing it over, retiring it, opening a service on it, and the
request path that resolves a device — write the same history as the domain does, and
refuse what the domain refuses.
"""

import frappe

from nexgen_msp.api.internal.endpoints import v1
from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.utils import device_holders as holders
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase


class TestDeviceCallers(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.alice = self.make_person(self.customer, "Alice")
        self.bob = self.make_person(self.customer, "Bob")
        self.today = frappe.utils.today()

    # ------------------------------------------------------------------ helpers
    def reload(self, device):
        return frappe.get_doc("MSP Managed Device", device)

    def periods(self, device):
        return holders.history(device)

    def current(self, device):
        return [row for row in self.periods(device) if not row.to_date]

    def free_serial(self, serial):
        """A serial names one machine: whatever an interrupted run left on it goes first."""
        for stale in frappe.get_all(
            "MSP Managed Device", filters={"serial_number": serial}, pluck="name"
        ):
            frappe.db.sql("delete from `tabMSP Service Assignment` where managed_device=%s", stale)
            frappe.delete_doc("MSP Managed Device", stale, force=True, ignore_permissions=True)

        frappe.db.commit()

        return serial

    def register(self, hostname, serial, holder=None, assigned_date=None):
        out = DeviceService.create_device(
            customer=self.customer,
            hostname=f"ZZTEST-{hostname}",
            device_type="PC",
            serial_number=self.free_serial(serial),
            assigned_client_user=holder,
            assigned_date=assigned_date,
        )

        return self.track("MSP Managed Device", out["name"])

    def open_service_on(self, device, suffix, holder):
        """One open, device-scoped service on a machine, opened the way the app opens one."""
        service = self.make_service(suffix, scope="Device")
        self.cover_service(self.customer, service)
        UserService.assign_service(
            client_user=holder,
            service_item=service,
            device_mode="existing",
            managed_device=device,
        )

        name = frappe.get_all(
            "MSP Service Assignment",
            filters={"managed_device": device, "service_item": service},
            pluck="name",
        )[0]

        return service, self.track("MSP Service Assignment", name)

    def assignment_state(self, assignment):
        return frappe.db.get_value(
            "MSP Service Assignment",
            assignment,
            ["operational_status", "billing_status", "effective_end_date"],
            as_dict=True,
        )

    # ------------------------------------------------------------- registering a machine
    def test_a_machine_registered_without_a_holder_lands_in_stock(self):
        device = self.register("REG1", "ZZTEST-SN-REG1")
        doc = self.reload(device)

        self.assertEqual(doc.status, "Stock")
        self.assertIsNone(doc.assigned_client_user)
        self.assertIsNone(doc.assigned_date)
        self.assertEqual(self.periods(device), [])

    def test_a_machine_registered_with_a_holder_is_active_from_a_dated_spell(self):
        device = self.register("REG2", "ZZTEST-SN-REG2", holder=self.alice)
        doc = self.reload(device)
        rows = self.periods(device)

        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.alice)
        self.assertEqual(frappe.utils.getdate(doc.assigned_date), frappe.utils.getdate(self.today))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].client_user, self.alice)
        self.assertEqual(frappe.utils.getdate(rows[0].from_date), frappe.utils.getdate(self.today))
        self.assertTrue(rows[0].is_current)

    # ------------------------------------------------------------------- handing it over
    def test_handing_a_machine_in_stock_to_somebody_opens_a_spell(self):
        device = self.make_device(self.customer, hostname="HO1", serial="ZZTEST-SN-HO1")

        DeviceService.hand_over_device(device=device, client_user=self.alice)
        doc = self.reload(device)

        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.alice)
        self.assertEqual([row.client_user for row in self.current(device)], [self.alice])

    def test_handing_a_held_machine_to_somebody_else_closes_one_spell_and_opens_another(self):
        device = self.make_device(
            self.customer, hostname="HO2", holder=self.alice, serial="ZZTEST-SN-HO2"
        )
        _, assignment = self.open_service_on(device, "HO2", self.alice)
        before = self.assignment_state(assignment)

        DeviceService.hand_over_device(device=device, client_user=self.bob)
        doc = self.reload(device)
        rows = self.periods(device)

        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.bob)
        self.assertEqual([row.client_user for row in rows], [self.alice, self.bob])
        self.assertEqual(
            frappe.utils.getdate(rows[0].to_date), frappe.utils.getdate(self.today)
        )
        self.assertEqual([bool(row.is_current) for row in rows], [False, True])
        self.assertEqual(
            self.assignment_state(assignment),
            before,
            "a service follows the machine, not the hands it is in",
        )

    def test_handing_a_machine_to_nobody_takes_it_back_onto_the_shelf(self):
        device = self.make_device(
            self.customer, hostname="HO3", holder=self.alice, serial="ZZTEST-SN-HO3"
        )
        _, assignment = self.open_service_on(device, "HO3", self.alice)
        before = self.assignment_state(assignment)

        DeviceService.hand_over_device(device=device, client_user=None)
        doc = self.reload(device)

        self.assertEqual(doc.status, "Stock")
        self.assertIsNone(doc.assigned_client_user)
        self.assertEqual(self.current(device), [])
        self.assertEqual(self.assignment_state(assignment), before)

    def test_handing_a_machine_to_the_person_who_already_has_it_is_refused(self):
        device = self.make_device(
            self.customer, hostname="HO4", holder=self.alice, serial="ZZTEST-SN-HO4"
        )

        with self.assertRaises(ValidationError) as caught:
            DeviceService.hand_over_device(device=device, client_user=self.alice)

        self.assertIn("already holds", caught.exception.message)
        self.assertEqual(self.reload(device).assigned_client_user, self.alice)

    # --------------------------------------------------------------- out of service, back
    def test_retiring_a_held_machine_closes_its_spell_and_its_services(self):
        device = self.make_device(
            self.customer, hostname="ST1", holder=self.alice, serial="ZZTEST-SN-ST1"
        )
        _, assignment = self.open_service_on(device, "ST1", self.alice)

        out = DeviceService.change_device_status(device=device, action="Retire")
        doc = self.reload(device)

        self.assertEqual(doc.status, "Retired")
        self.assertIsNone(doc.assigned_client_user)
        self.assertEqual(self.current(device), [])
        self.assertEqual(out["closed_assignments"], [assignment])
        self.assertEqual(out["name"], device)
        self.assertEqual(out["hostname"], doc.hostname)

        ended = self.assignment_state(assignment)
        self.assertEqual(ended.operational_status, "Ended")
        self.assertEqual(ended.billing_status, "Ended")
        self.assertEqual(
            frappe.utils.getdate(ended.effective_end_date), frappe.utils.getdate(self.today)
        )

    def test_reinstating_without_a_holder_lands_in_stock_and_never_active(self):
        device = self.make_device(self.customer, hostname="ST2", serial="ZZTEST-SN-ST2")
        DeviceService.change_device_status(device=device, action="Retire")

        out = DeviceService.change_device_status(device=device, action="Reinstate")
        doc = self.reload(device)

        self.assertEqual(doc.status, "Stock")
        self.assertNotEqual(doc.status, "Active")
        self.assertIsNone(doc.assigned_client_user)
        self.assertIsNone(doc.retired_date)
        self.assertEqual(self.current(device), [])
        self.assertEqual(out["closed_assignments"], [])

    def test_reinstating_into_somebodys_hands_opens_a_new_spell(self):
        device = self.make_device(
            self.customer, hostname="ST3", holder=self.alice, serial="ZZTEST-SN-ST3"
        )
        DeviceService.change_device_status(device=device, action="Retire")

        DeviceService.change_device_status(
            device=device, action="Reinstate", assigned_client_user=self.bob
        )
        doc = self.reload(device)

        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.bob)
        self.assertIsNone(doc.retired_date)
        self.assertEqual([row.client_user for row in self.current(device)], [self.bob])

    def test_retiring_into_a_status_the_domain_no_longer_offers_is_refused(self):
        device = self.make_device(
            self.customer, hostname="ST4", holder=self.alice, serial="ZZTEST-SN-ST4"
        )

        with self.assertRaises(ValidationError) as caught:
            DeviceService.change_device_status(device=device, action="Retire", status="Damaged")

        self.assertIn("Damaged", caught.exception.message)
        self.assertEqual(self.reload(device).status, "Active")

    # --------------------------------------------------------- opening a service on one
    def test_a_service_opened_on_a_machine_in_stock_puts_it_in_the_users_hands(self):
        device = self.make_device(self.customer, hostname="SV1", serial="ZZTEST-SN-SV1")

        self.open_service_on(device, "SV1", self.alice)
        doc = self.reload(device)
        rows = self.periods(device)

        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.alice)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].client_user, self.alice)
        self.assertTrue(rows[0].from_date)

    def test_a_second_service_on_a_machine_its_holder_already_has_changes_nothing(self):
        device = self.make_device(self.customer, hostname="SV2", serial="ZZTEST-SN-SV2")
        self.open_service_on(device, "SV2A", self.alice)
        before = self.periods(device)

        self.open_service_on(device, "SV2B", self.alice)
        doc = self.reload(device)
        rows = self.periods(device)

        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.alice)
        self.assertEqual(len(rows), 1, "attaching another service is not a hand-over")
        self.assertEqual(
            [(row.client_user, row.from_date, row.to_date) for row in rows],
            [(row.client_user, row.from_date, row.to_date) for row in before],
        )

    def test_a_service_cannot_quietly_move_a_machine_to_somebody_else(self):
        device = self.make_device(self.customer, hostname="SV3", serial="ZZTEST-SN-SV3")
        self.open_service_on(device, "SV3A", self.alice)
        service = self.make_service("SV3B", scope="Device")

        with self.assertRaises(ValidationError) as caught:
            UserService.assign_service(
                client_user=self.bob,
                service_item=service,
                device_mode="existing",
                managed_device=device,
            )

        self.assertIn("Transfer", caught.exception.message)

        doc = self.reload(device)
        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.alice)
        self.assertEqual([row.client_user for row in self.current(device)], [self.alice])
        self.assertEqual(
            frappe.get_all(
                "MSP Service Assignment",
                filters={"managed_device": device, "service_item": service},
                pluck="name",
            ),
            [],
            "the refused service was not opened either",
        )

    def test_a_machine_created_along_with_its_service_carries_a_dated_spell(self):
        service = self.make_service("SV4", scope="Device")
        self.cover_service(self.customer, service)
        serial = self.free_serial("ZZTEST-SN-SV4")

        UserService.assign_service(
            client_user=self.alice,
            service_item=service,
            device_mode="new",
            hostname="ZZTEST-SV4",
            device_type="PC",
            serial_number=serial,
        )

        device = self.track(
            "MSP Managed Device",
            frappe.db.get_value("MSP Managed Device", {"serial_number": serial}, "name"),
        )
        self.track(
            "MSP Service Assignment",
            frappe.get_all("MSP Service Assignment", filters={"managed_device": device}, pluck="name")[0],
        )
        doc = self.reload(device)
        rows = self.periods(device)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].client_user, self.alice)
        self.assertTrue(rows[0].from_date, "a holder period needs the day it started")
        self.assertEqual(frappe.utils.getdate(rows[0].from_date), frappe.utils.getdate(self.today))
        self.assertTrue(rows[0].is_current)
        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.alice)
        self.assertEqual(frappe.utils.getdate(doc.assigned_date), frappe.utils.getdate(self.today))

    def test_a_machine_on_the_shelf_can_still_be_fitted_with_a_service(self):
        device = self.make_device(self.customer, hostname="SV5", serial="ZZTEST-SN-SV5")
        service = self.make_service("SV5", scope="Device")
        self.cover_service(self.customer, service)

        DeviceService.assign_device_service(device=device, service_item=service)

        opened = frappe.get_all(
            "MSP Service Assignment",
            filters={"managed_device": device, "service_item": service},
            pluck="name",
        )
        self.assertEqual(len(opened), 1)
        self.track("MSP Service Assignment", opened[0])
        self.assertEqual(self.assignment_state(opened[0]).operational_status, "Active")

    def test_a_machine_that_left_service_takes_nothing_more(self):
        device = self.make_device(self.customer, hostname="SV6", serial="ZZTEST-SN-SV6")
        service = self.make_service("SV6", scope="Device")
        self.cover_service(self.customer, service)
        DeviceService.change_device_status(device=device, action="Retire")

        with self.assertRaises(ValidationError) as caught:
            DeviceService.assign_device_service(device=device, service_item=service)

        self.assertIn("retired", caught.exception.message)

    # ------------------------------------------------------------------- the new doors
    def test_the_lifecycle_endpoints_are_whitelisted(self):
        for name in (
            "assign_device",
            "transfer_device",
            "repossess_device",
            "retire_device",
            "reinstate_device",
        ):
            endpoint = getattr(v1, name)
            self.assertIn(endpoint, frappe.whitelisted, f"{name} is not whitelisted")

    def test_the_assign_endpoint_does_what_the_lifecycle_service_does(self):
        device = self.make_device(self.customer, hostname="EP1", serial="ZZTEST-SN-EP1")

        out = v1.assign_device(device=device, client_user=self.alice)
        doc = self.reload(device)

        self.assertEqual(out["status"], "Active")
        self.assertEqual(out["assigned_client_user"], self.alice)
        self.assertEqual(doc.status, "Active")
        self.assertEqual([row.client_user for row in self.current(device)], [self.alice])
