import frappe

from nexgen_msp.utils import permissions
from nexgen_msp.utils.approval import AUTHORITY


def execute():
	"""Take off every matrix the accounts that no longer answer for the company it belongs to.

	Removing the line when a rattachement changes stops new ones appearing; it says nothing
	about the ones written before that rule existed. Those keep a customer screen naming
	somebody whose own account answers for another company — and, worse, refuse every later
	save of that company's matrix, for everybody.

	Whole documents are rewritten at once: a matrix carrying two orphans cannot be saved by
	taking them off one at a time, since the first save still validates the second.
	"""
	by_customer = {}

	for row in frappe.db.sql(
		"select parent, user from `tabMSP Approver`", as_dict=True
	):
		by_customer.setdefault(row.parent, []).append(row.user)

	removed = 0

	for customer, users in sorted(by_customer.items()):
		if not frappe.db.exists(AUTHORITY, customer):
			continue

		stale = {
			user
			for user in set(users)
			if customer not in permissions.get_allowed_customers(user)
			or not set(frappe.get_roles(user)).intersection(permissions.CUSTOMER_ROLES)
		}

		if not stale:
			continue

		doc = frappe.get_doc(AUTHORITY, customer)
		doc.set("approvers", [row for row in doc.approvers if row.user not in stale])
		doc.save(ignore_permissions=True)
		doc.add_comment(
			"Comment",
			f"Removed {', '.join(sorted(stale))}: no longer answering for {customer}.",
		)
		removed += len(stale)
		print(f"  {customer}: removed {', '.join(sorted(stale))}")

	frappe.db.commit()
	print(f"Authority matrices: {removed} line(s) removed from {len(by_customer)} matrix(es)")
