"""What a suspension history refuses to be.

A suspension is the only record of the days a service was really paused, so Billing reads it
literally. These tests build the log by hand on the assignment and insert it directly, the
way a caller that skips the service layer would: one pause at a time, read in the order it
happened, inside the period the service was actually provided over, and never contradicting
the status the record wears today.
"""

import frappe

from .base import MSPTestCase


class TestSuspensionInvariants(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.john = self.make_person(self.customer, "John")
        self.today = frappe.utils.today()

    # ------------------------------------------------------------------ helpers
    def days_from_today(self, days):
        return frappe.utils.add_days(self.today, days)

    def assignment(self, suffix, status="Active", start=None, end=None, suspensions=None):
        service = self.make_service(suffix, scope="User")
        doc = frappe.get_doc(
            {
                "doctype": "MSP Service Assignment",
                "customer": self.customer,
                "service_item": service,
                "assignment_scope": "User",
                "client_user": self.john,
                "quantity": 1,
                "uom": "Unit",
                "operational_status": status,
                "effective_start_date": start or self.days_from_today(-60),
                "effective_end_date": end,
                "price_source": "Contract",
                "suspension_log": suspensions or [],
            }
        )
        doc.insert(ignore_permissions=True)
        self.track("MSP Service Assignment", doc.name)

        return doc

    def spell(self, suspended_on, resumed_on=None):
        return {"suspended_on": suspended_on, "resumed_on": resumed_on}

    # ------------------------------------------------------- one pause at a time
    def test_a_service_cannot_be_paused_twice_at_once(self):
        with self.assertRaises(frappe.ValidationError):
            self.assignment(
                "SUSP2OPEN",
                status="Ended",
                end=self.days_from_today(-1),
                suspensions=[self.spell(self.days_from_today(-30)), self.spell(self.days_from_today(-10))],
            )

    def test_two_closed_pauses_followed_by_an_open_one_are_accepted(self):
        doc = self.assignment(
            "SUSPSEQ",
            status="Suspended",
            suspensions=[
                self.spell(self.days_from_today(-50), self.days_from_today(-45)),
                self.spell(self.days_from_today(-40), self.days_from_today(-35)),
                self.spell(self.days_from_today(-5)),
            ],
        )
        doc.reload()

        self.assertEqual(len(doc.suspension_log), 3)
        self.assertEqual(len([row for row in doc.suspension_log if not row.resumed_on]), 1)

    def test_a_pause_cannot_begin_while_the_previous_one_is_still_running(self):
        with self.assertRaises(frappe.ValidationError):
            self.assignment(
                "SUSPOVER",
                suspensions=[
                    self.spell(self.days_from_today(-30), self.days_from_today(-10)),
                    self.spell(self.days_from_today(-20), self.days_from_today(-5)),
                ],
            )

    # ----------------------------------------------------- the status has to agree
    def test_a_suspended_service_needs_an_open_pause(self):
        with self.assertRaises(frappe.ValidationError):
            self.assignment("SUSPNONE", status="Suspended")

    def test_a_suspended_service_cannot_have_two_open_pauses(self):
        with self.assertRaises(frappe.ValidationError):
            self.assignment(
                "SUSPTWO",
                status="Suspended",
                suspensions=[self.spell(self.days_from_today(-30)), self.spell(self.days_from_today(-10))],
            )

    def test_a_suspended_service_with_exactly_one_open_pause_is_accepted(self):
        doc = self.assignment(
            "SUSPONE", status="Suspended", suspensions=[self.spell(self.days_from_today(-10))]
        )
        doc.reload()

        self.assertEqual(doc.billing_status, "On Hold")
        self.assertEqual(len(doc.suspension_log), 1)

    def test_an_active_service_cannot_have_an_open_pause(self):
        with self.assertRaises(frappe.ValidationError):
            self.assignment("SUSPACT", status="Active", suspensions=[self.spell(self.days_from_today(-10))])

    def test_a_service_awaiting_removal_cannot_have_an_open_pause(self):
        with self.assertRaises(frappe.ValidationError):
            self.assignment(
                "SUSPPR", status="Pending Removal", suspensions=[self.spell(self.days_from_today(-10))]
            )

    def test_an_active_service_may_carry_a_pause_that_is_over(self):
        doc = self.assignment(
            "SUSPPAST",
            status="Active",
            suspensions=[self.spell(self.days_from_today(-30), self.days_from_today(-20))],
        )
        doc.reload()

        self.assertEqual(doc.billing_status, "Billable")
        self.assertEqual(len(doc.suspension_log), 1)

    def test_a_service_closed_while_it_was_paused_keeps_the_pause_open(self):
        doc = self.assignment(
            "SUSPENDED",
            status="Ended",
            end=self.days_from_today(-1),
            suspensions=[self.spell(self.days_from_today(-10))],
        )
        doc.reload()

        self.assertEqual(doc.operational_status, "Ended")
        self.assertIsNone(doc.suspension_log[0].resumed_on)

    # ------------------------------------------------------------ dates hold up
    def test_a_pause_cannot_start_tomorrow(self):
        with self.assertRaises(frappe.ValidationError):
            self.assignment(
                "SUSPFUT", status="Suspended", suspensions=[self.spell(self.days_from_today(1))]
            )

    def test_a_pause_cannot_start_before_the_service_did(self):
        with self.assertRaises(frappe.ValidationError):
            self.assignment(
                "SUSPEARLY",
                status="Suspended",
                start=self.days_from_today(-30),
                suspensions=[self.spell(self.days_from_today(-40))],
            )

    def test_a_pause_cannot_start_after_the_service_ended(self):
        with self.assertRaises(frappe.ValidationError):
            self.assignment(
                "SUSPLATE",
                status="Ended",
                start=self.days_from_today(-60),
                end=self.days_from_today(-30),
                suspensions=[self.spell(self.days_from_today(-10))],
            )

    def test_a_pause_cannot_be_resumed_before_it_started(self):
        with self.assertRaises(frappe.ValidationError):
            self.assignment(
                "SUSPBACK",
                suspensions=[self.spell(self.days_from_today(-10), self.days_from_today(-20))],
            )

    def test_a_pause_started_and_ended_the_same_day_is_kept(self):
        same_day = self.days_from_today(-10)

        doc = self.assignment("SUSPSAME", suspensions=[self.spell(same_day, same_day)])
        doc.reload()

        self.assertEqual(len(doc.suspension_log), 1)
        self.assertEqual(frappe.utils.getdate(doc.suspension_log[0].suspended_on), frappe.utils.getdate(same_day))
        self.assertEqual(frappe.utils.getdate(doc.suspension_log[0].resumed_on), frappe.utils.getdate(same_day))

    # ------------------------------------------------------------- reading the log
    def test_the_open_pause_is_the_one_still_running(self):
        from nexgen_msp.utils import service_suspensions

        doc = self.assignment(
            "SUSPREAD",
            status="Suspended",
            suspensions=[
                self.spell(self.days_from_today(-50), self.days_from_today(-45)),
                self.spell(self.days_from_today(-5)),
            ],
        )

        open_row = service_suspensions.open_row(doc)
        last_row = service_suspensions.last_row(doc)

        self.assertIsNotNone(open_row)
        self.assertEqual(frappe.utils.getdate(open_row.suspended_on), frappe.utils.getdate(self.days_from_today(-5)))
        self.assertEqual(last_row.name, open_row.name)

    def test_a_service_that_was_never_paused_has_no_open_pause(self):
        from nexgen_msp.utils import service_suspensions

        doc = self.assignment("SUSPNIL")

        self.assertIsNone(service_suspensions.open_row(doc))
        self.assertIsNone(service_suspensions.last_row(doc))
