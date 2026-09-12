import frappe
from frappe import _
from frappe.model.document import Document

from nexgen_msp.utils import permissions


class MSPApprovalAuthority(Document):
	def validate(self):
		self.stamp_names()
		self.validate_accounts_belong_here()
		self.validate_no_duplicates()
		self.validate_departments()

	def stamp_names(self):
		for row in self.approvers:
			row.full_name = frappe.db.get_value("User", row.user, "full_name") or row.user

	def validate_accounts_belong_here(self):
		"""An approver decides for their own company and no other.

		Which company an account answers for is its customer permission — the same fact that
		lets it hold a customer role at all.
		"""
		for row in self.approvers:
			allowed = permissions.get_allowed_customers(row.user)

			if self.customer not in allowed:
				frappe.throw(
					_("{0} is not an account of {1}.").format(
						frappe.bold(row.full_name or row.user), self.customer
					)
				)

			if not set(frappe.get_roles(row.user)).intersection(permissions.CUSTOMER_ROLES):
				frappe.throw(
					_("{0} is not a customer account, so it cannot decide here.").format(
						frappe.bold(row.full_name or row.user)
					)
				)

	def validate_no_duplicates(self):
		seen = set()

		for row in self.approvers:
			if row.user in seen:
				frappe.throw(
					_("{0} appears twice. One line per account.").format(
						frappe.bold(row.full_name or row.user)
					)
				)

			seen.add(row.user)

	def validate_departments(self):
		"""An approver limited to a department must be limited to one that actually exists.

		The authority scoping is the customer's own concern; only the department itself is
		global, so this is the one place its catalogue is checked from here.
		"""
		from nexgen_msp.api.internal.services.department_service import DepartmentService

		previous = self.get_doc_before_save()
		old_rows = {row.name: row for row in previous.approvers} if previous and previous.customer == self.customer else {}
		for row in self.approvers:
			if row.department:
				old = old_rows.get(row.name)
				unchanged = bool(old and old.user == row.user and
					DepartmentService._normalized(old.department) == DepartmentService._normalized(row.department))
				row.department = DepartmentService.validate_department(row.department, allow_disabled=unchanged)
