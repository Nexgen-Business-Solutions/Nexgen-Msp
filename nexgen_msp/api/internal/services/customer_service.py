import frappe

from nexgen_msp.utils.meta import select_options

from nexgen_msp.utils import customer_access
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
    # Administrative fields are never accepted from customer managers.
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


class CustomerService:
    @staticmethod
    def _guard_admin():
        customer_access.require_admin()

    @staticmethod
    def options():
        role = customer_access.current_role()
        if role == customer_access.MANAGER:
            if not customer_access.linked_customers():
                customer_access.deny()
            return {"countries": frappe.get_all("Country", pluck="name", order_by="name")}
        CustomerService._guard_admin()

        return {
            "customer_types": select_options("Customer", "customer_type"),
            "customer_groups": frappe.get_all("Customer Group", filters={"is_group": 0}, pluck="name", order_by="name"),
            "territories": frappe.get_all("Territory", pluck="name", order_by="name"),
            "countries": frappe.get_all("Country", pluck="name", order_by="name"),
            "currencies": frappe.get_all(
                "Currency", filters={"enabled": 1}, pluck="name", order_by="name"
            ),
            "price_lists": frappe.get_all(
                "Price List", filters={"selling": 1, "enabled": 1}, pluck="name", order_by="name"
            ),
            "payment_terms": frappe.get_all(
                "Payment Terms Template", pluck="name", order_by="name"
            ),
        }

    @staticmethod
    def _billing_address(customer):
        """The address the invoice bills to: the primary one, else any billing address."""
        found = frappe.db.sql(
            """
            select a.name
            from `tabAddress` a
            join `tabDynamic Link` dl on dl.parent = a.name and dl.parenttype = 'Address'
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
    def list_customers():
        if customer_access.current_role() not in (customer_access.ADMIN, customer_access.TECHNICIAN):
            customer_access.deny()
        return frappe.get_all(
            "Customer", fields=["name", "customer_name", "customer_type", "website"],
            order_by="customer_name asc",
        )

    @staticmethod
    def _exclusive_link(doc, customer):
        return bool(doc.links) and all(
            link.link_doctype == "Customer" and link.link_name == customer for link in doc.links
        )

    @staticmethod
    def _contact_names(customer):
        return frappe.get_all(
            "Dynamic Link", filters={"parenttype": "Contact", "link_doctype": "Customer", "link_name": customer},
            pluck="parent", order_by="parent asc",
        )

    @staticmethod
    def get_customer(customer=None):
        customer, role = customer_access.require_access(customer)
        if not frappe.db.exists("Customer", customer):
            raise NotFoundError("Customer not found.", "NOT_FOUND")
        doc = frappe.get_doc("Customer", customer)
        result = {"name": doc.name, "customer_name": doc.customer_name}
        if role == customer_access.OPERATOR:
            return result

        address_name = CustomerService._billing_address(customer)
        address = frappe.get_doc("Address", address_name) if address_name else None
        admin = role == customer_access.ADMIN
        editable = role in (customer_access.ADMIN, customer_access.MANAGER)
        fields = CUSTOMER_FIELDS if admin else ("customer_type", "website")
        result.update({field: doc.get(field) for field in fields})
        result["address"] = (
            {"name": address.name, **{field: address.get(field) for field in ADDRESS_FIELDS}}
            if address else None
        )
        result["permissions"] = {
            "can_edit": editable,
            "can_administer": admin,
            "can_edit_address": editable and (admin or not address or CustomerService._exclusive_link(address, customer)),
        }
        result["contacts"] = []
        for name in CustomerService._contact_names(customer):
            contact = frappe.get_doc("Contact", name)
            result["contacts"].append({
                "name": contact.name,
                **{field: contact.get(field) for field in CONTACT_FIELDS},
                "editable": editable and (admin or CustomerService._exclusive_link(contact, customer)),
            })
        if admin:
            result["last_billed_on"] = doc.get("msp_last_billed_on")
            result["counts"] = {
                "users": frappe.db.count("MSP Client User", {"customer": customer}),
                "devices": frappe.db.count("MSP Managed Device", {"customer": customer}),
                "contracts": frappe.db.count("MSP Contract", {"customer": customer}),
            }
        return result

    @staticmethod
    def _parse_values(values, label):
        try:
            values = frappe.parse_json(values) if isinstance(values, str) else values
        except (ValueError, TypeError):
            raise ValidationError(f"{label} must be valid JSON.", "VALIDATION_ERROR")
        if not isinstance(values, dict):
            raise ValidationError(f"{label} must be an object.", "VALIDATION_ERROR")
        return values

    @staticmethod
    def _clean_fields(values, allowed):
        if set(values) - set(allowed):
            customer_access.deny()
        cleaned = {}
        for field, value in values.items():
            if field == "msp_free_of_charge":
                if value not in (0, 1, "0", "1", None):
                    raise ValidationError("Free-of-charge must be 0 or 1.", "VALIDATION_ERROR")
                cleaned[field] = frappe.utils.cint(value)
            else:
                if value is not None and not isinstance(value, str):
                    raise ValidationError(f"{field} must be text.", "VALIDATION_ERROR")
                cleaned[field] = value.strip() if value else None
        return cleaned

    @staticmethod
    def create_customer(details=None, address=None):
        """Create the ERPNext customer and optional billing address in one transaction."""
        CustomerService._guard_admin()

        details = CustomerService._parse_values(details if details is not None else {}, "Customer details")
        # Creation only copies supported fields, never owner, naming, linkage or roles.
        details = CustomerService._clean_fields(
            {key: value for key, value in details.items() if key in CUSTOMER_FIELDS}, CUSTOMER_FIELDS
        )
        if address is not None:
            address = CustomerService._parse_values(address, "Billing address")
            address = CustomerService._clean_fields(
                {key: value for key, value in address.items() if key in ADDRESS_FIELDS}, ADDRESS_FIELDS
            )
            address = address if any(address.values()) else None
        doc = frappe.new_doc("Customer")
        for field, value in details.items():
            doc.set(field, value)

        for field in ("customer_name", "customer_type", "customer_group", "territory"):
            if not doc.get(field):
                raise ValidationError(f"{field.replace('_', ' ').capitalize()} is required.", "VALIDATION_ERROR")
        if frappe.db.exists("Customer", {"customer_name": doc.customer_name}):
            raise ValidationError("A customer with this name already exists.", "DUPLICATE_CUSTOMER")

        frappe.db.savepoint("create_customer")
        try:
            # MSP administrators are authorized by the service guard; ERPNext's
            # standard roles do not include the MSP role on Customer or Address.
            doc.insert(ignore_permissions=True)
            if address:
                CustomerService._save_address(doc.name, doc.customer_name, address, creating=True)
            result = CustomerService.get_customer(doc.name)
        except Exception as exc:
            frappe.db.rollback(save_point="create_customer")
            if isinstance(exc, frappe.DuplicateEntryError):
                raise ValidationError("A customer with this name already exists.", "DUPLICATE_CUSTOMER") from exc
            raise
        frappe.db.commit()
        return result

    @staticmethod
    def save_customer(customer=None, details=None, address=None, contacts=None):
        """Authorize the target and every submitted field before changing any record."""
        customer, role = customer_access.require_access(customer, write=True)
        details = CustomerService._parse_values(details if details is not None else {}, "Customer details")
        allowed = CUSTOMER_FIELDS if role == customer_access.ADMIN else ("website",)
        details = CustomerService._clean_fields(details, allowed)
        if address is not None:
            address = CustomerService._clean_fields(
                CustomerService._parse_values(address, "Billing address"), ADDRESS_FIELDS
            )
        if contacts is not None:
            try:
                contacts = frappe.parse_json(contacts) if isinstance(contacts, str) else contacts
            except (ValueError, TypeError):
                raise ValidationError("Contacts must be valid JSON.", "VALIDATION_ERROR")
            if not isinstance(contacts, list) or len(contacts) > 100:
                raise ValidationError("Contacts must be a list of at most 100 entries.", "VALIDATION_ERROR")

        if not frappe.db.exists("Customer", customer):
            raise NotFoundError("Customer not found.", "NOT_FOUND")
        frappe.db.savepoint("save_customer")
        try:
            doc = frappe.get_doc("Customer", customer)
            for field, value in details.items():
                doc.set(field, value)
            doc.save(ignore_permissions=True)
            if address is not None:
                CustomerService._save_address(customer, doc.customer_name, address, allow_shared=role == customer_access.ADMIN)
            if contacts is not None:
                CustomerService._save_contacts(customer, contacts, allow_shared=role == customer_access.ADMIN)
            result = CustomerService.get_customer(customer)
        except Exception:
            frappe.db.rollback(save_point="save_customer")
            raise
        frappe.db.commit()
        return result

    @staticmethod
    def _save_contacts(customer, contacts, *, allow_shared=False):
        linked = set(CustomerService._contact_names(customer))
        for values in contacts:
            values = CustomerService._parse_values(values, "Contact")
            name = values.get("name")
            if name is not None and (not isinstance(name, str) or name not in linked):
                customer_access.deny()
            fields = CustomerService._clean_fields(
                {key: value for key, value in values.items() if key != "name"}, CONTACT_FIELDS
            )
            doc = frappe.get_doc("Contact", name) if name else frappe.new_doc("Contact")
            if name and not allow_shared and not CustomerService._exclusive_link(doc, customer):
                customer_access.deny()
            if not name:
                doc.append("links", {"link_doctype": "Customer", "link_name": customer})
            for field in ("first_name", "last_name"):
                if field in fields:
                    doc.set(field, fields[field])
            if not doc.first_name:
                raise ValidationError("Contact first name is required.", "VALIDATION_ERROR")
            if "email_id" in fields:
                email = fields["email_id"]
                # Contact.validate otherwise infers a User from the email, and the
                # contact hook would grant that account access to this customer.
                if not doc.user and email and frappe.db.exists("User", {"email": email}):
                    raise ValidationError("Account access must be managed from Accounts.", "VALIDATION_ERROR")
                primary = next((row for row in doc.email_ids if row.is_primary), None)
                if primary:
                    if email:
                        primary.email_id = email
                    else:
                        doc.remove(primary)
                elif email:
                    doc.append("email_ids", {"email_id": email, "is_primary": 1})
            if "phone" in fields:
                phone = fields["phone"]
                primary = next((row for row in doc.phone_nos if row.is_primary_phone), None)
                if primary:
                    if phone:
                        primary.phone = phone
                    else:
                        doc.remove(primary)
                elif phone:
                    doc.append("phone_nos", {"phone": phone, "is_primary_phone": 1})
            # Preserve account linkage even when changing contact email addresses.
            original_user = doc.user
            doc.save(ignore_permissions=True)
            if doc.user != original_user:
                customer_access.deny()

    @staticmethod
    def _save_address(customer, customer_name, values, *, creating=False, allow_shared=False):
        """Keep one primary billing address per customer, created on first save."""
        if not values.get("address_line1"):
            raise ValidationError(
                "An address needs at least a first line.", "VALIDATION_ERROR"
            )

        if not values.get("country"):
            raise ValidationError("An address needs a country.", "VALIDATION_ERROR")

        if not values.get("city"):
            raise ValidationError("An address needs a city.", "VALIDATION_ERROR")

        name = None if creating else CustomerService._billing_address(customer)

        if name:
            doc = frappe.get_doc("Address", name)
            if not allow_shared and not CustomerService._exclusive_link(doc, customer):
                customer_access.deny()
        else:
            doc = frappe.new_doc("Address")
            doc.address_title = customer_name or customer
            doc.address_type = "Billing"
            doc.is_primary_address = 1
            doc.append("links", {"link_doctype": "Customer", "link_name": customer})

        for field in ADDRESS_FIELDS:
            if field in values:
                doc.set(field, values[field] or None)

        if creating:
            doc.insert(ignore_permissions=True)
            return doc.name

        doc.save(ignore_permissions=True)

        # the invoice reads the address off the document, so refresh what is still editable
        for invoice in frappe.get_all(
            "Sales Invoice", filters={"customer": customer, "docstatus": 0}, pluck="name"
        ):
            invoice_doc = frappe.get_doc("Sales Invoice", invoice)
            invoice_doc.customer_address = doc.name
            invoice_doc.set_posting_time = 1
            invoice_doc.save(ignore_permissions=True)

        return doc.name
