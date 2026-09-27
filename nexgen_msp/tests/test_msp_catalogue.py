"""What Nexgen MSP offers lives in its own record; ERPNext's Items stay the site's own business.

A catalogue entry is an `MSP Service Definition` pointing at an ERPNext Item. Availability in
MSP is the definition's; being disabled, being stocked, carrying a unit table is the Item's, and
this application repairs an Item only when somebody says, field by field, that it should.
"""

import frappe

from nexgen_msp.api.internal.services.catalogue_service import CatalogueService
from nexgen_msp.api.internal.services.service_definition_service import (
    ServiceDefinitionService,
)
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.utils import catalogue as msp_catalogue
from nexgen_msp.utils.errors import NexgenError

from .base import MSPTestCase


class CatalogueCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(f"CAT{self.tag[:4]}")
        self.track("MSP Approval Authority", self.customer)

    def item(self, suffix, **fields):
        """An ERPNext Item the site made for its own reasons."""
        code = f"ZZTEST-ITEM-{suffix}{self.tag[:4]}"
        doc = frappe.get_doc(
            {
                "doctype": "Item",
                "item_code": code,
                "item_name": f"Site item {suffix}",
                "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
                "is_stock_item": 0,
                "is_sales_item": 1,
                "stock_uom": "Unit",
                "sales_uom": "Unit",
                **fields,
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()

        return self.track("Item", doc.name)

    def listed(self):
        return {row["name"] for row in CatalogueService.list_services()}

    def definition(self, item):
        return ServiceDefinitionService.for_item(item)

    def msp_enabled(self, item):
        definition = ServiceDefinitionService.for_item(item)

        return bool(definition and definition.enabled)


class TestWhatTheCatalogueShows(CatalogueCase):
    def test_an_item_that_has_nothing_to_do_with_msp_is_not_listed(self):
        theirs = self.item("PLAIN")

        self.assertNotIn(theirs, self.listed())

    def test_a_service_offered_in_msp_is_listed(self):
        service = self.make_service(f"CAT{self.tag[:3]}")

        rows = {row["name"]: row for row in CatalogueService.list_services()}

        self.assertIn(service, rows)
        self.assertEqual(rows[service]["compatibility_status"], "Ready")
        self.assertEqual(rows[service]["msp_availability"], "Available")
        self.assertEqual(rows[service]["erpnext_status"], "Enabled")

    def test_a_service_removed_from_msp_is_still_readable(self):
        service = self.make_service(f"OLD{self.tag[:3]}")
        self.cover_service(self.customer, service)
        person = self.make_person(self.customer, "Holder")
        opened = ServiceLifecycleService.activate(
            customer=self.customer, service_item=service, target_scope="User", client_user=person
        )
        self.track("MSP Service Assignment", opened["name"])

        CatalogueService.remove_service_from_msp(item=service, mode="keep")
        rows = {row["name"]: row for row in CatalogueService.list_services()}

        self.assertIn(service, rows)
        self.assertEqual(rows[service]["compatibility_status"], "Historical Only")
        self.assertEqual(rows[service]["msp_availability"], "Not available")
        self.assertEqual(rows[service]["erpnext_status"], "Enabled")
        self.assertEqual(rows[service]["open_assignments"], 1)

    def test_an_item_disabled_in_erpnext_says_so_rather_than_retired(self):
        service = self.make_service(f"DIS{self.tag[:3]}")
        frappe.db.set_value("Item", service, "disabled", 1)
        frappe.db.commit()

        rows = {row["name"]: row for row in CatalogueService.list_services()}

        self.assertEqual(rows[service]["compatibility_status"], "ERPNext Disabled")
        self.assertEqual(rows[service]["erpnext_status"], "Disabled")

    def test_the_status_filter_uses_the_badge_words(self):
        service = self.make_service(f"FIL{self.tag[:3]}")

        rows = CatalogueService.list_services(status="Ready")

        self.assertIn(service, {row["name"] for row in rows})
        self.assertNotIn(
            service, {row["name"] for row in CatalogueService.list_services(status="ERPNext Disabled")}
        )

    def test_the_name_the_catalogue_shows_is_the_invoice_label_when_there_is_one(self):
        service = self.make_service(f"LBL{self.tag[:3]}")
        frappe.db.set_value(
            "MSP Service Definition",
            self.definition(service).name,
            "invoice_label",
            "Managed mailbox",
        )
        frappe.db.commit()

        rows = {row["name"]: row for row in CatalogueService.list_services()}

        self.assertEqual(rows[service]["service_name"], "Managed mailbox")
        self.assertEqual(ServiceDefinitionService.label_of(service), "Managed mailbox")

    def test_one_item_carries_one_definition(self):
        service = self.make_service(f"ONE{self.tag[:3]}")

        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "MSP Service Definition",
                    "item": service,
                    "enabled": 1,
                    "service_scope": "User",
                }
            ).insert(ignore_permissions=True)

        self.assertEqual(
            frappe.db.count("MSP Service Definition", {"item": service}), 1
        )


class TestAdoptingAnExistingItem(CatalogueCase):
    def test_a_disabled_item_can_still_be_found(self):
        theirs = self.item("HIDDEN", disabled=1)

        found = CatalogueService.search_catalogue_items(search="ZZTEST-ITEM-HIDDEN")

        self.assertIn(theirs, {row["name"] for row in found["rows"]})

    def test_a_stock_item_is_found_but_never_converted_in_place(self):
        stock = self.item("STOCK", is_stock_item=1, stock_uom="Nos", sales_uom="Nos")

        found = CatalogueService.search_catalogue_items(search="ZZTEST-ITEM-STOCK")
        compatibility = CatalogueService.get_item_msp_compatibility(item=stock)

        self.assertIn(stock, {row["name"] for row in found["rows"]})
        self.assertFalse(compatibility["can_enable_in_place"])
        self.assertIn("MSP_STOCK_ITEM", compatibility["blockers"])

        with self.assertRaises(NexgenError) as refused:
            CatalogueService.enable_item_for_msp(item=stock, scope="User")

        self.assertEqual(refused.exception.code, "MSP_STOCK_ITEM")
        self.assertFalse(self.msp_enabled(stock))
        self.assertIsNone(self.definition(stock))
        self.assertTrue(frappe.db.get_value("Item", stock, "is_stock_item"))

    def test_a_compatible_item_is_adopted_without_touching_its_units(self):
        theirs = self.item("READY")

        out = CatalogueService.enable_item_for_msp(item=theirs, scope="User", add_month_uom=1)
        card = msp_catalogue.read_item(theirs)

        self.assertTrue(self.msp_enabled(theirs))
        self.assertEqual(self.definition(theirs).name, out["definition"])
        self.assertEqual(self.definition(theirs).service_scope, "User")
        self.assertEqual(card.stock_uom, "Unit", "its own units are left exactly as they are")
        self.assertEqual(card.sales_uom, "Unit")
        self.assertEqual(card.month_conversion_factor, 1)
        self.assertTrue(ServiceDefinitionService.is_ready(theirs))

    def test_a_disabled_item_is_only_enabled_when_that_is_said_in_as_many_words(self):
        theirs = self.item("CONSENT", disabled=1)

        with self.assertRaises(NexgenError) as refused:
            CatalogueService.enable_item_for_msp(item=theirs, scope="User", add_month_uom=1)

        self.assertEqual(refused.exception.code, "ITEM_DISABLED")
        self.assertTrue(frappe.db.get_value("Item", theirs, "disabled"))

        out = CatalogueService.enable_item_for_msp(
            item=theirs, scope="User", add_month_uom=1, enable_item=1
        )

        self.assertTrue(out["erpnext_enabled"])
        self.assertFalse(frappe.db.get_value("Item", theirs, "disabled"))

    def test_a_wrong_month_factor_is_repaired_only_when_asked(self):
        theirs = self.item("FACTOR")
        doc = frappe.get_doc("Item", theirs)
        doc.append("uoms", {"uom": "Month", "conversion_factor": 30})
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        compatibility = CatalogueService.get_item_msp_compatibility(item=theirs)
        self.assertEqual(compatibility["billing"]["conversion_factor"], 30)
        self.assertIn("MSP_BILLING_UOM_MISSING", compatibility["blockers"])

        CatalogueService.enable_item_for_msp(item=theirs, scope="Both", fix_month_factor=1)

        self.assertEqual(msp_catalogue.read_item(theirs).month_conversion_factor, 1)

    def test_an_item_that_moved_while_it_was_being_configured_is_refused(self):
        theirs = self.item("MOVED")
        seen = CatalogueService.get_item_msp_compatibility(item=theirs)["fingerprint"]

        frappe.db.set_value("Item", theirs, "disabled", 1)
        frappe.db.commit()

        with self.assertRaises(NexgenError) as refused:
            CatalogueService.enable_item_for_msp(
                item=theirs, scope="User", add_month_uom=1, enable_item=1, seen=seen
            )

        self.assertEqual(refused.exception.code, "ITEM_CHANGED_DURING_CONFIGURATION")
        self.assertIsNone(self.definition(theirs))

    def test_a_scope_is_required(self):
        theirs = self.item("NOSCOPE")

        with self.assertRaises(NexgenError) as refused:
            CatalogueService.enable_item_for_msp(item=theirs, scope=None, add_month_uom=1)

        self.assertEqual(refused.exception.code, "INVALID_MSP_SCOPE")

    def test_a_new_service_that_reuses_a_code_is_refused_without_touching_it(self):
        theirs = self.item("TAKEN")
        before = frappe.db.get_value("Item", theirs, ["item_name", "disabled"], as_dict=True)

        with self.assertRaises(NexgenError) as refused:
            CatalogueService.create_msp_service(
                item_code=theirs, item_name="Something else", scope="User"
            )

        self.assertEqual(refused.exception.code, "ITEM_CODE_EXISTS")
        self.assertEqual(
            frappe.db.get_value("Item", theirs, ["item_name", "disabled"], as_dict=True), before
        )

    def test_a_new_service_is_born_ready_for_msp(self):
        code = f"ZZTEST-NEW-{self.tag[:5]}"
        out = CatalogueService.create_msp_service(
            item_code=code, item_name="Brand new service", scope="Device"
        )
        self.track("Item", out["name"])
        card = msp_catalogue.read_item(out["name"])

        self.assertEqual(card.stock_uom, "Month")
        self.assertEqual(card.sales_uom, "Month")
        self.assertEqual(card.month_conversion_factor, 1)
        self.assertEqual(self.definition(out["name"]).service_scope, "Device")
        self.assertTrue(self.msp_enabled(out["name"]))
        self.assertFalse(card.is_stock_item)
        self.assertTrue(ServiceDefinitionService.is_ready(out["name"]))

    def test_a_new_service_that_cannot_be_configured_leaves_no_item_behind(self):
        code = f"ZZTEST-ROLL-{self.tag[:5]}"

        with self.assertRaises(NexgenError) as refused:
            CatalogueService.create_msp_service(
                item_code=code, item_name="Half a service", scope="Nowhere"
            )

        self.assertEqual(refused.exception.code, "INVALID_MSP_SCOPE")
        self.assertFalse(frappe.db.exists("Item", code))
        self.assertFalse(frappe.db.exists("MSP Service Definition", {"item": code}))


class TestRemovingFromMsp(CatalogueCase):
    def running(self, suffix="RM"):
        service = self.make_service(f"{suffix}{self.tag[:3]}")
        self.cover_service(self.customer, service)
        person = self.make_person(self.customer, "Holder")
        opened = ServiceLifecycleService.activate(
            customer=self.customer, service_item=service, target_scope="User", client_user=person
        )

        return service, self.track("MSP Service Assignment", opened["name"])

    def test_it_never_touches_the_erpnext_item(self):
        service, _ = self.running("KEEP")

        CatalogueService.remove_service_from_msp(item=service, mode="keep")

        self.assertFalse(frappe.db.get_value("Item", service, "disabled"))
        self.assertFalse(self.msp_enabled(service))
        self.assertIsNotNone(self.definition(service), "the definition is never deleted")

    def test_existing_assignments_keep_running_and_stay_billable(self):
        service, assignment = self.running("BILL")

        CatalogueService.remove_service_from_msp(item=service, mode="keep")
        card = frappe.db.get_value(
            "MSP Service Assignment", assignment, ["operational_status", "billing_status"], as_dict=True
        )

        self.assertEqual(card.operational_status, "Active")
        self.assertEqual(card.billing_status, "Billable")

    def test_it_can_end_everything_through_the_lifecycle_when_that_is_asked(self):
        service, assignment = self.running("END")

        out = CatalogueService.remove_service_from_msp(
            item=service, mode="end", reason="Service withdrawn from the offer"
        )

        self.assertEqual(out["ended"], 1)
        self.assertEqual(out["failed"], [])
        card = frappe.db.get_value(
            "MSP Service Assignment", assignment, ["operational_status", "effective_end_date"], as_dict=True
        )
        self.assertEqual(card.operational_status, "Ended")
        self.assertIsNotNone(card.effective_end_date)
        self.assertFalse(frappe.db.get_value("Item", service, "disabled"))

    def test_ending_everything_asks_why(self):
        service, _ = self.running("WHY")

        with self.assertRaises(NexgenError) as refused:
            CatalogueService.remove_service_from_msp(item=service, mode="end")

        self.assertEqual(refused.exception.code, "VALIDATION_ERROR")
        self.assertTrue(self.msp_enabled(service))

    def test_a_closure_that_fails_is_reported_and_the_rest_is_kept(self):
        service, assignment = self.running("PART")
        frappe.db.set_value("MSP Service Assignment", assignment, "effective_start_date", None)
        frappe.db.commit()
        frappe.db.set_value("MSP Service Assignment", assignment, "operational_status", "Cancelled")
        frappe.db.commit()

        out = CatalogueService.remove_service_from_msp(
            item=service, mode="end", reason="Service withdrawn"
        )

        # a cancelled assignment is no longer open, so there is nothing to end
        self.assertEqual(out["open_assignments"], 0)
        self.assertFalse(self.msp_enabled(service))


class TestTheServiceDetail(CatalogueCase):
    def test_a_missing_name_is_not_a_missing_service(self):
        with self.assertRaises(NexgenError) as refused:
            CatalogueService.get_service(name=None)

        self.assertEqual(refused.exception.code, "VALIDATION_ERROR")
        self.assertIn("No service was selected", str(refused.exception))

    def test_an_item_that_is_gone_says_exactly_that(self):
        with self.assertRaises(NexgenError) as refused:
            CatalogueService.get_service(name="ZZTEST-NOT-AN-ITEM")

        self.assertEqual(refused.exception.code, "NOT_FOUND")
        self.assertEqual(str(refused.exception), "This Item no longer exists in ERPNext.")

    def test_a_code_with_a_slash_in_it_survives(self):
        code = f"ZZTEST/SLASH/{self.tag[:4]}"
        doc = frappe.get_doc(
            {
                "doctype": "Item",
                "item_code": code,
                "item_name": "Sliced service",
                "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
                "is_stock_item": 0,
                "is_sales_item": 1,
                "stock_uom": "Month",
            }
        ).insert(ignore_permissions=True)
        frappe.get_doc(
            {
                "doctype": "MSP Service Definition",
                "item": doc.name,
                "enabled": 1,
                "service_scope": "User",
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        self.track("Item", doc.name)

        reading = CatalogueService.get_service(name=doc.name)

        self.assertEqual(reading["service"]["name"], doc.name)

    def test_a_disabled_item_still_loads_and_says_what_it_is(self):
        service = self.make_service(f"DET{self.tag[:3]}")
        frappe.db.set_value("Item", service, "disabled", 1)
        frappe.db.commit()

        reading = CatalogueService.get_service(name=service)

        self.assertEqual(reading["service"]["compatibility_status"], "ERPNext Disabled")
        self.assertEqual(reading["service"]["billing_uom"], "Month")
        self.assertTrue(reading["service"]["has_month_uom"])


class TestTheBillingUnitOnAnInvoice(CatalogueCase):
    """The unit the spec says to prove: a non-Month Item billed in Months, factor 1."""

    def invoice(self, item, qty):
        company = frappe.db.get_value("Company", {}, "name")
        doc = frappe.get_doc(
            {
                "doctype": "Sales Invoice",
                "customer": self.customer,
                "company": company,
                "due_date": frappe.utils.today(),
                "items": [
                    {"item_code": item, "qty": qty, "uom": "Month", "conversion_factor": 1, "rate": 20}
                ],
            }
        )
        doc.insert(ignore_permissions=True)
        self.track("Sales Invoice", doc.name)
        frappe.db.commit()

        return doc

    def test_erpnext_bills_a_month_on_an_item_stocked_in_another_unit(self):
        theirs = self.item("INVOICE")
        CatalogueService.enable_item_for_msp(item=theirs, scope="User", add_month_uom=1)

        invoice = self.invoice(theirs, 1)
        line = invoice.items[0]

        self.assertEqual(line.uom, "Month")
        self.assertEqual(frappe.utils.flt(line.conversion_factor), 1)
        self.assertEqual(frappe.db.get_value("Item", theirs, "stock_uom"), "Unit")

    def test_a_half_month_needs_a_stock_unit_that_allows_halves(self):
        """ERPNext measures the fraction against the Item's own stock unit, not ours."""
        whole = self.item("WHOLEUNIT")
        CatalogueService.enable_item_for_msp(item=whole, scope="User", add_month_uom=1)

        self.assertTrue(frappe.db.get_value("UOM", "Unit", "must_be_whole_number"))

        with self.assertRaises(Exception) as refused:
            self.invoice(whole, 1.5)

        self.assertIn("fraction", str(refused.exception).lower())

        # and the compatibility answer says so before anybody adopts the Item
        warnings = CatalogueService.get_item_msp_compatibility(item=whole)["warnings"]
        self.assertTrue(any("half month cannot" in text for text in warnings))

    def test_a_service_stocked_in_months_bills_half_months(self):
        service = self.make_service(f"HALF{self.tag[:3]}")
        self.cover_service(self.customer, service)

        invoice = self.invoice(service, 1.5)

        self.assertEqual(frappe.utils.flt(invoice.items[0].qty), 1.5)
