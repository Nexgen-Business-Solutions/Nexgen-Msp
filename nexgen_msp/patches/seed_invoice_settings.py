import frappe

DEFAULTS = {
	"issuer_name": "Nexgen Business Solutions",
	"issuer_address": "Office 115 - 1800 Boulevard Le Corbusier\nLaval, H7S 2K1",
	"issuer_phone": "+1 438 542 5757",
	"issuer_website": "www.nxgensolutions.com",
	"bank_currency": "USD",
	"beneficiary": "Nexgen Business Solutions Inc.\n115 - 1800 Boulevard Le Corbusier\n"
	"Laval, QC H7S 2K1\nCanada",
	"beneficiary_bank": "RBC Royal Bank of Canada\nBank / Institution Number: 006\n"
	"Branch / Transit Number: 05649\nAccount Number: 6549793\nCurrency: USD\n"
	"SWIFT/BIC: ROYCCAT2",
	"intermediary_bank": "JPMorgan Chase Bank, New York\nSWIFT/BIC: CHASUS33\nABA: 021000021",
	"footer_note": "Thank you for your business!",
	"portal_url": "https://myaccount.nxgensolutions.com",
}


def execute():
	"""Move what the invoice template had hardcoded into settings the admin can edit."""
	doc = frappe.get_single("MSP Invoice Settings")

	for field, value in DEFAULTS.items():
		if not doc.get(field):
			doc.set(field, value)

	doc.save(ignore_permissions=True)
	frappe.db.commit()
