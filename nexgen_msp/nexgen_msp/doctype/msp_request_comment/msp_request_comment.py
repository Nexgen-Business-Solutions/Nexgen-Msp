import frappe
from frappe import _
from frappe.model.document import Document


class MSPRequestComment(Document):
	"""One message of a request's conversation, written once and never touched again.

	Both sides read this thread and each answers what the other wrote. A message somebody
	could edit afterwards would make the record of the exchange worth less than the memory
	of it, so the refusals below hold for everybody, including through the API.
	"""

	def on_update(self):
		if self.get_doc_before_save() is not None:
			frappe.throw(_("A comment records what was said and cannot be changed."))

	def on_trash(self):
		frappe.throw(_("A comment cannot be deleted."))
