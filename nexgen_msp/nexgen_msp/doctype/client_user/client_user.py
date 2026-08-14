# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

LINKED_DOCTYPES = ("Managed Device",)


class ClientUser(Document):
	def validate(self):
		self.normalize_full_name()
		self.validate_lifecycle_dates()
		self.validate_unique_username()

	def on_trash(self):
		self.prevent_delete_with_history()

	def normalize_full_name(self):
		if self.full_name:
			self.full_name = " ".join(self.full_name.split())

	def validate_lifecycle_dates(self):
		if self.lifecycle_status == "Disabled" and not self.disabled_date:
			frappe.throw(_("Disabled Date is required when Lifecycle Status is Disabled."))

		if self.lifecycle_status in ("Pending", "Active"):
			self.disabled_date = None
			self.disabled_reason = None

		if self.start_date and self.disabled_date and self.disabled_date < self.start_date:
			frappe.throw(_("Disabled Date cannot be earlier than Start Date."))

	def validate_unique_username(self):
		if not self.username:
			return

		duplicate = frappe.db.exists(
			"Client User",
			{
				"username": self.username,
				"customer": self.customer,
				"name": ("!=", self.name),
			},
		)
		if duplicate:
			frappe.throw(
				_("Username {0} already exists for customer {1} on {2}.").format(
					frappe.bold(self.username), frappe.bold(self.customer), duplicate
				)
			)

	def prevent_delete_with_history(self):
		for doctype in LINKED_DOCTYPES:
			count = frappe.db.count(doctype, {"assigned_client_user": self.name})
			if count:
				frappe.throw(
					_("Cannot delete {0} because {1} {2} record(s) are linked. Disable or archive instead.").format(
						frappe.bold(self.name), count, doctype
					)
				)
