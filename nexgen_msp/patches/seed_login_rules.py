"""Give every account that has a home today the rule that keeps it.

Destination used to be implied: whoever signed in on our login screen was carried into our
screens, which is why accounts holding nothing of ours ended up there. Rules make the
destination explicit, and this writes the two that describe the site as it already is —
not one document per person, two documents naming roles, so that giving or taking a role
moves somebody without anybody editing a rule.

  Nexgen MSP   /msp, priority 100, the four MSP roles. Higher than the desk on purpose: one
               of our administrators is a System User too, and must keep landing here
               without losing the desk access they already have.

  Frappe Desk  /desk, priority 10, the `Desk User` role Frappe hands every System User. It
               is what carries the people of other applications home instead of here.

  Administrator is named directly, as its own default. It holds every role on the site, so
  it matches both rules; its home has always been /msp and that is written down rather than
  arrived at.

Nothing here touches a User, a role, a contact, a permission or any commercial record.

**It cannot overwrite.** A rule already carrying one of these two names is left exactly as
it is, including its lines — an administrator's own wiring is not something a migration gets
to correct, and a replay must add nothing. The Administrator line is therefore written only
by the save that creates the rule.

**It refuses to finish quietly.** Before committing, the resolution of every enabled account
is simulated: any account allowed into this application today that would not land on /msp
stops the migration with the list, because the alternative is a deployment that locks people
out of the only place they have ever worked. Only once that simulation is clean does it throw
the switch that makes the login read these rules at all — and that switch is what an incident
turns back off, without deleting a rule or an assignment.
"""

import frappe

from nexgen_msp.api.core.services.login_rule_service import LoginRuleService
from nexgen_msp.utils import login_route_registry as routes

RULE = "Nexgen Login Rule"
LINE = "Nexgen Login Applicable User"

# the switch the login reads, thrown only once the postflight is clean
ROUTING_FLAG = "route_login_by_rules"

MSP_RULE = "Nexgen MSP"
DESK_RULE = "Frappe Desk"

ADMINISTRATOR = "Administrator"

MSP_ROLES = (
	"MSP Customer Manager",
	"MSP Customer Operator",
	"MSP Technician",
	"MSP System Admin",
)

# Frappe's own automatic role for a System User, which is how the desk rule reaches the
# people of every other application without naming any of them
DESK_ROLE = "Desk User"

SEEDS = (
	{
		"rule": MSP_RULE,
		"home_route": routes.MSP,
		"priority": 100,
		"roles": MSP_ROLES,
		"direct": ADMINISTRATOR,
	},
	{
		"rule": DESK_RULE,
		"home_route": routes.DESK,
		"priority": 10,
		"roles": (DESK_ROLE,),
		"direct": None,
	},
)


def execute():
	preflight()

	for seed in SEEDS:
		_seed(seed)

	# simulated before the commit, so a regression leaves the site exactly as it was
	postflight()

	route_by_rules()

	frappe.db.commit()


def route_by_rules():
	"""Turn the login over to the rules, now that the simulation has vouched for them.

	Written rather than defaulted: an existing site has no stored value for a field nobody
	has saved, and Frappe reads that absence as off. Leaving it implicit would mean the
	rules decided nothing until somebody happened to open the settings.
	"""
	frappe.db.set_single_value("MSP Portal Settings", ROUTING_FLAG, 1)

	print(f"  login now routed by rules ({ROUTING_FLAG} = 1)")


def preflight():
	"""Read the site and say what it is, before anything is written."""
	print("Login rules — preflight")
	print(f"  frappe {frappe.__version__}, desk at {routes.DESK}")

	for role in MSP_ROLES + (DESK_ROLE,):
		present = bool(frappe.db.exists("Role", role))
		print(f"  role {role:24} {'present' if present else 'MISSING'}")

	accounts = frappe.get_all("User", filters={"enabled": 1}, pluck="name")
	print(f"  enabled accounts: {len(accounts)}")

	for seed in SEEDS:
		existing = frappe.db.exists(RULE, seed["rule"])
		print(f"  rule {seed['rule']:14} {'already defined' if existing else 'to create'}")

	claimed = frappe.db.sql(
		"""
		select line.user, line.parent
		from `tabNexgen Login Applicable User` line
		where line.parenttype = %s and ifnull(line.`default`, 0) = 1
		""",
		RULE,
		as_dict=True,
	)

	for row in claimed:
		print(f"  direct default already set: {row.user} -> {row.parent}")


def _seed(seed):
	"""Write one rule, or leave the one that is already there completely alone."""
	if frappe.db.exists(RULE, seed["rule"]):
		print(f"  {seed['rule']}: already defined, untouched")
		return

	roles = [role for role in seed["roles"] if frappe.db.exists("Role", role)]
	missing = [role for role in seed["roles"] if role not in roles]

	for role in missing:
		print(f"  {seed['rule']}: role {role} does not exist here, left out")

	direct = seed["direct"] if seed["direct"] and not _claimed(seed["direct"]) else None

	if seed["direct"] and not direct:
		print(f"  {seed['rule']}: {seed['direct']} is already sent somewhere directly, left alone")

	if not roles and not direct:
		print(f"  {seed['rule']}: nothing left to name it with, not created")
		return

	doc = frappe.new_doc(RULE)
	doc.name = seed["rule"]
	doc.enabled = 1
	doc.home_route = seed["home_route"]
	doc.priority = seed["priority"]

	for role in roles:
		doc.append("applicable_roles", {"role": role})

	if direct:
		doc.append("applicable_users", {"user": direct, "default": 1})

	doc.insert(ignore_permissions=True)

	print(
		f"  {seed['rule']}: created, {seed['home_route']} at priority {seed['priority']},"
		f" {len(roles)} role(s){', ' + direct + ' direct' if direct else ''}"
	)


def _claimed(user):
	"""Whether some rule already sends this account somewhere as its default."""
	return bool(
		frappe.db.sql_list(
			"""
			select line.parent
			from `tabNexgen Login Applicable User` line
			where line.parenttype = %s
			  and line.user = %s
			  and ifnull(line.`default`, 0) = 1
			limit 1
			""",
			(RULE, user),
		)
	)


def postflight():
	"""Resolve every enabled account and refuse to ship a home that moved."""
	print("Login rules — postflight")

	landings = {}
	lost = []

	for user in frappe.get_all("User", filters={"enabled": 1}, pluck="name"):
		if user == "Guest":
			continue

		verdict = LoginRuleService.resolve_for_user(user)
		where = verdict["path"] if verdict["success"] else verdict["error"]
		landings[where] = landings.get(where, 0) + 1

		if routes.can_enter_msp(user) and verdict.get("path") != routes.MSP:
			lost.append((user, where))

	for where, count in sorted(landings.items(), key=lambda pair: -pair[1]):
		print(f"  {count:4} -> {where}")

	if not lost:
		print("  every account allowed into Nexgen MSP still lands there")
		return

	for user, where in lost:
		print(f"  REGRESSION {user} is allowed into Nexgen MSP but resolves to {where}")

	frappe.throw(
		f"{len(lost)} account(s) allowed into Nexgen MSP would no longer land there."
		" The rules have not been saved. Resolve the accounts listed above first."
	)
