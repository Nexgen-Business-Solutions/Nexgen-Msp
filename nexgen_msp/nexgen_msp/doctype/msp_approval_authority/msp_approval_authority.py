import frappe
from frappe import _
from frappe.model.document import Document


class MSPApprovalAuthority(Document):
	def validate(self):
		self.stamp_names()
		self.validate_people_belong_here()
		self.validate_no_duplicates()

	def stamp_names(self):
		for row in self.approvers:
			row.full_name = frappe.db.get_value("MSP Client User", row.client_user, "full_name")

	def validate_people_belong_here(self):
		"""An approver decides for their own company and no other."""
		for row in self.approvers:
			owner = frappe.db.get_value("MSP Client User", row.client_user, "customer")

			if owner != self.customer:
				frappe.throw(
					_("{0} belongs to {1}, not to {2}.").format(
						frappe.bold(row.full_name or row.client_user), owner, self.customer
					)
				)

	def validate_no_duplicates(self):
		seen = set()

		for row in self.approvers:
			if row.client_user in seen:
				frappe.throw(
					_("{0} appears twice. One line per person.").format(
						frappe.bold(row.full_name or row.client_user)
					)
				)

			seen.add(row.client_user)
