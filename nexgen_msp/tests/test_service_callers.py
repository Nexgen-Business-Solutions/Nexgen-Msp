"""The older doors onto a service, now that the domain stands behind them.

Opening a service from a user's page, from a machine's page, or pausing one, no longer
builds a record by hand: each asks the lifecycle service, and so inherits its structural
checks and commercial annotations. What is
checked here is that the doors really lead there, and that the two ownership mistakes they
used to make are gone: a device service is never found as its holder's own, and a service
the catalogue lets us sell either way asks only for what its real target needs.
"""

import frappe

from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.user_service import UserService
from .base import MSPTestCase


class TestServiceCallers(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.john = self.make_person(self.customer, "John")
        # a personal service is issued against the username the person uses on it
        frappe.db.set_value(
            "MSP Client User", self.john, "username", f"j.{frappe.generate_hash(length=6)}"
        )
        self.today = frappe.utils.today()

    def tearDown(self):
        frappe.set_user("Administrator")

        for name in frappe.get_all(
            "MSP Service Assignment", filters={"customer": self.customer}, pluck="name"
        ):
            frappe.delete_doc(
                "MSP Service Assignment", name, force=True, ignore_permissions=True
            )

        frappe.db.commit()
        super().tearDown()

    # ------------------------------------------------------------------ fixtures
    def offering(self, suffix, scope="User"):
        """A catalogue entry this customer is contracted and priced for."""
        service = self.make_service(suffix, scope=scope)
        self.cover_service(self.customer, service)

        return service

    def opened(self, service, **target):
        names = frappe.get_all(
            "MSP Service Assignment",
            filters={"customer": self.customer, "service_item": service, **target},
            pluck="name",
        )
        self.assertEqual(len(names), 1, f"one assignment expected for {service}")

        return frappe.get_doc("MSP Service Assignment", names[0])

    # ------------------------------------------------------- opening from the user
    def test_a_user_service_opens_active_at_a_rate_somebody_really_set(self):
        service = self.offering("CU")

        UserService.assign_service(client_user=self.john, service_item=service)
        doc = self.opened(service, client_user=self.john)

        self.assertEqual(doc.assignment_scope, "User")
        self.assertEqual(doc.operational_status, "Active")
        self.assertEqual(doc.billing_status, "Billable")
        self.assertIsNone(doc.managed_device)
        self.assertEqual(frappe.utils.getdate(doc.effective_start_date), frappe.utils.getdate(self.today))
        self.assertIn(doc.price_source, ("Contract", "Item Price"))

    def test_a_service_no_contract_covers_is_still_opened(self):
        service = self.make_service("CX", scope="User")

        UserService.assign_service(client_user=self.john, service_item=service)

        opened = self.opened(service, client_user=self.john)
        self.assertEqual(opened.operational_status, "Active")
        self.assertEqual(opened.price_source, "Unpriced")

    def test_a_service_with_no_rate_on_file_is_opened_as_unpriced(self):
        service = self.make_service("CR", scope="User")
        self.cover_service(self.customer, service, rate=None)

        UserService.assign_service(client_user=self.john, service_item=service)

        opened = self.opened(service, client_user=self.john)
        self.assertEqual(opened.operational_status, "Active")
        self.assertEqual(opened.price_source, "Unpriced")

    # ----------------------------------------------------- opening from the machine
    def test_a_machine_on_the_shelf_takes_a_new_device_service(self):
        service = self.offering("CD", scope="Device")
        device = self.make_device(self.customer, hostname="SHELF", serial="ZZTEST-SN-CD")
        self.assertEqual(frappe.db.get_value("MSP Managed Device", device, "status"), "Stock")

        DeviceService.assign_device_service(device=device, service_item=service)
        doc = self.opened(service, managed_device=device)

        self.assertEqual(doc.assignment_scope, "Device")
        self.assertEqual(doc.operational_status, "Active")
        self.assertEqual(doc.billing_status, "Billable")
        self.assertIsNone(doc.client_user)

    def test_the_same_device_service_runs_on_two_machines_of_the_same_person(self):
        service = self.offering("CT", scope="Device")
        first = self.make_device(self.customer, hostname="TWO1", holder=self.john, serial="ZZTEST-SN-CT1")
        second = self.make_device(self.customer, hostname="TWO2", holder=self.john, serial="ZZTEST-SN-CT2")

        DeviceService.assign_device_service(device=first, service_item=service)
        DeviceService.assign_device_service(device=second, service_item=service)

        self.assertEqual(self.opened(service, managed_device=first).operational_status, "Active")
        self.assertEqual(self.opened(service, managed_device=second).operational_status, "Active")

    # ------------------------------------------------------------- pausing a service
    def test_suspending_writes_the_days_down_and_resuming_closes_them(self):
        service = self.offering("CS")
        UserService.assign_service(client_user=self.john, service_item=service)
        assignment = self.opened(service, client_user=self.john).name

        UserService.change_service(assignment=assignment, action="Suspend")
        doc = frappe.get_doc("MSP Service Assignment", assignment)

        self.assertEqual(doc.operational_status, "Suspended")
        self.assertEqual(doc.billing_status, "On Hold")
        self.assertEqual(len(doc.suspension_log), 1)
        self.assertEqual(
            frappe.utils.getdate(doc.suspension_log[0].suspended_on),
            frappe.utils.getdate(self.today),
        )
        self.assertIsNone(doc.suspension_log[0].resumed_on)

        UserService.change_service(assignment=assignment, action="Resume")
        doc = frappe.get_doc("MSP Service Assignment", assignment)

        self.assertEqual(doc.operational_status, "Active")
        self.assertEqual(doc.billing_status, "Billable")
        self.assertEqual(len(doc.suspension_log), 1, "resuming closes the pause, it does not add one")
        self.assertEqual(
            frappe.utils.getdate(doc.suspension_log[0].resumed_on),
            frappe.utils.getdate(self.today),
        )

    def test_a_note_on_a_suspension_never_overwrites_the_services_own_note(self):
        service = self.offering("CN")
        UserService.assign_service(
            client_user=self.john, service_item=service, notes="Opened for onboarding"
        )
        assignment = self.opened(service, client_user=self.john).name

        UserService.change_service(
            assignment=assignment, action="Suspend", notes="Paused while abroad"
        )
        doc = frappe.get_doc("MSP Service Assignment", assignment)

        self.assertEqual(doc.internal_notes, "Opened for onboarding")
        self.assertEqual(doc.suspension_log[0].note, "Paused while abroad")
        self.assertTrue(
            any(
                "Paused while abroad" in (row.note or "")
                for row in frappe.get_all(
                    "MSP Remark",
                    filters={"parent": self.john, "parenttype": "MSP Client User"},
                    fields=["note"],
                )
            ),
            "the note went to the person's log instead",
        )

    def test_ending_a_service_closes_it_on_the_day_it_stopped(self):
        service = self.offering("CE")
        UserService.assign_service(client_user=self.john, service_item=service)
        assignment = self.opened(service, client_user=self.john).name

        UserService.change_service(assignment=assignment, action="End")
        doc = frappe.get_doc("MSP Service Assignment", assignment)

        self.assertEqual(doc.operational_status, "Ended")
        self.assertEqual(doc.billing_status, "Ended")
        self.assertEqual(frappe.utils.getdate(doc.effective_end_date), frappe.utils.getdate(self.today))

    # -------------------------------------------------- whose service is whose
    def test_a_device_service_is_never_found_as_its_holders_own(self):
        service = self.offering("CH", scope="Device")
        device = self.make_device(self.customer, hostname="HELD", holder=self.john, serial="ZZTEST-SN-CH")

        DeviceService.assign_device_service(device=device, service_item=service)
        assignment = self.opened(service, managed_device=device).name

        self.assertIsNone(
            RequestService._find_open_assignment(
                self.customer, service, "User", client_user=self.john
            ),
            "the machine's service is not John's, however tightly he holds the machine",
        )
        self.assertEqual(
            RequestService._find_open_assignment(
                self.customer, service, "Device", managed_device=device
            ),
            assignment,
        )

    def test_a_user_service_is_found_by_the_person_it_was_issued_to(self):
        service = self.offering("CW")
        UserService.assign_service(client_user=self.john, service_item=service)
        assignment = self.opened(service, client_user=self.john).name

        self.assertEqual(
            RequestService._find_open_assignment(
                self.customer, service, "User", client_user=self.john
            ),
            assignment,
        )
        self.assertIsNone(
            RequestService._find_open_assignment(self.customer, service, "User", client_user=None)
        )

    # ---------------------------------------------- 'Both' is a permission, not a target
    def both_line(self, service, **fields):
        """One request line, held in memory: the closing gate reads nothing else."""
        return frappe.get_doc(
            {
                "doctype": "MSP Service Request",
                "customer": self.customer,
                "status": "Draft",
                "source": "Internal",
                "request_type": "Add",
                "requester": frappe.session.user,
                "lines": [
                    {
                        "request_action": self.action(),
                        "action": "Add",
                        "requested_service": service,
                        "line_status": "Pending",
                        **fields,
                    }
                ],
            }
        )

    def owed_on(self, service, **fields):
        """What one line is still owed, read the way the workbench reads it."""
        doc = self.both_line(service, **fields)
        doc.insert(ignore_permissions=True)
        self.track("MSP Service Request", doc.name)
        frappe.db.commit()

        return RequestService.get_request(doc.name)["lines"][0]

    def test_a_both_service_landing_on_a_machine_asks_for_the_holder_s_username(self):
        service = self.offering("CBD", scope="Both")
        device = self.make_device(self.customer, hostname="BOTHD", holder=self.john, serial="ZZTEST-SN-CBD")
        frappe.db.set_value("MSP Client User", self.john, "username", None)

        line = self.owed_on(service, target_scope="Device", managed_device=device)

        self.assertTrue(line["needs_username"], "sold to both, it is issued against the holder too")
        self.assertFalse(line["needs_serial"], "this machine already carries its serial")

    def test_a_both_service_landing_on_a_person_is_never_asked_for_a_serial(self):
        service = self.offering("CBU", scope="Both")
        self.make_device(self.customer, hostname="BOTHU", holder=self.john)
        frappe.db.set_value("MSP Client User", self.john, "username", "j.john")

        line = self.owed_on(service, target_scope="User", client_user=self.john)

        self.assertFalse(line["needs_serial"])
        self.assertFalse(line["needs_username"], "this person already carries their account name")

    def test_the_screen_asks_a_line_for_what_its_own_target_needs(self):
        service = self.offering("CBS", scope="Both")
        device = self.make_device(self.customer, hostname="BOTHS", holder=self.john)

        doc = self.both_line(
            service,
            target_scope="Device",
            is_new_device=1,
            managed_device=device,
            client_user=self.john,
        )
        doc.insert(ignore_permissions=True)
        self.track("MSP Service Request", doc.name)
        frappe.db.commit()

        line = RequestService.get_request(doc.name)["lines"][0]

        self.assertTrue(line["needs_serial"], "the machine it lands on is what needs identifying")
        self.assertFalse(line["needs_username"], "a device line never licenses a person")
