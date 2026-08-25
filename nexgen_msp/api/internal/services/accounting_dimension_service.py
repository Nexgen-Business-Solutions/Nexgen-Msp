import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils.errors import ValidationError

# Cost Center and Project ship with ERPNext; every other dimension is declared by the
# accountant and reaches the invoice as a custom field of the same name.
NATIVE_DIMENSIONS = ("cost_center", "project")

MAX_OPTIONS = 200


class AccountingDimensionService:
    @staticmethod
    def _company(company=None):
        return company or frappe.defaults.get_global_default("company")

    @staticmethod
    def _mandatory(fieldname):
        """A dimension the invoice will refuse to post without.

        The requirement lives on the line, not on the header — that is where ERPNext books
        the entry — so the item table is what decides.
        """
        for doctype in ("Sales Invoice Item", "Sales Invoice"):
            field = frappe.get_meta(doctype).get_field(fieldname)

            if field and field.reqd:
                return True

        return False

    @staticmethod
    def _options(document_type):
        if not document_type or not frappe.db.exists("DocType", document_type):
            return []

        filters = {}

        if frappe.get_meta(document_type).get_field("is_group"):
            filters["is_group"] = 0

        if frappe.get_meta(document_type).get_field("disabled"):
            filters["disabled"] = 0

        return frappe.get_all(
            document_type, filters=filters, pluck="name", order_by="name", limit=MAX_OPTIONS
        )

    @staticmethod
    def catalogue(company=None):
        """Every dimension the invoice can carry, with the values to choose from.

        The chart of accounts is not customer-facing, so this stays with the administrator
        who issues the invoices.
        """
        ContractService._guard_admin()

        company = AccountingDimensionService._company(company)
        meta = frappe.get_meta("Sales Invoice")
        entries = []

        for fieldname in NATIVE_DIMENSIONS:
            field = meta.get_field(fieldname)

            if not field:
                continue

            entries.append(
                {
                    "fieldname": fieldname,
                    "label": field.label or fieldname,
                    "document_type": field.options,
                    "mandatory": AccountingDimensionService._mandatory(fieldname),
                    "default": None,
                }
            )

        for dimension in frappe.get_all(
            "Accounting Dimension",
            filters={"disabled": 0},
            fields=["name", "label", "fieldname", "document_type"],
            order_by="label",
        ):
            if dimension.fieldname in NATIVE_DIMENSIONS or not meta.get_field(dimension.fieldname):
                continue

            detail = frappe.db.get_value(
                "Accounting Dimension Detail",
                {"parent": dimension.name, "company": company},
                ["mandatory_for_pl", "default_dimension"],
                as_dict=True,
            )

            entries.append(
                {
                    "fieldname": dimension.fieldname,
                    "label": dimension.label or dimension.name,
                    "document_type": dimension.document_type,
                    # a sale lands in the profit and loss, so that is the flag that binds
                    "mandatory": bool(detail and detail.mandatory_for_pl)
                    or AccountingDimensionService._mandatory(dimension.fieldname),
                    "default": detail.default_dimension if detail else None,
                }
            )

        for entry in entries:
            entry["options"] = AccountingDimensionService._options(entry["document_type"])

        # an optional dimension with nothing to pick would only be an empty box
        return [entry for entry in entries if entry["mandatory"] or entry["options"]]

    @staticmethod
    def _configured_defaults():
        """What Settings says the invoice should carry, chosen once rather than per run."""
        settings = frappe.db.get_value(
            "MSP Invoice Settings", "MSP Invoice Settings", ["default_cost_center"], as_dict=True
        )

        if not settings or not settings.default_cost_center:
            return {}

        return {"cost_center": settings.default_cost_center}

    @staticmethod
    def resolve(values=None, company=None):
        """Turn the configured accounting settings into the values the invoice will carry.

        Everything is checked before a single document is written, so a missing dimension
        stops the run rather than leaving a half-made order behind.
        """
        values = frappe.parse_json(values) if isinstance(values, str) else (values or {})
        values = {**AccountingDimensionService._configured_defaults(), **{
            key: value for key, value in values.items() if value
        }}
        resolved = {}
        missing = []

        for entry in AccountingDimensionService.catalogue(company):
            value = (values.get(entry["fieldname"]) or entry["default"] or "").strip()

            if not value:
                if entry["mandatory"]:
                    missing.append(entry["label"])
                continue

            if entry["document_type"] and not frappe.db.exists(entry["document_type"], value):
                raise ValidationError(
                    f"{entry['label']} {value} does not exist.", "VALIDATION_ERROR"
                )

            resolved[entry["fieldname"]] = value

        if missing:
            raise ValidationError(
                "The invoice cannot be posted without "
                + ", ".join(missing)
                + ". Set it in Settings → Invoice, under Accounting.",
                "VALIDATION_ERROR",
            )

        return resolved

    @staticmethod
    def stamp(doc, values):
        """Carry the values onto the document and every one of its lines.

        The header alone would not do: ERPNext books the ledger entry off the line, which
        is why the accountant sees the same value in both places.
        """
        if not values:
            return doc

        for fieldname, value in values.items():
            if doc.meta.get_field(fieldname):
                doc.set(fieldname, value)

            for row in doc.get("items") or []:
                if row.meta.get_field(fieldname):
                    row.set(fieldname, value)

        return doc

    @staticmethod
    def _root_cost_center(company):
        """The group every cost center hangs from, so creating one asks for no parent."""
        root = frappe.db.get_value(
            "Cost Center",
            {"company": company, "is_group": 1, "parent_cost_center": ("in", ("", None))},
            "name",
        )

        if not root:
            raise ValidationError(
                f"{company} has no root cost center to attach to.", "VALIDATION_ERROR"
            )

        return root

    @staticmethod
    def create_cost_center(cost_center_name=None, company=None):
        """Open a cost center from the app, under the company's own root."""
        ContractService._guard_admin()

        company = AccountingDimensionService._company(company)
        cost_center_name = (cost_center_name or "").strip()

        if not cost_center_name:
            raise ValidationError("A cost center needs a name.", "VALIDATION_ERROR")

        existing = frappe.db.get_value(
            "Cost Center", {"company": company, "cost_center_name": cost_center_name}, "name"
        )

        if existing:
            raise ValidationError(
                f"{cost_center_name} already exists as {existing}.", "VALIDATION_ERROR"
            )

        doc = frappe.get_doc(
            {
                "doctype": "Cost Center",
                "cost_center_name": cost_center_name,
                "company": company,
                "is_group": 0,
                "parent_cost_center": AccountingDimensionService._root_cost_center(company),
            }
        ).insert()

        frappe.db.commit()

        return {"name": doc.name, "cost_center_name": doc.cost_center_name}

    @staticmethod
    def on(doc, catalogue=None):
        """What a document actually carries, read back from the fields themselves.

        Works for the invoice and for one of its lines: they are separate fields at two
        levels, and this reports whichever level it is handed rather than assuming the two
        agree.
        """
        entries = catalogue if catalogue is not None else AccountingDimensionService.catalogue()

        return [
            {
                "fieldname": entry["fieldname"],
                "label": entry["label"],
                "value": doc.get(entry["fieldname"]),
            }
            for entry in entries
            if doc.meta.get_field(entry["fieldname"]) and doc.get(entry["fieldname"])
        ]
