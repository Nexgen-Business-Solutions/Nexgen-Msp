import frappe

MONTH = "Month"


def execute():
	"""Billing quantities are months, and a month can be a half — the UOM must allow it."""
	if not frappe.db.exists("UOM", MONTH):
		frappe.get_doc(
			{"doctype": "UOM", "uom_name": MONTH, "must_be_whole_number": 0, "enabled": 1}
		).insert(ignore_permissions=True)
	elif frappe.db.get_value("UOM", MONTH, "must_be_whole_number"):
		frappe.db.set_value("UOM", MONTH, "must_be_whole_number", 0)

	for item in frappe.get_all("Item", filters={"is_stock_item": 0}, pluck="name"):
		doc = frappe.get_doc("Item", item)
		dirty = False

		if doc.stock_uom != MONTH:
			doc.stock_uom = MONTH
			dirty = True

		if doc.sales_uom != MONTH:
			doc.sales_uom = MONTH
			dirty = True

		if not any(row.uom == MONTH for row in doc.uoms):
			doc.append("uoms", {"uom": MONTH, "conversion_factor": 1})
			dirty = True

		if dirty:
			doc.save(ignore_permissions=True)

	frappe.db.commit()
