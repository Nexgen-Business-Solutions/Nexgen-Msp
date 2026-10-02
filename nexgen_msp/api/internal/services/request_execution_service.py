"""The work an approved request turns into, and the order it can be carried out in.

A request says what the customer wants. This turns it into the work that grants it, and it
is the only thing the technician's screen talks to. It orchestrates and records; it decides
nothing about services, devices or people — those rules live in the lifecycle services and
are called, never reimplemented.

Building the plan twice must produce the same plan: every work order carries a plan key
derived from the request and the grouping it stands for, and that key is unique in the
table, so two technicians opening the request at the same moment cannot double it.
"""

import frappe

from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.service_definition_service import ServiceDefinitionService
from nexgen_msp.utils import identifiers, operations, request_intents, request_targets
from nexgen_msp.utils.errors import NotFoundError, ValidationError

WORK_ORDER = "MSP Work Order"
REQUESTED_CLIENT_USER = "MSP Requested Client User"
REQUESTED_DEVICE = "MSP Requested Device"

SERVICE_ACTION = "Service Action"
USER_SETUP = "User Setup"
DEVICE_PROVISIONING = "Device Provisioning"
DEVICE_OPERATION = "Device Operation"
CONTEXT_ACTION = "Context Action"

RETIRED_WORK_TYPES = (USER_SETUP, DEVICE_PROVISIONING)

HOLDER_CHANGES = ("device.assign", "device.transfer")

# the request has been decided and the work may exist
PLANNABLE_STATUSES = ("Approved", "In Progress", "Completed")

WORKABLE_STATUSES = tuple(status for status in PLANNABLE_STATUSES if status != "Completed")

REVIEWABLE_STATUSES = ("Under Review",) + WORKABLE_STATUSES

# work that is over, one way or another
FINISHED_STATUSES = ("Completed", "Cancelled")

DONE_STATUSES = ("Completed", "Awaiting Verification")

PRIMARY_ACTION_LABELS = {
	"service.add": "Add service",
	"service.end": "End service",
	"service.suspend": "Suspend service",
	"service.resume": "Resume service",
	"service.change": "Change service",
	"device.transfer": "Change holder",
	"device.repossess": "Return to stock",
	"device.assign": "Assign Device",
}

PREREQUISITE_LABELS = {
	"prepare_person": "Prepare person",
	"prepare_holder": "Prepare new holder",
	"prepare_device": "Prepare Device",
	"complete_device_information": "Complete Device information",
	"complete_username": "Complete username",
	"complete_serial": "Complete serial number",
}

DEPENDENCY_LABELS = {
	"requested_client_user": "Requested Client User must be resolved",
	"requested_holder": "Requested holder must be resolved",
	"requested_device": "Requested Device must be resolved",
	"username": "Username required",
	"serial_number": "Serial number required",
}

PREPARATION_OF = {
	"requested_client_user": "prepare_person",
	"requested_holder": "prepare_holder",
	"requested_device": "prepare_device",
	"username": "complete_username",
	"serial_number": "complete_serial",
}

DEPENDENCY_OWNER_LABELS = {
	"requested_client_user": "Client User",
	"requested_holder": "New holder",
	"requested_device": "Device",
}

COMPLETION_REFUSAL = "This Request cannot be completed while accepted work remains unresolved."

NOBODY = "Unassigned"


class _Reading:
	"""What a plan reads about the people, machines and Requested entities of one request, read once."""

	def __init__(self, doc):
		self.doc = doc
		self.lines = {row.name: row for row in doc.lines}
		self.people = {
			row.name: row
			for row in frappe.get_all(
				REQUESTED_CLIENT_USER,
				filters={"request": doc.name},
				fields=[
					"name", "subject_key", "full_name", "department", "username", "status",
					"resolved_client_user", "resolution_mode", "resolved_by", "resolved_at", "modified",
					"cancel_reason", "cancelled_by", "cancelled_at",
				],
				order_by="creation asc",
			)
		}
		self.machines = {
			row.name: row
			for row in frappe.get_all(
				REQUESTED_DEVICE,
				filters={"request": doc.name},
				fields=[
					"name", "device_requirement_key", "display_label", "hostname", "serial_number",
					"device_type", "status", "resolved_managed_device", "resolution_mode",
					"resolved_by", "resolved_at", "requested_snapshot_json", "modified",
					"cancel_reason", "cancelled_by", "cancelled_at",
				],
				order_by="creation asc",
			)
		}
		self._client_users = {}
		self._devices = {}

	def client_user(self, name):
		"""One Client User's card, read once."""
		if not name:
			return None

		if name not in self._client_users:
			self._client_users[name] = frappe.db.get_value(
				"MSP Client User",
				name,
				["name", "full_name", "department", "email", "username", "lifecycle_status", "modified"],
				as_dict=True,
			)

		return self._client_users[name]

	def device(self, name):
		"""One Managed Device's card, read once."""
		if not name:
			return None

		if name not in self._devices:
			self._devices[name] = frappe.db.get_value(
				"MSP Managed Device",
				name,
				["name", "hostname", "serial_number", "device_type", "status", "assigned_client_user", "modified"],
				as_dict=True,
			)

		return self._devices[name]

	def resolved_person(self, requested):
		"""The Client User a Requested Client User resolved to, if it did."""
		row = self.people.get(requested)

		return row.resolved_client_user if row and row.status == "Resolved" else None

	def resolved_device(self, requested):
		"""The Managed Device a Requested Device resolved to, if it did."""
		row = self.machines.get(requested)

		return row.resolved_managed_device if row and row.status == "Resolved" else None

	def person_of_key(self, subject_key):
		"""The Requested Client User standing for a subject key."""
		return next((row for row in self.people.values() if subject_key and row.subject_key == subject_key), None)

	def machine_of_key(self, key):
		"""The Requested Device standing for a device requirement key."""
		return next((row for row in self.machines.values() if key and row.device_requirement_key == key), None)

	def person_label(self, client_user=None, requested=None):
		"""Who a Client User or a Requested Client User is, by name."""
		card = self.client_user(client_user or self.resolved_person(requested))

		if card:
			return card.full_name

		row = self.people.get(requested)

		return row.full_name if row else None


class RequestExecutionService:
	# ------------------------------------------------------------------ building
	@staticmethod
	def build_execution_plan(request=None):
		"""Create the work an approved request calls for, once and only once."""
		RequestService._guard_internal()

		doc = RequestExecutionService._request(request)

		if doc.status not in PLANNABLE_STATUSES:
			raise ValidationError(
				f"A request in status '{doc.status}' has no work to carry out yet.",
				"INVALID_TRANSITION",
			)

		for row in doc.lines:
			if row.line_status != "Approved":
				continue

			if request_intents.is_device_operation(row):
				RequestExecutionService._plan_device_operation(doc, row)
			else:
				RequestExecutionService._plan_service_action(doc, row)

		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(doc.name)

	@staticmethod
	def _plan_device_operation(doc, row):
		"""A line asking something of the machine itself, on the machine or the Requested Device it names."""
		if not (row.managed_device or row.requested_device):
			return

		device = request_targets.resolve_device_target(row.managed_device, row.requested_device)
		holder = request_targets.resolve_holder_target(
			row.requested_holder, row.requested_holder_requested_client_user
		)

		RequestExecutionService._work_order(
			doc,
			plan_key=f"{doc.name}:operation:{row.name}",
			work_type=DEVICE_OPERATION,
			action_group_key=row.action_group_key,
			action=operations.work_action(row.operation_code),
			operation_code=row.operation_code,
			target_scope="Device",
			subject_key=row.subject_key,
			device_requirement_key=row.device_requirement_key,
			managed_device=device["resolved"],
			requested_device=row.requested_device,
			requested_holder=holder["resolved"],
			requested_holder_requested_client_user=row.requested_holder_requested_client_user,
			effective_date=row.requested_effective_date,
			request_line_name=row.name,
			request_line_idx=row.idx,
		)

	@staticmethod
	def _plan_service_action(doc, row):
		"""One approved line, one act on one service."""
		on_device = row.target_scope == "Device" or bool(row.managed_device or row.requested_device)

		if on_device:
			device = request_targets.resolve_device_target(row.managed_device, row.requested_device)
			person = {"resolved": None}
		else:
			device = {"resolved": None}
			person = request_targets.resolve_client_user_target(row.client_user, row.requested_client_user)

		RequestExecutionService._work_order(
			doc,
			plan_key=f"{doc.name}:service:{row.name}",
			work_type=SERVICE_ACTION,
			action_group_key=row.action_group_key,
			action=row.action,
			operation_code=row.operation_code or operations.from_legacy_action(row.action),
			target_scope="Device" if on_device else row.target_scope,
			subject_key=row.subject_key,
			device_requirement_key=row.device_requirement_key,
			client_user=person["resolved"],
			requested_client_user=None if on_device else row.requested_client_user,
			managed_device=device["resolved"],
			requested_device=row.requested_device if on_device else None,
			service_item=row.requested_service,
			source_service_assignment=row.source_service_assignment,
			effective_date=row.requested_effective_date,
			request_line_name=row.name,
			request_line_idx=row.idx,
		)

	@staticmethod
	def _work_order(doc, plan_key, **fields):
		"""The work order this grouping stands for, created the first time and read after.

		Two technicians can open the same request in the same second. The plan key is unique
		in the table, so the loser of that race reads the row the winner wrote rather than
		writing a second one.
		"""
		existing = frappe.db.get_value(WORK_ORDER, {"plan_key": plan_key}, "name")

		if existing:
			return existing

		savepoint = "work_order_plan"
		frappe.db.savepoint(savepoint)

		try:
			order = frappe.get_doc(
				{
					"doctype": WORK_ORDER,
					"plan_key": plan_key,
					"request": doc.name,
					"customer": doc.customer,
					"status": "Open",
					**fields,
				}
			).insert(ignore_permissions=True)
		except frappe.DuplicateEntryError:
			frappe.db.rollback(save_point=savepoint)

			return frappe.db.get_value(WORK_ORDER, {"plan_key": plan_key}, "name")

		return order.name

	# ------------------------------------------------------------------ reading
	@staticmethod
	def get_execution_plan(request=None):
		"""The whole of the work, read act by act, person by person, and by what it still waits on."""
		from nexgen_msp.api.internal.services.requested_entity_presentation import (
			RequestedEntityPresentation,
		)

		RequestService._guard_internal()

		doc = RequestExecutionService._request(request)
		orders = RequestExecutionService._orders(doc.name)
		reading = _Reading(doc)
		requirements = {
			order.name: RequestExecutionService._requirements_of(order, reading) for order in orders
		}
		cards = {
			order.name: RequestExecutionService._card(order, reading, requirements[order.name])
			for order in orders
		}
		people = RequestExecutionService._people(doc, orders, reading)
		recap = RequestExecutionService._recap(doc, orders, people, reading)

		return {
			"request": doc.name,
			"customer": doc.customer,
			"status": doc.status,
			"context": RequestExecutionService._context(doc, orders),
			"stages": RequestExecutionService._stages(doc, orders),
			"action_groups": RequestExecutionService._action_groups(doc, orders, cards),
			"requested_entities": RequestedEntityPresentation.for_request(doc.name),
			"preparation": RequestExecutionService._preparation(reading, requirements),
			"people": people,
			"requirements": RequestExecutionService._requirement_summary(requirements),
			"recap": recap,
			"outcome": RequestExecutionService._outcome(doc, orders, recap, reading),
			"rejected": [
				{
					"idx": row.idx,
					"service": frappe.db.get_value("Item", row.requested_service, "item_name")
					or row.requested_service,
					"reason": row.rejection_reason,
				}
				for row in doc.lines
				if row.line_status == "Rejected"
			],
			"summary": RequestExecutionService._summary(orders),
			"activity": RequestExecutionService._activity(doc, orders),
		}

	@staticmethod
	def _orders(request):
		orders = frappe.get_all(
			WORK_ORDER,
			filters={"request": request},
			fields=[
				"name",
				"plan_key",
				"work_type",
				"origin",
				"technician_reason",
				"activity_label",
				"action",
				"operation_code",
				"override_reason",
				"requested_holder",
				"requested_holder_requested_client_user",
				"state_snapshot",
				"status",
				"target_scope",
				"subject_key",
				"action_group_key",
				"device_requirement_key",
				"request_line_name",
				"request_line_idx",
				"client_user",
				"requested_client_user",
				"managed_device",
				"requested_device",
				"service_item",
				"source_service_assignment",
				"effective_date",
				"execution_notes",
				"customer_visible_note",
				"failure_reason",
				"completed_by",
				"completed_at",
				"resulting_assignment",
				"resulting_client_user",
				"resulting_device",
			],
			order_by="request_line_idx asc, creation asc",
		)

		if not orders:
			return orders

		# one query for all of them: a plan of thirty work orders is not thirty round trips
		labels = {
			row.name: row.item_name
			for row in frappe.get_all(
				"Item",
				filters={"name": ("in", [order.service_item for order in orders if order.service_item] or [""])},
				fields=["name", "item_name"],
			)
		}
		checklists = {}

		for row in frappe.get_all(
			"MSP Work Order Checklist Item",
			filters={"parent": ("in", [order.name for order in orders])},
			fields=["name", "parent", "idx", "step", "is_done", "note"],
			order_by="parent asc, idx asc",
		):
			checklists.setdefault(row.parent, []).append(row)

		for order in orders:
			order["service_name"] = labels.get(order.service_item) or order.service_item
			order["action_label"] = operations.label(order.operation_code) if order.operation_code else None
			order["checklist"] = checklists.get(order.name, [])

		return orders

	@staticmethod
	def _operation(order):
		"""The operation a work order carries out, whatever vocabulary it was written in."""
		return order.operation_code or operations.from_legacy_work(order.action)

	@staticmethod
	def _person_target(order, reading):
		"""The Client User a person-scoped work order acts on, once there is one."""
		return order.resulting_client_user or order.client_user or reading.resolved_person(
			RequestExecutionService._requested_person(order, reading)
		)

	@staticmethod
	def _device_target(order, reading):
		"""The Managed Device a machine-scoped work order acts on, once there is one."""
		return order.resulting_device or order.managed_device or reading.resolved_device(
			RequestExecutionService._requested_machine(order, reading)
		)

	@staticmethod
	def _holder_target(order, reading):
		"""The Client User a holder change hands the machine to, once there is one."""
		return order.requested_holder or reading.resolved_person(order.requested_holder_requested_client_user)

	@staticmethod
	def _requested_person(order, reading):
		if order.requested_client_user:
			return order.requested_client_user

		if order.work_type == USER_SETUP:
			row = reading.person_of_key(order.subject_key)
			return row.name if row else None

		return None

	@staticmethod
	def _requested_machine(order, reading):
		if order.requested_device:
			return order.requested_device

		if order.work_type == DEVICE_PROVISIONING:
			row = reading.machine_of_key(order.device_requirement_key)
			return row.name if row else None

		return None

	@staticmethod
	def _dependencies(order, reading):
		"""The Requested entities a work order waits on, in the order they are to be prepared."""
		found = []

		for kind, requested, rows in (
			("requested_device", RequestExecutionService._requested_machine(order, reading), reading.machines),
			("requested_client_user", RequestExecutionService._requested_person(order, reading), reading.people),
			("requested_holder", order.requested_holder_requested_client_user, reading.people),
		):
			row = rows.get(requested) if requested else None

			if row and row.status != "Resolved":
				found.append({"kind": kind, "requested": requested, "cancelled": row.status == "Cancelled"})

		return found

	@staticmethod
	def _username_owner(order, reading):
		"""Whose username a service is issued against: a Client User, or a Requested Client User still to resolve."""
		if order.target_scope != "Device":
			person = RequestExecutionService._person_target(order, reading)

			if person:
				return "MSP Client User", reading.client_user(person)

			requested = reading.people.get(order.requested_client_user)

			return (REQUESTED_CLIENT_USER, requested) if requested else (None, None)

		device = reading.device(RequestExecutionService._device_target(order, reading))

		if device and device.assigned_client_user:
			return "MSP Client User", reading.client_user(device.assigned_client_user)

		line = reading.lines.get(order.request_line_name)

		if line and line.requested_for_user:
			return "MSP Client User", reading.client_user(line.requested_for_user)

		if line and line.requested_for_requested_client_user:
			resolved = reading.resolved_person(line.requested_for_requested_client_user)

			if resolved:
				return "MSP Client User", reading.client_user(resolved)

			requested = reading.people.get(line.requested_for_requested_client_user)

			return (REQUESTED_CLIENT_USER, requested) if requested else (None, None)

		return None, None

	@staticmethod
	def _requirements_of(order, reading):
		"""The requirements of one work order, in the shape every screen reads."""
		needed = []

		if order.status in FINISHED_STATUSES + ("Awaiting Verification",) or order.work_type == CONTEXT_ACTION:
			return needed

		for dependency in RequestExecutionService._dependencies(order, reading):
			if dependency["cancelled"]:
				continue

			kind = dependency["kind"]
			on_machine = kind == "requested_device"
			row = (reading.machines if on_machine else reading.people)[dependency["requested"]]
			needed.append(
				{
					"key": f"{kind}:{row.name}",
					"kind": kind,
					"blocking": True,
					"satisfied": False,
					"owner_type": REQUESTED_DEVICE if on_machine else REQUESTED_CLIENT_USER,
					"owner_name": row.name,
					"owner_label": row.display_label if on_machine else row.full_name,
					"owner_department": None if on_machine else row.department,
					"owner_modified": str(row.modified or ""),
					"subject_key": None if on_machine else row.subject_key,
					"label": DEPENDENCY_OWNER_LABELS[kind],
					"current_value": None,
					"reason": DEPENDENCY_LABELS[kind],
					"can_batch_edit": False,
				}
			)

		if order.work_type != SERVICE_ACTION or order.operation_code not in ("service.add", "service.change"):
			return needed

		on_device = order.target_scope == "Device"

		if not on_device or ServiceDefinitionService.scope_of(order.service_item) == "Both":
			owner_type, owner = RequestExecutionService._username_owner(order, reading)

			if owner:
				needed.append(
					{
						"key": f"username:{owner.name}",
						"kind": "username",
						"blocking": True,
						"satisfied": bool((owner.username or "").strip()),
						"owner_type": owner_type,
						"owner_name": owner.name,
						"owner_label": owner.full_name,
						"label": "Username",
						"current_value": owner.username,
						"owner_department": owner.department,
						"owner_modified": str(owner.modified or ""),
						"subject_key": owner.get("subject_key"),
						"reason": "This service is issued against the person's username.",
						"can_batch_edit": True,
					}
				)

		if not on_device:
			return needed

		device = reading.device(RequestExecutionService._device_target(order, reading))
		requested = None if device else reading.machines.get(order.requested_device)
		owner = device or requested

		if owner:
			needed.append(
				{
					"key": f"serial:{owner.name}",
					"kind": "serial_number",
					"blocking": True,
					"satisfied": bool((owner.serial_number or "").strip()),
					"owner_type": "MSP Managed Device" if device else REQUESTED_DEVICE,
					"owner_name": owner.name,
					"owner_label": (owner.hostname or owner.name) if device else owner.display_label,
					"label": "Serial number",
					"current_value": owner.serial_number,
					"owner_department": None,
					"owner_modified": str(owner.modified or ""),
					"reason": "A Device-scoped service is issued against the machine's serial.",
					"can_batch_edit": True,
				}
			)

		return needed

	@staticmethod
	def _display(order, requirements, dependencies):
		"""What a work order's row says: its status, the preparation it waits on, and why."""
		if order.status in DONE_STATUSES:
			return "Completed", None, None

		if order.status in ("Cancelled", "Failed", "Blocked"):
			return order.status, None, None

		if any(dependency["cancelled"] for dependency in dependencies):
			return "Blocked", None, request_targets.CANCELLED_TARGET

		if dependencies:
			first = dependencies[0]
			kind = PREPARATION_OF[first["kind"]]

			return (
				"Waiting for prerequisite",
				{"kind": kind, "label": PREREQUISITE_LABELS[kind], "requested_entity": first["requested"]},
				DEPENDENCY_LABELS[first["kind"]],
			)

		missing = next(
			(
				row
				for row in requirements
				if not row["satisfied"] and row["kind"] in ("username", "serial_number")
			),
			None,
		)

		if missing:
			kind = PREPARATION_OF[missing["kind"]]

			return (
				"Needs information",
				{
					"kind": kind,
					"label": PREREQUISITE_LABELS[kind],
					"requested_entity": missing["owner_name"]
					if missing["owner_type"] in (REQUESTED_CLIENT_USER, REQUESTED_DEVICE)
					else None,
				},
				DEPENDENCY_LABELS[missing["kind"]],
			)

		return "Ready", None, None

	@staticmethod
	def _on_machine(order):
		return order.target_scope == "Device" or order.work_type in (DEVICE_OPERATION, DEVICE_PROVISIONING)

	@staticmethod
	def _relationship(order, reading):
		"""Who holds the machine and who is to hold it, for a work order that changes its holder."""
		code = RequestExecutionService._operation(order)

		if order.work_type != DEVICE_OPERATION or code not in HOLDER_CHANGES + ("device.repossess",):
			return None

		snapshot = frappe.parse_json(order.state_snapshot) if order.state_snapshot else {}
		device = reading.device(RequestExecutionService._device_target(order, reading))
		before = snapshot.get("current_holder") if snapshot else (device.assigned_client_user if device else None)
		from_label = reading.person_label(before) if before else None

		if code == "device.repossess":
			return {"from_label": from_label, "to_label": "Stock", "to_is_new": False, "note": None}

		holder = RequestExecutionService._holder_target(order, reading)
		requested = reading.people.get(order.requested_holder_requested_client_user)
		to_is_new = bool(not holder and requested and requested.status == "Open")

		return {
			"from_label": from_label,
			"to_label": reading.person_label(holder, order.requested_holder_requested_client_user) or NOBODY,
			"to_is_new": to_is_new,
			"note": None,
		}

	@staticmethod
	def _target(order, reading, relationship):
		"""What a work order acts on, as its row names it."""
		if RequestExecutionService._on_machine(order):
			requested = RequestExecutionService._requested_machine(order, reading)
			device = reading.device(RequestExecutionService._device_target(order, reading))

			if relationship:
				sublabel = f"{relationship['from_label'] or NOBODY} → {relationship['to_label']}"
			else:
				person = RequestExecutionService._machine_person(order, reading)
				sublabel = f"requested for {person}" if person else None

			if device:
				return {
					"kind": "managed_device",
					"name": device.name,
					"requested_entity": requested,
					"label": device.hostname or device.name,
					"sublabel": sublabel,
					"badge": None,
				}

			row = reading.machines.get(requested)

			return {
				"kind": "requested_device",
				"name": None,
				"requested_entity": requested,
				"label": row.display_label if row else "Device",
				"sublabel": sublabel,
				"badge": "UNRESOLVED" if row else None,
			}

		requested = RequestExecutionService._requested_person(order, reading)

		if order.work_type == CONTEXT_ACTION and not requested:
			person = RequestExecutionService._subject_person(order.subject_key, reading)
			requested = None if person else (reading.person_of_key(order.subject_key) or {}).get("name")
		else:
			person = RequestExecutionService._person_target(order, reading)

		card = reading.client_user(person)

		if card:
			return {
				"kind": "client_user",
				"name": card.name,
				"requested_entity": requested,
				"label": card.full_name,
				"sublabel": card.department,
				"badge": None,
			}

		row = reading.people.get(requested)

		return {
			"kind": "requested_client_user",
			"name": None,
			"requested_entity": requested,
			"label": row.full_name if row else "Client User",
			"sublabel": row.department if row else None,
			"badge": "NEW" if row else None,
		}

	@staticmethod
	def _subject_person(subject_key, reading):
		"""The Client User a subject key names, directly or through the person it resolved to."""
		if not subject_key:
			return None

		if subject_key.startswith("user:"):
			return subject_key.split(":", 1)[1]

		row = reading.person_of_key(subject_key)

		return reading.resolved_person(row.name) if row else None

	@staticmethod
	def _machine_person(order, reading):
		"""Who a machine was asked for, by name."""
		line = reading.lines.get(order.request_line_name)

		if line and (line.requested_for_user or line.requested_for_requested_client_user):
			return reading.person_label(line.requested_for_user, line.requested_for_requested_client_user)

		device = reading.device(RequestExecutionService._device_target(order, reading))

		if device and device.assigned_client_user:
			return reading.person_label(device.assigned_client_user)

		return None

	@staticmethod
	def _replacement(order):
		"""The service a change moves onto, when its line asked for another one."""
		if RequestExecutionService._operation(order) != "service.change":
			return None

		if not (order.source_service_assignment and order.service_item):
			return None

		current = frappe.db.get_value(
			"MSP Service Assignment", order.source_service_assignment, "service_item"
		)

		return order.service_item if current and current != order.service_item else None

	@staticmethod
	def _card(order, reading, requirements):
		"""One unit of work, with everything the technician needs to carry it out in place."""
		dependencies = RequestExecutionService._dependencies(order, reading)
		status, prerequisite, dependency = RequestExecutionService._display(
			order, requirements, dependencies
		)
		relationship = RequestExecutionService._relationship(order, reading)
		code = RequestExecutionService._operation(order)
		row = reading.lines.get(order.request_line_name)

		card = dict(order)
		card["requirements"] = requirements
		card["ready"] = status == "Ready"
		card["waiting_on"] = dependency if status == "Waiting for prerequisite" else None

		if row:
			card["comment"] = row.comment
			card["requested_quantity"] = row.requested_quantity

		requested_machine = reading.machines.get(RequestExecutionService._requested_machine(order, reading))

		if requested_machine:
			asked = frappe.parse_json(requested_machine.requested_snapshot_json or "{}") or {}
			card["asked_hostname"] = asked.get("hostname") or asked.get("display_label")
			card["asked_serial"] = asked.get("serial_number")
			card["asked_device_type"] = asked.get("device_type")

		if order.work_type == DEVICE_OPERATION:
			card.update(RequestExecutionService._holder_facts(order, row))
			card["requested_holder_name"] = card.get("requested_holder_name") or reading.person_label(
				None, order.requested_holder_requested_client_user
			)

		card["device"] = RequestExecutionService._device_card(
			RequestExecutionService._device_target(order, reading)
		)
		card["current"] = RequestExecutionService._current_service(order)
		card["service_scope"] = (
			RequestService._service_scope(order.service_item) if order.service_item else None
		)
		card["action_label"] = order.action_label or RequestExecutionService._action_labels().get(
			order.action, order.action
		)
		replacement = RequestExecutionService._replacement(order)
		card["replacement_service"] = replacement
		card["replacement_service_name"] = (
			frappe.db.get_value("Item", replacement, "item_name") or replacement if replacement else None
		)
		card["display_status"] = status
		card["target"] = RequestExecutionService._target(order, reading, relationship)
		card["relationship"] = relationship
		card["primary_action"] = {
			"operation_code": code or "",
			"label": PRIMARY_ACTION_LABELS.get(code)
			or (operations.label(code) if code else None)
			or order.activity_label
			or order.work_type,
			"enabled": status == "Ready" and order.work_type in (SERVICE_ACTION, DEVICE_OPERATION),
		}
		card["prerequisite_action"] = prerequisite
		card["dependency_label"] = dependency

		return card

	@staticmethod
	def _requirement_summary(requirements):
		"""The same requirements, gathered per record, so nothing is typed twice.

		This is what the batch dialogs read: one row per person missing a username, one per
		machine missing a serial, each naming the work that is waiting on it.
		"""
		gathered = {}

		for work_order, rows in requirements.items():
			for row in rows:
				if row["satisfied"]:
					continue

				row.setdefault("subject_key", None)
				row.setdefault("work_order", None)

				entry = gathered.setdefault(
					row["key"],
					{
						**{key: value for key, value in row.items() if key != "key"},
						"key": row["key"],
						"work_orders": [],
					},
				)
				entry["work_orders"].append(work_order)

		return sorted(gathered.values(), key=lambda row: (row["kind"], row["owner_label"] or ""))

	@staticmethod
	def _preparation(reading, requirements):
		"""The request-wide preparation still to do, counted once per record."""
		owed = [row for rows in requirements.values() for row in rows if not row["satisfied"]]

		return {
			"new_people": len([row for row in reading.people.values() if row.status == "Open"]),
			"unresolved_devices": len([row for row in reading.machines.values() if row.status == "Open"]),
			"missing_usernames": len({row["key"] for row in owed if row["kind"] == "username"}),
			"missing_serials": len({row["key"] for row in owed if row["kind"] == "serial_number"}),
		}

	@staticmethod
	def _machine_label(reading, machine):
		card = reading.device(machine)

		return (card.hostname or card.serial_number or machine) if card else machine

	@staticmethod
	def _people(doc, orders, reading):
		"""Every person the accepted work is for, in the order the request speaks of them."""
		keys = [row.subject_key for row in doc.get("subjects") or [] if row.subject_key]

		for row in doc.lines:
			if row.subject_key and row.subject_key not in keys:
				keys.append(row.subject_key)

		work = [order for order in orders if order.work_type in (SERVICE_ACTION, DEVICE_OPERATION)]

		for order in work:
			if order.subject_key and order.subject_key not in keys:
				keys.append(order.subject_key)

		people = []

		machines = {
			row.subject_key: row.managed_device
			for row in doc.get("subjects") or []
			if row.subject_key and row.get("managed_device")
		}
		# a machine the request is having made has no record to name yet, so it is read by
		# the label the customer gave it
		wanted = {
			row.subject_key: row.requested_device
			for row in doc.get("subjects") or []
			if row.subject_key and row.get("requested_device") and not row.get("managed_device")
		}

		for key in keys:
			requested = reading.person_of_key(key) if not key.startswith("user:") else None
			mine = [
				order
				for order in work
				if order.subject_key == key
				or (requested and order.requested_holder_requested_client_user == requested.name)
			]

			if not mine:
				continue

			client_user = RequestExecutionService._subject_person(key, reading)
			card = reading.client_user(client_user)
			# a subject nobody holds is the machine itself, and it is read by its hostname
			machine = machines.get(key)
			asked = reading.machines.get(wanted[key]) if key in wanted else None
			label = (
				card.full_name
				if card
				else requested.full_name
				if requested
				else RequestExecutionService._machine_label(reading, machine)
				if machine
				else (asked.display_label or asked.name)
				if asked
				else key
			)

			people.append(
				{
					"subject_key": key,
					"full_name": label,
					"department": card.department if card else (requested.department if requested else None),
					"is_new": bool(requested),
					"client_user": client_user,
					"managed_device": machine,
					"requested_device": wanted.get(key),
					"requested_client_user": requested.name if requested else None,
					"total": len(mine),
					"remaining": len(
						[order for order in mine if order.status not in DONE_STATUSES + ("Cancelled",)]
					),
				}
			)

		return people

	@staticmethod
	def _action_groups(doc, orders, cards):
		"""The same work, read act by act: what the customer asked for, and what is left to do.

		This is a second reading of one set of Work Orders, never a second set. The technician
		works through twenty additions at once or through one person at a time, and both views
		answer from the same records — so a target completed in one is completed in the other.
		"""
		named = {
			row.group_key: row for row in doc.get("action_groups") or []
		}
		by_group = {}

		for order in orders:
			if order.work_type in RETIRED_WORK_TYPES:
				continue

			by_group.setdefault(order.action_group_key or "", []).append(order)

		groups = []

		for key, mine in by_group.items():
			asked = named.get(key)
			work = [cards[order.name] for order in mine]
			counted, shown = {}, {}

			for card in work:
				counted[card["status"]] = counted.get(card["status"], 0) + 1
				shown[card["display_status"]] = shown.get(card["display_status"], 0) + 1

			groups.append(
				{
					"group_key": key or None,
					"operation_code": asked.operation_code if asked else None,
					"label": (
						asked.operation_label_snapshot
						if asked
						else "Additional technician actions"
						if not key
						else "Legacy grouped action"
					),
					"scope_label": asked.source_scope_label if asked else None,
					"origin": "Customer" if asked else "Technician",
					"total": len(work),
					"target_count": len(work),
					"remaining": len(
						[card for card in work if card["display_status"] not in ("Completed", "Cancelled")]
					),
					"completed": shown.get("Completed", 0),
					"ready": shown.get("Ready", 0),
					"needs_information": shown.get("Needs information", 0),
					"waiting_for_prerequisite": shown.get("Waiting for prerequisite", 0),
					"failed": shown.get("Failed", 0),
					"blocked": shown.get("Blocked", 0),
					"by_status": counted,
					"by_display_status": shown,
					"work": work,
				}
			)

		# the customer's own acts first, in the order they asked for them
		order_of = {row.group_key: index for index, row in enumerate(doc.get("action_groups") or [])}

		return sorted(groups, key=lambda row: order_of.get(row["group_key"], 999))

	@staticmethod
	def _context(doc, orders):
		"""What the technician keeps in view at every step: who asked, for when, and what they said."""
		dates = sorted(
			str(row.requested_effective_date) for row in doc.lines if row.requested_effective_date
		)
		return {
			"customer": doc.customer,
			"requester": doc.requester,
			"requester_name": frappe.db.get_value("User", doc.requester, "full_name")
			if doc.requester
			else None,
			"raised_at": doc.creation,
			"requested_date": str(doc.requested_date) if doc.get("requested_date") else dates[0] if dates else None,
			"priority": doc.priority,
			"people": len({row.subject_key for row in doc.lines if row.subject_key}),
			"lines": len(doc.lines),
			"details": doc.details,
			"customer_approved": bool(doc.customer_approved_by) or doc.source == "Internal",
		}

	@staticmethod
	def _recap(doc, orders, people, reading):
		"""What was actually performed, read from the work orders that performed it.

		Nothing here is remembered by the screen: reload the page and the same recap comes
		back, because it is the record of the work and not a summary of the session.
		"""
		names = {row["subject_key"]: row["full_name"] for row in people}
		departments = {row["subject_key"]: row["department"] for row in people}

		for row in reading.people.values():
			names.setdefault(row.subject_key, row.full_name)
			departments.setdefault(row.subject_key, row.department)

		action_labels = RequestExecutionService._action_labels()
		who = {}

		entries = []

		for order in orders:
			if order.status not in ("Completed", "Awaiting Verification"):
				continue

			if order.work_type == USER_SETUP and reading.resolved_person(
				RequestExecutionService._requested_person(order, reading)
			):
				continue

			if order.work_type == DEVICE_PROVISIONING and reading.resolved_device(
				RequestExecutionService._requested_machine(order, reading)
			):
				continue

			if order.completed_by and order.completed_by not in who:
				who[order.completed_by] = (
					frappe.db.get_value("User", order.completed_by, "full_name") or order.completed_by
				)

			if order.work_type == USER_SETUP:
				kind = "object"
				title = "Client User created"
				detail = order.resulting_client_user or ""
			elif order.work_type == DEVICE_PROVISIONING:
				kind = "object"
				device = RequestExecutionService._device_card(order.resulting_device) or {}
				title = "Device prepared"
				detail = " · ".join(
					part for part in (device.get("hostname"), device.get("serial_number")) if part
				)
			elif order.work_type == DEVICE_OPERATION:
				kind = "technician" if order.origin == "Technician" else "requested"
				title, detail = RequestExecutionService._device_operation_recap(order)
			elif order.work_type == CONTEXT_ACTION:
				kind = "technician"
				title = order.activity_label or "Record updated"
				detail = order.execution_notes or ""
			else:
				kind = "technician" if order.origin == "Technician" else "requested"
				title = f"{order.service_name} · {order.action_label or action_labels.get(order.action, order.action)}"
				target = (
					(RequestExecutionService._device_card(order.managed_device) or {}).get("hostname")
					if order.target_scope == "Device"
					else order.client_user
				)
				detail = f"{order.target_scope} scope" + (f" · {target}" if target else "")

			entries.append(
				{
					"work_order": order.name,
					"subject_key": order.subject_key,
					# the act the customer asked for, so the recap can be read either way
					"action_group_key": order.action_group_key,
					"subject": names.get(order.subject_key),
					"department": departments.get(order.subject_key),
					"kind": kind,
					"title": title,
					"detail": detail,
					"reason": order.override_reason or order.technician_reason,
					"at": order.completed_at,
					"by": who.get(order.completed_by),
				}
			)

		return (
			entries
			+ RequestExecutionService._resolutions(reading, names, departments)
			+ RequestExecutionService._cancellations(doc, orders, reading, names, departments)
			+ RequestExecutionService._direct_acts(doc, orders, names, departments, reading)
		)

	@staticmethod
	def _resolutions(reading, names, departments):
		"""Each Requested entity that was resolved, as the recap reads it."""
		entries = []

		for row in reading.people.values():
			if row.status != "Resolved":
				continue

			entries.append(
				{
					"work_order": row.name,
					"subject_key": row.subject_key,
					"action_group_key": None,
					"subject": names.get(row.subject_key) or row.full_name,
					"department": departments.get(row.subject_key) or row.department,
					"kind": "object",
					"title": "Client User created"
					if row.resolution_mode == "Create New"
					else "Existing Client User selected",
					"detail": reading.person_label(row.resolved_client_user) or row.resolved_client_user,
					"reason": None,
					"at": row.resolved_at,
					"by": frappe.db.get_value("User", row.resolved_by, "full_name") or row.resolved_by,
				}
			)

		for row in reading.machines.values():
			if row.status != "Resolved":
				continue

			device = reading.device(row.resolved_managed_device) or {}
			entries.append(
				{
					"work_order": row.name,
					"subject_key": None,
					"action_group_key": None,
					"subject": None,
					"department": None,
					"kind": "object",
					"title": "Device registered"
					if row.resolution_mode == "Register New"
					else "Existing Device selected",
					"detail": " · ".join(
						part for part in (device.get("hostname"), device.get("serial_number")) if part
					),
					"reason": None,
					"at": row.resolved_at,
					"by": frappe.db.get_value("User", row.resolved_by, "full_name") or row.resolved_by,
				}
			)

		return entries

	@staticmethod
	def _cancellations(doc, orders, reading, names, departments):
		"""Each Requested entity that was cancelled, with its reason and the work that went with it."""
		labels = {row.group_key: row.operation_label_snapshot for row in doc.get("action_groups") or []}
		entries = []

		def went_with(fields, name):
			said = []

			for order in orders:
				if order.status != "Cancelled" or order.work_type in RETIRED_WORK_TYPES:
					continue

				if not any(order.get(field) == name for field in fields):
					continue

				label = labels.get(order.action_group_key) or order.action_label or order.service_name or order.work_type

				if label not in said:
					said.append(label)

			return ", ".join(said)

		for kind, rows, fields in (
			("client_user", reading.people, ("requested_client_user", "requested_holder_requested_client_user")),
			("device", reading.machines, ("requested_device",)),
		):
			for row in rows.values():
				if row.status != "Cancelled":
					continue

				person = kind == "client_user"
				entries.append(
					{
						"work_order": row.name,
						"subject_key": row.subject_key if person else None,
						"action_group_key": None,
						"subject": (names.get(row.subject_key) or row.full_name) if person else None,
						"department": (departments.get(row.subject_key) or row.department) if person else None,
						"kind": "cancelled",
						"title": "Requested Client User cancelled" if person else "Requested Device cancelled",
						"detail": went_with(fields, row.name),
						"reason": row.cancel_reason,
						"at": row.cancelled_at,
						"by": frappe.db.get_value("User", row.cancelled_by, "full_name") or row.cancelled_by,
					}
				)

		return entries

	DEVICE_OPERATION_TITLE = {
		"device.assign": "Device assigned",
		"device.transfer": "Device holder changed",
		"device.repossess": "Device returned to stock",
		"device.retire": "Device retired",
		"device.reinstate": "Device reinstated",
	}

	@staticmethod
	def _device_operation_recap(order):
		"""What was done to the machine, and to whom, read back from the work order itself."""
		snapshot = frappe.parse_json(order.state_snapshot) if order.state_snapshot else {}
		hostname = snapshot.get("hostname") or (
			frappe.db.get_value("MSP Managed Device", order.managed_device, "hostname")
			or order.managed_device
		)
		title = RequestExecutionService.DEVICE_OPERATION_TITLE.get(
			order.operation_code, operations.label(order.operation_code)
		)

		before = RequestExecutionService._holder_name(snapshot.get("current_holder"))
		after = RequestExecutionService._holder_name(order.resulting_client_user)

		if order.operation_code in ("device.assign", "device.transfer", "device.repossess"):
			detail = f"{hostname} · {before or 'Unassigned'} → {after or 'Unassigned'}"
		else:
			detail = hostname

		if order.override_reason and order.requested_holder:
			requested = RequestExecutionService._holder_name(order.requested_holder)
			detail += f"\nRequested: {requested}\nExecuted: {after or 'Unassigned'}"

		return title, detail

	@staticmethod
	def _direct_acts(doc, orders, names, departments, reading):
		"""What was done straight from a person's menu while this request was open.

		Those acts go through the same lifecycle doors as everything else and cite the request
		on the service's own history; that citation is what brings them into the recap. Acts
		that carried out one of the work orders are already there and are not repeated.
		"""
		handled = {
			name
			for order in orders
			for name in (order.resulting_assignment, order.source_service_assignment)
			if name
		}
		subject_of = {}

		for row in doc.lines:
			if row.subject_key and row.client_user:
				subject_of[row.client_user] = row.subject_key

		for order in orders:
			if order.subject_key and order.resulting_client_user:
				subject_of[order.resulting_client_user] = order.subject_key

		for row in reading.people.values():
			if row.resolved_client_user:
				subject_of.setdefault(row.resolved_client_user, row.subject_key)

		acts = []

		for comment in frappe.get_all(
			"Comment",
			filters={
				"comment_type": "Comment",
				"reference_doctype": "MSP Service Assignment",
				"content": ("like", f"%in reference to {doc.name}%"),
			},
			fields=["name", "reference_name", "content", "owner", "creation"],
			order_by="creation asc",
		):
			if comment.reference_name in handled:
				continue

			assignment = frappe.db.get_value(
				"MSP Service Assignment",
				comment.reference_name,
				["service_item", "client_user", "managed_device", "assignment_scope"],
				as_dict=True,
			)

			if not assignment:
				continue

			person = assignment.client_user or frappe.db.get_value(
				"MSP Managed Device", assignment.managed_device, "assigned_client_user"
			)
			subject = subject_of.get(person)
			verb = (comment.content or "").split(" by ", 1)[0]

			acts.append(
				{
					"work_order": comment.name,
					"subject_key": subject,
					# done beside the request rather than asked for: it belongs to no act
					"action_group_key": None,
					"subject": names.get(subject)
					or frappe.db.get_value("MSP Client User", person, "full_name"),
					"department": departments.get(subject),
					"kind": "technician",
					"title": f"{frappe.db.get_value('Item', assignment.service_item, 'item_name') or assignment.service_item} · {verb}",
					"detail": f"{assignment.assignment_scope} scope",
					"reason": None,
					"at": comment.creation,
					"by": frappe.db.get_value("User", comment.owner, "full_name") or comment.owner,
				}
			)

		for opened in frappe.get_all(
			"MSP Service Assignment",
			filters={"source_request": doc.name, "name": ("not in", list(handled) or [""])},
			fields=["name", "service_item", "client_user", "managed_device", "assignment_scope", "owner", "creation"],
			order_by="creation asc",
		):
			person = opened.client_user or frappe.db.get_value(
				"MSP Managed Device", opened.managed_device, "assigned_client_user"
			)
			subject = subject_of.get(person)
			acts.append(
				{
					"work_order": opened.name,
					"subject_key": subject,
					"action_group_key": None,
					"subject": names.get(subject)
					or frappe.db.get_value("MSP Client User", person, "full_name"),
					"department": departments.get(subject),
					"kind": "technician",
					"title": f"{frappe.db.get_value('Item', opened.service_item, 'item_name') or opened.service_item} · Opened",
					"detail": f"{opened.assignment_scope} scope",
					"reason": None,
					"at": opened.creation,
					"by": frappe.db.get_value("User", opened.owner, "full_name") or opened.owner,
				}
			)

		return acts

	@staticmethod
	def _outcome(doc, orders, recap, reading):
		"""The figures the final validation reads: what was decided, and what was done."""
		work = [order for order in orders if order.work_type != CONTEXT_ACTION]
		requested = [
			order
			for order in work
			if order.origin != "Technician" and order.work_type in (SERVICE_ACTION, DEVICE_OPERATION)
		]
		additional = [entry for entry in recap if entry["kind"] == "technician"]
		people = [row for row in reading.people.values() if row.status != "Cancelled"]
		machines = [row for row in reading.machines.values() if row.status != "Cancelled"]
		people_resolved = len([row for row in people if row.status == "Resolved"])
		machines_resolved = len([row for row in machines if row.status == "Resolved"])

		return {
			"accepted": len([row for row in doc.lines if row.line_status == "Approved"]),
			"rejected": len([row for row in doc.lines if row.line_status == "Rejected"]),
			"requested_done": len([order for order in requested if order.status in DONE_STATUSES]),
			"requested_cancelled": len([order for order in requested if order.status == "Cancelled"]),
			"unresolved_accepted": len(
				[order for order in work if order.status not in DONE_STATUSES + ("Cancelled",)]
			),
			"technician_added": len(additional)
			+ len(
				[
					order
					for order in work
					if order.origin == "Technician" and order.status not in DONE_STATUSES
				]
			),
			"technician_done": len(additional),
			"prepared": people_resolved + machines_resolved,
			"context_done": len(
				[o for o in orders if o.work_type == CONTEXT_ACTION and o.status in DONE_STATUSES]
			),
			"requested_client_users_total": len(people),
			"requested_client_users_resolved": people_resolved,
			"requested_devices_total": len(machines),
			"requested_devices_resolved": machines_resolved,
			"requested_client_users_cancelled": len(
				[row for row in reading.people.values() if row.status == "Cancelled"]
			),
			"requested_devices_cancelled": len(
				[row for row in reading.machines.values() if row.status == "Cancelled"]
			),
		}

	@staticmethod
	def _action_labels():
		"""What each kind of act is called, from the operations this application performs."""
		return {
			definition["legacy_action"]: definition["label"]
			for definition in operations.REGISTRY.values()
			if definition.get("legacy_action")
		}

	@staticmethod
	def _device_card(device):
		if not device:
			return None

		card = frappe.db.get_value(
			"MSP Managed Device",
			device,
			["name", "hostname", "serial_number", "device_type", "status", "assigned_client_user"],
			as_dict=True,
		)

		if card and card.assigned_client_user:
			card["holder_name"] = frappe.db.get_value(
				"MSP Client User", card.assigned_client_user, "full_name"
			)

		return card

	@staticmethod
	def _holder_facts(order, row):
		"""Who holds the machine, who was asked for, and who held it when the request was sent.

		Three different people, and the technician is shown all three rather than one of them:
		a machine can change hands between the day a change is asked for and the day it is
		carried out, and that is exactly what must not pass unnoticed.
		"""
		snapshot = frappe.parse_json(row.state_snapshot) if row and row.state_snapshot else {}
		asked = snapshot.get("current_holder") or None
		current = (
			frappe.db.get_value("MSP Managed Device", order.managed_device, "assigned_client_user")
			if order.managed_device
			else None
		)

		return {
			"requested_holder_name": RequestExecutionService._holder_name(order.requested_holder),
			"snapshot_holder": asked,
			"snapshot_holder_name": RequestExecutionService._holder_name(asked),
			"current_holder": current,
			"current_holder_name": RequestExecutionService._holder_name(current),
			"holder_changed": bool(snapshot) and asked != current,
		}

	@staticmethod
	def _holder_name(client_user):
		if not client_user:
			return None

		return frappe.db.get_value("MSP Client User", client_user, "full_name") or client_user

	@staticmethod
	def _current_service(order):
		"""What the service being acted on is doing today, so the act is read in context."""
		assignment = order.resulting_assignment or order.source_service_assignment

		if order.work_type != SERVICE_ACTION or not assignment:
			return None

		card = frappe.db.get_value(
			"MSP Service Assignment",
			assignment,
			[
				"name",
				"operational_status",
				"quantity",
				"effective_start_date",
				"effective_end_date",
			],
			as_dict=True,
		)

		if card:
			from nexgen_msp.api.internal.services.user_service import UserService

			# an act dated inside an invoiced period still runs; the screen says so beforehand
			card["billed_to"] = UserService._billed_to(assignment)

		return card

	# ------------------------------------------------------------------ the stepper
	@staticmethod
	def _stages(doc, orders):
		"""The four steps of the job, and which one the request is actually in.

		Review lines decides what enters the work. Execute is all of it — creating the person
		and preparing the machine included, since they are what the requested acts wait on.
		Verify reads back what was performed. Final validation closes the file.
		"""
		reviewed = doc.status not in ("Submitted", "Under Review")
		executed = reviewed and all(
			order.status in FINISHED_STATUSES + ("Awaiting Verification",) for order in orders
		)
		completed = doc.status == "Completed"

		stages = [
			{"key": "review", "label": "Review lines", "done": reviewed, "needed": True},
			{"key": "execute", "label": "Execute", "done": executed, "needed": True},
			{"key": "verify", "label": "Verify", "done": completed, "needed": True},
			{"key": "complete", "label": "Final validation", "done": completed, "needed": True},
		]

		current = (
			"complete"
			if completed
			else "verify"
			if executed
			else "execute"
			if reviewed
			else "review"
		)

		for stage in stages:
			stage["state"] = (
				"done" if stage["done"] else "current" if stage["key"] == current else "todo"
			)

		return {"stages": stages, "current": current}

	@staticmethod
	def _activity(doc, orders):
		"""What happened and when, told by the work itself rather than kept in a second place."""
		names = [order.name for order in orders] or [""]
		label = {
			order.name: order.service_name or order.action_label or order.work_type
			for order in orders
		}

		rows = frappe.get_all(
			"Comment",
			filters={
				"comment_type": "Comment",
				"reference_doctype": ("in", (WORK_ORDER, "MSP Request")),
				"reference_name": ("in", names + [doc.name]),
			},
			fields=["reference_doctype", "reference_name", "content", "owner", "creation"],
			order_by="creation asc",
			limit=200,
		)

		return [
			{
				"at": row.creation,
				"who": frappe.db.get_value("User", row.owner, "full_name") or row.owner,
				"about": label.get(row.reference_name) if row.reference_doctype == WORK_ORDER else None,
				"said": row.content,
			}
			for row in rows
		]

	@staticmethod
	def _summary(orders):
		work = [order for order in orders if order.work_type in (SERVICE_ACTION, DEVICE_OPERATION)]

		return {
			"people": len({order.subject_key for order in work if order.subject_key}),
			"devices": len(
				{
					order.managed_device or order.requested_device
					for order in work
					if order.target_scope == "Device" and (order.managed_device or order.requested_device)
				}
			),
			"services": len([order for order in work if order.work_type == SERVICE_ACTION]),
			"open": len([order for order in work if order.status not in FINISHED_STATUSES]),
			"blocked": len([order for order in work if order.status == "Blocked"]),
			"failed": len([order for order in work if order.status == "Failed"]),
		}

	# ------------------------------------------------------------------ shared
	@staticmethod
	def _request(request):
		if not request:
			raise ValidationError("request is required.", "VALIDATION_ERROR")

		if not frappe.db.exists("MSP Request", request):
			raise NotFoundError(f"Request {request} not found.", "NOT_FOUND")

		return frappe.get_doc("MSP Request", request)

	# ------------------------------------------------------------------ carrying it out
	@staticmethod
	def execute_device_operation(
		work_order=None,
		effective_date=None,
		execution_holder=None,
		override_reason=None,
		notes=None,
		customer_note=None,
		_plan=True,
	):
		"""Carry out what a request asked of the machine itself, through the device domain.

		The holder the customer asked for is what is carried out unless whoever does the work
		says otherwise in as many words, and why. Nothing about how a machine changes hands is
		decided here: the act is named and the device domain does it.
		"""
		from nexgen_msp.api.internal.services.device_lifecycle_service import (
			DeviceLifecycleService,
		)

		order = RequestExecutionService._claimed(work_order, DEVICE_OPERATION)
		doc = frappe.get_doc("MSP Request", order.request)
		definition = operations.require(
			order.operation_code or operations.from_legacy_work(order.action)
		)
		code = definition["code"]
		device = order.managed_device

		if not device:
			raise ValidationError(DEPENDENCY_LABELS["requested_device"], "REQUESTED_TARGET_UNRESOLVED")

		RequestExecutionService._owned_device(doc.customer, device)

		before = operations.snapshot_device(device)
		on_date = effective_date or order.effective_date or frappe.utils.today()
		holder = None

		if code in HOLDER_CHANGES:
			requested = RequestExecutionService._requested_holder(order, execution_holder)
			holder = execution_holder or requested

			if not holder:
				raise ValidationError("Say who is to hold this Device.", "VALIDATION_ERROR")

			RequestExecutionService._receivable_holder(doc.customer, holder)

			if (order.requested_holder or order.requested_holder_requested_client_user) and holder != requested:
				reason = (override_reason or "").strip()

				if not reason:
					raise ValidationError(
						"Explain why Nexgen is executing the transfer to a different person.",
						"VALIDATION_ERROR",
					)

				order.override_reason = reason

		already_held = code == "device.assign" and before.get("current_holder") == holder

		if not already_held:
			RequestExecutionService._revalidate_device_state(order, before)

		savepoint = "execute_device_operation"
		frappe.db.savepoint(savepoint)

		try:
			if already_held:
				notes = notes or (
					f"{RequestExecutionService._holder_name(holder)} already holds "
					f"{before.get('hostname') or device}."
				)
			elif code == "device.assign" and before.get("current_holder"):
				DeviceLifecycleService.transfer(
					device=device, client_user=holder, effective_date=on_date, note=notes,
					_commit=False, _within_request=doc.name,
				)
			elif code == "device.assign":
				DeviceLifecycleService.assign(
					device=device, client_user=holder, effective_date=on_date, note=notes,
					_commit=False, _within_request=doc.name,
				)
			elif code == "device.transfer":
				DeviceLifecycleService.transfer(
					device=device, client_user=holder, effective_date=on_date, note=notes,
					_commit=False, _within_request=doc.name,
				)
			elif code == "device.repossess":
				DeviceLifecycleService.repossess(
					device=device, effective_date=on_date, note=notes, _commit=False,
					_within_request=doc.name,
				)
			elif code == "device.retire":
				DeviceLifecycleService.retire(
					device=device, effective_date=on_date, note=notes, _commit=False,
					_within_request=doc.name,
				)
			elif code == "device.reinstate":
				DeviceLifecycleService.reinstate(
					device=device, effective_date=on_date, note=notes, _commit=False,
					_within_request=doc.name,
				)
			else:
				raise ValidationError(
					f"{definition['label']} is not work that can be carried out on a machine here.",
					"VALIDATION_ERROR",
				)

			order.state_snapshot = frappe.as_json(before)
			order.resulting_device = device
			order.resulting_client_user = holder
			order.effective_date = on_date
			order.execution_notes = notes or order.execution_notes
			order.customer_visible_note = customer_note or order.customer_visible_note
			RequestExecutionService._settle(
				order, proven=RequestExecutionService._prove_device_operation
			)
			RequestExecutionService._work_has_begun(doc)
		except Exception:
			frappe.db.rollback(save_point=savepoint)
			raise

		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(doc.name) if _plan else None

	@staticmethod
	def _requested_holder(order, execution_holder=None):
		"""The Client User the request asked to hold the machine, refusing one still to be resolved."""
		if order.requested_holder or not order.requested_holder_requested_client_user:
			return order.requested_holder

		target = request_targets.resolve_holder_target(
			requested_holder_requested_client_user=order.requested_holder_requested_client_user
		)

		if target["resolved"]:
			order.requested_holder = target["resolved"]
			return target["resolved"]

		if execution_holder:
			return None

		if target["waiting"]:
			raise ValidationError(DEPENDENCY_LABELS["requested_holder"], "REQUESTED_TARGET_UNRESOLVED")

		raise ValidationError(request_targets.CANCELLED_TARGET, "INVALID_TRANSITION")

	@staticmethod
	def _receivable_holder(customer, client_user):
		"""The person a machine is being handed to: ours, and in a state to receive it."""
		person = frappe.db.get_value(
			"MSP Client User", client_user, ["customer", "lifecycle_status"], as_dict=True
		)

		if not person or person.customer != customer:
			raise ValidationError(
				"The selected person does not belong to this Customer.", "VALIDATION_ERROR"
			)

		if person.lifecycle_status not in ("Pending", "Active"):
			raise ValidationError(
				"The selected person cannot receive this Device in their current lifecycle state.",
				"VALIDATION_ERROR",
			)

	@staticmethod
	def _revalidate_device_state(order, before):
		"""What the machine looked like when the change was asked for, read again now.

		A machine can change hands between the day a customer asks for a transfer and the day
		it is carried out. Nothing is done automatically in that case: whoever is doing the
		work is shown the three holders and decides.
		"""
		row = (
			frappe.db.get_value(
				"MSP Request Line", order.request_line_name, "state_snapshot"
			)
			if order.request_line_name
			else None
		)

		snapshot = frappe.parse_json(row) if row else {}

		if not snapshot:
			return

		if (snapshot.get("current_holder") or None) != (before.get("current_holder") or None):
			raise ValidationError(
				"The Device holder changed after this request was submitted. Review the current "
				"holder before continuing.",
				"DEVICE_STATE_CHANGED",
			)

	@staticmethod
	def _prove_device_operation(order):
		"""What the machine's own record says happened, which the technician never has to tick."""
		card = frappe.db.get_value(
			"MSP Managed Device",
			order.managed_device,
			["status", "assigned_client_user"],
			as_dict=True,
		)

		if not card:
			return [("Device on file", False)]

		checks = [("Device on file", True)]
		code = order.operation_code

		if code in ("device.assign", "device.transfer"):
			checks.append(
				(
					"Held by the person it was carried out for",
					card.assigned_client_user == order.resulting_client_user,
				)
			)
		elif code == "device.repossess":
			checks.append(("Back in stock with nobody holding it", not card.assigned_client_user))
		elif code == "device.retire":
			checks.append(("Device out of service", card.status == "Retired"))
		elif code == "device.reinstate":
			checks.append(("Device back in service", card.status != "Retired"))

		return checks

	@staticmethod
	def execute_service_action(
		work_order=None,
		effective_date=None,
		quantity=None,
		username=None,
		serial_number=None,
		notes=None,
		customer_note=None,
		confirm_billed=0,
		action=None,
		operation_code=None,
		service_item=None,
		_plan=True,
	):
		"""Carry out the act one approved line asked for, through the service domain.

		The customer asks; the technician decides what the service really needs. A line that
		acts on a running service may be carried out as another act than the one written on
		it — suspended instead of closed, moved onto another service — and the work order says
		so, while the customer's line stays exactly as they wrote it.

		Nothing about how a service opens, suspends or ends is decided here. The act is
		named, the target is read from the work order, and the domain does the rest.
		"""
		from nexgen_msp.api.internal.services.service_lifecycle_service import (
			ServiceLifecycleService,
		)

		order = RequestExecutionService._claimed(work_order, SERVICE_ACTION)
		doc = frappe.get_doc("MSP Request", order.request)
		on_date = effective_date or order.effective_date or frappe.utils.today()

		if order.target_scope == "User" and not order.client_user:
			raise ValidationError(DEPENDENCY_LABELS["requested_client_user"], "REQUESTED_TARGET_UNRESOLVED")

		if order.target_scope == "Device" and not order.managed_device:
			raise ValidationError(DEPENDENCY_LABELS["requested_device"], "REQUESTED_TARGET_UNRESOLVED")

		# the technician names the operation; the old verb is still accepted from older callers
		if operation_code:
			action = operations.require(operation_code)["legacy_action"]

		if action and action != order.action:
			if action not in ("Suspend", "Resume", "Change", "Remove") or order.action == "Add":
				raise ValidationError(
					f"This work cannot be carried out as {action}.", "VALIDATION_ERROR"
				)

			notes = (
				f"Carried out as {action}; the request asked for {order.action}."
				+ (f" {notes}" if notes else "")
			)
			order.action = action
			order.operation_code = operations.from_legacy_action(action)

		savepoint = "execute_service_action"
		frappe.db.savepoint(savepoint)

		try:
			RequestExecutionService._identify_target(order, username, serial_number)

			if order.action == "Add":
				outcome = ServiceLifecycleService.activate(
					customer=doc.customer,
					service_item=order.service_item,
					target_scope=order.target_scope,
					client_user=order.client_user,
					managed_device=order.managed_device,
					effective_date=on_date,
					quantity=quantity or RequestExecutionService._asked_quantity(doc, order),
					source_request=doc.name,
					notes=notes,
					_commit=False,
					_within_request=doc.name,
				)
			else:
				assignment = order.source_service_assignment

				if not assignment:
					raise ValidationError(
						"This act names no service to work on.", "VALIDATION_ERROR"
					)

				if order.action == "Suspend":
					outcome = ServiceLifecycleService.suspend(
						assignment=assignment,
						effective_date=on_date,
						source_request=doc.name,
						notes=notes,
						confirm_billed=confirm_billed,
						_commit=False,
						_within_request=doc.name,
					)
				elif order.action == "Resume":
					outcome = ServiceLifecycleService.resume(
						assignment=assignment,
						effective_date=on_date,
						source_request=doc.name,
						notes=notes,
						confirm_billed=confirm_billed,
						_commit=False,
						_within_request=doc.name,
					)
				elif order.action == "Remove":
					outcome = ServiceLifecycleService.end(
						assignment=assignment,
						effective_date=on_date,
						source_request=doc.name,
						notes=notes,
						_commit=False,
						_within_request=doc.name,
					)
				else:
					outcome = ServiceLifecycleService.change(
						assignment=assignment,
						effective_date=on_date,
						quantity=quantity,
						service_item=service_item or RequestExecutionService._replacement(order),
						source_request=doc.name,
						notes=notes,
						_commit=False,
						_within_request=doc.name,
					)

			order.resulting_assignment = outcome.get("name")
			order.effective_date = on_date
			order.execution_notes = notes or order.execution_notes
			order.customer_visible_note = customer_note or order.customer_visible_note
			RequestExecutionService._executed(order)
			RequestExecutionService._work_has_begun(doc)
		except Exception:
			frappe.db.rollback(save_point=savepoint)
			raise

		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(doc.name) if _plan else None

	@staticmethod
	def execute_service_actions(work_orders=None, effective_date=None, confirm_billed=0):
		"""The same ready act for several people, carried out one person at a time.

		Grouping is a convenience of the screen. Every work order still goes through the
		service domain on its own, is refused on its own, and is reported on its own, so a
		batch of eighteen can come back as seventeen done and one refused, named.
		"""
		RequestService._guard_internal()

		work_orders = frappe.parse_json(work_orders) if isinstance(work_orders, str) else work_orders

		if not work_orders:
			raise ValidationError("Name the work to carry out.", "VALIDATION_ERROR")

		requests = {
			frappe.db.get_value(WORK_ORDER, name, "request") for name in work_orders
		}
		requests.discard(None)

		if len(requests) != 1:
			raise ValidationError(
				"Work from several requests cannot be carried out together.", "VALIDATION_ERROR"
			)

		results = []

		for name in work_orders:
			try:
				RequestExecutionService.execute_service_action(
					work_order=name,
					effective_date=effective_date,
					confirm_billed=confirm_billed,
					_plan=False,
				)
				results.append({"work_order": name, "ok": True, "message": None, "code": None})
			except Exception as error:
				frappe.db.rollback()
				results.append(
					{
						"work_order": name,
						"ok": False,
						"message": getattr(error, "message", None) or str(error),
						"code": getattr(error, "code", None),
					}
				)

		return {
			"results": results,
			"completed": len([row for row in results if row["ok"]]),
			"failed": len([row for row in results if not row["ok"]]),
			"plan": RequestExecutionService.get_execution_plan(requests.pop()),
		}

	@staticmethod
	def execute_work_orders(request=None, executions=None):
		"""Carry out a batch of ready work, whatever each unit happens to be.

		The screen groups twenty additions, or three handovers, and asks for them at once.
		Nothing about that grouping reaches the domain: each work order is dispatched to the
		executor its own work type calls for, runs on its own, commits on its own and is
		reported on its own. Eighteen done and two refused is a normal answer, and the two
		keep their own message rather than being folded into one sentence.
		"""
		RequestService._guard_internal()

		executions = frappe.parse_json(executions) if isinstance(executions, str) else executions

		if not executions:
			raise ValidationError("Name the work to carry out.", "VALIDATION_ERROR")

		doc = RequestExecutionService._request(request)
		names = [row.get("work_order") for row in executions if row.get("work_order")]
		orders = {
			row.name: row
			for row in frappe.get_all(
				WORK_ORDER,
				filters={"name": ("in", names or [""])},
				fields=["name", "request", "work_type", "status"],
			)
		}

		for name in names:
			order = orders.get(name)

			if not order or order.request != doc.name:
				raise ValidationError(
					"Work from several requests cannot be carried out together.",
					"VALIDATION_ERROR",
				)

		runner = {
			SERVICE_ACTION: RequestExecutionService.execute_service_action,
			DEVICE_OPERATION: RequestExecutionService.execute_device_operation,
		}
		results, skipped = [], 0

		for row in executions:
			name = row.get("work_order")
			order = orders.get(name)
			execute = runner.get(order.work_type) if order else None

			if not execute:
				skipped += 1
				continue

			try:
				execute(**{**(row.get("inputs") or {}), "work_order": name, "_plan": False})
				results.append({"work_order": name, "ok": True, "message": None, "code": None})
			except Exception as error:
				frappe.db.rollback()
				results.append(
					{
						"work_order": name,
						"ok": False,
						"message": getattr(error, "message", None) or str(error),
						"code": getattr(error, "code", None),
					}
				)

		return {
			"results": results,
			"completed": len([row for row in results if row["ok"]]),
			"failed": len([row for row in results if not row["ok"]]),
			"skipped": skipped,
			"plan": RequestExecutionService.get_execution_plan(doc.name),
		}

	@staticmethod
	def save_required_identifiers(request=None, values=None):
		"""Write the identifiers a request is waiting on, as many as are known right now.

		Whoever is doing the work rarely holds all eight usernames at once. So each row is
		written on its own, a row that fails keeps its value and its own message, and what was
		saved stays saved.

		A row carries the `modified` it was read with. If the record moved since, that row is
		refused rather than quietly overwriting somebody else's newer value.
		"""
		RequestService._guard_internal()

		doc = RequestExecutionService._request(request)
		values = frappe.parse_json(values) if isinstance(values, str) else values

		if not values:
			raise ValidationError("Nothing to save.", "VALIDATION_ERROR")

		results = []

		for row in values:
			kind = row.get("kind")
			owner = row.get("owner")
			value = (row.get("value") or "").strip()

			if not value or not owner:
				continue

			try:
				doctype = RequestExecutionService._identifier_owner(kind, owner, row.get("owner_type"))
				seen = row.get("modified")
				now = str(frappe.db.get_value(doctype, owner, "modified") or "")

				if seen and str(seen) != now:
					raise ValidationError(
						"Some information changed while this dialog was open. Refresh the "
						"affected rows before saving again.",
						"PREPARATION_STATE_CHANGED",
					)

				if doctype in (REQUESTED_CLIENT_USER, REQUESTED_DEVICE):
					RequestExecutionService._keep_on_requested(doc, doctype, owner, kind, value)
				else:
					RequestExecutionService._record_identifier(owner, kind, value)

				frappe.db.commit()
				results.append({"owner": owner, "kind": kind, "ok": True, "message": None, "code": None})
			except Exception as error:
				frappe.db.rollback()
				results.append(
					{
						"owner": owner,
						"kind": kind,
						"ok": False,
						"message": getattr(error, "message", None) or str(error),
						"code": getattr(error, "code", None),
					}
				)

		saved = len([row for row in results if row["ok"]])

		if saved:
			# one line in the request's history for the batch, not one per value
			RequestExecutionService._note_identifiers(doc, results)

		return {
			"saved": saved,
			"failed": len([row for row in results if not row["ok"]]),
			"results": results,
			"plan": RequestExecutionService.get_execution_plan(doc.name),
		}

	IDENTIFIER_OWNERS = {
		"username": ("MSP Client User", REQUESTED_CLIENT_USER),
		"serial_number": ("MSP Managed Device", REQUESTED_DEVICE),
	}

	@staticmethod
	def _identifier_owner(kind, owner, owner_type=None):
		"""The record an identifier is written on, as named or as read from the owner's name."""
		allowed = RequestExecutionService.IDENTIFIER_OWNERS.get(kind)

		if not allowed:
			raise ValidationError(f"{kind} cannot be entered here.", "VALIDATION_ERROR")

		if owner_type and owner_type not in allowed:
			raise ValidationError(f"{owner_type} does not hold a {kind}.", "VALIDATION_ERROR")

		doctype = owner_type or next(
			(candidate for candidate in allowed if frappe.db.exists(candidate, owner)), None
		)

		if not doctype or not frappe.db.exists(doctype, owner):
			raise ValidationError(f"{owner} no longer exists.", "NOT_FOUND")

		return doctype

	@staticmethod
	def _record_identifier(owner, kind, value):
		"""Put a username on a Client User or a serial on a Managed Device, in the catalogue's words."""
		if kind == "username":
			try:
				identifiers.record_username(owner, value, overwrite=True)
			except Exception as refusal:
				raise RequestExecutionService._identifier_refusal(
					refusal,
					"USERNAME_CONFLICT",
					f'Username "{value}" is already used by another Client User for this Customer.',
				)
			return

		try:
			identifiers.record_serial(owner, value, overwrite=True)
		except Exception as refusal:
			raise RequestExecutionService._identifier_refusal(
				refusal,
				"SERIAL_CONFLICT",
				f'Serial number "{value}" is already used by another Managed Device.',
			)

	@staticmethod
	def _keep_on_requested(doc, doctype, name, kind, value):
		"""Keep an identifier on a Requested entity, or on its real record once it has resolved."""
		row = frappe.db.get_value(
			doctype,
			name,
			["request", "customer", "status", "resolved_client_user" if doctype == REQUESTED_CLIENT_USER else "resolved_managed_device"],
			as_dict=True,
		)

		if row.request != doc.name:
			raise ValidationError(request_targets.CROSS_REQUEST, "VALIDATION_ERROR")

		if row.status == "Cancelled":
			raise ValidationError(request_targets.CANCELLED_TARGET, "VALIDATION_ERROR")

		resolved = row.get("resolved_client_user") or row.get("resolved_managed_device")

		if row.status == "Resolved" and resolved:
			RequestExecutionService._record_identifier(resolved, kind, value)
			return

		if kind == "username":
			if frappe.db.exists(
				"MSP Client User", {"customer": row.customer, "username": value}
			):
				raise ValidationError(
					f'Username "{value}" is already used by another Client User for this Customer.',
					"USERNAME_CONFLICT",
				)

			frappe.db.set_value(doctype, name, "username", value)
			return

		if frappe.db.exists("MSP Managed Device", {"serial_number": value}):
			raise ValidationError(
				f'Serial number "{value}" is already used by another Managed Device.',
				"SERIAL_CONFLICT",
			)

		frappe.db.set_value(doctype, name, "serial_number", value)

	@staticmethod
	def _identifier_refusal(refusal, code, said):
		"""Say a clash in the words the catalogue fixes, and leave anything else as it is.

		The record's own validation is right about what happened; it is not written for the
		person entering eight usernames in a dialog. Only the clash is re-worded, so a
		refusal nobody anticipated still arrives exactly as the domain said it.
		"""
		message = str(getattr(refusal, "message", None) or refusal)

		if "already exists" in message or "already used" in message:
			return ValidationError(said, code)

		return refusal

	@staticmethod
	def _note_identifiers(doc, results):
		"""Say once, on the request, what was completed during fulfilment."""
		usernames = len([row for row in results if row["ok"] and row["kind"] == "username"])
		serials = len([row for row in results if row["ok"] and row["kind"] == "serial_number"])
		said = []

		if usernames:
			said.append(f"{usernames} username(s) recorded during fulfilment.")

		if serials:
			said.append(f"{serials} serial number(s) recorded during fulfilment.")

		if not said:
			return

		# the request's own activity log, which is what the screens already read
		doc.add_comment("Comment", f"Required information updated — {' '.join(said)}")

	@staticmethod
	def record_context_action(request=None, subject_key=None, label=None, detail=None):
		"""Add an already-completed in-context change to this request's recap."""
		RequestService._guard_internal()
		doc = RequestExecutionService._request(request)

		if doc.status not in ("Approved", "In Progress"):
			raise ValidationError(
				f"Activity can only be recorded while a request is being carried out; this one is {doc.status.lower()}.",
				"INVALID_TRANSITION",
			)

		label = (label or "").strip()
		if not label:
			raise ValidationError("An activity label is required.", "VALIDATION_ERROR")

		name = RequestExecutionService._work_order(
			doc,
			plan_key=f"{doc.name}:context:{frappe.generate_hash(length=12)}",
			work_type=CONTEXT_ACTION,
			origin="Technician",
			action="",
			subject_key=subject_key,
			activity_label=label,
			execution_notes=(detail or "").strip() or None,
			status="Completed",
			completed_by=frappe.session.user,
			completed_at=frappe.utils.now_datetime(),
		)
		frappe.get_doc(WORK_ORDER, name).add_comment("Comment", label)
		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(doc.name)

	@staticmethod
	def settle_work_done_elsewhere(request=None):
		"""Lines the person's own actions already carried out are settled.

		The ⋯ menu acts on the person directly and stays available whatever the request asks.
		When what it did is exactly what a line was waiting for (the service opened, suspended,
		resumed or ended), the line is marked done rather than left asking for it again.
		"""
		RequestService._guard_internal()
		doc = RequestExecutionService._request(request)

		if doc.status not in ("Approved", "In Progress"):
			return RequestExecutionService.get_execution_plan(doc.name)

		open_orders = frappe.get_all(
			WORK_ORDER,
			filters={
				"request": doc.name,
				"work_type": SERVICE_ACTION,
				"status": ("not in", (*FINISHED_STATUSES, "Awaiting Verification")),
			},
			pluck="name",
		)
		settled = False

		for name in open_orders:
			order = frappe.get_doc(WORK_ORDER, name)
			assignment = RequestExecutionService._already_done(doc, order)

			if not assignment:
				continue

			order.resulting_assignment = assignment
			order.effective_date = order.effective_date or frappe.utils.today()
			order.execution_notes = "Already done from the person's actions."
			RequestExecutionService._executed(order)
			settled = True

		if settled:
			RequestExecutionService._work_has_begun(doc)

		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(doc.name)

	@staticmethod
	def _already_done(doc, order):
		"""The service record that already shows what this line asked for, if one does."""
		if order.action == "Add":
			target = order.client_user if order.target_scope == "User" else order.managed_device

			if not target or not order.service_item:
				return None

			found = frappe.get_all(
				"MSP Service Assignment",
				filters={
					"customer": doc.customer,
					"service_item": order.service_item,
					"assignment_scope": order.target_scope,
					("client_user" if order.target_scope == "User" else "managed_device"): target,
					"operational_status": "Active",
				},
				pluck="name",
				limit=1,
			)

			return found[0] if found else None

		reached = {
			"Remove": ("Ended",),
			"Suspend": ("Suspended",),
			"Resume": ("Active",),
		}.get(order.action)

		if not reached or not order.source_service_assignment:
			return None

		status = frappe.db.get_value(
			"MSP Service Assignment", order.source_service_assignment, "operational_status"
		)

		return order.source_service_assignment if status in reached else None

	@staticmethod
	def _identify_target(order, username, serial_number):
		"""What a service needs to be issued against, asked for where the work is happening.

		A personal service is issued against a username and a machine is known by what is
		engraved on it. Neither is ever asked of the customer, and neither is discovered at
		closing time any more: it is owed by the act that puts the service into service, and
		asked for on that card.
		"""
		if order.action not in ("Add", "Change"):
			return

		if order.target_scope == "User":
			identifiers.require_username(order.client_user, username)
		elif order.target_scope == "Device":
			identifiers.require_serial(order.managed_device, serial_number)

			# a service sold to both is issued against the machine and the person holding it
			if RequestService._service_scope(order.service_item) == "Both":
				holder = order.client_user or frappe.db.get_value(
					"MSP Managed Device", order.managed_device, "assigned_client_user"
				)
				if holder:
					identifiers.require_username(holder, username)

	@staticmethod
	def _asked_quantity(doc, order):
		row = next((line for line in doc.lines if line.name == order.request_line_name), None)

		return (row.requested_quantity if row else None) or 1

	@staticmethod
	def _owned_device(customer, device):
		owner = frappe.db.get_value("MSP Managed Device", device, "customer")

		if not owner:
			raise NotFoundError(f"Managed Device {device} not found.", "NOT_FOUND")

		if owner != customer:
			raise ValidationError(
				f"Device {device} does not belong to {customer}.", "PERMISSION_DENIED", 403
			)

		return device

	REQUESTED_KINDS = {"client_user": REQUESTED_CLIENT_USER, "device": REQUESTED_DEVICE}

	@staticmethod
	def _requested_service(kind):
		if kind == "client_user":
			from nexgen_msp.api.internal.services.requested_client_user_service import (
				RequestedClientUserService,
			)

			return RequestedClientUserService

		from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService

		return RequestedDeviceService

	@staticmethod
	def _requested_record(kind, name):
		doctype = RequestExecutionService.REQUESTED_KINDS.get(kind)

		if not doctype:
			raise ValidationError(f"{kind} is not a kind of requested target.", "VALIDATION_ERROR")

		if not name or not frappe.db.exists(doctype, name):
			raise NotFoundError(f"{doctype} {name} not found.", "NOT_FOUND")

		return doctype

	@staticmethod
	def get_requested(kind=None, name=None):
		"""One Requested entity, with the requested work that references it."""
		from nexgen_msp.api.internal.services.requested_entity_presentation import (
			RequestedEntityPresentation,
		)

		RequestService._guard_internal()
		RequestExecutionService._requested_record(kind, name)

		return {
			"entity": RequestedEntityPresentation.of(kind, name),
			"requested_work": RequestedEntityPresentation.requested_work(kind, name),
		}

	@staticmethod
	def save_requested(kind=None, name=None, values=None):
		"""Keep what the technician prepared on a Requested entity, and say where the work stands."""
		RequestService._guard_internal()
		RequestExecutionService._requested_record(kind, name)
		RequestExecutionService._requested_service(kind).mark_reviewed(name, values)

		return RequestExecutionService._prepared(kind, name)

	@staticmethod
	def resolve_requested(kind=None, name=None, mode=None, values=None, target=None, interfaces=None):
		"""Resolve a Requested entity to a new record or a chosen one, and say where the work stands."""
		RequestService._guard_internal()
		RequestExecutionService._requested_record(kind, name)
		service = RequestExecutionService._requested_service(kind)
		if mode == "existing":
			service.resolve_existing(name, target)
		elif kind == "client_user" and mode == "create":
			service.resolve_create(name, values)
		elif kind == "device" and mode == "new":
			service.resolve_new(name, values, interfaces=frappe.parse_json(interfaces) if isinstance(interfaces, str) else interfaces)
		else:
			raise ValidationError(f"{mode} is not a way to resolve this requested target.", "VALIDATION_ERROR")

		request = frappe.db.get_value(
			RequestExecutionService.REQUESTED_KINDS[kind], name, "request"
		)
		RequestExecutionService._work_has_begun(frappe.get_doc("MSP Request", request))
		frappe.db.commit()

		return RequestExecutionService._prepared(kind, name)

	@staticmethod
	def cancel_requested(kind=None, name=None, reason=None):
		"""Cancel a Requested entity and the work that depended on it, and say where the work stands."""
		RequestService._guard_internal()
		RequestExecutionService._requested_record(kind, name)
		RequestExecutionService._requested_service(kind).cancel(name, reason)

		return RequestExecutionService._prepared(kind, name)

	@staticmethod
	def _prepared(kind, name):
		from nexgen_msp.api.internal.services.requested_entity_presentation import (
			RequestedEntityPresentation,
		)

		request = frappe.db.get_value(
			RequestExecutionService.REQUESTED_KINDS[kind], name, "request"
		)

		return {
			"entity": RequestedEntityPresentation.of(kind, name),
			"plan": RequestExecutionService.get_execution_plan(request),
		}

	# ------------------------------------------------------------------ one job at a time
	@staticmethod
	def _claimed(work_order, expected_type):
		"""The work order, locked, and only if it is really ours to carry out now.

		Two technicians can press the same button in the same second. The row is taken for
		update before anything is read from it, so the second one is told what the first one
		already did instead of doing it twice.
		"""
		RequestService._guard_internal()

		if not work_order:
			raise ValidationError("work_order is required.", "VALIDATION_ERROR")

		if not frappe.db.exists(WORK_ORDER, work_order):
			raise NotFoundError(f"Work Order {work_order} not found.", "NOT_FOUND")

		frappe.db.sql(
			f"select name from `tab{WORK_ORDER}` where name = %s for update", work_order
		)

		order = frappe.get_doc(WORK_ORDER, work_order)

		if order.work_type != expected_type:
			raise ValidationError(
				f"{work_order} is {order.work_type} work, not {expected_type}.", "VALIDATION_ERROR"
			)

		RequestExecutionService._refuse_settled(order)

		if order.status == "Blocked":
			raise ValidationError(
				"This work is blocked. Resume it before carrying it out.", "INVALID_TRANSITION"
			)

		RequestExecutionService._settle_targets(order)

		return order

	@staticmethod
	def _refuse_settled(order):
		if order.status == "Cancelled":
			raise ValidationError("This work item was cancelled.", "INVALID_TRANSITION")

		if order.status in ("Completed", "Awaiting Verification"):
			who = frappe.db.get_value("User", order.completed_by, "full_name") or order.completed_by
			when = frappe.utils.format_datetime(order.completed_at) if order.completed_at else None

			raise ValidationError(
				"This work item was already carried out"
				+ (f" by {who}" if who else "")
				+ (f" at {when}" if when else "")
				+ ".",
				"ALREADY_DONE",
			)

	@staticmethod
	def _settle_targets(order):
		"""Put the resolved targets on a work order, refusing one whose Requested entity is unresolved."""
		for field, real, kind, resolve in (
			("requested_device", "managed_device", "requested_device", request_targets.resolve_device_target),
			(
				"requested_client_user",
				"client_user",
				"requested_client_user",
				request_targets.resolve_client_user_target,
			),
		):
			requested = order.get(field)

			if not requested:
				continue

			target = resolve(**{field: requested})

			if target["waiting"]:
				raise ValidationError(DEPENDENCY_LABELS[kind], "REQUESTED_TARGET_UNRESOLVED")

			if not target["resolved"]:
				raise ValidationError(request_targets.CANCELLED_TARGET, "INVALID_TRANSITION")

			if not order.get(real) and (real == "managed_device") == (order.target_scope == "Device"):
				order.set(real, target["resolved"])

	# ------------------------------------------------------------------ what was proven
	@staticmethod
	def _prove_service_action(order):
		"""What the record itself says happened, which the technician never has to tick."""
		assignment = frappe.db.get_value(
			"MSP Service Assignment",
			order.resulting_assignment,
			["operational_status", "client_user", "managed_device", "service_item"],
			as_dict=True,
		)

		if not assignment:
			return [("Service assignment written", False)]

		wanted = {
			"Add": "Active",
			"Change": "Active",
			"Suspend": "Suspended",
			"Resume": "Active",
			"Remove": ("Ended",),
		}[order.action]

		reached = (
			assignment.operational_status in wanted
			if isinstance(wanted, tuple)
			else assignment.operational_status == wanted
		)
		target = (
			assignment.client_user if order.target_scope == "User" else assignment.managed_device
		)
		asked = order.client_user if order.target_scope == "User" else order.managed_device

		return [
			("Service assignment written", True),
			(f"Service is {str(wanted[0] if isinstance(wanted, tuple) else wanted).lower()}", reached),
			("Target is the one that was asked for", target == asked),
		]

	# the one thing the record cannot prove: that the customer can actually use it

	MANUAL_CHECK = {
		"Add": "Confirmed working for the customer",
		"Change": "Confirmed working on the new terms",
	}

	@staticmethod
	def _settle(order, proven):
		"""Preparation work: everything it claims is provable, so it finishes on the spot."""
		checks = proven(order)
		RequestExecutionService._write_checklist(order, checks, manual=None)

		failed = [step for step, done in checks if not done]

		if failed:
			raise ValidationError(
				"The work did not leave the record it should have: " + ", ".join(failed) + ".",
				"VALIDATION_ERROR",
			)

		order.status = "Completed"
		order.completed_by = frappe.session.user
		order.completed_at = frappe.utils.now_datetime()
		order.save(ignore_permissions=True)

	@staticmethod
	def _executed(order):
		"""A service act has run, and the record proves it did: it is done.

		What was performed is read back afterwards as a recap, not ticked off one item at a
		time before the request may close.
		"""
		checks = RequestExecutionService._prove_service_action(order)
		RequestExecutionService._write_checklist(order, checks, manual=None)

		failed = [step for step, done in checks if not done]

		if failed:
			raise ValidationError(
				"The service did not end up as asked: " + ", ".join(failed) + ".",
				"VALIDATION_ERROR",
			)

		order.status = "Completed"
		order.completed_by = frappe.session.user
		order.completed_at = frappe.utils.now_datetime()
		order.save(ignore_permissions=True)

	@staticmethod
	def _write_checklist(order, checks, manual=None):
		"""What the record proves is ticked here; what only a person can see is left open."""
		done = {row.step: row.is_done for row in order.checklist}
		order.set("checklist", [])

		for step, proven in checks:
			order.append("checklist", {"step": step, "is_done": 1 if proven else 0})

		if manual:
			order.append("checklist", {"step": manual, "is_done": done.get(manual, 0)})

	@staticmethod
	def _work_has_begun(doc):
		"""The first real act is what starts the work; nobody announces it separately."""
		if doc.status != "Approved":
			return

		frappe.db.set_value("MSP Request", doc.name, "status", "In Progress")
		doc.status = "In Progress"

	# ------------------------------------------------------------------ when it goes wrong
	@staticmethod
	def block_work_item(work_order=None, reason=None):
		"""Something nobody planned for is in the way. The rest of the request carries on."""
		order = RequestExecutionService._open_order(work_order)
		reason = (reason or "").strip()

		if not reason:
			raise ValidationError("Say what is in the way.", "VALIDATION_ERROR")

		order.status = "Blocked"
		order.failure_reason = reason
		order.save(ignore_permissions=True)
		order.add_comment("Comment", f"Blocked: {reason}")
		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(order.request)

	@staticmethod
	def resume_work_item(work_order=None):
		"""Whatever was in the way is gone."""
		RequestService._guard_internal()
		order = RequestExecutionService._order(work_order)

		if order.status not in ("Blocked", "Failed"):
			raise ValidationError(
				f"This work is {order.status.lower()}, not held up.", "INVALID_TRANSITION"
			)

		order.status = "Open"
		order.failure_reason = None
		order.save(ignore_permissions=True)
		order.add_comment("Comment", "Work resumed.")
		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(order.request)

	@staticmethod
	def fail_work_item(work_order=None, reason=None):
		"""It was attempted and it did not work. Somebody still has to decide what next."""
		order = RequestExecutionService._open_order(work_order)
		reason = (reason or "").strip()

		if not reason:
			raise ValidationError("Say what went wrong.", "VALIDATION_ERROR")

		order.status = "Failed"
		order.failure_reason = reason
		order.save(ignore_permissions=True)
		order.add_comment("Comment", f"Failed: {reason}")
		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(order.request)

	@staticmethod
	def cancel_work_item(work_order=None, reason=None):
		"""Give this piece up, with a reason, so the request can be closed without it."""
		RequestService._guard_internal()
		order = RequestExecutionService._order(work_order)
		reason = (reason or "").strip()

		if not reason:
			raise ValidationError("Say why this work is being given up.", "VALIDATION_ERROR")

		if order.status == "Completed":
			raise ValidationError("This work is already done.", "INVALID_TRANSITION")

		order.status = "Cancelled"
		order.failure_reason = reason
		order.save(ignore_permissions=True)
		order.add_comment("Comment", f"Cancelled: {reason}")
		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(order.request)

	@staticmethod
	def _open_order(work_order):
		RequestService._guard_internal()
		order = RequestExecutionService._order(work_order)

		if order.status in FINISHED_STATUSES:
			raise ValidationError(
				f"This work is already {order.status.lower()}.", "INVALID_TRANSITION"
			)

		return order

	# ------------------------------------------------------------------ signing it off
	@staticmethod
	def verify_work_item(work_order=None, checklist=None, customer_note=None, notes=None):
		"""Read the result, tick what only a person can see, and close the item."""
		RequestService._guard_internal()
		order = RequestExecutionService._order(work_order)

		if order.status == "Completed":
			raise ValidationError("This work is already verified.", "INVALID_TRANSITION")

		if order.status != "Awaiting Verification":
			raise ValidationError(
				f"This work is {order.status.lower()} and has nothing to verify yet.",
				"INVALID_TRANSITION",
			)

		ticked = frappe.parse_json(checklist) if isinstance(checklist, str) else (checklist or {})

		for row in order.checklist:
			if row.step in ticked:
				row.is_done = 1 if ticked[row.step] else 0

		pending = [row.step for row in order.checklist if not row.is_done]

		if pending:
			raise ValidationError(
				"Still to check: " + ", ".join(pending) + ".", "VALIDATION_ERROR"
			)

		order.customer_visible_note = customer_note or order.customer_visible_note
		order.execution_notes = notes or order.execution_notes
		order.status = "Completed"
		order.completed_by = frappe.session.user
		order.completed_at = frappe.utils.now_datetime()
		order.save(ignore_permissions=True)
		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(order.request)

	@staticmethod
	def complete_request(request=None):
		"""Close the file, once every piece of work has been seen through."""
		RequestService._guard_internal()

		doc = RequestExecutionService._request(request)
		RequestExecutionService.guard_completion(doc)

		return RequestService.run_action(name=doc.name, action="complete")

	@staticmethod
	def guard_completion(doc):
		"""What still stands between this request and being closed.

		Nothing is discovered here that the plan did not already say: a missing serial or a
		missing account name is work that was never finished, and it shows as such.
		"""
		orders = RequestExecutionService._orders(doc.name)

		if not orders:
			raise ValidationError(
				"There is no work on this request to close.", "VALIDATION_ERROR"
			)

		waiting = []

		for order in orders:
			if order.status == "Completed":
				continue

			label = order.service_name or order.action_label or order.work_type

			if order.status == "Blocked":
				waiting.append(f"{label} is blocked: {order.failure_reason}")
			elif order.status == "Failed":
				waiting.append(f"{label} failed: {order.failure_reason}")
			elif order.status == "Cancelled":
				continue
			elif order.status == "Awaiting Verification":
				# carried out before the recap replaced the sign-off: it ran, it is done
				continue
			else:
				waiting.append(f"{label} has not been carried out")

		if waiting:
			raise ValidationError(
				f"{COMPLETION_REFUSAL} " + "; ".join(waiting) + ".",
				"VALIDATION_ERROR",
			)

	@staticmethod
	def _order(work_order):
		if not work_order:
			raise ValidationError("work_order is required.", "VALIDATION_ERROR")

		if not frappe.db.exists(WORK_ORDER, work_order):
			raise NotFoundError(f"Work Order {work_order} not found.", "NOT_FOUND")

		return frappe.get_doc(WORK_ORDER, work_order)
