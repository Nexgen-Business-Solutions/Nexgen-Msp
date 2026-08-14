# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class MSPCustomerProfile(Document):
	def validate(self):
		self.validate_contract_dates()
		self.validate_cutoff_day()
		self.validate_eligibility_rows()

	def validate_contract_dates(self):
		if not self.contract_end_date:
			return

		if getdate(self.contract_end_date) < getdate(self.contract_start_date):
			frappe.throw(_("Contract End Date cannot be earlier than Contract Start Date."))

	def validate_cutoff_day(self):
		if not 1 <= (self.billing_cutoff_day or 0) <= 28:
			frappe.throw(_("Billing Cut-off Day must be between 1 and 28."))

	def validate_eligibility_rows(self):
		seen = set()

		for row in self.service_eligibility:
			if row.service_item in seen:
				frappe.throw(
					_("Row {0}: service {1} is listed more than once.").format(row.idx, frappe.bold(row.service_item))
				)
			seen.add(row.service_item)

			if row.valid_from and row.valid_upto and getdate(row.valid_upto) < getdate(row.valid_from):
				frappe.throw(_("Row {0}: Valid Upto cannot be earlier than Valid From.").format(row.idx))

			if row.negotiated_rate is not None and row.negotiated_rate < 0:
				frappe.throw(_("Row {0}: Negotiated Rate cannot be negative.").format(row.idx))
