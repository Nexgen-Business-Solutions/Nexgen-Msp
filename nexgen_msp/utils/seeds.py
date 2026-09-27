"""The records the app cannot run without, put in place at every deployment.

Frappe marks every patch as already applied when an app is installed on a fresh site, so a
seed written as a patch runs on the sites that were migrated and never on the ones that
start clean — the opposite of what a seed is for. These are the ones a site cannot
work without: the billing unit and the letterhead an invoice is printed with.

The first is structure, and is restored whenever it is missing: without it the app cannot
run at all. The second is editorial — an address, a bank, a footer — so it is written once
and then left alone, because an empty field there is a decision someone is entitled to
make.

The values themselves stay in the patches, which remain the single place they are written
down.
"""

import frappe

from nexgen_msp.patches import (
    billing_month_uom,
    portal_url_moves_home,
    seed_invoice_settings,
)
from nexgen_msp.utils.catalogue import BILLING_UOM

SETTINGS_MARKER = "msp_invoice_defaults_seeded"


def ensure_seeds():
    done = [name for name in (_uom(), _invoice_settings(), _live_sessions()) if name]

    if done:
        print(f"  seeds: {', '.join(done)}")


def _uom():
    """Billing quantities are months, and ERPNext ships no such unit.

    Only the UOM record itself: an Item is never touched by a seed.
    """
    if frappe.db.exists("UOM", BILLING_UOM) and not frappe.db.get_value(
        "UOM", BILLING_UOM, "must_be_whole_number"
    ):
        return None

    billing_month_uom.execute()

    return f"{BILLING_UOM} billing unit"


def _invoice_settings():
    """The issuer, the bank, and the address invited customers are sent to.

    Once per site: whoever later clears the portal address, or rewrites the footer, keeps
    that through every deployment that follows.
    """
    if frappe.db.get_default(SETTINGS_MARKER):
        return None

    seed_invoice_settings.execute()
    portal_url_moves_home.execute()
    frappe.db.set_default(SETTINGS_MARKER, "1")
    frappe.db.commit()

    return "invoice settings"


def _live_sessions():
    """A deployment that changes the customer session limit reaches the sessions already open."""
    from nexgen_msp.utils.session_timeout import refresh_live_sessions

    touched = refresh_live_sessions()

    return f"{touched} live customer session(s) given the current limit" if touched else None
