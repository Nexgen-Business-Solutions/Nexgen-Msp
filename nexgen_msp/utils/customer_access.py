"""Customer master permissions, resolved from the authenticated account only."""

import frappe

from nexgen_msp.utils import permissions
from nexgen_msp.utils.errors import PermissionError

ADMIN = "MSP System Admin"
TECHNICIAN = "MSP Technician"
MANAGER = permissions.CUSTOMER_MANAGER_ROLE
OPERATOR = permissions.CUSTOMER_OPERATOR_ROLE


def deny():
    raise PermissionError("You are not allowed to access or change this customer.", "PERMISSION_DENIED")


def current_role():
    user = frappe.session.user
    if not user or user == "Guest":
        deny()
    roles = set(frappe.get_roles())
    # Administrator holds every installed role. Other mixed accounts must never
    # turn a customer-side role or persistent customer linkage into global access.
    if user == "Administrator" and ADMIN in roles:
        return ADMIN
    if OPERATOR in roles:
        return OPERATOR
    if MANAGER in roles:
        return MANAGER
    if permissions.is_customer_contact(user) or permissions.customers_from_contacts(user):
        deny()
    for role in (ADMIN, TECHNICIAN):
        if role in roles:
            return role
    deny()


def linked_customers():
    """Contact is the declaration; User Permission must agree, never widen it."""
    user = frappe.session.user
    declared = permissions.customers_from_contacts(user)
    permitted = frappe.get_all(
        "User Permission", filters={"user": user, "allow": "Customer"}, pluck="for_value"
    )
    return sorted(declared.intersection(permitted))


def require_admin():
    if current_role() != ADMIN:
        deny()


def require_access(customer=None, *, write=False):
    role = current_role()
    if customer is not None and (not isinstance(customer, str) or not customer.strip()):
        deny()
    if write and role not in (ADMIN, MANAGER):
        deny()
    if role in (MANAGER, OPERATOR):
        allowed = linked_customers()
        if customer is None and len(allowed) == 1:
            customer = allowed[0]
        if not customer or customer not in allowed:
            deny()
    elif not customer:
        deny()
    return customer, role
