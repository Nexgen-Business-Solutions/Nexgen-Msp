import frappe

# the order a customer meets them in: give first, then the ways to change what they have
ORDER = {"Add": 10, "Change": 20, "Suspend": 30, "Resume": 40, "Remove": 50}


def execute():
	"""Settle the order the offers are read in, instead of leaving it to the alphabet."""
	for name, action_type, sort_order in frappe.get_all(
		"MSP Request Action", fields=["name", "action_type", "sort_order"], as_list=True
	):
		if sort_order:
			continue

		frappe.db.set_value(
			"MSP Request Action", name, "sort_order", ORDER.get(action_type, 90),
			update_modified=False,
		)

	frappe.db.commit()
