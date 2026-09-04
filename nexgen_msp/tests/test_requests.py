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


class TestWhoHearsAboutANewRequest(MSPTestCase):
    """A request that reaches us must reach the people who will carry it out."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.person = self.make_person(self.customer, "Asker")
        self.service = self.make_service("N", scope="User")
        self.contact = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="c")
        self.tech = self.make_account("internal", "MSP Technician", suffix="t")

    def raise_one(self):
        frappe.set_user(self.contact)
        out = PortalService.create_request(
            customer=self.customer,
            request_type="Add",
            lines=[
                {
                    "request_action": self.action(),
                    "action": "Add",
                    "target_scope": "User",
                    "client_user": self.person,
                    "requested_service": self.service,
                }
            ],
        )
        frappe.set_user("Administrator")

        return self.track("MSP Service Request", out["name"])

    def told(self, name):
        queued = frappe.get_all(
            "Email Queue",
            filters={"reference_doctype": "MSP Service Request", "reference_name": name},
            pluck="name",
        )

        return {
            address
            for row in queued
            for address in frappe.get_all(
                "Email Queue Recipient", filters={"parent": row}, pluck="recipient"
            )
        }

    def test_our_team_is_told_as_well_as_the_requester(self):
        name = self.raise_one()
        told = self.told(name)

        self.assertIn(self.contact, told, "the person who raised it")
        self.assertIn(self.tech, told, "the technician who will carry it out")

    def test_nobody_is_told_twice(self):
        name = self.raise_one()
        queued = frappe.get_all(
            "Email Queue",
            filters={"reference_doctype": "MSP Service Request", "reference_name": name},
            pluck="name",
        )
        addresses = [
            address
            for row in queued
            for address in frappe.get_all(
                "Email Queue Recipient", filters={"parent": row}, pluck="recipient"
            )
        ]

        self.assertEqual(len(addresses), len(set(addresses)))

    def test_a_request_still_awaiting_the_customer_does_not_reach_us(self):
        """It is not ours until the company has agreed to it."""
        from nexgen_msp.api.internal.services.authority_service import AuthorityService

        self.track("MSP Approval Authority", self.customer)
        AuthorityService.set_account_rights(self.contact, {"can_submit": 1, "can_approve": 1})

        other = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="o")
        frappe.set_user(other)
        out = PortalService.create_request(
            customer=self.customer,
            request_type="Add",
            lines=[
                {
                    "request_action": self.action(),
                    "action": "Add",
                    "target_scope": "User",
                    "client_user": self.person,
                    "requested_service": self.service,
                }
            ],
        )
        frappe.set_user("Administrator")
        name = self.track("MSP Service Request", out["name"])

        self.assertEqual(out["status"], "Awaiting Customer Approval")
        self.assertNotIn(self.tech, self.told(name))


class TestDrafts(MSPTestCase):
    """A request put aside reaches nobody until its author sends it."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.one = self.make_person(self.customer, "One")
        self.two = self.make_person(self.customer, "Two")
        self.service = self.make_service("D", scope="User")
        self.author = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="a")
        self.colleague = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="b")
        self.tech = self.make_account("internal", "MSP Technician", suffix="t")

    def line(self, person):
        return {
            "request_action": self.action(),
            "action": "Add",
            "target_scope": "User",
            "client_user": person,
            "requested_service": self.service,
        }

    def as_user(self, email, fn):
        frappe.set_user(email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def start(self):
        out = self.as_user(
            self.author,
            lambda: PortalService.save_draft(
                customer=self.customer, request_type="Add", lines=[self.line(self.one)]
            ),
        )

        return self.track("MSP Service Request", out["name"]), out

    def test_a_draft_is_saved_as_a_draft(self):
        name, out = self.start()

        self.assertEqual(out["status"], "Draft")
        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "requester"), self.author)

    def test_saving_again_keeps_the_same_document(self):
        name, _ = self.start()

        again = self.as_user(
            self.author,
            lambda: PortalService.save_draft(
                name=name,
                customer=self.customer,
                request_type="Add",
                lines=[self.line(self.one), self.line(self.two)],
            ),
        )

        self.assertEqual(again["name"], name)
        self.assertEqual(len(again["lines"]), 2)
        self.assertEqual(frappe.db.count("MSP Service Request", {"name": name}), 1)

    def test_only_its_author_sees_it(self):
        name, _ = self.start()

        mine = self.as_user(self.author, lambda: PortalService.list_requests(page_length=200))
        theirs = self.as_user(self.colleague, lambda: PortalService.list_requests(page_length=200))

        self.assertIn(name, [row["name"] for row in mine["rows"]])
        self.assertNotIn(name, [row["name"] for row in theirs["rows"]])

    def test_a_colleague_cannot_open_it(self):
        name, _ = self.start()

        with self.assertRaises(NotFoundError):
            self.as_user(self.colleague, lambda: PortalService.get_request(name))

    def test_it_never_reaches_our_queue(self):
        name, _ = self.start()

        listed = self.as_user(self.tech, lambda: RequestService.list_requests(page_length=200))
        self.assertNotIn(name, [row["name"] for row in listed["rows"]])

        with self.assertRaises(NotFoundError):
            self.as_user(self.tech, lambda: RequestService.get_request(name))

    def test_nobody_is_emailed_about_a_draft(self):
        name, _ = self.start()

        self.assertEqual(
            frappe.db.count(
                "Email Queue",
                {"reference_doctype": "MSP Service Request", "reference_name": name},
            ),
            0,
        )

    def test_sending_it_grows_the_same_document_up(self):
        name, _ = self.start()

        sent = self.as_user(
            self.author,
            lambda: PortalService.create_request(
                name=name, customer=self.customer, request_type="Add", lines=[self.line(self.one)]
            ),
        )

        self.assertEqual(sent["name"], name)
        self.assertEqual(sent["status"], "Submitted")

        listed = self.as_user(self.tech, lambda: RequestService.list_requests(page_length=200))
        self.assertIn(name, [row["name"] for row in listed["rows"]], "it must reach us once sent")

    def test_a_draft_can_be_thrown_away(self):
        name, _ = self.start()

        self.as_user(self.author, lambda: PortalService.discard_draft(name))

        self.assertFalse(frappe.db.exists("MSP Service Request", name))

    def test_a_colleague_cannot_throw_it_away(self):
        name, _ = self.start()

        with self.assertRaises(ValidationError):
            self.as_user(self.colleague, lambda: PortalService.discard_draft(name))

        self.assertTrue(frappe.db.exists("MSP Service Request", name))

    def test_a_sent_request_is_no_longer_a_draft_to_throw_away(self):
        name, _ = self.start()
        self.as_user(
            self.author,
            lambda: PortalService.create_request(
                name=name, customer=self.customer, request_type="Add", lines=[self.line(self.one)]
            ),
        )

        with self.assertRaises(ValidationError):
            self.as_user(self.author, lambda: PortalService.discard_draft(name))

        self.assertTrue(frappe.db.exists("MSP Service Request", name))


class TestDraftsAreNotWork(MSPTestCase):
    """A draft is not work waiting on anyone, and must not be counted as such."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.person = self.make_person(self.customer, "Subject")
        self.service = self.make_service("W", scope="User")
        self.author = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="a")

    def dashboard(self):
        from nexgen_msp.api.internal.services.dashboard_service import DashboardService

        frappe.set_user("Administrator")

        return DashboardService.get_dashboard()

    def test_a_draft_is_not_counted_as_open_work(self):
        before = self.dashboard()["requests"]["open"]

        frappe.set_user(self.author)
        out = PortalService.save_draft(
            customer=self.customer,
            request_type="Add",
            lines=[
                {
                    "request_action": self.action(),
                    "action": "Add",
                    "target_scope": "User",
                    "client_user": self.person,
                    "requested_service": self.service,
                }
            ],
        )
        frappe.set_user("Administrator")
        name = self.track("MSP Service Request", out["name"])

        after = self.dashboard()

        self.assertEqual(after["requests"]["open"], before, "a draft is not open work")
        self.assertNotIn(name, [row["name"] for row in after["queue"]])

    def test_a_request_the_customer_refused_is_not_ours_to_see(self):
        from nexgen_msp.api.internal.services.authority_service import AuthorityService
        from nexgen_msp.api.internal.services.request_service import RequestService

        self.track("MSP Approval Authority", self.customer)
        AuthorityService.set_account_rights(self.author, {"can_submit": 1, "can_approve": 1})
        other = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="o")

        frappe.set_user(other)
        out = PortalService.create_request(
            customer=self.customer,
            request_type="Add",
            lines=[
                {
                    "request_action": self.action(),
                    "action": "Add",
                    "target_scope": "User",
                    "client_user": self.person,
                    "requested_service": self.service,
                }
            ],
        )
        frappe.set_user("Administrator")
        name = self.track("MSP Service Request", out["name"])

        frappe.set_user(self.author)
        PortalService.reject_request(name, "not this quarter")
        frappe.set_user("Administrator")

        self.assertTrue(frappe.db.get_value("MSP Service Request", name, "refused_by_customer"))

        tech = self.make_account("internal", "MSP Technician", suffix="t")
        frappe.set_user(tech)
        listed = RequestService.list_requests(page_length=500)
        frappe.set_user("Administrator")

        self.assertNotIn(name, [row["name"] for row in listed["rows"]])
        self.assertNotIn(name, [row["name"] for row in self.dashboard()["queue"]])


class TestDraftsAreNotChecked(MSPTestCase):
    """A draft is a half-written page: it is checked when it is sent, not before."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.person = self.make_person(self.customer, "Subject")
        self.device = self.make_device(self.customer, hostname="BOX")
        self.device_service = self.make_service("DS", scope="Device")
        self.author = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="a")

    def half_written(self):
        return [
            {
                "request_action": self.action(),
                "action": "Add",
                "target_scope": "User",
                "client_user": self.person,
                "requested_service": self.device_service,
            }
        ]

    def test_a_device_service_can_be_put_aside_without_its_machine(self):
        frappe.set_user(self.author)
        out = PortalService.save_draft(
            customer=self.customer, request_type="Add", lines=self.half_written()
        )
        frappe.set_user("Administrator")
        self.track("MSP Service Request", out["name"])

        self.assertEqual(out["status"], "Draft")

    def test_sending_it_still_asks_for_the_machine(self):
        frappe.set_user(self.author)
        out = PortalService.save_draft(
            customer=self.customer, request_type="Add", lines=self.half_written()
        )
        name = out["name"]

        try:
            with self.assertRaises(ValidationError):
                PortalService.create_request(
                    name=name,
                    customer=self.customer,
                    request_type="Add",
                    lines=self.half_written(),
                )
        finally:
            frappe.set_user("Administrator")

        self.track("MSP Service Request", name)
        self.assertEqual(frappe.db.get_value("MSP Service Request", name, "status"), "Draft")

    def test_once_the_machine_is_named_it_goes_out(self):
        frappe.set_user(self.author)
        out = PortalService.save_draft(
            customer=self.customer, request_type="Add", lines=self.half_written()
        )
        name = self.track("MSP Service Request", out["name"])

        sent = PortalService.create_request(
            name=name,
            customer=self.customer,
            request_type="Add",
            lines=[
                {
                    "request_action": self.action(),
                    "action": "Add",
                    "target_scope": "Device",
                    "managed_device": self.device,
                    "requested_service": self.device_service,
                }
            ],
        )
        frappe.set_user("Administrator")

        self.assertEqual(sent["name"], name)
        self.assertEqual(sent["status"], "Submitted")
