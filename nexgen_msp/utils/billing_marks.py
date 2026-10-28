"""How far a service has really been billed, said in one place.

Every screen that shows a last-billed date was asking the runs its own way: one counted a
run the moment it was approved, before anything was posted; several left credit notes out
altogether, so a period given back in full still read as billed; and all of them took the
end of the run's period rather than the coverage the line actually carried, which is a
different day as soon as half a month is billed.

`BillingService.net_billed_periods` already settles what counts — only what was posted,
a credit of its own answers no charge of ours, and a period whose months net to nothing
stops counting. This is that same definition, in the two shapes the screens read it in, so
a date shown on one page is the date shown on the next.
"""

import frappe

# correlated on `sa.name`, for a query that already has the assignment in hand
BILLED_TO = """
    (
        select max(coalesce(brl.covered_to, br.billing_period_end))
        from `tabMSP Billing Run Line` brl
        join `tabMSP Billing Run` br on br.name = brl.parent
        where brl.service_assignment = sa.name
          and br.status = 'Invoiced'
          and ifnull(br.standalone_credit, 0) = 0
        group by br.billing_period_start, br.billing_period_end
        having sum(brl.billable_months) > 0
        order by 1 desc
        limit 1
    )
"""


def billed_to(assignments):
    """The same answer for a set of assignments, as a date by assignment name."""
    wanted = [name for name in (assignments or []) if name]

    if not wanted:
        return {}

    rows = frappe.db.sql(
        """
        select period.assignment as assignment, max(period.covered_to) as billed_to
        from (
            select
                brl.service_assignment as assignment,
                max(coalesce(brl.covered_to, br.billing_period_end)) as covered_to
            from `tabMSP Billing Run Line` brl
            join `tabMSP Billing Run` br on br.name = brl.parent
            join `tabMSP Service Assignment` sa on sa.name = brl.service_assignment
            where brl.service_assignment in %(assignments)s
              -- only that company's own runs can have billed it
              and br.customer = sa.customer
              and br.status = 'Invoiced'
              and ifnull(br.standalone_credit, 0) = 0
            group by brl.service_assignment, br.billing_period_start, br.billing_period_end
            having sum(brl.billable_months) > 0
        ) period
        group by period.assignment
        """,
        {"assignments": wanted},
        as_dict=True,
    )

    return {row.assignment: row.billed_to for row in rows}
