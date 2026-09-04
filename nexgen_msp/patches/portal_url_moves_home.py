import frappe

DEFAULT_PORTAL_URL = "https://myaccount.nxgensolutions.com"
DEFAULT_CUSTOMER_SESSION_TIMEOUT = "8 hours"


def execute():
	"""The portal's own settings, filled in where nothing has been chosen yet.

	The address is carried over from the invoice settings, where it used to live; failing
	that, the address the site has always used. A customer session sits idle eight hours at
	most unless the administrator says otherwise.
	"""
	doc = frappe.get_single("MSP Portal Settings")
	changed = False

	if not doc.portal_url:
		# the field is gone from the invoice settings' meta, so its old value is read from
		# the singles table directly
		previous = frappe.db.sql(
			"select value from `tabSingles` where doctype = 'MSP Invoice Settings' and field = 'portal_url'"
		)
		doc.portal_url = (previous[0][0] if previous else None) or DEFAULT_PORTAL_URL
		changed = True

	if not doc.customer_session_timeout:
		doc.customer_session_timeout = DEFAULT_CUSTOMER_SESSION_TIMEOUT
		changed = True

	if changed:
		doc.save(ignore_permissions=True)
		frappe.db.commit()
