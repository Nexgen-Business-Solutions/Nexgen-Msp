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
		if not self.is_new():
			frappe.throw(_("An audit entry records what happened and cannot be changed."))

	def on_trash(self):
		frappe.throw(_("An audit entry cannot be deleted."))
