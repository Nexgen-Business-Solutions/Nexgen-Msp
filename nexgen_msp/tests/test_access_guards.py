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
    "MSP Request",
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
        """Nothing of ours reaches a customer account through Frappe's own list API.

        What is checked is the outcome, not the mechanism that produces it: the door may be
        shut outright or answer with nothing at all, and both are the same promise kept. It
        used to answer empty; since the customer DocPerms were withdrawn it refuses, which is
        the stronger of the two.
        """
        person = self.make_person(self.customer, "Raw hidden")
        frappe.set_user(self.manager)
        frappe.clear_cache(user=self.manager)
        try:
            try:
                rows = frappe.get_list(
                    "MSP Client User", filters={"name": person}, pluck="name"
                )
            except frappe.PermissionError:
                rows = []

            self.assertEqual(rows, [], "no MSP row may come back through the generic API")
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


class TestWhoMayEnterAtAll(MSPTestCase):
    """The verdict the route guard applies, and the three states that used to slip past it.

    Signed in was taken for allowed in, so an account holding no role of ours, one belonging
    to a company it has no permission for, and one holding both sides at once all reached the
    application and were then refused by every call it made. The first and the last read as
    neither side, so the layout fell through to the staff screens.
    """

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.acme = self.make_customer(self.tag)
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.acme, suffix=f"ea{self.tag[:3]}"
        )
        self.technician = self.make_account(
            "internal", "MSP Technician", suffix=f"et{self.tag[:3]}"
        )

    def unpermit(self, user):
        for row in frappe.get_all("User Permission", filters={"user": user}, pluck="name"):
            frappe.delete_doc("User Permission", row, force=True, ignore_permissions=True)

        frappe.db.commit()
        frappe.clear_cache(user=user)

    def give(self, user, role):
        doc = frappe.get_doc("User", user)
        doc.append("roles", {"role": role})
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.clear_cache(user=user)

    def strip(self, user):
        doc = frappe.get_doc("User", user)
        doc.roles = [row for row in doc.roles if not row.role.startswith("MSP ")]
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.clear_cache(user=user)

    def code_for(self, user):
        return access.entry(user)["code"]

    def test_a_contact_and_a_permission_are_not_a_role(self):
        """Being bound to a company says which company, never that the account may be here.

        An account whose role was taken away keeps its contact record and its permission
        until somebody clears them, and that pair used to be read as enough on its own.
        """
        self.strip(self.manager)

        self.assertTrue(access.declared_customers(self.manager) or access.permitted_customers(self.manager))
        self.assertFalse(access.entry(self.manager)["ok"])
        self.assertEqual(self.code_for(self.manager), access.NO_ROLE)

    def test_our_own_people_and_a_company_person_both_get_in(self):
        for user in (self.technician, self.manager, "Administrator"):
            self.assertTrue(access.entry(user)["ok"], user)
            self.assertIsNone(self.code_for(user), user)

    def test_the_builtin_administrator_is_not_read_as_holding_both_sides(self):
        """It carries every role on this site, customer ones included, and still runs it."""
        self.assertIn("MSP Customer Manager", access.roles("Administrator"))
        self.assertTrue(access.entry("Administrator")["ok"])

    def test_an_account_with_no_role_of_ours_is_refused_rather_than_shown_our_screens(self):
        self.strip(self.technician)

        self.assertEqual(self.code_for(self.technician), access.NO_ROLE)

    def test_a_company_person_whose_permission_is_gone_is_refused_by_name(self):
        self.unpermit(self.manager)

        self.assertEqual(access.allowed_customers(self.manager), [], "reaches no company")
        self.assertEqual(self.code_for(self.manager), access.NO_CUSTOMER)

    def test_holding_both_sides_is_named_as_the_conflict_it_is(self):
        self.give(self.manager, "MSP Technician")

        self.assertEqual(self.code_for(self.manager), access.CONFLICTING_ROLES)

    def test_the_conflict_is_said_before_the_missing_permission(self):
        """Both apply at once, and the one somebody has to undo is the one worth saying."""
        self.give(self.manager, "MSP Technician")
        self.unpermit(self.manager)

        self.assertEqual(self.code_for(self.manager), access.CONFLICTING_ROLES)

    def test_a_company_binding_on_one_of_ours_is_the_same_conflict(self):
        """Read the other way round: the staff role came first and the binding was added."""
        from nexgen_msp.utils import permissions

        permissions.ensure_customer_contact(frappe.get_doc("User", self.technician), self.acme)
        frappe.db.commit()
        frappe.clear_cache(user=self.technician)

        self.assertEqual(self.code_for(self.technician), access.CONFLICTING_ROLES)

    def test_a_signed_out_caller_is_told_that_and_not_blamed_for_a_role(self):
        self.assertEqual(self.code_for("Guest"), access.NOT_SIGNED_IN)

    def test_every_refusal_carries_something_to_read(self):
        self.unpermit(self.manager)
        self.strip(self.technician)

        for user in ("Guest", self.manager, self.technician):
            verdict = access.entry(user)

            self.assertFalse(verdict["ok"], user)
            self.assertTrue(verdict["code"], user)
            self.assertTrue(verdict["message"], user)

    def test_a_system_manager_with_no_msp_role_is_still_refused_the_application(self):
        """The desk is theirs; ours is not. The two answers are separate on purpose."""
        self.strip(self.technician)
        self.give(self.technician, access.SYSTEM_ROLE)

        self.assertEqual(self.code_for(self.technician), access.NO_ROLE)
