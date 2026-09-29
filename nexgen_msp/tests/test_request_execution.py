"""The technician carries the whole request out from the request, and nothing else moves.

Every act goes through the domain that owns it: people through the user service, machines
through the device lifecycle, services through the service lifecycle. The execution service
orchestrates and records; it decides nothing of its own.

The two things that must never happen are a job done twice and a job done out of turn.
"""

from unittest.mock import patch

import frappe

from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import request_targets
from nexgen_msp.utils.errors import ValidationError as ServiceRefused

from .base import MSPTestCase

WORK_ORDER = "MSP Work Order"


class ExecutionCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.newcomers, self.owed = {}, {}
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", self.customer)
        self.john = self.make_person(self.customer, "John")
        frappe.db.set_value("MSP Client User", self.john, "username", f"j.{self.tag}")
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"ea{self.tag[:3]}"
        )
        self.grant(self.asker)
        self.tech = self.make_account("internal", "MSP Technician", suffix=f"et{self.tag[:3]}")

    # ------------------------------------------------------------------ helpers
    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def tech_does(self, fn):
        return self.as_user(self.tech, fn)

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

    def approved(self, *lines):
        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=list(lines),
                **self.described(lines),
            ),
        )
        name = self.track("MSP Request", out["name"])
        self.tech_does(lambda: RequestService.run_action(name=name, action="start_review"))

        doc = frappe.get_doc("MSP Request", name)
        for row in doc.lines:
            self.tech_does(
                lambda idx=row.idx: RequestService.set_line_status(
                    name=name, idx=idx, line_status="Approved"
                )
            )

        self.tech_does(lambda: RequestService.run_action(name=name, action="approve"))
        self.sweep(name)

        return name

    def sweep(self, request):
        """Everything the plan wrote, and everything carrying it out left behind."""
        for order in frappe.get_all(WORK_ORDER, filters={"request": request}, pluck="name"):
            self.track(WORK_ORDER, order)

        for assignment in frappe.get_all(
            "MSP Service Assignment", filters={"source_request": request}, pluck="name"
        ):
            self.track("MSP Service Assignment", assignment)

    def work(self, request, work_type, index=0):
        return frappe.get_all(
            WORK_ORDER,
            filters={"request": request, "work_type": work_type},
            fields=["name", "action", "status", "target_scope"],
            order_by="request_line_idx asc, creation asc",
        )[index]

    def state(self, order):
        return frappe.db.get_value(WORK_ORDER, order, "status")

    def requested(self, request, doctype="MSP Requested Client User"):
        return frappe.get_all(doctype, filters={"request": request}, pluck="name")[0]

    def assign_line(self, owner=None, **fields):
        """The act that hands the machine asked for to the person it was asked for."""
        owner = owner or f"user:{self.john}"
        row = {
            "operation_code": "device.assign",
            "target_scope": "Device",
            "device_requirement_key": f"new-device:{owner}",
            **fields,
        }

        if owner in self.newcomers:
            row["subject_key"] = owner
            row["requested_holder_subject_key"] = owner
        else:
            row["requested_for_user"] = self.john
            row["requested_holder"] = self.john

        return row

    def create_person(self, request, **values):
        person = self.tech_does(
            lambda: RequestedClientUserService.resolve_create(self.requested(request), values)
        )

        return self.track("MSP Client User", person)

    def register_machine(self, request, **values):
        device = self.tech_does(
            lambda: RequestedDeviceService.resolve_new(
                self.requested(request, "MSP Requested Device"), values
            )
        )

        return self.track("MSP Managed Device", device)

    def choose_machine(self, request, device):
        return self.tech_does(
            lambda: RequestedDeviceService.resolve_existing(
                self.requested(request, "MSP Requested Device"), device
            )
        )

    def hand_over(self, request):
        order = frappe.get_all(
            WORK_ORDER,
            filters={"request": request, "operation_code": "device.assign"},
            pluck="name",
        )[0]

        return self.tech_does(lambda: RequestExecutionService.execute_device_operation(work_order=order))


class TestOpeningTheAccountARequestAskedFor(ExecutionCase):
    def test_the_person_is_created_once_for_every_line_that_named_them(self):
        name = self.approved(
            self.new_person_line(self.offering("US1")),
            self.new_person_line(self.offering("US2")),
        )
        requested = self.requested(name)
        created = self.create_person(name, username="m.dupont")

        orders = frappe.get_all(
            WORK_ORDER, filters={"request": name}, fields=["client_user", "requested_client_user"]
        )
        rows = frappe.get_all(
            "MSP Request Line",
            filters={"parent": name},
            fields=["client_user", "requested_client_user"],
        )

        self.assertEqual({row.client_user for row in orders}, {created}, "the work names the person now")
        self.assertEqual({row.requested_client_user for row in orders}, {requested})
        self.assertEqual({row.client_user for row in rows}, {None}, "the lines keep the customer's words")
        self.assertEqual({row.requested_client_user for row in rows}, {requested})
        self.assertEqual(
            frappe.db.get_value("MSP Requested Client User", requested, "resolved_client_user"), created
        )

    def test_the_account_opens_through_the_domain_that_owns_people(self):
        name = self.approved(self.new_person_line(self.offering("US3")))
        created = self.create_person(name, username="m.dupont")
        card = frappe.db.get_value(
            "MSP Client User", created, ["full_name", "customer", "username"], as_dict=True
        )

        self.assertEqual(card.full_name, "Marie Dupont")
        self.assertEqual(card.customer, self.customer)
        self.assertEqual(card.username, "m.dupont")
        self.assertTrue(
            frappe.db.exists(
                "Comment",
                {"reference_doctype": "MSP Client User", "reference_name": created, "content": ("like", f"%{name}%")},
            ),
            "the person's history says which request brought them",
        )

    def test_the_services_owed_to_them_can_be_picked_up_the_moment_they_exist(self):
        name = self.approved(self.new_person_line(self.offering("US4")))
        requested = self.requested(name)

        plan = self.tech_does(
            lambda: RequestExecutionService.resolve_requested(
                kind="client_user", name=requested, mode="create", values={"username": "m.dupont"}
            )
        )["plan"]
        self.track("MSP Client User", frappe.db.get_value("MSP Requested Client User", requested, "resolved_client_user"))
        card = plan["action_groups"][0]["work"][0]

        self.assertEqual(plan["outcome"]["requested_client_users_resolved"], 1)
        self.assertTrue(card["ready"])
        self.assertEqual(card["display_status"], "Ready")

    def test_opening_it_twice_opens_one_person_and_a_different_choice_is_refused(self):
        name = self.approved(self.new_person_line(self.offering("US5")))
        created = self.create_person(name, username="m.dupont")

        again = self.tech_does(lambda: RequestedClientUserService.resolve_create(self.requested(name)))

        self.assertEqual(again, created)
        self.assertEqual(frappe.db.count("MSP Client User", {"full_name": "Marie Dupont"}), 1)

        with self.assertRaises(ServiceRefused) as caught:
            self.tech_does(
                lambda: RequestedClientUserService.resolve_existing(self.requested(name), self.john)
            )

        self.assertIn("already been resolved to a different record", str(caught.exception))


class TestSettlingTheMachine(ExecutionCase):
    def test_a_new_machine_is_registered_and_handed_to_its_person(self):
        name = self.approved(
            self.line(self.offering("DV1", scope="Device"), on_requested_device=True),
            self.assign_line(),
        )
        device = self.register_machine(
            name, hostname="laptop-dv1", serial_number=f"SN-{self.tag}", device_type="PC"
        )

        self.assertIsNone(
            frappe.db.get_value("MSP Managed Device", device, "assigned_client_user"),
            "registering puts it in stock; the hand-over is the assign line's work",
        )

        self.hand_over(name)
        card = frappe.db.get_value(
            "MSP Managed Device",
            device,
            ["hostname", "serial_number", "assigned_client_user"],
            as_dict=True,
        )

        self.assertEqual(card.hostname, "LAPTOP-DV1")
        self.assertEqual(card.serial_number, f"SN-{self.tag}")
        self.assertEqual(card.assigned_client_user, self.john)

    def test_a_new_machine_keeps_what_its_case_says(self):
        name = self.approved(self.line(self.offering("DV9", scope="Device"), on_requested_device=True))
        device = self.register_machine(
            name,
            hostname="laptop-dv9",
            serial_number=f"HW-{self.tag}",
            manufacturer="Lenovo",
            model="ThinkPad T14",
            operating_system="Windows 11",
        )
        card = frappe.db.get_value(
            "MSP Managed Device", device, ["manufacturer", "model", "operating_system"], as_dict=True
        )

        self.assertEqual((card.manufacturer, card.model, card.operating_system), ("Lenovo", "ThinkPad T14", "Windows 11"))

    def test_a_machine_without_a_serial_is_refused(self):
        name = self.approved(self.line(self.offering("DV2", scope="Device"), on_requested_device=True))

        with self.assertRaises(ServiceRefused) as caught:
            self.register_machine(name, hostname="LAPTOP-DV2")

        self.assertIn("serial number", str(caught.exception))
        self.assertEqual(
            frappe.db.get_value("MSP Requested Device", self.requested(name, "MSP Requested Device"), "status"),
            "Open",
        )

    def test_one_machine_settles_every_service_that_was_owed_it(self):
        name = self.approved(
            self.line(self.offering("DV3A", scope="Device"), on_requested_device=True),
            self.line(self.offering("DV3B", scope="Device"), on_requested_device=True),
            self.line(self.offering("DV3C", scope="Device"), on_requested_device=True),
        )
        requested = self.requested(name, "MSP Requested Device")
        device = self.register_machine(name, hostname="laptop-dv3", serial_number=f"SN3-{self.tag}")

        orders = frappe.get_all(
            WORK_ORDER,
            filters={"request": name},
            fields=["managed_device", "requested_device", "target_scope"],
        )
        rows = frappe.get_all(
            "MSP Request Line",
            filters={"parent": name},
            fields=["managed_device", "target_scope", "requested_device"],
        )

        self.assertEqual({row.managed_device for row in orders}, {device})
        self.assertEqual({row.requested_device for row in orders}, {requested})
        self.assertEqual({row.target_scope for row in rows}, {"Device"})
        self.assertEqual({row.requested_device for row in rows}, {requested}, "the lines keep the Requested Device")
        self.assertEqual({row.managed_device for row in rows}, {None})
        self.assertEqual(
            frappe.db.get_value("MSP Requested Device", requested, "resolved_managed_device"), device
        )

    def test_a_machine_on_the_shelf_is_taken_from_stock(self):
        device = self.make_device(self.customer, hostname="STOCK1", serial=f"SS-{self.tag}")
        name = self.approved(
            self.line(self.offering("DV4", scope="Device"), on_requested_device=True),
            self.assign_line(),
        )

        self.choose_machine(name, device)
        self.hand_over(name)

        self.assertEqual(
            frappe.db.get_value("MSP Managed Device", device, "assigned_client_user"), self.john
        )

    def test_a_shelf_machine_with_no_serial_asks_for_it_before_its_service_is_given(self):
        device = self.make_device(self.customer, hostname="NOSN1")
        frappe.db.set_value("MSP Managed Device", device, "serial_number", None)
        name = self.approved(self.line(self.offering("DV8", scope="Device"), on_requested_device=True))
        job = self.work(name, "Service Action")

        self.choose_machine(name, device)
        card = self.tech_does(lambda: RequestExecutionService.get_execution_plan(request=name))[
            "action_groups"
        ][0]["work"][0]

        self.assertEqual(card["display_status"], "Needs information")
        self.assertEqual(card["prerequisite_action"]["kind"], "complete_serial")

        with self.assertRaises(ServiceRefused) as refused:
            self.tech_does(lambda: RequestExecutionService.execute_service_action(work_order=job.name))
        self.assertIn("no serial number", str(refused.exception).lower())
        self.assertFalse(frappe.db.exists("MSP Service Assignment", {"source_request": name}))

        self.tech_does(
            lambda: RequestExecutionService.save_required_identifiers(
                request=name, values=[{"kind": "serial_number", "owner": device, "value": f"NS-{self.tag}"}]
            )
        )
        self.tech_does(lambda: RequestExecutionService.execute_service_action(work_order=job.name))
        self.sweep(name)

        self.assertEqual(frappe.db.get_value("MSP Managed Device", device, "serial_number"), f"NS-{self.tag}")
        self.assertEqual(self.state(job.name), "Completed")

    def test_a_machine_somebody_else_holds_is_never_taken_silently(self):
        bob = self.make_person(self.customer, "Bob")
        device = self.make_device(
            self.customer, hostname="HELD1", holder=bob, serial=f"SH-{self.tag}"
        )
        name = self.approved(
            self.line(self.offering("DV5", scope="Device"), on_requested_device=True),
            self.assign_line(),
        )

        self.choose_machine(name, device)

        self.assertEqual(
            frappe.db.get_value("MSP Managed Device", device, "assigned_client_user"),
            bob,
            "choosing the machine moves nothing",
        )
        plan = self.tech_does(lambda: RequestExecutionService.get_execution_plan(request=name))
        card = next(
            card
            for group in plan["action_groups"]
            for card in group["work"]
            if card["operation_code"] == "device.assign"
        )

        self.assertEqual(card["relationship"]["from_label"], "ZZTEST Bob")
        self.assertEqual(card["relationship"]["to_label"], "ZZTEST John")
        self.assertEqual(card["target"]["sublabel"], "ZZTEST Bob → ZZTEST John")

    def test_it_is_transferred_once_the_technician_carries_the_assignment_out(self):
        bob = self.make_person(self.customer, "Bob")
        device = self.make_device(
            self.customer, hostname="HELD2", holder=bob, serial=f"SH2-{self.tag}"
        )
        name = self.approved(
            self.line(self.offering("DV6", scope="Device"), on_requested_device=True),
            self.assign_line(),
        )

        self.choose_machine(name, device)
        self.hand_over(name)

        self.assertEqual(
            frappe.db.get_value("MSP Managed Device", device, "assigned_client_user"), self.john
        )
        self.assertEqual(
            frappe.get_all(
                "MSP Device Holder",
                filters={"parent": device, "parenttype": "MSP Managed Device"},
                fields=["client_user", "is_current"],
                order_by="idx asc",
            ),
            [{"client_user": bob, "is_current": 0}, {"client_user": self.john, "is_current": 1}],
            "the change of holder closes Bob's period and opens John's",
        )

    def test_a_machine_they_held_before_can_be_given_back_to_them(self):
        """Phase 1 allows a second holding period; nothing here may forbid it."""
        from nexgen_msp.api.internal.services.device_lifecycle_service import (
            DeviceLifecycleService,
        )

        device = self.make_device(
            self.customer, hostname="AGAIN1", holder=self.john, serial=f"SA-{self.tag}"
        )
        DeviceLifecycleService.repossess(device=device)

        name = self.approved(
            self.line(self.offering("DV7", scope="Device"), on_requested_device=True),
            self.assign_line(),
        )

        self.choose_machine(name, device)
        self.hand_over(name)

        self.assertEqual(
            frappe.db.get_value("MSP Managed Device", device, "assigned_client_user"), self.john
        )


class TestActingOnTheService(ExecutionCase):
    def test_adding_a_service_opens_it_through_the_service_domain(self):
        service = self.offering("SA1")
        name = self.approved(self.line(service))
        job = self.work(name, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=job.name)
        )
        self.sweep(name)

        assignment = frappe.db.get_value(WORK_ORDER, job.name, "resulting_assignment")
        card = frappe.db.get_value(
            "MSP Service Assignment",
            assignment,
            ["operational_status", "client_user", "source_request"],
            as_dict=True,
        )

        self.assertEqual(card.operational_status, "Active")
        self.assertEqual(card.client_user, self.john)
        self.assertEqual(card.source_request, name)

    def test_it_is_done_the_moment_the_record_proves_it_ran(self):
        name = self.approved(self.line(self.offering("SA2")))
        job = self.work(name, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=job.name)
        )
        self.sweep(name)

        self.assertEqual(self.state(job.name), "Completed")

    def test_the_first_real_act_puts_the_request_to_work(self):
        name = self.approved(self.line(self.offering("SA3")))

        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Approved")

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(
                work_order=self.work(name, "Service Action").name
            )
        )
        self.sweep(name)

        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "In Progress")

    def test_running_it_twice_opens_no_second_service(self):
        name = self.approved(self.line(self.offering("SA4")))
        job = self.work(name, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=job.name)
        )
        self.sweep(name)

        with self.assertRaises(ServiceRefused) as caught:
            self.tech_does(
                lambda: RequestExecutionService.execute_service_action(work_order=job.name)
            )

        self.assertIn("already carried out", str(caught.exception))
        self.assertEqual(frappe.db.count("MSP Service Assignment", {"source_request": name}), 1)

    def test_a_service_cannot_run_before_the_person_it_is_for_exists(self):
        name = self.approved(self.new_person_line(self.offering("SA5")))
        job = self.work(name, "Service Action")

        with self.assertRaises(ServiceRefused) as caught:
            self.tech_does(
                lambda: RequestExecutionService.execute_service_action(work_order=job.name)
            )

        self.assertEqual(caught.exception.message, "Requested Client User must be resolved")

    def test_a_device_service_cannot_run_before_the_machine_is_settled(self):
        name = self.approved(self.line(self.offering("SA6", scope="Device"), on_requested_device=True))
        job = self.work(name, "Service Action")

        with self.assertRaises(ServiceRefused) as caught:
            self.tech_does(
                lambda: RequestExecutionService.execute_service_action(work_order=job.name)
            )

        self.assertEqual(caught.exception.message, "Requested Device must be resolved")

    def test_suspending_reaches_the_service_that_was_named(self):
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        service = self.offering("SA7")
        opened = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope="User",
            client_user=self.john,
        )
        self.track("MSP Service Assignment", opened["name"])

        name = self.approved(
            self.line(service, action="Suspend", source_service_assignment=opened["name"])
        )
        job = self.work(name, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=job.name)
        )

        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", opened["name"], "operational_status"),
            "Suspended",
        )


class TestWorkDoneFromThePersonMenu(ExecutionCase):
    """The ⋯ menu stays available; what it already did settles the line waiting for it."""

    def opened(self, service):
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        out = ServiceLifecycleService.activate(
            customer=self.customer, service_item=service, target_scope="User", client_user=self.john
        )
        return self.track("MSP Service Assignment", out["name"])

    def settle(self, name):
        return self.tech_does(lambda: RequestExecutionService.settle_work_done_elsewhere(request=name))

    def test_a_service_already_ended_from_the_menu_settles_the_removal_line(self):
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        service = self.offering("ME1")
        running = self.opened(service)
        name = self.approved(self.line(service, action="Remove", source_service_assignment=running))
        job = self.work(name, "Service Action")

        self.tech_does(lambda: ServiceLifecycleService.end(assignment=running))
        self.settle(name)

        self.assertEqual(self.state(job.name), "Completed")
        self.assertEqual(
            frappe.db.get_value(WORK_ORDER, job.name, "resulting_assignment"), running
        )

    def test_a_service_already_given_from_the_menu_settles_the_line_that_asked_for_it(self):
        service = self.offering("ME2")
        name = self.approved(self.line(service))
        job = self.work(name, "Service Action")

        given = self.tech_does(lambda: self.opened(service))
        self.settle(name)

        self.assertEqual(self.state(job.name), "Completed")
        self.assertEqual(frappe.db.get_value(WORK_ORDER, job.name, "resulting_assignment"), given)

    def test_a_line_nobody_has_done_yet_stays_to_do(self):
        service = self.offering("ME3")
        name = self.approved(self.line(service))
        job = self.work(name, "Service Action")

        self.settle(name)

        self.assertNotEqual(self.state(job.name), "Completed")


class TestActionsAddedWhileWorking(ExecutionCase):
    def test_an_act_from_the_person_menu_keeps_its_own_name_into_the_recap(self):
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        service = self.offering("DYN")
        opened = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope="User",
            client_user=self.john,
        )
        self.track("MSP Service Assignment", opened["name"])

        name = self.approved(self.line(self.offering("BASE")))
        self.tech_does(
            lambda: ServiceLifecycleService.suspend(assignment=opened["name"], source_request=name)
        )
        plan = self.tech_does(
            lambda: RequestExecutionService.settle_work_done_elsewhere(request=name)
        )

        entry = next(row for row in plan["recap"] if row["kind"] == "technician")
        self.assertIn(frappe.db.get_value("Item", service, "item_name"), entry["title"])
        self.assertIn("Suspended", entry["title"])
        self.assertEqual(entry["subject_key"], f"user:{self.john}")
        self.assertEqual(plan["outcome"]["technician_added"], 1)
        self.assertFalse(
            frappe.db.exists(WORK_ORDER, {"request": name, "origin": "Technician"}),
            "nothing is added to the customer's work",
        )

    def test_a_profile_change_recorded_in_the_workflow_appears_in_the_recap(self):
        name = self.approved(self.line(self.offering("PROFILE")))
        subject_key = frappe.db.get_value(
            "MSP Request Line", {"parent": name}, "subject_key"
        )

        plan = self.tech_does(
            lambda: RequestExecutionService.record_context_action(
                request=name,
                subject_key=subject_key,
                label="User information updated",
                detail="John's department and email were updated.",
            )
        )
        self.sweep(name)

        entry = next(row for row in plan["recap"] if row["title"] == "User information updated")
        self.assertIn("department", entry["detail"])
        self.assertEqual(plan["outcome"]["context_done"], 1)


class TestWhenSomethingGetsInTheWay(ExecutionCase):
    def test_a_failed_resolution_rolls_back_the_person_and_their_work(self):
        name = self.approved(self.new_person_line(self.offering("TX1")))
        requested = self.requested(name)

        with patch.object(request_targets, "refresh_work_orders", side_effect=RuntimeError("refresh failed")):
            with self.assertRaises(RuntimeError):
                self.tech_does(
                    lambda: RequestedClientUserService.resolve_create(
                        requested, {"username": f"tx1.{self.tag}"}
                    )
                )

        self.assertFalse(
            frappe.db.exists(
                "MSP Client User", {"customer": self.customer, "username": f"tx1.{self.tag}"}
            )
        )
        self.assertEqual(
            frappe.db.get_value("MSP Requested Client User", requested, ["status", "resolved_client_user"]),
            ("Open", None),
        )
        self.assertIsNone(frappe.db.get_value(WORK_ORDER, {"request": name}, "client_user"))
        self.assertEqual(
            frappe.db.get_value("MSP Request Line", {"parent": name}, "requested_client_user"),
            requested,
        )

    def test_a_failed_registration_rolls_back_the_device_and_its_work(self):
        serial = f"TX2-{self.tag}"
        name = self.approved(
            self.line(self.offering("TX2", scope="Device"), on_requested_device=True)
        )
        requested = self.requested(name, "MSP Requested Device")

        with patch.object(request_targets, "refresh_work_orders", side_effect=RuntimeError("refresh failed")):
            with self.assertRaises(RuntimeError):
                self.register_machine(name, hostname="ROLLBACK-TX2", serial_number=serial)

        self.assertFalse(frappe.db.exists("MSP Managed Device", {"serial_number": serial}))
        self.assertEqual(
            frappe.db.get_value("MSP Requested Device", requested, ["status", "resolved_managed_device"]),
            ("Open", None),
        )
        self.assertIsNone(frappe.db.get_value(WORK_ORDER, {"request": name}, "managed_device"))
        self.assertEqual(
            frappe.db.get_value("MSP Request Line", {"parent": name}, "requested_device"), requested
        )

    def test_failed_service_orchestration_rolls_back_the_open_assignment(self):
        name = self.approved(self.line(self.offering("TX3")))
        job = self.work(name, "Service Action")

        with patch.object(
            RequestExecutionService, "_executed", side_effect=RuntimeError("follow-up failed")
        ):
            with self.assertRaises(RuntimeError):
                self.tech_does(
                    lambda: RequestExecutionService.execute_service_action(work_order=job.name)
                )

        self.assertFalse(
            frappe.db.exists("MSP Service Assignment", {"source_request": name})
        )
        self.assertEqual(frappe.db.get_value(WORK_ORDER, job.name, "resulting_assignment"), None)

    def test_blocked_work_says_why_and_leaves_the_rest_alone(self):
        keep = self.offering("BL1")
        stuck = self.offering("BL2")
        name = self.approved(self.line(keep), self.line(stuck))
        first, second = (self.work(name, "Service Action", i) for i in range(2))

        self.tech_does(
            lambda: RequestExecutionService.block_work_item(
                work_order=second.name, reason="Waiting for the vendor licence"
            )
        )
        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=first.name)
        )
        self.sweep(name)

        self.assertEqual(self.state(second.name), "Blocked")
        self.assertEqual(self.state(first.name), "Completed")
        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "In Progress")

    def test_blocking_without_saying_why_is_refused(self):
        name = self.approved(self.line(self.offering("BL3")))
        job = self.work(name, "Service Action")

        with self.assertRaises(ServiceRefused):
            self.tech_does(
                lambda: RequestExecutionService.block_work_item(work_order=job.name)
            )

    def test_blocked_work_cannot_be_run_until_it_is_resumed(self):
        name = self.approved(self.line(self.offering("BL4")))
        job = self.work(name, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.block_work_item(
                work_order=job.name, reason="Vendor is down"
            )
        )

        with self.assertRaises(ServiceRefused):
            self.tech_does(
                lambda: RequestExecutionService.execute_service_action(work_order=job.name)
            )

        self.tech_does(lambda: RequestExecutionService.resume_work_item(work_order=job.name))
        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=job.name)
        )
        self.sweep(name)

        self.assertEqual(self.state(job.name), "Completed")

    def test_work_that_failed_can_be_tried_again(self):
        name = self.approved(self.line(self.offering("BL5")))
        job = self.work(name, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.fail_work_item(
                work_order=job.name, reason="The console rejected it"
            )
        )
        self.assertEqual(self.state(job.name), "Failed")

        self.tech_does(lambda: RequestExecutionService.resume_work_item(work_order=job.name))
        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=job.name)
        )
        self.sweep(name)

        self.assertEqual(self.state(job.name), "Completed")

    def test_work_given_up_on_needs_a_reason_and_stops_holding_the_request(self):
        name = self.approved(self.line(self.offering("BL6")), self.line(self.offering("BL7")))
        first, second = (self.work(name, "Service Action", i) for i in range(2))

        with self.assertRaises(ServiceRefused):
            self.tech_does(
                lambda: RequestExecutionService.cancel_work_item(work_order=second.name)
            )

        self.tech_does(
            lambda: RequestExecutionService.cancel_work_item(
                work_order=second.name, reason="The customer withdrew it"
            )
        )
        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=first.name)
        )
        self.sweep(name)
        self.tech_does(lambda: RequestExecutionService.complete_request(request=name))

        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Completed")


class TestTheRecordProvesTheWork(ExecutionCase):
    """Verify reads back what was performed. Nobody ticks a list before the file can close."""

    def test_what_the_record_proves_is_ticked_without_anyone_being_asked(self):
        name = self.approved(self.line(self.offering("VF1")))
        job = self.work(name, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=job.name)
        )
        self.sweep(name)

        checks = frappe.get_all(
            "MSP Work Order Checklist Item",
            filters={"parent": job.name},
            fields=["step", "is_done"],
        )

        self.assertTrue(checks)
        self.assertTrue(all(row.is_done for row in checks))

    def test_nothing_is_left_for_a_person_to_tick(self):
        name = self.approved(self.line(self.offering("VF2")))
        job = self.work(name, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=job.name)
        )
        self.sweep(name)

        self.assertFalse(
            frappe.db.exists(
                "MSP Work Order Checklist Item", {"parent": job.name, "is_done": 0}
            )
        )

    def test_carrying_it_out_records_who_did_it_and_when(self):
        name = self.approved(self.line(self.offering("VF3")))
        job = self.work(name, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=job.name)
        )
        self.sweep(name)

        card = frappe.db.get_value(
            WORK_ORDER, job.name, ["status", "completed_by", "completed_at"], as_dict=True
        )

        self.assertEqual(card.status, "Completed")
        self.assertEqual(card.completed_by, self.tech)
        self.assertTrue(card.completed_at)


class TestClosingTheFile(ExecutionCase):
    def test_a_request_with_work_still_to_do_is_not_closed(self):
        name = self.approved(self.line(self.offering("CL1")))

        with self.assertRaises(ServiceRefused) as caught:
            self.tech_does(lambda: RequestExecutionService.complete_request(request=name))

        self.assertIn("has not been carried out", str(caught.exception))

    def test_work_that_ran_is_enough_to_close_the_file(self):
        name = self.approved(self.line(self.offering("CL2")))
        job = self.work(name, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=job.name)
        )
        self.sweep(name)
        self.tech_does(lambda: RequestExecutionService.complete_request(request=name))

        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Completed")

    def test_blocked_work_holds_the_file_open_and_says_what_for(self):
        name = self.approved(self.line(self.offering("CL3")))
        job = self.work(name, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.block_work_item(
                work_order=job.name, reason="Waiting for the vendor licence"
            )
        )

        with self.assertRaises(ServiceRefused) as caught:
            self.tech_does(lambda: RequestExecutionService.complete_request(request=name))

        self.assertIn("vendor licence", str(caught.exception))

    def test_the_whole_job_from_a_new_person_to_a_closed_request(self):
        """Scenario A: a person, a machine and four services, without leaving the request."""
        name = self.approved(
            self.new_person_line(self.offering("E2E1")),
            self.new_person_line(self.offering("E2E2")),
            self.new_person_line(self.offering("E2E3", scope="Device"), on_requested_device=True),
            self.new_person_line(self.offering("E2E4", scope="Device"), on_requested_device=True),
            self.assign_line("new:marie_dupont"),
        )

        marie = self.create_person(name, username=f"m.{self.tag}")
        device = self.register_machine(
            name, hostname=f"laptop-{self.tag}", serial_number=f"E2E-{self.tag}"
        )
        self.hand_over(name)

        for index in range(4):
            service = self.work(name, "Service Action", index)
            self.tech_does(
                lambda order=service.name: RequestExecutionService.execute_service_action(
                    work_order=order
                )
            )
            self.sweep(name)

        plan = self.tech_does(lambda: RequestExecutionService.complete_request(request=name))

        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Completed")
        self.assertEqual(plan["status"], "Completed")
        self.assertEqual(frappe.db.count("MSP Service Assignment", {"source_request": name}), 4)
        self.assertEqual(frappe.db.get_value("MSP Managed Device", device, "assigned_client_user"), marie)

    def test_nothing_is_prepared_when_the_person_and_machine_already_exist(self):
        """Scenario B: preparation is skipped entirely, and the file still closes."""
        device = self.make_device(
            self.customer, hostname="B1", holder=self.john, serial=f"B1-{self.tag}"
        )
        name = self.approved(
            self.line(self.offering("E2EB1")),
            self.line(
                self.offering("E2EB2", scope="Device"),
                client_user=None,
                target_scope="Device",
                managed_device=device,
            ),
        )

        self.assertEqual(
            frappe.db.count(WORK_ORDER, {"request": name, "work_type": "User Setup"}), 0
        )

        for index in range(2):
            job = self.work(name, "Service Action", index)
            self.tech_does(
                lambda order=job.name: RequestExecutionService.execute_service_action(
                    work_order=order
                )
            )
            self.sweep(name)

        self.tech_does(lambda: RequestExecutionService.complete_request(request=name))

        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Completed")


class TestTwoTechniciansOnTheSameJob(ExecutionCase):
    def test_the_second_one_is_told_who_already_did_it(self):
        other = self.make_account("internal", "MSP Technician", suffix=f"ec{self.tag[:3]}")
        name = self.approved(self.line(self.offering("CC1")))
        job = self.work(name, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=job.name)
        )
        self.sweep(name)

        with self.assertRaises(ServiceRefused) as caught:
            self.as_user(
                other,
                lambda: RequestExecutionService.execute_service_action(work_order=job.name),
            )

        message = str(caught.exception)

        self.assertIn("already carried out", message)
        self.assertIn(frappe.db.get_value("User", self.tech, "full_name"), message)

    def test_the_person_is_created_once_however_many_hands_press_the_button(self):
        other = self.make_account("internal", "MSP Technician", suffix=f"ed{self.tag[:3]}")
        name = self.approved(self.new_person_line(self.offering("CC2")))
        requested = self.requested(name)

        first = self.create_person(name, username=f"cc2.{self.tag}")
        second = self.as_user(other, lambda: RequestedClientUserService.resolve_create(requested))

        self.assertEqual(second, first)
        self.assertEqual(frappe.db.count("MSP Client User", {"full_name": "Marie Dupont"}), 1)


class TestTheRequestTellsItsOwnStory(ExecutionCase):
    def test_the_trail_says_who_did_what(self):
        name = self.approved(self.line(self.offering("AC1")))
        job = self.work(name, "Service Action")

        self.tech_does(
            lambda: RequestExecutionService.block_work_item(
                work_order=job.name, reason="Waiting for the vendor licence"
            )
        )
        plan = self.tech_does(
            lambda: RequestExecutionService.get_execution_plan(request=name)
        )

        said = [row["said"] for row in plan["activity"]]

        self.assertTrue(any("vendor licence" in entry for entry in said))
        self.assertTrue(
            all(row["who"] for row in plan["activity"]), "every entry names who did it"
        )
