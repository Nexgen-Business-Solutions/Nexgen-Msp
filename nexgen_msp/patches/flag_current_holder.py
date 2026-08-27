import frappe


def execute():
	"""Mark the open spell of each machine as the current one.

	The device field is only an index onto the history now, so the flag is what tells the
	two apart when someone reads the table directly.
	"""
	frappe.db.sql(
		"""
		update `tabMSP Device Holder`
		set is_current = case when ifnull(to_date, '') = '' then 1 else 0 end
		where parenttype = 'Managed Device'
		"""
	)
	frappe.db.commit()
	print("  holder rows flagged")
