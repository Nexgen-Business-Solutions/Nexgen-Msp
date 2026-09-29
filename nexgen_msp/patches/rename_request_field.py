import frappe
from frappe.model.utils.rename_field import rename_field

OLD = "service_request"
NEW = "request"

OWNERS = ("MSP Work Order", "MSP Requested Client User", "MSP Requested Device")


def execute():
	"""Carry the request link from its old column into the synced one, then drop the old column."""
	for doctype in OWNERS:
		copied = move_column(doctype)

		if copied is None:
			print(f"  {doctype}: no {OLD} column, nothing to carry")
		else:
			print(f"  {doctype}: {copied} row(s) carried from {OLD} to {NEW}")

	frappe.db.commit()


def move_column(doctype, old=OLD, new=NEW):
	"""Copy one column into another on a synced doctype, rebuild its indexes on the new column, drop the old one."""
	table = f"tab{doctype}"
	forget_columns(table)

	if not frappe.db.has_column(doctype, old):
		return None

	rename_field(doctype, old, new)

	stranded = frappe.db.sql(
		f"select count(*) from `{table}` where not (`{new}` <=> `{old}`)"
	)[0][0]

	if stranded:
		frappe.throw(f"{doctype}: {stranded} row(s) did not carry {old} into {new}.")

	indexes = indexes_on(table, old)

	for name in indexes:
		frappe.db.sql_ddl(f"alter table `{table}` drop index `{name}`")

	frappe.db.sql_ddl(f"alter table `{table}` drop column `{old}`")

	for name, (unique, columns) in indexes.items():
		columns = [new if column == old else column for column in columns]
		kind = "unique index" if unique else "index"
		frappe.db.sql_ddl(
			f"alter table `{table}` add {kind} `{name}` ({', '.join(f'`{column}`' for column in columns)})"
		)

	forget_columns(table)
	frappe.clear_cache(doctype=doctype)

	return frappe.db.sql(f"select count(*) from `{table}` where `{new}` is not null and `{new}` != ''")[0][0]


def indexes_on(table, column):
	"""The indexes of a table that include a column, with their uniqueness and ordered columns."""
	names = frappe.db.sql_list(
		"""
		select distinct index_name from information_schema.statistics
		where table_schema = database() and table_name = %s and column_name = %s
		""",
		(table, column),
	)
	indexes = {}

	for name in names:
		rows = frappe.db.sql(
			"""
			select non_unique, column_name from information_schema.statistics
			where table_schema = database() and table_name = %s and index_name = %s
			order by seq_in_index
			""",
			(table, name),
		)
		indexes[name] = (not rows[0][0], [row[1] for row in rows])

	return indexes


def forget_columns(table):
	frappe.client_cache.delete_value(f"table_columns::{table}")
