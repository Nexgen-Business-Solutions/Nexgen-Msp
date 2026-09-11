import frappe
from frappe import _

FIELD = "holder_log"

# a person the machine may be handed to: someone who has left is not given one
HOLDABLE_LIFECYCLE = ("Active", "Pending")


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


def last_transition(doc):
	"""The most recent day the history already speaks for, whether it opened or closed a spell.

	Nothing may be dated before it: the history is read as a sequence, and a spell slipped
	in behind the last one describes a machine being in two places at once.
	"""
	dates = [
		frappe.utils.getdate(value)
		for row in doc.get(FIELD) or []
		for value in (row.from_date, row.to_date)
		if value
	]

	return max(dates) if dates else None


def sync_current(doc):
	"""Restate who holds the machine from its history, and flag that row as the current one.

	The history is where a hand-over is written; the field on the device is only an index
	onto it, kept here so the dozens of queries that join on it stay simple. Deriving it on
	every save is what makes the two impossible to disagree.

	It reads the history and nothing else. Closing a spell because the machine is leaving
	service is a decision, and decisions are taken before the save, not inside the mirror.
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

	A machine coming back to someone who had it before is an ordinary thing to happen, and
	it opens a spell of its own: the history says who held it when, not who has ever held it.
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
			"full_name": frappe.db.get_value("MSP Client User", client_user, "full_name"),
			"from_date": on_date,
			"note": note,
		},
	)

	return True


def validate_holder_log(doc):
	"""Refuse a history that cannot have happened.

	Read in the order it was written, a machine goes to one person at a time: a spell ends
	before the next begins — the same day is fine, a machine changes hands in the morning —
	and only the last one may still be open.
	"""
	rows = doc.get(FIELD) or []
	previous = None

	if len([row for row in rows if not row.to_date]) > 1:
		frappe.throw(_("Only one holder period can be open at a time."))

	for row in rows:
		if not row.from_date:
			frappe.throw(_("Row {0}: a holder period needs the day it started.").format(row.idx))

		if row.to_date and frappe.utils.getdate(row.to_date) < frappe.utils.getdate(row.from_date):
			frappe.throw(_("Row {0}: a holder period cannot end before it started.").format(row.idx))

		if bool(row.is_current) != (not row.to_date):
			frappe.throw(
				_("Row {0}: the current holder is the one whose period is still open.").format(row.idx)
			)

		holder_customer = frappe.db.get_value("MSP Client User", row.client_user, "customer")

		if holder_customer != doc.customer:
			frappe.throw(
				_("Row {0}: {1} belongs to customer {2}, not {3}.").format(
					row.idx, frappe.bold(row.client_user), frappe.bold(holder_customer), frappe.bold(doc.customer)
				)
			)

		if previous:
			if frappe.utils.getdate(row.from_date) < frappe.utils.getdate(previous.from_date):
				frappe.throw(
					_("Row {0}: a holder period cannot start before the one recorded above it.").format(row.idx)
				)

			if not previous.to_date:
				frappe.throw(
					_("Row {0}: the open holder period must be the last one.").format(previous.idx)
				)

			if frappe.utils.getdate(row.from_date) < frappe.utils.getdate(previous.to_date):
				frappe.throw(
					_("Row {0}: the previous holder still had the device on that day.").format(row.idx)
				)

		previous = row


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
