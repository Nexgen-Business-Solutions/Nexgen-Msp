import frappe


def execute():
	"""Carry the authority matrix from the person's file over to the account.

	Approving is something a login does, not a seat we service: the two were the same only
	while a Client User carried a portal account, and they no longer do.

	A line whose person had no account is dropped — there was nobody behind it to approve.
	"""
	if not frappe.db.has_column("MSP Approver", "client_user"):
		return

	rows = frappe.db.sql(
		"""
		select a.name, cu.portal_user
		from `tabMSP Approver` a
		left join `tabMSP Client User` cu on cu.name = a.client_user
		""",
		as_dict=True,
	)

	moved = dropped = 0

	for row in rows:
		if row.portal_user and frappe.db.exists("User", row.portal_user):
			frappe.db.set_value("MSP Approver", row.name, "user", row.portal_user, update_modified=False)
			moved += 1
		else:
			frappe.db.delete("MSP Approver", {"name": row.name})
			dropped += 1

	frappe.db.commit()

	if moved or dropped:
		print(f"  approvers: {moved} moved onto accounts, {dropped} with no account dropped")
