"""A billing run is financial history: read it in five years and it says the same thing.

Two rules carry the whole of it. What was billed is what was written when the run was drawn,
never what the operational records happen to say today. And what somebody chose to bill is a
decision, which no recalculation may quietly undo.

A device service belongs to the machine. Whoever was carrying that machine is context on the
invoice, never the party billed, and a transfer in September rewrites nothing about August.
"""

import zlib

import frappe
from frappe.utils import add_days, flt, getdate

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.utils import device_holders as holders
from nexgen_msp.utils.errors import ValidationError as ServiceRefused

from .base import MSPTestCase


class BillingHistoryCase(MSPTestCase):
    RATE = 20.0

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.john = self.make_person(self.customer, "John", department="Accounting")
        self.today = frappe.utils.today()
        self.contract = None
        self.price_list = None
        self.currency = None

    # ------------------------------------------------------------------ fixtures
    def days_ago(self, days):
        return frappe.utils.add_days(self.today, -days)

    def selling_price_list(self):
        if self.price_list:
            return self.price_list, self.currency

        row = frappe.db.get_value(
            "Price List", {"selling": 1, "enabled": 1}, ["name", "currency"], as_dict=True
        )
        self.price_list, self.currency = row.name, row.currency

        return self.price_list, self.currency

    def cover(self, service, rate=None, valid_from=None, valid_upto=None):
        price_list, currency = self.selling_price_list()
        existing = frappe.db.get_value("MSP Contract", {"customer": self.customer}, "name")

        doc = (
            frappe.get_doc("MSP Contract", existing)
            if existing
            else frappe.get_doc(
                {
                    "doctype": "MSP Contract",
                    "customer": self.customer,
                    "status": "Active",
                    "start_date": self.days_ago(1200),
                    "billing_frequency": "Monthly",
                    "billing_timing": "In Arrears",
                    "proration_method": "Daily Actual Days",
                    "invoice_grouping": "One Invoice",
                    "price_list": price_list,
                    "currency": currency,
                }
            )
        )

        if not any(row.service_item == service for row in doc.services):
            doc.append("services", {"service_item": service})

        doc.save(ignore_permissions=True)
        self.track("MSP Contract", doc.name)
        self.contract = doc.name

        self.price(service, rate if rate is not None else self.RATE, valid_from, valid_upto)
        frappe.db.commit()

        return doc.name

    def price(self, service, rate, valid_from=None, valid_upto=None):
        price_list, currency = self.selling_price_list()
        doc = frappe.get_doc(
            {
                "doctype": "Item Price",
                "item_code": service,
                "price_list": price_list,
                "customer": self.customer,
                "selling": 1,
                "buying": 0,
                "currency": currency,
                "price_list_rate": rate,
                "valid_from": valid_from or self.days_ago(1200),
                "valid_upto": valid_upto,
            }
        ).insert(ignore_permissions=True)

        return self.track("Item Price", doc.name)

    def offering(self, suffix, scope="User", **rate):
        service = self.make_service(f"{suffix}{self.tag[:3]}", scope=scope)
        self.cover(service, **rate)

        return service

    def laptop(self, hostname, holder=None, since=-800, serial=None):
        device = self.make_device(
            self.customer, hostname=f"{hostname}{self.tag[:3]}", serial=serial
        )

        if holder:
            doc = frappe.get_doc("MSP Managed Device", device)
            holders.hand_over(doc, holder, on_date=self.days_ago(-since))
            doc.status = "Active"
            doc.save(ignore_permissions=True)
            frappe.db.commit()

        return device

    def running(self, service, scope="User", started=-800, **target):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope=scope,
            effective_date=self.days_ago(-started),
            **target,
        )
        frappe.db.commit()

        return self.track("MSP Service Assignment", outcome["name"])

    def month(self, back=None):
        """A whole calendar month that has already gone by, this test's own.

        Every method bills a different month. Two runs of the same period on the same
        assignment are refused by design, and these tests run side by side.
        """
        if back is None:
            back = 1 + zlib.crc32(self._testMethodName.encode()) % 10

        anchor = frappe.utils.add_months(getdate(self.today), -back)
        first = anchor.replace(day=1)

        return str(first), str(getdate(add_days(frappe.utils.add_months(first, 1), -1)))

    def drawn(self, include=None, **period):
        start, end = period.get("start"), period.get("end")
        out = BillingService.generate(
            contract=self.contract, period_start=start, period_end=end, include=include
        )

        return self.track("MSP Billing Run", out["name"])

    def lines_of(self, run):
        return BillingService.get_run(run)["lines"]

    def paused(self, assignment, frm, to):
        """A pause written straight onto the record: what is under test here is the reading."""
        doc = frappe.get_doc("MSP Service Assignment", assignment)
        doc.append("suspension_log", {"suspended_on": frm, "resumed_on": to})
        doc.flags.via_service_lifecycle = True
        doc.save(ignore_permissions=True)
        frappe.db.commit()

    def unpriced(self, suffix):
        """A service on the contract that nothing prices: the run cannot value it."""
        service = self.make_service(f"{suffix}{self.tag[:3]}", scope="User")
        self.cover(service)
        assignment = self.running(service, client_user=self.john)

        for row in frappe.get_all(
            "Item Price", filters={"item_code": service, "customer": self.customer}, pluck="name"
        ):
            frappe.delete_doc("Item Price", row, force=True, ignore_permissions=True)

        frappe.db.commit()

        return assignment


class TestARunSaysWhatItSaidWhenItWasDrawn(BillingHistoryCase):
    def test_a_machine_handed_on_afterwards_never_rewrites_the_run(self):
        """Scenario A: the laptop goes to Bob in September; August still reads Alice."""
        bob = self.make_person(self.customer, "Bob")
        service = self.offering("HISTA", scope="Device")
        device = self.laptop("HISTA", holder=self.john, serial=f"SA-{self.tag}")
        self.running(service, scope="Device", managed_device=device)

        start, end = self.month()
        run = self.drawn(start=start, end=end)
        before = self.lines_of(run)[0]

        DeviceLifecycleService.transfer(device=device, client_user=bob)
        frappe.db.commit()

        after = self.lines_of(run)[0]

        self.assertEqual(before["hostname"], after["hostname"])
        self.assertEqual(after["serial_number"], f"SA-{self.tag}")
        self.assertNotIn("Bob", str(after.get("user_name") or ""))

    def test_a_device_line_is_never_attributed_to_whoever_holds_the_machine(self):
        service = self.offering("HISTB", scope="Device")
        device = self.laptop("HISTB", holder=self.john, serial=f"SB-{self.tag}")
        self.running(service, scope="Device", managed_device=device)

        start, end = self.month()
        line = self.lines_of(self.drawn(start=start, end=end))[0]

        self.assertEqual(line["managed_device"], device)
        self.assertIsNone(line["client_user"])
        self.assertIsNone(line["user_name"], "a machine's service is billed to the machine")

    def test_who_was_holding_it_is_kept_as_context(self):
        service = self.offering("HISTC", scope="Device")
        device = self.laptop("HISTC", holder=self.john, serial=f"SC-{self.tag}")
        self.running(service, scope="Device", managed_device=device)

        start, end = self.month()
        line = self.lines_of(self.drawn(start=start, end=end))[0]

        self.assertIn("ZZTEST John", line["holder_context"])

    def test_a_department_change_afterwards_never_rewrites_the_run(self):
        """Scenario B: John moves to Finance; August still reads Accounting."""
        service = self.offering("HISTD")
        self.running(service, client_user=self.john)

        start, end = self.month()
        run = self.drawn(start=start, end=end)

        self.assertEqual(
            self.lines_of(run)[0]["department"], self.make_department("Accounting")
        )

        doc = frappe.get_doc("MSP Client User", self.john)
        doc.department = self.make_department("Finance")
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        self.assertEqual(
            self.lines_of(run)[0]["department"], self.make_department("Accounting")
        )

    def test_a_service_renamed_afterwards_never_rewrites_the_run(self):
        """Scenario C: the catalogue label changes; the run keeps the one it printed."""
        service = self.offering("HISTE")
        self.running(service, client_user=self.john)

        start, end = self.month()
        run = self.drawn(start=start, end=end)
        printed = self.lines_of(run)[0]["service_name"]

        item = frappe.get_doc("Item", service)
        item.item_name = f"ZZTEST Renamed {self.tag}"
        item.save(ignore_permissions=True)
        frappe.db.commit()

        self.assertEqual(self.lines_of(run)[0]["service_name"], printed)

    def test_the_person_billed_is_named_as_they_were(self):
        service = self.offering("HISTF")
        self.running(service, client_user=self.john)

        start, end = self.month()
        line = self.lines_of(self.drawn(start=start, end=end))[0]

        self.assertEqual(line["user_name"], "ZZTEST John")
        self.assertIsNone(line["hostname"], "a personal service borrows nobody's machine")


class TestWhatWasActuallyLive(BillingHistoryCase):
    def test_the_run_says_which_stretches_were_billed(self):
        service = self.offering("SEGA")
        assignment = self.running(service, client_user=self.john)

        start, end = self.month()
        pause = str(getdate(add_days(start, 9)))
        back = str(getdate(add_days(start, 15)))

        self.paused(assignment, pause, back)

        line = self.lines_of(self.drawn(start=start, end=end))[0]

        self.assertEqual(len(line["segments"]), 2, "a paused month was live twice")
        self.assertEqual(line["segments"][0]["from"], str(getdate(start)))
        self.assertLess(line["segments"][0]["to"], pause)
        self.assertEqual(line["segments"][1]["to"], str(getdate(end)))

    def test_an_uninterrupted_month_is_one_stretch(self):
        service = self.offering("SEGB")
        self.running(service, client_user=self.john)

        start, end = self.month()
        line = self.lines_of(self.drawn(start=start, end=end))[0]

        self.assertEqual(line["segments"], [{"from": str(getdate(start)), "to": str(getdate(end))}])


class TestTheRateThatWasInForce(BillingHistoryCase):
    def test_a_rate_change_inside_the_period_splits_the_charge(self):
        """Scenario: 10 until the 15th, 12 after. Neither price bills the whole month."""
        start, end = self.month()
        changeover = str(getdate(add_days(start, 15)))

        service = self.make_service(f"RATEA{self.tag[:3]}", scope="User")
        self.cover(service, rate=10.0, valid_from=self.days_ago(1200),
                   valid_upto=str(getdate(add_days(changeover, -1))))
        self.price(service, 12.0, valid_from=changeover)
        self.running(service, client_user=self.john)

        lines = self.lines_of(self.drawn(start=start, end=end))

        self.assertEqual(len(lines), 2, "two prices held over this month, so two charges")
        self.assertEqual(sorted(flt(line["unit_rate"]) for line in lines), [10.0, 12.0])

    def test_neither_stretch_covers_the_other(self):
        start, end = self.month()
        changeover = str(getdate(add_days(start, 15)))

        service = self.make_service(f"RATEB{self.tag[:3]}", scope="User")
        self.cover(service, rate=10.0, valid_from=self.days_ago(1200),
                   valid_upto=str(getdate(add_days(changeover, -1))))
        self.price(service, 12.0, valid_from=changeover)
        self.running(service, client_user=self.john)

        lines = sorted(self.lines_of(self.drawn(start=start, end=end)), key=lambda row: row["unit_rate"])

        self.assertEqual(str(getdate(lines[0]["covered_from"])), str(getdate(start)))
        self.assertEqual(str(getdate(lines[1]["covered_to"])), str(getdate(end)))
        self.assertEqual(
            str(getdate(add_days(lines[0]["covered_to"], 1))), str(getdate(changeover))
        )

    def test_a_rate_that_never_moved_stays_one_charge(self):
        service = self.offering("RATEC")
        self.running(service, client_user=self.john)

        start, end = self.month()

        self.assertEqual(len(self.lines_of(self.drawn(start=start, end=end))), 1)

    def test_a_price_starting_after_the_period_never_reaches_it(self):
        """An August invoice may not be drawn at a September rate."""
        start, end = self.month()

        service = self.make_service(f"RATED{self.tag[:3]}", scope="User")
        self.cover(service, rate=10.0, valid_from=self.days_ago(1200),
                   valid_upto=str(getdate(add_days(end, 5))))
        self.price(service, 99.0, valid_from=str(getdate(add_days(end, 6))))
        self.running(service, client_user=self.john)

        lines = self.lines_of(self.drawn(start=start, end=end))

        self.assertEqual({flt(line["unit_rate"]) for line in lines}, {10.0})


class TestSelectionIsADecision(BillingHistoryCase):
    def setUp(self):
        super().setUp()
        self.bob = self.make_person(self.customer, "Bob")
        self.service = self.offering("SELA")
        self.mine = self.running(self.service, client_user=self.john)
        self.theirs = self.running(self.service, client_user=self.bob)

    def test_only_what_was_chosen_enters_the_run(self):
        start, end = self.month()

        run = self.drawn(start=start, end=end, include=[self.mine])

        self.assertEqual([line["service_assignment"] for line in self.lines_of(run)], [self.mine])

    def test_revalidating_never_brings_back_what_was_left_out(self):
        """Scenario 93: exclude, generate, revalidate. The excluded stay excluded."""
        start, end = self.month()
        run = self.drawn(start=start, end=end, include=[self.mine])

        BillingService.revalidate(name=run)

        self.assertEqual([line["service_assignment"] for line in self.lines_of(run)], [self.mine])

    def test_a_discount_somebody_typed_survives_revalidation(self):
        """Scenario 96: a manual 15% is a decision, not a calculation."""
        start, end = self.month()
        run = self.drawn(start=start, end=end, include=[self.mine])

        BillingService.set_line_discount(
            name=run, service_assignment=self.mine, discount_percent=15
        )
        BillingService.revalidate(name=run)

        line = self.lines_of(run)[0]

        self.assertEqual(flt(line["discount_percent"]), 15.0)
        self.assertEqual(line["discount_source"], "Manual")

    def test_something_left_out_can_be_brought_back_in(self):
        start, end = self.month()
        run = self.drawn(start=start, end=end, include=[self.mine])

        BillingService.add_to_run(name=run, service_assignment=self.theirs)

        self.assertEqual(
            {line["service_assignment"] for line in self.lines_of(run)}, {self.mine, self.theirs}
        )

    def test_something_can_be_taken_out_without_touching_the_service(self):
        start, end = self.month()
        run = self.drawn(start=start, end=end)

        BillingService.remove_from_run(name=run, service_assignment=self.theirs)

        self.assertEqual([line["service_assignment"] for line in self.lines_of(run)], [self.mine])
        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", self.theirs, "operational_status"),
            "Active",
            "the service itself is untouched",
        )

    def test_a_run_cannot_be_emptied(self):
        start, end = self.month()
        run = self.drawn(start=start, end=end, include=[self.mine])

        with self.assertRaises(ServiceRefused):
            BillingService.remove_from_run(name=run, service_assignment=self.mine)

    def test_whoever_drew_the_run_is_recorded(self):
        start, end = self.month()
        run = self.drawn(start=start, end=end)

        self.assertEqual(
            frappe.db.get_value("MSP Billing Run", run, "prepared_by"), frappe.session.user
        )


class TestABlockerHoldsTheRunAndCanLeaveIt(BillingHistoryCase):
    def test_a_line_nobody_can_price_blocks_the_approval(self):
        priced = self.offering("BLKA")
        self.running(priced, client_user=self.john)
        stuck = self.unpriced("BLKB")

        start, end = self.month()
        run = self.drawn(start=start, end=end)

        blocked = {
            line["service_assignment"]: line
            for line in self.lines_of(run)
            if line["exception_code"]
        }

        self.assertIn(stuck, blocked)
        self.assertEqual(blocked[stuck]["exception_code"], "Missing Rate")
        self.assertEqual(flt(blocked[stuck]["amount"]), 0.0, "a blocked line bills nothing")

        with self.assertRaises(Exception):
            BillingService.approve(name=run)

    def test_taking_the_blocker_out_lets_the_rest_be_approved(self):
        priced = self.offering("BLKC")
        self.running(priced, client_user=self.john)
        stuck = self.unpriced("BLKD")

        start, end = self.month()
        run = self.drawn(start=start, end=end)

        for line in self.lines_of(run):
            if line["exception_code"]:
                BillingService.remove_from_run(
                    name=run, service_assignment=line["service_assignment"]
                )

        self.assertNotIn(
            stuck, [line["service_assignment"] for line in self.lines_of(run)]
        )
        BillingService.approve(name=run)

        self.assertEqual(frappe.db.get_value("MSP Billing Run", run, "status"), "Approved")

    def test_approving_records_who_reviewed_and_who_approved(self):
        service = self.offering("BLKE")
        self.running(service, client_user=self.john)

        start, end = self.month()
        run = self.drawn(start=start, end=end)

        self.assertEqual(
            [line["exception_detail"] for line in self.lines_of(run) if line["exception_code"]],
            [],
        )

        BillingService.approve(name=run)
        row = frappe.db.get_value(
            "MSP Billing Run", run, ["reviewed_by", "approved_by", "approved_at"], as_dict=True
        )

        self.assertEqual(row.approved_by, frappe.session.user)
        self.assertEqual(row.reviewed_by, frappe.session.user)
        self.assertTrue(row.approved_at)
