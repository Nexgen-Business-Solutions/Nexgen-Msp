# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate

from nexgen_msp.utils.assignments import OPERATIONAL_TO_BILLING
from nexgen_msp.utils.service_suspensions import validate_suspension_log

SCOPE_FIELD = {
	"User": "client_user",
	"Device": "managed_device",
	"Site": "customer_site",
}

# the two scopes a catalogue entry can be restricted to, and what each forbids
ITEM_SCOPES = ("User", "Device")


class MSPServiceAssignment(Document):
	def validate(self):
		self.validate_scope_link()
		self.validate_item_scope_compatibility()
		self.validate_scope_ownership()
		self.validate_dates()
		validate_suspension_log(self)
		self.validate_quantity()
		self.validate_rate()
		self.validate_no_overlap()
		self.sync_billing_status()

	def validate_scope_link(self):
		required = SCOPE_FIELD.get(self.assignment_scope)

		for scope, fieldname in SCOPE_FIELD.items():
			if fieldname != required and self.get(fieldname):
				frappe.throw(
					_("{0} must be empty for a {1} scope assignment.").format(
						_(self.meta.get_label(fieldname)), self.assignment_scope
					)
				)

		if required and not self.get(required):
			frappe.throw(
				_("{0} is required for a {1} scope assignment.").format(
					_(self.meta.get_label(required)), self.assignment_scope
				)
			)

	def validate_item_scope_compatibility(self):
		"""A catalogue entry says where its service may be sold, and the doctype holds that line.

		The rule lives here rather than in the service layer so that a caller which builds the
		document itself, bypassing the whitelisted API, is refused just the same. An Item with no
		scope on file is a legacy one and stays unrestricted.
		"""
		if self.assignment_scope not in ITEM_SCOPES or not self.service_item:
			return

		item_scope = frappe.db.get_value("Item", self.service_item, "msp_service_scope")

		if item_scope not in ITEM_SCOPES or item_scope == self.assignment_scope:
			return

		frappe.throw(
			_("{0} is a {1} service and cannot be assigned at {2} scope.").format(
				frappe.bold(self.service_item), item_scope, self.assignment_scope
			)
		)

	def validate_scope_ownership(self):
		fieldname = SCOPE_FIELD.get(self.assignment_scope)
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

	def validate_dates(self):
		if not self.effective_start_date or not self.effective_end_date:
			return

		if getdate(self.effective_end_date) < getdate(self.effective_start_date):
			frappe.throw(_("Effective End Date cannot be earlier than Effective Start Date."))

	def validate_quantity(self):
		if self.quantity is not None and self.quantity <= 0:
			frappe.throw(_("Quantity must be greater than zero."))

	def validate_rate(self):
		if self.price_source == "Manual Override" and not self.rate_override_reason:
			frappe.throw(_("Rate Override Reason is required when Price Source is Manual Override."))

		if self.agreed_rate is not None and self.agreed_rate < 0:
			frappe.throw(_("Agreed Rate cannot be negative."))

	def validate_no_overlap(self):
		"""One service, one target, one period at a time — history included.

		A closed assignment still describes a period that was really provided and really
		billed, so a new one may not reach back over it. Only a Cancelled record is ignored:
		it never stood for a period at all.
		"""
		if self.operational_status == "Cancelled" or not self.effective_start_date:
			return

		filters = {
			"name": ("!=", self.name),
			"customer": self.customer,
			"service_item": self.service_item,
			"assignment_scope": self.assignment_scope,
			"operational_status": ("!=", "Cancelled"),
		}

		scope_field = SCOPE_FIELD.get(self.assignment_scope)
		if scope_field:
			filters[scope_field] = self.get(scope_field)

		for other in frappe.get_all(
			"MSP Service Assignment",
			filters=filters,
			fields=["name", "effective_start_date", "effective_end_date"],
		):
			if self.periods_overlap(other):
				frappe.throw(
					_("Assignment {0} already covers an overlapping period for the same service and scope.").format(
						frappe.bold(other.name)
					)
				)

	def periods_overlap(self, other):
		start = getdate(self.effective_start_date) if self.effective_start_date else None
		end = getdate(self.effective_end_date) if self.effective_end_date else None
		other_start = getdate(other.effective_start_date) if other.effective_start_date else None
		other_end = getdate(other.effective_end_date) if other.effective_end_date else None

		if end and other_start and end < other_start:
			return False

		if other_end and start and other_end < start:
			return False

		return True

	def sync_billing_status(self):
		"""Billing is read off the operational status, never set beside it.

		Whatever a caller put in the field is restated from the life the service is actually
		in, so no code can leave Active + On Hold or Ended + Pending behind.
		"""
		derived = OPERATIONAL_TO_BILLING.get(self.operational_status)

		if derived:
			self.billing_status = derived
