import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

FIELD = "msp_invoice_label"


def execute():
	"""What a service is called on the customer's invoice, when its catalogue name is too technical."""
	create_custom_field(
		"Item",
		{
			"fieldname": FIELD,
			"label": "Invoice Label",
			"fieldtype": "Data",
			"insert_after": "item_name",
		},
	)

	frappe.db.commit()
