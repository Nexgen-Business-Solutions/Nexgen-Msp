import frappe

from nexgen_msp.api.internal.services.request_service import ABANDONED_STATUSES


def execute():
	"""Give the already-closed requests the line outcomes they never got.

	Only the lines nobody ruled on: a line approved or refused before the request ended
	keeps the verdict it was given.
	"""
	frappe.db.sql(
		"""
		update `tabMSP Service Request Line` srl
		join `tabMSP Service Request` sr on sr.name = srl.parent
		set srl.line_status = sr.status
		where srl.line_status = 'Pending'
		  and sr.status in %(closed)s
		""",
		{"closed": ABANDONED_STATUSES},
	)

	frappe.db.commit()
