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
		"""A service sits on one live contract for any given day, or billing would double up.

		Two contracts may carry the same service one after the other — 2026 on one, 2027 on
		the next. What they may not do is cover it over the same days. A draft is still being
		prepared and is checked the moment it goes live. An open end runs for ever.
		"""
		if self.status not in LIVE_STATUSES:
			return

		for row in self.services:
			clash = frappe.db.sql(
				"""
				select c.name, c.title, c.start_date, c.end_date
				from `tabMSP Contract` c
				join `tabMSP Contract Service` cs on cs.parent = c.name
				where c.customer = %(customer)s
				  and c.name != %(name)s
				  and c.status in %(live)s
				  and cs.service_item = %(service)s
				  and c.start_date <= ifnull(%(end)s, '9999-12-31')
				  and %(start)s <= ifnull(c.end_date, '9999-12-31')
				order by c.start_date
				limit 1
				""",
				{
					"customer": self.customer,
					"name": self.name or "",
					"live": LIVE_STATUSES,
					"service": row.service_item,
					"start": self.start_date,
					"end": self.end_date or None,
				},
				as_dict=True,
			)

			if clash:
				other = clash[0]
				frappe.throw(
					_(
						"{0} is already covered by contract {1} from {2} to {3}, which overlaps "
						"this contract's dates. Change the dates so they do not overlap, or end "
						"the other contract first."
					).format(
						row.service_item,
						other.title or other.name,
						other.start_date,
						other.end_date or _("no end date"),
					)
				)
