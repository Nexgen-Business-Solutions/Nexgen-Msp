"""The ERPNext facts MSP needs about an Item, and the words for what they prevent.

The site's Items are not ours. Being sellable, being enabled, being a stock item, carrying a
billing unit — those are ERPNext's own, taken for reasons that have nothing to do with us. This
module only reads them.

What MSP itself decides about an Item lives in `MSP Service Definition` and is answered by
`ServiceDefinitionService`, which is the only place that says whether a service may be sold.
"""

import frappe

# what a billing quantity is counted in; it must allow halves
BILLING_UOM = "Month"

# where a service can be attached
MSP_SCOPES = ("User", "Device", "Both")

# why an Item cannot be used, in the words the screen shows
BLOCKERS = {
	"MSP_STOCK_ITEM": (
		"MSP services must use non-stock Items. Nexgen MSP will not change an existing stock "
		"Item because doing so can affect inventory history."
	),
	"ITEM_DISABLED": (
		"This Item is disabled globally in ERPNext. "
		"It must be enabled before it can be available in MSP."
	),
	"ITEM_NOT_SELLABLE": "This Item is not marked as a sales Item.",
	"MSP_BILLING_UOM_MISSING": "Month is not configured for this Item.",
	"INVALID_MSP_SCOPE": "Choose User, Device or Both as the MSP service scope.",
	"MSP_DEFINITION_MISSING": "This Item has no MSP service definition yet.",
	"MSP_SERVICE_NOT_AVAILABLE": "This service is not available in Nexgen MSP.",
}


def month_row(item):
	"""The Month line of an Item's own unit table, if it has one."""
	return frappe.db.get_value(
		"UOM Conversion Detail",
		{"parent": item, "parenttype": "Item", "uom": BILLING_UOM},
		["name", "conversion_factor"],
		as_dict=True,
	)


def month_is_ready(item):
	row = month_row(item)

	return bool(row and frappe.utils.flt(row.conversion_factor) == 1)


def site_uom_allows_halves():
	"""A month can be a half, so the site unit must not be whole-number only."""
	if not frappe.db.exists("UOM", BILLING_UOM):
		return False

	return not frappe.db.get_value("UOM", BILLING_UOM, "must_be_whole_number")


def read_item(item):
	"""The Item facts every MSP question is answered from."""
	card = frappe.db.get_value(
		"Item",
		item,
		[
			"name",
			"item_name",
			"description",
			"item_group",
			"disabled",
			"is_stock_item",
			"is_sales_item",
			"stock_uom",
			"sales_uom",
		],
		as_dict=True,
	)

	if not card:
		return None

	row = month_row(item)
	card["month_ready"] = bool(row and frappe.utils.flt(row.conversion_factor) == 1)
	card["has_month_uom"] = bool(row)
	card["month_conversion_factor"] = frappe.utils.flt(row.conversion_factor) if row else None

	return card
