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

    def test_a_company_service_is_never_offered_on_a_persons_card(self):
        """The one door the form actually calls, which the scoped read is not.

        Both tests above ask `_offered` for one scope at a time and are answered correctly.
        The builder reads the catalogue once for every scope and sorts the cards itself, so
        a service sold to the company arrived on the people's card — offered to two people
        who can never hold it.
        """
        from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

        personal = self.make_service(f"PS1{self.tag}", scope="User")
        self.cover_service(self.customer, personal, rate=10.0)
        person = self.make_person(self.customer, "Alice")
        card = frappe.db.get_value(
            "MSP Client User", person, ["full_name", "department", "email"], as_dict=True
        )

        options = RequestScopeService.operation_options(
            customer=self.customer,
            subjects=[
                {
                    "subject_key": f"user:{person}",
                    "client_user": person,
                    "full_name": card.full_name,
                    "department": card.department,
                    "email": card.email,
                    "added_via": "Existing",
                }
            ],
        )
        domains = {domain["key"]: domain for domain in options["domains"]}
        offered = domains["Service"]["options"]

        self.assertIn(personal, [option["object_key"] for option in offered])
        self.assertNotIn(self.retainer, [option["object_key"] for option in offered])
        # and nothing else sold to a company is there either, whatever it is called
        self.assertEqual(
            [option["object_key"] for option in offered if option["service_scope"] == "Customer"],
            [],
        )
        # it is offered where it belongs, and only there
        self.assertIn(
            self.retainer, [option["object_key"] for option in domains["Company"]["options"]]
        )

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

    def test_a_technician_may_open_the_service_but_not_price_it(self):
        """Opening a service is operational. Putting a price on it by hand is not.

        Every internal account could pass a manual rate here, because the door asked only
        whether the caller was staff — and a manual rate is the one number Billing takes
        literally, reason on file or not.
        """
        technician = self.make_account("internal", "MSP Technician", suffix=f"tk{self.tag[:3]}")
        frappe.set_user(technician)

        try:
            with self.assertRaises(Exception) as refused:
                self.door().assign_service(
                    customer=self.customer,
                    service_item=self.retainer,
                    effective_date="2026-01-01",
                    quantity=5,
                    agreed_rate=36.0,
                    rate_override_reason="Agreed on the telephone",
                )

            # the same act without a price of its own is theirs to carry out
            self.door().assign_service(
                customer=self.customer,
                service_item=self.retainer,
                effective_date="2026-01-01",
                quantity=5,
            )
        finally:
            frappe.set_user("Administrator")

        opened = frappe.get_all(
            ASSIGNMENT,
            filters={"customer": self.customer, "service_item": self.retainer},
            fields=["name", "price_source"],
        )

        for row in opened:
            self.track(ASSIGNMENT, row.name)

        self.assertIn("PERMISSION", str(getattr(refused.exception, "code", "")).upper())
        self.assertEqual(len(opened), 1)
        self.assertEqual(opened[0].price_source, "Contract")

    def test_an_administrator_may_price_it(self):
        self.door().assign_service(
            customer=self.customer,
            service_item=self.retainer,
            effective_date="2026-01-01",
            quantity=5,
            agreed_rate=36.0,
            rate_override_reason="Agreed at signature",
        )

        opened = frappe.get_all(
            ASSIGNMENT,
            filters={"customer": self.customer, "service_item": self.retainer},
            fields=["name", "price_source", "agreed_rate"],
        )

        for row in opened:
            self.track(ASSIGNMENT, row.name)

        self.assertEqual(opened[0].price_source, "Manual Override")
        self.assertEqual(flt_round(opened[0].agreed_rate), 36.0)

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

    def held_periods(self):
        """Every period of the company's retainer, oldest first, with its commercial terms."""
        rows = frappe.get_all(
            ASSIGNMENT,
            filters={"customer": self.customer, "service_item": self.retainer},
            fields=[
                "name",
                "quantity",
                "agreed_rate",
                "price_source",
                "rate_override_reason",
                "operational_status",
            ],
            order_by="effective_start_date asc",
        )

        for row in rows:
            self.track(ASSIGNMENT, row.name)

        return rows

    def test_a_prepared_service_the_company_never_got_is_cancelled(self):
        """A service waiting for setup is dropped, not ended.

        The company page offered End service for one of those, and the engine refused the
        transition: nothing was ever provided, so there is nothing to stop providing. The
        act it needed was the one the engine already had, and this door did not list it.
        """
        prepared = self.track(
            ASSIGNMENT,
            ServiceLifecycleService.create_pending(
                customer=self.customer,
                service_item=self.retainer,
                target_scope="Customer",
                effective_date="2026-01-01",
                quantity=5,
            )["name"],
        )

        self.door().change_service(assignment=prepared, action="Cancel")

        self.assertEqual(
            frappe.db.get_value(ASSIGNMENT, prepared, "operational_status"), "Cancelled"
        )

    def test_a_running_service_is_ended_and_never_cancelled(self):
        held = self.open_one(quantity=5)

        # the refusal has to be the engine's own — the door used to answer that it had
        # never heard of the act, which said nothing about the state of this service
        with self.assertRaisesRegex(ValidationError, "waiting for setup"):
            self.door().change_service(assignment=held, action="Cancel")

        # and it is still being provided, because a refused act changes nothing
        self.assertEqual(
            frappe.db.get_value(ASSIGNMENT, held, "operational_status"), "Active"
        )

    def test_a_disabled_company_is_not_sold_a_service_through_the_api(self):
        """The catalogue refuses to offer one. The door is not the screen, and must refuse too.

        The reading was the only thing standing in the way, so a direct call to the API
        opened a new service for a company nobody sells to any more.
        """
        frappe.db.set_value("Customer", self.customer, "disabled", 1)

        self.assertIn("disabled", self.reading()["target_reason"] or "")

        with self.assertRaises(ValidationError):
            self.door().assign_service(
                customer=self.customer,
                service_item=self.retainer,
                effective_date="2026-01-01",
                quantity=5,
            )

        self.assertFalse(
            frappe.get_all(
                ASSIGNMENT, filters={"customer": self.customer}, pluck="name"
            ),
            "nothing was opened behind the refusal",
        )

    def test_the_change_door_carries_a_new_rate_and_the_reason_for_it(self):
        held = self.open_one(quantity=5, agreed_rate=42.0, rate_override_reason="Signed at 42")

        self.door().change_service(
            assignment=held,
            action="Change",
            effective_date="2026-03-01",
            quantity=5,
            agreed_rate=36.0,
            rate_override_reason="Renegotiated for the renewal",
        )

        periods = self.held_periods()

        self.assertEqual([flt_round(row.agreed_rate) for row in periods], [42.0, 36.0])
        self.assertEqual(periods[1].price_source, "Manual Override")
        self.assertEqual(periods[1].rate_override_reason, "Renegotiated for the renewal")
        # the period already invoiced keeps the rate its invoice was drawn on
        self.assertEqual(periods[0].rate_override_reason, "Signed at 42")

    def test_the_change_door_refuses_a_new_rate_with_no_reason(self):
        held = self.open_one(quantity=5, agreed_rate=42.0, rate_override_reason="Signed at 42")

        with self.assertRaises(ValidationError):
            self.door().change_service(
                assignment=held,
                action="Change",
                effective_date="2026-03-01",
                quantity=5,
                agreed_rate=36.0,
            )

        # the running period is untouched: a refused change changes nothing
        self.assertEqual(
            frappe.db.get_value(ASSIGNMENT, held, "operational_status"), "Active"
        )
        self.assertEqual(len(self.held_periods()), 1)

    def test_a_service_priced_off_the_contract_may_be_agreed_at_nothing(self):
        """Zero is a rate. It was read as no rate at all, and the change refused outright.

        A service billed at the contract rate has no rate of its own on file, so agreeing
        it at nothing compared zero against zero and answered that nothing would change.
        """
        held = self.open_one(quantity=5)

        self.assertEqual(frappe.db.get_value(ASSIGNMENT, held, "price_source"), "Contract")

        self.door().change_service(
            assignment=held,
            action="Change",
            effective_date="2026-03-01",
            quantity=5,
            agreed_rate=0,
            rate_override_reason="Included in the renewal",
        )

        periods = self.held_periods()

        self.assertEqual(len(periods), 2)
        self.assertEqual(periods[1].price_source, "Manual Override")
        self.assertEqual(flt_round(periods[1].agreed_rate), 0.0)
        # and the period that was billed off the contract still says so
        self.assertEqual(periods[0].price_source, "Contract")

    def test_a_service_priced_off_the_contract_may_be_agreed_at_a_rate_of_its_own(self):
        held = self.open_one(quantity=5)

        self.door().change_service(
            assignment=held,
            action="Change",
            effective_date="2026-03-01",
            quantity=5,
            agreed_rate=36.0,
            rate_override_reason="Agreed with the customer",
        )

        periods = self.held_periods()

        self.assertEqual(len(periods), 2)
        self.assertEqual(flt_round(periods[1].agreed_rate), 36.0)
        self.assertEqual(periods[1].price_source, "Manual Override")

    def test_a_quantity_change_through_the_door_keeps_the_rate_agreed_by_hand(self):
        held = self.open_one(quantity=5, agreed_rate=42.0, rate_override_reason="Signed at 42")

        self.door().change_service(
            assignment=held, action="Change", effective_date="2026-03-01", quantity=8
        )

        periods = self.held_periods()

        self.assertEqual([flt_round(row.quantity) for row in periods], [5.0, 8.0])
        self.assertEqual(flt_round(periods[1].agreed_rate), 42.0)
        self.assertEqual(periods[1].price_source, "Manual Override")


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

    def take_more(self, quantity, now):
        """A period opened at one quantity, paid for, then resized halfway through."""
        start, end = self.month()
        first = self.opened(quantity=quantity)
        self.posted(start, end)
        middle = frappe.utils.add_days(frappe.utils.getdate(start), 15)

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

        return first, start, end, middle

    def test_a_change_after_the_days_were_billed_charges_only_what_was_added(self):
        """A month paid at five, then the company takes eight halfway through.

        Issue #33: only the added quantity and time is charged, and the coverage already
        issued stays where it is. Charging the eight again over days paid for at five is
        charging five of them twice.
        """
        first, start, end, middle = self.take_more(5, 8)

        rows = self.mine(self.drawn(start=start, end=end))
        added = [row for row in rows if row.service_assignment != first]

        self.assertEqual(
            [flt(row.quantity) for row in added],
            [3.0],
            f"three units were added, not eight: {[(flt(row.quantity), str(row.covered_from)) for row in rows]}",
        )
        self.assertGreater(
            flt(added[0].billable_months), 0, "the added units are charged for the rest of it"
        )
        self.assertEqual(
            sum(flt(row.billable_months) for row in rows if row.service_assignment == first),
            0,
            "the period already paid for owes nothing more",
        )

    def test_taking_units_away_over_paid_days_charges_nothing_more(self):
        """Money owed back is given back by somebody, not quietly billed as a negative."""
        first, start, end, _middle = self.take_more(8, 5)

        rows = self.mine(self.drawn(start=start, end=end))

        self.assertEqual(
            sum(flt(row.billable_months) for row in rows),
            0,
            f"nothing further is owed: {[(flt(row.quantity), flt(row.billable_months)) for row in rows]}",
        )
        self.assertTrue(
            all(flt(row.amount) >= 0 for row in rows), "no run writes a credit by itself"
        )

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

class TestWhatIsNotSoldToTheCompany(CustomerScopeCase):
    """"Both" names a person or a machine, and has never named the company.

    Adding Customer to the scopes a service may be provided at widened the one test that
    read "Both" as "anywhere": a service sold per person or per machine became sellable to
    the company itself, which no catalogue entry ever said.
    """

    def setUp(self):
        super().setUp()
        self.either = self.make_service(f"BTH{self.tag}", scope="Both")
        self.cover_service(self.customer, self.either, rate=20.0)

    def test_a_per_user_or_per_device_service_is_refused_at_company_scope(self):
        with self.assertRaises(ValidationError) as caught:
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=self.either,
                target_scope="Customer",
                effective_date="2026-01-01",
                quantity=1,
            )

        self.assertIn("cannot be assigned at Customer scope", str(caught.exception))

    def test_it_is_still_provided_to_a_person_exactly_as_before(self):
        person = self.make_person(self.customer, "Alice")
        opened = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.either,
            target_scope="User",
            client_user=person,
            effective_date="2026-01-01",
            quantity=1,
        )

        self.assertTrue(self.track(ASSIGNMENT, opened["name"]))

    def test_the_record_refuses_it_whatever_door_writes_it(self):
        """The service layer is one door; a script writing the document itself is another."""
        doc = frappe.get_doc(
            {
                "doctype": ASSIGNMENT,
                "customer": self.customer,
                "service_item": self.either,
                "assignment_scope": "Customer",
                "operational_status": "Active",
                "effective_start_date": "2026-01-01",
                "quantity": 1,
            }
        )

        with self.assertRaises(frappe.ValidationError):
            doc.insert(ignore_permissions=True)


class TestARequestActsOnTheServiceItNames(CustomerScopeCase):
    """A line says what it acts on, and the record has to agree with it.

    A person's service is identified by the person named beside it, so a line pointing at
    the wrong one is caught by that name. The company has no such name: the scope and the
    service are the whole of the identity, and without checking them a line raised about
    the company could carry out its act on somebody's service instead.
    """

    def setUp(self):
        super().setUp()
        self.person = self.make_person(self.customer, "Alice")
        self.personal = self.make_service(f"PRS{self.tag}", scope="User")
        self.cover_service(self.customer, self.personal, rate=15.0)
        self.hers = self.track(
            ASSIGNMENT,
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=self.personal,
                target_scope="User",
                client_user=self.person,
                effective_date="2026-01-01",
                quantity=1,
            )["name"],
        )

    def asking(self, **over):
        line = {
            "doctype": "MSP Request Line",
            "action": "Remove",
            "operation_code": "service.end",
            "target_scope": "Customer",
            "requested_service": self.retainer,
        }
        line.update(over)
        doc = frappe.get_doc(
            {
                "doctype": "MSP Request",
                "customer": self.customer,
                "request_type": "Change",
                # a draft is not checked: it is still being written, and the rules this
                # exercises are the ones that run when it is sent
                "status": "Submitted",
                "requester": frappe.session.user,
                "lines": [line],
            }
        )
        doc.insert(ignore_permissions=True)

        return self.track("MSP Request", doc.name)

    def test_a_company_line_may_not_act_on_a_persons_service(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            self.asking(source_service_assignment=self.hers)

        self.assertIn("scope", str(caught.exception).lower())

    def test_a_line_may_not_name_one_service_and_act_on_another(self):
        company = self.open_one()
        other = self.make_service(f"OTH{self.tag}", scope="Customer")
        self.cover_service(self.customer, other, rate=50.0)

        with self.assertRaises(frappe.ValidationError):
            self.asking(source_service_assignment=company, requested_service=other)

    def test_a_change_may_still_put_the_period_onto_another_service(self):
        """The one act that is allowed to name a service the period does not hold."""
        company = self.open_one()
        other = self.make_service(f"SWP{self.tag}", scope="Customer")
        self.cover_service(self.customer, other, rate=50.0)

        self.assertTrue(
            self.asking(
                action="Change",
                operation_code="service.change",
                source_service_assignment=company,
                requested_service=other,
            )
        )

    def test_the_line_that_names_its_own_service_is_accepted(self):
        company = self.open_one()

        self.assertTrue(self.asking(source_service_assignment=company))

    def test_the_same_company_service_may_not_be_asked_for_twice_at_once(self):
        """Nothing identifies the company target but the customer and the scope."""
        first = self.asking(
            action="Add", operation_code="service.add", source_service_assignment=None
        )
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError) as caught:
            self.asking(
                action="Add", operation_code="service.add", source_service_assignment=None
            )

        self.assertIn(first, str(caught.exception))


class TestACompanyServiceClosedForLater(CustomerScopeCase):
    """A period closed for a day still to come is being provided until that day.

    The portal read the stored status, which already says Ended the moment somebody dates
    the close. The service then vanished from what the company holds, and was offered for
    sale again over days it is still being provided over.
    """

    def setUp(self):
        super().setUp()
        self.held = self.open_one()
        self.later = frappe.utils.add_days(frappe.utils.today(), 20)
        # the state a close dated ahead leaves on the record. Only a request may date one
        # for later, and what is exercised here is how that state is read, not how it is
        # reached
        frappe.db.set_value(
            ASSIGNMENT,
            self.held,
            {"operational_status": "Ended", "effective_end_date": self.later},
            update_modified=False,
        )
        frappe.db.commit()

    def test_the_company_still_holds_it_until_that_day(self):
        from nexgen_msp.api.portal.services import request_scope_service

        running = request_scope_service._company_open(self.customer)

        self.assertIn(self.retainer, running)
        self.assertEqual(running[self.retainer]["status"], "Active")
        self.assertTrue(running[self.retainer]["dated_change"])

    def test_nothing_further_is_offered_on_it_until_the_day_comes(self):
        """The lifecycle would refuse a second close, so the portal must not offer one."""
        from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

        # the builder is always asked about somebody; the company's own card is built
        # beside the people's, and it is that card this reads
        person = self.make_person(self.customer, "Alice")
        card = frappe.db.get_value(
            "MSP Client User", person, ["full_name", "department", "email"], as_dict=True
        )
        options = RequestScopeService.operation_options(
            customer=self.customer,
            subjects=[
                {
                    "subject_key": f"user:{person}",
                    "client_user": person,
                    "full_name": card.full_name,
                    "department": card.department,
                    "email": card.email,
                    "added_via": "Existing",
                }
            ],
        )
        company = next(
            (domain for domain in options["domains"] if domain["key"] == "Company"), None
        )
        offered = [] if not company else [
            code
            for option in company["options"]
            if option["object_key"] == self.retainer
            for code in [action["operation_code"] for action in option["actions"]]
        ]

        self.assertEqual(offered, [], "a change is already dated on it")

    def test_the_internal_screen_does_not_offer_to_sell_it_again(self):
        from nexgen_msp.api.internal.services.service_availability_service import (
            ServiceAvailabilityService,
        )

        answer = ServiceAvailabilityService._answer(
            self.customer, "Customer", None, "The company", None
        )

        self.assertIn(self.retainer, [row["service_item"] for row in answer["current"]])
        self.assertNotIn(
            self.retainer, [row["service_item"] for row in answer["available"]]
        )

class TestAReplacementSaysWhatItReplaced(CompanyBillingCase):
    """Issue #33 R2.1: the handover is written down, not read off the calendar.

    A change of terms and a service that stopped and was sold again leave the same shape —
    one period ending, another starting the next day — and the two owe entirely different
    things. Only the record can tell them apart.
    """

    def test_a_change_records_the_period_it_took_over_from(self):
        first = self.opened(quantity=5)
        ServiceLifecycleService.change(
            assignment=first, effective_date=frappe.utils.today(), quantity=8
        )
        frappe.db.commit()

        successors = frappe.get_all(
            ASSIGNMENT,
            filters={"replaces_assignment": first},
            fields=["name", "quantity"],
        )

        for row in successors:
            self.track(ASSIGNMENT, row.name)

        self.assertEqual(len(successors), 1)
        self.assertEqual(flt(successors[0].quantity), 8.0)
        self.assertTrue(BillingService._was_replaced(first))

    def test_a_service_sold_again_the_next_day_is_not_a_change(self):
        """F33-H2: the calendar cannot tell a change from a resale, so it is not asked.

        A service ended on the fifteenth and sold again on the sixteenth leaves exactly the
        shape a change leaves. Read as a replacement, the new sale inherits the old one's
        paid days and nobody is charged for them.
        """
        start, end = self.month()
        first = self.opened(quantity=5)
        self.posted(start, end)
        middle = frappe.utils.add_days(frappe.utils.getdate(start), 15)

        ServiceLifecycleService.end(assignment=first, effective_date=str(middle))
        frappe.db.commit()
        again = self.track(
            ASSIGNMENT,
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=self.storage,
                target_scope="Customer",
                effective_date=str(frappe.utils.add_days(middle, 1)),
                quantity=5,
            )["name"],
        )

        self.assertIsNone(
            frappe.db.get_value(ASSIGNMENT, again, "replaces_assignment"),
            "nobody said it replaced anything, because it did not",
        )
        self.assertEqual(
            BillingService._period_chain(
                frappe.get_doc(ASSIGNMENT, again).as_dict(), self.customer
            ),
            [],
            "a new sale carries no paid coverage from the period before it",
        )

    def test_a_service_that_simply_stopped_says_nothing_of_the_kind(self):
        first = self.opened(quantity=5)
        ServiceLifecycleService.end(assignment=first, effective_date=frappe.utils.today())
        frappe.db.commit()

        self.assertFalse(
            BillingService._was_replaced(first),
            "nothing took it over, so it stopped — and what it owes back is the unused days",
        )


class TestWhatAChangeOwesBack(CompanyBillingCase):
    """Issue #33, F33-02 and F33-04: a change that lowers the terms owes the difference back.

    The run proposes it and stops there. A credit note is somebody's decision, taken in the
    flow that already exists for them, and no billing run has ever refunded anybody by
    itself — which is also why a decrease charges nothing further on the debit side.
    """

    def setUp(self):
        super().setUp()
        # every scenario here is about days the customer has already paid for, which only
        # exist where the contract bills ahead of serving
        frappe.db.set_value("MSP Contract", self.contract, "billing_timing", "In Advance")
        frappe.db.commit()

    def owed(self, run):
        return [
            {
                "assignment": row["service_assignment"],
                "months": flt((row.get("owed_back") or {}).get("months") or 0),
                "replaced": bool((row.get("owed_back") or {}).get("replaced")),
            }
            for row in BillingService.creditable_lines(run)["lines"]
            if row.get("service_item") == self.storage
        ]

    def test_taking_units_away_owes_back_only_the_units_taken(self):
        start, end = self.month()
        first = self.opened(quantity=8)
        run = self.posted(start, end)
        middle = frappe.utils.add_days(frappe.utils.getdate(start), 15)

        ServiceLifecycleService.change(assignment=first, effective_date=str(middle), quantity=5)
        frappe.db.commit()

        for row in frappe.get_all(
            ASSIGNMENT, filters={"customer": self.customer, "service_item": self.storage}, pluck="name"
        ):
            self.track(ASSIGNMENT, row)

        proposed = next(row for row in self.owed(run) if row["assignment"] == first)
        line = next(
            row
            for row in BillingService.get_run(run)["lines"]
            if row["service_assignment"] == first
        )
        # three of the eight units, over the days the five-unit period is serving
        share = BillingService._unused_share(
            line["proration_method"], [(middle, frappe.utils.getdate(end))]
        )

        self.assertTrue(proposed["replaced"], "the service did not stop; its terms moved")
        self.assertAlmostEqual(proposed["months"], round(share * 3 / 8, 3), places=2)

    def test_a_lower_price_owes_back_the_price_difference(self):
        start, end = self.month()
        first = self.opened(quantity=5)
        run = self.posted(start, end)
        middle = frappe.utils.add_days(frappe.utils.getdate(start), 15)
        was = flt(
            next(
                row
                for row in BillingService.get_run(run)["lines"]
                if row["service_assignment"] == first
            )["unit_rate"]
        )

        ServiceLifecycleService.change(
            assignment=first,
            effective_date=str(middle),
            agreed_rate=was / 2,
            rate_override_reason="Agreed reduction for the rest of the period",
        )
        frappe.db.commit()

        for row in frappe.get_all(
            ASSIGNMENT, filters={"customer": self.customer, "service_item": self.storage}, pluck="name"
        ):
            self.track(ASSIGNMENT, row)

        proposed = next(row for row in self.owed(run) if row["assignment"] == first)
        share = BillingService._unused_share(
            next(
                row
                for row in BillingService.get_run(run)["lines"]
                if row["service_assignment"] == first
            )["proration_method"],
            [(middle, frappe.utils.getdate(end))],
        )

        # half the price over those days, so half of what they were charged at
        self.assertAlmostEqual(proposed["months"], round(share / 2, 3), places=2)

    def test_a_rate_of_nothing_is_a_rate_somebody_chose(self):
        """F33-H3: zero is a price, not a missing one.

        Read for truthiness, an agreed rate of nothing falls back to the old rate and the
        change reads as costing the same — so a service given away for the rest of the
        period proposes no credit at all.
        """
        start, end = self.month()
        first = self.opened(quantity=5)
        run = self.posted(start, end)
        middle = frappe.utils.add_days(frappe.utils.getdate(start), 15)

        ServiceLifecycleService.change(
            assignment=first,
            effective_date=str(middle),
            agreed_rate=0,
            rate_override_reason="Given at no charge for the rest of the period",
        )
        frappe.db.commit()

        for row in frappe.get_all(
            ASSIGNMENT, filters={"customer": self.customer, "service_item": self.storage}, pluck="name"
        ):
            self.track(ASSIGNMENT, row)

        proposed = next(row for row in self.owed(run) if row["assignment"] == first)
        share = BillingService._unused_share(
            next(
                row
                for row in BillingService.get_run(run)["lines"]
                if row["service_assignment"] == first
            )["proration_method"],
            [(middle, frappe.utils.getdate(end))],
        )

        # nothing is being charged for those days, so the whole of what they cost is owed
        self.assertAlmostEqual(proposed["months"], round(share, 3), places=2)

    def test_taking_more_owes_nothing_back(self):
        start, end = self.month()
        first = self.opened(quantity=5)
        run = self.posted(start, end)
        middle = frappe.utils.add_days(frappe.utils.getdate(start), 15)

        ServiceLifecycleService.change(assignment=first, effective_date=str(middle), quantity=8)
        frappe.db.commit()

        for row in frappe.get_all(
            ASSIGNMENT, filters={"customer": self.customer, "service_item": self.storage}, pluck="name"
        ):
            self.track(ASSIGNMENT, row)

        proposed = next(row for row in self.owed(run) if row["assignment"] == first)

        self.assertEqual(proposed["months"], 0, "the five units are still being provided")

    def test_the_credit_that_is_issued_is_the_one_that_was_proposed(self):
        """F33-04, asserted where the money actually leaves: the credit note itself.

        The proposal being right is not the same as the credit being right. Asked for by
        date, the engine prices the whole quantity over those days and gives back eight
        units where three were taken away — and every test of the proposal passes while it
        does so.
        """
        start, end = self.month()
        first = self.opened(quantity=8)
        run = self.posted(start, end)
        middle = frappe.utils.add_days(frappe.utils.getdate(start), 15)

        ServiceLifecycleService.change(assignment=first, effective_date=str(middle), quantity=5)
        frappe.db.commit()

        for row in frappe.get_all(
            ASSIGNMENT, filters={"customer": self.customer, "service_item": self.storage}, pluck="name"
        ):
            self.track(ASSIGNMENT, row)

        line = next(
            row
            for row in BillingService.get_run(run)["lines"]
            if row["service_assignment"] == first
        )
        share = BillingService._unused_share(
            line["proration_method"], [(middle, frappe.utils.getdate(end))]
        )
        expected = -3 * flt(line["unit_rate"]) * share

        from nexgen_msp.api.internal.services.billing import wizard

        priced = wizard.credit_preview(
            contract=self.contract, against=run, include=[first], scope="detected"
        )
        mine = [row for row in priced["lines"] if row["service_assignment"] == first]

        self.assertEqual(len(mine), 1, mine)
        self.assertAlmostEqual(flt(mine[0]["amount"]), round(expected, 2), places=1)

    def test_a_partial_credit_leaves_the_rest_paid_for(self):
        """F33-H4: a credit is money back, not a day struck off the calendar.

        Three units returned out of eight leaves five paid for. Taken off by date instead,
        those days read as unpaid and the five are charged all over again.
        """
        from nexgen_msp.api.internal.services.billing import wizard

        start, end = self.month()
        first = self.opened(quantity=8)
        run = self.posted(start, end)
        middle = frappe.utils.add_days(frappe.utils.getdate(start), 15)

        ServiceLifecycleService.change(assignment=first, effective_date=str(middle), quantity=5)
        frappe.db.commit()

        for row in frappe.get_all(
            ASSIGNMENT, filters={"customer": self.customer, "service_item": self.storage}, pluck="name"
        ):
            self.track(ASSIGNMENT, row)

        given = wizard.create(
            contract=self.contract,
            kind="credit_note",
            against=run,
            include=[first],
            scope="detected",
            reason="Reduced to five units",
        )
        self.track(RUN, given["run"] if isinstance(given, dict) else given)
        frappe.db.commit()

        rows = self.mine(self.drawn(start=start, end=end))
        charged = [row for row in rows if not row.exception_code and flt(row.billable_months)]

        self.assertEqual(
            charged,
            [],
            f"five units are still paid for over those days: {[(flt(r.quantity), flt(r.billable_months)) for r in rows]}",
        )

    def test_the_same_partial_credit_cannot_be_given_twice(self):
        """F33-08: months left on a line is not the same question as money still owed.

        Three units of eight given back leaves months on the line, so a second identical
        request passes a test that only looks at months — and the customer is refunded
        twice for the same three units.
        """
        from nexgen_msp.api.internal.services.billing import wizard

        start, end = self.month()
        first = self.opened(quantity=8)
        run = self.posted(start, end)
        middle = frappe.utils.add_days(frappe.utils.getdate(start), 15)

        ServiceLifecycleService.change(assignment=first, effective_date=str(middle), quantity=5)
        frappe.db.commit()

        for row in frappe.get_all(
            ASSIGNMENT, filters={"customer": self.customer, "service_item": self.storage}, pluck="name"
        ):
            self.track(ASSIGNMENT, row)

        given = wizard.create(
            contract=self.contract,
            kind="credit_note",
            against=run,
            include=[first],
            scope="detected",
            reason="Reduced to five units",
        )
        self.track(RUN, given["run"] if isinstance(given, dict) else given)
        frappe.db.commit()

        notes = frappe.get_all(RUN, filters={"credit_note_of": run}, pluck="name")
        self.assertEqual(len(notes), 1)

        with self.assertRaises(ValidationError):
            wizard.create(
                contract=self.contract,
                kind="credit_note",
                against=run,
                include=[first],
                scope="detected",
                reason="Reduced to five units",
            )

        self.assertEqual(
            frappe.get_all(RUN, filters={"credit_note_of": run}, pluck="name"),
            notes,
            "the first credit stands and no second one was written",
        )

    def test_two_reductions_credited_together_keep_their_own_days(self):
        """The review's own worked case: 8, then 5, then 3, credited once, then 4.

        Two reductions are worth different amounts a day. Credited as one total over the
        merged days, that total is spread evenly — and the next change is then priced
        against an average nobody was ever charged.
        """
        from nexgen_msp.api.internal.services.billing import wizard

        start, end = self.month()
        first = self.opened(quantity=8)
        run = self.posted(start, end)
        middle = frappe.utils.add_days(frappe.utils.getdate(start), 15)
        later = frappe.utils.add_days(frappe.utils.getdate(start), 22)

        second = ServiceLifecycleService.change(
            assignment=first, effective_date=str(middle), quantity=5
        )["name"]
        ServiceLifecycleService.change(
            assignment=second, effective_date=str(later), quantity=3
        )
        frappe.db.commit()

        for row in frappe.get_all(
            ASSIGNMENT, filters={"customer": self.customer, "service_item": self.storage}, pluck="name"
        ):
            self.track(ASSIGNMENT, row)

        line = next(
            row
            for row in BillingService.get_run(run)["lines"]
            if row["service_assignment"] == first
        )
        method = line["proration_method"]
        rate = flt(line["unit_rate"])
        # three of the eight units over the first stretch, five of them over the second
        expected = -(
            3 * rate * BillingService._unused_share(method, [(middle, frappe.utils.add_days(later, -1))])
            + 5 * rate * BillingService._unused_share(method, [(later, frappe.utils.getdate(end))])
        )

        priced = wizard.credit_preview(
            contract=self.contract, against=run, include=[first], scope="detected"
        )
        mine = [row for row in priced["lines"] if row["service_assignment"] == first]

        self.assertEqual(len(mine), 2, f"two reductions, two pieces: {mine}")
        self.assertAlmostEqual(sum(flt(row["amount"]) for row in mine), round(expected, 2), places=1)
        self.assertEqual(
            len({(str(row["covered_from"]), str(row["covered_to"])) for row in mine}),
            2,
            "and each piece keeps the days it is worth",
        )

    def test_the_proposal_the_stored_line_and_the_return_all_say_the_same_money(self):
        """One number, carried through three places without being rounded on the way.

        A month fraction decides money. Rounded to three decimals on its way to the record,
        a hundred and fifty becomes a hundred and fifty forty — and the return document,
        which works the quantity out from the stored months again, carries that error out
        of the door.
        """
        from nexgen_msp.api.internal.services.billing import wizard

        start, end = self.month()
        first = self.opened(quantity=8)
        run = self.posted(start, end)
        middle = frappe.utils.add_days(frappe.utils.getdate(start), 15)

        ServiceLifecycleService.change(assignment=first, effective_date=str(middle), quantity=5)
        frappe.db.commit()

        for row in frappe.get_all(
            ASSIGNMENT, filters={"customer": self.customer, "service_item": self.storage}, pluck="name"
        ):
            self.track(ASSIGNMENT, row)

        line = next(
            row
            for row in BillingService.get_run(run)["lines"]
            if row["service_assignment"] == first
        )
        expected = -3 * flt(line["unit_rate"]) * BillingService._unused_share(
            line["proration_method"], [(middle, frappe.utils.getdate(end))]
        )

        proposed = wizard.credit_preview(
            contract=self.contract, against=run, include=[first], scope="detected"
        )
        given = wizard.create(
            contract=self.contract,
            kind="credit_note",
            against=run,
            include=[first],
            scope="detected",
            reason="Reduced to five units",
        )
        note = given["run"] if isinstance(given, dict) else given
        self.track(RUN, note)
        frappe.db.commit()

        stored = frappe.get_all(
            "MSP Billing Run Line",
            filters={"parent": note, "service_assignment": first},
            fields=["billable_months", "amount"],
        )

        self.assertAlmostEqual(flt(proposed["total"]), round(expected, 2), places=1)
        self.assertAlmostEqual(
            sum(flt(row.amount) for row in stored), round(expected, 2), places=1
        )

        invoice = frappe.db.get_value(RUN, note, "sales_invoice")

        if invoice:
            self.track("Sales Invoice", invoice)
            # the return is compared by what it is worth, not by the sign ERPNext writes it
            # with, and to the money's own precision: rounding at the currency is right,
            # rounding a month fraction on the way there is not
            self.assertAlmostEqual(
                abs(flt(frappe.db.get_value("Sales Invoice", invoice, "grand_total"))),
                abs(round(expected, 2)),
                delta=0.05,
                msg="the return document carries the same money as the proposal",
            )

    def test_nothing_is_credited_without_somebody_doing_it(self):
        """The run proposes; it never refunds."""
        start, end = self.month()
        first = self.opened(quantity=8)
        run = self.posted(start, end)
        middle = frappe.utils.add_days(frappe.utils.getdate(start), 15)

        ServiceLifecycleService.change(assignment=first, effective_date=str(middle), quantity=5)
        frappe.db.commit()

        for row in frappe.get_all(
            ASSIGNMENT, filters={"customer": self.customer, "service_item": self.storage}, pluck="name"
        ):
            self.track(ASSIGNMENT, row)

        self.assertTrue(next(row for row in self.owed(run) if row["assignment"] == first)["months"])
        self.assertFalse(
            frappe.get_all("MSP Billing Run", filters={"credit_note_of": run}, pluck="name"),
            "a proposal is not a credit note",
        )

class TestTheChangeMatrix(CompanyBillingCase):
    """Issue #33's own worked examples, each charged to the penny and then charged again.

    Every case here is a period already invoiced and then changed inside it. What must come
    out is the difference and only the difference — and running the same period a second
    time must come out at nothing, because the difference has already been asked for.
    """

    def tracked(self):
        for row in frappe.get_all(
            ASSIGNMENT,
            filters={"customer": self.customer, "service_item": self.storage},
            pluck="name",
        ):
            self.track(ASSIGNMENT, row)

    def repriced(self, assignment, on, rate=None, quantity=None):
        ServiceLifecycleService.change(
            assignment=assignment,
            effective_date=str(on),
            quantity=quantity,
            agreed_rate=rate,
            rate_override_reason="Agreed for the rest of the period" if rate else None,
        )
        frappe.db.commit()
        self.tracked()

        return frappe.get_all(
            ASSIGNMENT,
            filters={"replaces_assignment": assignment},
            pluck="name",
        )[0]

    def charged(self, run, assignment=None):
        rows = self.mine(run)

        return [
            (round(flt(row.quantity), 3), str(row.covered_from), str(row.covered_to))
            for row in rows
            if (assignment is None or row.service_assignment == assignment)
            and not row.exception_code
            and flt(row.billable_months)
        ]

    def day(self, start, offset):
        return frappe.utils.add_days(frappe.utils.getdate(start), offset)

    # ----------------------------------------------------------------- F33-01
    def test_a_price_rise_alone_is_charged_as_the_difference(self):
        start, end = self.month()
        first = self.opened(quantity=5)
        self.posted(start, end)
        self.repriced(first, self.day(start, 15), rate=120.0)

        charged = self.charged(self.drawn(start=start, end=end))

        # five units already paid for at a hundred, now worth a hundred and twenty
        self.assertEqual(len(charged), 1, charged)
        self.assertAlmostEqual(charged[0][0], (5 * 120 - 5 * 100) / 120, places=2)

    # ----------------------------------------------------------------- F33-05
    def test_more_units_at_a_higher_price_is_one_difference(self):
        start, end = self.month()
        first = self.opened(quantity=5)
        self.posted(start, end)
        self.repriced(first, self.day(start, 15), rate=120.0, quantity=8)

        charged = self.charged(self.drawn(start=start, end=end))

        self.assertEqual(len(charged), 1, charged)
        self.assertAlmostEqual(charged[0][0], (8 * 120 - 5 * 100) / 120, places=2)

    # ----------------------------------------------------------------- F33-06
    def test_two_changes_before_anything_was_topped_up(self):
        start, end = self.month()
        first = self.opened(quantity=5)
        self.posted(start, end)
        second = self.repriced(first, self.day(start, 15), quantity=8)
        third = self.repriced(second, self.day(start, 22), quantity=10)

        run = self.drawn(start=start, end=end)

        # three more units while eight were held, five more once ten were
        self.assertEqual(
            [entry[0] for entry in self.charged(run, second)], [3.0], self.charged(run)
        )
        self.assertEqual(
            [entry[0] for entry in self.charged(run, third)], [5.0], self.charged(run)
        )

    # ----------------------------------------------------------------- F33-07
    def test_a_second_change_counts_the_top_up_already_invoiced(self):
        start, end = self.month()
        first = self.opened(quantity=5)
        self.posted(start, end)
        second = self.repriced(first, self.day(start, 15), quantity=8)
        # the three extra units are invoiced before anybody asks for ten
        self.posted(start, end)
        third = self.repriced(second, self.day(start, 22), quantity=10)

        run = self.drawn(start=start, end=end)

        # eight units are paid for on those days, so two are owed and not five
        self.assertEqual(
            [entry[0] for entry in self.charged(run, third)], [2.0], self.charged(run)
        )

    # ----------------------------------------------------------------- F33-11
    def test_the_same_period_drawn_twice_asks_for_nothing_the_second_time(self):
        start, end = self.month()
        first = self.opened(quantity=5)
        self.posted(start, end)
        self.repriced(first, self.day(start, 15), quantity=8)
        self.posted(start, end)

        again = self.drawn(start=start, end=end)

        self.assertEqual(
            self.charged(again), [], "the difference was already asked for and paid"
        )



class LedgerCase(CompanyBillingCase):
    """A company service billed ahead, in months of thirty days, so the sums can be done by hand."""

    def setUp(self):
        super().setUp()
        frappe.db.set_value(
            "MSP Contract",
            self.contract,
            {"billing_timing": "In Advance", "proration_method": "30-Day Convention"},
        )
        frappe.db.commit()

    def thirty_day_month(self):
        """A month that has already gone by and is thirty days long, so the convention and the calendar agree."""
        anchor = frappe.utils.getdate(self.today)

        for back in range(1, 13):
            first = frappe.utils.add_months(anchor, -back).replace(day=1)
            last = frappe.utils.add_days(frappe.utils.add_months(first, 1), -1)

            if last.day == 30:
                return str(first), str(last)

        raise AssertionError("no month of thirty days in the last year")

    def dear(self, rate):
        service = self.offering("CDR", scope="Customer", rate=rate)
        frappe.db.set_value("Item", service, "stock_uom", self.unit)
        frappe.db.commit()

        return service

    def adopt(self, service):
        for row in frappe.get_all(
            ASSIGNMENT,
            filters={"customer": self.customer, "service_item": service},
            pluck="name",
        ):
            if (ASSIGNMENT, row) not in self._trash:
                self.track(ASSIGNMENT, row)

    def day(self, start, offset):
        return frappe.utils.add_days(frappe.utils.getdate(start), offset)

    def lines_for(self, run, service):
        return frappe.get_all(
            "MSP Billing Run Line",
            filters={"parent": run, "service_item": service},
            fields=[
                "service_assignment",
                "quantity",
                "billable_months",
                "unit_rate",
                "amount",
                "discount_percent",
                "exception_code",
                "covered_from",
                "covered_to",
                "billable_segments_json",
            ],
            order_by="covered_from asc",
        )

    def top_ups(self, run, service):
        return [
            row
            for row in self.lines_for(run, service)
            if not row.exception_code and flt(row.billable_months) > 0
        ]

    def settle(self, run):
        invoice = self.invoiced(run)
        BillingService.submit_invoice(name=run, notify=0)

        return invoice


class TestACreditAndItsTopUpReachTheLedger(LedgerCase):
    """The review's own case, run end to end rather than previewed.

    Eight units paid for a month at a hundred, five from the 16th, three from the 23rd,
    one credit note for both stretches, then four from the 25th. The credit is money going
    back in ERPNext and the top-up is money asked for, and neither may be zero or point the
    wrong way.
    """

    def credited_and_raised(self):
        from nexgen_msp.api.internal.services.billing import wizard

        start, end = self.thirty_day_month()
        first = self.opened(quantity=8)
        run = self.posted(start, end)

        second = ServiceLifecycleService.change(
            assignment=first, effective_date=str(self.day(start, 15)), quantity=5
        )["name"]
        third = ServiceLifecycleService.change(
            assignment=second, effective_date=str(self.day(start, 22)), quantity=3
        )["name"]
        frappe.db.commit()
        self.adopt(self.storage)

        given = wizard.create(
            contract=self.contract,
            kind="credit_note",
            against=run,
            include=[first],
            scope="detected",
            reason="Reduced to five, then to three",
        )
        note = self.track(RUN, given["run"] if isinstance(given, dict) else given)
        frappe.db.commit()

        fourth = ServiceLifecycleService.change(
            assignment=third, effective_date=str(self.day(start, 24)), quantity=4
        )["name"]
        frappe.db.commit()
        self.adopt(self.storage)

        return start, end, first, fourth, note

    def test_the_credit_is_a_return_in_erpnext_that_gives_back_each_stretch_at_its_own_price(self):
        start, end, first, _fourth, note = self.credited_and_raised()

        rows = frappe.get_all(
            "MSP Billing Run Line",
            filters={"parent": note},
            fields=[
                "quantity",
                "billable_months",
                "unit_rate",
                "amount",
                "covered_from",
                "covered_to",
            ],
            order_by="covered_from asc",
        )

        # three units over the 16th to the 22nd, five over the 23rd to the 30th, a hundred
        # a unit a month in thirty-day months: 3 x 100 x 7/30 and 5 x 100 x 8/30
        self.assertEqual(len(rows), 2, rows)
        self.assertEqual(
            [(str(row.covered_from), str(row.covered_to)) for row in rows],
            [
                (str(self.day(start, 15)), str(self.day(start, 21))),
                (str(self.day(start, 22)), str(self.day(end, 0))),
            ],
        )
        self.assertEqual([flt_round(row.amount) for row in rows], [-70.0, -133.33])
        self.assertEqual(
            [flt_round(flt(row.billable_months) * flt(row.quantity) * flt(row.unit_rate)) for row in rows],
            [-70.0, -133.33],
            "each line's months multiply out to its own money",
        )
        self.assertEqual(flt_round(sum(flt(row.amount) for row in rows)), -203.33)

        invoice = frappe.db.get_value(RUN, note, "sales_invoice")
        self.assertTrue(invoice, "the credit note drafted its return document")
        self.assertTrue(frappe.db.exists("Sales Invoice", invoice))
        self.track("Sales Invoice", invoice)

        document = frappe.get_doc("Sales Invoice", invoice)

        self.assertEqual(document.is_return, 1)
        self.assertLess(flt(document.grand_total), 0)
        self.assertTrue(document.items)

        for item in document.items:
            self.assertLess(flt(item.qty), 0, f"a return line takes its sign from the quantity: {item.as_dict()}")
            self.assertGreaterEqual(flt(item.rate), 0, "and never from the rate")
            self.assertLess(flt(item.amount), 0)

        self.assertEqual(
            flt_round(sum(flt(item.amount) for item in document.items)), flt_round(document.grand_total)
        )
        self.assertAlmostEqual(
            flt(document.grand_total),
            -203.33,
            delta=0.011,
            msg="the return document carries the money of the credit run, to the cent",
        )

    def test_the_return_document_carries_exactly_the_money_the_credit_run_owes(self):
        _start, _end, _first, _fourth, note = self.credited_and_raised()

        invoice = frappe.db.get_value(RUN, note, "sales_invoice")
        self.track("Sales Invoice", invoice)
        document = frappe.get_doc("Sales Invoice", invoice)
        owed = flt_round(
            sum(
                flt(row.amount)
                for row in frappe.get_all(
                    "MSP Billing Run Line", filters={"parent": note}, fields=["amount"]
                )
            )
        )

        self.assertEqual(flt_round(document.grand_total), owed)

    def test_the_increase_after_the_credit_is_charged_and_charged_once(self):
        start, end, _first, fourth, _note = self.credited_and_raised()

        run = self.drawn(start=start, end=end)
        added = self.top_ups(run, self.storage)

        self.assertEqual(len(added), 1, self.lines_for(run, self.storage))
        self.assertEqual(added[0].service_assignment, fourth)
        self.assertEqual(flt(added[0].quantity), 1.0, "four held over the three paid for")
        self.assertEqual(
            (str(added[0].covered_from), str(added[0].covered_to)),
            (str(self.day(start, 24)), str(end)),
        )
        # six days are charged as two blocks of five, which is how a charge is rounded and a
        # credit is not: ten thirtieths of a hundred, with the months kept to three places
        self.assertAlmostEqual(flt(added[0].billable_months), 10 / 30.0, places=3)
        self.assertEqual(flt_round(added[0].amount), flt_round(flt(added[0].billable_months) * 100))
        self.assertAlmostEqual(flt(added[0].amount), 100 * 10 / 30.0, delta=0.05)
        self.assertGreater(flt(added[0].amount), 0)

        again = self.drawn(start=start, end=end)

        self.assertEqual(self.top_ups(again, self.storage), [], "the same scope and period asks for nothing twice")

        self.settle(run)
        after = self.drawn(start=start, end=end)

        self.assertEqual(
            self.top_ups(after, self.storage), [], "and nor does it once the top-up is posted"
        )


class TestASmallTopUpIsStillMoney(LedgerCase):
    """A fraction of a unit at a high rate is a real sum, and a sum below a cent is not."""

    def raised(self, was, now, rate):
        service = self.dear(rate)
        start, end = self.thirty_day_month()
        first = self.running(service, scope="Customer", quantity=was)
        self.posted(start, end)

        ServiceLifecycleService.change(
            assignment=first, effective_date=str(self.day(start, 15)), quantity=now
        )
        frappe.db.commit()
        self.adopt(service)

        return service, start, end, self.drawn(start=start, end=end)

    def test_five_thousandths_of_a_unit_at_a_high_rate_is_charged(self):
        service, _start, _end, run = self.raised(5.0, 5.005, 100000.0)
        added = self.top_ups(run, service)

        self.assertEqual(len(added), 1, self.lines_for(run, service))
        self.assertEqual(flt(added[0].quantity), 0.005)
        self.assertAlmostEqual(flt(added[0].billable_months), 0.5, places=3)
        # 0.005 x 100000 x 15/30
        self.assertEqual(flt_round(added[0].amount), 250.0)

    def test_a_rise_from_five_thousandths_to_ten_is_charged(self):
        service, _start, _end, run = self.raised(0.005, 0.010, 100000.0)
        added = self.top_ups(run, service)

        self.assertEqual(len(added), 1, self.lines_for(run, service))
        self.assertEqual(flt(added[0].quantity), 0.005)
        self.assertEqual(flt_round(added[0].amount), 250.0)

    def test_a_rise_of_one_thousandth_at_a_high_rate_is_charged(self):
        service, _start, _end, run = self.raised(0.001, 0.002, 100000.0)
        added = self.top_ups(run, service)

        self.assertEqual(len(added), 1, self.lines_for(run, service))
        self.assertEqual(flt(added[0].quantity), 0.001)
        self.assertEqual(flt_round(added[0].amount), 50.0)

    def test_a_sum_of_one_cent_is_charged(self):
        service, _start, _end, run = self.raised(5.0, 5.001, 20.0)
        added = self.top_ups(run, service)

        self.assertEqual(len(added), 1, self.lines_for(run, service))
        self.assertEqual(flt_round(added[0].amount), 0.01)

    def test_a_sum_below_half_a_cent_is_not_charged(self):
        service, _start, _end, run = self.raised(5.0, 5.001, 5.0)

        self.assertEqual(
            self.top_ups(run, service),
            [],
            f"0.001 x 5 x 15/30 is a quarter of a cent: {self.lines_for(run, service)}",
        )

    def test_an_assignment_that_never_changed_has_no_top_up_at_all(self):
        service = self.dear(100000.0)
        start, end = self.thirty_day_month()
        self.running(service, scope="Customer", quantity=5.005)
        self.posted(start, end)

        again = self.drawn(start=start, end=end)

        self.assertEqual(self.top_ups(again, service), [])
        self.assertEqual(sum(flt(row.amount) for row in self.lines_for(again, service)), 0)

    def test_the_same_run_twice_charges_the_top_up_once(self):
        service, start, end, run = self.raised(5.0, 5.005, 100000.0)

        self.assertEqual(len(self.top_ups(run, service)), 1)

        twin = self.drawn(start=start, end=end)
        self.assertEqual(self.top_ups(twin, service), [], "a draft is already asking for it")

        self.settle(run)
        after = self.drawn(start=start, end=end)

        self.assertEqual(self.top_ups(after, service), [], "and a posted one has been paid")


class TestACreditThatRoundsToNoQuantityStillReturnsMoney(LedgerCase):
    """Three decimals of quantity cannot hold a third of a thousandth of a month.

    The money is not nothing — a third of a thousandth of a month at a thousand is thirty-
    three pence — and it may not be written as a charge to get past the rounding.
    """

    RATE = 1000.0

    def charged(self, discount=0):
        service = self.dear(self.RATE)
        start, end = self.thirty_day_month()
        first = self.running(service, scope="Customer", quantity=1)
        run = self.track(
            RUN,
            BillingService.generate(
                contract=self.contract,
                period_start=start,
                period_end=end,
                discount_percent=discount,
            )["name"],
        )
        self.invoiced(run)
        BillingService.submit_invoice(name=run, notify=0)

        return service, first, start, end, run

    def credit(self, run, first, rows):
        note = BillingService.create_credit_note(
            name=run, lines=rows, reason="ZZTEST a fraction given back", only_unserved=False
        )["name"]
        self.track(RUN, note)
        invoice = frappe.db.get_value(RUN, note, "sales_invoice")
        self.track("Sales Invoice", invoice)

        return note, frappe.get_doc("Sales Invoice", invoice)

    def piece(self, first, months, start, offset):
        day = str(self.day(start, offset))

        return {
            "service_assignment": first,
            "months": months,
            "segments": [{"from": day, "to": day}],
        }

    def test_the_item_function_writes_a_return_as_minus_one_at_a_positive_rate(self):
        bucket = {"months": -0.000333}

        item = BillingService._credited_item("ZZTEST-ITEM", 1000.0, 0, bucket, "ZZTEST", "x")

        self.assertEqual((item["qty"], item["rate"]), (-1, 0.33))

    def test_the_item_function_still_writes_a_charge_as_plus_one(self):
        item = BillingService._credited_item("ZZTEST-ITEM", 1000.0, 0, {"months": 0.000333}, "ZZTEST", "x")

        self.assertEqual((item["qty"], item["rate"]), (1, 0.33))

    def test_a_third_of_a_thousandth_of_a_month_is_a_return_of_thirty_three_pence(self):
        service, first, start, _end, run = self.charged()

        note, document = self.credit(run, first, [self.piece(first, 0.000333, start, 9)])
        row = self.lines_for(note, service)[0]

        self.assertEqual(document.is_return, 1)
        self.assertEqual(len(document.items), 1)
        self.assertEqual(document.items[0].qty, -1)
        self.assertEqual(flt(document.items[0].rate), 0.33)
        self.assertEqual(flt_round(document.items[0].amount), -0.33)
        self.assertEqual(flt_round(document.grand_total), -0.33)
        document.validate()
        self.assertAlmostEqual(flt(row.billable_months), -0.000333, places=6)
        self.assertEqual(flt_round(row.amount), -0.33)
        self.assertEqual(
            (str(row.covered_from), str(row.covered_to)),
            (str(self.day(start, 9)), str(self.day(start, 9))),
        )

    def test_an_ordinary_partial_credit_keeps_its_quantity_and_its_sign(self):
        service, first, start, _end, run = self.charged()

        note, document = self.credit(run, first, [self.piece(first, 0.5, start, 14)])
        row = self.lines_for(note, service)[0]

        self.assertEqual(document.is_return, 1)
        self.assertEqual(flt(document.items[0].qty), -0.5)
        self.assertEqual(flt(document.items[0].rate), 1000.0)
        self.assertEqual(flt_round(document.items[0].amount), -500.0)
        self.assertEqual(flt_round(document.grand_total), -500.0)
        self.assertAlmostEqual(flt(row.billable_months), -0.5, places=6)
        self.assertEqual(str(row.covered_from), str(self.day(start, 14)))

    def test_a_credit_with_half_off_gives_back_the_net_money(self):
        service, first, start, _end, run = self.charged(discount=50)

        self.assertEqual(flt(self.lines_for(run, service)[0].discount_percent), 50.0)

        note, document = self.credit(run, first, [self.piece(first, 0.0004, start, 3)])
        row = self.lines_for(note, service)[0]

        # 0.0004 of a month at five hundred net is twenty pence, which no quantity holds
        self.assertEqual(document.is_return, 1)
        self.assertEqual(document.items[0].qty, -1)
        self.assertEqual(flt(document.items[0].rate), 0.2)
        self.assertEqual(flt_round(document.items[0].amount), -0.2)
        self.assertEqual(flt_round(document.grand_total), -0.2)
        document.validate()
        self.assertAlmostEqual(flt(row.billable_months), -0.0004, places=6)
        self.assertEqual(flt(row.discount_percent), 50.0)
        self.assertEqual(str(row.covered_from), str(self.day(start, 3)))

    def test_a_larger_credit_with_half_off_is_still_a_return_at_net_money(self):
        service, first, start, _end, run = self.charged(discount=50)

        note, document = self.credit(run, first, [self.piece(first, 0.5, start, 3)])

        self.assertEqual(flt(document.items[0].qty), -0.5)
        self.assertGreaterEqual(flt(document.items[0].rate), 0)
        self.assertEqual(flt_round(document.items[0].amount), -250.0)
        self.assertEqual(flt_round(document.grand_total), -250.0)

    def test_a_credit_over_two_stretches_keeps_each_stretch_and_returns_the_sum(self):
        service, first, start, _end, run = self.charged()

        note, document = self.credit(
            run,
            first,
            [self.piece(first, 0.0002, start, 2), self.piece(first, 0.0001, start, 9)],
        )
        rows = self.lines_for(note, service)

        self.assertEqual(document.is_return, 1)
        self.assertEqual(len(document.items), 1)
        self.assertEqual(document.items[0].qty, -1)
        self.assertEqual(flt(document.items[0].rate), 0.3)
        self.assertEqual(flt_round(document.grand_total), -0.3)
        document.validate()
        self.assertEqual(len(rows), 2, rows)
        self.assertEqual(
            [(str(row.covered_from), str(row.covered_to)) for row in rows],
            [(str(self.day(start, 2)), str(self.day(start, 2))), (str(self.day(start, 9)), str(self.day(start, 9)))],
        )
        self.assertEqual(
            [round(flt(row.billable_months), 6) for row in rows], [-0.0002, -0.0001]
        )
        self.assertEqual([flt_round(row.amount) for row in rows], [-0.2, -0.1])


class TestWhereACompanyServiceStands(CustomerScopeCase):
    """The company is a target like any other, and its card says since when.

    Nobody is named on a company service, so there is no person's row to read it off. The
    card carries the company's own line instead, with the day the state it is in began.
    """

    def person(self):
        name = self.make_person(self.customer, "Alice")
        card = frappe.db.get_value(
            "MSP Client User", name, ["full_name", "department", "email"], as_dict=True
        )

        return [
            {
                "subject_key": f"user:{name}",
                "client_user": name,
                "full_name": card.full_name,
                "department": card.department,
                "email": card.email,
                "added_via": "Existing",
            }
        ]

    def row(self):
        from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

        options = RequestScopeService.operation_options(
            customer=self.customer, subjects=self.person()
        )
        company = next(
            (domain for domain in options["domains"] if domain["key"] == "Company"), None
        )
        card = next(
            (
                option
                for option in (company or {}).get("options", [])
                if option["object_key"] == self.retainer
            ),
            None,
        )

        self.assertIsNotNone(card, "the company's card is built beside the people's")
        self.assertEqual(len(card["service_status_rows"]), 1)

        return card["service_status_rows"][0]

    def test_a_service_the_company_runs_is_dated_from_the_day_it_started(self):
        self.open_one()

        row = self.row()

        self.assertEqual(row["target_scope"], "Customer")
        self.assertIsNone(row["client_user"], "nobody is named on it")
        self.assertEqual(row["status"], "Active")
        self.assertEqual(row["status_since"], "2026-01-01")

    def test_a_service_the_company_never_had_is_not_dated(self):
        row = self.row()

        self.assertEqual(row["status"], "Not subscribed")
        self.assertIsNone(row["status_since"])

    def test_a_service_the_company_gave_up_is_dated_from_its_last_day(self):
        held = self.open_one()
        ServiceLifecycleService.end(
            assignment=held, effective_date=frappe.utils.add_days(frappe.utils.today(), -3)
        )

        row = self.row()

        self.assertEqual(row["status"], "Ended")
        self.assertEqual(row["status_since"], frappe.utils.add_days(frappe.utils.today(), -3))

    def test_a_paused_company_service_is_dated_from_the_pause(self):
        held = self.open_one()
        ServiceLifecycleService.suspend(
            assignment=held,
            effective_date=frappe.utils.add_days(frappe.utils.today(), -2),
            confirm_billed=1,
        )

        row = self.row()

        self.assertEqual(row["status"], "Suspended")
        self.assertEqual(row["status_since"], frappe.utils.add_days(frappe.utils.today(), -2))


class TestTheExecutionViewNamesTheCompany(ExecutionCase):
    """Nobody is named on a company service, so nobody may be shown as its target.

    The plan read a person off every line that was not about a machine, and a line about
    the company has none — so it fell through to a Client User that does not exist.
    """

    def company_line(self, service, **fields):
        return self.line(service, target_scope="Customer", client_user=None, **fields)

    def card(self, request):
        from nexgen_msp.api.internal.services.request_execution_service import (
            RequestExecutionService,
        )

        plan = self.tech_does(
            lambda: RequestExecutionService.get_execution_plan(request=request)
        )

        return plan["action_groups"][0]["work"][0]

    def test_the_target_is_the_company_itself(self):
        service = self.offering("CEX1", scope="Customer")
        request = self.approved(self.company_line(service))

        target = self.card(request)["target"]

        self.assertEqual(target["kind"], "customer")
        self.assertEqual(target["name"], self.customer)
        self.assertEqual(target["sublabel"], "The company itself")

    def test_a_company_service_opened_by_hand_settles_its_line(self):
        """The ⋯ menu opens it on the company; the line must stop asking for it again."""
        from nexgen_msp.api.internal.services.request_execution_service import (
            RequestExecutionService,
        )

        service = self.offering("CEX2", scope="Customer")
        request = self.approved(self.company_line(service))
        held = self.track(
            ASSIGNMENT,
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=service,
                target_scope="Customer",
                effective_date=frappe.utils.today(),
                quantity=1,
            )["name"],
        )

        self.tech_does(
            lambda: RequestExecutionService.settle_work_done_elsewhere(request=request)
        )

        order = frappe.get_all(
            "MSP Work Order",
            filters={"request": request, "work_type": "Service Action"},
            fields=["name", "status", "resulting_assignment"],
        )[0]

        self.assertEqual(
            order.resulting_assignment, held, "the line is settled by the service that exists"
        )
        self.assertNotIn(order.status, ("Pending", "In Progress", "Blocked"))


class TestAskingForADifferentQuantityOfACompanyService(CustomerScopeCase):
    """Issue #33: a company service runs at a quantity, so a different quantity is an act.

    The chain already carried it — the operation is declared customer-requestable, the
    lifecycle replaces the period, the billing engine prices the difference. What the
    builder could not do was offer it: its list of service acts left the change out, so
    the only way to ask for less was to end the service, and the only way to ask for more
    was a second assignment nobody wanted.
    """

    def card(self, item=None):
        from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

        # the builder is always asked about somebody; the company's own card is built beside
        # the people's, and it is that card this reads
        person = self.make_person(self.customer, "Alice")
        card = frappe.db.get_value(
            "MSP Client User", person, ["full_name", "department", "email"], as_dict=True
        )
        options = RequestScopeService.operation_options(
            customer=self.customer,
            subjects=[
                {
                    "subject_key": f"user:{person}",
                    "client_user": person,
                    "full_name": card.full_name,
                    "department": card.department,
                    "email": card.email,
                    "added_via": "Existing",
                }
            ],
        )
        company = next(
            (domain for domain in options["domains"] if domain["key"] == "Company"), None
        )

        if not company:
            return None

        return next(
            (
                option
                for option in company["options"]
                if option["object_key"] == (item or self.retainer)
            ),
            None,
        )

    def offered(self, item=None):
        card = self.card(item)

        return [] if not card else [action["operation_code"] for action in card["actions"]]

    # ------------------------------------------------------------------ what is offered
    def test_a_running_service_can_be_asked_for_a_different_quantity(self):
        self.open_one(quantity=5)

        self.assertIn("service.change", self.offered())

    def test_it_is_offered_beside_suspend_and_end_and_never_instead_of_them(self):
        self.open_one(quantity=5)

        self.assertEqual(
            self.offered(), ["service.change", "service.suspend", "service.end"]
        )

    def test_a_service_nobody_holds_is_only_offered_to_be_added(self):
        self.assertEqual(self.offered(), ["service.add"])

    def test_a_suspended_service_is_offered_resume_and_end_and_no_quantity_change(self):
        held = self.open_one(quantity=5)
        ServiceLifecycleService.suspend(
            assignment=held, effective_date=frappe.utils.today()
        )
        frappe.db.commit()

        offered = self.offered()

        self.assertEqual(offered, ["service.resume", "service.end"])
        self.assertNotIn("service.change", offered)

    def test_the_act_is_called_update_rather_than_change(self):
        from nexgen_msp.api.portal.services.request_scope_service import SHORT_LABEL

        self.open_one(quantity=5)
        card = self.card()
        act = next(
            action for action in card["actions"] if action["operation_code"] == "service.change"
        )

        self.assertEqual(SHORT_LABEL["service.change"], "Update")
        self.assertEqual(act["operation_label"], "Update")

    # ------------------------------------------------------------------ what it is asked against
    def test_the_card_says_how_much_is_running_and_in_what_unit(self):
        self.open_one(quantity=5)
        card = self.card()

        self.assertEqual(flt_round(card["current_quantity"]), 5.0)
        self.assertTrue(card["quantity_uom"])

    def test_a_service_nobody_holds_has_no_current_quantity_but_still_names_its_unit(self):
        card = self.card()

        self.assertIsNone(card["current_quantity"])
        self.assertTrue(card["quantity_uom"])

    def test_the_target_names_the_assignment_and_the_quantity_it_would_replace(self):
        held = self.open_one(quantity=5)
        card = self.card()
        act = next(
            action for action in card["actions"] if action["operation_code"] == "service.change"
        )
        target = act["targets"][0]

        self.assertEqual(target["source_service_assignment"], held)
        self.assertEqual(flt_round(target["current_quantity"]), 5.0)
        self.assertEqual(target["target_scope"], "Customer")

    def test_the_count_of_targets_still_counts_the_company_and_not_its_terabytes(self):
        """`current_count` says how many things an act can reach, which is one company."""
        self.open_one(quantity=5)
        card = self.card()

        self.assertEqual(card["current_count"], 1)
        self.assertEqual(flt_round(card["current_quantity"]), 5.0)

    # ------------------------------------------------------------------ nobody else's
    def test_another_companys_service_is_not_offered(self):
        other = self.make_customer(f"X{self.tag}")
        mine = self.open_one(quantity=5)
        card = self.card()
        act = next(
            action for action in card["actions"] if action["operation_code"] == "service.change"
        )

        self.assertEqual(
            [target["source_service_assignment"] for target in act["targets"]], [mine]
        )
        self.assertNotEqual(other, self.customer)

    def test_a_person_or_a_machine_is_never_offered_a_quantity_change(self):
        """Nothing a person holds is held by the unit, so there is no quantity to change."""
        from nexgen_msp.api.portal.services.request_scope_service import SERVICE_CODES

        self.assertNotIn("service.change", SERVICE_CODES)


class TestCarryingOutAQuantityChangeOnACompanyService(ExecutionCase):
    """Issue #33: the quantity asked for has to survive as far as the assignment.

    The execution took the technician's own number and nothing else, so a request for
    eight terabytes carried out by somebody who typed nothing changed the terms and left
    the quantity where it was — the one thing that had been asked for.
    """

    def running(self, service, quantity):
        return self.track(
            ASSIGNMENT,
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=service,
                target_scope="Customer",
                effective_date="2026-01-01",
                quantity=quantity,
            )["name"],
        )

    def change_line(self, service, held, **fields):
        return self.line(
            service,
            action="Change",
            target_scope="Customer",
            client_user=None,
            source_service_assignment=held,
            **fields,
        )

    def carry_out(self, request, **over):
        order = self.work(request, "Service Action")
        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(
                work_order=order.name, **over
            )
        )
        self.sweep(request)

        return order

    def periods(self, service):
        return frappe.get_all(
            ASSIGNMENT,
            filters={"customer": self.customer, "service_item": service},
            fields=[
                "name",
                "quantity",
                "operational_status",
                "effective_start_date",
                "effective_end_date",
                "replaces_assignment",
            ],
            order_by="effective_start_date asc",
        )

    def test_the_quantity_asked_for_is_what_is_carried_out(self):
        service = self.offering("CQ1", scope="Customer")
        held = self.running(service, 5)
        request = self.approved(
            self.change_line(service, held, requested_quantity=8)
        )

        self.carry_out(request)
        periods = self.periods(service)

        self.assertEqual(len(periods), 2)
        self.assertEqual(flt_round(periods[0].quantity), 5.0)
        self.assertEqual(flt_round(periods[1].quantity), 8.0)
        self.assertEqual(periods[1].replaces_assignment, held)

    def test_a_reduction_is_carried_out_as_a_reduction(self):
        service = self.offering("CQ2", scope="Customer")
        held = self.running(service, 5)
        request = self.approved(
            self.change_line(service, held, requested_quantity=3)
        )

        self.carry_out(request)
        periods = self.periods(service)

        self.assertEqual(flt_round(periods[-1].quantity), 3.0)
        self.assertEqual(periods[-1].operational_status, "Active")

    def test_the_two_periods_do_not_overlap_and_the_first_is_kept(self):
        service = self.offering("CQ3", scope="Customer")
        held = self.running(service, 5)
        request = self.approved(
            self.change_line(service, held, requested_quantity=8)
        )

        self.carry_out(request)
        periods = self.periods(service)

        self.assertEqual(periods[0].name, held)
        self.assertTrue(periods[0].effective_end_date)
        self.assertLess(
            frappe.utils.getdate(periods[0].effective_end_date),
            frappe.utils.getdate(periods[1].effective_start_date),
        )

    def test_a_technician_may_still_carry_out_a_different_quantity(self):
        service = self.offering("CQ4", scope="Customer")
        held = self.running(service, 5)
        request = self.approved(
            self.change_line(service, held, requested_quantity=8)
        )

        self.carry_out(request, quantity=7)

        self.assertEqual(flt_round(self.periods(service)[-1].quantity), 7.0)

    def test_the_requested_quantity_is_what_the_technician_is_shown(self):
        service = self.offering("CQ5", scope="Customer")
        held = self.running(service, 5)
        request = self.approved(
            self.change_line(service, held, requested_quantity=8)
        )
        order = self.work(request, "Service Action")

        plan = RequestExecutionService.get_execution_plan(request=request)
        card = next(
            card
            for group in plan["action_groups"]
            for card in group["work"]
            if card["name"] == order.name
        )

        self.assertEqual(flt_round(card["requested_quantity"]), 8.0)

    def test_moving_the_period_onto_another_service_is_carried_out(self):
        """The variant that names no quantity, carried out by a technician who types none.

        Found by review: the quantity helper handed the lifecycle the 0 a child row holds
        for a quantity nobody named, and the assignment refused it. The move could not be
        carried out at all unless somebody typed a number it never needed.
        """
        service = self.offering("CQ7", scope="Customer")
        other = self.offering("CQ8", scope="Customer")
        held = self.running(service, 5)
        request = self.approved(
            self.change_line(service, held, requested_service=other)
        )

        self.carry_out(request)

        opened = frappe.get_all(
            ASSIGNMENT,
            filters={"customer": self.customer, "service_item": other},
            fields=["name", "quantity", "operational_status", "replaces_assignment"],
        )

        self.assertEqual(len(opened), 1)
        self.assertEqual(opened[0].operational_status, "Active")
        self.assertEqual(opened[0].replaces_assignment, held)
        self.assertEqual(
            flt_round(opened[0].quantity), 5.0, "it keeps the quantity it was running at"
        )

    def test_suspending_and_ending_still_use_their_own_acts(self):
        service = self.offering("CQ6", scope="Customer")
        held = self.running(service, 5)
        request = self.approved(
            self.line(
                service,
                action="Suspend",
                target_scope="Customer",
                client_user=None,
                source_service_assignment=held,
            )
        )

        order = self.work(request, "Service Action")

        self.assertEqual(order.action, "Suspend")
        self.carry_out(request)

        held_now = frappe.db.get_value(
            ASSIGNMENT, held, ["operational_status", "quantity"], as_dict=True
        )
        self.assertEqual(held_now.operational_status, "Suspended")
        self.assertEqual(
            flt_round(held_now.quantity), 5.0, "a suspended service is still five of it"
        )


class TestAQuantityChangeHasToNameAQuantity(ExecutionCase):
    """The refusals, which are the whole point of asking for a quantity.

    Written after a review found the guard comparing an operation's *definition* against
    its *code* — always unequal, so the validator returned before doing anything and
    every one of these payloads was accepted. The happy paths passed throughout, which is
    exactly why a guard needs tests that make it say no.
    """

    def running(self, service, quantity=5):
        return self.track(
            ASSIGNMENT,
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=service,
                target_scope="Customer",
                effective_date="2026-01-01",
                quantity=quantity,
            )["name"],
        )

    def change_line(self, service, held, **fields):
        return self.line(
            service,
            action="Change",
            target_scope="Customer",
            client_user=None,
            source_service_assignment=held,
            **fields,
        )

    def test_a_change_naming_no_quantity_is_refused(self):
        service = self.offering("CR1", scope="Customer")
        held = self.running(service)

        with self.assertRaises(frappe.ValidationError) as refused:
            self.approved(self.change_line(service, held, requested_quantity=None))

        self.assertIn("how much", str(refused.exception).lower())

    def test_a_change_to_the_quantity_it_already_runs_at_is_refused(self):
        service = self.offering("CR2", scope="Customer")
        held = self.running(service, 5)

        with self.assertRaises(frappe.ValidationError) as refused:
            self.approved(self.change_line(service, held, requested_quantity=5))

        self.assertIn("already runs", str(refused.exception).lower())

    def test_a_change_to_none_of_it_is_refused(self):
        service = self.offering("CR3", scope="Customer")
        held = self.running(service)

        with self.assertRaises(frappe.ValidationError):
            self.approved(self.change_line(service, held, requested_quantity=0))

    def test_a_change_to_less_than_none_is_refused(self):
        service = self.offering("CR4", scope="Customer")
        held = self.running(service)

        with self.assertRaises(frappe.ValidationError):
            self.approved(self.change_line(service, held, requested_quantity=-2))

    def test_a_change_naming_no_assignment_is_refused(self):
        service = self.offering("CR5", scope="Customer")
        self.running(service)

        with self.assertRaises(frappe.ValidationError):
            self.approved(
                self.line(
                    service,
                    action="Change",
                    target_scope="Customer",
                    client_user=None,
                    requested_quantity=8,
                )
            )

    def test_the_refusal_reads_the_assignment_and_not_what_was_sent(self):
        """A draft built against a stale screen must not pass because it says 5 itself."""
        service = self.offering("CR6", scope="Customer")
        held = self.running(service, 5)
        frappe.db.set_value(ASSIGNMENT, held, "quantity", 8)
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError) as refused:
            self.approved(self.change_line(service, held, requested_quantity=8))

        self.assertIn("already runs", str(refused.exception).lower())

    def test_moving_the_period_onto_another_service_names_no_quantity(self):
        """The same act also changes *what* is provided, and that one is not a quantity.

        The requirement asks for a different quantity only when the quantity is the whole
        of what is being changed. A guard that demanded one on every change refused a
        service swap the product has always allowed.
        """
        service = self.offering("CR8", scope="Customer")
        other = self.offering("CR9", scope="Customer")
        held = self.running(service)

        request = self.approved(
            self.change_line(service, held, requested_service=other)
        )

        row = frappe.get_all(
            "MSP Request Line",
            filters={"parent": request},
            fields=["requested_service", "requested_quantity"],
        )[0]

        self.assertEqual(row.requested_service, other)
        # a child row's Float holds 0 for a quantity nobody named: the framework cannot
        # keep the difference, so what is asserted is that none was asked for
        self.assertFalse(row.requested_quantity)

    def test_a_quantity_change_on_a_persons_service_is_refused(self):
        """The builder offers it on the company's own services; a payload may say anything.

        Found by review: the scope was held by the card alone, so a crafted line naming a
        person-scoped assignment got a quantity through both guards and would have opened
        a person's period at that quantity.
        """
        personal = self.offering("CR10", scope="User")
        held = self.track(
            ASSIGNMENT,
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=personal,
                target_scope="User",
                client_user=self.john,
                effective_date="2026-01-01",
            )["name"],
        )

        with self.assertRaises(frappe.ValidationError) as refused:
            self.approved(
                self.line(
                    personal,
                    action="Change",
                    source_service_assignment=held,
                    requested_quantity=3,
                )
            )

        self.assertIn("company itself", str(refused.exception))

    def test_an_ordinary_add_still_means_one_of_it(self):
        """The refusals are the quantity change's own; nothing else acquires them."""
        service = self.offering("CR7", scope="User")
        request = self.approved(self.line(service))

        row = frappe.get_all(
            "MSP Request Line", filters={"parent": request}, fields=["requested_quantity"]
        )[0]

        self.assertEqual(flt_round(row.requested_quantity), 1.0)


class TestWhatIsRunningTodayAndWhatIsWaitingForItsDay(CustomerScopeCase):
    """A dated change leaves two periods for one service, and only one of them is today's.

    The old one ends on a day still to come; the replacement starts on that day. Both
    answered "what is running", and whichever the database happened to return last won —
    so a company still being provided five of something could be shown as running eight,
    with acts offered against a period that has not begun.
    """

    def running(self):
        from nexgen_msp.api.portal.services import request_scope_service

        return request_scope_service._company_open(self.customer)[self.retainer]

    def test_the_lifecycle_refuses_to_date_a_change_into_the_future(self):
        """Which is why the two periods below are arranged by hand and not asked for."""
        held = self.open_one(quantity=5)
        later = frappe.utils.add_days(frappe.utils.today(), 10)

        with self.assertRaises(ServiceRefused):
            ServiceLifecycleService.change(
                assignment=held, effective_date=later, quantity=8
            )

    def test_a_period_that_has_not_begun_is_not_what_is_running(self):
        """Arranged directly, because the lifecycle refuses to date one into the future."""
        from nexgen_msp.api.portal.services import request_scope_service

        held = self.open_one(quantity=8)
        later = frappe.utils.add_days(frappe.utils.today(), 10)
        frappe.db.set_value(ASSIGNMENT, held, "effective_start_date", later)
        frappe.db.commit()

        self.assertNotIn(
            self.retainer, request_scope_service._company_open(self.customer)
        )

    def test_a_period_closed_for_a_day_to_come_still_says_so(self):
        held = self.open_one(quantity=5)
        later = frappe.utils.add_days(frappe.utils.today(), 10)
        frappe.db.set_value(
            ASSIGNMENT, held, {"operational_status": "Ended", "effective_end_date": later}
        )
        frappe.db.commit()

        reads = self.running()

        self.assertEqual(reads["assignment"], held)
        self.assertEqual(reads["status"], "Active")
        self.assertTrue(reads["dated_change"])

    def test_the_replacement_becomes_what_is_running_once_its_day_has_come(self):
        held = self.open_one(quantity=5)
        ServiceLifecycleService.change(
            assignment=held, effective_date=frappe.utils.today(), quantity=8
        )
        frappe.db.commit()

        reads = self.running()

        self.assertNotEqual(reads["assignment"], held)
        self.assertEqual(flt_round(reads["quantity"]), 8.0)
        self.assertFalse(reads["dated_change"])
