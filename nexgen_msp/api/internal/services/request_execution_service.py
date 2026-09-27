"""The work an approved request turns into, and the order it can be carried out in.

A request says what the customer wants. This turns it into the work that grants it, and it
is the only thing the technician's screen talks to. It orchestrates and records; it decides
nothing about services, devices or people — those rules live in the lifecycle services and
are called, never reimplemented.

The plan is built from three groupings, none of which is the request line:

    one person to create        per subject_key
    one machine to settle       per device_requirement_key
    one act on a service        per approved line

so somebody the customer wrote once and asked three things for is created once, and three
device services owed to that person land on one machine.

Building the plan twice must produce the same plan: every work order carries a plan key
derived from the request and the grouping it stands for, and that key is unique in the
table, so two technicians opening the request at the same moment cannot double it.
"""

import frappe

from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.service_definition_service import ServiceDefinitionService
from nexgen_msp.utils import identifiers, operations, request_intents
from nexgen_msp.utils.errors import NotFoundError, ValidationError

WORK_ORDER = "MSP Service Work Order"

SERVICE_ACTION = "Service Action"
USER_SETUP = "User Setup"
DEVICE_PROVISIONING = "Device Provisioning"
DEVICE_OPERATION = "Device Operation"
CONTEXT_ACTION = "Context Action"

# the request has been decided and the work may exist
PLANNABLE_STATUSES = ("Approved", "In Progress", "Completed")

# work that is over, one way or another
FINISHED_STATUSES = ("Completed", "Cancelled")


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

		approved = [row for row in doc.lines if row.line_status == "Approved"]

		for row in approved:
			RequestExecutionService._plan_user_setup(doc, row)

		for row in approved:
			RequestExecutionService._plan_device_provisioning(doc, row)

		for row in approved:
			RequestExecutionService._plan_device_operation(doc, row)

		for row in approved:
			RequestExecutionService._plan_service_action(doc, row)

		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(doc.name)

	@staticmethod
	def _plan_user_setup(doc, row):
		"""A person the customer described but who does not exist yet."""
		if not row.is_new_user or row.client_user or not row.subject_key:
			return

		RequestExecutionService._work_order(
			doc,
			plan_key=f"{doc.name}:user:{row.subject_key}",
			work_type=USER_SETUP,
			action="Create User",
			target_scope="User",
			subject_key=row.subject_key,
		)

	@staticmethod
	def _plan_device_operation(doc, row):
		"""A line asking something of the machine itself rather than of a service on it.

		The machine is left exactly as the customer found it: what was asked, and what the
		machine looked like when it was asked, are on the line, and the act happens here.
		"""
		if not request_intents.is_device_operation(row):
			return

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
			managed_device=row.managed_device,
			requested_holder=row.requested_holder,
			effective_date=row.requested_effective_date,
			request_line_name=row.name,
			request_line_idx=row.idx,
		)

	@staticmethod
	def _plan_device_provisioning(doc, row):
		"""A machine a line needs that is not settled: not found yet, or held by somebody else.

		Handing a machine from one person to the next is never silent. It is work of its own,
		visible before anything is activated on that machine.
		"""
		if request_intents.is_device_operation(row):
			# the machine's own operation settles who holds it; nothing is prepared for it
			return

		key = row.device_requirement_key

		if not key:
			return

		if row.is_new_device and not row.managed_device:
			RequestExecutionService._work_order(
				doc,
				plan_key=f"{doc.name}:device:{key}",
				work_type=DEVICE_PROVISIONING,
				action="Register Device",
				action_group_key=row.action_group_key,
				target_scope="Device",
				subject_key=row.subject_key,
				device_requirement_key=key,
			)
			return

		if not row.managed_device:
			return

		person = RequestExecutionService._person_of(row)

		if not person:
			return

		holder = frappe.db.get_value("MSP Managed Device", row.managed_device, "assigned_client_user")

		if holder == person:
			return

		RequestExecutionService._work_order(
			doc,
			plan_key=f"{doc.name}:device:{key}",
			work_type=DEVICE_PROVISIONING,
			action="Transfer Device" if holder else "Assign Device",
			action_group_key=row.action_group_key,
			target_scope="Device",
			subject_key=row.subject_key,
			device_requirement_key=key,
			managed_device=row.managed_device,
		)

	@staticmethod
	def _plan_service_action(doc, row):
		"""One approved line, one act on one service.

		A line asking for a machine that does not exist yet is stored against the person,
		because there is no machine to store it against. The act itself is still an act on a
		machine, and the work order says so from the start rather than changing its mind
		once the machine is found.
		"""
		if request_intents.is_device_operation(row):
			return

		on_a_device = bool(row.is_new_device or row.managed_device)

		RequestExecutionService._work_order(
			doc,
			plan_key=f"{doc.name}:service:{row.name}",
			work_type=SERVICE_ACTION,
			action_group_key=row.action_group_key,
			action=row.action,
			operation_code=row.operation_code or operations.from_legacy_action(row.action),
			target_scope="Device" if on_a_device else row.target_scope,
			subject_key=row.subject_key,
			device_requirement_key=row.device_requirement_key,
			client_user=None if on_a_device else row.client_user,
			managed_device=row.managed_device if on_a_device else None,
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
					"service_request": doc.name,
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
		"""The whole of the work, grouped the way the technician works through it."""
		RequestService._guard_internal()

		doc = RequestExecutionService._request(request)
		orders = RequestExecutionService._orders(doc.name)
		ready = RequestExecutionService._readiness(orders)
		requirements = RequestExecutionService._requirements(doc, orders)

		for order in orders:
			ready[order.name]["requirements"] = requirements.get(order.name, [])

		groups = RequestExecutionService._groups(doc, orders, ready)

		return {
			"request": doc.name,
			"customer": doc.customer,
			"status": doc.status,
			"context": RequestExecutionService._context(doc, orders),
			"stages": RequestExecutionService._stages(doc, orders),
			"groups": groups,
			"action_groups": RequestExecutionService._action_groups(doc, orders, ready),
			"requirements": RequestExecutionService._requirement_summary(requirements),
			"recap": RequestExecutionService._recap(doc, orders, groups),
			"outcome": RequestExecutionService._outcome(doc, orders),
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
			filters={"service_request": request},
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
				"state_snapshot",
				"status",
				"target_scope",
				"subject_key",
				"action_group_key",
				"device_requirement_key",
				"request_line_name",
				"request_line_idx",
				"client_user",
				"managed_device",
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
	def _readiness(orders):
		"""Which work can be picked up now, and what the rest is waiting for.

		Waiting for the step before is not a problem, it is the shape of the job. It is said
		here as a derived fact and never written on the work order as a status: Blocked is
		reserved for something nobody planned for.
		"""
		setups = {
			order.subject_key: order for order in orders if order.work_type == USER_SETUP
		}
		provisions = {
			order.device_requirement_key: order
			for order in orders
			if order.work_type == DEVICE_PROVISIONING
		}

		ready = {}

		for order in orders:
			waiting = None

			setup = setups.get(order.subject_key)
			if setup and setup.name != order.name and setup.status != "Completed":
				waiting = "the person to be created"

			if not waiting and order.work_type != USER_SETUP:
				provision = provisions.get(order.device_requirement_key)
				if provision and provision.name != order.name and provision.status != "Completed":
					waiting = "the machine to be prepared"

			ready[order.name] = {"ready": waiting is None, "waiting_on": waiting}

		return ready

	@staticmethod
	def _requirements(doc, orders):
		"""What each unit of work is still owed before it can run, said by the server.

		Expected missing data is not an obstacle — it is the ordinary state of a request whose
		customer was never asked for a username or a serial. So it is reported as a requirement
		with the record that owns it, and never as `Blocked`, which is reserved for something
		nobody planned for.

		Requirements are named per owner rather than per work order: five services waiting on
		one person's username are one username to enter, not five.
		"""
		people, devices = {}, {}
		found = {}

		for order in orders:
			person = RequestExecutionService._person_card(doc, order.subject_key, orders)

			if person and person.get("name") and person["name"] not in people:
				people[person["name"]] = person

			target = order.resulting_device or order.managed_device

			if target and target not in devices:
				devices[target] = frappe.db.get_value(
					"MSP Managed Device",
					target,
					["name", "hostname", "serial_number", "status"],
					as_dict=True,
				)

			found[order.name] = RequestExecutionService._requirements_of(
				order, person, devices.get(target) if target else None
			)

		return found

	@staticmethod
	def _requirements_of(order, person, device):
		"""The requirements of one work order, in the shape every screen reads."""
		needed = []

		if order.status in ("Completed", "Cancelled"):
			return needed

		issuing = order.operation_code in ("service.add", "service.change")
		on_device = order.target_scope == "Device"

		if order.work_type == SERVICE_ACTION and issuing:
			scope = ServiceDefinitionService.scope_of(order.service_item)

			if not on_device or (scope == "Both" and person and person.get("name")):
				needed.append(
					{
						"key": f"username:{(person or {}).get('name') or order.subject_key}",
						"kind": "username",
						"blocking": True,
						"satisfied": bool((person or {}).get("username")),
						"owner_type": "MSP Client User",
						"owner_name": (person or {}).get("name"),
						"owner_label": (person or {}).get("full_name"),
						"label": "Username",
						"current_value": (person or {}).get("username"),
						"owner_department": (person or {}).get("department"),
						"owner_modified": str(
							frappe.db.get_value(
								"MSP Client User", (person or {}).get("name"), "modified"
							)
							or ""
						)
						if (person or {}).get("name")
						else None,
						"reason": "This service is issued against the person's username.",
						"can_batch_edit": bool((person or {}).get("name")),
					}
				)

			if on_device and device:
				needed.append(
					{
						"key": f"serial:{device['name']}",
						"kind": "serial_number",
						"blocking": True,
						"satisfied": bool(device.get("serial_number")),
						"owner_type": "MSP Managed Device",
						"owner_name": device["name"],
						"owner_label": device.get("hostname") or device["name"],
						"label": "Serial number",
						"current_value": device.get("serial_number"),
						"owner_department": None,
						"owner_modified": str(
							frappe.db.get_value("MSP Managed Device", device["name"], "modified") or ""
						),
						"reason": "A Device-scoped service is issued against the machine's serial.",
						"can_batch_edit": True,
					}
				)

		if order.work_type == USER_SETUP:
			needed.append(
				{
					"key": f"client_user:{order.subject_key}",
					"kind": "client_user_creation",
					"blocking": True,
					"satisfied": bool(order.resulting_client_user),
					"owner_type": "MSP Client User",
					"owner_name": order.resulting_client_user,
					"owner_label": (person or {}).get("full_name"),
					"owner_department": (person or {}).get("department"),
					# what the customer already told us they will be called on the service, so
					# the technician is not asked for it a second time
					"owner_username": (person or {}).get("username"),
					"owner_email": (person or {}).get("email"),
					"owner_modified": None,
					"subject_key": order.subject_key,
					"work_order": order.name,
					"label": "Client User",
					"current_value": order.resulting_client_user,
					"reason": "The person this work is for does not exist yet.",
					"can_batch_edit": True,
				}
			)

		if order.work_type == DEVICE_PROVISIONING:
			needed.append(
				{
					"key": f"device:{order.device_requirement_key}",
					"kind": "device_resolution",
					"blocking": True,
					"satisfied": order.status == "Completed",
					"owner_type": "MSP Managed Device",
					"owner_name": order.resulting_device or order.managed_device,
					"owner_label": (device or {}).get("hostname")
					or (person or {}).get("full_name")
					or "New Device",
					"owner_department": (person or {}).get("department"),
					"owner_modified": None,
					"subject_key": order.subject_key,
					"work_order": order.name,
					"label": "Device",
					"current_value": order.resulting_device or order.managed_device,
					"reason": "The machine this work needs is not settled yet.",
					"can_batch_edit": True,
				}
			)

		return needed

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
	def _groups(doc, orders, ready):
		"""The work, read person by person: who, then their machine, then their services."""
		lines = {row.name: row for row in doc.lines}
		order_of = {}

		for order in orders:
			order_of.setdefault(order.subject_key, []).append(order)

		groups = []

		for subject_key in RequestExecutionService._subject_order(doc):
			mine = order_of.get(subject_key, [])
			person = RequestExecutionService._person_card(doc, subject_key, mine)

			devices = {}
			for order in mine:
				if order.work_type != DEVICE_PROVISIONING:
					continue
				devices[order.device_requirement_key] = {
					"device_requirement_key": order.device_requirement_key,
					"device": RequestExecutionService._device_card(
						order.resulting_device or order.managed_device
					),
					"work": RequestExecutionService._card(order, ready, lines),
				}

			groups.append(
				{
					"subject_key": subject_key,
					"person": person,
					"user_setup": next(
						(
							RequestExecutionService._card(order, ready, lines)
							for order in mine
							if order.work_type == USER_SETUP
						),
						None,
					),
					"devices": list(devices.values()),
					"device_operations": [
						RequestExecutionService._card(order, ready, lines)
						for order in mine
						if order.work_type == DEVICE_OPERATION
					],
					"services": [
						RequestExecutionService._card(order, ready, lines)
						for order in mine
						if order.work_type == SERVICE_ACTION
					],
				}
			)

		return groups

	@staticmethod
	def _action_groups(doc, orders, ready):
		"""The same work, read act by act: what the customer asked for, and what is left to do.

		This is a second reading of one set of Work Orders, never a second set. The technician
		works through twenty additions at once or through one person at a time, and both views
		answer from the same records — so a target completed in one is completed in the other.
		"""
		lines = {row.name: row for row in doc.lines}
		named = {
			row.group_key: row for row in doc.get("action_groups") or []
		}
		by_group = {}

		for order in orders:
			by_group.setdefault(order.action_group_key or "", []).append(order)

		groups = []

		for key, mine in by_group.items():
			asked = named.get(key)
			cards = [RequestExecutionService._card(order, ready, lines) for order in mine]
			counted = {}

			for card in cards:
				counted[card["status"]] = counted.get(card["status"], 0) + 1

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
					"total": len(cards),
					"remaining": len(
						[card for card in cards if card["status"] in ("Open", "In Progress")]
					),
					"ready": len(
						[
							card
							for card in cards
							if card["status"] in ("Open", "In Progress") and card.get("ready")
						]
					),
					"needs_information": len(
						[
							card
							for card in cards
							if card["status"] in ("Open", "In Progress") and not card.get("ready")
						]
					),
					"by_status": counted,
					"work": cards,
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
			"requested_date": dates[0] if dates else None,
			"priority": doc.priority,
			"people": len({row.subject_key for row in doc.lines if row.subject_key}),
			"lines": len(doc.lines),
			"details": doc.details,
			"customer_approved": bool(doc.customer_approved_by) or doc.source == "Internal",
		}

	@staticmethod
	def _recap(doc, orders, groups):
		"""What was actually performed, read from the work orders that performed it.

		Nothing here is remembered by the screen: reload the page and the same recap comes
		back, because it is the record of the work and not a summary of the session.
		"""
		names = {
			group["subject_key"]: (group["person"] or {}).get("full_name") for group in groups
		}
		departments = {
			group["subject_key"]: (group["person"] or {}).get("department") for group in groups
		}
		action_labels = RequestExecutionService._action_labels()
		who = {}

		entries = []

		for order in orders:
			if order.status not in ("Completed", "Awaiting Verification"):
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

		return entries + RequestExecutionService._direct_acts(doc, orders, names, departments)

	# what the recap calls each act on a machine, once it has been carried out
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
	def _direct_acts(doc, orders, names, departments):
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

		return acts

	@staticmethod
	def _outcome(doc, orders):
		"""The figures the final validation reads: what was decided, and what was done."""
		services = [order for order in orders if order.work_type == SERVICE_ACTION]
		done = ("Completed", "Awaiting Verification")

		return {
			"accepted": len([row for row in doc.lines if row.line_status == "Approved"]),
			"rejected": len([row for row in doc.lines if row.line_status == "Rejected"]),
			"requested_done": len(
				[o for o in services if o.origin != "Technician" and o.status in done]
			),
			"technician_added": len([o for o in services if o.origin == "Technician"]),
			"technician_done": len(
				[o for o in services if o.origin == "Technician" and o.status in done]
			),
			"prepared": len(
				[
					o
					for o in orders
					if o.work_type in (USER_SETUP, DEVICE_PROVISIONING) and o.status in done
				]
			),
			"context_done": len(
				[o for o in orders if o.work_type == CONTEXT_ACTION and o.status in done]
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
	def _subject_order(doc):
		"""Each person once, in the order the request first speaks of them."""
		seen = []

		for row in doc.lines:
			if row.line_status != "Approved":
				continue
			if row.subject_key and row.subject_key not in seen:
				seen.append(row.subject_key)

		return seen

	@staticmethod
	def _person_card(doc, subject_key, orders):
		"""Who this group of work is for, as fully as the request can say it."""
		created = next(
			(order.resulting_client_user for order in orders if order.resulting_client_user), None
		)
		row = next((line for line in doc.lines if line.subject_key == subject_key), None)
		person = created or (row.client_user if row else None) or (
			row.requested_for_user if row else None
		)

		if person:
			card = frappe.db.get_value(
				"MSP Client User",
				person,
				["name", "full_name", "department", "email", "username", "lifecycle_status"],
				as_dict=True,
			)

			if card:
				card["is_new"] = False
				return card

		if not row:
			return None

		return {
			"name": None,
			"full_name": row.new_user_full_name,
			"department": row.new_user_department,
			# retired since the request was agreed: said, not enforced. Whoever is doing the
			# work decides whether it still makes sense, and the account opens either way
			"department_retired": RequestExecutionService._retired(row.new_user_department),
			"email": row.new_user_email,
			"username": row.new_user_username,
			"lifecycle_status": None,
			"is_new": True,
		}

	@staticmethod
	def _retired(department):
		if not department:
			return False

		enabled = frappe.db.get_value("MSP Department", {"department_name": department}, "enabled")

		return enabled == 0

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
	def _card(order, ready, lines):
		"""One unit of work, with everything the technician needs to carry it out in place."""
		card = dict(order)
		card.update(ready.get(order.name, {"ready": True, "waiting_on": None}))

		row = lines.get(order.request_line_name)

		if row:
			card["comment"] = row.comment
			card["requested_quantity"] = row.requested_quantity
			card["asked_hostname"] = row.new_device_label
			card["asked_serial"] = row.new_device_serial
			card["asked_device_type"] = row.new_device_type

		# preparing a machine answers no line of its own: what the customer said about the machine
		# is on the lines of the services waiting for it
		if order.work_type == DEVICE_PROVISIONING and order.device_requirement_key and not (
			card.get("asked_hostname") or card.get("asked_serial")
		):
			for line_name in frappe.get_all(
				WORK_ORDER,
				filters={
					"device_requirement_key": order.device_requirement_key,
					"request_line_name": ("in", list(lines) or [""]),
				},
				pluck="request_line_name",
			):
				asked = lines.get(line_name)
				if asked and (asked.new_device_label or asked.new_device_serial or asked.new_device_type):
					card["asked_hostname"] = asked.new_device_label
					card["asked_serial"] = asked.new_device_serial
					card["asked_device_type"] = asked.new_device_type
					break

		if order.work_type == DEVICE_OPERATION:
			card.update(RequestExecutionService._holder_facts(order, row))

		card["device"] = RequestExecutionService._device_card(
			order.resulting_device or order.managed_device
		)
		card["current"] = RequestExecutionService._current_service(order)
		card["service_scope"] = (
			RequestService._service_scope(order.service_item) if order.service_item else None
		)
		card["action_label"] = order.action_label or RequestExecutionService._action_labels().get(
			order.action, order.action
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
				"reference_doctype": ("in", (WORK_ORDER, "MSP Service Request")),
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
		return {
			"people": len([order for order in orders if order.work_type == USER_SETUP]),
			"devices": len(
				[
					order
					for order in orders
					if order.work_type in (DEVICE_PROVISIONING, DEVICE_OPERATION)
				]
			),
			"services": len([order for order in orders if order.work_type == SERVICE_ACTION]),
			"open": len([order for order in orders if order.status not in FINISHED_STATUSES]),
			"blocked": len([order for order in orders if order.status == "Blocked"]),
			"failed": len([order for order in orders if order.status == "Failed"]),
		}

	# ------------------------------------------------------------------ shared
	@staticmethod
	def _request(request):
		if not request:
			raise ValidationError("request is required.", "VALIDATION_ERROR")

		if not frappe.db.exists("MSP Service Request", request):
			raise NotFoundError(f"Service Request {request} not found.", "NOT_FOUND")

		return frappe.get_doc("MSP Service Request", request)

	@staticmethod
	def _person_of(row):
		"""The person a line is for, whether it names them or the machine they were given."""
		return row.client_user or row.requested_for_user or None

	# ------------------------------------------------------------------ carrying it out
	@staticmethod
	def execute_user_setup(
		work_order=None, username=None, email=None, department=None, notes=None
	):
		"""Open the account for the person a request described, once for all their lines.

		The person is created through the domain that owns people, and every line and every
		job that spoke of them by name now speaks of their record instead.
		"""
		from nexgen_msp.api.internal.services.user_service import UserService

		order = RequestExecutionService._claimed(work_order, USER_SETUP)
		doc = frappe.get_doc("MSP Service Request", order.service_request)
		rows = [row for row in doc.lines if row.subject_key == order.subject_key]

		if not rows:
			raise ValidationError("This request no longer describes that person.", "VALIDATION_ERROR")

		asked = rows[0]
		savepoint = "execute_user_setup"
		frappe.db.savepoint(savepoint)

		try:
			created = UserService.create_client_user(
				customer=doc.customer,
				full_name=asked.new_user_full_name,
				department=department or asked.new_user_department,
				email=email or asked.new_user_email,
				username=username or asked.new_user_username,
				source_request=doc.name,
				# what the request agreed to stands, even if the catalogue has moved on
				department_already_agreed=not department,
				_commit=False,
			)

			RequestExecutionService._propagate_person(doc, order.subject_key, created["name"])

			order.resulting_client_user = created["name"]
			order.client_user = created["name"]
			order.execution_notes = notes or order.execution_notes
			RequestExecutionService._settle(order, proven=RequestExecutionService._prove_user_setup)
		except Exception:
			frappe.db.rollback(save_point=savepoint)
			raise

		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(doc.name)

	@staticmethod
	def execute_device_provisioning(
		work_order=None,
		mode=None,
		managed_device=None,
		hostname=None,
		serial_number=None,
		device_type=None,
		interfaces=None,
		effective_date=None,
		confirm_transfer=None,
		notes=None,
		manufacturer=None,
		model=None,
		operating_system=None,
	):
		"""Settle the machine a request needs: one already on the shelf, or a new one.

		Handing a machine over is never silent. A machine somebody else is holding is only
		moved once whoever is doing the work has said so in as many words, and the move goes
		through the domain that owns machines so the two holding periods read correctly.
		"""
		from nexgen_msp.api.internal.services.device_lifecycle_service import (
			DeviceLifecycleService,
		)

		order = RequestExecutionService._claimed(work_order, DEVICE_PROVISIONING)
		doc = frappe.get_doc("MSP Service Request", order.service_request)
		rows = [
			row for row in doc.lines if row.device_requirement_key == order.device_requirement_key
		]

		if not rows:
			raise ValidationError("This request no longer needs that machine.", "VALIDATION_ERROR")

		person = RequestExecutionService._resolved_person(doc, order.subject_key)
		mode = mode or ("existing" if order.managed_device else "new")
		savepoint = "execute_device_provisioning"
		frappe.db.savepoint(savepoint)

		try:
			if mode == "new":
				device = RequestExecutionService._register_device(
					doc.customer, hostname, serial_number, device_type, interfaces,
					manufacturer=manufacturer, model=model, operating_system=operating_system,
				)
				action = "Register Device"
			else:
				device = managed_device or order.managed_device

				if not device:
					raise ValidationError("Say which machine.", "VALIDATION_ERROR")

				RequestExecutionService._owned_device(doc.customer, device)
				RequestExecutionService._fill_serial(device, serial_number)
				action = "Assign Device"

			if person:
				holder = frappe.db.get_value("MSP Managed Device", device, "assigned_client_user")

				if holder and holder != person:
					if not frappe.utils.cint(confirm_transfer):
						raise ValidationError(
							f"{frappe.db.get_value('MSP Managed Device', device, 'hostname')} is "
							f"held by {frappe.db.get_value('MSP Client User', holder, 'full_name')}. "
							"Transferring it closes their holding period.",
							"CONFIRMATION_REQUIRED",
						)

					DeviceLifecycleService.transfer(
						device=device,
						client_user=person,
						effective_date=effective_date,
						_commit=False,
					)
					action = "Transfer Device"
				elif not holder:
					DeviceLifecycleService.assign(
						device=device,
						client_user=person,
						effective_date=effective_date,
						_commit=False,
					)

			RequestExecutionService._propagate_device(doc, order.device_requirement_key, device)

			order.action = action
			order.managed_device = device
			order.resulting_device = device
			order.effective_date = effective_date or frappe.utils.today()
			order.execution_notes = notes or order.execution_notes
			RequestExecutionService._settle(order, proven=RequestExecutionService._prove_device)
		except Exception:
			frappe.db.rollback(save_point=savepoint)
			raise

		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(doc.name)

	@staticmethod
	def execute_device_operation(
		work_order=None,
		effective_date=None,
		execution_holder=None,
		override_reason=None,
		notes=None,
		customer_note=None,
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
		doc = frappe.get_doc("MSP Service Request", order.service_request)
		definition = operations.require(
			order.operation_code or operations.from_legacy_work(order.action)
		)
		code = definition["code"]
		device = order.managed_device

		if not device:
			raise ValidationError("The machine is not settled yet.", "VALIDATION_ERROR")

		RequestExecutionService._owned_device(doc.customer, device)

		before = operations.snapshot_device(device)
		on_date = effective_date or order.effective_date or frappe.utils.today()

		RequestExecutionService._revalidate_device_state(order, before)

		holder = None

		if code in ("device.assign", "device.transfer"):
			holder = execution_holder or order.requested_holder

			if not holder:
				raise ValidationError("Say who is to hold this Device.", "VALIDATION_ERROR")

			RequestExecutionService._receivable_holder(doc.customer, holder)

			if order.requested_holder and holder != order.requested_holder:
				reason = (override_reason or "").strip()

				if not reason:
					raise ValidationError(
						"Explain why Nexgen is executing the transfer to a different person.",
						"VALIDATION_ERROR",
					)

				order.override_reason = reason

		savepoint = "execute_device_operation"
		frappe.db.savepoint(savepoint)

		try:
			if code == "device.assign":
				DeviceLifecycleService.assign(
					device=device, client_user=holder, effective_date=on_date, note=notes,
					_commit=False,
				)
			elif code == "device.transfer":
				DeviceLifecycleService.transfer(
					device=device, client_user=holder, effective_date=on_date, note=notes,
					_commit=False,
				)
			elif code == "device.repossess":
				DeviceLifecycleService.repossess(
					device=device, effective_date=on_date, note=notes, _commit=False
				)
			elif code == "device.retire":
				DeviceLifecycleService.retire(
					device=device, effective_date=on_date, note=notes, _commit=False
				)
			elif code == "device.reinstate":
				DeviceLifecycleService.reinstate(
					device=device, effective_date=on_date, note=notes, _commit=False
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

		return RequestExecutionService.get_execution_plan(doc.name)

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
				"MSP Service Request Line", order.request_line_name, "state_snapshot"
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
		doc = frappe.get_doc("MSP Service Request", order.service_request)
		on_date = effective_date or order.effective_date or frappe.utils.today()

		if order.target_scope == "User" and not order.client_user:
			raise ValidationError("The person is not on file yet.", "VALIDATION_ERROR")

		if order.target_scope == "Device" and not order.managed_device:
			raise ValidationError("The machine is not settled yet.", "VALIDATION_ERROR")

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
					)
				elif order.action == "Resume":
					outcome = ServiceLifecycleService.resume(
						assignment=assignment,
						effective_date=on_date,
						source_request=doc.name,
						notes=notes,
						confirm_billed=confirm_billed,
						_commit=False,
					)
				elif order.action == "Remove":
					outcome = ServiceLifecycleService.end(
						assignment=assignment,
						effective_date=on_date,
						source_request=doc.name,
						notes=notes,
						_commit=False,
					)
				else:
					outcome = ServiceLifecycleService.change(
						assignment=assignment,
						effective_date=on_date,
						quantity=quantity,
						service_item=service_item or None,
						source_request=doc.name,
						notes=notes,
						_commit=False,
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

		return RequestExecutionService.get_execution_plan(doc.name)

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
			frappe.db.get_value(WORK_ORDER, name, "service_request") for name in work_orders
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
					work_order=name, effective_date=effective_date, confirm_billed=confirm_billed
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
				fields=["name", "service_request", "work_type", "status"],
			)
		}

		for name in names:
			order = orders.get(name)

			if not order or order.service_request != doc.name:
				raise ValidationError(
					"Work from several requests cannot be carried out together.",
					"VALIDATION_ERROR",
				)

		runner = {
			SERVICE_ACTION: RequestExecutionService.execute_service_action,
			DEVICE_OPERATION: RequestExecutionService.execute_device_operation,
			USER_SETUP: RequestExecutionService.execute_user_setup,
			DEVICE_PROVISIONING: RequestExecutionService.execute_device_provisioning,
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
				execute(work_order=name, **(row.get("inputs") or {}))
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
		saved stays saved — there is no second draft of a username hiding anywhere, because
		the Client User can hold it perfectly well itself.

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

			doctype = "MSP Client User" if kind == "username" else "MSP Managed Device"

			try:
				if not frappe.db.exists(doctype, owner):
					raise ValidationError(f"{owner} no longer exists.", "NOT_FOUND")

				seen = row.get("modified")
				now = str(frappe.db.get_value(doctype, owner, "modified") or "")

				if seen and str(seen) != now:
					raise ValidationError(
						"Some information changed while this dialog was open. Refresh the "
						"affected rows before saving again.",
						"PREPARATION_STATE_CHANGED",
					)

				if kind == "username":
					try:
						identifiers.record_username(owner, value, overwrite=True)
					except Exception as refusal:
						raise RequestExecutionService._identifier_refusal(
							refusal,
							"USERNAME_CONFLICT",
							f'Username "{value}" is already used by another Client User for '
							"this Customer.",
						)
				elif kind == "serial_number":
					try:
						identifiers.record_serial(owner, value, overwrite=True)
					except Exception as refusal:
						raise RequestExecutionService._identifier_refusal(
							refusal,
							"SERIAL_CONFLICT",
							f'Serial number "{value}" is already used by another Managed Device.',
						)
				else:
					raise ValidationError(f"{kind} cannot be entered here.", "VALIDATION_ERROR")

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
	def technician_options(request=None, subject_key=None):
		"""What else a technician may do for this person while the request is open.

		Read from what the person and their machines hold today, never from a list kept on
		the screen: a service already running offers the acts its state allows, a service
		that may be sold offers to be added, and anything already in this request's work is
		left out so the same thing is not planned twice.
		"""
		from nexgen_msp.api.internal.services.service_availability_service import (
			ServiceAvailabilityService,
		)

		RequestService._guard_internal()
		doc = RequestExecutionService._request(request)
		person = RequestExecutionService._resolved_person(doc, subject_key)

		if not person:
			return {
				"subject_key": subject_key,
				"options": [],
				"reason": "Create the Client User first.",
			}

		open_orders = [
			o for o in RequestExecutionService._orders(doc.name) if o.status not in FINISHED_STATUSES
		]
		planned = {
			(o.service_item, o.action, o.client_user or "", o.managed_device or "", o.source_service_assignment or "")
			for o in open_orders
			if o.work_type == SERVICE_ACTION
		}
		planned_machines = {
			(o.managed_device, o.operation_code)
			for o in open_orders
			if o.work_type == DEVICE_OPERATION
		}
		options = []

		def offer(service_item, service_name, action, scope, device=None, device_label=None, assignment=None, state=None):
			mechanical_key = (
				service_item,
				action,
				person if scope == "User" else "",
				device or "",
				assignment or "",
			)

			if mechanical_key in planned:
				return

			code = operations.from_legacy_action(action)
			definition = operations.get(code)

			if not definition or not definition["technician_addable"]:
				return

			options.append(
				{
					"key": "|".join((*mechanical_key, code)),
					"service_item": service_item,
					"service_name": service_name,
					"action": action,
					"operation_code": code,
					"action_label": definition["label"],
					"description": definition["description"],
					"target_scope": scope,
					"managed_device": device,
					"device_label": device_label,
					"source_service_assignment": assignment,
					"current_state": state or "Not assigned",
				}
			)

		def offer_machine(device, device_label, code, state):
			"""An act on the machine itself, offered for the state that machine is in."""
			definition = operations.get(code)

			if not definition or not definition["technician_addable"]:
				return

			if (device, code) in planned_machines:
				return

			options.append(
				{
					"key": "|".join(("", "", "", device, "", code)),
					"service_item": None,
					"service_name": device_label,
					"action": operations.work_action(code),
					"operation_code": code,
					"action_label": definition["label"],
					"description": definition["description"],
					"target_scope": "Device",
					"managed_device": device,
					"device_label": device_label,
					"source_service_assignment": None,
					"current_state": state,
				}
			)

		reading = ServiceAvailabilityService.read_user(person)

		for row in reading["current"]:
			for code in operations.for_service_state(row["operational_status"]):
				offer(
					row["service_item"],
					row["item_name"],
					operations.get(code)["legacy_action"],
					"User",
					assignment=row["name"],
					state=row["operational_status"],
				)

		for row in reading["available"]:
			offer(row["service_item"], row["item_name"], "Add", "User")

		for device in frappe.get_all(
			"MSP Device Holder",
			filters={"client_user": person, "is_current": 1, "parenttype": "MSP Managed Device"},
			pluck="parent",
		):
			machine = ServiceAvailabilityService.read_device(device)
			label = machine["target"]["label"]

			for row in machine["current"]:
				for code in operations.for_service_state(row["operational_status"]):
					offer(
						row["service_item"],
						row["item_name"],
						operations.get(code)["legacy_action"],
						"Device",
						device,
						label,
						row["name"],
						row["operational_status"],
					)

			for row in machine["available"]:
				offer(row["service_item"], row["item_name"], "Add", "Device", device, label)

			status = frappe.db.get_value("MSP Managed Device", device, "status")

			for code in operations.for_device_state(status):
				offer_machine(device, label, code, status)

		return {"subject_key": subject_key, "options": options, "reason": None}

	@staticmethod
	def add_technician_action(request=None, subject_key=None, option=None, reason=None):
		"""Add work the request did not ask for, because the job on the ground needs it.

		It never becomes a line of the customer's request. It is a work order of its own,
		marked as the technician's, carrying who added it and why, and it is carried out
		through exactly the same door as the work that was asked for.
		"""
		RequestService._guard_internal()
		doc = RequestExecutionService._request(request)

		if doc.status not in ("Approved", "In Progress"):
			raise ValidationError(
				f"Work can only be added to a request being carried out; this one is {doc.status.lower()}.",
				"INVALID_TRANSITION",
			)

		reason = (reason or "").strip()

		if not reason:
			raise ValidationError("Say why this action is needed.", "VALIDATION_ERROR")

		option = frappe.parse_json(option) if isinstance(option, str) else (option or {})
		offered = {
			row["key"]: row
			for row in RequestExecutionService.technician_options(doc.name, subject_key)["options"]
		}
		chosen = offered.get(option.get("key"))

		if not chosen:
			raise ValidationError(
				"That action is no longer available for this person. The list has been refreshed.",
				"STALE_STATE",
			)

		person = RequestExecutionService._resolved_person(doc, subject_key)
		on_device = chosen["target_scope"] == "Device"

		if operations.require(chosen["operation_code"])["domain"] == operations.DEVICE:
			name = RequestExecutionService._work_order(
				doc,
				plan_key=f"{doc.name}:technician:{frappe.generate_hash(length=12)}",
				work_type=DEVICE_OPERATION,
				origin="Technician",
				technician_reason=reason,
				action=operations.work_action(chosen["operation_code"]),
				operation_code=chosen["operation_code"],
				target_scope="Device",
				subject_key=subject_key,
				device_requirement_key=f"device:{chosen['managed_device']}",
				managed_device=chosen["managed_device"],
				effective_date=frappe.utils.today(),
			)

			frappe.get_doc(WORK_ORDER, name).add_comment(
				"Comment", f"Added by the technician: {reason}"
			)
			frappe.db.commit()

			return RequestExecutionService.get_execution_plan(doc.name)

		name = RequestExecutionService._work_order(
			doc,
			plan_key=f"{doc.name}:technician:{frappe.generate_hash(length=12)}",
			work_type=SERVICE_ACTION,
			origin="Technician",
			technician_reason=reason,
			action=chosen["action"],
			operation_code=chosen["operation_code"],
			target_scope=chosen["target_scope"],
			subject_key=subject_key,
			device_requirement_key=f"device:{chosen['managed_device']}" if on_device else None,
			client_user=None if on_device else person,
			managed_device=chosen["managed_device"] if on_device else None,
			service_item=chosen["service_item"],
			source_service_assignment=chosen["source_service_assignment"],
			effective_date=frappe.utils.today(),
		)

		frappe.get_doc(WORK_ORDER, name).add_comment(
			"Comment", f"Added by the technician: {reason}"
		)
		frappe.db.commit()

		return RequestExecutionService.get_execution_plan(doc.name)

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
				"service_request": doc.name,
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
		from nexgen_msp.utils import identifiers

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

	# ------------------------------------------------------------------ propagation
	@staticmethod
	def _propagate_person(doc, subject_key, client_user):
		"""Everything that spoke of a person by name now speaks of their record.

		A line that lands on a machine keeps naming the machine: the person is held beside
		it, so the line does not lose them the day the machine changes hands.
		"""
		for row in doc.lines:
			if row.subject_key != subject_key:
				continue

			row.db_set("is_new_user", 0)
			row.db_set("requested_for_user", client_user)

			if row.target_scope == "User" and not row.is_new_device:
				row.db_set("client_user", client_user)

		for order in frappe.get_all(
			WORK_ORDER,
			filters={"service_request": doc.name, "subject_key": subject_key},
			fields=["name", "work_type", "target_scope", "client_user"],
		):
			if order.work_type == SERVICE_ACTION and order.target_scope == "User":
				frappe.db.set_value(WORK_ORDER, order.name, "client_user", client_user)

	@staticmethod
	def _propagate_device(doc, requirement_key, device):
		"""Every service owed to one machine now names the machine that was settled."""
		for row in doc.lines:
			if row.device_requirement_key != requirement_key:
				continue

			row.db_set("is_new_device", 0)
			row.db_set("managed_device", device)
			row.db_set("target_scope", "Device")
			row.db_set("client_user", None)

		for order in frappe.get_all(
			WORK_ORDER,
			filters={"service_request": doc.name, "device_requirement_key": requirement_key},
			fields=["name", "work_type"],
		):
			if order.work_type != SERVICE_ACTION:
				continue

			frappe.db.set_value(
				WORK_ORDER,
				order.name,
				{"target_scope": "Device", "managed_device": device, "client_user": None},
			)

	@staticmethod
	def _resolved_person(doc, subject_key):
		"""Who this work is for, now that the plan has been running for a while."""
		if not subject_key:
			return None

		if subject_key.startswith("user:"):
			return subject_key.split(":", 1)[1]

		created = frappe.db.get_value(
			WORK_ORDER,
			{"service_request": doc.name, "work_type": USER_SETUP, "subject_key": subject_key},
			"resulting_client_user",
		)

		return created or None

	@staticmethod
	def _asked_quantity(doc, order):
		row = next((line for line in doc.lines if line.name == order.request_line_name), None)

		return (row.requested_quantity if row else None) or 1

	# ------------------------------------------------------------------ registering a machine
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

	@staticmethod
	def _fill_serial(device, serial_number):
		"""A machine from the shelf with no serial on file gets the one read off its case."""
		if (frappe.db.get_value("MSP Managed Device", device, "serial_number") or "").strip():
			return

		serial = (serial_number or "").strip()

		if not serial:
			raise ValidationError(
				"This machine has no serial number on file. Enter the one on its case.",
				"VALIDATION_ERROR",
			)

		twin = frappe.db.get_value(
			"MSP Managed Device",
			{"serial_number": serial, "name": ("!=", device)},
			["hostname", "customer"],
			as_dict=True,
		)

		if twin:
			raise ValidationError(
				f"Serial number {serial} is already on {twin.hostname} ({twin.customer}).",
				"VALIDATION_ERROR",
			)

		frappe.db.set_value("MSP Managed Device", device, "serial_number", serial)

	@staticmethod
	def _register_device(
		customer, hostname, serial_number, device_type, interfaces,
		manufacturer=None, model=None, operating_system=None,
	):
		"""Put a machine on file. It reaches its holder through the device domain, not here."""
		hostname = (hostname or "").strip()
		serial_number = (serial_number or "").strip()

		if not hostname:
			raise ValidationError("A hostname is required.", "VALIDATION_ERROR")

		if not serial_number:
			raise ValidationError(
				"A serial number is required: it is what identifies the machine.",
				"VALIDATION_ERROR",
			)

		twin = frappe.db.get_value(
			"MSP Managed Device",
			{"serial_number": serial_number},
			["hostname", "customer"],
			as_dict=True,
		)

		if twin:
			raise ValidationError(
				f"Serial number {serial_number} is already on {twin.hostname} ({twin.customer}).",
				"VALIDATION_ERROR",
			)

		device = frappe.get_doc(
			{
				"doctype": "MSP Managed Device",
				"customer": customer,
				"hostname": hostname.upper(),
				"serial_number": serial_number,
				"device_type": device_type or "Other",
				"status": "Stock",
				"manufacturer": (manufacturer or "").strip() or None,
				"model": (model or "").strip() or None,
				"operating_system": (operating_system or "").strip() or None,
				"network_interfaces": [
					{
						"interface_type": interface.get("interface_type") or "Other",
						"mac_address": (interface.get("mac_address") or "").strip().upper(),
					}
					for interface in (frappe.parse_json(interfaces) or [])
				],
			}
		).insert()

		return device.name

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

		waiting = RequestExecutionService._waiting_on(order)

		if waiting:
			raise ValidationError(f"This work is waiting for {waiting}.", "INVALID_TRANSITION")

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
	def _waiting_on(order):
		"""Read fresh: the plan the technician is looking at may be a minute old."""
		orders = RequestExecutionService._orders(order.service_request)
		ready = RequestExecutionService._readiness(orders)

		return ready.get(order.name, {}).get("waiting_on")

	# ------------------------------------------------------------------ what was proven
	@staticmethod
	def _prove_user_setup(order):
		person = order.resulting_client_user
		card = frappe.db.get_value(
			"MSP Client User", person, ["full_name", "department", "username"], as_dict=True
		)

		checks = [("Client user on file", bool(card))]

		if card:
			# the customer is never asked for a Department, but the person ends up with one:
			# it is settled by whoever creates them, and the work is not done until it is
			checks.append(("Department recorded", bool(card.department)))

			if card.username:
				checks.append(("Username recorded", True))

		return checks

	@staticmethod
	def _prove_device(order):
		device = order.resulting_device
		card = frappe.db.get_value(
			"MSP Managed Device",
			device,
			["hostname", "serial_number", "assigned_client_user"],
			as_dict=True,
		)

		checks = [
			("Device on file", bool(card)),
			("Serial number recorded", bool(card and (card.serial_number or "").strip())),
		]

		person = RequestExecutionService._resolved_person(
			frappe.get_doc("MSP Service Request", order.service_request), order.subject_key
		)

		if person:
			checks.append(
				("Held by the right person", bool(card) and card.assigned_client_user == person)
			)

		return checks

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

		frappe.db.set_value("MSP Service Request", doc.name, "status", "In Progress")
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

		return RequestExecutionService.get_execution_plan(order.service_request)

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

		return RequestExecutionService.get_execution_plan(order.service_request)

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

		return RequestExecutionService.get_execution_plan(order.service_request)

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

		return RequestExecutionService.get_execution_plan(order.service_request)

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

		return RequestExecutionService.get_execution_plan(order.service_request)

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
				"This request cannot be closed yet — " + "; ".join(waiting) + ".",
				"VALIDATION_ERROR",
			)

	@staticmethod
	def _order(work_order):
		if not work_order:
			raise ValidationError("work_order is required.", "VALIDATION_ERROR")

		if not frappe.db.exists(WORK_ORDER, work_order):
			raise NotFoundError(f"Work Order {work_order} not found.", "NOT_FOUND")

		return frappe.get_doc(WORK_ORDER, work_order)
