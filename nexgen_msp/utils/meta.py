import frappe


def select_options(doctype, fieldname):
	"""The choices a Select field actually offers, read from the doctype.

	Copying them into Python is how a filter bar ends up proposing a status the doctype no
	longer has — or missing one it gained.
	"""
	field = frappe.get_meta(doctype).get_field(fieldname)

	if not field:
		return []

	return [option for option in (field.options or "").split("\n") if option]
