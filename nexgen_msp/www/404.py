import frappe

from nexgen_msp.utils import permissions

# the answer depends on who is asking, so it must never be served from a cache
no_cache = 1

HOME = "/"
LOGIN = "/msp/login"


def get_context(context):
	"""What an unknown address answers, according to who asked for it.

	Frappe reaches this only after every other renderer has declined the route, so a real
	page — the app, a doctype view, the API, an asset — never lands here and nothing about
	the existing routing changes.

	A visitor who is not signed in is sent to the login rather than told the address does
	not exist: confirming that would describe the site to someone who has not identified
	themselves. A customer is sent home, where everything they may open is one click away.
	Nexgen staff get the page itself, because for them a wrong address is worth seeing.
	"""
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = LOGIN
		raise frappe.Redirect

	if not permissions.is_internal():
		frappe.local.flags.redirect_location = HOME
		raise frappe.Redirect

	context.http_status_code = 404
	context.no_cache = 1
	context.title = "Page not found"
