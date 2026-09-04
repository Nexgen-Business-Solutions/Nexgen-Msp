"""What a customer account can reach, and what it must never reach."""

import frappe

from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import permissions
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase


class TestPortalScope(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.mine = self.make_customer("A")
        self.theirs = self.make_customer("B")
        self.my_person = self.make_person(self.mine, "Mine")
        self.their_person = self.make_person(self.theirs, "Theirs")
        self.manager = self.make_account("customer", "MSP Customer Manager", self.mine)

    def as_manager(self, fn):
        frappe.set_user(self.manager)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def test_a_contact_sees_only_its_own_company(self):
        rows = self.as_manager(lambda: PortalService.list_client_users(page_length=500))["rows"]
        seen = {row["customer"] for row in rows}

        self.assertEqual(seen, {self.mine})

    def test_asking_for_another_company_is_refused(self):
        with self.assertRaises(ValidationError):
            self.as_manager(lambda: PortalService.list_client_users(customer=self.theirs))

    def test_opening_someone_of_another_company_is_refused(self):
        with self.assertRaises(ValidationError):
            self.as_manager(lambda: PortalService.get_user_detail(self.their_person))

    def test_the_internal_workspace_is_closed_to_a_contact(self):
        for call in (
            lambda: UserService.list_users(page_length=5),
            lambda: DeviceService.list_devices(page_length=5),
            lambda: RequestService.list_requests(page_length=5),
        ):
            with self.assertRaises(ValidationError):
                self.as_manager(call)

    def test_a_staff_role_does_not_widen_a_contact(self):
        """The permission on a customer wins over any role handed out by mistake."""
        user = frappe.get_doc("User", self.manager)
        user.append("roles", {"role": "MSP System Admin"})
        user.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.clear_cache(user=self.manager)

        self.assertFalse(permissions.is_internal(self.manager))
        self.assertEqual(permissions.get_allowed_customers(self.manager), [self.mine])

        with self.assertRaises(ValidationError):
            self.as_manager(lambda: UserService.list_users(page_length=5))

    def test_staff_reach_every_customer(self):
        staff = self.make_account("internal", "MSP Technician", suffix="staff")

        self.assertTrue(permissions.is_internal(staff))
        self.assertEqual(
            len(permissions.get_allowed_customers(staff)), frappe.db.count("Customer")
        )


class TestInvoiceAccess(MSPTestCase):
    """A Customer Operator does everything a Customer Manager does, except the money."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix="mgr"
        )
        self.operator = self.make_account(
            "customer", "MSP Customer Operator", self.customer, suffix="ope"
        )

    def test_the_manager_reaches_the_invoices(self):
        frappe.set_user(self.manager)
        rows = PortalService.list_billing(self.customer)
        frappe.set_user("Administrator")

        self.assertIsInstance(rows, list)

    def test_the_operator_is_kept_away_from_the_invoices(self):
        frappe.set_user(self.operator)
        try:
            for call in (
                lambda: PortalService.list_billing(self.customer),
                lambda: PortalService.get_billing_detail("anything"),
                lambda: PortalService.download_invoice("anything"),
                lambda: PortalService.download_breakdown("anything"),
                lambda: PortalService.dispute_invoice("anything", "why"),
            ):
                with self.assertRaises(ValidationError):
                    call()
        finally:
            frappe.set_user("Administrator")

    def test_the_operator_keeps_everything_else(self):
        frappe.set_user(self.operator)
        people = PortalService.list_client_users(page_length=5)
        requests = PortalService.list_requests(page_length=5)
        frappe.set_user("Administrator")

        self.assertIn("rows", people)
        self.assertIn("rows", requests)

    def test_the_rule_is_read_off_the_role(self):
        self.assertTrue(permissions.may_see_invoices(self.manager))
        self.assertFalse(permissions.may_see_invoices(self.operator))


class TestWhereLinksPoint(MSPTestCase):
    """No one is ever moved between hosts; only the links we email carry the portal address."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.kept = frappe.db.get_single_value("MSP Portal Settings", "portal_url")
        frappe.db.set_value(
            "MSP Portal Settings", "MSP Portal Settings", "portal_url", "https://portal.test"
        )
        frappe.db.commit()
        frappe.clear_cache()

    def tearDown(self):
        frappe.db.set_value(
            "MSP Portal Settings", "MSP Portal Settings", "portal_url", self.kept
        )
        frappe.db.commit()
        frappe.clear_cache()
        super().tearDown()

    def test_a_customer_link_carries_the_portal_address(self):
        from nexgen_msp.utils import notifications

        moved = notifications.on_portal_host("http://internal.test/update-password?key=abc")

        self.assertTrue(moved.startswith("https://portal.test/"))
        self.assertIn("key=abc", moved)

    def test_the_reset_mail_moves_only_a_customer_link(self):
        contact = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="c")
        staff = self.make_account("internal", "MSP Technician", suffix="s")

        self.assertTrue(permissions.is_customer_contact(contact))
        self.assertFalse(permissions.is_customer_contact(staff))

    def test_nobody_is_redirected_between_hosts(self):
        """The guard moves a website user off the desk, and nothing else."""
        import inspect

        from nexgen_msp.utils import gatekeeper

        source = inspect.getsource(gatekeeper.guard)

        self.assertNotIn("portal_origin()", source)
        self.assertEqual(source.count("SeeOther"), 1)


class TestWhatACustomerTakesAway(MSPTestCase):
    """The customer's own registers, and the sheet they can take away."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.other = self.make_customer("B")
        self.person = self.make_person(self.customer, "Holder")
        self.stranger = self.make_person(self.other, "Stranger")
        self.device = self.make_device(self.customer, holder=self.person)
        self.manager = self.make_account("customer", "MSP Customer Manager", self.customer)

    def as_manager(self, fn):
        frappe.set_user(self.manager)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def test_each_person_carries_what_they_run(self):
        rows = self.as_manager(lambda: PortalService.list_client_users(page_length=200))["rows"]

        self.assertTrue(rows)
        for row in rows:
            self.assertIn("active_services", row)
            self.assertIn("inactive_services", row)
            self.assertIsInstance(row["active_services"], int)

    def test_each_machine_carries_what_it_runs(self):
        rows = self.as_manager(lambda: PortalService.list_devices(page_length=200))["rows"]

        self.assertTrue(rows)
        for row in rows:
            self.assertIn("active_services", row)
            self.assertIn("inactive_services", row)

    def test_the_export_takes_every_row_not_only_the_page(self):
        from nexgen_msp.api.portal.endpoints import v1

        rows = self.as_manager(lambda: v1._all_rows(PortalService.list_client_users))
        total = self.as_manager(lambda: PortalService.list_client_users(page_length=1))["total"]

        self.assertEqual(len(rows), total)

    def test_the_export_never_reaches_another_customer(self):
        from nexgen_msp.api.portal.endpoints import v1

        rows = self.as_manager(lambda: v1._all_rows(PortalService.list_client_users))
        names = {row["name"] for row in rows}

        self.assertNotIn(self.stranger, names)
        self.assertEqual({row["customer"] for row in rows}, {self.customer})
