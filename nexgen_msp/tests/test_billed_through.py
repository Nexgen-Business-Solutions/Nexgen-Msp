"""How far a service is billed, and the one answer every screen has to give for it.

A date that says a period is paid for is read in three places at least: the service list, the
person's file and the machine's card. They used to ask the runs their own way — one counted a
run the moment somebody approved it, before anything was posted; several left credit notes
out, so money given back still read as billed; and all of them took the end of the run's
period rather than the coverage the line carried. These tests hold them to one answer, the
one the engine itself bills on.
"""

import frappe

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.api.internal.services.user_360_service import User360Service
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import billing_marks

from .test_billing_history import BillingHistoryCase

RUN = "MSP Billing Run"


class BilledThroughCase(BillingHistoryCase):
    def setUp(self):
        super().setUp()
        self.service = self.offering("BTH")
        self.assignment = self.running(self.service, client_user=self.john)
        frappe.db.set_value("Customer", self.customer, "msp_last_billed_on", self.days_ago(400))
        frappe.db.commit()

    def approved(self, back=None):
        """A run frozen with its invoice drafted, which is where posting starts."""
        start, end = self.month(back=back) if back else self.month()
        run = self.drawn(start=start, end=end)
        BillingService.finalise(run)

        return run

    def posted(self, back=None):
        run = self.approved(back=back)
        BillingService.submit_invoice(name=run, notify=0)

        return run

    def period_of(self, run):
        return frappe.db.get_value(
            RUN, run, ["billing_period_start", "billing_period_end"], as_dict=True
        )

    def credit_back(self, charge):
        """The whole of a posted charge given back, and posted in its turn."""
        period = self.period_of(charge)
        note = BillingService.create_credit_note(
            name=charge,
            reason="ZZTEST credit",
            lines=[
                {
                    "service_assignment": self.assignment,
                    "from": str(period.billing_period_start),
                    "to": str(period.billing_period_end),
                }
            ],
            only_unserved=False,
        )["name"]
        self.track(RUN, note)
        BillingService.submit_invoice(name=note, notify=0)

        return note

    def billed(self):
        return billing_marks.billed_to([self.assignment]).get(self.assignment)


class TestOnlyWhatWasPostedCounts(BilledThroughCase):
    def test_a_run_nobody_posted_has_billed_nothing(self):
        run = self.approved()

        self.assertEqual(frappe.db.get_value(RUN, run, "docstatus"), 1, "the run is frozen")
        self.assertIsNone(self.billed(), "freezing a run is not invoicing it")

    def test_posting_it_is_what_makes_the_period_billed(self):
        run = self.posted()

        self.assertEqual(str(self.billed()), str(self.period_of(run).billing_period_end))

    def test_a_period_given_back_in_full_stops_counting_as_billed(self):
        charge = self.posted()

        self.assertIsNotNone(self.billed())

        self.credit_back(charge)

        self.assertIsNone(self.billed(), "money given back is not money billed")

    def test_a_cancelled_run_counts_for_nothing(self):
        run = self.posted()

        self.assertIsNotNone(self.billed())

        BillingService.cancel(name=run, reason="ZZTEST billing correction")

        self.assertIsNone(self.billed())


class TestTheDateIsTheCoverage(BilledThroughCase):
    def test_a_service_that_ended_mid_period_is_billed_to_the_day_it_ended(self):
        start, end = self.month()
        closed = frappe.utils.add_days(end, -10)
        frappe.db.set_value(
            "MSP Service Assignment", self.assignment, "effective_end_date", closed
        )
        frappe.db.commit()

        run = self.drawn(start=start, end=end)
        BillingService.finalise(run)
        BillingService.submit_invoice(name=run, notify=0)

        self.assertEqual(str(self.billed()), str(closed))
        self.assertNotEqual(str(self.billed()), str(end), "the run's period is not the coverage")


class TestEveryScreenSaysTheSameDay(BilledThroughCase):
    def row_of(self):
        page = PortalService.list_service_rows(customer=self.customer, page_length=50)
        rows = [row for row in page["rows"] if row["name"] == self.assignment]

        self.assertEqual(len(rows), 1, "the service is listed once")

        return rows[0]

    def test_the_list_the_person_and_the_set_agree(self):
        self.posted()
        day = self.billed()

        self.assertEqual(str(self.row_of()["last_billed_on"]), str(day))
        self.assertEqual(str(UserService._billed_to(self.assignment)), str(day))
        self.assertEqual(
            str(User360Service._billed_through([self.assignment])[self.assignment]), str(day)
        )

    def test_they_agree_on_having_billed_nothing_too(self):
        self.approved()

        self.assertIsNone(self.row_of()["last_billed_on"])
        self.assertIsNone(UserService._billed_to(self.assignment))
        self.assertEqual(User360Service._billed_through([self.assignment]), {})


class TestTheMachineOfAServiceIsTheOneItNames(BilledThroughCase):
    def test_a_personal_service_names_no_machine_even_when_the_person_holds_two(self):
        self.laptop("ONE", holder=self.john)
        self.laptop("TWO", holder=self.john)

        held = frappe.get_all(
            "MSP Managed Device",
            filters={"assigned_client_user": self.john, "status": "Active"},
            pluck="name",
        )

        self.assertEqual(len(held), 2, "the person holds two machines")

        page = PortalService.list_service_rows(customer=self.customer, page_length=50)
        row = next(row for row in page["rows"] if row["name"] == self.assignment)

        self.assertIsNone(row["device"], "a personal service is on no machine")
        self.assertIsNone(row["hostname"], "so none of theirs is named as its own")

    def test_a_device_service_still_names_the_machine_it_is_on(self):
        device = self.laptop("OWN", holder=self.john)
        service = self.offering("BTD", scope="Device")
        assignment = self.running(service, scope="Device", managed_device=device)

        page = PortalService.list_service_rows(customer=self.customer, page_length=50)
        row = next(row for row in page["rows"] if row["name"] == assignment)

        self.assertEqual(row["device"], device)
        self.assertEqual(row["hostname"], frappe.db.get_value("MSP Managed Device", device, "hostname"))
