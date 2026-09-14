"""A machine is Active because somebody holds it, and the history says who, and when.

Everything here is asked of the domain itself: the five acts a machine can go through, the
history they write, and the states the record refuses to be left in. A machine that comes
back to somebody who had it before is an ordinary day at a customer, not a mistake, and it
is the case these tests care most about.
"""

import frappe

from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.utils import device_holders as holders
from nexgen_msp.utils.device_status import TERMINAL_STATUSES, UNAVAILABLE_STATUSES
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase


class TestDeviceLifecycle(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.alice = self.make_person(self.customer, "Alice")
        self.bob = self.make_person(self.customer, "Bob")
        self.device = self.make_device(self.customer, hostname="LIFE", serial="SN-LIFE")
        self.today = frappe.utils.today()

    # ------------------------------------------------------------------ helpers
    def reload(self, device=None):
        return frappe.get_doc("MSP Managed Device", device or self.device)

    def periods(self, device=None):
        return holders.history(device or self.device)

    def current(self, device=None):
        return [row for row in self.periods(device) if not row.to_date]

    def device_service_on(self, device, suffix="DL"):
        """One open, device-scoped service on a machine, the way the app opens one."""
        service = self.make_service(suffix, scope="Device")
        self.cover_service(self.customer, service)
        UserService.assign_service(
            client_user=self.alice,
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

    def days_ago(self, days):
        return frappe.utils.add_days(self.today, -days)

    # -------------------------------------------------------------- what a machine is
    def test_a_machine_registered_without_a_holder_sits_in_stock(self):
        doc = self.reload()

        self.assertEqual(doc.status, "Stock")
        self.assertIsNone(doc.assigned_client_user)
        self.assertEqual(self.current(), [])

    def test_a_machine_registered_with_a_holder_is_active_in_their_hands(self):
        held = self.make_device(self.customer, hostname="HELD", holder=self.alice, serial="SN-HELD")
        doc = self.reload(held)

        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.alice)
        self.assertEqual([row.client_user for row in self.current(held)], [self.alice])

    # ------------------------------------------------------------------- the five acts
    def test_assigning_a_machine_in_stock_puts_it_in_somebodys_hands(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)
        doc = self.reload()

        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.alice)

        held = self.current()
        self.assertEqual(len(held), 1)
        self.assertEqual(held[0].client_user, self.alice)
        self.assertEqual(frappe.utils.getdate(held[0].from_date), frappe.utils.getdate(self.today))
        self.assertTrue(held[0].is_current)

    def test_taking_a_machine_back_leaves_it_in_stock_and_touches_no_service(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)
        _, assignment = self.device_service_on(self.device)
        before = frappe.db.get_value(
            "MSP Service Assignment",
            assignment,
            ["operational_status", "billing_status", "effective_end_date"],
            as_dict=True,
        )

        DeviceLifecycleService.repossess(device=self.device)
        doc = self.reload()

        self.assertEqual(doc.status, "Stock")
        self.assertIsNone(doc.assigned_client_user)
        self.assertEqual(self.current(), [])

        after = frappe.db.get_value(
            "MSP Service Assignment",
            assignment,
            ["operational_status", "billing_status", "effective_end_date"],
            as_dict=True,
        )
        self.assertEqual(after, before, "a machine taken back keeps what it is billed for")
        self.assertIn(after.operational_status, ("Pending Setup", "Active"))

    def test_a_machine_can_go_back_to_somebody_who_had_it_before(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)
        DeviceLifecycleService.repossess(device=self.device)
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)

        rows = self.periods()
        mine = [row for row in rows if row.client_user == self.alice]

        self.assertEqual(len(mine), 2, "the second time is a spell of its own")
        self.assertTrue(mine[0].to_date, "the first one was closed")
        self.assertFalse(mine[1].to_date, "the second one is open")
        self.assertGreaterEqual(
            frappe.utils.getdate(mine[1].from_date), frappe.utils.getdate(mine[0].to_date)
        )
        self.assertEqual(self.reload().assigned_client_user, self.alice)

    def test_transferring_closes_one_spell_and_opens_the_next_the_same_day(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)
        DeviceLifecycleService.transfer(device=self.device, client_user=self.bob)

        doc = self.reload()
        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.bob)

        rows = self.periods()
        self.assertEqual([row.client_user for row in rows], [self.alice, self.bob])
        self.assertEqual(
            frappe.utils.getdate(rows[0].to_date), frappe.utils.getdate(rows[1].from_date)
        )
        self.assertEqual([bool(row.is_current) for row in rows], [False, True])

    def test_a_machine_transferred_back_writes_a_third_spell(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)
        DeviceLifecycleService.transfer(device=self.device, client_user=self.bob)
        DeviceLifecycleService.transfer(device=self.device, client_user=self.alice)

        rows = self.periods()
        self.assertEqual([row.client_user for row in rows], [self.alice, self.bob, self.alice])
        self.assertEqual([bool(row.is_current) for row in rows], [False, False, True])
        self.assertEqual(self.reload().assigned_client_user, self.alice)

    def test_retiring_an_active_machine_closes_its_spell_and_its_services(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)
        _, assignment = self.device_service_on(self.device)

        out = DeviceLifecycleService.retire(device=self.device, end_services=1)
        doc = self.reload()

        self.assertEqual(doc.status, "Retired")
        self.assertIsNone(doc.assigned_client_user)
        self.assertEqual(frappe.utils.getdate(doc.retired_date), frappe.utils.getdate(self.today))
        self.assertEqual(self.current(), [])
        self.assertEqual(out["closed_assignments"], [assignment])

        service = frappe.db.get_value(
            "MSP Service Assignment",
            assignment,
            ["operational_status", "billing_status", "effective_end_date"],
            as_dict=True,
        )
        self.assertEqual(service.operational_status, "Ended")
        self.assertEqual(service.billing_status, "Ended")
        self.assertEqual(
            frappe.utils.getdate(service.effective_end_date), frappe.utils.getdate(self.today)
        )

    def test_retiring_can_leave_its_services_open(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)
        _, assignment = self.device_service_on(self.device)

        out = DeviceLifecycleService.retire(device=self.device)

        self.assertEqual(out["closed_assignments"], [])
        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", assignment, "operational_status"),
            "Active",
        )

    def test_retiring_a_machine_nobody_holds_is_fine(self):
        DeviceLifecycleService.retire(device=self.device)
        doc = self.reload()

        self.assertEqual(doc.status, "Retired")
        self.assertIsNone(doc.assigned_client_user)
        self.assertEqual(frappe.utils.getdate(doc.retired_date), frappe.utils.getdate(self.today))

    def test_reinstating_without_a_holder_puts_the_machine_back_on_the_shelf(self):
        DeviceLifecycleService.retire(device=self.device)
        DeviceLifecycleService.reinstate(device=self.device)

        doc = self.reload()
        self.assertEqual(doc.status, "Stock")
        self.assertIsNone(doc.assigned_client_user)
        self.assertIsNone(doc.retired_date)
        self.assertEqual(self.current(), [])

    def test_reinstating_with_a_holder_opens_a_new_spell(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)
        DeviceLifecycleService.retire(device=self.device)
        DeviceLifecycleService.reinstate(device=self.device, client_user=self.bob)

        doc = self.reload()
        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.bob)
        self.assertIsNone(doc.retired_date)
        self.assertEqual([row.client_user for row in self.current()], [self.bob])

    def test_reinstating_never_starts_the_services_that_were_ended_again(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)
        service, assignment = self.device_service_on(self.device)
        DeviceLifecycleService.retire(device=self.device, end_services=1)

        DeviceLifecycleService.reinstate(device=self.device, client_user=self.alice)

        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", assignment, "operational_status"), "Ended"
        )
        self.assertEqual(
            frappe.get_all(
                "MSP Service Assignment",
                filters={"managed_device": self.device, "service_item": service},
                pluck="name",
            ),
            [assignment],
            "reinstating writes no service of its own",
        )

    # --------------------------------------------------------- the day it went into service
    def test_the_day_a_machine_went_into_service_is_written_once(self):
        DeviceLifecycleService.assign(
            device=self.device, client_user=self.alice, effective_date=self.days_ago(10)
        )
        first_day = self.reload().assigned_date
        self.assertEqual(frappe.utils.getdate(first_day), frappe.utils.getdate(self.days_ago(10)))

        DeviceLifecycleService.transfer(device=self.device, client_user=self.bob)
        self.assertEqual(self.reload().assigned_date, first_day, "a transfer is not a new life")

        DeviceLifecycleService.repossess(device=self.device)
        self.assertEqual(self.reload().assigned_date, first_day)

        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)
        self.assertEqual(self.reload().assigned_date, first_day)

    def test_reinstating_into_somebodys_hands_does_not_move_the_day_it_went_into_service(self):
        DeviceLifecycleService.assign(
            device=self.device, client_user=self.alice, effective_date=self.days_ago(5)
        )
        first_day = self.reload().assigned_date

        DeviceLifecycleService.retire(device=self.device)
        DeviceLifecycleService.reinstate(device=self.device, client_user=self.bob)

        self.assertEqual(self.reload().assigned_date, first_day)

    # ----------------------------------------------------------------- what is refused
    def test_assigning_a_machine_somebody_else_holds_asks_for_a_transfer(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)

        with self.assertRaises(ValidationError) as caught:
            DeviceLifecycleService.assign(device=self.device, client_user=self.bob)

        self.assertIn("Transfer", str(caught.exception))

    def test_assigning_a_machine_to_the_person_already_holding_it_is_refused(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)

        with self.assertRaises(ValidationError):
            DeviceLifecycleService.assign(device=self.device, client_user=self.alice)

    def test_transferring_to_the_person_already_holding_it_is_refused(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)

        with self.assertRaises(ValidationError):
            DeviceLifecycleService.transfer(device=self.device, client_user=self.alice)

    def test_a_machine_nobody_holds_can_be_neither_transferred_nor_taken_back(self):
        with self.assertRaises(ValidationError):
            DeviceLifecycleService.transfer(device=self.device, client_user=self.alice)

        with self.assertRaises(ValidationError):
            DeviceLifecycleService.repossess(device=self.device)

    def test_a_machine_is_not_given_to_somebody_at_another_customer(self):
        elsewhere = self.make_customer(suffix="B")
        carol = self.make_person(elsewhere, "Carol")

        with self.assertRaises(ValidationError):
            DeviceLifecycleService.assign(device=self.device, client_user=carol)

        self.assertEqual(self.reload().status, "Stock")

    def test_a_machine_is_not_given_to_somebody_who_has_left(self):
        for status in ("Disabled", "Archived"):
            frappe.db.set_value("MSP Client User", self.bob, "lifecycle_status", status)

            with self.assertRaises(ValidationError):
                DeviceLifecycleService.assign(device=self.device, client_user=self.bob)

        frappe.db.set_value("MSP Client User", self.bob, "lifecycle_status", "Active")

    def test_nothing_can_happen_to_a_machine_tomorrow(self):
        with self.assertRaises(ValidationError):
            DeviceLifecycleService.assign(
                device=self.device,
                client_user=self.alice,
                effective_date=frappe.utils.add_days(self.today, 1),
            )

    def test_a_machine_cannot_change_hands_before_the_person_holding_it_got_it(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)

        with self.assertRaises(ValidationError):
            DeviceLifecycleService.transfer(
                device=self.device, client_user=self.bob, effective_date=self.days_ago(3)
            )

    def test_a_machine_cannot_be_given_out_before_it_came_back(self):
        DeviceLifecycleService.assign(
            device=self.device, client_user=self.alice, effective_date=self.days_ago(4)
        )
        DeviceLifecycleService.repossess(device=self.device, effective_date=self.days_ago(2))

        with self.assertRaises(ValidationError):
            DeviceLifecycleService.assign(
                device=self.device, client_user=self.bob, effective_date=self.days_ago(3)
            )

    def test_a_machine_already_out_of_service_is_not_retired_twice(self):
        DeviceLifecycleService.retire(device=self.device)

        with self.assertRaises(ValidationError):
            DeviceLifecycleService.retire(device=self.device)

    def test_a_machine_already_in_service_is_not_reinstated(self):
        with self.assertRaises(ValidationError):
            DeviceLifecycleService.reinstate(device=self.device)

        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)

        with self.assertRaises(ValidationError):
            DeviceLifecycleService.reinstate(device=self.device)

    # ------------------------------------------------------------- the record itself
    def test_the_holder_on_the_machine_is_never_anything_but_what_the_history_says(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)

        doc = self.reload()
        doc.asset_tag = "ZZTEST-TAG"
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        doc = self.reload()
        self.assertEqual(doc.assigned_client_user, self.alice)
        self.assertEqual([bool(row.is_current) for row in self.periods()], [True])

        DeviceLifecycleService.repossess(device=self.device)
        doc = self.reload()
        doc.model = "ZZTEST Model"
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        doc = self.reload()
        self.assertIsNone(doc.assigned_client_user)
        self.assertEqual([bool(row.is_current) for row in self.periods()], [False])

    def test_a_machine_in_stock_is_not_a_machine_out_of_service(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)
        DeviceLifecycleService.repossess(device=self.device)

        doc = self.reload()
        self.assertEqual(doc.status, "Stock")
        self.assertIsNone(doc.assigned_client_user)
        self.assertIsNone(doc.retired_date, "a machine on the shelf has not left service")
        self.assertNotIn(doc.status, UNAVAILABLE_STATUSES)
        self.assertNotIn(doc.status, TERMINAL_STATUSES)

    def test_a_machine_cannot_be_saved_active_with_nobody_holding_it(self):
        doc = self.reload()
        doc.status = "Active"

        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

        frappe.db.rollback()

    def test_a_machine_cannot_be_saved_out_of_service_with_somebody_holding_it(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)

        doc = self.reload()
        doc.status = "Retired"
        doc.retired_date = self.today

        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

        frappe.db.rollback()

    def test_two_people_cannot_hold_the_same_machine(self):
        DeviceLifecycleService.assign(device=self.device, client_user=self.alice)

        doc = self.reload()
        doc.append("holder_log", {"client_user": self.bob, "from_date": self.today})

        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

        frappe.db.rollback()
