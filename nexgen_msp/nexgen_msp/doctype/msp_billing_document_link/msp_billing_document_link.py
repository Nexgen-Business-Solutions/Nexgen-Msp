import frappe
from frappe.model.document import Document


class MSPBillingDocumentLink(Document):
    """One ERPNext document a billing run produced, and the group it answers.

    A run billed `By Site` or `By PO or Cost Center` makes several documents; each one is
    recorded here with the key it was grouped on, so a reader never has to guess which
    invoice carries which lines.
    """

    pass
