"""Give historical requests the Requested Client Users and Requested Devices their data proves."""

import frappe

from nexgen_msp.api.internal.services.department_service import DepartmentService
from nexgen_msp.api.internal.services.requested_client_user_service import (
	REQUESTER_FIELDS as PERSON_FIELDS,
)
from nexgen_msp.api.internal.services.requested_device_service import (
	REQUESTER_FIELDS as DEVICE_FIELDS,
)
from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService
from nexgen_msp.nexgen_msp.doctype.msp_requested_client_user.msp_requested_client_user import (
	source_key_for as person_source_key,
)
from nexgen_msp.nexgen_msp.doctype.msp_requested_device.msp_requested_device import (
	source_key_for as device_source_key,
)
from nexgen_msp.utils import request_targets

REQUEST = "MSP Request"
SUBJECT = "MSP Request Subject"
LINE = "MSP Request Line"
WORK_ORDER = "MSP Work Order"
CLIENT_USER = "MSP Client User"
MANAGED_DEVICE = "MSP Managed Device"
REQUESTED_CLIENT_USER = request_targets.REQUESTED_CLIENT_USER
REQUESTED_DEVICE = request_targets.REQUESTED_DEVICE

USER_SETUP = "User Setup"
DEVICE_PROVISIONING = "Device Provisioning"
DEVICE_OPERATION = "Device Operation"
HANDED_OVER = ("device.assign", "device.transfer")
NAMED_KEY = "new-user:"
OPAQUE_KEY = "new-user:request:"
DEVICE_KEY = "new-device:"
DEVICE_MODES = {
	"Register Device": "Register New",
	"Assign Device": "Use Existing",
	"Transfer Device": "Use Existing",
}

REAL_FIELD = {
	"requested_client_user": "client_user",
	"requested_for_requested_client_user": "requested_for_user",
	"requested_device": "managed_device",
	"requested_holder_requested_client_user": "requested_holder",
}

SUBJECT_FIELDS = ("name", "idx", "subject_key", "client_user", "requested_client_user")
SUBJECT_HISTORY = (
	"is_new_user",
	"full_name_snapshot",
	"department_snapshot",
	"email_snapshot",
	"username_snapshot",
)
LINE_FIELDS = (
	"name",
	"idx",
	"target_scope",
	"client_user",
	"requested_client_user",
	"requested_for_user",
	"requested_for_requested_client_user",
	"managed_device",
	"requested_device",
	"requested_holder",
	"requested_holder_requested_client_user",
	"requested_effective_date",
	"operation_code",
	"action_group_key",
	"subject_key",
	"device_requirement_key",
)
LINE_HISTORY = (
	"is_new_user",
	"new_user_full_name",
	"new_user_department",
	"new_user_email",
	"new_user_username",
	"is_new_device",
	"new_device_label",
	"new_device_type",
	"new_device_serial",
)
ORDER_FIELDS = (
	"name",
	"work_type",
	"status",
	"action",
	"target_scope",
	"subject_key",
	"device_requirement_key",
	"request_line_name",
	"client_user",
	"managed_device",
	"requested_holder",
	"requested_client_user",
	"requested_device",
	"requested_holder_requested_client_user",
	"resulting_client_user",
	"resulting_device",
	"completed_by",
	"completed_at",
)

COUNTERS = (
	"requested client users created",
	"requested client users already present",
	"requested devices created",
	"requested devices already present",
	"subjects linked",
	"request lines linked",
	"work orders linked",
	"historical resolutions recovered",
	"requested dates backfilled",
	"keys aligned",
	"ambiguous historical relations skipped",
	"values kept in the requested snapshot only",
	"historical work orders turned into device operations",
	"historical work orders settled",
	"historical work orders cancelled",
)

RETIRED_TYPES = (USER_SETUP, DEVICE_PROVISIONING)
SETTLED_STATUSES = ("Completed", "Cancelled", "Awaiting Verification")
SUPERSEDED = "Superseded by the requested entity model."


def execute(requests=None):
	"""Create the Requested entities the historical requests prove, and link them."""
	report = _run(requests, write=True)
	frappe.db.commit()
	_print(report)

	return report


def preview(requests=None):
	"""What execute would produce, computed without writing anything."""
	return _run(requests, write=False)


def _run(requests, write):
	counters = {key: 0 for key in COUNTERS}
	log = []

	if requests is None:
		names = frappe.get_all(REQUEST, pluck="name")
	else:
		names = [name for name in requests if frappe.db.exists(REQUEST, name)]

	for name in sorted(names):
		_Migration(name, write, counters, log).run()

	counters["ambiguous historical relations skipped"] = len([row for row in log if row["kind"] == "skipped"])
	counters["values kept in the requested snapshot only"] = len([row for row in log if row["kind"] == "note"])

	return {"counters": counters, "ambiguities": log}


def _print(report):
	print("Requested entities:")

	for key, value in report["counters"].items():
		print(f"  {key}: {value}")

	for row in report["ambiguities"]:
		print(
			f"  [{row['kind']}] {row['request']} {row['key'] or '-'} "
			f"{', '.join(row['records']) or '-'}: {row['reason']}"
		)


def _rows(doctype, parent, fields, history):
	columns = [f"`{field}`" for field in fields] + [
		f"`{field}`" if frappe.db.has_column(doctype, field) else f"null as `{field}`" for field in history
	]

	return frappe.db.sql(
		f"select {', '.join(columns)} from `tab{doctype}` where parent = %s and parenttype = %s order by idx asc",
		(parent, REQUEST),
		as_dict=True,
	)


def _text(value):
	return " ".join(str(value).split()) if value not in (None, "") else None


def _slug(value):
	return " ".join((value or "").split()).casefold()


def _historical_device_key(line):
	"""The key the former rule gave a line that asks for a device still to be found."""
	if not line.is_new_device:
		return None

	group = (line.get("action_group_key") or "").strip()
	subject = (line.get("subject_key") or "").strip()

	if (line.get("operation_code") or "") == "device.assign" and group:
		return f"{DEVICE_KEY}{group}"

	return f"{DEVICE_KEY}{subject}" if subject else None


class _Migration:
	"""One historical request read, and what it proves written."""

	def __init__(self, name, write, counters, log):
		self.write = write
		self.counters = counters
		self.log = log
		self.request = frappe.db.get_value(REQUEST, name, ["name", "customer", "requested_date"], as_dict=True)
		self.subjects = _rows(SUBJECT, name, SUBJECT_FIELDS, SUBJECT_HISTORY)
		self.lines = _rows(LINE, name, LINE_FIELDS, LINE_HISTORY)
		self.orders = frappe.get_all(
			WORK_ORDER,
			filters={"request": name},
			fields=list(ORDER_FIELDS),
			order_by="creation asc, name asc",
		)
		self.person_of_key = {}
		self.people = {}
		self.resolutions = {}
		self.plans = {}
		self.accepted = {}
		self.line_person = {}
		self.entity_keys = {}
		self.holders = {}
		self.conflicted = set()

	def run(self):
		self.migrate_people()
		self.migrate_devices()
		self.link_rows(LINE, self.lines, "request lines linked")
		self.plan_orders()
		self.link_rows(WORK_ORDER, self.orders, "work orders linked")
		self.align_keys(LINE, self.lines)
		self.align_keys(WORK_ORDER, self.orders)
		self.retire_open_orders()
		self.backfill_requested_date()

	def skip(self, key, records, reason, kind="skipped"):
		self.log.append(
			{"kind": kind, "request": self.request.name, "key": key, "records": list(records), "reason": reason}
		)

	def migrate_people(self):
		setups = [order for order in self.orders if order.work_type == USER_SETUP and order.subject_key]
		keyed = {}

		for line in self.lines:
			key = (line.subject_key or "").strip()

			if not key:
				if line.is_new_user:
					self.skip(None, [line.name], "A line asks for a future person but carries no subject key.")
				continue

			if key.startswith("user:"):
				if line.is_new_user:
					self.skip(key, [line.name], "A line marked as a future person carries an existing person's key.")
				continue

			keyed.setdefault(key, []).append(line)

		self.attach_through_orders(keyed, "subject_key", lambda key: not key.startswith("user:"))

		evidenced = {
			key for key, rows in keyed.items() if key.startswith(NAMED_KEY) or any(row.is_new_user for row in rows)
		}

		for order in setups:
			if order.subject_key.startswith("user:"):
				self.skip(order.subject_key, [order.name], "A user setup work order carries an existing person's key.")
				continue

			evidenced.add(order.subject_key)

		subject_keys = {subject.subject_key for subject in self.subjects}
		people = {}

		for subject in self.subjects:
			if not (subject.is_new_user or subject.subject_key in evidenced):
				continue

			if subject.subject_key.startswith("user:"):
				self.skip(subject.subject_key, [subject.name], "A subject marked as a future person carries an existing person's key.")
				continue

			people[subject.subject_key] = {"subject": subject, "keys": [subject.subject_key]}

		claims = {}

		for key in sorted(evidenced - subject_keys):
			candidates = self.subjects_named(key)
			records = [line.name for line in keyed.get(key, [])] + [
				order.name for order in setups if order.subject_key == key
			]

			if len(candidates) > 1:
				self.skip(
					key,
					records + [subject.name for subject in candidates],
					"Several subjects of the request bear this person's name; the historical key is not tied to one of them.",
				)
				continue

			if candidates:
				claims.setdefault(candidates[0].subject_key, []).append((key, candidates[0], records))
			else:
				people[key] = {"subject": None, "keys": [key]}

		for subject_key, found in sorted(claims.items()):
			if len(found) > 1:
				self.skip(
					subject_key,
					[record for _key, _subject, records in found for record in records],
					"Several historical keys point at the same subject.",
				)
				continue

			key, subject, _records = found[0]
			entry = people.setdefault(subject_key, {"subject": subject, "keys": [subject_key]})
			entry["keys"].append(key)

		for person_key, entry in people.items():
			self.migrate_person(person_key, entry, keyed, setups)

	def subjects_named(self, key):
		if not key.startswith(NAMED_KEY) or key.startswith(OPAQUE_KEY):
			return []

		name = key[len(NAMED_KEY):]

		return [
			subject
			for subject in self.subjects
			if not subject.client_user
			and not subject.subject_key.startswith("user:")
			and name
			and _slug(subject.full_name_snapshot) == name
		]

	def migrate_person(self, person_key, entry, keyed, setups):
		keys = entry["keys"]
		subject = entry["subject"]
		lines = sorted(
			{line.name: line for key in keys for line in keyed.get(key, [])}.values(), key=lambda line: line.idx
		)
		orders = [order for order in setups if order.subject_key in keys]
		records = [line.name for line in lines] + [order.name for order in orders]

		for key in keys:
			self.person_of_key[key] = person_key

		for line in lines:
			self.line_person[line.name] = person_key

		requested = {
			"full_name": _text(subject.full_name_snapshot) if subject else None,
			"department": _text(subject.department_snapshot) if subject else None,
			"email": _text(subject.email_snapshot) if subject else None,
			"username": _text(subject.username_snapshot) if subject else None,
			"external_employee_id": None,
			"start_date": None,
		}

		for line in lines:
			for field, column in (
				("full_name", "new_user_full_name"),
				("department", "new_user_department"),
				("email", "new_user_email"),
				("username", "new_user_username"),
			):
				if not requested[field]:
					requested[field] = _text(line.get(column))

		resolution = self.person_resolution(person_key, lines, orders, records)
		prepared = dict(requested)

		if resolution:
			card = frappe.db.get_value(
				CLIENT_USER, resolution["name"], ["full_name", "department", "email", "username"], as_dict=True
			)

			for field in ("full_name", "department", "email", "username"):
				if not prepared[field]:
					prepared[field] = _text(card.get(field))

		prepared = self.prepared_person(person_key, prepared, records)

		if not prepared.get("full_name"):
			self.skip(person_key, records, "No name was ever written for this future person.")
			return

		fields = {
			"request": self.request.name,
			"customer": self.request.customer,
			"subject_key": person_key,
			"status": "Open",
			"requested_snapshot_json": request_targets.snapshot_of(requested, PERSON_FIELDS),
			**{field: value for field, value in prepared.items() if value},
		}

		if resolution:
			fields.update(
				{
					"status": "Resolved",
					"resolution_mode": "Create New",
					"resolved_client_user": resolution["name"],
					"resolved_by": resolution["by"],
					"resolved_at": resolution["at"],
				}
			)

		name = self.ensure(
			REQUESTED_CLIENT_USER,
			person_source_key(self.request.name, person_key),
			fields,
			"requested client users",
			person_key,
			records,
		)

		if not name:
			return

		self.people[person_key] = name

		if subject:
			self.link_subject(subject, name)

		resolved = self.resolutions.get(name)

		for line in lines:
			device_side = (
				line.target_scope == "Device"
				or bool(line.is_new_device)
				or (line.operation_code or "").startswith("device.")
			)
			self.plan(
				line,
				"requested_for_requested_client_user" if device_side else "requested_client_user",
				name,
			)

			if (line.operation_code or "") in HANDED_OVER and (
				not line.requested_holder or line.requested_holder == resolved
			):
				self.plan(line, "requested_holder_requested_client_user", name)

		for order in orders:
			self.plan(order, "requested_client_user", name)

	def person_resolution(self, person_key, lines, orders, records):
		results = {order.resulting_client_user for order in orders if order.resulting_client_user}
		propagated = {
			line.requested_for_user or line.client_user
			for line in lines
			if not line.is_new_user and (line.requested_for_user or line.client_user)
		}
		proofs = results | propagated

		if not proofs:
			return None

		if len(proofs) > 1:
			self.skip(
				person_key,
				records,
				f"The history names several Client Users for this person: {', '.join(sorted(proofs))}.",
			)
			return None

		person = next(iter(proofs))

		if not results and any(line.is_new_user for line in lines):
			self.skip(
				person_key,
				records,
				f"Only some lines of this person were rewritten to {person}; the resolution is not proven.",
			)
			return None

		if frappe.db.get_value(CLIENT_USER, person, "customer") != self.request.customer:
			self.skip(person_key, records, f"{person} does not exist or belongs to another customer.")
			return None

		order = next((order for order in orders if order.resulting_client_user == person), None)

		return self.completion(person, order)

	def completion(self, name, order):
		by = order.completed_by if order and order.completed_by else None

		return {
			"name": name,
			"by": by if by and frappe.db.exists("User", by) else None,
			"at": order.completed_at if order else None,
		}

	def prepared_person(self, person_key, values, records):
		department = values.get("department")

		if department and not DepartmentService._find_by_name(department):
			self.skip(
				person_key,
				records,
				f"Department '{department}' is not in the catalogue; it is kept in the requested snapshot only.",
				kind="note",
			)
			values["department"] = None

		email = values.get("email")

		if email and not frappe.utils.validate_email_address(email):
			self.skip(
				person_key,
				records,
				f"Email '{email}' is not a valid address; it is kept in the requested snapshot only.",
				kind="note",
			)
			values["email"] = None

		return values

	def migrate_devices(self):
		provisioning = [
			order
			for order in self.orders
			if order.work_type == DEVICE_PROVISIONING and (order.device_requirement_key or "").startswith(DEVICE_KEY)
		]
		keyed = {}

		for line in self.lines:
			key = (line.device_requirement_key or "").strip() or _historical_device_key(line)

			if not key:
				if line.is_new_device:
					self.skip(
						None, [line.name], "A line asks for a device still to be found but carries no device requirement key."
					)
				continue

			if key.startswith(DEVICE_KEY) or line.is_new_device:
				keyed.setdefault(key, []).append(line)

		self.attach_through_orders(keyed, "device_requirement_key", lambda key: key.startswith(DEVICE_KEY))

		for key in sorted(set(keyed) | {order.device_requirement_key for order in provisioning}):
			self.migrate_device(
				key,
				keyed.get(key, []),
				[order for order in provisioning if order.device_requirement_key == key],
			)

	def migrate_device(self, key, lines, orders):
		records = [line.name for line in lines] + [order.name for order in orders]
		requested = {field: None for field in DEVICE_FIELDS}
		label = None

		for line in lines:
			label = label or _text(line.new_device_label)
			requested["device_type"] = requested["device_type"] or _text(line.new_device_type)
			requested["serial_number"] = requested["serial_number"] or _text(line.new_device_serial)

		device_types = (frappe.get_meta(REQUESTED_DEVICE).get_field("device_type").options or "").split("\n")

		if requested["device_type"] and requested["device_type"] not in device_types:
			self.skip(
				key,
				records,
				f"Device type '{requested['device_type']}' is not a known type; it is kept in the requested snapshot only.",
				kind="note",
			)
			device_type = None
		else:
			device_type = requested["device_type"]

		requested["display_label"] = label or RequestedDeviceService._label({"device_type": device_type})

		subjects = sorted(
			{
				self.person_of_key.get(subject_key, subject_key)
				for subject_key in [self.line_person.get(line.name, line.subject_key) for line in lines]
				+ [order.subject_key for order in orders]
				if subject_key
			}
		)
		subject_key = subjects[0] if len(subjects) == 1 else None

		if len(subjects) > 1:
			self.skip(key, records, "The device was asked for several people; its intended holder is not proven.")

		if subject_key in self.people:
			requested["intended_holder_requested_client_user"] = self.people[subject_key]
		elif subject_key and subject_key.startswith("user:"):
			holder = subject_key[len("user:"):]

			if frappe.db.get_value(CLIENT_USER, holder, "customer") == self.request.customer:
				requested["intended_holder_client_user"] = holder
			else:
				self.skip(key, records, f"{holder} does not exist or belongs to another customer.")

		resolution = self.device_resolution(key, lines, orders, records)
		prepared = {field: value for field, value in requested.items() if value}
		prepared["device_type"] = device_type

		fields = {
			"request": self.request.name,
			"customer": self.request.customer,
			"device_requirement_key": key,
			"subject_key": subject_key,
			"status": "Open",
			"requested_snapshot_json": request_targets.snapshot_of(requested, DEVICE_FIELDS),
			**{field: value for field, value in prepared.items() if value},
		}

		if resolution:
			fields.update(
				{
					"status": "Resolved",
					"resolution_mode": resolution["mode"],
					"resolved_managed_device": resolution["name"],
					"resolved_by": resolution["by"],
					"resolved_at": resolution["at"],
				}
			)

		name = self.ensure(
			REQUESTED_DEVICE,
			device_source_key(self.request.name, key),
			fields,
			"requested devices",
			key,
			records,
		)

		if not name:
			return

		for line in lines:
			self.plan(line, "requested_device", name)

		for order in orders:
			self.plan(order, "requested_device", name)

	def device_resolution(self, key, lines, orders, records):
		results = {order.resulting_device for order in orders if order.resulting_device}
		propagated = {line.managed_device for line in lines if not line.is_new_device and line.managed_device}
		proofs = results | propagated

		if not proofs:
			return None

		if len(proofs) > 1:
			self.skip(key, records, f"The history names several Devices for this requirement: {', '.join(sorted(proofs))}.")
			return None

		device = next(iter(proofs))

		if not results and any(line.is_new_device for line in lines):
			self.skip(key, records, f"Only some lines of this device were rewritten to {device}; the resolution is not proven.")
			return None

		if frappe.db.get_value(MANAGED_DEVICE, device, "customer") != self.request.customer:
			self.skip(key, records, f"{device} does not exist or belongs to another customer.")
			return None

		order = next((order for order in orders if order.resulting_device == device), None)
		resolution = self.completion(device, order)
		resolution["mode"] = DEVICE_MODES.get(order.action) if order else None

		if not resolution["mode"]:
			self.skip(
				key,
				records,
				f"The history proves {device} but not how it was reached; the resolution mode is left blank.",
				kind="note",
			)

		return resolution

	def ensure(self, doctype, source_key, fields, counter, key, records):
		holder_field = "intended_holder_requested_client_user" if doctype == REQUESTED_DEVICE else "name"
		existing = frappe.db.get_value(
			doctype,
			{"source_key": source_key},
			["name", request_targets.RESOLVED_FIELD[doctype], holder_field],
			as_dict=True,
		)

		if existing:
			self.counters[f"{counter} already present"] += 1
			self.resolutions[existing.name] = existing.get(request_targets.RESOLVED_FIELD[doctype])
			self.entity_keys[existing.name] = key
			self.holders[existing.name] = existing.get(holder_field) if doctype == REQUESTED_DEVICE else None

			return existing.name

		resolved = fields.get(request_targets.RESOLVED_FIELD[doctype])

		if not self.write:
			name = f"<{source_key}>"
		else:
			frappe.db.savepoint("requested_entities")

			try:
				doc = frappe.get_doc({"doctype": doctype, **fields})
				doc.flags.department_already_agreed = True
				doc.insert(ignore_permissions=True)
			except Exception as error:
				frappe.db.rollback(save_point="requested_entities")
				frappe.clear_messages()
				self.skip(key, records, f"The {doctype} could not be written: {error}")

				return None

			name = doc.name

		self.counters[f"{counter} created"] += 1

		if resolved:
			self.counters["historical resolutions recovered"] += 1

		self.resolutions[name] = resolved
		self.entity_keys[name] = key
		self.holders[name] = fields.get("intended_holder_requested_client_user")

		return name

	def link_subject(self, subject, name):
		if subject.requested_client_user == name:
			return

		if subject.requested_client_user:
			self.skip(
				subject.subject_key,
				[subject.name],
				f"The subject already names {subject.requested_client_user}; it is left as it is.",
			)
			return

		if self.write:
			frappe.db.set_value(SUBJECT, subject.name, "requested_client_user", name, update_modified=False)

		self.counters["subjects linked"] += 1

	def attach_through_orders(self, keyed, field, accepted):
		lines = {line.name: line for line in self.lines}

		for order in self.orders:
			key = (order.get(field) or "").strip()
			line = lines.get(order.request_line_name)

			if not key or not line or not accepted(key):
				continue

			rows = keyed.setdefault(key, [])

			if line not in rows:
				rows.append(line)

	def plan(self, row, field, value):
		if (row.name, field) in self.conflicted:
			return

		planned = self.plans.setdefault(row.name, {})

		if planned.get(field) not in (None, value):
			self.skip(
				None,
				[row.name],
				f"The history ties {field} to both {planned[field]} and {value}; it is left empty.",
			)
			self.conflicted.add((row.name, field))
			planned.pop(field)
			return

		planned[field] = value

	def plan_orders(self):
		lines = {line.name: line for line in self.lines}

		for order in self.orders:
			line = lines.get(order.request_line_name)

			if not line:
				continue

			final = {field: line.get(field) for field in REAL_FIELD}
			final.update(self.accepted.get(line.name, {}))
			on_device = order.target_scope == "Device" or order.work_type == DEVICE_OPERATION

			for field, value in (
				("requested_client_user", None if on_device else final["requested_client_user"]),
				("requested_device", final["requested_device"] if on_device else None),
				("requested_holder_requested_client_user", final["requested_holder_requested_client_user"]),
			):
				if value:
					self.plan(order, field, value)

	def link_rows(self, doctype, rows, counter):
		for row in rows:
			changes = {}

			for field, value in sorted(self.plans.get(row.name, {}).items()):
				current = row.get(field)

				if current == value:
					continue

				if current:
					self.skip(None, [row.name], f"{field} already names {current}; it is left as it is.")
					continue

				real = row.get(REAL_FIELD[field])

				if real and real != self.resolutions.get(value):
					self.skip(
						None,
						[row.name],
						f"{REAL_FIELD[field]} names {real}, which is not what {value} resolved to; {field} is left empty.",
					)
					continue

				changes[field] = value

			self.accepted[row.name] = {
				field: value
				for field, value in self.plans.get(row.name, {}).items()
				if field in changes or row.get(field) == value
			}

			if not changes:
				continue

			if self.write:
				frappe.db.set_value(doctype, row.name, changes, update_modified=False)

			self.counters[counter] += 1

	def align_keys(self, doctype, rows):
		for row in rows:
			linked = self.accepted.get(row.name)

			if not linked:
				continue

			sources = [linked]

			if doctype == WORK_ORDER:
				sources.append(self.accepted.get(row.request_line_name) or {})

			people = {
				source.get(field)
				for source in sources
				for field in ("requested_client_user", "requested_for_requested_client_user")
				if source.get(field)
			}
			device = linked.get("requested_device")
			direct = bool(people)

			if not people and device and self.holders.get(device):
				people.add(self.holders[device])

			changes = {}

			if len(people) > 1:
				self.skip(
					None,
					[row.name],
					f"The row is tied to several Requested Client Users ({', '.join(sorted(people))}); its subject_key is left as it is.",
				)
			elif people:
				person = next(iter(people))
				key = self.entity_keys.get(person)
				current = row.subject_key or ""
				resolved = self.resolutions.get(person)
				rewritten = direct and resolved and current == f"user:{resolved}"

				if key and current != key and (current.startswith(NAMED_KEY) or rewritten):
					changes["subject_key"] = key

			if device:
				key = self.entity_keys.get(device)

				if key and row.device_requirement_key != key:
					changes["device_requirement_key"] = key

			if not changes:
				continue

			if self.write:
				frappe.db.set_value(doctype, row.name, changes, update_modified=False)

			self.counters["keys aligned"] += 1

	def retire_open_orders(self):
		lines = {line.name: line for line in self.lines}

		for order in self.orders:
			if order.work_type not in RETIRED_TYPES or order.status in SETTLED_STATUSES:
				continue

			linked = self.accepted.get(order.name) or {}
			entity = (
				linked.get("requested_client_user")
				or order.requested_client_user
				or linked.get("requested_device")
				or order.requested_device
			)

			if entity:
				self.follow_entity(order, entity)
			elif order.work_type == DEVICE_PROVISIONING and order.managed_device:
				self.hand_over_order(order, lines.get(order.request_line_name))
			else:
				person = self.person_of_order(order, lines.get(order.request_line_name))

				if order.work_type == USER_SETUP and person:
					self.settle_order(order, {"client_user": person, "resulting_client_user": person})
				else:
					self.skip(
						order.subject_key or order.device_requirement_key,
						[order.name],
						f"An open {order.work_type} work order is tied to no requested entity and proves nobody; it is cancelled.",
					)
					self.cancel_order(order, SUPERSEDED)

	def follow_entity(self, order, entity):
		resolved = self.resolutions.get(entity)
		doctype = REQUESTED_CLIENT_USER if order.work_type == USER_SETUP else REQUESTED_DEVICE

		if resolved:
			field = "client_user" if doctype == REQUESTED_CLIENT_USER else "managed_device"
			result = "resulting_client_user" if doctype == REQUESTED_CLIENT_USER else "resulting_device"
			self.settle_order(order, {field: resolved, result: resolved})
		elif frappe.db.get_value(doctype, entity, "status") == "Cancelled":
			self.cancel_order(order, f"{request_targets.CANCELLED_TARGET} {SUPERSEDED}")

	def person_of_order(self, order, line):
		key = order.subject_key or ""
		candidates = [
			order.requested_holder,
			order.client_user,
			key[len("user:"):] if key.startswith("user:") else None,
		]

		if line:
			candidates += [line.requested_holder, line.requested_for_user, line.client_user]

		for person in candidates:
			if person and frappe.db.get_value(CLIENT_USER, person, "customer") == self.request.customer:
				return person

		return None

	def hand_over_order(self, order, line):
		person = self.person_of_order(order, line)

		if not person:
			self.skip(
				order.device_requirement_key,
				[order.name],
				"An open provisioning work order on an existing Device names nobody to hand it to; it is cancelled.",
			)
			self.cancel_order(order, SUPERSEDED)
			return

		holder = frappe.db.get_value(MANAGED_DEVICE, order.managed_device, "assigned_client_user")

		if holder == person:
			self.settle_order(order, {"resulting_device": order.managed_device, "resulting_client_user": person})
			return

		code = "device.transfer" if holder else "device.assign"

		if self.write:
			frappe.db.set_value(
				WORK_ORDER,
				order.name,
				{
					"work_type": DEVICE_OPERATION,
					"operation_code": code,
					"action": "Transfer Device" if holder else "Assign Device",
					"target_scope": "Device",
					"requested_holder": person,
				},
				update_modified=False,
			)
			frappe.get_doc(WORK_ORDER, order.name).add_comment(
				"Comment", f"Turned into a Device Operation ({code}) when the requested entity model replaced provisioning work."
			)

		self.counters["historical work orders turned into device operations"] += 1

	def settle_order(self, order, values):
		if self.write:
			frappe.db.set_value(
				WORK_ORDER,
				order.name,
				{
					**values,
					"status": "Completed",
					"completed_at": frappe.utils.now_datetime(),
					"execution_notes": "Settled when the requested entity model replaced this work.",
				},
				update_modified=False,
			)

		self.counters["historical work orders settled"] += 1

	def cancel_order(self, order, reason):
		if self.write:
			frappe.db.set_value(
				WORK_ORDER, order.name, {"status": "Cancelled", "failure_reason": reason}, update_modified=False
			)
			frappe.get_doc(WORK_ORDER, order.name).add_comment("Comment", f"Cancelled: {reason}")

		self.counters["historical work orders cancelled"] += 1

	def backfill_requested_date(self):
		if self.request.requested_date:
			return

		dates = sorted({str(line.requested_effective_date) for line in self.lines if line.requested_effective_date})

		if len(dates) > 1:
			self.skip(
				None,
				[line.name for line in self.lines if line.requested_effective_date],
				f"The lines ask for {len(dates)} different dates ({', '.join(dates)}); requested_date is left empty.",
			)
			return

		if not dates:
			return

		if self.write:
			frappe.db.set_value(REQUEST, self.request.name, "requested_date", dates[0], update_modified=False)

		self.counters["requested dates backfilled"] += 1
