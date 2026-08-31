import frappe

# the services whose licence is issued against a named account, not a machine
NEEDS_USERNAME = ("nextcloud", "parallels")


def execute():
	"""Mark the services a technician cannot deliver without a username.

	Read from the mapping rather than written into the code that checks it: which product
	needs an account name is a catalogue fact, and it changes without the rule changing.
	"""
	if not frappe.db.exists("DocType", "MSP Service Mapping"):
		return

	flagged = 0

	for name, key in frappe.get_all(
		"MSP Service Mapping", fields=["name", "service_key"], as_list=True
	):
		wanted = 1 if (key or "").strip().lower() in NEEDS_USERNAME else 0

		if frappe.db.get_value("MSP Service Mapping", name, "requires_username") == wanted:
			continue

		frappe.db.set_value("MSP Service Mapping", name, "requires_username", wanted, update_modified=False)
		flagged += 1

	frappe.db.commit()
	print(f"  {flagged} service mapping(s) flagged")
