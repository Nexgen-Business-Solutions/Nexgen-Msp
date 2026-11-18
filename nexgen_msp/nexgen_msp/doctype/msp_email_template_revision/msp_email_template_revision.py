import frappe
from frappe import _
from frappe.model.document import Document


class MSPEmailTemplateRevision(Document):
	"""One published wording, kept exactly as it went out.

	A revision is what a mail was built from, so it has to stay readable long after
	somebody has published three more over it: restoring old content creates a new
	revision rather than reopening this one. The refusals below hold for a System Manager
	coming through the API as well, because an archive that can be rewritten proves
	nothing about what a customer actually received.
	"""

	def autoname(self):
		self.name = f"{self.template_name}::{self.locale}::{self.revision_number}"

	def on_update(self):
		# Frappe runs this after an insert as well as after an update. What tells the two
		# apart is whether there was a version before this one
		if self.get_doc_before_save() is not None:
			frappe.throw(_("A published revision records what was sent and cannot be changed."))

	def on_trash(self):
		frappe.throw(_("A published revision cannot be deleted."))
