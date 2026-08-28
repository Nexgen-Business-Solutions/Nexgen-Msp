import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils.errors import NotFoundError, ValidationError

# the two roles that make someone staff; the portal role is granted from a person's file
STAFF_ROLES = ("MSP System Admin", "MSP Technician")

# customer contacts are accounts too, and belong on the same page
PORTAL_ROLES = ("Customer Portal Manager",)

def _classify(email, held):
	if email == "Administrator" or "MSP System Admin" in held:
		return "Administrator"
	if "MSP Technician" in held:
		return "Technician"
	if held.intersection(PORTAL_ROLES):
		return "Portal contact"
	return "No role"


class TeamService:
	@staticmethod
	def _guard():
		ContractService._guard_admin()

	@staticmethod
	def list_members(search=None, role=None, status=None, kind=None):
		"""Every account that can sign in, staff and customer contacts alike.

		One page for the whole population: a portal contact and a technician are both
		accounts, and looking for "who is this address" should not depend on guessing which
		of two lists to open.
		"""
		TeamService._guard()

		rows = frappe.db.sql(
			"""
			select u.name, u.full_name, u.enabled, u.user_type, u.last_active, u.creation
			from `tabUser` u
			where u.name not in ('Guest')
			  and u.user_type in ('System User', 'Website User')
			order by u.full_name asc
			""",
			as_dict=True,
		)

		scopes = {}

		for row in frappe.get_all(
			"User Permission", filters={"allow": "Customer"}, fields=["user", "for_value"]
		):
			scopes.setdefault(row.user, []).append(row.for_value)

		linked = {
			row.portal_user: row.name
			for row in frappe.get_all(
				"Client User",
				filters={"portal_user": ("is", "set")},
				fields=["name", "portal_user"],
			)
		}

		for row in rows:
			held = set(frappe.get_roles(row.name))
			row["roles"] = sorted(held.intersection(STAFF_ROLES + PORTAL_ROLES))
			row["customers"] = scopes.get(row.name, [])
			row["client_user"] = linked.get(row.name)

			row["kind"] = _classify(row.name, held)

			row["role"] = next((name for name in STAFF_ROLES if name in held), None)

		needle = (search or "").strip().lower()

		if needle:
			rows = [
				r
				for r in rows
				if needle in (r.full_name or "").lower()
				or needle in r.name.lower()
				or any(needle in c.lower() for c in r["customers"])
			]

		if role:
			rows = [r for r in rows if role in r["roles"]]

		if kind:
			rows = [r for r in rows if r["kind"] == kind]

		if status == "active":
			rows = [r for r in rows if r.enabled]
		elif status == "disabled":
			rows = [r for r in rows if not r.enabled]

		return rows

	@staticmethod
	def get_member(email=None):
		"""One account, with everything that decides what it may do.

		Sign-ins are read from the trail Frappe already keeps, because the useful question
		about an account is rarely what it is allowed to do but whether anyone still uses it.
		"""
		TeamService._guard()

		if not email or not frappe.db.exists("User", email):
			raise NotFoundError(f"User {email} not found.", "NOT_FOUND")

		account = frappe.db.get_value(
			"User",
			email,
			[
				"name",
				"full_name",
				"first_name",
				"last_name",
				"enabled",
				"user_type",
				"creation",
				"last_active",
				"last_login",
				"last_password_reset_date",
			],
			as_dict=True,
		)

		held = set(frappe.get_roles(email))
		account["kind"] = _classify(email, held)
		account["role"] = next((name for name in STAFF_ROLES if name in held), None)
		account["roles"] = sorted(held.intersection(STAFF_ROLES + PORTAL_ROLES))
		account["desk_access"] = account.user_type == "System User"
		account["customers"] = frappe.get_all(
			"User Permission",
			filters={"user": email, "allow": "Customer"},
			pluck="for_value",
			order_by="for_value",
		)

		person = frappe.db.get_value(
			"Client User",
			{"portal_user": email},
			["name", "full_name", "customer", "lifecycle_status", "email"],
			as_dict=True,
		)
		account["client_user"] = person

		account["sign_ins"] = frappe.get_all(
			"Activity Log",
			filters={"user": email, "operation": ("in", ("Login", "Logout"))},
			fields=["operation", "status", "ip_address", "creation"],
			order_by="creation desc",
			limit=12,
		)

		account["is_self"] = email == frappe.session.user
		account["can_invite"] = bool(account["role"] or person)

		return account

	@staticmethod
	def options():
		TeamService._guard()

		return {
			"roles": list(STAFF_ROLES),
			"kinds": ["Administrator", "Technician", "Portal contact", "No role"],
		}

	@staticmethod
	def invite(email=None, first_name=None, last_name=None, role=None, send_email=1):
		"""Open an account for a colleague and mail them a link to set their password."""
		TeamService._guard()

		email = (email or "").strip().lower()

		if not email or "@" not in email:
			raise ValidationError("A valid email address is required.", "VALIDATION_ERROR")

		if role not in STAFF_ROLES:
			raise ValidationError(f"'{role}' is not a staff role.", "VALIDATION_ERROR")

		if not (first_name or "").strip():
			raise ValidationError("A first name is required.", "VALIDATION_ERROR")

		if frappe.db.exists("User", email):
			raise ValidationError(
				f"{email} already has an account. Change their role instead.",
				"VALIDATION_ERROR",
			)

		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": (first_name or "").strip(),
				"last_name": (last_name or "").strip() or None,
				"send_welcome_email": 0,
			}
		).insert(ignore_permissions=True)

		user.append("roles", {"role": role})
		user.save(ignore_permissions=True)
		frappe.db.commit()

		if frappe.utils.cint(send_email):
			TeamService.send_invitation(user.name)

		return TeamService.list_members()

	@staticmethod
	def send_invitation(email=None):
		"""Send, or resend, the link that lets a colleague set their password."""
		TeamService._guard()

		if not email or not frappe.db.exists("User", email):
			raise NotFoundError(f"User {email} not found.", "NOT_FOUND")

		from nexgen_msp.utils import notifications

		user = frappe.get_doc("User", email)
		held = set(frappe.get_roles(user.name))
		role = next((name for name in STAFF_ROLES if name in held), None)

		if not role:
			person = frappe.db.get_value("Client User", {"portal_user": user.name}, "name")

			if not person:
				raise ValidationError(
					f"{email} holds no role, so there is nothing to invite them to. "
					"Give the account a role first.",
					"VALIDATION_ERROR",
				)

			from nexgen_msp.api.internal.services.user_service import UserService

			UserService.invite_to_portal(name=person, email=user.name)

			return {"sent_to": user.name}

		link = user._reset_password(send_email=False)

		notifications.send(
			"MSP Team Invitation",
			[user.name],
			{"full_name": user.full_name or user.name, "role": role, "link": link},
			reference_doctype="User",
			reference_name=user.name,
		)
		frappe.db.commit()

		return {"sent_to": user.name}

	@staticmethod
	def set_role(email=None, role=None):
		"""Move someone between staff roles. One role at a time, so what they can do is plain."""
		TeamService._guard()

		if not email or not frappe.db.exists("User", email):
			raise NotFoundError(f"User {email} not found.", "NOT_FOUND")

		if role not in STAFF_ROLES:
			raise ValidationError(f"'{role}' is not a staff role.", "VALIDATION_ERROR")

		user = frappe.get_doc("User", email)
		user.set("roles", [row for row in user.roles if row.role not in STAFF_ROLES])
		user.append("roles", {"role": role})
		user.save(ignore_permissions=True)
		frappe.db.commit()

		return TeamService.list_members()

	@staticmethod
	def set_enabled(email=None, enabled=None):
		"""Close or reopen an account. Nothing is deleted: their trail stays readable."""
		TeamService._guard()

		if not email or not frappe.db.exists("User", email):
			raise NotFoundError(f"User {email} not found.", "NOT_FOUND")

		if email == frappe.session.user:
			raise ValidationError(
				"You cannot disable your own account.", "VALIDATION_ERROR"
			)

		frappe.db.set_value("User", email, "enabled", frappe.utils.cint(enabled))
		frappe.db.commit()

		return TeamService.list_members()
