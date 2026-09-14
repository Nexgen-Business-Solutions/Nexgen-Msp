"""Whole journeys, told end to end.

A request from the customer's first line to the closed file: some lines accepted, some
refused, the work done as asked or as the technician found it had to be done. Then a person
and a machine through the hands they pass, and what each record says about it afterwards.

Every other suite checks one gesture. This one checks that the gestures still add up.
"""

import frappe

from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.user_360_service import User360Service
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import device_holders as holders
from nexgen_msp.utils.errors import NotFoundError
from nexgen_msp.utils.errors import ValidationError as Refused

from .test_request_execution import WORK_ORDER, ExecutionCase

REFUSED = (Refused, NotFoundError, frappe.ValidationError, frappe.PermissionError)
OPEN = ("Active", "Suspended", "Pending Removal")


class JourneyCase(ExecutionCase):
    def raised(self, *lines, details=None):
        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer, request_type="Add", lines=list(lines), details=details
            ),
        )

        return self.track("MSP Service Request", out["name"])

    def decide(self, name, idx, status, reason=None):
        return self.tech_does(
            lambda: RequestService.set_line_status(
                name=name, idx=idx, line_status=status, reason=reason
            )
        )

    def act(self, name, action, reason=None):
        return self.tech_does(lambda: RequestService.run_action(name=name, action=action, reason=reason))

    def status(self, name):
        return frappe.db.get_value("MSP Service Request", name, "status")

    def plan(self, name):
        return self.tech_does(lambda: RequestExecutionService.get_execution_plan(request=name))

    def orders(self, name):
        return frappe.get_all(
            WORK_ORDER,
            filters={"service_request": name, "work_type": "Service Action"},
            fields=["name", "status", "service_item", "action"],
            order_by="request_line_idx asc, creation asc",
        )

    def open_services(self, person):
        return frappe.get_all(
            "MSP Service Assignment",
            filters={"client_user": person, "operational_status": ("in", OPEN)},
            pluck="service_item",
        )

    def running(self, service, person=None):
        out = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope="User",
            client_user=person or self.john,
            effective_date=frappe.utils.add_days(frappe.utils.today(), -30),
        )

        return self.track("MSP Service Assignment", out["name"])

    def refused_to_raise(self, *lines, details=None):
        before = frappe.db.count("MSP Service Request", {"customer": self.customer})

        with self.assertRaises(REFUSED):
            self.raised(*lines, details=details)

        self.assertEqual(frappe.db.count("MSP Service Request", {"customer": self.customer}), before)


class TestARequestFromFirstLineToClosedFile(JourneyCase):
    def test_part_accepted_carried_out_and_closed(self):
        m365, vpn, extra = self.offering("JA1"), self.offering("JA2"), self.offering("JA3")
        name = self.raised(
            self.line(m365), self.line(vpn), self.line(extra), details="Before Monday please."
        )

        self.decide(name, 1, "Approved")
        self.decide(name, 2, "Approved")
        self.decide(name, 3, "Rejected", reason="Not in the contract")
        self.act(name, "approve")
        self.sweep(name)

        orders = self.orders(name)
        self.assertEqual(sorted(order.service_item for order in orders), sorted([m365, vpn]))

        out = self.tech_does(
            lambda: RequestExecutionService.execute_service_actions(
                work_orders=[order.name for order in orders]
            )
        )
        self.sweep(name)
        self.assertEqual(out["completed"], 2)

        self.tech_does(lambda: RequestExecutionService.complete_request(request=name))

        self.assertEqual(self.status(name), "Completed")
        lines = frappe.get_doc("MSP Service Request", name).lines
        self.assertEqual(lines[2].line_status, "Rejected")
        self.assertCountEqual(self.open_services(self.john), [m365, vpn])
        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "details"), "Before Monday please.")

    def test_a_line_is_not_refused_without_a_reason(self):
        name = self.raised(self.line(self.offering("JA4")))

        with self.assertRaises(REFUSED):
            self.decide(name, 1, "Rejected")

    def test_nothing_is_accepted_while_a_line_is_still_undecided(self):
        name = self.raised(self.line(self.offering("JA5")), self.line(self.offering("JA6")))
        self.decide(name, 1, "Approved")

        with self.assertRaises(REFUSED):
            self.act(name, "approve")

        self.assertEqual(self.orders(name), [])

    def test_the_file_does_not_close_while_accepted_work_is_still_to_do(self):
        name = self.approved(self.line(self.offering("JA7")))

        with self.assertRaises(REFUSED):
            self.tech_does(lambda: RequestExecutionService.complete_request(request=name))

        self.assertNotEqual(self.status(name), "Completed")


class TestRefusedInternally(JourneyCase):
    def test_refusing_the_whole_request_needs_a_reason(self):
        name = self.raised(self.line(self.offering("JR1")))

        with self.assertRaises(REFUSED):
            self.act(name, "reject")

        self.assertNotEqual(self.status(name), "Rejected")

    def test_a_refused_request_closes_every_line_and_plans_no_work(self):
        name = self.raised(self.line(self.offering("JR2")), self.line(self.offering("JR3")))

        self.act(name, "reject", reason="Duplicate of an earlier request")

        self.assertEqual(self.status(name), "Rejected")
        self.assertEqual(
            {row.line_status for row in frappe.get_doc("MSP Service Request", name).lines},
            {"Rejected"},
        )
        self.assertEqual(self.orders(name), [])
        self.assertEqual(self.open_services(self.john), [])

    def test_a_cancelled_request_changes_nothing_on_the_person(self):
        name = self.raised(self.line(self.offering("JR4")))

        # cancelling is not the technician's to do
        RequestService.run_action(name=name, action="cancel", reason="Asked by mistake")

        self.assertEqual(self.status(name), "Cancelled")
        self.assertEqual(self.open_services(self.john), [])

    def test_a_refused_request_cannot_be_accepted_afterwards(self):
        name = self.raised(self.line(self.offering("JR5")))
        self.act(name, "reject", reason="No budget")

        with self.assertRaises(REFUSED):
            self.act(name, "approve")


class TestWhatTheTechnicianDoesBesideTheRequest(JourneyCase):
    def test_the_act_carried_out_differs_from_the_one_asked_and_says_so(self):
        service = self.offering("JT1")
        held = self.running(service)
        name = self.approved(self.line(service, action="Suspend", source_service_assignment=held))
        order = self.orders(name)[0]

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(
                work_order=order.name, action="Remove", effective_date=frappe.utils.today()
            )
        )
        self.sweep(name)

        done = frappe.db.get_value(WORK_ORDER, order.name, ["action", "status", "execution_notes"], as_dict=True)
        self.assertEqual(done.action, "Remove")
        self.assertEqual(done.status, "Completed")
        self.assertIn("the request asked for", (done.execution_notes or "").lower())
        self.assertNotIn(service, self.open_services(self.john))

    def test_an_act_on_an_add_line_cannot_be_swapped(self):
        name = self.approved(self.line(self.offering("JT2")))
        order = self.orders(name)[0]

        with self.assertRaises(REFUSED):
            self.tech_does(
                lambda: RequestExecutionService.execute_service_action(
                    work_order=order.name, action="Suspend"
                )
            )

        self.assertNotEqual(self.state(order.name), "Completed")

    def test_stopping_every_service_of_the_person_shows_in_the_recap(self):
        kept = self.offering("JT3")
        self.running(kept)
        name = self.approved(self.line(self.offering("JT4")))

        UserService.stop_all_services(
            name=self.john, effective_date=frappe.utils.today(), source_request=name
        )

        self.assertNotIn(kept, self.open_services(self.john))
        self.assertTrue(
            any(entry.get("kind") == "technician" for entry in self.plan(name)["recap"]),
            "the direct act is part of what was done for this request",
        )

    def test_stopping_every_service_of_somebody_with_none_is_refused(self):
        with self.assertRaises(REFUSED):
            UserService.stop_all_services(name=self.john, effective_date=frappe.utils.today())

    def test_blocking_then_resuming_then_running(self):
        name = self.approved(self.line(self.offering("JT5")))
        order = self.orders(name)[0].name

        self.tech_does(lambda: RequestExecutionService.block_work_item(work_order=order, reason="Vendor down"))
        with self.assertRaises(REFUSED):
            self.tech_does(lambda: RequestExecutionService.execute_service_action(work_order=order))

        self.tech_does(lambda: RequestExecutionService.resume_work_item(work_order=order))
        self.tech_does(lambda: RequestExecutionService.execute_service_action(work_order=order))
        self.sweep(name)

        self.assertEqual(self.state(order), "Completed")
        said = " ".join(row["said"] for row in self.plan(name)["activity"])
        self.assertIn("Vendor down", said)


class TestWhatAServiceIsIssuedAgainst(JourneyCase):
    def setUp(self):
        super().setUp()
        self.marie = self.make_person(self.customer, "Marie")

    def test_a_personal_service_waits_for_the_username(self):
        name = self.approved(self.line(self.offering("JI1"), client_user=self.marie))
        order = self.orders(name)[0].name

        with self.assertRaises(REFUSED):
            self.tech_does(lambda: RequestExecutionService.execute_service_action(work_order=order))

        self.tech_does(
            lambda: RequestExecutionService.execute_service_action(work_order=order, username=f"m.{self.tag}")
        )
        self.sweep(name)

        self.assertEqual(frappe.db.get_value("MSP Client User", self.marie, "username"), f"m.{self.tag}")

    def test_adding_one_directly_also_waits_for_the_username(self):
        service = self.offering("JI2")

        with self.assertRaises(REFUSED):
            UserService.assign_service(client_user=self.marie, service_item=service)
        self.assertEqual(self.open_services(self.marie), [])

        UserService.assign_service(client_user=self.marie, service_item=service, username=f"m2.{self.tag}")
        for name in frappe.get_all("MSP Service Assignment", {"client_user": self.marie}, pluck="name"):
            self.track("MSP Service Assignment", name)

        self.assertEqual(self.open_services(self.marie), [service])

    def test_a_machine_service_waits_for_the_serial(self):
        service = self.offering("JI3", scope="Device")
        laptop = self.make_device(self.customer, f"JI-{self.tag}", holder=self.marie)

        with self.assertRaises(REFUSED):
            DeviceService.assign_device_service(device=laptop, service_item=service)

        DeviceService.assign_device_service(
            device=laptop, service_item=service, serial_number=f"ZZTEST-JI-{self.tag}"
        )
        for name in frappe.get_all("MSP Service Assignment", {"managed_device": laptop}, pluck="name"):
            self.track("MSP Service Assignment", name)

        self.assertEqual(
            frappe.db.get_value("MSP Managed Device", laptop, "serial_number"), f"ZZTEST-JI-{self.tag}"
        )

    def test_a_service_sold_to_both_on_a_machine_wants_the_serial_and_the_username(self):
        service = self.offering("JI4", scope="Both")
        laptop = self.make_device(self.customer, f"JB-{self.tag}", holder=self.marie)

        with self.assertRaises(REFUSED):
            DeviceService.assign_device_service(
                device=laptop, service_item=service, serial_number=f"ZZTEST-JB-{self.tag}"
            )

        DeviceService.assign_device_service(
            device=laptop,
            service_item=service,
            serial_number=f"ZZTEST-JB-{self.tag}",
            username=f"mb.{self.tag}",
        )
        for name in frappe.get_all("MSP Service Assignment", {"managed_device": laptop}, pluck="name"):
            self.track("MSP Service Assignment", name)

        self.assertEqual(frappe.db.get_value("MSP Client User", self.marie, "username"), f"mb.{self.tag}")

    def test_a_service_that_names_no_scope_is_sold_to_both(self):
        service = self.offering("JI5")
        frappe.db.set_value("Item", service, "msp_service_scope", None)

        self.assertEqual(RequestService._service_scope(service), "Both")

        laptop = self.make_device(self.customer, f"JS-{self.tag}", holder=self.john, serial=f"ZZTEST-JS-{self.tag}")
        DeviceService.assign_device_service(device=laptop, service_item=service)
        UserService.assign_service(client_user=self.john, service_item=service)
        for name in frappe.get_all("MSP Service Assignment", {"service_item": service}, pluck="name"):
            self.track("MSP Service Assignment", name)

        scopes = frappe.get_all(
            "MSP Service Assignment",
            filters={"service_item": service, "operational_status": ("in", OPEN)},
            pluck="assignment_scope",
        )
        self.assertCountEqual(scopes, ["Device", "User"])


class TestWhatIsSentThatShouldNotBe(JourneyCase):
    def test_no_line_at_all(self):
        self.refused_to_raise()

    def test_only_an_instruction_and_no_line(self):
        self.refused_to_raise(details="Please call me about the new office.")

    def test_a_service_that_does_not_exist(self):
        self.refused_to_raise(self.line(f"ZZTEST-NOPE-{self.tag}"))

    def test_somebody_from_another_company(self):
        other = self.make_customer(f"{self.tag}x")
        stranger = self.make_person(other, "Stranger")

        self.refused_to_raise(self.line(self.offering("JW1"), client_user=stranger))

    def test_a_machine_from_another_company(self):
        other = self.make_customer(f"{self.tag}y")
        box = self.make_device(other, f"JW-{self.tag}")
        service = self.offering("JW2", scope="Device")

        self.refused_to_raise(
            self.line(service, target_scope="Device", managed_device=box)
        )

    def test_a_new_person_with_no_department(self):
        self.refused_to_raise(
            self.line(
                self.offering("JW3"),
                client_user=None,
                is_new_user=1,
                new_user_full_name="Paul Martin",
                new_user_department=None,
            )
        )

    def test_a_line_naming_nobody(self):
        self.refused_to_raise(self.line(self.offering("JW4"), client_user=None))

    def test_a_line_naming_somebody_on_file_and_a_new_person_never_keeps_both(self):
        try:
            name = self.raised(
                self.line(
                    self.offering("JW5"),
                    is_new_user=1,
                    new_user_full_name="Paul Martin",
                    new_user_department=self.make_department("Human Resources"),
                )
            )
        except REFUSED:
            return

        row = frappe.get_doc("MSP Service Request", name).lines[0]
        self.assertFalse(row.is_new_user and row.client_user, "a line is about one person")

    def test_the_same_service_asked_twice_for_the_same_person_opens_it_once(self):
        service = self.offering("JW6")

        try:
            name = self.approved(self.line(service), self.line(service))
        except REFUSED:
            return

        self.tech_does(
            lambda: RequestExecutionService.execute_service_actions(
                work_orders=[order.name for order in self.orders(name)]
            )
        )
        self.sweep(name)

        self.assertEqual(self.open_services(self.john).count(service), 1)


class TestSomebodyLeaves(JourneyCase):
    def test_a_person_who_left_is_given_nothing_new(self):
        service = self.offering("JL1")
        UserService.disable_client_user(name=self.john, reason="Departure")

        try:
            name = self.approved(self.line(service))
        except REFUSED:
            self.assertEqual(self.open_services(self.john), [])
            return

        order = self.orders(name)[0].name
        with self.assertRaises(REFUSED):
            self.tech_does(lambda: RequestExecutionService.execute_service_action(work_order=order))

        self.assertEqual(self.open_services(self.john), [])

    def test_leaving_then_coming_back(self):
        service = self.offering("JL2")
        self.running(service)

        UserService.disable_client_user(name=self.john, reason="Departure")
        UserService.reactivate_client_user(name=self.john)

        self.assertEqual(frappe.db.get_value("MSP Client User", self.john, "lifecycle_status"), "Active")
        self.assertEqual(self.open_services(self.john), [service])


class TestAMachineThroughManyHands(JourneyCase):
    def setUp(self):
        super().setUp()
        self.bob = self.make_person(self.customer, "Bob")
        self.carol = self.make_person(self.customer, "Carol")
        self.box = self.make_device(self.customer, f"JM-{self.tag}", serial=f"ZZTEST-JM-{self.tag}")

    def spells(self):
        return holders.history(self.box)

    def machine(self):
        return frappe.db.get_value(
            "MSP Managed Device", self.box, ["status", "assigned_client_user"], as_dict=True
        )

    def test_the_trail_of_hands_is_kept_in_order(self):
        DeviceLifecycleService.assign(device=self.box, client_user=self.john)
        DeviceLifecycleService.transfer(device=self.box, client_user=self.bob)
        DeviceLifecycleService.transfer(device=self.box, client_user=self.carol)
        DeviceLifecycleService.repossess(device=self.box)

        self.assertEqual(self.machine().status, "Stock")
        self.assertIsNone(self.machine().assigned_client_user)

        DeviceLifecycleService.assign(device=self.box, client_user=self.john)

        rows = self.spells()
        self.assertEqual(
            [row.client_user for row in rows], [self.john, self.bob, self.carol, self.john]
        )
        self.assertEqual([bool(row.is_current) for row in rows], [False, False, False, True])
        self.assertTrue(all(row.to_date for row in rows[:-1]), "every past spell has an end")
        self.assertEqual(self.machine().assigned_client_user, self.john)
        self.assertEqual(self.machine().status, "Active")

    def test_a_machine_is_not_handed_to_somebody_who_left(self):
        DeviceLifecycleService.assign(device=self.box, client_user=self.john)
        UserService.disable_client_user(name=self.bob, reason="Departure")

        with self.assertRaises(REFUSED):
            DeviceLifecycleService.transfer(device=self.box, client_user=self.bob)

        self.assertEqual(self.machine().assigned_client_user, self.john)

    def test_a_machine_nobody_holds_cannot_be_taken_back(self):
        with self.assertRaises(REFUSED):
            DeviceLifecycleService.repossess(device=self.box)

    def test_each_person_s_page_tells_their_part_of_it(self):
        DeviceLifecycleService.assign(device=self.box, client_user=self.john)
        DeviceLifecycleService.transfer(device=self.box, client_user=self.bob)

        told = [row["what"] for row in User360Service.get_user_history(self.john)["activity"]]
        hostname = frappe.db.get_value("MSP Managed Device", self.box, "hostname")

        self.assertIn(f"{hostname} handed over", told)
        self.assertIn(f"{hostname} given back", told)

    def test_a_machine_service_stays_with_the_machine_across_hands(self):
        service = self.offering("JM1", scope="Device")
        DeviceLifecycleService.assign(device=self.box, client_user=self.john)
        DeviceService.assign_device_service(device=self.box, service_item=service)
        for name in frappe.get_all("MSP Service Assignment", {"managed_device": self.box}, pluck="name"):
            self.track("MSP Service Assignment", name)

        DeviceLifecycleService.transfer(device=self.box, client_user=self.bob)

        still = frappe.get_all(
            "MSP Service Assignment",
            filters={"managed_device": self.box, "operational_status": ("in", OPEN)},
            pluck="service_item",
        )
        self.assertEqual(still, [service])


class TestAMachineAskedForSomebodyOnFile(JourneyCase):
    """A person on file with no machine: the customer asks a machine service and says what the
    machine is. The technician must see who it is for, and find what the customer typed."""

    def asked(self):
        service = self.offering("JN1", scope="Device")
        return self.approved(
            {
                "request_action": self.action("Add"),
                "action": "Add",
                "target_scope": "User",
                "requested_for_user": self.john,
                "is_new_device": 1,
                "new_device_label": f"ZZTEST-JN-{self.tag}",
                "new_device_serial": f"ZZTEST-SN-JN-{self.tag}",
                "requested_service": service,
            }
        )

    def test_the_line_names_the_person_it_is_for(self):
        name = self.asked()

        line = self.tech_does(lambda: RequestService.get_request(name))["lines"][0]

        self.assertEqual(line["requested_for_user"], self.john)
        self.assertEqual(line["client_user_name"], frappe.db.get_value("MSP Client User", self.john, "full_name"))

    def test_preparing_the_machine_starts_from_what_the_customer_typed(self):
        name = self.asked()

        slots = [slot for group in self.plan(name)["groups"] for slot in group["devices"]]

        self.assertTrue(slots, "a machine is to be prepared")
        self.assertEqual(slots[0]["work"]["asked_hostname"], f"ZZTEST-JN-{self.tag}")
        self.assertEqual(slots[0]["work"]["asked_serial"], f"ZZTEST-SN-JN-{self.tag}")
