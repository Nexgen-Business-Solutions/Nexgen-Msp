from frappe.model.document import Document


class MSPEmailTemplateLocale(Document):
	"""What an administrator is writing for one template in one language.

	The draft lives here and nowhere else, so saving it cannot change what is being sent:
	production reads the published revision this row points at, and a row whose
	`published_revision` is still nothing is a language nobody has configured yet.
	"""
