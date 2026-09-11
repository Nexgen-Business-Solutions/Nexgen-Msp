import frappe


def execute():
	"""Give every holder period the day it started, so the record can be saved again.

	A handful of machines came in before a period's start date was ever required, and
	`validate_holder_log` now refuses to save them until one exists. The day the device
	itself went into service is the best fact already on file for that; failing that, the
	day the record was created is what is left.
	"""
	rows = frappe.db.sql(
		"""
		select distinct h.parent as device
		from `tabMSP Device Holder` h
		where h.parenttype = 'MSP Managed Device' and ifnull(h.from_date, '') = ''
		""",
		as_dict=True,
	)

	dated = flagged = 0

	for row in rows:
		doc = frappe.get_doc("MSP Managed Device", row.device)
		fallback = doc.assigned_date or frappe.utils.getdate(doc.creation)

		for holder_row in doc.holder_log:
			if not holder_row.from_date:
				holder_row.from_date = fallback

		try:
			doc.save(ignore_permissions=True)
			dated += 1
		except Exception:
			frappe.db.rollback()
			flagged += 1
			frappe.log_error(
				title="Holder period could not be dated automatically",
				message=f"{row.device}: filling in {fallback} would contradict its own history; needs manual review.",
			)

	frappe.db.commit()
	print(f"  {dated} device(s) had a holder period given a start date; {flagged} flagged for manual review")
