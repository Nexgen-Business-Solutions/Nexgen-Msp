"""The two accounting settings foreign-currency billing needs, applied at deployment.

Both live in ERPNext, not in this app, so a deployment does not carry them by itself — they
were being set by hand on each site and forgotten. This runs with the migration instead.

Done once per site and never again: a marker is written afterwards, so an accountant who
later turns either of them off keeps that decision through the next deployment.
"""

import frappe

MARKER = "msp_currency_setup_done"

# the CFA franc is fixed to the euro by monetary agreement, and no online provider quotes
# it — without this peg, converting anything into XAF returns nothing at all
PEGS = (("XAF", "EUR", 655.957),)


def ensure_currency_settings():
    if frappe.db.get_default(MARKER):
        return

    if not frappe.db.exists("DocType", "Pegged Currencies"):
        return

    added = _add_pegs()
    enabled = _allow_pegged()

    frappe.db.set_default(MARKER, "1")
    frappe.db.commit()

    if added or enabled:
        print(f"  currency setup: {added} peg(s) added, pegged rates {'enabled' if enabled else 'already on'}")


def _add_pegs():
    """Declare the fixed parities, leaving alone any the site already holds."""
    doc = frappe.get_single("Pegged Currencies")
    held = {row.source_currency for row in doc.pegged_currency_item or []}
    added = 0

    for source, against, ratio in PEGS:
        if source in held or not frappe.db.exists("Currency", source):
            continue

        doc.append(
            "pegged_currency_item",
            {"source_currency": source, "pegged_against": against, "pegged_exchange_rate": ratio},
        )
        added += 1

    if added:
        doc.save(ignore_permissions=True)

    return added


def _allow_pegged():
    """Let ERPNext route through those parities when it converts."""
    settings = frappe.get_single("Accounts Settings")

    if settings.get("allow_pegged_currencies_exchange_rates"):
        return False

    settings.allow_pegged_currencies_exchange_rates = 1
    settings.save(ignore_permissions=True)

    return True
