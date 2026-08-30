import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

FIELD = "msp_last_billed_on"


def execute():
	"""Record on the customer and on each device when they were last billed.

	The figure was only ever derived at read time, so nothing outside a billing screen
	could see it. It is stamped when a run is posted, and backfilled here from the runs
	that were already posted.
	"""
	create_custom_field(
		"Customer",
		{
			"fieldname": FIELD,
			"label": "Last Billed On",
			"fieldtype": "Date",
			"read_only": 1,
			"insert_after": "customer_group",
		},
	)

	for customer, billed in frappe.db.sql(
		"""
		select br.customer, max(br.billing_period_end)
		from `tabMSP Billing Run` br
		where br.status = 'Invoiced' and (br.credit_note_of is null or br.credit_note_of = '')
		group by br.customer
		"""
	):
		frappe.db.set_value("Customer", customer, FIELD, billed, update_modified=False)

	for device, billed in frappe.db.sql(
		"""
		select brl.managed_device, max(br.billing_period_end)
		from `tabMSP Billing Run Line` brl
		join `tabMSP Billing Run` br on br.name = brl.parent
		where br.status = 'Invoiced' and brl.managed_device is not null
		  and (br.credit_note_of is null or br.credit_note_of = '')
		group by brl.managed_device
		"""
	):
		frappe.db.set_value("MSP Managed Device", device, "last_billed_on", billed, update_modified=False)

	frappe.db.commit()
