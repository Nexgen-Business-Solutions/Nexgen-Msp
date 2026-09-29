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

EDITABLE_STATUSES = ("Awaiting Customer Approval", "Submitted")

MODIFIED_COMMENT = "Modified by the requester"


def requester_edit_refusal(name, for_update=False):
	"""Why the session user may not modify this sent request now: None, "not_requester" or "locked"."""
	row = frappe.db.get_value(
		"MSP Request", name, ["requester", "status", "request_type"], as_dict=True, for_update=for_update
	)

	if not row or row.requester != frappe.session.user:
		return "not_requester"

	if row.status not in EDITABLE_STATUSES or row.request_type == DISPUTE_TYPE:
		return "locked"

	lock = " for update" if for_update else ""
	decided = frappe.db.sql(
		"select name from `tabMSP Request Line` where parent = %s and parenttype = 'MSP Request'"
		" and line_status != 'Pending' limit 1" + lock,
		name,
	)
	ordered = frappe.db.sql("select name from `tabMSP Work Order` where request = %s limit 1" + lock, name)

	return "locked" if decided or ordered else None


def requested_date_refusal(requested_date, creation=None):
	"""Why a requested date cannot be asked: before the day the request was created. None when it can."""
	if not requested_date:
		return None

	floor = frappe.utils.getdate(creation or frappe.utils.now_datetime())

	if frappe.utils.getdate(requested_date) >= floor:
		return None

	return f"The requested date cannot be before the request was created ({frappe.utils.formatdate(floor)})."


def requester_edit_open(name):
	"""Whether the write under way is the requester's own modification of this request, still allowed."""
	return bool(name) and frappe.flags.requester_edit == name and not requester_edit_refusal(name)


class MSPRequest(Document):
	def validate(self):
		from nexgen_msp.utils import request_intents

		self.validate_has_lines()
		self.validate_requested_targets()
		self.validate_requested_date()

		# a draft is still being written: it is checked when it is sent, not while it is put
		# aside half finished
		if self.status != "Draft":
			self.validate_lines()

		# who and which machine each line is about, grouped: the execution plan is built on
		# these and they must be right whatever door the request came in through
		request_intents.stamp_keys(self)

		self.sync_request_type()
		self.sync_status_with_lines()

	def validate_requested_date(self):
		if not self.has_value_changed("requested_date"):
			return

		refusal = requested_date_refusal(self.requested_date, self.creation)

		if refusal:
			frappe.throw(refusal)

	def validate_requested_targets(self):
		"""Refuse a row written now that names both members of a target pair, or a foreign Requested entity."""
		from nexgen_msp.utils import request_targets

		previous = None if self.is_new() else self.get_doc_before_save()

		for table in ("subjects", "lines"):
			request_targets.validate_request_rows(
				self.get(table),
				previous.get(table) if previous else None,
				self.name,
				self.customer,
			)

	def sync_request_type(self):
		from nexgen_msp.utils import operations

		if self.request_type == DISPUTE_TYPE:
			return

		self.request_type = operations.request_type_of(self.lines, self.request_type) or self.request_type

	def validate_has_lines(self):
		# a dispute is about an invoice, not about services to grant or remove
		if self.request_type == DISPUTE_TYPE:
			if not self.billing_run:
				frappe.throw(_("A billing dispute must point at the run it disputes."))
			return

		if not self.lines:
			frappe.throw(_("A request must contain at least one line."))

	def validate_lines(self):
		from nexgen_msp.utils import request_intents

		# an intention is checked against the world when it is written, not every time the
		# document is touched afterwards. A machine can change hands between the day a
		# request is raised and the day it is worked: that is the technician's transfer to
		# make, and it must not turn the request itself into something nobody can save.
		fresh = self.intentions_were_rewritten()
		seen = set()

		for row in self.lines:
			self.validate_line_scope(row, fresh)
			self.validate_line_ownership(row)

			# an intention is only worth sending if the service could actually receive it
			if fresh:
				request_intents.validate_subject(self, row)
				request_intents.validate_action_against_state(self, row)
				request_intents.validate_no_open_conflict(self, row)

			if row.requested_quantity is not None and row.requested_quantity <= 0:
				frappe.throw(_("Row {0}: quantity must be greater than zero.").format(row.idx))

			key = request_intents.target_key(row)

			if row.target_scope not in ("User", "Device"):
				key = key + (row.target_scope, row.get(SCOPE_FIELD.get(row.target_scope) or ""))

			if fresh and key in seen:
				frappe.throw(
					_("Row {0}: the same service is already requested for this target.").format(row.idx)
				)
			seen.add(key)

		if fresh:
			request_intents.validate_one_destination(self.lines)
			request_intents.validate_one_intent_per_service(self)
			self.validate_subject_pairs()

	def validate_subject_pairs(self):
		"""Refuse a subject that names both, or neither, an existing and a requested person."""
		from nexgen_msp.utils import request_targets

		for row in self.get("subjects") or []:
			named = [field for field in ("client_user", "requested_client_user") if row.get(field)]

			if len(named) == 2:
				frappe.throw(_("Subject {0}: {1}").format(row.idx, _(request_targets.BOTH_TARGETS)))

			if not named:
				frappe.throw(_("Subject {0}: {1}").format(row.idx, _(request_targets.TARGET_REQUIRED)))

	INTENTION = (
		"target_scope",
		"action",
		"client_user",
		"requested_for_user",
		"managed_device",
		"requested_service",
		"source_service_assignment",
		"requested_client_user",
		"requested_for_requested_client_user",
		"requested_device",
		"requested_holder",
		"requested_holder_requested_client_user",
		"subject_key",
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
		if self.is_new() or requester_edit_open(self.name):
			return True

		previous = self.get_doc_before_save()

		if not previous:
			return True

		if previous.status in self.UNSENT_STATUSES and self.status != previous.status:
			return True

		def asked(doc):
			return [tuple(row.get(field) for field in self.INTENTION) for row in doc.lines]

		return asked(self) != asked(previous)

	def validate_line_scope(self, row, fresh=True):
		from nexgen_msp.utils import request_intents

		# an act on a service names the service; an act on the machine itself names none
		if not request_intents.is_device_operation(row) and not row.get("requested_service"):
			frappe.throw(_("Row {0}: say which service this line is about.").format(row.idx))

		required = SCOPE_FIELD.get(row.target_scope)

		for fieldname in SCOPE_FIELD.values():
			if fieldname != required and row.get(fieldname):
				frappe.throw(
					_("Row {0}: {1} must be empty for a {2} scope line.").format(
						row.idx, _(fieldname.replace("_", " ").title()), row.target_scope
					)
				)

		if not fresh:
			return

		self.validate_requested_pairs(row)

		if required == "customer_site" and not row.get(required):
			frappe.throw(
				_("Row {0}: {1} is required for a {2} scope line.").format(
					row.idx, _(required.replace("_", " ").title()), row.target_scope
				)
			)

	def validate_requested_pairs(self, row):
		"""Refuse a line that names both, or neither, of a target pair its operation needs."""
		from nexgen_msp.utils import request_targets

		pairs = []

		if row.target_scope == "User":
			pairs.append(("client_user", "requested_client_user"))

		if row.target_scope == "Device":
			pairs.append(("managed_device", "requested_device"))

		if (row.get("operation_code") or "") in ("device.assign", "device.transfer"):
			pairs.append(("requested_holder", "requested_holder_requested_client_user"))

		if row.get("requested_for_user") and row.get("requested_for_requested_client_user"):
			frappe.throw(_("Row {0}: {1}").format(row.idx, _(request_targets.BOTH_TARGETS)))

		for existing, requested in pairs:
			named = [field for field in (existing, requested) if row.get(field)]

			if len(named) == 2:
				frappe.throw(_("Row {0}: {1}").format(row.idx, _(request_targets.BOTH_TARGETS)))

			if not named and existing == "requested_holder":
				frappe.throw(_("Row {0}: say who should hold this Device.").format(row.idx))

			if not named:
				frappe.throw(
					_("Row {0}: {1} is required for a {2} scope line.").format(
						row.idx, _(existing.replace("_", " ").title()), row.target_scope
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
		if self.request_type == DISPUTE_TYPE:
			return

		if self.status not in ("Approved", "Rejected"):
			return

		statuses = {row.line_status for row in self.lines}

		if self.status == "Approved" and "Pending" in statuses:
			frappe.throw(_("Every line must be approved or rejected before approving the request."))

		if self.status == "Approved" and statuses == {"Rejected"}:
			frappe.throw(_("All lines are rejected. Reject the request instead of approving it."))
