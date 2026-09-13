"""Who an account may act for, and what it is allowed to do. Decided once, here.

Two questions run through the whole application and both used to be answered in a dozen
places: which companies is this account allowed near, and is it allowed to do this. Every
copy of an answer is a copy that can drift, so there is one of each and the services ask.

**Reaching a company takes two proofs.** A Contact record naming the account and linked to
the company is the declaration; a User Permission is the enforcement. An account reaches a
company only when it holds both. A permission left behind after somebody was moved is not a
key: without a matching contact it opens nothing.

**A customer's account is never staff.** Whatever roles it also carries — added by hand in
the desk, or by a mis-click — an account declared as a company's contact belongs to that
company. The only exception is the builtin Administrator, and it is written out in full
rather than arrived at through a role.
"""

import frappe

from nexgen_msp.utils.errors import ValidationError

ADMINISTRATOR = "Administrator"

# what a person at a customer holds
CUSTOMER_ROLES = ("MSP Customer Manager", "MSP Customer Operator")

# what our own people hold
STAFF_ROLES = ("MSP System Admin", "MSP Technician")

# the commercial half of our own work: contracts, pricing, billing, the reference catalogues
COMMERCIAL_ROLE = "MSP System Admin"

# a Frappe administration role. It runs the site; it does not sell anything, so it is not a
# commercial authority here — the builtin Administrator is, and that is said explicitly
SYSTEM_ROLE = "System Manager"

REFUSED = "PERMISSION_DENIED"


def _who(user=None):
    return user or frappe.session.user


def is_administrator(user=None):
    """The builtin account. The one exception, written out rather than inferred."""
    return _who(user) == ADMINISTRATOR


def roles(user=None):
    return set(frappe.get_roles(_who(user)))


# ------------------------------------------------------------------ which side they are on
def declared_customers(user=None):
    """The companies an account is declared a contact of.

    Read across every contact record, not one: an invitation writes a contact per company,
    so somebody invited at two of them has two.
    """
    user = _who(user)

    if not user or user in (ADMINISTRATOR, "Guest"):
        return set()

    return set(
        frappe.db.sql_list(
            """
            select distinct link.link_name
            from `tabContact` contact
            join `tabDynamic Link` link on link.parent = contact.name
            where contact.user = %s
              and link.link_doctype = 'Customer'
              and ifnull(link.link_name, '') != ''
            """,
            user,
        )
    )


def permitted_customers(user=None):
    """The companies Frappe will actually let this account's queries reach."""
    user = _who(user)

    if not user or user in (ADMINISTRATOR, "Guest"):
        return set()

    return set(
        frappe.db.get_all(
            "User Permission",
            filters={"user": user, "allow": "Customer"},
            pluck="for_value",
        )
    )


def is_customer_account(user=None):
    """Bound to a customer, and therefore never one of ours.

    Either proof on its own makes this true. Somebody halfway through being set up, or
    halfway through being removed, is still a customer's person and must not fall through
    into the staff branch while the two records disagree.
    """
    user = _who(user)

    if is_administrator(user) or user == "Guest":
        return False

    return bool(declared_customers(user) or permitted_customers(user))


def is_staff(user=None):
    """One of ours, who serves every company rather than belonging to one."""
    user = _who(user)

    if is_administrator(user):
        return True

    if is_customer_account(user):
        return False

    return bool(roles(user).intersection(STAFF_ROLES))


# ------------------------------------------------------------------ which companies
def allowed_customers(user=None):
    """Every company this account may act for, in a stable order.

    For one of ours, that is all of them. For a customer's person it is the two proofs
    agreeing: declared as a contact, and permitted. Neither alone is enough.
    """
    user = _who(user)

    if is_administrator(user):
        return sorted(frappe.db.get_all("Customer", pluck="name"))

    declared = declared_customers(user)
    permitted = permitted_customers(user)

    if declared or permitted:
        return sorted(declared.intersection(permitted))

    if roles(user).intersection(STAFF_ROLES):
        return sorted(frappe.db.get_all("Customer", pluck="name"))

    return []


def may_reach(customer, user=None):
    return bool(customer) and customer in allowed_customers(user)


def refuse(customer=None):
    """One refusal for a company that is not theirs and for one that does not exist.

    Telling the two apart would answer a question nobody asked: whether that company is a
    customer of ours at all.
    """
    raise ValidationError(
        f"You are not allowed to access customer {customer}." if customer
        else "No customer is linked to your account.",
        REFUSED,
        403,
    )


def resolve_customer(customer=None, user=None):
    """The company a call is acting for, refusing anything else.

    Left unsaid, it is filled in only when there is exactly one it could be. An account at
    two companies has to say which: picking whichever sorts first would quietly act on the
    wrong one.
    """
    allowed = allowed_customers(user)

    if not allowed:
        refuse()

    if customer:
        if customer not in allowed:
            refuse(customer)

        return customer

    if len(allowed) == 1:
        return allowed[0]

    raise ValidationError("Say which customer you are acting for.", "VALIDATION_ERROR")


# ------------------------------------------------------------------ what they may do
def _commercial(user=None):
    if is_customer_account(user):
        return False

    return is_administrator(user) or COMMERCIAL_ROLE in roles(user)


def can_view_all_customers(user=None):
    return is_staff(user)


def can_create_customer(user=None):
    return _commercial(user)


def can_edit_customer_commercial(user=None):
    """Terms, pricing, contracts: ours to set, never the customer's."""
    return _commercial(user)


def can_edit_customer_profile(customer=None, user=None):
    """Their own address and contact details, which they know better than we do."""
    if _commercial(user):
        return True

    return (
        "MSP Customer Manager" in roles(user)
        and is_customer_account(user)
        and may_reach(customer, user)
    )


def can_view_customer_operations(customer=None, user=None):
    """Their people, machines, services and requests."""
    if is_staff(user):
        return True

    return may_reach(customer, user)


def can_manage_contracts(user=None):
    return _commercial(user)


def can_manage_pricing(user=None):
    return _commercial(user)


def can_execute_requests(user=None):
    """Carrying work out is ours. A customer asks; they never execute."""
    return is_staff(user)


def can_manage_settings(user=None):
    return _commercial(user)


CAPABILITIES = {
    "view_all_customers": can_view_all_customers,
    "create_customer": can_create_customer,
    "edit_customer_commercial": can_edit_customer_commercial,
    "edit_customer_profile": can_edit_customer_profile,
    "view_customer_operations": can_view_customer_operations,
    "manage_contracts": can_manage_contracts,
    "manage_pricing": can_manage_pricing,
    "execute_requests": can_execute_requests,
    "manage_settings": can_manage_settings,
}

REFUSALS = {
    "view_all_customers": "Only our own team can read across every customer.",
    "create_customer": "Only an MSP administrator can add a customer.",
    "edit_customer_commercial": "Only an MSP administrator can change commercial terms.",
    "edit_customer_profile": "You are not allowed to change this company's details.",
    "view_customer_operations": "You are not allowed to access this customer.",
    "manage_contracts": "Only an MSP administrator can manage contracts.",
    "manage_pricing": "Only an MSP administrator can manage pricing.",
    "execute_requests": "Only our own team carries requests out.",
    "manage_settings": "Only an MSP administrator can manage settings.",
}


def allows(capability, **context):
    """Whether this account holds a capability. The one question a service should ask."""
    check = CAPABILITIES.get(capability)

    if not check:
        raise ValidationError(f"Unknown capability '{capability}'.", "VALIDATION_ERROR")

    return bool(check(**context))


def require(capability, **context):
    """The same question, refused in the capability's own words."""
    if not allows(capability, **context):
        raise ValidationError(REFUSALS[capability], REFUSED, 403)


def capabilities(user=None):
    """What this account may do, for a screen that has to decide what to draw."""
    return {
        "view_all_customers": can_view_all_customers(user),
        "create_customer": can_create_customer(user),
        "edit_customer_commercial": can_edit_customer_commercial(user),
        "manage_contracts": can_manage_contracts(user),
        "manage_pricing": can_manage_pricing(user),
        "execute_requests": can_execute_requests(user),
        "manage_settings": can_manage_settings(user),
    }


# --------------------------------------------------------- raw document access
def has_raw_msp_permission(doc, ptype=None, user=None, debug=False):
    """Keep MSP records behind the application's scoped service endpoints.

    Customer accounts must not fall through to Frappe's generic document API. That API
    exposes fields and mutations which the portal deliberately does not. A role added to a
    customer account by mistake must not widen this answer; ``is_staff`` already applies
    that rule. The builtin Administrator remains the explicit exception.

    This hook may only deny a permission already granted by the DocType. Returning true for
    staff therefore preserves the ordinary role checks rather than granting anything new.
    """
    user = _who(user)
    return is_administrator(user) or is_staff(user)


def raw_msp_query_condition(user=None):
    """Hide every MSP row from generic list/report APIs for non-staff accounts."""
    return None if has_raw_msp_permission(None, user=user) else "1 = 0"
