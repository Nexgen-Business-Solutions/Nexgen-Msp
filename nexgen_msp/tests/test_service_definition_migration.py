"""What the migration turns into an MSP service, and what it leaves as a plain ERPNext Item.

An Item belongs to the site. Most of them are accounts, expenses and stock, and MSP has no
business having an opinion about any of them. The one-time migration exists to give a record
to the services MSP was already selling — and to nothing else.

The rule it has to keep is the narrow one: what MSP *did* with an Item is what counts. A scope
written on an Item by an import, or by somebody opening the form once and saving it, is not a
service. A site can carry hundreds of Items in that state, and defining each of them would
turn the chart of accounts into a catalogue.
"""

import frappe

from nexgen_msp.api.internal.services.service_definition_service import DEFINITION
from nexgen_msp.patches.msp_service_definitions import _items_msp_knows

from .base import MSPTestCase


class WhatTheMigrationDefinesCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)

    def _plain_item(self, suffix, **fields):
        """An ERPNext Item nobody has sold as a service."""
        code = f"ZZMIG-{self.tag[:4]}-{suffix}"

        frappe.get_doc(
            {
                "doctype": "Item",
                "item_code": code,
                "item_name": code,
                "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
                "is_stock_item": 0,
                "is_sales_item": 1,
                **fields,
            }
        ).insert(ignore_permissions=True)
        self.track("Item", code)

        return code

    def test_an_item_with_a_scope_and_no_history_is_not_a_service(self):
        item = self._plain_item("SCOPED", msp_service_scope="User")

        self.assertNotIn(
            item,
            _items_msp_knows(),
            "a scope written on an Item is not a service MSP ever sold",
        )

    def test_an_item_with_an_invoice_label_and_no_history_is_not_a_service(self):
        item = self._plain_item("LABEL", msp_invoice_label="Looks like a service")

        self.assertNotIn(item, _items_msp_knows())

    def test_a_plain_expense_account_is_left_alone(self):
        item = self._plain_item("EXPENSE")

        self.assertNotIn(item, _items_msp_knows())

    def test_a_service_somebody_holds_is_defined(self):
        customer = self.make_customer(f"MG{self.tag[:4]}")
        person = self.make_person(customer, "Mig")
        service = self.make_service(f"MG{self.tag[:3]}")

        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        self.track(
            "MSP Service Assignment",
            ServiceLifecycleService.activate(
                customer=customer,
                service_item=service,
                target_scope="User",
                client_user=person,
            )["name"],
        )

        self.assertIn(service, _items_msp_knows(), "an Item somebody holds is a service")

    def test_a_service_a_contract_covers_is_defined(self):
        customer = self.make_customer(f"MC{self.tag[:4]}")
        service = self.make_service(f"MC{self.tag[:3]}")
        self.cover_service(customer, service)

        self.assertIn(service, _items_msp_knows(), "an Item a contract sells is a service")

    def test_an_item_the_old_release_switched_on_is_defined(self):
        if not frappe.db.has_column("Item", "msp_service_enabled"):
            self.skipTest("the compatibility column is gone from this site")

        item = self._plain_item("SWITCHED")
        frappe.db.set_value("Item", item, "msp_service_enabled", 1, update_modified=False)

        self.assertIn(
            item,
            _items_msp_knows(),
            "switching a service on was a deliberate act, and it is carried over",
        )

    def test_it_never_touches_an_item_it_already_defined(self):
        service = self.make_service(f"MI{self.tag[:3]}")
        before = frappe.db.count(DEFINITION, {"item": service})

        from nexgen_msp.patches.msp_service_definitions import execute

        execute()

        self.assertEqual(
            frappe.db.count(DEFINITION, {"item": service}),
            before,
            "running the migration twice does not make a second definition",
        )

    def test_the_site_keeps_more_items_than_it_has_services(self):
        """The shape of the result, not its size: most Items are not services and stay that way."""
        defined = _items_msp_knows()
        items = frappe.db.count("Item")

        self.assertLess(
            len(defined),
            items,
            "a migration that defines every Item has misread what an MSP service is",
        )
