"""Service assignments that predate Phase 2 are made to agree with it, or else reported.

The states the patch is there for cannot be built through the front door any more — that is
the whole point of the rules Task 1 and this task added — so they are written straight to the
database the way the records already on the site got there. What the patch may then do is
narrowly bounded: restate a billing status, rebuild a suspension it can date from the record's
own version trail, and otherwise count and log what only a person can decide.
"""

import frappe

from nexgen_msp.patches import normalize_service_assignments

from .base import MSPTestCase


class TestServiceAssignmentMigration(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.john = self.make_person(self.customer, "John")
        self.today = frappe.utils.today()

    def tearDown(self):
        # the version trail is what the patch reads; it outlives the record unless it is told to go
        for doctype, name in self._trash:
            if doctype == "MSP Service Assignment":
                frappe.db.sql(
                    "delete from `tabVersion` where ref_doctype = 'MSP Service Assignment' and docname = %s",
                    name,
                )
        frappe.db.commit()

        super().tearDown()

    # ------------------------------------------------------------------ helpers
    def days_ago(self, days):
        return frappe.utils.add_days(self.today, -days)

    def assignment(self, service, status="Active", start=None, end=None):
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
                "effective_start_date": start,
                "effective_end_date": end,
                "price_source": "Contract",
            }
        )
        doc.flags.via_service_lifecycle = True
        doc.insert(ignore_permissions=True)
        doc.flags.via_service_lifecycle = False
        self.track("MSP Service Assignment", doc.name)

        return doc

    def write(self, name, **values):
        """Leave an assignment in a state no save would ever have written."""
        frappe.db.set_value("MSP Service Assignment", name, values, update_modified=False)
        frappe.db.commit()

    def drop_suspension_log(self, name):
        frappe.db.sql(
            "delete from `tabMSP Service Suspension` where parent = %s and parenttype = 'MSP Service Assignment'",
            name,
        )
        frappe.db.commit()

    def suspensions(self, name):
        return frappe.get_all(
            "MSP Service Suspension",
            filters={"parent": name, "parenttype": "MSP Service Assignment"},
            fields=["suspended_on", "resumed_on", "note"],
            order_by="idx asc",
        )

    def state(self, name):
        """Everything the patch could have touched, the timestamp included."""
        row = frappe.db.get_value(
            "MSP Service Assignment",
            name,
            [
                "operational_status",
                "billing_status",
                "effective_start_date",
                "effective_end_date",
                "quantity",
                "modified",
            ],
            as_dict=True,
        )

        return (row, self.suspensions(name))

    # --------------------------------------------------- what it restates with certainty
    def test_a_billing_status_that_contradicts_the_service_is_put_right(self):
        service = self.make_service("MIGBILL", scope="User")
        doc = self.assignment(service, start=self.days_ago(30))
        self.write(doc.name, billing_status="On Hold")

        report = normalize_service_assignments.execute()

        self.assertEqual(report["billing_restated"], 1)
        self.assertEqual(report["billing_flagged"], 0)
        self.assertEqual(frappe.db.get_value("MSP Service Assignment", doc.name, "billing_status"), "Billable")

    def test_a_closed_service_billed_as_pending_is_put_right(self):
        service = self.make_service("MIGBILLE", scope="User")
        doc = self.assignment(service, status="Ended", start=self.days_ago(60), end=self.days_ago(10))
        self.write(doc.name, billing_status="Pending")

        normalize_service_assignments.execute()

        self.assertEqual(frappe.db.get_value("MSP Service Assignment", doc.name, "billing_status"), "Ended")

    def test_a_service_that_already_agrees_with_itself_is_left_alone(self):
        service = self.make_service("MIGOK", scope="User")
        doc = self.assignment(service, start=self.days_ago(30))
        before = self.state(doc.name)

        report = normalize_service_assignments.execute()

        self.assertEqual(report["billing_restated"], 0)
        self.assertEqual(self.state(doc.name), before)

    # ------------------------------------------------------------- what it only reports
    def test_the_same_service_open_twice_on_one_target_is_reported_and_not_touched(self):
        service = self.make_service("MIGDUP", scope="User")
        running = self.assignment(service, start=self.days_ago(30))
        # a period with no start date escapes the overlap rule, so both can be left open
        planned = self.assignment(service, status="Pending Setup")
        before = (self.state(running.name), self.state(planned.name))

        report = normalize_service_assignments.execute()

        self.assertEqual(report["duplicate_open"], 1)
        self.assertEqual((self.state(running.name), self.state(planned.name)), before)

    def test_two_periods_claiming_the_same_days_are_reported_and_not_touched(self):
        service = self.make_service("MIGOVER", scope="User")
        closed = self.assignment(service, status="Ended", start=self.days_ago(60), end=self.days_ago(30))
        again = self.assignment(service, start=self.days_ago(10))
        self.write(again.name, effective_start_date=self.days_ago(40))
        before = (self.state(closed.name), self.state(again.name))

        report = normalize_service_assignments.execute()

        self.assertEqual(report["overlapping_history"], 1)
        self.assertEqual(report["duplicate_open"], 0)
        self.assertEqual((self.state(closed.name), self.state(again.name)), before)

    def test_a_period_that_ends_before_it_begins_is_reported(self):
        """Counted against the site's own tally: the records already here have their own gaps."""
        service = self.make_service("MIGBAD", scope="User")
        doc = self.assignment(service, status="Ended", start=self.days_ago(30), end=self.days_ago(10))
        already_on_file = normalize_service_assignments.execute()["invalid_dates"]

        self.write(doc.name, effective_end_date=self.days_ago(60))
        before = self.state(doc.name)
        report = normalize_service_assignments.execute()

        self.assertEqual(report["invalid_dates"] - already_on_file, 1)
        self.assertEqual(self.state(doc.name), before)

    def test_a_service_sold_from_a_retired_catalogue_entry_is_reported(self):
        service = self.make_service("MIGDIS", scope="User")
        doc = self.assignment(service, start=self.days_ago(30))
        before = self.state(doc.name)

        frappe.db.set_value("Item", service, "disabled", 1)
        frappe.db.commit()
        report = normalize_service_assignments.execute()

        self.assertEqual(report["disabled_services"], 1)
        self.assertEqual(self.state(doc.name), before)

    # ------------------------------------------------ what it rebuilds from the trail
    def suspended_with_a_trail(self, service, suspended_on):
        """A service suspended through the front door, then stripped of the log it once had.

        The version trail is left intact: that is the only thing on file that still says when
        the service stopped, and it is exactly what a record written before the log existed
        leaves behind.
        """
        doc = self.assignment(service, start=self.days_ago(60))
        doc.operational_status = "Suspended"
        doc.append("suspension_log", {"suspended_on": suspended_on})
        doc.flags.via_service_lifecycle = True
        # a test run keeps no version trail of its own, and the trail is the whole point here
        doc.save(ignore_permissions=True, ignore_version=False)
        frappe.db.commit()

        self.drop_suspension_log(doc.name)

        return doc.name

    def test_a_suspension_is_rebuilt_from_the_day_the_trail_recorded_it(self):
        service = self.make_service("MIGSUSP", scope="User")
        name = self.suspended_with_a_trail(service, self.days_ago(10))
        before = self.state(name)[0]

        report = normalize_service_assignments.execute()

        self.assertEqual(report["suspensions_rebuilt"], 1)
        self.assertEqual(report["suspensions_flagged"], 0)

        rows = self.suspensions(name)
        self.assertEqual(len(rows), 1)
        self.assertEqual(frappe.utils.getdate(rows[0].suspended_on), frappe.utils.getdate(self.today))
        self.assertIsNone(rows[0].resumed_on)
        self.assertIn("Reconstructed", rows[0].note)

        after = self.state(name)[0]
        self.assertEqual(after.operational_status, "Suspended")
        self.assertEqual(after.billing_status, "On Hold")
        self.assertEqual(after.effective_start_date, before.effective_start_date)
        self.assertEqual(after.effective_end_date, before.effective_end_date)
        self.assertEqual(after.quantity, before.quantity)

    def test_a_suspension_with_no_trail_at_all_is_flagged_rather_than_guessed(self):
        service = self.make_service("MIGSUSPX", scope="User")
        doc = self.assignment(service, start=self.days_ago(60))
        self.write(doc.name, operational_status="Suspended", billing_status="On Hold")

        report = normalize_service_assignments.execute()

        self.assertEqual(report["suspensions_flagged"], 1)
        self.assertEqual(report["suspensions_rebuilt"], 0)
        self.assertEqual(self.suspensions(doc.name), [])
        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", doc.name, "effective_start_date"),
            frappe.utils.getdate(self.days_ago(60)),
        )

    def test_a_trail_that_says_the_service_came_back_is_treated_as_ambiguous(self):
        service = self.make_service("MIGSUSPA", scope="User")
        doc = self.assignment(service, start=self.days_ago(60))
        doc.operational_status = "Suspended"
        doc.append("suspension_log", {"suspended_on": self.days_ago(20)})
        doc.flags.via_service_lifecycle = True
        doc.save(ignore_permissions=True, ignore_version=False)
        doc.operational_status = "Active"
        doc.suspension_log[0].resumed_on = self.days_ago(10)
        doc.flags.via_service_lifecycle = True
        doc.save(ignore_permissions=True, ignore_version=False)
        frappe.db.commit()

        # the record is put back to Suspended without a trail entry saying so: the last thing
        # the history recorded is the service coming back, which contradicts the record
        self.drop_suspension_log(doc.name)
        self.write(doc.name, operational_status="Suspended", billing_status="On Hold")

        report = normalize_service_assignments.execute()

        self.assertEqual(report["suspensions_rebuilt"], 0)
        self.assertEqual(report["suspensions_flagged"], 1)
        self.assertEqual(self.suspensions(doc.name), [])

    # ------------------------------------------------------------------ idempotence
    def test_running_it_again_changes_nothing(self):
        service = self.make_service("MIGIDEM", scope="User")
        mispaired = self.assignment(service, start=self.days_ago(30))
        self.write(mispaired.name, billing_status="On Hold")

        suspended_service = self.make_service("MIGIDEMS", scope="User")
        suspended = self.suspended_with_a_trail(suspended_service, self.days_ago(10))

        normalize_service_assignments.execute()
        settled = (self.state(mispaired.name), self.state(suspended))

        report = normalize_service_assignments.execute()

        self.assertEqual(report["billing_restated"], 0)
        self.assertEqual(report["suspensions_rebuilt"], 0)
        self.assertEqual(report["suspensions_flagged"], 0)
        self.assertEqual((self.state(mispaired.name), self.state(suspended)), settled)
