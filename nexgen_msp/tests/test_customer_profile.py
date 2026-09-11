"""Customer profile authorization and isolation against a real ERPNext site.

Every integration test suppresses commits and rolls back its temporary records.
"""

import unittest
from unittest.mock import patch

import frappe

from nexgen_msp.api.internal.services.customer_service import CUSTOMER_FIELDS, CustomerService
from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils import customer_access, permissions
from nexgen_msp.utils.errors import PermissionError, ValidationError
from nexgen_msp.tests.test_customer_creation import CustomerIntegrationCase


class TestCustomerProfileIntegration(CustomerIntegrationCase):
    def setUp(self):
        super().setUp()
        self.admin = frappe.session.user
        self.mine = CustomerService.create_customer(self.details, self.address)["name"]
        self.other = CustomerService.create_customer({**self.details, "customer_name": self.details["customer_name"] + " Other"})["name"]
        self.manager = self.make_user("MSP Customer Manager", self.mine)
        self.operator = self.make_user("MSP Customer Operator", self.mine)
        self.tech = self.make_user("MSP Technician")
        frappe.set_user(self.admin)

    def make_user(self, role, customer=None):
        frappe.set_user("Administrator")
        token = frappe.generate_hash(length=10)
        user = frappe.get_doc({
            "doctype": "User", "email": f"zztest-profile-{token}@example.com",
            "first_name": "ZZTEST Profile", "send_welcome_email": 0,
            "roles": [{"role": role}],
        }).insert(ignore_permissions=True)
        if customer:
            permissions.ensure_customer_contact(user, customer)
        return user.name

    def test_admin_updates_supported_fields(self):
        result = CustomerService.save_customer(self.mine, {"website": "https://example.com", "msp_free_of_charge": 1})
        self.assertEqual(result["msp_free_of_charge"], 1)
        self.assertTrue(result["permissions"]["can_administer"])
        self.assertIn(self.mine, [row.name for row in CustomerService.list_customers()])

    def test_invalid_address_rolls_back_profile_change(self):
        before = frappe.db.get_value("Customer", self.mine, "website")
        with self.assertRaises(frappe.ValidationError):
            CustomerService.save_customer(self.mine, {"website": "https://changed.example.com"}, {**self.address, "country": "ZZTEST missing country"})
        self.assertEqual(frappe.db.get_value("Customer", self.mine, "website"), before)

    def test_manager_edits_own_website_address_and_contact(self):
        frappe.set_user(self.manager)
        result = CustomerService.save_customer(None, {"website": "https://example.com"}, {**self.address, "phone": "+9611123456", "email_id": "office@example.com"}, contacts=[{"first_name": "Reception", "last_name": "Desk", "email_id": "reception@example.com", "phone": "+9611123457"}])
        self.assertEqual(result["name"], self.mine)
        self.assertEqual(result["address"]["phone"], "+9611123456")
        self.assertEqual(result["website"], "https://example.com")
        self.assertNotIn("default_currency", result)
        self.assertNotIn("msp_free_of_charge", result)
        contact = next(row for row in result["contacts"] if row["first_name"] == "Reception")
        CustomerService.save_customer(self.mine, contacts=[{"name": contact["name"], "phone": "+9611765432"}])
        self.assertEqual(frappe.db.get_value("Contact", contact["name"], "phone"), "+9611765432")
        self.assertEqual(permissions.get_linked_customers(frappe.get_doc("Contact", contact["name"])), [self.mine])

    def test_manager_rejects_every_admin_field_and_unknown_field(self):
        frappe.set_user(self.manager)
        for field in set(CUSTOMER_FIELDS) - {"website"} | {"name", "customer", "doctype", "roles", "accounts", "contacts", "contract", "price_list"}:
            with self.subTest(field=field), self.assertRaises(PermissionError):
                CustomerService.save_customer(self.mine, {field: "Injected"})
        self.assertEqual(frappe.db.get_value("Customer", self.mine, "customer_name"), self.details["customer_name"])

    def test_cross_customer_and_nonexistent_targets_return_same_forbidden_error(self):
        for user in (self.manager, self.operator):
            frappe.set_user(user)
            for customer in (self.other, "ZZTEST unknown customer"):
                for call in (lambda: CustomerService.get_customer(customer), lambda: CustomerService.save_customer(customer, {"website": "https://example.com"})):
                    with self.subTest(user=user, customer=customer), self.assertRaises(PermissionError) as error:
                        call()
                    self.assertEqual(error.exception.http_status_code, 403)
                    self.assertEqual(error.exception.message, "You are not allowed to access or change this customer.")

    def test_operator_gets_only_customer_identity_and_cannot_edit(self):
        frappe.set_user(self.operator)
        self.assertEqual(set(CustomerService.get_customer()), {"name", "customer_name"})
        with self.assertRaises(PermissionError):
            CustomerService.save_customer(self.mine, {})
        with self.assertRaises(PermissionError):
            CustomerService.options()

    def test_technician_can_read_operational_profiles_but_not_edit_or_read_commercial(self):
        frappe.set_user(self.tech)
        self.assertIn(self.other, [row.name for row in CustomerService.list_customers()])
        detail = CustomerService.get_customer(self.mine)
        self.assertFalse(detail["permissions"]["can_edit"])
        for field in ("msp_free_of_charge", "default_currency", "default_price_list", "payment_terms", "last_billed_on", "counts"):
            self.assertNotIn(field, detail)
        for call in (lambda: CustomerService.save_customer(self.mine, {}), lambda: CustomerService.create_customer(self.details), lambda: ContractService.list_contracts()):
            with self.assertRaises(PermissionError):
                call()

    def test_other_roles_cannot_create_or_list_all_customers(self):
        for user in (self.manager, self.operator, self.tech):
            frappe.set_user(user)
            with self.assertRaises(PermissionError):
                CustomerService.create_customer(self.details)
            if user != self.tech:
                with self.assertRaises(PermissionError):
                    CustomerService.list_customers()

    def test_stale_permission_without_contact_does_not_grant_access(self):
        frappe.set_user("Administrator")
        permissions.add_customer_permission(self.manager, self.other)
        frappe.set_user(self.manager)
        self.assertEqual(customer_access.linked_customers(), [self.mine])
        self.assertEqual(permissions.get_allowed_customers(), [self.mine])
        with self.assertRaises(PermissionError):
            CustomerService.get_customer(self.other)

    def test_mixed_customer_staff_roles_do_not_widen_access(self):
        for user in (self.manager, self.operator):
            frappe.set_user("Administrator")
            doc = frappe.get_doc("User", user)
            doc.append("roles", {"role": "MSP System Admin"})
            doc.save(ignore_permissions=True)
            frappe.clear_cache(user=user)
            frappe.set_user(user)
            for call in (lambda: CustomerService.create_customer(self.details), lambda: CustomerService.get_customer(self.other), lambda: ContractService.list_contracts()):
                with self.assertRaises(PermissionError):
                    call()
            self.assertFalse(permissions.is_internal())

    def test_address_and_contact_linkage_cannot_be_supplied_by_manager(self):
        frappe.set_user(self.manager)
        for address in ({"name": "Other-Address"}, {"links": [{"link_name": self.other}]}):
            with self.assertRaises(PermissionError):
                CustomerService.save_customer(self.mine, address=address)
        for contact in ({"first_name": "Other", "user": self.tech}, {"first_name": "Other", "links": []}, {"name": "ZZTEST nonexistent contact", "first_name": "Other"}):
            with self.assertRaises(PermissionError):
                CustomerService.save_customer(self.mine, contacts=[contact])

    def test_contact_email_cannot_grant_an_existing_user_customer_access(self):
        frappe.set_user(self.manager)
        before = permissions.customers_from_contacts(self.tech)
        with self.assertRaises(ValidationError):
            CustomerService.save_customer(self.mine, contacts=[{"first_name": "Injected", "email_id": self.tech}])
        self.assertEqual(permissions.customers_from_contacts(self.tech), before)

    def test_shared_address_and_contact_are_not_mutated(self):
        frappe.set_user("Administrator")
        address = frappe.get_doc("Address", CustomerService._billing_address(self.mine))
        address.append("links", {"link_doctype": "Customer", "link_name": self.other})
        address.save(ignore_permissions=True)
        contact = frappe.get_doc("Contact", permissions.get_customer_contact(self.manager, self.mine))
        contact.append("links", {"link_doctype": "Customer", "link_name": self.other})
        contact.save(ignore_permissions=True)
        frappe.set_user(self.manager)
        detail = CustomerService.get_customer(self.mine)
        self.assertFalse(detail["permissions"]["can_edit_address"])
        with self.assertRaises(PermissionError):
            CustomerService.save_customer(self.mine, address=self.address)
        with self.assertRaises(PermissionError):
            CustomerService.save_customer(self.mine, contacts=[{"name": contact.name, "first_name": "Changed"}])
        self.assertEqual(frappe.db.get_value("Contact", contact.name, "first_name"), contact.first_name)

    def test_system_manager_without_msp_admin_cannot_create(self):
        user = self.make_user("System Manager")
        frappe.set_user(user)
        with self.assertRaises(PermissionError):
            CustomerService.create_customer(self.details)

    def test_invalid_erpnext_options_are_rejected_atomically(self):
        for field, value in (("customer_type", "Invalid"), ("customer_group", "ZZTEST missing"), ("territory", "ZZTEST missing"), ("default_currency", "ZZTEST missing")):
            name = self.details["customer_name"] + field
            with self.subTest(field=field), self.assertRaises(frappe.ValidationError):
                CustomerService.create_customer({**self.details, "customer_name": name, field: value})
            self.assertFalse(frappe.db.exists("Customer", {"customer_name": name}))

    def test_session_context_matches_customer_scope_and_role(self):
        from nexgen_msp.api.core.services.session_service import SessionService

        for user, role in ((self.manager, customer_access.MANAGER), (self.operator, customer_access.OPERATOR)):
            frappe.set_user(user)
            context = SessionService.get_session_context()
            self.assertEqual(context["customer_profile_role"], role)
            self.assertTrue(context["is_portal_user"])
            self.assertFalse(context["is_internal_user"])
            self.assertEqual(context["customers"], [self.mine])
            self.assertEqual(context["customer"], self.mine)

    def test_existing_portal_endpoints_keep_customer_isolation(self):
        from nexgen_msp.api.portal.services.portal_service import PortalService

        for user in (self.manager, self.operator):
            frappe.set_user(user)
            with self.assertRaises(ValidationError):
                PortalService.list_client_users(customer=self.other)
            self.assertIsInstance(PortalService.list_client_users(customer=self.mine), dict)

    def test_unknown_and_unlinked_accounts_fail_closed(self):
        unlinked = self.make_user("MSP Customer Manager")
        for user in (unlinked, "Guest"):
            frappe.set_user(user)
            for call in (lambda: CustomerService.get_customer(self.mine), lambda: CustomerService.create_customer(self.details), lambda: CustomerService.save_customer(self.mine, {})):
                with self.assertRaises(PermissionError):
                    call()

    def test_manager_cannot_edit_another_customers_real_contact(self):
        other_user = self.make_user("MSP Customer Manager", self.other)
        name = permissions.get_customer_contact(other_user, self.other)
        frappe.set_user(self.manager)
        with self.assertRaises(PermissionError):
            CustomerService.save_customer(self.mine, contacts=[{"name": name, "first_name": "Changed"}])
