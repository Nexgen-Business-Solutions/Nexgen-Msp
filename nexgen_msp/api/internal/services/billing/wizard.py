"""The one preparation path, for the three operations that stay apart.

`Regular billing`, `Additions` and `Credit note` are prepared the same way — context,
services, accounting, confirm — and each still produces its own run and its own document.
Nothing here posts anything to ERPNext on its own: the last step prepares, a person submits.
"""

import frappe
from frappe.utils import flt, getdate

from nexgen_msp.api.internal.services.accounting_dimension_service import (
    AccountingDimensionService,
)
from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.utils.errors import ValidationError

KINDS = ("period", "additions", "credit_note")

SCOPES = ("detected", "all")

LABELS = {
    "period": "Regular billing",
    "additions": "Additions",
    "credit_note": "Credit note",
}

# what each operation is for, said on the first step so nobody has to infer it
NOTES = {
    "additions": (
        "blue",
        "Incremental billing. Only services left out of a period already charged are "
        "included; the next cycle is not opened here.",
    ),
    "credit_note": (
        "amber",
        "Credit for coverage already billed. Each line has to be reconciled with the "
        "charge it stands against before it can be approved.",
    ),
}


def _terms(contract):
    terms = frappe.db.get_value(
        "MSP Contract",
        contract,
        [
            "name",
            "customer",
            "title",
            "currency",
            "billing_frequency",
            "billing_timing",
            "proration_method",
            "invoice_grouping",
            "start_date",
            "end_date",
            "status",
        ],
        as_dict=True,
    )

    if not terms:
        raise ValidationError(f"Contract {contract} not found.", "NOT_FOUND")

    return terms


def _proposal(contract, kind):
    """What the engine proposes for this contract today, when it proposes anything."""
    for action in BillingService.due()["actions"]:
        if action["contract"] == contract and action["kind"] == kind:
            return action

    return None


def _source_run(contract, against=None):
    """The charge a credit stands against: the one named, and only the one named.

    A run named by the caller is checked against the contract it is claimed to belong to.
    Crediting one customer's invoice from another customer's screen is not a mistake the
    server lets a payload make. Nothing is attached by guesswork either: a credit nobody
    pointed at a charge stands on its own, however many charges the contract has behind
    it — the last one issued has no business being credited for a decision about another.
    """
    if not against:
        return None

    row = frappe.db.get_value(
        "MSP Billing Run", against, ["name", "contract", "customer", "docstatus"], as_dict=True
    )

    if not row or row.contract != contract:
        raise ValidationError(
            f"{against} is not a billing run of {contract}.", "VALIDATION_ERROR"
        )

    return row.name


def context(kind="period", contract=None, period_start=None, period_end=None, against=None):
    """Step 1 — what this operation is about, on the contract's own terms."""
    BillingService._guard_admin()

    kind = kind if kind in KINDS else "period"
    terms = _terms(contract)
    proposal = _proposal(contract, kind)

    if not period_start or not period_end:
        if proposal:
            period_start, period_end = proposal["run_start"], proposal["run_end"]
        else:
            start, end = BillingService._next_period(
                None, terms.billing_frequency, terms.start_date, terms.billing_timing
            )
            period_start, period_end = start, end

    tone, note = NOTES.get(kind, (None, None))

    if kind == "period" and terms.billing_timing == "In Arrears":
        tone, note = (
            "blue",
            "Billing in arrears. Services are charged for periods already delivered; "
            "suspended days are left out according to the contract.",
        )

    source = _source_run(contract, against) if kind == "credit_note" else None

    return {
        "kind": kind,
        "label": LABELS[kind],
        "contract": terms.name,
        "contract_title": terms.title,
        "customer": terms.customer,
        "currency": terms.currency,
        "billing_frequency": terms.billing_frequency,
        "billing_timing": terms.billing_timing,
        "proration_method": terms.proration_method,
        "invoice_grouping": terms.invoice_grouping,
        "contract_start": terms.start_date,
        "contract_end": terms.end_date,
        "period_start": getdate(period_start),
        "period_end": getdate(period_end),
        # a detected proposal fixes its own window; a run opened by hand does not
        "period_locked": bool(proposal) and kind != "period",
        "note": note,
        "note_tone": tone,
        "proposed_lines": proposal["lines"] if proposal else None,
        "proposed_amount": proposal["amount"] if proposal else None,
        "source_run": source,
        "open_run": (proposal or {}).get("open_run"),
    }


def _segments_of(line):
    """The stretches a line was live over, as the engine wrote them down.

    A line paused in the middle is two stretches; showing one unbroken period would ask
    somebody to approve days nobody served.
    """
    segments = line.get("segments")

    if segments:
        return segments

    stored = line.get("billable_segments_json")

    if stored:
        try:
            return frappe.parse_json(stored) or []
        except Exception:
            return []

    return []


def _candidate(line, reason, covered, proof=False):
    """One line as the Services step reads it, whatever operation it belongs to."""
    return {
        # a charge can carry the same assignment twice, at two rates: the line it was
        # billed on is what a credit answers, so it is what the screen selects
        "id": line.get("line") or line["service_assignment"],
        "line": line.get("line"),
        "service": line["service_name"],
        "service_item": line["service_item"],
        "assignment": line["service_assignment"],
        "person": line.get("user_name") or line.get("hostname") or "Customer",
        "device": line.get("hostname"),
        "covered_from": line.get("covered_from"),
        "covered_to": line.get("covered_to"),
        "segments": _segments_of(line),
        "months": flt(line.get("billable_months"), 3),
        "days": line.get("billable_days"),
        "quantity": flt(line.get("quantity") or 1),
        "rate": line.get("unit_rate"),
        "amount": flt(line.get("amount"), 2),
        "exception_code": line.get("exception_code"),
        "exception_detail": line.get("exception_detail"),
        "reason": reason,
        "covered": covered,
        # a credit line is reconciled with its original charge before anybody approves it
        "proof": proof,
        "eligible": not line.get("exception_code"),
    }


def _why(line, kind, timing):
    """Why this line is proposed, in the words of what was actually read."""
    if line.get("exception_code"):
        return line.get("exception_detail") or line["exception_code"]

    if kind == "additions":
        return (
            "Effective inside a period already charged, and no run covers these days yet."
        )

    if len(_segments_of(line)) > 1:
        return "Suspended days are excluded; only the stretches actually served are billed."

    if timing == "In Advance":
        return "Active service for the cycle being opened."

    return "Delivered over the period being billed."


def _credit_candidates(source, scope):
    """The lines of a charge a credit can be built from.

    Two different questions are asked of the same charge. `detected` answers "what stopped
    being served after it was paid for", which is the proposal the Billing page raises on
    its own. `all` answers "what of this charge is still creditable", which is what an
    operator settling a dispute needs: every line that has months left, with the window it
    was billed over, for them to cut as the case requires.
    """
    lines = []

    for line in source["lines"]:
        owed = line.get("owed_back") or {}
        remaining = flt(line.get("remaining_months") or 0, 3)
        rate = flt(line.get("unit_rate") or 0) * flt(line.get("quantity") or 1)

        if scope == "detected":
            months = flt(owed.get("months") or 0, 3)

            if not months:
                continue

            lines.append(
                {
                    **_candidate(
                        {**line, "billable_months": months, "amount": -flt(months * rate, 2)},
                        "Service ended on "
                        f"{owed.get('ended_on')}, inside a period charged in advance; "
                        f"{owed.get('unused_days')} days were paid for and not served. "
                        "Confirm the original quantity, rate and any credit already given.",
                        "History to verify",
                        proof=True,
                    ),
                    "covered_from": owed.get("unused_from"),
                    "covered_to": owed.get("unused_to"),
                    "days": owed.get("unused_days"),
                    "editable": False,
                }
            )
            continue

        if remaining <= 0:
            continue

        given = flt(line.get("credited_months") or 0, 3)
        lines.append(
            {
                **_candidate(
                    {**line, "billable_months": remaining, "amount": -flt(remaining * rate, 2)},
                    f"Billed {flt(line.get('billable_months') or 0, 3)} months over "
                    f"{line.get('covered_from')} – {line.get('covered_to')}"
                    + (f", {given} already credited" if given else "")
                    + ". Choose the stretch to give back.",
                    "Already credited" if given else "On this charge",
                    proof=True,
                ),
                "covered_from": line.get("covered_from"),
                "covered_to": line.get("covered_to"),
                "editable": True,
            }
        )

    return lines


def services(
    kind="period",
    contract=None,
    period_start=None,
    period_end=None,
    against=None,
    scope="detected",
):
    """Step 2 — the candidates, each with the reason it is there."""
    BillingService._guard_admin()

    terms = _terms(contract)

    if kind == "credit_note":
        run = _source_run(contract, against)

        if not run:
            # no charge of ours on file does not mean nothing was detected: a customer
            # taken on with a date paid for a period, and what stopped inside it is owed
            # back. The proposal is offered here exactly as it would be against a run of
            # ours — read and validated, not composed.
            if scope != "all":
                detected = BillingService.owed_back_without_run(contract)

                return {
                    "kind": kind,
                    "scope": scope,
                    "currency": detected["currency"] or terms.currency,
                    "source_run": None,
                    "source_invoice": None,
                    "source_period": {
                        "from": detected["period_start"] or period_start,
                        "to": detected["period_end"] or period_end,
                    },
                    "billed_in_advance": True,
                    "lines": [
                        {
                            **_candidate(
                                {
                                    **line,
                                    "billable_months": line["owed_back"]["months"],
                                    "amount": line["amount"],
                                },
                                "Service ended on "
                                f"{line['owed_back']['ended_on']}, inside a period this "
                                "customer had already paid for; "
                                f"{line['owed_back']['unused_days']} days were paid for and "
                                "not served. Nothing of ours charged them, so the note "
                                "stands on its own.",
                                "History to verify",
                                proof=True,
                            ),
                            "covered_from": line["owed_back"]["unused_from"],
                            "covered_to": line["owed_back"]["unused_to"],
                            "days": line["owed_back"]["unused_days"],
                            "editable": False,
                        }
                        for line in detected["lines"]
                    ],
                    "blocked": [],
                    "note": None
                    if detected["lines"]
                    else (
                        "Nothing this customer paid ahead for stopped being served, so "
                        "there is nothing detected to give back."
                    ),
                }

            # nothing on file says what was charged, which does not mean nothing is owed.
            # Every service of the contract is offered, and the operator says which days
            # go back and why — the note then stands on its own.
            offered, _ = BillingService.build_lines(
                contract, period_start, period_end, ignore_coverage=True
            )

            return {
                "kind": kind,
                "scope": scope,
                "currency": terms.currency,
                "source_run": None,
                "source_invoice": None,
                "source_period": {"from": period_start, "to": period_end},
                "lines": [
                    {
                        **_candidate(
                            {**line, "billable_months": 0, "amount": 0},
                            "No charge of ours covers this period. Give back the days you "
                            "have agreed, at this service's own rate.",
                            "Credit on its own",
                        ),
                        # the days this service really ran over the window: its last
                        # coverage, which is what the operator starts from before cutting
                        "covered_from": line.get("covered_from") or period_start,
                        "covered_to": line.get("covered_to") or period_end,
                        "editable": True,
                    }
                    for line in offered
                    if not line.get("exception_code")
                ],
                "blocked": [],
                "note": None,
            }

        source = BillingService.creditable_lines(run)
        lines = _credit_candidates(source, "all" if scope == "all" else "detected")

        return {
            "kind": kind,
            "scope": scope,
            "currency": terms.currency,
            "source_run": run,
            "source_invoice": source.get("invoice"),
            "source_period": {
                "from": source.get("period_start"),
                "to": source.get("period_end"),
            },
            "billed_in_advance": source.get("billed_in_advance"),
            "lines": lines,
            "blocked": [],
            "note": None
            if lines
            else (
                "Nothing of this charge is left to credit."
                if scope == "all"
                else "Nothing on this charge stopped being served after it was paid for."
            ),
        }

    preview = BillingService.preview(
        contract=contract, period_start=period_start, period_end=period_end
    )
    eligible, blocked = [], []

    for line in preview["lines"]:
        candidate = _candidate(
            line,
            _why(line, kind, terms.billing_timing),
            "New assignment" if kind == "additions" else "Covered by the contract",
        )
        (blocked if line.get("exception_code") else eligible).append(candidate)

    return {
        "kind": kind,
        "scope": scope,
        "currency": preview["currency"],
        "source_run": None,
        "source_period": None,
        "lines": eligible,
        "blocked": blocked,
        "note": None,
    }


def _scope(scope):
    """Which of the two credits is being asked for, said rather than assumed."""
    if scope not in SCOPES:
        raise ValidationError(
            f"{scope} is not a credit scope: it is either detected or all.",
            "VALIDATION_ERROR",
        )

    return scope


def _detected_windows(contract, include):
    """The stretches the proposal itself read, for the lines somebody validated.

    A detected credit is not composed in a browser: the days come from what the engine
    says was paid for and never served, and the selection only says which of its lines go
    back. Anything named that the proposal does not carry is refused rather than priced.
    """
    detected = BillingService.owed_back_without_run(contract)
    offered = {
        line["service_assignment"]: line["owed_back"] for line in detected["lines"]
    }
    include = frappe.parse_json(include) if isinstance(include, str) else include
    asked = []

    for row in include or []:
        assignment = (
            row.get("service_assignment") or row.get("id") if isinstance(row, dict) else row
        )
        back = offered.get(assignment)

        if not back:
            raise ValidationError(
                f"{assignment} is not among the days this customer paid ahead for.",
                "VALIDATION_ERROR",
            )

        asked.append(
            {
                "service_assignment": assignment,
                "from": str(back["unused_from"]),
                "to": str(back["unused_to"]),
            }
        )

    if not asked:
        raise ValidationError("Select at least one line to credit.", "VALIDATION_ERROR")

    return asked


def _detected_reason(asked):
    """What a detected credit says of itself when nobody adds anything."""
    opens = min(row["from"] for row in asked)
    closes = max(row["to"] for row in asked)

    return (
        f"Days paid for and not served, {opens} to {closes}. Read from the coverage this "
        "customer was taken on with; no charge of ours carries them."
    )


def _credit_windows(include):
    """The stretches asked for, when there is no charge on file to read them against."""
    include = frappe.parse_json(include) if isinstance(include, str) else include
    asked = []

    for row in include or []:
        if not isinstance(row, dict):
            asked.append({"service_assignment": row})
            continue

        assignment = row.get("service_assignment") or row.get("id")

        if not assignment:
            raise ValidationError(
                "Each credited line names its service assignment.", "VALIDATION_ERROR"
            )

        asked.append(
            {
                "service_assignment": assignment,
                "from": row.get("from"),
                "to": row.get("to"),
            }
        )

    return asked


def _credit_rows(run, include):
    """The stretches a credit is asked for: the operator's own, or the detected ones."""
    # the browser sends its selection as JSON; read as a list of characters it matches
    # nothing, and the operator is told to select lines they had already selected
    include = frappe.parse_json(include) if isinstance(include, str) else include
    chosen = list(include or [])
    rows = []
    named = [row for row in chosen if not isinstance(row, dict)]

    # an operator settling a dispute cuts the stretch themselves; the engine still checks
    # every one of them against what was charged and what was already given back
    if any(isinstance(row, dict) for row in chosen):
        for row in [entry for entry in chosen if isinstance(entry, dict)]:
            assignment = row.get("service_assignment") or row.get("id")

            if not assignment:
                raise ValidationError(
                    "Each credited line names its service assignment.", "VALIDATION_ERROR"
                )

            asked = {"service_assignment": assignment}

            if row.get("line"):
                asked["line"] = row["line"]

            if row.get("from") and row.get("to"):
                asked["from"], asked["to"] = row["from"], row["to"]
            elif row.get("months"):
                asked["months"] = row["months"]
            else:
                raise ValidationError(
                    f"{assignment}: give the stretch to credit, or the months.",
                    "VALIDATION_ERROR",
                )

            rows.append(asked)

        if not named:
            return rows

    # the proposal as it was detected: the stretch is read off the charge itself, so no
    # window arrives from a browser
    source = BillingService.creditable_lines(run)
    wanted = set(named)

    for line in source["lines"]:
        owed = line.get("owed_back") or {}
        named_here = {line.get("line"), line["service_assignment"]} & wanted

        if not owed or (wanted and not named_here):
            continue

        # the days left can be two stretches either side of what was already given back:
        # each one is asked for on its own, never flattened into one window that covers
        # days nobody owes any more
        for part in owed.get("segments") or [
            {"from": owed["unused_from"], "to": owed["unused_to"]}
        ]:
            rows.append(
                {
                    "service_assignment": line["service_assignment"],
                    "line": line.get("line"),
                    "from": part["from"],
                    "to": part["to"],
                }
            )

    return rows


def credit_preview(
    contract=None,
    against=None,
    include=None,
    scope="detected",
    period_start=None,
    period_end=None,
):
    """What the chosen days come to, priced by the engine that would write them.

    The Confirm step asks for this rather than adding up what the Services step showed:
    an operator who shortened a stretch must see the amount that stretch is worth, not the
    one the whole line was worth.
    """
    BillingService._guard_admin()
    scope = _scope(scope)
    run = _source_run(contract, against)

    # nothing on file to price it against: the detection carries its own days, and a
    # credit composed by hand carries the ones the operator named
    if not run:
        return BillingService.create_standalone_credit(
            contract=contract,
            period_start=period_start,
            period_end=period_end,
            lines=(
                _detected_windows(contract, include)
                if scope != "all"
                else _credit_windows(include)
            ),
            dry_run=True,
        )

    return BillingService.create_credit_note(
        name=run,
        lines=frappe.as_json(_credit_rows(run, include)),
        dry_run=True,
        only_unserved=scope != "all",
    )


def accounting(contract=None):
    """Step 3 — what ERPNext asks for, and who hears about the document."""
    BillingService._guard_admin()

    terms = _terms(contract)
    contact, why = BillingService.billing_contact_email(terms.customer)

    return {
        "dimensions": AccountingDimensionService.catalogue(),
        "currency": terms.currency,
        "company_currency": frappe.db.get_single_value("Global Defaults", "default_currency"),
        "posting_date": getdate(),
        "payment_terms": frappe.db.get_value("Customer", terms.customer, "payment_terms"),
        # #21: one address, the customer's own billing contact, and nothing inferred
        "billing_contact": contact,
        "billing_contact_note": why,
    }


def create(
    kind="period",
    contract=None,
    period_start=None,
    period_end=None,
    include=None,
    dimensions=None,
    exchange_rate=None,
    discount_percent=0,
    reason=None,
    against=None,
    draft_invoice=0,
    expected_total=None,
    scope="detected",
):
    """Step 4 — prepare the operation. Nothing is posted; a person submits it after."""
    BillingService._guard_admin()

    include = frappe.parse_json(include) if isinstance(include, str) else include
    dimensions = frappe.parse_json(dimensions) if isinstance(dimensions, str) else dimensions

    # nothing chosen is not everything: a payload that says "none" is refused rather than
    # read as "all", which is how a whole contract gets billed by an empty selection
    if include is not None and not include:
        raise ValidationError("Select at least one service line.", "VALIDATION_ERROR")

    if kind == "credit_note":
        scope = _scope(scope)
        run = _source_run(contract, against)

        if not run:
            # nothing of ours charged these days, so the note stands on its own. Asked for
            # as the detection, it carries the days the proposal read and says so itself;
            # asked for by hand, the operator names the days and signs for them.
            asked = (
                _detected_windows(contract, include)
                if scope != "all"
                else _credit_windows(include)
            )

            return {
                "run": BillingService.create_standalone_credit(
                    contract=contract,
                    period_start=period_start,
                    period_end=period_end,
                    lines=asked,
                    reason=reason or _detected_reason(asked),
                )["name"],
                "kind": kind,
            }

        # a credit on days that were served is a decision somebody takes and signs
        if scope == "all" and not str(reason or "").strip():
            raise ValidationError(
                "Say why these days are being given back: a credit on days that were "
                "served is a decision, and it is written down with the note.",
                "VALIDATION_ERROR",
            )

        rows = _credit_rows(run, include)

        if not rows:
            raise ValidationError(
                "Nothing on the chosen lines is owed back on this charge.", "VALIDATION_ERROR"
            )

        # the figure somebody approved is the figure that is written. Anything that moved
        # in between — a credit raised elsewhere, a line corrected — stops this one rather
        # than quietly returning a different amount
        if expected_total not in (None, ""):
            priced = BillingService.create_credit_note(
                name=run,
                lines=frappe.as_json(rows),
                dry_run=True,
                only_unserved=scope != "all",
            )

            if abs(flt(priced["total"], 2) - flt(expected_total, 2)) > 0.01:
                raise ValidationError(
                    f"This credit now comes to {flt(priced['total'], 2)}, not "
                    f"{flt(expected_total, 2)} as reviewed. Read it again before it is "
                    "written.",
                    "VALIDATION_ERROR",
                )

        created = BillingService.create_credit_note(
            name=run,
            lines=frappe.as_json(rows),
            reason=reason,
            # a dispute is settled on the days somebody decided to give back, which are
            # not always the days nobody was served
            only_unserved=scope != "all",
        )

        return {"run": created["name"], "kind": kind}

    created = BillingService.generate(
        contract=contract,
        period_start=period_start,
        period_end=period_end,
        include=include,
        discount_percent=discount_percent,
        # a catch-up is a run of its own kind, and says which charge it completes
        adjustment_of=_source_run(contract, against) if kind == "additions" else None,
    )

    # the accounting answers are used where they were asked for: at drafting time
    if frappe.utils.cint(draft_invoice) and dimensions is not None:
        detail = BillingService.get_run(created["name"])
        runner = (
            BillingService.finalise if detail["can_approve"] else BillingService.create_invoice
        )
        runner(
            name=created["name"],
            dimensions=frappe.as_json(dimensions),
            exchange_rate=exchange_rate,
        )

    return {"run": created["name"], "kind": kind}
