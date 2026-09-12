"""What a Service Assignment refuses to be, whoever is writing it.

These rules live in the document itself rather than in a service, so every test here builds
the record by hand and inserts it directly: that is exactly the caller which bypasses the
API layer, and it must be refused just the same. Three things are asked of the doctype — a
service may only be sold where its catalogue entry allows, one target holds one service over
one period at a time including the periods it held in the past, and billing is read off the
operational status instead of being set beside it.
"""

import frappe

from .base import MSPTestCase


class TestServiceAssignmentInvariants(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.john = self.make_person(self.customer, "John")
        self.today = frappe.utils.today()

    # ------------------------------------------------------------------ helpers
    def assignment(
        self,
        service_item,
        scope,
        target,
        start=None,
        end=None,
        status="Active",
        billing=None,
        suspensions=None,
    ):
        doc = frappe.get_doc(
            {
                "doctype": "MSP Service Assignment",
                "customer": self.customer,
                "service_item": service_item,
                "assignment_scope": scope,
                "client_user": target if scope == "User" else None,
                "managed_device": target if scope == "Device" else None,
                "quantity": 1,
                "uom": "Unit",
                "operational_status": status,
                "billing_status": billing,
                "effective_start_date": start or self.today,
                "effective_end_date": end,
                "price_source": "Contract",
                "suspension_log": suspensions or [],
            }
        )
        doc.flags.via_service_lifecycle = True
        doc.insert(ignore_permissions=True)
        doc.flags.via_service_lifecycle = False
        self.track("MSP Service Assignment", doc.name)

        return doc

    def days_from_today(self, days):
        return frappe.utils.add_days(self.today, days)

    def device(self, hostname):
        return self.make_device(self.customer, hostname=hostname, serial=f"ZZTEST-SN-{hostname}")

    def test_direct_creation_is_refused(self):
        service = self.make_service("DIRECTCREATE", scope="User")
        doc = frappe.get_doc(
            {
                "doctype": "MSP Service Assignment",
                "customer": self.customer,
                "service_item": service,
                "assignment_scope": "User",
                "client_user": self.john,
                "quantity": 1,
                "operational_status": "Active",
                "effective_start_date": self.today,
            }
        )

        with self.assertRaises(frappe.ValidationError):
            doc.insert(ignore_permissions=True)

    # -------------------------------------------------------- catalogue scope is binding
    def test_a_user_only_service_cannot_be_assigned_to_a_device(self):
        service = self.make_service("SCOPEU", scope="User")
        box = self.device("SCOPEU")

        with self.assertRaises(frappe.ValidationError):
            self.assignment(service, "Device", box)

    def test_a_device_only_service_cannot_be_assigned_to_a_user(self):
        service = self.make_service("SCOPED", scope="Device")

        with self.assertRaises(frappe.ValidationError):
            self.assignment(service, "User", self.john)

    def test_a_both_service_can_be_assigned_to_a_user(self):
        service = self.make_service("BOTHU", scope="Both")

        doc = self.assignment(service, "User", self.john)

        self.assertEqual(doc.assignment_scope, "User")
        self.assertEqual(doc.client_user, self.john)

    def test_a_both_service_can_be_assigned_to_a_device(self):
        service = self.make_service("BOTHD", scope="Both")
        box = self.device("BOTHD")

        doc = self.assignment(service, "Device", box)

        self.assertEqual(doc.assignment_scope, "Device")
        self.assertEqual(doc.managed_device, box)

    def test_a_both_service_can_be_open_on_a_user_and_a_device_at_once(self):
        service = self.make_service("BOTHX", scope="Both")
        box = self.device("BOTHX")

        personal = self.assignment(service, "User", self.john)
        machine = self.assignment(service, "Device", box)

        self.assertEqual(personal.operational_status, "Active")
        self.assertEqual(machine.operational_status, "Active")

    # ------------------------------------------------------------ identity is scope + target
    def test_the_same_device_service_can_be_open_on_two_different_devices(self):
        service = self.make_service("TWOBOX", scope="Device")
        first = self.device("BOXA")
        second = self.device("BOXB")

        self.assignment(service, "Device", first)
        other = self.assignment(service, "Device", second)

        self.assertEqual(other.managed_device, second)

    def test_the_same_service_cannot_be_open_twice_on_the_same_device(self):
        service = self.make_service("DUPBOX", scope="Device")
        box = self.device("DUPBOX")

        self.assignment(service, "Device", box)

        with self.assertRaises(frappe.ValidationError):
            self.assignment(service, "Device", box)

    def test_the_same_service_cannot_be_open_twice_for_the_same_user(self):
        service = self.make_service("DUPUSER", scope="User")

        self.assignment(service, "User", self.john)

        with self.assertRaises(frappe.ValidationError):
            self.assignment(service, "User", self.john)

    # ------------------------------------------------------------------- history counts
    def test_a_service_can_be_taken_up_again_after_the_earlier_period_was_closed(self):
        service = self.make_service("READD", scope="User")

        self.assignment(
            service,
            "User",
            self.john,
            start=self.days_from_today(-120),
            end=self.days_from_today(-30),
            status="Ended",
        )
        again = self.assignment(service, "User", self.john, start=self.days_from_today(-15))

        self.assertEqual(again.operational_status, "Active")

    def test_a_new_period_cannot_reach_back_over_a_closed_one(self):
        service = self.make_service("HIST", scope="User")

        self.assignment(
            service,
            "User",
            self.john,
            start=self.days_from_today(-120),
            end=self.days_from_today(-10),
            status="Ended",
        )

        with self.assertRaises(frappe.ValidationError):
            self.assignment(service, "User", self.john, start=self.days_from_today(-30))

    def test_a_new_period_cannot_reach_back_over_a_closed_one_on_the_same_device(self):
        service = self.make_service("HISTBOX", scope="Device")
        box = self.device("HISTBOX")

        self.assignment(
            service,
            "Device",
            box,
            start=self.days_from_today(-90),
            end=self.days_from_today(-5),
            status="Ended",
        )

        with self.assertRaises(frappe.ValidationError):
            self.assignment(service, "Device", box, start=self.days_from_today(-20))

    # --------------------------------------------------------------- billing is derived
    def test_an_active_service_is_billable_whatever_billing_status_was_asked_for(self):
        service = self.make_service("DERA", scope="User")

        doc = self.assignment(service, "User", self.john, status="Active", billing="On Hold")
        doc.reload()

        self.assertEqual(doc.billing_status, "Billable")

    def test_a_suspended_service_is_on_hold_whatever_billing_status_was_asked_for(self):
        service = self.make_service("DERS", scope="User")

        # a suspended service carries the suspension that is still running: the log is what
        # says so, and the doctype refuses the status without it
        doc = self.assignment(
            service,
            "User",
            self.john,
            status="Suspended",
            billing="Billable",
            suspensions=[{"suspended_on": self.today}],
        )
        doc.reload()

        self.assertEqual(doc.billing_status, "On Hold")

    def test_a_closed_service_is_billed_as_ended_whatever_billing_status_was_asked_for(self):
        service = self.make_service("DERE", scope="User")

        doc = self.assignment(
            service,
            "User",
            self.john,
            start=self.days_from_today(-60),
            end=self.days_from_today(-1),
            status="Ended",
            billing="Pending",
        )
        doc.reload()

        self.assertEqual(doc.billing_status, "Ended")

    def test_direct_status_changes_are_refused(self):
        service = self.make_service("DERM", scope="User")

        doc = self.assignment(service, "User", self.john, status="Pending Setup")
        doc.reload()
        self.assertEqual(doc.billing_status, "Pending")

        doc.operational_status = "Active"
        doc.billing_status = "Not Billable"
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)
        doc.reload()

        self.assertEqual(doc.operational_status, "Pending Setup")
        self.assertEqual(doc.billing_status, "Pending")
