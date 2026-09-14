"""The arithmetic an invoice rests on, and the deployment steps it depends on."""

import frappe

from nexgen_msp.api.internal.services.billing_service import DAY_BLOCK, BillingService
from nexgen_msp.utils import currency_setup, permissions, seeds

from .base import MSPTestCase


class TestBillingArithmetic(MSPTestCase):
    def test_days_are_billed_in_blocks_of_five(self):
        cases = {1: 5, 3: 5, 5: 5, 6: 10, 11: 15, 14: 15, 15: 15, 16: 20}

        for days, expected in cases.items():
            self.assertEqual(
                BillingService._billed_days(days, 30), expected, f"{days} days"
            )

    def test_a_service_that_never_ran_is_billed_nothing(self):
        self.assertEqual(BillingService._billed_days(0, 30), 0)
        self.assertEqual(BillingService._billed_days(-4, 30), 0)

    def test_a_full_month_is_never_more_than_a_month(self):
        for days_in_month in (28, 29, 30, 31):
            self.assertEqual(
                BillingService._billed_days(days_in_month, days_in_month), days_in_month
            )

    def test_the_block_is_five(self):
        self.assertEqual(DAY_BLOCK, 5)


class TestAPartialMonthOnThirtyDays(MSPTestCase):
    """Rounded to five-day blocks, out of thirty, whatever the calendar says."""

    def months(self, start, end, period_start, period_end, method="30-Day Convention"):
        assignment = frappe._dict(effective_start_date=start, effective_end_date=end, name=None)

        return BillingService._billable_months(method, assignment, period_start, period_end, [])[0]

    def test_the_examples_agreed(self):
        cases = {
            1: 0.167,
            5: 0.167,
            6: 0.333,
            13: 0.5,
            16: 0.667,
            28: 1.0,
        }

        for days, expected in cases.items():
            end = frappe.utils.add_days("2026-07-01", days - 1)
            self.assertEqual(
                self.months("2026-07-01", end, "2026-07-01", "2026-07-31"), expected, f"{days} days"
            )

    def test_thirteen_days_are_half_a_month_in_a_month_of_thirty_one(self):
        self.assertEqual(self.months("2026-07-19", None, "2026-07-01", "2026-07-31"), 0.5)

    def test_and_in_february_too(self):
        self.assertEqual(self.months("2026-02-16", None, "2026-02-01", "2026-02-28"), 0.5)

    def test_a_full_month_is_one_month_whatever_its_length(self):
        for start, end in (("2026-07-01", "2026-07-31"), ("2026-02-01", "2026-02-28")):
            self.assertEqual(self.months(start, None, start, end), 1.0)

    def test_several_months_are_rounded_one_by_one_then_added(self):
        # 13 days of June, all of July, 6 days of August
        self.assertEqual(
            self.months("2026-06-18", "2026-08-06", "2026-06-01", "2026-08-31"),
            round(0.5 + 1.0 + 10 / 30, 3),
        )

    def test_a_new_contract_bills_on_thirty_days(self):
        self.assertEqual(
            frappe.get_meta("MSP Contract").get_field("proration_method").default,
            "30-Day Convention",
        )


class TestDeploymentSteps(MSPTestCase):
    """What a fresh site must end up with, whatever order it was set up in."""

    def test_the_billing_unit_exists_and_allows_a_half(self):
        self.assertTrue(frappe.db.exists("UOM", "Month"))
        self.assertFalse(frappe.db.get_value("UOM", "Month", "must_be_whole_number"))

    def test_the_actions_a_customer_may_ask_for_are_seeded(self):
        self.assertGreater(frappe.db.count("MSP Request Action"), 0)

    def test_the_invoice_carries_an_issuer(self):
        self.assertTrue(
            (frappe.db.get_single_value("MSP Invoice Settings", "issuer_name") or "").strip()
        )

    def test_running_the_seeds_again_changes_nothing(self):
        before = (
            frappe.db.count("MSP Request Action"),
            frappe.db.get_value("UOM", "Month", "must_be_whole_number"),
        )
        seeds.ensure_seeds()
        after = (
            frappe.db.count("MSP Request Action"),
            frappe.db.get_value("UOM", "Month", "must_be_whole_number"),
        )

        self.assertEqual(before, after)

    def test_the_currency_setup_is_done_once(self):
        currency_setup.ensure_currency_settings()

        self.assertTrue(frappe.db.get_default(currency_setup.MARKER))

    def test_permissions_and_contacts_agree(self):
        """The sweep that runs at every deployment must leave nothing adrift."""
        permissions.reconcile_all_customer_permissions()

        for user in frappe.db.sql_list(
            """
            select distinct c.user from `tabContact` c
            join `tabDynamic Link` dl on dl.parent = c.name
            where ifnull(c.user, '') != '' and dl.link_doctype = 'Customer'
            """
        ):
            declared = permissions.customers_from_contacts(user)
            held = set(
                frappe.get_all(
                    "User Permission", filters={"user": user, "allow": "Customer"}, pluck="for_value"
                )
            )

            self.assertEqual(declared, held, f"{user} is adrift")
