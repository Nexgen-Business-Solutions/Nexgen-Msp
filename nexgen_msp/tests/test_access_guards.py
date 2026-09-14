"""Security boundaries which must hold below the React route guards."""

from unittest.mock import patch

import frappe
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from nexgen_msp.api.core.services.session_service import SessionService
from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.api.internal.services.request_service import ADMIN_ROLES
from nexgen_msp.utils import access, gatekeeper
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase


SENSITIVE_DOCTYPES = (
    "MSP Client User",
    "MSP Managed Device",
    "MSP Service Request",
    "MSP Service Assignment",
)


class RequestContextMixin:
    def setUp(self):
        super().setUp()
        self._had_request = hasattr(frappe.local, "request")
        self._kept_request = getattr(frappe.local, "request", None)

    def tearDown(self):
        if self._had_request:
            frappe.local.request = self._kept_request
        elif hasattr(frappe.local, "request"):
            del frappe.local.request

        super().tearDown()

    def at(self, path, method="GET"):
        frappe.local.request = Request(
            EnvironBuilder(path=path, method=method).get_environ()
        )


class TestTwoFactorApiGate(RequestContextMixin, MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.staff = self.make_account(
            "internal", "MSP Technician", suffix=f"2f{self.tag}"
        )

    def as_staff(self):
        frappe.set_user(self.staff)
        frappe.clear_cache(user=self.staff)

    def test_the_server_guard_is_wired_before_dispatch(self):
        hooks = frappe.get_hooks("before_request")

        self.assertIn("nexgen_msp.utils.gatekeeper.require_two_factor", hooks)
        self.assertLess(
            hooks.index("nexgen_msp.utils.gatekeeper.require_two_factor"),
            hooks.index("nexgen_msp.utils.gatekeeper.guard"),
        )

    def test_an_ungated_session_cannot_call_application_data(self):
        self.as_staff()
        self.at("/api/method/nexgen_msp.api.internal.endpoints.v1.list_requests")

        # The import is intentionally lazy in the guard, so patch its source directly.
        with patch(
            "nexgen_msp.api.two_factor.services.two_factor_service."
            "TwoFactorService.gate_passed",
            return_value=False,
        ):
            with self.assertRaises(frappe.PermissionError):
                gatekeeper.require_two_factor()

    def test_an_ungated_session_cannot_use_the_generic_document_api(self):
        self.as_staff()
        self.at("/api/resource/MSP%20Service%20Assignment")

        with patch(
            "nexgen_msp.api.two_factor.services.two_factor_service."
            "TwoFactorService.gate_passed",
            return_value=False,
        ):
            with self.assertRaises(frappe.PermissionError):
                gatekeeper.require_two_factor()

    def test_a_session_that_passed_may_call_both_protected_surfaces(self):
        self.as_staff()

        with patch(
            "nexgen_msp.api.two_factor.services.two_factor_service."
            "TwoFactorService.gate_passed",
            return_value=True,
        ):
            for path in (
                "/api/method/nexgen_msp.api.portal.endpoints.v1.list_requests",
                "/api/resource/MSP%20Service%20Request",
                "/api/v2/document/MSP%20Client%20User",
            ):
                self.at(path)
                gatekeeper.require_two_factor()

    def test_login_setup_and_session_bootstrap_remain_reachable(self):
        self.as_staff()
        paths = (
            "/api/method/nexgen_msp.api.auth.endpoints.v1.pre_login",
            "/api/method/nexgen_msp.api.auth.endpoints.v1.complete_login",
            "/api/method/nexgen_msp.api.two_factor.endpoints.v1.start_two_factor_setup",
            "/api/method/nexgen_msp.api.two_factor.endpoints.v1.verify_two_factor_setup",
            "/api/method/nexgen_msp.api.two_factor.endpoints.v1.verify_two_factor",
            "/api/method/nexgen_msp.api.core.endpoints.v1.get_session_context",
            "/api/method/nexgen_msp.api.core.endpoints.v1.get_csrf_token",
            "/api/method/logout",
            "/api/method/frappe.auth.get_logged_user",
        )

        with patch(
            "nexgen_msp.api.two_factor.services.two_factor_service."
            "TwoFactorService.gate_passed",
            side_effect=AssertionError("an exempt call must not consult the gate"),
        ):
            for path in paths:
                self.at(path, method="POST")
                gatekeeper.require_two_factor()

    def test_a_guest_reaches_login_and_authentication_still_belongs_to_the_endpoint(self):
        frappe.set_user("Guest")
        self.at("/api/method/nexgen_msp.api.internal.endpoints.v1.list_requests")

        with patch(
            "nexgen_msp.api.two_factor.services.two_factor_service."
            "TwoFactorService.gate_passed",
            side_effect=AssertionError("guest calls must not consult a session gate"),
        ):
            gatekeeper.require_two_factor()


class TestMspAdministrativeAuthority(MSPTestCase):
    def make_system_manager(self):
        email = f"zztest.system.{frappe.generate_hash(length=6)}@example.invalid"
        self._purge_account(email)
        frappe.db.commit()
        doc = frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": "ZZTEST System Manager",
                "enabled": 1,
                "send_welcome_email": 0,
                "user_type": "System User",
                "roles": [{"role": "System Manager"}],
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        return self.track("User", doc.name)

    def test_system_manager_is_not_an_msp_administrator(self):
        system_manager = self.make_system_manager()

        self.assertEqual(ADMIN_ROLES, ("MSP System Admin", "Administrator"))
        frappe.set_user(system_manager)
        frappe.clear_cache(user=system_manager)
        try:
            with self.assertRaises(ValidationError):
                ContractService._guard_admin()
            self.assertFalse(SessionService.get_session_context()["is_internal_user"])
        finally:
            frappe.set_user("Administrator")

    def test_a_customer_contact_with_an_admin_role_is_still_refused(self):
        tag = frappe.generate_hash(length=6)
        customer = self.make_customer(tag)
        manager = self.make_account(
            "customer", "MSP Customer Manager", customer, suffix=f"ba{tag}"
        )
        account = frappe.get_doc("User", manager)
        account.append("roles", {"role": "MSP System Admin"})
        account.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.clear_cache(user=manager)

        frappe.set_user(manager)
        try:
            with self.assertRaises(ValidationError):
                ContractService._guard_admin()
        finally:
            frappe.set_user("Administrator")


class TestRawDocumentBoundary(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"r{self.tag}"
        )
        self.staff = self.make_account(
            "internal", "MSP Technician", suffix=f"s{self.tag}"
        )

    def test_each_sensitive_doctype_uses_both_permission_hooks(self):
        document_hooks = frappe.get_hooks("has_permission")
        query_hooks = frappe.get_hooks("permission_query_conditions")

        for doctype in SENSITIVE_DOCTYPES:
            self.assertIn("nexgen_msp.utils.access.has_raw_msp_permission", document_hooks[doctype])
            self.assertIn("nexgen_msp.utils.access.raw_msp_query_condition", query_hooks[doctype])

    def test_customer_contacts_are_refused_even_if_an_internal_role_is_added(self):
        account = frappe.get_doc("User", self.manager)
        account.append("roles", {"role": "MSP System Admin"})
        account.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.clear_cache(user=self.manager)

        for doctype in SENSITIVE_DOCTYPES:
            doc = frappe.get_doc({"doctype": doctype})
            self.assertFalse(
                access.has_raw_msp_permission(doc, "read", self.manager), doctype
            )
            self.assertEqual(access.raw_msp_query_condition(self.manager), "1 = 0")

    def test_generic_lists_return_no_msp_rows_to_a_customer_contact(self):
        person = self.make_person(self.customer, "Raw hidden")
        frappe.set_user(self.manager)
        frappe.clear_cache(user=self.manager)
        try:
            rows = frappe.get_list(
                "MSP Client User", filters={"name": person}, pluck="name"
            )
            self.assertEqual(rows, [])
            self.assertFalse(
                frappe.has_permission(
                    "MSP Client User",
                    "read",
                    doc=frappe.get_doc("MSP Client User", person),
                )
            )
        finally:
            frappe.set_user("Administrator")

    def test_a_customer_cannot_insert_through_the_document_model(self):
        frappe.set_user(self.manager)
        frappe.clear_cache(user=self.manager)
        try:
            doc = frappe.get_doc(
                {
                    "doctype": "MSP Client User",
                    "customer": self.customer,
                    "full_name": "ZZTEST Raw bypass",
                    "lifecycle_status": "Active",
                }
            )
            with self.assertRaises(frappe.PermissionError):
                doc.insert()
            frappe.db.rollback()
        finally:
            frappe.set_user("Administrator")

    def test_staff_keep_the_doctype_permissions_their_role_grants(self):
        for user in (self.staff, "Administrator"):
            for doctype in SENSITIVE_DOCTYPES:
                self.assertTrue(
                    access.has_raw_msp_permission(
                        frappe.get_doc({"doctype": doctype}), "read", user
                    ),
                    f"{user} / {doctype}",
                )
                self.assertIsNone(access.raw_msp_query_condition(user))
