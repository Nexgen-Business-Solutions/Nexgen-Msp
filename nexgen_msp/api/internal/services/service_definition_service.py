"""The one place that answers what MSP knows about a service.

An ERPNext Item is the site's own: it is the accounting master, and other applications and
older processes may use it for reasons that have nothing to do with us. What MSP decides about
an Item — whether it may still be sold as a service, at which scope, under which invoice name —
lives in `MSP Service Definition`, one record per Item.

Every screen and every domain service asks its question here: readiness for new work, the scope
a service is sold at, the name it is invoiced under, and why an Item cannot be used yet. History
never asks: an assignment made years ago stays readable whatever the catalogue says today.
"""

import frappe

from nexgen_msp.utils import catalogue as items

DEFINITION = "MSP Service Definition"

# what MSP sells a service against
SCOPES = ("User", "Device", "Both")

# the compatibility state a catalogue row is in, most blocking first
STATUS_PRIORITY = (
    "Stock Item",
    "ERPNext Disabled",
    "Historical Only",
    "Needs Configuration",
    "Ready",
)


class ServiceDefinitionService:
    # ------------------------------------------------------------------ reading
    @staticmethod
    def for_item(item):
        """The MSP definition of this Item, or nothing when MSP knows none."""
        if not item:
            return None

        return frappe.db.get_value(
            DEFINITION,
            {"item": item},
            ["name", "item", "enabled", "service_scope", "invoice_label"],
            as_dict=True,
        )

    @staticmethod
    def definitions_by_item(item_codes):
        """The definitions of several Items at once, for a list that must not query per row."""
        codes = [code for code in (item_codes or []) if code]

        if not codes:
            return {}

        return {
            row.item: row
            for row in frappe.get_all(
                DEFINITION,
                filters={"item": ("in", codes)},
                fields=["name", "item", "enabled", "service_scope", "invoice_label"],
            )
        }

    @staticmethod
    def scope_of(item, default="Both"):
        """What this service is sold against.

        A service with no definition is history: it is read at the widest scope so an old
        assignment still renders, and no new work may be opened on it.
        """
        definition = ServiceDefinitionService.for_item(item)
        scope = (definition.service_scope if definition else None) or ""

        return scope if scope in SCOPES else default

    @staticmethod
    def label_of(item):
        """The name this service is invoiced and listed under."""
        definition = ServiceDefinitionService.for_item(item)
        label = (definition.invoice_label if definition else None) or ""

        return label.strip() or frappe.db.get_value("Item", item, "item_name") or item

    @staticmethod
    def labels_by_item(item_codes):
        """The same answer for several Items, read in two queries rather than two per row."""
        codes = [code for code in (item_codes or []) if code]

        if not codes:
            return {}

        definitions = ServiceDefinitionService.definitions_by_item(codes)
        names = {
            row.name: row.item_name
            for row in frappe.get_all(
                "Item", filters={"name": ("in", codes)}, fields=["name", "item_name"]
            )
        }

        labels = {}

        for code in codes:
            declared = (definitions.get(code, {}) or {}).get("invoice_label") or ""
            labels[code] = declared.strip() or names.get(code) or code

        return labels

    # ------------------------------------------------------------------ readiness
    @staticmethod
    def blockers(item, definition=None, card=None):
        """Every reason this Item cannot carry new MSP work, in evaluation order."""
        card = card or items.read_item(item)

        if not card:
            return ["ITEM_NOT_FOUND"]

        definition = definition if definition is not None else ServiceDefinitionService.for_item(item)
        found = []

        if frappe.utils.cint(card.get("is_stock_item")):
            found.append("MSP_STOCK_ITEM")

        if frappe.utils.cint(card.get("disabled")):
            found.append("ITEM_DISABLED")

        if not frappe.utils.cint(card.get("is_sales_item")):
            found.append("ITEM_NOT_SELLABLE")

        if not definition:
            found.append("MSP_DEFINITION_MISSING")
        elif (definition.get("service_scope") or "") not in SCOPES:
            found.append("INVALID_MSP_SCOPE")

        if not card.get("month_ready"):
            found.append("MSP_BILLING_UOM_MISSING")

        return found

    @staticmethod
    def is_ready(item, definition=None, card=None):
        """Whether this Item may be chosen for new MSP assignments, requests or contracts."""
        definition = definition if definition is not None else ServiceDefinitionService.for_item(item)

        if not definition or not frappe.utils.cint(definition.get("enabled")):
            return False

        return not ServiceDefinitionService.blockers(item, definition=definition, card=card)

    @staticmethod
    def compatibility(item, definition=None, card=None):
        """The single state the catalogue shows for this service."""
        card = card or items.read_item(item)

        if not card:
            return "ERPNext Disabled"

        definition = definition if definition is not None else ServiceDefinitionService.for_item(item)

        if frappe.utils.cint(card.get("is_stock_item")):
            return "Stock Item"

        if frappe.utils.cint(card.get("disabled")):
            return "ERPNext Disabled"

        if definition and not frappe.utils.cint(definition.get("enabled")):
            return "Historical Only"

        blockers = [
            code
            for code in ServiceDefinitionService.blockers(item, definition=definition, card=card)
            if code not in ("MSP_STOCK_ITEM", "ITEM_DISABLED")
        ]

        return "Needs Configuration" if blockers else "Ready"

    @staticmethod
    def diagnostics(item):
        """Everything a configuration screen needs to say about one Item, in one answer."""
        card = items.read_item(item)

        if not card:
            return None

        definition = ServiceDefinitionService.for_item(item)
        blockers = ServiceDefinitionService.blockers(item, definition=definition, card=card)

        return {
            **card,
            "definition": definition.name if definition else None,
            "in_msp": bool(definition),
            "msp_enabled": bool(definition and frappe.utils.cint(definition.enabled)),
            "service_scope": definition.service_scope if definition else None,
            "invoice_label": definition.invoice_label if definition else None,
            "blockers": blockers,
            "messages": [items.BLOCKERS[code] for code in blockers if code in items.BLOCKERS],
            "compatibility_status": ServiceDefinitionService.compatibility(
                item, definition=definition, card=card
            ),
            "ready": ServiceDefinitionService.is_ready(item, definition=definition, card=card),
            "site_uom_allows_halves": items.site_uom_allows_halves(),
        }

    # ------------------------------------------------------------------ selecting
    @staticmethod
    def available_condition(alias="item", definition_alias="msp_def"):
        """The readiness rule as SQL, for the screens that list what may be chosen."""
        return f"""
            exists (
                select 1 from `tab{DEFINITION}` {definition_alias}
                where {definition_alias}.item = {alias}.name
                  and {definition_alias}.enabled = 1
                  and ifnull({definition_alias}.service_scope, '') in ('User', 'Device', 'Both')
            )
            and {alias}.disabled = 0
            and {alias}.is_stock_item = 0
            and {alias}.is_sales_item = 1
            and exists (
                select 1 from `tabUOM Conversion Detail` msp_uom
                where msp_uom.parent = {alias}.name
                  and msp_uom.parenttype = 'Item'
                  and msp_uom.uom = '{items.BILLING_UOM}'
                  and msp_uom.conversion_factor = 1
            )
        """

    @staticmethod
    def available_items(scopes=None):
        """Every Item that may be chosen for new MSP work, at these scopes."""
        values = {}
        clause = ServiceDefinitionService.available_condition("item")

        if scopes:
            clause += """
                and exists (
                    select 1 from `tab%s` scope_def
                    where scope_def.item = item.name and scope_def.service_scope in %%(scopes)s
                )
            """ % DEFINITION
            values["scopes"] = tuple(scopes)

        return frappe.db.sql_list(f"select item.name from `tabItem` item where {clause}", values)

    @staticmethod
    def available_rows(scopes=None):
        """The same list with what a picker shows: the Item, its MSP name and its scope."""
        codes = ServiceDefinitionService.available_items(scopes)

        if not codes:
            return []

        definitions = ServiceDefinitionService.definitions_by_item(codes)
        rows = []

        for item in frappe.get_all(
            "Item",
            filters={"name": ("in", codes)},
            fields=["name", "item_name", "stock_uom", "description"],
            order_by="item_name asc",
        ):
            definition = definitions.get(item.name)
            rows.append(
                {
                    **item,
                    "item_name": (definition.invoice_label if definition else None)
                    or item.item_name
                    or item.name,
                    "service_scope": definition.service_scope if definition else "Both",
                }
            )

        return rows
