"""A customer asks for a machine to change hands, and nothing on the machine moves until we do it.

A holder change is a business request like any other: it is written as a request line, it is
reviewed, and it becomes work. The machine keeps its holder throughout. What the machine
looked like when the change was asked for is kept on the line, read again before the work is
carried out, and whoever does the work may hand the machine to somebody else — in as many
words, and with the reason recorded.
"""

import frappe

from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import operations
from nexgen_msp.utils.errors import ValidationError as ServiceRefused

from .base import MSPTestCase

WORK_ORDER = "MSP Service Work Order"


class DeviceOperationCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", self.customer)
        self.franck = self.make_person(self.customer, "Franck")
        self.marie = self.make_person(self.customer, "Marie")
        self.device = self.make_device(
            self.customer, hostname=f"LT-{self.tag[:4]}", holder=self.franck, serial=f"ZZTEST-{self.tag}"
        )
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"da{self.tag[:3]}"
        )
        self.grant(self.asker)
        self.tech = self.make_account("internal", "MSP Technician", suffix=f"dt{self.tag[:3]}")

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

    def transfer_line(self, **fields):
        return {
            "operation_code": "device.transfer",
            "target_scope": "Device",
            "managed_device": self.device,
            "requested_holder": self.marie,
            **fields,
        }

    def raised(self, *lines):
        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(customer=self.customer, lines=list(lines)),
        )

        return self.track("MSP Service Request", out["name"])

    def approved(self, *lines):
        name = self.raised(*lines)
        doc = frappe.get_doc("MSP Service Request", name)

        for row in doc.lines:
            self.tech_does(
                lambda idx=row.idx: RequestService.set_line_status(
                    name=name, idx=idx, line_status="Approved"
                )
            )

        self.tech_does(lambda: RequestService.run_action(name=name, action="approve"))

        for order in frappe.get_all(WORK_ORDER, filters={"service_request": name}, pluck="name"):
            self.track(WORK_ORDER, order)

        return name

    def order(self, request, work_type="Device Operation"):
        return frappe.get_all(
            WORK_ORDER,
            filters={"service_request": request, "work_type": work_type},
            fields=["name", "operation_code", "requested_holder", "status"],
            order_by="request_line_idx asc, creation asc",
        )[0]

    def holder(self):
        return frappe.db.get_value("MSP Managed Device", self.device, "assigned_client_user")


class TestWhatAskingChanges(DeviceOperationCase):
    def test_asking_for_a_holder_change_leaves_the_holder_alone(self):
        name = self.raised(self.transfer_line())

        self.assertEqual(self.holder(), self.franck)
        self.assertEqual(
            frappe.db.get_value("MSP Managed Device", self.device, "status"), "Active"
        )

        row = frappe.db.get_value(
            "MSP Service Request Line",
            {"parent": name},
            ["operation_code", "operation_label_snapshot", "requested_holder", "requested_for_user", "state_snapshot"],
            as_dict=True,
        )

        self.assertEqual(row.operation_code, "device.transfer")
        self.assertEqual(row.operation_label_snapshot, "Change holder")
        self.assertEqual(row.requested_holder, self.marie)
        self.assertEqual(row.requested_for_user, self.franck)
        self.assertEqual(frappe.parse_json(row.state_snapshot)["current_holder"], self.franck)

    def test_no_future_holding_period_is_written(self):
        self.raised(self.transfer_line())

        open_rows = frappe.get_all(
            "MSP Device Holder",
            filters={"parent": self.device, "parenttype": "MSP Managed Device"},
            fields=["client_user", "is_current"],
        )

        self.assertEqual([row.client_user for row in open_rows], [self.franck])
        self.assertEqual([row.is_current for row in open_rows], [1])

    def test_a_device_request_is_a_device_request(self):
        name = self.raised(self.transfer_line())

        self.assertEqual(
            frappe.db.get_value("MSP Service Request", name, "request_type"), "Device"
        )

    def test_the_machine_says_what_is_pending_and_offers_nothing_further(self):
        name = self.raised(self.transfer_line())
        reading = self.tech_does(lambda: DeviceService.read_device(self.device))

        self.assertEqual(reading["pending_operation"]["request"], name)
        self.assertEqual(reading["pending_operation"]["operation_code"], "device.transfer")
        self.assertEqual(reading["pending_operation"]["current_holder"], self.franck)
        self.assertEqual(reading["pending_operation"]["requested_holder"], self.marie)
        self.assertEqual(reading["customer_operations"], [])

    def test_a_held_machine_offers_a_holder_change_and_a_return(self):
        reading = self.tech_does(lambda: DeviceService.read_device(self.device))

        self.assertEqual(
            [row["code"] for row in reading["customer_operations"]],
            ["device.transfer", "device.repossess"],
        )

    def test_a_second_holder_change_is_refused(self):
        name = self.raised(self.transfer_line())

        with self.assertRaises(ServiceRefused) as caught:
            self.raised(self.transfer_line())

        self.assertEqual(caught.exception.code, "DEVICE_REQUEST_CONFLICT")
        self.assertIn(name, caught.exception.message)

    def test_assigning_a_machine_somebody_holds_is_refused(self):
        with self.assertRaises(ServiceRefused) as caught:
            self.raised(self.transfer_line(operation_code="device.assign"))

        self.assertIn("already has a holder", caught.exception.message)

    def test_the_same_person_is_not_a_change(self):
        with self.assertRaises(ServiceRefused) as caught:
            self.raised(self.transfer_line(requested_holder=self.franck))

        self.assertIn("already holds this Device", caught.exception.message)

    def test_a_customer_cannot_ask_for_a_machine_to_be_retired(self):
        with self.assertRaises(ServiceRefused) as caught:
            self.raised(self.transfer_line(operation_code="device.retire"))

        self.assertEqual(caught.exception.code, "OPERATION_NOT_REQUESTABLE")


class TestCarryingItOut(DeviceOperationCase):
    def test_the_work_hands_the_machine_over_through_the_device_domain(self):
        name = self.approved(self.transfer_line())
        order = self.order(name)

        self.assertEqual(order.operation_code, "device.transfer")
        self.assertEqual(order.requested_holder, self.marie)

        self.tech_does(
            lambda: RequestExecutionService.execute_device_operation(work_order=order.name)
        )

        self.assertEqual(self.holder(), self.marie)
        self.assertEqual(frappe.db.get_value(WORK_ORDER, order.name, "status"), "Completed")

        spells = frappe.get_all(
            "MSP Device Holder",
            filters={"parent": self.device, "parenttype": "MSP Managed Device"},
            fields=["client_user", "is_current"],
            order_by="idx asc",
        )

        self.assertEqual([row.client_user for row in spells], [self.franck, self.marie])
        self.assertEqual([row.is_current for row in spells], [0, 1])

    def test_a_holder_that_moved_since_the_request_stops_the_work(self):
        name = self.approved(self.transfer_line())
        order = self.order(name)

        third = self.make_person(self.customer, "Third")
        DeviceLifecycleService.transfer(device=self.device, client_user=third)

        with self.assertRaises(ServiceRefused) as caught:
            self.tech_does(
                lambda: RequestExecutionService.execute_device_operation(work_order=order.name)
            )

        self.assertEqual(caught.exception.code, "DEVICE_STATE_CHANGED")
        self.assertEqual(
            caught.exception.message,
            "The Device holder changed after this request was submitted. Review the current "
            "holder before continuing.",
        )
        self.assertEqual(self.holder(), third)

    def test_handing_it_to_somebody_else_needs_a_reason(self):
        name = self.approved(self.transfer_line())
        order = self.order(name)
        other = self.make_person(self.customer, "Other")

        with self.assertRaises(ServiceRefused) as caught:
            self.tech_does(
                lambda: RequestExecutionService.execute_device_operation(
                    work_order=order.name, execution_holder=other
                )
            )

        self.assertEqual(
            caught.exception.message,
            "Explain why Nexgen is executing the transfer to a different person.",
        )
        self.assertEqual(self.holder(), self.franck)

        self.tech_does(
            lambda: RequestExecutionService.execute_device_operation(
                work_order=order.name,
                execution_holder=other,
                override_reason="Marie left the company this morning.",
            )
        )

        self.assertEqual(self.holder(), other)
        self.assertEqual(
            frappe.db.get_value(WORK_ORDER, order.name, "override_reason"),
            "Marie left the company this morning.",
        )

    def test_the_recap_keeps_what_was_asked_and_what_was_done(self):
        name = self.approved(self.transfer_line())
        order = self.order(name)
        other = self.make_person(self.customer, "Other")

        plan = self.tech_does(
            lambda: RequestExecutionService.execute_device_operation(
                work_order=order.name,
                execution_holder=other,
                override_reason="Marie left the company this morning.",
            )
        )
        entry = next(row for row in plan["recap"] if row["work_order"] == order.name)

        self.assertEqual(entry["title"], "Device holder changed")
        self.assertIn("Franck", entry["detail"])
        self.assertIn("Requested:", entry["detail"])
        self.assertIn("Executed:", entry["detail"])
        self.assertEqual(entry["reason"], "Marie left the company this morning.")

    def test_a_return_to_stock_puts_it_back_with_nobody_holding_it(self):
        name = self.approved(
            {
                "operation_code": "device.repossess",
                "target_scope": "Device",
                "managed_device": self.device,
            }
        )
        order = self.order(name)

        self.tech_does(
            lambda: RequestExecutionService.execute_device_operation(work_order=order.name)
        )

        self.assertIsNone(self.holder())
        self.assertEqual(frappe.db.get_value("MSP Managed Device", self.device, "status"), "Stock")

    def test_the_plan_carries_no_service_work_for_a_machine_operation(self):
        name = self.approved(self.transfer_line())

        types = frappe.get_all(
            WORK_ORDER, filters={"service_request": name}, pluck="work_type"
        )

        self.assertEqual(types, ["Device Operation"])


class TestTheOperationsAreNotAdministered(DeviceOperationCase):
    def test_no_runtime_reading_needs_the_old_action_table(self):
        name = self.approved(self.transfer_line())
        order = self.order(name)

        plan = self.tech_does(lambda: RequestExecutionService.get_execution_plan(name))
        detail = self.tech_does(lambda: RequestService.get_request(name))

        self.assertEqual(plan["groups"][0]["device_operations"][0]["name"], order.name)
        self.assertEqual(
            plan["groups"][0]["device_operations"][0]["action_label"], "Change holder"
        )
        self.assertEqual(detail["lines"][0]["action_label"], "Change holder")
        self.assertIsNone(
            frappe.db.get_value("MSP Service Request Line", {"parent": name}, "request_action")
        )

    def test_what_a_technician_may_add_comes_from_the_state_of_the_machine(self):
        self.assertEqual(
            operations.for_device_state("Stock"), ["device.assign", "device.retire"]
        )
        self.assertEqual(
            operations.for_device_state("Active"),
            ["device.transfer", "device.repossess", "device.retire"],
        )
        self.assertEqual(operations.for_device_state("Retired"), ["device.reinstate"])
