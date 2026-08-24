import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

FIELD = "msp_free_of_charge"


def execute():
	"""Some customers are served at no charge and must stay out of the billing machinery."""
	create_custom_field(
		"Customer",
		{
			"fieldname": FIELD,
			"label": "Free of charge",
			"fieldtype": "Check",
			"description": "Served at no charge: never billed, needs no contract and no rates.",
			"insert_after": "customer_group",
		},
	)

	frappe.db.commit()
