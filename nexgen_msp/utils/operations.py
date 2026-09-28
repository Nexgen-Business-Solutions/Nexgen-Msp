"""Every business operation Nexgen MSP can be asked to perform, written in code.

These used to live in a table an administrator could edit, which meant the engine's own
behaviour could be renamed, reordered or deleted from a settings screen. What a request may
ask for is not configuration: it is what the domain services can actually do, and it belongs
where that is decided.

A code names one operation. The label is what a person reads, the description what the
choice means, and the two flags say who may ask for it: a customer from the portal, or a
technician adding work while executing.
"""

import frappe

SERVICE = "service"
DEVICE = "device"
CLIENT_USER = "client_user"

# the acts on a service already on file, and the one that opens a new one
SERVICE_OPERATIONS = {
	"service.add": {
		"label": "Add service",
		"description": "Add this service to the selected person or Device.",
		"customer_requestable": True,
		"technician_addable": True,
		"legacy_action": "Add",
	},
	"service.change": {
		"label": "Change service",
		"description": "Change the running service terms from the requested date.",
		"customer_requestable": True,
		"technician_addable": True,
		"legacy_action": "Change",
	},
	"service.suspend": {
		"label": "Suspend service",
		"description": "Temporarily stop this service without ending its assignment.",
		"customer_requestable": True,
		"technician_addable": True,
		"legacy_action": "Suspend",
	},
	"service.resume": {
		"label": "Resume service",
		"description": "Resume a currently suspended service.",
		"customer_requestable": True,
		"technician_addable": True,
		"legacy_action": "Resume",
	},
	"service.end": {
		"label": "End service",
		"description": (
			"Request that this service permanently stop on the selected date. "
			"The service remains visible in history after it ends."
		),
		"customer_requestable": True,
		"technician_addable": True,
		"legacy_action": "Remove",
	},
}

DEVICE_OPERATIONS = {
	"device.assign": {
		"label": "Assign device",
		"description": "Request that this Device be assigned to a person.",
		"customer_requestable": True,
		"technician_addable": True,
	},
	"device.transfer": {
		"label": "Change holder",
		"description": "Request that this Device be transferred to another person.",
		"customer_requestable": True,
		"technician_addable": True,
	},
	"device.repossess": {
		"label": "Return to stock",
		"description": "Request that this Device be returned to stock and have no current holder.",
		"customer_requestable": True,
		"technician_addable": True,
	},
	"device.retire": {
		"label": "Retire device",
		"description": "Take this Device out of the active fleet.",
		"customer_requestable": False,
		"technician_addable": True,
	},
	"device.reinstate": {
		"label": "Reinstate device",
		"description": "Bring this Device back into the active fleet.",
		"customer_requestable": False,
		"technician_addable": True,
	},
	"device.register": {
		"label": "Register device",
		"description": "Put a new Device on file for this customer.",
		"customer_requestable": False,
		"technician_addable": True,
	},
}

INTERNAL_OPERATIONS = {
	"client_user.create": {
		"label": "Create Client User",
		"description": "Put the person on file so the work asked for them can be carried out.",
		"customer_requestable": False,
		"technician_addable": False,
	},
}


def _domain(code):
	return code.split(".", 1)[0]


REGISTRY = {}

for source in (SERVICE_OPERATIONS, DEVICE_OPERATIONS, INTERNAL_OPERATIONS):
	for code, definition in source.items():
		REGISTRY[code] = {
			"code": code,
			"domain": _domain(code),
			"target_scope": {"service": None, "device": "Device", "client_user": "User"}[_domain(code)],
			**definition,
		}

# what the old table called these acts, and what they are now
LEGACY_SERVICE_ACTIONS = {
	definition["legacy_action"]: code
	for code, definition in REGISTRY.items()
	if definition.get("legacy_action")
}

# what a Work Order used to call the work it carried
LEGACY_WORK_ACTIONS = {
	"Create User": "client_user.create",
	"Register Device": "device.register",
	"Assign Device": "device.assign",
	"Transfer Device": "device.transfer",
	"Add": "service.add",
	"Change": "service.change",
	"Suspend": "service.suspend",
	"Resume": "service.resume",
	"Remove": "service.end",
}

# what a Work Order used to call the work it carries, for the machine operations that had one
WORK_ACTION_OF = {
	code: action
	for action, code in LEGACY_WORK_ACTIONS.items()
	if code.startswith(f"{DEVICE}.")
}

# which operations a Device in this state can actually take
DEVICE_CAPABILITIES = {
	"Stock": ("device.assign", "device.retire"),
	"Pending": ("device.assign", "device.retire"),
	"Active": ("device.transfer", "device.repossess", "device.retire"),
	"Returned": ("device.assign", "device.retire"),
	"Damaged": ("device.reinstate", "device.retire"),
	"Lost": ("device.reinstate", "device.retire"),
	"Retired": ("device.reinstate",),
}

# and which a service in this state can take
SERVICE_CAPABILITIES = {
	"Active": ("service.change", "service.suspend", "service.end"),
	"Suspended": ("service.resume", "service.end"),
	"Pending Setup": (),
	"Ended": (),
	"Cancelled": (),
}


def get(code):
	"""One operation, or nothing if the code is not one of ours."""
	return REGISTRY.get((code or "").strip())


def require(code):
	"""The operation, refusing a code this application does not perform."""
	from nexgen_msp.utils.errors import ValidationError

	definition = get(code)

	if not definition:
		raise ValidationError(f'"{code}" is not a supported MSP operation.', "UNKNOWN_OPERATION")

	return definition


def require_customer_requestable(code):
	definition = require(code)

	if not definition["customer_requestable"]:
		from nexgen_msp.utils.errors import ValidationError

		raise ValidationError(
			"This operation cannot be requested from the customer portal.",
			"OPERATION_NOT_REQUESTABLE",
		)

	return definition


def label(code):
	definition = get(code)

	return definition["label"] if definition else code


def offered(codes):
	"""The registry entries for these codes, as a screen reads them."""
	return [
		{
			"code": code,
			"label": REGISTRY[code]["label"],
			"description": REGISTRY[code]["description"],
		}
		for code in codes
		if code in REGISTRY
	]


def customer_requestable(domain=None):
	return [
		code
		for code, definition in REGISTRY.items()
		if definition["customer_requestable"] and (domain is None or definition["domain"] == domain)
	]


def for_service_state(status):
	"""What may be asked of a service in this state."""
	return list(SERVICE_CAPABILITIES.get(status, ()))


def for_device_state(status):
	"""What may be asked of a Device in this state."""
	return list(DEVICE_CAPABILITIES.get(status, ()))


def from_legacy_action(action):
	"""The operation an old service line's action means."""
	return LEGACY_SERVICE_ACTIONS.get(action)


def work_action(code):
	"""What a Work Order carrying this operation is called in the old vocabulary, if anything."""
	return WORK_ACTION_OF.get(code)


def from_legacy_work(action):
	"""The operation an old Work Order's action means."""
	return LEGACY_WORK_ACTIONS.get(action)


# What a request made of one family of service acts is called. The family name on the line is
# the one it has always had, because that is what the line's own `action` field holds; the
# request above it says what was actually asked for, and ending a service is not removing one.
REQUEST_TYPE_OF_FAMILY = {"Remove": "End"}


def request_type_of(rows, asked=None):
	"""What a request made of these lines is called.

	One family of service operations keeps the name that family has always had; lines about
	machines make it a Device request, and a mix of both is Mixed.
	"""
	if asked == "Billing Dispute":
		return asked

	codes = []

	for row in rows:
		code = (row.get("operation_code") or "").strip() or from_legacy_action(row.get("action"))

		if code in REGISTRY:
			codes.append(code)

	domains = {REGISTRY[code]["domain"] for code in codes}

	if not domains:
		return asked

	if domains == {DEVICE}:
		return "Device"

	if domains != {SERVICE}:
		return "Mixed"

	families = {REQUEST_TYPE_OF_FAMILY.get(
		REGISTRY[code]["legacy_action"], REGISTRY[code]["legacy_action"]
	) for code in codes}

	return families.pop() if len(families) == 1 else "Mixed"


def snapshot_device(device):
	"""What the Device looked like when somebody asked for a change to it."""
	card = frappe.db.get_value(
		"MSP Managed Device",
		device,
		["status", "assigned_client_user", "hostname", "serial_number"],
		as_dict=True,
	)

	if not card:
		return {}

	return {
		"device_status": card.status,
		"current_holder": card.assigned_client_user,
		"hostname": card.hostname,
		"serial_number": card.serial_number,
	}
