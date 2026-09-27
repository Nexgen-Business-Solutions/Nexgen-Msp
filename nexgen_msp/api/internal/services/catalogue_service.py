"""The service catalogue: the ERPNext Items Nexgen MSP is configured to sell, and nothing else.

A catalogue row is an `MSP Service Definition` joined to its ERPNext Item. Availability inside
MSP belongs to the definition; `Item.disabled`, `is_stock_item` and the unit table stay
ERPNext's own. Removing a service from MSP never switches an Item off for the rest of the site,
and an Item is only repaired when somebody says, field by field, that it should be.
"""

import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.api.internal.services.service_definition_service import (
    DEFINITION,
    SCOPES,
    ServiceDefinitionService,
)
from nexgen_msp.utils import catalogue as msp_items
from nexgen_msp.utils.assignments import OPEN_ASSIGNMENT_STATUSES
from nexgen_msp.utils.catalogue import BILLING_UOM
from nexgen_msp.utils.errors import NotFoundError, ValidationError

ITEM_GROUP = "Services"

# what the catalogue says about MSP itself, and what it says about ERPNext: two axes, never one
MSP_AVAILABILITY = {True: "Available", False: "Not available"}

STALE_ITEM = (
    "This ERPNext Item changed while you were configuring it. "
    "Review the current Item state before continuing."
)


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

    # ------------------------------------------------------------------ the catalogue
    @staticmethod
    def list_services(search=None, scope=None, status=None):
        """Every ERPNext Item configured for Nexgen MSP, with both of its status axes."""
        CatalogueService._guard_admin()

        conditions = []
        values = {"open": OPEN_ASSIGNMENT_STATUSES}

        if search:
            conditions.append(
                "(item.item_name like %(search)s or item.name like %(search)s"
                " or msp_def.name like %(search)s or msp_def.invoice_label like %(search)s)"
            )
            values["search"] = f"%{search}%"

        if scope:
            conditions.append("msp_def.service_scope = %(scope)s")
            values["scope"] = scope

        where = (" and " + " and ".join(conditions)) if conditions else ""
        rows = frappe.db.sql(
            f"""
            select
                msp_def.name as definition, msp_def.enabled as msp_enabled,
                msp_def.service_scope as scope, msp_def.invoice_label,
                item.name, item.item_name, item.description,
                item.disabled, item.stock_uom, item.sales_uom,
                item.is_stock_item, item.is_sales_item,
                (select count(*) from `tabMSP Service Assignment` sa
                    where sa.service_item = item.name
                      and sa.operational_status in %(open)s) as open_assignments,
                (select count(distinct sa.customer) from `tabMSP Service Assignment` sa
                    where sa.service_item = item.name
                      and sa.operational_status in %(open)s) as customers,
                (select count(*) from `tabMSP Service Eligibility` se
                    where se.service_item = item.name and se.is_eligible = 1
                      and se.negotiated_rate > 0) as priced_contracts
            from `tab{DEFINITION}` msp_def
            join `tabItem` item on item.name = msp_def.item
            where 1 = 1{where}
            order by coalesce(msp_def.creation, item.creation) desc
            """,
            values,
            as_dict=True,
        )

        for row in rows:
            CatalogueService._stamp_status(row)

        if status:
            rows = [row for row in rows if row["compatibility_status"] == status]

        return rows

    @staticmethod
    def _stamp_status(row):
        """The two axes, the blockers, and the name the catalogue shows this service under."""
        definition = {
            "name": row.get("definition"),
            "enabled": frappe.utils.cint(row.get("msp_enabled")),
            "service_scope": row.get("scope"),
            "invoice_label": row.get("invoice_label"),
        }
        card = {
            "disabled": row.get("disabled"),
            "is_stock_item": row.get("is_stock_item"),
            "is_sales_item": row.get("is_sales_item"),
            "month_ready": msp_items.month_is_ready(row["name"]),
        }

        row["msp_enabled"] = definition["enabled"]
        row["month_ready"] = card["month_ready"]
        row["service_name"] = (row.get("invoice_label") or "").strip() or row.get("item_name") or row["name"]
        row["blockers"] = ServiceDefinitionService.blockers(
            row["name"], definition=definition, card=card
        )
        row["compatibility_status"] = ServiceDefinitionService.compatibility(
            row["name"], definition=definition, card=card
        )
        row["ready"] = ServiceDefinitionService.is_ready(
            row["name"], definition=definition, card=card
        )
        row["msp_availability"] = (
            "Needs configuration"
            if definition["enabled"] and not row["ready"]
            else MSP_AVAILABILITY[bool(definition["enabled"])]
        )
        row["erpnext_status"] = (
            "Stock item"
            if frappe.utils.cint(row.get("is_stock_item"))
            else "Disabled"
            if frappe.utils.cint(row.get("disabled"))
            else "Enabled"
        )

        return row

    # ------------------------------------------------------------------ adopting an Item
    @staticmethod
    def search_catalogue_items(search=None, start=0, page_length=20):
        """Every Item the site holds, MSP or not, so one can be adopted deliberately.

        Disabled Items and stock Items are included on purpose: an administrator looking for a
        service has to be able to find the one that is there, and be told why it cannot be used
        as it stands.
        """
        CatalogueService._guard_admin()

        start = frappe.utils.cint(start)
        page_length = min(max(frappe.utils.cint(page_length) or 20, 1), 100)
        conditions = []
        values = {"start": start, "page_length": page_length}

        if search:
            conditions.append("(item.item_name like %(search)s or item.name like %(search)s)")
            values["search"] = f"%{search}%"

        where = (" where " + " and ".join(conditions)) if conditions else ""
        total = frappe.db.sql(f"select count(*) from `tabItem` item {where}", values)[0][0]
        rows = frappe.db.sql(
            f"""
            select item.name, item.item_name, item.item_group, item.disabled,
                   item.is_stock_item, item.is_sales_item, item.stock_uom, item.sales_uom
            from `tabItem` item
            {where}
            order by item.item_name asc
            limit %(page_length)s offset %(start)s
            """,
            values,
            as_dict=True,
        )

        definitions = ServiceDefinitionService.definitions_by_item([row.name for row in rows])

        for row in rows:
            definition = definitions.get(row.name)
            row["definition"] = definition.name if definition else None
            row["in_msp"] = bool(definition)
            row["msp_enabled"] = bool(definition and frappe.utils.cint(definition.enabled))
            row["scope"] = definition.service_scope if definition else None
            row["month_ready"] = msp_items.month_is_ready(row.name)

        return {"rows": rows, "total": total, "start": start, "page_length": page_length}

    @staticmethod
    def get_item_msp_compatibility(item=None):
        """What stands between this Item and MSP, and exactly what would have to change."""
        CatalogueService._guard_admin()

        diagnostics = ServiceDefinitionService.diagnostics(item) if item else None

        if not diagnostics:
            raise NotFoundError("This Item no longer exists in ERPNext.", "NOT_FOUND")

        card = frappe._dict(diagnostics)
        repairs = []
        warnings = []

        if frappe.utils.cint(card.disabled):
            repairs.append(
                {
                    "code": "ITEM_DISABLED",
                    "field": "enable_item",
                    "label": "Enable this Item in ERPNext",
                    "message": (
                        "This Item is disabled globally in ERPNext. "
                        "It must be enabled before it can be available in MSP."
                    ),
                }
            )

        if not frappe.utils.cint(card.is_sales_item):
            repairs.append(
                {
                    "code": "ITEM_NOT_SELLABLE",
                    "field": "allow_sales",
                    "label": "Allow this Item to be sold",
                    "message": "This Item is not marked as a sales Item.",
                }
            )

        if not card.has_month_uom:
            repairs.append(
                {
                    "code": "MSP_BILLING_UOM_MISSING",
                    "field": "add_month_uom",
                    "label": f"Add {BILLING_UOM} with conversion factor 1",
                    "message": f"{BILLING_UOM} is not configured for this Item.",
                }
            )
        elif not card.month_ready:
            repairs.append(
                {
                    "code": "MSP_BILLING_UOM_MISSING",
                    "field": "fix_month_factor",
                    "label": f"Set {BILLING_UOM} conversion factor to 1",
                    "message": (
                        f"{BILLING_UOM} currently uses conversion factor "
                        f"{card.month_conversion_factor}. MSP billing requires conversion factor 1."
                    ),
                }
            )

        if not card.site_uom_allows_halves:
            warnings.append(
                f"The site {BILLING_UOM} unit must allow halves before MSP can bill a part month."
            )

        if card.stock_uom and frappe.db.get_value("UOM", card.stock_uom, "must_be_whole_number"):
            warnings.append(
                f"This Item is stocked in {card.stock_uom}, which ERPNext only accepts in whole "
                "numbers. Whole months can be billed on it; a half month cannot."
            )

        return {
            "item": {
                "name": card.name,
                "item_name": card.item_name,
                "description": card.description,
                "item_group": card.item_group,
                "disabled": frappe.utils.cint(card.disabled),
                "is_stock_item": frappe.utils.cint(card.is_stock_item),
                "is_sales_item": frappe.utils.cint(card.is_sales_item),
                "stock_uom": card.stock_uom,
                "sales_uom": card.sales_uom,
            },
            "msp": {
                "definition": card.definition,
                "in_msp": card.in_msp,
                "enabled": card.msp_enabled,
                "scope": card.service_scope,
                "invoice_label": card.invoice_label,
            },
            "billing": {
                "required_uom": BILLING_UOM,
                "has_required_uom": card.has_month_uom,
                "conversion_factor": card.month_conversion_factor,
            },
            "compatibility_status": card.compatibility_status,
            "blockers": card.blockers,
            "repairs": repairs,
            "warnings": warnings,
            "can_enable_in_place": not frappe.utils.cint(card.is_stock_item),
            # what the screen saw, sent back when it applies changes so nothing moved meanwhile
            "fingerprint": CatalogueService._fingerprint(card),
        }

    @staticmethod
    def _fingerprint(card):
        """The Item facts a configuration decision was taken against."""
        return {
            "disabled": frappe.utils.cint(card.get("disabled")),
            "is_stock_item": frappe.utils.cint(card.get("is_stock_item")),
            "is_sales_item": frappe.utils.cint(card.get("is_sales_item")),
            "month_conversion_factor": card.get("month_conversion_factor"),
        }

    @staticmethod
    def enable_item_for_msp(
        item=None,
        scope=None,
        invoice_label=None,
        item_name=None,
        description=None,
        enable_item=0,
        allow_sales=0,
        add_month_uom=0,
        fix_month_factor=0,
        seen=None,
    ):
        """Adopt an existing Item, changing only what was explicitly consented to.

        A stock Item is never converted in place: its inventory history is the site's, and a
        service made from it is a new Item of our own. The Item is read again first: a decision
        taken against a state that has since moved is refused rather than half applied.
        """
        CatalogueService._guard_admin()

        card = msp_items.read_item(item) if item else None

        if not card:
            raise NotFoundError("This Item no longer exists in ERPNext.", "NOT_FOUND")

        CatalogueService._refuse_if_changed(card, seen)

        if frappe.utils.cint(card.is_stock_item):
            raise ValidationError(msp_items.BLOCKERS["MSP_STOCK_ITEM"], "MSP_STOCK_ITEM")

        if scope not in SCOPES:
            raise ValidationError(msp_items.BLOCKERS["INVALID_MSP_SCOPE"], "INVALID_MSP_SCOPE")

        if frappe.utils.cint(card.disabled) and not frappe.utils.cint(enable_item):
            raise ValidationError(msp_items.BLOCKERS["ITEM_DISABLED"], "ITEM_DISABLED")

        if not frappe.utils.cint(card.is_sales_item) and not frappe.utils.cint(allow_sales):
            raise ValidationError(msp_items.BLOCKERS["ITEM_NOT_SELLABLE"], "ITEM_NOT_SELLABLE")

        if not card.month_ready and not (
            frappe.utils.cint(add_month_uom) or frappe.utils.cint(fix_month_factor)
        ):
            raise ValidationError(
                msp_items.BLOCKERS["MSP_BILLING_UOM_MISSING"], "MSP_BILLING_UOM_MISSING"
            )

        savepoint = "enable_item_for_msp"
        frappe.db.savepoint(savepoint)

        try:
            doc = frappe.get_doc("Item", card.name)
            enabled_here = False

            if frappe.utils.cint(enable_item) and doc.disabled:
                doc.disabled = 0
                enabled_here = True

            if frappe.utils.cint(allow_sales):
                doc.is_sales_item = 1

            if frappe.utils.cint(add_month_uom) or frappe.utils.cint(fix_month_factor):
                CatalogueService._ensure_month_uom(doc)

            if item_name:
                doc.item_name = item_name

            if description is not None:
                doc.description = description or doc.item_name

            doc.save()

            definition = CatalogueService._write_definition(doc.name, scope, invoice_label)

            if not ServiceDefinitionService.is_ready(doc.name):
                blockers = ServiceDefinitionService.blockers(doc.name)
                code = blockers[0] if blockers else "MSP_SERVICE_UNAVAILABLE"
                raise ValidationError(msp_items.BLOCKERS.get(code, STALE_ITEM), code)

            doc.add_comment("Comment", f"Added to Nexgen MSP by {frappe.session.user}.")
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise

        frappe.db.commit()

        return {
            "name": doc.name,
            "item_name": doc.item_name,
            "definition": definition,
            "scope": scope,
            "erpnext_enabled": enabled_here,
        }

    @staticmethod
    def _refuse_if_changed(card, seen):
        """A configuration decision is applied to the Item it was taken against, or not at all."""
        seen = frappe.parse_json(seen) if isinstance(seen, str) else seen

        if not seen:
            return

        current = CatalogueService._fingerprint(card)

        for field, value in seen.items():
            if field not in current:
                continue

            if str(current[field] if current[field] is not None else "") != str(
                value if value is not None else ""
            ):
                raise ValidationError(STALE_ITEM, "ITEM_CHANGED_DURING_CONFIGURATION")

    @staticmethod
    def _write_definition(item, scope, invoice_label):
        """The MSP configuration of this Item: created the first time, corrected after."""
        name = frappe.db.get_value(DEFINITION, {"item": item}, "name")
        doc = frappe.get_doc(DEFINITION, name) if name else frappe.new_doc(DEFINITION)

        doc.item = item
        doc.service_scope = scope
        doc.invoice_label = (invoice_label or "").strip() or None
        doc.enabled = 1
        doc.save(ignore_permissions=True)

        return doc.name

    @staticmethod
    def _ensure_month_uom(doc):
        """The billing unit on this Item alone, at factor 1, leaving its own units alone."""
        for row in doc.uoms:
            if row.uom == BILLING_UOM:
                row.conversion_factor = 1

                return

        doc.append("uoms", {"uom": BILLING_UOM, "conversion_factor": 1})

    @staticmethod
    def create_msp_service(
        item_code=None, item_name=None, scope=None, invoice_label=None, description=None
    ):
        """A new non-stock Item and its MSP definition, both or neither."""
        CatalogueService._guard_admin()

        code = (item_code or "").strip().upper()

        if not code:
            raise ValidationError("A service code is required.", "VALIDATION_ERROR")

        if not (item_name or "").strip():
            raise ValidationError("A name is required.", "VALIDATION_ERROR")

        if scope not in SCOPES:
            raise ValidationError(msp_items.BLOCKERS["INVALID_MSP_SCOPE"], "INVALID_MSP_SCOPE")

        if frappe.db.exists("Item", code):
            raise ValidationError(
                f'An Item with code "{code}" already exists. Choose "Use existing Item" instead.',
                "ITEM_CODE_EXISTS",
            )

        savepoint = "create_msp_service"
        frappe.db.savepoint(savepoint)

        try:
            doc = frappe.new_doc("Item")
            doc.item_code = code
            doc.item_name = item_name.strip()
            doc.description = (description or "").strip() or doc.item_name
            doc.item_group = CatalogueService._ensure_group()
            doc.is_stock_item = 0
            doc.is_sales_item = 1
            doc.is_purchase_item = 0
            doc.disabled = 0
            doc.stock_uom = BILLING_UOM
            doc.sales_uom = BILLING_UOM
            doc.append("uoms", {"uom": BILLING_UOM, "conversion_factor": 1})
            doc.insert()

            definition = CatalogueService._write_definition(doc.name, scope, invoice_label)
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise

        frappe.db.commit()

        return {
            "name": doc.name,
            "item_name": doc.item_name,
            "definition": definition,
            "scope": scope,
        }

    # ------------------------------------------------------------------ withdrawing
    @staticmethod
    def remove_service_from_msp(item=None, mode="keep", effective_date=None, reason=None):
        """Stop offering a service. The ERPNext Item is left exactly as it is.

        What is already running is the customer's: it keeps running and keeps being billed
        unless somebody says, in as many words, to end all of it.
        """
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        CatalogueService._guard_admin()

        if not item or not frappe.db.exists("Item", item):
            raise NotFoundError("This Item no longer exists in ERPNext.", "NOT_FOUND")

        definition = ServiceDefinitionService.for_item(item)

        if not definition:
            raise NotFoundError("This service is not configured for MSP.", "NOT_FOUND")

        if mode not in ("keep", "end"):
            raise ValidationError("Say what happens to the open assignments.", "VALIDATION_ERROR")

        open_assignments = frappe.get_all(
            "MSP Service Assignment",
            filters={"service_item": item, "operational_status": ("in", OPEN_ASSIGNMENT_STATUSES)},
            pluck="name",
        )
        results = []

        if mode == "end":
            if not (reason or "").strip():
                raise ValidationError(
                    "Say why these service assignments are being ended.", "VALIDATION_ERROR"
                )

            for assignment in open_assignments:
                try:
                    ServiceLifecycleService.end(
                        assignment=assignment,
                        effective_date=effective_date,
                        notes=reason,
                    )
                    results.append({"assignment": assignment, "ok": True})
                except Exception as error:
                    results.append(
                        {"assignment": assignment, "ok": False, "message": str(error)}
                    )

        frappe.db.set_value(DEFINITION, definition.name, "enabled", 0)
        frappe.get_doc("Item", item).add_comment(
            "Comment", f"Removed from Nexgen MSP by {frappe.session.user}."
        )
        frappe.db.commit()

        return {
            "name": item,
            "definition": definition.name,
            "open_assignments": len(open_assignments),
            "ended": len([row for row in results if row["ok"]]),
            "failed": [row for row in results if not row["ok"]],
            "results": results,
        }

    @staticmethod
    def contracts_using(item):
        """The live contracts that still name this service."""
        return frappe.db.sql_list(
            """
            select distinct c.name
            from `tabMSP Contract` c
            join `tabMSP Contract Service` cs on cs.parent = c.name
            where cs.service_item = %s and c.status in ('Active', 'Suspended')
            """,
            item,
        )

    # ------------------------------------------------------------------ one service
    @staticmethod
    def get_service(name=None):
        """One service: how it is sold, who runs it, and what it earns."""
        CatalogueService._guard_admin()

        if not name:
            raise ValidationError("No service was selected.", "VALIDATION_ERROR")

        diagnostics = ServiceDefinitionService.diagnostics(name)

        if not diagnostics:
            raise NotFoundError("This Item no longer exists in ERPNext.", "NOT_FOUND")

        card = frappe._dict(diagnostics)
        doc = frappe._dict(
            {
                "name": card.name,
                "item_name": card.item_name,
                "service_name": (card.invoice_label or "").strip() or card.item_name or card.name,
                "definition": card.definition,
                "in_msp": card.in_msp,
                "invoice_label": card.invoice_label,
                "scope": card.service_scope,
                "description": card.description,
                "uom": card.stock_uom,
                "disabled": frappe.utils.cint(card.disabled),
                "msp_enabled": card.msp_enabled,
                "is_stock_item": frappe.utils.cint(card.is_stock_item),
                "is_sales_item": frappe.utils.cint(card.is_sales_item),
                "stock_uom": card.stock_uom,
                "sales_uom": card.sales_uom,
                "has_month_uom": card.has_month_uom,
                "month_conversion_factor": card.month_conversion_factor,
                "month_ready": card.month_ready,
                "billing_uom": BILLING_UOM,
                "compatibility_status": card.compatibility_status,
                "blockers": card.blockers,
                "ready": card.ready,
            }
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
