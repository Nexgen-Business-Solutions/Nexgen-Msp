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

SERVICE_ACTION = "Service Action"
USER_SETUP = "User Setup"
DEVICE_PROVISIONING = "Device Provisioning"
DEVICE_OPERATION = "Device Operation"
CONTEXT_ACTION = "Context Action"

# what each kind of work is allowed to be an act of
WORK_ACTIONS = {
	SERVICE_ACTION: ("Add", "Change", "Suspend", "Resume", "Remove"),
	USER_SETUP: ("Create User",),
	DEVICE_PROVISIONING: ("Assign Device", "Register Device", "Transfer Device"),
	DEVICE_OPERATION: ("Assign Device", "Transfer Device"),
	CONTEXT_ACTION: (),
}

# work that has been picked up: by then it must know what it is acting on
STARTED_STATUSES = ("In Progress", "Awaiting Verification", "Completed")


class MSPWorkOrder(Document):
	def validate(self):
		self.validate_work_type()
		self.validate_target_scope()
		self.validate_target_ownership()
		self.validate_requested_targets()
		self.validate_request_customer()
		self.validate_completion()

	def validate_work_type(self):
		"""Preparing a person or a machine is work, but it is not a service being sold.

		Only a Service Action names a service item and acts on it. The preparation kinds
		name the group of lines they stand for instead, which is what lets one account be
		created for somebody a request asked three things for, and an act on a machine
		itself names the machine and the operation it carries out.
		"""
		if not self.work_type:
			self.work_type = SERVICE_ACTION

		if self.work_type == DEVICE_OPERATION:
			# the operation is what this work is; the old verb is kept only where one exists
			from nexgen_msp.utils import operations

			self.action = operations.work_action(self.operation_code)

		allowed = WORK_ACTIONS[self.work_type]

		if self.action and self.action not in allowed:
			frappe.throw(
				_("{0} is not something a {1} work order can do.").format(
					frappe.bold(self.action), self.work_type
				)
			)

		if self.work_type == SERVICE_ACTION:
			if not self.service_item:
				frappe.throw(_("A service action work order must name the service it acts on."))
			if not self.action:
				frappe.throw(_("A service action work order must say which act it carries out."))
			return

		if self.service_item:
			frappe.throw(
				_("A {0} work order prepares a person or a machine, not a service.").format(
					self.work_type
				)
			)

		if self.work_type == USER_SETUP and not self.subject_key:
			frappe.throw(_("A user setup work order must say which person it creates."))

		if self.work_type == DEVICE_PROVISIONING and not self.device_requirement_key:
			frappe.throw(_("A device provisioning work order must say which machine it settles."))

		if self.work_type == DEVICE_OPERATION:
			if not self.operation_code:
				frappe.throw(_("A device operation work order must say which operation it carries out."))
			if not (self.managed_device or self.requested_device):
				frappe.throw(_("A device operation work order must name the machine it acts on."))

		if self.work_type == CONTEXT_ACTION and not self.activity_label:
			frappe.throw(_("A context action must say what was changed."))

	def validate_target_scope(self):
		# Context actions only document something already performed from the request
		# header.  ``subject_key`` keeps the recap grouped with the right person; it
		# is not a service target and therefore does not need a duplicated link field.
		if self.work_type == CONTEXT_ACTION:
			return

		required = SCOPE_FIELD.get(self.target_scope)

		for fieldname in SCOPE_FIELD.values():
			if fieldname != required and self.get(fieldname):
				frappe.throw(
					_("{0} must be empty for a {1} scope work order.").format(
						_(self.meta.get_label(fieldname)), self.target_scope
					)
				)

		# work is planned before its target exists: the person is still to be created, the
		# machine still to be found, and the service that lands on them waits for both. The
		# target is owed by the time the work is picked up, not by the time it is written down
		if self.status not in STARTED_STATUSES:
			return

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

	def validate_requested_targets(self):
		"""A Requested reference stays in its request, and a real target beside it is its resolution."""
		from nexgen_msp.utils import request_targets

		previous = None if self.is_new() else self.get_doc_before_save()

		if previous and request_targets.watched(previous) == request_targets.watched(self):
			return

		for field, doctype in request_targets.REQUESTED_LINKS.items():
			if self.meta.has_field(field) and self.get(field):
				request_targets.check_requested_link(doctype, self.get(field), self.request, self.customer)

		for existing, requested in request_targets.PAIRS:
			if not (self.get(existing) and self.get(requested)):
				continue

			doctype = request_targets.REQUESTED_LINKS[requested]
			row = frappe.db.get_value(
				doctype, self.get(requested), ["status", request_targets.RESOLVED_FIELD[doctype]], as_dict=True
			)

			if row.status != "Resolved" or row.get(request_targets.RESOLVED_FIELD[doctype]) != self.get(existing):
				frappe.throw(_(request_targets.BOTH_TARGETS))

	def validate_request_customer(self):
		if not self.request:
			return

		request_customer = frappe.db.get_value("MSP Request", self.request, "customer")
		if request_customer != self.customer:
			frappe.throw(
				_("Request {0} belongs to customer {1}, not {2}.").format(
					frappe.bold(self.request), frappe.bold(request_customer), frappe.bold(self.customer)
				)
			)

	def validate_completion(self):
		if self.status != "Completed":
			return

		if self.work_type == SERVICE_ACTION and not self.effective_date:
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
