import frappe
from frappe import _
from frappe.model.document import Document

from nexgen_msp.api.internal.services import notification_registry as registry


class MSPNotificationRule(Document):
	"""One managed notification as the administrator has configured it.

	The rules live here so that a crafted payload cannot reach past the service layer: what
	this notification *is* comes from the registry, and the record is refused if it drifts
	from it. A settings screen may change how a message is sent; it may never turn a
	password reset into a weekly newsletter.
	"""

	def validate(self):
		self.hold_the_registry()
		self.hold_the_shape()

	def hold_the_registry(self):
		declared = registry.rule(self.rule_key)

		if not declared:
			frappe.throw(
				_("{0} is not a notification this application owns.").format(self.rule_key)
			)

		if self.kind != declared["kind"]:
			frappe.throw(
				_("{0} is a {1} notification and cannot be saved as {2}.").format(
					self.rule_key, declared["kind"], self.kind
				)
			)

		if self.trigger_key != declared["trigger_key"]:
			frappe.throw(
				_("The trigger of {0} is fixed by the application.").format(self.rule_key)
			)

		# the registry owns protection, not the payload: a rule cannot be unprotected by
		# sending protected=0, and a protected one cannot be switched off at all
		self.protected = 1 if declared["protected"] else 0

		if self.protected:
			self.enabled = 1

		if self.template_name not in declared["templates"]:
			frappe.throw(
				_("{0} cannot be sent with the template {1}.").format(
					self.rule_key, self.template_name
				)
			)

		if self.audience_key not in declared["audiences"]:
			frappe.throw(
				_("{0} cannot be addressed to {1}.").format(self.rule_key, self.audience_key)
			)

	def hold_the_shape(self):
		if self.kind == registry.EVENT:
			# an event has no cadence of its own: it happens when the business event happens,
			# and a number left on the record would read as a schedule nobody runs
			for fieldname in (
				"initial_delay_value",
				"repeat_interval_value",
				"max_sends",
				"escalation_after_iteration",
			):
				self.set(fieldname, 0)

			self.stop_condition_key = None
			self.escalation_audience_key = None
			self.quiet_hours_enabled = 0

			return

		adapter = registry.condition(self.trigger_key) or {}

		if frappe.utils.cint(self.initial_delay_value) < 0:
			frappe.throw(_("The first reminder cannot be sent before the record exists."))

		if frappe.utils.cint(self.repeat_interval_value) <= 0:
			frappe.throw(_("A reminder that repeats every nothing would never stop."))

		if frappe.utils.cint(self.max_sends) <= 0:
			frappe.throw(_("A reminder needs a maximum number of sends."))

		if self.stop_condition_key not in adapter.get("stop_conditions", ()):
			frappe.throw(
				_("{0} is not a way this reminder can stop.").format(self.stop_condition_key)
			)

		self.hold_the_timezone()
		self.hold_the_quiet_hours()
		self.hold_the_escalation()

	def hold_the_timezone(self):
		if not self.timezone:
			self.timezone = frappe.utils.get_system_timezone()
			return

		from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

		try:
			ZoneInfo(self.timezone)
		except (ZoneInfoNotFoundError, ValueError):
			frappe.throw(_("{0} is not a timezone this system knows.").format(self.timezone))

	def hold_the_quiet_hours(self):
		if not frappe.utils.cint(self.quiet_hours_enabled):
			return

		if not self.quiet_start or not self.quiet_end:
			frappe.throw(_("Quiet hours need a start and an end."))

		if self.quiet_start == self.quiet_end:
			frappe.throw(_("Quiet hours that start when they end would silence every send."))

	def hold_the_escalation(self):
		iteration = frappe.utils.cint(self.escalation_after_iteration)

		if not iteration:
			self.escalation_audience_key = None
			return

		if not self.escalation_audience_key:
			frappe.throw(_("An escalation needs somebody to escalate to."))

		if self.escalation_audience_key not in registry.AUDIENCES:
			frappe.throw(
				_("{0} is not an audience this application resolves.").format(
					self.escalation_audience_key
				)
			)

		# "after reminder N" means the ones that follow it, so an escalation after the last
		# reminder has nothing left to escalate. Allowing it stored a setting that could
		# never fire, which reads on the screen as an escalation somebody will be waiting for
		if iteration >= frappe.utils.cint(self.max_sends):
			frappe.throw(
				_(
					"An escalation after reminder {0} is never reached: this rule stops at {1}, "
					"so nothing follows it."
				).format(iteration, self.max_sends)
			)
