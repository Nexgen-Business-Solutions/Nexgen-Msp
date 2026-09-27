"""The ERPNext site is not ours: a seed touches no Item, and a repair puts back only proof."""

import frappe

from nexgen_msp.diagnostics import item_integrity
from nexgen_msp.patches import billing_month_uom
from nexgen_msp.utils.catalogue import BILLING_UOM as MONTH
from nexgen_msp.utils.errors import NexgenError

from .base import MSPTestCase


class IntegrityCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)

    def legacy_item(self, suffix, **fields):
        """An Item the site had before MSP, with the unit its own business chose."""
        code = f"ZZTEST-LEGACY-{suffix}{self.tag[:4]}"
        doc = frappe.get_doc(
            {
                "doctype": "Item",
                "item_code": code,
                "item_name": f"Legacy {suffix}",
                "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
                "is_stock_item": 0,
                "is_sales_item": 1,
                "stock_uom": "Unit",
                "sales_uom": "Unit",
                **fields,
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        self.track("Item", doc.name)

        return doc.name

    def msp_wrote(self, item, **fields):
        """A change recorded the way the site records it: Frappe skips versions in tests."""
        doc = frappe.get_doc("Item", item)

        for field, value in fields.items():
            doc.set(field, value)

        doc.save(ignore_permissions=True, ignore_version=False)
        frappe.db.commit()

    def card(self, item):
        return frappe.db.get_value(
            "Item", item, ["disabled", "stock_uom", "sales_uom", "modified"], as_dict=True
        )


class TestTheBillingUnitSeed(IntegrityCase):
    def test_it_creates_the_month_when_the_site_has_none(self):
        existed = frappe.db.exists("UOM", MONTH)

        if existed:
            frappe.db.set_value("UOM", MONTH, "must_be_whole_number", 1)

        billing_month_uom.execute()

        self.assertTrue(frappe.db.exists("UOM", MONTH))
        self.assertFalse(frappe.db.get_value("UOM", MONTH, "must_be_whole_number"))

    def test_it_only_lets_the_month_be_halved(self):
        frappe.db.set_value("UOM", MONTH, "must_be_whole_number", 1)
        before = frappe.db.get_value("UOM", MONTH, "uom_name")

        billing_month_uom.execute()

        self.assertEqual(frappe.db.get_value("UOM", MONTH, "uom_name"), before)
        self.assertFalse(frappe.db.get_value("UOM", MONTH, "must_be_whole_number"))

    def test_it_leaves_every_item_alone(self):
        theirs = self.legacy_item("SEED")
        before = self.card(theirs)

        billing_month_uom.execute()

        self.assertEqual(self.card(theirs), before)
        self.assertEqual(frappe.db.get_value("Item", theirs, "stock_uom"), "Unit")
        self.assertFalse(
            frappe.db.exists("UOM Conversion Detail", {"parent": theirs, "uom": MONTH})
        )

    def test_running_it_twice_changes_nothing_more(self):
        theirs = self.legacy_item("TWICE")
        billing_month_uom.execute()
        after_first = self.card(theirs)

        billing_month_uom.execute()

        self.assertEqual(self.card(theirs), after_first)
        self.assertFalse(frappe.db.get_value("UOM", MONTH, "must_be_whole_number"))

    def test_the_seed_says_what_it_did(self):
        from nexgen_msp.utils import seeds

        frappe.db.set_value("UOM", MONTH, "must_be_whole_number", 1)

        self.assertEqual(seeds._uom(), "Month billing unit")
        self.assertIsNone(seeds._uom())


class TestTheAudit(IntegrityCase):
    def test_it_sees_an_item_msp_disabled_and_proves_what_it_held(self):
        item = self.legacy_item("DIS")
        self.msp_wrote(item, disabled=1)

        row = self.row(item)

        self.assertEqual(row["disabled"], 1)
        self.assertEqual(frappe.utils.cint(row["previous_disabled_value"]), 0)
        self.assertIsNotNone(row["disabled_last_changed_at"])
        self.assertEqual(row["evidence_level"], item_integrity.HIGH)
        self.assertEqual(row["group"], item_integrity.SAFE)

    def test_it_reads_a_unit_the_old_patch_overwrote(self):
        item = self.legacy_item("UOM")
        self.msp_wrote(item, stock_uom=MONTH, sales_uom=MONTH)

        row = self.row(item)

        self.assertEqual(row["previous_stock_uom"], "Unit")
        self.assertEqual(row["previous_sales_uom"], "Unit")
        self.assertEqual(row["evidence_level"], item_integrity.HIGH)

    def test_an_item_nobody_touched_is_left_alone(self):
        item = self.legacy_item("QUIET")

        row = self.row(item)

        self.assertEqual(row["evidence_level"], item_integrity.NONE)
        self.assertEqual(row["group"], item_integrity.LEAVE)
        self.assertEqual(row["restorable"], {})

    def test_reading_the_audit_changes_nothing(self):
        item = self.legacy_item("READ")
        before = self.card(item)

        item_integrity.audit()

        self.assertEqual(self.card(item), before)

    def row(self, item):
        rows = item_integrity.audit()["rows"]

        return next(row for row in rows if row["item_code"] == item)


class TestRestoring(IntegrityCase):
    def msp_disabled(self, suffix="R"):
        item = self.legacy_item(suffix)
        self.msp_wrote(item, disabled=1)

        return item

    def test_only_the_field_that_was_selected_is_written(self):
        item = self.msp_disabled("SEL")
        frappe.db.set_value("Item", item, "item_name", "Renamed by the site")

        out = item_integrity.restore([{"item": item, "fields": {"disabled": 1}}])

        self.assertTrue(out["results"][0]["ok"])
        self.assertFalse(frappe.db.get_value("Item", item, "disabled"))
        self.assertEqual(frappe.db.get_value("Item", item, "item_name"), "Renamed by the site")
        self.assertEqual(frappe.db.get_value("Item", item, "stock_uom"), "Unit")

    def test_an_item_that_moved_since_the_audit_is_refused(self):
        item = self.msp_disabled("STALE")
        # somebody enabled it again between the audit and the repair
        frappe.db.set_value("Item", item, "disabled", 0)
        frappe.db.commit()

        out = item_integrity.restore([{"item": item, "fields": {"disabled": 1}}])

        self.assertFalse(out["results"][0]["ok"])
        self.assertEqual(out["results"][0]["code"], "ITEM_CHANGED_SINCE_AUDIT")

    def test_an_item_with_no_proof_is_never_restored(self):
        item = self.legacy_item("NOPROOF")
        frappe.db.set_value("Item", item, "disabled", 1)
        frappe.db.commit()

        out = item_integrity.restore([{"item": item, "fields": {"disabled": 1}}])

        self.assertFalse(out["results"][0]["ok"])
        self.assertEqual(out["results"][0]["code"], "NO_PROVEN_PREVIOUS_STATE")
        self.assertTrue(frappe.db.get_value("Item", item, "disabled"))

    def test_an_item_that_no_longer_exists_says_so(self):
        out = item_integrity.restore([{"item": "ZZTEST-GONE-XYZ", "fields": {"disabled": 1}}])

        self.assertEqual(out["results"][0]["code"], "ITEM_NOT_FOUND")

    def test_it_is_refused_to_anyone_but_an_administrator(self):
        tech = self.make_account("internal", "MSP Technician", suffix=f"ii{self.tag[:3]}")
        frappe.set_user(tech)

        try:
            with self.assertRaises(NexgenError) as refused:
                item_integrity.audit()
            self.assertIn("not allowed to repair", str(refused.exception))
        finally:
            frappe.set_user("Administrator")
