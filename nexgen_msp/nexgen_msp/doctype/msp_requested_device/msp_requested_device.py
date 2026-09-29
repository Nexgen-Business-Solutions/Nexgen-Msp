# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from nexgen_msp.nexgen_msp.doctype.msp_requested_client_user.msp_requested_client_user import (
	RequestedEntity,
)
from nexgen_msp.utils import request_targets

SOURCE_PREFIX = "requested-device"


def source_key_for(request, device_requirement_key):
	"""The deterministic idempotency key of a Requested Device."""
	return f"{SOURCE_PREFIX}:{request}:{device_requirement_key}"


class MSPRequestedDevice(RequestedEntity):
	RESOLVED_FIELD = "resolved_managed_device"
	RESOLVED_DOCTYPE = "MSP Managed Device"

	def build_source_key(self):
		return source_key_for(self.request, self.device_requirement_key)

	def validate(self):
		super().validate()
		self.validate_intended_holder()

	def validate_intended_holder(self):
		person = self.intended_holder_client_user
		requested = self.intended_holder_requested_client_user

		if person and requested:
			frappe.throw(_("A requested Device can have only one intended holder."))

		if person and frappe.db.get_value("MSP Client User", person, "customer") != self.customer:
			frappe.throw(_(request_targets.CROSS_CUSTOMER))

		if requested:
			request_targets.check_requested_link(
				request_targets.REQUESTED_CLIENT_USER, requested, self.request, self.customer
			)
