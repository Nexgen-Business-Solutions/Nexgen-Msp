"""What a request line may actually ask for, read against what the service is doing today.

A request line is an intention, not an instruction: it says what somebody wants changed, for
whom, and from when. Nothing here touches the operational record — that belongs to whoever
carries the work out afterwards. What these rules do is refuse an intention that could never
be carried out: resuming a service that is already running, adding one the target already
has, or asking two contradictory things of the same service in one breath.

The state a service is in is the Phase 2 record's own; this module only reads it.
"""

import frappe
from frappe import _

ASSIGNMENT = "MSP Service Assignment"

# what may be asked of a service, according to the life it is currently in
ALLOWED_ACTIONS = {
	"Draft": (),
	"Pending Setup": (),
	"Active": ("Change", "Suspend", "Remove"),
	"Suspended": ("Resume", "Remove"),
	"Pending Removal": (),
	"Ended": (),
	"Cancelled": (),
}

# the acts that work on a service already on file, and so have to name which one
ACTS_ON_EXISTING = ("Change", "Suspend", "Resume", "Remove")

# a service nobody holds can only be started
ACTS_ON_NOTHING = ("Add",)

# a request already on its way: a draft is nobody's business but its author's, so it never
# stands in anyone's way
IN_FLIGHT_STATUSES = (
	"Awaiting Customer Approval",
	"Submitted",
	"Under Review",
	"Approved",
	"In Progress",
)

TARGET_FIELD = {"User": "client_user", "Device": "managed_device"}


def subject_of(row):
	"""The person a line is really about, whichever way it reaches its target.

	A device service names the machine, not the holder, so the person would otherwise be
	lost the moment the scope turns to Device — and a request has to keep saying who it was
	raised for, even after the machine changes hands.
	"""
	if row.get("is_new_user"):
		return None

	return row.get("requested_for_user") or row.get("client_user") or None


def subject_department(row):
	"""The department a line is about, for whoever has to agree to it.

	A line raised for somebody reads their department; one for a person who does not exist
	yet reads what the request itself says. A device line naming nobody has no department,
	and that is the answer, not a missing one.
	"""
	if row.get("is_new_user"):
		return (row.get("new_user_department") or "").strip() or None

	person = subject_of(row)

	if not person:
		return None

	return (frappe.db.get_value("MSP Client User", person, "department") or "").strip() or None


def allowed_actions(operational_status):
	"""What may still be asked of a service in this state."""
	return ALLOWED_ACTIONS.get(operational_status, ())


def open_assignment_for(customer, service_item, scope, target):
	"""The service already running on this exact target, if there is one."""
	if scope not in TARGET_FIELD or not target:
		return None

	from nexgen_msp.utils.assignments import OPEN_ASSIGNMENT_STATUSES

	found = frappe.get_all(
		ASSIGNMENT,
		filters={
			"customer": customer,
			"service_item": service_item,
			"assignment_scope": scope,
			TARGET_FIELD[scope]: target,
			"operational_status": ("in", OPEN_ASSIGNMENT_STATUSES),
		},
		pluck="name",
		limit=1,
	)

	return found[0] if found else None


def in_flight_requests_for(assignment, exclude=None):
	"""Other requests already asking for something on this same service."""
	return frappe.db.sql_list(
		"""
		select distinct sr.name
		from `tabMSP Service Request Line` srl
		join `tabMSP Service Request` sr on sr.name = srl.parent
		where srl.source_service_assignment = %(assignment)s
		  and sr.status in %(in_flight)s
		  and sr.name != %(exclude)s
		""",
		{"assignment": assignment, "in_flight": IN_FLIGHT_STATUSES, "exclude": exclude or ""},
	)


def in_flight_additions_for(customer, service_item, scope, target, exclude=None):
	"""Another request already asking for this same service on this same target."""
	if scope not in TARGET_FIELD or not target:
		return []

	return frappe.db.sql_list(
		f"""
		select distinct sr.name
		from `tabMSP Service Request Line` srl
		join `tabMSP Service Request` sr on sr.name = srl.parent
		where sr.customer = %(customer)s
		  and srl.requested_service = %(service)s
		  and srl.action = 'Add'
		  and srl.target_scope = %(scope)s
		  and srl.`{TARGET_FIELD[scope]}` = %(target)s
		  and sr.status in %(in_flight)s
		  and sr.name != %(exclude)s
		""",
		{
			"customer": customer,
			"service": service_item,
			"scope": scope,
			"target": target,
			"in_flight": IN_FLIGHT_STATUSES,
			"exclude": exclude or "",
		},
	)


def validate_subject(doc, row):
	"""Who the line is for: named, ours, and consistent with the target it carries."""
	if row.get("is_new_user"):
		if row.get("requested_for_user"):
			frappe.throw(
				_("Row {0}: a new person cannot also be an existing one.").format(row.idx)
			)
		return

	person = row.get("requested_for_user")

	# a user line is about the person it targets: saying so twice must say the same thing
	if row.target_scope == "User" and row.get("client_user"):
		if person and person != row.client_user:
			frappe.throw(
				_("Row {0}: this line targets {1} but is said to be for {2}.").format(
					row.idx, frappe.bold(row.client_user), frappe.bold(person)
				)
			)

		row.requested_for_user = row.client_user
		return

	if not person:
		return

	owner = frappe.db.get_value("MSP Client User", person, "customer")

	if owner != doc.customer:
		frappe.throw(
			_("Row {0}: {1} belongs to customer {2}, not {3}.").format(
				row.idx, frappe.bold(person), frappe.bold(owner), frappe.bold(doc.customer)
			)
		)

	# the machine a line names has to be the one that person actually holds, or the request
	# was written about a state of the world that has since moved on
	if row.target_scope == "Device" and row.get("managed_device"):
		holder = frappe.db.get_value("MSP Managed Device", row.managed_device, "assigned_client_user")

		if holder and holder != person:
			frappe.throw(
				_("Row {0}: {1} is no longer held by {2}. Review the request before sending it.").format(
					row.idx,
					frappe.bold(
						frappe.db.get_value("MSP Managed Device", row.managed_device, "hostname")
						or row.managed_device
					),
					frappe.bold(
						frappe.db.get_value("MSP Client User", person, "full_name") or person
					),
				)
			)


def validate_action_against_state(doc, row):
	"""The act asked for has to be one the service could actually receive today."""
	if row.get("is_new_user"):
		return

	action = row.get("action")
	assignment = row.get("source_service_assignment")

	if action in ACTS_ON_EXISTING:
		if not assignment:
			frappe.throw(
				_("Row {0}: say which service is to be {1}.").format(row.idx, _(action.lower()))
			)

		current = frappe.db.get_value(
			ASSIGNMENT,
			assignment,
			["customer", "assignment_scope", "client_user", "managed_device", "operational_status", "service_item"],
			as_dict=True,
		)

		if not current:
			frappe.throw(_("Row {0}: service assignment {1} does not exist.").format(row.idx, assignment))

		if current.customer != doc.customer:
			frappe.throw(
				_("Row {0}: {1} belongs to another customer.").format(row.idx, frappe.bold(assignment))
			)

		field = TARGET_FIELD.get(row.target_scope)
		target = row.get(field) if field else None

		if field and target and current.get(field) != target:
			frappe.throw(
				_("Row {0}: {1} is not the service running on that target.").format(
					row.idx, frappe.bold(assignment)
				)
			)

		permitted = allowed_actions(current.operational_status)

		if action not in permitted:
			frappe.throw(
				_("Row {0}: {1} is {2}. {3} does not apply to a service in that state.").format(
					row.idx,
					frappe.bold(current.service_item),
					_(current.operational_status.lower()),
					_(action),
				)
			)

		return

	if action in ACTS_ON_NOTHING:
		if assignment:
			frappe.throw(
				_("Row {0}: adding a service does not act on one already there.").format(row.idx)
			)

		field = TARGET_FIELD.get(row.target_scope)
		target = row.get(field) if field else None

		if not target:
			return

		running = open_assignment_for(doc.customer, row.requested_service, row.target_scope, target)

		if running:
			frappe.throw(
				_("Row {0}: {1} is already running on that target ({2}).").format(
					row.idx, frappe.bold(row.requested_service), running
				)
			)


def validate_no_open_conflict(doc, row):
	"""One open request at a time may ask for something on the same service."""
	if row.get("is_new_user"):
		return

	assignment = row.get("source_service_assignment")

	if assignment:
		others = in_flight_requests_for(assignment, exclude=doc.name)

		if others:
			frappe.throw(
				_("Row {0}: {1} is already being changed by request {2}.").format(
					row.idx, frappe.bold(assignment), others[0]
				)
			)

		return

	if row.get("action") != "Add":
		return

	field = TARGET_FIELD.get(row.target_scope)
	target = row.get(field) if field else None

	if not target:
		return

	others = in_flight_additions_for(
		doc.customer, row.requested_service, row.target_scope, target, exclude=doc.name
	)

	if others:
		frappe.throw(
			_("Row {0}: {1} has already been asked for on that target by request {2}.").format(
				row.idx, frappe.bold(row.requested_service), others[0]
			)
		)


def validate_one_intent_per_service(doc):
	"""Two contradictory things cannot be asked of the same service in one request."""
	seen = {}

	for row in doc.lines:
		assignment = row.get("source_service_assignment")

		if not assignment:
			continue

		if assignment in seen:
			frappe.throw(
				_("Row {0}: row {1} already asks for something on that same service.").format(
					row.idx, seen[assignment]
				)
			)

		seen[assignment] = row.idx


def _slug(text):
	return " ".join((text or "").split()).casefold()


def subject_key(row):
	"""Which person a line is about, written so every line about them reads the same.

	The workbench works per person, not per line: one account is created for somebody the
	customer wrote once and asked three things for. The key is derived here rather than
	taken from the screen that raised the request, so it cannot drift — a person on file is
	their record, a person still to be created is the name the customer wrote.
	"""
	if row.get("is_new_user"):
		name = _slug(row.get("new_user_full_name"))

		return f"new-user:{name}" if name else None

	person = subject_of(row)

	return f"user:{person}" if person else None


def device_requirement_key(row):
	"""Which machine a line needs, or None when it needs none.

	Several device services asked for the same person go onto one machine, so they share a
	key and a single machine is provisioned for all of them.
	"""
	if row.get("is_new_device"):
		subject = subject_key(row)

		return f"new-device:{subject}" if subject else None

	device = row.get("managed_device")

	return f"device:{device}" if device else None


def stamp_keys(doc):
	"""Give every line the two keys the execution plan groups its work by."""
	for row in doc.lines:
		row.subject_key = subject_key(row)
		row.device_requirement_key = device_requirement_key(row)
