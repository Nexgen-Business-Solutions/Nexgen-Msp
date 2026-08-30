from urllib.parse import urlparse

import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils.errors import NotFoundError, ValidationError

ACTION_FIELDS = ("title", "action_type", "description", "enabled")

INVOICE_FIELDS = (
    "issuer_name",
    "issuer_address",
    "issuer_phone",
    "issuer_website",
    "bank_currency",
    "beneficiary",
    "beneficiary_bank",
    "intermediary_bank",
    "footer_note",
    "dispute_window_days",
    "payment_terms_days",
    "default_cost_center",
    "show_cost_center_on_invoice",
    "portal_url",
)

# how long a customer keeps the right to contest, when the setting has never been saved
DEFAULT_DISPUTE_WINDOW = 10

# how long they have to pay, counted from the invoice date
DEFAULT_PAYMENT_TERMS = 30


class SettingsService:
    @staticmethod
    def _guard_admin():
        ContractService._guard_admin()

    @staticmethod
    def options():
        SettingsService._guard_admin()

        field = frappe.get_meta("MSP Request Action").get_field("action_type")

        return {
            "action_types": [
                value for value in (field.options or "").split("\n") if value
            ],
        }

    @staticmethod
    def list_request_actions():
        """Every action a customer can pick from, with how often it has been used."""
        SettingsService._guard_admin()

        return frappe.db.sql(
            """
            select
                ra.name, ra.title, ra.action_type, ra.description, ra.enabled,
                (select count(*) from `tabMSP Service Request Line` srl
                    where srl.request_action = ra.name) as used
            from `tabMSP Request Action` ra
            order by ra.action_type asc, ra.title asc
            """,
            as_dict=True,
        )

    @staticmethod
    def save_request_action(name=None, action=None):
        """Create or update an action. Its type is what the engine actually carries out."""
        SettingsService._guard_admin()

        action = frappe.parse_json(action) if isinstance(action, str) else (action or {})

        title = (action.get("title") or "").strip()

        if not title:
            raise ValidationError("A title is required.", "VALIDATION_ERROR")

        allowed = SettingsService.options()["action_types"]

        if action.get("action_type") not in allowed:
            raise ValidationError(
                f"'{action.get('action_type')}' is not an action type.", "VALIDATION_ERROR"
            )

        if name:
            if not frappe.db.exists("MSP Request Action", name):
                raise NotFoundError(f"Action {name} not found.", "NOT_FOUND")
            doc = frappe.get_doc("MSP Request Action", name)
        else:
            if frappe.db.exists("MSP Request Action", title):
                raise ValidationError(
                    f"An action is already called '{title}'.", "VALIDATION_ERROR"
                )
            doc = frappe.new_doc("MSP Request Action")

        for field in ACTION_FIELDS:
            if field in action:
                doc.set(field, action[field])

        doc.title = title
        doc.save()

        # the record is named after its title, so a rename keeps the links intact
        if name and doc.name != title:
            frappe.rename_doc("MSP Request Action", doc.name, title, force=True)

        frappe.db.commit()

        return SettingsService.list_request_actions()

    @staticmethod
    def delete_request_action(name=None):
        """Remove an action nobody has used. A used one is disabled instead."""
        SettingsService._guard_admin()

        if not name or not frappe.db.exists("MSP Request Action", name):
            raise NotFoundError(f"Action {name} not found.", "NOT_FOUND")

        used = frappe.db.count("MSP Service Request Line", {"request_action": name})

        if used:
            raise ValidationError(
                f"'{name}' is on {used} request line(s). Disable it instead — deleting it "
                "would erase what those customers asked for.",
                "VALIDATION_ERROR",
            )

        frappe.delete_doc("MSP Request Action", name, ignore_permissions=True)
        frappe.db.commit()

        return SettingsService.list_request_actions()

    @staticmethod
    def get_import_mappings():
        """What the user list calls a company or a service, and what it is on this site."""
        SettingsService._guard_admin()

        doc = frappe.get_single("MSP Import Settings")

        return {
            "customers": [
                {
                    "excel_label": row.excel_label,
                    "customer_id": row.customer_id,
                    "create_as": row.create_as,
                    "department_prefix": row.department_prefix,
                    "exists": bool(frappe.db.exists("Customer", row.customer_id)),
                }
                for row in doc.customer_mappings
            ],
            "services": [
                {
                    "service_key": row.service_key,
                    "item_id": row.item_id,
                    "scope": row.scope,
                    "exists": bool(frappe.db.exists("Item", row.item_id)),
                }
                for row in doc.service_mappings
            ],
        }

    @staticmethod
    def save_import_mappings(customers=None, services=None):
        """Replace the mapping wholesale: it is a short table, edited as one."""
        SettingsService._guard_admin()

        customers = frappe.parse_json(customers) if isinstance(customers, str) else (customers or [])
        services = frappe.parse_json(services) if isinstance(services, str) else (services or [])

        seen = set()

        for row in customers:
            label = (row.get("excel_label") or "").strip()

            if not label or not (row.get("customer_id") or "").strip():
                raise ValidationError(
                    "Every company needs a label and a customer id.", "VALIDATION_ERROR"
                )

            if label.lower() in seen:
                raise ValidationError(
                    f"'{label}' is mapped twice.", "VALIDATION_ERROR"
                )

            seen.add(label.lower())

        doc = frappe.get_single("MSP Import Settings")
        doc.customer_mappings = []
        doc.service_mappings = []

        for row in customers:
            doc.append(
                "customer_mappings",
                {
                    "excel_label": (row.get("excel_label") or "").strip(),
                    "customer_id": (row.get("customer_id") or "").strip(),
                    "create_as": (row.get("create_as") or "").strip() or None,
                    "department_prefix": (row.get("department_prefix") or "").strip() or None,
                },
            )

        for row in services:
            doc.append(
                "service_mappings",
                {
                    "service_key": row.get("service_key"),
                    "item_id": (row.get("item_id") or "").strip(),
                    "scope": row.get("scope") or "User",
                },
            )

        doc.save()
        frappe.clear_cache(doctype="MSP Import Settings")
        frappe.db.commit()

        return SettingsService.get_import_mappings()

    @staticmethod
    def upload_user_list():
        """Take the user list from the browser and keep it as a private file."""
        SettingsService._guard_admin()

        uploaded = (frappe.request.files or {}).get("file") if frappe.request else None

        if not uploaded:
            raise ValidationError("No file was uploaded.", "VALIDATION_ERROR")

        name = uploaded.filename or "user-list.xlsx"

        if not name.lower().endswith((".xlsx", ".xlsm")):
            raise ValidationError("The user list must be an Excel file.", "VALIDATION_ERROR")

        doc = frappe.get_doc(
            {
                "doctype": "File",
                "file_name": name,
                "is_private": 1,
                "content": uploaded.stream.read(),
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()

        return {"file_url": doc.file_url, "file_name": doc.file_name}

    @staticmethod
    def run_user_import(file_url=None, dry_run=1):
        SettingsService._guard_admin()

        from nexgen_msp.api.excel_import.services.excel_import_service import ExcelImportService

        return ExcelImportService.import_users(file_url=file_url, dry_run=dry_run)

    @staticmethod
    def dispute_window():
        """How many days after its date an invoice can still be contested."""
        days = frappe.db.get_single_value("MSP Invoice Settings", "dispute_window_days")

        return frappe.utils.cint(days) or DEFAULT_DISPUTE_WINDOW

    @staticmethod
    def payment_terms_days():
        """How many days after its date an invoice falls due."""
        days = frappe.db.get_single_value("MSP Invoice Settings", "payment_terms_days")

        return frappe.utils.cint(days) or DEFAULT_PAYMENT_TERMS

    @staticmethod
    def get_invoice_settings():
        """What the printed invoice says about us, and where the money should be wired."""
        SettingsService._guard_admin()

        doc = frappe.get_single("MSP Invoice Settings")

        return {field: doc.get(field) for field in INVOICE_FIELDS}

    @staticmethod
    def save_invoice_settings(settings=None):
        SettingsService._guard_admin()

        settings = frappe.parse_json(settings) if isinstance(settings, str) else (settings or {})

        doc = frappe.get_single("MSP Invoice Settings")

        for field in INVOICE_FIELDS:
            if field in settings:
                doc.set(field, settings[field])

        if not (doc.issuer_name or "").strip():
            raise ValidationError(
                "The invoice needs an issuer name.", "VALIDATION_ERROR"
            )

        if doc.default_cost_center and not frappe.db.exists("Cost Center", doc.default_cost_center):
            raise ValidationError(
                f"Cost Center {doc.default_cost_center} does not exist.", "VALIDATION_ERROR"
            )

        # only the origin is kept: the paths are the application's own business
        portal = (doc.portal_url or "").strip().rstrip("/")

        if portal:
            parsed = urlparse(portal)

            if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.path:
                raise ValidationError(
                    "The portal address must be a bare origin, such as "
                    "https://portal.example.com.",
                    "VALIDATION_ERROR",
                )

        doc.portal_url = portal or None

        if doc.payment_terms_days in (None, ""):
            doc.payment_terms_days = DEFAULT_PAYMENT_TERMS
        elif frappe.utils.cint(doc.payment_terms_days) < 0:
            raise ValidationError(
                "A payment delay cannot be negative.", "VALIDATION_ERROR"
            )

        # an untouched setting falls back rather than blocking the save of everything else
        if doc.dispute_window_days in (None, ""):
            doc.dispute_window_days = DEFAULT_DISPUTE_WINDOW
        elif frappe.utils.cint(doc.dispute_window_days) < 1:
            raise ValidationError(
                "A dispute window of less than a day would leave nobody able to contest.",
                "VALIDATION_ERROR",
            )

        doc.save()
        # the print format reads the single straight from cache
        frappe.clear_cache(doctype="MSP Invoice Settings")
        frappe.db.commit()

        return SettingsService.get_invoice_settings()
