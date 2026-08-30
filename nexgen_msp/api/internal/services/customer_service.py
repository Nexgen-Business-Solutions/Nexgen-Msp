import frappe

from nexgen_msp.utils.meta import select_options

from nexgen_msp.api.internal.services.contract_service import ContractService
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


class CustomerService:
    @staticmethod
    def _guard_admin():
        ContractService._guard_admin()

    @staticmethod
    def options():
        CustomerService._guard_admin()

        return {
            "customer_types": select_options("Customer", "customer_type"),
            "customer_groups": frappe.get_all("Customer Group", pluck="name", order_by="name"),
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
    def get_customer(customer=None):
        CustomerService._guard_admin()

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
            "last_billed_on": doc.get("msp_last_billed_on"),
            "counts": {
                "users": frappe.db.count("MSP Client User", {"customer": customer}),
                "devices": frappe.db.count("MSP Managed Device", {"customer": customer}),
                "contracts": frappe.db.count("MSP Contract", {"customer": customer}),
            },
        }

    @staticmethod
    def save_customer(customer=None, details=None, address=None):
        """Update the customer and the address the invoice bills to."""
        CustomerService._guard_admin()

        if not customer or not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        details = frappe.parse_json(details) if isinstance(details, str) else (details or {})
        address = frappe.parse_json(address) if isinstance(address, str) else address

        doc = frappe.get_doc("Customer", customer)

        for field in CUSTOMER_FIELDS:
            if field not in details:
                continue

            # a cleared checkbox is a zero, not an absent value
            if field == "msp_free_of_charge":
                doc.set(field, frappe.utils.cint(details[field]))
            else:
                doc.set(field, details[field] or None)

        doc.save()

        if address is not None:
            CustomerService._save_address(customer, doc.customer_name, address)

        frappe.db.commit()

        return CustomerService.get_customer(customer)

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

        doc.save()

        # the invoice reads the address off the document, so refresh what is still editable
        for invoice in frappe.get_all(
            "Sales Invoice", filters={"customer": customer, "docstatus": 0}, pluck="name"
        ):
            invoice_doc = frappe.get_doc("Sales Invoice", invoice)
            invoice_doc.customer_address = doc.name
            invoice_doc.set_posting_time = 1
            invoice_doc.save()

        return doc.name
