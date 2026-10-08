import frappe

from nexgen_msp.utils.errors import ValidationError

# Two families, and an account belongs to exactly one of them. A customer role means the
# account answers for one company; an internal role means it answers for all of them. An
# account holding both would be a contradiction the permission model cannot express, so it
# is refused rather than resolved.
CUSTOMER_ROLES = ("MSP Customer Manager", "MSP Customer Operator")
INTERNAL_ROLES = ("MSP System Admin", "MSP Technician")
MANAGE_ACCESS_ROLES = ("MSP System Admin", "System Manager")

# kept under its old name for the code that still reads it as "the role a contact holds"
PORTAL_ROLES = CUSTOMER_ROLES

CUSTOMER_MANAGER_ROLE = "MSP Customer Manager"
CUSTOMER_OPERATOR_ROLE = "MSP Customer Operator"

# what a person is shown, which is not what the database calls it
ROLE_LABELS = {
    "MSP System Admin": "Administrator",
    "MSP Technician": "Technician",
    "MSP Customer Manager": "Customer Manager",
    "MSP Customer Operator": "Customer Operator",
}


def guard_can_manage_access():
    if frappe.session.user == "Administrator":
        return

    roles = set(frappe.get_roles())
    if not roles.intersection(MANAGE_ACCESS_ROLES):
        raise ValidationError(
            "You are not allowed to manage portal access.", "PERMISSION_DENIED", 403
        )


def has_customer_permission(user, customer):
    return bool(
        frappe.db.exists(
            "User Permission", {"user": user, "allow": "Customer", "for_value": customer}
        )
    )


def may_see_invoices(user=None):
    """Whether this account is allowed near the money.

    The two customer roles are otherwise the same — both raise requests, both approve when
    the authority matrix says so. The invoices are the whole difference, so the rule is
    written here once rather than guessed at on each screen.
    """
    user = user or frappe.session.user

    return CUSTOMER_OPERATOR_ROLE not in set(frappe.get_roles(user))


def family_of(role):
    """Which side of the fence a role sits on."""
    if role in CUSTOMER_ROLES:
        return "customer"

    return "internal" if role in INTERNAL_ROLES else None


def held_roles(user):
    """The application roles this account carries, by family."""
    held = set(frappe.get_roles(user))

    return {
        "customer": sorted(held.intersection(CUSTOMER_ROLES)),
        "internal": sorted(held.intersection(INTERNAL_ROLES)),
    }


def guard_single_family(user, role):
    """Refuse a role that would put an account on both sides at once.

    Not corrected silently: an account that was meant to be a contact and is being handed
    an internal role is a mistake someone should see, not one to paper over.
    """
    family = family_of(role)

    if not family:
        raise ValidationError(f"'{role}' is not a role this application grants.", "VALIDATION_ERROR")

    other = "internal" if family == "customer" else "customer"
    conflicting = held_roles(user)[other]

    if conflicting:
        raise ValidationError(
            f"{user} already holds {', '.join(conflicting)}. An account belongs either to a "
            "customer or to Nexgen, never to both — remove that role first.",
            "VALIDATION_ERROR",
        )

    if family == "customer" and not get_allowed_customers(user):
        raise ValidationError(
            f"{user} is not linked to any customer, so it cannot hold a customer role. "
            "Give it a customer first.",
            "VALIDATION_ERROR",
        )


def is_customer_contact(user=None):
    """An account bound to a customer belongs to that customer, whatever else it holds.

    This is the fact a staff role must never override: a contact who is also given an
    internal role would otherwise reach every customer in the book.
    """
    from nexgen_msp.utils import access

    return access.is_customer_account(user)


def is_internal(user=None):
    """Nexgen staff, who serve every customer rather than belonging to one."""
    from nexgen_msp.utils import access

    return access.is_staff(user)


def get_allowed_customers(user=None):
    """Which customers this account may act for.

    Answered in one place, because it decides what every screen and every service may see.
    A customer's person reaches a company only where the contact and the permission agree;
    our own people hold neither and reach them all.
    """
    from nexgen_msp.utils import access

    return access.allowed_customers(user)


def contact_profile(user=None, allowed=None):
    """The company this account is a contact of, among those it may act for.

    An address can be a contact at more than one company. Picking whichever one the
    database returns first would name a company the account has no rights to, so the
    choice is made against what it is actually allowed.
    """
    user = user or frappe.session.user
    linked = customers_from_contacts(user)

    if not linked:
        return None

    if allowed is None:
        allowed = get_allowed_customers(user)

    customer = next((name for name in allowed if name in linked), None) or sorted(linked)[0]

    return frappe._dict(customer=customer)

def _withdraw_from_authority(user):
    """A company taken away from an account takes its authority line with it.

    Left behind, that line refuses to validate, and the whole matrix of the company it sits
    in can no longer be saved — by anyone, for anyone.
    """
    from nexgen_msp.utils import approval

    return approval.withdraw_from_elsewhere(user, customer_permissions_of(user))


def add_customer_permission(user, customer):
    if has_customer_permission(user, customer):
        return False

    frappe.get_doc(
        {
            "doctype": "User Permission",
            "user": user,
            "allow": "Customer",
            "for_value": customer,
            "apply_to_all_doctypes": 1,
        }
    ).insert(ignore_permissions=True)

    return True


def remove_customer_permission(user, customer=None):
    filters = {"user": user, "allow": "Customer"}
    if customer:
        filters["for_value"] = customer

    removed = frappe.db.get_all("User Permission", filters=filters, pluck="name")
    for name in removed:
        frappe.delete_doc("User Permission", name, ignore_permissions=True)

    if removed:
        _withdraw_from_authority(user)

    return len(removed)


def add_role(user_doc, role):
    if any(r.role == role for r in user_doc.roles):
        return False

    user_doc.append("roles", {"role": role})
    user_doc.save(ignore_permissions=True)
    return True


def remove_roles(user_doc, roles):
    kept = [r for r in user_doc.roles if r.role not in roles]
    if len(kept) == len(user_doc.roles):
        return False

    user_doc.set("roles", kept)
    user_doc.save(ignore_permissions=True)
    return True


def get_customer_contact(user, customer):
    rows = frappe.db.sql(
        """
        select dl.parent
        from `tabDynamic Link` dl
        inner join `tabContact` c on c.name = dl.parent
        where dl.link_doctype = 'Customer'
          and dl.link_name = %s
          and c.user = %s
        limit 1
        """,
        (customer, user),
    )

    return rows[0][0] if rows else None


INVITATION_TEMPLATE = "MSP Portal Invitation"

INVITATION_SUBJECT = "Your {{ app_name }} portal access"

INVITATION_BODY = """<p>Hello {{ full_name }},</p>

<p>An access to the {{ app_name }} portal has been created for {{ customer }}.</p>

<p>From the portal you can review your users, devices and services, and submit
requests to our team.</p>

<p>Set your password to activate your account:</p>

<p><a href="{{ link }}">Set my password</a></p>

<p>If the button does not work, copy this address into your browser:<br>
{{ link }}</p>

<p>This link can only be used once. If you did not expect this email, you can ignore it.</p>

<p>{{ app_name }}</p>
"""


def ensure_invitation_template():
    if frappe.db.exists("Email Template", INVITATION_TEMPLATE):
        return INVITATION_TEMPLATE

    frappe.get_doc(
        {
            "doctype": "Email Template",
            "name": INVITATION_TEMPLATE,
            "subject": INVITATION_SUBJECT,
            "use_html": 1,
            "response_html": INVITATION_BODY,
        }
    ).insert(ignore_permissions=True)

    return INVITATION_TEMPLATE


def get_linked_customers(contact_doc):
    return [
        link.link_name
        for link in (contact_doc.links or [])
        if link.link_doctype == "Customer" and link.link_name
    ]


def customers_from_contacts(user):
    """Every customer this account is a contact of.

    Read across all of its contact records, not one: an invitation creates a contact per
    customer, so a person invited at two companies has two — and judging by a single one
    would call the other company's access stale.
    """
    return set(
        frappe.db.sql_list(
            """
            select distinct dl.link_name
            from `tabContact` c
            join `tabDynamic Link` dl on dl.parent = c.name
            where c.user = %s
              and dl.link_doctype = 'Customer'
              and ifnull(dl.link_name, '') != ''
            """,
            user,
        )
    )


# what a reconciliation can conclude about one account
HEALTHY = "HEALTHY"
REPAIRED_CONTACT_LINK = "REPAIRED_CONTACT_LINK"
REPAIRED_USER_PERMISSION = "REPAIRED_USER_PERMISSION"
MISSING_CUSTOMER_REFERENCE = "MISSING_CUSTOMER_REFERENCE"
CUSTOMER_REFERENCE_CONFLICT = "CUSTOMER_REFERENCE_CONFLICT"
ROLE_FAMILY_CONFLICT = "ROLE_FAMILY_CONFLICT"
NOT_CUSTOMER_ACCOUNT = "NOT_CUSTOMER_ACCOUNT"

REPAIRED = (REPAIRED_CONTACT_LINK, REPAIRED_USER_PERMISSION)
NEEDS_REVIEW = (MISSING_CUSTOMER_REFERENCE, CUSTOMER_REFERENCE_CONFLICT, ROLE_FAMILY_CONFLICT)

STATUS_TEXT = {
    ROLE_FAMILY_CONFLICT: (
        "This account has both customer and Nexgen staff roles. "
        "Remove one role family before access can be reconciled."
    ),
    MISSING_CUSTOMER_REFERENCE: (
        "This customer account is not linked to any Customer. "
        "Assign a Customer in Accounts before the account can be used."
    ),
    CUSTOMER_REFERENCE_CONFLICT: (
        "Customer access references disagree. "
        "Review the Contact links and User Permissions before continuing."
    ),
}


def customer_permissions_of(user):
    """Every customer Frappe itself lets this account reach."""
    return set(
        frappe.db.get_all(
            "User Permission",
            filters={"user": user, "allow": "Customer"},
            pluck="for_value",
        )
    )


def reconcile_customer_permissions(user):
    """Check that a customer account's two references agree, and repair only the obvious.

    The role is what says an account belongs to a customer, so the check starts there: a
    contact record that was never created cannot declare anything, and an account whose
    contact was lost would otherwise pass unnoticed.

    One side empty is a missing reference and is written from the other. Both sides filled
    and disagreeing is somebody's decision to make, never ours: nothing is unioned, and no
    permission is ever taken away here.
    """
    held = held_roles(user)
    outcome = {
        "user": user,
        "status": NOT_CUSTOMER_ACCOUNT,
        "customer_roles": held["customer"],
        "internal_roles": held["internal"],
        "contact_customers": [],
        "permission_customers": [],
        "added_contact_links": [],
        "added_permissions": [],
        "removed_permissions": [],
    }

    if not held["customer"]:
        return outcome

    if held["internal"]:
        outcome["status"] = ROLE_FAMILY_CONFLICT

        return outcome

    declared = customers_from_contacts(user)
    permitted = customer_permissions_of(user)
    outcome["contact_customers"] = sorted(declared)
    outcome["permission_customers"] = sorted(permitted)

    if declared and permitted:
        outcome["status"] = HEALTHY if declared == permitted else CUSTOMER_REFERENCE_CONFLICT

        return outcome

    if not declared and not permitted:
        outcome["status"] = MISSING_CUSTOMER_REFERENCE

        return outcome

    if not declared:
        outcome["added_contact_links"] = _declare_on_contact(user, permitted)
        outcome["status"] = REPAIRED_CONTACT_LINK
    else:
        outcome["added_permissions"] = [
            customer for customer in sorted(declared) if add_customer_permission(user, customer)
        ]
        outcome["status"] = REPAIRED_USER_PERMISSION

        if outcome["added_permissions"]:
            frappe.get_doc("User", user).add_comment(
                "Comment", f"Created missing Customer User Permission for {user}."
            )

    outcome["contact_customers"] = sorted(customers_from_contacts(user))
    outcome["permission_customers"] = sorted(customer_permissions_of(user))

    if set(outcome["contact_customers"]) != set(outcome["permission_customers"]):
        outcome["status"] = CUSTOMER_REFERENCE_CONFLICT

    return outcome


def _declare_on_contact(user, customers):
    """Write on the contact what the permissions already say."""
    user_doc = frappe.get_doc("User", user)
    written = []

    for customer in sorted(customers):
        if not frappe.db.exists("Customer", customer):
            continue

        _, created = ensure_customer_contact(user_doc, customer)
        written.append(customer)

        if created:
            continue

    if written:
        frappe.get_doc("User", user).add_comment(
            "Comment", f"Created missing Customer reference on Contact for {user}."
        )

    return written


def revoke_undeclared_customer_permissions(user):
    """Take away every permission no contact stands behind.

    Stricter than the reconciliation: that one leaves an account with no contact at all
    alone, because nothing declares it either way. This one is used when something has just
    linked an account by accident, and the leftover has to go whether or not the account has
    contacts elsewhere.
    """
    if not user:
        return 0

    declared = customers_from_contacts(user)
    stale = [
        row.name
        for row in frappe.db.get_all(
            "User Permission",
            filters={"user": user, "allow": "Customer"},
            fields=["name", "for_value"],
        )
        if row.for_value not in declared
    ]

    for name in stale:
        frappe.delete_doc("User Permission", name, ignore_permissions=True)

    if stale:
        _withdraw_from_authority(user)

    return len(stale)


def sync_contact_user_permission(doc, method=None):
    """A contact says who an account answers for; only a customer account is reconciled.

    Nothing is written for an account without a customer role: a contact record of our own
    staff, or of a person with no application account at all, is somebody else's business.
    """
    user = doc.get("user")

    if not user or frappe.flags.in_msp_access_reconciliation:
        return

    if not frappe.db.exists("User", user):
        return

    if not held_roles(user)["customer"]:
        return

    frappe.flags.in_msp_access_reconciliation = True

    try:
        reconcile_customer_permissions(user)
    finally:
        frappe.flags.in_msp_access_reconciliation = False


def customer_role_accounts():
    """Every account a customer role says belongs to a customer.

    Found by role rather than by contact: an account whose contact reference was never
    created is exactly the one that has to be found.
    """
    return sorted(
        set(
            frappe.db.sql_list(
                """
                select distinct parent from `tabHas Role`
                where parenttype = 'User' and role in %(roles)s
                """,
                {"roles": CUSTOMER_ROLES},
            )
        )
        - {"Administrator", "Guest"}
    )


def reconcile_all_customer_permissions():
    """Check every customer account, repair what is unambiguous, report the rest."""
    healthy = repaired = review = 0

    for user in customer_role_accounts():
        if not frappe.db.get_value("User", user, "enabled"):
            continue

        outcome = reconcile_customer_permissions(user)

        if outcome["status"] == HEALTHY:
            healthy += 1
        elif outcome["status"] in REPAIRED:
            repaired += 1
        elif outcome["status"] in NEEDS_REVIEW:
            review += 1
            frappe.logger("msp.access").warning(
                f"{user}: {outcome['status']} "
                f"contacts={outcome['contact_customers']} permissions={outcome['permission_customers']}"
            )

    frappe.db.commit()
    print(f"  customer access: {healthy} healthy, {repaired} repaired, {review} need review")

    return {"healthy": healthy, "repaired": repaired, "need_review": review}


def ensure_customer_contact(user_doc, customer):
    """The contact that says this account belongs to that customer.

    Frappe already makes a contact of its own when a user is created, so the link is added
    to that one rather than a second contact being made beside it — two contacts for one
    person is how a company ends up looking like two.
    """
    existing = get_customer_contact(user_doc.name, customer)

    if existing:
        return existing, False

    orphan = frappe.db.get_value("Contact", {"user": user_doc.name}, "name")

    if orphan:
        doc = frappe.get_doc("Contact", orphan)
        doc.append("links", {"link_doctype": "Customer", "link_name": customer})
        doc.save(ignore_permissions=True)

        return doc.name, False

    contact = frappe.get_doc(
        {
            "doctype": "Contact",
            "first_name": user_doc.first_name,
            "last_name": user_doc.last_name,
            "user": user_doc.name,
            "email_ids": [{"email_id": user_doc.name, "is_primary": 1}],
            "links": [{"link_doctype": "Customer", "link_name": customer}],
        }
    ).insert(ignore_permissions=True)

    return contact.name, True


def keep_technicians_off_desk():
	"""Move technicians to Website User, after the roles have been synced.

	A role that grants desk access forces its holders to System User — which opens the
	Frappe backend to them and consumes a paid seat. This runs after fixtures precisely
	because the fixture is what settles the role, and the accounts follow from it.
	"""
	for user in frappe.get_all(
		"User", filters={"enabled": 1, "user_type": "System User"}, pluck="name"
	):
		roles = set(frappe.get_roles(user))

		if not roles.intersection({"MSP Technician"} | set(CUSTOMER_ROLES)):
			continue

		if roles.intersection({"MSP System Admin", "System Manager", "Administrator"}):
			continue

		frappe.db.set_value("User", user, "user_type", "Website User")

	frappe.db.commit()
