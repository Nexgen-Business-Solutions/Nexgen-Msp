# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate

from nexgen_msp.utils import device_holders as holders

MAC_PATTERN = re.compile(r"^[0-9A-F]{2}([:-])(?:[0-9A-F]{2}\1){4}[0-9A-F]{2}$")
CLOSED_STATUSES = ("Returned", "Damaged", "Retired", "Lost")


class MSPManagedDevice(Document):
	def validate(self):
		holders.sync_current(self)
		self.normalize_hostname()
		self.validate_unique_serial()
		self.validate_assigned_user()
		self.validate_status_dates()
		self.validate_network_interfaces()

	def normalize_hostname(self):
		if self.hostname:
			self.hostname = self.hostname.strip().upper()

	def validate_unique_serial(self):
		"""A serial number names one physical machine, so no two records may share it.

		The hostname is deliberately left free: two machines can answer to the same name,
		and the screens say who already carries it when it comes up. What cannot be shared
		is the number engraved on the case.
		"""
		if not (self.serial_number or "").strip():
			return

		self.serial_number = self.serial_number.strip()

		duplicate = frappe.db.get_value(
			"MSP Managed Device",
			{"serial_number": self.serial_number, "name": ("!=", self.name)},
			["name", "hostname", "customer"],
			as_dict=True,
		)

		if duplicate:
			frappe.throw(
				_("Serial number {0} is already on {1} ({2}, {3}).").format(
					frappe.bold(self.serial_number),
					duplicate.name,
					duplicate.hostname,
					duplicate.customer,
				)
			)

	def validate_assigned_user(self):
		if not self.assigned_client_user:
			return

		user_customer = frappe.db.get_value("MSP Client User", self.assigned_client_user, "customer")
		if user_customer != self.customer:
			frappe.throw(
				_("Client User {0} belongs to customer {1} and cannot be assigned to a device of customer {2}.").format(
					frappe.bold(self.assigned_client_user), frappe.bold(user_customer), frappe.bold(self.customer)
				)
			)

	def validate_status_dates(self):
		if self.status in ("Returned", "Retired") and not self.retired_date:
			frappe.throw(_("Retired Date is required when Status is {0}.").format(self.status))

		if self.status not in CLOSED_STATUSES:
			self.retired_date = None

		if self.assigned_date and self.retired_date and getdate(self.retired_date) < getdate(self.assigned_date):
			frappe.throw(_("Retired Date cannot be earlier than Assigned Date."))

		if self.status == "Active" and not self.assigned_client_user and not self.assigned_date:
			self.assigned_date = frappe.utils.today()

	def validate_network_interfaces(self):
		seen = set()
		primary_count = 0

		for row in self.network_interfaces:
			row.mac_address = (row.mac_address or "").strip().upper().replace(".", ":")

			if not MAC_PATTERN.match(row.mac_address):
				frappe.throw(
					_("Row {0}: {1} is not a valid MAC address.").format(row.idx, frappe.bold(row.mac_address))
				)

			if row.mac_address in seen:
				frappe.throw(_("Row {0}: MAC address {1} is duplicated.").format(row.idx, frappe.bold(row.mac_address)))

			seen.add(row.mac_address)
			primary_count += bool(row.is_primary)

		if primary_count > 1:
			frappe.throw(_("Only one network interface can be marked as primary."))

		if self.network_interfaces and not primary_count:
			self.network_interfaces[0].is_primary = 1
