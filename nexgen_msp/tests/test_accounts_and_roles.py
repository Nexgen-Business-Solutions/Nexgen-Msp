"""The rule the whole permission model rests on: an account is on one side, never both."""

import frappe

from nexgen_msp.api.internal.services.team_service import TeamService
from nexgen_msp.utils import permissions
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase


class TestAccountsAndRoles(MSPTestCase):
    def test_internal_account_gets_only_the_role_asked_for(self):
        email = self.make_account("internal", "MSP Technician")

        self.assertEqual(
            sorted(row.role for row in frappe.get_doc("User", email).roles), ["MSP Technician"]
        )
        # staff hold no customer permission, and that absence is what gives them every one
        self.assertEqual(
            frappe.get_all("User Permission", filters={"user": email, "allow": "Customer"}), []
        )
        self.assertEqual(
            len(permissions.get_allowed_customers(email)), frappe.db.count("Customer")
        )

    def test_customer_account_is_bound_to_its_company(self):
        customer = self.make_customer()
        email = self.make_account("customer", "MSP Customer Operator", customer)

        self.assertIn("MSP Customer Operator", frappe.get_roles(email))
        self.assertEqual(permissions.get_allowed_customers(email), [customer])
        self.assertEqual(frappe.db.count("Contact", {"user": email}), 1)

    def test_customer_role_without_a_company_is_refused(self):
        with self.assertRaises(ValidationError):
            TeamService.create_account(
                email="zztest.orphan@example.invalid",
                first_name="Orphan",
                kind="customer",
                role="MSP Customer Operator",
                send_email=0,
            )

        self.assertFalse(frappe.db.exists("User", "zztest.orphan@example.invalid"))

    def test_an_account_cannot_hold_both_families(self):
        customer = self.make_customer()
        staff = self.make_account("internal", "MSP Technician", suffix="staff")
        contact = self.make_account("customer", "MSP Customer Operator", customer, suffix="contact")

        with self.assertRaises(ValidationError):
            TeamService.set_role(email=staff, role="MSP Customer Operator")

        with self.assertRaises(ValidationError):
            TeamService.set_role(email=contact, role="MSP System Admin")

        self.assertEqual(sorted(frappe.get_roles(staff)).count("MSP Customer Operator"), 0)
        self.assertNotIn("MSP System Admin", frappe.get_roles(contact))

    def test_moving_inside_a_family_replaces_the_role(self):
        customer = self.make_customer()
        contact = self.make_account("customer", "MSP Customer Operator", customer)

        TeamService.set_role(email=contact, role="MSP Customer Manager")
        held = set(frappe.get_roles(contact))

        self.assertIn("MSP Customer Manager", held)
        self.assertNotIn("MSP Customer Operator", held)

    def test_a_role_outside_the_two_families_is_refused(self):
        customer = self.make_customer()

        with self.assertRaises(ValidationError):
            TeamService.create_account(
                email="zztest.sysman@example.invalid",
                first_name="X",
                kind="internal",
                role="System Manager",
                customer=customer,
                send_email=0,
            )

    def test_the_picker_offers_the_weakest_role_first(self):
        options = TeamService.options()

        self.assertEqual(options["internal_roles"][0]["value"], "MSP Technician")
        self.assertEqual(options["customer_roles"][0]["value"], "MSP Customer Operator")
        self.assertEqual(options["internal_roles"][-1]["value"], "MSP System Admin")

    def test_roles_are_shown_under_a_readable_name(self):
        labels = permissions.ROLE_LABELS

        self.assertEqual(labels["MSP Customer Manager"], "Customer Manager")
        self.assertEqual(labels["MSP System Admin"], "Administrator")
        self.assertNotIn("Portal", labels["MSP Customer Manager"])

    def test_a_customer_contact_is_never_treated_as_staff(self):
        """A staff role handed to a contact by hand must not open the whole book."""
        customer = self.make_customer()
        contact = self.make_account("customer", "MSP Customer Operator", customer)

        user = frappe.get_doc("User", contact)
        user.append("roles", {"role": "MSP Technician"})
        user.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.clear_cache(user=contact)

        self.assertFalse(permissions.is_internal(contact))
        self.assertEqual(permissions.get_allowed_customers(contact), [customer])


class TestThePortalContactsCard(MSPTestCase):
    def test_customer_alone_lists_both_customer_kinds(self):
        from nexgen_msp.api.internal.services.team_service import TeamService

        customer = self.make_customer()
        manager = self.make_account("customer", "MSP Customer Manager", customer, suffix="pcm")
        operator = self.make_account("customer", "MSP Customer Operator", customer, suffix="pco")
        tech = self.make_account("internal", "MSP Technician", suffix="pct")

        listed = {row["name"] for row in TeamService.list_members(kind="Customer")}

        self.assertTrue({manager, operator} <= listed)
        self.assertNotIn(tech, listed)
        self.assertEqual({row["name"] for row in TeamService.list_members(kind="Technician")} & {manager, operator, tech}, {tech})
