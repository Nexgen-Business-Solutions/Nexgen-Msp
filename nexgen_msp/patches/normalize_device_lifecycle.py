import datetime

import frappe

from nexgen_msp.utils.device_status import UNAVAILABLE_STATUSES

FIELD = "holder_log"


def execute():
	"""Put every machine already on record back in agreement with its own history.

	A machine is Active because somebody holds it, and the records that came in before that
	rule existed do not all say so: a retired one still points at whoever had it last, one
	nobody holds any more is still Active, one on the shelf was never flipped back when its
	spell was reopened. None of them can be saved again until they are made to agree, so the
	history is read as the truth and the status and the holder are restated from it.
	"""
	repaired = {
		"devices": 0,
		"to_stock": 0,
		"to_active": 0,
		"closed": 0,
		"histories": 0,
		"dated": 0,
		"holders": 0,
	}

	for row in _disagreeing():
		doc = frappe.get_doc("MSP Managed Device", row.name)
		held_by = doc.assigned_client_user

		if _collapse_open_spells(doc):
			repaired["histories"] += 1

		if doc.status in UNAVAILABLE_STATUSES:
			if not doc.retired_date:
				doc.retired_date = frappe.utils.getdate(doc.modified)
				repaired["dated"] += 1

			repaired["closed"] += _close_open_spell(doc, doc.retired_date)
		elif _open_spell(doc) and doc.status != "Active":
			doc.status = "Active"
			repaired["to_active"] += 1
		elif doc.status == "Active" and not _open_spell(doc):
			doc.status = "Stock"
			repaired["to_stock"] += 1

		doc.save(ignore_permissions=True)

		if doc.assigned_client_user != held_by:
			repaired["holders"] += 1

		repaired["devices"] += 1

	frappe.db.commit()

	print(f"  {repaired['devices']} device(s) restated from their holder history")
	print(f"  {repaired['to_stock']} active without a holder sent back to stock")
	print(f"  {repaired['to_active']} still held by somebody turned active again")
	print(f"  {repaired['closed']} holder spell(s) closed on a machine out of service")
	print(f"  {repaired['histories']} history(ies) with more than one open spell repaired")
	print(f"  {repaired['dated']} out of service date(s) filled in")
	print(f"  {repaired['holders']} device(s) now point at the right holder")


def _disagreeing():
	"""The machines whose status, holder or history says something the others deny.

	Everything else is already what a save would make of it, and a migration has no business
	stamping its date on a record it would not change.
	"""
	return frappe.db.sql(
		"""
		select * from (
			select
				d.name, d.status, d.retired_date, d.assigned_client_user,
				(
					select count(*) from `tabMSP Device Holder` h
					where h.parent = d.name and h.parenttype = 'MSP Managed Device'
					  and ifnull(h.to_date, '') = ''
				) as open_spells,
				(
					select h.client_user from `tabMSP Device Holder` h
					where h.parent = d.name and h.parenttype = 'MSP Managed Device'
					  and ifnull(h.to_date, '') = ''
					order by h.idx desc limit 1
				) as open_holder
			from `tabMSP Managed Device` d
		) device
		where device.open_spells > 1
		   or (device.status = 'Active' and device.open_spells = 0)
		   or (device.status != 'Active' and device.open_spells > 0)
		   or (device.status in %(out_of_service)s and ifnull(device.retired_date, '') = '')
		   or ifnull(device.assigned_client_user, '') != ifnull(device.open_holder, '')
		""",
		{"out_of_service": UNAVAILABLE_STATUSES},
		as_dict=True,
	)


def _spells(doc):
	"""The history in the order it happened, whatever order it was written in."""
	return sorted(
		doc.get(FIELD) or [],
		key=lambda row: (
			frappe.utils.getdate(row.from_date) if row.from_date else datetime.date.min,
			row.idx or 0,
		),
	)


def _open_spell(doc):
	for row in reversed(_spells(doc)):
		if not row.to_date:
			return row

	return None


def _collapse_open_spells(doc):
	"""Leave one person holding the machine: the last hand-over stands, the earlier ones end.

	Each spell that was never closed ends where the next one begins, so the history closes
	its own gap instead of inventing a day nothing happened on.
	"""
	spells = _spells(doc)
	still_open = [row for row in spells if not row.to_date]

	if len(still_open) < 2:
		return False

	for position, row in enumerate(spells):
		if row.to_date or row is still_open[-1]:
			continue

		row.to_date = spells[position + 1].from_date

	return True


def _close_open_spell(doc, on_date):
	"""End the spell of whoever still holds a machine that left service, on the day it left.

	A machine given out after the day it was written off says more about the paperwork than
	about the machine, and the spell is closed the day it opened rather than before it.
	"""
	row = _open_spell(doc)

	if not row:
		return 0

	closed_on = frappe.utils.getdate(on_date)
	started_on = frappe.utils.getdate(row.from_date) if row.from_date else None
	row.to_date = max(closed_on, started_on) if started_on else closed_on

	return 1
