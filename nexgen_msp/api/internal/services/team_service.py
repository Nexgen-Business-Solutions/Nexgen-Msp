import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils import approval, permissions
from nexgen_msp.utils.errors import NotFoundError, ValidationError

# An account belongs to one family or the other, never both. Within each, the most powerful
# role comes first: what an account *is* is read off the first one it holds.
STAFF_ROLES = permissions.INTERNAL_ROLES
PORTAL_ROLES = permissions.CUSTOMER_ROLES
ALL_ROLES = STAFF_ROLES + PORTAL_ROLES

# offered least powerful first, so full administration is never the option under the cursor
INTERNAL_CHOICES = ("MSP Technician", "MSP System Admin")
CUSTOMER_CHOICES = ("MSP Customer Operator", "MSP Customer Manager")


def _classify(email, held):
	if email == "Administrator":
		return "Administrator"

	role = next((name for name in ALL_ROLES if name in held), None)

	return permissions.ROLE_LABELS.get(role, "No role")


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

		from nexgen_msp.api.two_factor.services.two_factor_service import TwoFactorService

		for row in rows:
			held = set(frappe.get_roles(row.name))
			row["two_factor"] = TwoFactorService.has_secret(row.name)
			row["roles"] = sorted(held.intersection(ALL_ROLES))
			row["customers"] = scopes.get(row.name, [])

			row["kind"] = _classify(row.name, held)

			row["role"] = next((name for name in ALL_ROLES if name in held), None)
			row["role_label"] = permissions.ROLE_LABELS.get(row["role"])

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
			# "Customer" alone means either customer kind: the portal card counts them together
			rows = [r for r in rows if r["kind"] == kind or (kind == "Customer" and r["kind"].startswith("Customer"))]

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
		# the one role the account carries, from whichever family it belongs to
		account["role"] = next((name for name in ALL_ROLES if name in held), None)
		account["role_label"] = permissions.ROLE_LABELS.get(account["role"])
		account["roles"] = sorted(held.intersection(ALL_ROLES))
		account["desk_access"] = account.user_type == "System User"
		account["customers"] = frappe.get_all(
			"User Permission",
			filters={"user": email, "allow": "Customer"},
			pluck="for_value",
			order_by="for_value",
		)

		account["sign_ins"] = frappe.get_all(
			"Activity Log",
			filters={"user": email, "operation": ("in", ("Login", "Logout"))},
			fields=["operation", "status", "ip_address", "creation"],
			order_by="creation desc",
			limit=12,
		)

		from nexgen_msp.api.two_factor.services.two_factor_service import TwoFactorService

		account["two_factor"] = TwoFactorService.has_secret(email)
		account["is_self"] = email == frappe.session.user
		# nothing to invite someone to until the account carries a role
		account["can_invite"] = bool(account["role"])

		return account

	@staticmethod
	def _after_account_change(email):
		"""An account opened, re-roled or switched off can leave its company with nobody to
		act: our administrators hear of it."""
		if not permissions.is_customer_contact(email):
			return

		for customer in permissions.get_allowed_customers(email):
			approval.warn_admins_of_gaps(customer)

	@staticmethod
	def options():
		TeamService._guard()

		def choices(roles):
			return [{"value": role, "label": permissions.ROLE_LABELS[role]} for role in roles]

		return {
			"internal_roles": choices(INTERNAL_CHOICES),
			"customer_roles": choices(CUSTOMER_CHOICES),
			"roles": list(ALL_ROLES),
			"labels": dict(permissions.ROLE_LABELS),
			"kinds": [permissions.ROLE_LABELS[r] for r in ALL_ROLES] + ["No role"],
			"customers": frappe.get_all("Customer", pluck="name", order_by="name asc"),
		}

	@staticmethod
	def create_account(
		email=None, first_name=None, last_name=None, kind=None, role=None, customer=None, send_email=1
	):
		"""Open the one account a person signs in with.

		Everything that decides what they can reach is settled here and nowhere else: which
		side they are on, the single role that follows from it, and — for someone at a
		customer — the permission and the contact that say which company they answer for.

		A customer account without that link would be a role with nothing behind it, so the
		customer is required rather than filled in later.
		"""
		TeamService._guard()

		email = (email or "").strip().lower()

		if not email or "@" not in email:
			raise ValidationError("A valid email address is required.", "VALIDATION_ERROR")

		if not (first_name or "").strip():
			raise ValidationError("A first name is required.", "VALIDATION_ERROR")

		if kind not in ("internal", "customer"):
			raise ValidationError(
				"Say whether this is a Nexgen account or a customer account.", "VALIDATION_ERROR"
			)

		allowed = INTERNAL_CHOICES if kind == "internal" else CUSTOMER_CHOICES

		if role not in allowed:
			raise ValidationError(
				f"'{role}' is not a role a {kind} account can hold.", "VALIDATION_ERROR"
			)

		customer = (customer or "").strip() or None

		if kind == "customer":
			if not customer:
				raise ValidationError(
					"Choose the customer this account belongs to.", "VALIDATION_ERROR"
				)
			if not frappe.db.exists("Customer", customer):
				raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")
		else:
			customer = None

		if frappe.db.exists("User", email):
			raise ValidationError(
				f"{email} already has an account. Change its role instead.", "VALIDATION_ERROR"
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

		# the company first: a customer role is refused until the account is linked to one
		if customer:
			permissions.add_customer_permission(user.name, customer)
			permissions.ensure_customer_contact(user, customer)

		permissions.guard_single_family(user.name, role)

		user.append("roles", {"role": role})
		user.save(ignore_permissions=True)
		frappe.db.commit()

		if frappe.utils.cint(send_email):
			TeamService.send_invitation(user.name)

		TeamService._after_account_change(user.name)

		return TeamService.get_member(user.name)

	@staticmethod
	def send_invitation(email=None):
		"""Send, or resend, the link that lets a colleague set their password."""
		TeamService._guard()

		if not email or not frappe.db.exists("User", email):
			raise NotFoundError(f"User {email} not found.", "NOT_FOUND")

		from nexgen_msp.utils import notifications

		user = frappe.get_doc("User", email)
		held = set(frappe.get_roles(user.name))
		role = next((name for name in ALL_ROLES if name in held), None)

		if not role:
			raise ValidationError(
				f"{email} holds no role, so there is nothing to invite them to. "
				"Give the account a role first.",
				"VALIDATION_ERROR",
			)

		link = user._reset_password(send_email=False)

		# the two families read a different welcome: one is joining the team, the other is
		# being given access to their own company's portal
		internal = role in STAFF_ROLES
		template = "MSP Team Invitation" if internal else "MSP Portal Invitation"
		context = {
			"full_name": user.full_name or user.name,
			"role": permissions.ROLE_LABELS.get(role, role),
			"link": notifications.on_portal_host(link) if not internal else link,
		}

		if not internal:
			customers = permissions.get_allowed_customers(user.name)
			context["customer"] = customers[0] if customers else ""

		notifications.send(
			template,
			[user.name],
			context,
			reference_doctype="User",
			reference_name=user.name,
		)
		frappe.db.commit()

		return {"sent_to": user.name}

	@staticmethod
	def set_role(email=None, role=None):
		"""Move someone within their family. One role at a time, so what they can do is plain.

		Crossing families is refused, not performed: an account is a customer's or ours, and
		turning one into the other silently is how a contact ends up seeing every customer.
		"""
		TeamService._guard()

		if not email or not frappe.db.exists("User", email):
			raise NotFoundError(f"User {email} not found.", "NOT_FOUND")

		if role not in ALL_ROLES:
			raise ValidationError(f"'{role}' is not a role this application grants.", "VALIDATION_ERROR")

		permissions.guard_single_family(email, role)

		user = frappe.get_doc("User", email)
		user.set("roles", [row for row in user.roles if row.role not in ALL_ROLES])
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

		TeamService._after_account_change(email)

		return TeamService.list_members()
