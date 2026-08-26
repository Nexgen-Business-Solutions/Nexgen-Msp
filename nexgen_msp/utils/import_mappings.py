import json
import os

import frappe

FIXTURE = "import_mappings.json"

TABLES = {
	"customer_mappings": ("excel_label", ("excel_label", "customer_id", "create_as", "department_prefix")),
	"service_mappings": (
		"service_key",
		("service_key", "item_id", "scope", "is_endpoint_protection"),
	),
}


def _path():
	# deliberately not under fixtures/: Frappe imports every json there as a document
	# list, and this file is a plain mapping table
	return os.path.join(frappe.get_app_path("nexgen_msp"), "data", FIXTURE)


def export_mappings():
	"""Write what this site holds into the app, so the next deployment carries it."""
	doc = frappe.get_single("MSP Import Settings")
	payload = {
		table: [{field: row.get(field) for field in fields} for row in doc.get(table)]
		for table, (_key, fields) in TABLES.items()
	}

	with open(_path(), "w") as handle:
		json.dump(payload, handle, indent=1)
		handle.write("\n")

	return payload


def ensure_mappings():
	"""Apply the shipped mapping, adding only what the site does not already have.

	A row already present is left untouched: production may have corrected an id, and a
	deployment must not overwrite that correction with the value frozen in the repository.
	"""
	path = _path()

	if not os.path.exists(path):
		return

	with open(path) as handle:
		payload = json.load(handle)

	doc = frappe.get_single("MSP Import Settings")
	added = 0

	for table, (key, _fields) in TABLES.items():
		held = {(row.get(key) or "").strip().lower() for row in doc.get(table)}

		for row in payload.get(table, []):
			if (row.get(key) or "").strip().lower() in held:
				continue

			doc.append(table, row)
			added += 1

	if added:
		doc.save(ignore_permissions=True)
		frappe.db.commit()

	return added
