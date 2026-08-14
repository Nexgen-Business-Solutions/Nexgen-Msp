# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

SCOPE_FIELD = {
	"User": "client_user",
	"Device": "managed_device",
	"Site": "customer_site",
}

SCOPE_DOCTYPE = {
	"client_user": "Client User",
	"managed_device": "Managed Device",
	"customer_site": "Customer Site",
}


class ServiceRequest(Document):
	def validate(self):
		self.validate_has_lines()
		self.validate_lines()
		self.sync_status_with_lines()

	def validate_has_lines(self):
		if not self.lines:
			frappe.throw(_("A service request must contain at least one line."))

	def validate_lines(self):
		seen = set()

		for row in self.lines:
			self.validate_line_scope(row)
			self.validate_line_ownership(row)

			if row.requested_quantity is not None and row.requested_quantity <= 0:
				frappe.throw(_("Row {0}: quantity must be greater than zero.").format(row.idx))

			key = (row.target_scope, row.get(SCOPE_FIELD.get(row.target_scope) or ""), row.requested_service)
			if key in seen:
				frappe.throw(
					_("Row {0}: the same service is already requested for this target.").format(row.idx)
				)
			seen.add(key)

	def validate_line_scope(self, row):
		required = SCOPE_FIELD.get(row.target_scope)

		for fieldname in SCOPE_FIELD.values():
			if fieldname != required and row.get(fieldname):
				frappe.throw(
					_("Row {0}: {1} must be empty for a {2} scope line.").format(
						row.idx, _(fieldname.replace("_", " ").title()), row.target_scope
					)
				)

		if required and not row.get(required):
			frappe.throw(
				_("Row {0}: {1} is required for a {2} scope line.").format(
					row.idx, _(required.replace("_", " ").title()), row.target_scope
				)
			)

	def validate_line_ownership(self, row):
		fieldname = SCOPE_FIELD.get(row.target_scope)
		if not fieldname or not row.get(fieldname):
			return

		doctype = SCOPE_DOCTYPE[fieldname]
		owner_customer = frappe.db.get_value(doctype, row.get(fieldname), "customer")

		if owner_customer != self.customer:
			frappe.throw(
				_("Row {0}: {1} {2} belongs to customer {3}, not {4}.").format(
					row.idx,
					doctype,
					frappe.bold(row.get(fieldname)),
					frappe.bold(owner_customer),
					frappe.bold(self.customer),
				)
			)

	def sync_status_with_lines(self):
		if self.status not in ("Approved", "Rejected"):
			return

		statuses = {row.line_status for row in self.lines}

		if self.status == "Approved" and "Pending" in statuses:
			frappe.throw(_("Every line must be approved or rejected before approving the request."))

		if self.status == "Approved" and statuses == {"Rejected"}:
			frappe.throw(_("All lines are rejected. Reject the request instead of approving it."))
