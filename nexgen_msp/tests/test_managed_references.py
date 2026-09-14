"""The two small catalogues the application really administers, and their limits.

Departments and request actions are the only reference data an administrator maintains.
Everything else — device types, statuses, lifecycles, scopes — is a constant of the product
and Settings must never be able to reach it.

Both catalogues are controlled rather than free: nothing invents a department, and nothing
offers a customer two buttons that do the same thing.
"""

import frappe

from nexgen_msp.api.excel_import.services.excel_import_service import ExcelImportService
from nexgen_msp.api.internal.services.department_service import DepartmentService
from nexgen_msp.api.internal.services.settings_service import SettingsService
from nexgen_msp.utils.errors import NexgenError, ValidationError as ServiceRefused

from .base import MSPTestCase

REFUSED = frappe.ValidationError


class ReferenceCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.admin = self.make_account("internal", "MSP System Admin", suffix=f"rf{self.tag[:3]}")

    def as_admin(self, fn):
        frappe.set_user(self.admin)
        frappe.clear_cache(user=self.admin)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def department(self, label, **fields):
        name = f"ZZTEST {label} {self.tag}"
        rows = self.as_admin(
            lambda: DepartmentService.create_department(department_name=name, **fields)
        )
        created = next(row for row in rows if row.department_name == name)

        return self.track("MSP Department", created.name)


class TestOneCatalogueForEveryCompany(ReferenceCase):
    def test_the_same_department_serves_two_companies(self):
        shared = self.department("Accounting")
        first = self.make_customer(self.tag)
        second = self.make_customer(f"{self.tag}B")

        alice = self.make_person(first, "Alice")
        bob = self.make_person(second, "Bob")

        for person in (alice, bob):
            doc = frappe.get_doc("MSP Client User", person)
            doc.department = shared
            doc.save(ignore_permissions=True)

        self.assertEqual(
            {frappe.db.get_value("MSP Client User", person, "department") for person in (alice, bob)},
            {shared},
        )

    def test_the_same_name_in_another_casing_is_the_same_department(self):
        self.department("Finance")

        with self.assertRaises(ServiceRefused):
            self.as_admin(
                lambda: DepartmentService.create_department(
                    department_name=f"zztest finance {self.tag}"
                )
            )

    def test_what_a_form_offers_is_only_what_is_enabled(self):
        live = self.department("Live")
        retired = self.department("Retired", enabled=0)

        offered = [row.name for row in DepartmentService.list_departments()]

        self.assertIn(live, offered)
        self.assertNotIn(retired, offered)

    def test_the_administrator_still_sees_the_retired_one(self):
        retired = self.department("Shelved", enabled=0)

        listed = self.as_admin(lambda: DepartmentService.list_departments(enabled_only=False))

        self.assertIn(retired, [row.name for row in listed])

    def test_the_table_says_who_is_holding_it(self):
        held = self.department("Held")
        customer = self.make_customer(self.tag)
        person = self.make_person(customer, "Holder")
        doc = frappe.get_doc("MSP Client User", person)
        doc.department = held
        doc.save(ignore_permissions=True)

        row = next(
            entry
            for entry in self.as_admin(
                lambda: DepartmentService.list_departments(enabled_only=False)
            )
            if entry.name == held
        )

        self.assertEqual(row.users, 1)
        self.assertEqual(row.approvers, 0)
        self.assertEqual(row.used, 1)


class TestRetiringADepartment(ReferenceCase):
    def test_a_department_nobody_uses_can_be_deleted(self):
        spare = self.department("Spare")

        self.as_admin(lambda: DepartmentService.delete_department(name=spare))

        self.assertFalse(frappe.db.exists("MSP Department", spare))

    def test_one_somebody_wears_is_refused_and_told_to_be_disabled(self):
        worn = self.department("Worn")
        customer = self.make_customer(self.tag)
        person = self.make_person(customer, "Wearer")
        doc = frappe.get_doc("MSP Client User", person)
        doc.department = worn
        doc.save(ignore_permissions=True)

        with self.assertRaises(ServiceRefused) as caught:
            self.as_admin(lambda: DepartmentService.delete_department(name=worn))

        self.assertIn("Disable it instead", str(caught.exception))

    def test_disabling_it_changes_nothing_about_who_already_wears_it(self):
        worn = self.department("Kept")
        customer = self.make_customer(self.tag)
        person = self.make_person(customer, "Keeper")
        doc = frappe.get_doc("MSP Client User", person)
        doc.department = worn
        doc.save(ignore_permissions=True)

        self.as_admin(lambda: DepartmentService.disable_department(name=worn))

        self.assertEqual(frappe.db.get_value("MSP Client User", person, "department"), worn)

    def test_somebody_who_already_wears_it_can_still_be_saved(self):
        worn = self.department("Still")
        customer = self.make_customer(self.tag)
        person = self.make_person(customer, "Wearer")
        doc = frappe.get_doc("MSP Client User", person)
        doc.department = worn
        doc.save(ignore_permissions=True)

        self.as_admin(lambda: DepartmentService.disable_department(name=worn))

        doc = frappe.get_doc("MSP Client User", person)
        doc.email = f"still{self.tag}@example.invalid"
        doc.save(ignore_permissions=True)

        self.assertEqual(doc.department, worn)

    def test_nobody_new_may_be_put_into_a_retired_one(self):
        retired = self.department("Gone", enabled=0)
        customer = self.make_customer(self.tag)

        with self.assertRaises(ServiceRefused):
            frappe.get_doc(
                {
                    "doctype": "MSP Client User",
                    "customer": customer,
                    "full_name": f"ZZTEST Newcomer {self.tag}",
                    "department": retired,
                    "lifecycle_status": "Active",
                    "start_date": frappe.utils.today(),
                }
            ).insert(ignore_permissions=True)


class TestNothingInventsADepartment(ReferenceCase):
    def test_a_person_cannot_be_given_one_nobody_configured(self):
        customer = self.make_customer(self.tag)

        with self.assertRaises(ServiceRefused):
            frappe.get_doc(
                {
                    "doctype": "MSP Client User",
                    "customer": customer,
                    "full_name": f"ZZTEST Invented {self.tag}",
                    "department": "Department Of Nowhere",
                    "lifecycle_status": "Active",
                    "start_date": frappe.utils.today(),
                }
            ).insert(ignore_permissions=True)

    def test_an_approver_cannot_be_limited_to_one_either(self):
        customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", customer)
        account = self.make_account(
            "customer", "MSP Customer Manager", customer, suffix=f"ap{self.tag[:3]}"
        )

        with self.assertRaises(ServiceRefused):
            frappe.get_doc(
                {
                    "doctype": "MSP Approval Authority",
                    "customer": customer,
                    "approvers": [
                        {
                            "account": account,
                            "can_submit": 1,
                            "can_approve": 1,
                            "department": "Department Of Nowhere",
                        }
                    ],
                }
            ).insert(ignore_permissions=True)


class TestWhatTheSpreadsheetIsAllowedToSay(ReferenceCase):
    def test_the_exact_name_is_resolved(self):
        known = self.department("Procurement")

        self.assertEqual(DepartmentService.resolve_department(known), known)

    def test_a_different_casing_is_the_same_department(self):
        known = self.department("Marketing")

        self.assertEqual(DepartmentService.resolve_department(known.lower()), known)
        self.assertEqual(DepartmentService.resolve_department(f"  {known.upper()}  "), known)

    def test_an_unknown_word_refuses_the_row_and_says_what_to_do(self):
        with self.assertRaises(ServiceRefused) as caught:
            DepartmentService.resolve_department("Special Projects")

        self.assertIn("Unknown department", str(caught.exception))
        self.assertIn("Settings", str(caught.exception))

    def test_it_never_creates_the_department_it_could_not_find(self):
        before = frappe.db.count("MSP Department")

        with self.assertRaises(ServiceRefused):
            DepartmentService.resolve_department("Special Projects")

        self.assertEqual(frappe.db.count("MSP Department"), before)

    def test_an_abbreviation_is_never_guessed(self):
        full = self.department("Human Resources")
        short = full.split()[1][:2] + self.tag

        with self.assertRaises(ServiceRefused):
            DepartmentService.resolve_department(short)

    def test_an_empty_column_leaves_the_person_without_one_and_is_counted(self):
        report = {"skipped": {"users_without_department": 0}}

        self.assertIsNone(ExcelImportService._department({"department": "  "}, report))
        self.assertEqual(report["skipped"]["users_without_department"], 1)

    def test_the_importer_resolves_through_the_catalogue(self):
        known = self.department("Legal")
        report = {"skipped": {"users_without_department": 0}}

        self.assertEqual(
            ExcelImportService._department({"department": known.lower()}, report), known
        )
        self.assertEqual(report["skipped"]["users_without_department"], 0)

    def test_a_company_prefix_is_no_longer_part_of_the_mapping(self):
        fields = {row.fieldname for row in frappe.get_meta("MSP Customer Mapping").fields}

        self.assertNotIn("department_prefix", fields)


class TestOneOfferPerAct(ReferenceCase):
    def action(self, title, action_type, **fields):
        doc = frappe.get_doc(
            {
                "doctype": "MSP Request Action",
                "title": f"ZZTEST {title} {self.tag}",
                "action_type": action_type,
                **fields,
            }
        ).insert(ignore_permissions=True)

        return self.track("MSP Request Action", doc.name)

    def test_a_second_offer_of_the_same_act_is_refused(self):
        with self.assertRaises(REFUSED) as caught:
            self.action("Terminate", "Remove", enabled=1)

        self.assertIn("already what a customer is offered", str(caught.exception))

    def test_a_second_wording_may_be_kept_as_long_as_it_is_not_offered(self):
        kept = self.action("Terminate", "Remove", enabled=0)

        self.assertEqual(frappe.db.get_value("MSP Request Action", kept, "enabled"), 0)

    def test_what_an_unused_action_does_can_still_be_settled(self):
        spare = self.action("Spare", "Remove", enabled=0)

        doc = frappe.get_doc("MSP Request Action", spare)
        doc.action_type = "Suspend"
        doc.save(ignore_permissions=True)

        self.assertEqual(frappe.db.get_value("MSP Request Action", spare, "action_type"), "Suspend")

    def test_what_a_used_action_does_can_no_longer_be_rewritten(self):
        customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", customer)
        person = self.make_person(customer, "Asker")
        service = self.make_service(f"RA{self.tag[:3]}", scope="User")
        self.cover_service(customer, service)

        used = frappe.db.get_value("MSP Request Action", {"action_type": "Add", "enabled": 1}, "name")
        request = frappe.get_doc(
            {
                "doctype": "MSP Service Request",
                "customer": customer,
                "request_type": "Add",
                "priority": "Medium",
                "status": "Submitted",
                "source": "Internal",
                "requester": frappe.session.user,
                "lines": [
                    {
                        "request_action": used,
                        "action": "Add",
                        "target_scope": "User",
                        "client_user": person,
                        "requested_service": service,
                    }
                ],
            }
        ).insert(ignore_permissions=True)
        self.track("MSP Service Request", request.name)

        doc = frappe.get_doc("MSP Request Action", used)
        doc.action_type = "Suspend"

        with self.assertRaises(REFUSED) as caught:
            doc.save(ignore_permissions=True)

        self.assertIn("can no longer be changed", str(caught.exception))

    def test_the_order_an_administrator_settled_is_the_order_they_are_read_in(self):
        listed = self.as_admin(lambda: SettingsService.list_request_actions())
        seeded = [row for row in listed if not row.title.startswith("ZZTEST")]

        self.assertEqual(
            [row.action_type for row in seeded],
            ["Add", "Change", "Suspend", "Resume", "Remove"],
        )

    def test_an_action_nobody_has_used_can_be_deleted(self):
        spare = self.action("Unused", "Remove", enabled=0)

        self.as_admin(lambda: SettingsService.delete_request_action(name=spare))

        self.assertFalse(frappe.db.exists("MSP Request Action", spare))

    def test_hiding_an_offer_does_not_take_the_act_away_from_the_engine(self):
        """Settings governs what a customer may ask for, never what the engine can do."""
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        customer = self.make_customer(self.tag)
        person = self.make_person(customer, "Subject")
        service = self.make_service(f"HD{self.tag[:3]}", scope="User")
        self.cover_service(customer, service)

        opened = ServiceLifecycleService.activate(
            customer=customer, service_item=service, target_scope="User", client_user=person
        )
        self.track("MSP Service Assignment", opened["name"])

        offer = frappe.db.get_value(
            "MSP Request Action", {"action_type": "Suspend", "enabled": 1}, "name"
        )
        frappe.db.set_value("MSP Request Action", offer, "enabled", 0)
        frappe.db.commit()
        self.addCleanup(
            lambda: frappe.db.set_value("MSP Request Action", offer, "enabled", 1)
        )

        ServiceLifecycleService.suspend(assignment=opened["name"])

        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", opened["name"], "operational_status"),
            "Suspended",
        )


class TestWhatSettingsMayNeverReach(ReferenceCase):
    def test_device_types_stay_a_constant_of_the_product(self):
        options = frappe.get_meta("MSP Managed Device").get_field("device_type").options

        self.assertEqual(
            [value for value in options.split("\n") if value],
            ["PC", "Laptop", "Mini PC", "Mac", "Phone", "Tablet", "Server", "Firewall", "VM", "Other"],
        )

    def test_the_acts_the_engine_knows_are_not_administered(self):
        options = frappe.get_meta("MSP Request Action").get_field("action_type").options

        self.assertEqual(
            [value for value in options.split("\n") if value],
            ["Add", "Change", "Suspend", "Resume", "Remove"],
        )

    def test_only_an_administrator_maintains_the_catalogue(self):
        technician = self.make_account("internal", "MSP Technician", suffix=f"tc{self.tag[:3]}")

        frappe.set_user(technician)
        frappe.clear_cache(user=technician)
        try:
            with self.assertRaises(NexgenError):
                DepartmentService.create_department(department_name=f"ZZTEST Sneak {self.tag}")
        finally:
            frappe.set_user("Administrator")
