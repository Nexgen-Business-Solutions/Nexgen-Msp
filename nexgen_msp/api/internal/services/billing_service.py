import calendar
import datetime

import frappe
from frappe.utils import add_days, flt, getdate

from nexgen_msp.api.internal.services.accounting_dimension_service import (
    AccountingDimensionService,
)
from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils.catalogue import BILLING_UOM
from nexgen_msp.utils.errors import NotFoundError, ValidationError

OPEN_ASSIGNMENT_STATUSES = ("Pending Setup", "Active", "Suspended", "Pending Removal", "Ended")

BILLABLE_OPERATIONAL = ("Pending Setup", "Active", "Pending Removal", "Ended")

LIVE_CONTRACT_STATUSES = ("Active", "Suspended")

MONTHS_PER_PERIOD = {"Monthly": 1, "Quarterly": 3, "Annually": 12}

# the invoiced quantity is a number of months, and half months are routine

DISPLAY_ONLY = (
    "service_name",
    "user_name",
    "email",
    "hostname",
    "department",
    "user_status",
    "device_type",
    "billed_to",
    "operational_status",
    "effective_start_date",
    "effective_end_date",
    "last_billed_on",
)

RUN_STATUSES = (
    "Draft",
    "Validating",
    "Exception",
    "Ready for Approval",
    "Approved",
    "Invoice Drafted",
    "Invoiced",
    "Cancelled",
)


class BillingService:
    @staticmethod
    def _guard_admin():
        ContractService._guard_admin()

    @staticmethod
    def _period_days(period_start, period_end):
        return (getdate(period_end) - getdate(period_start)).days + 1

    @staticmethod
    def _billable_days(assignment, period_start, period_end):
        """Days the service was actually live inside the billing period, both ends included."""
        start = getdate(assignment.effective_start_date)
        end = getdate(assignment.effective_end_date) if assignment.effective_end_date else None

        window_start = max(start, getdate(period_start))
        window_end = min(end, getdate(period_end)) if end else getdate(period_end)

        if window_end < window_start:
            return 0

        return (window_end - window_start).days + 1

    @staticmethod
    def _calendar_months(period_start, period_end):
        """Every calendar month the period touches, clipped to the period at both ends."""
        start = getdate(period_start)
        end = getdate(period_end)
        months = []

        cursor = datetime.date(start.year, start.month, 1)

        while cursor <= end:
            last = datetime.date(
                cursor.year, cursor.month, calendar.monthrange(cursor.year, cursor.month)[1]
            )
            months.append((max(cursor, start), min(last, end), last.day))

            cursor = datetime.date(cursor.year + (cursor.month == 12), cursor.month % 12 + 1, 1)

        return months

    @staticmethod
    def _round_half_month(months, live_days):
        """Bill in half-month steps, and never give away a service that really did run."""
        rounded = round(months * 2.0) / 2.0

        if not rounded and live_days:
            return 0.5

        return rounded

    @staticmethod
    def _billable_months(method, assignment, period_start, period_end):
        """How many monthly instalments the assignment earns inside the period.

        This is the quantity that reaches the invoice: a monthly rate multiplied by a
        number of months, which is how the printed invoice has always read.
        """
        start = getdate(assignment.effective_start_date)
        end = getdate(assignment.effective_end_date) if assignment.effective_end_date else None

        months = 0.0
        live_days = 0

        for window_start, window_end, days_in_month in BillingService._calendar_months(
            period_start, period_end
        ):
            live_start = max(start, window_start)
            live_end = min(end, window_end) if end else window_end

            if live_end < live_start:
                continue

            days = (live_end - live_start).days + 1
            live_days += days

            if method == "Daily Actual Days":
                months += days / days_in_month
            elif method == "30-Day Convention":
                months += days / 30.0
            elif method == "Start Next Month":
                months += 0.0 if start >= window_start and start <= window_end else 1.0
            else:
                months += 1.0

        return BillingService._round_half_month(months, live_days), live_days

    @staticmethod
    def _covered_window(assignment, period_start, period_end):
        """The stretch of the period the line was actually live for."""
        start = getdate(assignment.effective_start_date)
        end = getdate(assignment.effective_end_date) if assignment.effective_end_date else None

        covered_from = max(start, getdate(period_start))
        covered_to = min(end, getdate(period_end)) if end else getdate(period_end)

        if covered_to < covered_from:
            return None, None

        return covered_from, covered_to

    @staticmethod
    def _rate_for(customer, assignment, terms, period_start, period_end):
        """Resolve the unit rate and the discount that travels with it.

        Returns rate, source, exception code, exception detail, discount percent.
        """
        source = assignment.price_source or "Contract"

        if source == "Manual Override":
            if not assignment.rate_override_reason:
                return None, source, "Unapproved Override", "Manual override without a reason.", 0.0
            if assignment.agreed_rate is None:
                return None, source, "Missing Rate", "Manual override with no agreed rate.", 0.0
            return flt(assignment.agreed_rate), source, None, None, 0.0

        if source == "Contract":
            # the price in force is the price applied, whatever period is being billed;
            # the dated history only steps in when nothing is in force today
            price = ContractService.current_rate(customer, assignment.service_item)

            if not price or not flt(price.price_list_rate):
                price = ContractService.current_rate(
                    customer, assignment.service_item, period_start
                )

            if not price or not flt(price.price_list_rate):
                return (
                    None,
                    source,
                    "Missing Rate",
                    f"No rate is in force for {assignment.service_item}, and none covers "
                    f"{period_start} either.",
                    0.0,
                )

            return (
                flt(price.price_list_rate),
                source,
                None,
                None,
                flt(price.msp_discount_percent),
            )

        price = frappe.db.get_value(
            "Item Price",
            {
                "item_code": assignment.service_item,
                "price_list": terms.get("price_list"),
                "selling": 1,
            },
            "price_list_rate",
        )

        if not price:
            return (
                None,
                source,
                "Missing Rate",
                f"No Item Price for {assignment.service_item} on {terms.get('price_list')}.",
                0.0,
            )

        return flt(price), source, None, None, 0.0

    @staticmethod
    def _terms(contract, period_start, period_end):
        """The contract that governs this run, refusing to bill on terms that do not hold."""
        if not contract:
            raise ValidationError("contract is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Contract", contract):
            raise NotFoundError(f"Contract {contract} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Contract", contract)

        if frappe.db.get_value("Customer", doc.customer, "msp_free_of_charge"):
            raise ValidationError(
                f"{doc.customer} is served free of charge and is never billed.",
                "VALIDATION_ERROR",
            )

        if doc.status != "Active":
            raise ValidationError(
                f"Contract {doc.name} is {doc.status.lower()}, not active.", "VALIDATION_ERROR"
            )

        # nothing outside the contract's own window may be billed under it
        covered_to = f"{doc.end_date}" if doc.end_date else "open-ended"

        if getdate(period_start) < getdate(doc.start_date):
            raise ValidationError(
                f"Contract {doc.name} does not cover this period: it runs from "
                f"{doc.start_date} to {covered_to}, and the period opens on {period_start}.",
                "VALIDATION_ERROR",
            )

        if doc.end_date and getdate(period_end) > getdate(doc.end_date):
            raise ValidationError(
                f"Contract {doc.name} does not cover this period: it ends on {doc.end_date}, "
                f"and the period runs to {period_end}.",
                "VALIDATION_ERROR",
            )

        if doc.price_list_valid_upto and getdate(doc.price_list_valid_upto) < getdate(period_end):
            raise ValidationError(
                f"The price list on {doc.name} is only valid until {doc.price_list_valid_upto}, "
                "which does not cover this period. Set a new price list before billing.",
                "VALIDATION_ERROR",
            )

        services = [row.service_item for row in doc.services]

        if not services:
            raise ValidationError(
                f"Contract {doc.name} covers no service yet.", "VALIDATION_ERROR"
            )

        return {
            "name": doc.name,
            "title": doc.title,
            "customer": doc.customer,
            "services": services,
            "currency": doc.currency,
            "price_list": doc.price_list,
            "proration_method": doc.proration_method or "None",
            "billing_frequency": doc.billing_frequency or "Monthly",
            "invoice_grouping": doc.invoice_grouping,
            "default_cost_center": doc.default_cost_center,
        }

    @staticmethod
    def _already_invoiced(assignment_name, period_start, period_end, exclude_run=None):
        """A run this line already sits on for an overlapping period, frozen or still open.

        Open drafts count: a customer can be billed in several passes — some people now,
        the rest later — and the only thing that must never happen is the same person
        landing on two runs for the same stretch.
        """
        found = frappe.db.sql(
            """
            select br.name
            from `tabBilling Run Line` brl
            join `tabBilling Run` br on br.name = brl.parent
            where brl.service_assignment = %(assignment)s
              and br.docstatus < 2
              and br.status not in ('Cancelled')
              and (br.credit_note_of is null or br.credit_note_of = '')
              and br.billing_period_start <= %(period_end)s
              and br.billing_period_end >= %(period_start)s
              and br.name != %(exclude)s
            limit 1
            """,
            {
                "assignment": assignment_name,
                "period_start": period_start,
                "period_end": period_end,
                "exclude": exclude_run or "",
            },
        )
        return found[0][0] if found else None

    @staticmethod
    def period_status(contract=None, period_start=None, period_end=None):
        """Whether this period is already covered, asked before anything is generated.

        Cheaper than a preview: it only counts what the contract covers against what has
        already been billed for an overlapping stretch, so the answer can be shown while
        the period is still being typed.
        """
        BillingService._guard_admin()

        if not (contract and period_start and period_end):
            raise ValidationError(
                "contract, period_start and period_end are required.", "VALIDATION_ERROR"
            )

        terms = BillingService._terms(contract, period_start, period_end)

        rows = frappe.db.sql(
            """
            select
                sa.name,
                (select br.name
                    from `tabBilling Run Line` brl
                    join `tabBilling Run` br on br.name = brl.parent
                    where brl.service_assignment = sa.name
                      and br.docstatus < 2
                      and br.status not in ('Cancelled')
                      and (br.credit_note_of is null or br.credit_note_of = '')
                      and br.billing_period_start <= %(period_end)s
                      and br.billing_period_end >= %(period_start)s
                    limit 1) as billed_on
            from `tabService Assignment` sa
            where sa.customer = %(customer)s
              and sa.service_item in %(services)s
              and sa.billing_status in ('Billable', 'Ended')
              and sa.operational_status in %(operational)s
              and sa.effective_start_date is not null
              and sa.effective_start_date <= %(period_end)s
              and (sa.effective_end_date is null or sa.effective_end_date >= %(period_start)s)
            """,
            {
                "customer": terms["customer"],
                "services": terms["services"],
                "operational": BILLABLE_OPERATIONAL,
                "period_start": period_start,
                "period_end": period_end,
            },
            as_dict=True,
        )

        covered = [row for row in rows if row.billed_on]
        runs = sorted({row.billed_on for row in covered})

        return {
            "customer": terms["customer"],
            "eligible": len(rows),
            "already_billed": len(covered),
            "remaining": len(rows) - len(covered),
            "fully_billed": bool(rows) and len(covered) == len(rows),
            "runs": runs,
        }

    @staticmethod
    def build_lines(contract, period_start, period_end, exclude_run=None, run_discount=0):
        """Every assignment the contract covers over the period, priced or flagged with why not."""
        terms = BillingService._terms(contract, period_start, period_end)
        customer = terms["customer"]
        run_discount = flt(run_discount)

        assignments = frappe.db.sql(
            """
            select
                sa.name, sa.service_item, sa.assignment_scope, sa.client_user, sa.managed_device,
                sa.quantity, sa.operational_status, sa.billing_status,
                sa.effective_start_date, sa.effective_end_date,
                sa.price_source, sa.agreed_rate, sa.rate_override_reason,
                sa.internal_notes as line_comment,
                coalesce(cu.name, dcu.name) as holder,
                coalesce(cu.full_name, dcu.full_name) as user_name,
                coalesce(cu.email, dcu.email) as email,
                coalesce(cu.department, dcu.department) as department,
                coalesce(cu.lifecycle_status, dcu.lifecycle_status) as user_status,
                coalesce(device.hostname, owned.hostname) as hostname,
                coalesce(device.device_type, owned.device_type) as device_type,
                coalesce(item.item_name, sa.service_item) as service_name,
                (
                    select max(br.billing_period_end)
                    from `tabBilling Run Line` brl
                    join `tabBilling Run` br on br.name = brl.parent
                    where brl.service_assignment = sa.name and br.docstatus = 1
                ) as last_billed_on
            from `tabService Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            left join `tabClient User` cu on cu.name = sa.client_user
            left join `tabManaged Device` device on device.name = sa.managed_device
            left join `tabClient User` dcu on dcu.name = device.assigned_client_user
            left join `tabManaged Device` owned
                on owned.assigned_client_user = sa.client_user and owned.status = 'Active'
            where sa.customer = %(customer)s
              and sa.service_item in %(services)s
              and sa.billing_status in ('Billable', 'Ended')
              and sa.operational_status in %(operational)s
              and sa.effective_start_date is not null
              and sa.effective_start_date <= %(period_end)s
              and (sa.effective_end_date is null or sa.effective_end_date >= %(period_start)s)
            group by sa.name
            order by sa.service_item asc, sa.name asc
            """,
            {
                "customer": customer,
                "services": terms["services"],
                "operational": BILLABLE_OPERATIONAL,
                "period_start": period_start,
                "period_end": period_end,
            },
            as_dict=True,
        )

        method = terms["proration_method"]
        period_days = BillingService._period_days(period_start, period_end)
        lines = []

        for assignment in assignments:
            exception_code = None
            exception_detail = None

            if assignment.effective_end_date and getdate(assignment.effective_end_date) < getdate(
                assignment.effective_start_date
            ):
                exception_code = "Invalid Dates"
                exception_detail = "End date precedes start date."

            quantity = flt(assignment.quantity or 0)
            if not exception_code and quantity <= 0:
                exception_code = "Negative Quantity"
                exception_detail = f"Quantity is {quantity}."

            invoiced_in = BillingService._already_invoiced(
                assignment.name, period_start, period_end, exclude_run
            )
            if not exception_code and invoiced_in:
                exception_code = "Already Invoiced"
                exception_detail = f"Already billed on {invoiced_in} for an overlapping period."

            rate, source, rate_exception, rate_detail, rate_discount = BillingService._rate_for(
                customer, assignment, terms, period_start, period_end
            )

            if not exception_code and rate_exception:
                exception_code = rate_exception
                exception_detail = rate_detail

            months, billable_days = BillingService._billable_months(
                method, assignment, period_start, period_end
            )

            # a discount carried by the rate applies as long as that rate does, and the
            # run's own discount comes on top of it — the two are granted for different
            # reasons, so they add up rather than one replacing the other
            rate_discount = flt(rate_discount)
            run_discount = flt(run_discount)
            discount = min(rate_discount + run_discount, 100.0)

            if rate_discount and run_discount:
                discount_source = "Rate + Run"
            elif rate_discount:
                discount_source = "Rate"
            elif run_discount:
                discount_source = "Run"
            else:
                discount_source = None

            gross = 0.0 if exception_code else flt(rate) * quantity * months
            amount = gross * (1 - flt(discount) / 100.0)

            # the days the line was actually live inside the period, so the duration on the
            # invoice can be read back and not only its month count
            covered_from, covered_to = BillingService._covered_window(
                assignment, period_start, period_end
            )

            lines.append(
                {
                    "service_assignment": assignment.name,
                    "service_item": assignment.service_item,
                    "service_name": assignment.service_name,
                    "user_name": assignment.user_name,
                    "email": assignment.email,
                    "hostname": assignment.hostname,
                    "department": assignment.department,
                    "user_status": assignment.user_status,
                    "device_type": assignment.device_type,
                    "billed_to": assignment.assignment_scope,
                    "operational_status": assignment.operational_status,
                    "effective_start_date": assignment.effective_start_date,
                    "effective_end_date": assignment.effective_end_date,
                    "last_billed_on": assignment.last_billed_on,
                    "assignment_scope": assignment.assignment_scope,
                    "client_user": assignment.client_user,
                    "managed_device": assignment.managed_device,
                    "quantity": quantity,
                    "billable_days": billable_days,
                    "period_days": period_days,
                    "covered_from": covered_from,
                    "covered_to": covered_to,
                    "billable_months": flt(months, 2),
                    "gross_amount": flt(gross, 2),
                    "discount_percent": flt(discount, 2),
                    "discount_source": discount_source,
                    "unit_rate": rate,
                    "price_source": source,
                    "proration_method": method,
                    "amount": flt(amount, 2),
                    "exception_code": exception_code,
                    "exception_detail": exception_detail,
                    "line_comment": assignment.line_comment,
                }
            )

        return lines, terms

    @staticmethod
    def _matches(line, filters):
        """A filter that cannot apply to a line excludes it, rather than silently passing it."""
        if not filters:
            return True

        def wanted(key):
            value = filters.get(key)
            if value in (None, "", []):
                return None
            return value if isinstance(value, list) else [value]

        checks = (
            ("statuses", "operational_status"),
            ("billed_to", "billed_to"),
            ("services", "service_item"),
            ("device_types", "device_type"),
            ("departments", "department"),
            ("user_statuses", "user_status"),
        )

        for key, field in checks:
            allowed = wanted(key)
            if allowed and line.get(field) not in allowed:
                return False

        started = line.get("effective_start_date")

        if filters.get("started_after"):
            if not started or getdate(started) < getdate(filters["started_after"]):
                return False

        if filters.get("started_before"):
            if not started or getdate(started) > getdate(filters["started_before"]):
                return False

        # a line never billed cannot sit inside a "last billed between" window
        billed = line.get("last_billed_on")

        if filters.get("last_billed_after"):
            if not billed or getdate(billed) < getdate(filters["last_billed_after"]):
                return False

        if filters.get("last_billed_before"):
            if not billed or getdate(billed) > getdate(filters["last_billed_before"]):
                return False

        if frappe.utils.cint(filters.get("only_billable")) and line.get("exception_code"):
            return False

        search = (filters.get("search") or "").strip().lower()

        if search:
            haystack = " ".join(
                str(line.get(field) or "")
                for field in ("user_name", "service_name", "hostname", "department")
            ).lower()
            if search not in haystack:
                return False

        return True

    @staticmethod
    def filter_options(customer=None):
        """The axes a billing run can be narrowed on, for this customer."""
        BillingService._guard_admin()

        customer = customer or ""

        return {
            "statuses": list(BILLABLE_OPERATIONAL),
            # only the axes that actually exist here — a customer whose services are all
            # billed to people has nothing to choose between
            "billed_to": frappe.db.sql_list(
                """
                select distinct assignment_scope from `tabService Assignment`
                where customer = %(customer)s and assignment_scope is not null
                  and assignment_scope != ''
                order by assignment_scope asc
                """,
                {"customer": customer},
            ),
            "user_statuses": ["Pending", "Active", "Disabled", "Archived"],
            "services": frappe.db.sql(
                """
                select distinct sa.service_item as value,
                       coalesce(item.item_name, sa.service_item) as label
                from `tabService Assignment` sa
                left join `tabItem` item on item.name = sa.service_item
                where sa.customer = %(customer)s
                order by label asc
                """,
                {"customer": customer},
                as_dict=True,
            ),
            "device_types": frappe.db.sql_list(
                """
                select distinct device_type from `tabManaged Device`
                where customer = %(customer)s and device_type is not null and device_type != ''
                order by device_type asc
                """,
                {"customer": customer},
            ),
            "departments": frappe.db.sql_list(
                """
                select distinct department from `tabClient User`
                where customer = %(customer)s and department is not null and department != ''
                order by department asc
                """,
                {"customer": customer},
            ),
        }

    @staticmethod
    def preview(
        contract=None,
        period_start=None,
        period_end=None,
        adjustment_of=None,
        filters=None,
        discount_percent=0,
    ):
        """What a run would produce, without writing anything."""
        BillingService._guard_admin()

        if not contract or not period_start or not period_end:
            raise ValidationError(
                "contract, period_start and period_end are required.", "VALIDATION_ERROR"
            )

        lines, terms = BillingService.build_lines(
            contract, period_start, period_end, run_discount=discount_percent
        )

        filters = frappe.parse_json(filters) if isinstance(filters, str) else filters
        total_before = len(lines)
        lines = [line for line in lines if BillingService._matches(line, filters)]

        return {
            "contract": terms["name"],
            "contract_title": terms["title"],
            "customer": terms["customer"],
            "matched": len(lines),
            "available": total_before,
            "period_start": period_start,
            "period_end": period_end,
            "currency": terms["currency"],
            "proration_method": terms["proration_method"],
            "billing_frequency": terms["billing_frequency"],
            "lines": lines,
            **BillingService._totals(lines),
        }

    @staticmethod
    def _totals(lines):
        billable = [line for line in lines if not line["exception_code"]]
        exceptions = {}

        for line in lines:
            if line["exception_code"]:
                exceptions[line["exception_code"]] = exceptions.get(line["exception_code"], 0) + 1

        return {
            "line_count": len(lines),
            "billable_count": len(billable),
            "exception_count": len(lines) - len(billable),
            "exceptions_by_code": exceptions,
            "total_amount": flt(sum(line["amount"] for line in billable), 2),
            "total_months": flt(sum(line["billable_months"] for line in billable), 2),
        }

    @staticmethod
    def generate(
        contract=None,
        period_start=None,
        period_end=None,
        adjustment_of=None,
        include=None,
        discount_percent=0,
    ):
        """Create the run and freeze its draft lines, optionally narrowed to a chosen selection."""
        BillingService._guard_admin()

        if not contract or not period_start or not period_end:
            raise ValidationError(
                "contract, period_start and period_end are required.", "VALIDATION_ERROR"
            )

        lines, terms = BillingService.build_lines(
            contract, period_start, period_end, run_discount=discount_percent
        )

        include = frappe.parse_json(include) if isinstance(include, str) else include

        if include:
            wanted = set(include)
            lines = [line for line in lines if line["service_assignment"] in wanted]

            if not lines:
                raise ValidationError(
                    "None of the selected assignments falls inside this period.",
                    "VALIDATION_ERROR",
                )

        if not lines:
            raise ValidationError(
                "No assignment falls inside this period — nothing to bill.", "VALIDATION_ERROR"
            )

        doc = frappe.get_doc(
            {
                "doctype": "Billing Run",
                "customer": terms["customer"],
                "contract": terms["name"],
                "billing_period_start": period_start,
                "billing_period_end": period_end,
                "cutoff_datetime": frappe.utils.now(),
                "currency": terms["currency"],
                "discount_percent": flt(discount_percent),
                "status": "Validating",
                "adjustment_of": adjustment_of or None,
                "generation_version": "1",
                "lines": [
                    {k: v for k, v in line.items() if k not in DISPLAY_ONLY} for line in lines
                ],
            }
        ).insert()

        doc.status = "Exception" if doc.exception_count else "Ready for Approval"
        doc.save()
        frappe.db.commit()

        return BillingService.get_run(doc.name)

    @staticmethod
    def revalidate(name=None):
        """Rebuild the lines of a draft run after the underlying data was fixed."""
        BillingService._guard_admin()

        doc = BillingService._open_run(name)

        lines, terms = BillingService.build_lines(
            doc.contract,
            doc.billing_period_start,
            doc.billing_period_end,
            exclude_run=doc.name,
            run_discount=doc.discount_percent,
        )

        doc.lines = []
        for line in lines:
            doc.append("lines", {k: v for k, v in line.items() if k not in DISPLAY_ONLY})

        doc.currency = terms["currency"]
        doc.status = "Exception" if any(line["exception_code"] for line in lines) else "Ready for Approval"
        doc.save()
        frappe.db.commit()

        return BillingService.get_run(doc.name)

    @staticmethod
    def set_line_discount(name=None, service_assignment=None, discount_percent=0):
        """Take something off one person or one machine, inside a run not yet frozen.

        Approving a run freezes its figures, so a discount belongs before that — afterwards
        the way back is a credit note.
        """
        BillingService._guard_admin()

        doc = BillingService._open_run(name)

        discount = flt(discount_percent)

        if discount < 0 or discount > 100:
            raise ValidationError(
                "A discount runs from 0 to 100 percent.", "VALIDATION_ERROR"
            )

        row = next(
            (line for line in doc.lines if line.service_assignment == service_assignment), None
        )

        if not row:
            raise NotFoundError(
                f"{service_assignment} is not on this run.", "NOT_FOUND"
            )

        row.discount_percent = discount
        row.discount_source = "Manual" if discount else None
        row.amount = flt(flt(row.gross_amount) * (1 - discount / 100.0), 2)

        doc.save()
        frappe.db.commit()

        return BillingService.get_run(doc.name)

    @staticmethod
    def _open_run(name):
        if not name:
            raise ValidationError("name is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("Billing Run", name):
            raise NotFoundError(f"Billing Run {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("Billing Run", name)

        if doc.docstatus != 0:
            raise ValidationError(
                f"Billing Run {name} is {doc.status.lower()} and can no longer be changed.",
                "INVALID_TRANSITION",
            )

        return doc

    @staticmethod
    def approve(name=None):
        """Freeze the run. Its numbers stop depending on the operational data."""
        BillingService._guard_admin()

        doc = BillingService._open_run(name)
        doc.submit()
        frappe.db.commit()

        return BillingService.get_run(name)

    @staticmethod
    def finalise(name=None, dimensions=None):
        """Freeze the run and draw its invoice in one go.

        Between the two there is nothing left to decide: freezing is what forbids changing
        the lines, so the confirmation in the middle only ever asked again about numbers
        already reviewed. They are joined here, and joined atomically — if ERPNext refuses
        the invoice, the run is not left frozen with nothing to show for it.
        """
        BillingService._guard_admin()

        # settled before anything is written, so a missing dimension never freezes a run
        AccountingDimensionService.resolve(dimensions)

        doc = BillingService._open_run(name)
        savepoint = "msp_finalise"
        frappe.db.savepoint(savepoint)

        try:
            doc.submit()
            BillingService.create_invoice(name, dimensions)
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise

        return BillingService.get_run(name)

    @staticmethod
    def cancel(name=None):
        BillingService._guard_admin()

        if not frappe.db.exists("Billing Run", name):
            raise NotFoundError(f"Billing Run {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("Billing Run", name)

        if doc.sales_invoice:
            raise ValidationError(
                f"This run carries invoice {doc.sales_invoice}. Cancel or delete that invoice "
                "first — dropping the run would leave it orphaned.",
                "INVALID_TRANSITION",
            )

        if doc.docstatus == 1:
            doc.cancel()
        else:
            doc.status = "Cancelled"
            doc.save()

        frappe.db.commit()

        return BillingService.get_run(name)

    @staticmethod
    def _create_order(doc, items, company, conversion_rate, dimensions=None):
        """The order the invoice is drawn from, delivered at the close of the period."""
        # a period already elapsed cannot be delivered in the past, so it delivers on the day
        # the order is raised
        raised = getdate()
        delivery = max(getdate(doc.billing_period_end), raised)

        payload = {
            "doctype": "Sales Order",
            "company": company,
            "customer": doc.customer,
            "order_type": "Sales",
            "transaction_date": raised,
            "delivery_date": delivery,
            "items": [{**item, "delivery_date": delivery} for item in items],
        }

        if doc.currency:
            payload["currency"] = doc.currency

        if conversion_rate:
            payload["conversion_rate"] = flt(conversion_rate)

        order = AccountingDimensionService.stamp(frappe.get_doc(payload), dimensions).insert()
        order.submit()

        return order

    @staticmethod
    def _invoice_from_order(order, conversion_rate, dimensions=None):
        """Draw the invoice off the order, so the two stay linked in the ledger."""
        from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice

        invoice = make_sales_invoice(order.name, ignore_permissions=True)
        invoice.posting_date = frappe.utils.today()
        # hold the posting date, or ERPNext moves it to today when the draft is posted later
        invoice.set_posting_time = 1

        if conversion_rate:
            invoice.conversion_rate = flt(conversion_rate)

        return AccountingDimensionService.stamp(invoice, dimensions).insert()

    @staticmethod
    def _period_label(doc):
        """How the period reads on the invoice: a quarter is named, a month is spelled out."""
        start = getdate(doc.billing_period_start)
        end = getdate(doc.billing_period_end)

        if start.month == 1 and start.day == 1 and end.month == 12 and end.day == 31:
            return f"Year {start.year}" if start.year == end.year else f"{start.year}–{end.year}"

        if start.year == end.year and (end.month - start.month) == 2 and start.month % 3 == 1:
            return f"Q{(start.month - 1) // 3 + 1} {start.year}"

        if start.year == end.year and start.month == end.month:
            return frappe.utils.formatdate(doc.billing_period_end, "MMMM yyyy")

        return (
            f"{frappe.utils.formatdate(doc.billing_period_start, 'MMM yyyy')} – "
            f"{frappe.utils.formatdate(doc.billing_period_end, 'MMM yyyy')}"
        )

    @staticmethod
    def _invoice_groups(doc):
        """One invoice line per service and rate: quantity is the number of months billed.

        Keeping the rate in the key is what lets a correction ride on the same invoice as a
        separate line, exactly as the printed invoice has always shown it.
        """
        grouped = {}

        for row in doc.lines:
            if row.exception_code:
                continue

            months = flt(row.billable_months) * flt(row.quantity or 1)

            if not months:
                continue

            bucket = grouped.setdefault(
                (row.service_item, flt(row.unit_rate, 2), flt(row.discount_percent, 2)),
                {"months": 0.0, "amount": 0.0, "targets": 0},
            )
            bucket["months"] += months
            bucket["amount"] += flt(row.amount)
            bucket["targets"] += 1

        return grouped

    @staticmethod
    def create_invoice(name=None, dimensions=None):
        """Group the frozen lines into an order, then the invoice drawn from it.

        The order carries no approval of its own — it is there so the sale follows the
        usual accounting chain rather than appearing straight as an invoice.
        """
        BillingService._guard_admin()

        if not frappe.db.exists("Billing Run", name):
            raise NotFoundError(f"Billing Run {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("Billing Run", name)

        if doc.sales_invoice:
            raise ValidationError(
                f"Billing Run {name} is already invoiced as {doc.sales_invoice}.",
                "VALIDATION_ERROR",
            )

        if doc.docstatus != 1 or doc.status not in ("Approved", "Invoice Drafted"):
            raise ValidationError(
                f"Approve Billing Run {name} before invoicing it.", "INVALID_TRANSITION"
            )

        # settled before anything is written, so a missing dimension cannot leave a
        # submitted order behind with no invoice to draw from it
        dimensions = AccountingDimensionService.resolve(dimensions)

        grouped = BillingService._invoice_groups(doc)

        if not grouped:
            raise ValidationError("This run has no billable line.", "VALIDATION_ERROR")

        period_label = BillingService._period_label(doc)
        items = []

        for (service_item, rate, discount), bucket in grouped.items():
            names = frappe.db.get_value(
                "Item", service_item, ["item_name", "msp_invoice_label"], as_dict=True
            )
            # what the customer reads, which the catalogue name is not always fit for
            item_name = (names.msp_invoice_label or names.item_name or service_item) if names else service_item

            item = {
                "item_code": service_item,
                "item_name": item_name,
                "description": (
                    f"{period_label}"
                    f" ({doc.billing_period_start} → {doc.billing_period_end})"
                ),
                # the headcount behind the line, printed in its own column
                "msp_billed_count": bucket["targets"],
                "qty": flt(bucket["months"], 2),
                "uom": BILLING_UOM,
                "conversion_factor": 1,
                "rate": flt(flt(rate, 2) * (1 - flt(discount) / 100.0), 2),
            }

            if discount:
                # ERPNext prints the list price and what came off it
                item["price_list_rate"] = flt(rate, 2)
                item["discount_percentage"] = flt(discount, 2)

            items.append(item)

        company = frappe.defaults.get_global_default("company")
        company_currency, income_account = frappe.db.get_value(
            "Company", company, ["default_currency", "default_income_account"]
        )

        if not income_account:
            raise ValidationError(
                f"{company} has no default income account. Set one on the Company "
                "(or on each service Item) before invoicing — where revenue is booked "
                "is an accounting decision, not one this app should guess.",
                "VALIDATION_ERROR",
            )

        for item in items:
            item["income_account"] = income_account

        conversion_rate = None

        if doc.currency and doc.currency != company_currency:
            conversion_rate = frappe.db.get_value(
                "Currency Exchange",
                {"from_currency": doc.currency, "to_currency": company_currency},
                "exchange_rate",
                order_by="date desc",
            )
            if not conversion_rate:
                raise ValidationError(
                    f"The contract bills in {doc.currency} but {company} keeps its books in "
                    f"{company_currency}. Create a Currency Exchange record before invoicing.",
                    "VALIDATION_ERROR",
                )

        order = BillingService._create_order(doc, items, company, conversion_rate, dimensions)
        invoice = BillingService._invoice_from_order(order, conversion_rate, dimensions)

        doc.db_set("sales_order", order.name)
        doc.db_set("sales_invoice", invoice.name)
        doc.db_set("status", "Invoice Drafted")
        frappe.db.commit()

        return BillingService.get_run(name)

    @staticmethod
    def invoice_view(name=None):
        """The invoice as ERPNext holds it, for a run that has one.

        Everything here is read back from the Sales Invoice rather than recomputed: taxes,
        totals, what is still outstanding and whether it is paid are ERPNext's answers, not
        ours. The run only supplies the business context around them.
        """
        BillingService._guard_admin()

        if not name or not frappe.db.exists("Billing Run", name):
            raise NotFoundError(f"Billing Run {name} not found.", "NOT_FOUND")

        run = frappe.get_doc("Billing Run", name)

        if not run.sales_invoice:
            return {"run": run.name, "invoice": None}

        doc = frappe.get_doc("Sales Invoice", run.sales_invoice)
        catalogue = AccountingDimensionService.catalogue(doc.company)

        # which people and machines stand behind each line, at the granularity the invoice
        # groups them: one line covers a service at a rate, not a single device
        targets = {}

        for row in run.lines:
            if row.exception_code:
                continue

            key = (row.service_item, flt(row.unit_rate, 2), flt(row.discount_percent, 2))
            targets.setdefault(key, []).append(
                {
                    "user_name": frappe.db.get_value("Client User", row.client_user, "full_name")
                    if row.client_user
                    else None,
                    "hostname": frappe.db.get_value(
                        "Managed Device", row.managed_device, "hostname"
                    )
                    if row.managed_device
                    else None,
                    "serial_number": frappe.db.get_value(
                        "Managed Device", row.managed_device, "serial_number"
                    )
                    if row.managed_device
                    else None,
                    "covered_from": row.covered_from,
                    "covered_to": row.covered_to,
                    "months": flt(row.billable_months),
                    "amount": flt(row.amount),
                }
            )

        items = []

        for row in doc.items:
            key = (row.item_code, flt(row.price_list_rate or row.rate, 2), flt(row.discount_percentage, 2))
            items.append(
                {
                    "idx": row.idx,
                    "item_code": row.item_code,
                    "item_name": row.item_name,
                    "description": row.description,
                    "qty": flt(row.qty),
                    "uom": row.uom,
                    "rate": flt(row.rate),
                    "price_list_rate": flt(row.price_list_rate),
                    "discount_percentage": flt(row.discount_percentage),
                    "amount": flt(row.amount),
                    "income_account": row.income_account,
                    "billed_count": row.get("msp_billed_count"),
                    "dimensions": AccountingDimensionService.on(row, catalogue),
                    "targets": targets.get(key, []),
                }
            )

        return {
            "run": run.name,
            "contract": run.contract,
            "contract_title": frappe.db.get_value("MSP Contract", run.contract, "title")
            if run.contract
            else None,
            "period_label": BillingService._period_label(run),
            "invoice": {
                "name": doc.name,
                "status": doc.status,
                "docstatus": doc.docstatus,
                "company": doc.company,
                "customer": doc.customer,
                "customer_name": doc.customer_name,
                "posting_date": doc.posting_date,
                "due_date": doc.due_date,
                "payment_terms_template": doc.payment_terms_template,
                "currency": doc.currency,
                "conversion_rate": flt(doc.conversion_rate),
                "debit_to": doc.debit_to,
                "net_total": flt(doc.net_total),
                "total_taxes_and_charges": flt(doc.total_taxes_and_charges),
                "grand_total": flt(doc.grand_total),
                "outstanding_amount": flt(doc.outstanding_amount),
                "is_return": bool(doc.is_return),
                "return_against": doc.return_against,
            },
            "dimensions": AccountingDimensionService.on(doc, catalogue),
            "items": items,
            "taxes": [
                {
                    "description": tax.description,
                    "rate": flt(tax.rate),
                    "tax_amount": flt(tax.tax_amount),
                }
                for tax in doc.taxes
            ],
        }

    @staticmethod
    def discard_invoice(name=None):
        """Throw away a drafted invoice so the run can be invoiced again.

        A drafted invoice has not been posted, so nothing is booked and nothing has been
        sent to the customer — it can be redone freely.
        """
        BillingService._guard_admin()

        if not name or not frappe.db.exists("Billing Run", name):
            raise NotFoundError(f"Billing Run {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("Billing Run", name)

        if not doc.sales_invoice:
            raise ValidationError(f"{name} has no invoice to discard.", "INVALID_TRANSITION")

        invoice = frappe.get_doc("Sales Invoice", doc.sales_invoice)

        if invoice.docstatus != 0:
            raise ValidationError(
                f"{invoice.name} is already posted. Raise a credit note instead of discarding it.",
                "INVALID_TRANSITION",
            )

        order = doc.sales_order

        doc.db_set("sales_invoice", None)
        doc.db_set("sales_order", None)
        doc.db_set("status", "Approved")

        frappe.delete_doc("Sales Invoice", invoice.name, ignore_permissions=True)

        # the order exists only to carry this invoice, so it goes with it
        if order and frappe.db.exists("Sales Order", order):
            order_doc = frappe.get_doc("Sales Order", order)

            if order_doc.docstatus == 1:
                order_doc.cancel()

            frappe.delete_doc("Sales Order", order, ignore_permissions=True)

        frappe.db.commit()

        return BillingService.get_run(name)

    @staticmethod
    def reopen(name=None):
        """Take an approved run back to a draft that can be rebuilt.

        Approving freezes a run on purpose, so the way back is an amendment: the frozen
        one is cancelled and stays on file, and a fresh draft carries on from it.
        """
        BillingService._guard_admin()

        if not name or not frappe.db.exists("Billing Run", name):
            raise NotFoundError(f"Billing Run {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("Billing Run", name)

        if doc.sales_invoice:
            raise ValidationError(
                f"This run carries invoice {doc.sales_invoice}. Discard it first — a run "
                "cannot be reopened while an invoice stands against it.",
                "INVALID_TRANSITION",
            )

        if doc.docstatus != 1:
            raise ValidationError(
                f"Billing Run {name} is not frozen, so there is nothing to reopen.",
                "INVALID_TRANSITION",
            )

        doc.cancel()

        amended = frappe.copy_doc(doc)
        amended.amended_from = doc.name
        amended.status = "Validating"
        amended.cutoff_datetime = frappe.utils.now()
        amended.approved_by = None
        amended.approved_at = None
        amended.insert()

        amended.status = "Exception" if amended.exception_count else "Ready for Approval"
        amended.save()
        frappe.db.commit()

        return BillingService.get_run(amended.name)

    @staticmethod
    def resolve_dispute(name=None, note=None):
        """Close a dispute from the invoice it concerns.

        The invoice itself is untouched: settling a dispute is a decision, and any money
        owed back travels as a credit note.
        """
        BillingService._guard_admin()

        if not name or not frappe.db.exists("Billing Run", name):
            raise NotFoundError(f"Billing Run {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("Billing Run", name)

        if not doc.disputed:
            raise ValidationError(f"{name} is not disputed.", "INVALID_TRANSITION")

        if doc.dispute_request and frappe.db.exists("Service Request", doc.dispute_request):
            request = frappe.get_doc("Service Request", doc.dispute_request)
            request.status = "Completed"

            if note:
                request.rejection_reason = note

            request.save(ignore_permissions=True)

        doc.db_set("disputed", 0)
        frappe.db.commit()

        BillingService._notify_dispute_settled(doc, note)

        return BillingService.get_run(name)

    @staticmethod
    def _notify_dispute_settled(doc, note):
        """Tell whoever raised it what came of it."""
        from nexgen_msp.utils import notifications

        if not doc.disputed_by:
            return

        notifications.send(
            "MSP Dispute Settled",
            [doc.disputed_by],
            {
                "full_name": frappe.db.get_value("User", doc.disputed_by, "full_name") or "there",
                "customer": doc.customer,
                "invoice": doc.sales_invoice or doc.name,
                "period": BillingService._period_label(doc),
                "outcome": note or "We have reviewed it and the invoice stands as issued.",
                "link": notifications.portal_url(f"/invoices/{doc.name}"),
            },
            reference_doctype="Billing Run",
            reference_name=doc.name,
        )

    @staticmethod
    def list_runs(
        customer=None,
        customers=None,
        status=None,
        statuses=None,
        contract=None,
        period_from=None,
        period_to=None,
        search=None,
        start=0,
        page_length=20,
    ):
        """The runs, narrowed on any axis the listing offers."""
        BillingService._guard_admin()

        def as_list(value):
            value = frappe.parse_json(value) if isinstance(value, str) else value
            if value in (None, "", []):
                return []
            return value if isinstance(value, list) else [value]

        wanted_customers = as_list(customers) or as_list(customer)
        wanted_statuses = as_list(statuses) or as_list(status)

        conditions = []
        params = {
            "start": frappe.utils.cint(start),
            "page_length": frappe.utils.cint(page_length) or 20,
        }

        if wanted_customers:
            conditions.append("br.customer in %(customers)s")
            params["customers"] = wanted_customers

        if wanted_statuses:
            conditions.append("br.status in %(statuses)s")
            params["statuses"] = wanted_statuses

        if contract:
            conditions.append("br.contract = %(contract)s")
            params["contract"] = contract

        # a run belongs to the window its period ends in
        if period_from:
            conditions.append("br.billing_period_end >= %(period_from)s")
            params["period_from"] = period_from

        if period_to:
            conditions.append("br.billing_period_end <= %(period_to)s")
            params["period_to"] = period_to

        if search:
            conditions.append(
                "(br.name like %(search)s or br.customer like %(search)s"
                " or br.sales_invoice like %(search)s)"
            )
            params["search"] = f"%{search}%"

        where = (" where " + " and ".join(conditions)) if conditions else ""

        total = frappe.db.sql(f"select count(*) from `tabBilling Run` br {where}", params)[0][0]

        rows = frappe.db.sql(
            f"""
            select
                br.name, br.customer, br.contract, br.status, br.credit_note_of, br.disputed,
                br.billing_period_start, br.billing_period_end,
                br.currency, br.total_amount, br.exception_count,
                br.sales_invoice, br.adjustment_of, br.creation,
                (select count(*) from `tabBilling Run Line` brl where brl.parent = br.name)
                    as line_count
            from `tabBilling Run` br
            {where}
            order by br.billing_period_end desc, br.creation desc
            limit %(page_length)s offset %(start)s
            """,
            params,
            as_dict=True,
        )

        return {"rows": rows, "total": total}

    @staticmethod
    def get_run(name=None, guard=True):
        if guard:
            BillingService._guard_admin()

        if not name or not frappe.db.exists("Billing Run", name):
            raise NotFoundError(f"Billing Run {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("Billing Run", name)

        lines = frappe.db.sql(
            """
            select
                brl.idx, brl.service_assignment, brl.service_item,
                coalesce(item.item_name, brl.service_item) as service_name,
                brl.assignment_scope,
                coalesce(brl.client_user, device.assigned_client_user) as client_user,
                coalesce(cu.full_name, device_holder.full_name) as user_name,
                device.hostname,
                brl.quantity, brl.billable_days, brl.period_days, brl.billable_months,
                brl.covered_from, brl.covered_to,
                brl.gross_amount, brl.discount_percent, brl.discount_source,
                brl.unit_rate, brl.price_source, brl.proration_method, brl.amount,
                brl.exception_code, brl.exception_detail, brl.line_comment,
                coalesce(cu.department, device_holder.department) as department,
                coalesce(cu.email, device_holder.email) as email,
                sa.effective_start_date, sa.effective_end_date, sa.operational_status
            from `tabBilling Run Line` brl
            left join `tabService Assignment` sa on sa.name = brl.service_assignment
            left join `tabItem` item on item.name = brl.service_item
            left join `tabClient User` cu on cu.name = brl.client_user
            left join `tabManaged Device` device on device.name = brl.managed_device
            left join `tabClient User` device_holder on device_holder.name = device.assigned_client_user
            where brl.parent = %(parent)s
            order by brl.exception_code desc, brl.service_item asc, brl.idx asc
            """,
            {"parent": name},
            as_dict=True,
        )

        posted = (
            frappe.db.get_value("Sales Invoice", doc.sales_invoice, "docstatus") == 1
            if doc.sales_invoice
            else False
        )

        return {
            "name": doc.name,
            "customer": doc.customer,
            "contract": doc.contract,
            "contract_title": frappe.db.get_value("MSP Contract", doc.contract, "title")
            if doc.contract
            else None,
            "period_label": BillingService._period_label(doc),
            "status": doc.status,
            "docstatus": doc.docstatus,
            "billing_period_start": doc.billing_period_start,
            "billing_period_end": doc.billing_period_end,
            "cutoff_datetime": doc.cutoff_datetime,
            "currency": doc.currency,
            "total_amount": doc.total_amount,
            "exception_count": doc.exception_count,
            "prepared_by": frappe.db.get_value("User", doc.prepared_by, "full_name")
            if doc.prepared_by
            else None,
            "approved_by": frappe.db.get_value("User", doc.approved_by, "full_name")
            if doc.approved_by
            else None,
            "approved_at": doc.approved_at,
            "sales_order": doc.sales_order,
            "sales_invoice": doc.sales_invoice,
            "invoice_status": frappe.db.get_value("Sales Invoice", doc.sales_invoice, "status")
            if doc.sales_invoice
            else None,
            "invoice_submitted": posted,
            "adjustment_of": doc.adjustment_of,
            "credit_note_of": doc.credit_note_of,
            "credit_note_reason": doc.credit_note_reason,
            "disputed": bool(doc.disputed),
            "dispute_reason": doc.dispute_reason,
            "disputed_on": doc.disputed_on,
            "is_credit_note": bool(doc.credit_note_of),
            "lines": lines,
            "can_approve": doc.docstatus == 0 and doc.status == "Ready for Approval",
            # rebuilding the lines of a run that already carries an invoice would rewrite
            # numbers the customer has been given
            "discount_percent": flt(doc.discount_percent),
            "can_discount_lines": doc.docstatus == 0 and not doc.sales_invoice,
            "can_revalidate": doc.docstatus == 0
            and not doc.sales_invoice
            and doc.status not in ("Approved", "Invoiced", "Cancelled"),
            "can_invoice": doc.docstatus == 1
            and doc.status == "Approved"
            and not doc.sales_invoice
            and not doc.credit_note_of,
            # a credit note stands against a posted invoice, so there is nothing to contest
            # while the invoice is still a draft
            "can_contest": posted and not doc.credit_note_of,
            "can_resolve_dispute": bool(doc.disputed),
            "dispute_request": doc.dispute_request,
            "can_discard_invoice": bool(doc.sales_invoice) and not posted,
            "can_reopen": doc.docstatus == 1 and not doc.sales_invoice,
            "can_cancel": doc.status not in ("Invoiced", "Cancelled")
            and not doc.sales_invoice,
            "can_submit_invoice": bool(doc.sales_invoice) and not posted,
        }


    @staticmethod
    def _accounting_gaps(company):
        """Name every company setting a Sales Invoice needs, before ERPNext throws mid-submit."""
        needed = {
            "default_income_account": "Default Income Account",
            "round_off_account": "Round Off Account",
            "round_off_cost_center": "Round Off Cost Center",
            "default_receivable_account": "Default Receivable Account",
        }

        values = frappe.db.get_value("Company", company, list(needed), as_dict=True) or {}

        return [label for field, label in needed.items() if not values.get(field)]

    @staticmethod
    def _payment_terms_template():
        """A template ERPNext can date the invoice from, kept in step with the setting.

        Without one the due date falls back to the posting date and every invoice reads as
        overdue the day after it is issued.
        """
        from nexgen_msp.api.internal.services.settings_service import SettingsService

        days = SettingsService.payment_terms_days()
        name = f"Net {days} Days"

        if not frappe.db.exists("Payment Term", name):
            frappe.get_doc(
                {
                    "doctype": "Payment Term",
                    "payment_term_name": name,
                    "due_date_based_on": "Day(s) after invoice date",
                    "credit_days": days,
                    "invoice_portion": 100,
                }
            ).insert(ignore_permissions=True)

        if not frappe.db.exists("Payment Terms Template", name):
            frappe.get_doc(
                {
                    "doctype": "Payment Terms Template",
                    "template_name": name,
                    "terms": [{"payment_term": name, "invoice_portion": 100, "credit_days": days}],
                }
            ).insert(ignore_permissions=True)

        return name

    @staticmethod
    def submit_invoice(name=None, notify=1):
        """Post the invoice to the ledger. The run only becomes final once this succeeds."""
        BillingService._guard_admin()

        if not name or not frappe.db.exists("Billing Run", name):
            raise NotFoundError(f"Billing Run {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("Billing Run", name)

        if not doc.sales_invoice:
            raise ValidationError(
                f"Billing Run {name} has no invoice yet.", "INVALID_TRANSITION"
            )

        invoice = frappe.get_doc("Sales Invoice", doc.sales_invoice)

        if invoice.docstatus == 1:
            raise ValidationError(
                f"{invoice.name} is already submitted.", "INVALID_TRANSITION"
            )

        gaps = BillingService._accounting_gaps(invoice.company)

        if gaps:
            raise ValidationError(
                f"{invoice.company} is missing: {', '.join(gaps)}. Set them on the Company "
                "before posting invoices — where the money lands is an accounting decision.",
                "VALIDATION_ERROR",
            )

        # without this ERPNext moves the posting date to today on save, leaving the due date
        # stranded in the past and refusing the submit
        invoice.set_posting_time = 1

        # ERPNext recomputes the due date from the payment terms at validate, so setting the
        # date directly would be overwritten: the template is what actually grants the delay
        template = BillingService._payment_terms_template()

        if template:
            invoice.payment_terms_template = template
            # both are cleared so ERPNext derives them from the template rather than
            # keeping the posting date it fell back on when the draft was made
            invoice.payment_schedule = []
            invoice.due_date = None

        invoice.submit()

        doc.db_set("status", "Invoiced")
        BillingService._recompute_last_billed(doc.customer)
        frappe.db.commit()

        if frappe.utils.cint(notify):
            BillingService._notify_customer(doc, invoice, BillingService._invoice_groups(doc))

        return BillingService.get_run(name)

    @staticmethod
    def net_billed_periods(customer):
        """Periods this customer was really billed for, per assignment, credits netted off.

        A credit note carries negative months against the same assignment and period, so a
        period fully credited back nets to zero and stops counting as billed. Nothing needs
        to be undone: the runs themselves are the record.
        """
        return frappe.db.sql(
            """
            select
                brl.service_assignment,
                brl.managed_device,
                brl.client_user,
                br.billing_period_end as period_end,
                max(coalesce(brl.covered_to, br.billing_period_end)) as covered_to,
                sum(brl.billable_months) as net_months
            from `tabBilling Run Line` brl
            join `tabBilling Run` br on br.name = brl.parent
            where br.customer = %(customer)s and br.status = 'Invoiced'
            group by brl.service_assignment, br.billing_period_start, br.billing_period_end
            having net_months > 0
            """,
            {"customer": customer},
            as_dict=True,
        )

    @staticmethod
    def _recompute_last_billed(customer):
        """Restate the recorded billing dates from what stands after credits.

        Called whenever an invoice or a credit note is posted, so crediting someone back
        rolls their date to the period before rather than leaving a mark that no longer
        corresponds to money owed.
        """
        rows = BillingService.net_billed_periods(customer)

        latest = max((getdate(row.period_end) for row in rows), default=None)
        frappe.db.set_value(
            "Customer", customer, "msp_last_billed_on", latest, update_modified=False
        )

        # how far each person and each machine is billed to, credits already netted off
        per_device = {}
        per_user = {}

        for row in rows:
            covered = getdate(row.covered_to or row.period_end)

            for bucket, key in ((per_device, row.managed_device), (per_user, row.client_user)):
                if not key:
                    continue

                known = bucket.get(key)

                if not known or covered > known:
                    bucket[key] = covered

        for user, covered in per_user.items():
            frappe.db.set_value(
                "Client User", user, "last_billed_on", covered, update_modified=False
            )

        for device, covered in per_device.items():
            frappe.db.set_value(
                "Managed Device", device, "last_billed_on", covered, update_modified=False
            )

        touched = frappe.db.sql_list(
            """
            select distinct brl.managed_device
            from `tabBilling Run Line` brl
            join `tabBilling Run` br on br.name = brl.parent
            where br.customer = %(customer)s and brl.managed_device is not null
            """,
            {"customer": customer},
        )

        for device in touched:
            frappe.db.set_value(
                "Managed Device",
                device,
                {
                    "last_billed_on": per_device.get(device),
                    "covered_until": per_device.get(device),
                },
                update_modified=False,
            )

        billed_users = frappe.db.sql_list(
            """
            select distinct brl.client_user
            from `tabBilling Run Line` brl
            join `tabBilling Run` br on br.name = brl.parent
            where br.customer = %(customer)s and brl.client_user is not null
            """,
            {"customer": customer},
        )

        for user in billed_users:
            frappe.db.set_value(
                "Client User", user, "covered_until", per_user.get(user), update_modified=False
            )

    @staticmethod
    def _notify_customer(doc, invoice, grouped):
        """Let the customer's portal contacts know an invoice was issued for the period."""
        from nexgen_msp.utils import notifications

        recipients = frappe.db.sql_list(
            """
            select distinct u.name
            from `tabUser Permission` up
            join `tabUser` u on u.name = up.user
            where up.allow = 'Customer' and up.for_value = %(customer)s and u.enabled = 1
            """,
            {"customer": doc.customer},
        )

        if not recipients:
            return

        period = BillingService._period_label(doc)
        currency = doc.currency or ""

        rows = [
            (
                frappe.db.get_value("Item", service_item, "item_name") or service_item,
                f"{flt(bucket['amount'], 2):,.0f} {currency}".replace(",", " "),
            )
            for (service_item, _rate, _discount), bucket in grouped.items()
        ]
        rows.append(("Total", f"{flt(doc.total_amount, 2):,.0f} {currency}".replace(",", " ")))

        notifications.send(
            "MSP Invoice Issued",
            recipients,
            {
                "full_name": "there",
                "customer": doc.customer,
                "invoice": invoice.name,
                "period": period,
                "summary": notifications.summary_table(rows),
                "link": notifications.portal_url("/records"),
            },
            reference_doctype="Billing Run",
            reference_name=doc.name,
        )

    @staticmethod
    def breakdown(name=None, guard=True):
        """The supporting detail behind an invoice: a summary, then one block per service.

        This is the file the customer reconciles against — every person or machine that was
        billed, what they were billed for, and for how many months. The portal passes
        guard=False, having already checked the caller owns the run.
        """
        if guard:
            BillingService._guard_admin()

        if not name or not frappe.db.exists("Billing Run", name):
            raise NotFoundError(f"Billing Run {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("Billing Run", name)
        detail = BillingService.get_run(name, guard=guard)
        reference = doc.sales_invoice or doc.name

        # the customer reads this file next to their invoice, so the two must name a
        # service the same way
        labels = {
            row.name: (row.msp_invoice_label or row.item_name or row.name)
            for row in frappe.get_all(
                "Item",
                filters={"name": ("in", [line["service_item"] for line in detail["lines"]] or [""])},
                fields=["name", "item_name", "msp_invoice_label"],
            )
        }

        blocks = {}

        for line in detail["lines"]:
            if line.get("exception_code"):
                continue

            service_name = labels.get(line["service_item"], line["service_name"])

            block = blocks.setdefault(
                service_name,
                {
                    "service_name": service_name,
                    "service_item": line["service_item"],
                    "rows": [],
                    "months": 0.0,
                    "total": 0.0,
                },
            )

            block["rows"].append(
                {
                    "count": len(block["rows"]) + 1,
                    "employee_name": line.get("user_name"),
                    "email": line.get("email"),
                    "hostname": line.get("hostname"),
                    "company": doc.customer,
                    "department": line.get("department"),
                    "creation_date": line.get("effective_start_date"),
                    "reference": reference,
                    "status": line.get("operational_status"),
                    "monthly": flt(line.get("unit_rate")),
                    # the days this line was actually covered, which a month count hides
                    "covered_from": line.get("covered_from"),
                    "covered_to": line.get("covered_to"),
                    "months": flt(line.get("billable_months")),
                    "discount_percent": flt(line.get("discount_percent")),
                    "gross": flt(line.get("gross_amount")),
                    "total": flt(line.get("amount")),
                    "comments": line.get("line_comment"),
                }
            )
            block["months"] += flt(line.get("billable_months"))
            block["total"] += flt(line.get("amount"))

        summary = [
            {
                "company": doc.customer,
                "service": block["service_name"],
                "months": flt(block["months"], 2),
                "amount": flt(block["total"], 2),
            }
            for block in blocks.values()
        ]

        return {
            "run": doc.name,
            "customer": doc.customer,
            "contract": doc.contract,
            "invoice": doc.sales_invoice,
            "period_label": detail["period_label"],
            "period_start": doc.billing_period_start,
            "period_end": doc.billing_period_end,
            "currency": doc.currency,
            "summary": summary,
            "blocks": list(blocks.values()),
            "total_amount": flt(doc.total_amount, 2),
        }

    @staticmethod
    def creditable_lines(name=None):
        """The lines of an issued invoice that could still be credited back."""
        BillingService._guard_admin()

        detail = BillingService.get_run(name)

        if not detail["sales_invoice"]:
            raise ValidationError(
                f"Billing Run {name} has no invoice to contest.", "INVALID_TRANSITION"
            )

        credited = frappe.db.sql(
            """
            select brl.service_assignment, sum(brl.billable_months) as months
            from `tabBilling Run Line` brl
            join `tabBilling Run` br on br.name = brl.parent
            where br.credit_note_of = %(run)s and br.docstatus != 2
            group by brl.service_assignment
            """,
            {"run": name},
            as_dict=True,
        )

        already = {row.service_assignment: flt(row.months) for row in credited}

        rows = []

        for line in detail["lines"]:
            if line.get("exception_code"):
                continue

            billed = flt(line["billable_months"])
            done = abs(already.get(line["service_assignment"], 0.0))

            rows.append(
                {
                    **line,
                    "credited_months": done,
                    "remaining_months": flt(billed - done, 2),
                }
            )

        return {
            "run": detail["name"],
            "customer": detail["customer"],
            "invoice": detail["sales_invoice"],
            "invoice_submitted": detail["invoice_submitted"],
            "period_label": detail["period_label"],
            "currency": detail["currency"],
            "lines": rows,
        }

    @staticmethod
    def create_credit_note(name=None, lines=None, reason=None):
        """Credit part of an issued invoice back, as a return against the original.

        Contesting a line does not rewrite history: the original invoice stands and a
        separate credit note carries the negative months, exactly as the printed
        breakdown has always shown a correction.
        """
        BillingService._guard_admin()

        if not reason or not str(reason).strip():
            raise ValidationError(
                "Say why this invoice is being credited — an unexplained credit note "
                "cannot be reconciled later.",
                "VALIDATION_ERROR",
            )

        source = BillingService.creditable_lines(name)

        if not source["invoice_submitted"]:
            raise ValidationError(
                f"{source['invoice']} is still a draft. Post it before crediting it back — "
                "a return can only stand against a posted invoice.",
                "INVALID_TRANSITION",
            )

        lines = frappe.parse_json(lines) if isinstance(lines, str) else lines
        wanted = {row["service_assignment"]: flt(row.get("months")) for row in (lines or [])}

        if not wanted:
            raise ValidationError("Select at least one line to credit.", "VALIDATION_ERROR")

        chosen = []

        for line in source["lines"]:
            if line["service_assignment"] not in wanted:
                continue

            asked = wanted[line["service_assignment"]] or line["remaining_months"]

            if asked <= 0:
                continue

            if asked > line["remaining_months"]:
                raise ValidationError(
                    f"{line['user_name'] or line['service_name']} was billed "
                    f"{line['remaining_months']} month(s) that are still creditable, "
                    f"not {asked}.",
                    "VALIDATION_ERROR",
                )

            chosen.append((line, asked))

        if not chosen:
            raise ValidationError("Nothing left to credit on these lines.", "VALIDATION_ERROR")

        run = frappe.get_doc("Billing Run", name)

        note = frappe.get_doc(
            {
                "doctype": "Billing Run",
                "customer": run.customer,
                "contract": run.contract,
                "billing_period_start": run.billing_period_start,
                "billing_period_end": run.billing_period_end,
                "cutoff_datetime": frappe.utils.now(),
                "currency": run.currency,
                "status": "Validating",
                "credit_note_of": run.name,
                "credit_note_reason": reason,
                "generation_version": "1",
                "lines": [
                    {
                        "service_assignment": line["service_assignment"],
                        "service_item": line["service_item"],
                        "assignment_scope": line["assignment_scope"],
                        "client_user": line["client_user"],
                        "managed_device": line.get("managed_device"),
                        "quantity": line["quantity"],
                        "billable_days": line["billable_days"],
                        "period_days": line["period_days"],
                        "billable_months": -months,
                        "unit_rate": line["unit_rate"],
                        "price_source": line["price_source"],
                        "proration_method": line["proration_method"],
                        "amount": flt(-months * flt(line["unit_rate"]) * flt(line["quantity"]), 2),
                        "line_comment": reason,
                    }
                    for line, months in chosen
                ],
            }
        ).insert()

        note.save()
        note.submit()

        BillingService._issue_credit_note(note)
        frappe.db.commit()

        return BillingService.get_run(note.name)

    @staticmethod
    def _issue_credit_note(doc):
        """Draft the return document that carries the credited months."""
        original = frappe.db.get_value("Billing Run", doc.credit_note_of, "sales_invoice")

        if not original:
            raise ValidationError(
                f"{doc.credit_note_of} has no invoice to credit against.", "INVALID_TRANSITION"
            )

        grouped = {}

        for row in doc.lines:
            months = flt(row.billable_months) * flt(row.quantity or 1)
            bucket = grouped.setdefault(
                (row.service_item, flt(row.unit_rate, 2), flt(row.discount_percent, 2)),
                {"months": 0.0},
            )
            bucket["months"] += months

        company = frappe.db.get_value("Sales Invoice", original, "company")
        income_account = frappe.db.get_value("Company", company, "default_income_account")

        period_label = BillingService._period_label(doc)

        note = frappe.get_doc(
            {
                "doctype": "Sales Invoice",
                "company": company,
                "customer": doc.customer,
                "posting_date": frappe.utils.today(),
                "is_return": 1,
                "return_against": original,
                "currency": doc.currency,
                "remarks": doc.credit_note_reason,
                "items": [
                    {
                        "item_code": service_item,
                        "description": f"{frappe.db.get_value('Item', service_item, 'item_name') or service_item}"
                        f" — credit for {period_label}",
                        "qty": flt(bucket["months"], 2),
                        "uom": BILLING_UOM,
                        "conversion_factor": 1,
                        "rate": flt(rate, 2),
                        "income_account": income_account,
                    }
                    for (service_item, rate, _discount), bucket in grouped.items()
                ],
            }
        ).insert()

        doc.db_set("sales_invoice", note.name)
        doc.db_set("status", "Invoice Drafted")

        return note.name

    @staticmethod
    def _next_period(covered_upto, frequency, contract_start):
        """Where the next invoice picks up, and how far it runs."""
        span = MONTHS_PER_PERIOD.get(frequency, 1)

        start = add_days(getdate(covered_upto), 1) if covered_upto else getdate(contract_start)
        end = add_days(frappe.utils.add_months(start, span), -1)

        return start, end

    @staticmethod
    def due(horizon_days=30):
        """Which contracts are running out of billed coverage, and what to bill next.

        Coverage is read from the periods already billed, so the answer follows the
        invoices that were actually issued rather than a separate schedule to maintain.
        """
        BillingService._guard_admin()

        horizon = frappe.utils.cint(horizon_days) or 30
        today = getdate()

        rows = frappe.db.sql(
            """
            select
                c.name as contract, c.customer, c.title, c.billing_frequency,
                c.start_date, c.end_date,
                max(br.billing_period_end) as covered_upto,
                count(br.name) as runs
            from `tabMSP Contract` c
            join `tabCustomer` cust on cust.name = c.customer
            left join `tabBilling Run` br
                on br.contract = c.name and br.docstatus != 2 and br.status != 'Cancelled'
            where c.status = 'Active' and ifnull(cust.msp_free_of_charge, 0) = 0
            group by c.name
            order by covered_upto asc
            """,
            as_dict=True,
        )

        due = []

        for row in rows:
            covered = getdate(row.covered_upto) if row.covered_upto else None
            start, end = BillingService._next_period(
                covered, row.billing_frequency, row.start_date
            )

            if row.end_date:
                contract_end = getdate(row.end_date)

                if start > contract_end:
                    continue

                end = min(end, contract_end)

            if covered is None:
                state = "Never billed"
                days_left = None
            else:
                days_left = (covered - today).days
                if days_left < 0:
                    state = "Overdue"
                elif days_left <= horizon:
                    state = "Due soon"
                else:
                    state = "Scheduled"

            row.update(
                {
                    "covered_upto": covered,
                    "next_period_start": start,
                    "next_period_end": end,
                    "days_left": days_left,
                    "state": state,
                    "billable_assignments": frappe.db.count(
                        "Service Assignment",
                        {
                            "customer": row.customer,
                            "billing_status": "Billable",
                            "operational_status": ["in", BILLABLE_OPERATIONAL],
                        },
                    ),
                }
            )
            due.append(row)

        order = {"Overdue": 0, "Never billed": 1, "Due soon": 2, "Scheduled": 3}
        due.sort(key=lambda entry: (order.get(entry["state"], 9), entry["customer"]))

        return {
            "as_of": today,
            "horizon_days": horizon,
            "rows": due,
            "action_needed": len([e for e in due if e["state"] != "Scheduled"]),
        }
