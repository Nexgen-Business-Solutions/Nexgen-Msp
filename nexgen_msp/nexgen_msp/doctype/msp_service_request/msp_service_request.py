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
	"client_user": "MSP Client User",
	"managed_device": "MSP Managed Device",
	"customer_site": "MSP Customer Site",
}


DISPUTE_TYPE = "Billing Dispute"


class MSPServiceRequest(Document):
	def validate(self):
		from nexgen_msp.utils import request_intents

		self.validate_has_lines()

		# a draft is still being written: it is checked when it is sent, not while it is put
		# aside half finished
		if self.status != "Draft":
			self.validate_lines()

		# who and which machine each line is about, grouped: the execution plan is built on
		# these and they must be right whatever door the request came in through
		request_intents.stamp_keys(self)

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
		from nexgen_msp.utils import request_intents

		# an intention is checked against the world when it is written, not every time the
		# document is touched afterwards. A machine can change hands between the day a
		# request is raised and the day it is worked: that is the technician's transfer to
		# make, and it must not turn the request itself into something nobody can save.
		fresh = self.intentions_were_rewritten()
		seen = set()

		for row in self.lines:
			self.validate_line_scope(row)
			self.validate_line_ownership(row)

			# an intention is only worth sending if the service could actually receive it
			if fresh:
				request_intents.validate_subject(self, row)
				request_intents.validate_action_against_state(self, row)
				request_intents.validate_no_open_conflict(self, row)

			if row.requested_quantity is not None and row.requested_quantity <= 0:
				frappe.throw(_("Row {0}: quantity must be greater than zero.").format(row.idx))

			target = row.get("new_user_full_name") if row.get("is_new_user") else row.get(
				SCOPE_FIELD.get(row.target_scope) or ""
			)
			key = (row.target_scope, target, row.requested_service, row.get("action"))
			if key in seen:
				frappe.throw(
					_("Row {0}: the same service is already requested for this target.").format(row.idx)
				)
			seen.add(key)

		if fresh:
			request_intents.validate_one_intent_per_service(self)

	INTENTION = (
		"target_scope",
		"action",
		"client_user",
		"requested_for_user",
		"managed_device",
		"requested_service",
		"source_service_assignment",
		"is_new_user",
		"new_user_full_name",
		"is_new_device",
		"requested_quantity",
	)

	# while a request is still the customer's own, it has reached nobody
	UNSENT_STATUSES = ("Draft", "Awaiting Customer Approval")

	def intentions_were_rewritten(self):
		"""Whether the ask is being written, rather than what became of it recorded.

		Two moments count: the lines themselves changing, and the request moving on while it
		is still the customer's own — sent from a draft, or agreed to after waiting. A draft
		saved on Monday and sent on Friday is read against the world of Friday, even though
		not a word of it changed.

		Ruling on a line, or moving the request along afterwards, is neither.
		"""
		if self.is_new():
			return True

		previous = self.get_doc_before_save()

		if not previous:
			return True

		if previous.status in self.UNSENT_STATUSES and self.status != previous.status:
			return True

		def asked(doc):
			return [tuple(row.get(field) for field in self.INTENTION) for row in doc.lines]

		return asked(self) != asked(previous)

	def validate_line_scope(self, row):
		if row.get("is_new_user"):
			from nexgen_msp.api.internal.services.department_service import DepartmentService

			row.new_user_department = DepartmentService.validate_department(
				row.get("new_user_department"), required=True
			)

		if row.get("is_new_device"):
			# what the machine is called and what is engraved on it are collected by whoever
			# carries the work out; the customer only says that it is a new one
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
