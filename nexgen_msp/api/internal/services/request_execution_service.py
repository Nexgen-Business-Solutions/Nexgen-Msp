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
from nexgen_msp.utils.errors import NotFoundError, ValidationError

WORK_ORDER = "MSP Service Work Order"

SERVICE_ACTION = "Service Action"
USER_SETUP = "User Setup"
DEVICE_PROVISIONING = "Device Provisioning"

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
	def _plan_device_provisioning(doc, row):
		"""A machine a line needs that is not settled: not found yet, or held by somebody else.

		Handing a machine from one person to the next is never silent. It is work of its own,
		visible before anything is activated on that machine.
		"""
		key = row.device_requirement_key

		if not key:
			return

		if row.is_new_device and not row.managed_device:
			RequestExecutionService._work_order(
				doc,
				plan_key=f"{doc.name}:device:{key}",
				work_type=DEVICE_PROVISIONING,
				action="Register Device",
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
			target_scope="Device",
			subject_key=row.subject_key,
			device_requirement_key=key,
			managed_device=row.managed_device,
		)

	@staticmethod
	def _plan_service_action(doc, row):
		"""One approved line, one act on one service."""
		RequestExecutionService._work_order(
			doc,
			plan_key=f"{doc.name}:service:{row.name}",
			work_type=SERVICE_ACTION,
			action=row.action,
			target_scope=row.target_scope,
			subject_key=row.subject_key,
			device_requirement_key=row.device_requirement_key,
			client_user=row.client_user if row.target_scope == "User" else None,
			managed_device=row.managed_device if row.target_scope == "Device" else None,
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

		groups = RequestExecutionService._groups(doc, orders, ready)

		return {
			"request": doc.name,
			"customer": doc.customer,
			"status": doc.status,
			"stages": RequestExecutionService._stages(doc, orders),
			"groups": groups,
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
				"action",
				"status",
				"target_scope",
				"subject_key",
				"device_requirement_key",
				"request_line_name",
				"request_line_idx",
				"client_user",
				"managed_device",
				"service_item",
				"source_service_assignment",
				"effective_date",
				"assigned_technician",
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

		for order in orders:
			order["service_name"] = (
				frappe.db.get_value("Item", order.service_item, "item_name") or order.service_item
			)
			order["assigned_technician_name"] = (
				frappe.db.get_value("User", order.assigned_technician, "full_name")
				if order.assigned_technician
				else None
			)
			order["checklist"] = frappe.get_all(
				"MSP Work Order Checklist Item",
				filters={"parent": order.name},
				fields=["name", "idx", "step", "is_done", "note"],
				order_by="idx asc",
			)

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
					"services": [
						RequestExecutionService._card(order, ready, lines)
						for order in mine
						if order.work_type == SERVICE_ACTION
					],
				}
			)

		return groups

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
			"email": row.new_user_email,
			"username": row.new_user_username,
			"lifecycle_status": None,
			"is_new": True,
			"needs_portal_access": bool(row.needs_portal_access),
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

		card["device"] = RequestExecutionService._device_card(
			order.resulting_device or order.managed_device
		)
		card["current"] = RequestExecutionService._current_service(order)

		return card

	@staticmethod
	def _current_service(order):
		"""What the service being acted on is doing today, so the act is read in context."""
		if order.work_type != SERVICE_ACTION or not order.source_service_assignment:
			return None

		return frappe.db.get_value(
			"MSP Service Assignment",
			order.source_service_assignment,
			[
				"name",
				"operational_status",
				"quantity",
				"effective_start_date",
				"effective_end_date",
			],
			as_dict=True,
		)

	# ------------------------------------------------------------------ the stepper
	@staticmethod
	def _stages(doc, orders):
		"""The five phases of the job, and which one the request is actually in.

		A phase with nothing in it is not walked through; it is marked as not needed and the
		technician goes straight past it.
		"""
		preparation = [
			order for order in orders if order.work_type in (USER_SETUP, DEVICE_PROVISIONING)
		]
		services = [order for order in orders if order.work_type == SERVICE_ACTION]

		reviewed = doc.status not in ("Submitted", "Under Review")
		prepared = all(order.status in FINISHED_STATUSES for order in preparation)
		executed = all(
			order.status in FINISHED_STATUSES + ("Awaiting Verification",) for order in services
		)
		verified = bool(services) and all(order.status in FINISHED_STATUSES for order in services)
		completed = doc.status == "Completed"

		stages = [
			{"key": "review", "label": "Review", "done": reviewed, "needed": True},
			{
				"key": "prepare",
				"label": "Prepare",
				"done": reviewed and prepared,
				"needed": bool(preparation),
			},
			{
				"key": "execute",
				"label": "Execute",
				"done": reviewed and prepared and executed,
				"needed": bool(services),
			},
			{
				"key": "verify",
				"label": "Verify",
				"done": reviewed and verified,
				"needed": bool(services),
			},
			{"key": "complete", "label": "Complete", "done": completed, "needed": True},
		]

		current = next(
			(stage["key"] for stage in stages if stage["needed"] and not stage["done"]),
			"complete",
		)

		for stage in stages:
			stage["state"] = (
				"skipped"
				if not stage["needed"]
				else "done"
				if stage["done"]
				else "current"
				if stage["key"] == current
				else "todo"
			)

		return {"stages": stages, "current": current}

	@staticmethod
	def _summary(orders):
		return {
			"people": len([order for order in orders if order.work_type == USER_SETUP]),
			"devices": len([order for order in orders if order.work_type == DEVICE_PROVISIONING]),
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
