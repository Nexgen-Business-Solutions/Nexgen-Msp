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

from nexgen_msp.utils import request_targets

ASSIGNMENT = "MSP Service Assignment"

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

TARGET_SQL = {"User": request_targets.line_person_sql, "Device": request_targets.line_device_sql}

# the operations that decide who holds a machine, and so cannot be asked twice at once
HOLDER_OPERATIONS = ("device.assign", "device.transfer", "device.repossess")


def operation_of(row):
	"""The operation a line asks for, whether it was written as a code or as an old action."""
	from nexgen_msp.utils import operations

	code = (row.get("operation_code") or "").strip() or operations.from_legacy_action(
		row.get("action")
	)

	return operations.get(code)


def is_device_operation(row):
	"""Whether this line is about a machine itself rather than a service on one."""
	definition = operation_of(row)

	return bool(definition) and definition["domain"] == "device"


def pending_holder_request(device, exclude=None):
	"""The request already asking for this machine to change hands, if there is one."""
	if not device:
		return None

	rows = frappe.db.sql_list(
		f"""
		select distinct sr.name
		from `tabMSP Request Line` srl
		join `tabMSP Request` sr on sr.name = srl.parent
		where {request_targets.line_of_device_sql("srl", "%(device)s")}
		  and srl.operation_code in %(holder)s
		  and sr.status in %(in_flight)s
		  and sr.name != %(exclude)s
		""",
		{
			"device": device,
			"holder": HOLDER_OPERATIONS,
			"in_flight": IN_FLIGHT_STATUSES,
			"exclude": exclude or "",
		},
	)

	return rows[0] if rows else None


def requested_subject_of(row):
	"""The Requested Client User a line is about, when its person is still to be created."""
	return row.get("requested_client_user") or row.get("requested_for_requested_client_user") or None


def subject_of(row):
	"""The person a line is really about, whichever way it reaches its target.

	A device service names the machine, not the holder, so the person would otherwise be
	lost the moment the scope turns to Device — and a request has to keep saying who it was
	raised for, even after the machine changes hands.
	"""
	if requested_subject_of(row):
		return None

	return row.get("requested_for_user") or row.get("client_user") or None


def subject_department(row):
	"""The department a line is about, for whoever has to agree to it.

	A line raised for somebody reads their department; one for a person who does not exist
	yet reads what the request itself says. A device line naming nobody has no department,
	and that is the answer, not a missing one.
	"""
	requested = requested_subject_of(row)

	if requested:
		return (
			frappe.db.get_value("MSP Requested Client User", requested, "department") or ""
		).strip() or None

	person = subject_of(row)

	if not person:
		return None

	return (frappe.db.get_value("MSP Client User", person, "department") or "").strip() or None


def allowed_actions(operational_status):
	"""What may still be asked of a service in this state, in the old vocabulary.

	Which acts a state allows is decided once, where the operations themselves are.
	"""
	from nexgen_msp.utils import operations

	return tuple(
		operations.REGISTRY[code]["legacy_action"]
		for code in operations.for_service_state(operational_status)
	)


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
		from `tabMSP Request Line` srl
		join `tabMSP Request` sr on sr.name = srl.parent
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
		from `tabMSP Request Line` srl
		join `tabMSP Request` sr on sr.name = srl.parent
		where sr.customer = %(customer)s
		  and srl.requested_service = %(service)s
		  and srl.action = 'Add'
		  and srl.target_scope = %(scope)s
		  and {TARGET_SQL[scope]("srl")} = %(target)s
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


HANDED_OVER = ("device.assign", "device.transfer")

ONE_DESTINATION = (
	"Two requested actions try to change the same target in incompatible ways. "
	"Review the highlighted actions."
)


def machine_of(row):
	"""The machine a line is about: the one on file or the requested one."""
	return row.get("managed_device") or row.get("requested_device")


def holder_wanted(row):
	"""Who a line hands a machine to: the person on file or the requested one."""
	return row.get("requested_holder") or row.get("requested_holder_requested_client_user")


def target_key(row):
	"""What a line acts on, whoever the line was raised for."""
	if row.get("target_scope") == "Device":
		target = ("machine", machine_of(row) or row.get("device_requirement_key"))
	else:
		target = ("person", row.get("client_user") or row.get("requested_client_user"))

	return (
		row.get("operation_code") or row.get("action"),
		row.get("requested_service"),
		target,
		row.get("source_service_assignment"),
	)


def handed_over(rows):
	"""The machines the lines hand over, each with the people it is handed to."""
	found = {}

	for row in rows:
		if (row.get("operation_code") or "") in HANDED_OVER and machine_of(row):
			found.setdefault(machine_of(row), set()).add(holder_wanted(row))

	return found


def machine_label(machine):
	"""What a machine is called, on file or requested."""
	return (
		frappe.db.get_value("MSP Managed Device", machine, "hostname")
		or frappe.db.get_value("MSP Requested Device", machine, "display_label")
		or machine
	)


def validate_one_destination(rows):
	"""Refuse a machine that the same request hands to two different people."""
	for machine, holders in handed_over(rows).items():
		if len(holders) > 1:
			frappe.throw(f"{machine_label(machine)}: {ONE_DESTINATION}")


def validate_subject(doc, row):
	"""Who the line is for: named, ours, and consistent with the target it carries."""
	if requested_subject_of(row):
		if row.get("requested_for_user") or row.get("client_user"):
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
		arriving = person in handed_over(doc.lines).get(row.managed_device, set())

		if holder and holder != person and not arriving:
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
	# a machine operation is read against the machine, not against a service on it, and that
	# reading happens where the operation is accepted and again before it is carried out
	if is_device_operation(row):
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
	if is_device_operation(row):
		if (row.get("operation_code") or "") in HOLDER_OPERATIONS:
			other = pending_holder_request(request_targets.device_of_line(row), exclude=doc.name)

			if other:
				frappe.throw(
					_("Row {0}: this Device already has a pending holder change in request {1}.").format(
						row.idx, other
					)
				)

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

	if row.target_scope == "User":
		target = request_targets.person_of_line(row)
	elif row.target_scope == "Device":
		target = request_targets.device_of_line(row)
	else:
		target = None

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


def subject_key(row):
	"""Which person a line is about: the key of its Requested Client User, or its Client User record."""
	requested = requested_subject_of(row)

	if requested:
		return frappe.db.get_value("MSP Requested Client User", requested, "subject_key")

	person = subject_of(row)

	if person:
		return f"user:{person}"

	provided = (row.get("subject_key") or "").strip()

	if provided and not provided.startswith("user:"):
		return provided

	return None


def device_requirement_key(row):
	"""Which machine a line needs: the key of its Requested Device, or its Managed Device record."""
	if row.get("requested_device"):
		return frappe.db.get_value("MSP Requested Device", row.get("requested_device"), "device_requirement_key")

	device = row.get("managed_device")

	return f"device:{device}" if device else None


def stamp_keys(doc):
	"""Give every line the two keys the execution plan groups its work by."""
	for row in doc.lines:
		row.subject_key = subject_key(row) or row.subject_key
		row.device_requirement_key = device_requirement_key(row) or row.device_requirement_key
