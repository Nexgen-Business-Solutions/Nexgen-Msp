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


DISPUTE_TYPE = "Billing Dispute"


class ServiceRequest(Document):
	def validate(self):
		self.validate_has_lines()
		self.validate_lines()
		self.sync_request_type()
		self.sync_status_with_lines()

	def sync_request_type(self):
		if self.request_type == DISPUTE_TYPE:
			return

		actions = {row.action for row in self.lines if row.action}

		if not actions:
			return

		self.request_type = actions.pop() if len(actions) == 1 else "Mixed"

	def validate_has_lines(self):
		# a dispute is about an invoice, not about services to grant or remove
		if self.request_type == DISPUTE_TYPE:
			if not self.billing_run:
				frappe.throw(_("A billing dispute must point at the run it disputes."))
			return

		if not self.lines:
			frappe.throw(_("A service request must contain at least one line."))

	def validate_lines(self):
		seen = set()

		for row in self.lines:
			self.validate_line_scope(row)
			self.validate_line_ownership(row)

			if row.requested_quantity is not None and row.requested_quantity <= 0:
				frappe.throw(_("Row {0}: quantity must be greater than zero.").format(row.idx))

			target = row.get("new_user_full_name") if row.get("is_new_user") else row.get(
				SCOPE_FIELD.get(row.target_scope) or ""
			)
			key = (row.target_scope, target, row.requested_service)
			if key in seen:
				frappe.throw(
					_("Row {0}: the same service is already requested for this target.").format(row.idx)
				)
			seen.add(key)

	def validate_line_scope(self, row):
		if row.get("is_new_device"):
			if not row.get("new_device_label"):
				frappe.throw(_("Row {0}: describe the device to be registered.").format(row.idx))
			if row.get("managed_device"):
				frappe.throw(
					_("Row {0}: cannot select an existing device for a new device line.").format(row.idx)
				)
			return

		if row.get("is_new_user"):
			if not row.get("new_user_full_name"):
				frappe.throw(_("Row {0}: full name is required for a new user.").format(row.idx))
			if row.get("client_user"):
				frappe.throw(_("Row {0}: cannot select an existing user for a new user line.").format(row.idx))
			if row.get("needs_portal_access") and not row.get("new_user_email"):
				frappe.throw(_("Row {0}: an email is required to grant portal access.").format(row.idx))
			return

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
		if row.get("is_new_user"):
			return

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
		if self.request_type == DISPUTE_TYPE:
			return

		if self.status not in ("Approved", "Rejected"):
			return

		statuses = {row.line_status for row in self.lines}

		if self.status == "Approved" and "Pending" in statuses:
			frappe.throw(_("Every line must be approved or rejected before approving the request."))

		if self.status == "Approved" and statuses == {"Rejected"}:
			frappe.throw(_("All lines are rejected. Reject the request instead of approving it."))
