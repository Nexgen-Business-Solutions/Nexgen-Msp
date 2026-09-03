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
    user = user or frappe.session.user

    if not user or user in ("Administrator", "Guest"):
        return False

    return bool(frappe.db.exists("User Permission", {"user": user, "allow": "Customer"}))


def is_internal(user=None):
    """Nexgen staff, who serve every customer rather than belonging to one."""
    user = user or frappe.session.user

    if user == "Administrator":
        return True

    if is_customer_contact(user):
        return False

    return bool(set(frappe.get_roles(user)).intersection(INTERNAL_ROLES + MANAGE_ACCESS_ROLES))


def get_allowed_customers(user=None):
    """Which customers this account may act for.

    A permission on a customer is what makes an account that customer's contact, and it
    wins over anything else the account carries. A staff role added to such an account —
    by hand in the desk, or by a mis-click on the account page — must not turn a customer's
    contact into someone who sees the whole book.

    Staff hold no such permission, and that absence is what gives them every customer: it
    is what lets a technician raise a request on a customer's behalf.
    """
    user = user or frappe.session.user

    permitted = frappe.db.get_all(
        "User Permission",
        filters={"user": user, "allow": "Customer"},
        pluck="for_value",
        order_by="for_value asc",
    )

    if permitted:
        return permitted

    if is_internal(user):
        return frappe.db.get_all("Customer", pluck="name")

    return []


def contact_profile(user=None, allowed=None):
    """The record that says who this account is at the customer it may act for.

    An address can carry more than one record — the same person invited at two companies,
    or a row left behind by an earlier invitation. Picking whichever one the database
    returns first would name a company the account has no rights to, so the choice is made
    against what it is actually allowed.
    """
    user = user or frappe.session.user

    rows = frappe.db.get_all(
        "MSP Client User",
        filters={"portal_user": user},
        fields=["name", "customer", "department"],
        order_by="modified desc",
    )

    if not rows:
        return None

    if allowed is None:
        allowed = get_allowed_customers(user)

    return next((row for row in rows if row.customer in allowed), rows[0])


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


def ensure_portal_user(email, first_name=None, last_name=None, send_welcome_email=0):
    if frappe.db.exists("User", email):
        return frappe.get_doc("User", email), False

    if not first_name:
        raise ValidationError(
            "first_name is required to create a new portal user.", "VALIDATION_ERROR"
        )

    user = frappe.get_doc(
        {
            "doctype": "User",
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "user_type": "Website User",
            "send_welcome_email": frappe.utils.cint(send_welcome_email),
        }
    ).insert(ignore_permissions=True)

    return user, True


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
service requests to our team.</p>

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


def send_portal_invitation(user_doc, customer):
    from nexgen_msp.utils import notifications

    link = notifications.on_portal_host(user_doc._reset_password(send_email=False))

    notifications.send(
        "MSP Portal Invitation",
        [user_doc.name],
        {
            "full_name": user_doc.full_name or user_doc.name,
            "customer": customer,
            "link": link,
        },
        reference_doctype="User",
        reference_name=user_doc.name,
    )

    return link


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


def reconcile_customer_permissions(user):
    """Make the permissions say exactly what the contacts say.

    The contact is where an account is declared to belong to a customer; the permission is
    only how Frappe enforces it. When the two drift — a permission added by hand, or a
    contact unlinked without it — the contact wins, and access follows the declaration
    rather than a leftover row.

    An account with no contact at all is left alone: nothing declares it, so there is
    nothing to reconcile it against.
    """
    declared = customers_from_contacts(user)

    if not declared:
        return 0, 0

    added = sum(1 for customer in declared if add_customer_permission(user, customer))

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

    return added, len(stale)


def sync_contact_user_permission(doc, method=None):
    if not doc.get("user"):
        return

    reconcile_customer_permissions(doc.user)


def reconcile_all_customer_permissions():
    """Sweep the drift that built up before the contacts were the last word."""
    users = frappe.db.sql_list(
        """
        select distinct c.user
        from `tabContact` c
        join `tabDynamic Link` dl on dl.parent = c.name
        where ifnull(c.user, '') != '' and dl.link_doctype = 'Customer'
        """
    )

    added = removed = 0

    for user in users:
        gained, lost = reconcile_customer_permissions(user)
        added += gained
        removed += lost

    if added or removed:
        frappe.db.commit()
        print(f"  portal access: {added} permission(s) added, {removed} stale one(s) removed")


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
