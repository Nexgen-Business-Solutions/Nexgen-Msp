import frappe

from nexgen_msp.api.internal.services.request_service import ADMIN_ROLES
from nexgen_msp.utils.errors import NotFoundError, ValidationError

OPEN_ASSIGNMENT_STATUSES = ("Pending Setup", "Active", "Suspended", "Pending Removal")

LIVE_CONTRACT_STATUSES = ("Active", "Suspended")

PROFILE_FIELDS = (
    "contract_status",
    "contract_start_date",
    "contract_end_date",
    "billing_frequency",
    "billing_timing",
    "proration_method",
    "invoice_grouping",
    "customer_approval_required",
    "price_list",
    "price_list_valid_upto",
    "currency",
    "default_cost_center",
    "billing_notes",
)


class ContractService:
    @staticmethod
    def _price_list(customer, service_item=None):
        """The selling price list this customer is billed from.

        The live contract covering the service decides it, because that is what the
        customer actually signed. The legacy profile is only a fallback for data that
        predates contracts.
        """
        if service_item:
            covering = frappe.db.sql(
                """
                select c.price_list
                from `tabMSP Contract` c
                join `tabMSP Contract Service` cs on cs.parent = c.name
                where c.customer = %(customer)s
                  and cs.service_item = %(item)s
                  and c.status in %(live)s
                  and c.price_list is not null and c.price_list != ''
                order by c.start_date desc
                limit 1
                """,
                {"customer": customer, "item": service_item, "live": LIVE_CONTRACT_STATUSES},
                pluck=True,
            )

            if covering:
                return covering[0]

        any_contract = frappe.db.sql(
            """
            select price_list from `tabMSP Contract`
            where customer = %(customer)s and status in %(live)s
              and price_list is not null and price_list != ''
            order by start_date desc
            limit 1
            """,
            {"customer": customer, "live": LIVE_CONTRACT_STATUSES},
            pluck=True,
        )

        if any_contract:
            return any_contract[0]

        return frappe.db.get_value("MSP Customer Profile", {"customer": customer}, "price_list")

    @staticmethod
    def _currency(customer, service_item=None):
        """The currency the contract bills in, falling back to the legacy profile."""
        found = frappe.db.sql(
            """
            select c.currency
            from `tabMSP Contract` c
            left join `tabMSP Contract Service` cs on cs.parent = c.name
            where c.customer = %(customer)s and c.status in %(live)s
              and c.currency is not null and c.currency != ''
              and (%(item)s is null or cs.service_item = %(item)s)
            order by (cs.service_item = %(item)s) desc, c.start_date desc
            limit 1
            """,
            {"customer": customer, "item": service_item, "live": LIVE_CONTRACT_STATUSES},
            pluck=True,
        )

        if found:
            return found[0]

        return frappe.db.get_value("MSP Customer Profile", {"customer": customer}, "currency")

    @staticmethod
    def current_rate(customer, service_item, on_date=None):
        """The rate that applies on a given day. Dated rows in Item Price are the history."""
        price_list = ContractService._price_list(customer, service_item)

        if not price_list:
            return None

        on_date = on_date or frappe.utils.today()

        found = frappe.db.sql(
            """
            select name, price_list_rate, currency, valid_from, valid_upto
            from `tabItem Price`
            where item_code = %(item)s
              and price_list = %(price_list)s
              and selling = 1
              and (customer = %(customer)s or customer is null or customer = '')
              and (valid_from is null or valid_from <= %(on_date)s)
              and (valid_upto is null or valid_upto >= %(on_date)s)
            order by (customer = %(customer)s) desc, valid_from desc
            limit 1
            """,
            {
                "item": service_item,
                "price_list": price_list,
                "customer": customer,
                "on_date": on_date,
            },
            as_dict=True,
        )

        return found[0] if found else None

    @staticmethod
    def list_rates(customer=None, service_item=None):
        """Every rate version for this customer, newest first."""
        ContractService._guard_admin()

        price_list = ContractService._price_list(customer)

        if not price_list:
            return []

        filters = {"price_list": price_list, "customer": customer, "selling": 1}

        if service_item:
            filters["item_code"] = service_item

        rows = frappe.get_all(
            "Item Price",
            filters=filters,
            fields=[
                "name",
                "item_code",
                "item_name",
                "price_list_rate",
                "currency",
                "valid_from",
                "valid_upto",
                "note",
            ],
            order_by="item_code asc, valid_from desc",
            limit_page_length=0,
        )

        today = frappe.utils.getdate(frappe.utils.today())

        for row in rows:
            starts = frappe.utils.getdate(row.valid_from) if row.valid_from else None
            ends = frappe.utils.getdate(row.valid_upto) if row.valid_upto else None
            row["state"] = (
                "Scheduled"
                if starts and starts > today
                else "Expired"
                if ends and ends < today
                else "Active"
            )

        return rows

    @staticmethod
    def set_eligibility(customer=None, service_item=None, is_eligible=None):
        """Offer a service to this customer, or stop offering it."""
        ContractService._guard_admin()

        if not customer or not service_item:
            raise ValidationError("customer and service_item are required.", "VALIDATION_ERROR")

        name = frappe.db.get_value("MSP Customer Profile", {"customer": customer}, "name")

        if not name:
            raise ValidationError(
                f"Set up {customer}'s contract before choosing which services are offered.",
                "VALIDATION_ERROR",
            )

        wanted = frappe.utils.cint(is_eligible)
        doc = frappe.get_doc("MSP Customer Profile", name)
        row = next(
            (line for line in doc.service_eligibility if line.service_item == service_item), None
        )

        if wanted and not row:
            doc.append("service_eligibility", {"service_item": service_item, "is_eligible": 1})
        elif wanted and row:
            row.is_eligible = 1
        elif not wanted and row:
            open_count = frappe.db.count(
                "Service Assignment",
                {
                    "customer": customer,
                    "service_item": service_item,
                    "operational_status": ("in", OPEN_ASSIGNMENT_STATUSES),
                },
            )
            if open_count:
                raise ValidationError(
                    f"{open_count} assignment(s) still run this service for {customer}. "
                    "End them before withdrawing the offer.",
                    "VALIDATION_ERROR",
                )
            doc.service_eligibility.remove(row)

        doc.save()
        frappe.db.commit()

        return ContractService.get_contract(customer)

    @staticmethod
    def save_rate(
        customer=None,
        service_item=None,
        rate=None,
        valid_from=None,
        valid_upto=None,
        note=None,
        name=None,
    ):
        """Add a rate version, or correct one. Never overwrite the past."""
        ContractService._guard_admin()

        if not customer or not service_item:
            raise ValidationError("customer and service_item are required.", "VALIDATION_ERROR")

        price_list = ContractService._price_list(customer, service_item)

        if not price_list:
            raise ValidationError(
                f"Set a price list on {customer}'s contract before adding rates.",
                "VALIDATION_ERROR",
            )

        rate = frappe.utils.flt(rate)

        if rate <= 0:
            raise ValidationError("A rate must be greater than zero.", "VALIDATION_ERROR")

        if valid_from and valid_upto and frappe.utils.getdate(valid_upto) < frappe.utils.getdate(valid_from):
            raise ValidationError("The end date precedes the start date.", "VALIDATION_ERROR")

        currency = ContractService._currency(customer, service_item)

        doc = frappe.get_doc("Item Price", name) if name else frappe.new_doc("Item Price")

        doc.item_code = service_item
        doc.price_list = price_list
        doc.customer = customer
        doc.selling = 1
        doc.buying = 0
        doc.currency = currency or doc.currency
        doc.price_list_rate = rate
        doc.valid_from = valid_from or None
        doc.valid_upto = valid_upto or None
        doc.note = note or None
        doc.save()
        frappe.db.commit()

        return {"name": doc.name, "item_code": doc.item_code, "rate": doc.price_list_rate}

    @staticmethod
    def delete_rate(name=None):
        ContractService._guard_admin()

        if not name or not frappe.db.exists("Item Price", name):
            raise NotFoundError(f"Item Price {name} not found.", "NOT_FOUND")

        frappe.delete_doc("Item Price", name)
        frappe.db.commit()

        return {"deleted": name}

    @staticmethod
    def _guard_admin():
        """Billing is the administrator's job end to end — technicians never see it."""
        if not set(frappe.get_roles()).intersection(ADMIN_ROLES):
            raise ValidationError(
                "Only an MSP administrator can manage contracts and pricing.",
                "PERMISSION_DENIED",
                403,
            )

    @staticmethod
    def _select_options(doctype, fieldname):
        return [
            option
            for option in (frappe.get_meta(doctype).get_field(fieldname).options or "").split("\n")
            if option
        ]

    @staticmethod
    def get_options():
        ContractService._guard_admin()

        return {
            "contract_statuses": ContractService._select_options(
                "MSP Customer Profile", "contract_status"
            ),
            "billing_timings": ContractService._select_options(
                "MSP Customer Profile", "billing_timing"
            ),
            "proration_methods": ContractService._select_options(
                "MSP Customer Profile", "proration_method"
            ),
            "invoice_groupings": ContractService._select_options(
                "MSP Customer Profile", "invoice_grouping"
            ),
            "price_lists": frappe.get_all(
                "Price List", filters={"selling": 1, "enabled": 1}, pluck="name"
            ),
            "currencies": frappe.get_all(
                "Currency", filters={"enabled": 1}, pluck="name", order_by="name asc"
            ),
            "cost_centers": frappe.get_all(
                "Cost Center", filters={"is_group": 0}, pluck="name", order_by="name asc"
            ),
            "company": frappe.defaults.get_global_default("company"),
            "company_currency": frappe.db.get_value(
                "Company", frappe.defaults.get_global_default("company"), "default_currency"
            ),
        }

    @staticmethod
    def list_contracts():
        """One row per customer: does a contract exist, and can its services be priced?"""
        ContractService._guard_admin()

        return frappe.db.sql(
            """
            select
                c.name as customer,
                profile.name as profile,
                profile.contract_status,
                profile.contract_start_date,
                profile.contract_end_date,
                profile.proration_method,
                profile.billing_timing,
                profile.currency,
                profile.price_list_valid_upto,
                (select count(*) from `tabService Assignment` sa
                    where sa.customer = c.name and sa.billing_status = 'Billable'
                      and sa.operational_status in %(open)s) as billable_assignments,
                (select count(distinct sa.service_item) from `tabService Assignment` sa
                    where sa.customer = c.name
                      and sa.operational_status in %(open)s) as services_used,
                (select count(distinct ip.item_code) from `tabItem Price` ip
                    where ip.price_list = profile.price_list and ip.customer = c.name
                      and ip.selling = 1 and ip.price_list_rate > 0
                      and (ip.valid_upto is null or ip.valid_upto >= curdate())) as services_priced
            from `tabCustomer` c
            left join `tabMSP Customer Profile` profile on profile.customer = c.name
            order by c.name asc
            """,
            {"open": OPEN_ASSIGNMENT_STATUSES},
            as_dict=True,
        )

    @staticmethod
    def get_contract(customer=None):
        """The contract plus every service the customer actually uses, priced or not."""
        ContractService._guard_admin()

        if not customer:
            raise ValidationError("customer is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        profile_name = frappe.db.get_value("MSP Customer Profile", {"customer": customer}, "name")
        profile = None
        eligibility = {}

        if profile_name:
            doc = frappe.get_doc("MSP Customer Profile", profile_name)
            profile = {field: doc.get(field) for field in PROFILE_FIELDS}
            profile["name"] = doc.name
            eligibility = {row.service_item: row for row in doc.service_eligibility}

        usage = frappe.db.sql(
            """
            select
                sa.service_item,
                coalesce(item.item_name, sa.service_item) as service_name,
                count(*) as open_assignments,
                sum(sa.billing_status = 'Billable') as billable_assignments
            from `tabService Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            where sa.customer = %(customer)s
              and sa.operational_status in %(open)s
            group by sa.service_item, service_name
            order by open_assignments desc
            """,
            {"customer": customer, "open": OPEN_ASSIGNMENT_STATUSES},
            as_dict=True,
        )

        used_items = {row.service_item for row in usage}

        catalogue = frappe.get_all(
            "Item",
            filters={"disabled": 0, "is_stock_item": 0},
            fields=["name", "item_name"],
            order_by="item_name asc",
        )

        services = []

        for item in catalogue:
            row = eligibility.get(item.name)
            used = next((entry for entry in usage if entry.service_item == item.name), None)
            price = ContractService.current_rate(customer, item.name)

            services.append(
                {
                    "service_item": item.name,
                    "service_name": item.item_name,
                    "is_eligible": frappe.utils.cint(row.is_eligible) if row else 0,
                    "negotiated_rate": price.price_list_rate if price else None,
                    "valid_from": price.valid_from if price else None,
                    "valid_upto": price.valid_upto if price else None,
                    "rate_versions": len(ContractService.list_rates(customer, item.name)),
                    "open_assignments": used.open_assignments if used else 0,
                    "billable_assignments": frappe.utils.cint(used.billable_assignments)
                    if used
                    else 0,
                    "in_use": item.name in used_items,
                }
            )

        return {
            "customer": customer,
            "profile": profile,
            "services": services,
            "readiness": ContractService._readiness(customer, profile, services),
        }

    @staticmethod
    def _readiness(customer, profile, services):
        """What still stands between this customer and a first billing run."""
        blockers = []

        if not profile:
            blockers.append("No contract yet — create the customer profile first.")
        elif profile.get("contract_status") != "Active":
            blockers.append(
                f"Contract is {str(profile.get('contract_status') or 'unset').lower()}, not active."
            )

        billable = sum(row["billable_assignments"] for row in services)
        priced = sum(
            row["billable_assignments"]
            for row in services
            if row["is_eligible"] and (row["negotiated_rate"] or 0) > 0
        )

        unpriced = [
            row["service_name"]
            for row in services
            if row["billable_assignments"]
            and not (row["is_eligible"] and (row["negotiated_rate"] or 0) > 0)
        ]

        if unpriced:
            blockers.append("No rate set for: " + ", ".join(unpriced) + ".")

        expiry = profile.get("price_list_valid_upto") if profile else None
        if expiry and frappe.utils.getdate(expiry) < frappe.utils.getdate(frappe.utils.today()):
            blockers.append(
                f"The price list expired on {expiry}. Renew it before the next billing run."
            )

        return {
            "billable_assignments": billable,
            "priced_assignments": priced,
            "coverage": round(priced / billable * 100) if billable else 0,
            "price_list_valid_upto": profile.get("price_list_valid_upto") if profile else None,
            "blockers": blockers,
            "ready": not blockers and billable > 0,
        }

    @staticmethod
    def save_contract(customer=None, profile=None, services=None):
        """Create or update the contract and its rate grid in one call."""
        ContractService._guard_admin()

        if not customer:
            raise ValidationError("customer is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        profile = frappe.parse_json(profile) if isinstance(profile, str) else (profile or {})
        services = frappe.parse_json(services) if isinstance(services, str) else (services or [])

        existing = frappe.db.get_value("MSP Customer Profile", {"customer": customer}, "name")
        doc = (
            frappe.get_doc("MSP Customer Profile", existing)
            if existing
            else frappe.new_doc("MSP Customer Profile")
        )

        doc.customer = customer

        for field in PROFILE_FIELDS:
            if field in profile:
                doc.set(field, profile.get(field))

        if doc.price_list_valid_upto and doc.contract_start_date:
            if frappe.utils.getdate(doc.price_list_valid_upto) < frappe.utils.getdate(
                doc.contract_start_date
            ):
                raise ValidationError(
                    "The price list cannot expire before the contract starts.", "VALIDATION_ERROR"
                )

        doc.service_eligibility = []

        for row in services:
            if not frappe.utils.cint(row.get("is_eligible")):
                continue

            doc.append(
                "service_eligibility",
                {
                    "service_item": row.get("service_item"),
                    "is_eligible": 1,
                },
            )

        doc.save()
        frappe.db.commit()

        return ContractService.get_contract(customer)
