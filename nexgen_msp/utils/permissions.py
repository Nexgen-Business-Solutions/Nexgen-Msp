import frappe

from nexgen_msp.utils.errors import ValidationError

PORTAL_ROLES = ("Customer Portal Manager",)
INTERNAL_ROLES = ("MSP System Admin", "MSP Technician")
MANAGE_ACCESS_ROLES = ("MSP System Admin", "System Manager")


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


def get_allowed_customers(user=None):
    user = user or frappe.session.user

    if user == "Administrator":
        return frappe.db.get_all("Customer", pluck="name")

    return frappe.db.get_all(
        "User Permission", filters={"user": user, "allow": "Customer"}, pluck="for_value"
    )


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

    link = user_doc._reset_password(send_email=False)

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


def sync_contact_user_permission(doc, method=None):
    if not doc.get("user"):
        return

    customers = get_linked_customers(doc)
    if not customers:
        return

    for customer in customers:
        add_customer_permission(doc.user, customer)

    stale = [
        row
        for row in frappe.db.get_all(
            "User Permission",
            filters={"user": doc.user, "allow": "Customer"},
            fields=["name", "for_value"],
        )
        if row.for_value not in customers
    ]

    for row in stale:
        frappe.delete_doc("User Permission", row.name, ignore_permissions=True)


def ensure_customer_contact(user_doc, customer):
    existing = get_customer_contact(user_doc.name, customer)
    if existing:
        return existing, False

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
