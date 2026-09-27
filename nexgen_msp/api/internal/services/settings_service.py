from urllib.parse import urlparse

import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils.errors import ValidationError

PORTAL_FIELDS = ("portal_url", "customer_session_timeout")

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
    def run_user_import(file_url=None, dry_run=1, fill_blanks_only=1):
        SettingsService._guard_admin()

        from nexgen_msp.api.excel_import.services.excel_import_service import ExcelImportService

        return ExcelImportService.import_users(
            file_url=file_url, dry_run=dry_run, fill_blanks_only=fill_blanks_only
        )

    @staticmethod
    def describe_asset_file(file_url=None):
        SettingsService._guard_admin()

        from nexgen_msp.api.excel_import.services.asset_import_service import AssetImportService

        return AssetImportService.describe(file_url=file_url)

    @staticmethod
    def run_asset_import(file_url=None, dry_run=1, fill_blanks_only=1):
        SettingsService._guard_admin()

        from nexgen_msp.api.excel_import.services.asset_import_service import AssetImportService

        return AssetImportService.import_assets(
            file_url=file_url, dry_run=dry_run, fill_blanks_only=fill_blanks_only
        )

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
    def get_portal_settings():
        """What customer accounts are given, and the choices on offer."""
        from nexgen_msp.utils.session_timeout import TIMEOUTS

        SettingsService._guard_admin()

        doc = frappe.get_single("MSP Portal Settings")

        return {
            **{field: doc.get(field) or "" for field in PORTAL_FIELDS},
            "timeout_options": list(TIMEOUTS),
        }

    @staticmethod
    def save_portal_settings(settings=None):
        from nexgen_msp.utils.session_timeout import TIMEOUTS

        SettingsService._guard_admin()

        settings = frappe.parse_json(settings) if isinstance(settings, str) else (settings or {})
        doc = frappe.get_single("MSP Portal Settings")

        if "portal_url" in settings:
            # only the origin is kept: the paths are the application's own business
            portal = (settings["portal_url"] or "").strip().rstrip("/")

            if portal:
                parsed = urlparse(portal)

                if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.path:
                    raise ValidationError(
                        "The portal address must be a bare origin, such as "
                        "https://portal.example.com.",
                        "VALIDATION_ERROR",
                    )

            doc.portal_url = portal or None

        if "customer_session_timeout" in settings:
            choice = settings["customer_session_timeout"] or ""

            if choice and choice not in TIMEOUTS:
                raise ValidationError(
                    f"'{choice}' is not one of the offered session timeouts.", "VALIDATION_ERROR"
                )

            doc.customer_session_timeout = choice

        doc.save(ignore_permissions=True)
        frappe.db.commit()

        # the sessions already open follow the new limit at once, not at their next login
        from nexgen_msp.utils.session_timeout import refresh_live_sessions

        refresh_live_sessions()

        return SettingsService.get_portal_settings()

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
