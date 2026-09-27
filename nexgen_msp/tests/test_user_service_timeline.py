"""The person's whole service record, as the user page reads it.

A personal service is the person's for its whole life. A machine's service is only read on a
person's page for the days they held that machine while it ran: the assignment itself never
moves, never gains a second copy, and reads differently on each holder's page.
"""

import datetime

import frappe

from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.user_360_service import User360Service, association_window
from nexgen_msp.utils import device_holders as holders

from .base import MSPTestCase

ASSIGNMENT = "MSP Service Assignment"


class TestAssociationWindow(MSPTestCase):
    """The date arithmetic on its own, without a database row in sight."""

    def d(self, text):
        return datetime.date.fromisoformat(text)

    def test_a_service_outliving_the_holding_is_cut_at_the_hand_back(self):
        self.assertEqual(
            association_window("2026-04-01", None, "2026-05-01", "2026-09-15"),
            (self.d("2026-05-01"), self.d("2026-09-15")),
        )

    def test_the_next_holder_reads_it_from_their_own_first_day(self):
        self.assertEqual(
            association_window("2026-04-01", None, "2026-09-16", None),
            (self.d("2026-09-16"), None),
        )

    def test_a_service_started_after_the_hand_back_was_never_theirs(self):
        self.assertIsNone(association_window("2026-09-20", None, "2026-05-01", "2026-09-15"))

    def test_a_service_ended_before_the_holding_began_was_never_theirs(self):
        self.assertIsNone(
            association_window("2026-01-01", "2026-04-30", "2026-05-01", "2026-09-15")
        )

    def test_a_service_ended_during_the_holding_ends_the_association_with_it(self):
        self.assertEqual(
            association_window("2026-06-01", "2026-07-01", "2026-05-01", "2026-09-15"),
            (self.d("2026-06-01"), self.d("2026-07-01")),
        )

    def test_a_service_not_started_yet_only_belongs_with_a_running_holding(self):
        self.assertEqual(association_window(None, None, "2026-05-01", None), (None, None))
        self.assertIsNone(association_window(None, None, "2026-05-01", "2026-09-15"))


class TestUserServiceTimeline(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.alice = self.make_person(self.customer, "Alice")
        self.bob = self.make_person(self.customer, "Bob")

        self.device_service = self.make_service(f"TLDEV{self.tag[:3]}", scope="Device")
        self.late_service = self.make_service(f"TLLAT{self.tag[:3]}", scope="Device")
        self.user_service = self.make_service(f"TLUSR{self.tag[:3]}", scope="User")
        for service in (self.device_service, self.late_service, self.user_service):
            self.cover_service(self.customer, service)

        self.laptop = self.make_device(
            self.customer, hostname=f"TLBOX{self.tag[:3]}", serial=f"SN-TL-{self.tag}"
        )

        doc = frappe.get_doc("MSP Managed Device", self.laptop)
        holders.hand_over(doc, self.alice, on_date=self.day(-90))
        doc.status = "Active"
        doc.save(ignore_permissions=True)
        frappe.db.commit()

    # ------------------------------------------------------------------ helpers
    def day(self, offset):
        return frappe.utils.getdate(frappe.utils.add_days(frappe.utils.today(), offset))

    def activate(self, service, started, **target):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope="Device" if "managed_device" in target else "User",
            effective_date=self.day(started),
            **target,
        )
        self.track(ASSIGNMENT, outcome["name"])
        frappe.db.commit()

        return outcome["name"]

    def on_laptop(self, service=None, started=-60):
        return self.activate(service or self.device_service, started, managed_device=self.laptop)

    def personal(self, started=-60):
        return self.activate(self.user_service, started, client_user=self.alice)

    def transfer_to_bob(self, on=-30):
        DeviceLifecycleService.transfer(
            device=self.laptop, client_user=self.bob, effective_date=self.day(on)
        )
        frappe.db.commit()

    def reading(self, person):
        return User360Service.get_user(person)

    def rows(self, person, assignment):
        return [row for row in self.reading(person)["services"] if row["assignment"] == assignment]

    def only(self, person, assignment):
        rows = self.rows(person, assignment)
        self.assertEqual(len(rows), 1, f"{assignment} should be read once on {person}'s page")

        return rows[0]

    def stored(self, assignment):
        return frappe.db.get_value(
            ASSIGNMENT,
            assignment,
            [
                "operational_status",
                "billing_status",
                "client_user",
                "managed_device",
                "effective_start_date",
                "effective_end_date",
            ],
            as_dict=True,
        )

    # ------------------------------------------------------------------ their own
    def test_an_active_personal_service_is_read_as_theirs(self):
        name = self.personal()
        row = self.only(self.alice, name)

        self.assertEqual(row["assignment_scope"], "User")
        self.assertIsNone(row["managed_device"])
        self.assertEqual(row["association_from"], self.day(-60))
        self.assertIsNone(row["association_until"])
        self.assertEqual(row["operational_status"], "Active")
        self.assertEqual(row["billing_status"], "Billable")
        self.assertTrue(row["current_holding"])

    def test_an_ended_personal_service_stays_in_the_list(self):
        name = self.personal()
        ServiceLifecycleService.end(assignment=name, effective_date=self.day(-10))
        frappe.db.commit()

        row = self.only(self.alice, name)

        self.assertEqual(row["operational_status"], "Ended")
        self.assertEqual(row["association_until"], self.day(-10))
        self.assertEqual(row["allowed_actions"], [])
        self.assertEqual(self.reading(self.alice)["service_counts"].get("Ended"), 1)

    def test_a_suspended_service_stays_in_the_list_and_may_only_be_resumed_or_removed(self):
        name = self.personal()
        ServiceLifecycleService.suspend(assignment=name, effective_date=self.day(-5))
        frappe.db.commit()

        row = self.only(self.alice, name)

        self.assertEqual(row["operational_status"], "Suspended")
        self.assertIn("Resume", row["allowed_actions"])
        self.assertNotIn("Suspend", row["allowed_actions"])

    def test_the_same_service_again_is_a_new_line_beside_the_ended_one(self):
        first = self.personal(started=-60)
        ServiceLifecycleService.end(assignment=first, effective_date=self.day(-40))
        frappe.db.commit()

        second = self.personal(started=-20)

        self.assertNotEqual(first, second)
        self.assertEqual(self.stored(first).operational_status, "Ended", "never reopened")
        self.assertEqual(self.only(self.alice, first)["operational_status"], "Ended")
        self.assertEqual(self.only(self.alice, second)["operational_status"], "Active")

    # ------------------------------------------------------------------ the machine's
    def test_a_device_service_is_read_under_the_current_holder_with_its_machine(self):
        name = self.on_laptop()
        row = self.only(self.alice, name)

        self.assertEqual(row["assignment_scope"], "Device")
        self.assertEqual(row["managed_device"], self.laptop)
        self.assertTrue(row["hostname"])
        self.assertEqual(row["association_from"], self.day(-60))
        self.assertIsNone(row["association_until"])
        self.assertTrue(row["current_holding"])

    def test_a_transfer_splits_the_reading_and_leaves_the_assignment_alone(self):
        name = self.on_laptop(started=-60)
        before = self.stored(name)

        self.transfer_to_bob(on=-30)

        hers = self.only(self.alice, name)
        self.assertEqual(hers["association_from"], self.day(-60))
        self.assertEqual(hers["association_until"], self.day(-30))
        self.assertEqual(hers["operational_status"], "Active", "the service itself did not end")
        self.assertFalse(hers["current_holding"])

        his = self.only(self.bob, name)
        self.assertEqual(his["association_from"], self.day(-30))
        self.assertIsNone(his["association_until"])
        self.assertTrue(his["current_holding"])

        self.assertEqual(self.stored(name), before, "reading it moved nothing")
        self.assertEqual(frappe.db.count(ASSIGNMENT, {"managed_device": self.laptop}), 1)

    def test_a_service_installed_after_the_hand_back_is_not_hers(self):
        self.transfer_to_bob(on=-30)
        late = self.on_laptop(service=self.late_service, started=-10)

        self.assertEqual(self.rows(self.alice, late), [])
        self.assertEqual(self.only(self.bob, late)["association_from"], self.day(-10))

    def test_an_ended_device_service_stays_visible_while_it_overlapped_the_holding(self):
        name = self.on_laptop(started=-80)
        ServiceLifecycleService.end(assignment=name, effective_date=self.day(-70))
        frappe.db.commit()
        self.transfer_to_bob(on=-30)

        row = self.only(self.alice, name)
        self.assertEqual(row["operational_status"], "Ended")
        self.assertEqual(row["association_from"], self.day(-80))
        self.assertEqual(row["association_until"], self.day(-70))

        self.assertEqual(self.rows(self.bob, name), [], "it ended before he got the machine")

    def test_holding_the_same_machine_twice_reads_as_two_associations(self):
        name = self.on_laptop(started=-60)
        self.transfer_to_bob(on=-30)
        DeviceLifecycleService.transfer(
            device=self.laptop, client_user=self.alice, effective_date=self.day(-10)
        )
        frappe.db.commit()

        spells = sorted(row["association_from"] for row in self.rows(self.alice, name))
        self.assertEqual(spells, [self.day(-60), self.day(-10)])

    # ------------------------------------------------------------------ holding history
    def test_every_holding_is_listed_with_the_current_one_first(self):
        self.transfer_to_bob(on=-30)
        DeviceLifecycleService.transfer(
            device=self.laptop, client_user=self.alice, effective_date=self.day(-10)
        )
        frappe.db.commit()

        history = self.reading(self.alice)["device_history"]

        self.assertEqual([spell["is_current"] for spell in history], [True, False])
        self.assertEqual(history[0]["from_date"], self.day(-10))
        self.assertIsNone(history[0]["to_date"])
        self.assertEqual(history[1]["from_date"], self.day(-90))
        self.assertEqual(history[1]["to_date"], self.day(-30))

    # ------------------------------------------------------------------ nothing else moved
    def test_billing_and_status_are_read_as_stored(self):
        device = self.on_laptop()
        mine = self.personal()
        ServiceLifecycleService.suspend(assignment=mine, effective_date=self.day(-5))
        frappe.db.commit()

        for name in (device, mine):
            stored = self.stored(name)
            row = self.only(self.alice, name)

            self.assertEqual(row["billing_status"], stored.billing_status)
            self.assertEqual(row["operational_status"], stored.operational_status)
            self.assertEqual(row["effective_start_date"], stored.effective_start_date)

        self.assertEqual(self.stored(mine).billing_status, "On Hold")

    def test_the_old_lists_still_carry_only_what_is_open(self):
        name = self.personal()
        ServiceLifecycleService.end(assignment=name, effective_date=self.day(-10))
        frappe.db.commit()

        reading = self.reading(self.alice)

        self.assertNotIn(name, [row["name"] for row in reading["personal_services"]["current"]])
        self.assertEqual(reading["summary"]["active_personal_services"], 0)
