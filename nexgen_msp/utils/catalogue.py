import frappe

# what a billing quantity is counted in; it must allow halves
BILLING_UOM = "Month"


def security_item():
	"""The article that stands for endpoint protection on this site.

	Which service guards a machine is a property of the mapping row, ticked by whoever
	configures the import — naming a vendor here would break the day the product changes.
	Failing that, the service attached to devices is taken: returning nothing would make
	every active machine read as unprotected in silence, which is the very fault that four
	stale copies of an item code already caused.
	"""
	if not frappe.db.exists("DocType", "MSP Service Mapping"):
		return None

	flagged = frappe.db.get_value(
		"MSP Service Mapping", {"is_endpoint_protection": 1}, "item_id"
	)

	return flagged or frappe.db.get_value(
		"MSP Service Mapping", {"scope": "Device"}, "item_id"
	)
