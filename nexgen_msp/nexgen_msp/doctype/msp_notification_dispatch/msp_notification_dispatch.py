import frappe
from frappe import _
from frappe.model.document import Document


class MSPNotificationDispatch(Document):
	"""One logical delivery, identified by what makes it unique rather than by when it ran.

	The identity is the whole point: it is what lets a crashed worker find the delivery it
	already reserved instead of queueing a second copy of the same mail. So it is written
	once, and the row is never thrown away — a deleted dispatch is a mail that can be sent
	twice.
	"""

	def validate(self):
		if not self.dedup_key:
			frappe.throw(_("A dispatch without its identity cannot be deduplicated."))

		if self.recipient:
			self.recipient = self.recipient.strip().lower()

	def on_trash(self):
		frappe.throw(_("A dispatch is the record that stops a mail being sent twice."))
