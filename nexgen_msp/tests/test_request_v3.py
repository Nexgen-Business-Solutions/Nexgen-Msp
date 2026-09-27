"""A request keeps the shape the customer gave it, all the way to the work.

The customer thinks in people and in acts: "end Nextcloud for Purchasing". The application
has always thought in atomic targets, and had to guess the grouping back afterwards. V3 stops
guessing — the people and the acts are recorded as the customer built them, and the atomic
lines are derived from them.

What is checked here is the chain: one subject per selected person, one group per act, one
line per applicable target and nothing at all for the people an act cannot reach, and a
Work Order that still says which act it came from.
"""

import json

import frappe

from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.api.portal.services.request_v3_service import RequestV3Service

from .base import MSPTestCase

REQUEST = "MSP Service Request"
WORK_ORDER = "MSP Service Work Order"


class RequestV3Case(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(f"V3{self.tag[:4]}")
        self.track("MSP Approval Authority", self.customer)
        self.purchasing = self.make_department("Purchasing")
        self.alice = self.make_person(self.customer, "Alice")
        self.brice = self.make_person(self.customer, "Brice")
        self.carine = self.make_person(self.customer, "Carine")

        for person in (self.alice, self.brice, self.carine):
            frappe.db.set_value("MSP Client User", person, "department", self.purchasing)

        frappe.db.commit()

        self.service = self.make_service(f"V3S{self.tag[:3]}")
        self.cover_service(self.customer, self.service)
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"v3a{self.tag[:3]}"
        )
        self.grant(self.asker)
        self.tech = self.make_account("internal", "MSP Technician", suffix=f"v3t{self.tag[:3]}")

    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def running_for(self, person):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.service,
            target_scope="User",
            client_user=person,
        )

        return self.track("MSP Service Assignment", outcome["name"])

    def subjects(self, *people):
        rows = []

        for person in people:
            card = frappe.db.get_value(
                "MSP Client User", person, ["full_name", "department", "email"], as_dict=True
            )
            rows.append(
                {
                    "subject_key": f"user:{person}",
                    "client_user": person,
                    "full_name": card.full_name,
                    "department": card.department,
                    "email": card.email,
                    "added_via": "Department",
                    "selection_label": self.purchasing,
                }
            )

        return rows

    def evaluate(self, subjects, code):
        options = self.as_user(
            self.asker,
            lambda: RequestV3Service.operation_options(customer=self.customer, subjects=subjects),
        )
        services = next(
            domain for domain in options["domains"] if domain["key"] == "Service"
        )
        card = next(
            option for option in services["options"] if option["object_key"] == self.service
        )

        return next(action for action in card["actions"] if action["operation_code"] == code)

    def raise_group(self, subjects, action, scope=("All", None, "All selected")):
        group = {
            "group_key": f"grp:{frappe.generate_hash(length=8)}",
            "operation_code": action["operation_code"],
            "operation_label_snapshot": action["operation_label_snapshot"],
            "domain": "Service",
            "service_item": self.service,
            "source_scope_type": scope[0],
            "source_scope_key": scope[1],
            "source_scope_label": scope[2],
            "selected_subject_count": len(subjects),
            "targets": action["targets"],
            "exclusions": action["exclusions"],
        }
        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer, subjects=subjects, action_groups=[group]
            ),
        )

        return self.track(REQUEST, out["name"]), group


class TestWhatTheCustomerBuiltIsWhatIsStored(RequestV3Case):
    def test_one_subject_per_selected_person_and_one_group_per_act(self):
        self.running_for(self.alice)
        self.running_for(self.brice)
        subjects = self.subjects(self.alice, self.brice, self.carine)
        action = self.evaluate(subjects, "service.end")

        name, _ = self.raise_group(subjects, action)
        doc = frappe.get_doc(REQUEST, name)

        self.assertEqual(len(doc.subjects), 3, "every selected person is in the snapshot")
        self.assertEqual(len(doc.action_groups), 1, "one act the customer added, one group")
        self.assertEqual(
            {row.subject_key for row in doc.subjects},
            {f"user:{person}" for person in (self.alice, self.brice, self.carine)},
        )

    def test_only_applicable_targets_become_lines(self):
        self.running_for(self.alice)
        self.running_for(self.brice)
        subjects = self.subjects(self.alice, self.brice, self.carine)
        action = self.evaluate(subjects, "service.end")

        self.assertEqual(action["applicable_target_count"], 2)

        name, _ = self.raise_group(subjects, action)
        doc = frappe.get_doc(REQUEST, name)

        self.assertEqual(len(doc.lines), 2, "no line is written for a person nothing happens to")
        self.assertEqual(
            {row.client_user for row in doc.lines}, {self.alice, self.brice}
        )

    def test_the_group_keeps_the_scope_it_was_chosen_from(self):
        self.running_for(self.alice)
        subjects = self.subjects(self.alice, self.brice, self.carine)
        action = self.evaluate(subjects, "service.end")

        name, _ = self.raise_group(subjects, action)
        group = frappe.get_doc(REQUEST, name).action_groups[0]

        self.assertEqual(group.selected_subject_count, 3)
        self.assertEqual(group.applicable_target_count, 1)
        self.assertEqual(group.excluded_subject_count, 2)
        self.assertEqual(group.group_origin, "Customer")

    def test_the_unchanged_people_live_in_the_impact_snapshot_with_a_reason(self):
        self.running_for(self.alice)
        subjects = self.subjects(self.alice, self.brice)
        action = self.evaluate(subjects, "service.end")

        name, _ = self.raise_group(subjects, action)
        impact = json.loads(frappe.get_doc(REQUEST, name).action_groups[0].impact_snapshot_json)
        unchanged = [row for row in impact if row["status"] == "inapplicable"]

        self.assertEqual(len(unchanged), 1)
        self.assertEqual(unchanged[0]["subject_key"], f"user:{self.brice}")
        self.assertEqual(unchanged[0]["reason_code"], "NO_CURRENT_ASSIGNMENT")

    def test_a_target_the_customer_unchecks_is_not_requested(self):
        self.running_for(self.alice)
        self.running_for(self.brice)
        subjects = self.subjects(self.alice, self.brice)
        action = self.evaluate(subjects, "service.end")
        action = {
            **action,
            "targets": [
                target for target in action["targets"] if target["client_user"] == self.alice
            ],
        }

        name, _ = self.raise_group(subjects, action)
        doc = frappe.get_doc(REQUEST, name)

        self.assertEqual(len(doc.lines), 1)
        self.assertEqual(doc.lines[0].client_user, self.alice)


class TestEveryLineSaysWhereItCameFrom(RequestV3Case):
    def test_line_names_its_subject_and_its_group(self):
        self.running_for(self.alice)
        subjects = self.subjects(self.alice)
        action = self.evaluate(subjects, "service.end")

        name, group = self.raise_group(subjects, action)
        line = frappe.get_doc(REQUEST, name).lines[0]

        self.assertEqual(line.subject_key, f"user:{self.alice}")
        self.assertEqual(line.action_group_key, group["group_key"])
        self.assertEqual(line.operation_code, "service.end")

    def test_the_work_order_still_says_which_act_it_came_from(self):
        self.running_for(self.alice)
        subjects = self.subjects(self.alice)
        action = self.evaluate(subjects, "service.end")
        name, group = self.raise_group(subjects, action)

        self.as_user(
            self.tech,
            lambda: RequestService.set_line_status(name=name, idx=1, line_status="Approved"),
        )
        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="approve"))

        order = frappe.get_all(
            WORK_ORDER,
            filters={"service_request": name, "work_type": "Service Action"},
            fields=["name", "action_group_key", "subject_key", "request_line_name"],
        )[0]
        self.track(WORK_ORDER, order.name)

        self.assertEqual(order.action_group_key, group["group_key"])
        self.assertEqual(order.subject_key, f"user:{self.alice}")
        self.assertTrue(order.request_line_name)

    def test_the_plan_reads_the_same_work_by_person_and_by_act(self):
        self.running_for(self.alice)
        self.running_for(self.brice)
        subjects = self.subjects(self.alice, self.brice)
        action = self.evaluate(subjects, "service.end")
        name, group = self.raise_group(subjects, action)

        for idx in (1, 2):
            self.as_user(
                self.tech,
                lambda idx=idx: RequestService.set_line_status(
                    name=name, idx=idx, line_status="Approved"
                ),
            )

        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="approve"))

        plan = self.as_user(
            self.tech, lambda: RequestExecutionService.get_execution_plan(request=name)
        )

        for order in frappe.get_all(WORK_ORDER, filters={"service_request": name}, pluck="name"):
            self.track(WORK_ORDER, order)

        by_action = next(
            row for row in plan["action_groups"] if row["group_key"] == group["group_key"]
        )

        self.assertEqual(by_action["label"], action["operation_label_snapshot"])
        self.assertEqual(by_action["origin"], "Customer")
        self.assertEqual(by_action["total"], 2)
        self.assertEqual(
            sum(len(row["services"]) for row in plan["groups"]),
            by_action["total"],
            "the two readings count the same Work Orders",
        )


class TestWhatTheServerDecidesTheBrowserDoesNot(RequestV3Case):
    def test_an_act_is_offered_when_at_least_one_target_can_use_it(self):
        self.running_for(self.alice)
        subjects = self.subjects(self.alice, self.brice)
        action = self.evaluate(subjects, "service.end")

        self.assertEqual(action["applicable_target_count"], 1)
        self.assertEqual(
            [row["reason_code"] for row in action["exclusions"]], ["NO_CURRENT_ASSIGNMENT"]
        )

    def test_adding_is_refused_for_somebody_who_already_has_it(self):
        self.running_for(self.alice)
        subjects = self.subjects(self.alice, self.brice)
        action = self.evaluate(subjects, "service.add")

        self.assertEqual([target["client_user"] for target in action["targets"]], [self.brice])
        self.assertEqual(
            [row["reason_code"] for row in action["exclusions"]], ["ALREADY_ACTIVE"]
        )

    def test_the_people_table_reads_what_is_current_and_never_what_ended(self):
        assignment = self.running_for(self.alice)
        ServiceLifecycleService.end(assignment=assignment)
        self.running_for(self.brice)

        projection = self.as_user(
            self.asker,
            lambda: RequestV3Service.scope_projection(
                customer=self.customer, subjects=self.subjects(self.alice, self.brice)
            ),
        )
        rows = {row["subject_key"]: row for row in projection["subjects"]}

        self.assertEqual(rows[f"user:{self.alice}"]["current_services"], [])
        self.assertEqual(len(rows[f"user:{self.brice}"]["current_services"]), 1)

    def test_a_person_who_does_not_exist_yet_can_only_be_given_something_new(self):
        subjects = [
            *self.subjects(self.alice),
            {
                "subject_key": "new:draft-1",
                "is_new_user": True,
                "full_name": "Fresh Face",
                "department": self.purchasing,
            },
        ]
        add = self.evaluate(subjects, "service.add")

        self.assertIn("new:draft-1", [target["subject_key"] for target in add["targets"]])

        self.running_for(self.alice)
        end = self.evaluate(subjects, "service.end")

        self.assertNotIn("new:draft-1", [target["subject_key"] for target in end["targets"]])
        self.assertIn(
            "NEW_PERSON", [row["reason_code"] for row in end["exclusions"]]
        )
