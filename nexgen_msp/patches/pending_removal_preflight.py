"""Count what the old pending-removal workflow left behind, and let it be removed or not.

A service waiting to be ended is an intention, and an intention belongs to a Request and its Work
Order, not to the real assignment. The `Pending Removal` state is withdrawn from this release —
but never underneath data that still uses it.

This runs before the model is synced, so it can still see and repair the old rows:

  request-backed      an in-flight Request or Work Order clearly represents the pending removal.
                      The assignment goes back to the state it is actually in, Active, and the
                      intention stays where it belongs.

  not request-backed  nothing says whether the service should already have ended. Nothing is
                      guessed: the rows are reported, and the migration stops so somebody can
                      decide before the state disappears.
"""

import frappe

ASSIGNMENT = "MSP Service Assignment"

LEGACY_STATUS = "Pending Removal"

# a request that has not been carried out yet, which is where a pending end now lives
IN_FLIGHT = (
    "Awaiting Customer Approval",
    "Submitted",
    "Under Review",
    "Approved",
    "In Progress",
)


def execute():
    if not frappe.db.has_column(ASSIGNMENT, "operational_status"):
        return

    rows = frappe.get_all(
        ASSIGNMENT,
        filters={"operational_status": LEGACY_STATUS},
        fields=["name", "customer", "service_item", "client_user", "managed_device", "source_request"],
    )

    print(f"Legacy Pending Removal assignments: {len(rows)}")

    if not rows:
        return

    repaired, unresolved = [], []

    for row in rows:
        if _request_backed(row):
            frappe.db.set_value(ASSIGNMENT, row.name, "operational_status", "Active", update_modified=False)
            repaired.append(row.name)
        else:
            unresolved.append(row)

    frappe.db.commit()

    print(f"  request-backed, returned to Active: {len(repaired)}")

    if not unresolved:
        return

    print(f"  not request-backed, needing a decision: {len(unresolved)}")
    print("  Service | Customer | Target | Start date | Last billed")

    for row in unresolved:
        target = row.client_user or row.managed_device or "—"
        card = frappe.db.get_value(
            ASSIGNMENT, row.name, ["effective_start_date", "last_billed_on"], as_dict=True
        )
        print(
            f"  {row.service_item} | {row.customer} | {target} | "
            f"{card.effective_start_date} | {card.last_billed_on}"
        )

    frappe.throw(
        f"{len(unresolved)} service assignment(s) still use the previous pending-removal "
        "workflow and are not backed by a request. Resolve them (end the service or keep it "
        "active) before this release removes the Pending Removal state."
    )


def _request_backed(row):
    """Whether an in-flight request or work order already carries this pending end."""
    if row.source_request and frappe.db.exists(
        "MSP Service Request", {"name": row.source_request, "status": ("in", IN_FLIGHT)}
    ):
        return True

    return bool(
        frappe.db.exists(
            "MSP Service Work Order",
            {
                "source_service_assignment": row.name,
                "status": ("not in", ("Completed", "Cancelled")),
            },
        )
    )
