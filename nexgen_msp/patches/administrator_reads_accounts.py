import frappe
from frappe.permissions import add_permission, update_permission_property

ROLE = "MSP System Admin"


def execute():
	"""Let the administrator who posts invoices read the ledger accounts behind them.

	Drawn from an order, an invoice inherits its party account and nothing is resolved. A
	credit note that stands against no order has nothing to inherit, so ERPNext resolves
	the account itself and asks whether the signed-in role may read the chart of accounts.
	The role held nothing on Account, so crediting failed for everybody but Administrator
	— and silently passed every test, which all run as Administrator.

	Read only: posting money is already guarded by `manage_contracts`, and nothing here
	lets this role write an account.
	"""
	if not frappe.db.exists("Role", ROLE):
		return

	add_permission("Account", ROLE, 0)
	update_permission_property("Account", ROLE, 0, "read", 1)
	update_permission_property("Account", ROLE, 0, "select", 1)
	frappe.db.commit()
