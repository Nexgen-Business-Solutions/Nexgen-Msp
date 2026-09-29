"""The requester modifies a request already sent, until the work on it starts."""

import frappe

from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.portal.endpoints import v1 as portal
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import request_intents
from nexgen_msp.utils.errors import NotFoundError, ValidationError

from .test_requested_execution import RequestedWorkCase
from .writer_case import LINE, REQUEST, REQUESTED_CLIENT_USER, REQUESTED_DEVICE

NOT_THE_REQUESTER = "Only the person who raised this request can modify it."
LOCKED = "This request can no longer be modified: work on it has started."
NOT_STARTED = "Start work on this request before deciding its lines."
DECIDED = "The lines of this request have already been decided."
MODIFIED = "Modified by the requester"


class ModificationCase(RequestedWorkCase):
    def setUp(self):
        super().setUp()
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"wq{self.tag[:3]}"
        )
        self.grant(self.asker, can_submit=1, can_approve=0)

    def raise_as(self, user, payload):
        out = self.as_user(user, lambda: PortalService.create_request(customer=self.customer, **payload))
        self.track(REQUEST, out["name"])

        return out["name"]

    def read(self, name, user):
        return self.as_user(user, lambda: PortalService.get_request(name))

    def modify(self, name, user, payload):
        return self.as_user(user, lambda: PortalService.update_request(name=name, **payload))

    def reopened(self, name, user):
        return self.payload_of(self.read(name, user))

    def refused(self, fn):
        with self.assertRaises(ValidationError) as caught:
            fn()

        return caught.exception

    def comments(self, name):
        return frappe.db.count(
            "Comment",
            {"reference_doctype": REQUEST, "reference_name": name, "content": MODIFIED},
        )

    def state(self, name):
        """Every row the request is made of, as the database holds it."""
        doc = frappe.get_doc(REQUEST, name)

        return {
            "request": {
                field: doc.get(field)
                for field in (
                    "status",
                    "priority",
                    "details",
                    "requested_date",
                    "request_type",
                    "requester",
                    "source",
                    "creation",
                    "modified",
                    "customer_approved_by",
                    "customer_approved_at",
                )
            },
            "lines": [row.as_dict() for row in doc.lines],
            "subjects": [row.as_dict() for row in doc.get("subjects")],
            "action_groups": [row.as_dict() for row in doc.get("action_groups")],
            "people": frappe.get_all(
                REQUESTED_CLIENT_USER, filters={"request": name}, fields=["*"], order_by="name asc"
            ),
            "machines": frappe.get_all(
                REQUESTED_DEVICE, filters={"request": name}, fields=["*"], order_by="name asc"
            ),
            "comments": self.comments(name),
        }

    def asked(self, name):
        return sorted(
            (
                row.operation_code,
                row.requested_service or "",
                row.client_user or "",
                row.requested_client_user or "",
                row.requested_device or "",
                row.managed_device or "",
            )
            for row in frappe.get_doc(REQUEST, name).lines
        )

    def rewritten(self, payload):
        """Helen joins Microsoft 365, Sophos is dropped, and the details and priority change."""
        helen = self.existing(self.helen)

        for group in payload["action_groups"]:
            if group["group_key"] == "grp:m365":
                group["targets"] = [*group["targets"], self.target(helen)]
                group["exclusions"] = []

        payload["action_groups"] = [
            group for group in payload["action_groups"] if group["group_key"] != "grp:sophos"
        ]
        payload["priority"] = "Low"
        payload["details"] = "Marie starts on Tuesday."

        return payload

    def helen_only(self):
        helen = self.existing(self.helen)

        return {
            "priority": "Medium",
            "details": None,
            "requested_date": self.today,
            "subjects": [helen],
            "requested_devices": [],
            "action_groups": [self.group("grp:m365", "service.add", [self.target(helen)], service=self.m365)],
        }

    def work_order(self, name):
        doc = frappe.get_doc(
            {
                "doctype": "MSP Work Order",
                "customer": self.customer,
                "request": name,
                "work_type": "Context Action",
                "action": "",
                "origin": "Technician",
                "activity_label": "ZZTEST context",
                "status": "Open",
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()

        return self.track("MSP Work Order", doc.name)


class TestTheRequesterModifiesWhatTheySent(ModificationCase):
    def assert_modified_in_place(self, name, user):
        before = self.state(name)
        lines_before = self.asked(name)
        marie = frappe.get_all(REQUESTED_CLIENT_USER, filters={"request": name}, pluck="name")
        laptop = frappe.get_all(REQUESTED_DEVICE, filters={"request": name}, pluck="name")
        self.assertEqual((len(marie), len(laptop)), (1, 1))
        self.assertIsNone(self.as_user(user, lambda: portal.get_request_presentation(name=name))["request"]["modified"])

        out = self.modify(name, user, self.rewritten(self.reopened(name, user)))
        after = self.state(name)

        self.assertEqual(out["name"], name)
        self.assertEqual(frappe.db.count(REQUEST, {"customer": self.customer}), 1)
        for field in ("status", "requester", "source", "creation", "customer_approved_by", "customer_approved_at"):
            self.assertEqual(after["request"][field], before["request"][field], field)
        self.assertEqual(out["status"], before["request"]["status"])
        self.assertEqual((after["request"]["priority"], after["request"]["details"]), ("Low", "Marie starts on Tuesday."))
        self.assertEqual((before["request"]["priority"], before["request"]["details"]), ("High", "Marie starts on Monday."))

        lines_after = self.asked(name)
        self.assertNotEqual(lines_after, lines_before)
        self.assertEqual(
            sorted(row[0] for row in lines_after),
            ["device.assign", "device.transfer", "service.add", "service.add"],
        )
        self.assertIn(("service.add", self.m365, self.helen, "", "", ""), lines_after)
        self.assertNotIn(self.sophos, [row[1] for row in lines_after])
        self.assertIn(self.sophos, [row[1] for row in lines_before])
        self.assertEqual(
            sorted(group.group_key for group in frappe.get_doc(REQUEST, name).action_groups),
            ["grp:assign", "grp:m365", "grp:transfer"],
        )
        self.assertTrue(all(row.line_status == "Pending" for row in frappe.get_doc(REQUEST, name).lines))

        self.assertEqual(frappe.get_all(REQUESTED_CLIENT_USER, filters={"request": name}, pluck="name"), marie)
        self.assertEqual(frappe.get_all(REQUESTED_DEVICE, filters={"request": name}, pluck="name"), laptop)

        self.assertEqual((before["comments"], after["comments"]), (0, 1))
        modified = self.as_user(user, lambda: portal.get_request_presentation(name=name))["request"]["modified"]
        self.assertEqual(modified["by_name"], frappe.db.get_value("User", user, "full_name"))
        self.assertTrue(modified["at"])

        return before, after

    def test_a_request_awaiting_approval_is_modified_and_still_awaits_it(self):
        name = self.raise_as(self.asker, self.scenario())
        self.assertEqual(frappe.db.get_value(REQUEST, name, "status"), "Awaiting Customer Approval")

        self.grant(self.asker, can_submit=1, can_approve=1)
        _, after = self.assert_modified_in_place(name, self.asker)

        self.assertEqual(after["request"]["status"], "Awaiting Customer Approval")
        self.assertIsNone(after["request"]["customer_approved_by"])
        self.assertIsNone(after["request"]["customer_approved_at"])

    def test_a_submitted_request_is_modified_and_stays_submitted(self):
        name = self.raise_as(self.manager, self.scenario())
        self.assertEqual(frappe.db.get_value(REQUEST, name, "status"), "Submitted")

        before, after = self.assert_modified_in_place(name, self.manager)

        self.assertEqual(after["request"]["status"], "Submitted")
        self.assertEqual(before["request"]["customer_approved_by"], self.manager)
        self.assertTrue(before["request"]["customer_approved_at"])
        self.assertEqual(after["request"]["customer_approved_by"], self.manager)
        self.assertEqual(after["request"]["customer_approved_at"], before["request"]["customer_approved_at"])

    def test_the_endpoint_answers_with_the_request_detail(self):
        name = self.raise_as(self.manager, self.scenario())
        payload = self.rewritten(self.reopened(name, self.manager))

        out = self.as_manager(
            lambda: portal.update_request(
                name=name,
                customer=self.customer,
                **{key: frappe.as_json(value) if isinstance(value, list) else value for key, value in payload.items()},
            )
        )

        self.assertEqual(out["name"], name)
        self.assertEqual(out["status"], "Submitted")
        self.assertEqual(out["priority"], "Low")
        self.assertTrue(out["can_edit"])
        self.assertEqual(len(out["lines"]), 4)


class TestRequestedRecordsFollowTheModification(ModificationCase):
    def test_future_people_and_machines_are_created_kept_and_removed(self):
        name = self.raise_as(self.manager, self.helen_only())
        self.assertEqual((self.count(REQUESTED_CLIENT_USER, name), self.count(REQUESTED_DEVICE, name)), (0, 0))

        marie = self.marie()
        helen = self.existing(self.helen)
        grown = {
            **self.helen_only(),
            "subjects": [helen, marie],
            "requested_devices": [self.new_laptop()],
            "action_groups": [
                self.group("grp:m365", "service.add", [self.target(helen), self.target(marie)], service=self.m365),
                self.group(
                    "grp:assign",
                    "device.assign",
                    [
                        self.target(
                            marie,
                            "Device",
                            device_requirement_key="new-device:laptop",
                            requested_holder_subject_key="new:marie",
                        )
                    ],
                ),
            ],
        }
        self.modify(name, self.manager, grown)

        people = frappe.get_all(REQUESTED_CLIENT_USER, filters={"request": name}, pluck="name")
        machines = frappe.get_all(REQUESTED_DEVICE, filters={"request": name}, pluck="name")
        self.assertEqual((len(people), len(machines)), (1, 1))
        lines = frappe.get_doc(REQUEST, name).lines
        self.assertIn(people[0], [row.requested_client_user for row in lines])
        self.assertIn(machines[0], [row.requested_device for row in lines])
        self.assertEqual(frappe.db.get_value(REQUEST, name, "status"), "Submitted")

        kept = self.reopened(name, self.manager)
        renamed = f"ZZTEST Marie {self.tag} Jr"
        for subject in kept["subjects"]:
            if subject["subject_key"] == "new:marie":
                subject["full_name"] = renamed
        self.modify(name, self.manager, kept)

        self.assertEqual(frappe.get_all(REQUESTED_CLIENT_USER, filters={"request": name}, pluck="name"), people)
        self.assertEqual(frappe.get_all(REQUESTED_DEVICE, filters={"request": name}, pluck="name"), machines)
        self.assertEqual(frappe.db.get_value(REQUESTED_CLIENT_USER, people[0], "full_name"), renamed)
        snapshot = frappe.parse_json(
            frappe.db.get_value(REQUESTED_CLIENT_USER, people[0], "requested_snapshot_json")
        )
        self.assertEqual(snapshot["full_name"], renamed)

        self.modify(name, self.manager, self.helen_only())

        self.assertEqual((self.count(REQUESTED_CLIENT_USER, name), self.count(REQUESTED_DEVICE, name)), (0, 0))
        self.assertFalse(frappe.db.exists(REQUESTED_CLIENT_USER, people[0]))
        self.assertFalse(frappe.db.exists(REQUESTED_DEVICE, machines[0]))
        self.assertEqual(self.asked(name), [("service.add", self.m365, self.helen, "", "", "")])
        self.assertEqual(self.comments(name), 3)


class TestWhoMayModifyAndUntilWhen(ModificationCase):
    def assert_locked(self, name, user):
        before = self.state(name)
        payload = self.rewritten(self.reopened(name, user))

        refusal = self.refused(lambda: self.modify(name, user, payload))

        self.assertEqual((refusal.message, refusal.code), (LOCKED, "REQUEST_LOCKED"))
        self.assertEqual(self.state(name), before)
        self.assertFalse(self.read(name, user)["can_edit"])

    def test_somebody_else_of_the_same_customer_is_refused(self):
        name = self.raise_as(self.asker, self.scenario())
        before = self.state(name)
        payload = self.rewritten(self.reopened(name, self.asker))

        refusal = self.refused(lambda: self.modify(name, self.manager, payload))

        self.assertEqual((refusal.message, refusal.code, refusal.http_status_code), (NOT_THE_REQUESTER, "PERMISSION_DENIED", 403))
        self.assertEqual(self.state(name), before)
        self.assertTrue(self.read(name, self.asker)["can_edit"])
        self.assertFalse(self.read(name, self.manager)["can_edit"])

        answer = self.as_manager(lambda: portal.update_request(name=name, priority="Low"))
        self.assertEqual((answer["success"], answer["error"], answer["code"]), (False, NOT_THE_REQUESTER, "PERMISSION_DENIED"))
        self.assertEqual(frappe.local.response.get("http_status_code"), 403)
        self.assertEqual(self.state(name), before)

    def test_once_the_work_has_started_nobody_modifies_it(self):
        name = self.raise_as(self.manager, self.scenario())
        self.assertTrue(self.read(name, self.manager)["can_edit"])

        self.as_tech(lambda: RequestService.run_action(name=name, action="start_review"))

        self.assertEqual(frappe.db.get_value(REQUEST, name, "status"), "Under Review")
        self.assert_locked(name, self.manager)

    def test_once_a_line_was_decided_nobody_modifies_it(self):
        name = self.raise_as(self.manager, self.scenario())
        self.assertTrue(self.read(name, self.manager)["can_edit"])

        line = frappe.get_doc(REQUEST, name).lines[0].name
        frappe.db.set_value(LINE, line, "line_status", "Approved", update_modified=False)
        frappe.db.commit()

        self.assertEqual(frappe.db.get_value(REQUEST, name, "status"), "Submitted")
        self.assert_locked(name, self.manager)

    def test_once_a_work_order_exists_nobody_modifies_it(self):
        name = self.raise_as(self.manager, self.scenario())
        self.assertTrue(self.read(name, self.manager)["can_edit"])

        self.work_order(name)

        self.assertEqual(frappe.db.get_value(REQUEST, name, "status"), "Submitted")
        self.assert_locked(name, self.manager)

    def test_a_billing_dispute_is_never_modified(self):
        name = self.raise_as(self.manager, self.scenario())
        self.assertTrue(self.read(name, self.manager)["can_edit"])

        frappe.db.set_value(REQUEST, name, "request_type", "Billing Dispute", update_modified=False)
        frappe.db.commit()

        self.assertFalse(self.read(name, self.manager)["can_edit"])
        refusal = self.refused(lambda: self.modify(name, self.manager, {"priority": "Low"}))
        self.assertEqual((refusal.message, refusal.code), (LOCKED, "REQUEST_LOCKED"))

    def test_a_draft_and_a_refused_request_keep_their_own_paths(self):
        draft = self.save(**self.scenario())["name"]
        self.assertFalse(self.read(draft, self.manager)["can_edit"])
        refusal = self.refused(lambda: self.modify(draft, self.manager, self.helen_only()))
        self.assertEqual(refusal.code, "REQUEST_LOCKED")
        self.assertEqual(frappe.db.get_value(REQUEST, draft, "status"), "Draft")

        name = self.raise_as(self.manager, self.scenario())
        self.as_tech(lambda: RequestService.run_action(name=name, action="reject", reason="Out of contract"))
        self.assertFalse(self.read(name, self.manager)["can_edit"])
        refusal = self.refused(lambda: self.modify(name, self.manager, self.helen_only()))
        self.assertEqual(refusal.code, "REQUEST_LOCKED")

    def test_a_modification_refused_by_validation_leaves_every_row_as_it_was(self):
        name = self.raise_as(self.manager, self.scenario())
        before = self.state(name)
        payload = self.reopened(name, self.manager)

        for subject in payload["subjects"]:
            if subject["subject_key"] == "new:marie":
                subject["full_name"] = f"ZZTEST Marie {self.tag} Renamed"

        payload["action_groups"] = [group for group in payload["action_groups"] if group["group_key"] != "grp:sophos"]
        payload["action_groups"].append(
            self.group(
                "grp:transfer-helen",
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
        )

        refusal = self.refused(lambda: self.modify(name, self.manager, payload))

        self.assertEqual(refusal.code, "VALIDATION_ERROR")
        self.assertIn(request_intents.ONE_DESTINATION, refusal.message)
        self.assertEqual(self.state(name), before)
        self.assertEqual(
            frappe.db.get_value(REQUESTED_CLIENT_USER, before["people"][0]["name"], "full_name"),
            f"ZZTEST Marie {self.tag}",
        )
        self.assertTrue(self.read(name, self.manager)["can_edit"])


class TestARequestRaisedByNexgen(ModificationCase):
    def test_its_internal_requester_follows_the_same_rule(self):
        other = self.make_account("internal", "MSP Technician", suffix=f"ry{self.tag[:3]}")
        name = self.raise_as(self.tech, self.helen_only())
        self.assertEqual(
            frappe.db.get_value(REQUEST, name, ["status", "source"]), ("Submitted", "Internal")
        )
        self.assertTrue(self.read(name, self.tech)["can_edit"])
        self.assertFalse(self.read(name, other)["can_edit"])

        before = self.state(name)
        refusal = self.refused(lambda: self.modify(name, other, {**self.helen_only(), "priority": "Urgent"}))
        self.assertEqual((refusal.message, refusal.code, refusal.http_status_code), (NOT_THE_REQUESTER, "PERMISSION_DENIED", 403))
        self.assertEqual(self.state(name), before)

        self.modify(name, self.tech, {**self.helen_only(), "priority": "Urgent"})
        self.assertEqual(
            frappe.db.get_value(REQUEST, name, ["status", "source", "priority"]), ("Submitted", "Internal", "Urgent")
        )
        self.assertEqual(self.comments(name), 1)

        self.as_user(other, lambda: RequestService.run_action(name=name, action="start_review"))

        refusal = self.refused(lambda: self.modify(name, self.tech, {**self.helen_only(), "priority": "Low"}))
        self.assertEqual((refusal.message, refusal.code), (LOCKED, "REQUEST_LOCKED"))
        self.assertEqual(frappe.db.get_value(REQUEST, name, "priority"), "Urgent")
        self.assertFalse(self.read(name, self.tech)["can_edit"])


class TestTheWorkStartsBeforeLinesAreDecided(ModificationCase):
    def internal(self, name):
        return self.as_tech(lambda: RequestService.get_request(name))

    def test_a_line_waits_for_the_work_to_start(self):
        name = self.raise_as(self.manager, self.helen_only())
        submitted = self.internal(name)

        self.assertEqual(submitted["status"], "Submitted")
        self.assertEqual((submitted["can_start"], submitted["can_decide_lines"]), (True, False))
        self.assertIn(
            {"action": "start_review", "label": "Start work", "needs_reason": False}, submitted["available_actions"]
        )

        refusal = self.refused(
            lambda: self.as_tech(lambda: RequestService.set_line_status(name=name, idx=1, line_status="Approved"))
        )
        self.assertEqual((refusal.message, refusal.code), (NOT_STARTED, "WORK_NOT_STARTED"))
        refusal = self.refused(
            lambda: self.as_tech(lambda: RequestService.set_line_statuses(name=name, idxs=[1], line_status="Approved"))
        )
        self.assertEqual((refusal.message, refusal.code), (NOT_STARTED, "WORK_NOT_STARTED"))
        self.assertEqual(frappe.db.get_value(REQUEST, name, "status"), "Submitted")
        self.assertEqual(frappe.get_doc(REQUEST, name).lines[0].line_status, "Pending")
        self.assertTrue(self.read(name, self.manager)["can_edit"])

        started = self.as_tech(lambda: RequestService.run_action(name=name, action="start_review"))

        self.assertEqual(started["status"], "Under Review")
        self.assertEqual((started["can_start"], started["can_decide_lines"]), (False, True))
        self.assertFalse(self.read(name, self.manager)["can_edit"])

        decided = self.as_tech(lambda: RequestService.set_line_status(name=name, idx=1, line_status="Approved"))
        self.assertEqual(decided["lines"][0]["line_status"], "Approved")

        approved = self.as_tech(lambda: RequestService.run_action(name=name, action="approve"))
        for order in frappe.get_all("MSP Work Order", filters={"request": name}, pluck="name"):
            self.track("MSP Work Order", order)

        self.assertEqual(approved["status"], "Approved")
        self.assertEqual((approved["can_start"], approved["can_decide_lines"]), (False, False))
        self.assertIn(
            {"action": "start_work", "label": "Start execution", "needs_reason": False}, approved["available_actions"]
        )

        for status in ("Approved", "In Progress"):
            if status == "In Progress":
                self.as_tech(lambda: RequestService.run_action(name=name, action="start_work"))

            refusal = self.refused(
                lambda: self.as_tech(
                    lambda: RequestService.set_line_status(name=name, idx=1, line_status="Rejected", reason="Late")
                )
            )
            self.assertEqual((refusal.message, refusal.code), (DECIDED, "LINES_DECIDED"))
            refusal = self.refused(
                lambda: self.as_tech(
                    lambda: RequestService.set_line_statuses(name=name, idxs=[1], line_status="Rejected", reason="Late")
                )
            )
            self.assertEqual((refusal.message, refusal.code), (DECIDED, "LINES_DECIDED"))
            self.assertEqual(frappe.db.get_value(REQUEST, name, "status"), status)
            self.assertEqual(frappe.get_doc(REQUEST, name).lines[0].line_status, "Approved")

    def test_a_customer_account_cannot_start_the_work(self):
        name = self.raise_as(self.manager, self.helen_only())

        refusal = self.refused(lambda: self.as_manager(lambda: RequestService.run_action(name=name, action="start_review")))

        self.assertEqual((refusal.code, refusal.http_status_code), ("PERMISSION_DENIED", 403))
        self.assertEqual(frappe.db.get_value(REQUEST, name, "status"), "Submitted")

    def test_a_request_still_awaiting_its_customer_is_not_ours_to_start(self):
        name = self.raise_as(self.asker, self.helen_only())

        with self.assertRaises(NotFoundError):
            self.internal(name)

        self.assertEqual(frappe.db.get_value(REQUEST, name, "status"), "Awaiting Customer Approval")


class TestTheBuilderOffersWhatTheRequestAlreadyAsks(ModificationCase):
    def offered(self, subjects, request=None):
        from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

        options = self.as_manager(
            lambda: RequestScopeService.operation_options(
                customer=self.customer, subjects=subjects, request=request
            )
        )

        return sorted(
            target["client_user"]
            for domain in options["domains"]
            if domain["key"] == "Service"
            for card in domain["options"]
            if card["object_key"] == self.m365
            for action in card["actions"]
            if action["operation_code"] == "service.add"
            for target in action["targets"]
        )

    def test_an_act_taken_out_can_be_put_back_for_the_same_people(self):
        name = self.raise_as(self.manager, self.helen_only())
        subjects = [self.existing(self.helen), self.existing(self.franck)]

        self.assertEqual(self.offered(subjects), [self.franck])
        self.assertEqual(self.offered(subjects, request=name), sorted([self.helen, self.franck]))

    def test_what_another_request_asks_stays_asked(self):
        first = self.raise_as(self.manager, self.helen_only())
        franck = self.existing(self.franck)
        second = self.raise_as(
            self.manager,
            {
                **self.helen_only(),
                "subjects": [franck],
                "action_groups": [
                    self.group("grp:m365", "service.add", [self.target(franck)], service=self.m365)
                ],
            },
        )
        subjects = [self.existing(self.helen), franck]

        self.assertEqual(self.offered(subjects, request=first), [self.helen])
        self.assertEqual(self.offered(subjects, request=second), [self.franck])
