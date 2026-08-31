import frappe

FIELD = "holder_log"


def _open_row(doc):
	"""The spell that has not been closed yet, if there is one."""
	for row in reversed(doc.get(FIELD) or []):
		if not row.to_date:
			return row

	return None


def _last_row(doc):
	"""Whoever held it most recently, open spell or not."""
	rows = doc.get(FIELD) or []

	if not rows:
		return None

	return max(rows, key=lambda row: (frappe.utils.getdate(row.from_date), row.idx or 0))


def sync_current(doc):
	"""Restate who holds the machine from its history, and flag that row as the current one.

	The history is where a hand-over is written; the field on the device is only an index
	onto it, kept here so the dozens of queries that join on it stay simple. Deriving it on
	every save is what makes the two impossible to disagree.

	Nobody holds a machine that has left service, so its open spell closes on the day it was
	retired — the device still points at that last holder, which is what keeps the machine on
	their page.
	"""
	retired = bool(doc.status) and doc.status != "Active"
	current = _open_row(doc)

	if retired and current:
		current.to_date = doc.retired_date or frappe.utils.today()
		current = None

	for row in doc.get(FIELD) or []:
		row.is_current = 1 if row is current else 0

	if current:
		doc.assigned_client_user = current.client_user
	elif retired:
		last = _last_row(doc)
		doc.assigned_client_user = last.client_user if last else None
	else:
		doc.assigned_client_user = None


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

	# a machine out of service has no open spell any more — its last one was closed on the
	# day it was retired. Handing it to the person who already held it last would open a
	# second spell for the same holder, and a re-import would do so again every time.
	if not current:
		last = _last_row(doc)

		if last and last.client_user == client_user:
			return False

	if current:
		current.to_date = on_date

	if not client_user:
		return bool(current)

	doc.append(
		FIELD,
		{
			"client_user": client_user,
			"full_name": frappe.db.get_value("MSP Client User", client_user, "full_name"),
			"from_date": on_date,
			"note": note,
		},
	)

	return True


def history(device):
	"""Who held this machine, oldest first.

	Each spell carries where its holder stands today: someone who left the company still
	appears here, and reading the row without that is how a disabled person passes for the
	person to call about the machine.
	"""
	rows = frappe.db.sql(
		"""
		select
			h.client_user, h.full_name, h.from_date, h.to_date, h.note, h.is_current, h.idx,
			cu.lifecycle_status, cu.disabled_date
		from `tabMSP Device Holder` h
		left join `tabMSP Client User` cu on cu.name = h.client_user
		where h.parent = %(device)s and h.parenttype = 'MSP Managed Device'
		order by h.idx asc
		""",
		{"device": device},
		as_dict=True,
	)

	return rows
