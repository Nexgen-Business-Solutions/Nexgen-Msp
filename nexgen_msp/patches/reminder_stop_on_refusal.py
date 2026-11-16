import frappe


def execute():
	"""Keep the reminders stopping on a refusal, now that the choice reaches the engine.

	The stop condition was stored and never read: the engine applied the refusal as well,
	whatever the rule said. Reading the stored value now would start reminding about
	requests the customer has already turned down, so the rules that were only ever seeded
	are moved to what they have always done.

	Only those. A rule whose stop condition somebody edited is their decision, and the
	audit is what says which: every edit through the settings screen writes one, so a rule
	with no such row carries a value nobody ever chose.
	"""
	frappe.db.sql(
		"""
		update `tabMSP Notification Rule` rule
		set rule.stop_condition_key = 'refused_by_customer'
		where rule.kind = 'Reminder'
		  and ifnull(rule.stop_condition_key, '') = 'left_trigger_status'
		  and not exists (
			select 1 from `tabMSP Notification Audit` audit
			where audit.rule = rule.name
			  and audit.action = 'Rule Edited'
			  and audit.detail like '%stop_condition_key%'
		  )
		"""
	)
	frappe.db.commit()
