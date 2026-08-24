import frappe

ACTIONS = (
	("Grant a service", "Add", "Give someone or a machine a service they do not have yet."),
	("Change a service", "Change", "Adjust an existing service — quantity, device or terms."),
	("Suspend a service", "Suspend", "Pause a service without ending it, and stop billing it."),
	("Resume a service", "Resume", "Restart a service that was paused."),
	("Remove a service", "Remove", "End a service for good."),
)


def execute():
	"""Turn the hardcoded action list into records the admin can extend."""
	for title, action_type, description in ACTIONS:
		if frappe.db.exists("MSP Request Action", title):
			continue

		frappe.get_doc(
			{
				"doctype": "MSP Request Action",
				"title": title,
				"action_type": action_type,
				"description": description,
				"enabled": 1,
			}
		).insert(ignore_permissions=True)

	frappe.db.commit()
