import frappe

OLD = "MSP Customer Portal Manager"
NEW = "MSP Customer Manager"


def execute():
	"""Drop 'Portal' from the customer manager's role name.

	The word said where the person signs in, not what they are: the pair reads Customer
	Manager and Customer Operator. The rename carries the role, every account holding it and
	every permission written against it.
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
	print(f"  customer manager role renamed to {NEW} ({holders} account(s) carried over)")
