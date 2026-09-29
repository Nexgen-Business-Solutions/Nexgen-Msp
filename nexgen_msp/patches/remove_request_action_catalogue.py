"""Remove the request action catalogue, which nothing reads any more."""

import frappe

DOCTYPE = "MSP Request Action"
LINKED = ("MSP Request Line", "MSP Work Order")


def execute():
	columns = 0

	for doctype in LINKED:
		if frappe.db.has_column(doctype, "request_action"):
			frappe.db.sql_ddl(f"alter table `tab{doctype}` drop column `request_action`")
			columns += 1

	removed = 0

	if frappe.db.exists("DocType", DOCTYPE):
		frappe.delete_doc("DocType", DOCTYPE, force=True, ignore_permissions=True)
		removed = 1

	frappe.db.sql_ddl(f"drop table if exists `tab{DOCTYPE}`")
	frappe.db.commit()

	print(f"request action catalogue: {removed} DocType removed, {columns} column(s) dropped")
