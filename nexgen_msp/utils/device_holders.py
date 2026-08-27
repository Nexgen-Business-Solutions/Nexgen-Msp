import frappe

FIELD = "holder_log"


def _open_row(doc):
	"""The spell that has not been closed yet, if there is one."""
	for row in reversed(doc.get(FIELD) or []):
		if not row.to_date:
			return row

	return None


def sync_current(doc):
	"""Restate who holds the machine from its history, and flag that row as the current one.

	The history is where a hand-over is written; the field on the device is only an index
	onto it, kept here so the dozens of queries that join on it stay simple. Deriving it on
	every save is what makes the two impossible to disagree.
	"""
	current = _open_row(doc)

	for row in doc.get(FIELD) or []:
		row.is_current = 1 if row is current else 0

	doc.assigned_client_user = current.client_user if current else None


def hand_over(doc, client_user, on_date=None, note=None):
	"""Record that a machine changed hands.

	Closes whoever held it and opens a spell for the new holder. Nothing is written when
	the holder has not actually changed, so saving a device for another reason does not
	fabricate a hand-over.
	"""
	on_date = on_date or frappe.utils.today()
	current = _open_row(doc)

	if current and current.client_user == client_user:
		return False

	if current:
		current.to_date = on_date

	if not client_user:
		return bool(current)

	doc.append(
		FIELD,
		{
			"client_user": client_user,
			"full_name": frappe.db.get_value("Client User", client_user, "full_name"),
			"from_date": on_date,
			"note": note,
		},
	)

	return True


def history(device):
	"""Who held this machine, oldest first."""
	return frappe.get_all(
		"MSP Device Holder",
		filters={"parent": device, "parenttype": "Managed Device"},
		fields=[
			"client_user",
			"full_name",
			"from_date",
			"to_date",
			"note",
			"is_current",
			"idx",
		],
		order_by="idx asc",
	)
