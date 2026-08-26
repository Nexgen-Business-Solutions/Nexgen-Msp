import frappe


def execute():
	"""Tick endpoint protection on the mapping row that already carried it by scope."""
	if not frappe.db.exists("DocType", "MSP Service Mapping"):
		return

	if frappe.db.exists("MSP Service Mapping", {"is_endpoint_protection": 1}):
		return

	for name in frappe.get_all(
		"MSP Service Mapping", filters={"scope": "Device"}, pluck="name"
	):
		frappe.db.set_value("MSP Service Mapping", name, "is_endpoint_protection", 1)

	frappe.db.commit()
