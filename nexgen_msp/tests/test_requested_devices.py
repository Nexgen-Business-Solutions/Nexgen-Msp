"""A Requested Device: one per Device need, resolved to an existing or a newly registered machine."""

import json

import frappe

from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
from nexgen_msp.api.internal.services.requested_device_service import (
    RequestedDeviceService as Service,
)
from nexgen_msp.api.internal.services.requested_entity_presentation import (
    RequestedEntityPresentation as Reading,
)
from nexgen_msp.utils import request_targets
from nexgen_msp.utils.errors import ValidationError

from .requested_case import REQUESTED_DEVICE, WORK_ORDER, RequestedCase

DEVICE = "MSP Managed Device"


class TestRequestedDevices(RequestedCase):
    def draft(self, key="new-device:laptop", **values):
        requested = {"display_label": "New laptop", "device_type": "Laptop"}
        requested.update(values)
        name = Service.create_or_update_draft(self.request, key, requested)
        frappe.db.commit()

        return name

    def readiness(self, name):
        return Reading.device(name)["readiness"]

    def stock_device(self, suffix):
        return self.make_device(self.customer, hostname=f"{suffix}{self.tag[:4]}", serial=self.serial(suffix))

    def retired_device(self, suffix):
        name = self.stock_device(suffix)
        frappe.db.set_value(DEVICE, name, {"status": "Retired", "retired_date": frappe.utils.today()})
        frappe.db.commit()

        return name

    def test_the_same_requirement_key_yields_one_record(self):
        first = self.draft(serial_number="")
        second = self.draft(display_label="New laptop for Marie", model="X1")
        other = self.draft(key="new-device:phone", display_label=None, device_type="Phone")
        bare = self.draft(key="new-device:bare", display_label=None, device_type=None)

        self.assertEqual(first, second)
        self.assertTrue(first.startswith("RDEV-"))
        self.assertEqual(self.count(REQUESTED_DEVICE, {"request": self.request}), 3)

        doc = frappe.get_doc(REQUESTED_DEVICE, first)
        self.assertEqual(doc.source_key, f"requested-device:{self.request}:new-device:laptop")
        self.assertEqual(doc.device_requirement_key, "new-device:laptop")
        self.assertEqual(doc.customer, self.customer)
        self.assertEqual(doc.status, "Open")
        self.assertEqual(doc.display_label, "New laptop for Marie")
        self.assertEqual(doc.model, "X1")
        self.assertIsNone(doc.serial_number)
        self.assertEqual(json.loads(doc.requested_snapshot_json)["display_label"], "New laptop for Marie")

        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, other, "display_label"), "New Phone")
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, bare, ["display_label", "device_type"]), ("New device", ""))

    def test_resolve_to_an_existing_stock_device(self):
        name = self.draft()
        self.carry_out(devices=[name])
        device = self.stock_device("S")

        self.assertEqual(Service.resolve_existing(name, device), device)

        doc = frappe.get_doc(REQUESTED_DEVICE, name)
        self.assertEqual(
            (doc.status, doc.resolution_mode, doc.resolved_managed_device, doc.resolved_by),
            ("Resolved", "Use Existing", device, "Administrator"),
        )
        self.assertEqual(frappe.db.get_value(DEVICE, device, ["status", "assigned_client_user"]), ("Stock", None))

    def test_resolve_to_a_held_active_device_is_allowed(self):
        name = self.draft()
        self.carry_out(devices=[name])
        device = self.make_device(self.customer, hostname=f"H{self.tag[:4]}", holder=self.person, serial=self.serial("H"))

        self.assertEqual(Service.resolve_existing(name, device), device)
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, name, "resolved_managed_device"), device)
        self.assertEqual(frappe.db.get_value(DEVICE, device, ["status", "assigned_client_user"]), ("Active", self.person))

    def test_a_retired_device_is_listed_but_cannot_be_chosen(self):
        name = self.draft()
        self.carry_out(devices=[name])
        retired = self.retired_device("R")

        with self.assertRaises(ValidationError) as refused:
            Service.resolve_existing(name, retired)

        self.assertEqual(refused.exception.message, "This Device is retired and cannot be selected.")
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, name, ["status", "resolved_managed_device"]), ("Open", None))

    def test_a_device_of_another_customer_is_refused(self):
        name = self.draft()
        self.carry_out(devices=[name])
        foreign = self.make_device(self.other_customer, hostname=f"F{self.tag[:4]}", serial=self.serial("F"))

        with self.assertRaises(ValidationError) as refused:
            Service.resolve_existing(name, foreign)

        self.assertEqual(refused.exception.message, request_targets.CROSS_CUSTOMER)

        doc = frappe.get_doc(REQUESTED_DEVICE, name)
        doc.resolved_managed_device = foreign
        doc.status = "Resolved"
        with self.assertRaisesRegex(frappe.ValidationError, request_targets.CROSS_CUSTOMER):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

    def test_selectable_devices_lists_every_device_of_the_customer(self):
        held = self.make_device(self.customer, hostname=f"H{self.tag[:4]}", holder=self.person, serial=self.serial("H"))
        stock = self.stock_device("S")
        retired = self.retired_device("R")
        foreign = self.make_device(self.other_customer, hostname=f"F{self.tag[:4]}", serial=self.serial("F"))

        page = Service.selectable_device_page(self.customer)
        rows = {row.name: row for row in page["rows"]}

        self.assertEqual(set(rows), {held, stock, retired})
        self.assertNotIn(foreign, rows)
        self.assertEqual((page["total"], page["truncated"]), (3, False))

        self.assertTrue(rows[held].selectable)
        self.assertEqual(rows[held].status, "Active")
        self.assertEqual(rows[held].current_holder, self.person)
        self.assertIsNone(rows[held].unavailable_reason)

        self.assertTrue(rows[stock].selectable)
        self.assertEqual(rows[stock].status, "Stock")
        self.assertIsNone(rows[stock].current_holder)

        self.assertFalse(rows[retired].selectable)
        self.assertEqual(rows[retired].unavailable_reason, "This Device is retired and cannot be selected.")
        self.assertEqual(rows[retired].serial_number, self.serial("R"))

        found = Service.selectable_device_page(self.customer, search=self.serial("S"))
        self.assertEqual([row.name for row in found["rows"]], [stock])
        self.assertEqual(found["total"], 1)

    def test_register_new_is_idempotent(self):
        name = self.draft()
        self.carry_out(devices=[name])
        machines = self.count(DEVICE, {"customer": self.customer})
        accounts = self.users()

        created = Service.resolve_new(
            name,
            {
                "hostname": f"zz-new-{self.tag}",
                "serial_number": self.serial("N"),
                "asset_tag": f"TAG-{self.tag}",
                "manufacturer": "Lenovo",
                "model": "T14",
                "operating_system": "Windows 11",
            },
        )
        retried = Service.resolve_new(name, {"hostname": "zz-other", "serial_number": self.serial("O")})

        self.assertEqual(created, retried)
        self.assertEqual(self.count(DEVICE, {"customer": self.customer}), machines + 1)
        self.assertEqual(self.count(DEVICE, {"serial_number": self.serial("O")}), 0)
        self.assertEqual(self.users(), accounts)

        device = frappe.get_doc(DEVICE, created)
        self.assertEqual(device.customer, self.customer)
        self.assertEqual(device.hostname, f"ZZ-NEW-{self.tag}".upper())
        self.assertEqual(device.serial_number, self.serial("N"))
        self.assertEqual(device.device_type, "Laptop")
        self.assertEqual(device.asset_tag, f"TAG-{self.tag}")
        self.assertEqual((device.manufacturer, device.model, device.operating_system), ("Lenovo", "T14", "Windows 11"))
        self.assertEqual(device.status, "Stock")
        self.assertIsNone(device.assigned_client_user)

        doc = frappe.get_doc(REQUESTED_DEVICE, name)
        self.assertEqual(
            (doc.status, doc.resolution_mode, doc.resolved_managed_device),
            ("Resolved", "Register New", created),
        )
        self.assertEqual(self.readiness(name), "resolved")

    def test_register_new_follows_the_device_domain_rules(self):
        name = self.draft()
        self.carry_out(devices=[name])
        machines = self.count(DEVICE, {"customer": self.customer})

        with self.assertRaises(ValidationError) as refused:
            Service.resolve_new(name, {"hostname": f"zz-noserial-{self.tag}"})

        self.assertEqual(refused.exception.message, "A serial number is required: it is what identifies the machine.")
        self.assertEqual(self.count(DEVICE, {"customer": self.customer}), machines)
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, name, ["status", "resolved_managed_device"]), ("Open", None))

    def test_a_conflicting_second_resolution_is_refused(self):
        name = self.draft()
        self.carry_out(devices=[name])
        first = self.stock_device("A")
        second = self.stock_device("B")

        Service.resolve_existing(name, first)
        self.assertEqual(Service.resolve_existing(name, first), first)

        with self.assertRaises(ValidationError) as refused:
            Service.resolve_existing(name, second)
        self.assertEqual(
            refused.exception.message,
            "This requested target has already been resolved to a different record. "
            "Refresh the request before continuing.",
        )

        machines = self.count(DEVICE, {"customer": self.customer})
        with self.assertRaises(ValidationError) as again:
            Service.resolve_new(name, {"hostname": "zz-late", "serial_number": self.serial("L")})
        self.assertEqual(again.exception.message, request_targets.CONFLICTING_RESOLUTION)
        self.assertEqual(self.count(DEVICE, {"customer": self.customer}), machines)

        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, name, "resolved_managed_device"), first)

    def test_one_requested_device_unblocks_every_line_that_needs_it(self):
        name = self.draft()
        self.add_lines(
            self.request,
            self.service_line(self.device_service, target_scope="Device", client_user=None, requested_device=name),
            self.service_line(self.second_service, target_scope="Device", client_user=None, requested_device=name),
        )
        self.carry_out()

        first, second = (
            frappe.db.get_value(
                WORK_ORDER,
                {"request": self.request, "requested_device": name, "service_item": service, "status": "Open"},
            )
            for service in (self.device_service, self.second_service)
        )
        self.assertTrue(first and second)
        finished = self.work_order(
            service_item=self.second_service,
            target_scope="Device",
            client_user=None,
            requested_device=name,
            status="Cancelled",
        )

        created = Service.resolve_new(name, {"hostname": f"zz-shared-{self.tag}", "serial_number": self.serial("M")})

        for order in (first, second):
            self.assertEqual(
                frappe.db.get_value(WORK_ORDER, order, ["managed_device", "requested_device"]), (created, name)
            )
        self.assertEqual(frappe.db.get_value(WORK_ORDER, finished, ["managed_device", "requested_device"]), (None, name))

        lines = frappe.db.sql(
            """select idx, managed_device, requested_device from `tabMSP Request Line`
               where parent = %s and requested_device = %s order by idx""",
            (self.request, name),
        )
        self.assertEqual(lines, ((2, None, name), (3, None, name)))

        work = Reading.requested_work("device", name)
        self.assertEqual([(row["line_idx"], row["work_order"], row["role"]) for row in work], [
            (2, first, "target"),
            (3, second, "target"),
        ])
        self.assertEqual(self.count(DEVICE, {"customer": self.customer}), 1)

    def test_the_intended_holder_is_one_target_of_the_same_request(self):
        requested_person = RequestedClientUserService.create_or_update_draft(
            self.request, "new:holder", {"full_name": f"ZZTEST Holder {self.tag}"}
        )
        name = self.draft(intended_holder_requested_client_user=requested_person)
        self.assertEqual(
            frappe.db.get_value(REQUESTED_DEVICE, name, "intended_holder_requested_client_user"), requested_person
        )

        doc = frappe.get_doc(REQUESTED_DEVICE, name)
        doc.intended_holder_client_user = self.person
        with self.assertRaisesRegex(frappe.ValidationError, "only one intended holder"):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

        doc = frappe.get_doc(REQUESTED_DEVICE, name)
        doc.intended_holder_requested_client_user = None
        doc.intended_holder_client_user = self.stranger
        with self.assertRaisesRegex(frappe.ValidationError, request_targets.CROSS_CUSTOMER):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

        elsewhere = self.open_request()
        foreign_person = RequestedClientUserService.create_or_update_draft(
            elsewhere, "new:holder", {"full_name": f"ZZTEST Elsewhere {self.tag}"}
        )
        frappe.db.commit()

        doc = frappe.get_doc(REQUESTED_DEVICE, name)
        doc.intended_holder_requested_client_user = foreign_person
        with self.assertRaisesRegex(frappe.ValidationError, request_targets.CROSS_REQUEST):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

        self.assertEqual(
            frappe.db.get_value(
                REQUESTED_DEVICE, name, ["intended_holder_client_user", "intended_holder_requested_client_user"]
            ),
            (None, requested_person),
        )

    def test_readiness_is_derived(self):
        name = self.draft()
        cancelled = self.draft(key="new-device:cancelled")
        self.assertEqual(self.readiness(name), "needs_review")
        self.carry_out(devices=[name, cancelled])

        payload = Service.mark_reviewed(name, {"hostname": f"zz-ready-{self.tag}"})
        self.assertEqual(payload["readiness"], "needs_information")
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, name, "reviewed_by"), "Administrator")

        self.assertEqual(Service.mark_reviewed(name, {"serial_number": self.serial("Y")})["readiness"], "ready")
        self.assertEqual(
            Service.mark_reviewed(name, {"resolution_mode": "Use Existing"})["readiness"], "needs_information"
        )

        Service.resolve_existing(name, self.stock_device("Q"))
        self.assertEqual(self.readiness(name), "resolved")

        payload = Service.cancel(cancelled, "No longer needed")
        self.assertEqual((payload["status"], payload["readiness"]), ("Cancelled", "cancelled"))
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, cancelled, "cancel_reason"), "No longer needed")

        with self.assertRaises(ValidationError) as closed:
            Service.resolve_existing(cancelled, self.stock_device("C"))
        self.assertEqual(closed.exception.message, request_targets.CANCELLED_TARGET)

    def test_the_requested_snapshot_is_frozen_after_submission(self):
        name = self.draft(serial_number="SN-ASKED")
        self.submit()

        doc = frappe.get_doc(REQUESTED_DEVICE, name)
        doc.requested_snapshot_json = json.dumps({"display_label": "Rewritten"})
        with self.assertRaisesRegex(frappe.ValidationError, "cannot change once the request has been submitted"):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

        RequestService.run_action(name=self.request, action="start_review")
        Service.mark_reviewed(name, {"serial_number": self.serial("P")})

        doc = frappe.get_doc(REQUESTED_DEVICE, name)
        self.assertEqual(doc.serial_number, self.serial("P"))
        self.assertEqual(json.loads(doc.requested_snapshot_json)["serial_number"], "SN-ASKED")

        with self.assertRaises(ValidationError):
            self.draft(serial_number="SN-LATE")
