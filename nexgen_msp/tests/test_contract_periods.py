"""A contract carries services over a stretch of time, and no two contracts share a day.

The same service may be on one contract for 2026 and on the next for 2027. It may not be on
two contracts over the same days, or nobody could say which one a month of it was billed
under. Everything that asks "which contract" — opening a service, pricing it, offering it to
the customer — asks it for a day.
"""

import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase


class ContractCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.m365 = self.make_service(f"CP{self.tag[:3]}")
        self.sophos = self.make_service(f"CQ{self.tag[:3]}")
        self.price_list = frappe.db.get_value(
            "Price List", {"selling": 1, "enabled": 1}, ["name", "currency"], as_dict=True
        )

    def contract(self, start, end, services, status="Active", price_list=None):
        doc = frappe.get_doc(
            {
                "doctype": "MSP Contract",
                "customer": self.customer,
                "title": f"ZZTEST {self.tag} {start}",
                "status": status,
                "start_date": start,
                "end_date": end,
                "billing_frequency": "Monthly",
                "billing_timing": "In Arrears",
                "proration_method": "Daily Actual Days",
                "invoice_grouping": "One Invoice",
                "price_list": price_list or self.price_list.name,
                "currency": self.price_list.currency,
                "services": [{"service_item": service} for service in services],
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()

        return self.track("MSP Contract", doc.name)


class TestTheSameServiceOverTheSameDays(ContractCase):
    def test_two_contracts_cannot_cover_it_over_overlapping_dates(self):
        self.contract("2026-01-01", "2026-12-31", [self.m365])

        with self.assertRaises(frappe.ValidationError) as caught:
            self.contract("2026-06-01", "2027-05-31", [self.m365])

        self.assertIn("overlaps", str(caught.exception))

    def test_one_after_the_other_is_fine(self):
        self.contract("2026-01-01", "2026-06-30", [self.m365])
        self.contract("2026-07-01", "2026-12-31", [self.m365])

    def test_a_contract_with_no_end_runs_for_ever(self):
        self.contract("2026-01-01", None, [self.m365])

        with self.assertRaises(frappe.ValidationError):
            self.contract("2030-01-01", "2030-12-31", [self.m365])

    def test_different_services_over_the_same_days_are_fine(self):
        self.contract("2026-01-01", "2026-12-31", [self.m365])
        self.contract("2026-01-01", "2026-12-31", [self.sophos])

    def test_a_draft_may_overlap_while_it_is_prepared(self):
        self.contract("2026-01-01", "2026-12-31", [self.m365])
        self.contract("2026-06-01", "2026-11-30", [self.m365], status="Draft")

    def test_but_it_cannot_go_live_until_the_dates_are_fixed(self):
        self.contract("2026-01-01", "2026-12-31", [self.m365])
        draft = self.contract("2026-06-01", "2026-11-30", [self.m365], status="Draft")

        doc = frappe.get_doc("MSP Contract", draft)
        doc.status = "Active"

        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

    def test_moving_the_dates_of_a_live_one_onto_another_is_refused(self):
        self.contract("2026-01-01", "2026-06-30", [self.m365])
        later = self.contract("2026-07-01", "2026-12-31", [self.m365])

        doc = frappe.get_doc("MSP Contract", later)
        doc.start_date = "2026-06-15"

        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)


class TestWhichContractHoldsOnADay(ContractCase):
    def setUp(self):
        super().setUp()
        today = frappe.utils.getdate(frappe.utils.today())
        self.this_year = self.contract(
            frappe.utils.add_days(today, -100), frappe.utils.add_days(today, 30), [self.m365]
        )
        self.next_one = self.contract(
            frappe.utils.add_days(today, 31), frappe.utils.add_days(today, 400), [self.m365]
        )
        self.today = today

    def test_opening_a_service_today_finds_this_year_s_contract(self):
        title = frappe.db.get_value("MSP Contract", self.this_year, "title")

        self.assertEqual(ServiceLifecycleService._contract(self.customer, self.m365, self.today), title)

    def test_opening_it_next_year_finds_the_next_one(self):
        title = frappe.db.get_value("MSP Contract", self.next_one, "title")
        later = frappe.utils.add_days(self.today, 60)

        self.assertEqual(ServiceLifecycleService._contract(self.customer, self.m365, later), title)

    def test_a_day_no_contract_covers_is_refused_and_says_so(self):
        before = frappe.utils.add_days(self.today, -200)

        with self.assertRaises(ValidationError) as caught:
            ServiceLifecycleService._contract(self.customer, self.m365, before)

        self.assertIn("does not cover", str(caught.exception))

    def test_the_price_list_is_the_one_of_the_contract_holding_that_day(self):
        other = frappe.get_doc(
            {
                "doctype": "Price List",
                "price_list_name": f"ZZTEST Next {self.tag}",
                "selling": 1,
                "enabled": 1,
                "currency": self.price_list.currency,
            }
        ).insert(ignore_permissions=True)
        self.track("Price List", other.name)
        frappe.db.set_value("MSP Contract", self.next_one, "price_list", other.name)
        frappe.db.commit()

        self.assertEqual(
            ContractService._price_list(self.customer, self.m365, self.today), self.price_list.name
        )
        self.assertEqual(
            ContractService._price_list(self.customer, self.m365, frappe.utils.add_days(self.today, 60)),
            other.name,
        )


class TestWhatTheCustomerIsOffered(ContractCase):
    def test_a_contract_that_has_not_started_offers_nothing_yet(self):
        today = frappe.utils.getdate(frappe.utils.today())
        self.contract(frappe.utils.add_days(today, 10), frappe.utils.add_days(today, 300), [self.m365])

        offered = [row["name"] for row in PortalService.list_catalogue(customer=self.customer)["items"]]

        self.assertNotIn(self.m365, offered)

    def test_a_contract_running_today_offers_its_services(self):
        today = frappe.utils.getdate(frappe.utils.today())
        self.contract(frappe.utils.add_days(today, -10), frappe.utils.add_days(today, 300), [self.m365])

        offered = [row["name"] for row in PortalService.list_catalogue(customer=self.customer)["items"]]

        self.assertIn(self.m365, offered)
