"""Approving a request creates the work that grants it, and creates it exactly once.

Nothing here carries any work out. Building a plan writes work orders and touches no
person, no machine and no service assignment.
"""

import frappe

from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import ValidationError as ServiceRefused

from .base import MSPTestCase

WORK_ORDER = "MSP Work Order"


class ExecutionPlanCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.newcomers, self.owed = {}, {}
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

    def line(self, service, on_requested_device=False, **fields):
        action = fields.pop("action", "Add")
        row = {
            "operation_code": self.operation(action),
            "action": action,
            "target_scope": "User",
            "client_user": self.john,
            "requested_service": service,
            **fields,
        }

        if on_requested_device:
            owner = row.get("subject_key") or f"user:{row['client_user']}"
            row["target_scope"] = "Device"
            row["device_requirement_key"] = f"new-device:{owner}"
            self.owed[row["device_requirement_key"]] = {
                "device_requirement_key": row["device_requirement_key"],
                "intended_holder_subject_key": owner if owner in self.newcomers else None,
                "intended_holder_client_user": row.get("client_user"),
            }

        return row

    def described(self, lines):
        """The future people and the requested Devices a set of lines names."""
        return {
            "subjects": [
                self.newcomers[key]
                for key in dict.fromkeys(line.get("subject_key") for line in lines)
                if key in self.newcomers
            ],
            "requested_devices": [
                self.owed[key]
                for key in dict.fromkeys(line.get("device_requirement_key") for line in lines)
                if key in self.owed
            ],
        }

    def new_person_line(self, service, full_name="Marie Dupont", subject_key=None, **fields):
        key = subject_key or f"new:{frappe.scrub(full_name)}"
        self.newcomers[key] = {
            "subject_key": key,
            "kind": "new",
            "full_name": full_name,
            "department": self.make_department("Human Resources"),
        }

        return self.line(service, client_user=None, subject_key=key, **fields)

    def raise_request(self, *lines):
        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=list(lines),
                **self.described(lines),
            ),
        )

        return self.track("MSP Request", out["name"])

    def decide(self, name, verdicts=None):
        """Rule on every line, then approve. Verdicts are given by line number."""
        verdicts = verdicts or {}
        doc = frappe.get_doc("MSP Request", name)

        if doc.status == "Submitted":
            self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="start_review"))

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
        filters = {"request": request}
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
                "request_line_name",
                "client_user",
                "requested_client_user",
                "managed_device",
                "requested_device",
                "target_scope",
                "effective_date",
            ],
            order_by="work_type asc, request_line_idx asc",
        )

    def plan(self, request):
        return self.as_user(
            self.tech, lambda: RequestExecutionService.get_execution_plan(request=request)
        )

    def cards(self, request):
        return [card for group in self.plan(request)["action_groups"] for card in group["work"]]

    def requested(self, request, doctype="MSP Requested Client User"):
        return frappe.get_all(doctype, filters={"request": request}, pluck="name")


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

        people = self.requested(name)
        services = self.orders(name, "Service Action")

        self.assertEqual(self.orders(name, "User Setup"), [], "nobody is created by a work order of its own")
        self.assertEqual(len(people), 1, "one person to resolve")
        self.assertEqual(len(services), 4)
        self.assertEqual({order.requested_client_user for order in services}, set(people))

    def test_three_device_services_for_one_person_settle_one_machine(self):
        name = self.approve(
            self.raise_request(
                self.new_person_line(self.offering("PC1", scope="Device"), on_requested_device=True),
                self.new_person_line(self.offering("PC2", scope="Device"), on_requested_device=True),
                self.new_person_line(self.offering("PC3", scope="Device"), on_requested_device=True),
            )
        )

        machines = self.requested(name, "MSP Requested Device")
        services = self.orders(name, "Service Action")

        self.assertEqual(self.orders(name, "Device Provisioning"), [])
        self.assertEqual(len(machines), 1, "one machine to resolve")
        self.assertEqual({order.requested_device for order in services}, set(machines))
        self.assertEqual({order.target_scope for order in services}, {"Device"})

    def test_marie_with_three_user_services_and_four_device_services(self):
        lines = [self.new_person_line(self.offering(f"PD{n}")) for n in range(3)]
        lines += [
            self.new_person_line(self.offering(f"PE{n}", scope="Device"), on_requested_device=True)
            for n in range(4)
        ]

        name = self.approve(self.raise_request(*lines))

        services = self.orders(name, "Service Action")
        people = self.requested(name)
        machines = self.requested(name, "MSP Requested Device")

        self.assertEqual(self.orders(name, "User Setup") + self.orders(name, "Device Provisioning"), [])
        self.assertEqual((len(people), len(machines)), (1, 1))
        self.assertEqual(len(services), 7)
        self.assertEqual(
            sorted(order.requested_client_user or order.requested_device for order in services),
            sorted(people * 3 + machines * 4),
        )

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
                self.new_person_line(self.offering("ID2"), on_requested_device=True),
            )
        )
        before = {order.name for order in self.orders(name)}

        self.as_user(self.tech, lambda: RequestExecutionService.build_execution_plan(request=name))

        self.assertEqual({order.name for order in self.orders(name)}, before)

    def test_every_work_order_carries_the_key_it_stands_for(self):
        name = self.approve(self.raise_request(self.new_person_line(self.offering("ID3"))))

        orders = self.orders(name)
        person = self.requested(name)[0]

        self.assertEqual([order.plan_key for order in orders], [f"{name}:service:{orders[0].request_line_name}"])
        self.assertEqual(orders[0].requested_client_user, person)
        self.assertEqual(
            orders[0].subject_key,
            frappe.db.get_value("MSP Requested Client User", person, "subject_key"),
        )

    def test_a_request_nobody_has_decided_has_no_plan_to_build(self):
        name = self.raise_request(self.line(self.offering("ID4")))

        with self.assertRaises(ServiceRefused):
            self.as_user(
                self.tech, lambda: RequestExecutionService.build_execution_plan(request=name)
            )


class TestHandingAMachineOverIsWorkOfItsOwn(ExecutionPlanCase):
    """A machine can change hands between the day a request is written and the day it is approved."""

    def test_a_machine_that_has_since_moved_on_is_shown_with_who_holds_it_now(self):
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
        card = self.cards(name)[0]

        self.assertEqual(self.orders(name, "Device Provisioning"), [], "the plan moves no machine")
        self.assertEqual(card["managed_device"], device)
        self.assertEqual(card["device"]["assigned_client_user"], bob)
        self.assertEqual(
            card["target"]["sublabel"],
            f"requested for {frappe.db.get_value('MSP Client User', self.john, 'full_name')}",
        )

    def test_nothing_hands_that_machine_back_without_a_line_asking_for_it(self):
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

        self.assertEqual([order.work_type for order in self.orders(name)], ["Service Action"])
        self.assertEqual(
            frappe.db.get_value("MSP Managed Device", device, "assigned_client_user"), bob
        )

    def test_a_machine_on_the_shelf_is_not_given_to_anybody_by_the_plan(self):
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

        self.assertEqual([order.work_type for order in self.orders(name)], ["Service Action"])
        self.assertFalse(frappe.db.get_value("MSP Managed Device", device, "assigned_client_user"))


class TestWhatCanBePickedUpNow(ExecutionPlanCase):
    def test_a_service_for_a_person_yet_to_exist_waits_for_them(self):
        name = self.approve(self.raise_request(self.new_person_line(self.offering("WT1"))))
        person = self.requested(name)[0]

        card = self.cards(name)[0]

        self.assertFalse(card["ready"])
        self.assertEqual(card["display_status"], "Waiting for prerequisite")
        self.assertEqual(card["waiting_on"], "Requested Client User must be resolved")
        self.assertEqual(card["prerequisite_action"]["requested_entity"], person)
        self.assertEqual(
            frappe.get_all("MSP Requested Client User", filters={"name": person}, pluck="status"), ["Open"]
        )

    def test_a_device_service_waits_for_the_machine_and_the_machine_for_the_person(self):
        name = self.approve(
            self.raise_request(
                self.new_person_line(self.offering("WT2", scope="Device"), on_requested_device=True)
            )
        )
        machine = self.requested(name, "MSP Requested Device")[0]
        card = self.cards(name)[0]

        self.assertFalse(card["ready"])
        self.assertEqual(card["prerequisite_action"]["kind"], "prepare_device")
        self.assertEqual(card["prerequisite_action"]["requested_entity"], machine)
        self.assertEqual(
            frappe.db.get_value("MSP Requested Device", machine, "intended_holder_requested_client_user"),
            self.requested(name)[0],
            "the machine waits for the person it is meant for",
        )

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

        cards = self.cards(name)

        self.assertEqual([card["waiting_on"] for card in cards], [None, None])
        self.assertNotIn("Waiting for prerequisite", {card["display_status"] for card in cards})
        self.assertFalse(
            [row for card in cards for row in card["requirements"] if row["kind"].startswith("requested_")]
        )

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

        people = self.plan(name)["people"]

        self.assertEqual(len(people), 2)
        self.assertEqual({row["subject_key"] for row in people}, {f"user:{self.john}", f"user:{bob}"})
        self.assertEqual({row["total"] for row in people}, {1})

    def test_a_person_still_to_be_created_is_described_from_the_request(self):
        name = self.approve(self.raise_request(self.new_person_line(self.offering("GR2"))))

        person = self.plan(name)["people"][0]

        self.assertTrue(person["is_new"])
        self.assertEqual(person["full_name"], "Marie Dupont")
        self.assertIsNone(person["client_user"])
        self.assertEqual(person["requested_client_user"], self.requested(name)[0])

    def test_a_person_on_file_is_described_from_their_record(self):
        name = self.approve(self.raise_request(self.line(self.offering("GR3"))))

        person = self.plan(name)["people"][0]

        self.assertFalse(person["is_new"])
        self.assertEqual(person["client_user"], self.john)

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
                self.new_person_line(self.offering("GR6C", scope="Device"), on_requested_device=True),
            )
        )

        self.assertEqual(
            self.plan(name)["summary"],
            {"people": 1, "devices": 1, "services": 3, "open": 3, "blocked": 0, "failed": 0},
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

    def test_ruling_on_a_line_waits_for_the_work_to_start(self):
        name = self.raise_request(self.line(self.offering("AP2")), self.line(self.offering("AP3")))

        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Submitted")

        with self.assertRaises(ServiceRefused) as refused:
            self.as_user(
                self.tech,
                lambda: RequestService.set_line_status(name=name, idx=1, line_status="Approved"),
            )

        self.assertEqual(refused.exception.message, "Start work on this request before deciding its lines.")
        self.assertEqual(refused.exception.code, "WORK_NOT_STARTED")
        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Submitted")
        self.assertEqual(
            frappe.db.get_value("MSP Request Line", {"parent": name, "idx": 1}, "line_status"), "Pending"
        )

        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="start_review"))
        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Under Review")

        self.as_user(
            self.tech,
            lambda: RequestService.set_line_status(name=name, idx=1, line_status="Approved"),
        )

        self.assertEqual(
            frappe.db.get_value("MSP Request Line", {"parent": name, "idx": 1}, "line_status"), "Approved"
        )

    def test_building_the_plan_activates_nothing(self):
        name = self.approve(
            self.raise_request(
                self.new_person_line(self.offering("AP4")),
                self.new_person_line(self.offering("AP5", scope="Device"), on_requested_device=True),
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
