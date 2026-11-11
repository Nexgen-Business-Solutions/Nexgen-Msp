"""A service the company itself holds, with no person and no machine behind it.

A retainer, a block of storage, a line: things a customer buys that nobody carries. They
were impossible to record, so they were either left off the system or faked onto somebody's
account — which then billed that person's company for a machine they never had and made the
figure impossible to explain.

The storage was ready for it: the assignment and the billing run line already accepted a
Customer scope, the three target fields were already required to be empty for a scope with
no target, and two overlapping Customer periods were already refused. What was missing was
the way in — the catalogue would not sell one, and the lifecycle had nowhere to put it.
"""

import frappe

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.utils import catalogue as msp_catalogue
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase

ASSIGNMENT = "MSP Service Assignment"


class CustomerScopeCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=4)
        self.customer = self.make_customer(self.tag)
        self.retainer = self.make_service(f"RET{self.tag}", scope="Customer")
        self.contract = self.cover_service(self.customer, self.retainer, rate=300.0)

    def open_one(self, **over):
        asked = {
            "customer": self.customer,
            "service_item": self.retainer,
            "target_scope": "Customer",
            "effective_date": "2026-01-01",
            "quantity": 1,
        }
        asked.update(over)
        return self.track(ASSIGNMENT, ServiceLifecycleService.activate(**asked)["name"])


class TestTheCatalogueWillSellOne(CustomerScopeCase):
    def test_customer_is_a_scope_a_service_may_be_sold_at(self):
        self.assertIn("Customer", msp_catalogue.MSP_SCOPES)

    def test_the_definition_records_it(self):
        scope = frappe.db.get_value(
            "MSP Service Definition", {"item": self.retainer}, "service_scope"
        )

        self.assertEqual(scope, "Customer")


class TestOpeningOneForTheCompany(CustomerScopeCase):
    def test_it_opens_against_the_company_and_names_nobody(self):
        doc = frappe.get_doc(ASSIGNMENT, self.open_one())

        self.assertEqual(doc.assignment_scope, "Customer")
        self.assertEqual(doc.customer, self.customer)
        self.assertEqual(doc.operational_status, "Active")
        self.assertFalse(doc.client_user)
        self.assertFalse(doc.managed_device)
        self.assertFalse(doc.customer_site)

    def test_a_person_or_a_machine_offered_with_it_is_refused(self):
        person = self.make_person(self.customer, "Holder")

        with self.assertRaises(ValidationError) as refused:
            self.open_one(client_user=person)

        self.assertIn("carries no user", str(refused.exception))

    def test_the_same_service_cannot_run_twice_over_the_company_at_once(self):
        self.open_one()

        with self.assertRaises(ValidationError) as refused:
            self.open_one()

        self.assertIn("already holds an open", str(refused.exception))

    def test_a_customer_service_cannot_be_opened_onto_a_person_instead(self):
        """The catalogue says where it may be sold, and the scope cannot step around it."""
        person = self.make_person(self.customer, "Holder")

        with self.assertRaises(ValidationError) as refused:
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=self.retainer,
                target_scope="User",
                client_user=person,
                effective_date="2026-01-01",
            )

        self.assertIn("cannot be assigned at User scope", str(refused.exception))


class TestChangingItMidPeriod(CustomerScopeCase):
    def test_a_quantity_change_closes_the_old_period_and_opens_a_new_one(self):
        """The days already billed keep the terms they were billed on."""
        first = self.open_one(quantity=5)

        ServiceLifecycleService.change(
            assignment=first, effective_date="2026-03-01", quantity=8
        )

        was = frappe.get_doc(ASSIGNMENT, first)
        periods = frappe.get_all(
            ASSIGNMENT,
            filters={"customer": self.customer, "service_item": self.retainer},
            fields=["name", "quantity", "effective_start_date", "effective_end_date",
                    "operational_status", "assignment_scope"],
            order_by="effective_start_date asc",
        )

        for period in periods:
            self.track(ASSIGNMENT, period.name)

        self.assertEqual(len(periods), 2)
        self.assertEqual(was.quantity, 5)
        self.assertEqual(str(was.effective_end_date), "2026-02-28")
        self.assertEqual(periods[1].quantity, 8)
        self.assertEqual(str(periods[1].effective_start_date), "2026-03-01")
        self.assertEqual(periods[1].assignment_scope, "Customer")
        self.assertFalse(frappe.db.get_value(ASSIGNMENT, periods[1].name, "client_user"))

    def test_the_two_periods_do_not_overlap_and_neither_is_rewritten(self):
        first = self.open_one(quantity=5)
        ServiceLifecycleService.change(
            assignment=first, effective_date="2026-03-01", quantity=8
        )

        periods = frappe.get_all(
            ASSIGNMENT,
            filters={"customer": self.customer, "service_item": self.retainer},
            fields=["name", "effective_start_date", "effective_end_date"],
            order_by="effective_start_date asc",
        )

        for period in periods:
            self.track(ASSIGNMENT, period.name)

        self.assertLess(
            frappe.utils.getdate(periods[0].effective_end_date),
            frappe.utils.getdate(periods[1].effective_start_date),
        )


class TestBillingTheCompanyForIt(CustomerScopeCase):
    """It is billed by the same engine, on the same arithmetic, with nothing invented.

    The selection never filtered by scope, so a customer assignment was always going to be
    picked up. What was missing was the reading: a line about the company showed an empty
    holder, and a quantity with no unit beside it.
    """

    def priced(self, **over):
        asked = {
            "contract": self.contract,
            "period_start": "2026-01-01",
            "period_end": "2026-03-31",
        }
        asked.update(over)

        return BillingService.preview(**asked)

    def ours(self, preview):
        return [
            line
            for line in preview["lines"]
            if line.get("service_item") == self.retainer
        ]

    def test_a_fixed_retainer_is_billed_quantity_times_rate_times_months(self):
        self.open_one(quantity=1)

        lines = self.ours(self.priced())

        self.assertEqual(len(lines), 1)
        self.assertEqual(flt_round(lines[0]["billable_months"]), 3.0)
        self.assertEqual(flt_round(lines[0]["amount"]), 900.0)

    def test_a_quantity_based_fee_multiplies_by_the_units_held(self):
        """Five units of something, every month of the quarter."""
        self.open_one(quantity=5)

        lines = self.ours(self.priced())

        self.assertEqual(flt_round(lines[0]["quantity"]), 5.0)
        self.assertEqual(flt_round(lines[0]["amount"]), 4500.0)

    def test_the_line_is_about_the_company_and_names_no_person_or_machine(self):
        self.open_one()

        line = self.ours(self.priced())[0]

        self.assertEqual(line["assignment_scope"], "Customer")
        self.assertFalse(line.get("client_user"))
        self.assertFalse(line.get("managed_device"))
        self.assertFalse(line.get("user_name"))
        self.assertFalse(line.get("hostname"))

    def test_a_period_already_billed_is_not_billed_again(self):
        """The same coverage intervals the rest of the engine reads."""
        self.open_one()

        first = self.ours(self.priced())
        again = self.ours(self.priced(period_start="2026-01-01", period_end="2026-01-31"))

        self.assertEqual(flt_round(first[0]["billable_months"]), 3.0)
        self.assertEqual(flt_round(again[0]["billable_months"]), 1.0)

    def test_the_invoice_explains_the_units_rather_than_only_the_months(self):
        """5 TB over 3 months is billed as 15 months; the line has to say why."""
        self.open_one(quantity=5)

        bucket = {
            "months": 15.0,
            "amount": 4500.0,
            "targets": 1,
            "scopes": {"Customer"},
            "units": 5.0,
            "uom": "TB",
            "spans": 3.0,
        }

        self.assertEqual(BillingService._units_billed(bucket), " — 5 TB × 3 months")

    def test_one_month_is_not_called_months(self):
        bucket = {"units": 1.0, "uom": "Unit", "spans": 1.0}

        self.assertEqual(BillingService._units_billed(bucket), " — 1 Unit × 1 month")

    def test_the_grouping_remembers_what_the_line_was_about(self):
        """Read off real run lines, because that is what decides the printed column."""
        run = frappe._dict(
            lines=[
                frappe._dict(
                    service_item=self.retainer,
                    assignment_scope="Customer",
                    quantity=5,
                    uom_snapshot="TB",
                    billable_months=3,
                    unit_rate=300,
                    discount_percent=0,
                    amount=4500,
                    exception_code=None,
                )
            ]
        )

        bucket = next(iter(BillingService._invoice_groups(run).values()))

        self.assertEqual(bucket["scopes"], {"Customer"})
        self.assertEqual(bucket["units"], 5.0)
        self.assertEqual(bucket["uom"], "TB")
        self.assertEqual(bucket["spans"], 3.0)
        # the invoice still counts the line in months, quantity folded in
        self.assertEqual(bucket["months"], 15.0)

    def test_a_line_about_people_keeps_its_headcount(self):
        """Nothing about the existing User and Device presentation may move."""
        run = frappe._dict(
            lines=[
                frappe._dict(
                    service_item=self.retainer,
                    assignment_scope="User",
                    quantity=1,
                    uom_snapshot="Month",
                    billable_months=3,
                    unit_rate=300,
                    discount_percent=0,
                    amount=900,
                    exception_code=None,
                )
            ]
        )

        bucket = next(iter(BillingService._invoice_groups(run).values()))

        self.assertNotEqual(bucket["scopes"], {"Customer"})
        self.assertEqual(bucket["targets"], 1)

    def test_a_period_before_it_opened_bills_nothing_for_it(self):
        self.open_one(effective_date="2026-03-01")

        lines = self.ours(self.priced(period_start="2026-01-01", period_end="2026-02-28"))

        self.assertFalse([line for line in lines if flt(line.get("billable_months")) > 0])


def flt(value):
    import frappe.utils

    return frappe.utils.flt(value)


def flt_round(value):
    import frappe.utils

    return frappe.utils.flt(value, 2)


class TestAskingForOneThroughARequest(CustomerScopeCase):
    """A company service has to be askable, not only creatable by hand.

    The chain was already built for it: the request line and the work order both accept a
    Customer target scope, and the execution hands whatever scope it is given straight to
    the service domain. What it could not do was offer one — the builder knew two scopes
    and listed a company service under neither, so nobody could ask for what the rest of
    the chain was ready to carry out.
    """

    def test_the_builder_offers_a_company_service_at_company_scope(self):
        from nexgen_msp.api.portal.services.request_builder_service import RequestBuilderService

        offered = RequestBuilderService._offered(self.customer, "Customer")

        self.assertIn(self.retainer, [row["service_item"] for row in offered])

    def test_it_is_not_offered_to_a_person_or_to_a_machine(self):
        """A service the company holds is never also somebody's."""
        from nexgen_msp.api.portal.services.request_builder_service import RequestBuilderService

        for scope in ("User", "Device"):
            offered = RequestBuilderService._offered(self.customer, scope)

            self.assertNotIn(self.retainer, [row["service_item"] for row in offered], scope)

    def test_a_person_service_is_still_offered_exactly_as_before(self):
        from nexgen_msp.api.portal.services.request_builder_service import RequestBuilderService

        personal = self.make_service(f"PER{self.tag}", scope="User")
        self.cover_service(self.customer, personal, rate=10.0)

        at_user = [row["service_item"] for row in RequestBuilderService._offered(self.customer, "User")]
        at_company = [
            row["service_item"] for row in RequestBuilderService._offered(self.customer, "Customer")
        ]

        self.assertIn(personal, at_user)
        self.assertNotIn(personal, at_company)

    def test_the_work_order_and_the_request_line_both_accept_a_company_target(self):
        """The storage was ready; this pins it so a later edit cannot quietly take it away."""
        for doctype in ("MSP Work Order", "MSP Request Line"):
            options = (frappe.get_meta(doctype).get_field("target_scope").options or "").split("\n")

            self.assertIn("Customer", options, doctype)
