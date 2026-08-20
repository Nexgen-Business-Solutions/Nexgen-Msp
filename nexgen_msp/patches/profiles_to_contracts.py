import frappe


def execute():
	"""Each customer profile becomes its first contract, carrying its terms and services."""
	if not frappe.db.table_exists("MSP Customer Profile"):
		return

	for profile in frappe.get_all("MSP Customer Profile", pluck="name"):
		if frappe.db.exists("MSP Contract", {"customer": profile}):
			continue

		doc = frappe.get_doc("MSP Customer Profile", profile)

		contract = frappe.new_doc("MSP Contract")
		contract.customer = doc.customer
		contract.title = f"{doc.customer} — migrated"
		contract.status = doc.get("contract_status") or "Draft"
		contract.start_date = doc.get("contract_start_date") or frappe.utils.today()
		contract.end_date = doc.get("contract_end_date")
		contract.billing_frequency = doc.get("billing_frequency") or "Monthly"
		contract.billing_timing = doc.get("billing_timing") or "In Arrears"
		contract.proration_method = doc.get("proration_method") or "Daily Actual Days"
		contract.invoice_grouping = doc.get("invoice_grouping") or "One Invoice"
		contract.price_list = doc.get("price_list")
		contract.price_list_valid_upto = doc.get("price_list_valid_upto")
		contract.currency = doc.get("currency")
		contract.default_cost_center = doc.get("default_cost_center")
		contract.billing_notes = doc.get("billing_notes")

		for row in doc.get("service_eligibility") or []:
			if row.is_eligible:
				contract.append("services", {"service_item": row.service_item})

		contract.insert(ignore_permissions=True)

	frappe.db.commit()
