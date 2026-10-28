"""Which way an accounting amount points, decided once.

ERPNext stores what each document stores: a credit note may carry its figures negative, or
carry them positive and say `is_return`. Either way the money goes back to the customer, so
every screen has to read it as a deduction — and a screen that adds its own minus sign to a
figure that is already negative turns a credit back into a charge.

So the direction is settled here, on the way out of the server, and read nowhere else: a
credit is negative, a charge is whatever the document says it is, and the amount a screen
receives is already the one to print.
"""

from frappe.utils import flt


def signed(amount, credit=False):
    """The amount as it should be read: a credit deducts, anything else stands as recorded."""
    value = flt(amount)

    return -abs(value) if credit else value


def totals_by_currency(rows):
    """Signed totals, one per currency, because two currencies are never one number."""
    totals = {}

    for currency, amount in rows:
        key = currency or ""
        totals[key] = flt(totals.get(key, 0) + flt(amount), 2)

    return [
        {"currency": currency, "amount": amount}
        for currency, amount in sorted(totals.items(), key=lambda pair: -abs(pair[1]))
    ]
