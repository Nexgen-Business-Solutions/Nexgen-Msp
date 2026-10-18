import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

FIELD = "msp_billing_contact"


def execute():
	"""Who at the customer receives the invoice, named rather than inferred.

	Until now an invoice notice went to every account holding a permission on the customer,
	which is an answer to "who may sign in", not to "who does the accounting". The company
	names one contact; nobody else is written to.
	"""
	create_custom_field(
		"Customer",
		{
			"fieldname": FIELD,
			"label": "Billing Contact",
			"fieldtype": "Link",
			"options": "Contact",
			"insert_after": "msp_last_billed_on",
		},
	)
	frappe.db.commit()
