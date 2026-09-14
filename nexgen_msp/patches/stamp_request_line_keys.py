import frappe

from nexgen_msp.utils import request_intents


def execute():
	"""Give the request lines written before Phase 4 the two keys the workbench groups by.

	The keys are derived from the line itself, so this invents nothing: a line naming a
	person on file is keyed to that person, and one naming a person still to be created is
	keyed to the name the customer wrote. A line that names nobody stays without a key, and
	the request stays readable exactly as it is.
	"""
	rows = frappe.get_all(
		"MSP Service Request Line",
		filters={"subject_key": ("in", (None, ""))},
		fields=[
			"name",
			"is_new_user",
			"new_user_full_name",
			"client_user",
			"requested_for_user",
			"is_new_device",
			"managed_device",
		],
	)

	stamped = 0
	unkeyed = 0

	for row in rows:
		subject = request_intents.subject_key(row)
		device = request_intents.device_requirement_key(row)

		if not subject:
			unkeyed += 1
			continue

		frappe.db.set_value(
			"MSP Service Request Line",
			row.name,
			{"subject_key": subject, "device_requirement_key": device},
			update_modified=False,
		)
		stamped += 1

	frappe.db.commit()

	print(f"Request line keys: {stamped} stamped, {unkeyed} left without a subject")
