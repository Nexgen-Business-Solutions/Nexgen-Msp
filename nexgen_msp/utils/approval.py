"""Who, inside a customer company, may decide what.

Named people, never a role: the same person can be allowed to raise a request and to
approve it, or only one of the two, and the answer is written down per person rather than
inferred from a group they belong to.

A customer with no authority on file behaves exactly as before — their requests reach
Nexgen straight away. That is what keeps every existing customer working the day this
ships.
"""

import frappe

AUTHORITY = "MSP Approval Authority"

# what a line of the matrix can grant
RIGHTS = ("can_submit", "can_approve")


def authority_for(customer):
    """The enabled authority document of a customer, or None."""
    if not customer:
        return None

    name = frappe.db.get_value(AUTHORITY, {"customer": customer, "enabled": 1}, "name")

    return frappe.get_cached_doc(AUTHORITY, name) if name else None


def has_approvers(customer):
    """Whether anyone at this customer has been given the right to approve.

    This is the switch: until someone holds it, nothing changes for that customer.
    """
    doc = authority_for(customer)

    return bool(doc and any(row.can_approve for row in doc.approvers))


def rights_of(customer, user=None):
    """What the signed-in account may do at this customer. Empty when it holds nothing.

    Read off the account, not the person's file: approving is something a login does, and a
    seat we service no longer carries one.
    """
    user = user or frappe.session.user

    if not user or user == "Guest":
        return {}

    doc = authority_for(customer)

    if not doc:
        return {}

    row = next((line for line in doc.approvers if line.user == user), None)

    if not row:
        return {}

    return {
        "user": user,
        "department": (row.department or "").strip() or None,
        **{right: bool(row.get(right)) for right in RIGHTS},
    }


def may(right, customer, user=None):
    return bool(rights_of(customer, user).get(right))


def covers(rights, client_user):
    """Whether an approver's scope reaches the person a request line is about.

    A row limited to a department decides for that department only; an unlimited row
    decides for the whole company. The department is still read off the person being
    served, because that is what a request is about.
    """
    if not rights:
        return False

    wanted = rights.get("department")

    if not wanted:
        return True

    return (frappe.db.get_value("MSP Client User", client_user, "department") or "") == wanted


# ---------------------------------------------------------------- the gaps
def gaps(customer):
    """Whether this company still has someone to raise a request, and someone to agree.

    Raising is open to every enabled account of the company except those the matrix names
    without the right; agreeing belongs only to those it names with it.
    """
    accounts = frappe.db.sql_list(
        """
        select distinct up.user
        from `tabUser Permission` up
        join `tabUser` u on u.name = up.user
        where up.allow = 'Customer' and up.for_value = %(customer)s and u.enabled = 1
        """,
        {"customer": customer},
    )
    doc = authority_for(customer)
    named = {row.user: row for row in (doc.approvers if doc else [])}

    raisers = [
        user for user in accounts if user not in named or named[user].can_submit
    ]
    approvers = [
        user for user, row in named.items() if row.can_approve and user in accounts
    ]

    return {
        "accounts": len(accounts),
        "nobody_may_raise": not raisers,
        "nobody_may_approve": not approvers,
    }


def warn_admins_of_gaps(customer, request=None):
    """Tell our administrators when a company can no longer raise, or no longer agree.

    Said once per state: the same gap is not repeated at every request, and a gap that
    closes and reopens is announced again. Mail never breaks what triggered it.
    """
    from nexgen_msp.utils import notifications

    try:
        state = gaps(customer)
        signature = (
            f"{int(state['nobody_may_raise'])}{int(state['nobody_may_approve'])}"
            if state["nobody_may_raise"] or state["nobody_may_approve"]
            else ""
        )
        marker = f"msp_authority_gap::{customer}"

        if frappe.db.get_default(marker) == signature:
            return False

        frappe.db.set_default(marker, signature)

        if not signature:
            return False

        admins = frappe.db.sql_list(
            """
            select distinct hr.parent
            from `tabHas Role` hr
            join `tabUser` u on u.name = hr.parent
            where hr.role = 'MSP System Admin' and u.enabled = 1 and u.name != 'Administrator'
            """
        )

        missing = []
        if state["nobody_may_raise"]:
            missing.append("nobody at this company may raise a request")
        if state["nobody_may_approve"]:
            missing.append("nobody at this company may approve a request")

        return notifications.send(
            "MSP Authority Gap",
            admins,
            {
                "full_name": "",
                "customer": customer,
                "missing": "; ".join(missing),
                "request": request or "",
                "accounts": state["accounts"],
                "link": frappe.utils.get_url(f"/msp/customers/{customer}"),
            },
        )
    except Exception:
        frappe.log_error(title="Authority gap warning failed", message=frappe.get_traceback())
        return False
