import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint

from nexgen_msp.api.core.services.login_rule_service import BLANKET_ROLES
from nexgen_msp.utils import login_route_registry as routes

MAX_PRIORITY = 1000


class NexgenLoginRule(Document):
	def validate(self):
		self.stamp_names()
		self.validate_route()
		self.validate_priority()
		self.validate_somebody_is_named()
		self.validate_no_duplicates()
		self.validate_roles_are_specific()
		self.validate_one_default_per_account()

	def stamp_names(self):
		for row in self.applicable_users:
			row.full_name = frappe.db.get_value("User", row.user, "full_name") or row.user

	def validate_route(self):
		"""A destination is a local route the server already knows how to guard.

		Checked on a switched-off rule too. Being switched off is a state an administrator
		can read and undo; a route that resolves nowhere is a trap waiting for whoever
		switches it back on.
		"""
		route, problem = routes.normalize(self.home_route)

		if problem:
			frappe.throw(
				_(
					"{0} is not a route this site can send somebody to. A destination is a"
					" local path beginning with a single slash, with no host, query or"
					" fragment."
				).format(frappe.bold(self.home_route or "")),
				title=_("Invalid destination"),
			)

		if not routes.registered(route):
			frappe.throw(
				_(
					"Nothing is registered to answer for {0}. A destination needs its prefix"
					" and the check that decides who may reach it, declared together."
				).format(frappe.bold(route)),
				title=_("Unknown destination"),
			)

		self.home_route = route

	def validate_priority(self):
		self.priority = cint(self.priority)

		if not 0 <= self.priority <= MAX_PRIORITY:
			frappe.throw(
				_("Priority runs from 0 to {0}.").format(MAX_PRIORITY),
				title=_("Priority out of range"),
			)

	def validate_somebody_is_named(self):
		if not self.applicable_users and not self.applicable_roles:
			frappe.throw(
				_("A rule that names nobody decides nothing. Add an account or a role."),
				title=_("Nobody named"),
			)

	def validate_no_duplicates(self):
		seen = set()

		for row in self.applicable_users:
			if row.user in seen:
				frappe.throw(
					_("{0} appears twice. One line per account.").format(
						frappe.bold(row.full_name or row.user)
					)
				)

			seen.add(row.user)

		seen = set()

		for row in self.applicable_roles:
			if row.role in seen:
				frappe.throw(
					_("{0} appears twice. One line per role.").format(frappe.bold(row.role))
				)

			seen.add(row.role)

	def validate_roles_are_specific(self):
		"""Nobody is routed by a role they were never given.

		Frappe hands every account `All` and `Guest` without anybody asking, so a rule hung
		on one of them is a destination for the whole site that no administrator chose.
		"""
		for row in self.applicable_roles:
			if row.role in BLANKET_ROLES:
				frappe.throw(
					_(
						"{0} is carried by every account on the site, so a rule cannot be"
						" hung on it. Name the roles this destination is actually for."
					).format(frappe.bold(row.role)),
					title=_("Role too broad"),
				)

	def validate_one_default_per_account(self):
		"""One account, one direct destination — read across every other rule.

		A direct default beats every role, so two of them are two answers to a question
		that has to have one. The account is locked before the other rules are read: two
		administrators saving at the same moment would otherwise each find the way clear.
		"""
		for row in self.applicable_users:
			if not cint(row.get("default")):
				continue

			frappe.db.get_value("User", row.user, "name", for_update=True)

			held = frappe.db.sql_list(
				"""
				select distinct line.parent
				from `tabNexgen Login Applicable User` line
				where line.parenttype = %s
				  and line.user = %s
				  and ifnull(line.`default`, 0) = 1
				  and line.parent != %s
				""",
				(self.doctype, row.user, self.name),
			)

			if held:
				frappe.throw(
					_(
						"{0} is already sent somewhere by {1}. An account has one default"
						" destination; clear that one before setting this."
					).format(
						frappe.bold(row.full_name or row.user),
						frappe.bold(", ".join(held)),
					),
					title=_("Already assigned"),
				)
