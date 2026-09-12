# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class MSPDepartment(Document):
	def validate(self):
		self.normalize_name()
		self.validate_unique_name()

	def on_update(self):
		from nexgen_msp.api.internal.services.department_service import DepartmentService

		previous = self.get_doc_before_save()
		if previous and previous.department_name != self.department_name:
			DepartmentService.rename_references(previous.department_name, self.department_name)

	def before_rename(self, old, new, merge=False):
		if merge:
			frappe.throw(_("Departments cannot be merged. Reassign current records, then disable the unused department."))
		new = " ".join((new or "").split())
		if not new:
			frappe.throw(_("A department name is required."))
		return {"new": new}

	def after_rename(self, old, new, merge=False):
		from nexgen_msp.api.internal.services.department_service import DepartmentService

		DepartmentService.rename_references(old, new)

	def on_trash(self):
		from nexgen_msp.api.internal.services.department_service import DepartmentService

		DepartmentService.ensure_unused(self.department_name)

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
