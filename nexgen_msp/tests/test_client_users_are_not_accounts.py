"""A person we manage is a record of ours, never an account.

A company with five hundred people on file may have three who sign in. Those three are
opened in the accounts screen and nowhere else. Creating a person, importing a sheet of
them, writing down their email or raising a request for a newcomer must leave the other
four hundred and ninety-seven exactly as they were: no User, no Contact, no permission,
no role, no invitation, and no screen that says they have, or could have, access.
"""

from collections import defaultdict

import frappe

from nexgen_msp.api.excel_import.services.excel_import_service import ExcelImportService
from nexgen_msp.api.internal.services.user_360_service import User360Service
from nexgen_msp.api.internal.services.user_service import UserService

from .base import MSPTestCase


class AccountFootprint(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.department = self.make_department("Operations")

    def accounts(self):
        """Everything that would let somebody at this company sign in or be reached as one."""
        return {
            "users": frappe.db.count("User"),
            "contacts": frappe.db.sql(
                """
                select count(distinct parent) from `tabDynamic Link`
                where parenttype = 'Contact' and link_doctype = 'Customer' and link_name = %s
                """,
                self.customer,
            )[0][0],
            "permissions": frappe.db.count(
                "User Permission", {"allow": "Customer", "for_value": self.customer}
            ),
            "mail": frappe.db.count("Email Queue", {"creation": [">=", self.started]}),
        }

    def remember(self):
        self.started = frappe.utils.now()
        self.before = self.accounts()

    def assertNoAccountAppeared(self):
        self.assertEqual(self.accounts(), self.before)

    def created(self, name):
        return self.track("MSP Client User", name)


class TestCreatingAPerson(AccountFootprint):
    def test_creating_a_person_creates_no_user(self):
        self.remember()

        out = UserService.create_client_user(
            customer=self.customer,
            full_name=f"ZZTEST Person {self.tag}",
            department=self.department,
        )
        self.created(out["name"] if isinstance(out, dict) else out)

        self.assertNoAccountAppeared()

    def test_an_email_on_file_grants_nothing(self):
        """Somebody's work address is how we reach them, not a login."""
        self.remember()

        out = UserService.create_client_user(
            customer=self.customer,
            full_name=f"ZZTEST Mailed {self.tag}",
            department=self.department,
            email=f"zztest.mailed.{self.tag}@example.invalid",
        )
        self.created(out["name"] if isinstance(out, dict) else out)

        self.assertNoAccountAppeared()
        self.assertFalse(
            frappe.db.exists("User", f"zztest.mailed.{self.tag}@example.invalid")
        )

    def test_the_record_carries_no_portal_flag_any_more(self):
        self.assertFalse(frappe.get_meta("MSP Client User").has_field("portal_visible"))
        self.assertFalse(frappe.get_meta("MSP Client User").has_field("portal_user"))


class TestImportingASheet(AccountFootprint):
    def record(self, index):
        return {
            "row_number": index + 2,
            "full_name": f"ZZTEST Imported {self.tag} {index}",
            "company": self.customer,
            "department": self.department,
            "email": f"zztest.imported.{self.tag}.{index}@example.invalid",
            "username": f"zz{self.tag}{index}",
            "ad_created": frappe.utils.add_days(frappe.utils.today(), -30),
            "ad_disabled": None,
            "ad_marked_active": 1,
            "remarks": None,
            "services": {},
        }

    def test_five_hundred_people_open_no_account(self):
        ExcelImportService._billed_customers = {}
        ExcelImportService._fill_blanks_only = 1
        report = {
            "created": defaultdict(int),
            "updated": defaultdict(int),
            "skipped": defaultdict(int),
            "exceptions": [],
        }

        self.remember()

        for index in range(500):
            name = ExcelImportService._create_client_user(self.record(index), self.customer, report)
            self.created(name)

        frappe.db.commit()

        self.assertEqual(
            frappe.db.count("MSP Client User", {"customer": self.customer}), 500
        )
        self.assertNoAccountAppeared()


class TestThePersonsPage(AccountFootprint):
    def test_it_says_nothing_about_signing_in(self):
        name = self.make_person(self.customer, f"Reader {self.tag}")

        reading = User360Service.get_user(name)

        for word in ("portal_access", "portal_user", "portal_visible", "account"):
            self.assertNotIn(word, reading["user"])


class TestARequestForANewcomer(AccountFootprint):
    def test_a_request_line_can_no_longer_ask_for_access(self):
        self.assertFalse(
            frappe.get_meta("MSP Service Request Line").has_field("needs_portal_access")
        )

    def test_a_newcomer_needs_no_email_to_be_asked_for(self):
        service = self.make_service(f"NC{self.tag[:3]}")
        self.cover_service(self.customer, service)
        self.track("MSP Approval Authority", self.customer)
        manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"nc{self.tag[:3]}"
        )
        self.grant(manager, can_submit=1, can_approve=0)

        from nexgen_msp.api.portal.services.portal_service import PortalService

        self.remember()

        frappe.set_user(manager)
        frappe.clear_cache(user=manager)
        try:
            out = PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=[
                    {
                        "request_action": self.action("Add"),
                        "action": "Add",
                        "target_scope": "User",
                        "is_new_user": 1,
                        "new_user_full_name": f"ZZTEST Newcomer {self.tag}",
                        "new_user_department": self.department,
                        "needs_portal_access": 1,
                        "requested_service": service,
                    }
                ],
            )
        finally:
            frappe.set_user("Administrator")

        self.track("MSP Service Request", out["name"])

        self.assertTrue(frappe.db.exists("MSP Service Request", out["name"]))
        self.assertNoAccountAppeared()
