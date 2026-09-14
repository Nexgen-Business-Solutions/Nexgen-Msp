"""What a paused service is billed for: the days it really ran, and not one more.

A suspension is the only record of what was not provided, so Billing has to read it back.
These tests build their fixtures through the lifecycle itself — a service is opened, paused
and resumed the way a technician does it — and then ask a billing run what it would charge
for the period those acts fall in.
"""

import frappe
from frappe.utils import add_days, flt, getdate

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService

from .base import MSPTestCase


class TestBillingSuspensions(MSPTestCase):
    RATE = 25.0

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.john = self.make_person(self.customer, "John")
        self.today = frappe.utils.today()
        self.contract = None

    # ------------------------------------------------------------------ fixtures
    def days_ago(self, days):
        return frappe.utils.add_days(self.today, -days)

    def selling_price_list(self):
        row = frappe.db.get_value(
            "Price List", {"selling": 1, "enabled": 1}, ["name", "currency"], as_dict=True
        )

        if row:
            return row.name, row.currency

        doc = frappe.get_doc(
            {
                "doctype": "Price List",
                "price_list_name": "ZZTEST Selling",
                "selling": 1,
                "enabled": 1,
                "currency": frappe.defaults.get_global_default("currency") or "USD",
            }
        ).insert(ignore_permissions=True)
        self.track("Price List", doc.name)

        return doc.name, doc.currency

    def cover(self, service, rate=25.0):
        """Put a service on the customer's live contract, at a rate that is in force today."""
        price_list, currency = self.selling_price_list()
        existing = frappe.db.get_value("MSP Contract", {"customer": self.customer}, "name")

        doc = (
            frappe.get_doc("MSP Contract", existing)
            if existing
            else frappe.get_doc(
                {
                    "doctype": "MSP Contract",
                    "customer": self.customer,
                    "status": "Active",
                    "start_date": self.days_ago(730),
                    "billing_frequency": "Monthly",
                    "billing_timing": "In Arrears",
                    "proration_method": "Daily Actual Days",
                    "invoice_grouping": "One Invoice",
                    "price_list": price_list,
                    "currency": currency,
                }
            )
        )

        if not any(row.service_item == service for row in doc.services):
            doc.append("services", {"service_item": service})

        doc.save(ignore_permissions=True)
        self.track("MSP Contract", doc.name)
        self.price(service, rate, price_list, currency)
        frappe.db.commit()

        self.contract = doc.name

        return doc.name

    def price(self, service, rate, price_list, currency):
        existing = frappe.db.get_value(
            "Item Price", {"item_code": service, "customer": self.customer, "selling": 1}, "name"
        )

        if existing:
            return existing

        doc = frappe.get_doc(
            {
                "doctype": "Item Price",
                "item_code": service,
                "price_list": price_list,
                "customer": self.customer,
                "selling": 1,
                "buying": 0,
                "currency": currency,
                "price_list_rate": rate,
                "valid_from": self.days_ago(730),
            }
        ).insert(ignore_permissions=True)

        return self.track("Item Price", doc.name)

    def offering(self, suffix):
        service = self.make_service(suffix, scope="User")
        self.cover(service, rate=self.RATE)

        return service

    def open_service(self, service, **kwargs):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope="User",
            client_user=self.john,
            **kwargs,
        )
        self.track("MSP Service Assignment", outcome["name"])

        return outcome["name"]

    def reload(self, assignment):
        return frappe.get_doc("MSP Service Assignment", assignment)

    def line_for(self, assignment, period_start, period_end):
        """What a run over this period would charge for this one assignment."""
        lines, _terms = BillingService.build_lines(self.contract, period_start, period_end)
        mine = [line for line in lines if line["service_assignment"] == assignment]

        self.assertEqual(len(mine), 1, f"{assignment} produced {len(mine)} billing lines")

        return mine[0]

    # ------------------------------------------------------------------- calendar
    def last_month(self):
        """The calendar month before this one: every day of it is already behind us."""
        first_of_this = getdate(self.today).replace(day=1)
        end = getdate(add_days(first_of_this, -1))

        return end.replace(day=1), end

    def month_before_last(self):
        start, _end = self.last_month()
        end = getdate(add_days(start, -1))

        return end.replace(day=1), end

    def instalment(self, days, days_in_month):
        """The share of a month that many live days earns, blocks of five and all."""
        return flt(BillingService._billed_days(days, days_in_month) / days_in_month, 3)

    # ------------------------------------------------------- the spec's own example
    def test_a_pause_inside_the_period_takes_only_its_own_days_off(self):
        """1st to the month end, paused on the 10th and resumed on the 16th: 1–9 and 16–end."""
        start, end = self.last_month()
        assignment = self.open_service(self.offering("BSUSP1"), effective_date=start)

        ServiceLifecycleService.suspend(assignment=assignment, effective_date=start.replace(day=10))
        ServiceLifecycleService.resume(assignment=assignment, effective_date=start.replace(day=16))

        line = self.line_for(assignment, start, end)
        live = 9 + (end.day - 15)

        self.assertEqual(line["billable_days"], live)
        self.assertEqual(line["billable_days"], end.day - 6)
        self.assertEqual(line["billable_months"], self.instalment(live, end.day))
        self.assertLess(line["billable_months"], 1.0)
        self.assertEqual(line["amount"], flt(self.RATE * line["billable_months"], 2))
        self.assertIsNone(line["exception_code"])

        # the pause sits in the middle, so the line still covers the month end to end
        self.assertEqual(getdate(line["covered_from"]), start)
        self.assertEqual(getdate(line["covered_to"]), end)

    # ------------------------------------------------------------- still suspended
    def test_a_service_still_paused_is_billed_for_the_days_before_the_pause(self):
        start, end = self.last_month()
        assignment = self.open_service(self.offering("BSUSP2"), effective_date=start)

        ServiceLifecycleService.suspend(assignment=assignment, effective_date=start.replace(day=10))

        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", assignment, "billing_status"), "On Hold"
        )

        line = self.line_for(assignment, start, end)

        self.assertEqual(line["billable_days"], 9)
        self.assertEqual(line["billable_months"], self.instalment(9, end.day))
        self.assertEqual(getdate(line["covered_from"]), start)
        self.assertEqual(getdate(line["covered_to"]), start.replace(day=9))

    def test_a_service_still_paused_is_counted_among_what_is_left_to_bill(self):
        start, end = self.last_month()
        assignment = self.open_service(self.offering("BSUSP3"), effective_date=start)
        ServiceLifecycleService.suspend(assignment=assignment, effective_date=start.replace(day=10))

        status = BillingService.period_status(self.contract, start, end)

        self.assertEqual(status["eligible"], 1)
        self.assertEqual(status["remaining"], 1)

    # ------------------------------------------------------------- several pauses
    def test_two_pauses_in_one_period_both_come_off(self):
        start, end = self.last_month()
        assignment = self.open_service(self.offering("BSUSP4"), effective_date=start)

        for suspended_on, resumed_on in ((5, 8), (15, 20)):
            ServiceLifecycleService.suspend(
                assignment=assignment, effective_date=start.replace(day=suspended_on)
            )
            ServiceLifecycleService.resume(
                assignment=assignment, effective_date=start.replace(day=resumed_on)
            )

        line = self.line_for(assignment, start, end)
        paused = (8 - 5) + (20 - 15)

        self.assertEqual(paused, 8)
        self.assertEqual(line["billable_days"], end.day - paused)
        self.assertEqual(line["billable_months"], self.instalment(end.day - paused, end.day))
        self.assertEqual(len(self.reload(assignment).suspension_log), 2)

    # --------------------------------------------------------- closed while paused
    def test_a_service_closed_while_paused_is_billed_only_up_to_the_pause(self):
        """The pause stays open on purpose, and an open pause on a closed service bills nothing
        after the day it started."""
        start, end = self.last_month()
        assignment = self.open_service(self.offering("BSUSP5"), effective_date=start)

        ServiceLifecycleService.suspend(assignment=assignment, effective_date=start.replace(day=10))
        ServiceLifecycleService.end(assignment=assignment, effective_date=start.replace(day=20))

        doc = self.reload(assignment)
        self.assertIsNone(doc.suspension_log[0].resumed_on)
        self.assertEqual(getdate(doc.effective_end_date), start.replace(day=20))

        line = self.line_for(assignment, start, end)

        self.assertEqual(line["billable_days"], 9)
        self.assertEqual(line["billable_months"], self.instalment(9, end.day))
        self.assertEqual(getdate(line["covered_to"]), start.replace(day=9))

    def test_a_period_the_service_was_paused_throughout_covers_nothing(self):
        earlier_start, _earlier_end = self.month_before_last()
        start, end = self.last_month()
        assignment = self.open_service(self.offering("BSUSP6"), effective_date=earlier_start)

        ServiceLifecycleService.suspend(assignment=assignment, effective_date=start)

        line = self.line_for(assignment, start, end)

        self.assertEqual(line["billable_days"], 0)
        self.assertEqual(line["billable_months"], 0.0)
        self.assertEqual(line["amount"], 0.0)
        self.assertIsNone(line["covered_from"])
        self.assertIsNone(line["covered_to"])

    # ------------------------------------------------------------------ untouched
    def test_a_pause_that_closed_before_the_period_changes_nothing(self):
        earlier_start, _earlier_end = self.month_before_last()
        start, end = self.last_month()
        assignment = self.open_service(self.offering("BSUSP7"), effective_date=earlier_start)

        ServiceLifecycleService.suspend(
            assignment=assignment, effective_date=earlier_start.replace(day=5)
        )
        ServiceLifecycleService.resume(
            assignment=assignment, effective_date=earlier_start.replace(day=10)
        )

        line = self.line_for(assignment, start, end)

        self.assertEqual(line["billable_days"], end.day)
        self.assertEqual(line["billable_months"], 1.0)
        self.assertEqual(line["amount"], flt(self.RATE, 2))
        self.assertEqual(getdate(line["covered_from"]), start)
        self.assertEqual(getdate(line["covered_to"]), end)

    def test_a_service_that_was_never_paused_bills_the_whole_period(self):
        start, end = self.last_month()
        assignment = self.open_service(self.offering("BSUSP8"), effective_date=start)

        line = self.line_for(assignment, start, end)

        self.assertEqual(line["billable_days"], end.day)
        self.assertEqual(line["billable_months"], 1.0)
        self.assertEqual(line["amount"], flt(self.RATE, 2))
        self.assertEqual(getdate(line["covered_from"]), start)
        self.assertEqual(getdate(line["covered_to"]), end)
        self.assertIsNone(line["exception_code"])

    # ---------------------------------------------------------------- arithmetic
    def test_the_day_of_the_resume_is_billable_again(self):
        assignment = frappe._dict(
            {"effective_start_date": "2026-09-01", "effective_end_date": None}
        )
        paused = [frappe._dict({"suspended_on": "2026-09-10", "resumed_on": "2026-09-16"})]

        self.assertEqual(
            BillingService._billable_days(assignment, "2026-09-01", "2026-09-30", paused), 24
        )
        self.assertEqual(
            BillingService._suspended_days(assignment, paused, "2026-09-01", "2026-09-30"), 6
        )
        # suspended and resumed on the same day is an event, not a day off the bill
        same_day = [frappe._dict({"suspended_on": "2026-09-10", "resumed_on": "2026-09-10"})]
        self.assertEqual(
            BillingService._billable_days(assignment, "2026-09-01", "2026-09-30", same_day), 30
        )

    def test_an_open_pause_on_a_closed_service_stops_at_the_end_date(self):
        assignment = frappe._dict(
            {"effective_start_date": "2026-09-01", "effective_end_date": "2026-09-20"}
        )
        paused = [frappe._dict({"suspended_on": "2026-09-10", "resumed_on": None})]

        self.assertEqual(
            BillingService._billable_days(assignment, "2026-09-01", "2026-09-30", paused), 9
        )
        self.assertEqual(
            BillingService._suspended_days(assignment, paused, "2026-09-01", "2026-09-30"), 11
        )
