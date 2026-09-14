"""What the request form is handed, so that it has nothing left to work out for itself.

The old screen loaded the whole catalogue, every person of the company and a handful of
state lookups, then tried to decide in React what could be asked for. Everything it needed
is decided here instead: what this person already has, what they may be given, which
machines they hold and what runs on each — with the acts each of those can still receive,
named the way the administrator named them.
"""

import frappe

from nexgen_msp.api.internal.services.authority_service import AuthorityService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.api.portal.services.request_builder_service import RequestBuilderService

from .base import MSPTestCase


class RequestBuilderCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", self.customer)
        self.john = self.make_person(self.customer, "John", department="Accounting")
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"rb{self.tag[:3]}"
        )
        self.grant(self.asker, can_submit=1, can_approve=0)

    def as_asker(self, fn):
        frappe.set_user(self.asker)
        frappe.clear_cache(user=self.asker)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def offering(self, suffix, scope="User"):
        service = self.make_service(f"{suffix}{self.tag[:3]}", scope=scope)
        self.cover_service(self.customer, service)

        return service

    def running(self, service, scope="User", **target):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer, service_item=service, target_scope=scope, **target
        )

        return self.track("MSP Service Assignment", outcome["name"])

    def context(self):
        return self.as_asker(lambda: RequestBuilderService.subject_context(self.john))


class TestTheSubjectIsShownAsTheyAre(RequestBuilderCase):
    def test_the_person_comes_back_with_what_identifies_them(self):
        out = self.context()

        self.assertEqual(out["user"]["name"], self.john)
        self.assertEqual(out["user"]["department"], self.make_department("Accounting"))
        self.assertEqual(out["user"]["lifecycle_status"], "Active")

    def test_a_running_personal_service_is_current_and_not_offered_again(self):
        service = self.offering("CUR")
        assignment = self.running(service, client_user=self.john)

        out = self.context()
        current = out["personal_services"]["current"]
        available = [row["service_item"] for row in out["personal_services"]["available"]]

        self.assertEqual([row["assignment"] for row in current], [assignment])
        self.assertEqual(current[0]["status"], "Active")
        self.assertIsNotNone(current[0]["since"])
        self.assertNotIn(service, available)

    def test_a_service_the_contract_covers_is_offered(self):
        service = self.offering("OFFER")

        offered = {row["service_item"] for row in self.context()["personal_services"]["available"]}

        self.assertIn(service, offered)

    def test_a_service_outside_the_contract_is_not_offered_for_an_existing_person(self):
        uncovered = self.make_service(f"EXISTING{self.tag[:3]}", scope="User")

        offered = {row["service_item"] for row in self.context()["personal_services"]["available"]}

        self.assertNotIn(uncovered, offered)

    def test_the_machines_shown_are_the_ones_this_person_holds(self):
        mine = self.make_device(
            self.customer, hostname="MINE", holder=self.john, serial=f"SN-MI{self.tag}"
        )
        colleague = self.make_person(self.customer, "Colleague")
        theirs = self.make_device(
            self.customer, hostname="THEIRS", holder=colleague, serial=f"SN-TH{self.tag}"
        )
        self.make_device(self.customer, hostname="SHELF", serial=f"SN-SH{self.tag}")

        shown = {device["name"] for device in self.context()["devices"]}

        self.assertEqual(shown, {mine}, "a colleague's machine and stock are not theirs to pick")
        self.assertNotIn(theirs, shown)

    def test_a_machine_comes_with_its_hostname_and_serial(self):
        self.make_device(self.customer, hostname="FRAMED", holder=self.john, serial="SN-FRAMED-1")

        device = self.context()["devices"][0]

        self.assertEqual(device["hostname"], "ZZTEST-FRAMED")
        self.assertEqual(device["serial_number"], "SN-FRAMED-1")
        self.assertEqual(device["device_type"], "PC")


class TestEachTargetIsReadOnItsOwn(RequestBuilderCase):
    def test_a_service_on_one_machine_stays_available_on_the_other(self):
        service = self.offering("TWOBOX", scope="Device")
        first = self.make_device(
            self.customer, hostname="BOXONE", holder=self.john, serial=f"SN-B1{self.tag}"
        )
        second = self.make_device(
            self.customer, hostname="BOXTWO", holder=self.john, serial=f"SN-B2{self.tag}"
        )
        self.running(service, scope="Device", managed_device=first)

        devices = {device["name"]: device for device in self.context()["devices"]}

        self.assertIn(
            service, [row["service_item"] for row in devices[first]["services"]["current"]]
        )
        self.assertIn(
            service, [row["service_item"] for row in devices[second]["services"]["available"]]
        )

    def test_a_service_sold_either_way_is_offered_to_the_person_and_to_the_machine(self):
        service = self.offering("BOTH", scope="Both")
        box = self.make_device(
            self.customer, hostname="BOTHBOX", holder=self.john, serial=f"SN-BO{self.tag}"
        )

        out = self.context()

        self.assertIn(
            service, [row["service_item"] for row in out["personal_services"]["available"]]
        )
        device = next(row for row in out["devices"] if row["name"] == box)
        self.assertIn(service, [row["service_item"] for row in device["services"]["available"]])


class TestOnlyTheActsThatApplyAreOffered(RequestBuilderCase):
    def acts(self, entry):
        return {row["action_type"] for row in entry["allowed_request_actions"]}

    def test_a_running_service_offers_change_suspend_and_remove(self):
        service = self.offering("ACTA")
        self.running(service, client_user=self.john)

        entry = self.context()["personal_services"]["current"][0]

        self.assertEqual(self.acts(entry), {"Change", "Suspend", "Remove"})

    def test_a_paused_service_offers_resume_and_remove(self):
        service = self.offering("ACTB")
        assignment = self.running(service, client_user=self.john)
        ServiceLifecycleService.suspend(assignment=assignment)

        entry = self.context()["personal_services"]["current"][0]

        self.assertEqual(self.acts(entry), {"Resume", "Remove"})
        self.assertEqual(entry["status"], "Suspended")

    def test_a_service_waiting_to_be_set_up_offers_nothing_contradictory(self):
        service = self.offering("ACTC")
        outcome = ServiceLifecycleService.create_pending(
            customer=self.customer,
            service_item=service,
            target_scope="User",
            client_user=self.john,
        )
        self.track("MSP Service Assignment", outcome["name"])

        entry = self.context()["personal_services"]["current"][0]

        self.assertEqual(entry["status"], "Pending Setup")
        self.assertEqual(self.acts(entry), set())

    def test_an_act_the_administrator_switched_off_is_not_offered(self):
        service = self.offering("ACTD")
        self.running(service, client_user=self.john)
        suspend = frappe.db.get_value("MSP Request Action", {"action_type": "Suspend"}, "name")

        frappe.db.set_value("MSP Request Action", suspend, "enabled", 0)
        frappe.db.commit()
        try:
            entry = self.context()["personal_services"]["current"][0]
            self.assertNotIn("Suspend", self.acts(entry))
        finally:
            frappe.db.set_value("MSP Request Action", suspend, "enabled", 1)
            frappe.db.commit()

    def test_the_acts_are_named_the_way_the_administrator_named_them(self):
        service = self.offering("ACTE")
        self.running(service, client_user=self.john)

        entry = self.context()["personal_services"]["current"][0]
        titles = {row["action_type"]: row["title"] for row in entry["allowed_request_actions"]}

        self.assertTrue(all(titles.values()), "a customer reads a title, never an action type")


class TestSomethingAlreadyAskedForIsSaidSo(RequestBuilderCase):
    def test_a_service_with_a_request_in_flight_offers_nothing_further(self):
        service = self.offering("PEND")
        assignment = self.running(service, client_user=self.john)

        out = self.as_asker(
            lambda: PortalService.create_request(
                customer=self.customer,
                request_type="Suspend",
                lines=[
                    {
                        "request_action": self.action("Suspend"),
                        "action": "Suspend",
                        "target_scope": "User",
                        "client_user": self.john,
                        "source_service_assignment": assignment,
                        "requested_service": service,
                    }
                ],
            )
        )
        name = self.track("MSP Service Request", out["name"])

        entry = self.context()["personal_services"]["current"][0]

        self.assertEqual(entry["pending_request"], name)
        self.assertEqual(entry["allowed_request_actions"], [])


class TestTheFormForSomebodyWhoDoesNotExistYet(RequestBuilderCase):
    def test_it_offers_departments_and_compatible_services(self):
        personal = self.offering("NEWU")
        machine = self.offering("NEWD", scope="Device")
        self.make_department("Human Resources")

        out = self.as_asker(lambda: RequestBuilderService.new_user_context(self.customer))

        self.assertIn(
            self.make_department("Human Resources"), [row["value"] for row in out["departments"]]
        )
        self.assertIn(personal, [row["service_item"] for row in out["available_user_services"]])
        self.assertIn(machine, [row["service_item"] for row in out["available_device_services"]])

    def test_a_service_outside_the_contract_is_not_offered_to_the_customer(self):
        uncovered = self.make_service(f"NOCON{self.tag[:3]}", scope="User")

        out = self.as_asker(lambda: RequestBuilderService.new_user_context(self.customer))

        self.assertNotIn(
            uncovered, [row["service_item"] for row in out["available_user_services"]]
        )

    def test_staff_can_still_record_a_service_outside_the_contract(self):
        uncovered = self.make_service(f"INTERNAL{self.tag[:3]}", scope="User")

        out = RequestBuilderService.new_user_context(self.customer)

        offer = next(
            row for row in out["available_user_services"] if row["service_item"] == uncovered
        )
        self.assertIn("contract", offer["warning"].lower())


class TestWhatHappensWhenItIsSent(RequestBuilderCase):
    def test_without_the_right_to_approve_it_waits_even_with_no_approver_yet(self):
        """The screen says what the request will really do: nothing reaches us unagreed."""
        out = self.as_asker(lambda: RequestBuilderService.submission_context(self.customer))

        self.assertTrue(out["needs_customer_approval"])
        self.assertIn("your company", out["message"])

    def test_someone_who_decides_too_sends_it_straight_to_us(self):
        self.grant(self.asker, can_submit=1, can_approve=1)

        out = self.as_asker(lambda: RequestBuilderService.submission_context(self.customer))

        self.assertFalse(out["needs_customer_approval"])
        self.assertIn("Nexgen", out["message"])

    def test_an_account_the_matrix_does_not_name_may_not_submit(self):
        unnamed = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"rn{self.tag[:3]}"
        )
        frappe.set_user(unnamed)
        frappe.clear_cache(user=unnamed)
        try:
            out = RequestBuilderService.submission_context(self.customer)
        finally:
            frappe.set_user("Administrator")

        self.assertFalse(out["may_submit"])

    def test_with_an_approver_it_waits_for_the_company_first(self):
        decider = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"rc{self.tag[:3]}"
        )
        AuthorityService.set_account_rights(decider, {"can_submit": 1, "can_approve": 1})

        out = self.as_asker(lambda: RequestBuilderService.submission_context(self.customer))

        self.assertTrue(out["needs_customer_approval"])
        self.assertIn("your company", out["message"])


class TestFindingThePerson(RequestBuilderCase):
    def test_the_search_narrows_to_what_was_typed(self):
        self.make_person(self.customer, "Marianne")

        found = self.as_asker(
            lambda: RequestBuilderService.search_users(self.customer, search="Marianne")
        )

        self.assertEqual([row["full_name"] for row in found], ["ZZTEST Marianne"])

    def test_it_never_reaches_another_company(self):
        elsewhere = self.make_customer(f"{self.tag}B")
        self.make_person(elsewhere, "Outsider")

        found = self.as_asker(lambda: RequestBuilderService.search_users(self.customer))

        self.assertNotIn("ZZTEST Outsider", [row["full_name"] for row in found])

    def test_somebody_who_has_left_is_not_offered(self):
        gone = self.make_person(self.customer, "Departed")
        frappe.db.set_value("MSP Client User", gone, "lifecycle_status", "Archived")
        frappe.db.commit()

        found = self.as_asker(lambda: RequestBuilderService.search_users(self.customer))

        self.assertNotIn(gone, [row["name"] for row in found])


class TestAPersonWithNoMachine(RequestBuilderCase):
    def test_machine_services_are_still_offered_for_a_machine_to_come(self):
        sophos = self.offering("NM1", scope="Device")

        offered = [row["service_item"] for row in self.context()["new_device_services"]]

        self.assertIn(sophos, offered)

    def test_every_machine_of_the_company_can_be_suggested_with_its_holder(self):
        shelf = self.make_device(self.customer, f"NM-{self.tag}", serial=f"ZZTEST-NM-{self.tag}")
        colleague = self.make_person(self.customer, "Colleague", department="Accounting")
        held = self.make_device(self.customer, f"NH-{self.tag}", holder=colleague)

        rows = {row["name"]: row for row in self.context()["assignable_devices"]}

        self.assertIn(shelf, rows)
        self.assertIsNone(rows[shelf]["holder_name"])
        self.assertIn(held, rows, "a machine somebody holds may still be asked for")
        self.assertEqual(rows[held]["assigned_client_user"], colleague)


class TestThePersonIsDescribed(RequestBuilderCase):
    def test_their_username_and_start_date_come_with_them(self):
        frappe.db.set_value(
            "MSP Client User", self.john, {"username": f"j.{self.tag}", "start_date": "2025-02-18"}
        )

        user = self.context()["user"]

        self.assertEqual(user["username"], f"j.{self.tag}")
        self.assertEqual(str(user["start_date"]), "2025-02-18")

    def test_what_is_already_asked_about_them_is_listed(self):
        service = self.offering("OR1")
        out = self.as_asker(
            lambda: PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=[
                    {
                        "request_action": self.action("Add"),
                        "action": "Add",
                        "target_scope": "User",
                        "client_user": self.john,
                        "requested_service": service,
                    }
                ],
            )
        )
        self.track("MSP Service Request", out["name"])

        self.assertIn(out["name"], [row["name"] for row in self.context()["open_requests"]])

