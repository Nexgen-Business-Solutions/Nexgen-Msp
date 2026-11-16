import frappe

RULE = "MSP Notification Rule"


def execute():
	"""Keep the reminders stopping on a refusal, now that the choice reaches the engine.

	The stop condition was stored and never read, so every seeded rule carries the floor
	while the engine applied the refusal as well. Reading the stored value now would start
	reminding about requests the customer already turned down.
	"""
	frappe.db.sql(
		"""
		update `tabMSP Notification Rule`
		set stop_condition_key = 'refused_by_customer'
		where kind = 'Reminder' and ifnull(stop_condition_key, '') = 'left_trigger_status'
		"""
	)
	frappe.db.commit()
