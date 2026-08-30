import frappe
from frappe.utils import flt


def execute():
	"""Runs frozen before the month model have no quantity to show — derive it from what was billed.

	The ratio is kept exact rather than rounded to a half month, so an old run still
	reconciles: months x rate is the amount that was actually invoiced.
	"""
	rows = frappe.db.sql(
		"""
		select name, quantity, unit_rate, amount
		from `tabMSP Billing Run Line`
		where (billable_months is null or billable_months = 0)
		  and amount != 0 and unit_rate > 0
		""",
		as_dict=True,
	)

	for row in rows:
		divisor = flt(row.unit_rate) * (flt(row.quantity) or 1)

		if not divisor:
			continue

		frappe.db.set_value(
			"MSP Billing Run Line", row.name, "billable_months", flt(row.amount / divisor, 2),
			update_modified=False,
		)

	frappe.db.commit()
