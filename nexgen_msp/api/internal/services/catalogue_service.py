import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils.errors import NotFoundError, ValidationError

ITEM_GROUP = "Services"

# a service is billed in months, and a month can be a half: an integer-only
# unit would make the first half-month invoice fail
from nexgen_msp.utils.catalogue import BILLING_UOM

OPEN_ASSIGNMENT_STATUSES = ("Pending Setup", "Active", "Suspended", "Pending Removal")

SCOPES = ("User", "Device", "Both")


class CatalogueService:
    @staticmethod
    def _guard_admin():
        """The service catalogue drives what can be sold, so it stays with the administrator."""
        ContractService._guard_admin()

    @staticmethod
    def _ensure_group():
        if not frappe.db.exists("Item Group", ITEM_GROUP):
            frappe.get_doc(
                {
                    "doctype": "Item Group",
                    "item_group_name": ITEM_GROUP,
                    "parent_item_group": "All Item Groups",
                    "is_group": 0,
                }
            ).insert(ignore_permissions=True)

        return ITEM_GROUP

    @staticmethod
    def get_options():
        CatalogueService._guard_admin()

        return {
            "scopes": list(SCOPES),
            "uoms": frappe.get_all("UOM", pluck="name", order_by="name asc", limit_page_length=0),
            "external_systems": [
                option
                for option in (
                    frappe.get_meta("MSP Service Assignment").get_field("external_system").options or ""
                ).split("\n")
                if option
            ],
        }

    @staticmethod
    def list_services():
        """Every sellable service, with how much of the estate depends on it."""
        CatalogueService._guard_admin()

        return frappe.db.sql(
            """
            select
                item.name, item.item_name, item.disabled, item.stock_uom,
                item.msp_service_scope as scope, item.description,
                item.msp_invoice_label as invoice_label,
                (select count(*) from `tabMSP Service Assignment` sa
                    where sa.service_item = item.name
                      and sa.operational_status in %(open)s) as open_assignments,
                (select count(distinct sa.customer) from `tabMSP Service Assignment` sa
                    where sa.service_item = item.name
                      and sa.operational_status in %(open)s) as customers,
                (select count(*) from `tabMSP Service Eligibility` se
                    where se.service_item = item.name and se.is_eligible = 1
                      and se.negotiated_rate > 0) as priced_contracts
            from `tabItem` item
            where item.is_stock_item = 0
            order by item.disabled asc, item.item_name asc
            """,
            {"open": OPEN_ASSIGNMENT_STATUSES},
            as_dict=True,
        )

    @staticmethod
    def save_service(
        name=None,
        item_code=None,
        item_name=None,
        scope=None,
        description=None,
        uom=None,
        disabled=None,
        invoice_label=None,
    ):
        """Create or update a service. Its code never changes once assignments point at it."""
        CatalogueService._guard_admin()

        if not item_name:
            raise ValidationError("item_name is required.", "VALIDATION_ERROR")

        if scope and scope not in SCOPES:
            raise ValidationError(f"'{scope}' is not a valid scope.", "VALIDATION_ERROR")

        if name:
            if not frappe.db.exists("Item", name):
                raise NotFoundError(f"Item {name} not found.", "NOT_FOUND")
            doc = frappe.get_doc("Item", name)
        else:
            code = (item_code or "").strip().upper()

            if not code:
                raise ValidationError("item_code is required for a new service.", "VALIDATION_ERROR")

            # reusing a code means editing that service, not colliding with it
            if frappe.db.exists("Item", code):
                doc = frappe.get_doc("Item", code)
            else:
                doc = frappe.new_doc("Item")
                doc.item_code = code
                doc.item_group = CatalogueService._ensure_group()
                doc.is_stock_item = 0
                doc.is_sales_item = 1
                doc.is_purchase_item = 0
                doc.stock_uom = uom or BILLING_UOM

        doc.item_name = item_name
        doc.description = description or item_name
        doc.msp_service_scope = scope or "User"

        if invoice_label is not None:
            doc.msp_invoice_label = (invoice_label or "").strip() or None

        if disabled is not None:
            wanted = frappe.utils.cint(disabled)

            if wanted and not doc.disabled:
                open_count = frappe.db.count(
                    "MSP Service Assignment",
                    {
                        "service_item": doc.name or doc.item_code,
                        "operational_status": ("in", OPEN_ASSIGNMENT_STATUSES),
                    },
                )
                if open_count:
                    raise ValidationError(
                        f"{open_count} assignment(s) still use this service. End them before "
                        "retiring it from the catalogue.",
                        "VALIDATION_ERROR",
                    )

            doc.disabled = wanted

        doc.save()
        frappe.db.commit()

        return {"name": doc.name, "item_name": doc.item_name, "scope": doc.msp_service_scope}

    @staticmethod
    def get_service(name=None):
        """One service: how it is sold, who runs it, and what it earns."""
        CatalogueService._guard_admin()

        if not name or not frappe.db.exists("Item", name):
            raise NotFoundError(f"Service {name} not found.", "NOT_FOUND")

        doc = frappe.db.get_value(
            "Item",
            name,
            [
                "name",
                "item_name",
                "msp_invoice_label as invoice_label",
                "msp_service_scope as scope",
                "description",
                "stock_uom as uom",
                "disabled",
            ],
            as_dict=True,
        )

        customers = frappe.db.sql(
            """
            select
                sa.customer,
                count(*) as open_assignments,
                sum(sa.billing_status = 'Billable') as billable_assignments,
                (select price.price_list_rate from `tabItem Price` price
                    where price.item_code = %(item)s and price.customer = sa.customer
                      and price.selling = 1
                      and (price.valid_from is null or price.valid_from <= curdate())
                      and (price.valid_upto is null or price.valid_upto >= curdate())
                    order by price.valid_from desc limit 1) as current_rate,
                (select price.msp_discount_percent from `tabItem Price` price
                    where price.item_code = %(item)s and price.customer = sa.customer
                      and price.selling = 1
                      and (price.valid_from is null or price.valid_from <= curdate())
                      and (price.valid_upto is null or price.valid_upto >= curdate())
                    order by price.valid_from desc limit 1) as discount_percent
            from `tabMSP Service Assignment` sa
            where sa.service_item = %(item)s
              and sa.operational_status in %(open)s
            group by sa.customer
            order by open_assignments desc
            """,
            {"item": name, "open": OPEN_ASSIGNMENT_STATUSES},
            as_dict=True,
        )

        contracts = frappe.db.sql(
            """
            select c.name, c.title, c.customer, c.status, c.billing_frequency
            from `tabMSP Contract` c
            join `tabMSP Contract Service` cs on cs.parent = c.name
            where cs.service_item = %(item)s
            order by c.status asc, c.start_date desc
            """,
            {"item": name},
            as_dict=True,
        )

        billed = frappe.db.sql(
            """
            select
                count(distinct brl.parent) as runs,
                sum(brl.billable_months) as months,
                sum(brl.amount) as amount
            from `tabMSP Billing Run Line` brl
            join `tabMSP Billing Run` br on br.name = brl.parent
            where brl.service_item = %(item)s and br.docstatus = 1
            """,
            {"item": name},
            as_dict=True,
        )

        return {
            "service": doc,
            "customers": customers,
            "contracts": contracts,
            "billed": billed[0] if billed else {},
            "scopes": list(SCOPES),
        }
