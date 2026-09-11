"""Customer creation boundary tests; run without a database using unittest."""

import json
import unittest
from unittest.mock import MagicMock, patch

import frappe

from nexgen_msp.api.internal.services.customer_service import CustomerService
from nexgen_msp.utils.errors import PermissionError, ValidationError
from nexgen_msp.utils import permissions

class TestCustomerCreation(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(frappe, "session", frappe._dict(user="admin@example.com")))
        self.enterContext(patch.object(permissions, "is_customer_contact", return_value=False))
        self.enterContext(patch.object(permissions, "customers_from_contacts", return_value=set()))
        self.db = MagicMock()
        self.enterContext(patch.object(frappe, "db", self.db, create=True))
        self.db.exists.return_value = False
        self.enterContext(patch.object(frappe, "get_roles", return_value=["MSP System Admin"]))
        self.values = frappe._dict(name="CUST-0001", customer_type="Company")
        self.doc = MagicMock()
        self.doc.set.side_effect = self.values.__setitem__
        self.doc.get.side_effect = self.values.get
        self.doc.name = self.values.name
        type(self.doc).customer_name = property(lambda doc: self.values.customer_name)
        self.new_doc = self.enterContext(patch.object(frappe, "new_doc", return_value=self.doc))
        self.detail = {"name": self.doc.name, "customer_name": "Example"}
        self.read = self.enterContext(patch.object(CustomerService, "get_customer", return_value=self.detail))
        self.details = dict(customer_name=" Example ", customer_type="Company", customer_group="Commercial", territory="Lebanon")

    def test_creates_standard_customer_and_ignores_untrusted_fields(self):
        result = CustomerService.create_customer({**self.details, "doctype": "User", "name": "injected", "owner": "Guest", "msp_free_of_charge": "1"})
        self.assertEqual(result, self.detail)
        self.new_doc.assert_called_once_with("Customer")
        self.assertEqual(self.values.customer_name, "Example")
        self.assertEqual(self.values.msp_free_of_charge, 1)
        self.assertEqual(self.values.name, "CUST-0001")
        self.assertNotIn("owner", self.values)
        self.doc.insert.assert_called_once_with(ignore_permissions=True)
        self.db.commit.assert_called_once()

    def test_json_payload_and_address_use_generated_customer_identifier(self):
        address = {"address_line1": " Main Street ", "city": " Beirut ", "country": "Lebanon", "name": "other-customer-address"}
        with patch.object(CustomerService, "_save_address") as save_address:
            CustomerService.create_customer(json.dumps(self.details), json.dumps(address))
        customer, title, values = save_address.call_args.args
        self.assertEqual((customer, title), ("CUST-0001", "Example"))
        self.assertEqual(values["city"], "Beirut")
        self.assertNotIn("name", values)
        self.assertEqual(save_address.call_args.kwargs, {"creating": True})

    def test_empty_address_is_optional(self):
        with patch.object(CustomerService, "_save_address") as save_address:
            CustomerService.create_customer(self.details, {"city": "  "})
        save_address.assert_not_called()

    def test_duplicate_name_is_rejected_before_insert(self):
        self.db.exists.return_value = True
        with self.assertRaises(ValidationError) as error:
            CustomerService.create_customer(self.details)
        self.assertEqual(error.exception.code, "DUPLICATE_CUSTOMER")
        self.doc.insert.assert_not_called()
        self.db.commit.assert_not_called()

    def test_required_fields(self):
        for field in ("customer_name", "customer_type", "customer_group", "territory"):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                CustomerService.create_customer({**self.details, field: " "})
        self.doc.insert.assert_not_called()

    def test_malformed_payloads_are_validation_errors(self):
        for details in ("{broken", "[]", [], 42, {"customer_name": []}):
            with self.subTest(details=details), self.assertRaises(ValidationError):
                CustomerService.create_customer(details)
        for address in ("{broken", [], {"city": []}):
            with self.subTest(address=address), self.assertRaises(ValidationError):
                CustomerService.create_customer(self.details, address)
        self.doc.insert.assert_not_called()

    def test_non_admin_roles_are_rejected_before_accessing_customer_data(self):
        for roles in (["Guest"], ["MSP Technician"], ["MSP Customer Manager"], ["MSP Customer Operator"]):
            with self.subTest(roles=roles), patch.object(frappe, "get_roles", return_value=roles):
                with self.assertRaises(PermissionError) as error:
                    CustomerService.create_customer(self.details)
                self.assertEqual(error.exception.http_status_code, 403)
        self.new_doc.assert_not_called()
        self.db.exists.assert_not_called()

    def test_address_failure_rolls_back_customer(self):
        with patch.object(CustomerService, "_save_address", side_effect=frappe.ValidationError("Invalid address")):
            with self.assertRaises(frappe.ValidationError):
                CustomerService.create_customer(self.details, {"city": "Beirut"})
        self.doc.insert.assert_called_once()
        self.db.rollback.assert_called_once_with(save_point="create_customer")
        self.db.commit.assert_not_called()

    def test_duplicate_insert_error_is_clean_and_rolled_back(self):
        self.doc.insert.side_effect = frappe.DuplicateEntryError("Customer", "Example")
        with self.assertRaises(ValidationError) as error:
            CustomerService.create_customer(self.details)
        self.assertEqual(error.exception.code, "DUPLICATE_CUSTOMER")
        self.db.rollback.assert_called_once_with(save_point="create_customer")
        self.db.commit.assert_not_called()

    def test_detail_read_failure_does_not_commit_customer(self):
        self.read.side_effect = RuntimeError("Read failed")
        with self.assertRaises(RuntimeError):
            CustomerService.create_customer(self.details)
        self.db.rollback.assert_called_once_with(save_point="create_customer")
        self.db.commit.assert_not_called()

    def test_billing_address_is_linked_to_customer(self):
        with patch.object(CustomerService, "_billing_address", return_value=None), patch.object(frappe, "get_all", return_value=[]):
            CustomerService._save_address("CUST-0001", "Example", {"address_line1": "Main Street", "city": "Beirut", "country": "Lebanon"})
        self.new_doc.assert_called_once_with("Address")
        self.doc.append.assert_called_once_with("links", {"link_doctype": "Customer", "link_name": "CUST-0001"})
        self.assertEqual(self.doc.address_type, "Billing")
        self.assertEqual(self.doc.is_primary_address, 1)
        self.doc.save.assert_called_once_with(ignore_permissions=True)


@unittest.skipUnless(getattr(frappe.local, "site", None), "Requires an initialized ERPNext site")
class CustomerIntegrationCase(unittest.TestCase):
    def setUp(self):
        self.original_user = frappe.session.user
        frappe.set_user("Administrator")
        self.addCleanup(frappe.set_user, self.original_user)
        self.addCleanup(frappe.db.rollback)
        self.enterContext(patch.object(frappe.db, "commit"))
        token = frappe.generate_hash(length=10)
        user = frappe.get_doc({
            "doctype": "User", "email": f"zztest-customer-{token}@example.com",
            "first_name": "ZZTEST Customer Creation", "send_welcome_email": 0,
            "roles": [{"role": "MSP System Admin"}],
        }).insert(ignore_permissions=True)
        frappe.set_user(user.name)
        self.details = {
            "customer_name": f"ZZTEST Customer {token}", "customer_type": "Company",
            "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
            "territory": frappe.db.get_value("Territory", {}, "name"),
        }
        self.address = {
            "address_line1": "Test street", "city": "Beirut",
            "country": frappe.db.get_value("Country", {}, "name"),
        }



class TestCustomerCreationIntegration(CustomerIntegrationCase):
    def test_admin_creates_customer_address_and_list_entry(self):
        from nexgen_msp.api.internal.services.contract_service import ContractService

        result = CustomerService.create_customer(self.details, self.address)
        self.assertTrue(frappe.db.exists("Customer", result["name"]))
        self.assertEqual(result["counts"], {"users": 0, "devices": 0, "contracts": 0})
        address = frappe.get_doc("Address", result["address"]["name"])
        self.assertTrue(any(link.link_doctype == "Customer" and link.link_name == result["name"] for link in address.links))
        self.assertIn(result["name"], [row.customer for row in ContractService.list_contracts()])
        with self.assertRaises(ValidationError):
            CustomerService.create_customer(self.details)

    def test_invalid_address_leaves_no_customer(self):
        with self.assertRaises(frappe.ValidationError):
            CustomerService.create_customer(self.details, {**self.address, "country": "ZZTEST nonexistent country"})
        self.assertFalse(frappe.db.exists("Customer", {"customer_name": self.details["customer_name"]}))
