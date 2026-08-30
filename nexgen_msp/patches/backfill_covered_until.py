import frappe


def execute():
	"""Work out how far each person and machine is billed to, from the runs themselves."""
	from nexgen_msp.api.internal.services.billing_service import BillingService

	for customer in frappe.db.sql_list(
		"select distinct customer from `tabMSP Billing Run` where status = 'Invoiced'"
	):
		BillingService._recompute_last_billed(customer)

	frappe.db.commit()
