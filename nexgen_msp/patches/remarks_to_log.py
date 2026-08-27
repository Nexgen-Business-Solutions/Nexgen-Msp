import frappe

PARENTS = ("Client User", "Managed Device")


def execute():
	"""Carry the single remark each record held into its remark log.

	The old field stays in place and read-only: it is the only copy of notes typed over
	months, and a migration that cannot be re-read is a migration nobody can check. It is
	dropped in a later release, once the log has been in use.
	"""
	for doctype in PARENTS:
		if not frappe.db.has_column(doctype, "remarks"):
			continue

		rows = frappe.db.sql(
			"""
			select name, remarks, owner, creation
			from `tab{doctype}`
			where ifnull(remarks, '') != ''
			""".format(doctype=doctype),
			as_dict=True,
		)

		moved = 0

		for row in rows:
			# a record already carrying a log has been through this, or has been written
			# to since: never stack a second copy of the same note on it
			if frappe.db.exists(
				"MSP Remark", {"parent": row.name, "parenttype": doctype}
			):
				continue

			doc = frappe.get_doc(doctype, row.name)
			doc.append(
				"remark_log",
				{"note": row.remarks, "noted_on": row.creation, "noted_by": row.owner},
			)
			doc.save(ignore_permissions=True)
			moved += 1

		frappe.db.commit()
		print(f"  {doctype}: {moved} remark(s) carried over")
