"""A request from the customer's side, and what it takes to close it from ours."""

import frappe

from nexgen_msp.api.internal.services.request_service import RequestService, effective_line_status
from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService
from nexgen_msp.api.internal.services.requested_entity_presentation import RequestedEntityPresentation
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import NotFoundError, ValidationError
from nexgen_msp.utils import operations

from .base import MSPTestCase

LINE = "MSP Request Line"


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
        self.track("MSP Approval Authority", self.customer)
        self.grant(self.contact)

    def line(self, service, **extra):
        base = {
            "operation_code": self.operation(),
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
                "doctype": "MSP Request",
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

        return self.track("MSP Request", doc.name)

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
        self.track("MSP Request", out["name"])

        self.assertEqual(len(out["lines"]), 2)

    def test_a_new_machine_needs_no_detail_from_the_customer(self):
        frappe.set_user(self.contact)
        out = PortalService.create_request(
            customer=self.customer,
            request_type="Add",
            lines=[
                self.line(
                    self.device_service,
                    target_scope="Device",
                    device_requirement_key="new-device:one",
                )
            ],
            requested_devices=[{"device_requirement_key": "new-device:one"}],
        )
        frappe.set_user("Administrator")
        self.track("MSP Request", out["name"])

        self.assertTrue(out["lines"][0]["requested_device"])
        self.assertEqual(out["requested_devices"][0]["display_label"], "New device")

    # ------------------------------------------------------- closing the request
    def test_a_request_with_work_still_open_cannot_be_closed(self):
        """What stops a closure is unfinished work, never a field discovered at the last moment."""
        name = self.open_request(
            [self.line(self.user_service, line_status="Approved")], status="In Progress"
        )

        with self.assertRaises(ValidationError) as caught:
            RequestService.run_action(name, "complete")

        self.assertIn("no work on this request", str(caught.exception))

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

        statuses = [row.line_status for row in frappe.get_doc("MSP Request", name).lines]

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
    """A service sold to both asks a person for their username, a machine for its serial and
    the username of whoever holds it."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.person = self.make_person(self.customer, "Holder")
        self.device = self.make_device(self.customer, holder=self.person)
        self.service = self.make_service("B", scope="Both")

    def open_line(self, target):
        base = {
            "operation_code": self.operation(),
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
                "doctype": "MSP Request",
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

        return self.track("MSP Request", doc.name)

    def test_on_a_person_it_asks_for_the_username_only(self):
        name = self.open_line("User")
        line = RequestService.get_request(name)["lines"][0]

        self.assertTrue(line["needs_username"])
        self.assertFalse(line["needs_serial"])

    def test_on_a_machine_it_asks_for_the_serial_and_the_holder_s_username(self):
        name = self.open_line("Device")
        line = RequestService.get_request(name)["lines"][0]

        self.assertTrue(line["needs_serial"])
        self.assertTrue(line["needs_username"])

    def test_on_a_machine_whose_holder_has_a_username_it_asks_for_the_serial_only(self):
        frappe.db.set_value("MSP Client User", self.person, "username", f"h.{frappe.generate_hash(length=6)}")
        name = self.open_line("Device")
        line = RequestService.get_request(name)["lines"][0]

        self.assertTrue(line["needs_serial"])
        self.assertFalse(line["needs_username"])

    def test_a_line_never_carries_both_targets_at_once(self):
        """The doctype refuses it, which is why 'both' can only ever mean one per line."""
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "MSP Request",
                    "customer": self.customer,
                    "request_type": "Add",
                    "priority": "Medium",
                    "status": "In Progress",
                    "source": "Internal",
                    "requester": frappe.session.user,
                    "lines": [
                        {
                            "operation_code": self.operation(),
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
        # holding both rights, their word reaches us at once — which is what this class is about
        self.grant(self.contact)
        self.tech = self.make_account("internal", "MSP Technician", suffix="t")

    def raise_one(self):
        frappe.set_user(self.contact)
        out = PortalService.create_request(
            customer=self.customer,
            request_type="Add",
            lines=[
                {
                    "operation_code": self.operation(),
                    "action": "Add",
                    "target_scope": "User",
                    "client_user": self.person,
                    "requested_service": self.service,
                }
            ],
        )
        frappe.set_user("Administrator")

        return self.track("MSP Request", out["name"])

    def told(self, name):
        queued = frappe.get_all(
            "Email Queue",
            filters={"reference_doctype": "MSP Request", "reference_name": name},
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
            filters={"reference_doctype": "MSP Request", "reference_name": name},
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
        AuthorityService.set_account_rights(other, {"can_submit": 1, "can_approve": 0})
        frappe.set_user(other)
        out = PortalService.create_request(
            customer=self.customer,
            request_type="Add",
            lines=[
                {
                    "operation_code": self.operation(),
                    "action": "Add",
                    "target_scope": "User",
                    "client_user": self.person,
                    "requested_service": self.service,
                }
            ],
        )
        frappe.set_user("Administrator")
        name = self.track("MSP Request", out["name"])

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
        self.grant(self.author)
        self.colleague = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="b")
        self.tech = self.make_account("internal", "MSP Technician", suffix="t")

    def line(self, person):
        return {
            "operation_code": self.operation(),
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

        return self.track("MSP Request", out["name"]), out

    def test_a_draft_is_saved_as_a_draft(self):
        name, out = self.start()

        self.assertEqual(out["status"], "Draft")
        self.assertEqual(frappe.db.get_value("MSP Request", name, "requester"), self.author)

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
        self.assertEqual(frappe.db.count("MSP Request", {"name": name}), 1)

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
                {"reference_doctype": "MSP Request", "reference_name": name},
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

        self.assertFalse(frappe.db.exists("MSP Request", name))

    def test_a_colleague_cannot_throw_it_away(self):
        name, _ = self.start()

        with self.assertRaises(ValidationError):
            self.as_user(self.colleague, lambda: PortalService.discard_draft(name))

        self.assertTrue(frappe.db.exists("MSP Request", name))

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

        self.assertTrue(frappe.db.exists("MSP Request", name))


class TestDraftsAreNotWork(MSPTestCase):
    """A draft is not work waiting on anyone, and must not be counted as such."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.person = self.make_person(self.customer, "Subject")
        self.service = self.make_service("W", scope="User")
        self.author = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="a")
        self.grant(self.author)

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
                    "operation_code": self.operation(),
                    "action": "Add",
                    "target_scope": "User",
                    "client_user": self.person,
                    "requested_service": self.service,
                }
            ],
        )
        frappe.set_user("Administrator")
        name = self.track("MSP Request", out["name"])

        after = self.dashboard()

        self.assertEqual(after["requests"]["open"], before, "a draft is not open work")
        self.assertNotIn(name, [row["name"] for row in after["queue"]])

    def test_a_request_the_customer_refused_is_not_ours_to_see(self):
        from nexgen_msp.api.internal.services.authority_service import AuthorityService
        from nexgen_msp.api.internal.services.request_service import RequestService

        self.track("MSP Approval Authority", self.customer)
        AuthorityService.set_account_rights(self.author, {"can_submit": 1, "can_approve": 1})
        other = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="o")
        AuthorityService.set_account_rights(other, {"can_submit": 1, "can_approve": 0})

        frappe.set_user(other)
        out = PortalService.create_request(
            customer=self.customer,
            request_type="Add",
            lines=[
                {
                    "operation_code": self.operation(),
                    "action": "Add",
                    "target_scope": "User",
                    "client_user": self.person,
                    "requested_service": self.service,
                }
            ],
        )
        frappe.set_user("Administrator")
        name = self.track("MSP Request", out["name"])

        frappe.set_user(self.author)
        PortalService.reject_request(name, "not this quarter")
        frappe.set_user("Administrator")

        self.assertTrue(frappe.db.get_value("MSP Request", name, "refused_by_customer"))

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
        self.grant(self.author)

    def half_written(self):
        return [
            {
                "operation_code": self.operation(),
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
        self.track("MSP Request", out["name"])

        self.assertEqual(out["status"], "Draft")

    def test_sent_without_the_machine_it_goes_out_about_the_person(self):
        """A device service named against a person only: the machine is not specified."""
        frappe.set_user(self.author)
        out = PortalService.save_draft(
            customer=self.customer, request_type="Add", lines=self.half_written()
        )
        name = self.track("MSP Request", out["name"])

        try:
            sent = PortalService.create_request(
                name=name, customer=self.customer, request_type="Add", lines=self.half_written()
            )
        finally:
            frappe.set_user("Administrator")

        self.assertEqual(sent["status"], "Submitted")
        row = frappe.db.get_value(
            "MSP Request Line", {"parent": name, "idx": 1},
            ["target_scope", "client_user", "managed_device"], as_dict=True,
        )
        self.assertEqual((row.target_scope, row.client_user, row.managed_device), ("User", self.person, None))

        frappe.set_user(self.author)
        try:
            seen = PortalService.get_request(name)["lines"][0]
        finally:
            frappe.set_user("Administrator")
        self.assertEqual(seen["service_scope"], "Device")
        self.assertIsNone(seen["hostname"], "so the page says: not specified")

    def test_naming_nobody_and_no_machine_is_refused(self):
        frappe.set_user(self.author)
        try:
            with self.assertRaises(ValidationError):
                PortalService.create_request(
                    customer=self.customer, request_type="Add",
                    lines=[{"operation_code": self.operation(), "action": "Add", "target_scope": "User", "requested_service": self.device_service}],
                )
        finally:
            frappe.set_user("Administrator")

    def test_once_the_machine_is_named_it_goes_out(self):
        frappe.set_user(self.author)
        out = PortalService.save_draft(
            customer=self.customer, request_type="Add", lines=self.half_written()
        )
        name = self.track("MSP Request", out["name"])

        sent = PortalService.create_request(
            name=name,
            customer=self.customer,
            request_type="Add",
            lines=[
                {
                    "operation_code": self.operation(),
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


class TestTheTechnicianSeesWhatWasSupplied(MSPTestCase):
    """Whatever the customer took the trouble to write must reach the person doing the work.

    The username and the serial are the two the closure is later refused for, so a request
    that carries them and a screen that drops them costs a phone call for nothing.
    """

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.service = self.make_service("SUP", scope="User")
        self.device_service = self.make_service("SUPD", scope="Device")
        self.person = self.make_person(self.customer, "Known")
        frappe.db.set_value("MSP Client User", self.person, "username", "k.known")
        self.device = self.make_device(self.customer, hostname="KNOWN", serial="SN-KNOWN")
        self.asker = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="sup")
        self.grant(self.asker)
        self.tech = self.make_account("internal", "MSP Technician", suffix="sut")

    def raise_with(self, *lines, subjects=None, requested_devices=None):
        frappe.set_user(self.asker)
        try:
            out = PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=list(lines),
                subjects=subjects,
                requested_devices=requested_devices,
            )
        finally:
            frappe.set_user("Administrator")

        return self.track("MSP Request", out["name"])

    def as_tech(self, name):
        frappe.set_user(self.tech)
        try:
            return RequestService.get_request(name)
        finally:
            frappe.set_user("Administrator")

    def test_the_facts_on_file_reach_the_technician(self):
        name = self.raise_with(
            {
                "operation_code": self.operation(),
                "action": "Add",
                "target_scope": "User",
                "client_user": self.person,
                "requested_service": self.service,
            },
            {
                "operation_code": self.operation(),
                "action": "Add",
                "target_scope": "Device",
                "managed_device": self.device,
                "requested_service": self.device_service,
            },
        )

        person_line, device_line = self.as_tech(name)["lines"]

        self.assertEqual(person_line["client_username"], "k.known")
        self.assertFalse(person_line["needs_username"])
        self.assertEqual(device_line["device_serial"], "SN-KNOWN")
        self.assertFalse(device_line["needs_serial"])

    def test_what_the_customer_typed_for_a_new_person_reaches_the_technician(self):
        department = self.make_department("Sales")
        name = self.raise_with(
            {
                "operation_code": self.operation(),
                "action": "Add",
                "target_scope": "User",
                "subject_key": "new:fresh",
                "requested_service": self.service,
            },
            subjects=[
                {
                    "subject_key": "new:fresh",
                    "kind": "new",
                    "full_name": "Fresh Face",
                    "department": department,
                    "email": "fresh@example.invalid",
                    "username": "f.face",
                }
            ],
        )

        line = self.as_tech(name)["lines"][0]
        typed = RequestedEntityPresentation.client_user(
            frappe.db.get_value(LINE, {"parent": name, "idx": 1}, "requested_client_user")
        )["requested_snapshot"]

        self.assertEqual(typed["full_name"], "Fresh Face")
        self.assertEqual(typed["department"], department)
        self.assertEqual(typed["email"], "fresh@example.invalid")
        self.assertEqual(typed["username"], "f.face")
        self.assertNotIn("needs_portal_access", line)

    def test_what_the_customer_typed_for_a_new_machine_reaches_the_technician(self):
        name = self.raise_with(
            {
                "operation_code": self.operation(),
                "action": "Add",
                "target_scope": "Device",
                "client_user": self.person,
                "device_requirement_key": "new-device:newbox",
                "requested_service": self.device_service,
            },
            requested_devices=[
                {
                    "device_requirement_key": "new-device:newbox",
                    "display_label": "NEWBOX",
                    "device_type": "Phone",
                    "serial_number": "SN-NEW",
                }
            ],
        )

        self.as_tech(name)
        typed = RequestedEntityPresentation.device(
            frappe.db.get_value(LINE, {"parent": name, "idx": 1}, "requested_device")
        )["requested_snapshot"]

        self.assertEqual(typed["display_label"], "NEWBOX")
        self.assertEqual(typed["device_type"], "Phone")
        self.assertEqual(typed["serial_number"], "SN-NEW")

    def test_the_action_the_customer_picked_is_named_not_only_its_verb(self):
        name = self.raise_with(
            {
                "operation_code": self.operation(),
                "action": "Add",
                "target_scope": "User",
                "client_user": self.person,
                "requested_service": self.service,
            }
        )

        line = self.as_tech(name)["lines"][0]

        self.assertTrue(line["action_label"])
        self.assertEqual(line["action_label"], operations.label(line["operation_code"]))


class TestOneNoteForTheWholeRequest(MSPTestCase):
    """What the customer wants to add is said once, for the request, not item by item."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer("NOTE")
        self.track("MSP Approval Authority", self.customer)
        self.person = self.make_person(self.customer, "Noted")
        self.service = self.make_service("NOTE", scope="User")
        self.cover_service(self.customer, self.service)
        self.asker = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="note")
        self.grant(self.asker)

    def lines(self):
        return [
            {
                "operation_code": self.operation(),
                "action": "Add",
                "target_scope": "User",
                "client_user": self.person,
                "requested_service": self.service,
            }
        ]

    def as_asker(self, call):
        frappe.set_user(self.asker)
        frappe.clear_cache(user=self.asker)
        try:
            return call()
        finally:
            frappe.set_user("Administrator")

    def test_the_note_is_kept_on_the_request_and_read_back(self):
        out = self.as_asker(
            lambda: PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=self.lines(),
                details="  Please call before coming on site.  ",
            )
        )
        name = self.track("MSP Request", out["name"])

        self.assertEqual(out["details"], "Please call before coming on site.")
        self.assertEqual(
            frappe.db.get_value("MSP Request", name, "details"),
            "Please call before coming on site.",
        )

    def test_a_draft_keeps_it_and_sending_it_keeps_it_too(self):
        draft = self.as_asker(
            lambda: PortalService.save_draft(
                customer=self.customer, request_type="Add", lines=self.lines(), details="First word."
            )
        )
        name = self.track("MSP Request", draft["name"])
        self.assertEqual(draft["details"], "First word.")

        sent = self.as_asker(
            lambda: PortalService.create_request(
                name=name,
                customer=self.customer,
                request_type="Add",
                lines=self.lines(),
                details="Final word.",
            )
        )

        self.assertEqual(sent["details"], "Final word.")

    def test_no_note_is_nothing_rather_than_an_empty_string(self):
        out = self.as_asker(
            lambda: PortalService.create_request(
                customer=self.customer, request_type="Add", lines=self.lines(), details="   "
            )
        )
        self.track("MSP Request", out["name"])

        self.assertIsNone(out["details"])


class TestCreatingThePersonARequestAskedFor(MSPTestCase):
    """The customer writes a new person once and asks for several things for them."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.service_a = self.make_service("NPA", scope="User")
        self.service_b = self.make_service("NPB", scope="User")
        self.asker = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="npa")
        self.grant(self.asker)
        self.tech = self.make_account("internal", "MSP Technician", suffix="npt")

    def new_person(self, full_name="Fresh Face"):
        return {
            "subject_key": f"new:{frappe.scrub(full_name)}",
            "kind": "new",
            "full_name": full_name,
            "department": self.make_department("Sales"),
            "username": "f.face",
        }

    def new_person_line(self, service, full_name="Fresh Face"):
        return {
            "operation_code": self.operation(),
            "action": "Add",
            "target_scope": "User",
            "subject_key": f"new:{frappe.scrub(full_name)}",
            "requested_service": service,
        }

    def test_resolving_them_once_reaches_every_line_that_describes_them_and_rewrites_none(self):
        from nexgen_msp.api.internal.services.user_service import UserService

        frappe.set_user(self.asker)
        out = PortalService.create_request(
            customer=self.customer,
            request_type="Add",
            lines=[
                self.new_person_line(self.service_a),
                self.new_person_line(self.service_b),
                self.new_person_line(self.service_a, full_name="Someone Else"),
            ],
            subjects=[self.new_person(), self.new_person("Someone Else")],
        )
        frappe.set_user("Administrator")
        name = self.track("MSP Request", out["name"])
        asked = [
            row.requested_client_user
            for row in frappe.get_all(
                LINE, filters={"parent": name}, fields=["idx", "requested_client_user"], order_by="idx"
            )
        ]

        frappe.set_user(self.tech)
        try:
            RequestService.run_action(name=name, action="start_review")
            for idx in (1, 2, 3):
                RequestService.set_line_status(name=name, idx=idx, line_status="Approved")
            RequestService.run_action(name=name, action="approve")
            created = RequestedClientUserService.resolve_create(asked[0])
            unrelated = UserService.create_client_user(
                customer=self.customer,
                full_name="Someone Else",
                department=self.make_department("Sales"),
                source_request=name,
            )["name"]
        finally:
            frappe.set_user("Administrator")
        self.track("MSP Client User", created)
        self.track("MSP Client User", unrelated)

        linked = frappe.get_all(
            LINE,
            filters={"parent": name},
            fields=["idx", "client_user", "requested_client_user"],
            order_by="idx",
        )

        self.assertEqual(asked[0], asked[1], "one Requested Client User for the two lines about them")
        self.assertEqual([row.requested_client_user for row in linked], asked, "no line is rewritten")
        self.assertEqual([row.client_user for row in linked], [None, None, None])
        self.assertEqual(
            frappe.db.get_value("MSP Requested Client User", asked[0], "resolved_client_user"), created
        )
        self.assertEqual(
            frappe.db.get_value("MSP Requested Client User", asked[2], "status"),
            "Open",
            "a person created from the person page is never matched to a request on their name",
        )

        frappe.get_doc("MSP Request", name).save(ignore_permissions=True)

        frappe.set_user(self.tech)
        try:
            detail = RequestService.get_request(name)
        finally:
            frappe.set_user("Administrator")

        self.assertEqual([line["client_user"] for line in detail["lines"]], [None, None, None])
        self.assertEqual(
            [line["requested_client_user_resolved"] for line in detail["lines"]], [created, created, None]
        )
        self.assertEqual(
            [line["client_user_name"] for line in detail["lines"]],
            ["Fresh Face", "Fresh Face", "Someone Else"],
        )
        self.assertIn(created, detail["people"], "the person the request resolved to is described too")
        self.assertNotIn("is_new_user", detail["lines"][0])
        self.assertNotIn("new_user_full_name", detail["lines"][0])


class TestNothingClosesOnSomeoneWhoDoesNotExist(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.service = self.make_service("NCX", scope="User")
        self.device_service = self.make_service("NCD", scope="Device")
        self.asker = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="ncx")
        self.grant(self.asker)
        self.tech = self.make_account("internal", "MSP Technician", suffix="nct")

    def as_tech(self, fn):
        frappe.set_user(self.tech)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def in_progress(self, *lines, subjects=None, requested_devices=None):
        frappe.set_user(self.asker)
        try:
            out = PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=list(lines),
                subjects=subjects,
                requested_devices=requested_devices,
            )
        finally:
            frappe.set_user("Administrator")
        name = self.track("MSP Request", out["name"])

        self.as_tech(lambda: RequestService.run_action(name, "start_review"))
        for idx in range(1, len(lines) + 1):
            self.as_tech(lambda: RequestService.set_line_status(name, idx, "Approved"))
        self.as_tech(lambda: RequestService.run_action(name, "approve"))
        self.as_tech(lambda: RequestService.run_action(name, "start_work"))

        # approving wrote the work this request calls for; it goes with the request
        for order in frappe.get_all(
            "MSP Work Order", filters={"request": name}, pluck="name"
        ):
            self.track("MSP Work Order", order)

        return name

    def test_a_person_still_to_be_created_blocks_the_closure(self):
        name = self.in_progress(
            {
                "operation_code": self.operation(),
                "action": "Add",
                "target_scope": "User",
                "subject_key": "new:fresh",
                "requested_service": self.service,
            },
            subjects=[
                {
                    "subject_key": "new:fresh",
                    "kind": "new",
                    "full_name": "Fresh Face",
                    "department": self.make_department("Sales"),
                }
            ],
        )

        with self.assertRaises(ValidationError) as caught:
            self.as_tech(lambda: RequestService.run_action(name, "complete"))

        self.assertIn(
            "This Request cannot be completed while accepted work remains unresolved.",
            str(caught.exception),
        )
        self.assertIn("ZZTEST Service NCX has not been carried out", str(caught.exception))

    def test_a_machine_still_to_be_registered_blocks_the_closure(self):
        person = self.make_person(self.customer, "Holder")
        frappe.db.set_value("MSP Client User", person, "username", "h.holder")

        name = self.in_progress(
            {
                "operation_code": self.operation(),
                "action": "Add",
                "target_scope": "Device",
                "client_user": person,
                "device_requirement_key": "new-device:newbox",
                "requested_service": self.device_service,
            },
            requested_devices=[
                {"device_requirement_key": "new-device:newbox", "display_label": "NEWBOX", "device_type": "PC"}
            ],
        )

        with self.assertRaises(ValidationError) as caught:
            self.as_tech(lambda: RequestService.run_action(name, "complete"))

        self.assertIn(
            "This Request cannot be completed while accepted work remains unresolved.",
            str(caught.exception),
        )
        self.assertIn("ZZTEST Service NCD has not been carried out", str(caught.exception))

    def test_resolving_to_the_machine_registered_for_the_request_reaches_every_line_that_wanted_it(self):
        from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
        from nexgen_msp.api.internal.services.user_service import UserService

        person = self.make_person(self.customer, "Holder")
        name = self.in_progress(
            {
                "operation_code": self.operation(),
                "action": "Add",
                "target_scope": "Device",
                "client_user": person,
                "device_requirement_key": "new-device:newbox",
                "requested_service": self.device_service,
            },
            {
                "operation_code": self.operation(),
                "action": "Add",
                "target_scope": "Device",
                "client_user": person,
                "device_requirement_key": "new-device:newbox",
                "requested_service": self.service,
            },
            requested_devices=[
                {"device_requirement_key": "new-device:newbox", "display_label": "NEWBOX", "device_type": "PC"}
            ],
        )
        requested = frappe.db.get_value(LINE, {"parent": name, "idx": 1}, "requested_device")

        self.as_tech(
            lambda: UserService.add_device(
                client_user=person,
                hostname="newbox",
                device_type="PC",
                serial_number="SN-NEWBOX",
                source_request=name,
            )
        )
        device = frappe.db.get_value("MSP Managed Device", {"hostname": "newbox"}, "name")
        self.track("MSP Managed Device", device)

        self.assertEqual(frappe.db.get_value("MSP Requested Device", requested, "status"), "Open")

        self.as_tech(lambda: RequestedDeviceService.resolve_existing(requested, device))

        lines = frappe.get_all(
            LINE,
            filters={"parent": name},
            fields=["idx", "managed_device", "requested_device", "client_user"],
            order_by="idx",
        )
        self.assertEqual([row.requested_device for row in lines], [requested, requested], "no line is rewritten")
        self.assertEqual([row.managed_device for row in lines], [None, None])
        self.assertEqual(
            set(frappe.get_all("MSP Work Order", filters={"request": name}, pluck="managed_device")),
            {device},
        )

        frappe.get_doc("MSP Request", name).save(ignore_permissions=True)
        detail = self.as_tech(lambda: RequestService.get_request(name))
        self.assertEqual(detail["lines"][0]["requested_device_resolved"], device)
        self.assertEqual(detail["lines"][0]["requested_device_label"], "NEWBOX")

        card = self.as_tech(lambda: RequestExecutionService.get_execution_plan(name))["action_groups"][0]["work"][0]
        self.assertEqual(card["device"]["serial_number"], "SN-NEWBOX")
        self.assertEqual(card["device"]["assigned_client_user"], person)

    def test_a_machine_registered_for_a_person_under_another_name_is_never_matched_silently(self):
        from nexgen_msp.api.internal.services.user_service import UserService

        person = self.make_person(self.customer, "Holder")
        name = self.in_progress(
            {
                "operation_code": self.operation(),
                "action": "Add",
                "target_scope": "Device",
                "client_user": person,
                "device_requirement_key": "new-device:laptop",
                "requested_service": self.device_service,
            },
            requested_devices=[
                {"device_requirement_key": "new-device:laptop", "display_label": "the laptop", "device_type": "Laptop"}
            ],
        )

        self.as_tech(
            lambda: UserService.add_device(
                client_user=person, hostname="LT-0042", device_type="Laptop",
                serial_number="SN-LT42", source_request=name,
            )
        )
        device = self.track("MSP Managed Device", frappe.db.get_value("MSP Managed Device", {"hostname": "LT-0042"}, "name"))
        requested = frappe.db.get_value(LINE, {"parent": name, "idx": 1}, "requested_device")

        self.assertEqual(frappe.db.get_value("MSP Requested Device", requested, "status"), "Open")
        self.assertIsNone(frappe.db.get_value("MSP Work Order", {"request": name}, "managed_device"))

        self.as_tech(lambda: RequestedDeviceService.resolve_existing(requested, device))

        row = frappe.db.get_value(
            LINE, {"parent": name, "idx": 1},
            ["managed_device", "requested_device", "target_scope"], as_dict=True,
        )
        self.assertEqual((row.managed_device, row.requested_device, row.target_scope), (None, requested, "Device"))
        self.assertEqual(
            frappe.db.get_value("MSP Work Order", {"request": name}, "managed_device"), device
        )

    def test_a_machine_registered_outside_any_request_touches_no_line(self):
        from nexgen_msp.api.internal.services.user_service import UserService

        person = self.make_person(self.customer, "Holder")
        name = self.in_progress(
            {
                "operation_code": self.operation(),
                "action": "Add",
                "target_scope": "Device",
                "client_user": person,
                "device_requirement_key": "new-device:newbox",
                "requested_service": self.device_service,
            },
            requested_devices=[
                {"device_requirement_key": "new-device:newbox", "display_label": "NEWBOX", "device_type": "PC"}
            ],
        )

        self.as_tech(
            lambda: UserService.add_device(
                client_user=person, hostname="NEWBOX", device_type="PC", serial_number="SN-FREE"
            )
        )
        self.track("MSP Managed Device", frappe.db.get_value("MSP Managed Device", {"hostname": "NEWBOX"}, "name"))

        row = frappe.db.get_value(
            "MSP Request Line", {"parent": name, "idx": 1}, ["managed_device", "requested_device"], as_dict=True
        )
        self.assertEqual((row.managed_device, bool(row.requested_device)), (None, True))
