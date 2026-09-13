"""Approving a request creates the work that grants it, and creates it exactly once.

The plan is not a list of request lines. It is a list of jobs: one account to open per
person, one machine to settle per machine, one act per approved service. A customer who
writes one person and asks four things for them gets one account and one machine, never
four of each.

Nothing here carries any work out. Building a plan writes work orders and touches no
person, no machine and no service assignment.
"""

import frappe

from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import ValidationError as ServiceRefused

from .base import MSPTestCase

WORK_ORDER = "MSP Service Work Order"


class ExecutionPlanCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", self.customer)
        self.john = self.make_person(self.customer, "John")
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"xp{self.tag[:3]}"
        )
        # both rights: the request reaches our queue at once, which is where this work starts
        self.grant(self.asker)
        self.tech = self.make_account("internal", "MSP Technician", suffix=f"xt{self.tag[:3]}")

    # ------------------------------------------------------------------ helpers
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

    def line(self, service, **fields):
        action = fields.pop("action", "Add")

        return {
            "request_action": self.action(action),
            "action": action,
            "target_scope": "User",
            "client_user": self.john,
            "requested_service": service,
            **fields,
        }

    def new_person_line(self, service, full_name="Marie Dupont", **fields):
        return self.line(
            service,
            client_user=None,
            is_new_user=1,
            new_user_full_name=full_name,
            new_user_department=self.make_department("Human Resources"),
            **fields,
        )

    def raise_request(self, *lines):
        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer, request_type="Add", lines=list(lines)
            ),
        )

        return self.track("MSP Service Request", out["name"])

    def decide(self, name, verdicts=None):
        """Rule on every line, then approve. Verdicts are given by line number."""
        verdicts = verdicts or {}
        doc = frappe.get_doc("MSP Service Request", name)

        return self.as_user(
            self.tech,
            lambda: [
                RequestService.set_line_status(
                    name=name,
                    idx=row.idx,
                    line_status=verdicts.get(row.idx, "Approved"),
                    reason="not covered" if verdicts.get(row.idx) == "Rejected" else None,
                )
                for row in doc.lines
            ],
        )

    def approve(self, name, verdicts=None):
        self.decide(name, verdicts)
        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="approve"))
        for order in self.orders(name):
            self.track(WORK_ORDER, order.name)

        return name

    def orders(self, request, work_type=None):
        filters = {"service_request": request}
        if work_type:
            filters["work_type"] = work_type

        return frappe.get_all(
            WORK_ORDER,
            filters=filters,
            fields=[
                "name",
                "plan_key",
                "work_type",
                "action",
                "status",
                "subject_key",
                "device_requirement_key",
                "service_item",
                "request_line_idx",
                "client_user",
                "managed_device",
                "target_scope",
                "effective_date",
            ],
            order_by="work_type asc, request_line_idx asc",
        )

    def plan(self, request):
        return self.as_user(
            self.tech, lambda: RequestExecutionService.get_execution_plan(request=request)
        )


class TestOneJobPerThingToDo(ExecutionPlanCase):
    def test_an_approved_service_line_becomes_one_act(self):
        name = self.approve(self.raise_request(self.line(self.offering("PA"))))

        orders = self.orders(name)

        self.assertEqual(len(orders), 1)
        self.assertEqual(orders[0].work_type, "Service Action")
        self.assertEqual(orders[0].action, "Add")

    def test_four_things_for_one_new_person_open_one_account(self):
        name = self.approve(
            self.raise_request(
                self.new_person_line(self.offering("PB1")),
                self.new_person_line(self.offering("PB2")),
                self.new_person_line(self.offering("PB3")),
                self.new_person_line(self.offering("PB4")),
            )
        )

        self.assertEqual(len(self.orders(name, "User Setup")), 1)
        self.assertEqual(len(self.orders(name, "Service Action")), 4)

    def test_three_device_services_for_one_person_settle_one_machine(self):
        name = self.approve(
            self.raise_request(
                self.new_person_line(self.offering("PC1", scope="Device"), is_new_device=1),
                self.new_person_line(self.offering("PC2", scope="Device"), is_new_device=1),
                self.new_person_line(self.offering("PC3", scope="Device"), is_new_device=1),
            )
        )

        self.assertEqual(len(self.orders(name, "Device Provisioning")), 1)
        self.assertEqual(self.orders(name, "Device Provisioning")[0].action, "Register Device")

    def test_marie_with_three_user_services_and_four_device_services(self):
        lines = [self.new_person_line(self.offering(f"PD{n}")) for n in range(3)]
        lines += [
            self.new_person_line(self.offering(f"PE{n}", scope="Device"), is_new_device=1)
            for n in range(4)
        ]

        name = self.approve(self.raise_request(*lines))

        self.assertEqual(len(self.orders(name, "User Setup")), 1)
        self.assertEqual(len(self.orders(name, "Device Provisioning")), 1)
        self.assertEqual(len(self.orders(name, "Service Action")), 7)

    def test_a_person_already_on_file_needs_no_account_opening(self):
        name = self.approve(self.raise_request(self.line(self.offering("PF"))))

        self.assertEqual(self.orders(name, "User Setup"), [])

    def test_a_machine_already_theirs_needs_no_preparation(self):
        device = self.make_device(self.customer, hostname="PG", holder=self.john)
        service = self.offering("PG", scope="Device")

        name = self.approve(
            self.raise_request(
                self.line(service, client_user=None, target_scope="Device", managed_device=device)
            )
        )

        self.assertEqual(self.orders(name, "Device Provisioning"), [])


class TestARefusedLineIsNoWork(ExecutionPlanCase):
    def test_a_rejected_line_produces_no_act(self):
        keep = self.offering("RJ1")
        drop = self.offering("RJ2")

        name = self.raise_request(self.line(keep), self.line(drop))
        self.approve(name, verdicts={2: "Rejected"})

        services = self.orders(name, "Service Action")

        self.assertEqual(len(services), 1)
        self.assertEqual(services[0].service_item, keep)

    def test_the_refusal_is_still_read_back_with_its_reason(self):
        name = self.raise_request(self.line(self.offering("RJ3")), self.line(self.offering("RJ4")))
        self.approve(name, verdicts={2: "Rejected"})

        rejected = self.plan(name)["rejected"]

        self.assertEqual(len(rejected), 1)
        self.assertEqual(rejected[0]["reason"], "not covered")

    def test_a_refused_line_asks_for_no_account_either(self):
        name = self.raise_request(
            self.new_person_line(self.offering("RJ5")),
            self.line(self.offering("RJ6")),
        )
        self.approve(name, verdicts={1: "Rejected"})

        self.assertEqual(self.orders(name, "User Setup"), [])


class TestBuildingItTwiceChangesNothing(ExecutionPlanCase):
    def test_a_second_build_creates_no_second_work_order(self):
        name = self.approve(
            self.raise_request(
                self.new_person_line(self.offering("ID1")),
                self.new_person_line(self.offering("ID2"), is_new_device=1),
            )
        )
        before = {order.name for order in self.orders(name)}

        self.as_user(self.tech, lambda: RequestExecutionService.build_execution_plan(request=name))

        self.assertEqual({order.name for order in self.orders(name)}, before)

    def test_every_work_order_carries_the_key_it_stands_for(self):
        name = self.approve(self.raise_request(self.new_person_line(self.offering("ID3"))))

        keys = {order.plan_key for order in self.orders(name)}

        self.assertTrue(any(key.startswith(f"{name}:user:") for key in keys))
        self.assertTrue(any(key.startswith(f"{name}:service:") for key in keys))

    def test_a_request_nobody_has_decided_has_no_plan_to_build(self):
        name = self.raise_request(self.line(self.offering("ID4")))

        with self.assertRaises(ServiceRefused):
            self.as_user(
                self.tech, lambda: RequestExecutionService.build_execution_plan(request=name)
            )


class TestHandingAMachineOverIsWorkOfItsOwn(ExecutionPlanCase):
    """A machine can change hands between the day a request is written and the day it is approved."""

    def test_a_machine_that_has_since_moved_on_is_transferred_explicitly(self):
        from nexgen_msp.api.internal.services.device_lifecycle_service import (
            DeviceLifecycleService,
        )

        bob = self.make_person(self.customer, "Bob")
        device = self.make_device(self.customer, hostname="TR1", holder=self.john)
        service = self.offering("TR1", scope="Device")

        name = self.raise_request(
            self.line(service, client_user=None, target_scope="Device", managed_device=device)
        )

        DeviceLifecycleService.transfer(device=device, client_user=bob)

        self.approve(name)
        provisioning = self.orders(name, "Device Provisioning")

        self.assertEqual(len(provisioning), 1)
        self.assertEqual(provisioning[0].action, "Transfer Device")
        self.assertEqual(provisioning[0].managed_device, device)

    def test_nothing_is_activated_on_that_machine_before_it_is_handed_over(self):
        from nexgen_msp.api.internal.services.device_lifecycle_service import (
            DeviceLifecycleService,
        )

        bob = self.make_person(self.customer, "Bob")
        device = self.make_device(self.customer, hostname="TR3", holder=self.john)
        service = self.offering("TR3", scope="Device")

        name = self.raise_request(
            self.line(service, client_user=None, target_scope="Device", managed_device=device)
        )
        DeviceLifecycleService.transfer(device=device, client_user=bob)
        self.approve(name)

        self.assertFalse(self.plan(name)["groups"][0]["services"][0]["ready"])

    def test_a_machine_on_the_shelf_is_assigned_rather_than_transferred(self):
        device = self.make_device(self.customer, hostname="TR2")
        service = self.offering("TR2", scope="Device")

        name = self.approve(
            self.raise_request(
                self.line(
                    service,
                    client_user=None,
                    target_scope="Device",
                    managed_device=device,
                    requested_for_user=self.john,
                )
            )
        )

        self.assertEqual(self.orders(name, "Device Provisioning")[0].action, "Assign Device")


class TestWhatCanBePickedUpNow(ExecutionPlanCase):
    def test_a_service_for_a_person_yet_to_exist_waits_for_them(self):
        name = self.approve(self.raise_request(self.new_person_line(self.offering("WT1"))))

        group = self.plan(name)["groups"][0]

        self.assertTrue(group["user_setup"]["ready"])
        self.assertFalse(group["services"][0]["ready"])
        self.assertIn("person", group["services"][0]["waiting_on"])

    def test_a_device_service_waits_for_the_machine_and_the_machine_for_the_person(self):
        name = self.approve(
            self.raise_request(
                self.new_person_line(self.offering("WT2", scope="Device"), is_new_device=1)
            )
        )
        group = self.plan(name)["groups"][0]

        self.assertTrue(group["user_setup"]["ready"])
        self.assertFalse(group["devices"][0]["work"]["ready"])
        self.assertFalse(group["services"][0]["ready"])

    def test_nothing_waits_when_the_person_and_the_machine_are_both_on_file(self):
        device = self.make_device(self.customer, hostname="WT3", holder=self.john)
        name = self.approve(
            self.raise_request(
                self.line(self.offering("WT3A")),
                self.line(
                    self.offering("WT3B", scope="Device"),
                    client_user=None,
                    target_scope="Device",
                    managed_device=device,
                ),
            )
        )

        self.assertTrue(all(card["ready"] for card in self.plan(name)["groups"][0]["services"]))

    def test_waiting_is_never_written_on_the_work_order_as_a_status(self):
        name = self.approve(self.raise_request(self.new_person_line(self.offering("WT4"))))

        self.assertEqual({order.status for order in self.orders(name)}, {"Open"})


class TestThePlanReadsAsAJob(ExecutionPlanCase):
    def test_the_work_is_grouped_person_by_person(self):
        bob = self.make_person(self.customer, "Bob")
        service = self.offering("GR1")

        name = self.approve(
            self.raise_request(self.line(service), self.line(service, client_user=bob))
        )

        groups = self.plan(name)["groups"]

        self.assertEqual(len(groups), 2)
        self.assertEqual({group["subject_key"] for group in groups}, {f"user:{self.john}", f"user:{bob}"})

    def test_a_person_still_to_be_created_is_described_from_the_request(self):
        name = self.approve(self.raise_request(self.new_person_line(self.offering("GR2"))))

        person = self.plan(name)["groups"][0]["person"]

        self.assertTrue(person["is_new"])
        self.assertEqual(person["full_name"], "Marie Dupont")
        self.assertIsNone(person["name"])

    def test_a_person_on_file_is_described_from_their_record(self):
        name = self.approve(self.raise_request(self.line(self.offering("GR3"))))

        person = self.plan(name)["groups"][0]["person"]

        self.assertFalse(person["is_new"])
        self.assertEqual(person["name"], self.john)

    def test_the_technician_walks_four_steps(self):
        name = self.approve(self.raise_request(self.line(self.offering("GR4"))))

        stages = self.plan(name)["stages"]["stages"]

        self.assertEqual(
            [stage["label"] for stage in stages],
            ["Review lines", "Execute", "Verify", "Final validation"],
        )
        self.assertEqual([stage["state"] for stage in stages], ["done", "current", "todo", "todo"])

    def test_creating_the_person_is_part_of_execute_not_a_step_of_its_own(self):
        name = self.approve(self.raise_request(self.new_person_line(self.offering("GR5"))))

        self.assertEqual(self.plan(name)["stages"]["current"], "execute")

    def test_the_summary_counts_the_work_and_not_the_lines(self):
        name = self.approve(
            self.raise_request(
                self.new_person_line(self.offering("GR6A")),
                self.new_person_line(self.offering("GR6B")),
                self.new_person_line(self.offering("GR6C", scope="Device"), is_new_device=1),
            )
        )

        self.assertEqual(
            self.plan(name)["summary"],
            {"people": 1, "devices": 1, "services": 3, "open": 5, "blocked": 0, "failed": 0},
        )


class TestApprovingIsWhatCreatesTheWork(ExecutionPlanCase):
    def test_the_plan_exists_the_moment_the_request_is_approved(self):
        name = self.raise_request(self.line(self.offering("AP1")))
        self.decide(name)

        self.assertEqual(self.orders(name), [])

        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="approve"))
        for order in self.orders(name):
            self.track(WORK_ORDER, order.name)

        self.assertEqual(len(self.orders(name)), 1)

    def test_ruling_on_the_first_line_opens_the_review_by_itself(self):
        name = self.raise_request(self.line(self.offering("AP2")), self.line(self.offering("AP3")))

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Submitted")

        self.as_user(
            self.tech,
            lambda: RequestService.set_line_status(name=name, idx=1, line_status="Approved"),
        )

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Under Review")

    def test_building_the_plan_activates_nothing(self):
        name = self.approve(
            self.raise_request(
                self.new_person_line(self.offering("AP4")),
                self.new_person_line(self.offering("AP5", scope="Device"), is_new_device=1),
            )
        )

        self.assertEqual(
            frappe.db.count("MSP Service Assignment", {"source_request": name}),
            0,
        )
        self.assertEqual(
            frappe.db.count("MSP Client User", {"full_name": "Marie Dupont"}),
            0,
        )
