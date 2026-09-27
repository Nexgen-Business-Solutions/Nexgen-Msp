"""Write on every request line and work order which operation it is, in code.

What a request asks for used to be read from a table an administrator could edit. From this
release the operation is a code the application defines, so every line and every work order
already on file is given the code its old action means. Nothing else about them changes: the
history keeps its own words, and the rows stay exactly where they are.
"""

import frappe

from nexgen_msp.utils import operations


def execute():
	lines = _fill_lines()
	orders = _fill_orders()

	print(f"request operations: {lines} request line(s), {orders} work order(s) given an operation code")


def _fill_lines():
	if not frappe.db.has_column("MSP Service Request Line", "operation_code"):
		return 0

	filled = 0

	for row in frappe.db.sql(
		"""
		select name, action
		from `tabMSP Service Request Line`
		where ifnull(operation_code, '') = ''
		""",
		as_dict=True,
	):
		code = operations.from_legacy_action(row.action)

		if not code:
			continue

		frappe.db.sql(
			"""
			update `tabMSP Service Request Line`
			set operation_code = %(code)s, operation_label_snapshot = %(label)s
			where name = %(name)s
			""",
			{"code": code, "label": operations.label(code), "name": row.name},
		)
		filled += 1

	frappe.db.commit()

	return filled


def _fill_orders():
	if not frappe.db.has_column("MSP Service Work Order", "operation_code"):
		return 0

	filled = 0

	for row in frappe.db.sql(
		"""
		select name, action, work_type
		from `tabMSP Service Work Order`
		where ifnull(operation_code, '') = ''
		""",
		as_dict=True,
	):
		code = operations.from_legacy_work(row.action)

		if not code and row.work_type == "User Setup":
			code = "client_user.create"

		if not code and row.work_type == "Device Provisioning":
			code = "device.register"

		if not code:
			continue

		frappe.db.sql(
			"update `tabMSP Service Work Order` set operation_code = %(code)s where name = %(name)s",
			{"code": code, "name": row.name},
		)
		filled += 1

	frappe.db.commit()

	return filled
