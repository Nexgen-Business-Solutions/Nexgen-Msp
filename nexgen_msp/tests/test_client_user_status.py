"""Somebody leaves the company: we record it and follow the explicit service choice.

Leaving does not hand a laptop back, does not cancel a licence and does not rewrite what was
billed. Those are separate decisions, taken when somebody takes them. The person's page says
what is still in their hands; the disabling itself changes their status and their date.
"""

import frappe

from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.user_360_service import User360Service
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase


class StatusCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.john = self.make_person(self.customer, f"John {self.tag}")
        frappe.db.set_value(
            "MSP Client User", self.john, "start_date", frappe.utils.add_days(frappe.utils.today(), -60)
        )
        self.service = self.make_service(f"ST{self.tag[:3]}")
        self.cover_service(self.customer, self.service)

        opened = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.service,
            target_scope="User",
            client_user=self.john,
            effective_date=frappe.utils.add_days(frappe.utils.today(), -20),
        )
        self.assignment = self.track("MSP Service Assignment", opened["name"])
        self.laptop = self.make_device(
            self.customer, f"ST-{self.tag}", holder=self.john, serial=f"ZZTEST-ST-{self.tag}"
        )

    def status(self):
        return frappe.db.get_value(
            "MSP Client User", self.john, ["lifecycle_status", "disabled_date", "disabled_reason"], as_dict=True
        )


class TestDisabling(StatusCase):
    def test_it_records_the_status_the_day_and_the_reason(self):
        day = frappe.utils.add_days(frappe.utils.today(), -2)

        UserService.disable_client_user(name=self.john, effective_date=day, reason="Departure")

        row = self.status()
        self.assertEqual(row.lifecycle_status, "Disabled")
        self.assertEqual(str(row.disabled_date), str(frappe.utils.getdate(day)))
        self.assertEqual(row.disabled_reason, "Departure")

    def test_without_a_day_it_is_today(self):
        UserService.disable_client_user(name=self.john)

        self.assertEqual(str(self.status().disabled_date), frappe.utils.today())

    def test_their_services_stay_as_they_were(self):
        UserService.disable_client_user(name=self.john)

        row = frappe.db.get_value(
            "MSP Service Assignment",
            self.assignment,
            ["operational_status", "effective_end_date"],
            as_dict=True,
        )
        self.assertEqual(row.operational_status, "Active")
        self.assertIsNone(row.effective_end_date)

    def test_their_services_can_be_ended_explicitly(self):
        device_service = self.make_service(f"STD{self.tag[:3]}", scope="Device")
        self.cover_service(self.customer, device_service)
        device_assignment = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=device_service,
            target_scope="Device",
            managed_device=self.laptop,
            effective_date=frappe.utils.add_days(frappe.utils.today(), -10),
        )["name"]
        self.track("MSP Service Assignment", device_assignment)

        out = UserService.disable_client_user(name=self.john, end_services=1)

        self.assertCountEqual(out["closed_assignments"], [self.assignment, device_assignment])
        for assignment in (self.assignment, device_assignment):
            self.assertEqual(
                frappe.db.get_value("MSP Service Assignment", assignment, "operational_status"),
                "Ended",
            )

    def test_the_laptop_stays_in_their_hands(self):
        UserService.disable_client_user(name=self.john)

        self.assertEqual(
            frappe.db.get_value("MSP Managed Device", self.laptop, "assigned_client_user"), self.john
        )
        self.assertTrue(
            frappe.db.exists(
                "MSP Device Holder", {"parent": self.laptop, "client_user": self.john, "is_current": 1}
            )
        )

    def test_their_page_says_what_is_still_theirs(self):
        UserService.disable_client_user(name=self.john)

        codes = {signal["code"] for signal in User360Service.get_user(self.john)["attention"]}

        self.assertIn("DISABLED_WITH_OPEN_SERVICES", codes)
        self.assertIn("DISABLED_WITH_DEVICE", codes)

    def test_somebody_already_gone_cannot_leave_twice(self):
        UserService.disable_client_user(name=self.john)

        with self.assertRaises(ValidationError):
            UserService.disable_client_user(name=self.john)

    def test_a_reason_we_do_not_record_is_refused(self):
        with self.assertRaises(ValidationError):
            UserService.disable_client_user(name=self.john, reason="Bored")

        self.assertEqual(self.status().lifecycle_status, "Active")

    def test_they_cannot_leave_before_they_started(self):
        start = frappe.db.get_value("MSP Client User", self.john, "start_date")

        with self.assertRaises(frappe.ValidationError):
            UserService.disable_client_user(
                name=self.john, effective_date=frappe.utils.add_days(start, -1)
            )

    def test_a_customer_account_cannot_disable_anybody(self):
        manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"st{self.tag[:3]}"
        )
        frappe.set_user(manager)
        try:
            with self.assertRaises((ValidationError, frappe.PermissionError)):
                UserService.disable_client_user(name=self.john)
        finally:
            frappe.set_user("Administrator")

        self.assertEqual(self.status().lifecycle_status, "Active")


class TestWhileTheyAreGone(StatusCase):
    def setUp(self):
        super().setUp()
        UserService.disable_client_user(name=self.john)

    def test_they_cannot_be_given_a_new_service(self):
        other = self.make_service(f"ST2{self.tag[:3]}")
        self.cover_service(self.customer, other)

        with self.assertRaises(ValidationError):
            ServiceLifecycleService.activate(
                customer=self.customer, service_item=other, target_scope="User", client_user=self.john
            )

    def test_the_editing_form_leaves_their_status_alone(self):
        UserService.update_client_user(name=self.john, email=f"john.{self.tag}@example.invalid")

        self.assertEqual(self.status().lifecycle_status, "Disabled")


class TestReactivating(StatusCase):
    def setUp(self):
        super().setUp()
        UserService.disable_client_user(name=self.john, reason="Departure")

    def test_they_are_active_again_with_no_leaving_day(self):
        UserService.reactivate_client_user(name=self.john)

        row = self.status()
        self.assertEqual(row.lifecycle_status, "Active")
        self.assertIsNone(row.disabled_date)
        self.assertIsNone(row.disabled_reason)

    def test_nothing_they_had_is_touched_on_the_way_back(self):
        ServiceLifecycleService.end(assignment=self.assignment, effective_date=frappe.utils.today())

        UserService.reactivate_client_user(name=self.john)

        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", self.assignment, "operational_status"),
            "Ended",
        )

    def test_somebody_still_here_cannot_be_reactivated(self):
        UserService.reactivate_client_user(name=self.john)

        with self.assertRaises(ValidationError):
            UserService.reactivate_client_user(name=self.john)
