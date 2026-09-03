"""What each kind of account may reach, screen by screen.

The application serves two audiences on the same paths. This walks every listing either of
them can open and asserts, for all four roles, that it answers or refuses — so a page that
starts serving the wrong audience fails here rather than in front of a customer.
"""

import frappe

from nexgen_msp.api.core.services.session_service import SessionService
from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.api.internal.services.customer_service import CustomerService
from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.team_service import TeamService
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import NotFoundError, ValidationError

from .base import MSPTestCase

ADMIN = "MSP System Admin"
TECH = "MSP Technician"
MANAGER = "MSP Customer Manager"
OPERATOR = "MSP Customer Operator"


class TestWhatEachAudienceReaches(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.accounts = {
            ADMIN: self.make_account("internal", ADMIN, suffix="adm"),
            TECH: self.make_account("internal", TECH, suffix="tec"),
            MANAGER: self.make_account("customer", MANAGER, self.customer, suffix="mgr"),
            OPERATOR: self.make_account("customer", OPERATOR, self.customer, suffix="ope"),
        }

    def reaches(self, email, call):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            call()
            return True
        except NotFoundError:
            # the guard let them through; the record simply is not there
            return True
        except ValidationError:
            # refused, whether for lacking the right or for not belonging to a customer
            return False
        finally:
            frappe.set_user("Administrator")

    def assert_reach(self, call, allowed, label):
        for role, email in self.accounts.items():
            self.assertEqual(
                self.reaches(email, call), role in allowed, f"{label} / {role}"
            )

    # ------------------------------------------------------------ our workspace
    def test_the_internal_listings_answer_staff_only(self):
        staff = {ADMIN, TECH}

        self.assert_reach(lambda: RequestService.list_requests(page_length=1), staff, "requests")
        self.assert_reach(lambda: UserService.list_users(page_length=1), staff, "users")
        self.assert_reach(lambda: DeviceService.list_devices(page_length=1), staff, "devices")

    def test_the_commercial_screens_answer_administrators_only(self):
        self.assert_reach(
            lambda: TeamService.list_members(), {ADMIN}, "accounts"
        )
        self.assert_reach(lambda: CustomerService.options(), {ADMIN}, "customers")
        self.assert_reach(
            lambda: BillingService.list_runs(page_length=1), {ADMIN}, "billing runs"
        )

    # --------------------------------------------------------- the customer side
    def test_the_portal_listings_answer_both_customer_roles(self):
        both = {MANAGER, OPERATOR}

        self.assert_reach(
            lambda: PortalService.list_client_users(page_length=1), both, "portal users"
        )
        self.assert_reach(
            lambda: PortalService.list_devices(page_length=1), both, "portal devices"
        )
        self.assert_reach(
            lambda: PortalService.list_requests(page_length=1), both, "portal requests"
        )
        self.assert_reach(
            lambda: PortalService.list_catalogue(), both, "portal catalogue"
        )

    def test_the_invoices_answer_the_manager_only(self):
        self.assert_reach(
            lambda: PortalService.list_billing(), {MANAGER}, "portal billing"
        )
        # an administrator may reach it from here too; a technician has no billing
        # screen internally and must not find a way round that through the portal door
        self.assert_reach(
            lambda: PortalService.download_invoice("x"), {MANAGER, ADMIN}, "invoice pdf"
        )

    def test_the_session_tells_each_screen_which_audience_it_serves(self):
        for role, email in self.accounts.items():
            frappe.set_user(email)
            frappe.clear_cache(user=email)
            context = SessionService.get_session_context()
            frappe.set_user("Administrator")

            internal = role in (ADMIN, TECH)

            self.assertEqual(context["is_internal_user"], internal, role)
            self.assertEqual(context["is_portal_user"], not internal, role)
            self.assertEqual(context["can_see_invoices"], role != OPERATOR, role)

    def test_a_customer_never_sees_another_customer_anywhere(self):
        other = self.make_customer("B")
        stranger = self.make_person(other, "Stranger")

        for role in (MANAGER, OPERATOR):
            email = self.accounts[role]

            self.assertFalse(
                self.reaches(email, lambda: PortalService.list_client_users(customer=other)), role
            )
            self.assertFalse(
                self.reaches(email, lambda: PortalService.get_user_detail(stranger)), role
            )

    def test_the_catalogue_offers_everything_and_says_what_is_covered(self):
        """Asking is not ordering: a customer with no contract can still raise a request.

        What the contract covers is reported, not enforced — so whoever reviews the request
        knows a rate has to be agreed before that line can be delivered.
        """
        mine = self.make_service("X", scope="User")

        frappe.set_user(self.accounts[MANAGER])
        offered = PortalService.list_catalogue()
        frappe.set_user("Administrator")

        names = {row["name"] for row in offered["items"]}
        every_service = set(
            frappe.get_all("Item", filters={"disabled": 0, "is_stock_item": 0}, pluck="name")
        )

        self.assertEqual(names, every_service)
        self.assertIn(mine, names)

        covered = set(
            frappe.db.sql_list(
                """
                select distinct cs.service_item
                from `tabMSP Contract` c
                join `tabMSP Contract Service` cs on cs.parent = c.name
                where c.customer = %(customer)s and c.status in ('Active', 'Suspended')
                """,
                {"customer": self.customer},
            )
        )

        self.assertEqual({row["name"] for row in offered["items"] if row["covered"]}, covered)
        self.assertEqual(offered["covered"], len(covered))

    def test_a_customer_with_no_contract_is_still_offered_services(self):
        frappe.set_user(self.accounts[OPERATOR])
        offered = PortalService.list_catalogue()
        frappe.set_user("Administrator")

        self.assertGreater(offered["count"], 0)
        self.assertEqual(offered["covered"], 0)
        self.assertTrue(all(row["covered"] == 0 for row in offered["items"]))
