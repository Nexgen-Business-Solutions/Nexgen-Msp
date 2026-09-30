"""Carrying a request out when what it names is still a Requested Client User or a Requested Device."""

import frappe

from nexgen_msp.api.internal.endpoints import v1
from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService
from nexgen_msp.api.internal.services.requested_entity_presentation import RequestedEntityPresentation
from nexgen_msp.utils.errors import ValidationError as Refused

from .writer_case import LINE, REQUESTED_CLIENT_USER, REQUESTED_DEVICE, WriterCase

WORK_ORDER = "MSP Work Order"


class RequestedWorkCase(WriterCase):
    """The writer's company, a technician, and requests dated today so the work can run now."""

    def setUp(self):
        super().setUp()
        self.tech = self.make_account("internal", "MSP Technician", suffix=f"rx{self.tag[:3]}")
        self.today = frappe.utils.today()

    def tearDown(self):
        frappe.set_user("Administrator")

        for name in frappe.get_all("MSP Managed Device", filters={"customer": self.customer}, pluck="name"):
            self.track("MSP Managed Device", name)

        super().tearDown()

    def as_tech(self, fn):
        return self.as_user(self.tech, fn)

    def approved(self, subjects, groups, requested_devices=None):
        out = self.send(
            priority="Medium",
            requested_date=self.today,
            subjects=subjects,
            requested_devices=requested_devices or [],
            action_groups=groups,
        )
        return self.decided(out["name"])

    def approved_lines(self, lines):
        out = self.send(requested_date=self.today, lines=lines)
        return self.decided(out["name"])

    def decided(self, name):
        self.as_tech(lambda: RequestService.run_action(name=name, action="start_review"))

        for row in frappe.get_doc("MSP Request", name).lines:
            self.as_tech(
                lambda idx=row.idx: RequestService.set_line_status(
                    name=name, idx=idx, line_status="Approved"
                )
            )

        self.as_tech(lambda: RequestService.run_action(name=name, action="approve"))

        return name

    def plan(self, name):
        return self.as_tech(lambda: RequestExecutionService.get_execution_plan(request=name))

    def cards(self, plan):
        return [card for group in plan["action_groups"] for card in group["work"]]

    def card(self, plan, code, service=None):
        return next(
            card
            for card in self.cards(plan)
            if card["operation_code"] == code and (service is None or card["service_item"] == service)
        )

    def requested(self, name, doctype=REQUESTED_CLIENT_USER):
        return frappe.get_all(doctype, filters={"request": name}, pluck="name")

    def transfer_to_marie(self, marie):
        return self.group(
            "grp:transfer",
            "device.transfer",
            [
                self.target(
                    self.existing(self.franck),
                    "Device",
                    managed_device=self.laptop,
                    current_holder=self.franck,
                    requested_holder_subject_key=marie["subject_key"],
                )
            ],
        )

    def execute(self, work_order, **inputs):
        return self.as_tech(
            lambda: RequestExecutionService.execute_work_orders(
                request=frappe.db.get_value(WORK_ORDER, work_order, "request"),
                executions=[{"work_order": work_order, "inputs": inputs}],
            )
        )


class TestThePlannedActionIsAlwaysVisible(RequestedWorkCase):
    """Spec 9.7: the requested operation never disappears because something is missing."""

    def test_a_service_missing_its_username_keeps_its_disabled_button_and_asks_for_the_username(self):
        name = self.approved(
            [self.existing(self.helen)],
            [self.group("grp:m365", "service.add", [self.target(self.existing(self.helen))], service=self.m365)],
        )

        card = self.card(self.plan(name), "service.add")

        self.assertEqual(card["display_status"], "Needs information")
        self.assertEqual(
            card["primary_action"], {"operation_code": "service.add", "label": "Add service", "enabled": False}
        )
        self.assertEqual(card["prerequisite_action"]["kind"], "complete_username")
        self.assertEqual(card["prerequisite_action"]["label"], "Complete username")
        self.assertIsNone(card["prerequisite_action"]["requested_entity"])
        self.assertEqual(card["dependency_label"], "Username required")

    def test_a_holder_change_towards_a_future_person_keeps_its_disabled_button_and_asks_for_the_holder(self):
        marie = self.marie()
        name = self.approved([marie, self.existing(self.franck)], [self.transfer_to_marie(marie)])
        rcu = self.requested(name)[0]

        plan = self.plan(name)
        card = self.card(plan, "device.transfer")

        self.assertEqual(card["display_status"], "Waiting for prerequisite")
        self.assertEqual(card["primary_action"]["label"], "Change holder")
        self.assertFalse(card["primary_action"]["enabled"])
        self.assertEqual(
            card["prerequisite_action"],
            {"kind": "prepare_holder", "label": "Prepare new holder", "requested_entity": rcu},
        )
        self.assertEqual(card["dependency_label"], "Requested holder must be resolved")
        self.assertEqual(card["relationship"]["to_label"], marie["full_name"])
        self.assertTrue(card["relationship"]["to_is_new"])
        self.assertIsNone(card["relationship"]["note"])
        self.assertNotIn("Destination is not yet a Client User", frappe.as_json(plan))
        self.assertEqual(card["target"]["kind"], "managed_device")
        self.assertIn("→", card["target"]["sublabel"])

    def test_a_ready_holder_change_offers_its_button_and_nothing_else(self):
        name = self.approved(
            [self.existing(self.franck), self.existing(self.helen)],
            [
                self.group(
                    "grp:transfer",
                    "device.transfer",
                    [
                        self.target(
                            self.existing(self.franck),
                            "Device",
                            managed_device=self.laptop,
                            current_holder=self.franck,
                            requested_holder=self.helen,
                        )
                    ],
                )
            ],
        )

        card = self.card(self.plan(name), "device.transfer")

        self.assertEqual(card["display_status"], "Ready")
        self.assertEqual(
            card["primary_action"], {"operation_code": "device.transfer", "label": "Change holder", "enabled": True}
        )
        self.assertIsNone(card["prerequisite_action"])
        self.assertIsNone(card["dependency_label"])
        self.assertFalse(card["relationship"]["to_is_new"])

    def test_every_card_carries_its_button_whatever_its_status(self):
        frappe.db.set_value("MSP Client User", self.helen, "username", f"zz.helen{self.tag[:4]}")
        marie = self.marie()
        name = self.approved(
            [marie, self.existing(self.helen), self.existing(self.franck)],
            [
                self.group(
                    "grp:m365",
                    "service.add",
                    [self.target(self.existing(self.helen)), self.target(marie)],
                    service=self.m365,
                ),
                self.transfer_to_marie(marie),
            ],
        )
        helen_card = next(
            card for card in self.cards(self.plan(name)) if card["target"]["name"] == self.helen
        )
        self.execute(helen_card["name"])

        plan = self.plan(name)
        statuses = {card["display_status"] for card in self.cards(plan)}

        self.assertEqual(statuses, {"Completed", "Waiting for prerequisite"})
        for card in self.cards(plan):
            self.assertTrue(card["primary_action"]["label"])
            self.assertTrue(card["primary_action"]["operation_code"])
            self.assertFalse(card["primary_action"]["enabled"])
            self.assertIn("requested_client_user", card)
            self.assertIn("requested_device", card)
            self.assertIn("requested_holder_requested_client_user", card)
            self.assertIn("relationship", card)
        self.assertNotIn("groups", plan)


class TestGroupedExecution(RequestedWorkCase):
    """Spec 9.8: twenty additions, twelve ready and eight waiting for a username."""

    def test_ready_work_runs_the_rest_waits_and_saved_usernames_survive_a_reload(self):
        people = [self.make_person(self.customer, f"G{index} {self.tag}") for index in range(20)]

        for index, person in enumerate(people[:12]):
            frappe.db.set_value("MSP Client User", person, "username", f"zz.g{index}.{self.tag[:4]}")
        frappe.db.commit()

        name = self.approved_lines(
            [
                {
                    "operation_code": "service.add",
                    "target_scope": "User",
                    "client_user": person,
                    "requested_service": self.m365,
                }
                for person in people
            ]
        )
        plan = self.plan(name)
        group = plan["action_groups"][0]

        self.assertEqual((group["ready"], group["needs_information"]), (12, 8))
        self.assertEqual(plan["preparation"]["missing_usernames"], 8)

        ready = [card["name"] for card in self.cards(plan) if card["display_status"] == "Ready"]
        missing = [card for card in self.cards(plan) if card["display_status"] == "Needs information"]

        out = self.as_tech(
            lambda: RequestExecutionService.execute_work_orders(
                request=name,
                executions=[{"work_order": order} for order in ready] + [{"work_order": missing[0]["name"]}],
            )
        )

        self.assertEqual((out["completed"], out["failed"]), (12, 1))
        refused = next(row for row in out["results"] if not row["ok"])
        self.assertEqual(refused["work_order"], missing[0]["name"])
        self.assertIn("username", refused["message"])
        self.assertEqual(
            frappe.db.count(WORK_ORDER, {"request": name, "status": "Completed"}), 12,
            "one refusal rolls back nobody else's work",
        )
        self.assertEqual(frappe.db.count("MSP Service Assignment", {"source_request": name}), 12)

        chosen = [card["target"]["name"] for card in missing[:3]]
        saved = self.as_tech(
            lambda: RequestExecutionService.save_required_identifiers(
                request=name,
                values=[
                    {"kind": "username", "owner": person, "value": f"zz.late{index}.{self.tag[:4]}"}
                    for index, person in enumerate(chosen)
                ],
            )
        )
        self.assertEqual(saved["saved"], 3)

        reopened = self.plan(name)
        waiting = [card for card in self.cards(reopened) if card["status"] != "Completed"]

        self.assertEqual(len(waiting), 8)
        self.assertEqual(
            {card["target"]["name"] for card in waiting if card["display_status"] == "Ready"}, set(chosen)
        )
        self.assertEqual(len([card for card in waiting if card["display_status"] == "Needs information"]), 5)
        self.assertEqual(reopened["preparation"]["missing_usernames"], 5)
        self.assertEqual(reopened["outcome"]["unresolved_accepted"], 8)


class TestAHolderChangeTowardsSomebodyNew(RequestedWorkCase):
    """Spec 9.9: Franck's laptop to Marie, who does not exist yet."""

    def test_blocked_before_resolution_enabled_after_and_the_line_still_names_the_requested_person(self):
        marie = self.marie()
        name = self.approved([marie, self.existing(self.franck)], [self.transfer_to_marie(marie)])
        rcu = self.requested(name)[0]
        order = self.card(self.plan(name), "device.transfer")["name"]

        with self.assertRaises(Refused) as refused:
            self.as_tech(lambda: RequestExecutionService.execute_device_operation(work_order=order))
        self.assertEqual(str(refused.exception.message), "Requested holder must be resolved")
        self.assertEqual(frappe.db.get_value("MSP Managed Device", self.laptop, "assigned_client_user"), self.franck)

        out = self.as_tech(lambda: v1.resolve_requested_client_user(name=rcu, mode="create"))
        created = out["entity"]["resolved_to"]["name"]
        card = self.card(out["plan"], "device.transfer")

        self.assertEqual(card["display_status"], "Ready")
        self.assertTrue(card["primary_action"]["enabled"])
        self.assertEqual(frappe.db.get_value(WORK_ORDER, order, "requested_holder"), created)

        self.as_tech(lambda: RequestExecutionService.execute_device_operation(work_order=order))

        self.assertEqual(frappe.db.get_value("MSP Managed Device", self.laptop, "assigned_client_user"), created)
        history = frappe.get_all(
            "MSP Device Holder",
            filters={"parent": self.laptop, "parenttype": "MSP Managed Device"},
            fields=["client_user", "is_current"],
            order_by="idx asc",
        )
        self.assertEqual([row.client_user for row in history][-2:], [self.franck, created])
        self.assertEqual([row.is_current for row in history][-2:], [0, 1])

        line = frappe.db.get_value(
            LINE,
            {"parent": name, "operation_code": "device.transfer"},
            ["requested_holder", "requested_holder_requested_client_user"],
            as_dict=True,
        )
        self.assertEqual(line.requested_holder_requested_client_user, rcu, "the line keeps the customer's words")
        self.assertIsNone(line.requested_holder)
        self.assertEqual(
            frappe.db.get_value(REQUESTED_CLIENT_USER, line.requested_holder_requested_client_user, "resolved_client_user"),
            created,
            "the real person is reached through the Requested Client User",
        )


    def test_somebody_who_only_receives_a_machine_has_a_view_of_their_own(self):
        marie = self.marie()
        name = self.approved([marie, self.existing(self.franck)], [self.transfer_to_marie(marie)])
        rcu = self.requested(name)[0]

        people = {row["subject_key"]: row for row in self.plan(name)["people"]}

        self.assertEqual(sorted(people), sorted([marie["subject_key"], f"user:{self.franck}"]))
        self.assertEqual(people[marie["subject_key"]]["requested_client_user"], rcu)
        self.assertTrue(people[marie["subject_key"]]["is_new"])
        self.assertIsNone(people[marie["subject_key"]]["client_user"])
        self.assertEqual(
            (people[marie["subject_key"]]["total"], people[marie["subject_key"]]["remaining"]), (1, 1)
        )

        out = self.as_tech(lambda: v1.resolve_requested_client_user(name=rcu, mode="create"))
        after = {row["subject_key"]: row for row in out["plan"]["people"]}

        self.assertEqual(sorted(after), sorted(people))
        self.assertEqual(
            after[marie["subject_key"]]["client_user"], out["entity"]["resolved_to"]["name"]
        )


class TestOneRequestedDeviceForSeveralActs(RequestedWorkCase):
    """Spec 9.10: one Requested Device assigned and given two services, resolved to a held machine."""

    def test_every_act_lands_on_the_same_machine_and_the_lifecycle_moves_it(self):
        backup = self.make_service(f"WB{self.tag[:3]}", scope="Device")
        self.cover_service(self.customer, backup)
        helen = self.existing(self.helen)
        laptop = self.new_laptop(intended_holder_subject_key=None, intended_holder_client_user=self.helen)
        on_it = {"device_requirement_key": "new-device:laptop"}
        name = self.approved(
            [helen],
            [
                self.group(
                    "grp:assign",
                    "device.assign",
                    [self.target(helen, "Device", requested_holder=self.helen, **on_it)],
                ),
                self.group("grp:sophos", "service.add", [self.target(helen, "Device", **on_it)], service=self.sophos),
                self.group("grp:backup", "service.add", [self.target(helen, "Device", **on_it)], service=backup),
            ],
            requested_devices=[laptop],
        )
        rdev = self.requested(name, REQUESTED_DEVICE)
        devices_before = frappe.db.count("MSP Managed Device", {"customer": self.customer})

        self.assertEqual(len(rdev), 1, "one Requested Device for three acts")
        self.assertEqual(
            {card["display_status"] for card in self.cards(self.plan(name))}, {"Waiting for prerequisite"}
        )

        out = self.as_tech(
            lambda: v1.resolve_requested_device(name=rdev[0], mode="existing", managed_device=self.laptop)
        )

        self.assertEqual(out["entity"]["resolved_to"]["name"], self.laptop)
        self.assertEqual(
            set(frappe.get_all(WORK_ORDER, filters={"request": name}, pluck="managed_device")),
            {self.laptop},
            "every dependent work order sees the same machine",
        )
        self.assertEqual(frappe.db.count("MSP Managed Device", {"customer": self.customer}), devices_before)
        self.assertEqual(frappe.db.get_value("MSP Managed Device", self.laptop, "assigned_client_user"), self.franck)

        assign = self.card(out["plan"], "device.assign")
        self.assertEqual(assign["relationship"]["from_label"], frappe.db.get_value("MSP Client User", self.franck, "full_name"))
        self.assertEqual(assign["display_status"], "Ready")

        self.execute(assign["name"])

        self.assertEqual(frappe.db.get_value("MSP Managed Device", self.laptop, "assigned_client_user"), self.helen)
        self.assertEqual(
            frappe.db.count("MSP Device Holder", {"parent": self.laptop, "client_user": self.franck, "is_current": 0}),
            1,
            "Franck's holding period was closed by the lifecycle, not overwritten",
        )

        for service in (self.sophos, backup):
            self.execute(self.card(self.plan(name), "service.add", service)["name"])

        running = frappe.get_all(
            "MSP Service Assignment", filters={"source_request": name}, pluck="managed_device"
        )
        self.assertEqual(running, [self.laptop, self.laptop])
        self.assertEqual(
            {line.requested_device for line in frappe.get_doc("MSP Request", name).lines}, {rdev[0]}
        )

    def test_a_machine_its_person_already_holds_is_settled_as_done(self):
        franck = self.existing(self.franck)
        name = self.approved(
            [franck],
            [
                self.group(
                    "grp:assign",
                    "device.assign",
                    [
                        self.target(
                            franck, "Device", device_requirement_key="new-device:laptop", requested_holder=self.franck
                        )
                    ],
                )
            ],
            requested_devices=[self.new_laptop(intended_holder_subject_key=None, intended_holder_client_user=self.franck)],
        )
        self.as_tech(
            lambda: RequestedDeviceService.resolve_existing(self.requested(name, REQUESTED_DEVICE)[0], self.laptop)
        )
        order = self.card(self.plan(name), "device.assign")["name"]
        spells = frappe.db.count("MSP Device Holder", {"parent": self.laptop})

        self.execute(order)

        self.assertEqual(frappe.db.get_value(WORK_ORDER, order, "status"), "Completed")
        self.assertEqual(frappe.db.count("MSP Device Holder", {"parent": self.laptop}), spells)


class TestResolvingTheRequestedPerson(RequestedWorkCase):
    def m365_for(self, subject):
        return self.group("grp:m365", "service.add", [self.target(subject)], service=self.m365)

    def test_create_opens_the_person_once_however_often_it_is_asked(self):
        marie = self.marie(username=f"zz.m{self.tag[:4]}")
        name = self.approved([marie], [self.m365_for(marie)])
        rcu = self.requested(name)[0]
        other = self.make_account("internal", "MSP Technician", suffix=f"ry{self.tag[:3]}")

        first = self.as_tech(lambda: RequestedClientUserService.resolve_create(rcu))
        second = self.as_user(other, lambda: RequestedClientUserService.resolve_create(rcu))

        self.assertEqual(first, second)
        self.assertEqual(frappe.db.count("MSP Client User", {"full_name": marie["full_name"]}), 1)
        self.assertEqual(frappe.db.get_value("MSP Client User", first, "username"), f"zz.m{self.tag[:4]}")

        card = self.card(self.plan(name), "service.add")
        self.assertEqual(card["display_status"], "Ready")
        self.assertEqual(card["client_user"], first)
        self.assertEqual(card["target"]["kind"], "client_user")
        self.assertEqual(card["target"]["requested_entity"], rcu)

        self.execute(card["name"])
        self.assertEqual(
            frappe.db.get_value("MSP Service Assignment", {"source_request": name}, "client_user"), first
        )
        self.assertEqual(frappe.db.get_value(LINE, {"parent": name}, "requested_client_user"), rcu)
        self.assertIsNone(frappe.db.get_value(LINE, {"parent": name}, "client_user"))

    def test_use_existing_points_the_work_at_the_chosen_person_and_brings_the_username(self):
        marie = self.marie()
        name = self.approved([marie], [self.m365_for(marie)])
        rcu = self.requested(name)[0]
        self.as_tech(
            lambda: RequestExecutionService.save_required_identifiers(
                request=name, values=[{"kind": "username", "owner": rcu, "value": f"zz.h{self.tag[:4]}"}]
            )
        )

        self.assertEqual(frappe.db.get_value(REQUESTED_CLIENT_USER, rcu, "username"), f"zz.h{self.tag[:4]}")
        self.assertFalse(frappe.db.get_value("MSP Client User", self.helen, "username"))

        out = self.as_tech(lambda: v1.resolve_requested_client_user(name=rcu, mode="existing", client_user=self.helen))

        self.assertEqual(out["entity"]["resolved_to"]["mode"], "Use Existing")
        self.assertEqual(frappe.db.get_value("MSP Client User", self.helen, "username"), f"zz.h{self.tag[:4]}")
        self.assertEqual(self.card(out["plan"], "service.add")["client_user"], self.helen)
        self.assertEqual(self.card(out["plan"], "service.add")["display_status"], "Ready")

        again = self.as_tech(lambda: RequestedClientUserService.resolve_existing(rcu, self.helen))
        self.assertEqual(again, self.helen)

        with self.assertRaises(Refused) as refused:
            self.as_tech(lambda: RequestedClientUserService.resolve_existing(rcu, self.franck))
        self.assertIn("already been resolved to a different record", str(refused.exception.message))

    def test_a_username_is_asked_of_the_work_and_never_of_the_resolution(self):
        marie = self.marie()
        name = self.approved([marie], [self.m365_for(marie)])
        rcu = self.requested(name)[0]

        before = self.card(self.plan(name), "service.add")
        kinds = {row["kind"]: row for row in before["requirements"]}
        self.assertEqual(set(kinds), {"requested_client_user", "username"})
        self.assertEqual(kinds["username"]["owner_type"], REQUESTED_CLIENT_USER)

        self.as_tech(lambda: RequestedClientUserService.mark_reviewed(rcu, {}))
        self.assertEqual(RequestedEntityPresentation.client_user(rcu)["readiness"], "ready")

        self.as_tech(lambda: RequestedClientUserService.resolve_create(rcu))
        after = self.card(self.plan(name), "service.add")

        self.assertEqual(after["display_status"], "Needs information")
        self.assertEqual(after["prerequisite_action"]["kind"], "complete_username")

        with self.assertRaises(Refused):
            self.execute_or_raise(after["name"])

    def execute_or_raise(self, order):
        return self.as_tech(lambda: RequestExecutionService.execute_service_action(work_order=order))

    def test_cancelling_the_person_cancels_what_depended_on_them_and_lets_the_file_close(self):
        frappe.db.set_value("MSP Client User", self.helen, "username", f"zz.hc{self.tag[:4]}")
        marie = self.marie()
        helen = self.existing(self.helen)
        name = self.approved(
            [marie, helen],
            [self.group("grp:m365", "service.add", [self.target(marie), self.target(helen)], service=self.m365)],
        )
        rcu = self.requested(name)[0]

        out = self.as_tech(lambda: v1.cancel_requested_client_user(name=rcu, reason="Marie will not join."))
        self.assertEqual(out["entity"]["status"], "Cancelled")

        mine = next(card for card in self.cards(out["plan"]) if card["requested_client_user"] == rcu)
        self.assertEqual(mine["status"], "Cancelled")

        self.execute(next(card for card in self.cards(out["plan"]) if card["client_user"] == self.helen)["name"])
        self.as_tech(lambda: RequestExecutionService.complete_request(request=name))

        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Completed")


class TestResolvingTheRequestedDevice(RequestedWorkCase):
    def sophos_on_a_new_laptop(self):
        helen = self.existing(self.helen)
        return self.approved(
            [helen],
            [
                self.group(
                    "grp:sophos",
                    "service.add",
                    [self.target(helen, "Device", device_requirement_key="new-device:laptop")],
                    service=self.sophos,
                )
            ],
            requested_devices=[self.new_laptop(intended_holder_subject_key=None, intended_holder_client_user=self.helen)],
        )

    def test_registering_keeps_the_serial_given_before_and_is_done_once(self):
        name = self.sophos_on_a_new_laptop()
        rdev = self.requested(name, REQUESTED_DEVICE)[0]
        serial = f"ZZTEST-RX-{self.tag}"

        before = self.card(self.plan(name), "service.add")
        serial_row = next(row for row in before["requirements"] if row["kind"] == "serial_number")
        self.assertEqual(serial_row["owner_type"], REQUESTED_DEVICE)

        saved = self.as_tech(
            lambda: RequestExecutionService.save_required_identifiers(
                request=name,
                values=[{"kind": "serial_number", "owner": rdev, "owner_type": REQUESTED_DEVICE, "value": serial}],
            )
        )
        self.assertEqual(saved["saved"], 1)
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, rdev, "serial_number"), serial)

        first = self.as_tech(
            lambda: v1.resolve_requested_device(name=rdev, mode="new", values=frappe.as_json({"hostname": f"ZZRX{self.tag[:4]}"}))
        )
        second = self.as_tech(lambda: RequestedDeviceService.resolve_new(rdev))
        device = first["entity"]["resolved_to"]["name"]

        self.assertEqual(second, device)
        self.assertEqual(frappe.db.count("MSP Managed Device", {"serial_number": serial}), 1)
        self.assertEqual(
            frappe.db.get_value("MSP Managed Device", device, ["status", "assigned_client_user"]), ("Active", self.helen)
        )
        self.assertEqual(frappe.db.count("MSP Device Holder", {"parent": device}), 1)

        card = self.card(first["plan"], "service.add")
        self.assertEqual((card["managed_device"], card["display_status"]), (device, "Ready"))

    def test_registering_records_the_network_interfaces_the_technician_read_off_the_machine(self):
        name = self.sophos_on_a_new_laptop()
        rdev = self.requested(name, REQUESTED_DEVICE)[0]

        created = self.as_tech(
            lambda: v1.resolve_requested_device(
                name=rdev,
                mode="new",
                values=frappe.as_json(
                    {"hostname": f"ZZNIC{self.tag[:4]}", "serial_number": f"ZZTEST-NIC-{self.tag}"}
                ),
                interfaces=frappe.as_json(
                    [
                        {"interface_type": "Wi-Fi", "mac_address": "AA:BB:CC:DD:EE:01"},
                        {"interface_type": "LAN", "mac_address": "AA:BB:CC:DD:EE:02"},
                    ]
                ),
            )
        )["entity"]["resolved_to"]["name"]

        rows = frappe.get_all(
            "MSP Network Interface",
            filters={"parent": created, "parenttype": "MSP Managed Device"},
            fields=["interface_type", "mac_address"],
            order_by="idx asc",
        )

        self.assertEqual(
            [(row.interface_type, row.mac_address) for row in rows],
            [("Wi-Fi", "AA:BB:CC:DD:EE:01"), ("LAN", "AA:BB:CC:DD:EE:02")],
        )

    def test_registering_without_interfaces_still_registers_the_machine(self):
        name = self.sophos_on_a_new_laptop()
        rdev = self.requested(name, REQUESTED_DEVICE)[0]

        created = self.as_tech(
            lambda: v1.resolve_requested_device(
                name=rdev,
                mode="new",
                values=frappe.as_json(
                    {"hostname": f"ZZNON{self.tag[:4]}", "serial_number": f"ZZTEST-NON-{self.tag}"}
                ),
            )
        )["entity"]["resolved_to"]["name"]

        self.assertTrue(frappe.db.exists("MSP Managed Device", created))
        self.assertEqual(
            frappe.db.count(
                "MSP Network Interface", {"parent": created, "parenttype": "MSP Managed Device"}
            ),
            0,
        )

    def test_a_failed_registration_leaves_no_machine_behind(self):
        from unittest.mock import patch

        from nexgen_msp.utils import request_targets

        name = self.sophos_on_a_new_laptop()
        rdev = self.requested(name, REQUESTED_DEVICE)[0]
        serial = f"ZZTEST-RB-{self.tag}"

        with patch.object(request_targets, "refresh_work_orders", side_effect=RuntimeError("refresh failed")):
            with self.assertRaises(RuntimeError):
                self.as_tech(
                    lambda: RequestedDeviceService.resolve_new(
                        rdev, {"hostname": f"ZZRB{self.tag[:4]}", "serial_number": serial}
                    )
                )

        self.assertFalse(frappe.db.exists("MSP Managed Device", {"serial_number": serial}))
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, rdev, "status"), "Open")
        self.assertIsNone(frappe.db.get_value(WORK_ORDER, {"request": name}, "managed_device"))

    def test_a_serial_already_on_another_machine_is_refused_on_the_requested_device(self):
        name = self.sophos_on_a_new_laptop()
        rdev = self.requested(name, REQUESTED_DEVICE)[0]
        taken = frappe.db.get_value("MSP Managed Device", self.laptop, "serial_number")

        out = self.as_tech(
            lambda: RequestExecutionService.save_required_identifiers(
                request=name, values=[{"kind": "serial_number", "owner": rdev, "value": taken}]
            )
        )

        self.assertEqual(out["failed"], 1)
        self.assertEqual(out["results"][0]["code"], "SERIAL_CONFLICT")
        self.assertFalse(frappe.db.get_value(REQUESTED_DEVICE, rdev, "serial_number"))


class TestRetryingChangesNothing(RequestedWorkCase):
    def test_building_twice_and_executing_twice(self):
        frappe.db.set_value("MSP Client User", self.helen, "username", f"zz.r{self.tag[:4]}")
        helen = self.existing(self.helen)
        marie = self.marie()
        name = self.approved(
            [marie, helen],
            [self.group("grp:m365", "service.add", [self.target(marie), self.target(helen)], service=self.m365)],
        )
        before = sorted(frappe.get_all(WORK_ORDER, filters={"request": name}, pluck="name"))

        self.as_tech(lambda: RequestExecutionService.build_execution_plan(request=name))
        self.assertEqual(sorted(frappe.get_all(WORK_ORDER, filters={"request": name}, pluck="name")), before)

        helen_card = next(card for card in self.cards(self.plan(name)) if card["client_user"] == self.helen)
        self.execute(helen_card["name"])

        with self.assertRaises(Refused) as refused:
            self.as_tech(lambda: RequestExecutionService.execute_service_action(work_order=helen_card["name"]))
        self.assertIn("already carried out", str(refused.exception.message))
        self.assertEqual(frappe.db.count("MSP Service Assignment", {"source_request": name}), 1)

        waiting = next(card for card in self.cards(self.plan(name)) if card["requested_client_user"])
        with self.assertRaises(Refused) as refused:
            self.as_tech(lambda: RequestExecutionService.execute_service_action(work_order=waiting["name"]))
        self.assertEqual(str(refused.exception.message), "Requested Client User must be resolved")


class TestARequestAlreadyInFlight(RequestedWorkCase):
    """Work orders of the two retired kinds, still open, finish when their Requested entity resolves."""

    def retired(self, name, work_type, **fields):
        return frappe.get_doc(
            {
                "doctype": WORK_ORDER,
                "plan_key": f"{name}:{frappe.generate_hash(length=8)}",
                "request": name,
                "customer": self.customer,
                "status": "Open",
                "work_type": work_type,
                **fields,
            }
        ).insert(ignore_permissions=True).name

    def test_the_retired_work_is_completed_by_the_resolution_and_the_file_closes(self):
        marie = self.marie(username=f"zz.f{self.tag[:4]}")
        name = self.approved(
            [marie],
            [
                self.group("grp:m365", "service.add", [self.target(marie)], service=self.m365),
                self.group(
                    "grp:sophos",
                    "service.add",
                    [self.target(marie, "Device", device_requirement_key="new-device:laptop")],
                    service=self.sophos,
                ),
            ],
            requested_devices=[self.new_laptop()],
        )
        rcu = self.requested(name)[0]
        rdev = self.requested(name, REQUESTED_DEVICE)[0]
        setup = self.retired(
            name, "User Setup", action="Create User", target_scope="User", subject_key="new:marie"
        )
        provisioning = self.retired(
            name,
            "Device Provisioning",
            action="Register Device",
            target_scope="Device",
            device_requirement_key="new-device:laptop",
            requested_device=rdev,
        )
        frappe.db.commit()

        plan = self.plan(name)
        self.assertNotIn(setup, [card["name"] for card in self.cards(plan)])
        self.assertEqual(plan["outcome"]["unresolved_accepted"], 4)

        with self.assertRaises(Refused) as refused:
            self.as_tech(lambda: RequestExecutionService.complete_request(request=name))
        self.assertIn("This Request cannot be completed while accepted work remains unresolved.", str(refused.exception.message))

        person = self.as_tech(lambda: RequestedClientUserService.resolve_create(rcu))
        device = self.as_tech(
            lambda: RequestedDeviceService.resolve_new(
                rdev, {"hostname": f"ZZIF{self.tag[:4]}", "serial_number": f"ZZTEST-IF-{self.tag}"}
            )
        )

        self.assertEqual(
            frappe.db.get_value(WORK_ORDER, setup, ["status", "resulting_client_user"]), ("Completed", person)
        )
        self.assertEqual(
            frappe.db.get_value(WORK_ORDER, provisioning, ["status", "resulting_device"]), ("Completed", device)
        )

        for card in self.cards(self.plan(name)):
            self.execute(card["name"])

        plan = self.as_tech(lambda: RequestExecutionService.complete_request(request=name))
        self.assertEqual(plan["status"], "Completed")


class TestTheOutcome(RequestedWorkCase):
    def test_the_figures_verify_and_final_validation_read(self):
        frappe.db.set_value("MSP Client User", self.helen, "username", f"zz.o{self.tag[:4]}")
        helen = self.existing(self.helen)
        marie = self.marie(username=f"zz.om{self.tag[:4]}")
        out = self.send(
            requested_date=self.today,
            subjects=[marie, helen, self.existing(self.franck)],
            requested_devices=[self.new_laptop()],
            action_groups=[
                self.group("grp:m365", "service.add", [self.target(marie), self.target(helen)], service=self.m365),
                self.group(
                    "grp:sophos",
                    "service.add",
                    [self.target(marie, "Device", device_requirement_key="new-device:laptop")],
                    service=self.sophos,
                ),
                self.transfer_to_marie(marie),
            ],
        )
        name = out["name"]
        lines = frappe.get_doc("MSP Request", name).lines
        self.as_tech(lambda: RequestService.run_action(name=name, action="start_review"))

        for row in lines:
            verdict = "Rejected" if row.operation_code == "device.transfer" else "Approved"
            self.as_tech(
                lambda idx=row.idx, verdict=verdict: RequestService.set_line_status(
                    name=name, idx=idx, line_status=verdict, reason="Not now" if verdict == "Rejected" else None
                )
            )
        self.as_tech(lambda: RequestService.run_action(name=name, action="approve"))

        rcu = self.requested(name)[0]
        self.as_tech(lambda: RequestedClientUserService.resolve_create(rcu))
        self.as_tech(
            lambda: RequestExecutionService.record_context_action(
                request=name, subject_key=f"user:{self.helen}", label="User information updated"
            )
        )

        for card in self.cards(self.plan(name)):
            if card["display_status"] == "Ready":
                self.execute(card["name"])

        outcome = self.plan(name)["outcome"]

        self.assertEqual(
            {key: outcome[key] for key in (
                "accepted", "rejected", "requested_done", "unresolved_accepted", "technician_added",
                "technician_done", "requested_client_users_total", "requested_client_users_resolved",
                "requested_devices_total", "requested_devices_resolved",
            )},
            {
                "accepted": 3,
                "rejected": 1,
                "requested_done": 2,
                "unresolved_accepted": 1,
                "technician_added": 1,
                "technician_done": 1,
                "requested_client_users_total": 1,
                "requested_client_users_resolved": 1,
                "requested_devices_total": 1,
                "requested_devices_resolved": 0,
            },
        )

        with self.assertRaises(Refused) as refused:
            self.as_tech(lambda: RequestExecutionService.complete_request(request=name))
        self.assertTrue(
            str(refused.exception.message).startswith(
                "This Request cannot be completed while accepted work remains unresolved."
            )
        )


class TestTheInternalCallsAreForNexgenOnly(RequestedWorkCase):
    """A customer account is refused on every internal call about Requested entities."""

    def test_a_customer_account_is_refused_everywhere(self):
        marie = self.marie()
        name = self.approved(
            [marie],
            [self.group("grp:m365", "service.add", [self.target(marie)], service=self.m365)],
            requested_devices=[self.new_laptop()],
        )
        rcu = self.requested(name)[0]
        rdev = self.requested(name, REQUESTED_DEVICE)[0]
        calls = {
            "get_requested_client_user": lambda: v1.get_requested_client_user(name=rcu),
            "save_requested_client_user": lambda: v1.save_requested_client_user(name=rcu, values="{}"),
            "resolve_requested_client_user": lambda: v1.resolve_requested_client_user(name=rcu, mode="create"),
            "cancel_requested_client_user": lambda: v1.cancel_requested_client_user(name=rcu, reason="No"),
            "get_requested_device": lambda: v1.get_requested_device(name=rdev),
            "save_requested_device": lambda: v1.save_requested_device(name=rdev, values="{}"),
            "resolve_requested_device": lambda: v1.resolve_requested_device(name=rdev, mode="existing", managed_device=self.laptop),
            "cancel_requested_device": lambda: v1.cancel_requested_device(name=rdev, reason="No"),
            "list_selectable_client_users": lambda: v1.list_selectable_client_users(customer=self.customer),
            "list_selectable_devices": lambda: v1.list_selectable_devices(customer=self.customer),
            "get_request_execution_plan": lambda: v1.get_request_execution_plan(name=name),
            "save_required_identifiers": lambda: v1.save_required_identifiers(
                request=name, values=frappe.as_json([{"kind": "username", "owner": rcu, "value": "x"}])
            ),
        }

        for label, call in calls.items():
            answer = self.as_manager(call)
            self.assertEqual((answer or {}).get("code"), "PERMISSION_DENIED", label)

        self.assertEqual(frappe.db.get_value(REQUESTED_CLIENT_USER, rcu, "status"), "Open")
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, rdev, "status"), "Open")
        self.assertFalse(frappe.db.get_value(REQUESTED_CLIENT_USER, rcu, "username"))

    def test_the_same_calls_answer_the_technician(self):
        marie = self.marie()
        name = self.approved(
            [marie],
            [self.group("grp:m365", "service.add", [self.target(marie)], service=self.m365)],
        )
        rcu = self.requested(name)[0]

        got = self.as_tech(lambda: v1.get_requested_client_user(name=rcu))
        saved = self.as_tech(
            lambda: v1.save_requested_client_user(name=rcu, values=frappe.as_json({"email": "marie@example.invalid"}))
        )
        people = self.as_tech(lambda: v1.list_selectable_client_users(customer=self.customer))

        self.assertEqual(got["entity"]["name"], rcu)
        self.assertEqual(got["requested_work"][0]["operation_code"], "service.add")
        self.assertEqual(saved["entity"]["prepared_values"]["email"], "marie@example.invalid")
        self.assertEqual(saved["entity"]["readiness"], "ready")
        self.assertEqual(saved["plan"]["request"], name)
        self.assertIn(self.helen, [row["name"] for row in people["rows"]])
        self.assertEqual((people["total"], people["truncated"]), (len(people["rows"]), False))


class TestAChangeCarriesItsReplacement(RequestedWorkCase):
    def test_the_generic_call_moves_the_service_onto_the_one_the_line_asked_for(self):
        from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService

        frappe.db.set_value("MSP Client User", self.helen, "username", f"zz.c{self.tag[:4]}")
        running = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.m365,
            target_scope="User",
            client_user=self.helen,
            effective_date=frappe.utils.add_days(self.today, -30),
        )["name"]
        wanted = self.make_service(f"WC{self.tag[:3]}", scope="User")
        self.cover_service(self.customer, wanted)
        name = self.approved_lines(
            [
                {
                    "operation_code": "service.change",
                    "target_scope": "User",
                    "client_user": self.helen,
                    "requested_service": wanted,
                    "source_service_assignment": running,
                }
            ]
        )
        card = self.card(self.plan(name), "service.change")

        self.assertEqual(card["replacement_service"], wanted)

        self.execute(card["name"])

        self.assertEqual(frappe.db.get_value("MSP Service Assignment", running, "operational_status"), "Ended")
        self.assertTrue(
            frappe.db.exists(
                "MSP Service Assignment",
                {"client_user": self.helen, "service_item": wanted, "operational_status": "Active"},
            )
        )
