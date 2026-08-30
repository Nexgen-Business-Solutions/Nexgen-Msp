import frappe


def execute():
	"""Close the spell of anyone still holding a machine that left service.

	Devices retired through the app close their spell on the way out; the ones that came in
	through the Excel import never did, so they read as held today by someone who gave them
	back long ago. The device keeps pointing at that last holder, which is what puts the
	machine on their page — only the spell closes.
	"""
	rows = frappe.db.sql(
		"""
		select h.name, h.parent, d.retired_date, d.modified
		from `tabMSP Device Holder` h
		join `tabMSP Managed Device` d on d.name = h.parent
		where h.parenttype = 'MSP Managed Device'
		  and ifnull(h.to_date, '') = ''
		  and d.status != 'Active'
		""",
		as_dict=True,
	)

	for row in rows:
		closed_on = row.retired_date or frappe.utils.getdate(row.modified)
		frappe.db.set_value(
			"MSP Device Holder",
			row.name,
			{"to_date": closed_on, "is_current": 0},
			update_modified=False,
		)

	frappe.db.commit()
	print(f"  {len(rows)} holder spell(s) closed on retired devices")
