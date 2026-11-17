"""A request keeps the shape the customer gave it, all the way to the work.

The customer thinks in people and in acts: "end Nextcloud for Purchasing". The application
has always thought in atomic targets, and had to guess the grouping back afterwards. This stops
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
from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

from .base import MSPTestCase

REQUEST = "MSP Request"
WORK_ORDER = "MSP Work Order"
ASSIGNMENT = "MSP Service Assignment"


class RequestScopeCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(f"SC{self.tag[:4]}")
        self.track("MSP Approval Authority", self.customer)
        self.purchasing = self.make_department("Purchasing")
        self.alice = self.make_person(self.customer, "Alice")
        self.brice = self.make_person(self.customer, "Brice")
        self.carine = self.make_person(self.customer, "Carine")

        for person in (self.alice, self.brice, self.carine):
            frappe.db.set_value("MSP Client User", person, "department", self.purchasing)

        frappe.db.commit()

        self.service = self.make_service(f"SCS{self.tag[:3]}")
        self.cover_service(self.customer, self.service)
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"sca{self.tag[:3]}"
        )
        self.grant(self.asker)
        self.tech = self.make_account("internal", "MSP Technician", suffix=f"sct{self.tag[:3]}")

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
            lambda: RequestScopeService.operation_options(customer=self.customer, subjects=subjects),
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


class TestWhatTheCustomerBuiltIsWhatIsStored(RequestScopeCase):
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


class TestEveryLineSaysWhereItCameFrom(RequestScopeCase):
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

        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="start_review"))
        self.as_user(
            self.tech,
            lambda: RequestService.set_line_status(name=name, idx=1, line_status="Approved"),
        )
        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="approve"))

        order = frappe.get_all(
            WORK_ORDER,
            filters={"request": name, "work_type": "Service Action"},
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
        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="start_review"))

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

        for order in frappe.get_all(WORK_ORDER, filters={"request": name}, pluck="name"):
            self.track(WORK_ORDER, order)

        by_action = next(
            row for row in plan["action_groups"] if row["group_key"] == group["group_key"]
        )

        self.assertEqual(by_action["label"], action["operation_label_snapshot"])
        self.assertEqual(by_action["origin"], "Customer")
        self.assertEqual(by_action["total"], 2)
        self.assertEqual(
            sum(row["total"] for row in plan["people"]),
            by_action["total"],
            "the two readings count the same Work Orders",
        )


class TestWhatTheServerDecidesTheBrowserDoesNot(RequestScopeCase):
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
            lambda: RequestScopeService.scope_projection(
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
                "kind": "new",
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

    def test_a_future_person_of_another_request_does_not_hold_back_this_one(self):
        earlier = {"subject_key": "new:earlier", "kind": "new", "full_name": "Earlier Face"}
        self.raise_group([earlier], self.evaluate([earlier], "service.add"))

        fresh = {"subject_key": "new:fresh", "kind": "new", "full_name": "Fresh Face"}
        add = self.evaluate([fresh], "service.add")

        self.assertEqual([target["subject_key"] for target in add["targets"]], ["new:fresh"])
        self.assertNotIn("PENDING_CONFLICT", [row["reason_code"] for row in add["exclusions"]])

    def machine_service(self):
        service = self.make_service(f"SCD{self.tag[:3]}", scope="Device")
        self.cover_service(self.customer, service)

        return service

    def machine_add(self, subjects, service, requested_devices=None):
        options = self.as_user(
            self.asker,
            lambda: RequestScopeService.operation_options(
                customer=self.customer, subjects=subjects, requested_devices=requested_devices
            ),
        )
        card = next(
            option
            for domain in options["domains"]
            if domain["key"] == "Service"
            for option in domain["options"]
            if option["object_key"] == service
        )

        return next(action for action in card["actions"] if action["operation_code"] == "service.add")

    def test_a_future_person_is_offered_what_somebody_with_no_machine_is(self):
        service = self.machine_service()
        fresh = {"subject_key": "new:fresh", "kind": "new", "full_name": "Fresh Face"}
        action = self.machine_add([*self.subjects(self.alice), fresh], service)

        self.assertEqual(action["applicable_target_count"], 0)
        self.assertEqual(
            {(row["subject_key"], row["reason_code"]) for row in action["exclusions"]},
            {(f"user:{self.alice}", "NO_CURRENT_DEVICE"), ("new:fresh", "NO_CURRENT_DEVICE")},
        )
        self.assertNotIn("blocked_reason", action)

    def test_a_requested_device_meant_for_them_takes_their_machine_service(self):
        service = self.machine_service()
        fresh = {"subject_key": "new:fresh", "kind": "new", "full_name": "Fresh Face"}
        action = self.machine_add(
            [*self.subjects(self.alice), fresh],
            service,
            requested_devices=[
                {
                    "device_requirement_key": "new-device:fresh",
                    "display_label": "New laptop",
                    "intended_holder_subject_key": "new:fresh",
                }
            ],
        )

        self.assertEqual(
            [(row["subject_key"], row["device_requirement_key"]) for row in action["targets"]],
            [("new:fresh", "new-device:fresh")],
        )
        self.assertEqual(action["targets"][0]["target_scope"], "Device")
        self.assertIsNone(action["targets"][0]["managed_device"])

    def test_the_people_table_says_which_people_are_still_to_come(self):
        projection = self.as_user(
            self.asker,
            lambda: RequestScopeService.scope_projection(
                customer=self.customer,
                subjects=[
                    *self.subjects(self.alice),
                    {"subject_key": "new:fresh", "kind": "new", "full_name": "Fresh Face"},
                ],
            ),
        )
        rows = {row["subject_key"]: row for row in projection["subjects"]}

        self.assertEqual(rows[f"user:{self.alice}"]["kind"], "existing")
        self.assertEqual(rows["new:fresh"]["kind"], "new")
        self.assertIsNone(rows["new:fresh"]["requested_client_user"])
        self.assertNotIn("is_new_user", rows["new:fresh"])


class TestAServiceAMachineAlreadyRunsIsNotOfferedAgain(RequestScopeCase):
    """Issue #36: the acts of a running device service, offered to the person who holds it.

    A customer could not ask to pause or stop a service their machine already runs. What
    the builder answers is read here through the one door the form calls, with the person
    selected and the machine theirs — the shape the ticket describes.
    """

    def running_on_a_machine(self):
        service = self.make_service(f"DS{self.tag[:3]}", scope="Device")
        self.cover_service(self.customer, service)
        machine = self.make_device(self.customer, hostname=f"BOX{self.tag[:3]}", holder=self.alice)
        assignment = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope="Device",
            managed_device=machine,
            effective_date=frappe.utils.today(),
        )["name"]
        self.track(ASSIGNMENT, assignment)

        return service, machine, assignment

    def offered(self, service):
        options = self.as_user(
            self.asker,
            lambda: RequestScopeService.operation_options(
                customer=self.customer, subjects=self.subjects(self.alice)
            ),
        )
        # a card with nothing to offer is not listed, and a domain with no cards left is
        # not listed either: both are the same answer, which is that nothing is offered
        services = next(
            (domain for domain in options["domains"] if domain["key"] == "Service"), None
        )
        card = next(
            (option for option in (services or {}).get("options", []) if option["object_key"] == service),
            None,
        )

        return {action["operation_code"] for action in card["actions"]} if card else set()

    def test_suspend_and_end_are_offered_and_add_is_not(self):
        service, _machine, _assignment = self.running_on_a_machine()

        codes = self.offered(service)

        self.assertIn("service.suspend", codes)
        self.assertIn("service.end", codes)
        self.assertNotIn("service.add", codes)

    def test_a_suspended_one_offers_resume_and_end(self):
        service, _machine, assignment = self.running_on_a_machine()
        ServiceLifecycleService.suspend(assignment=assignment)

        codes = self.offered(service)

        self.assertIn("service.resume", codes)
        self.assertIn("service.end", codes)
        self.assertNotIn("service.add", codes)

    def test_the_state_read_for_a_machine_is_the_machine_s_own(self):
        """`service_state` answered about the person, who holds no device service at all."""
        service, machine, _assignment = self.running_on_a_machine()

        state = self.as_user(
            self.asker,
            lambda: PortalService.service_state(
                service_item=service, client_user=self.alice, managed_device=machine
            ),
        )

        self.assertTrue(state["held"], "the machine runs it, whoever holds the machine")

    def test_a_personal_service_is_still_found_when_a_machine_is_named_too(self):
        """The page sends both; what the service is sold against decides where to look.

        Preferring the machine whenever one was named answered about the machine for a
        service only the person can hold, so a personal service read as free to add.
        """
        personal = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.service,
            target_scope="User",
            client_user=self.alice,
            effective_date=frappe.utils.today(),
        )["name"]
        self.track(ASSIGNMENT, personal)
        _service, machine, _assignment = self.running_on_a_machine()

        state = self.as_user(
            self.asker,
            lambda: PortalService.service_state(
                service_item=self.service, client_user=self.alice, managed_device=machine
            ),
        )

        self.assertTrue(state["held"], "it is theirs, whatever machine was named with it")

    def test_a_service_sold_at_either_scope_says_which_one_holds_it(self):
        """`Both` is two different things on a person and on one of their machines."""
        either = self.make_service(f"BO{self.tag[:3]}", scope="Both")
        self.cover_service(self.customer, either)
        machine = self.make_device(self.customer, hostname=f"BOT{self.tag[:3]}", holder=self.alice)
        personal = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=either,
            target_scope="User",
            client_user=self.alice,
            effective_date=frappe.utils.today(),
        )["name"]
        self.track(ASSIGNMENT, personal)

        state = self.as_user(
            self.asker,
            lambda: PortalService.service_state(
                service_item=either, client_user=self.alice, managed_device=machine
            ),
        )

        # the machine does not run it; the person does, and the answer says so
        self.assertTrue(state["held"])
        self.assertEqual(state["held_by"], "User")

    def test_work_that_cannot_be_carried_out_carries_no_day_either(self):
        """Blocked work is refused on the work screen; the page must not be the way round."""
        from nexgen_msp.api.internal.services.user_service import UserService

        running = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.service,
            target_scope="User",
            client_user=self.alice,
            effective_date=frappe.utils.add_days(frappe.utils.today(), -30),
        )["name"]
        self.track(ASSIGNMENT, running)

        request = frappe.get_doc(
            {
                "doctype": "MSP Request",
                "customer": self.customer,
                "request_type": "Change",
                "status": "Submitted",
                "requester": frappe.session.user,
            }
        )
        request.flags.ignore_validate = True
        request.insert(ignore_permissions=True)
        self.track(REQUEST, request.name)

        order = frappe.get_doc(
            {
                "doctype": "MSP Work Order",
                "request": request.name,
                "customer": self.customer,
                "work_type": "Service Action",
                "action": "Remove",
                "status": "Blocked",
                "target_scope": "User",
                "client_user": self.alice,
                "source_service_assignment": running,
            }
        )
        order.flags.ignore_validate = True
        order.insert(ignore_permissions=True)
        frappe.db.commit()
        self.track(WORK_ORDER, order.name)

        self.assertIsNone(UserService._asking_for(order.request, running, "End"))

    def test_a_machine_that_ran_it_once_does_not_answer_for_the_person_running_it_now(self):
        """`Both`, two assignments, one of them over: the live one is the answer."""
        either = self.make_service(f"BH{self.tag[:3]}", scope="Both")
        self.cover_service(self.customer, either)
        machine = self.make_device(self.customer, hostname=f"BHX{self.tag[:3]}", holder=self.alice)

        on_machine = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=either,
            target_scope="Device",
            managed_device=machine,
            effective_date=frappe.utils.add_days(frappe.utils.today(), -60),
        )["name"]
        self.track(ASSIGNMENT, on_machine)
        ServiceLifecycleService.end(
            assignment=on_machine, effective_date=frappe.utils.add_days(frappe.utils.today(), -30)
        )

        hers = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=either,
            target_scope="User",
            client_user=self.alice,
            effective_date=frappe.utils.add_days(frappe.utils.today(), -10),
        )["name"]
        self.track(ASSIGNMENT, hers)

        state = self.as_user(
            self.asker,
            lambda: PortalService.service_state(
                service_item=either, client_user=self.alice, managed_device=machine
            ),
        )

        self.assertTrue(state["live"], "the machine's old spell is not the current answer")
        self.assertEqual(state["held_by"], "User")

    def test_a_service_closed_for_a_day_to_come_is_still_held_today(self):
        """It is provided until that day, so asking to add it again is nonsense."""
        running = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.service,
            target_scope="User",
            client_user=self.alice,
            effective_date=frappe.utils.add_days(frappe.utils.today(), -30),
        )["name"]
        self.track(ASSIGNMENT, running)
        # closed for a day still ahead, as a request may ask
        frappe.db.set_value(
            ASSIGNMENT,
            running,
            {
                "effective_end_date": frappe.utils.add_days(frappe.utils.today(), 12),
                "operational_status": "Ended",
            },
            update_modified=False,
        )
        frappe.db.commit()

        codes = self.offered(self.service)

        self.assertNotIn("service.add", codes, "it is still running until that day")
        # and nothing else either: the lifecycle reads the record, which already says
        # Ended, so anything offered here would be refused the moment it was carried out
        self.assertEqual(codes, set())

    def test_a_pause_dated_ahead_does_not_offer_to_resume_it_yet(self):
        running = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.service,
            target_scope="User",
            client_user=self.alice,
            effective_date=frappe.utils.add_days(frappe.utils.today(), -30),
        )["name"]
        self.track(ASSIGNMENT, running)
        doc = frappe.get_doc(ASSIGNMENT, running)
        doc.append(
            "suspension_log",
            {"suspended_on": frappe.utils.add_days(frappe.utils.today(), 12)},
        )
        doc.operational_status = "Suspended"
        doc.flags.ignore_validate = True
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        codes = self.offered(self.service)

        self.assertNotIn("service.resume", codes, "the pause has not started")
        self.assertEqual(codes, set(), "a pause is already set: nothing more until it starts")


class TestWhereAServiceStandsOnEveryTarget(RequestScopeCase):
    """The three columns the service row answers with: target, status, and since when.

    An act is read from eligibility, which keeps only what it can reach — somebody who
    already holds the service is left out of Add, somebody who held it once is left out of
    everything. The row still has to say where the service stands on each of them, so these
    read the whole selection instead, and every date comes from a record.
    """

    def day(self, back):
        return frappe.utils.add_days(frappe.utils.today(), -back)

    def status_rows(self, service, *people):
        options = self.as_user(
            self.asker,
            lambda: RequestScopeService.operation_options(
                customer=self.customer, subjects=self.subjects(*people)
            ),
        )
        services = next(
            (domain for domain in options["domains"] if domain["key"] == "Service"), None
        )
        card = next(
            (
                option
                for option in (services or {}).get("options", [])
                if option["object_key"] == service
            ),
            None,
        )

        return card["service_status_rows"] if card else []

    def one_row(self, service, person):
        rows = [row for row in self.status_rows(service, person) if row["client_user"] == person]
        self.assertEqual(len(rows), 1, rows)

        return rows[0]

    def opened(self, person, when, service=None):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service or self.service,
            target_scope="User",
            client_user=person,
            effective_date=when,
        )

        return self.track(ASSIGNMENT, outcome["name"])

    def test_a_running_service_is_dated_from_the_day_it_started(self):
        self.opened(self.alice, self.day(40))

        row = self.one_row(self.service, self.alice)

        self.assertEqual(row["status"], "Active")
        self.assertEqual(row["status_since"], self.day(40))

    def test_a_target_no_act_can_reach_is_still_answered_for(self):
        """Already holding it is a reason to be left out of Add, not a reason to be unread."""
        self.opened(self.alice, self.day(40))

        add = self.evaluate(self.subjects(self.alice, self.brice), "service.add")

        self.assertEqual(
            [entry["client_user"] for entry in add["targets"]],
            [self.brice],
            "only the one who holds nothing can be given it",
        )
        self.assertEqual(
            [(entry["client_user"], entry["reason_code"]) for entry in add["exclusions"]],
            [(self.alice, "ALREADY_ACTIVE")],
        )

        rows = {
            row["client_user"]: row for row in self.status_rows(self.service, self.alice, self.brice)
        }

        self.assertEqual(rows[self.alice]["status"], "Active", "left out of Add, still read")
        self.assertEqual(rows[self.alice]["status_since"], self.day(40))
        self.assertEqual(rows[self.brice]["status"], "Not subscribed")

    def test_a_paused_service_is_dated_from_the_pause(self):
        assignment = self.opened(self.alice, self.day(40))
        ServiceLifecycleService.suspend(assignment=assignment, effective_date=self.day(10))

        row = self.one_row(self.service, self.alice)

        self.assertEqual(row["status"], "Suspended")
        self.assertEqual(row["status_since"], self.day(10))

    def test_a_service_served_again_is_dated_from_the_day_it_came_back(self):
        assignment = self.opened(self.alice, self.day(40))
        ServiceLifecycleService.suspend(assignment=assignment, effective_date=self.day(20))
        ServiceLifecycleService.resume(assignment=assignment, effective_date=self.day(5))

        row = self.one_row(self.service, self.alice)

        self.assertEqual(row["status"], "Active")
        self.assertEqual(
            row["status_since"], self.day(5), "the day it came back, not the day it started"
        )

    def test_a_closed_service_is_dated_from_its_last_day(self):
        assignment = self.opened(self.alice, self.day(40))
        ServiceLifecycleService.end(assignment=assignment, effective_date=self.day(10))

        row = self.one_row(self.service, self.alice)

        self.assertEqual(row["status"], "Ended")
        self.assertEqual(row["status_since"], self.day(10))

    def test_the_last_day_read_is_the_last_one_there_was(self):
        first = self.opened(self.alice, self.day(60))
        ServiceLifecycleService.end(assignment=first, effective_date=self.day(50))
        again = self.opened(self.alice, self.day(40))
        ServiceLifecycleService.end(assignment=again, effective_date=self.day(20))

        self.assertEqual(self.one_row(self.service, self.alice)["status_since"], self.day(20))

    def test_a_close_set_for_a_day_to_come_leaves_it_running_today(self):
        assignment = self.opened(self.alice, self.day(40))
        # closed for a day still ahead, as a request may ask: the lifecycle refuses to end a
        # service in the future, so the record is written the way a dated request leaves it
        frappe.db.set_value(
            ASSIGNMENT,
            assignment,
            {
                "effective_end_date": frappe.utils.add_days(frappe.utils.today(), 10),
                "operational_status": "Ended",
            },
            update_modified=False,
        )
        frappe.db.commit()

        rows = {
            row["client_user"]: row for row in self.status_rows(self.service, self.alice, self.brice)
        }

        self.assertEqual(
            rows[self.alice]["status"], "Active", "it is still being provided until that day"
        )
        self.assertEqual(rows[self.alice]["status_since"], self.day(40))

    def test_a_service_nobody_holds_is_not_dated(self):
        row = self.one_row(self.service, self.brice)

        self.assertEqual(row["status"], "Not subscribed")
        self.assertIsNone(row["status_since"])

    def test_a_person_with_no_machine_says_so_without_one_being_invented(self):
        service = self.make_service(f"SD{self.tag[:3]}", scope="Device")
        self.cover_service(self.customer, service)

        row = self.one_row(service, self.brice)

        self.assertEqual(row["status"], "No device")
        self.assertIsNone(row["managed_device"])
        self.assertIsNone(row["status_since"])

    def test_each_machine_of_the_same_person_answers_for_itself(self):
        service = self.make_service(f"SE{self.tag[:3]}", scope="Device")
        self.cover_service(self.customer, service)
        running = self.make_device(self.customer, hostname=f"ON{self.tag[:3]}", holder=self.alice)
        bare = self.make_device(self.customer, hostname=f"OFF{self.tag[:3]}", holder=self.alice)
        self.track(
            ASSIGNMENT,
            ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=service,
                target_scope="Device",
                managed_device=running,
                effective_date=self.day(15),
            )["name"],
        )

        rows = {row["managed_device"]: row for row in self.status_rows(service, self.alice)}

        self.assertEqual(rows[running]["status"], "Active")
        self.assertEqual(rows[running]["status_since"], self.day(15))
        self.assertEqual(rows[bare]["status"], "Not subscribed")
        self.assertIsNone(rows[bare]["status_since"])

    def test_another_customer_holding_it_is_no_business_of_this_one(self):
        other = self.make_customer(f"SO{self.tag[:4]}")
        self.cover_service(other, self.service)
        stranger = self.make_person(other, "Stranger")
        self.track(
            ASSIGNMENT,
            ServiceLifecycleService.activate(
                customer=other,
                service_item=self.service,
                target_scope="User",
                client_user=stranger,
                effective_date=self.day(30),
            )["name"],
        )

        rows = self.status_rows(self.service, self.alice)

        self.assertEqual([row["client_user"] for row in rows], [self.alice])
        self.assertEqual(rows[0]["status"], "Not subscribed")
