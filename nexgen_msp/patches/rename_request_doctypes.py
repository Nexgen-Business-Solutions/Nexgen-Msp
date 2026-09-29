import frappe

RENAMES = (
	("MSP Service Request", "MSP Request"),
	("MSP Service Request Line", "MSP Request Line"),
	("MSP Service Work Order", "MSP Work Order"),
)

STORED_NAMES = (
	("__UserSettings", "doctype"),
	("__global_search", "doctype"),
	("tabDeleted Document", "deleted_doctype"),
	("tabAccess Log", "export_from"),
)


def execute():
	"""Rename the request doctypes before the definitions shipped under their new names are synced."""
	renamed = 0
	developer_mode = frappe.conf.developer_mode
	frappe.conf.developer_mode = 0

	try:
		for old, new in RENAMES:
			if not frappe.db.exists("DocType", old):
				continue

			if frappe.db.exists("DocType", new):
				print(f"  {new} already exists, {old} left alone")
				continue

			frappe.rename_doc("DocType", old, new, force=True, show_alert=False, rebuild_search=False)
			frappe.clear_cache()
			frappe.db.commit()
			renamed += 1
	finally:
		frappe.conf.developer_mode = developer_mode

	settled = settle_stored_names()
	frappe.db.commit()

	print(f"  {renamed} request doctype(s) renamed, {settled} stored name(s) moved")


def settle_stored_names():
	"""Move the doctype names that rename_doc leaves behind in plain text columns."""
	moved = 0
	olds = tuple(old for old, _new in RENAMES)
	cases = " ".join("when %s then %s" for _pair in RENAMES)
	pairs = tuple(value for pair in RENAMES for value in pair)

	for table, column in STORED_NAMES:
		if not table_has_column(table, column):
			continue

		keyed = table.startswith("__")
		frappe.db.sql(
			f"update {'ignore' if keyed else ''} `{table}` set `{column}` = case `{column}` {cases} end "
			f"where `{column}` in %s",
			(*pairs, olds),
		)
		moved += frappe.db._cursor.rowcount

		if keyed:
			frappe.db.sql(f"delete from `{table}` where `{column}` in %s", (olds,))

	return moved


def table_has_column(table, column):
	return bool(
		frappe.db.sql(
			"""
			select 1 from information_schema.columns
			where table_schema = database() and table_name = %s and column_name = %s
			limit 1
			""",
			(table, column),
		)
	)
