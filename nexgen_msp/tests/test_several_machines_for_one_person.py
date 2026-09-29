"""One person asked several machines in one request: each its own line, its own machine, its own work."""

import frappe

from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import request_intents
from nexgen_msp.utils.errors import ValidationError

from .test_requested_execution import WORK_ORDER, RequestedWorkCase
from .writer_case import REQUEST, REQUESTED_DEVICE

DEVICE = "MSP Managed Device"
TWICE = (
    "Assign device: this request asks for the same thing twice for the same person. "
    "Remove one of the two actions."
)


class SeveralMachinesCase(RequestedWorkCase):
    def setUp(self):
        super().setUp()
        self.shelf_one = self.make_device(self.customer, hostname=f"S1{self.tag[:4]}", serial=f"ZZTEST-S1-{self.tag}")
        self.shelf_two = self.make_device(self.customer, hostname=f"S2{self.tag[:4]}", serial=f"ZZTEST-S2-{self.tag}")

    def described(self, key, label, holder=None, subject_key=None):
        return {
            "device_requirement_key": key,
            "display_label": label,
            "device_type": "Laptop",
            "intended_holder_subject_key": subject_key,
            "intended_holder_client_user": holder,
        }

    def ask(self, group_key, subject, **machine):
        holder = (
            {"requested_holder_subject_key": subject["subject_key"]}
            if subject["kind"] == "new"
            else {"requested_holder": subject["client_user"]}
        )

        return self.group(
            group_key, "device.assign", [self.target(subject, "Device", **holder, **machine)], label="Assign Device"
        )

    def sophos_on(self, group_key, subject, key):
        return self.group(
            group_key, "service.add", [self.target(subject, "Device", device_requirement_key=key)], service=self.sophos
        )

    def lines(self, name):
        return frappe.get_doc(REQUEST, name).lines

    def machines_of(self, name):
        return {
            row.device_requirement_key: row.name
            for row in frappe.get_all(
                REQUESTED_DEVICE, filters={"request": name}, fields=["name", "device_requirement_key"]
            )
        }

    def refused(self, fn):
        with self.assertRaises(ValidationError) as caught:
            fn()

        return caught.exception.message


class TestEveryWayOfAskingIsItsOwnLine(SeveralMachinesCase):
    def test_two_new_machines_described_and_two_unsaid_are_four_lines_and_four_requested_devices(self):
        helen = self.existing(self.helen)
        name = self.send(
            requested_date=self.today,
            subjects=[helen],
            requested_devices=[
                self.described("new-device:one", "Laptop one", holder=self.helen),
                self.described("new-device:two", "Laptop two", holder=self.helen),
            ],
            action_groups=[
                self.ask("grp:one", helen, device_requirement_key="new-device:one"),
                self.ask("grp:two", helen, device_requirement_key="new-device:two"),
                self.ask("grp:unsaid1", helen),
                self.ask("grp:unsaid2", helen),
            ],
        )["name"]
        lines = self.lines(name)
        machines = self.machines_of(name)

        self.assertEqual(len(lines), 4)
        self.assertEqual(
            sorted(machines),
            sorted(
                [
                    "new-device:one",
                    "new-device:two",
                    f"new-device:grp:unsaid1:user:{self.helen}",
                    f"new-device:grp:unsaid2:user:{self.helen}",
                ]
            ),
        )
        self.assertEqual(sorted(row.requested_device for row in lines), sorted(machines.values()))
        self.assertEqual({(row.operation_code, row.requested_holder) for row in lines}, {("device.assign", self.helen)})

    def test_one_act_asking_two_unsaid_machines_for_one_person_mints_two(self):
        helen = self.existing(self.helen)
        target = self.target(helen, "Device", requested_holder=self.helen)
        group = self.group("grp:both", "device.assign", [dict(target), dict(target)], label="Assign Device")
        name = self.send(requested_date=self.today, subjects=[helen], action_groups=[group])["name"]
        machines = self.machines_of(name)

        self.assertEqual(len(self.lines(name)), 2)
        self.assertEqual(
            sorted(machines),
            sorted([f"new-device:grp:both:user:{self.helen}", f"new-device:grp:both:user:{self.helen}:2"]),
        )
        self.assertEqual(sorted(row.requested_device for row in self.lines(name)), sorted(machines.values()))

    def test_a_future_person_is_asked_two_machines_from_stock(self):
        marie = self.marie()
        name = self.send(
            requested_date=self.today,
            subjects=[marie],
            action_groups=[
                self.ask("grp:stock1", marie, managed_device=self.shelf_one),
                self.ask("grp:stock2", marie, managed_device=self.shelf_two),
            ],
        )["name"]
        lines = self.lines(name)
        rcu = self.requested(name)

        self.assertEqual(len(lines), 2)
        self.assertEqual(len(rcu), 1)
        self.assertEqual(sorted(row.managed_device for row in lines), sorted([self.shelf_one, self.shelf_two]))
        self.assertEqual({row.requested_holder_requested_client_user for row in lines}, {rcu[0]})
        self.assertEqual(self.machines_of(name), {})

    def test_one_new_one_from_stock_and_one_taken_from_somebody_are_three_lines(self):
        helen = self.existing(self.helen)
        name = self.send(
            requested_date=self.today,
            subjects=[helen],
            requested_devices=[self.described("new-device:one", "Laptop one", holder=self.helen)],
            action_groups=[
                self.ask("grp:one", helen, device_requirement_key="new-device:one"),
                self.ask("grp:stock", helen, managed_device=self.shelf_one),
                self.ask("grp:taken", helen, managed_device=self.laptop),
            ],
        )["name"]
        lines = self.lines(name)

        self.assertEqual(len(lines), 3)
        self.assertEqual(len(self.machines_of(name)), 1)
        self.assertEqual(
            sorted((row.operation_code, row.managed_device or row.requested_device) for row in lines),
            sorted(
                [
                    ("device.assign", self.machines_of(name)["new-device:one"]),
                    ("device.assign", self.shelf_one),
                    ("device.transfer", self.laptop),
                ]
            ),
        )
        self.assertEqual({row.requested_holder for row in lines}, {self.helen})


class TestKeysSurviveDraftsAndModifications(SeveralMachinesCase):
    def two_laptops_each_with_sophos(self, subject):
        return {
            "requested_date": self.today,
            "subjects": [subject],
            "requested_devices": [
                self.described("new-device:one", "Laptop one", holder=subject["client_user"]),
                self.described("new-device:two", "Laptop two", holder=subject["client_user"]),
            ],
            "action_groups": [
                self.ask("grp:one", subject, device_requirement_key="new-device:one"),
                self.ask("grp:two", subject, device_requirement_key="new-device:two"),
                self.ask("grp:unsaid1", subject),
                self.ask("grp:unsaid2", subject),
                self.sophos_on("grp:sophos1", subject, "new-device:one"),
                self.sophos_on("grp:sophos2", subject, "new-device:two"),
            ],
        }

    def test_a_draft_saved_reopened_and_sent_keeps_every_machine_and_its_name(self):
        name = self.save(**self.two_laptops_each_with_sophos(self.existing(self.helen)))["name"]
        drafted = self.machines_of(name)

        self.assertEqual(len(drafted), 4)
        self.assertEqual(len(self.lines(name)), 6)

        sent = self.send(name=name, **self.payload_of(self.reopen(name)))
        lines = self.lines(name)

        self.assertEqual(sent["name"], name)
        self.assertNotEqual(frappe.db.get_value(REQUEST, name, "status"), "Draft")
        self.assertEqual(self.machines_of(name), drafted, "sending renames no machine")
        self.assertEqual(len(lines), 6)
        self.assertEqual(
            sorted(row.requested_device for row in lines if row.operation_code == "device.assign"),
            sorted(drafted.values()),
        )
        self.assertEqual(
            sorted(row.requested_device for row in lines if row.operation_code == "service.add"),
            sorted([drafted["new-device:one"], drafted["new-device:two"]]),
        )

    def test_removing_one_of_two_machines_after_sending_leaves_the_other_whole(self):
        name = self.send(**self.two_laptops_each_with_sophos(self.existing(self.helen)))["name"]
        before = self.machines_of(name)
        unsaid_one = f"new-device:grp:unsaid1:user:{self.helen}"
        unsaid_two = f"new-device:grp:unsaid2:user:{self.helen}"
        reopened = self.payload_of(self.reopen(name))
        reopened["action_groups"] = [
            group
            for group in reopened["action_groups"]
            if group["group_key"] not in ("grp:two", "grp:sophos2", "grp:unsaid2")
        ]
        reopened["requested_devices"] = [
            row
            for row in reopened["requested_devices"]
            if row["device_requirement_key"] not in ("new-device:two", unsaid_two)
        ]

        self.as_manager(lambda: PortalService.update_request(name=name, **reopened))

        lines = self.lines(name)

        self.assertEqual(len(before), 4)
        self.assertEqual(self.machines_of(name), {key: before[key] for key in ("new-device:one", unsaid_one)})
        self.assertEqual(len(lines), 3)
        self.assertEqual(
            sorted((row.operation_code, row.requested_device) for row in lines),
            sorted(
                [
                    ("device.assign", before["new-device:one"]),
                    ("device.assign", before[unsaid_one]),
                    ("service.add", before["new-device:one"]),
                ]
            ),
        )
        self.assertFalse(frappe.db.exists(REQUESTED_DEVICE, before["new-device:two"]))
        self.assertFalse(frappe.db.exists(REQUESTED_DEVICE, before[unsaid_two]))


class TestTheSameMachineIsNeverAskedTwice(SeveralMachinesCase):
    def requests(self):
        return frappe.db.count(REQUEST, {"customer": self.customer})

    def test_the_same_machine_asked_twice_is_refused_and_nothing_is_written(self):
        helen, franck = self.existing(self.helen), self.existing(self.franck)
        hostname = frappe.db.get_value(DEVICE, self.shelf_one, "hostname")
        described = [self.described("new-device:one", "Laptop one", holder=self.helen)]
        cases = (
            ("two people, one stock machine", [helen, franck], [], "managed_device", self.shelf_one,
             f"{hostname}: {request_intents.ONE_DESTINATION}"),
            ("two people, one described machine", [helen, franck], described, "device_requirement_key",
             "new-device:one", f"Laptop one: {request_intents.ONE_DESTINATION}"),
            ("one person, one stock machine twice", [helen, helen], [], "managed_device", self.shelf_one, TWICE),
            ("one person, one described machine twice", [helen, helen], described, "device_requirement_key",
             "new-device:one", TWICE),
        )
        before = self.requests()

        for label, (first, second), machines, field, value, expected in cases:
            with self.subTest(label):
                message = self.refused(
                    lambda: self.send(
                        requested_date=self.today,
                        subjects=list({row["subject_key"]: row for row in (first, second)}.values()),
                        requested_devices=machines,
                        action_groups=[
                            self.ask("grp:first", first, **{field: value}),
                            self.ask("grp:again", second, **{field: value}),
                        ],
                    )
                )

                self.assertEqual(message, expected)
                self.assertEqual(self.requests(), before)


class TestAtNexgenEachMachineIsItsOwnWork(SeveralMachinesCase):
    def cards_of(self, plan, code):
        return [card for card in self.cards(plan) if card["operation_code"] == code]

    def holder(self, device):
        return frappe.db.get_value(DEVICE, device, "assigned_client_user")

    def test_two_requested_machines_of_one_person_are_prepared_apart_and_both_reach_her(self):
        helen = self.existing(self.helen)
        name = self.approved(
            [helen],
            [
                self.ask("grp:one", helen, device_requirement_key="new-device:one"),
                self.ask("grp:two", helen, device_requirement_key="new-device:two"),
            ],
            requested_devices=[
                self.described("new-device:one", "Laptop one", holder=self.helen),
                self.described("new-device:two", "Laptop two", holder=self.helen),
            ],
        )
        machines = self.machines_of(name)
        assigns = self.cards_of(self.plan(name), "device.assign")

        self.assertEqual(len(self.lines(name)), 2)
        self.assertEqual(len(machines), 2)
        self.assertEqual(len(assigns), 2)
        self.assertEqual(frappe.db.count(WORK_ORDER, {"request": name}), 2)
        self.assertEqual({card["display_status"] for card in assigns}, {"Waiting for prerequisite"})

        values = {"hostname": f"ZZN1{self.tag[:4]}", "serial_number": f"ZZTEST-N1-{self.tag}"}
        registered = self.as_tech(lambda: RequestedDeviceService.resolve_new(machines["new-device:one"], values))

        self.assertEqual(
            frappe.db.get_value(REQUESTED_DEVICE, machines["new-device:one"], "status"), "Resolved"
        )
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, machines["new-device:two"], "status"), "Open")
        self.assertIsNone(self.holder(registered), "the line hands it over when its work runs")

        self.as_tech(lambda: RequestedDeviceService.resolve_existing(machines["new-device:two"], self.shelf_one))

        self.assertIsNone(self.holder(self.shelf_one))
        self.assertEqual(
            frappe.db.get_value(REQUESTED_DEVICE, machines["new-device:two"], ["status", "resolved_managed_device"]),
            ("Resolved", self.shelf_one),
        )

        for card in self.cards_of(self.plan(name), "device.assign"):
            self.execute(card["name"])

        orders = frappe.get_all(
            WORK_ORDER, filters={"request": name}, fields=["status", "managed_device"], order_by="managed_device"
        )

        self.assertEqual(len(orders), 2)
        self.assertEqual({row.status for row in orders}, {"Completed"})
        self.assertEqual(sorted(row.managed_device for row in orders), sorted([registered, self.shelf_one]))
        self.assertEqual(
            sorted(frappe.get_all(DEVICE, filters={"assigned_client_user": self.helen}, pluck="name")),
            sorted([registered, self.shelf_one]),
        )

    def test_a_future_person_receives_both_unsaid_machines_once_created(self):
        marie = self.marie()
        name = self.approved([marie], [self.ask("grp:one", marie), self.ask("grp:two", marie)])
        machines = self.machines_of(name)
        rcu = self.requested(name)[0]

        self.assertEqual(len(self.lines(name)), 2)
        self.assertEqual(len(machines), 2)
        self.assertEqual(frappe.db.count(WORK_ORDER, {"request": name}), 2)

        person = self.as_tech(lambda: RequestedClientUserService.resolve_create(rcu))
        first, second = sorted(machines.values())
        one = self.as_tech(
            lambda: RequestedDeviceService.resolve_new(
                first, {"hostname": f"ZZM1{self.tag[:4]}", "serial_number": f"ZZTEST-M1-{self.tag}"}
            )
        )

        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, first, "status"), "Resolved")
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, second, "status"), "Open")

        two = self.as_tech(
            lambda: RequestedDeviceService.resolve_new(
                second, {"hostname": f"ZZM2{self.tag[:4]}", "serial_number": f"ZZTEST-M2-{self.tag}"}
            )
        )

        self.assertNotEqual(one, two)
        self.assertEqual(frappe.get_all(DEVICE, filters={"assigned_client_user": person}, pluck="name"), [])

        for card in self.cards_of(self.plan(name), "device.assign"):
            self.execute(card["name"])

        self.assertEqual(
            sorted(frappe.get_all(WORK_ORDER, filters={"request": name}, pluck="status")), ["Completed", "Completed"]
        )
        self.assertEqual(
            sorted(frappe.get_all(DEVICE, filters={"assigned_client_user": person}, pluck="name")),
            sorted([one, two]),
        )
