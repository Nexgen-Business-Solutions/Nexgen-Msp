# Copyright (c) 2026, Nexgen Business Solutions and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class MSPRequestAction(Document):
	"""How one of the engine's acts is offered to a customer.

	The act itself is the engine's: Remove ends a service and nothing configured here can
	change that. What an administrator settles is the wording, the order and whether the act
	is offered at all.
	"""

	def validate(self):
		self.validate_act_is_settled()
		self.validate_one_offer_per_act()

	def validate_one_offer_per_act(self):
		"""Two enabled wordings of the same act would be two buttons doing one thing.

		A customer choosing between "Close service" and "Terminate service" is choosing
		between nothing at all: the engine carries out the same removal either way.
		"""
		if not self.enabled:
			return

		twin = frappe.db.get_value(
			"MSP Request Action",
			{"action_type": self.action_type, "enabled": 1, "name": ("!=", self.name or "")},
			"title",
		)

		if twin:
			frappe.throw(
				_("{0} is already what a customer is offered for {1}. Disable it first.").format(
					frappe.bold(twin), self.action_type
				)
			)

	def validate_act_is_settled(self):
		"""What an action already used stands for cannot be rewritten underneath it.

		Requests on file were raised against this wording; changing the act it maps to would
		change, after the fact, what those customers are recorded as having asked for.
		"""
		previous = self.get_doc_before_save()

		if not previous or previous.action_type == self.action_type:
			return

		used = frappe.db.count("MSP Service Request Line", {"request_action": self.name})

		if used:
			frappe.throw(
				_("{0} is on {1} request line(s). What it does can no longer be changed.").format(
					frappe.bold(self.title), used
				)
			)
