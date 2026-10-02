"""A request raised about a machine rather than about a person.

A machine nobody holds belongs to nobody, so there is no person to put in the People table and
no personal service to offer. The machine stands there in its own right, the acts that reach a
machine reach it, and a holder is named only if the customer wants one.
"""

import frappe

from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

from .writer_case import REQUEST, WriterCase


class DeviceSubjectCase(WriterCase):
    def setUp(self):
        super().setUp()
        self.shelf = self.make_device(
            self.customer, hostname=f"WF{self.tag[:4]}", serial=f"ZZTEST-WF-{self.tag}"
        )
        self.shelf_label = frappe.db.get_value("MSP Managed Device", self.shelf, "hostname")

    def machine(self, device=None, **values):
        """The machine as the builder names it among the subjects of a request."""
        name = device or self.shelf

        return {
            "subject_key": f"device:{name}",
            "kind": "device",
            "client_user": None,
            "managed_device": name,
            "full_name": frappe.db.get_value("MSP Managed Device", name, "hostname") or name,
            "added_via": "Device",
            **values,
        }

    def running_on_the_shelf(self):
        """A service already running on the machine nobody holds."""
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.sophos,
            target_scope="Device",
            managed_device=self.shelf,
            effective_date=frappe.utils.today(),
        )

        return self.track("MSP Service Assignment", outcome["name"])

    def projected(self, subjects):
        return self.as_manager(
            lambda: RequestScopeService.scope_projection(customer=self.customer, subjects=subjects)
        )["subjects"]

    def offered(self, subjects, groups=None):
        return self.as_manager(
            lambda: RequestScopeService.operation_options(
                customer=self.customer, subjects=subjects, action_groups=groups
            )
        )

    def domain(self, options, key):
        return next((row for row in options["domains"] if row["key"] == key), None)

    def action(self, options, code, service=None):
        for domain in options["domains"]:
            for card in domain["options"]:
                if service is not None and card.get("object_key") != service:
                    continue

                for entry in card.get("actions", [card]):
                    if entry.get("operation_code") == code:
                        return entry

        return None


class TestTheMachineStandsOnItsOwn(DeviceSubjectCase):
    def test_a_machine_nobody_holds_is_shown_by_its_hostname(self):
        row = self.projected([self.machine()])[0]

        self.assertEqual(row["kind"], "device")
        self.assertEqual(row["subject_key"], f"device:{self.shelf}")
        self.assertEqual(row["full_name"], self.shelf_label)
        self.assertEqual(row["managed_device"], self.shelf)
        self.assertIsNone(row["client_user"])
        self.assertTrue(row["usable"], "a machine in stock is exactly the one somebody asks for")
        self.assertEqual([device["name"] for device in row["devices"]], [self.shelf])

    def test_the_services_already_running_on_it_are_shown_although_nobody_holds_it(self):
        self.running_on_the_shelf()

        row = self.projected([self.machine()])[0]

        self.assertEqual(
            [service["service_item"] for service in row["current_services"]],
            [self.sophos],
            "a machine on the shelf still runs what it runs",
        )
        self.assertEqual(row["current_services"][0]["scope"], "Device")
        self.assertEqual(row["current_services"][0]["managed_device"], self.shelf)

    def test_what_runs_on_it_can_be_suspended_and_ended_without_a_holder(self):
        self.running_on_the_shelf()

        options = self.offered([self.machine()])

        for code in ("service.suspend", "service.end"):
            act = self.action(options, code, service=self.sophos)

            self.assertIsNotNone(act, code)
            self.assertEqual([target["managed_device"] for target in act["targets"]], [self.shelf], code)

    def test_a_machine_of_another_company_is_refused_like_any_other_target(self):
        other = self.make_customer("DSX")
        stranger = self.make_device(other, hostname=f"WX{self.tag[:4]}", serial=f"ZZTEST-WX-{self.tag}")
        row = self.projected([self.machine(device=stranger)])[0]

        self.assertFalse(row["usable"])
        self.assertEqual(row["reason_code"], "CROSS_CUSTOMER_TARGET")
        self.assertEqual(row["devices"], [])

    def test_a_retired_machine_can_be_named_but_nothing_is_asked_of_it(self):
        frappe.db.set_value("MSP Managed Device", self.shelf, "status", "Retired")
        frappe.db.commit()

        row = self.projected([self.machine()])[0]

        self.assertFalse(row["usable"])
        self.assertEqual(row["reason_code"], "DEVICE_NOT_ACTIVE")


class TestWhatCanBeAskedOfAMachine(DeviceSubjectCase):
    def test_a_device_service_reaches_it_and_a_personal_service_never_does(self):
        options = self.offered([self.machine()])
        on_machine = self.action(options, "service.add", service=self.sophos)
        personal = self.action(options, "service.add", service=self.m365)

        self.assertIsNotNone(on_machine, "a service that runs on a machine reaches this one")
        self.assertEqual(
            [target["managed_device"] for target in on_machine["targets"]], [self.shelf]
        )
        self.assertEqual(on_machine["targets"][0]["target_scope"], "Device")
        self.assertIsNone(on_machine["targets"][0]["client_user"])

        if personal:
            self.assertEqual(personal["targets"], [], "a machine is not a person")
            self.assertIn(
                "DEVICE_HAS_NO_PERSON",
                [entry["reason_code"] for entry in personal["exclusions"]],
            )

    def test_a_holder_can_be_named_for_it(self):
        transfer = self.action(self.offered([self.machine()]), "device.transfer")

        self.assertIsNotNone(transfer)
        self.assertEqual([target["managed_device"] for target in transfer["targets"]], [self.shelf])
        self.assertIsNone(transfer["targets"][0]["current_holder"])
        self.assertTrue(transfer["holder_options"], "somebody has to be offered to receive it")

    def test_the_act_is_called_assigning_a_holder_when_there_is_none_to_change(self):
        free = self.action(self.offered([self.machine()]), "device.transfer")
        held = self.action(self.offered([self.existing(self.franck)]), "device.transfer")

        self.assertEqual(free["operation_label"], "Assign holder")
        self.assertEqual(free["operation_label_snapshot"], "Assign holder")
        self.assertEqual(held["operation_label"], "Change holder")

    def test_nothing_is_taken_back_from_nobody(self):
        self.assertIsNone(self.action(self.offered([self.machine()]), "device.repossess"))

    def test_the_machine_is_never_offered_a_machine_of_its_own(self):
        self.assertIsNone(self.action(self.offered([self.machine()]), "device.assign"))

    def test_a_machine_somebody_holds_is_still_taken_back_from_them(self):
        held = self.offered([self.existing(self.franck)])

        self.assertIsNotNone(self.action(held, "device.repossess"))

    def test_people_and_machines_sit_in_the_same_request(self):
        rows = self.projected([self.existing(self.helen), self.machine()])

        self.assertEqual([row["kind"] for row in rows], ["existing", "device"])

        options = self.offered([self.existing(self.helen), self.machine()])
        personal = self.action(options, "service.add", service=self.m365)

        self.assertEqual(
            [target["client_user"] for target in personal["targets"]],
            [self.helen],
            "the person keeps their own services, the machine does not borrow them",
        )


class TestAMachineTheCustomerIsHavingMade(DeviceSubjectCase):
    """A machine described in the People step, before it exists, is still something to act on."""

    def described(self, **values):
        return {
            "subject_key": "device:new-device:fresh",
            "kind": "device",
            "client_user": None,
            "managed_device": None,
            "device_requirement_key": "new-device:fresh",
            "full_name": "New laptop",
            "added_via": "Device",
            **values,
        }

    def test_it_stands_in_the_table_under_the_label_it_was_given(self):
        row = self.projected([self.described()])[0]

        self.assertEqual(row["kind"], "device")
        self.assertEqual(row["full_name"], "New laptop")
        self.assertIsNone(row["managed_device"])
        self.assertTrue(row["usable"], "a machine being made is exactly what the request is about")
        self.assertEqual([device["label"] for device in row["devices"]], ["New laptop"])

    def test_a_device_service_is_offered_on_it_although_it_does_not_exist_yet(self):
        act = self.action(self.offered([self.described()]), "service.add", service=self.sophos)

        self.assertIsNotNone(act, "a service that runs on a machine reaches the one being made")
        self.assertEqual(
            [target["device_requirement_key"] for target in act["targets"]], ["new-device:fresh"]
        )
        self.assertIsNone(act["targets"][0]["managed_device"], "there is no record to point at yet")
        self.assertEqual(act["targets"][0]["target_scope"], "Device")

    def test_a_personal_service_still_never_reaches_it(self):
        personal = self.action(self.offered([self.described()]), "service.add", service=self.m365)

        if personal:
            self.assertEqual(personal["targets"], [])


class TestAMachineRequestIsWrittenAndReadBack(DeviceSubjectCase):
    def payload(self, groups):
        return {
            "priority": "Medium",
            "details": None,
            "requested_date": frappe.utils.today(),
            "subjects": [self.machine()],
            "requested_devices": [],
            "action_groups": groups,
        }

    def sophos_on_the_shelf(self):
        return [
            self.group(
                "grp:sophos",
                "service.add",
                [
                    self.target(
                        self.machine(),
                        "Device",
                        managed_device=self.shelf,
                        client_user=None,
                        full_name=self.shelf_label,
                    )
                ],
                service=self.sophos,
            )
        ]

    def test_a_service_asked_on_a_free_machine_is_stored_with_the_machine_as_its_subject(self):
        name = self.send(**self.payload(self.sophos_on_the_shelf()))["name"]
        doc = frappe.get_doc(REQUEST, name)

        self.assertEqual(len(doc.lines), 1)
        self.assertEqual(doc.lines[0].managed_device, self.shelf)
        self.assertIsNone(doc.lines[0].client_user)
        self.assertEqual(doc.lines[0].subject_key, f"device:{self.shelf}")

        self.assertEqual(len(doc.subjects), 1)
        self.assertEqual(doc.subjects[0].managed_device, self.shelf)
        self.assertIsNone(doc.subjects[0].client_user)
        self.assertEqual(doc.subjects[0].added_via, "Device")
        self.assertEqual(doc.subjects[0].full_name_snapshot, self.shelf_label)

    def test_the_draft_reopens_with_the_machine_still_its_subject(self):
        name = self.save(**self.payload(self.sophos_on_the_shelf()))["name"]
        reopened = self.reopen(name)
        subject = reopened["subjects"][0]

        self.assertEqual(subject["kind"], "device")
        self.assertEqual(subject["managed_device"], self.shelf)
        self.assertIsNone(subject["client_user"])
        self.assertEqual(subject["subject_key"], f"device:{self.shelf}")

    def test_a_subject_that_claims_to_be_both_a_machine_and_a_person_is_refused(self):
        with self.assertRaises(Exception) as caught:
            self.send(
                **{
                    **self.payload(self.sophos_on_the_shelf()),
                    "subjects": [self.machine(client_user=self.helen)],
                }
            )

        self.assertIn("machine, not a person", str(caught.exception))

    def test_a_machine_subject_naming_no_machine_is_refused(self):
        with self.assertRaises(Exception) as caught:
            self.send(
                **{
                    **self.payload(self.sophos_on_the_shelf()),
                    "subjects": [{**self.machine(), "managed_device": None}],
                }
            )

        self.assertIn("Choose the Device", str(caught.exception))

    def test_the_customer_reads_the_machine_as_the_subject_of_their_request(self):
        name = self.send(**self.payload(self.sophos_on_the_shelf()))["name"]
        shown = self.as_manager(lambda: PortalService.get_request(name))

        self.assertEqual(len(shown["lines"]), 1)
        self.assertEqual(shown["lines"][0]["managed_device"], self.shelf)


class TestTheMachineIsReadBackOnEveryScreen(DeviceSubjectCase):
    def setUp(self):
        super().setUp()
        self.tech = self.make_account("internal", "MSP Technician", suffix=f"ds{self.tag[:3]}")

    def raised(self):
        return self.send(
            priority="Medium",
            requested_date=frappe.utils.today(),
            subjects=[self.machine()],
            requested_devices=[],
            action_groups=[
                self.group(
                    "grp:sophos",
                    "service.add",
                    [
                        self.target(
                            self.machine(),
                            "Device",
                            managed_device=self.shelf,
                            client_user=None,
                            full_name=self.shelf_label,
                        )
                    ],
                    service=self.sophos,
                )
            ],
        )["name"]

    def test_the_shared_presentation_names_the_machine_and_links_to_its_file(self):
        from nexgen_msp.api.internal.services.request_presentation_service import (
            RequestPresentationService,
        )

        name = self.raised()
        shown = self.as_user(self.tech, lambda: RequestPresentationService.for_internal(name=name))
        subject = shown["subjects"][0]

        self.assertEqual(subject["type"], "device")
        self.assertEqual(subject["full_name"], self.shelf_label)
        self.assertEqual(subject["managed_device"], self.shelf)
        self.assertIsNone(subject["client_user"])
        self.assertEqual(subject["related_work_count"], 1, "the act belongs to the machine")

        target = shown["action_groups"][0]["targets"][0]

        self.assertEqual(target["target_kind"], "managed_device")
        self.assertEqual(target["target_name"], self.shelf)

    def test_the_technician_sees_the_machine_by_its_hostname_not_by_its_key(self):
        from nexgen_msp.api.internal.services.request_execution_service import (
            RequestExecutionService,
        )
        from nexgen_msp.api.internal.services.request_service import RequestService

        name = self.raised()
        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="start_review"))

        for row in frappe.get_doc(REQUEST, name).lines:
            self.as_user(
                self.tech,
                lambda idx=row.idx: RequestService.set_line_status(
                    name=name, idx=idx, line_status="Approved"
                ),
            )

        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="approve"))
        plan = self.as_user(
            self.tech, lambda: RequestExecutionService.get_execution_plan(request=name)
        )
        subject = next(row for row in plan["people"] if row["subject_key"] == f"device:{self.shelf}")

        self.assertEqual(subject["full_name"], self.shelf_label)
        self.assertEqual(subject["managed_device"], self.shelf)
        self.assertIsNone(subject["client_user"])
        self.assertFalse(subject["is_new"])
        self.assertEqual(subject["total"], 1)


class TestTheTechnicianReadsAMachineByItsName(DeviceSubjectCase):
    """A subject key is a key. Nobody should ever read one on a screen."""

    def setUp(self):
        super().setUp()
        self.tech = self.make_account("internal", "MSP Technician", suffix=f"dn{self.tag[:3]}")

    def carried(self, name):
        from nexgen_msp.api.internal.services.request_execution_service import (
            RequestExecutionService,
        )
        from nexgen_msp.api.internal.services.request_service import RequestService

        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="start_review"))

        for row in frappe.get_doc(REQUEST, name).lines:
            self.as_user(
                self.tech,
                lambda idx=row.idx: RequestService.set_line_status(
                    name=name, idx=idx, line_status="Approved"
                ),
            )

        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="approve"))

        return self.as_user(
            self.tech, lambda: RequestExecutionService.get_execution_plan(request=name)
        )

    def test_a_machine_being_made_is_read_by_the_label_it_was_given(self):
        key = "new-device:fresh"
        machine = {
            "subject_key": f"device:{key}",
            "kind": "device",
            "client_user": None,
            "managed_device": None,
            "device_requirement_key": key,
            "full_name": "New laptop",
            "added_via": "Device",
        }
        name = self.send(
            priority="Medium",
            requested_date=frappe.utils.today(),
            subjects=[machine],
            requested_devices=[
                {
                    "device_requirement_key": key,
                    "display_label": "New laptop",
                    "device_type": "Laptop",
                }
            ],
            action_groups=[
                self.group(
                    "grp:sophos",
                    "service.add",
                    [
                        self.target(
                            machine,
                            "Device",
                            managed_device=None,
                            device_requirement_key=key,
                            client_user=None,
                            full_name="New laptop",
                        )
                    ],
                    service=self.sophos,
                )
            ],
        )["name"]

        plan = self.carried(name)
        subject = next(row for row in plan["people"] if row["subject_key"] == f"device:{key}")

        self.assertEqual(subject["full_name"], "New laptop")
        self.assertNotIn("device:", subject["full_name"], "a key is never shown to anybody")
        self.assertNotIn("new-device:", subject["full_name"])
        self.assertIsNone(subject["client_user"])
        self.assertIsNotNone(subject["requested_device"], "it points at the machine being made")

    def test_a_machine_on_file_is_read_by_its_hostname(self):
        name = self.send(
            priority="Medium",
            requested_date=frappe.utils.today(),
            subjects=[self.machine()],
            requested_devices=[],
            action_groups=[
                self.group(
                    "grp:sophos",
                    "service.add",
                    [
                        self.target(
                            self.machine(),
                            "Device",
                            managed_device=self.shelf,
                            client_user=None,
                            full_name=self.shelf_label,
                        )
                    ],
                    service=self.sophos,
                )
            ],
        )["name"]

        plan = self.carried(name)
        subject = next(row for row in plan["people"] if row["subject_key"] == f"device:{self.shelf}")

        self.assertEqual(subject["full_name"], self.shelf_label)
        self.assertNotIn("device:", subject["full_name"])


class TestAFreeMachineIsStillBilled(DeviceSubjectCase):
    """Billing follows the assignment, not the person: a machine nobody holds is still served."""

    def quarter(self):
        today = frappe.utils.getdate()
        start = frappe.utils.get_first_day(frappe.utils.add_months(today, -1))

        return str(start), str(frappe.utils.get_last_day(frappe.utils.add_months(start, 2)))

    def lines_of(self, assignment):
        from nexgen_msp.api.internal.services.billing_service import BillingService

        contract = frappe.db.get_value("MSP Contract", {"customer": self.customer}, "name")
        start, end = self.quarter()

        rows, _terms = BillingService.build_lines(contract, start, end)

        return [row for row in rows if row.get("service_assignment") == assignment]

    def test_a_service_on_a_machine_nobody_holds_is_billed_like_any_other(self):
        assignment = self.running_on_the_shelf()

        self.assertIsNone(
            frappe.db.get_value("MSP Service Assignment", assignment, "client_user"),
            "the assignment names no person at all",
        )
        self.assertIsNone(
            frappe.db.get_value("MSP Managed Device", self.shelf, "assigned_client_user"),
            "and the machine is held by nobody",
        )

        billed = self.lines_of(assignment)

        self.assertEqual(len(billed), 1, "the run prices it exactly once")
        self.assertIsNone(billed[0]["exception_code"], billed[0].get("exception_detail"))
        self.assertGreater(billed[0]["billable_months"], 0)
        self.assertGreater(billed[0]["amount"], 0)
        self.assertEqual(billed[0]["hostname_snapshot"], self.shelf_label)
        # a Device service is billed to the machine, so no line of any kind names a person
        # in that column; who was carrying it is context, and there is nobody to put there
        self.assertIsNone(billed[0]["user_name_snapshot"])
        self.assertIsNone(billed[0]["holder_context_snapshot"], "nobody was carrying it")

    def test_the_same_service_on_a_held_machine_is_billed_the_same_way(self):
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        free = self.running_on_the_shelf()
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.sophos,
            target_scope="Device",
            managed_device=self.laptop,
            effective_date=frappe.utils.today(),
        )
        held = self.track("MSP Service Assignment", outcome["name"])

        on_shelf = self.lines_of(free)[0]
        on_laptop = self.lines_of(held)[0]

        self.assertEqual(on_shelf["billable_months"], on_laptop["billable_months"])
        self.assertEqual(on_shelf["amount"], on_laptop["amount"])
        self.assertIsNone(on_shelf["holder_context_snapshot"])
        self.assertIn(
            frappe.db.get_value("MSP Client User", self.franck, "full_name"),
            on_laptop["holder_context_snapshot"] or "",
            "the held one says who was carrying it",
        )

    def test_giving_it_a_holder_changes_who_it_is_billed_under_and_not_what_is_billed(self):
        from nexgen_msp.api.internal.services.device_lifecycle_service import (
            DeviceLifecycleService,
        )

        assignment = self.running_on_the_shelf()
        before = self.lines_of(assignment)[0]

        DeviceLifecycleService.assign(
            device=self.shelf, client_user=self.helen, effective_date=frappe.utils.today()
        )

        after = self.lines_of(assignment)[0]

        self.assertEqual(before["billable_months"], after["billable_months"])
        self.assertEqual(before["amount"], after["amount"])
        self.assertIsNone(before["holder_context_snapshot"])
        self.assertIn(
            frappe.db.get_value("MSP Client User", self.helen, "full_name"),
            after["holder_context_snapshot"] or "",
            "giving it a holder only adds who was carrying it",
        )

