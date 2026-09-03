"""The role model, exhaustively.

Everything the application allows or refuses hangs off two questions: which family an
account belongs to, and which single role it holds inside it. This module walks every role,
every crossing, and every way the two could be made to disagree.
"""

import frappe

from nexgen_msp.api.internal.services.authority_service import AuthorityService
from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.team_service import TeamService
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.api.core.services.session_service import SessionService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import permissions
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase

INTERNAL = ("MSP System Admin", "MSP Technician")
CUSTOMER = ("MSP Customer Manager", "MSP Customer Operator")


class TestRoleDefinitions(MSPTestCase):
    """What the two families are, before anyone holds anything."""

    def test_the_families_are_exactly_these(self):
        self.assertEqual(permissions.INTERNAL_ROLES, INTERNAL)
        self.assertEqual(permissions.CUSTOMER_ROLES, CUSTOMER)

    def test_no_role_belongs_to_both_families(self):
        self.assertEqual(
            set(permissions.INTERNAL_ROLES).intersection(permissions.CUSTOMER_ROLES), set()
        )

    def test_every_role_exists_on_the_site(self):
        for role in INTERNAL + CUSTOMER:
            self.assertTrue(frappe.db.exists("Role", role), f"{role} is missing")
            self.assertFalse(frappe.db.get_value("Role", role, "disabled"), f"{role} is disabled")

    def test_only_the_administrator_reaches_the_desk(self):
        for role in INTERNAL + CUSTOMER:
            expected = role == "MSP System Admin"
            self.assertEqual(
                bool(frappe.db.get_value("Role", role, "desk_access")), expected, role
            )

    def test_every_role_is_placed_in_a_family(self):
        for role in INTERNAL:
            self.assertEqual(permissions.family_of(role), "internal", role)

        for role in CUSTOMER:
            self.assertEqual(permissions.family_of(role), "customer", role)

    def test_a_role_we_do_not_grant_belongs_to_no_family(self):
        for role in ("System Manager", "Guest", "All", "Sales User", "", None):
            self.assertIsNone(permissions.family_of(role), repr(role))

    def test_the_old_operator_name_is_gone(self):
        self.assertFalse(frappe.db.exists("Role", "MSP Operator"))
        self.assertNotIn("MSP Operator", permissions.INTERNAL_ROLES + permissions.CUSTOMER_ROLES)

    def test_every_role_has_a_readable_name(self):
        for role in INTERNAL + CUSTOMER:
            self.assertIn(role, permissions.ROLE_LABELS)
            self.assertTrue(permissions.ROLE_LABELS[role].strip())

    def test_no_readable_name_mentions_the_portal(self):
        for label in permissions.ROLE_LABELS.values():
            self.assertNotIn("portal", label.lower())


class TestGrantingARole(MSPTestCase):
    """Creating an account: one role, and only the one asked for."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()

    def held(self, email):
        return sorted(row.role for row in frappe.get_doc("User", email).roles)

    def test_each_internal_role_grants_exactly_itself(self):
        for index, role in enumerate(INTERNAL):
            email = self.make_account("internal", role, suffix=f"i{index}")
            self.assertEqual(self.held(email), [role], role)

    def test_each_customer_role_grants_exactly_itself(self):
        for index, role in enumerate(CUSTOMER):
            email = self.make_account("customer", role, self.customer, suffix=f"c{index}")
            self.assertEqual(self.held(email), [role], role)

    def test_a_customer_role_cannot_be_asked_for_as_internal(self):
        for role in CUSTOMER:
            with self.assertRaises(ValidationError, msg=role):
                TeamService.create_account(
                    email="zztest.x@example.invalid", first_name="X", kind="internal",
                    role=role, send_email=0,
                )

    def test_an_internal_role_cannot_be_asked_for_as_a_customer(self):
        for role in INTERNAL:
            with self.assertRaises(ValidationError, msg=role):
                TeamService.create_account(
                    email="zztest.x@example.invalid", first_name="X", kind="customer",
                    role=role, customer=self.customer, send_email=0,
                )

    def test_a_role_outside_both_families_is_refused(self):
        for role in ("System Manager", "Administrator", "Guest", "", None):
            with self.assertRaises(ValidationError, msg=repr(role)):
                TeamService.create_account(
                    email="zztest.x@example.invalid", first_name="X", kind="internal",
                    role=role, send_email=0,
                )

    def test_a_kind_we_do_not_know_is_refused(self):
        for kind in ("staff", "portal", "", None):
            with self.assertRaises(ValidationError, msg=repr(kind)):
                TeamService.create_account(
                    email="zztest.x@example.invalid", first_name="X", kind=kind,
                    role="MSP Technician", send_email=0,
                )

    def test_nothing_is_left_behind_when_creation_is_refused(self):
        with self.assertRaises(ValidationError):
            TeamService.create_account(
                email="zztest.leftover@example.invalid", first_name="X", kind="customer",
                role="MSP Customer Operator", send_email=0,
            )

        self.assertFalse(frappe.db.exists("User", "zztest.leftover@example.invalid"))

    def test_a_customer_account_gets_its_permission_and_one_contact(self):
        email = self.make_account("customer", "MSP Customer Operator", self.customer)

        self.assertEqual(permissions.get_allowed_customers(email), [self.customer])
        self.assertEqual(frappe.db.count("Contact", {"user": email}), 1)
        self.assertEqual(permissions.customers_from_contacts(email), {self.customer})

    def test_an_internal_account_gets_no_permission_and_no_contact(self):
        email = self.make_account("internal", "MSP Technician")

        self.assertEqual(
            frappe.get_all("User Permission", filters={"user": email, "allow": "Customer"}), []
        )
        self.assertEqual(permissions.customers_from_contacts(email), set())

    def test_the_same_address_cannot_be_opened_twice(self):
        email = self.make_account("internal", "MSP Technician")

        with self.assertRaises(ValidationError):
            TeamService.create_account(
                email=email, first_name="Again", kind="internal",
                role="MSP Technician", send_email=0,
            )


class TestCrossingFamilies(MSPTestCase):
    """The rule that must never bend."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.staff = self.make_account("internal", "MSP Technician", suffix="s")
        self.contact = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="c")

    def test_a_customer_role_is_refused_on_an_internal_account(self):
        for role in CUSTOMER:
            with self.assertRaises(ValidationError, msg=role):
                TeamService.set_role(email=self.staff, role=role)

        self.assertEqual(
            sorted(row.role for row in frappe.get_doc("User", self.staff).roles), ["MSP Technician"]
        )

    def test_an_internal_role_is_refused_on_a_customer_account(self):
        for role in INTERNAL:
            with self.assertRaises(ValidationError, msg=role):
                TeamService.set_role(email=self.contact, role=role)

        self.assertEqual(
            sorted(row.role for row in frappe.get_doc("User", self.contact).roles),
            ["MSP Customer Operator"],
        )

    def test_moving_inside_the_internal_family_replaces_the_role(self):
        TeamService.set_role(email=self.staff, role="MSP System Admin")
        held = set(frappe.get_roles(self.staff))

        self.assertIn("MSP System Admin", held)
        self.assertNotIn("MSP Technician", held)

    def test_moving_inside_the_customer_family_replaces_the_role(self):
        TeamService.set_role(email=self.contact, role="MSP Customer Manager")
        held = set(frappe.get_roles(self.contact))

        self.assertIn("MSP Customer Manager", held)
        self.assertNotIn("MSP Customer Operator", held)

    def test_a_customer_role_needs_a_customer_behind_it(self):
        orphan = self.make_account("internal", "MSP Technician", suffix="o")
        permissions.remove_customer_permission(orphan)

        with self.assertRaises(ValidationError):
            permissions.guard_single_family(orphan, "MSP Customer Operator")

    def test_the_guard_refuses_a_role_it_does_not_grant(self):
        with self.assertRaises(ValidationError):
            permissions.guard_single_family(self.staff, "System Manager")


class TestWhatARoleOpens(MSPTestCase):
    """What each role actually reaches, asked of the services themselves."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.track("MSP Approval Authority", self.customer)
        self.accounts = {
            "MSP System Admin": self.make_account("internal", "MSP System Admin", suffix="adm"),
            "MSP Technician": self.make_account("internal", "MSP Technician", suffix="tec"),
            "MSP Customer Manager": self.make_account(
                "customer", "MSP Customer Manager", self.customer, suffix="mgr"
            ),
            "MSP Customer Operator": self.make_account(
                "customer", "MSP Customer Operator", self.customer, suffix="ope"
            ),
        }

    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def test_only_internal_accounts_are_internal(self):
        for role, email in self.accounts.items():
            self.assertEqual(permissions.is_internal(email), role in INTERNAL, role)

    def test_only_customer_accounts_are_contacts(self):
        for role, email in self.accounts.items():
            self.assertEqual(permissions.is_customer_contact(email), role in CUSTOMER, role)

    def test_only_the_operator_is_kept_from_the_invoices(self):
        for role, email in self.accounts.items():
            expected = role != "MSP Customer Operator"
            self.assertEqual(permissions.may_see_invoices(email), expected, role)

    def test_the_internal_workspace_answers_staff_only(self):
        for role, email in self.accounts.items():
            call = lambda: RequestService.list_requests(page_length=1)

            if role in INTERNAL:
                self.assertIn("rows", self.as_user(email, call), role)
            else:
                with self.assertRaises(ValidationError, msg=role):
                    self.as_user(email, call)

    def test_a_contact_reaches_its_own_company_and_no_other(self):
        for role in CUSTOMER:
            email = self.accounts[role]
            self.assertEqual(permissions.get_allowed_customers(email), [self.customer], role)

    def test_staff_reach_every_customer(self):
        for role in INTERNAL:
            self.assertEqual(
                len(permissions.get_allowed_customers(self.accounts[role])),
                frappe.db.count("Customer"),
                role,
            )

    def test_the_session_says_which_side_the_account_is_on(self):
        for role, email in self.accounts.items():
            context = self.as_user(email, SessionService.get_session_context)

            self.assertEqual(context["is_internal_user"], role in INTERNAL, role)
            self.assertEqual(context["is_portal_user"], role in CUSTOMER, role)
            self.assertEqual(
                context["can_see_invoices"], role != "MSP Customer Operator", role
            )

    def test_both_customer_roles_reach_the_same_pages(self):
        for role in CUSTOMER:
            email = self.accounts[role]

            self.assertIn("rows", self.as_user(email, lambda: PortalService.list_client_users(page_length=1)))
            self.assertIn("rows", self.as_user(email, lambda: PortalService.list_devices(page_length=1)))
            self.assertIn("rows", self.as_user(email, lambda: PortalService.list_requests(page_length=1)))

    def test_only_a_customer_account_can_be_named_an_approver(self):
        for role, email in self.accounts.items():
            if role in CUSTOMER:
                AuthorityService.set_account_rights(email, {"can_submit": 1})
                self.assertTrue(AuthorityService.get_account_rights(email)["named"], role)
                AuthorityService.set_account_rights(email, {})
            else:
                with self.assertRaises(ValidationError, msg=role):
                    AuthorityService.set_account_rights(email, {"can_submit": 1})


class TestARoleAddedByHand(MSPTestCase):
    """What the application does when someone edits roles in the desk, behind its back."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.contact = self.make_account("customer", "MSP Customer Operator", self.customer)

    def add_role(self, email, role):
        user = frappe.get_doc("User", email)
        user.append("roles", {"role": role})
        user.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.clear_cache(user=email)

    def test_an_internal_role_added_by_hand_does_not_make_a_contact_staff(self):
        for role in INTERNAL:
            self.add_role(self.contact, role)

            self.assertFalse(permissions.is_internal(self.contact), role)
            self.assertEqual(permissions.get_allowed_customers(self.contact), [self.customer], role)

    def test_an_internal_role_added_by_hand_does_not_open_our_workspace(self):
        self.add_role(self.contact, "MSP System Admin")

        frappe.set_user(self.contact)
        try:
            for call in (
                lambda: RequestService.list_requests(page_length=1),
                lambda: UserService.list_users(page_length=1),
                lambda: DeviceService.list_devices(page_length=1),
            ):
                with self.assertRaises(ValidationError):
                    call()
        finally:
            frappe.set_user("Administrator")

    def test_the_deployment_sweep_puts_permissions_back_in_line(self):
        permissions.add_customer_permission(self.contact, self.make_customer("B"))
        frappe.db.commit()

        self.assertEqual(len(permissions.get_allowed_customers(self.contact)), 2)

        permissions.reconcile_customer_permissions(self.contact)
        frappe.db.commit()

        self.assertEqual(permissions.get_allowed_customers(self.contact), [self.customer])
