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



def _drop_contact_links(user, wanted):
	"""Leave the contact saying exactly what the administrator settled on."""
	for contact in frappe.get_all("Contact", filters={"user": user}, pluck="name"):
		doc = frappe.get_doc("Contact", contact)
		keep = [
			link
			for link in doc.links
			if link.link_doctype != "Customer" or link.link_name in wanted
		]

		if len(keep) == len(doc.links):
			continue

		doc.links = keep
		doc.save(ignore_permissions=True)


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
			order by u.creation desc
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

		account["access"] = TeamService.access_integrity(email)
		account["abilities"] = TeamService.abilities(email)
		account["two_factor"] = TwoFactorService.has_secret(email)
		account["is_self"] = email == frappe.session.user
		# nothing to invite someone to until the account carries a role
		account["can_invite"] = bool(account["role"])

		return account

	@staticmethod
	def abilities(email):
		"""What this account may actually do, asked of the rules themselves.

		Every line is the answer the application gives when the question is really put, for
		this very account, so a reader is never promised something the code would refuse.

		An account answers for one company, so everything below is said in the singular.
		"""
		from nexgen_msp.utils import access

		held = set(frappe.get_roles(email))
		role = next((name for name in ALL_ROLES if name in held), None)
		company = frappe.db.get_value(
			"User Permission", {"user": email, "allow": "Customer"}, "for_value"
		)
		staff = access.is_staff(email)

		def may(capability, **context):
			try:
				return bool(access.allows(capability, user=email, **context))
			except Exception:
				return False

		may_edit_profile = may("edit_customer_profile", customer=company)
		requests = [
			{
				"label": "Carry requests out",
				"allowed": may("execute_requests"),
				"detail": "Decide lines, prepare people and machines, run the work orders"
				if staff
				else "Carrying work out is ours; a customer asks and never executes",
			},
			{
				"label": "Register new people and machines while fulfilling",
				"allowed": may("execute_requests"),
			},
		]

		if role in permissions.CUSTOMER_ROLES:
			rights = approval.rights_of(company, email) if company else {}
			department = rights.get("department")
			requests = [
				{
					"label": "Raise requests from the portal",
					"allowed": bool(rights.get("can_submit")),
					"detail": "Named on the authority matrix"
					if rights.get("can_submit")
					else "Not named on the matrix, so nothing can be sent",
				},
				{
					"label": "Approve this company's requests",
					"allowed": bool(rights.get("can_approve")),
					"detail": (
						f"For the {department} Department only"
						if rights.get("can_approve") and department
						else "For the whole company"
						if rights.get("can_approve")
						else "Their own requests wait for somebody who may approve"
					),
				},
				*requests,
			]

		return {
			"role": role,
			"role_label": _classify(email, held),
			"family": permissions.family_of(role),
			"scope": "Every customer we serve"
			if staff
			else company or "No company — this account reaches nothing",
			"groups": [
				{
					"title": "Reach",
					"items": [
						{"label": "Read across every customer", "allowed": may("view_all_customers")},
						{
							"label": "Read every customer's people, machines, services and requests"
							if staff
							else "Read this company's people, machines, services and requests",
							"allowed": may("view_customer_operations", customer=company),
						},
						{
							"label": "Reach the Frappe desk",
							"allowed": frappe.db.get_value("User", email, "user_type")
							== "System User",
						},
					],
				},
				{"title": "Requests", "items": requests},
				{
					"title": "Commercial and money",
					"items": [
						{"label": "Add a customer", "allowed": may("create_customer")},
						{
							"label": "Change commercial terms",
							"allowed": may("edit_customer_commercial"),
						},
						{
							"label": "Change a customer's own details"
							if staff
							else "Change this company's own details",
							"allowed": may_edit_profile,
							"detail": "Address, contact details and departments"
							if may_edit_profile
							else None,
						},
						{"label": "Manage contracts", "allowed": may("manage_contracts")},
						{"label": "Manage pricing", "allowed": may("manage_pricing")},
						{
							"label": "Draw and issue billing runs",
							"allowed": bool(
								frappe.has_permission("MSP Billing Run", "create", user=email)
							),
						},
						{
							"label": "Read invoices",
							"allowed": role != permissions.CUSTOMER_OPERATOR_ROLE,
							"detail": "The one thing a Customer Operator is kept away from"
							if role == permissions.CUSTOMER_OPERATOR_ROLE
							else None,
						},
						{
							"label": "Manage accounts and portal access",
							"allowed": bool(held.intersection(permissions.MANAGE_ACCESS_ROLES))
							or email == "Administrator",
						},
						{"label": "Manage settings", "allowed": may("manage_settings")},
					],
				},
			],
		}

	@staticmethod
	def access_integrity(email):
		"""Whether a customer account's two Customer references agree, and what they hold.

		A customer role is a promise that the account answers for a company; this says
		whether the records behind that promise are there, were repaired, or disagree.
		"""
		outcome = permissions.reconcile_customer_permissions(email)

		return {
			"status": outcome["status"],
			"message": permissions.STATUS_TEXT.get(outcome["status"]),
			"customer_roles": outcome["customer_roles"],
			"internal_roles": outcome["internal_roles"],
			"contact_customers": outcome["contact_customers"],
			"permission_customers": outcome["permission_customers"],
			"added_contact_links": outcome["added_contact_links"],
			"added_permissions": outcome["added_permissions"],
			"removed_permissions": outcome["removed_permissions"],
		}

	@staticmethod
	def resolve_access_references(email=None, source=None, customers=None):
		"""Settle a disagreement an administrator has looked at.

		Nothing here is guessed: the administrator says which side is right, or names the
		companies themselves, and both references are written to say the same thing.
		"""
		TeamService._guard()

		if not email or not frappe.db.exists("User", email):
			raise NotFoundError("This application account no longer exists.", "NOT_FOUND")

		held = permissions.held_roles(email)

		if held["internal"] and held["customer"]:
			raise ValidationError(permissions.STATUS_TEXT[permissions.ROLE_FAMILY_CONFLICT], "ROLE_FAMILY_CONFLICT")

		if not held["customer"]:
			raise ValidationError(
				"This account holds no customer role, so it answers for no Customer.",
				"NOT_CUSTOMER_ACCOUNT",
			)

		if source == "contact":
			wanted = permissions.customers_from_contacts(email)
		elif source == "permission":
			wanted = permissions.customer_permissions_of(email)
		else:
			wanted = set(frappe.parse_json(customers) if isinstance(customers, str) else (customers or []))

		wanted = {name for name in wanted if name}

		if not wanted:
			raise ValidationError(
				"Choose at least one Customer for this customer account.", "VALIDATION_ERROR"
			)

		for customer in sorted(wanted):
			if not frappe.db.exists("Customer", customer):
				raise NotFoundError(f'Customer "{customer}" no longer exists.', "NOT_FOUND")

		user_doc = frappe.get_doc("User", email)

		for customer in sorted(wanted):
			permissions.ensure_customer_contact(user_doc, customer)
			permissions.add_customer_permission(email, customer)

		for row in frappe.get_all(
			"User Permission", filters={"user": email, "allow": "Customer"}, fields=["name", "for_value"]
		):
			if row.for_value not in wanted:
				frappe.delete_doc("User Permission", row.name, ignore_permissions=True)

		approval.withdraw_from_elsewhere(email, wanted)
		_drop_contact_links(email, wanted)
		frappe.db.commit()

		return TeamService.get_member(email)

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

		# the account is only opened once both references agree
		if customer:
			health = permissions.reconcile_customer_permissions(user.name)

			if health["status"] not in (permissions.HEALTHY, *permissions.REPAIRED):
				frappe.db.rollback()

				raise ValidationError(
					permissions.STATUS_TEXT.get(health["status"], "Customer access could not be established."),
					health["status"],
				)

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
