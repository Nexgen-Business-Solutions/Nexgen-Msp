"""What MSP may have changed on ERPNext Items, and how to put back only what is proven.

The site existed before Nexgen MSP. An earlier release wrote across every non-stock Item —
its unit of measure, and its global disabled flag — which is not ours to decide. This module
reads that damage and repairs it one Item at a time.

Reading is free: it looks anywhere, changes nothing, and says how strong the evidence is.
Writing is the opposite: only a value an earlier version of the record proves, only on an
Item somebody selected, only while the Item still holds the value the audit saw.
"""

import json

import frappe

from nexgen_msp.utils.catalogue import BILLING_UOM as MONTH
from nexgen_msp.utils.errors import ValidationError

ITEM = "Item"
VERSION = "Version"

# how sure we are about the value an Item held before
HIGH = "HIGH"
MEDIUM = "MEDIUM"
LOW = "LOW"
NONE = "NONE"

# what the audit says should happen to a row
SAFE = "Safe to restore"
REVIEW = "Needs review"
LEAVE = "No change recommended"

# the fields an earlier MSP release is known to have written
REPAIRABLE = ("disabled", "stock_uom", "sales_uom")

PERMISSION_TEXT = "You are not allowed to repair ERPNext Item data."


# ------------------------------------------------------------------ who may do this
def _guard():
	from nexgen_msp.api.internal.services.request_service import ADMIN_ROLES, RequestService

	if not RequestService._roles().intersection(ADMIN_ROLES):
		raise ValidationError(PERMISSION_TEXT, "PERMISSION_DENIED", 403)


# ------------------------------------------------------------------ which Items to read
def _in_scope():
	"""Every Item MSP could have touched, and every Item MSP visibly uses.

	Broad on purpose: this is a read, and an Item left out of the audit is an Item nobody
	can be told about.
	"""
	names = set(frappe.get_all(ITEM, filters={"is_stock_item": 0}, pluck="name"))

	for doctype, field in (
		("MSP Service Assignment", "service_item"),
		("MSP Contract Service", "service_item"),
		("MSP Billing Run Line", "service_item"),
	):
		names.update(frappe.db.sql_list(f"select distinct `{field}` from `tab{doctype}`"))

	names.update(_mapped_items())

	for field in ("msp_service_scope", "msp_invoice_label", "msp_service_enabled"):
		if frappe.db.has_column(ITEM, field):
			names.update(
				frappe.db.sql_list(
					f"select name from `tabItem` where ifnull(`{field}`, '') not in ('', '0')"
				)
			)

	names.update(
		frappe.db.sql_list(
			"""
			select distinct docname from `tabVersion`
			where ref_doctype = 'Item'
			  and (data like '%%"disabled"%%' or data like '%%stock_uom%%'
			       or data like '%%sales_uom%%' or data like '%%uoms%%')
			"""
		)
	)

	return {name for name in names if name}


def _mapped_items():
	"""The Items an MSP import mapping names."""
	if not frappe.db.exists("DocType", "MSP Service Mapping"):
		return []

	return frappe.db.sql_list("select distinct item_id from `tabMSP Service Mapping`")


# ------------------------------------------------------------------ what a version proves
def _history(item):
	"""Every change an Item's own history records, newest first."""
	rows = frappe.get_all(
		VERSION,
		filters={"ref_doctype": ITEM, "docname": item},
		fields=["name", "owner", "creation", "data"],
		order_by="creation desc",
	)

	for row in rows:
		row["parsed"] = frappe.parse_json(row.data or "{}")

	return rows


def _last_change(history, field):
	"""When a field was last written, by whom, and what it held before."""
	for row in history:
		for changed in row["parsed"].get("changed") or []:
			if changed and changed[0] == field:
				return {
					"at": row.creation,
					"by": row.owner,
					"previous": changed[1],
					"current_then": changed[2],
				}

	return None


def _month_row(item):
	return frappe.db.get_value(
		"UOM Conversion Detail",
		{"parent": item, "parenttype": ITEM, "uom": MONTH},
		["name", "conversion_factor"],
		as_dict=True,
	)


def _msp_usage(item):
	open_statuses = ("Pending Setup", "Active", "Suspended", "Pending Removal")

	return {
		"open_msp_assignments": frappe.db.count(
			"MSP Service Assignment", {"service_item": item, "operational_status": ("in", open_statuses)}
		),
		"historical_msp_assignments": frappe.db.count(
			"MSP Service Assignment", {"service_item": item, "operational_status": ("not in", open_statuses)}
		),
		"msp_contract_references": frappe.db.count("MSP Contract Service", {"service_item": item}),
		"msp_billing_line_references": frappe.db.count("MSP Billing Run Line", {"service_item": item}),
	}


def _evidence(card, usage, proven):
	"""How much the audit actually knows about this Item's earlier state."""
	if proven:
		return HIGH

	if any(usage.values()) or card.get("msp_service_scope") or card.get("msp_invoice_label"):
		return MEDIUM

	if card.get("import_mapping_reference"):
		return LOW

	return NONE


def _written_by_msp(change, field):
	"""Whether the recorded change is the one the old MSP release used to make.

	The old patch wrote the billing unit over every non-stock Item, and catalogue retirement
	wrote the global disabled flag. A change that put another value there was somebody's own
	decision, and is none of our business.
	"""
	if not change:
		return False

	if field == "disabled":
		return frappe.utils.cint(change["current_then"]) == 1 and frappe.utils.cint(change["previous"]) == 0

	return change["current_then"] == MONTH and change["previous"] != MONTH


# ------------------------------------------------------------------ the audit itself
def audit(since=None, until=None, limit=None):
	"""Read what MSP may have changed. Changes nothing, ever."""
	_guard()

	mapped = set(_mapped_items())
	fields = [
		"name",
		"item_name",
		"disabled",
		"modified",
		"modified_by",
		"is_stock_item",
		"is_sales_item",
		"stock_uom",
		"sales_uom",
	]

	for extra in ("msp_service_scope", "msp_invoice_label", "msp_service_enabled"):
		if frappe.db.has_column(ITEM, extra):
			fields.append(extra)

	rows = []

	for name in sorted(_in_scope()):
		card = frappe.db.get_value(ITEM, name, fields, as_dict=True)

		if not card:
			continue

		history = _history(name)
		month = _month_row(name)
		usage = _msp_usage(name)
		changes = {field: _last_change(history, field) for field in REPAIRABLE}
		within = {
			field: _within(changes[field], since, until) and _written_by_msp(changes[field], field)
			for field in REPAIRABLE
		}

		row = {
			"item_code": name,
			"item_name": card.item_name,
			"disabled": frappe.utils.cint(card.disabled),
			"modified": card.modified,
			"modified_by": card.modified_by,
			"is_stock_item": frappe.utils.cint(card.is_stock_item),
			"is_sales_item": frappe.utils.cint(card.is_sales_item),
			"stock_uom": card.stock_uom,
			"sales_uom": card.sales_uom,
			"has_month_uom": bool(month),
			"month_conversion_factor": month.conversion_factor if month else None,
			"msp_service_scope": card.get("msp_service_scope"),
			"msp_invoice_label": card.get("msp_invoice_label"),
			"msp_service_enabled": frappe.utils.cint(card.get("msp_service_enabled") or 0),
			**usage,
			"import_mapping_reference": name in mapped,
			"disabled_last_changed_at": changes["disabled"]["at"] if changes["disabled"] else None,
			"disabled_last_changed_by": changes["disabled"]["by"] if changes["disabled"] else None,
			"previous_disabled_value": changes["disabled"]["previous"] if changes["disabled"] else None,
			"stock_uom_last_changed_at": changes["stock_uom"]["at"] if changes["stock_uom"] else None,
			"previous_stock_uom": changes["stock_uom"]["previous"] if changes["stock_uom"] else None,
			"sales_uom_last_changed_at": changes["sales_uom"]["at"] if changes["sales_uom"] else None,
			"previous_sales_uom": changes["sales_uom"]["previous"] if changes["sales_uom"] else None,
		}

		restorable = _restorable(row, changes, within)
		row["restorable"] = restorable
		row["evidence_level"] = _evidence(row, usage, bool(restorable))
		row["group"] = _group(row, restorable)
		rows.append(row)

	if limit:
		rows = rows[: frappe.utils.cint(limit)]

	return {
		"rows": rows,
		"groups": {
			SAFE: [row for row in rows if row["group"] == SAFE],
			REVIEW: [row for row in rows if row["group"] == REVIEW],
			LEAVE: [row for row in rows if row["group"] == LEAVE],
		},
		"generated_at": frappe.utils.now(),
	}


def _within(change, since, until):
	if not change:
		return False

	at = frappe.utils.get_datetime(change["at"])

	if since and at < frappe.utils.get_datetime(since):
		return False

	return not (until and at > frappe.utils.get_datetime(until))


def _restorable(row, changes, within):
	"""The fields a version proves MSP overwrote, and that the Item still holds."""
	proven = {}

	for field in REPAIRABLE:
		change = changes[field]

		if not change or not within[field]:
			continue

		current = row["disabled"] if field == "disabled" else row[field]
		wrote = change["current_then"]

		if field == "disabled":
			if frappe.utils.cint(current) != frappe.utils.cint(wrote):
				continue
		elif current != wrote:
			continue

		proven[field] = {
			"previous": change["previous"],
			"current": current,
			"changed_at": change["at"],
			"changed_by": change["by"],
			"source_of_evidence": f"Version {field} change recorded {change['at']}",
		}

	return proven


def _group(row, restorable):
	if restorable and row["evidence_level"] == HIGH:
		return SAFE

	if row["disabled"] or (row["has_month_uom"] and row["month_conversion_factor"] not in (1, 1.0)):
		return REVIEW

	if row["stock_uom"] == MONTH and not row["msp_service_scope"] and not any(
		(row["open_msp_assignments"], row["historical_msp_assignments"], row["msp_contract_references"])
	):
		return REVIEW

	return LEAVE


# ------------------------------------------------------------------ putting a value back
def restore(selections=None):
	"""Put back only the values named, only where the Item still holds what the audit saw."""
	_guard()

	selections = frappe.parse_json(selections) if isinstance(selections, str) else (selections or [])
	results = []

	for selection in selections:
		results.append(_restore_one(selection))

	frappe.db.commit()

	return {
		"results": results,
		"restored": len([row for row in results if row["ok"]]),
		"failed": len([row for row in results if not row["ok"]]),
	}


def _restore_one(selection):
	item = (selection.get("item") or "").strip()
	wanted = selection.get("fields") or {}

	if not item or not frappe.db.exists(ITEM, item):
		return {
			"item": item,
			"ok": False,
			"code": "ITEM_NOT_FOUND",
			"message": "This Item no longer exists in ERPNext.",
		}

	proven = _restorable_now(item)
	savepoint = f"restore_{frappe.generate_hash(length=8)}"
	frappe.db.savepoint(savepoint)

	try:
		doc = frappe.get_doc(ITEM, item)
		written = {}

		for field, seen in (wanted or {}).items():
			current = doc.get(field)

			# the audit says what it saw; an Item that moved since is not ours to rewrite
			if seen is not None and str(current) != str(seen):
				raise ValidationError(
					"This Item changed after the audit was generated. "
					"Refresh the audit before restoring it.",
					"ITEM_CHANGED_SINCE_AUDIT",
				)

			if field not in proven:
				raise ValidationError(
					"No reliable previous value was found for this Item. "
					"Review it manually instead of restoring it automatically.",
					"NO_PROVEN_PREVIOUS_STATE",
				)

			if str(current) != str(proven[field]["current"]):
				raise ValidationError(
					"This Item changed after the audit was generated. "
					"Refresh the audit before restoring it.",
					"ITEM_CHANGED_SINCE_AUDIT",
				)

			doc.set(field, proven[field]["previous"])
			written[field] = {
				"old_value": current,
				"new_value": proven[field]["previous"],
				"source_of_evidence": proven[field]["source_of_evidence"],
			}

		if not written:
			raise ValidationError("Choose at least one value to restore.", "VALIDATION_ERROR")

		doc.save(ignore_permissions=True)
		doc.add_comment(
			"Comment",
			"MSP integrity repair: "
			+ ", ".join(f"{field} {row['old_value']} → {row['new_value']}" for field, row in written.items()),
		)
		_log(item, written)
	except Exception as error:
		frappe.db.rollback(save_point=savepoint)

		return {
			"item": item,
			"ok": False,
			"code": getattr(error, "code", "VALIDATION_ERROR"),
			"message": str(error),
		}

	return {"item": item, "ok": True, "restored": written}


def _restorable_now(item):
	"""The proof, read again at the moment of writing rather than trusted from the audit."""
	card = frappe.db.get_value(ITEM, item, ["disabled", "stock_uom", "sales_uom"], as_dict=True)
	history = _history(item)
	row = {
		"disabled": frappe.utils.cint(card.disabled),
		"stock_uom": card.stock_uom,
		"sales_uom": card.sales_uom,
	}
	changes = {field: _last_change(history, field) for field in REPAIRABLE}

	return _restorable(row, changes, {field: _written_by_msp(changes[field], field) for field in REPAIRABLE})


def _log(item, written):
	"""What was repaired, kept where an auditor can read it back."""
	for field, row in written.items():
		frappe.logger("msp.item_integrity").info(
			json.dumps(
				{
					"item": item,
					"field": field,
					"old_value": row["old_value"],
					"new_value": row["new_value"],
					"source_of_evidence": row["source_of_evidence"],
					"performed_by": frappe.session.user,
					"performed_at": frappe.utils.now(),
				},
				default=str,
			)
		)
