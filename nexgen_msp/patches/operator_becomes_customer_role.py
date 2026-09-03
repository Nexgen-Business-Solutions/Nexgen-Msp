import frappe

OLD = "MSP Operator"
NEW = "MSP Customer Operator"


def execute():
	"""Move the operator role to the customer's side of the fence.

	It was written as a junior member of our own team; it is meant to be someone at the
	customer who runs everything there except the invoices. The name follows, and so does
	every account holding it and every permission written against it.

	An account that held it while also holding an internal role is left with the internal
	one only: the two families must never meet, and staff is the safer of the two to keep.
	"""
	if not frappe.db.exists("Role", OLD):
		return

	if frappe.db.exists("Role", NEW):
		print(f"  {NEW} already exists, {OLD} left alone")
		return

	frappe.rename_doc("Role", OLD, NEW, force=True)
	frappe.db.set_value("Role", NEW, "role_name", NEW, update_modified=False)
	frappe.db.commit()

	holders = frappe.get_all("Has Role", filters={"role": NEW, "parenttype": "User"}, pluck="parent")
	cleared = 0

	for user in holders:
		held = set(frappe.get_roles(user))

		if held.intersection({"MSP System Admin", "MSP Technician", "System Manager"}):
			doc = frappe.get_doc("User", user)
			doc.set("roles", [row for row in doc.roles if row.role != NEW])
			doc.save(ignore_permissions=True)
			cleared += 1

	frappe.db.commit()
	print(f"  operator role renamed to {NEW} ({len(holders)} holder(s), {cleared} conflict(s) cleared)")
