"""The records the app cannot run without, put in place at every deployment.

Frappe marks every patch as already applied when an app is installed on a fresh site, so a
seed written as a patch runs on the sites that were migrated and never on the ones that
start clean — the opposite of what a seed is for. These three are the ones a site cannot
work without: the billing unit, the actions a customer may ask for, and the letterhead an
invoice is printed with.

Each is only touched while the evidence of it is missing, so a value corrected in
production survives the next deployment. The values themselves stay in the patches, which
remain the single place they are written down.
"""

import frappe

from nexgen_msp.patches import billing_month_uom, seed_invoice_settings, seed_request_actions
from nexgen_msp.utils.catalogue import BILLING_UOM


def ensure_seeds():
    done = [name for name in (_uom(), _actions(), _invoice_settings()) if name]

    if done:
        print(f"  seeds: {', '.join(done)}")


def _uom():
    """Billing quantities are months, and ERPNext ships no such unit."""
    if frappe.db.exists("UOM", BILLING_UOM) and not frappe.db.get_value(
        "UOM", BILLING_UOM, "must_be_whole_number"
    ):
        return None

    billing_month_uom.execute()

    return f"{BILLING_UOM} unit"


def _actions():
    """Without these a customer has nothing to ask for."""
    if frappe.db.count("MSP Request Action"):
        return None

    seed_request_actions.execute()

    return "request actions"


def _invoice_settings():
    """The issuer and bank an invoice is printed with."""
    if frappe.db.get_single_value("MSP Invoice Settings", "issuer_name"):
        return None

    seed_invoice_settings.execute()

    return "invoice settings"
