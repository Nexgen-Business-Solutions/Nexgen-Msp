# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class MSPDepartment(Document):
	def validate(self):
		self.normalize_name()
		self.validate_unique_name()

	def normalize_name(self):
		if self.department_name:
			self.department_name = " ".join(self.department_name.strip().split())

	def validate_unique_name(self):
		if not self.department_name:
			return

		duplicate = frappe.db.sql(
			"""
			select name from `tabMSP Department`
			where lower(trim(department_name)) = %(normalized)s and name != %(name)s
			limit 1
			""",
			{"normalized": self.department_name.strip().casefold(), "name": self.name or ""},
		)

		if duplicate:
			frappe.throw(
				_("A department named {0} already exists.").format(frappe.bold(self.department_name))
			)
