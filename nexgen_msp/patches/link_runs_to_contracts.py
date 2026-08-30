import frappe


def execute():
	"""Runs made before contracts existed carry no contract, so coverage looks shorter than it is.

	Only runs whose customer has exactly one contract can be attached without guessing.
	"""
	orphans = frappe.get_all(
		"MSP Billing Run",
		filters={"contract": ["in", [None, ""]], "docstatus": ["!=", 2]},
		fields=["name", "customer"],
	)

	for run in orphans:
		contracts = frappe.get_all("MSP Contract", filters={"customer": run.customer}, pluck="name")

		if len(contracts) == 1:
			frappe.db.set_value(
				"MSP Billing Run", run.name, "contract", contracts[0], update_modified=False
			)

	frappe.db.commit()
