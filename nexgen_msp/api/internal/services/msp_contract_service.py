import frappe
from frappe.utils import flt, getdate

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils.errors import NotFoundError, ValidationError

EDITABLE_FIELDS = (
    "customer",
    "title",
    "status",
    "start_date",
    "end_date",
    "billing_frequency",
    "billing_timing",
    "proration_method",
    "invoice_grouping",
    "price_list",
    "price_list_valid_upto",
    "currency",
    "default_cost_center",
    "billing_notes",
)

LIVE_STATUSES = ("Active", "Suspended")


class MSPContractService:
    @staticmethod
    def _guard_admin():
        ContractService._guard_admin()

    @staticmethod
    def options(customer=None):
        MSPContractService._guard_admin()

        meta = frappe.get_meta("MSP Contract")

        def select(fieldname):
            field = meta.get_field(fieldname)
            return [value for value in (field.options or "").split("\n") if value]

        company = frappe.defaults.get_global_default("company")
        price_lists = frappe.get_all(
            "Price List", filters={"selling": 1, "enabled": 1}, pluck="name", order_by="name"
        )

        return {
            "statuses": select("status"),
            "billing_frequencies": select("billing_frequency"),
            "billing_timings": select("billing_timing"),
            "proration_methods": select("proration_method"),
            "invoice_groupings": select("invoice_grouping"),
            "price_lists": price_lists,
            "default_price_list": (
                frappe.db.get_single_value("Selling Settings", "selling_price_list")
                or (price_lists[0] if len(price_lists) == 1 else None)
            ),
            "currencies": frappe.get_all(
                "Currency", filters={"enabled": 1}, pluck="name", order_by="name"
            ),
            # what the customer is billed in comes before what the company keeps its books
            # in: a contract signed in USD must not open on the company's XAF
            "default_currency": (
                (customer and frappe.db.get_value("Customer", customer, "default_currency"))
                or frappe.db.get_value("Company", company, "default_currency")
            ),
            "services": frappe.get_all(
                "Item",
                filters={"disabled": 0, "is_stock_item": 0},
                fields=["name as value", "item_name as label"],
                order_by="item_name asc",
            ),
        }

    @staticmethod
    def list_contracts(customer=None, status=None, billable_only=0):
        """Every contract, with what it covers and whether it could be billed today."""
        MSPContractService._guard_admin()

        conditions = []
        params = {}

        if customer:
            conditions.append("c.customer = %(customer)s")
            params["customer"] = customer

        if status:
            conditions.append("c.status = %(status)s")
            params["status"] = status

        if frappe.utils.cint(billable_only):
            conditions.append("c.status = 'Active'")
            conditions.append(
                "ifnull((select cust.msp_free_of_charge from `tabCustomer` cust"
                " where cust.name = c.customer), 0) = 0"
            )

        where = (" where " + " and ".join(conditions)) if conditions else ""

        rows = frappe.db.sql(
            f"""
            select
                c.name, c.customer, c.title, c.status,
                c.start_date, c.end_date,
                c.billing_frequency, c.billing_timing, c.proration_method,
                c.invoice_grouping, c.price_list, c.price_list_valid_upto,
                c.currency, c.default_cost_center, c.billing_notes,
                (select count(*) from `tabMSP Contract Service` cs where cs.parent = c.name)
                    as service_count,
                (select count(*) from `tabMSP Billing Run` br
                    where br.contract = c.name and br.docstatus != 2) as run_count
            from `tabMSP Contract` c
            {where}
            order by c.customer asc, c.start_date desc
            """,
            params,
            as_dict=True,
        )

        for row in rows:
            row["services"] = frappe.db.sql(
                """
                select cs.service_item, coalesce(item.item_name, cs.service_item) as service_name,
                       cs.notes
                from `tabMSP Contract Service` cs
                left join `tabItem` item on item.name = cs.service_item
                where cs.parent = %(parent)s
                order by service_name asc
                """,
                {"parent": row["name"]},
                as_dict=True,
            )

        return rows

    @staticmethod
    def get_contract(name=None):
        MSPContractService._guard_admin()

        if not name or not frappe.db.exists("MSP Contract", name):
            raise NotFoundError(f"Contract {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Contract", name)

        services = []

        for row in doc.services:
            rate = ContractService.current_rate(doc.customer, row.service_item)

            services.append(
                {
                    "service_item": row.service_item,
                    "service_name": frappe.db.get_value("Item", row.service_item, "item_name")
                    or row.service_item,
                    "notes": row.notes,
                    "rate": flt(rate.price_list_rate) if rate else None,
                    "valid_from": rate.valid_from if rate else None,
                    "valid_upto": rate.valid_upto if rate else None,
                }
            )

        return {
            **{field: doc.get(field) for field in EDITABLE_FIELDS},
            "name": doc.name,
            "services": services,
            "blockers": MSPContractService._blockers(doc, services),
            "runs": frappe.get_all(
                "MSP Billing Run",
                filters={"contract": doc.name, "docstatus": ["!=", 2]},
                fields=[
                    "name",
                    "status",
                    "billing_period_start",
                    "billing_period_end",
                    "total_amount",
                    "currency",
                    "sales_invoice",
                ],
                order_by="billing_period_end desc",
            ),
        }

    @staticmethod
    def _blockers(doc, services):
        """What still stands between this contract and a billing run."""
        if frappe.db.get_value("Customer", doc.customer, "msp_free_of_charge"):
            return []

        blockers = []

        if doc.status != "Active":
            blockers.append(f"Contract is {doc.status.lower()}, not active.")

        if not services:
            blockers.append("No service is covered by this contract yet.")

        unpriced = [row["service_name"] for row in services if not row["rate"]]

        if unpriced:
            blockers.append(f"No agreed rate for {', '.join(unpriced)}.")

        if doc.price_list_valid_upto and getdate(doc.price_list_valid_upto) < getdate(
            frappe.utils.today()
        ):
            blockers.append(f"The price list expired on {doc.price_list_valid_upto}.")

        return blockers

    @staticmethod
    def save_contract(name=None, contract=None, services=None):
        """Create or update a contract. Exclusivity of services is enforced by the DocType."""
        MSPContractService._guard_admin()

        contract = frappe.parse_json(contract) if isinstance(contract, str) else (contract or {})
        services = frappe.parse_json(services) if isinstance(services, str) else services

        if name:
            if not frappe.db.exists("MSP Contract", name):
                raise NotFoundError(f"Contract {name} not found.", "NOT_FOUND")
            doc = frappe.get_doc("MSP Contract", name)
        else:
            if not contract.get("customer"):
                raise ValidationError("customer is required.", "VALIDATION_ERROR")
            doc = frappe.new_doc("MSP Contract")

        for field in EDITABLE_FIELDS:
            if field in contract:
                doc.set(field, contract[field])

        if services is not None:
            doc.services = []
            for row in services:
                item = row.get("service_item") if isinstance(row, dict) else row
                if not item:
                    continue
                doc.append("services", {"service_item": item, "notes": (row or {}).get("notes")
                                        if isinstance(row, dict) else None})

        doc.save()
        frappe.db.commit()

        return MSPContractService.get_contract(doc.name)

    @staticmethod
    def set_status(name=None, status=None):
        MSPContractService._guard_admin()

        if not name or not frappe.db.exists("MSP Contract", name):
            raise NotFoundError(f"Contract {name} not found.", "NOT_FOUND")

        allowed = frappe.get_meta("MSP Contract").get_field("status").options.split("\n")

        if status not in allowed:
            raise ValidationError(
                f"{status} is not a contract status.", "VALIDATION_ERROR"
            )

        doc = frappe.get_doc("MSP Contract", name)

        # an ended contract needs a date, or nothing says when coverage stopped
        if status == "Ended" and not doc.end_date:
            doc.end_date = frappe.utils.today()

        doc.status = status
        doc.save()
        frappe.db.commit()

        return MSPContractService.get_contract(name)
