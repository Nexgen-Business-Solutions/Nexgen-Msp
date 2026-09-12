"""Spec §54's own worked example, played through end to end.

Every rule here already has a unit test of its own elsewhere in this suite. What none of
those narrow fixtures show is the whole story running together, through the real call paths
a technician's actions actually take: John starts with four services across two machines,
Microsoft 365 is paused and resumed, VPN is closed and reopened, Laptop A is handed to Bob
and Laptop B is taken back to stock — and everything the spec promises still holds afterward.
"""

import frappe
from frappe.utils import flt, getdate

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.utils import device_holders

from .base import MSPTestCase


class TestPhase2DefinitionOfDone(MSPTestCase):
    def setUp(self):
        super().setUp()
        # a random suffix, not the shared default "A" every other test file also reaches
        # for: this setUp is the heaviest in the suite, and bench run-tests runs test
        # methods concurrently, so a shared hardcoded customer name races itself
        self.customer = self.make_customer(frappe.generate_hash(length=6))
        self.john = self.make_person(self.customer, "John")
        self.bob = self.make_person(self.customer, "Bob")
        self.today = frappe.utils.today()

        # holders are backdated to day -60, the same day everything else in the starting
        # state begins, so the later acts (transfer on day -5, repossess on day -2) land
        # after the holder history they are building on rather than before it
        self.laptop_a = self.make_device(self.customer, hostname="LAPTOPA", serial="SN-DOD-A")
        self.laptop_b = self.make_device(self.customer, hostname="LAPTOPB", serial="SN-DOD-B")

        for device in (self.laptop_a, self.laptop_b):
            doc = frappe.get_doc("MSP Managed Device", device)
            device_holders.hand_over(doc, self.john, on_date=self.days_ago(60))
            doc.status = "Active"
            doc.save(ignore_permissions=True)
        frappe.db.commit()

        self.m365 = self.make_service("M365", scope="User")
        self.vpn = self.make_service("VPN", scope="User")
        self.sophos = self.make_service("SOPHOS", scope="Device")
        self.rmm = self.make_service("RMM", scope="Device")

        for service in (self.m365, self.vpn, self.sophos, self.rmm):
            self.cover_service(self.customer, service)

        # -------------------------------------------------------- starting state
        # John: Microsoft 365 Active, VPN Active
        # Laptop A (John): Sophos Active, RMM Active
        # Laptop B (John): Sophos Active
        self.m365_assignment = self.open_service(
            self.m365, "User", client_user=self.john, effective_date=self.days_ago(60)
        )
        self.vpn_assignment_1 = self.open_service(
            self.vpn, "User", client_user=self.john, effective_date=self.days_ago(60)
        )
        self.sophos_a = self.open_service(
            self.sophos, "Device", managed_device=self.laptop_a, effective_date=self.days_ago(60)
        )
        self.rmm_a = self.open_service(
            self.rmm, "Device", managed_device=self.laptop_a, effective_date=self.days_ago(60)
        )
        self.sophos_b = self.open_service(
            self.sophos, "Device", managed_device=self.laptop_b, effective_date=self.days_ago(60)
        )

        # -------------------------------------------------------------- the story
        # Suspend Microsoft 365 / Resume Microsoft 365
        ServiceLifecycleService.suspend(
            assignment=self.m365_assignment, effective_date=self.days_ago(20)
        )
        ServiceLifecycleService.resume(
            assignment=self.m365_assignment, effective_date=self.days_ago(15)
        )

        # Close VPN / Re-add VPN — a genuine close followed by a fresh, distinct assignment,
        # not a Change: nothing about the VPN's plan or quantity was renegotiated, it was
        # simply switched off and switched back on again later
        ServiceLifecycleService.end(
            assignment=self.vpn_assignment_1, effective_date=self.days_ago(10)
        )
        self.vpn_assignment_2 = self.open_service(
            self.vpn, "User", client_user=self.john, effective_date=self.days_ago(8)
        )

        # Transfer Laptop A to Bob
        DeviceLifecycleService.transfer(
            device=self.laptop_a, client_user=self.bob, effective_date=self.days_ago(5)
        )

        # Repossess Laptop B
        DeviceLifecycleService.repossess(device=self.laptop_b, effective_date=self.days_ago(2))

    def tearDown(self):
        frappe.set_user("Administrator")

        for run in frappe.get_all("MSP Billing Run", filters={"customer": self.customer}, pluck="name"):
            frappe.db.sql("delete from `tabMSP Billing Run Line` where parent = %s", run)
            frappe.db.sql("delete from `tabMSP Billing Run` where name = %s", run)

        frappe.db.commit()
        super().tearDown()

    # ------------------------------------------------------------------ fixtures
    def days_ago(self, days):
        return frappe.utils.add_days(self.today, -days)

    def open_service(self, service, scope, **kwargs):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer, service_item=service, target_scope=scope, **kwargs
        )
        self.track("MSP Service Assignment", outcome["name"])

        return outcome["name"]

    def reload(self, assignment):
        return frappe.get_doc("MSP Service Assignment", assignment)

    def contract(self):
        return frappe.db.get_value("MSP Contract", {"customer": self.customer}, "name")

    # ----------------------------------------------------- 1. Microsoft 365 reste à John
    def test_microsoft_365_reste_a_john(self):
        doc = self.reload(self.m365_assignment)

        self.assertEqual(doc.operational_status, "Active")
        self.assertEqual(doc.client_user, self.john)
        self.assertEqual(len(doc.suspension_log), 1)
        self.assertIsNotNone(doc.suspension_log[0].suspended_on)
        self.assertIsNotNone(doc.suspension_log[0].resumed_on)
        self.assertEqual(
            getdate(doc.suspension_log[0].suspended_on), getdate(self.days_ago(20))
        )
        self.assertEqual(
            getdate(doc.suspension_log[0].resumed_on), getdate(self.days_ago(15))
        )

    # ------------------------------------------------------------- 2. VPN history reste à John
    def test_vpn_history_reste_a_john(self):
        old = self.reload(self.vpn_assignment_1)
        new = self.reload(self.vpn_assignment_2)

        self.assertEqual(old.operational_status, "Ended")
        self.assertEqual(old.client_user, self.john)

        self.assertEqual(new.operational_status, "Active")
        self.assertEqual(new.client_user, self.john)

        self.assertNotEqual(old.name, new.name)
        self.assertLess(getdate(old.effective_end_date), getdate(new.effective_start_date))

        # the doctype's own validate_no_overlap already refuses two open/overlapping periods
        # on save; re-saving both here confirms that rule still holds over this pair
        old.save()
        new.save()

    # -------------------------------------------------- 3. Sophos Laptop A reste au Laptop A
    def test_sophos_laptop_a_reste_au_laptop_a(self):
        fields = [
            "operational_status",
            "billing_status",
            "client_user",
            "managed_device",
            "effective_start_date",
            "effective_end_date",
            "quantity",
            "modified",
        ]

        after = frappe.db.get_value("MSP Service Assignment", self.sophos_a, fields, as_dict=True)

        self.assertEqual(after.operational_status, "Active")
        self.assertEqual(after.managed_device, self.laptop_a)
        self.assertIsNone(after.client_user)

    # ----------------------------------------- 4. Bob ne devient pas propriétaire de son historique
    def test_bob_ne_devient_pas_proprietaire_de_son_historique(self):
        found = RequestService._find_open_assignment(
            self.customer, self.sophos, "User", client_user=self.bob
        )
        self.assertIsNone(found, "Bob never gets a personal Sophos assignment of his own")

        detail = UserService.get_user(self.bob)
        bob_services = detail["user_services"]
        personal_rows = [
            row
            for row in bob_services
            if row["name"] == self.sophos_a and row.get("assignment_scope") == "User"
        ]
        self.assertEqual(
            personal_rows, [], "Laptop A's Sophos must never be attributed to Bob as his own"
        )

        # it does legitimately show up as the machine's own service, now under his holding
        machine_rows = [
            row
            for group in detail["device_services"]
            for row in group["services"]
            if row["name"] == self.sophos_a
        ]
        self.assertEqual(len(machine_rows), 1)
        self.assertEqual(machine_rows[0]["assignment_scope"], "Device")
        self.assertEqual(machine_rows[0]["managed_device"], self.laptop_a)

    # --------------------------------------- 5. Sophos Laptop B reste au Laptop B en stock
    def test_sophos_laptop_b_reste_au_laptop_b_en_stock(self):
        device = frappe.db.get_value(
            "MSP Managed Device", self.laptop_b, ["status", "assigned_client_user"], as_dict=True
        )
        self.assertEqual(device.status, "Stock")
        self.assertIsNone(device.assigned_client_user)

        assignment = self.reload(self.sophos_b)
        self.assertEqual(assignment.operational_status, "Active")
        self.assertEqual(assignment.managed_device, self.laptop_b)

    # ------------------------------------------ 6. Billing respecte les périodes de suspension
    def test_billing_respecte_les_periodes_de_suspension(self):
        period_start = self.days_ago(30)
        period_end = self.today

        lines, _terms = BillingService.build_lines(self.contract(), period_start, period_end)
        mine = [line for line in lines if line["service_assignment"] == self.m365_assignment]

        self.assertEqual(len(mine), 1, f"{self.m365_assignment} produced {len(mine)} billing lines")
        line = mine[0]

        total_days = (getdate(period_end) - getdate(period_start)).days + 1
        suspended_days = (getdate(self.days_ago(15)) - getdate(self.days_ago(20))).days

        self.assertGreater(line["billable_days"], 0)
        self.assertLess(line["billable_days"], total_days)
        self.assertEqual(line["billable_days"], total_days - suspended_days)
        self.assertGreater(line["billable_months"], 0.0)
        self.assertLess(line["billable_months"], 1.0)
        self.assertEqual(line["amount"], flt(line["amount"], 2))
        self.assertIsNone(line["exception_code"])
