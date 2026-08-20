# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate

LIVE_STATUSES = ("Active", "Suspended")


class MSPContract(Document):
	def validate(self):
		self.set_title()
		self.validate_dates()
		self.validate_unique_services()
		self.validate_service_exclusivity()

	def set_title(self):
		if not self.title:
			self.title = f"{self.customer} — {self.start_date}"

	def validate_dates(self):
		if self.end_date and getdate(self.end_date) < getdate(self.start_date):
			frappe.throw(_("End Date cannot be earlier than Start Date."))

		if self.price_list_valid_upto and getdate(self.price_list_valid_upto) < getdate(self.start_date):
			frappe.throw(_("The price list cannot expire before the contract starts."))

	def validate_unique_services(self):
		seen = set()

		for row in self.services:
			if row.service_item in seen:
				frappe.throw(
					_("Row {0}: {1} is listed twice on this contract.").format(
						row.idx, row.service_item
					)
				)
			seen.add(row.service_item)

	def validate_service_exclusivity(self):
		"""A service belongs to one live contract at a time, or billing would double up."""
		if self.status not in LIVE_STATUSES:
			return

		for row in self.services:
			clash = frappe.db.sql(
				"""
				select c.name
				from `tabMSP Contract` c
				join `tabMSP Contract Service` cs on cs.parent = c.name
				where c.customer = %(customer)s
				  and c.name != %(name)s
				  and c.status in %(live)s
				  and cs.service_item = %(service)s
				limit 1
				""",
				{
					"customer": self.customer,
					"name": self.name or "",
					"live": LIVE_STATUSES,
					"service": row.service_item,
				},
			)

			if clash:
				frappe.throw(
					_("{0} is already covered by live contract {1}. End or suspend it first.").format(
						row.service_item, clash[0][0]
					)
				)
