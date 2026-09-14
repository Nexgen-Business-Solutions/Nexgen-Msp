"""The reading a release is judged on, and the things it must never miss.

The audit is only worth running if it would actually notice. Each of these breaks one
invariant behind the application's back — the way a bad import or an old row would — and
asks the audit whether it saw.

Nothing here repairs anything either. The audit counts; people decide.
"""

import frappe

from nexgen_msp.utils import data_audit
from nexgen_msp.utils import device_holders as holders

from .base import MSPTestCase


class DataAuditCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.john = self.make_person(self.customer, "John")

    def laptop(self, hostname, holder=None):
        device = self.make_device(self.customer, hostname=f"{hostname}{self.tag[:3]}")

        if holder:
            doc = frappe.get_doc("MSP Managed Device", device)
            holders.hand_over(doc, holder)
            doc.status = "Active"
            doc.save(ignore_permissions=True)
            frappe.db.commit()

        return device


class TestTheAuditReadsTheWholeSite(DataAuditCase):
    def test_it_reports_every_domain(self):
        found = data_audit.report()

        self.assertEqual(
            set(found["sections"]),
            {"devices", "services", "departments", "requests", "billing"},
        )

    def test_it_says_whether_anything_should_stop_a_release(self):
        found = data_audit.report()

        self.assertIsInstance(found["blockers"], list)
        self.assertEqual(found["clean"], not found["blockers"])

    def test_it_counts_what_it_inspected(self):
        self.laptop("AUDA")

        self.assertGreater(data_audit.devices()["inspected"], 0)
        self.assertGreater(data_audit.services()["inspected"], -1)


class TestItNoticesAMachineWhoseHistoryContradictsIt(DataAuditCase):
    def test_a_machine_active_with_nobody_holding_it(self):
        device = self.laptop("AUDB", holder=self.john)
        before = data_audit.devices()["active_without_holder"]

        # written behind the application's back, the way a bad import would
        frappe.db.sql(
            "update `tabMSP Device Holder` set is_current = 0 where parent = %s", device
        )
        frappe.db.commit()

        self.assertEqual(data_audit.devices()["active_without_holder"], before + 1)

    def test_a_holder_cache_that_no_longer_matches_the_history(self):
        device = self.laptop("AUDC", holder=self.john)
        before = data_audit.devices()["stale_holder_cache"]

        frappe.db.set_value(
            "MSP Managed Device", device, "assigned_client_user", None, update_modified=False
        )
        frappe.db.commit()

        self.assertEqual(data_audit.devices()["stale_holder_cache"], before + 1)

    def test_a_holding_period_that_ends_before_it_starts(self):
        device = self.laptop("AUDD", holder=self.john)
        before = data_audit.devices()["holder_periods_that_cannot_be_ordered"]

        row = frappe.get_all(
            "MSP Device Holder",
            filters={"parent": device, "parenttype": "MSP Managed Device"},
            pluck="name",
        )[0]
        frappe.db.set_value(
            "MSP Device Holder",
            row,
            "to_date",
            frappe.utils.add_days(frappe.utils.today(), -400),
            update_modified=False,
        )
        frappe.db.commit()

        found = data_audit.report()

        self.assertEqual(
            found["sections"]["devices"]["holder_periods_that_cannot_be_ordered"], before + 1
        )
        self.assertFalse(found["clean"], "an unorderable history stops a release")


class TestItNoticesAServicePeriodThatCannotBeTrue(DataAuditCase):
    def opened(self, suffix, **fields):
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        service = self.make_service(f"{suffix}{self.tag[:3]}", scope="User")
        self.cover_service(self.customer, service)
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope="User",
            client_user=self.john,
        )
        frappe.db.commit()

        return self.track("MSP Service Assignment", outcome["name"])

    def test_a_closed_service_still_marked_billable(self):
        assignment = self.opened("AUDE")
        before = data_audit.services()["ended_but_still_billable"]

        frappe.db.set_value(
            "MSP Service Assignment",
            assignment,
            {"operational_status": "Ended", "billing_status": "Billable"},
            update_modified=False,
        )
        frappe.db.commit()

        self.assertEqual(data_audit.services()["ended_but_still_billable"], before + 1)

    def test_a_suspended_service_with_no_pause_on_file(self):
        assignment = self.opened("AUDF")
        before = data_audit.services()["suspended_without_an_open_pause"]

        frappe.db.set_value(
            "MSP Service Assignment",
            assignment,
            "operational_status",
            "Suspended",
            update_modified=False,
        )
        frappe.db.commit()

        self.assertEqual(data_audit.services()["suspended_without_an_open_pause"], before + 1)

    def test_a_machine_service_carrying_a_person(self):
        assignment = self.opened("AUDG")
        before = data_audit.services()["device_scope_carrying_a_person"]

        frappe.db.set_value(
            "MSP Service Assignment",
            assignment,
            "assignment_scope",
            "Device",
            update_modified=False,
        )
        frappe.db.commit()

        self.assertEqual(data_audit.services()["device_scope_carrying_a_person"], before + 1)


class TestItNoticesAWordNobodyConfigured(DataAuditCase):
    def test_a_department_worn_but_absent_from_the_catalogue(self):
        before = data_audit.departments()["not_in_the_catalogue"]

        frappe.db.set_value(
            "MSP Client User",
            self.john,
            "department",
            f"ZZTEST Ghost {self.tag}",
            update_modified=False,
        )
        frappe.db.commit()

        found = data_audit.departments()

        self.assertEqual(found["not_in_the_catalogue"], before + 1)
        self.assertIn(f"ZZTEST Ghost {self.tag}", found["examples"])
