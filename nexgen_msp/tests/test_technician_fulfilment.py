"""The technician's four steps: review the lines, execute, verify, validate.

A group decision or a group execution is a convenience of the screen, and nothing more: every
line is still decided on its own, every work order still runs on its own, and the answer says
which ones went through and which did not.

What the technician adds while on the job never becomes part of what the customer asked for.
It is work of its own, marked as theirs, with the reason they gave.
"""

import frappe

from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import ValidationError as Refused

from .test_request_execution import WORK_ORDER, ExecutionCase


class FulfilmentCase(ExecutionCase):
    def raised(self, *lines, details=None):
        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer, request_type="Add", lines=list(lines), details=details
            ),
        )

        return self.track("MSP Service Request", out["name"])

    def plan(self, name):
        return self.tech_does(lambda: RequestExecutionService.get_execution_plan(request=name))


class TestDecidingSeveralLinesAtOnce(FulfilmentCase):
    def test_every_line_takes_the_decision_on_its_own(self):
        name = self.raised(self.line(self.offering("GD1")), self.line(self.offering("GD2")))

        out = self.tech_does(
            lambda: RequestService.set_line_statuses(name=name, idxs=[1, 2], line_status="Approved")
        )

        self.assertEqual(out["decided"], 2)
        self.assertEqual(
            [row.line_status for row in frappe.get_doc("MSP Service Request", name).lines],
            ["Approved", "Approved"],
        )

    def test_a_group_rejection_still_needs_a_reason(self):
        name = self.raised(self.line(self.offering("GD3")), self.line(self.offering("GD4")))

        out = self.tech_does(
            lambda: RequestService.set_line_statuses(name=name, idxs=[1, 2], line_status="Rejected")
        )

        self.assertEqual(out["decided"], 0)
        self.assertEqual(out["failed"], 2)
        self.assertTrue(all("reason" in row["message"] for row in out["results"]))

    def test_one_line_that_cannot_be_decided_does_not_stop_the_others(self):
        name = self.raised(self.line(self.offering("GD5")))

        out = self.tech_does(
            lambda: RequestService.set_line_statuses(name=name, idxs=[1, 9], line_status="Approved")
        )

        self.assertEqual(out["decided"], 1)
        self.assertEqual([row["ok"] for row in out["results"]], [True, False])

    def test_deciding_rewrites_nothing_the_customer_asked_for(self):
        service = self.offering("GD6")
        name = self.raised(self.line(service))
        before = frappe.get_doc("MSP Service Request", name).lines[0]

        self.tech_does(
            lambda: RequestService.set_line_statuses(
                name=name, idxs=[1], line_status="Rejected", reason="Not covered"
            )
        )
        after = frappe.get_doc("MSP Service Request", name).lines[0]

        for field in ("requested_service", "action", "target_scope", "client_user", "request_action"):
            self.assertEqual(after.get(field), before.get(field), field)


class TestExecutingTheSameActForSeveralPeople(FulfilmentCase):
    def test_each_one_runs_and_is_reported_on_its_own(self):
        name = self.approved(self.line(self.offering("GE1")), self.line(self.offering("GE2")))
        orders = [self.work(name, "Service Action", index).name for index in range(2)]

        out = self.tech_does(
            lambda: RequestExecutionService.execute_service_actions(work_orders=orders)
        )
        self.sweep(name)

        self.assertEqual(out["completed"], 2)
        self.assertEqual({self.state(order) for order in orders}, {"Completed"})

    def test_one_refusal_is_named_and_the_rest_go_through(self):
        name = self.approved(self.line(self.offering("GE3")), self.line(self.offering("GE4")))
        first, second = (self.work(name, "Service Action", index).name for index in range(2))
        self.tech_does(
            lambda: RequestExecutionService.block_work_item(work_order=second, reason="Vendor down")
        )

        out = self.tech_does(
            lambda: RequestExecutionService.execute_service_actions(work_orders=[first, second])
        )
        self.sweep(name)

        self.assertEqual((out["completed"], out["failed"]), (1, 1))
        refused = next(row for row in out["results"] if not row["ok"])
        self.assertEqual(refused["work_order"], second)
        self.assertIn("blocked", refused["message"].lower())
        self.assertEqual(self.state(first), "Completed")
        self.assertEqual(self.state(second), "Blocked")


class TestWhatTheTechnicianAddsOnTheJob(FulfilmentCase):
    def setUp(self):
        super().setUp()
        self.extra = self.offering("TA1")
        self.name = self.approved(self.line(self.offering("TA0")))
        self.subject = f"user:{self.john}"

    def options(self):
        return self.tech_does(
            lambda: RequestExecutionService.technician_options(
                request=self.name, subject_key=self.subject
            )
        )["options"]

    def add(self, option, reason="The laptop needs it too"):
        plan = self.tech_does(
            lambda: RequestExecutionService.add_technician_action(
                request=self.name, subject_key=self.subject, option=option, reason=reason
            )
        )
        self.sweep(self.name)

        return plan

    def test_the_choices_come_from_what_the_person_holds_today(self):
        adds = [row for row in self.options() if row["action"] == "Add"]

        self.assertIn(self.extra, [row["service_item"] for row in adds])
        self.assertTrue(all(row["action_label"] for row in adds))

    def test_what_is_already_planned_is_not_offered_again(self):
        planned = frappe.db.get_value(WORK_ORDER, {"service_request": self.name}, "service_item")

        self.assertNotIn(
            (planned, "Add"), [(row["service_item"], row["action"]) for row in self.options()]
        )

    def test_it_becomes_work_of_its_own_marked_as_the_technicians(self):
        option = next(row for row in self.options() if row["service_item"] == self.extra)
        lines_before = len(frappe.get_doc("MSP Service Request", self.name).lines)

        self.add(option)

        order = frappe.db.get_value(
            WORK_ORDER,
            {"service_request": self.name, "service_item": self.extra},
            ["origin", "technician_reason", "request_line_name", "client_user"],
            as_dict=True,
        )
        self.assertEqual(order.origin, "Technician")
        self.assertEqual(order.technician_reason, "The laptop needs it too")
        self.assertFalse(order.request_line_name)
        self.assertEqual(order.client_user, self.john)
        self.assertEqual(len(frappe.get_doc("MSP Service Request", self.name).lines), lines_before)

    def test_it_needs_a_reason(self):
        option = next(row for row in self.options() if row["service_item"] == self.extra)

        with self.assertRaises(Refused):
            self.add(option, reason="  ")

    def test_an_action_no_longer_available_is_refused_not_forced(self):
        with self.assertRaises(Refused) as caught:
            self.add({"key": f"{self.extra}|Remove|{self.john}||SA-NOPE"})

        self.assertIn("no longer available", str(caught.exception))

    def test_it_runs_through_the_same_door_and_shows_as_additional_in_the_recap(self):
        option = next(row for row in self.options() if row["service_item"] == self.extra)
        self.add(option)
        added = frappe.db.get_value(
            WORK_ORDER, {"service_request": self.name, "origin": "Technician"}, "name"
        )
        requested = frappe.db.get_value(
            WORK_ORDER, {"service_request": self.name, "origin": ["!=", "Technician"]}, "name"
        )

        for order in (requested, added):
            self.tech_does(
                lambda order=order: RequestExecutionService.execute_service_action(work_order=order)
            )
        self.sweep(self.name)

        plan = self.plan(self.name)
        kinds = sorted(row["kind"] for row in plan["recap"])

        self.assertEqual(kinds, ["requested", "technician"])
        self.assertEqual(plan["outcome"]["technician_added"], 1)
        self.assertEqual(plan["outcome"]["technician_done"], 1)
        self.assertEqual(plan["stages"]["current"], "verify")

    def test_nothing_is_offered_for_somebody_not_created_yet(self):
        name = self.approved(self.new_person_line(self.offering("TA2")))
        key = frappe.db.get_value(WORK_ORDER, {"service_request": name, "work_type": "User Setup"}, "subject_key")

        out = self.tech_does(
            lambda: RequestExecutionService.technician_options(request=name, subject_key=key)
        )

        self.assertEqual(out["options"], [])
        self.assertIn("Client User", out["reason"])


class TestWhatStaysInViewThroughout(FulfilmentCase):
    def test_the_request_and_its_note_are_on_the_plan(self):
        name = self.raised(self.line(self.offering("CX1")), details="Before Monday please.")
        for row in frappe.get_doc("MSP Service Request", name).lines:
            self.tech_does(
                lambda idx=row.idx: RequestService.set_line_status(
                    name=name, idx=idx, line_status="Approved"
                )
            )
        self.tech_does(lambda: RequestService.run_action(name=name, action="approve"))
        self.sweep(name)

        context = self.plan(name)["context"]

        self.assertEqual(context["customer"], self.customer)
        self.assertEqual(context["details"], "Before Monday please.")
        self.assertEqual(context["lines"], 1)
        self.assertEqual(context["people"], 1)
        self.assertTrue(context["requester_name"])
        self.assertTrue(context["customer_approved"])

    def test_the_recap_is_the_same_after_a_reload(self):
        name = self.approved(self.line(self.offering("CX2")))
        order = self.work(name, "Service Action").name
        self.tech_does(lambda: RequestExecutionService.execute_service_action(work_order=order))
        self.sweep(name)

        self.assertEqual(self.plan(name)["recap"], self.plan(name)["recap"])
        self.assertEqual(len(self.plan(name)["recap"]), 1)


class TestWhatIsKnownAboutEachPerson(FulfilmentCase):
    def test_the_request_carries_their_record_machines_services_and_other_requests(self):
        laptop = self.make_device(self.customer, f"PF-{self.tag}", holder=self.john, serial=f"ZZTEST-PF-{self.tag}")
        held = self.offering("PF1")
        opened = self.tech_does(
            lambda: ServiceLifecycleService.activate(
                customer=self.customer, service_item=held, target_scope="User", client_user=self.john
            )
        )
        self.track("MSP Service Assignment", opened["name"])
        other = self.raised(self.line(self.offering("PF2")))
        name = self.raised(self.line(self.offering("PF3")))

        facts = self.tech_does(lambda: RequestService.get_request(name))["people"][self.john]

        self.assertEqual(facts["username"], f"j.{self.tag}")
        self.assertIn(laptop, [row["name"] for row in facts["devices"]])
        self.assertIn(opened["name"], [row["name"] for row in facts["services"]])
        self.assertIn(other, [row["name"] for row in facts["open_requests"]])
        self.assertNotIn(name, [row["name"] for row in facts["open_requests"]])


class TestTheTechnicianDecidesTheAct(FulfilmentCase):
    """The customer asks; what the service really needs is the technician's call."""

    def running(self, suffix):
        service = self.offering(suffix)
        opened = self.tech_does(
            lambda: ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=service,
                target_scope="User",
                client_user=self.john,
                effective_date=frappe.utils.add_days(frappe.utils.today(), -30),
            )
        )
        self.track("MSP Service Assignment", opened["name"])

        return service, opened["name"]

    def test_a_closure_asked_for_can_be_carried_out_as_a_suspension(self):
        service, assignment = self.running("TD1")
        name = self.approved(self.line(service, action="Remove", source_service_assignment=assignment))
        order = self.work(name, "Service Action").name

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=order, action="Suspend")
        )
        self.sweep(name)

        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", assignment, "operational_status"), "Suspended"
        )
        wo = frappe.db.get_value(WORK_ORDER, order, ["action", "status", "execution_notes"], as_dict=True)
        self.assertEqual((wo.action, wo.status), ("Suspend", "Completed"))
        self.assertIn("request asked for Remove", wo.execution_notes)
        self.assertEqual(
            frappe.db.get_value("MSP Service Request Line", {"parent": name}, "action"), "Remove"
        )

    def test_a_change_can_move_the_person_onto_another_service(self):
        service, assignment = self.running("TD2")
        other = self.offering("TD3")
        name = self.approved(self.line(service, action="Change", source_service_assignment=assignment))
        order = self.work(name, "Service Action").name

        # closing the old period the day before is backdating, which is an administrator's call
        RequestExecutionService.execute_service_action(
            work_order=order, service_item=other, effective_date=frappe.utils.today()
        )
        self.sweep(name)

        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", assignment, "operational_status"), "Ended"
        )
        self.assertTrue(
            frappe.db.exists(
                "MSP Service Assignment",
                {"client_user": self.john, "service_item": other, "operational_status": "Active"},
            )
        )

    def test_something_asked_to_be_added_cannot_be_turned_into_another_act(self):
        name = self.approved(self.line(self.offering("TD4")))
        order = self.work(name, "Service Action").name

        with self.assertRaises(Refused):
            self.tech_does(
                lambda: RequestExecutionService.execute_service_action(work_order=order, action="Remove")
            )

    def test_a_direct_act_citing_the_request_shows_in_its_recap(self):
        service, assignment = self.running("TD5")
        name = self.approved(self.line(self.offering("TD6")))

        self.tech_does(
            lambda: ServiceLifecycleService.suspend(assignment=assignment, source_request=name)
        )

        recap = self.plan(name)["recap"]
        self.assertIn("technician", [row["kind"] for row in recap])
        self.assertTrue(any("Suspended" in row["title"] for row in recap))


class TestStoppingEveryServiceOfAPerson(FulfilmentCase):
    def test_every_personal_service_closes_and_their_machine_keeps_its_own(self):
        from nexgen_msp.api.internal.services.user_service import UserService

        opened = []
        for suffix in ("SA1", "SA2"):
            service = self.offering(suffix)
            out = ServiceLifecycleService.activate(
                customer=self.customer, service_item=service, target_scope="User", client_user=self.john
            )
            opened.append(self.track("MSP Service Assignment", out["name"]))

        laptop = self.make_device(self.customer, f"SA-{self.tag}", holder=self.john, serial=f"ZZTEST-SA-{self.tag}")
        machine_service = self.offering("SA3", scope="Device")
        on_machine = ServiceLifecycleService.activate(
            customer=self.customer, service_item=machine_service, target_scope="Device", managed_device=laptop
        )
        self.track("MSP Service Assignment", on_machine["name"])

        UserService.stop_all_services(name=self.john)

        for assignment in opened:
            self.assertEqual(
                frappe.db.get_value("MSP Service Assignment", assignment, "operational_status"), "Ended"
            )
        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", on_machine["name"], "operational_status"), "Active"
        )

    def test_nobody_with_nothing_to_stop_is_told_so(self):
        from nexgen_msp.api.internal.services.user_service import UserService

        with self.assertRaises(Refused):
            UserService.stop_all_services(name=self.john)
