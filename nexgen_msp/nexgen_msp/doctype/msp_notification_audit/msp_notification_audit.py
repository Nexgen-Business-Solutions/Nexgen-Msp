import frappe
from frappe import _
from frappe.model.document import Document


class MSPNotificationAudit(Document):
	"""What happened, written once and never touched again.

	An audit trail that can be edited is a story, not a record. Application code inserts
	rows here and nothing else: the refusals below hold even for a System Manager coming
	through the API, because the value of this table is precisely that nobody can tidy it.
	"""

	def on_update(self):
		# Frappe runs this after an insert as well as after an update, and by then the row
		# is no longer new. What tells the two apart is whether there was a version before
		# this one: on an insert there was not
		if self.get_doc_before_save() is not None:
			frappe.throw(_("An audit entry records what happened and cannot be changed."))

	def on_trash(self):
		frappe.throw(_("An audit entry cannot be deleted."))
