"""A request line is an intention, and Phase 3 makes it a reliable one.

What the customer asks for is checked against what the service is actually doing: resuming
something already running, adding something already there, or asking two contradictory
things of the same service are all refused before the request exists. A line also keeps
saying who it was raised for, even when it targets a machine rather than a person — which
is what lets an approver limited to a department decide on it at all.

Nothing here may touch the operational record: sending a request is asking, not doing.
"""

import frappe

from nexgen_msp.api.internal.services.authority_service import AuthorityService
from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import ValidationError as ServiceRefused

from .base import MSPTestCase

# the document's own rules speak through frappe.throw; the service layer through ours
REFUSED = frappe.ValidationError


class RequestIntentCase(MSPTestCase):
    """A customer of its own per test: a request left in flight blocks the next one, by design."""

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", self.customer)
        self.john = self.make_person(self.customer, "John")
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"ri{self.tag[:3]}"
        )
        # raising only: whoever may also agree sends their own requests straight through,
        # and these tests need one that waits for somebody else
        self.grant(self.asker, can_submit=1, can_approve=0)

    # ------------------------------------------------------------------ helpers
    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def offering(self, suffix, scope="User"):
        service = self.make_service(f"{suffix}{self.tag[:3]}", scope=scope)
        self.cover_service(self.customer, service)

        return service

    def raise_request(self, *lines, asker=None):
        out = self.as_user(
            asker or self.asker,
            lambda: PortalService.create_request(
                customer=self.customer, request_type="Add", lines=list(lines)
            ),
        )

        return self.track("MSP Service Request", out["name"])

    def running(self, service, scope="User", **target):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer, service_item=service, target_scope=scope, **target
        )

        return self.track("MSP Service Assignment", outcome["name"])

    def line(self, service, **fields):
        """One intention. The act comes from the action record, the way the portal sends it."""
        action = fields.pop("action", "Add")

        return {
            "request_action": self.action(action),
            "action": action,
            "target_scope": "User",
            "client_user": self.john,
            "requested_service": service,
            **fields,
        }

    def lines_of(self, name):
        return frappe.get_all(
            "MSP Service Request Line",
            filters={"parent": name},
            fields=[
                "idx",
                "action",
                "target_scope",
                "client_user",
                "requested_for_user",
                "managed_device",
                "source_service_assignment",
                "requested_service",
                "is_new_device",
            ],
            order_by="idx asc",
        )


class TestOneIntentionOneLine(RequestIntentCase):
    def test_asking_for_one_service_writes_one_line(self):
        service = self.offering("ADD")

        name = self.raise_request(self.line(service))
        rows = self.lines_of(name)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].action, "Add")
        self.assertEqual(rows[0].requested_service, service)
        self.assertIsNone(rows[0].source_service_assignment)

    def test_three_things_asked_for_write_three_lines(self):
        adobe = self.offering("THREEA")
        vpn = self.offering("THREEV")
        sophos = self.offering("THREES", scope="Device")
        box = self.make_device(self.customer, hostname="THREE", holder=self.john, serial=f"SN-{self.tag}")
        vpn_assignment = self.running(vpn, client_user=self.john)

        name = self.raise_request(
            self.line(adobe),
            self.line(vpn, action="Suspend", source_service_assignment=vpn_assignment),
            self.line(sophos, target_scope="Device", client_user=None, managed_device=box),
        )
        rows = self.lines_of(name)

        self.assertEqual(len(rows), 3)
        self.assertEqual([row.action for row in rows], ["Add", "Suspend", "Add"])

    def test_the_request_type_is_read_off_the_lines_not_off_the_payload(self):
        adobe = self.offering("TYPEA")
        vpn = self.offering("TYPEV")
        assignment = self.running(vpn, client_user=self.john)

        only_adds = self.raise_request(self.line(adobe))
        self.assertEqual(frappe.db.get_value("MSP Service Request", only_adds, "request_type"), "Add")

        mixed = self.raise_request(
            self.line(self.offering("TYPEB")),
            self.line(vpn, action="Suspend", source_service_assignment=assignment),
        )
        self.assertEqual(frappe.db.get_value("MSP Service Request", mixed, "request_type"), "Mixed")


class TestTheActionMustSuitTheService(RequestIntentCase):
    def test_changing_a_service_says_which_one(self):
        service = self.offering("NEEDSA")
        self.running(service, client_user=self.john)

        with self.assertRaises(REFUSED) as caught:
            self.raise_request(self.line(service, action="Suspend"))

        self.assertIn("which service", str(caught.exception).lower())

    def test_a_running_service_cannot_be_resumed(self):
        service = self.offering("RESUME")
        assignment = self.running(service, client_user=self.john)

        with self.assertRaises(REFUSED) as caught:
            self.raise_request(
                self.line(service, action="Resume", source_service_assignment=assignment)
            )

        self.assertIn("does not apply", str(caught.exception).lower())

    def test_a_suspended_service_can_be_resumed_but_not_suspended_again(self):
        service = self.offering("PAUSED")
        assignment = self.running(service, client_user=self.john)
        ServiceLifecycleService.suspend(assignment=assignment)

        with self.assertRaises(REFUSED):
            self.raise_request(
                self.line(service, action="Suspend", source_service_assignment=assignment)
            )

        name = self.raise_request(
            self.line(service, action="Resume", source_service_assignment=assignment)
        )
        self.assertEqual(self.lines_of(name)[0].action, "Resume")

    def test_a_service_already_running_cannot_be_asked_for_again(self):
        service = self.offering("DUP")
        self.running(service, client_user=self.john)

        with self.assertRaises(REFUSED) as caught:
            self.raise_request(self.line(service))

        self.assertIn("already running", str(caught.exception).lower())

    def test_adding_a_service_names_no_assignment(self):
        service = self.offering("ADDSA")
        other = self.offering("ADDSB")
        assignment = self.running(other, client_user=self.john)

        with self.assertRaises(REFUSED):
            self.raise_request(self.line(service, source_service_assignment=assignment))

    def test_two_contradictory_asks_on_one_service_are_refused(self):
        service = self.offering("CONTRA")
        assignment = self.running(service, client_user=self.john)

        with self.assertRaises(REFUSED) as caught:
            self.raise_request(
                self.line(service, action="Suspend", source_service_assignment=assignment),
                self.line(service, action="Remove", source_service_assignment=assignment),
            )

        self.assertIn("already asks", str(caught.exception).lower())


class TestOnlyOneOpenAskPerService(RequestIntentCase):
    def test_a_request_already_in_flight_blocks_a_second_one(self):
        service = self.offering("FLIGHT")
        assignment = self.running(service, client_user=self.john)

        self.raise_request(
            self.line(service, action="Suspend", source_service_assignment=assignment)
        )

        with self.assertRaises(REFUSED) as caught:
            self.raise_request(
                self.line(service, action="Remove", source_service_assignment=assignment)
            )

        self.assertIn("already being changed", str(caught.exception).lower())

    def test_the_same_service_cannot_be_asked_for_twice_on_one_target(self):
        service = self.offering("TWICE")

        self.raise_request(self.line(service))

        with self.assertRaises(REFUSED) as caught:
            self.raise_request(self.line(service))

        self.assertIn("already been asked for", str(caught.exception).lower())

    def test_a_draft_stands_in_nobody_s_way(self):
        service = self.offering("DRAFT")

        draft = self.as_user(
            self.asker,
            lambda: PortalService.save_draft(
                customer=self.customer, request_type="Add", lines=[self.line(service)]
            ),
        )
        self.track("MSP Service Request", draft["name"])

        name = self.raise_request(self.line(service))
        self.assertEqual(self.lines_of(name)[0].requested_service, service)

    def test_a_draft_left_behind_by_the_world_is_refused_when_sent(self):
        """Saved on Monday, granted by someone else on Tuesday, sent on Friday."""
        service = self.offering("STALE")

        draft = self.as_user(
            self.asker,
            lambda: PortalService.save_draft(
                customer=self.customer, request_type="Add", lines=[self.line(service)]
            ),
        )
        name = self.track("MSP Service Request", draft["name"])

        self.running(service, client_user=self.john)

        with self.assertRaises(REFUSED) as caught:
            self.as_user(
                self.asker,
                lambda: PortalService.create_request(
                    name=name,
                    customer=self.customer,
                    request_type="Add",
                    lines=[self.line(service)],
                ),
            )

        self.assertIn("already running", str(caught.exception).lower())


class TestALineKeepsThePersonItWasRaisedFor(RequestIntentCase):
    def test_a_device_line_remembers_whose_request_it_was(self):
        service = self.offering("KEEPS", scope="Device")
        box = self.make_device(self.customer, hostname="KEEPS", holder=self.john, serial=f"SN-K{self.tag}")

        name = self.raise_request(
            self.line(service, target_scope="Device", client_user=None, managed_device=box)
        )
        row = self.lines_of(name)[0]

        self.assertEqual(row.target_scope, "Device")
        self.assertIsNone(row.client_user)
        self.assertEqual(row.managed_device, box)
        self.assertEqual(row.requested_for_user, self.john)

    def test_a_user_line_is_for_the_person_it_targets(self):
        service = self.offering("SELF")

        name = self.raise_request(self.line(service))
        row = self.lines_of(name)[0]

        self.assertEqual(row.client_user, self.john)
        self.assertEqual(row.requested_for_user, self.john)

    def test_a_machine_that_changed_hands_invalidates_the_line(self):
        service = self.offering("MOVED", scope="Device")
        bob = self.make_person(self.customer, "Bob")
        box = self.make_device(self.customer, hostname="MOVED", holder=self.john, serial=f"SN-M{self.tag}")

        payload = self.line(
            service,
            target_scope="Device",
            client_user=None,
            managed_device=box,
            requested_for_user=self.john,
        )

        DeviceLifecycleService.transfer(device=box, client_user=bob)

        with self.assertRaises(REFUSED) as caught:
            self.raise_request(payload)

        self.assertIn("no longer held", str(caught.exception).lower())

    def test_a_person_with_no_machine_can_still_ask_for_a_device_service(self):
        service = self.offering("NOBOX", scope="Device")

        name = self.raise_request(
            self.line(
                service,
                target_scope="User",
                is_new_device=1,
                managed_device=None,
                requested_for_user=self.john,
            )
        )
        row = self.lines_of(name)[0]

        self.assertEqual(row.is_new_device, 1)
        self.assertIsNone(row.managed_device)
        self.assertEqual(row.requested_for_user, self.john)

    def test_a_new_person_asks_for_a_device_service_without_naming_a_machine(self):
        service = self.offering("NEWDEV", scope="Device")

        name = self.raise_request(
            {
                "request_action": self.action(),
                "action": "Add",
                "target_scope": "User",
                "is_new_user": 1,
                "new_user_full_name": "Marie Dupont",
                "new_user_department": self.make_department("Human Resources"),
                "is_new_device": 1,
                "requested_service": service,
            }
        )
        row = self.lines_of(name)[0]

        self.assertEqual(row.is_new_device, 1)
        self.assertIsNone(row.managed_device)
        self.assertIsNone(row.requested_for_user)


class TestNothingOperationalMovesOnSubmit(RequestIntentCase):
    def test_sending_a_request_changes_no_record_it_is_about(self):
        service = self.offering("QUIET", scope="Device")
        box = self.make_device(self.customer, hostname="QUIET", holder=self.john, serial=f"SN-Q{self.tag}")

        before = (
            frappe.db.get_value("MSP Client User", self.john, ["username", "department", "modified"]),
            frappe.db.get_value(
                "MSP Managed Device", box, ["serial_number", "assigned_client_user", "status", "modified"]
            ),
            frappe.db.count("MSP Service Assignment", {"customer": self.customer}),
            frappe.db.count("MSP Device Holder", {"parent": box}),
        )

        self.raise_request(
            self.line(
                service,
                target_scope="Device",
                client_user=None,
                managed_device=box,
                new_device_serial="SN-SOMETHING-ELSE",
                new_user_username="not.written",
            )
        )

        after = (
            frappe.db.get_value("MSP Client User", self.john, ["username", "department", "modified"]),
            frappe.db.get_value(
                "MSP Managed Device", box, ["serial_number", "assigned_client_user", "status", "modified"]
            ),
            frappe.db.count("MSP Service Assignment", {"customer": self.customer}),
            frappe.db.count("MSP Device Holder", {"parent": box}),
        )

        self.assertEqual(after, before, "a request is an intention, not an instruction")


class TestWhoMayAgreeToWhat(RequestIntentCase):
    """An approver limited to a department decides for that department, whatever the line targets."""

    def setUp(self):
        super().setUp()
        self.decider = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"rd{self.tag[:3]}"
        )
        self.accounting = self.make_department("Accounting")
        self.sales = self.make_department("Sales")
        frappe.db.set_value("MSP Client User", self.john, "department", self.accounting)
        AuthorityService.set_account_rights(
            self.decider, {"can_submit": 1, "can_approve": 1, "department": self.accounting}
        )

    def can_decide(self, name):
        return self.as_user(self.decider, lambda: PortalService.get_request(name))["can_decide"]

    def test_they_decide_on_a_user_line_of_their_own_department(self):
        name = self.raise_request(self.line(self.offering("APPU")))

        self.assertTrue(self.can_decide(name))

    def test_they_decide_on_a_device_line_raised_for_their_own_department(self):
        service = self.offering("APPD", scope="Device")
        box = self.make_device(self.customer, hostname="APPD", holder=self.john, serial=f"SN-A{self.tag}")

        name = self.raise_request(
            self.line(service, target_scope="Device", client_user=None, managed_device=box)
        )

        self.assertTrue(self.can_decide(name), "a device line still says who it was raised for")

    def test_they_decide_on_a_new_person_of_their_own_department(self):
        name = self.raise_request(
            {
                "request_action": self.action(),
                "action": "Add",
                "target_scope": "User",
                "is_new_user": 1,
                "new_user_full_name": "Fresh Face",
                "new_user_department": self.accounting,
                "requested_service": self.offering("APPN"),
            }
        )

        self.assertTrue(self.can_decide(name))

    def test_they_do_not_decide_for_a_new_person_of_another_department(self):
        name = self.raise_request(
            {
                "request_action": self.action(),
                "action": "Add",
                "target_scope": "User",
                "is_new_user": 1,
                "new_user_full_name": "Far Away",
                "new_user_department": self.sales,
                "requested_service": self.offering("APPX"),
            }
        )

        self.assertFalse(self.can_decide(name))

        with self.assertRaises(ServiceRefused):
            self.as_user(self.decider, lambda: PortalService.approve_request(name))

    def test_a_request_reaching_beyond_their_department_is_refused_whole(self):
        elsewhere = self.make_person(self.customer, "Elsewhere")
        frappe.db.set_value("MSP Client User", elsewhere, "department", self.sales)

        name = self.raise_request(
            self.line(self.offering("APPM")),
            self.line(self.offering("APPN2"), client_user=elsewhere),
        )

        self.assertFalse(self.can_decide(name), "one line outside their scope is enough")
