import frappe

from nexgen_msp.utils.meta import select_options

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils import access
from nexgen_msp.utils.errors import NotFoundError, ValidationError

CUSTOMER_FIELDS = (
    "customer_name",
    "customer_type",
    "customer_group",
    "territory",
    "tax_id",
    "default_currency",
    "default_price_list",
    "payment_terms",
    "website",
    # only reachable through this service, which is administrator-only
    "msp_free_of_charge",
)

ADDRESS_FIELDS = (
    "address_line1",
    "address_line2",
    "city",
    "state",
    "pincode",
    "country",
    "phone",
    "email_id",
)

CONTACT_FIELDS = ("first_name", "last_name", "email_id", "phone")

# what a company may correct about itself: how to reach them, and nothing that is priced.
# Their name, their group, their currency and their terms are what we sell on, and a party
# to an agreement does not edit the agreement
PROFILE_FIELDS = ("website",)


class CustomerService:
    @staticmethod
    def _guard_admin():
        ContractService._guard_admin()

    @staticmethod
    def options():
        commercial = access.can_edit_customer_commercial()

        if not commercial:
            # Customer 360 uses the same form for our team and for a company manager.
            # A manager only needs the country list to maintain their own address; the
            # commercial catalogues remain ours and are deliberately not disclosed here.
            allowed = access.allowed_customers()
            if not any(
                access.can_edit_customer_profile(customer=customer) for customer in allowed
            ):
                access.require("edit_customer_profile")

        return {
            "customer_types": select_options("Customer", "customer_type") if commercial else [],
            "customer_groups": (
                frappe.get_all("Customer Group", pluck="name", order_by="name")
                if commercial
                else []
            ),
            "territories": (
                frappe.get_all("Territory", pluck="name", order_by="name")
                if commercial
                else []
            ),
            "countries": frappe.get_all("Country", pluck="name", order_by="name"),
            "currencies": (
                frappe.get_all(
                    "Currency", filters={"enabled": 1}, pluck="name", order_by="name"
                )
                if commercial
                else []
            ),
            "price_lists": (
                frappe.get_all(
                    "Price List",
                    filters={"selling": 1, "enabled": 1},
                    pluck="name",
                    order_by="name",
                )
                if commercial
                else []
            ),
            "payment_terms": (
                frappe.get_all("Payment Terms Template", pluck="name", order_by="name")
                if commercial
                else []
            ),
        }

    @staticmethod
    def _billing_address(customer):
        """The address the invoice bills to: the primary one, else any billing address."""
        found = frappe.db.sql(
            """
            select a.name
            from `tabAddress` a
            join `tabDynamic Link` dl on dl.parent = a.name
            where dl.link_doctype = 'Customer' and dl.link_name = %(customer)s
            order by a.is_primary_address desc,
                     (a.address_type = 'Billing') desc,
                     a.creation asc
            limit 1
            """,
            {"customer": customer},
            pluck=True,
        )

        return found[0] if found else None

    @staticmethod
    def _readable(customer):
        """A company this account may read at all, refused the same way whether it exists."""
        if not customer:
            raise NotFoundError("Customer not found.", "NOT_FOUND")

        access.require("view_customer_operations", customer=customer)

        if not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        return customer

    @staticmethod
    def _writable_fields(customer):
        """Which of the company's own fields this account may set, and no others."""
        if access.can_edit_customer_commercial():
            return set(CUSTOMER_FIELDS)

        access.require("edit_customer_profile", customer=customer)

        return set(PROFILE_FIELDS)

    @staticmethod
    def _refuse_unknown(given, allowed, what):
        """A field somebody may not set is refused, never quietly dropped.

        Silently ignoring it would tell the caller their change went through when it did
        not, which is how a currency nobody agreed to ends up believed in.
        """
        refused = sorted(set(given) - set(allowed))

        if refused:
            raise ValidationError(
                f"You are not allowed to change {what}: {', '.join(refused)}.",
                "PERMISSION_DENIED",
                403,
            )

    @staticmethod
    def _shared(doctype, name, customer):
        """Whether this record also belongs to somebody else."""
        others = frappe.db.sql_list(
            """
            select distinct link_name from `tabDynamic Link`
            where parenttype = %(doctype)s and parent = %(name)s
              and link_doctype = 'Customer' and link_name != %(customer)s
            """,
            {"doctype": doctype, "name": name, "customer": customer},
        )

        return sorted(others)

    @staticmethod
    def _guard_shared(doctype, name, customer):
        """A record two companies share is not one company's to edit.

        Correcting it here would change the other company's records without anybody there
        asking for it, so it is ours to maintain and read-only to them.
        """
        if access.can_edit_customer_commercial():
            return

        if name and CustomerService._shared(doctype, name, customer):
            raise ValidationError(
                f"This {doctype.lower()} is shared with another company and cannot be "
                "changed here. Ask your service provider to update it.",
                "PERMISSION_DENIED",
                403,
            )

    @staticmethod
    def get_customer(customer=None):
        CustomerService._readable(customer)

        if not customer or not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        doc = frappe.get_doc("Customer", customer)
        address_name = CustomerService._billing_address(customer)
        address = frappe.get_doc("Address", address_name) if address_name else None

        return {
            "name": doc.name,
            **{field: doc.get(field) for field in CUSTOMER_FIELDS},
            "address": (
                {"name": address.name, **{field: address.get(field) for field in ADDRESS_FIELDS}}
                if address
                else None
            ),
            "contact": CustomerService._primary_contact(customer),
            "last_billed_on": doc.get("msp_last_billed_on"),
            "counts": {
                "users": frappe.db.count("MSP Client User", {"customer": customer}),
                "devices": frappe.db.count("MSP Managed Device", {"customer": customer}),
                "contracts": frappe.db.count("MSP Contract", {"customer": customer}),
            },
            # what this account may do here, so a screen never has to work it out from roles
            "can": {
                "edit_commercial": access.can_edit_customer_commercial(),
                "edit_profile": access.can_edit_customer_profile(customer=customer),
                "manage_contracts": access.can_manage_contracts(),
                "manage_pricing": access.can_manage_pricing(),
            },
            "shared": {
                "address": bool(
                    address and CustomerService._shared("Address", address.name, customer)
                ),
            },
        }

    @staticmethod
    def _primary_contact(customer):
        name = frappe.db.sql_list(
            """
            select link.parent
            from `tabDynamic Link` link
            join `tabContact` contact on contact.name = link.parent
            where link.parenttype = 'Contact' and link.link_doctype = 'Customer'
              and link.link_name = %s
            order by contact.is_primary_contact desc, contact.creation desc
            limit 1
            """,
            customer,
        )

        if not name:
            return None

        doc = frappe.get_doc("Contact", name[0])

        return {
            "name": doc.name,
            "first_name": doc.first_name,
            "last_name": doc.last_name,
            "email_id": doc.email_id,
            "phone": doc.phone,
            "shared": bool(CustomerService._shared("Contact", doc.name, customer)),
        }

    @staticmethod
    def list_customers(search=None):
        """The companies this account may act for, and nothing beyond them."""
        allowed = access.allowed_customers()

        if not allowed:
            return []

        conditions = ["c.name in %(allowed)s"]
        values = {"allowed": tuple(allowed)}

        if search:
            conditions.append("(c.name like %(search)s or c.customer_name like %(search)s)")
            values["search"] = f"%{search}%"

        return frappe.db.sql(
            f"""
            select
                c.name, c.customer_name, c.customer_group, c.territory, c.website,
                (select count(*) from `tabMSP Client User` cu where cu.customer = c.name)
                    as users,
                (select count(*) from `tabMSP Managed Device` d where d.customer = c.name)
                    as devices,
                (select count(*) from `tabMSP Contract` ct
                    where ct.customer = c.name and ct.status = 'Active') as active_contracts
            from `tabCustomer` c
            where {" and ".join(conditions)}
            order by c.customer_name asc
            """,
            values,
            as_dict=True,
        )

    @staticmethod
    def create_customer(customer_name=None, details=None, address=None):
        """Put a company on file. Ours to do: it is the start of a commercial relationship."""
        access.require("create_customer")

        customer_name = " ".join((customer_name or "").split())

        if not customer_name:
            raise ValidationError("A company name is required.", "VALIDATION_ERROR")

        details = frappe.parse_json(details) if isinstance(details, str) else (details or {})
        address = frappe.parse_json(address) if isinstance(address, str) else address

        CustomerService._refuse_unknown(details, CUSTOMER_FIELDS, "on this company")

        savepoint = "customer_creation"
        frappe.db.savepoint(savepoint)

        try:
            doc = frappe.new_doc("Customer")
            doc.customer_name = customer_name

            for field in CUSTOMER_FIELDS:
                if field == "customer_name" or field not in details:
                    continue

                doc.set(field, details[field] or None)

            # ERPNext decides whether this name may exist, and says so in its own words
            doc.insert(ignore_permissions=True)

            if address:
                CustomerService._save_address(doc.name, doc.customer_name, address)
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise

        frappe.db.commit()

        return CustomerService.get_customer(doc.name)

    @staticmethod
    def save_customer(customer=None, details=None, address=None, contact=None):
        """The company's own details, saved as one act.

        A profile is one thing to the person saving it: the company, where it is, and who to
        call. If the contact will not save, the address must not be left changed either —
        half a profile is worse than none, because nobody can see which half took.
        """
        CustomerService._readable(customer)

        details = frappe.parse_json(details) if isinstance(details, str) else (details or {})
        address = frappe.parse_json(address) if isinstance(address, str) else address
        contact = frappe.parse_json(contact) if isinstance(contact, str) else contact

        allowed = CustomerService._writable_fields(customer)
        CustomerService._refuse_unknown(details, allowed, "on this company")

        if address is not None:
            CustomerService._refuse_unknown(address, ADDRESS_FIELDS + ("name",), "on this address")

        if contact is not None:
            CustomerService._refuse_unknown(contact, CONTACT_FIELDS + ("name",), "on this contact")

        savepoint = "customer_profile"
        frappe.db.savepoint(savepoint)

        try:
            doc = frappe.get_doc("Customer", customer)

            for field in CUSTOMER_FIELDS:
                if field not in details or field not in allowed:
                    continue

                # a cleared checkbox is a zero, not an absent value
                if field == "msp_free_of_charge":
                    doc.set(field, frappe.utils.cint(details[field]))
                else:
                    doc.set(field, details[field] or None)

            doc.save(ignore_permissions=True)

            if address is not None:
                CustomerService._save_address(customer, doc.customer_name, address)

            if contact is not None:
                CustomerService._save_contact(customer, contact)
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise

        frappe.db.commit()

        return CustomerService.get_customer(customer)

    @staticmethod
    def _save_contact(customer, values):
        """Who to call at this company.

        An email typed here reaches nobody's account. Whether somebody may sign in is the
        accounts workflow's business, and a contact record is not a way around it.
        """
        name = values.get("name")

        if name:
            if not frappe.db.exists("Contact", name):
                raise NotFoundError(f"Contact {name} not found.", "NOT_FOUND")

            if customer not in CustomerService._linked_customers("Contact", name):
                raise ValidationError(
                    f"Contact {name} does not belong to {customer}.", "PERMISSION_DENIED", 403
                )

            CustomerService._guard_shared("Contact", name, customer)
            doc = frappe.get_doc("Contact", name)
        else:
            doc = frappe.new_doc("Contact")
            doc.append("links", {"link_doctype": "Customer", "link_name": customer})

        if not (values.get("first_name") or "").strip():
            raise ValidationError("A contact needs a first name.", "VALIDATION_ERROR")

        doc.first_name = values["first_name"].strip()
        doc.last_name = (values.get("last_name") or "").strip() or None

        email = (values.get("email_id") or "").strip()
        phone = (values.get("phone") or "").strip()

        doc.set("email_ids", [{"email_id": email, "is_primary": 1}] if email else [])
        doc.set("phone_nos", [{"phone": phone, "is_primary_phone": 1}] if phone else [])

        was_linked_to = doc.user if name else None

        # the company's own line: whoever this form names is who to call
        if not name and not CustomerService._primary_contact(customer):
            doc.is_primary_contact = 1

        doc.save(ignore_permissions=True)

        # Frappe links a contact to any account whose email happens to match, and our own
        # hook would then hand that account this company's permission. Typing an email into
        # a profile form is not how somebody is given access, so the link is put back.
        if doc.user != was_linked_to:
            from nexgen_msp.utils import permissions

            mistaken = doc.user
            frappe.db.set_value("Contact", doc.name, "user", was_linked_to, update_modified=False)
            permissions.revoke_undeclared_customer_permissions(mistaken)

        return doc.name

    @staticmethod
    def _linked_customers(doctype, name):
        return frappe.db.sql_list(
            """
            select link_name from `tabDynamic Link`
            where parenttype = %(doctype)s and parent = %(name)s and link_doctype = 'Customer'
            """,
            {"doctype": doctype, "name": name},
        )

    @staticmethod
    def _save_address(customer, customer_name, values):
        """Keep one primary billing address per customer, created on first save."""
        if not values.get("address_line1"):
            raise ValidationError(
                "An address needs at least a first line.", "VALIDATION_ERROR"
            )

        if not values.get("country"):
            raise ValidationError("An address needs a country.", "VALIDATION_ERROR")

        name = CustomerService._billing_address(customer)

        if name:
            CustomerService._guard_shared("Address", name, customer)
            doc = frappe.get_doc("Address", name)
        else:
            doc = frappe.new_doc("Address")
            doc.address_title = customer_name or customer
            doc.address_type = "Billing"
            doc.is_primary_address = 1
            doc.append("links", {"link_doctype": "Customer", "link_name": customer})

        for field in ADDRESS_FIELDS:
            if field in values:
                doc.set(field, values[field] or None)

        doc.save(ignore_permissions=True)

        return doc.name
