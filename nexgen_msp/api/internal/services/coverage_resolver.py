"""What each service was owed, what was really charged for it, and what is left.

The engine used to answer that question with the period of a run: if a run touching these
months held a line for this assignment, the assignment counted as billed for all of them.
A quarter with a fortnight billed inside it therefore read as fully covered, and somebody
who arrived in the middle of a period paid in advance was written off.

Here the answer is made of days. For one assignment, the days it was owed are the days it
was live, pauses cut out. The days already charged are the stretches the submitted lines
actually carry — never the period of their run, never a line carried as an exception, never
a credit note. What is left is the difference, and the days paid for but not served are the
charged days that fall after the service stopped.

Nothing here writes. It reads the record and says what it means.
"""

import frappe
from frappe.utils import add_days, flt, getdate

from nexgen_msp.utils import intervals

# runs whose lines stand for money that has really been asked for
CHARGED_STATUSES = ("Invoiced",)
# runs being prepared: their lines are not money yet, but they hold the days so that two
# people preparing at once cannot charge them twice
RESERVED_STATUSES = ("Draft", "Validating", "Exception", "Ready for Approval", "Approved",
                     "Invoice Drafted")


def _rows_for(assignments, statuses, credits=False, exclude_run=None):
    """The lines of those runs, with the stretch each one really carries."""
    if not assignments:
        return []

    return frappe.db.sql(
        """
        select
            brl.service_assignment, brl.parent as run, br.status,
            brl.covered_from, brl.covered_to, brl.billable_segments_json,
            brl.quantity, brl.billable_months, brl.unit_rate,
            br.billing_period_start, br.billing_period_end
        from `tabMSP Billing Run Line` brl
        join `tabMSP Billing Run` br on br.name = brl.parent
        join `tabMSP Service Assignment` sa on sa.name = brl.service_assignment
        where brl.service_assignment in %(assignments)s
          -- an assignment belongs to one company, and only its own runs can charge it
          and br.customer = sa.customer
          and br.docstatus < 2
          and br.status in %(statuses)s
          -- a line carried with an exception was never charged for
          and ifnull(brl.exception_code, '') = ''
          and ifnull(br.credit_note_of, '') {credit_test}
          and br.name != %(exclude)s
        """.format(credit_test="!= ''" if credits else "= ''"),
        {
            "assignments": tuple(assignments),
            "statuses": tuple(statuses),
            "exclude": exclude_run or "",
        },
        as_dict=True,
    )


def _stretches_of(row):
    """The days one line carries: its own segments, or the window it covered."""
    if row.billable_segments_json:
        written = intervals.from_dicts(frappe.parse_json(row.billable_segments_json))

        if written:
            return written

    if row.covered_from and row.covered_to:
        return intervals.span(row.covered_from, row.covered_to)

    return []


def _by_assignment(rows):
    found = {}

    for row in rows:
        found.setdefault(row.service_assignment, []).extend(_stretches_of(row))

    return {name: intervals.merge(stretches) for name, stretches in found.items()}


def baseline_of(assignment):
    """The coverage this assignment arrived with, frozen when it was taken on.

    A date on the person or the machine is a summary that later runs overwrite; the
    baseline is written against the assignment itself and is never recomputed, because it
    is the only record of what somebody else's invoice already paid for.

    Only a baseline somebody confirmed counts as paid. A date nobody has verified is a
    question, not an invoice: it neither proves the days were paid for nor allows them to
    be credited back, and the run says so on the line instead of assuming either way.
    """
    if not assignment.get("baseline_covered_to"):
        return []

    if (assignment.get("baseline_state") or "") != "Confirmed":
        return []

    opens = assignment.get("baseline_covered_from") or assignment.get("effective_start_date")

    return intervals.span(opens, assignment["baseline_covered_to"])


def coverage_of(assignments, with_baseline=True, exclude_run=None):
    """Per assignment: the days charged, the days held by a run being prepared, the credits.

    `assignments` are rows carrying at least `name`, and the baseline fields when the
    baseline is to be read.
    """
    names = [row["name"] for row in assignments]
    charged = _by_assignment(_rows_for(names, CHARGED_STATUSES, exclude_run=exclude_run))
    reserved = _by_assignment(_rows_for(names, RESERVED_STATUSES, exclude_run=exclude_run))
    credited = _by_assignment(
        _rows_for(names, CHARGED_STATUSES + RESERVED_STATUSES, credits=True)
    )
    answer = {}

    for row in assignments:
        name = row["name"]
        attested = baseline_of(row) if with_baseline else []
        answer[name] = {
            "baseline": attested,
            "charged": intervals.merge(charged.get(name, []) + attested),
            "reserved": intervals.merge(reserved.get(name, [])),
            "credited": intervals.merge(credited.get(name, [])),
        }

    return answer


def due_over(eligible, covered):
    """The days of a window that were owed and nobody has been charged for yet."""
    return intervals.subtract(eligible, covered["charged"] + covered["reserved"])


def prepaid_not_served(covered, served_until, window=None):
    """Days paid for that nobody was served: charged days after the service stopped.

    A credit is what was charged minus what was delivered, so it is read off the charged
    days themselves — not off a period, and not off today's rate.
    """
    if not served_until:
        return []

    after = intervals.span(add_days(getdate(served_until), 1), getdate("2999-12-31"))
    unused = intervals.intersect(covered["charged"], after)

    if window:
        unused = intervals.intersect(unused, window)

    return intervals.subtract(unused, covered["credited"])


def explain(eligible, covered, due, owed):
    """One sentence an operator can act on, in the words the screens use."""
    if not eligible:
        return "Nothing was live over this period."

    if not due and covered["charged"]:
        return (
            "Already covered through "
            f"{max(last for _first, last in covered['charged'])}."
        )

    if not due and covered["reserved"]:
        return "Held by a run being prepared."

    if due and covered["charged"]:
        return f"{intervals.days(due)} day(s) of this period were never charged."

    if owed:
        return f"{intervals.days(owed)} day(s) were paid for and not served."

    return f"{intervals.days(due)} day(s) to bill."


def unconfirmed_baseline(assignment):
    """The days an unverified baseline claims, which nobody may bill or credit yet."""
    if not assignment.get("baseline_covered_to"):
        return []

    if (assignment.get("baseline_state") or "") == "Confirmed":
        return []

    opens = assignment.get("baseline_covered_from") or assignment.get("effective_start_date")

    return intervals.span(opens, assignment["baseline_covered_to"])
