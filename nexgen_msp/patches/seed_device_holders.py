import frappe


def execute():
	"""Open a spell for whoever holds each machine today.

	The history starts here: what came before was never recorded, so the first row carries
	the assignment date the device already had rather than pretending to know more.
	"""
	rows = frappe.db.sql(
		"""
		select name, assigned_client_user, assigned_date
		from `tabMSP Managed Device`
		where ifnull(assigned_client_user, '') != ''
		""",
		as_dict=True,
	)

	seeded = 0

	for row in rows:
		if frappe.db.exists(
			"MSP Device Holder", {"parent": row.name, "parenttype": "MSP Managed Device"}
		):
			continue

		doc = frappe.get_doc("MSP Managed Device", row.name)
		doc.append(
			"holder_log",
			{
				"client_user": row.assigned_client_user,
				"full_name": frappe.db.get_value(
					"MSP Client User", row.assigned_client_user, "full_name"
				),
				"from_date": row.assigned_date,
			},
		)
		doc.save(ignore_permissions=True)
		seeded += 1

	frappe.db.commit()
	print(f"  {seeded} device holder spell(s) opened")
