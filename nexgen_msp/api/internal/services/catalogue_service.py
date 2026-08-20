import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils.errors import NotFoundError, ValidationError

ITEM_GROUP = "Services"

DEFAULT_UOM = "Unit"

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
                    frappe.get_meta("Service Assignment").get_field("external_system").options or ""
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
                (select count(*) from `tabService Assignment` sa
                    where sa.service_item = item.name
                      and sa.operational_status in %(open)s) as open_assignments,
                (select count(distinct sa.customer) from `tabService Assignment` sa
                    where sa.service_item = item.name
                      and sa.operational_status in %(open)s) as customers,
                (select count(*) from `tabService Eligibility` se
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

            if frappe.db.exists("Item", code):
                raise ValidationError(f"A service already uses the code {code}.", "VALIDATION_ERROR")

            doc = frappe.new_doc("Item")
            doc.item_code = code
            doc.item_group = CatalogueService._ensure_group()
            doc.is_stock_item = 0
            doc.is_sales_item = 1
            doc.is_purchase_item = 0
            doc.stock_uom = uom or DEFAULT_UOM

        doc.item_name = item_name
        doc.description = description or item_name
        doc.msp_service_scope = scope or "User"

        if disabled is not None:
            wanted = frappe.utils.cint(disabled)

            if wanted and not doc.disabled:
                open_count = frappe.db.count(
                    "Service Assignment",
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
