import frappe


def execute():
	"""A run counts as invoiced only once its invoice is posted, not when it is drafted.

	Runs marked invoiced while their Sales Invoice is still a draft were inflating the
	invoiced totals with money that had never been booked.
	"""
	stale = frappe.db.sql(
		"""
		select br.name
		from `tabBilling Run` br
		join `tabSales Invoice` si on si.name = br.sales_invoice
		where br.status = 'Invoiced' and si.docstatus = 0
		""",
		pluck=True,
	)

	for name in stale:
		frappe.db.set_value("Billing Run", name, "status", "Invoice Drafted", update_modified=False)

	frappe.db.commit()
