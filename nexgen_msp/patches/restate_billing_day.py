import frappe


def execute():
	"""Restate the day each person and machine was last billed on.

	The mark used to be written with the coverage the invoice bought rather than the day it
	was posted, so a quarter billed in October and covering November had a screen announce a
	billing on a day still to come.

	Only that one field is written, and only where a posted charge names a day to write. A
	person carried on no posted run has no such day, and this is not the place to decide what
	their file should say instead: rolling a mark back belongs to the cancellation that
	rolls it, not to a restating. `covered_until` is never touched here either, so nothing
	the billing engine reads can move.
	"""
	from nexgen_msp.api.internal.services.billing_service import BillingService

	charged = {}

	for customer in frappe.db.sql_list(
		"select distinct customer from `tabMSP Billing Run` where status = 'Invoiced'"
	):
		for row in BillingService.net_billed_periods(customer):
			if not row.charged_on:
				continue

			for who, name in (
				("MSP Client User", row.client_user),
				("MSP Managed Device", row.managed_device),
			):
				if not name:
					continue

				held = charged.get((who, name))

				if not held or row.charged_on > held:
					charged[(who, name)] = row.charged_on

	for (who, name), day in charged.items():
		frappe.db.set_value(who, name, "last_billed_on", day, update_modified=False)

	frappe.db.commit()
