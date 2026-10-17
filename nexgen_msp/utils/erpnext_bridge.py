"""The boundary with ERPNext: everything we hand it, shaped the way it expects.

A document read back from the database carries its dates as `datetime.date`, while ERPNext's
own helpers are annotated for `str`. Frappe validates those annotations inside a request, so
a value that travelled fine for years is refused the day ERPNext annotates the function it
reaches — which is what happened to invoice posting on 15 October 2026.

Normalising here, once, keeps that class of breakage out of the services. Everything we
submit to ERPNext goes through this module, so there is a single place to adapt when their
side moves again.
"""

import frappe


def as_date_string(value):
    """An ISO date string, or None. Never a date object, and never the string "None"."""
    if value is None or value == "":
        return None

    return frappe.utils.getdate(value).isoformat()


def normalise_dates(doc):
    """Restate every Date field of an ERPNext document as an ISO string, in place.

    Only Date: a Datetime carries a time ERPNext parses differently, and nothing we pass it
    has ever broken on one.
    """
    for field in doc.meta.get("fields", {"fieldtype": "Date"}):
        value = doc.get(field.fieldname)

        if value is not None and not isinstance(value, str):
            doc.set(field.fieldname, as_date_string(value))

    return doc


def insert(doc, **kwargs):
    """Insert an ERPNext document with its dates in the shape ERPNext asks for."""
    return normalise_dates(doc).insert(**kwargs)


def submit(doc):
    """Submit an ERPNext document with its dates in the shape ERPNext asks for."""
    return normalise_dates(doc).submit()
