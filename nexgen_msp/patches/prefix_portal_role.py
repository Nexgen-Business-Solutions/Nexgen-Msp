import frappe

OLD = "Customer Portal Manager"
NEW = "MSP Customer Portal Manager"


def execute():
	"""Carry the portal role over to the MSP prefix the other roles already use.

	The rename takes the role's own record, every account holding it and every permission
	written against it, because the name is the key those rows point at. Nothing a user
	reads changes: the role is never shown, it is only tested.
	"""
	if not frappe.db.exists("Role", OLD):
		return

	if frappe.db.exists("Role", NEW):
		print(f"  {NEW} already exists, {OLD} left alone")
		return

	frappe.rename_doc("Role", OLD, NEW, force=True)
	frappe.db.set_value("Role", NEW, "role_name", NEW, update_modified=False)
	frappe.db.commit()

	holders = frappe.db.count("Has Role", {"role": NEW})
	print(f"  portal role renamed to {NEW} ({holders} account(s) carried over)")
