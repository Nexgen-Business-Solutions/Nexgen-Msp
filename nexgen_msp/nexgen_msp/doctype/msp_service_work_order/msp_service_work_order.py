# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime

SCOPE_FIELD = {
	"User": "client_user",
	"Device": "managed_device",
	"Site": "customer_site",
}


class MSPServiceWorkOrder(Document):
	def validate(self):
		self.validate_target_scope()
		self.validate_target_ownership()
		self.validate_request_customer()
		self.validate_completion()

	def validate_target_scope(self):
		required = SCOPE_FIELD.get(self.target_scope)

		for fieldname in SCOPE_FIELD.values():
			if fieldname != required and self.get(fieldname):
				frappe.throw(
					_("{0} must be empty for a {1} scope work order.").format(
						_(self.meta.get_label(fieldname)), self.target_scope
					)
				)

		if required and not self.get(required):
			frappe.throw(
				_("{0} is required for a {1} scope work order.").format(
					_(self.meta.get_label(required)), self.target_scope
				)
			)

	def validate_target_ownership(self):
		fieldname = SCOPE_FIELD.get(self.target_scope)
		if not fieldname or not self.get(fieldname):
			return

		doctype = self.meta.get_field(fieldname).options
		owner_customer = frappe.db.get_value(doctype, self.get(fieldname), "customer")

		if owner_customer != self.customer:
			frappe.throw(
				_("{0} {1} belongs to customer {2}, not {3}.").format(
					doctype, frappe.bold(self.get(fieldname)), frappe.bold(owner_customer), frappe.bold(self.customer)
				)
			)

	def validate_request_customer(self):
		if not self.service_request:
			return

		request_customer = frappe.db.get_value("MSP Service Request", self.service_request, "customer")
		if request_customer != self.customer:
			frappe.throw(
				_("Service Request {0} belongs to customer {1}, not {2}.").format(
					frappe.bold(self.service_request), frappe.bold(request_customer), frappe.bold(self.customer)
				)
			)

	def validate_completion(self):
		if self.status != "Completed":
			return

		if not self.effective_date:
			frappe.throw(_("Effective Date is required to complete a work order."))

		pending = [row.step for row in self.checklist if not row.is_done]
		if pending:
			frappe.throw(
				_("The following checklist steps are not done: {0}").format(frappe.bold(", ".join(pending)))
			)

		if not self.completed_by:
			self.completed_by = frappe.session.user

		if not self.completed_at:
			self.completed_at = now_datetime()
