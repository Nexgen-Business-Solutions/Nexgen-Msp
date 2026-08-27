import frappe

from nexgen_msp.utils.errors import NotFoundError, ValidationError

# only records this app owns carry a remark log
PARENTS = ("Client User", "Managed Device")


def add(doc, note, noted_by=None):
	"""Append a note to a record's remark log, if there is anything to append."""
	note = (note or "").strip()

	if not note:
		return False

	doc.append(
		"remark_log",
		{
			"note": note,
			"noted_on": frappe.utils.now(),
			"noted_by": noted_by or frappe.session.user,
		},
	)

	return True


def log(doctype, name):
	"""What a record holds, oldest first — the order it was written in."""
	return frappe.get_all(
		"MSP Remark",
		filters={"parent": name, "parenttype": doctype},
		fields=["note", "noted_on", "noted_by", "idx"],
		order_by="idx asc",
	)


def latest(doctype, name):
	"""The most recent note, for a listing that has room for one line."""
	rows = frappe.get_all(
		"MSP Remark",
		filters={"parent": name, "parenttype": doctype},
		fields=["note"],
		order_by="idx desc",
		limit=1,
	)

	return rows[0].note if rows else None


def joined(doctype, name, separator=" | "):
	"""Every note on one line, for a sheet."""
	return separator.join(row.note for row in log(doctype, name) if row.note)


def append(doctype=None, name=None, note=None):
	"""Add one note to a record's log, from wherever the user happens to be looking."""
	from nexgen_msp.api.internal.services.request_service import RequestService

	RequestService._guard_internal()

	if doctype not in PARENTS:
		raise ValidationError(f"{doctype} does not keep remarks.", "VALIDATION_ERROR")

	if not name or not frappe.db.exists(doctype, name):
		raise NotFoundError(f"{doctype} {name} not found.", "NOT_FOUND")

	if not (note or "").strip():
		raise ValidationError("Write something before saving it.", "VALIDATION_ERROR")

	doc = frappe.get_doc(doctype, name)
	add(doc, note)
	doc.save()
	frappe.db.commit()

	return log(doctype, name)


def on_assignment(assignment, action, note):
	"""Carry a note written on a service onto whatever receives that service.

	A note left on an assignment is invisible unless someone opens that very assignment.
	The person or the machine is where anyone actually looks, so the note is copied there
	as an event, naming the service and what was done to it. It is a copy, not a view: the
	log is a record of what was said at the time, and editing the assignment later must not
	rewrite history.
	"""
	note = (note or "").strip()

	if not note:
		return False

	host_type, host = (
		("Managed Device", assignment.managed_device)
		if assignment.managed_device
		else ("Client User", assignment.client_user)
	)

	if not host:
		return False

	service = (
		frappe.db.get_value("Item", assignment.service_item, "item_name")
		or assignment.service_item
	)

	doc = frappe.get_doc(host_type, host)
	add(doc, f"{service} — {action.lower()}: {note}")
	doc.save(ignore_permissions=True)

	return True
