"""Give every account that has a home today the rule that keeps it.

Destination used to be implied: whoever signed in on our login screen was carried into our
screens, which is why accounts holding nothing of ours ended up there. Rules make the
destination explicit, and this writes the two that describe the site as it already is —
not one document per person, two documents naming roles, so that giving or taking a role
moves somebody without anybody editing a rule.

  Nexgen MSP Portal    /msp, priority 100, the two customer roles. The people at our
                       customers, who read their own company and nothing else.

  Nexgen MSP Internal  /msp with the desk door open, priority 100, the two roles of our own
                       people. Split from the portal rule so that one population can be
                       moved without the other. Equal priority is not a tie here: an account
                       holds one side or the other, and one holding both is already refused
                       entry outright — being told two rules disagree is the right answer
                       for it.

  Frappe Desk          /desk, priority 10, the `Desk User` role Frappe hands every System
                       User. It is what carries the people of other applications home
                       instead of here. Lower than the two above on purpose: one of our
                       administrators is a System User too, and must keep landing in the
                       application rather than in the desk.

  Administrator is named directly on the internal rule, as its own default. It holds every
  role on the site, so it matches all three; its home has always been /msp and that is
  written down rather than arrived at.

  The desk door is open on the internal rule as well as on the desk rule, because our own
  administrators already reach the desk and must not lose it. It opens nothing for the
  technicians who share that rule: Frappe admits only a System User, so they are taken home
  instead — which is what the box is for, rather than a seat.

Nothing here touches a User, a role, a contact, a permission or any commercial record.

**It cannot overwrite.** A rule already carrying one of these names is left exactly as it
is, including its lines — an administrator's own wiring is not something a migration gets
to correct, and a replay must add nothing. The Administrator line is therefore written only
by the save that creates the rule.

The one exception is this patch's own earlier output. An earlier version made two rules, one
for all of our people and one for the desk, and neither carried the desk box because it did
not exist yet. Left standing, that desk rule now shuts the desk to every account whose only
home it is, and the combined rule ties with the two that replace it. So a rule matching that
earlier shape **to the letter** is stood down — renamed aside and switched off, never
deleted, so its history, its shares and anything referring to it survive and an operator can
read or restore it. One differing by a single field or line is not touched at all, and the
simulation below then reports whoever it strands.

**It refuses to finish quietly.** Two gates. The role the desk rule is built on has to
exist, because without it every System User of every other application would be left with
no home at all — and a missing role is a site this patch has not been written for, not
something to work around. Then, before committing, the resolution of every enabled account
is simulated in both directions: any account allowed into this application today that would
not land on /msp, and any desk account of another application that would not land on the
desk, stops the migration with the list, because the alternative is a deployment that locks people
out of the only place they have ever worked. Only once that simulation is clean does it throw
the switch that makes the login read these rules at all — and that switch is what an incident
turns back off, without deleting a rule or an assignment.
"""

import frappe
from frappe.utils import cint

from nexgen_msp.api.core.services.login_rule_service import LoginRuleService
from nexgen_msp.utils import login_route_registry as routes

RULE = "Nexgen Login Rule"
LINE = "Nexgen Login Applicable User"

# the switch the login reads, thrown only once the postflight is clean
ROUTING_FLAG = "route_login_by_rules"

PORTAL_RULE = "Nexgen MSP Portal"
INTERNAL_RULE = "Nexgen MSP Internal"
DESK_RULE = "Frappe Desk"

ADMINISTRATOR = "Administrator"

# the people at our customers
PORTAL_ROLES = ("MSP Customer Manager", "MSP Customer Operator")

# our own
INTERNAL_ROLES = ("MSP Technician", "MSP System Admin")

# Frappe's own automatic role for a System User, which is how the desk rule reaches the
# people of every other application without naming any of them
DESK_ROLE = "Desk User"

SEEDS = (
	{
		"rule": PORTAL_RULE,
		"home_route": routes.MSP,
		"priority": 100,
		"roles": PORTAL_ROLES,
		"direct": None,
		"desk": 0,
	},
	{
		"rule": INTERNAL_RULE,
		"home_route": routes.MSP,
		"priority": 100,
		"roles": INTERNAL_ROLES,
		"direct": ADMINISTRATOR,
		"desk": 1,
	},
	{
		"rule": DESK_RULE,
		"home_route": routes.DESK,
		"priority": 10,
		"roles": (DESK_ROLE,),
		"direct": None,
		"desk": 1,
	},
)


def execute():
	apply()

	frappe.db.commit()


def apply():
	"""Everything the migration does, up to but not including the commit.

	Separated so that it can be run inside a transaction and undone — the only honest way
	to exercise a migration against a site whose real configuration must survive the test.
	"""
	preflight()

	supersede_the_two_rule_shape()

	for seed in SEEDS:
		_seed(seed)

	# simulated before the caller commits, so a regression leaves the site exactly as it was
	postflight()

	route_by_rules()


# what the first version of this patch created, exactly. Anything differing from this by a
# single field or line is somebody's own work and is never touched
SUPERSEDED = {
	"Nexgen MSP": {
		"home_route": routes.MSP,
		"priority": 100,
		"enabled": 1,
		"desk_access": 0,
		"notes": "",
		"roles": sorted(PORTAL_ROLES + INTERNAL_ROLES),
		"users": [(ADMINISTRATOR, 1)],
	},
	DESK_RULE: {
		"home_route": routes.DESK,
		"priority": 10,
		"enabled": 1,
		"desk_access": 0,
		"notes": "",
		"roles": [DESK_ROLE],
		"users": [],
	},
}


STOOD_DOWN = "{0} (superseded)"


def supersede_the_two_rule_shape():
	"""Stand down the two rules this patch used to create, where nobody has touched them.

	Renamed and switched off rather than removed. A migration that deletes a document is a
	migration that can lose something it never looked at — a share, a note, the version
	history — and the only thing actually needed here is for the old rule to stop deciding
	and to stop holding a name the new ones need.

	Its direct claims go too, and that part is not optional. A direct default outranks every
	role and is read even on a rule that is switched off, by design: it is an explicit block.
	Left standing, the Administrator line of the old rule would answer for Administrator
	with `RULE_DISABLED` for ever, and the rule meant to replace it would step aside because
	the account already looked claimed. The line is kept, with its claim released.
	"""
	for name, shape in SUPERSEDED.items():
		if not frappe.db.exists(RULE, name):
			continue

		doc = frappe.get_doc(RULE, name)
		found = {
			"home_route": doc.home_route,
			"priority": cint(doc.priority),
			"enabled": cint(doc.enabled),
			"desk_access": cint(doc.desk_access),
			# a note somebody left on it is an edit like any other, and this promises not to
			# touch a rule that differs by anything at all
			"notes": (doc.notes or "").strip(),
			"roles": sorted(row.role for row in doc.applicable_roles),
			"users": sorted((row.user, cint(row.get("default"))) for row in doc.applicable_users),
		}

		if found == {**shape, "users": sorted(shape["users"])}:
			aside = STOOD_DOWN.format(name)

			if frappe.db.exists(RULE, aside):
				print(f"  {name}: already stood down once as {aside}, left alone")
				continue

			# switched off before the rename, so it stops deciding even if the rename fails
			frappe.db.set_value(RULE, name, "enabled", 0, update_modified=False)
			frappe.db.sql(
				"""
				update `tabNexgen Login Applicable User`
				set `default` = 0
				where parenttype = %s and parent = %s
				""",
				(RULE, name),
			)
			frappe.rename_doc(RULE, name, aside, force=True, show_alert=False)
			print(f"  {name}: this patch's earlier shape, switched off and kept as {aside}")
		else:
			# either already in its current shape, or edited since. Neither is this patch's
			# earlier output, and neither is this patch's to clear away
			print(f"  {name}: not the earlier shape, left exactly as it is")


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

	for role in PORTAL_ROLES + INTERNAL_ROLES + (DESK_ROLE,):
		present = bool(frappe.db.exists("Role", role))
		print(f"  role {role:24} {'present' if present else 'MISSING'}")

	# the desk rule is the only home the people of every other application have. Seeding it
	# without its role would leave them with none, so this is where the migration stops
	if not frappe.db.exists("Role", DESK_ROLE):
		frappe.throw(
			f"The role {DESK_ROLE} does not exist on this site, so no rule can carry the"
			" accounts of other applications to the desk. This framework version does not"
			" match what the login rules were written for; nothing has been changed."
		)

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
	doc.desk_access = seed["desk"]

	for role in roles:
		doc.append("applicable_roles", {"role": role})

	if direct:
		doc.append("applicable_users", {"user": direct, "default": 1})

	doc.insert(ignore_permissions=True)

	print(
		f"  {seed['rule']}: created, {seed['home_route']} at priority {seed['priority']},"
		f" {len(roles)} role(s){', ' + direct + ' direct' if direct else ''}"
		f"{', desk open' if seed['desk'] else ''}"
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

		if routes.can_enter_msp(user):
			if verdict.get("path") != routes.MSP:
				lost.append((user, where, "is allowed into Nexgen MSP"))

			continue

		# a desk account of another application: the desk rule is what carries it home, and
		# a site where it does not is a site this migration must not switch over
		if routes.can_enter_desk(user) and verdict.get("path") != routes.DESK:
			lost.append((user, where, "works in the desk and holds no role of ours"))

	for where, count in sorted(landings.items(), key=lambda pair: -pair[1]):
		print(f"  {count:4} -> {where}")

	if not lost:
		print("  every account allowed into Nexgen MSP still lands there")
		print("  every desk account of another application lands in the desk")
		return

	for user, where, why in lost:
		print(f"  REGRESSION {user} {why} but resolves to {where}")

	frappe.throw(
		f"{len(lost)} account(s) would no longer land where they work today. The rules have"
		" not been saved. Resolve the accounts listed above first."
	)
