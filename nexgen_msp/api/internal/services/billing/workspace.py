"""What the Billing landing page reads: figures, work waiting, and one list.

The page asks once. It gets the four figures, the actions somebody can start today, and
the page of rows for whichever tab is open — runs drawn here, or the invoices the
accounting desk holds whether this application drew them or not.
"""

import frappe
from frappe.utils import cint, flt, getdate

from nexgen_msp.api.internal.services import sales_invoice_service
from nexgen_msp.api.internal.services.billing import money
from nexgen_msp.api.internal.services.billing_service import BillingService

# what the one status filter means on each list, so both tabs read the same way
RUN_BUCKETS = {
    "awaiting": ["Ready for Approval"],
    "open": [
        "Draft",
        "Validating",
        "Exception",
        "Ready for Approval",
        "Approved",
        "Invoice Drafted",
    ],
    "posted": ["Invoiced"],
}

INVOICE_BUCKETS = {
    "open": ["Draft", "Unpaid", "Overdue", "Partly Paid"],
    "posted": ["Paid", "Return", "Credit Note Issued"],
}

TABS = ("runs", "invoices")


def _figures():
    """The four numbers at the top, each one a count somebody can act on."""
    rows = frappe.db.sql(
        """
        select status, exception_count, total_amount, currency,
               credit_note_of, standalone_credit, adjustment_of, reconstructed
        from `tabMSP Billing Run`
        where docstatus != 2
        """,
        as_dict=True,
    )

    settled = [row for row in rows if row.status in ("Invoiced", "Invoice Drafted")]

    return {
        "runs": len(rows),
        "settled": len(settled),
        "awaiting": len([row for row in rows if row.status == "Ready for Approval"]),
        "blocked": len([row for row in rows if cint(row.exception_count)]),
        "blocked_lines": sum(cint(row.exception_count) for row in rows),
        # what was really billed: credits come off rather than add up, and two currencies
        # stay two totals — nothing here adds XAF to USD to make one number
        "invoiced_totals": money.totals_by_currency(
            (row.currency, money.signed(row.total_amount, _kind_of(row) == "Credit note"))
            for row in rows
            if row.status == "Invoiced"
        ),
    }


def _kind_of(row):
    """Which of the three operations a run is, said in the listing rather than guessed."""
    if row.get("credit_note_of") or row.get("standalone_credit"):
        return "Credit note"
    if row.get("adjustment_of"):
        return "Additions"
    if row.get("reconstructed"):
        return "Historical coverage"

    return "Regular billing"


def _runs(search, status, page, page_length, count_only=False):
    listed = BillingService.list_runs(
        search=search,
        statuses=RUN_BUCKETS.get(status),
        focus="issue" if status == "issue" else None,
        start=(page - 1) * page_length,
        page_length=page_length,
        count_only=count_only,
    )

    # what the ledger says about each document on this page, read in one go: a run that
    # says `Invoice Drafted` against a posted document is said so here rather than later
    documents = {
        found.name: found.docstatus
        for found in (
            frappe.get_all(
                "Sales Invoice",
                filters={
                    "name": ["in", [row["sales_invoice"] for row in listed["rows"] if row["sales_invoice"]]]
                },
                fields=["name", "docstatus"],
            )
            if any(row["sales_invoice"] for row in listed["rows"])
            else []
        )
    }

    def adrift(row):
        if not row["sales_invoice"]:
            return False

        posted = documents.get(row["sales_invoice"])

        return (posted == 1 and row["status"] != "Invoiced") or (
            posted == 2 and row["status"] == "Invoiced"
        )

    return [
        {
            "name": row["name"],
            "customer": row["customer"],
            "kind": _kind_of(row),
            "period_start": row["billing_period_start"],
            "period_end": row["billing_period_end"],
            "lines": row["line_count"],
            "exceptions": row["exception_count"],
            "amount": money.signed(row["total_amount"], _kind_of(row) == "Credit note"),
            "currency": row["currency"],
            "sales_invoice": row["sales_invoice"],
            "is_credit_note": _kind_of(row) == "Credit note",
            "invoice_docstatus": documents.get(row["sales_invoice"]),
            "needs_reconciliation": adrift(row),
            "status": row["status"],
            "disputed": bool(row["disputed"]),
        }
        for row in listed["rows"]
    ], listed["total"]


def _invoices(search, status, page, page_length, count_only=False):
    listed = sales_invoice_service.list_invoices(
        search=search,
        statuses=INVOICE_BUCKETS.get(status),
        page=page,
        page_length=page_length,
        count_only=count_only,
    )

    return [
        {
            "name": row["name"],
            "customer": row["customer_name"] or row["customer"],
            "posting_date": row["posting_date"],
            "due_date": row["due_date"],
            # the document's own direction, settled on the way out: a credit deducts
            "amount": row["signed_total"],
            "outstanding": row["signed_outstanding"],
            "currency": row["currency"],
            "is_return": bool(row["is_return"]),
            "origin": row["origin"],
            "billing_run": row["billing_run"],
            "status": row["status"],
        }
        for row in listed["rows"]
    ], listed["total"]


def workspace(tab="runs", search=None, status=None, page=1, page_length=20):
    """One read for the whole landing page."""
    BillingService._guard_admin()

    tab = tab if tab in TABS else "runs"
    page = max(cint(page), 1)
    page_length = min(100, max(5, cint(page_length) or 20))
    status = status if status in ("open", "awaiting", "posted", "issue") else None

    due = BillingService.due()
    rows, total = (
        _runs(search, status, page, page_length)
        if tab == "runs"
        else _invoices(search, status, page, page_length)
    )
    # the chip on the tab nobody is looking at: how many, never the page behind it
    _, other = (
        _invoices(search, status, 1, 1, count_only=True)
        if tab == "runs"
        else _runs(search, status, 1, 1, count_only=True)
    )

    return {
        "as_of": getdate(),
        "figures": _figures(),
        "actions": due["actions"],
        "tab": tab,
        "rows": rows,
        "total": total,
        "page": page,
        "page_length": page_length,
        "counts": {
            "runs": total if tab == "runs" else other,
            "invoices": other if tab == "runs" else total,
        },
    }
