# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class MSPServiceDefinition(Document):
	"""What Nexgen MSP knows about an ERPNext Item it sells as a service.

	The Item stays ERPNext's: it is the accounting and product master, used by the rest of the
	site and by whatever came before this application. Everything MSP decides about it — whether
	it may still be sold, at which scope, and under which name it is invoiced — lives here, one
	record per Item.
	"""

	def validate(self):
		self.validate_one_per_item()
		self.validate_scope_when_offered()
		self.normalize_label()

	def validate_one_per_item(self):
		twin = frappe.db.get_value(
			"MSP Service Definition",
			{"item": self.item, "name": ("!=", self.name or "")},
			"name",
		)

		if twin:
			frappe.throw(
				_("{0} is already configured for MSP as {1}.").format(
					frappe.bold(self.item), frappe.bold(twin)
				)
			)

	def validate_scope_when_offered(self):
		"""A service on offer says what it is sold against; a historical one may not know.

		A definition kept only so old assignments read correctly is allowed to have no scope,
		which is exactly what makes it historical rather than available.
		"""
		if self.enabled and not self.service_scope:
			frappe.throw(_("Choose User, Device or Both before making this service available in MSP."))

	def normalize_label(self):
		self.invoice_label = " ".join((self.invoice_label or "").split()) or None
