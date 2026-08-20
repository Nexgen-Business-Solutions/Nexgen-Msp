# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate, now_datetime

BLOCKING_STATUSES = (
	"Draft",
	"Validating",
	"Exception",
	"Ready for Approval",
	"Approved",
	"Invoice Drafted",
	"Invoiced",
)


class BillingRun(Document):
	def validate(self):
		self.validate_period()
		self.validate_duplicate_run()
		self.validate_adjustment()
		self.set_totals()

	def before_submit(self):
		self.validate_no_blocking_exception()
		self.status = "Approved"
		self.approved_by = frappe.session.user
		self.approved_at = now_datetime()

	def on_cancel(self):
		self.status = "Cancelled"

	def validate_period(self):
		if getdate(self.billing_period_end) < getdate(self.billing_period_start):
			frappe.throw(_("Billing Period End cannot be earlier than Billing Period Start."))

	def validate_duplicate_run(self):
		# an adjustment or a credit note deliberately revisits a period already billed
		if self.adjustment_of or self.credit_note_of:
			return

		duplicate = frappe.db.exists(
			"Billing Run",
			{
				"name": ("!=", self.name),
				"customer": self.customer,
				"billing_period_start": self.billing_period_start,
				"billing_period_end": self.billing_period_end,
				"adjustment_of": ("is", "not set"),
				"credit_note_of": ("is", "not set"),
				"status": ("in", BLOCKING_STATUSES),
				"docstatus": ("<", 2),
			},
		)
		if duplicate:
			frappe.throw(
				_("Billing Run {0} already covers this period for {1}. Use an adjustment run instead.").format(
					duplicate, self.customer
				)
			)

	def validate_adjustment(self):
		if not self.adjustment_of:
			return

		if self.adjustment_of == self.name:
			frappe.throw(_("A Billing Run cannot be an adjustment of itself."))

		source_customer = frappe.db.get_value("Billing Run", self.adjustment_of, "customer")
		if source_customer != self.customer:
			frappe.throw(
				_("Billing Run {0} belongs to customer {1}, not {2}.").format(
					self.adjustment_of, source_customer, self.customer
				)
			)

	def set_totals(self):
		self.exception_count = sum(1 for row in self.lines if row.exception_code)
		self.total_amount = sum(flt(row.amount) for row in self.lines if not row.exception_code)

		if not self.prepared_by:
			self.prepared_by = frappe.session.user

	def validate_no_blocking_exception(self):
		if self.exception_count:
			frappe.throw(
				_("{0} line(s) carry a blocking exception. Resolve them before approving this run.").format(
					self.exception_count
				)
			)

		if not self.lines:
			frappe.throw(_("Cannot approve a Billing Run with no lines."))
