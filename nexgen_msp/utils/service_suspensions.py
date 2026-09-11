"""The days a service was really paused, kept beside the period it was provided over.

The assignment alone only ever says what the service is doing today, so a suspension that
has already been resumed leaves no trace and Billing ends up charging a month nobody had.
The log is where those days live, and these rules are what keep it readable as a sequence.
"""

import frappe
from frappe import _

FIELD = "suspension_log"

# the statuses that say the service is being provided right now, so nothing may be paused
PROVIDING_STATUSES = ("Active", "Pending Removal")


def open_row(doc):
	"""The suspension that has not been resumed yet, if there is one."""
	for row in reversed(doc.get(FIELD) or []):
		if not row.resumed_on:
			return row

	return None


def last_row(doc):
	"""The most recent suspension, resumed or not."""
	rows = doc.get(FIELD) or []

	if not rows:
		return None

	return max(rows, key=lambda row: (frappe.utils.getdate(row.suspended_on), row.idx or 0))


def _in_order(doc):
	"""The log in the order it happened, whatever order the rows were written in."""
	return sorted(
		doc.get(FIELD) or [],
		key=lambda row: (frappe.utils.getdate(row.suspended_on), row.idx or 0),
	)


def validate_suspension_log(doc):
	"""Refuse a suspension history that cannot have happened.

	A service is paused once at a time: an interval closes before the next one opens, only
	the last may still be open, and none of them starts tomorrow or outside the period the
	service was actually provided over. The current status has to agree with all of it —
	Suspended means exactly one interval is open, being provided means none is.

	The one exception is a service closed while it happened to be suspended: §11 keeps that
	last interval open on purpose, and Billing clips it to the end date rather than here.
	"""
	rows = doc.get(FIELD) or []

	for row in rows:
		if not row.suspended_on:
			frappe.throw(_("Row {0}: a suspension needs the day it started.").format(row.idx))

	_validate_sequence(doc)
	_validate_bounds(doc)
	_validate_status_agrees(doc)


def _validate_sequence(doc):
	rows = _in_order(doc)
	previous = None

	if len([row for row in rows if not row.resumed_on]) > 1:
		frappe.throw(_("Only one suspension can be open at a time."))

	for row in rows:
		if row.resumed_on and frappe.utils.getdate(row.resumed_on) < frappe.utils.getdate(row.suspended_on):
			frappe.throw(_("Row {0}: a suspension cannot be resumed before it started.").format(row.idx))

		if previous:
			if not previous.resumed_on:
				frappe.throw(_("Row {0}: the open suspension must be the last one.").format(previous.idx))

			if frappe.utils.getdate(row.suspended_on) < frappe.utils.getdate(previous.resumed_on):
				frappe.throw(
					_("Row {0}: the service was still suspended on that day.").format(row.idx)
				)

		previous = row


def _validate_bounds(doc):
	today = frappe.utils.getdate(frappe.utils.today())
	start = frappe.utils.getdate(doc.effective_start_date) if doc.effective_start_date else None
	end = frappe.utils.getdate(doc.effective_end_date) if doc.effective_end_date else None

	for row in doc.get(FIELD) or []:
		suspended_on = frappe.utils.getdate(row.suspended_on)

		if suspended_on > today:
			frappe.throw(_("Row {0}: a suspension cannot start in the future.").format(row.idx))

		if start and suspended_on < start:
			frappe.throw(
				_("Row {0}: a suspension cannot start before the service did.").format(row.idx)
			)

		if end and suspended_on > end:
			frappe.throw(
				_("Row {0}: a suspension cannot start after the service ended.").format(row.idx)
			)


def _validate_status_agrees(doc):
	open_rows = len([row for row in doc.get(FIELD) or [] if not row.resumed_on])

	if doc.operational_status == "Suspended" and open_rows != 1:
		frappe.throw(_("A suspended service must have exactly one open suspension."))

	if doc.operational_status in PROVIDING_STATUSES and open_rows:
		frappe.throw(
			_("{0} service cannot have an open suspension.").format(_(doc.operational_status))
		)
