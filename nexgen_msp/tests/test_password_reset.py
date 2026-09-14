"""Forgotten password: an address with no account is told so, one with an account gets its link."""

import frappe

from nexgen_msp.api.auth.services.auth_service import AuthService
from nexgen_msp.utils.errors import NotFoundError

from .base import MSPTestCase


class TestForgottenPassword(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.account = self.make_account("customer", "MSP Customer Manager", self.customer, suffix=f"pr{self.tag[:3]}")

    def test_an_address_with_no_account_is_told_so(self):
        with self.assertRaises(NotFoundError) as caught:
            AuthService.request_password_reset(user=f"nobody.{self.tag}@example.invalid")

        self.assertIn("Account not found", str(caught.exception))

    def test_a_disabled_account_is_not_sent_a_link(self):
        frappe.db.set_value("User", self.account, "enabled", 0)

        with self.assertRaises(NotFoundError):
            AuthService.request_password_reset(user=self.account)

    def test_an_account_that_exists_is_sent_its_link(self):
        self.assertEqual(AuthService.request_password_reset(user=self.account), {"ok": True})
        self.assertTrue(frappe.db.get_value("User", self.account, "reset_password_key"))
