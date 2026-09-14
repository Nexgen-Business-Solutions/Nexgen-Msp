import frappe


def execute():
	"""A partial month is billed in five-day blocks out of thirty, whatever the month's length.

	Thirteen days are half a month in July as in February. Contracts set to divide by the
	real length of the month move to the thirty-day base. Runs already drawn keep the method
	and the quantities they were drawn with: nothing billed is recalculated.
	"""
	moving = frappe.db.sql_list(
		"""
		select name from `tabMSP Contract`
		where ifnull(proration_method, '') in ('', 'Daily Actual Days')
		"""
	)

	for name in moving:
		frappe.db.set_value(
			"MSP Contract", name, "proration_method", "30-Day Convention", update_modified=False
		)

	frappe.db.commit()

	print(f"Proration: {len(moving)} contract(s) moved to the 30-day base")
