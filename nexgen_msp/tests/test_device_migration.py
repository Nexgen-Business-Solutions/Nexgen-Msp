"""Records that predate the rule are made to agree with it, without being told what to say.

None of the states repaired here can be built through the front door: the domain refuses
every one of them now. So the broken machines are written straight to the database, the way
the ones already on the site got there, and the patch is then asked to read the history and
restate the rest of the record from it.
"""

import frappe

from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.patches import normalize_device_lifecycle
from nexgen_msp.utils import device_holders as holders

from .base import MSPTestCase


class TestDeviceMigration(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.alice = self.make_person(self.customer, "Alice")
        self.bob = self.make_person(self.customer, "Bob")
        self.today = frappe.utils.today()

    # ------------------------------------------------------------------ helpers
    def days_ago(self, days):
        return frappe.utils.add_days(self.today, -days)

    def device(self, hostname, holder=None, serial=None):
        return self.make_device(self.customer, hostname=hostname, holder=holder, serial=serial)

    def reload(self, device):
        return frappe.get_doc("MSP Managed Device", device)

    def spells(self, device):
        return holders.history(device)

    def state(self, device):
        """Everything the patch could possibly have touched, the timestamp included."""
        doc = self.reload(device)

        return (
            doc.status,
            doc.assigned_client_user,
            doc.retired_date,
            doc.modified,
            [(row.client_user, row.from_date, row.to_date, bool(row.is_current)) for row in self.spells(device)],
        )

    def write(self, device, **values):
        """Leave a machine in a state the application would never have written."""
        frappe.db.set_value("MSP Managed Device", device, values, update_modified=False)
        frappe.db.commit()

    def close_spell(self, device, on_date):
        frappe.db.sql(
            """
            update `tabMSP Device Holder` set to_date = %(on_date)s, is_current = 0
            where parent = %(device)s and parenttype = 'MSP Managed Device'
              and ifnull(to_date, '') = ''
            """,
            {"device": device, "on_date": on_date},
        )
        frappe.db.commit()

    def start_spell(self, device, on_date):
        frappe.db.sql(
            """
            update `tabMSP Device Holder` set from_date = %(on_date)s
            where parent = %(device)s and parenttype = 'MSP Managed Device'
              and ifnull(to_date, '') = ''
            """,
            {"device": device, "on_date": on_date},
        )
        frappe.db.commit()

    def add_open_spell(self, device, holder, on_date):
        """A second spell left open on the same machine, which no save would ever allow."""
        frappe.db.sql(
            """
            insert into `tabMSP Device Holder`
                (name, creation, modified, owner, modified_by, docstatus, parent, parenttype,
                 parentfield, idx, client_user, full_name, from_date, is_current)
            values
                (%(name)s, now(), now(), 'Administrator', 'Administrator', 0, %(device)s,
                 'MSP Managed Device', 'holder_log', %(idx)s, %(holder)s, %(full_name)s,
                 %(on_date)s, 1)
            """,
            {
                "name": frappe.generate_hash(length=10),
                "device": device,
                "idx": len(self.spells(device)) + 1,
                "holder": holder,
                "full_name": frappe.db.get_value("MSP Client User", holder, "full_name"),
                "on_date": on_date,
            },
        )
        frappe.db.commit()

    # --------------------------------------------------------------- what it repairs
    def test_a_machine_nobody_holds_any_more_stops_being_active(self):
        device = self.device("MIGA", holder=self.alice, serial="SN-MIG-A")
        self.start_spell(device, self.days_ago(10))
        self.close_spell(device, self.days_ago(2))

        normalize_device_lifecycle.execute()

        doc = self.reload(device)
        self.assertEqual(doc.status, "Stock")
        self.assertIsNone(doc.assigned_client_user)
        self.assertEqual([row for row in self.spells(device) if not row.to_date], [])

    def test_a_machine_somebody_still_holds_is_active_again(self):
        device = self.device("MIGB", holder=self.alice, serial="SN-MIG-B")
        self.write(device, status="Stock", assigned_client_user=None)

        normalize_device_lifecycle.execute()

        doc = self.reload(device)
        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.alice)
        self.assertEqual([row.client_user for row in self.spells(device) if not row.to_date], [self.alice])

    def test_a_retired_machine_stops_pointing_at_whoever_had_it(self):
        device = self.device("MIGC", holder=self.alice, serial="SN-MIG-C")
        DeviceLifecycleService.retire(device=device)
        history = [(row.client_user, row.from_date, row.to_date) for row in self.spells(device)]

        self.write(device, assigned_client_user=self.alice)
        normalize_device_lifecycle.execute()

        doc = self.reload(device)
        self.assertEqual(doc.status, "Retired")
        self.assertIsNone(doc.assigned_client_user)
        self.assertEqual(
            [(row.client_user, row.from_date, row.to_date) for row in self.spells(device)],
            history,
            "the history of a machine that was properly retired is not rewritten",
        )

    def test_a_machine_retired_without_taking_it_back_has_its_spell_closed(self):
        device = self.device("MIGD", holder=self.alice, serial="SN-MIG-D")
        self.start_spell(device, self.days_ago(10))
        self.write(device, status="Retired", retired_date=self.days_ago(2))

        normalize_device_lifecycle.execute()

        doc = self.reload(device)
        self.assertEqual(doc.status, "Retired")
        self.assertIsNone(doc.assigned_client_user)

        rows = self.spells(device)
        self.assertEqual(len(rows), 1)
        self.assertEqual(frappe.utils.getdate(rows[0].to_date), frappe.utils.getdate(self.days_ago(2)))
        self.assertFalse(rows[0].is_current)

    def test_a_lost_machine_with_no_date_is_closed_on_the_day_it_was_last_touched(self):
        device = self.device("MIGE", holder=self.alice, serial="SN-MIG-E")
        self.start_spell(device, self.days_ago(30))
        self.write(device, status="Lost", retired_date=None)
        last_touched = frappe.db.get_value("MSP Managed Device", device, "modified")

        normalize_device_lifecycle.execute()

        doc = self.reload(device)
        rows = self.spells(device)
        self.assertIsNone(doc.assigned_client_user)
        self.assertEqual(frappe.utils.getdate(doc.retired_date), frappe.utils.getdate(last_touched))
        self.assertEqual(frappe.utils.getdate(rows[0].to_date), frappe.utils.getdate(last_touched))

    def test_a_machine_out_of_service_without_a_date_is_given_one(self):
        device = self.device("MIGF", serial="SN-MIG-F")
        self.write(device, status="Retired", retired_date=None)

        normalize_device_lifecycle.execute()

        doc = self.reload(device)
        self.assertEqual(doc.status, "Retired")
        self.assertTrue(doc.retired_date)

    def test_two_open_spells_leave_one_holder_and_a_history_that_holds_up(self):
        device = self.device("MIGG", holder=self.alice, serial="SN-MIG-G")
        self.start_spell(device, self.days_ago(10))
        self.add_open_spell(device, self.bob, self.days_ago(3))

        normalize_device_lifecycle.execute()

        doc = self.reload(device)
        self.assertEqual(doc.status, "Active")
        self.assertEqual(doc.assigned_client_user, self.bob)

        rows = self.spells(device)
        self.assertEqual([row.client_user for row in rows], [self.alice, self.bob])
        self.assertEqual(frappe.utils.getdate(rows[0].to_date), frappe.utils.getdate(self.days_ago(3)))
        self.assertFalse(rows[1].to_date)
        self.assertEqual([bool(row.is_current) for row in rows], [False, True])

        holders.validate_holder_log(doc)

    # ------------------------------------------------------------ what it leaves alone
    def test_running_it_again_changes_nothing(self):
        device = self.device("MIGH", holder=self.alice, serial="SN-MIG-H")
        self.start_spell(device, self.days_ago(10))
        self.close_spell(device, self.days_ago(2))
        normalize_device_lifecycle.execute()
        repaired = self.state(device)

        normalize_device_lifecycle.execute()

        self.assertEqual(self.state(device), repaired)

    def test_a_machine_that_already_agrees_with_its_history_is_left_alone(self):
        held = self.device("MIGI", holder=self.alice, serial="SN-MIG-I")
        shelved = self.device("MIGJ", serial="SN-MIG-J")
        before = (self.state(held), self.state(shelved))

        normalize_device_lifecycle.execute()

        self.assertEqual((self.state(held), self.state(shelved)), before)


class TestBackfillHolderPeriodDates(MSPTestCase):
    """A holder period with no start date is given the day the device itself went into service."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.alice = self.make_person(self.customer, "Alice")
        self.today = frappe.utils.today()

    def days_ago(self, days):
        return frappe.utils.add_days(self.today, -days)

    def blank_from_date(self, device):
        frappe.db.sql(
            "update `tabMSP Device Holder` set from_date = NULL "
            "where parent = %s and parenttype = 'MSP Managed Device'",
            device,
        )
        frappe.db.commit()

    def test_a_missing_start_date_is_filled_with_the_devices_own_in_service_date(self):
        from nexgen_msp.patches import backfill_holder_period_dates

        device = self.make_device(self.customer, hostname="BFA", holder=self.alice, serial="ZZTEST-SN-BFA")
        in_service = self.days_ago(20)
        frappe.db.set_value("MSP Managed Device", device, "assigned_date", in_service, update_modified=False)
        self.blank_from_date(device)

        backfill_holder_period_dates.execute()

        row = frappe.db.get_value(
            "MSP Device Holder", {"parent": device, "parenttype": "MSP Managed Device"}, "from_date"
        )
        self.assertEqual(frappe.utils.getdate(row), frappe.utils.getdate(in_service))

    def test_a_device_with_no_in_service_date_either_falls_back_to_when_it_was_created(self):
        from nexgen_msp.patches import backfill_holder_period_dates

        device = self.make_device(self.customer, hostname="BFB", holder=self.alice, serial="ZZTEST-SN-BFB")
        created = frappe.db.get_value("MSP Managed Device", device, "creation")
        frappe.db.set_value("MSP Managed Device", device, "assigned_date", None, update_modified=False)
        self.blank_from_date(device)

        backfill_holder_period_dates.execute()

        row = frappe.db.get_value(
            "MSP Device Holder", {"parent": device, "parenttype": "MSP Managed Device"}, "from_date"
        )
        self.assertEqual(frappe.utils.getdate(row), frappe.utils.getdate(created))

    def test_running_it_again_changes_nothing(self):
        from nexgen_msp.patches import backfill_holder_period_dates

        device = self.make_device(self.customer, hostname="BFC", holder=self.alice, serial="ZZTEST-SN-BFC")
        self.blank_from_date(device)
        backfill_holder_period_dates.execute()
        first_pass = frappe.db.get_value(
            "MSP Device Holder", {"parent": device, "parenttype": "MSP Managed Device"}, "from_date"
        )

        backfill_holder_period_dates.execute()

        second_pass = frappe.db.get_value(
            "MSP Device Holder", {"parent": device, "parenttype": "MSP Managed Device"}, "from_date"
        )
        self.assertEqual(first_pass, second_pass)

    def test_a_device_that_already_has_a_start_date_is_left_alone(self):
        device = self.make_device(
            self.customer, hostname="BFD", holder=self.alice, serial="ZZTEST-SN-BFD"
        )
        before = frappe.db.get_value(
            "MSP Device Holder", {"parent": device, "parenttype": "MSP Managed Device"}, "from_date"
        )

        from nexgen_msp.patches import backfill_holder_period_dates

        backfill_holder_period_dates.execute()

        after = frappe.db.get_value(
            "MSP Device Holder", {"parent": device, "parenttype": "MSP Managed Device"}, "from_date"
        )
        self.assertEqual(before, after)
