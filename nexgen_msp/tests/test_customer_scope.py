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
from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.utils import catalogue as msp_catalogue
from nexgen_msp.utils.errors import ValidationError
from nexgen_msp.utils.errors import ValidationError as ServiceRefused

from .base import MSPTestCase
from .test_billing_history import BillingHistoryCase
from .test_request_execution import ExecutionCase

ASSIGNMENT = "MSP Service Assignment"
RUN = "MSP Billing Run"


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

    def test_the_preview_reads_the_coverage_already_recorded(self):
        """The same coverage intervals the rest of the engine reads.

        Two previews, which write nothing. What a posted run does to the next one is
        proved against a real posted run, in TestACompanyPeriodIsBilledOnce.
        """
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

class TestTheCompanyPageSellsOne(CustomerScopeCase):
    """The company's own page, which is where a service with no target belongs.

    It was the one screen that could not open one: the availability reading asked which
    person or which machine, and the two doors on the company page did not exist at all.
    """

    def reading(self):
        from nexgen_msp.api.internal.services.service_availability_service import (
            ServiceAvailabilityService,
        )

        return ServiceAvailabilityService.for_customer(self.customer)

    def door(self):
        from nexgen_msp.api.internal.services.customer_service import CustomerService

        return CustomerService

    def test_customer_service_availability(self):
        held = self.open_one(quantity=5)

        reading = self.reading()

        self.assertEqual(reading["target"]["scope"], "Customer")
        self.assertEqual(reading["target"]["name"], self.customer)
        self.assertEqual([row["name"] for row in reading["current"]], [held])
        self.assertEqual(flt_round(reading["current"][0]["quantity"]), 5.0)
        # already held is neither an offer nor a refusal
        self.assertNotIn(
            self.retainer, [row["service_item"] for row in reading["available"]]
        )

    def test_a_company_service_not_yet_held_is_offered(self):
        other = self.make_service(f"RE2{self.tag}", scope="Customer")
        self.cover_service(self.customer, other, rate=50.0)

        offered = [row["service_item"] for row in self.reading()["available"]]

        self.assertIn(other, offered)

    def test_a_person_service_is_never_offered_to_the_company(self):
        personal = self.make_service(f"PE2{self.tag}", scope="User")
        self.cover_service(self.customer, personal, rate=10.0)
        reading = self.reading()

        self.assertNotIn(personal, [row["service_item"] for row in reading["available"]])
        self.assertIn(
            personal,
            [row["service_item"] for row in reading["blocked"]],
            "an administrator is told why, rather than left with a gap",
        )

    def test_customer_assignment_from_api(self):
        self.door().assign_service(
            customer=self.customer,
            service_item=self.retainer,
            effective_date="2026-01-01",
            quantity=5,
        )

        opened = frappe.get_all(
            ASSIGNMENT,
            filters={"customer": self.customer, "service_item": self.retainer},
            fields=["name", "assignment_scope", "client_user", "managed_device", "quantity"],
        )

        for row in opened:
            self.track(ASSIGNMENT, row.name)

        self.assertEqual(len(opened), 1)
        self.assertEqual(opened[0].assignment_scope, "Customer")
        self.assertEqual(flt_round(opened[0].quantity), 5.0)
        self.assertFalse(opened[0].client_user)
        self.assertFalse(opened[0].managed_device)

    def test_a_person_service_cannot_be_opened_on_the_company_through_this_door(self):
        personal = self.make_service(f"PE3{self.tag}", scope="User")
        self.cover_service(self.customer, personal, rate=10.0)

        with self.assertRaises(ValidationError):
            self.door().assign_service(
                customer=self.customer, service_item=personal, effective_date="2026-01-01"
            )

        self.assertFalse(
            frappe.db.exists(
                ASSIGNMENT, {"customer": self.customer, "service_item": personal}
            )
        )

    def test_customer_assignment_permission_denied(self):
        account = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"cs{self.tag[:3]}"
        )
        frappe.set_user(account)

        try:
            with self.assertRaises(Exception) as refused:
                self.door().assign_service(
                    customer=self.customer,
                    service_item=self.retainer,
                    effective_date="2026-01-01",
                )
        finally:
            frappe.set_user("Administrator")

        self.assertFalse(
            frappe.db.exists(
                ASSIGNMENT, {"customer": self.customer, "service_item": self.retainer}
            )
        )
        self.assertIn("PERMISSION", str(getattr(refused.exception, "code", "PERMISSION")).upper())

    def test_customer_assignment_duplicate_rejected(self):
        self.open_one()

        with self.assertRaises(ValidationError):
            self.door().assign_service(
                customer=self.customer,
                service_item=self.retainer,
                effective_date="2026-02-01",
            )

    def test_the_change_door_refuses_a_service_that_is_somebody_else_s(self):
        """The company page must not become a second way to act on a person's service."""
        personal = self.make_service(f"PE4{self.tag}", scope="User")
        self.cover_service(self.customer, personal, rate=10.0)
        person = self.make_person(self.customer, "Alice")
        theirs = self.track(
            ASSIGNMENT,
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=personal,
                target_scope="User",
                client_user=person,
                effective_date="2026-01-01",
            )["name"],
        )

        with self.assertRaises(ValidationError):
            self.door().change_service(
                assignment=theirs, action="End", effective_date="2026-03-01"
            )

        self.assertEqual(
            frappe.db.get_value(ASSIGNMENT, theirs, "operational_status"), "Active"
        )

    def test_the_change_door_changes_the_quantity_the_company_holds(self):
        held = self.open_one(quantity=5)

        self.door().change_service(
            assignment=held, action="Change", effective_date="2026-03-01", quantity=8
        )

        periods = frappe.get_all(
            ASSIGNMENT,
            filters={"customer": self.customer, "service_item": self.retainer},
            fields=["name", "quantity", "operational_status"],
            order_by="effective_start_date asc",
        )

        for row in periods:
            self.track(ASSIGNMENT, row.name)

        self.assertEqual([flt_round(row.quantity) for row in periods], [5.0, 8.0])
        self.assertEqual(periods[1].operational_status, "Active")


class TestWhatTheCustomerSeesOfIt(CustomerScopeCase):
    """A company service is the company's, and belongs to nobody on their register.

    The portal reads people and machines. A service held by neither used to be unreadable
    anywhere — and the register that counts what each person runs must not start counting
    it under whoever happens to be first.
    """

    def test_it_shows_among_the_services_the_company_subscribes_to(self):
        from nexgen_msp.api.portal.services.portal_service import PortalService

        self.open_one(quantity=5)

        rows = PortalService.list_subscribed_services(customer=self.customer)["services"]
        ours = [row for row in rows if row["service_item"] == self.retainer]

        self.assertEqual(len(ours), 1)
        self.assertEqual(ours[0]["assignment_scope"], "Customer")
        self.assertEqual(int(ours[0]["active"]), 1)

    def test_it_is_counted_under_nobody_on_the_people_register(self):
        from nexgen_msp.api.portal.services.portal_service import PortalService

        person = self.make_person(self.customer, "Alice")
        self.open_one()

        rows = PortalService.list_client_users(customer=self.customer)["rows"]
        theirs = next(row for row in rows if row["name"] == person)

        self.assertEqual(theirs["active_services"], 0)
        self.assertEqual(theirs["ended_services"], 0)

    def test_the_audit_sees_a_company_service_opened_twice(self):
        """The audit skipped a target it could not name; two company periods are two."""
        from nexgen_msp.utils import data_audit

        first = self.open_one()
        before = data_audit.services()["assignments_open_twice_on_one_target"]
        second = frappe.copy_doc(frappe.get_doc(ASSIGNMENT, first))
        second.flags.via_service_lifecycle = True
        # written past the validation on purpose: the rules refuse two open periods, and
        # what is under test is the audit that finds the ones older data already carries
        second.flags.ignore_validate = True
        second.insert(ignore_permissions=True)
        self.track(ASSIGNMENT, second.name)

        self.assertEqual(
            data_audit.services()["assignments_open_twice_on_one_target"], before + 1
        )

    def test_the_audit_names_a_company_service_that_carries_a_target(self):
        held = self.open_one()
        from nexgen_msp.utils import data_audit

        before = data_audit.services()["company_scope_carrying_a_target"]
        person = self.make_person(self.customer, "Bob")
        # written under the validation: the rules refuse it, which is why the audit exists
        frappe.db.set_value(ASSIGNMENT, held, "client_user", person, update_modified=False)

        self.assertEqual(
            data_audit.services()["company_scope_carrying_a_target"], before + 1
        )


class CompanyBillingCase(BillingHistoryCase):
    """A company service put through the real engine: drawn, frozen, invoiced, posted."""

    def setUp(self):
        super().setUp()
        self.unit = self.terabyte()
        self.storage = self.offering("CSTO", scope="Customer", rate=100.0)
        # the assignment takes its unit from the Item, which is where a block of storage
        # stops being counted in months
        frappe.db.set_value("Item", self.storage, "stock_uom", self.unit)
        frappe.db.commit()

    def terabyte(self):
        """A unit that is not a month, because that is the whole point of the line."""
        name = "ZZTEST TB"

        if not frappe.db.exists("UOM", name):
            frappe.get_doc({"doctype": "UOM", "uom_name": name}).insert(ignore_permissions=True)
            frappe.db.commit()

        return self.track("UOM", name)

    def opened(self, quantity=5):
        return self.running(self.storage, scope="Customer", quantity=quantity)

    def mine(self, run):
        return frappe.get_all(
            "MSP Billing Run Line",
            filters={"parent": run, "service_item": self.storage},
            fields=[
                "service_assignment",
                "quantity",
                "billable_months",
                "amount",
                "discount_percent",
                "exception_code",
                "covered_from",
                "covered_to",
            ],
            order_by="covered_from asc",
        )

    def invoiced(self, run):
        BillingService.finalise(run)
        invoice = frappe.db.get_value(RUN, run, "sales_invoice")
        self.track("Sales Invoice", invoice)

        return frappe.get_doc("Sales Invoice", invoice)

    def posted(self, start, end):
        """A month billed for real: frozen, invoiced, and the invoice submitted."""
        run = self.drawn(start=start, end=end)
        self.invoiced(run)
        BillingService.submit_invoice(name=run, notify=0)

        return run

    def groups_of(self, run):
        return BillingService._invoice_groups(frappe.get_doc(RUN, run))

    def resized(self, start, was=5, now=8):
        """One period, two sizes: the change lands mid-month."""
        middle = frappe.utils.add_days(frappe.utils.getdate(start), 15)
        first = self.opened(quantity=was)
        ServiceLifecycleService.change(
            assignment=first, effective_date=str(middle), quantity=now
        )
        frappe.db.commit()

        for row in frappe.get_all(
            ASSIGNMENT,
            filters={"customer": self.customer, "service_item": self.storage},
            pluck="name",
        ):
            self.track(ASSIGNMENT, row)

        return str(middle)


class TestWhatTheInvoiceSaysAboutACompanyService(CompanyBillingCase):
    """Two sizes of the same thing in one period are two lines, not one.

    The grouping key is the service, its rate and its discount, which is right for people
    and machines: there a line is one month of one subscription, and ten of them are ten
    identical things worth folding together. A company service is sold by its own quantity,
    so 5 TB until the 16th and 8 TB after it folded into a single line whose description
    could only name one of the two sizes — and named whichever was read last.
    """

    def test_customer_quantity_change_creates_distinct_invoice_lines(self):
        start, end = self.month()
        self.resized(start)
        run = self.drawn(start=start, end=end)

        grouped = self.groups_of(run)
        said = [item.description for item in self.invoiced(run).items]

        self.assertEqual(len(grouped), 2)
        self.assertEqual({bucket["units"] for bucket in grouped.values()}, {5.0, 8.0})
        self.assertTrue(any(f"5 {self.unit} \u00d7" in line for line in said), said)
        self.assertTrue(any(f"8 {self.unit} \u00d7" in line for line in said), said)

    def test_customer_invoice_preserves_uom_and_period(self):
        start, end = self.month()
        self.resized(start)

        invoice = self.invoiced(self.drawn(start=start, end=end))

        for item in invoice.items:
            # the invoice counts every line in months; the units are said in the description
            self.assertEqual(item.uom, "Month")
            self.assertEqual(flt_round(item.conversion_factor), 1.0)
            self.assertIn(str(start), item.description)
            self.assertIn(str(end), item.description)
            self.assertIn(self.unit, item.description)
            # a line about the company has no headcount behind it
            self.assertFalse(item.get("msp_billed_count"))

    def test_customer_invoice_total_matches_frozen_run(self):
        start, end = self.month()
        self.resized(start)
        run = self.drawn(start=start, end=end)

        invoice = self.invoiced(run)
        frozen = frappe.db.get_value(RUN, run, "total_amount")

        self.assertEqual(len(invoice.items), 2)
        self.assertAlmostEqual(flt_round(invoice.net_total), flt_round(frozen), places=2)

    def test_existing_user_device_invoice_grouping_unchanged(self):
        """Two people on the same subscription at the same rate stay one line."""
        start, end = self.month()
        service = self.offering("CUSR", scope="User", rate=20.0)
        bob = self.make_person(self.customer, "Bob")
        self.running(service, client_user=self.john)
        self.running(service, client_user=bob)
        run = self.drawn(start=start, end=end)

        grouped = self.groups_of(run)
        (key, bucket) = next(iter(grouped.items()))

        self.assertEqual(len(grouped), 1)
        self.assertEqual(bucket["targets"], 2)
        self.assertEqual(bucket["scopes"], {"User"})
        # nothing about a person's line is keyed by the assignment it came from
        self.assertIsNone(key[3])

        item = self.invoiced(run).items[0]

        self.assertEqual(item.msp_billed_count, 2)
        self.assertNotIn(" \u2014 ", item.description)


class TestACompanyPeriodIsBilledOnce(CompanyBillingCase):
    """What a posted run does to the next one, against a posted run.

    The engine cuts out the days an assignment is already covered for, and nothing about
    that reading is special to a company service. It had never been checked on one: the
    only test that claimed it compared two previews, which write nothing at all.
    """

    def test_a_period_already_billed_is_not_billed_again(self):
        start, end = self.month()
        self.opened()
        first = self.posted(start, end)

        again = self.drawn(start=start, end=end)

        self.assertGreater(sum(flt(row.billable_months) for row in self.mine(first)), 0)
        self.assertEqual(sum(flt(row.billable_months) for row in self.mine(again)), 0)

    def test_a_decrease_bills_the_smaller_quantity_for_the_rest_of_the_period(self):
        start, end = self.month()
        middle = self.resized(start, was=8, now=5)

        rows = self.mine(self.drawn(start=start, end=end))

        self.assertEqual([flt(row.quantity) for row in rows], [8.0, 5.0])
        self.assertEqual(str(rows[1].covered_from), middle)
        self.assertEqual(str(rows[0].covered_to), str(frappe.utils.add_days(middle, -1)))

    def test_a_credit_gives_back_only_the_company_period_it_names(self):
        start, end = self.month()
        assignment = self.opened()
        charge = self.posted(start, end)
        billed = self.mine(charge)[0]

        note = BillingService.create_credit_note(
            name=charge,
            reason="ZZTEST company credit",
            lines=[
                {
                    "service_assignment": assignment,
                    "from": str(billed.covered_from),
                    "to": str(billed.covered_to),
                }
            ],
            only_unserved=False,
        )["name"]
        self.track(RUN, note)
        given_back = self.mine(note)

        self.assertEqual(len(given_back), 1)
        self.assertEqual(flt(given_back[0].quantity), 5.0)
        self.assertAlmostEqual(
            flt_round(given_back[0].amount), -flt_round(billed.amount), places=2
        )

    def test_a_discount_on_the_company_line_reaches_the_invoice(self):
        start, end = self.month()
        assignment = self.opened()
        run = self.drawn(start=start, end=end)
        BillingService.set_line_discount(
            name=run, service_assignment=assignment, discount_percent=20
        )

        item = self.invoiced(run).items[0]

        self.assertEqual(flt(item.discount_percentage), 20.0)
        self.assertAlmostEqual(flt_round(item.rate), 80.0, places=2)
        self.assertIn(f"5 {self.unit}", item.description)

    def test_the_period_is_cut_where_the_service_opened(self):
        """A company service opened mid-month is billed from that day, not from the first."""
        start, end = self.month()
        opened_on = frappe.utils.add_days(frappe.utils.getdate(start), 10)
        self.track(
            ASSIGNMENT,
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=self.storage,
                target_scope="Customer",
                effective_date=str(opened_on),
                quantity=5,
            )["name"],
        )
        frappe.db.commit()

        rows = self.mine(self.drawn(start=start, end=end))

        self.assertEqual(len(rows), 1)
        self.assertEqual(str(rows[0].covered_from), str(opened_on))
        self.assertLess(flt(rows[0].billable_months), 1.0)

    def test_nothing_is_billed_to_the_company_past_its_contract(self):
        """The agreement is the boundary, and the run says so rather than cutting it."""
        start, end = self.month()
        ends_on = frappe.utils.add_days(frappe.utils.getdate(start), 14)
        self.opened()
        frappe.db.set_value("MSP Contract", self.contract, "end_date", str(ends_on))
        frappe.db.commit()

        with self.assertRaises(ValidationError) as refused:
            self.drawn(start=start, end=end)

        self.assertIn(str(ends_on), str(refused.exception))

        # the part the contract does cover is billed, and only that part
        rows = self.mine(self.drawn(start=start, end=str(ends_on)))

        self.assertEqual(len(rows), 1)
        self.assertEqual(str(rows[0].covered_to), str(ends_on))
        self.assertLess(flt(rows[0].billable_months), 1.0)

    def test_two_runs_over_two_months_bill_each_month_once(self):
        """The double-accounting question, asked across periods rather than within one."""
        self.opened()
        first_start, first_end = self.month(back=3)
        second_start, second_end = self.month(back=2)

        first = self.posted(first_start, first_end)
        second = self.posted(second_start, second_end)

        self.assertEqual(flt_round(sum(flt(row.billable_months) for row in self.mine(first))), 1.0)
        self.assertEqual(flt_round(sum(flt(row.billable_months) for row in self.mine(second))), 1.0)
        self.assertEqual(
            frappe.db.count("MSP Billing Run Line", {"service_item": self.storage, "parent": first}),
            1,
        )


class TestARequestForACompanyService(ExecutionCase):
    """Asked for in the portal, planned, and carried out onto the company.

    Everything after the line was already built for it — the request line and the work
    order both accept a company target, and execution hands whatever scope it is given
    straight to the service domain. The way in was the one thing missing: a line for a
    company service was refused outright, with "say who it is for, or which machine",
    which is the question a company service has no answer to.
    """

    def company_line(self, service, **fields):
        return self.line(service, target_scope="Customer", client_user=None, **fields)

    def test_the_line_is_about_the_company_and_names_nobody(self):
        service = self.offering("CREQ1", scope="Customer")
        request = self.approved(self.company_line(service))

        row = frappe.get_all(
            "MSP Request Line",
            filters={"parent": request},
            fields=["target_scope", "client_user", "managed_device", "requested_service"],
        )[0]

        self.assertEqual(row.target_scope, "Customer")
        self.assertEqual(row.requested_service, service)
        self.assertFalse(row.client_user)
        self.assertFalse(row.managed_device)

    def test_the_work_order_planned_for_it_carries_the_company_scope(self):
        service = self.offering("CREQ2", scope="Customer")
        request = self.approved(self.company_line(service))

        order = self.work(request, "Service Action")

        self.assertEqual(order.target_scope, "Customer")
        self.assertEqual(order.action, "Add")

    def test_carrying_it_out_opens_the_assignment_on_the_company(self):
        service = self.offering("CREQ3", scope="Customer")
        request = self.approved(self.company_line(service))
        order = self.work(request, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=order.name)
        )
        self.sweep(request)

        opened = frappe.get_all(
            ASSIGNMENT,
            filters={"source_request": request},
            fields=["name", "assignment_scope", "client_user", "managed_device", "customer"],
        )

        self.assertEqual(len(opened), 1)
        self.assertEqual(opened[0].assignment_scope, "Customer")
        self.assertEqual(opened[0].customer, self.customer)
        self.assertFalse(opened[0].client_user)
        self.assertFalse(opened[0].managed_device)
        self.assertEqual(self.state(order.name), "Completed")

    def test_a_company_service_asked_for_against_a_person_is_still_the_company_s(self):
        """A payload naming somebody does not make the company's service theirs."""
        service = self.offering("CREQ4", scope="Customer")
        request = self.approved(self.line(service, client_user=self.john))

        row = frappe.get_all(
            "MSP Request Line",
            filters={"parent": request},
            fields=["target_scope", "client_user", "subject_key"],
        )[0]

        self.assertEqual(row.target_scope, "Customer")
        self.assertFalse(row.client_user)
        self.assertFalse(row.subject_key)

    def offered_company(self, service):
        """What the actions step is given when nobody is selected at all."""
        from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

        answer = self.as_user(
            self.asker,
            lambda: RequestScopeService.operation_options(
                customer=self.customer, subjects="[]", subject_keys="[]"
            ),
        )
        company = next(
            (domain for domain in answer["domains"] if domain["key"] == "Company"), None
        )

        self.assertIsNotNone(company, "the company domain was not offered")

        card = next(
            (row for row in company["options"] if row["object_key"] == service), None
        )

        self.assertIsNotNone(card, f"{service} was not offered to the company")

        return card

    def test_the_actions_step_offers_it_with_nobody_selected(self):
        """A request about the company has no people in it, and used to be refused outright."""
        service = self.offering("CREQ6", scope="Customer")

        card = self.offered_company(service)
        adding = next(
            row for row in card["actions"] if row["operation_code"] == "service.add"
        )

        self.assertEqual(card["service_scope"], "Customer")
        self.assertEqual(len(adding["targets"]), 1)
        self.assertEqual(adding["targets"][0]["target_scope"], "Customer")
        self.assertIsNone(adding["targets"][0]["client_user"])

    def test_a_company_request_sent_from_the_portal_opens_it_at_the_asked_quantity(self):
        service = self.offering("CREQ7", scope="Customer")
        card = self.offered_company(service)
        adding = next(
            row for row in card["actions"] if row["operation_code"] == "service.add"
        )
        group = {
            "group_key": "company-1",
            "operation_code": "service.add",
            "operation_label_snapshot": adding["operation_label_snapshot"],
            # a service group like any other: what makes it the company's is its target
            "domain": "Service",
            "service_item": service,
            "source_scope_type": "All",
            "source_scope_key": None,
            "source_scope_label": "All selected",
            "selected_subject_count": 0,
            "targets": [{**adding["targets"][0], "requested_quantity": 5}],
            "exclusions": [],
        }

        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                subjects=[],
                requested_devices=[],
                action_groups=[group],
            ),
        )
        request = self.track("MSP Request", out["name"])

        self.tech_does(lambda: RequestService.run_action(name=request, action="start_review"))

        for row in frappe.get_doc("MSP Request", request).lines:
            self.tech_does(
                lambda idx=row.idx: RequestService.set_line_status(
                    name=request, idx=idx, line_status="Approved"
                )
            )

        self.tech_does(lambda: RequestService.run_action(name=request, action="approve"))
        self.sweep(request)

        order = self.work(request, "Service Action")
        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=order.name)
        )
        self.sweep(request)

        opened = frappe.get_all(
            ASSIGNMENT,
            filters={"source_request": request},
            fields=["assignment_scope", "quantity", "client_user", "managed_device"],
        )

        self.assertEqual(len(opened), 1)
        self.assertEqual(opened[0].assignment_scope, "Customer")
        self.assertEqual(flt_round(opened[0].quantity), 5.0)
        self.assertFalse(opened[0].client_user)
        self.assertFalse(opened[0].managed_device)

    def test_the_review_screen_can_present_a_request_with_nobody_in_it(self):
        """The last step reads the draft back through the server; it had no people to read."""
        from nexgen_msp.api.internal.services.request_presentation_service import (
            RequestPresentationService,
        )

        service = self.offering("CREQ8", scope="Customer")
        card = self.offered_company(service)
        adding = next(
            row for row in card["actions"] if row["operation_code"] == "service.add"
        )
        group = {
            "group_key": "company-2",
            "operation_code": "service.add",
            "operation_label_snapshot": adding["operation_label_snapshot"],
            "domain": "Service",
            "service_item": service,
            "source_scope_type": "All",
            "source_scope_key": None,
            "source_scope_label": "All selected",
            "selected_subject_count": 0,
            "targets": [{**adding["targets"][0], "requested_quantity": 5}],
            "exclusions": [],
        }

        shown = self.as_user(
            self.asker,
            lambda: RequestPresentationService.for_draft(
                customer=self.customer, subjects=[], requested_devices=[], action_groups=[group]
            ),
        )

        (group_shown,) = shown["action_groups"]
        (target,) = group_shown["targets"]

        self.assertEqual(group_shown["context_label"], "Company service")
        self.assertEqual(group_shown["impact_label"], "the company itself")
        # the company holds it, and reading it as somebody's was the whole problem
        self.assertEqual(target["target_kind"], "customer")
        self.assertIn("Company", target["target_label"])
        self.assertIsNone(target["person_label"])
        self.assertEqual(shown["summary"]["people"], 0)

    def test_a_personal_service_still_has_to_say_who_it_is_for(self):
        """Nothing about the refusal that was there before may be lost."""
        service = self.offering("CREQ5", scope="User")

        with self.assertRaises(ServiceRefused):
            self.approved(self.line(service, client_user=None))
