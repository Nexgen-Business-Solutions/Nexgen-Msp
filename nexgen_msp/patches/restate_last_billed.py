import frappe


def execute():
	"""Restate the recorded billing dates net of credit notes."""
	from nexgen_msp.api.internal.services.billing_service import BillingService

	for customer in frappe.db.sql_list(
		"select distinct customer from `tabBilling Run` where status = 'Invoiced'"
	):
		BillingService._recompute_last_billed(customer)

	frappe.db.commit()
