import frappe

# profiled before adding: each of these was a full table scan on the real site, and each one
# is on a path the application walks constantly
INDEXES = (
	# the current holder of a machine, and everything a person holds
	("MSP Device Holder", ["parent", "is_current"], "holder_current"),
	("MSP Device Holder", ["client_user", "is_current"], "holder_person"),
	# what a person or a machine is running, which billing and availability both ask for
	("MSP Service Assignment", ["customer", "assignment_scope", "client_user"], "sa_person"),
	("MSP Service Assignment", ["customer", "assignment_scope", "managed_device"], "sa_machine"),
	("MSP Service Assignment", ["service_item", "operational_status"], "sa_service"),
	# which requests speak of a person, and which act on one service
	("MSP Service Request Line", ["client_user"], "srl_person"),
	("MSP Service Request Line", ["requested_for_user"], "srl_for_person"),
	("MSP Service Request Line", ["source_service_assignment"], "srl_assignment"),
	("MSP Service Request Line", ["subject_key"], "srl_subject"),
	# a request's queue position, and the work behind it
	("MSP Service Request", ["customer", "status"], "sr_queue"),
	("MSP Service Work Order", ["service_request", "status"], "wo_request"),
	# whether a service has already been billed for an overlapping period
	("MSP Billing Run Line", ["service_assignment"], "brl_assignment"),
	("MSP Billing Run", ["customer", "billing_period_end"], "br_period"),
	# the user register: one company's people, in name order, with what each of them runs.
	# the counts down each row ask about a person alone, so an index that leads on the
	# company cannot serve them
	("MSP Client User", ["customer", "full_name"], "cu_register"),
	("MSP Service Assignment", ["client_user", "operational_status"], "sa_of_person"),
	("MSP Service Assignment", ["managed_device", "operational_status"], "sa_of_machine"),
	("MSP Managed Device", ["assigned_client_user", "status"], "device_of_person"),
)


def execute():
	"""Index the lookups the application walks on every screen."""
	added = 0

	for doctype, fields, name in INDEXES:
		table = f"tab{doctype}"

		if frappe.db.sql(
			"""
			select 1 from information_schema.statistics
			where table_schema = database() and table_name = %s and index_name = %s
			limit 1
			""",
			(table, name),
		):
			continue

		try:
			frappe.db.add_index(doctype, fields, index_name=name)
			added += 1
		except Exception as error:
			print(f"  could not index {doctype} ({', '.join(fields)}): {error}")

	frappe.db.commit()

	print(f"Hot lookups: {added} index(es) added")
