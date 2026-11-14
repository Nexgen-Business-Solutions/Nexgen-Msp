import frappe
from frappe import _
from frappe.model.document import Document


class MSPNotificationRecipient(Document):
	"""One address an administrator added to a notification, validated before it is kept.

	Stored as rows rather than as a comma-separated string so that each address is checked
	on its own and the bad one can be named. A list nobody validated is a list that mails
	somebody's typo for years.
	"""

	def validate(self):
		self.email = (self.email or "").strip().lower()

		if not self.email:
			frappe.throw(_("Row {0}: an empty address cannot be written to.").format(self.idx))

		from frappe.utils import validate_email_address

		validate_email_address(self.email, throw=True)
