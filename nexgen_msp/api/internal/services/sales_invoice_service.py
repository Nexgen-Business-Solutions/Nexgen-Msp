"""The invoices ERPNext holds, whether this application drew them or not.

Most of what a customer has been charged was not raised here: invoices made before this
application existed, or posted straight in the accounting desk, carry no billing run and
were therefore invisible. They are still the money the customer owes, and somebody
reconciling an account needs to see them beside the runs.

This reads them and nothing else. It never creates a run to explain an invoice, never
infers from an invoice that a service was covered, and never shows a document belonging to
a company the reader may not act for.
"""

import frappe
from frappe.utils import flt

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils import access
from nexgen_msp.utils.errors import NotFoundError, ValidationError

FIELDS = (
    "name", "customer", "customer_name", "company", "posting_date", "due_date",
    "currency", "grand_total", "outstanding_amount", "status", "docstatus",
    "is_return", "return_against",
)


def _reachable():
    """The companies this reader may act for, or nothing when they may act for none."""
    ContractService._guard_admin()

    return access.allowed_customers()


def _runs_by_invoice(names):
    if not names:
        return {}

    rows = frappe.db.sql(
        """
        select sales_invoice, min(name) as run
        from `tabMSP Billing Run`
        where sales_invoice in %(names)s and docstatus < 2
        group by sales_invoice
        """,
        {"names": tuple(names)},
        as_dict=True,
    )

    return {row.sales_invoice: row.run for row in rows}


def list_invoices(
    customer=None, status=None, statuses=None, posting_from=None, posting_to=None,
    search=None, kind=None, page=1, page_length=20, count_only=False,
):
    """The customer invoices in reach, newest first, with where each one came from."""
    allowed = _reachable()

    if not allowed:
        return {"total": 0, "rows": [], "page": 1, "page_length": 0}

    conditions = ["si.customer in %(allowed)s"]
    values = {"allowed": tuple(allowed)}

    if customer:
        if customer not in allowed:
            raise ValidationError(f"{customer} is not a company you act for.", "NOT_PERMITTED")

        conditions.append("si.customer = %(customer)s")
        values["customer"] = customer

    if status:
        conditions.append("si.status = %(status)s")
        values["status"] = status

    if statuses:
        conditions.append("si.status in %(statuses)s")
        values["statuses"] = tuple(statuses)

    if posting_from:
        conditions.append("si.posting_date >= %(posting_from)s")
        values["posting_from"] = posting_from

    if posting_to:
        conditions.append("si.posting_date <= %(posting_to)s")
        values["posting_to"] = posting_to

    if kind == "returns":
        conditions.append("ifnull(si.is_return, 0) = 1")
    elif kind == "invoices":
        conditions.append("ifnull(si.is_return, 0) = 0")

    if search:
        conditions.append("(si.name like %(search)s or si.customer like %(search)s)")
        values["search"] = f"%{search}%"

    where = " and ".join(conditions)
    page = max(1, frappe.utils.cint(page))
    page_length = min(100, max(5, frappe.utils.cint(page_length) or 20))
    values["limit"] = page_length
    values["start"] = (page - 1) * page_length

    total = frappe.db.sql(
        f"select count(*) from `tabSales Invoice` si where {where}", values
    )[0][0]

    # a tab chip only needs how many there are, never the page behind it
    if count_only:
        return {"total": total, "rows": [], "page": page, "page_length": page_length}

    rows = frappe.db.sql(
        f"""
        select {", ".join("si." + field for field in FIELDS)}
        from `tabSales Invoice` si
        where {where}
        order by si.posting_date desc, si.name desc
        limit %(limit)s offset %(start)s
        """,
        values,
        as_dict=True,
    )
    runs = _runs_by_invoice([row.name for row in rows])

    for row in rows:
        row["billing_run"] = runs.get(row.name)
        # where it came from is read off a link that exists, never guessed from its shape
        row["origin"] = "MSP" if row["billing_run"] else "ERPNext"

    return {"total": total, "rows": rows, "page": page, "page_length": page_length}


def invoice_detail(name=None):
    """One invoice as ERPNext holds it, plus the run that drew it when there is one."""
    allowed = _reachable()
    card = frappe.db.get_value("Sales Invoice", name, FIELDS, as_dict=True) if name else None

    # a document of a company this reader may not act for does not exist as far as they
    # are concerned: saying "not permitted" would already say that it exists
    if not card or card.customer not in allowed:
        raise NotFoundError(f"Sales Invoice {name} not found.", "NOT_FOUND")

    doc = frappe.get_doc("Sales Invoice", name)
    run = _runs_by_invoice([name]).get(name)

    return {
        **card,
        "billing_run": run,
        "origin": "MSP" if run else "ERPNext",
        "conversion_rate": flt(doc.conversion_rate),
        "payment_terms_template": doc.payment_terms_template,
        "cost_center": doc.cost_center,
        "remarks": doc.remarks,
        "net_total": flt(doc.net_total),
        "total_taxes_and_charges": flt(doc.total_taxes_and_charges),
        "items": [
            {
                "item_code": row.item_code,
                "description": row.description,
                "qty": flt(row.qty),
                "uom": row.uom,
                "rate": flt(row.rate),
                "amount": flt(row.amount),
                "cost_center": row.cost_center,
            }
            for row in doc.items
        ],
        "taxes": [
            {"description": row.description, "rate": flt(row.rate), "total": flt(row.total)}
            for row in doc.get("taxes") or []
        ],
        "payment_schedule": [
            {"due_date": str(row.due_date), "payment_amount": flt(row.payment_amount)}
            for row in doc.get("payment_schedule") or []
        ],
        # returns written against this invoice, said as ERPNext holds them
        "returns": frappe.get_all(
            "Sales Invoice",
            filters={"return_against": name, "docstatus": ["<", 2]},
            fields=["name", "posting_date", "grand_total", "status", "docstatus"],
            order_by="posting_date desc",
        ),
        "returned_against": frappe.db.get_value(
            "Sales Invoice", card.return_against, ["name", "posting_date", "grand_total"],
            as_dict=True,
        )
        if card.return_against
        else None,
    }
