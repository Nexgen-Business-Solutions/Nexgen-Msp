import frappe

from nexgen_msp.utils.catalogue import BILLING_UOM as MONTH


def execute():
	"""Ensure the MSP billing UOM exists. This seed must never modify Item records."""
	if not frappe.db.exists("UOM", MONTH):
		frappe.get_doc(
			{"doctype": "UOM", "uom_name": MONTH, "must_be_whole_number": 0, "enabled": 1}
		).insert(ignore_permissions=True)
	elif frappe.db.get_value("UOM", MONTH, "must_be_whole_number"):
		frappe.db.set_value("UOM", MONTH, "must_be_whole_number", 0)

	frappe.db.commit()
