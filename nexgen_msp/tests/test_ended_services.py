"""A service that stopped is part of the record, and asking for it to stop changes nothing yet.

Ending a service has two doors and one outcome. A customer asks for it — `service.end` — and the
assignment does not move until the work is carried out. Our own staff stop it directly, which is
the same domain operation with no second state invented for it. Either way the assignment ends on
a known date, stays visible everywhere it was visible before, and keeps whatever was legitimately
billable before that date.
"""

import frappe

from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.user_360_service import User360Service
from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import operations

from .base import MSPTestCase

WORK_ORDER = "MSP Work Order"


class EndingCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(f"END{self.tag[:4]}")
        self.track("MSP Approval Authority", self.customer)
        self.person = self.make_person(self.customer, "Holder")
        frappe.db.set_value("MSP Client User", self.person, "username", f"h.{self.tag}")
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"ea{self.tag[:3]}"
        )
        self.grant(self.asker)
        self.tech = self.make_account("internal", "MSP Technician", suffix=f"et{self.tag[:3]}")

    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def offering(self, suffix, scope="User"):
        service = self.make_service(f"{suffix}{self.tag[:3]}", scope=scope)
        self.cover_service(self.customer, service)

        return service

    def running(self, service, scope="User", managed_device=None, started=None):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope=scope,
            client_user=self.person if scope == "User" else None,
            managed_device=managed_device,
            effective_date=started,
        )

        return self.track("MSP Service Assignment", outcome["name"])

    def state(self, assignment):
        return frappe.db.get_value(
            "MSP Service Assignment",
            assignment,
            ["operational_status", "billing_status", "effective_end_date"],
            as_dict=True,
        )


class TestAskingForAServiceToEnd(EndingCase):
    def test_the_operation_a_customer_may_ask_for_is_end_service(self):
        self.assertIn("service.end", operations.customer_requestable(operations.SERVICE))
        self.assertNotIn("service.remove", operations.REGISTRY)
        self.assertEqual(operations.label("service.end"), "End service")
        self.assertEqual(
            operations.REGISTRY["service.end"]["description"],
            "Request that this service permanently stop on the selected date. "
            "The service remains visible in history after it ends.",
        )

    def test_asking_leaves_the_assignment_exactly_as_it_was(self):
        service = self.offering("ASK")
        assignment = self.running(service)

        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer,
                lines=[
                    {
                        "operation_code": "service.end",
                        "target_scope": "User",
                        "client_user": self.person,
                        "requested_service": service,
                        "source_service_assignment": assignment,
                    }
                ],
            ),
        )
        self.track("MSP Request", out["name"])
        card = self.state(assignment)

        self.assertEqual(card.operational_status, "Active")
        self.assertEqual(card.billing_status, "Billable")
        self.assertIsNone(card.effective_end_date)

    def test_carrying_the_work_out_ends_it_on_a_known_date(self):
        service = self.offering("EXE")
        assignment = self.running(service, started=frappe.utils.add_days(frappe.utils.today(), -40))

        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer,
                lines=[
                    {
                        "operation_code": "service.end",
                        "target_scope": "User",
                        "client_user": self.person,
                        "requested_service": service,
                        "source_service_assignment": assignment,
                    }
                ],
            ),
        )
        name = self.track("MSP Request", out["name"])

        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="start_review"))
        self.as_user(
            self.tech, lambda: RequestService.set_line_status(name=name, idx=1, line_status="Approved")
        )
        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="approve"))

        order = frappe.get_all(
            WORK_ORDER,
            filters={"request": name, "work_type": "Service Action"},
            fields=["name", "operation_code"],
        )[0]
        self.track(WORK_ORDER, order.name)

        self.assertEqual(order.operation_code, "service.end")

        self.as_user(
            self.tech,
            lambda: RequestExecutionService.execute_service_action(work_order=order.name),
        )
        card = self.state(assignment)

        self.assertEqual(card.operational_status, "Ended")
        self.assertIsNotNone(card.effective_end_date)


class TestStoppingItOurselves(EndingCase):
    def test_the_staff_action_ends_it_directly_with_no_second_state(self):
        service = self.offering("STOP")
        assignment = self.running(service)

        self.as_user(
            self.tech,
            lambda: ServiceLifecycleService.end(
                assignment=assignment, notes="Stopped at the customer's request"
            ),
        )
        card = self.state(assignment)

        self.assertEqual(card.operational_status, "Ended")
        self.assertIsNotNone(card.effective_end_date)

        options = frappe.get_meta("MSP Service Assignment").get_field("operational_status").options

        self.assertNotIn("Stopped", options.split("\n"))
        self.assertNotIn("Pending Removal", options.split("\n"))

    def test_nothing_creates_a_pending_removal_any_more(self):
        service = self.offering("NOPR")
        self.running(service)

        self.assertEqual(
            frappe.db.count("MSP Service Assignment", {"operational_status": "Pending Removal"}), 0
        )


class TestWhereAnEndedServiceStillShows(EndingCase):
    def setUp(self):
        super().setUp()
        self.personal = self.offering("SHOW")
        self.on_machine = self.offering("SHOWD", scope="Device")
        self.machine = self.make_device(
            self.customer, hostname=f"END-{self.tag[:4]}", holder=self.person, serial=f"ZZTEST-E{self.tag}"
        )
        # they have held it since before the service ran: a machine service is only theirs to
        # read for the days the two overlapped
        frappe.db.sql(
            """
            update `tabMSP Device Holder` set from_date = %(from_date)s
            where parent = %(device)s and parenttype = 'MSP Managed Device' and is_current = 1
            """,
            {"from_date": frappe.utils.add_days(frappe.utils.today(), -70), "device": self.machine},
        )
        frappe.db.commit()
        self.ended_personal = self.running(
            self.personal, started=frappe.utils.add_days(frappe.utils.today(), -60)
        )
        self.ended_on_machine = self.running(
            self.on_machine,
            scope="Device",
            managed_device=self.machine,
            started=frappe.utils.add_days(frappe.utils.today(), -60),
        )
        ServiceLifecycleService.end(
            assignment=self.ended_personal, effective_date=frappe.utils.add_days(frappe.utils.today(), -5)
        )
        ServiceLifecycleService.end(
            assignment=self.ended_on_machine,
            effective_date=frappe.utils.add_days(frappe.utils.today(), -5),
        )

    def test_the_persons_page_still_shows_both(self):
        reading = self.as_user(self.tech, lambda: User360Service.read_user(self.person))
        rows = {row["name"]: row for row in reading["services"]}

        self.assertIn(self.ended_personal, rows)
        self.assertIn(self.ended_on_machine, rows)
        self.assertEqual(rows[self.ended_personal]["operational_status"], "Ended")
        self.assertEqual(rows[self.ended_personal]["target"], "Person")
        self.assertEqual(
            rows[self.ended_on_machine]["target"],
            frappe.db.get_value("MSP Managed Device", self.machine, "hostname"),
        )
        self.assertEqual(rows[self.ended_on_machine]["assignment_scope"], "Device")

    def test_the_machines_page_still_shows_its_own(self):
        reading = self.as_user(self.tech, lambda: DeviceService.read_device(self.machine))
        rows = {row["name"] for row in reading["services"]}

        self.assertIn(self.ended_on_machine, rows)

    def test_the_customer_portfolio_lists_it_and_never_counts_it_as_in_use(self):
        portfolio = self.as_user(
            self.asker, lambda: PortalService.service_portfolio(self.customer)
        )
        rows = {row["service_item"]: row for row in portfolio["rows"]}

        self.assertIn(self.personal, rows)
        row = rows[self.personal]

        self.assertEqual(row["active"], 0)
        self.assertEqual(row["suspended"], 0)
        self.assertGreaterEqual(row["ended"], 1)
        self.assertEqual(row["availability"], "Available to request", "the contract still covers it")

    def test_a_service_nothing_covers_any_more_is_history_only(self):
        frappe.db.sql(
            "delete from `tabMSP Contract Service` where service_item = %s", self.personal
        )
        frappe.db.commit()

        portfolio = self.as_user(
            self.asker, lambda: PortalService.service_portfolio(self.customer)
        )
        row = next(
            row for row in portfolio["rows"] if row["service_item"] == self.personal
        )

        self.assertEqual(row["availability"], "History only")
        self.assertEqual(row["active"], 0)
        self.assertGreaterEqual(row["ended"], 1)

    def test_what_was_provided_before_the_end_stays_billable(self):
        card = self.state(self.ended_personal)

        self.assertEqual(card.operational_status, "Ended")
        self.assertEqual(card.billing_status, "Ended")

        from nexgen_msp.api.internal.services.billing_service import BILLABLE_OPERATIONAL

        self.assertIn("Ended", BILLABLE_OPERATIONAL)
