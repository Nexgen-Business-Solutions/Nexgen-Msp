"""A request from the customer's side, and what it takes to close it from ours."""

import frappe

from nexgen_msp.api.internal.services.request_service import RequestService, effective_line_status
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import NotFoundError, ValidationError

from .base import MSPTestCase


class TestRequests(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.person = self.make_person(self.customer, "Requester")
        self.user_service = self.make_service("U", scope="User")
        self.device_service = self.make_service("D", scope="Device")
        self.device = self.make_device(self.customer, holder=self.person)
        self.contact = self.make_account(
            "customer", "MSP Customer Manager", self.customer
        )

    def line(self, service, **extra):
        base = {
            "request_action": self.action(),
            "action": "Add",
            "target_scope": "User",
            "client_user": self.person,
            "requested_service": service,
        }
        base.update(extra)
        return base

    def open_request(self, lines, status="Submitted", source="Internal"):
        doc = frappe.get_doc(
            {
                "doctype": "MSP Service Request",
                "customer": self.customer,
                "request_type": "Add",
                "priority": "Medium",
                "status": status,
                "source": source,
                "requester": frappe.session.user,
                "lines": lines,
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()

        return self.track("MSP Service Request", doc.name)

    # ------------------------------------------------------------- the customer
    def test_a_request_can_carry_several_services(self):
        frappe.set_user(self.contact)
        out = PortalService.create_request(
            customer=self.customer,
            request_type="Add",
            lines=[self.line(self.user_service), self.line(self.device_service, target_scope="Device",
                                                           client_user=None, managed_device=self.device)],
        )
        frappe.set_user("Administrator")
        self.track("MSP Service Request", out["name"])

        self.assertEqual(len(out["lines"]), 2)

    def test_a_new_machine_needs_no_detail_from_the_customer(self):
        frappe.set_user(self.contact)
        out = PortalService.create_request(
            customer=self.customer,
            request_type="Add",
            lines=[self.line(self.device_service, is_new_device=1)],
        )
        frappe.set_user("Administrator")
        self.track("MSP Service Request", out["name"])

        self.assertEqual(out["lines"][0]["is_new_device"], 1)

    # ------------------------------------------------------- closing the request
    def test_a_device_service_cannot_be_closed_without_a_serial(self):
        name = self.open_request(
            [self.line(self.device_service, target_scope="Device", client_user=None,
                       managed_device=self.device, line_status="Approved")],
            status="In Progress",
        )

        with self.assertRaises(ValidationError):
            RequestService.run_action(name, "complete")

        RequestService.set_delivery_detail(name, 1, serial_number="ZZTEST-SN-1")
        RequestService.run_action(name, "complete")

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Completed")

    def test_a_user_service_cannot_be_closed_without_a_username(self):
        name = self.open_request(
            [self.line(self.user_service, line_status="Approved")], status="In Progress"
        )

        with self.assertRaises(ValidationError):
            RequestService.run_action(name, "complete")

        RequestService.set_delivery_detail(name, 1, username="zz.user")
        RequestService.run_action(name, "complete")

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Completed")

    def test_the_screen_says_what_is_still_owed(self):
        name = self.open_request(
            [self.line(self.user_service, line_status="Approved")], status="In Progress"
        )
        line = RequestService.get_request(name)["lines"][0]

        self.assertTrue(line["needs_username"])
        self.assertFalse(line["needs_serial"])

    # ----------------------------------------------------------------- lifecycle
    def test_cancelling_closes_only_the_undecided_lines(self):
        name = self.open_request(
            [
                self.line(self.user_service, line_status="Pending"),
                self.line(self.device_service, target_scope="Device", client_user=None,
                          managed_device=self.device, line_status="Approved"),
            ]
        )
        RequestService.run_action(name, "cancel", reason="test")

        statuses = [row.line_status for row in frappe.get_doc("MSP Service Request", name).lines]

        self.assertEqual(statuses, ["Cancelled", "Approved"])

    def test_a_pending_line_on_a_live_request_stays_pending(self):
        self.assertEqual(effective_line_status("Pending", "In Progress"), "Pending")
        self.assertEqual(effective_line_status("Pending", "Cancelled"), "Cancelled")
        self.assertEqual(effective_line_status("Approved", "Cancelled"), "Approved")

    def test_a_request_awaiting_the_customer_is_invisible_to_us(self):
        name = self.open_request(
            [self.line(self.user_service)], status="Awaiting Customer Approval"
        )

        listed = RequestService.list_requests(page_length=500)
        self.assertNotIn(name, [row["name"] for row in listed["rows"]])

        with self.assertRaises(NotFoundError):
            RequestService.get_request(name)

    def test_no_action_is_offered_on_a_request_awaiting_the_customer(self):
        self.assertEqual(RequestService._allowed_actions("Awaiting Customer Approval"), [])

    def test_the_status_filter_never_offers_the_customer_state(self):
        self.assertNotIn(
            "Awaiting Customer Approval", RequestService.get_filter_options()["statuses"]
        )


class TestBothScopeClosing(MSPTestCase):
    """A service sold against a person or a machine asks for whichever it landed on."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.person = self.make_person(self.customer, "Holder")
        self.device = self.make_device(self.customer, holder=self.person)
        self.service = self.make_service("B", scope="Both")

    def open_line(self, target):
        base = {
            "request_action": self.action(),
            "action": "Add",
            "requested_service": self.service,
            "line_status": "Approved",
            "target_scope": target,
        }
        base.update(
            {"client_user": self.person} if target == "User" else {"managed_device": self.device}
        )

        doc = frappe.get_doc(
            {
                "doctype": "MSP Service Request",
                "customer": self.customer,
                "request_type": "Add",
                "priority": "Medium",
                "status": "In Progress",
                "source": "Internal",
                "requester": frappe.session.user,
                "lines": [base],
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()

        return self.track("MSP Service Request", doc.name)

    def test_on_a_person_it_asks_for_the_username_only(self):
        name = self.open_line("User")
        line = RequestService.get_request(name)["lines"][0]

        self.assertTrue(line["needs_username"])
        self.assertFalse(line["needs_serial"])

        with self.assertRaises(ValidationError):
            RequestService.run_action(name, "complete")

        # the serial alone does not unlock it: this instance lives on the person
        RequestService.set_delivery_detail(name, 1, username="b.holder")
        RequestService.run_action(name, "complete")

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Completed")

    def test_on_a_machine_it_asks_for_the_serial_only(self):
        name = self.open_line("Device")
        line = RequestService.get_request(name)["lines"][0]

        self.assertTrue(line["needs_serial"])
        self.assertFalse(line["needs_username"])

        with self.assertRaises(ValidationError):
            RequestService.run_action(name, "complete")

        RequestService.set_delivery_detail(name, 1, serial_number="ZZTEST-BOTH-1")
        RequestService.run_action(name, "complete")

        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Completed")

    def test_a_line_never_carries_both_targets_at_once(self):
        """The doctype refuses it, which is why 'both' can only ever mean one per line."""
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "MSP Service Request",
                    "customer": self.customer,
                    "request_type": "Add",
                    "priority": "Medium",
                    "status": "In Progress",
                    "source": "Internal",
                    "requester": frappe.session.user,
                    "lines": [
                        {
                            "request_action": self.action(),
                            "action": "Add",
                            "requested_service": self.service,
                            "target_scope": "User",
                            "client_user": self.person,
                            "managed_device": self.device,
                        }
                    ],
                }
            ).insert(ignore_permissions=True)
