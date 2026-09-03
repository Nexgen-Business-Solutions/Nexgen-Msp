import frappe
from frappe.website.page_renderers.not_found_page import NotFoundPage


class CaseMismatchedRoute(NotFoundPage):
	"""Answer 404 where Frappe would raise instead.

	A path that names a doctype in the wrong case — /account against the Account doctype —
	gets past the list renderer's guard and reaches the module loader, which raises. The
	visitor is then shown a server error carrying the doctype's name, rather than being
	told the page does not exist.

	Claiming those paths here sends them through the ordinary 404, which is where the
	answer already depends on who asked.
	"""

	def can_render(self):
		path = (self.request_path or "").strip("/")

		if not path or "/" in path:
			return False

		real = frappe.db.exists("DocType", path)

		# an exact name is a route the built-in renderers handle correctly
		if not real or real == path:
			return False

		meta = frappe.get_meta(real)

		# these are answered before the loader is ever reached
		return not meta.has_web_view and not meta.custom
