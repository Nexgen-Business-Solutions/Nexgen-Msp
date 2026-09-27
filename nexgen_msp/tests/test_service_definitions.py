"""The MSP configuration of a service is its own record, and history never depends on it.

An ERPNext Item belongs to the site. What MSP decided about it — available or not, sold against a
person or a machine, invoiced under which name — is an `MSP Service Definition`. Taking a service
out of the offer stops new work and nothing else: what is running keeps running, what was billed
stays billed, and what happened before the definition existed stays readable.
"""

import pathlib

import frappe

from nexgen_msp.api.internal.services.catalogue_service import CatalogueService
from nexgen_msp.api.internal.services.service_availability_service import (
    ServiceAvailabilityService,
)
from nexgen_msp.api.internal.services.service_definition_service import (
    ServiceDefinitionService,
)
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.utils.errors import NexgenError

from .base import MSPTestCase

APP = pathlib.Path(__file__).resolve().parents[1]

# the Item custom fields this release stopped reading
LEGACY_ITEM_FIELDS = ("msp_service_scope", "msp_invoice_label", "msp_service_enabled")

# the two places allowed to name them, and why
#   hooks.py            declares the deprecated Custom Fields still shipped for one release
#   diagnostics/        audits what past patches did to legacy Items, which is its whole purpose
ALLOWED_TO_NAME_THEM = ("hooks.py", "diagnostics")


class DefinitionCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(f"DEF{self.tag[:4]}")
        self.track("MSP Approval Authority", self.customer)
        self.person = self.make_person(self.customer, "Holder")

    def offering(self, suffix, scope="User", available=True):
        service = self.make_service(f"{suffix}{self.tag[:3]}", scope=scope, available=available)
        self.cover_service(self.customer, service)

        return service

    def running(self, service, scope="User", **targets):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope=scope,
            client_user=targets.get("client_user", self.person if scope == "User" else None),
            managed_device=targets.get("managed_device"),
        )

        return self.track("MSP Service Assignment", outcome["name"])

    def definition(self, service):
        return ServiceDefinitionService.for_item(service)


class TestWhatTheDefinitionDecides(DefinitionCase):
    def test_a_service_with_no_definition_is_history_and_nothing_new(self):
        code = f"ZZTEST-LEGACY-{self.tag[:5]}"
        frappe.get_doc(
            {
                "doctype": "Item",
                "item_code": code,
                "item_name": "Legacy MSP service",
                "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
                "is_stock_item": 0,
                "is_sales_item": 1,
                "stock_uom": "Month",
                "uoms": [{"uom": "Month", "conversion_factor": 1}],
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        self.track("Item", code)

        self.assertIsNone(self.definition(code))
        self.assertFalse(ServiceDefinitionService.is_ready(code))
        self.assertIn("MSP_DEFINITION_MISSING", ServiceDefinitionService.blockers(code))
        # history keeps reading: the name and the widest scope are still answered
        self.assertEqual(ServiceDefinitionService.label_of(code), "Legacy MSP service")
        self.assertEqual(ServiceDefinitionService.scope_of(code), "Both")
        self.assertNotIn(code, ServiceDefinitionService.available_items())

        self.cover_service(self.customer, code)

        with self.assertRaises(NexgenError) as refused:
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=code,
                target_scope="User",
                client_user=self.person,
            )

        self.assertEqual(refused.exception.code, "MSP_DEFINITION_MISSING")

    def test_an_assignment_made_before_the_definition_stays_readable(self):
        service = self.offering("HIS")
        assignment = self.running(service)

        frappe.delete_doc(
            "MSP Service Definition", self.definition(service).name, ignore_permissions=True
        )
        frappe.db.commit()

        card = frappe.db.get_value(
            "MSP Service Assignment",
            assignment,
            ["service_item", "operational_status", "assignment_scope"],
            as_dict=True,
        )

        self.assertEqual(card.service_item, service)
        self.assertEqual(card.operational_status, "Active")
        self.assertEqual(card.assignment_scope, "User")
        self.assertTrue(ServiceDefinitionService.label_of(service))

    def test_a_definition_switched_off_blocks_new_work_and_nothing_else(self):
        service = self.offering("OFF")
        assignment = self.running(service)

        CatalogueService.remove_service_from_msp(item=service, mode="keep")

        self.assertFalse(ServiceDefinitionService.is_ready(service))
        self.assertNotIn(service, ServiceDefinitionService.available_items())

        offered = ServiceAvailabilityService.read_user(self.person)
        self.assertNotIn(service, [row["service_item"] for row in offered["available"]])
        self.assertIn(service, [row["service_item"] for row in offered["current"]])

        card = frappe.db.get_value(
            "MSP Service Assignment",
            assignment,
            ["operational_status", "billing_status"],
            as_dict=True,
        )
        self.assertEqual(card.operational_status, "Active")
        self.assertEqual(card.billing_status, "Billable")

        with self.assertRaises(NexgenError) as refused:
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=service,
                target_scope="User",
                client_user=self.make_person(self.customer, "Another"),
            )

        self.assertEqual(refused.exception.code, "MSP_SERVICE_NOT_AVAILABLE")

    def test_the_scope_the_definition_declares_is_the_one_enforced(self):
        service = self.offering("SCO", scope="Device")
        machine = self.make_device(
            self.customer, hostname=f"DEF-{self.tag[:4]}", holder=self.person, serial=f"ZZTEST-D{self.tag}"
        )

        self.assertEqual(ServiceDefinitionService.scope_of(service), "Device")

        with self.assertRaises(NexgenError):
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=service,
                target_scope="User",
                client_user=self.person,
            )

        self.assertTrue(self.running(service, scope="Device", managed_device=machine))

    def test_a_definition_with_no_scope_is_never_available(self):
        service = self.offering("NOS")
        frappe.db.set_value(
            "MSP Service Definition", self.definition(service).name, "service_scope", None
        )
        frappe.db.commit()

        self.assertFalse(ServiceDefinitionService.is_ready(service))
        self.assertIn("INVALID_MSP_SCOPE", ServiceDefinitionService.blockers(service))
        self.assertEqual(
            ServiceDefinitionService.compatibility(service), "Needs Configuration"
        )

    def test_a_definition_cannot_be_offered_without_saying_what_it_is_sold_against(self):
        service = self.offering("GRD")
        doc = frappe.get_doc("MSP Service Definition", self.definition(service).name)
        doc.service_scope = None

        with self.assertRaises(frappe.ValidationError) as refused:
            doc.save(ignore_permissions=True)

        self.assertIn("Choose User, Device or Both", str(refused.exception))


class TestTheItemKeepsItsOwnFields(DefinitionCase):
    def test_no_runtime_module_reads_the_old_item_custom_fields(self):
        """§V2-07-4: the repository itself has to prove the runtime moved off them."""
        offenders = []

        for path in sorted(APP.rglob("*.py")):
            relative = path.relative_to(APP)
            parts = set(relative.parts)

            if parts & {"tests", "patches"} or relative.name.startswith("test_"):
                continue

            if relative.name in ALLOWED_TO_NAME_THEM or parts & set(ALLOWED_TO_NAME_THEM):
                continue

            body = path.read_text()

            for field in LEGACY_ITEM_FIELDS:
                if field in body:
                    offenders.append(f"{relative}: {field}")

        self.assertEqual(offenders, [])

    def test_taking_a_service_out_of_msp_leaves_the_item_alone(self):
        service = self.offering("ITM")
        before = frappe.db.get_value(
            "Item", service, ["disabled", "is_sales_item", "is_stock_item", "stock_uom"], as_dict=True
        )

        CatalogueService.remove_service_from_msp(item=service, mode="keep")

        after = frappe.db.get_value(
            "Item", service, ["disabled", "is_sales_item", "is_stock_item", "stock_uom"], as_dict=True
        )

        self.assertEqual(before, after)
        self.assertIsNotNone(self.definition(service))
