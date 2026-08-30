import frappe

# every doctype this app owns now carries the MSP prefix, so a table read straight from the
# database says which application it belongs to
RENAMES = {
	"Billing Run": "MSP Billing Run",
	"Billing Run Line": "MSP Billing Run Line",
	"Client User": "MSP Client User",
	"Customer Site": "MSP Customer Site",
	"Integration Event": "MSP Integration Event",
	"Managed Device": "MSP Managed Device",
	"Network Interface": "MSP Network Interface",
	"Service Assignment": "MSP Service Assignment",
	"Service Eligibility": "MSP Service Eligibility",
	"Service Request": "MSP Service Request",
	"Service Request Line": "MSP Service Request Line",
	"Service Work Order": "MSP Service Work Order",
	"Work Order Checklist Item": "MSP Work Order Checklist Item",
}


def execute():
	"""Rename the app's doctypes before the new definitions are synced.

	It has to run here, ahead of the model sync: the code ships the renamed folders, so a
	sync running first would create empty tables beside the data instead of finding it. The
	rename moves the table itself, the options of every field pointing at it, the parenttype
	of its child rows, the dynamic links, the versions and the attachments.

	Renaming inside a patch also tells Frappe to leave the files on disk alone, which is
	what we want — the deployment already put them at their new names.
	"""
	done = 0

	for old, new in RENAMES.items():
		if not frappe.db.exists("DocType", old):
			continue

		if frappe.db.exists("DocType", new):
			print(f"  {new} already exists, {old} left alone")
			continue

		frappe.rename_doc("DocType", old, new, force=True)
		# the dynamic link map caches table names, and it has just gone stale
		frappe.clear_cache()
		frappe.db.commit()
		done += 1

	print(f"  {done} doctype(s) renamed")
