"""One billing run as its page reads it.

The engine keeps the record; this says what the page shows: which of the three operations
it is, how far along the real transitions it stands, the figures above the lines, the
moves still allowed, and what happened to it so far.
"""

from frappe.utils import flt, getdate

from nexgen_msp.api.internal.services.billing_service import BillingService

# the four states a run actually passes through, named as the document's own states
STAGES = ("Validation", "Approval", "Invoice", "Posted")

SETTLED = ("Invoiced", "Cancelled")


def _kind(run):
    if run["credit_note_of"]:
        return "Credit note"
    if run["adjustment_of"]:
        return "Additions"
    if run["reconstructed"]:
        return "Historical coverage"

    return "Regular billing"


def _stage(run):
    """Where the run stands, read off its own status rather than off a screen."""
    status = run["status"]

    if status == "Invoiced":
        return 3
    if status in ("Approved", "Invoice Drafted") or run["sales_invoice"]:
        return 2
    if status == "Ready for Approval":
        return 1

    return 0


def _moves(run):
    """Every move this run still allows, each one a decision somebody is entitled to."""
    offers = [
        ("revalidate", "Revalidate", "quiet", run["can_revalidate"]),
        (
            "invoice",
            "Approve and invoice" if run["can_approve"] else "Create invoice",
            "primary",
            run["can_approve"] or run["can_invoice"],
        ),
        (
            "submit_invoice",
            "Submit credit note" if run["is_credit_note"] else "Submit invoice",
            "primary",
            run["can_submit_invoice"],
        ),
        ("edit_invoice", "Edit invoice", "quiet", run["can_discard_invoice"]),
        ("discard_invoice", "Discard invoice", "quiet", run["can_discard_invoice"]),
        ("reopen", "Reopen run", "quiet", run["can_reopen"]),
        ("invoice_pdf", "Invoice PDF", "quiet", run["invoice_submitted"]),
        ("breakdown", "Breakdown file", "quiet", True),
        ("resolve_dispute", "Settle the dispute", "warn", run["can_resolve_dispute"]),
        # a customer contests their invoice from their own portal; what this side offers
        # against a posted charge is a credit note, prepared like any other operation
        ("credit", "Create credit note", "quiet", run["can_contest"]),
        ("cancel", "Cancel run", "danger", run["can_cancel"]),
    ]

    return [
        {"action": action, "label": label, "look": look}
        for action, label, look, allowed in offers
        if allowed
    ]


def _activity(run):
    """What has happened to this run, in the order it happened."""
    events = [{"label": "Billing run created", "by": run["prepared_by"], "on": None}]

    if run["status"] not in ("Draft", "Validating"):
        events.append({"label": "Coverage checked", "by": None, "on": None})

    if run["approved_by"]:
        events.append(
            {"label": "Approved", "by": run["approved_by"], "on": run["approved_at"]}
        )

    if run["sales_invoice"]:
        events.append(
            {
                "label": "Sales invoice drafted" if not run["invoice_submitted"] else "Sales invoice posted",
                "by": None,
                "on": None,
            }
        )

    if run["disputed"]:
        events.append({"label": "Customer disputed the invoice", "by": None, "on": run["disputed_on"]})

    return events


def _credit_detected(run):
    """What this charge owes back on its own reading, when it can be credited at all.

    Said on the page the way `Ready to bill` says it: a proposal somebody opens, never a
    document raised behind their back.
    """
    if not run["can_contest"]:
        return None

    try:
        source = BillingService.creditable_lines(run["name"])
    except Exception:
        return None

    owed = [line for line in source["lines"] if line.get("owed_back")]

    if not owed:
        return None

    amount = sum(
        flt(line["owed_back"]["months"])
        * flt(line.get("unit_rate") or 0)
        * flt(line.get("quantity") or 1)
        for line in owed
    )

    return {
        "lines": len(owed),
        "months": flt(source.get("owed_back_months"), 3),
        "amount": -flt(amount, 2),
        "currency": source.get("currency"),
    }


def run_view(name=None):
    """The whole page in one read."""
    run = BillingService.get_run(name=name)
    billed = [line for line in run["lines"] if not line["exception_code"]]

    return {
        **run,
        "kind": _kind(run),
        "stage": _stage(run),
        "stages": list(STAGES),
        "settled": run["status"] in SETTLED,
        "moves": _moves(run),
        "credit_detected": _credit_detected(run),
        "activity": _activity(run),
        "figures": {
            "amount": flt(run["total_amount"], 2),
            "currency": run["currency"],
            "lines": len(run["lines"]),
            "billed_lines": len(billed),
            "exceptions": run["exception_count"],
            "months": flt(sum(flt(line["billable_months"]) for line in billed), 2),
            "people": len({line["client_user"] for line in billed if line["client_user"]}),
            "devices": len({line["hostname"] for line in billed if line["hostname"]}),
        },
        "as_of": getdate(),
    }
