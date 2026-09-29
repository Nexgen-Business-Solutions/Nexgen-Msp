"""A batch of work builds the plan it answers with once, however many work orders it carries."""

from unittest.mock import patch

import frappe

from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService

from .test_requested_execution import WORK_ORDER, RequestedWorkCase


class TestTheBatchBuildsThePlanOnce(RequestedWorkCase):
    def five_additions(self):
        people = [self.helen, self.franck] + [
            self.make_person(self.customer, f"Batch {index} {self.tag}", department="Purchasing") for index in range(3)
        ]

        for index, person in enumerate(people):
            frappe.db.set_value("MSP Client User", person, "username", f"zz.b{index}{self.tag[:4]}")

        frappe.db.commit()
        subjects = [self.existing(person) for person in people]
        name = self.approved(
            subjects,
            [self.group("grp:m365", "service.add", [self.target(subject) for subject in subjects], service=self.m365)],
        )
        orders = [card["name"] for card in self.cards(self.plan(name)) if card["operation_code"] == "service.add"]
        self.assertEqual(len(orders), 5)

        return name, orders

    def counted(self, fn):
        original = RequestExecutionService.get_execution_plan

        with patch.object(RequestExecutionService, "get_execution_plan", side_effect=original) as built:
            out = self.as_tech(fn)

        return out, built.call_count

    def test_execute_work_orders_builds_the_plan_once_for_five(self):
        name, orders = self.five_additions()

        out, builds = self.counted(
            lambda: RequestExecutionService.execute_work_orders(
                request=name, executions=[{"work_order": order, "inputs": {}} for order in orders]
            )
        )

        self.assertEqual(builds, 1)
        self.assertEqual((out["completed"], out["failed"]), (5, 0))
        self.assertEqual({frappe.db.get_value(WORK_ORDER, order, "status") for order in orders}, {"Completed"})
        self.assertIn("action_groups", out["plan"])

    def test_execute_service_actions_builds_the_plan_once_for_five(self):
        name, orders = self.five_additions()

        out, builds = self.counted(lambda: RequestExecutionService.execute_service_actions(work_orders=orders))

        self.assertEqual(builds, 1)
        self.assertEqual(out["completed"], 5)
        self.assertEqual(frappe.db.count("MSP Service Assignment", {"source_request": name}), 5)

    def test_a_single_act_still_answers_with_the_plan(self):
        _name, orders = self.five_additions()

        out, builds = self.counted(lambda: RequestExecutionService.execute_service_action(work_order=orders[0]))

        self.assertEqual(builds, 1)
        self.assertIsInstance(out, dict)
        self.assertIn("action_groups", out)

    def test_the_endpoint_does_not_expose_the_switch(self):
        import inspect

        from nexgen_msp.api.internal.endpoints import v1

        for endpoint in (v1.execute_service_action, v1.execute_device_operation):
            self.assertNotIn("_plan", inspect.signature(endpoint).parameters)

        self.assertIn("_plan", inspect.signature(RequestExecutionService.execute_service_action).parameters)
