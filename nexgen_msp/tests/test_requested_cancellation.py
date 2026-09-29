"""A requested person or machine that will not come is cancelled from the work, and the rest of the request closes."""

import frappe

from nexgen_msp.api.internal.endpoints import v1
from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_presentation_service import RequestPresentationService
from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService
from nexgen_msp.utils.errors import ValidationError as Refused
from nexgen_msp.utils.request_targets import CANCELLED_TARGET

from .test_requested_execution import WORK_ORDER, RequestedWorkCase
from .writer_case import REQUESTED_CLIENT_USER, REQUESTED_DEVICE


class CancellationCase(RequestedWorkCase):
    def orders(self, name):
        return {
            (row.action_group_key, row.subject_key): row
            for row in frappe.get_all(
                WORK_ORDER,
                filters={"request": name, "work_type": ("in", ("Service Action", "Device Operation"))},
                fields=["name", "action_group_key", "subject_key", "status", "failure_reason"],
            )
        }

    def groups(self, plan):
        return {
            group["group_key"]: (group["total"], group["remaining"], group["ready"])
            for group in plan["action_groups"]
        }

    def people(self, plan):
        return {row["subject_key"]: (row["total"], row["remaining"]) for row in plan["people"]}

    def entity(self, plan, name):
        return next(row for row in plan["requested_entities"] if row["name"] == name)

    def portal(self, name):
        return self.as_manager(lambda: RequestPresentationService.for_portal(name))

    def targets(self, presentation):
        return {
            (group["group_key"], target["subject_key"]): target["work_cancelled"]
            for group in presentation["action_groups"]
            for target in group["targets"]
        }

    def tech_name(self):
        return frappe.db.get_value("User", self.tech, "full_name") or self.tech


class TestAPersonWhoWillNotCome(CancellationCase):
    def request(self):
        frappe.db.set_value("MSP Client User", self.helen, "username", f"zz.ch{self.tag[:4]}")
        marie = self.marie(username=f"zz.cm{self.tag[:4]}")
        helen = self.existing(self.helen)
        name = self.approved(
            [marie, helen, self.existing(self.franck)],
            [
                self.group(
                    "grp:m365",
                    "service.add",
                    [self.target(marie), self.target(helen)],
                    service=self.m365,
                    label="Add Microsoft 365",
                ),
                self.group(
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
                    label="Change holder",
                ),
            ],
        )

        return name, marie, self.requested(name)[0]

    def test_the_person_and_their_work_are_cancelled_the_rest_is_carried_out_and_the_file_closes(self):
        name, marie, rcu = self.request()
        mine = (("grp:m365", marie["subject_key"]), ("grp:transfer", f"user:{self.franck}"))
        before = self.plan(name)

        self.assertEqual(self.groups(before), {"grp:m365": (2, 2, 1), "grp:transfer": (1, 1, 0)})
        self.assertEqual(before["preparation"]["new_people"], 1)

        out = self.as_tech(lambda: v1.cancel_requested_client_user(name=rcu, reason="  Marie will not join.  "))
        plan = out["plan"]
        orders = self.orders(name)

        self.assertEqual(
            frappe.db.get_value(REQUESTED_CLIENT_USER, rcu, ["status", "cancel_reason", "cancelled_by"]),
            ("Cancelled", "Marie will not join.", self.tech),
        )
        for key in mine:
            self.assertEqual(
                (orders[key].status, orders[key].failure_reason),
                ("Cancelled", f"{CANCELLED_TARGET} Marie will not join."),
            )
        self.assertEqual(orders[("grp:m365", f"user:{self.helen}")].status, "Open")
        self.assertEqual(frappe.db.get_value("MSP Managed Device", self.laptop, "assigned_client_user"), self.franck)

        self.assertEqual(self.groups(plan), {"grp:m365": (2, 1, 1), "grp:transfer": (1, 0, 0)})
        self.assertEqual(
            self.people(plan),
            {marie["subject_key"]: (2, 0), f"user:{self.helen}": (1, 1), f"user:{self.franck}": (1, 0)},
        )
        self.assertEqual(
            {card["name"]: card["display_status"] for card in self.cards(plan)},
            {
                orders[mine[0]].name: "Cancelled",
                orders[mine[1]].name: "Cancelled",
                orders[("grp:m365", f"user:{self.helen}")].name: "Ready",
            },
        )
        self.assertEqual(plan["preparation"]["new_people"], 0)

        entity = self.entity(plan, rcu)
        self.assertEqual(
            (entity["status"], entity["badge"], entity["cancel_reason"], entity["cancelled_by"]),
            ("Cancelled", "CANCELLED", "Marie will not join.", self.tech_name()),
        )
        self.assertTrue(entity["cancelled_at"])
        self.assertEqual(out["entity"]["cancel_reason"], "Marie will not join.")

        cancelled = [entry for entry in plan["recap"] if entry["kind"] == "cancelled"]
        self.assertEqual(
            [
                (entry["work_order"], entry["subject_key"], entry["subject"], entry["title"], entry["detail"], entry["reason"], entry["by"])
                for entry in cancelled
            ],
            [
                (
                    rcu,
                    marie["subject_key"],
                    marie["full_name"],
                    "Requested Client User cancelled",
                    "Add Microsoft 365, Change holder",
                    "Marie will not join.",
                    self.tech_name(),
                )
            ],
        )

        outcome = plan["outcome"]
        self.assertEqual(
            {
                key: outcome[key]
                for key in (
                    "requested_done", "requested_cancelled", "unresolved_accepted",
                    "requested_client_users_total", "requested_client_users_resolved",
                    "requested_client_users_cancelled", "requested_devices_cancelled",
                )
            },
            {
                "requested_done": 0,
                "requested_cancelled": 2,
                "unresolved_accepted": 1,
                "requested_client_users_total": 0,
                "requested_client_users_resolved": 0,
                "requested_client_users_cancelled": 1,
                "requested_devices_cancelled": 0,
            },
        )

        with self.assertRaises(Refused):
            self.as_tech(lambda: RequestExecutionService.complete_request(request=name))

        self.execute(orders[("grp:m365", f"user:{self.helen}")].name)
        after = self.plan(name)

        self.assertEqual(self.groups(after), {"grp:m365": (2, 0, 0), "grp:transfer": (1, 0, 0)})
        self.assertEqual(after["stages"]["current"], "verify")
        self.assertEqual((after["outcome"]["requested_done"], after["outcome"]["unresolved_accepted"]), (1, 0))

        self.as_tech(lambda: RequestExecutionService.complete_request(request=name))

        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Completed")
        self.assertEqual(
            frappe.get_all(
                "MSP Service Assignment",
                filters={"source_request": name},
                fields=["client_user", "service_item", "operational_status"],
            ),
            [{"client_user": self.helen, "service_item": self.m365, "operational_status": "Active"}],
        )
        self.assertEqual(frappe.db.count("MSP Client User", {"customer": self.customer, "full_name": marie["full_name"]}), 0)
        self.assertEqual(frappe.db.get_value("MSP Managed Device", self.laptop, "assigned_client_user"), self.franck)

        presentation = self.portal(name)
        person = next(row for row in presentation["requested_entities"] if row["name"] == rcu)

        self.assertEqual((person["badge"], person["cancel_reason"]), ("CANCELLED", "Marie will not join."))
        self.assertEqual(
            self.targets(presentation),
            {
                ("grp:m365", marie["subject_key"]): True,
                ("grp:m365", f"user:{self.helen}"): False,
                ("grp:transfer", f"user:{self.franck}"): True,
            },
        )
        self.assertEqual(
            presentation["fulfilment_outcome"]["work"],
            {"completed": 1, "unresolved": 0, "cancelled": 2, "badge": "COMPLETED"},
        )
        self.assertEqual(
            [(row["display_name"], row["badge"], row["resolved_label"]) for row in presentation["fulfilment_outcome"]["entities"]],
            [(marie["full_name"], "CANCELLED", None)],
        )

    def test_without_a_reason_nothing_is_cancelled(self):
        name, _marie, rcu = self.request()
        before = {key: row.status for key, row in self.orders(name).items()}

        with self.assertRaises(Refused) as refused:
            self.as_tech(lambda: RequestExecutionService.cancel_requested(kind="client_user", name=rcu, reason="   "))

        self.assertEqual(refused.exception.message, "A reason is required to cancel.")
        self.assertEqual(frappe.db.get_value(REQUESTED_CLIENT_USER, rcu, ["status", "cancel_reason"]), ("Open", None))
        self.assertEqual({key: row.status for key, row in self.orders(name).items()}, before)
        self.assertEqual(set(before.values()), {"Open"})

    def test_a_person_already_created_cannot_be_cancelled(self):
        name, _marie, rcu = self.request()
        created = self.as_tech(lambda: v1.resolve_requested_client_user(name=rcu, mode="create"))["entity"]

        with self.assertRaises(Refused) as refused:
            self.as_tech(lambda: RequestExecutionService.cancel_requested(kind="client_user", name=rcu, reason="Too late"))

        self.assertEqual(refused.exception.message, "A resolved requested target cannot be cancelled.")
        self.assertEqual(
            frappe.db.get_value(REQUESTED_CLIENT_USER, rcu, ["status", "cancel_reason", "resolved_client_user"]),
            ("Resolved", None, created["resolved_to"]["name"]),
        )
        self.assertNotIn("Cancelled", {row.status for row in self.orders(name).values()})
        self.assertEqual([entry for entry in self.plan(name)["recap"] if entry["kind"] == "cancelled"], [])


class TestAMachineThatWillNotCome(CancellationCase):
    def test_the_machine_and_its_work_are_cancelled_the_person_keeps_their_service_and_the_file_closes(self):
        frappe.db.set_value("MSP Client User", self.helen, "username", f"zz.dh{self.tag[:4]}")
        helen = self.existing(self.helen)
        on_it = {"device_requirement_key": "new-device:laptop"}
        name = self.approved(
            [helen],
            [
                self.group("grp:m365", "service.add", [self.target(helen)], service=self.m365, label="Add Microsoft 365"),
                self.group(
                    "grp:sophos", "service.add", [self.target(helen, "Device", **on_it)], service=self.sophos, label="Add Sophos"
                ),
                self.group(
                    "grp:assign",
                    "device.assign",
                    [self.target(helen, "Device", requested_holder=self.helen, **on_it)],
                    label="Assign device",
                ),
            ],
            requested_devices=[self.new_laptop(intended_holder_subject_key=None, intended_holder_client_user=self.helen)],
        )
        rdev = self.requested(name, REQUESTED_DEVICE)[0]
        machines = frappe.db.count("MSP Managed Device", {"customer": self.customer})
        key = f"user:{self.helen}"

        self.assertEqual(
            self.groups(self.plan(name)), {"grp:m365": (1, 1, 1), "grp:sophos": (1, 1, 0), "grp:assign": (1, 1, 0)}
        )

        out = self.as_tech(lambda: v1.cancel_requested_device(name=rdev, reason="Out of stock"))
        plan = out["plan"]
        orders = self.orders(name)

        self.assertEqual(
            frappe.db.get_value(REQUESTED_DEVICE, rdev, ["status", "cancel_reason", "cancelled_by"]),
            ("Cancelled", "Out of stock", self.tech),
        )
        self.assertEqual(
            {group: orders[(group, key)].status for group in ("grp:m365", "grp:sophos", "grp:assign")},
            {"grp:m365": "Open", "grp:sophos": "Cancelled", "grp:assign": "Cancelled"},
        )
        self.assertEqual(orders[("grp:assign", key)].failure_reason, f"{CANCELLED_TARGET} Out of stock")
        self.assertEqual(
            self.groups(plan), {"grp:m365": (1, 1, 1), "grp:sophos": (1, 0, 0), "grp:assign": (1, 0, 0)}
        )
        self.assertEqual(self.people(plan), {key: (3, 1)})
        self.assertEqual(plan["preparation"]["unresolved_devices"], 0)

        entity = self.entity(plan, rdev)
        self.assertEqual(
            (entity["status"], entity["badge"], entity["cancel_reason"], entity["blocked_by"]),
            ("Cancelled", "CANCELLED", "Out of stock", None),
        )
        self.assertEqual(
            [
                (entry["work_order"], entry["subject_key"], entry["title"], entry["detail"], entry["reason"])
                for entry in plan["recap"]
                if entry["kind"] == "cancelled"
            ],
            [(rdev, None, "Requested Device cancelled", "Add Sophos, Assign device", "Out of stock")],
        )
        self.assertEqual(
            {
                field: plan["outcome"][field]
                for field in (
                    "requested_cancelled", "unresolved_accepted", "requested_devices_total",
                    "requested_devices_cancelled", "requested_client_users_cancelled",
                )
            },
            {
                "requested_cancelled": 2,
                "unresolved_accepted": 1,
                "requested_devices_total": 0,
                "requested_devices_cancelled": 1,
                "requested_client_users_cancelled": 0,
            },
        )

        with self.assertRaises(Refused):
            self.as_tech(lambda: RequestedDeviceService.resolve_existing(rdev, self.laptop))

        self.execute(orders[("grp:m365", key)].name)
        self.as_tech(lambda: RequestExecutionService.complete_request(request=name))

        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Completed")
        self.assertEqual(frappe.db.count("MSP Managed Device", {"customer": self.customer}), machines)
        self.assertEqual(frappe.db.get_value("MSP Managed Device", self.laptop, "assigned_client_user"), self.franck)
        self.assertEqual(
            frappe.get_all(
                "MSP Service Assignment",
                filters={"source_request": name},
                fields=["client_user", "service_item", "operational_status"],
            ),
            [{"client_user": self.helen, "service_item": self.m365, "operational_status": "Active"}],
        )

        presentation = self.portal(name)
        machine = next(row for row in presentation["requested_entities"] if row["name"] == rdev)

        self.assertEqual((machine["badge"], machine["cancel_reason"]), ("CANCELLED", "Out of stock"))
        self.assertEqual(
            self.targets(presentation),
            {("grp:m365", key): False, ("grp:sophos", key): True, ("grp:assign", key): True},
        )
        self.assertEqual(
            presentation["fulfilment_outcome"]["work"],
            {"completed": 1, "unresolved": 0, "cancelled": 2, "badge": "COMPLETED"},
        )


class TestAMachineForAPersonWhoWillNotCome(CancellationCase):
    def test_the_machine_is_prepared_for_nobody_and_its_own_work_is_carried_out(self):
        marie = self.marie(username=f"zz.nm{self.tag[:4]}")
        on_it = {"device_requirement_key": "new-device:laptop"}
        name = self.approved(
            [marie],
            [
                self.group("grp:m365", "service.add", [self.target(marie)], service=self.m365, label="Add Microsoft 365"),
                self.group(
                    "grp:sophos", "service.add", [self.target(marie, "Device", **on_it)], service=self.sophos, label="Add Sophos"
                ),
            ],
            requested_devices=[self.new_laptop()],
        )
        rcu = self.requested(name)[0]
        rdev = self.requested(name, REQUESTED_DEVICE)[0]
        shelf = self.make_device(self.customer, hostname=f"CN{self.tag[:4]}", serial=f"ZZTEST-CN-{self.tag}")

        self.assertEqual(self.entity(self.plan(name), rdev)["blocked_by"], {"name": rcu, "label": marie["full_name"]})

        plan = self.as_tech(lambda: v1.cancel_requested_client_user(name=rcu, reason="Hiring frozen"))["plan"]
        orders = self.orders(name)

        self.assertEqual(
            {group: orders[(group, marie["subject_key"])].status for group in ("grp:m365", "grp:sophos")},
            {"grp:m365": "Cancelled", "grp:sophos": "Open"},
        )
        self.assertIsNone(self.entity(plan, rdev)["blocked_by"])
        self.assertEqual(self.groups(plan), {"grp:m365": (1, 0, 0), "grp:sophos": (1, 1, 0)})
        self.assertEqual(
            next(card for card in self.cards(plan) if card["action_group_key"] == "grp:sophos")["display_status"],
            "Waiting for prerequisite",
        )

        out = self.as_tech(lambda: v1.resolve_requested_device(name=rdev, mode="existing", managed_device=shelf))
        sophos = next(card for card in self.cards(out["plan"]) if card["action_group_key"] == "grp:sophos")

        self.assertEqual((sophos["display_status"], sophos["managed_device"]), ("Ready", shelf))
        self.assertIsNone(frappe.db.get_value("MSP Managed Device", shelf, "assigned_client_user"))

        self.execute(sophos["name"])
        self.as_tech(lambda: RequestExecutionService.complete_request(request=name))

        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Completed")
        self.assertEqual(
            frappe.get_all(
                "MSP Service Assignment",
                filters={"source_request": name},
                fields=["managed_device", "service_item", "client_user"],
            ),
            [{"managed_device": shelf, "service_item": self.sophos, "client_user": None}],
        )
        final = self.plan(name)["outcome"]
        self.assertEqual(
            (final["requested_done"], final["requested_cancelled"], final["requested_devices_resolved"], final["requested_client_users_cancelled"]),
            (1, 1, 1, 1),
        )
