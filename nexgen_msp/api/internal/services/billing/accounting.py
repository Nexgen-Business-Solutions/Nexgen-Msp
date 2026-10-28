"""Who owns an accounting document, and who is allowed to undo it.

ERPNext keeps the ledger, and it stays free to post a document this application drafted: an
accountant may open the draft, correct it and submit it there, and the billing run it
belongs to has to hear about it. Undoing a posting is the other way round. A posted invoice
or credit note that belongs to a run is cancelled through that run, in one operation, or not
at all — otherwise a run reads `Invoiced` against a cancelled document, or a document stands
cancelled under a run that still counts it as billed.

So there is one resolver for who owns a document, one guard that refuses a cancellation
nobody here asked for, one synchronisation both posting paths go through, and one
coordinator that cancels the document and the run together or leaves both as they were.
"""

import json
from contextlib import contextmanager

import frappe
from frappe import _

from nexgen_msp.utils.errors import NotFoundError, ValidationError

RUN = "MSP Billing Run"
INVOICE = "Sales Invoice"

POSTED = "Invoiced"
CANCELLED = "Cancelled"

AUDIT_PREFIX = "[billing-cancel]"

# the permission to cancel one document, made here and held for the length of one operation
PERMIT = "nexgen_msp_cancelling"

# and the same for the run itself, which is cancelled by this side or not at all
RUN_PERMIT = "nexgen_msp_cancelling_run"

DRAFT, SUBMITTED, VOIDED = 0, 1, 2

ACCOUNTING_STATE = {DRAFT: "Draft", SUBMITTED: "Posted", VOIDED: "Cancelled"}


def kind_of(invoice):
    """What the document calls itself to the person reading the refusal."""
    is_return = (
        invoice.get("is_return")
        if isinstance(invoice, dict)
        else getattr(invoice, "is_return", None)
    )

    return "credit note" if frappe.utils.cint(is_return) else "invoice"


def runs_of(invoice):
    """Every Billing Run that claims this accounting document, cancelled runs included.

    A cancelled run keeps its link on purpose: what was posted and undone is part of the
    record, and the document has to stay readable from the run that raised it.
    """
    if not invoice:
        return []

    return frappe.db.sql_list(
        f"select name from `tab{RUN}` where sales_invoice = %s order by name", invoice
    )


def owner_of(invoice):
    """The one run this document belongs to, or nothing when no run does.

    Two runs claiming the same document is a broken link, and what to do about it is a
    decision somebody takes, not a run this code picks for them.
    """
    runs = runs_of(invoice)

    if not runs:
        return None

    if len(runs) > 1:
        raise ValidationError(
            f"{invoice} is claimed by more than one Billing Run ({', '.join(runs)}). "
            "Repair the link before posting or cancelling anything against it.",
            "AMBIGUOUS_OWNER",
        )

    return runs[0]


def refusal(invoice, runs):
    """What ERPNext says to somebody cancelling a document this application posted."""
    kind = kind_of(invoice)
    named = (
        f"Billing Run {runs[0]}"
        if len(runs) == 1
        else f"Billing Runs {', '.join(runs[:-1])} and {runs[-1]}"
    )

    return (
        "Cancellation not allowed"
        f"<br><br>This {kind} is linked to {named}."
        f"<br><br>To cancel this {kind}, please cancel the Billing Run in Nexgen MSP."
    )


def _permits():
    return frappe.flags.get(PERMIT) or {}


def permitted(invoice, run):
    """Whether this very document is being cancelled by this very run, here and now."""
    held = _permits().get(invoice)

    return bool(held and held.get("run") == run)


@contextmanager
def cancelling(run, invoice):
    """Permission to cancel one document, made on this side and for this operation only.

    It is written here, after the operation has been authorised and the link checked, it
    names the exact document and the exact run, and it is taken away again whatever happens
    next. Nothing that arrives in a request can reach it: a caller cannot ask for it, and a
    second operation cannot borrow the one already open.
    """
    token = frappe.generate_hash(length=16)
    held = dict(_permits())

    if invoice in held:
        raise ValidationError(
            f"{invoice} is already being cancelled. Wait for that operation to finish.",
            "INVALID_TRANSITION",
        )

    state = {"run": run, "token": token, "cancelled": False}
    held[invoice] = state
    frappe.flags[PERMIT] = held

    try:
        yield state
    finally:
        current = dict(_permits())

        if (current.get(invoice) or {}).get("token") == token:
            current.pop(invoice)

        frappe.flags[PERMIT] = current


def _run_permits():
    return frappe.flags.get(RUN_PERMIT) or {}


def run_cancellation_permitted(run):
    """Whether this very run is being cancelled by an operation that started on this side."""
    return bool(_run_permits().get(run))


@contextmanager
def cancelling_run(run):
    """Permission to cancel one Billing Run, made on this side and for this operation only.

    A run is cancelled through the operation that also sees to the document it posted, so
    the Desk's own cancellation is refused. This is how the operation says, for the length
    of itself and for one named run, that it is the one asking. Nothing that arrives in a
    request can reach it, and it is taken away again whatever happens next.
    """
    token = frappe.generate_hash(length=16)
    held = dict(_run_permits())

    if run in held:
        raise ValidationError(
            f"{run} is already being cancelled. Wait for that operation to finish.",
            "INVALID_TRANSITION",
        )

    held[run] = token
    frappe.flags[RUN_PERMIT] = held

    try:
        yield
    finally:
        current = dict(_run_permits())

        if current.get(run) == token:
            current.pop(run)

        frappe.flags[RUN_PERMIT] = current


# --------------------------------------------------------------------- document events


def _owner_for_event(doc):
    """Who owns the document an ERPNext event is about, said the way the Desk reads it."""
    try:
        return owner_of(doc.name)
    except ValidationError as unclear:
        frappe.throw(unclear.message, title=_("Posting not allowed"))


def refuse_ambiguous_posting(doc, method=None):
    """A document two runs claim is not posted until somebody repairs the link.

    Which of them was posted is a decision, not a guess, and this runs before the posting
    is written rather than after, so a refusal leaves the document the draft it was.
    """
    _owner_for_event(doc)


def invoice_submitted(doc, method=None):
    """A document of ours was posted — here or in ERPNext — so its run says so too.

    A document no run claims is ERPNext's own and is left exactly as it is.
    """
    run = _owner_for_event(doc)

    if not run:
        return

    mark_posted(run)


def refuse_unowned_cancel(doc, method=None):
    """Cancelling a document this application posted is done through its Billing Run."""
    runs = runs_of(doc.name)

    if not runs:
        return

    if len(runs) == 1 and permitted(doc.name, runs[0]):
        return

    frappe.throw(refusal(doc, runs), title=_("Cancellation not allowed"))


def invoice_cancelled(doc, method=None):
    """Note that ERPNext really did cancel it, and let the run's own link go.

    ERPNext refuses to cancel a document another record still points at, and the run that
    is cancelling it points at it — which is the one link that is not a reason to refuse,
    because both are being undone in the same operation. Everything else it checks is left
    exactly as it is. This runs after the Sales Invoice has had its own say, so the list it
    built is added to rather than replaced.
    """
    held = _permits().get(doc.name)

    if not held:
        return

    held["cancelled"] = True
    doc.ignore_linked_doctypes = tuple(getattr(doc, "ignore_linked_doctypes", None) or ()) + (RUN,)


# ----------------------------------------------------------------- one synchronisation


def mark_posted(run):
    """The one place a run becomes posted, whichever side posted its document.

    Saying it twice changes nothing, which is what lets the document event, this
    application's own posting and a later repair all go through here.
    """
    from nexgen_msp.api.internal.services.billing_service import BillingService

    card = frappe.db.get_value(
        RUN, run, ["name", "status", "docstatus", "customer"], as_dict=True
    )

    if not card or card.docstatus == VOIDED or card.status in (CANCELLED, POSTED):
        return False

    frappe.db.set_value(RUN, run, "status", POSTED)
    BillingService._recompute_last_billed(card.customer)

    return True


def drop_draft(run):
    """Throw away a drafted document and the order that exists only to carry it.

    A draft is booked nowhere and was sent to nobody, so it is deleted rather than
    cancelled — ERPNext has nothing to cancel. The run is left without a document; what its
    status becomes afterwards is the caller's decision, because discarding an invoice to
    redraw it and cancelling a run outright end in different places.
    """
    invoice = run.sales_invoice
    order = run.sales_order

    run.db_set("sales_invoice", None)
    run.db_set("sales_order", None)

    if invoice and frappe.db.exists(INVOICE, invoice):
        frappe.delete_doc(INVOICE, invoice, ignore_permissions=True)

    if order and frappe.db.exists("Sales Order", order):
        held = frappe.get_doc("Sales Order", order)

        if held.docstatus == SUBMITTED:
            held.flags.ignore_permissions = True
            held.cancel()

        frappe.delete_doc("Sales Order", order, ignore_permissions=True)

    return invoice


# ------------------------------------------------------------------- reading the state


def amended_to(invoice):
    """The document ERPNext made to replace this one, when somebody amended it.

    Read and shown, never followed: moving a run onto a replacement is a decision about
    what was billed, and nothing here is entitled to take it.
    """
    if not invoice:
        return None

    return frappe.db.get_value(INVOICE, {"amended_from": invoice, "docstatus": ["<", 2]}, "name")


def state_of(run):
    """What the run says, what its document says, and whether the two agree.

    The document is the ledger's, so it is the one that is right. This only says what was
    found, because repairing the run is an operation somebody starts, not a side effect of
    opening a page.
    """
    invoice = run.get("sales_invoice")

    if not invoice:
        return {"invoice_docstatus": None, "accounting_state": None, "mismatch": None}

    card = frappe.db.get_value(
        INVOICE, invoice, ["docstatus", "customer", "is_return"], as_dict=True
    )

    if not card:
        return {
            "invoice_docstatus": None,
            "accounting_state": None,
            "mismatch": {
                "code": "MISSING_DOCUMENT",
                "message": f"{invoice} is no longer in ERPNext. The link has to be repaired "
                "before this run can be posted or cancelled.",
            },
        }

    claimed = runs_of(invoice)
    found = {
        "invoice_docstatus": card.docstatus,
        "accounting_state": ACCOUNTING_STATE.get(card.docstatus),
        "invoice_is_return": bool(frappe.utils.cint(card.is_return)),
        "invoice_amended_to": amended_to(invoice) if card.docstatus == VOIDED else None,
        "mismatch": None,
    }

    if len(claimed) > 1:
        found["mismatch"] = {
            "code": "AMBIGUOUS_OWNER",
            "message": f"{invoice} is claimed by {', '.join(claimed)}. "
            "Repair the link before acting on it.",
        }
    elif card.docstatus == SUBMITTED and run.get("status") != POSTED:
        found["mismatch"] = {
            "code": "POSTED_ELSEWHERE",
            "message": f"{invoice} is posted in ERPNext while this run still reads "
            f"{run.get('status')}. Reconcile the run to bring it up to date.",
        }
    elif card.docstatus == VOIDED and run.get("status") == POSTED:
        found["mismatch"] = {
            "code": "CANCELLED_DOCUMENT",
            "message": f"{invoice} is cancelled in ERPNext while this run still reads "
            "Invoiced. Reconcile the run so nothing counts it as billed.",
        }

    return found


def blocker_of(run, found):
    """Why cancelling this run cannot be offered, when it cannot."""
    if run.get("status") == CANCELLED or run.get("docstatus") == VOIDED:
        return "This run is already cancelled."

    mismatch = found.get("mismatch")

    if mismatch and mismatch["code"] in ("MISSING_DOCUMENT", "AMBIGUOUS_OWNER"):
        return mismatch["message"]

    return None


# ------------------------------------------------------------------- the one operation


def _locked(doctype, name):
    frappe.db.sql(f"select name from `tab{doctype}` where name = %s for update", name)


def _audit(run, before, after, reason, operation):
    """What was undone, by whom and why, written where the run's own history is read."""
    frappe.get_doc(
        {
            "doctype": "Comment",
            "comment_type": "Comment",
            "reference_doctype": RUN,
            "reference_name": run,
            "content": f"{AUDIT_PREFIX} "
            + json.dumps(
                {
                    "operation": operation,
                    "reason": (reason or "").strip() or None,
                    "by": frappe.session.user,
                    "at": str(frappe.utils.now_datetime()),
                    "before": before,
                    "after": after,
                },
                default=str,
            ),
        }
    ).insert(ignore_permissions=True)


def cancellation_of(run):
    """The cancellation this run carries on its file, when it was cancelled from here."""
    for row in frappe.get_all(
        "Comment",
        filters={
            "reference_doctype": RUN,
            "reference_name": run,
            "comment_type": "Comment",
            "content": ["like", f"{AUDIT_PREFIX}%"],
        },
        fields=["content", "creation", "owner"],
        order_by="creation desc",
        limit=1,
    ):
        try:
            written = json.loads(row.content[len(AUDIT_PREFIX) :].strip())
        except ValueError:
            return None

        return {**written, "on": row.creation, "by": written.get("by") or row.owner}

    return None


def cancel_run(name=None, reason=None):
    """Cancel a Billing Run and the document it posted, both or neither.

    The document is ERPNext's, so ERPNext cancels it, through its own method and all its own
    accounting checks. Only once that has gone through does the run follow, in the same
    transaction: there is no commit in between, so a refusal from the ledger leaves the run
    exactly as it was and a run that reads `Cancelled` always has a cancelled document
    behind it.
    """
    from nexgen_msp.api.internal.services.billing_service import BillingService

    BillingService._guard_admin()

    if not name or not frappe.db.exists(RUN, name):
        raise NotFoundError(f"Billing Run {name} not found.", "NOT_FOUND")

    _locked(RUN, name)
    run = frappe.get_doc(RUN, name)

    # asking twice is asking once: the second answer is the first one, read back
    if run.status == CANCELLED or run.docstatus == VOIDED:
        return BillingService.get_run(name)

    before = {"run": run.status, "document": run.sales_invoice, "invoice_docstatus": None}
    operation = "run"

    if run.sales_invoice:
        invoice = run.sales_invoice
        claimed = runs_of(invoice)

        if claimed != [name]:
            raise ValidationError(
                f"{invoice} is claimed by {', '.join(claimed) or 'no run'} rather than by "
                f"{name}. Repair the link before cancelling anything.",
                "INVALID_TRANSITION",
            )

        if not frappe.db.exists(INVOICE, invoice):
            raise ValidationError(
                f"{invoice} is no longer in ERPNext. Repair the link before cancelling "
                f"{name}.",
                "INVALID_TRANSITION",
            )

        _locked(INVOICE, invoice)
        card = frappe.db.get_value(
            INVOICE, invoice, ["docstatus", "customer", "company", "is_return"], as_dict=True
        )

        if card.customer != run.customer:
            raise ValidationError(
                f"{invoice} belongs to {card.customer} and {name} to {run.customer}. "
                "Repair the link before cancelling anything.",
                "INVALID_TRANSITION",
            )

        before["invoice_docstatus"] = card.docstatus

        if card.docstatus == SUBMITTED:
            operation = "cancel-posted"
            posted = frappe.get_doc(INVOICE, invoice)
            # cancelling is authorised above, at `_guard_admin`; the document itself is an
            # ERPNext record no MSP role holds rights on
            posted.flags.ignore_permissions = True

            with cancelling(name, invoice) as permit:
                posted.cancel()

                if not permit["cancelled"]:
                    raise ValidationError(
                        f"{invoice} did not report its cancellation. Nothing has been "
                        "cancelled.",
                        "INVALID_TRANSITION",
                    )

            if frappe.db.get_value(INVOICE, invoice, "docstatus") != VOIDED:
                raise ValidationError(
                    f"{invoice} is not cancelled in ERPNext. {name} has not been cancelled.",
                    "INVALID_TRANSITION",
                )
        elif card.docstatus == DRAFT:
            operation = "drop-draft"
            drop_draft(run)
        else:
            operation = "already-cancelled"

    with cancelling_run(name):
        if run.docstatus == SUBMITTED:
            run.flags.ignore_links = True
            run.cancel()
        else:
            run.flags.ignore_links = True
            run.status = CANCELLED
            run.save()

    BillingService._recompute_last_billed(run.customer)

    after = {
        "run": frappe.db.get_value(RUN, name, "status"),
        "document": before["document"],
        "invoice_docstatus": frappe.db.get_value(INVOICE, before["document"], "docstatus")
        if before["document"] and frappe.db.exists(INVOICE, before["document"])
        else None,
    }

    if after["run"] != CANCELLED:
        raise ValidationError(
            f"{name} did not reach Cancelled. Nothing has been cancelled.",
            "INVALID_TRANSITION",
        )

    _audit(name, before, after, reason, operation)
    frappe.db.commit()

    return BillingService.get_run(name)


def reconcile_run(name=None, apply=0):
    """Bring a run back in line with the document it carries, or say what that would take.

    Events keep the two sides together from now on; this is for what was posted or cancelled
    before they existed, and for anything a lost event left behind. It reads the live
    document first, repairs only the run's own status and what is derived from it, and never
    posts, re-posts or raises anything.
    """
    from nexgen_msp.api.internal.services.billing_service import BillingService

    BillingService._guard_admin()

    if not name or not frappe.db.exists(RUN, name):
        raise NotFoundError(f"Billing Run {name} not found.", "NOT_FOUND")

    _locked(RUN, name)
    run = frappe.get_doc(RUN, name)
    found = state_of(run.as_dict())
    mismatch = found.get("mismatch")
    plan = {
        "name": name,
        "applied": False,
        "status": run.status,
        "sales_invoice": run.sales_invoice,
        "invoice_docstatus": found.get("invoice_docstatus"),
        "mismatch": mismatch,
        "would": None,
    }

    if not mismatch:
        return plan

    if mismatch["code"] == "POSTED_ELSEWHERE":
        plan["would"] = POSTED
    elif mismatch["code"] == "CANCELLED_DOCUMENT":
        plan["would"] = CANCELLED
    else:
        # a missing or contested link is an integrity problem, and guessing which run owns
        # what was posted is exactly what must not happen here
        return plan

    if not frappe.utils.cint(apply):
        return plan

    if plan["would"] == POSTED and (run.status == CANCELLED or run.docstatus == VOIDED):
        # a run that was undone cannot be brought back to a posting, and a posted document
        # is not undone by writing on the run, so there is no repair this can carry out
        raise ValidationError(
            f"{run.sales_invoice} is posted in ERPNext while {name} is cancelled. A repair "
            "cannot reconcile the two: whichever of them is wrong has to be settled on its "
            "own side.",
            "INVALID_TRANSITION",
        )

    if plan["would"] == POSTED:
        mark_posted(name)
    elif run.docstatus == VOIDED:
        # the run itself was already cancelled and only its status lagged behind
        frappe.db.set_value(RUN, name, "status", CANCELLED)
        BillingService._recompute_last_billed(run.customer)
    else:
        with cancelling_run(name):
            run.flags.ignore_links = True

            if run.docstatus == SUBMITTED:
                run.cancel()
            else:
                run.status = CANCELLED
                run.save()

        BillingService._recompute_last_billed(run.customer)

    left = state_of(frappe.get_doc(RUN, name).as_dict())

    if left.get("mismatch"):
        raise ValidationError(
            f"{name} still reads {frappe.db.get_value(RUN, name, 'status')} against "
            f"{run.sales_invoice}. Nothing has been repaired.",
            "INVALID_TRANSITION",
            detail={"mismatch": left["mismatch"]},
        )

    _audit(
        name,
        {"run": plan["status"], "document": run.sales_invoice, "invoice_docstatus": plan["invoice_docstatus"]},
        {"run": frappe.db.get_value(RUN, name, "status"), "document": run.sales_invoice},
        mismatch["message"],
        "reconcile",
    )
    frappe.db.commit()

    return {
        **plan,
        "applied": True,
        "status": frappe.db.get_value(RUN, name, "status"),
        "invoice_docstatus": left.get("invoice_docstatus"),
        "mismatch": None,
    }
