import frappe

from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.user_360_service import User360Service
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import device_holders as holders

from .base import MSPTestCase


class TestServiceOwnershipQueries(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.alice = self.make_person(self.customer, "Alice")
        self.bob = self.make_person(self.customer, "Bob")

        self.device_service = self.make_service(f"OWNDEV{self.tag[:3]}", scope="Device")
        self.user_service = self.make_service(f"OWNUSR{self.tag[:3]}", scope="User")
        self.cover_service(self.customer, self.device_service)
        self.cover_service(self.customer, self.user_service)

        self.laptop = self.make_device(
            self.customer,
            hostname=f"OWNBOX{self.tag[:3]}",
            serial=f"SN-OWN-BOX-{self.tag}",
        )
        self.held_since = frappe.utils.add_days(frappe.utils.today(), -90)

        doc = frappe.get_doc("MSP Managed Device", self.laptop)
        holders.hand_over(doc, self.alice, on_date=self.held_since)
        doc.status = "Active"
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"own{self.tag}"
        )

    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def day(self, offset):
        return frappe.utils.add_days(frappe.utils.today(), offset)

    def open_device_service(self, started=-60):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.device_service,
            target_scope="Device",
            managed_device=self.laptop,
            effective_date=self.day(started),
        )
        name = outcome["name"]
        self.track("MSP Service Assignment", name)
        frappe.db.commit()

        return name

    def open_user_service(self, person, started=-60):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.user_service,
            target_scope="User",
            client_user=person,
            effective_date=self.day(started),
        )
        name = outcome["name"]
        self.track("MSP Service Assignment", name)
        frappe.db.commit()

        return name

    def internal_services(self, person):
        """What is theirs: their own services, open or closed. Never a machine's."""
        reading = User360Service.get_user(person)

        return reading["personal_services"]["current"] + User360Service.get_user_history(person)[
            "past_personal_services"
        ]

    def slots(self, person):
        return User360Service.get_user(person)["devices"]

    def internal_device_services(self, person):
        return [
            dict(service, hostname=slot["device"]["hostname"], device=slot["device"]["name"])
            for slot in self.slots(person)
            for service in slot["services"]["current"]
        ]

    def portal_services(self, person):
        return self.as_user(
            self.manager, lambda: PortalService.get_user_detail(person)
        )["personal_services"]["current"]

    def told(self, person):
        return [event["what"] for event in User360Service.get_user(person)["recent_activity"]]

    def item_name(self, service):
        return frappe.db.get_value("Item", service, "item_name")

    def test_an_open_device_service_is_read_under_the_new_holder_as_the_machines_own(self):
        name = self.open_device_service()

        DeviceLifecycleService.transfer(device=self.laptop, client_user=self.bob)
        frappe.db.commit()

        rows = [row for row in self.internal_device_services(self.bob) if row["name"] == name]

        self.assertEqual(len(rows), 1, "the machine he holds still runs it")
        self.assertEqual(rows[0]["device"], self.laptop)
        self.assertEqual(rows[0]["hostname"], f"ZZTEST-OWNBOX{self.tag[:3]}".upper())
        self.assertNotIn(
            name,
            [row["name"] for row in self.internal_services(self.bob)],
            "it is the machine's, and never becomes his own",
        )

        self.assertEqual(
            [row["name"] for row in self.internal_device_services(self.alice) if row["name"] == name],
            [],
            "she does not have the machine any more",
        )

        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", name, "managed_device"),
            self.laptop,
            "the assignment names the machine, and the machine has not changed",
        )
        self.assertIsNone(frappe.db.get_value("MSP Service Assignment", name, "client_user"))
        self.assertEqual(User360Service.get_user(self.alice)["devices"], [])
        self.assertIn(
            self.laptop,
            [
                row["name"]
                for row in User360Service.get_user_history(self.alice)["past_devices"]
            ],
        )

    def test_a_device_service_history_stays_visible_after_a_change_of_holder(self):
        name = self.open_device_service()
        ServiceLifecycleService.end(assignment=name, effective_date=self.day(-10))
        frappe.db.commit()

        self.assertTrue(
            any(
                f"ended on ZZTEST-OWNBOX{self.tag[:3]}".upper() in said.upper()
                for said in self.told(self.alice)
            ),
            "it ran on her machine while she had it, and her story says so",
        )

        DeviceLifecycleService.transfer(device=self.laptop, client_user=self.bob)
        frappe.db.commit()

        self.assertNotIn(
            name,
            [row["name"] for row in self.internal_services(self.bob)],
            "the machine's history must not become the holder's personal history",
        )

        slot = next(slot for slot in self.slots(self.bob) if slot["device"]["name"] == self.laptop)
        self.assertIn(
            name,
            [row["name"] for row in slot["services"]["history"]],
            "the MSP still needs the complete history of the machine the person holds",
        )

        ended = self.item_name(self.device_service)
        portal = self.as_user(
            self.manager, lambda: PortalService.get_user_detail(self.bob)
        )
        self.assertIn(
            ended,
            [row["service_name"] for row in portal["devices"][0]["services"]["history"]],
        )

        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", name, "operational_status"), "Ended"
        )
        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", name, "managed_device"), self.laptop
        )

    def test_a_device_taken_back_to_the_shelf_leaves_its_history_with_nobody(self):
        name = self.open_device_service()
        ServiceLifecycleService.end(assignment=name, effective_date=self.day(-10))
        DeviceLifecycleService.repossess(device=self.laptop)
        frappe.db.commit()

        self.assertNotIn(name, [row["name"] for row in self.internal_device_services(self.alice)])
        self.assertNotIn(name, [row["name"] for row in self.internal_device_services(self.bob)])

    def test_a_personal_service_is_untouched_by_anything_that_happens_to_a_machine(self):
        mine = self.open_user_service(self.bob)
        on_box = self.open_device_service()

        DeviceLifecycleService.transfer(device=self.laptop, client_user=self.bob)
        frappe.db.commit()

        rows = {row["name"]: row for row in self.internal_services(self.bob)}

        self.assertIn(mine, rows)
        self.assertNotIn(on_box, rows)
        self.assertIn(on_box, {row["name"] for row in self.internal_device_services(self.bob)})

        self.assertNotIn(mine, [row["name"] for row in self.internal_services(self.alice)])

        named = self.item_name(self.user_service)
        self.assertIn(named, [row["service_name"] for row in self.portal_services(self.bob)])
        self.assertNotIn(named, [row["service_name"] for row in self.portal_services(self.alice)])

    def test_a_closed_personal_service_stays_in_the_persons_own_history(self):
        mine = self.open_user_service(self.bob)
        ServiceLifecycleService.end(assignment=mine, effective_date=self.day(-10))
        frappe.db.commit()

        rows = {row["name"]: row for row in self.internal_services(self.bob)}

        self.assertIn(mine, rows, "what he had is his, closed or not")
        self.assertEqual(rows[mine]["operational_status"], "Ended")
        self.assertNotIn(
            mine,
            [row["name"] for row in User360Service.get_user(self.bob)["personal_services"]["current"]],
            "closed is not current",
        )

    def test_the_service_report_names_the_machine_and_never_a_stand_in_person(self):
        on_box = self.open_device_service()
        mine = self.open_user_service(self.bob)

        DeviceLifecycleService.transfer(device=self.laptop, client_user=self.bob)
        frappe.db.commit()

        def row_for(service_item, assignment):
            listed = self.as_user(
                self.manager,
                lambda: PortalService.list_service_rows(
                    customer=self.customer, service_item=service_item, page_length=200
                ),
            )
            found = [row for row in listed["rows"] if row["name"] == assignment]
            self.assertEqual(len(found), 1)

            return found[0]

        device_row = row_for(self.device_service, on_box)
        self.assertIsNone(device_row["client_user"], "a device line belongs to the device")
        self.assertEqual(device_row["device"], self.laptop)
        self.assertEqual(device_row["hostname"], f"ZZTEST-OWNBOX{self.tag[:3]}".upper())
        self.assertEqual(device_row["user_name"], "ZZTEST Bob", "the holder, as context")

        user_row = row_for(self.user_service, mine)
        self.assertEqual(user_row["client_user"], self.bob)
