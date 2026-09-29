import frappe

from nexgen_msp.api.internal.services.dashboard_service import DashboardService
from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService
from nexgen_msp.api.internal.services.user_360_service import User360Service
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService
from nexgen_msp.utils import export_columns, request_intents

from . import test_requested_execution as execution
from .writer_case import REQUEST, REQUESTED_DEVICE


class TestReadersFollowTheResolvedEntity(execution.RequestedWorkCase):
    """A line naming a Requested entity counts for the person or the machine it resolved to."""

    def m365_for_marie(self):
        marie = self.marie()
        name = self.approved([marie], [self.group("grp:m365", "service.add", [self.target(marie)], service=self.m365)])

        return name, self.requested(name)[0]

    def laptop_for_helen(self):
        helen = self.existing(self.helen)
        name = self.approved(
            [helen],
            [
                self.group(
                    "grp:assign",
                    "device.assign",
                    [
                        self.target(
                            helen,
                            "Device",
                            device_requirement_key="new-device:laptop",
                            requested_holder=self.helen,
                        )
                    ],
                )
            ],
            requested_devices=[
                self.new_laptop(intended_holder_subject_key=None, intended_holder_client_user=self.helen)
            ],
        )
        stock = self.make_device(self.customer, hostname=f"WS{self.tag[:4]}", serial=f"ZZTEST-WS-{self.tag}")

        return name, self.requested(name, REQUESTED_DEVICE)[0], stock

    def page(self, person):
        return self.as_tech(lambda: User360Service.get_user(person))

    def register_row(self, person):
        rows = self.as_tech(
            lambda: UserService.list_users(customer=self.customer, coverage="open_requests", page_length=100)
        )["rows"]

        return next((row for row in rows if row["name"] == person), None)

    def m365_add(self, person):
        out = self.as_manager(
            lambda: RequestScopeService.operation_options(
                customer=self.customer, subjects=[self.existing(person)]
            )
        )

        return next(
            (
                action
                for domain in out["domains"]
                for option in domain["options"]
                if option.get("object_key") == self.m365
                for action in option["actions"]
                if action["operation_code"] == "service.add"
            ),
            None,
        )

    def test_the_person_a_request_resolves_to_sees_it_and_counts_as_having_an_open_request(self):
        name, rcu = self.m365_for_marie()

        self.assertNotIn(name, [row["name"] for row in self.page(self.helen)["open_requests"]])
        self.assertIsNone(self.register_row(self.helen))

        self.as_tech(lambda: RequestedClientUserService.resolve_existing(rcu, self.helen))

        page = self.page(self.helen)
        self.assertEqual([row["name"] for row in page["open_requests"]], [name])
        self.assertEqual(page["summary"]["open_requests"], 1)
        self.assertEqual(len(page["open_requests"][0]["lines"]), 1)
        row = self.register_row(self.helen)
        self.assertIsNotNone(row)
        self.assertEqual(row["open_requests"], 1)
        self.assertIsNone(self.register_row(self.franck))

    def test_a_person_created_by_a_request_sees_it_on_their_page(self):
        name, rcu = self.m365_for_marie()

        created = self.as_tech(lambda: RequestedClientUserService.resolve_create(rcu))

        page = self.page(created)
        self.assertEqual([row["name"] for row in page["open_requests"]], [name])
        self.assertEqual(self.register_row(created)["open_requests"], 1)

    def test_a_second_request_for_the_same_service_on_the_resolved_person_is_excluded_and_refused(self):
        name, rcu = self.m365_for_marie()

        before = self.m365_add(self.helen)
        self.assertEqual([target["subject_key"] for target in before["targets"]], [f"user:{self.helen}"])
        self.assertEqual(
            request_intents.in_flight_additions_for(self.customer, self.m365, "User", self.helen), []
        )

        self.as_tech(lambda: RequestedClientUserService.resolve_existing(rcu, self.helen))

        self.assertIsNone(self.m365_add(self.helen))
        self.assertEqual(
            request_intents.in_flight_additions_for(self.customer, self.m365, "User", self.helen), [name]
        )

        requests = set(frappe.get_all(REQUEST, filters={"customer": self.customer}, pluck="name"))
        helen = self.existing(self.helen)

        with self.assertRaisesRegex(Exception, f"already been asked for on that target by request {name}"):
            self.send(
                requested_date=self.today,
                subjects=[helen],
                requested_devices=[],
                action_groups=[self.group("grp:m365", "service.add", [self.target(helen)], service=self.m365)],
            )

        self.assertEqual(set(frappe.get_all(REQUEST, filters={"customer": self.customer}, pluck="name")), requests)

    def test_the_machine_a_requested_device_resolves_to_shows_the_request_and_its_pending_hand_over(self):
        name, rd, stock = self.laptop_for_helen()

        reading = self.as_tech(lambda: DeviceService.get_device(stock))
        self.assertNotIn(name, [row["name"] for row in reading["requests"]])
        self.assertIsNone(reading["pending_operation"])
        self.assertIsNone(request_intents.pending_holder_request(stock))

        self.as_tech(lambda: RequestedDeviceService.resolve_existing(rd, stock))

        reading = self.as_tech(lambda: DeviceService.get_device(stock))
        self.assertEqual([row["name"] for row in reading["requests"]], [name])
        self.assertEqual(reading["pending_operation"]["request"], name)
        self.assertEqual(reading["pending_operation"]["operation_code"], "device.assign")
        self.assertEqual(request_intents.pending_holder_request(stock), name)
        self.assertIsNone(request_intents.pending_holder_request(stock, exclude=name))

    def test_a_second_hand_over_of_the_resolved_machine_is_refused(self):
        name, rd, stock = self.laptop_for_helen()
        self.as_tech(lambda: RequestedDeviceService.resolve_existing(rd, stock))

        requests = set(frappe.get_all(REQUEST, filters={"customer": self.customer}, pluck="name"))
        franck = self.existing(self.franck)

        with self.assertRaisesRegex(Exception, f"already has a pending holder change in request {name}"):
            self.send(
                requested_date=self.today,
                subjects=[franck],
                requested_devices=[],
                action_groups=[
                    self.group(
                        "grp:assign",
                        "device.assign",
                        [self.target(franck, "Device", managed_device=stock, requested_holder=self.franck)],
                    )
                ],
            )

        self.assertEqual(set(frappe.get_all(REQUEST, filters={"customer": self.customer}, pluck="name")), requests)

    def full_name(self, person):
        return frappe.db.get_value("MSP Client User", person, "full_name")

    def urgent_m365_for_marie(self):
        marie = self.marie()
        out = self.send(
            priority="Urgent",
            requested_date=self.today,
            subjects=[marie],
            requested_devices=[],
            action_groups=[self.group("grp:m365", "service.add", [self.target(marie)], service=self.m365)],
        )
        name = self.decided(out["name"])

        return name, self.requested(name)[0], marie["full_name"]

    def test_the_request_queue_finds_and_counts_the_person_a_request_resolved_to(self):
        name, rcu = self.m365_for_marie()
        helen = self.full_name(self.helen)

        def listed():
            return self.as_tech(lambda: RequestService.list_requests(search=helen, customer=self.customer))["rows"]

        def counted():
            return self.as_tech(lambda: RequestService.get_stats(search=helen, customer=self.customer))["open"]

        self.assertEqual((listed(), counted()), ([], 0))

        self.as_tech(lambda: RequestedClientUserService.resolve_existing(rcu, self.helen))

        rows = listed()
        self.assertEqual([row.name for row in rows], [name])
        self.assertEqual(rows[0].users, helen)
        self.assertEqual(counted(), 1)

    def test_the_dashboard_names_the_person_a_request_resolved_to(self):
        name, rcu, marie = self.urgent_m365_for_marie()
        helen = self.full_name(self.helen)

        def mine():
            board = self.as_tech(DashboardService.get_dashboard)
            return (
                [row.user_name for row in board["pending_lines"] if row.request == name],
                [row.users for row in board["queue"] if row.name == name],
            )

        self.assertEqual(mine(), ([marie], [marie]))

        self.as_tech(lambda: RequestedClientUserService.resolve_existing(rcu, self.helen))

        self.assertEqual(mine(), ([helen], [helen]))

    def test_the_people_export_counts_the_open_request_of_the_person_it_resolved_to(self):
        _name, rcu = self.m365_for_marie()

        def open_requests(person):
            rows = [{"name": person}]
            export_columns.fill_people_extras(rows)
            return rows[0]["open_requests"]

        self.assertEqual((open_requests(self.helen), open_requests(self.franck)), (0, 0))

        self.as_tech(lambda: RequestedClientUserService.resolve_existing(rcu, self.helen))

        self.assertEqual((open_requests(self.helen), open_requests(self.franck)), (1, 0))

    def test_the_portal_request_shows_the_machine_a_requested_device_resolved_to(self):
        name, rd, stock = self.laptop_for_helen()

        def line():
            return self.as_manager(lambda: PortalService.get_request(name))["lines"][0]

        self.assertEqual((line()["hostname"], line()["serial_number"]), (None, None))
        self.assertIsNone(line()["managed_device"])

        self.as_tech(lambda: RequestedDeviceService.resolve_existing(rd, stock))

        hostname, serial = frappe.db.get_value("MSP Managed Device", stock, ["hostname", "serial_number"])
        self.assertEqual((line()["hostname"], line()["serial_number"]), (hostname, serial))
        self.assertIsNone(line()["managed_device"])
        self.assertEqual(line()["requested_device"], rd)
