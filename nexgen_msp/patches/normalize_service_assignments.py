"""Bring the service assignments already on record up to the rules Phase 2 gives them.

Two different jobs, deliberately kept apart. What can be restated with certainty is
restated: billing follows the operational status now, so a record that disagrees is simply
saved again and comes out right. Everything else — two open periods on the same target, a
history that overlaps itself, a period with no start, a service sold from a retired
catalogue entry — is a question about what really happened, and a migration that answers it
invents financial history. Those are counted and logged for a person to look at.

The suspension history of a service currently Suspended is the one reconstruction attempted,
and only from the record's own Version trail. Where the trail cannot say the day without
ambiguity the record is left alone: §43 is explicit that guessing the date breaks Billing.
"""

import frappe

from nexgen_msp.utils.assignments import OPEN_ASSIGNMENT_STATUSES, OPERATIONAL_TO_BILLING

DOCTYPE = "MSP Service Assignment"
FIELD = "suspension_log"

# what the doctype's own mandatory_depends_on asks of a record, read here as a fact to check
NEEDS_START = ("Active", "Suspended", "Pending Removal", "Ended")
NEEDS_END = ("Ended",)


def execute():
	report = {
		"billing_restated": 0,
		"billing_flagged": 0,
		"suspensions_rebuilt": 0,
		"suspensions_flagged": 0,
		"duplicate_open": 0,
		"overlapping_history": 0,
		"invalid_dates": 0,
		"disabled_services": 0,
	}

	_restate_billing_status(report)
	_rebuild_suspension_history(report)
	_report_duplicate_open(report)
	_report_overlapping_history(report)
	_report_invalid_dates(report)
	_report_disabled_services(report)

	frappe.db.commit()

	print(f"  {report['billing_restated']} assignment(s) had their billing status restated")
	print(f"  {report['billing_flagged']} assignment(s) could not be saved again and were flagged")
	print(f"  {report['suspensions_rebuilt']} suspension(s) rebuilt from the version history")
	print(f"  {report['suspensions_flagged']} suspended assignment(s) flagged: the day cannot be known")
	print(f"  {report['duplicate_open']} duplicate open assignment(s) reported")
	print(f"  {report['overlapping_history']} overlapping historical period(s) reported")
	print(f"  {report['invalid_dates']} assignment(s) with an impossible period reported")
	print(f"  {report['disabled_services']} assignment(s) on a retired catalogue service reported")

	return report


# --------------------------------------------------------------- what can be restated
def _restate_billing_status(report):
	"""Save again every record whose billing status is not the one its life implies.

	The save does the work: billing is derived on every save now, so the record only has to
	pass through the door once to come out agreeing with itself.
	"""
	for row in frappe.get_all(DOCTYPE, fields=["name", "operational_status", "billing_status"]):
		derived = OPERATIONAL_TO_BILLING.get(row.operational_status)

		if not derived or row.billing_status == derived:
			continue

		try:
			doc = frappe.get_doc(DOCTYPE, row.name)
			doc.flags.via_service_lifecycle = True
			doc.save(ignore_permissions=True)
			report["billing_restated"] += 1
		except Exception:
			frappe.db.rollback()
			report["billing_flagged"] += 1
			frappe.log_error(
				title="Billing status could not be restated",
				message=(
					f"{row.name}: {row.operational_status} should be billed as {derived} "
					f"rather than {row.billing_status}, but the record cannot be saved as it stands."
				),
			)


def _rebuild_suspension_history(report):
	"""Give a service that is Suspended today the suspension row it never had.

	Only the record's own Version trail is consulted, and only when it says the day without
	ambiguity. Anything else is flagged: a suspension dated on a guess would take days off
	an invoice that were really provided.
	"""
	for name in _suspended_without_a_log():
		suspended_on = _suspended_on_from_versions(name)

		if not suspended_on:
			report["suspensions_flagged"] += 1
			frappe.log_error(
				title="Suspension date cannot be reconstructed",
				message=(
					f"{name} is suspended but has no suspension history, and its version trail does "
					f"not say when it was suspended. It needs the date entering by hand; nothing was "
					f"guessed, because a wrong date would be billed."
				),
			)
			continue

		try:
			doc = frappe.get_doc(DOCTYPE, name)
			doc.flags.via_service_lifecycle = True
			doc.append(
				FIELD,
				{
					"suspended_on": suspended_on,
					"note": "Reconstructed from the version history by the Phase 2 migration.",
				},
			)
			doc.save(ignore_permissions=True)
			report["suspensions_rebuilt"] += 1
		except Exception:
			frappe.db.rollback()
			report["suspensions_flagged"] += 1
			frappe.log_error(
				title="Suspension could not be recorded",
				message=(
					f"{name}: the version history says it was suspended on {suspended_on}, but the "
					f"record refuses that day. It needs manual review."
				),
			)


def _suspended_without_a_log():
	return frappe.db.sql_list(
		"""
		select sa.name
		from `tabMSP Service Assignment` sa
		where sa.operational_status = 'Suspended'
		  and not exists (
			select 1 from `tabMSP Service Suspension` s
			where s.parent = sa.name and s.parenttype = 'MSP Service Assignment'
		  )
		"""
	)


def _suspended_on_from_versions(name):
	"""The day the record entered the suspension it is still in, if the trail says so plainly.

	Frappe writes every field change as a diff, so the trail reads as a list of status moves.
	The one wanted is the last move into Suspended — and if anything moved it back out again
	afterwards, the trail disagrees with the record in front of us and is not to be trusted.
	"""
	transitions = _status_transitions(name)
	entered = [position for position, row in enumerate(transitions) if row["new"] == "Suspended"]

	if not entered:
		return None

	last = entered[-1]

	for row in transitions[last + 1 :]:
		if row["old"] == "Suspended":
			return None

	return frappe.utils.getdate(transitions[last]["on"])


def _status_transitions(name):
	rows = []

	for version in frappe.get_all(
		"Version",
		filters={"ref_doctype": DOCTYPE, "docname": name},
		fields=["name", "data", "creation"],
		order_by="creation asc",
	):
		try:
			diff = frappe.parse_json(version.data) or {}
		except Exception:
			continue

		for change in diff.get("changed") or []:
			if len(change) >= 3 and change[0] == "operational_status":
				rows.append({"on": version.creation, "old": change[1], "new": change[2]})

	return rows


# -------------------------------------------------------------- what is only reported
def _report_duplicate_open(report):
	"""The same service open twice on the same target: which period is the real one is a question."""
	groups = frappe.db.sql(
		"""
		select
			customer, service_item, assignment_scope,
			ifnull(client_user, '') as client_user,
			ifnull(managed_device, '') as managed_device,
			ifnull(customer_site, '') as customer_site,
			group_concat(name order by name) as names
		from `tabMSP Service Assignment`
		where operational_status in %(open)s
		group by customer, service_item, assignment_scope,
			ifnull(client_user, ''), ifnull(managed_device, ''), ifnull(customer_site, '')
		having count(*) > 1
		""",
		{"open": OPEN_ASSIGNMENT_STATUSES},
		as_dict=True,
	)

	for group in groups:
		report["duplicate_open"] += 1
		frappe.log_error(
			title="Duplicate open service assignments",
			message=(
				f"{group.names} are all open for {group.service_item} on the same target "
				f"({group.assignment_scope}: {group.client_user or group.managed_device or group.customer_site}) "
				f"at {group.customer}. Only one period may be open; which one stands is a decision."
			),
		)


def _report_overlapping_history(report):
	"""Two periods of the same service on the same target that claim the same days."""
	pairs = frappe.db.sql(
		"""
		select a.name as earlier, b.name as later, a.service_item, a.assignment_scope, a.customer
		from `tabMSP Service Assignment` a
		join `tabMSP Service Assignment` b
			on b.name > a.name
			and b.customer = a.customer
			and b.service_item = a.service_item
			and b.assignment_scope = a.assignment_scope
			and ifnull(b.client_user, '') = ifnull(a.client_user, '')
			and ifnull(b.managed_device, '') = ifnull(a.managed_device, '')
			and ifnull(b.customer_site, '') = ifnull(a.customer_site, '')
		where a.operational_status != 'Cancelled'
		  and b.operational_status != 'Cancelled'
		  and ifnull(a.effective_start_date, '') != ''
		  and ifnull(b.effective_start_date, '') != ''
		  and (a.effective_end_date is null or a.effective_end_date >= b.effective_start_date)
		  and (b.effective_end_date is null or b.effective_end_date >= a.effective_start_date)
		""",
		as_dict=True,
	)

	for pair in pairs:
		report["overlapping_history"] += 1
		frappe.log_error(
			title="Overlapping service assignment periods",
			message=(
				f"{pair.earlier} and {pair.later} both cover the same days of {pair.service_item} "
				f"for the same {pair.assignment_scope} target at {pair.customer}. Which period was "
				f"really provided is a question for a person; nothing was changed."
			),
		)


def _report_invalid_dates(report):
	"""A period that ends before it begins, or a status that needs a date the record has not got."""
	rows = frappe.db.sql(
		"""
		select name, operational_status, effective_start_date, effective_end_date
		from `tabMSP Service Assignment`
		where (
			ifnull(effective_start_date, '') != ''
			and ifnull(effective_end_date, '') != ''
			and effective_end_date < effective_start_date
		)
		or (operational_status in %(needs_start)s and ifnull(effective_start_date, '') = '')
		or (operational_status in %(needs_end)s and ifnull(effective_end_date, '') = '')
		""",
		{"needs_start": NEEDS_START, "needs_end": NEEDS_END},
		as_dict=True,
	)

	for row in rows:
		report["invalid_dates"] += 1
		frappe.log_error(
			title="Service assignment period is not usable",
			message=(
				f"{row.name} is {row.operational_status} over {row.effective_start_date} → "
				f"{row.effective_end_date}. The period it was provided over cannot be read from that, "
				f"and inventing one would invent an invoice."
			),
		)


def _report_disabled_services(report):
	"""A service still assigned although its catalogue entry has been retired."""
	rows = frappe.db.sql(
		"""
		select sa.name, sa.service_item, sa.operational_status
		from `tabMSP Service Assignment` sa
		join `tabItem` i on i.name = sa.service_item
		where i.disabled = 1
		""",
		as_dict=True,
	)

	for row in rows:
		report["disabled_services"] += 1
		frappe.log_error(
			title="Service assignment on a disabled catalogue item",
			message=(
				f"{row.name} is {row.operational_status} on {row.service_item}, which is disabled in "
				f"the catalogue. Whether the service is still provided is a question for a person."
			),
		)
