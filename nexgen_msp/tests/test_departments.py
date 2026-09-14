"""The global, MSP-managed department catalogue: Phase 2.5.

Departments are no longer free text typed once per customer. One catalogue, administered by
the platform, is consumed everywhere as a controlled list — case- and whitespace-insensitive
on the way in, enabled/disabled rather than deleted on the way out, and never created on the
fly by a raw API call or an Excel import.
"""

import frappe

from nexgen_msp.api.internal.services.department_service import DepartmentService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.patches import build_department_catalogue
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase

DELETE_REFUSED = "This department is currently in use.\nDisable it instead of deleting it."


class TestDepartmentCatalogue(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)

    def name_for(self, label):
        return f"ZZTEST {label} {self.tag}"

    def make_dept(self, label, enabled=1):
        row = DepartmentService.create_department(department_name=self.name_for(label), enabled=enabled)
        created = next(r for r in row if r.department_name == self.name_for(label))
        self.track("MSP Department", created.name)
        return created.name

    def request_line(self, customer, service, department, status="Draft"):
        doc = frappe.get_doc(
            {
                "doctype": "MSP Service Request",
                "customer": customer,
                "request_type": "Add",
                "priority": "Medium",
                "status": "Draft",
                "source": "Internal",
                "requester": frappe.session.user,
                "lines": [
                    {
                        "request_action": self.action(),
                        "action": "Add",
                        "target_scope": "User",
                        "is_new_user": 1,
                        "new_user_full_name": "Future colleague",
                        "new_user_department": department,
                        "requested_service": service,
                    }
                ],
            }
        ).insert(ignore_permissions=True)
        if status != "Draft":
            frappe.db.set_value("MSP Service Request", doc.name, "status", status)
        frappe.db.commit()
        self.track("MSP Service Request", doc.name)
        return doc.lines[0].name

    # ------------------------------------------------------------------ uniqueness
    def test_case_and_whitespace_variants_collide_on_create(self):
        name = self.make_dept("Accounting")

        with self.assertRaises(ValidationError):
            DepartmentService.create_department(department_name=f"  {name.upper()}  ")

        with self.assertRaises(ValidationError):
            DepartmentService.create_department(department_name=name.lower())

    # ------------------------------------------------------------------ disable
    def test_disabling_removes_it_from_the_form_list_but_not_from_the_record(self):
        name = self.make_dept("Facilities")

        enabled_names = [row.department_name for row in DepartmentService.list_departments(enabled_only=True)]
        self.assertIn(name, enabled_names)

        customer = self.make_customer()
        person = self.make_person(customer, "Holder", department=name)

        DepartmentService.disable_department(name=name)

        enabled_names = [row.department_name for row in DepartmentService.list_departments(enabled_only=True)]
        self.assertNotIn(name, enabled_names)

        # what already carries it keeps it
        self.assertEqual(frappe.db.get_value("MSP Client User", person, "department"), name)

        # Disabling prevents new choices; it must not block an unrelated edit to an existing user.
        existing = frappe.get_doc("MSP Client User", person)
        existing.email = f"existing-{self.tag}@example.invalid"
        existing.save(ignore_permissions=True)
        self.assertEqual(existing.department, name)

    def test_rename_updates_current_user_and_approver_references(self):
        name = self.make_dept("People Operations")
        customer = self.make_customer()
        person = self.make_person(customer, "Holder", department=name)
        decider = self.make_account("customer", "MSP Customer Manager", customer, suffix=f"ren{self.tag}")
        self.grant(decider, can_submit=1, can_approve=1)

        from nexgen_msp.api.internal.services.authority_service import AuthorityService

        AuthorityService.set_account_rights(
            decider, {"can_submit": 1, "can_approve": 1, "department": name}
        )
        renamed = f"{name} Renamed"
        DepartmentService.update_department(name=name, department_name=renamed)
        self.track("MSP Department", renamed)

        self.assertEqual(frappe.db.get_value("MSP Client User", person, "department"), renamed)
        self.assertEqual(frappe.db.get_value("MSP Approver", {"user": decider}, "department"), renamed)
        self.assertFalse(frappe.db.exists("MSP Department", name))

    def test_rename_updates_open_requests_but_preserves_completed_history(self):
        name = self.make_dept("Delivery")
        customer = self.make_customer(self.tag)
        service = self.make_service(f"DEPR{self.tag}", scope="User")
        open_line = self.request_line(customer, service, name)
        completed_line = self.request_line(customer, service, name, status="Completed")
        renamed = f"{name} Renamed"

        DepartmentService.update_department(name=name, department_name=renamed)
        self.track("MSP Department", renamed)

        self.assertEqual(
            frappe.db.get_value(
                "MSP Service Request Line", open_line, "new_user_department"
            ),
            renamed,
        )
        self.assertEqual(
            frappe.db.get_value(
                "MSP Service Request Line", completed_line, "new_user_department"
            ),
            name,
        )

    def test_delete_ignores_completed_request_history(self):
        name = self.make_dept("Former Division")
        customer = self.make_customer(self.tag)
        service = self.make_service(f"DEPDEL{self.tag}", scope="User")
        completed_line = self.request_line(
            customer, service, name, status="Completed"
        )

        DepartmentService.delete_department(name=name)

        self.assertFalse(frappe.db.exists("MSP Department", name))
        self.assertEqual(
            frappe.db.get_value(
                "MSP Service Request Line", completed_line, "new_user_department"
            ),
            name,
        )

    def test_standard_delete_is_refused_when_department_is_used(self):
        name = self.make_dept("Protected")
        customer = self.make_customer()
        self.make_person(customer, "Holder", department=name)

        with self.assertRaises(ValidationError) as ctx:
            frappe.delete_doc("MSP Department", name, ignore_permissions=True)

        self.assertEqual(str(ctx.exception), DELETE_REFUSED)

    # ------------------------------------------------------------------ delete refused
    def test_delete_refused_when_a_client_user_holds_it(self):
        name = self.make_dept("Logistics")
        customer = self.make_customer()
        self.make_person(customer, "Holder", department=name)

        with self.assertRaises(ValidationError) as ctx:
            DepartmentService.delete_department(name=name)

        self.assertEqual(str(ctx.exception), DELETE_REFUSED)
        self.assertTrue(frappe.db.exists("MSP Department", name))

    def test_delete_refused_when_an_approver_row_holds_it(self):
        name = self.make_dept("Compliance")
        customer = self.make_customer()
        decider = self.make_account("customer", "MSP Customer Manager", customer, suffix=f"dep{self.tag}")
        self.grant(decider, can_submit=1, can_approve=1)

        from nexgen_msp.api.internal.services.authority_service import AuthorityService

        AuthorityService.set_account_rights(
            decider, {"can_submit": 1, "can_approve": 1, "department": name}
        )

        with self.assertRaises(ValidationError) as ctx:
            DepartmentService.delete_department(name=name)

        self.assertEqual(str(ctx.exception), DELETE_REFUSED)

    def test_delete_refused_when_an_active_request_holds_it(self):
        name = self.make_dept("Warehouse")
        customer = self.make_customer()
        service = self.make_service(f"DEP{self.tag}", scope="User")
        asker = self.make_account("customer", "MSP Customer Manager", customer, suffix=f"ask{self.tag}")
        self.grant(asker)

        frappe.set_user(asker)
        try:
            out = PortalService.create_request(
                customer=customer,
                request_type="Add",
                lines=[
                    {
                        "request_action": self.action(),
                        "action": "Add",
                        "target_scope": "User",
                        "is_new_user": 1,
                        "new_user_full_name": "Fresh Face",
                        "new_user_department": name,
                        "new_user_username": f"f.face.{self.tag}",
                        "requested_service": service,
                    }
                ],
            )
        finally:
            frappe.set_user("Administrator")

        self.track("MSP Service Request", out["name"])

        with self.assertRaises(ValidationError) as ctx:
            DepartmentService.delete_department(name=name)

        self.assertEqual(str(ctx.exception), DELETE_REFUSED)

    def test_delete_allowed_when_never_used(self):
        name = self.make_dept("Unused")

        DepartmentService.delete_department(name=name)

        self.assertFalse(frappe.db.exists("MSP Department", name))

    # ------------------------------------------------------------------ validate_department
    def test_validate_department_rejects_a_nonexistent_department(self):
        with self.assertRaises(ValidationError):
            DepartmentService.validate_department(self.name_for("Nowhere"))

    def test_validate_department_rejects_a_disabled_department(self):
        name = self.make_dept("Archive", enabled=0)

        with self.assertRaises(ValidationError):
            DepartmentService.validate_department(name)

    def test_validate_department_normalizes_to_the_canonical_spelling(self):
        name = self.make_dept("Engineering")

        self.assertEqual(DepartmentService.validate_department(f"  {name.upper()}  "), name)

    def test_a_raw_api_call_cannot_smuggle_in_an_unconfigured_department(self):
        customer = self.make_customer()
        service = self.make_service(f"RAW{self.tag}", scope="User")
        asker = self.make_account("customer", "MSP Customer Manager", customer, suffix=f"raw{self.tag}")
        self.grant(asker)

        frappe.set_user(asker)
        try:
            with self.assertRaises(ValidationError):
                PortalService.create_request(
                    customer=customer,
                    request_type="Add",
                    lines=[
                        {
                            "request_action": self.action(),
                            "action": "Add",
                            "target_scope": "User",
                            "is_new_user": 1,
                            "new_user_full_name": "Nobody",
                            "new_user_department": "Whatever I Want",
                            "requested_service": service,
                        }
                    ],
                )
        finally:
            frappe.set_user("Administrator")

    def test_new_user_request_requires_a_department_even_with_new_device_flag(self):
        customer = self.make_customer()
        service = self.make_service(f"REQDEP{self.tag}", scope="User")
        asker = self.make_account("customer", "MSP Customer Manager", customer, suffix=f"reqdep{self.tag}")
        self.grant(asker)

        frappe.set_user(asker)
        try:
            for department in (None, "Whatever I Want"):
                with self.assertRaises(ValidationError):
                    PortalService.create_request(
                        customer=customer,
                        request_type="Add",
                        lines=[
                            {
                                "request_action": self.action(),
                                "action": "Add",
                                "target_scope": "User",
                                "is_new_user": 1,
                                "is_new_device": 1,
                                "new_user_full_name": "New Colleague",
                                "new_user_department": department,
                                "requested_service": service,
                            }
                        ],
                    )
        finally:
            frappe.set_user("Administrator")


class TestDepartmentMigration(MSPTestCase):
    """The patch that turns everyone's own free text into one catalogue.

    The states this reads are, deliberately, no longer reachable through the front door: a
    `MSP Client User` cannot be saved with a department the catalogue does not recognise any
    more. So the messy, pre-migration data is written straight to the database, the way it
    already sits on a site that predates this phase.
    """

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer()

    def stamp(self, doctype, name, value):
        frappe.db.set_value(doctype, name, "department", value, update_modified=False)

    def variant(self, label, case="title"):
        base = f"ZZTEST {label} {self.tag}"
        if case == "upper":
            return base.upper()
        if case == "lower":
            return base.lower()
        return base

    def request_line(self, department, status="Draft"):
        service = self.make_service(f"DEPMIG{self.tag}", scope="User")
        doc = frappe.get_doc(
            {
                "doctype": "MSP Service Request",
                "customer": self.customer,
                "request_type": "Add",
                "priority": "Medium",
                "status": "Draft",
                "source": "Internal",
                "requester": frappe.session.user,
                "lines": [
                    {
                        "request_action": self.action(),
                        "action": "Add",
                        "target_scope": "User",
                        "is_new_user": 1,
                        "new_user_full_name": "Future colleague",
                        "new_user_department": department,
                        "requested_service": service,
                    }
                ],
            }
        ).insert(ignore_permissions=True)
        if status != "Draft":
            frappe.db.set_value("MSP Service Request", doc.name, "status", status)
        frappe.db.commit()
        self.track("MSP Service Request", doc.name)
        return doc.lines[0].name

    def test_open_request_lines_join_the_catalogue_but_completed_ones_stay_frozen(self):
        canonical_value = self.variant("Field Services")
        open_value = self.variant("Field Services", "lower")
        completed_value = self.variant("Field Services", "upper")
        # The existing spelling wins deterministically over the single draft variant.
        for label in ("Field One", "Field Two"):
            person = self.make_person(self.customer, label)
            self.stamp("MSP Client User", person, canonical_value)
        open_line = self.request_line(open_value)
        completed_line = self.request_line(completed_value, status="Completed")

        report = build_department_catalogue.execute()
        rewritten = frappe.db.get_value(
            "MSP Service Request Line", open_line, "new_user_department"
        )

        self.assertEqual(report["request_lines_rewritten"], 1)
        self.assertEqual(rewritten, canonical_value)
        self.assertTrue(frappe.db.exists("MSP Department", rewritten))
        self.assertEqual(
            frappe.db.get_value(
                "MSP Service Request Line", completed_line, "new_user_department"
            ),
            completed_value,
        )
        self.track("MSP Department", rewritten)

    def test_case_variants_collapse_into_one_canonical_department(self):
        alice = self.make_person(self.customer, "Alice")
        bob = self.make_person(self.customer, "Bob")
        carol = self.make_person(self.customer, "Carol")

        self.stamp("MSP Client User", alice, self.variant("Accounting", "title"))
        self.stamp("MSP Client User", bob, self.variant("Accounting", "upper"))
        self.stamp("MSP Client User", carol, self.variant("Accounting", "lower"))

        report = build_department_catalogue.execute()
        self.assertGreaterEqual(report["created"] + report["reused"], 1)

        departments = {
            frappe.db.get_value("MSP Client User", person, "department") for person in (alice, bob, carol)
        }
        self.assertEqual(len(departments), 1, "every case variant now points at the same department")

        canonical = departments.pop()
        dept_name = frappe.db.get_value("MSP Department", {"department_name": canonical}, "name")
        self.assertTrue(dept_name)
        self.track("MSP Department", dept_name)

    def test_internal_whitespace_variants_collapse_without_rolling_back_prior_creations(self):
        alice = self.make_person(self.customer, "WideSpace")
        bob = self.make_person(self.customer, "SingleSpace")
        wide = self.variant("Human  Resources")
        single = self.variant("Human Resources")
        self.stamp("MSP Client User", alice, wide)
        self.stamp("MSP Client User", bob, single)

        report = build_department_catalogue.execute()
        rewritten = {
            frappe.db.get_value("MSP Client User", person, "department")
            for person in (alice, bob)
        }

        self.assertEqual(len(rewritten), 1)
        canonical = rewritten.pop()
        self.assertTrue(frappe.db.exists("MSP Department", canonical))
        self.assertGreaterEqual(report["canonical_departments"], 1)
        self.track("MSP Department", canonical)

    def test_approver_rows_are_rewritten_too(self):
        decider = self.make_account("customer", "MSP Customer Manager", self.customer, suffix=f"mig{self.tag}")
        self.grant(decider, can_submit=1, can_approve=1)

        row_name = frappe.db.get_value(
            "MSP Approver", {"user": decider}, "name"
        )
        self.assertTrue(row_name)

        self.stamp("MSP Approver", row_name, self.variant("Payroll", "upper"))

        build_department_catalogue.execute()

        rewritten = frappe.db.get_value("MSP Approver", row_name, "department")
        self.assertEqual(rewritten.strip().casefold(), self.variant("Payroll").strip().casefold())

        dept_name = frappe.db.get_value("MSP Department", {"department_name": rewritten}, "name")
        self.track("MSP Department", dept_name)

    def test_genuinely_different_near_duplicates_are_left_separate_and_reported(self):
        hr = self.make_person(self.customer, "HrPerson")
        hres = self.make_person(self.customer, "HresPerson")

        hr_name = f"ZZTEST HR {self.tag}"
        hres_name = f"ZZTEST Human Resources {self.tag}"

        self.stamp("MSP Client User", hr, hr_name)
        self.stamp("MSP Client User", hres, hres_name)

        build_department_catalogue.execute()

        rewritten_hr = frappe.db.get_value("MSP Client User", hr, "department")
        rewritten_hres = frappe.db.get_value("MSP Client User", hres, "department")

        self.assertNotEqual(rewritten_hr, rewritten_hres, "not merged into one department")
        self.assertEqual(rewritten_hr.strip().casefold(), hr_name.strip().casefold())
        self.assertEqual(rewritten_hres.strip().casefold(), hres_name.strip().casefold())

        for value in (rewritten_hr, rewritten_hres):
            dept_name = frappe.db.get_value("MSP Department", {"department_name": value}, "name")
            self.track("MSP Department", dept_name)

    def test_lookalike_names_are_grouped_and_reported_without_being_merged(self):
        """The reporting half of §17, isolated from persistence: a pure grouping of names,
        exactly the spec's own example — not a fuzzy match, only a plain initialism check."""
        groups = build_department_catalogue._flag_potential_aliases(
            ["HR", "Human Resources", "Human Resource", "Accounting", "IT"]
        )

        hr_group = next((group for group in groups if "HR" in group), None)
        self.assertIsNotNone(hr_group, "HR and its spelled-out forms were grouped")
        self.assertIn("Human Resources", hr_group)
        self.assertIn("Human Resource", hr_group)

        for group in groups:
            self.assertNotIn("Accounting", group)
            self.assertNotIn("IT", group)

    def test_running_the_migration_twice_is_idempotent(self):
        alice = self.make_person(self.customer, "Repeat")
        self.stamp("MSP Client User", alice, self.variant("Support", "lower"))

        first = build_department_catalogue.execute()
        canonical = frappe.db.get_value("MSP Client User", alice, "department")
        dept_name = frappe.db.get_value("MSP Department", {"department_name": canonical}, "name")
        self.track("MSP Department", dept_name)

        second = build_department_catalogue.execute()

        self.assertEqual(
            frappe.db.get_value("MSP Client User", alice, "department"), canonical
        )
        self.assertEqual(
            frappe.db.count("MSP Department", {"department_name": canonical}), 1
        )
        self.assertGreaterEqual(first["created"], 0)
        self.assertGreaterEqual(second["reused"], 0)


class TestADepartmentMayBelongToOneCompany(MSPTestCase):
    """The rare department that is one company's own is offered to them and to nobody else."""

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.mine = self.make_customer(self.tag)
        self.theirs = self.make_customer(f"{self.tag}B")

    def named(self, label):
        return f"ZZTEST {label} {self.tag}"

    def make_owned(self, label, customer=None):
        rows = DepartmentService.create_department(
            department_name=self.named(label), customer=customer
        )
        created = next(row for row in rows if row.department_name == self.named(label))
        self.track("MSP Department", created.name)

        return created.name

    def offered_to(self, customer):
        return [row.department_name for row in DepartmentService.list_departments(customer=customer)]

    def test_one_without_a_customer_is_offered_to_everyone(self):
        shared = self.make_owned("Shared")

        self.assertIn(shared, self.offered_to(self.mine))
        self.assertIn(shared, self.offered_to(self.theirs))

    def test_one_named_for_a_company_is_offered_to_them_alone(self):
        private = self.make_owned("Workshop", customer=self.mine)

        self.assertIn(private, self.offered_to(self.mine))
        self.assertNotIn(private, self.offered_to(self.theirs))

    def test_it_is_not_offered_when_no_company_is_named_at_all(self):
        private = self.make_owned("Atelier", customer=self.mine)

        self.assertNotIn(private, [row.department_name for row in DepartmentService.list_departments()])

    def test_the_administrator_table_still_shows_every_one_of_them(self):
        private = self.make_owned("Cellar", customer=self.mine)

        listed = {
            row.department_name: row.customer
            for row in DepartmentService.list_departments(enabled_only=False)
        }

        self.assertIn(private, listed)
        self.assertEqual(listed[private], self.mine)

    def test_the_portal_offers_a_company_only_what_is_theirs(self):
        private = self.make_owned("Cellier", customer=self.mine)
        elsewhere = self.make_owned("Cave", customer=self.theirs)

        offered = [row["value"] for row in PortalService.list_departments(customer=self.mine)]

        self.assertIn(private, offered)
        self.assertNotIn(elsewhere, offered)

    def test_the_settings_screen_can_hand_one_to_a_company(self):
        label = self.make_owned("Garage")

        DepartmentService.save_department(name=label, department={"customer": self.mine})

        self.assertEqual(frappe.db.get_value("MSP Department", label, "customer"), self.mine)
        self.assertNotIn(label, self.offered_to(self.theirs))

    def test_and_give_it_back_to_everyone(self):
        label = self.make_owned("Loft", customer=self.mine)

        DepartmentService.save_department(name=label, department={"customer": ""})

        self.assertFalse(frappe.db.get_value("MSP Department", label, "customer"))
        self.assertIn(label, self.offered_to(self.theirs))

    def test_editing_something_else_leaves_the_company_alone(self):
        label = self.make_owned("Studio", customer=self.mine)

        DepartmentService.save_department(name=label, department={"description": "Paint"})

        self.assertEqual(frappe.db.get_value("MSP Department", label, "customer"), self.mine)

    def test_one_worn_at_another_company_cannot_become_one_company_s(self):
        """Their people would keep a department their own forms no longer offer."""
        label = self.make_owned("Depot")
        person = self.make_person(self.theirs, "Wearer")
        frappe.db.set_value("MSP Client User", person, "department", label)
        frappe.db.commit()

        with self.assertRaises(ValidationError) as caught:
            DepartmentService.save_department(name=label, department={"customer": self.mine})

        self.assertIn("other customer", str(caught.exception))
        self.assertFalse(frappe.db.get_value("MSP Department", label, "customer"))

    def test_one_worn_only_by_that_company_s_people_can(self):
        label = self.make_owned("Yard")
        person = self.make_person(self.mine, "Local")
        frappe.db.set_value("MSP Client User", person, "department", label)
        frappe.db.commit()

        DepartmentService.save_department(name=label, department={"customer": self.mine})

        self.assertEqual(frappe.db.get_value("MSP Department", label, "customer"), self.mine)
