import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

FIELD = "msp_billed_count"


def execute():
	"""How many people or machines a line covers, so the invoice can show it in its own column."""
	create_custom_field(
		"Sales Invoice Item",
		{
			"fieldname": FIELD,
			"label": "Billed Count",
			"fieldtype": "Int",
			"read_only": 1,
			"insert_after": "qty",
		},
	)

	create_custom_field(
		"Sales Order Item",
		{
			"fieldname": FIELD,
			"label": "Billed Count",
			"fieldtype": "Int",
			"read_only": 1,
			"insert_after": "qty",
		},
	)

	frappe.db.commit()
