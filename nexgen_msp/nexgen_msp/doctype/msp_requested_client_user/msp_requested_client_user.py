# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.model.document import Document

from nexgen_msp.nexgen_msp.doctype.msp_request.msp_request import requester_edit_open
from nexgen_msp.utils import request_targets
from nexgen_msp.utils.errors import ValidationError

SOURCE_PREFIX = "requested-user"


def source_key_for(request, subject_key):
	"""The deterministic idempotency key of a Requested Client User."""
	return f"{SOURCE_PREFIX}:{request}:{subject_key}"


class RequestedEntity(Document):
	"""What a Requested Client User and a Requested Device share."""

	RESOLVED_FIELD = None
	RESOLVED_DOCTYPE = None

	def build_source_key(self):
		raise NotImplementedError

	def validate(self):
		self.validate_request_customer()
		self.set_source_key()
		self.validate_resolution()
		self.validate_snapshot()
		self.validate_department()

	def validate_request_customer(self):
		customer = frappe.db.get_value("MSP Request", self.request, "customer")

		if customer != self.customer:
			frappe.throw(_(request_targets.CROSS_CUSTOMER))

	def set_source_key(self):
		self.source_key = self.build_source_key()

		duplicate = frappe.db.get_value(
			self.doctype, {"source_key": self.source_key, "name": ("!=", self.name)}, "name"
		)

		if duplicate:
			frappe.throw(
				_("{0} already stands for this request target.").format(frappe.bold(duplicate)),
				frappe.DuplicateEntryError,
			)

	def validate_resolution(self):
		resolved = self.get(self.RESOLVED_FIELD)

		if resolved:
			owner = frappe.db.get_value(self.RESOLVED_DOCTYPE, resolved, "customer")

			if owner != self.customer:
				frappe.throw(_(request_targets.CROSS_CUSTOMER))

		if self.status == "Resolved" and not resolved:
			frappe.throw(_("A resolved requested target must name the record it resolved to."))

		previous = None if self.is_new() else self.get_doc_before_save()

		if not previous or not previous.get(self.RESOLVED_FIELD):
			return

		if resolved != previous.get(self.RESOLVED_FIELD):
			frappe.throw(_(request_targets.CONFLICTING_RESOLUTION))

		if self.status != "Resolved":
			frappe.throw(_("A resolved requested target cannot leave the Resolved status."))

	def validate_snapshot(self):
		try:
			snapshot = json.loads(self.requested_snapshot_json or "")
		except (TypeError, ValueError):
			snapshot = None

		if not isinstance(snapshot, dict):
			frappe.throw(_("The requested snapshot must be a JSON object."))

		if self.is_new():
			return

		previous = self.get_doc_before_save()

		if not previous:
			return

		try:
			before = json.loads(previous.requested_snapshot_json or "")
		except (TypeError, ValueError):
			before = None

		if before == snapshot:
			return

		status = frappe.db.get_value("MSP Request", self.request, "status")

		if status != "Draft" and not requester_edit_open(self.request):
			frappe.throw(_("What the requester asked for cannot change once the request has been submitted."))

	def validate_department(self):
		if not self.meta.has_field("department") or not self.department:
			return

		from nexgen_msp.api.internal.services.department_service import DepartmentService

		previous = None if self.is_new() else self.get_doc_before_save()

		if previous and DepartmentService._normalized(previous.department) == DepartmentService._normalized(
			self.department
		):
			return

		try:
			self.department = DepartmentService.validate_department(
				self.department, allow_disabled=bool(self.flags.department_already_agreed)
			)
		except ValidationError as error:
			frappe.throw(error.message)


class MSPRequestedClientUser(RequestedEntity):
	RESOLVED_FIELD = "resolved_client_user"
	RESOLVED_DOCTYPE = "MSP Client User"

	def build_source_key(self):
		return source_key_for(self.request, self.subject_key)
