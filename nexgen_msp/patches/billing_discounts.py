import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

FIELD = "msp_discount_percent"


def execute():
	"""A rate may carry a discount that travels with it for as long as the rate applies."""
	create_custom_field(
		"Item Price",
		{
			"fieldname": FIELD,
			"label": "Discount %",
			"fieldtype": "Percent",
			"description": "Applied automatically while this rate is the one in force.",
			"insert_after": "price_list_rate",
		},
	)

	frappe.db.commit()
