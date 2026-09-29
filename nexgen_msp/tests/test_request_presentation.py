"""One presentation of a request, from the builder's preview to the completed file."""

import frappe

from nexgen_msp.api.internal.endpoints import v1 as internal
from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService
from nexgen_msp.api.portal.endpoints import v1 as portal

from .test_requested_execution import RequestedWorkCase
from .writer_case import REQUEST, REQUESTED_CLIENT_USER, REQUESTED_DEVICE

REMOVED = (
    "Destination is not yet a Client User",
    "Device not yet resolved",
    "Requires Device resolution",
    "Requires Client User resolution",
    "does not exist as a Client User yet",
    "has not been resolved to a Managed Device yet",
    "have not been resolved to Managed Devices yet",
)


def day(value):
    value = frappe.utils.getdate(value)

    return f"{value.day} {value.strftime('%b %Y')}"


class PresentationCase(RequestedWorkCase):
    def setUp(self):
        super().setUp()
        self.marie_name = f"ZZTEST Marie {self.tag}"
        self.helen_name = frappe.db.get_value("MSP Client User", self.helen, "full_name")
        self.franck_name = frappe.db.get_value("MSP Client User", self.franck, "full_name")
        self.hostname = frappe.db.get_value("MSP Managed Device", self.laptop, "hostname")
        self.m365_name = frappe.db.get_value("Item", self.m365, "item_name")
        self.sophos_name = frappe.db.get_value("Item", self.sophos, "item_name")

    def preview(self, payload=None):
        payload = payload or self.scenario()

        return self.as_manager(
            lambda: portal.preview_request(
                customer=self.customer,
                priority=payload["priority"],
                details=payload["details"],
                requested_date=payload["requested_date"],
                subjects=frappe.as_json(payload["subjects"]),
                requested_devices=frappe.as_json(payload["requested_devices"]),
                action_groups=frappe.as_json(payload["action_groups"]),
            )
        )

    def portal_view(self, name, user=None):
        return self.as_user(user or self.manager, lambda: portal.get_request_presentation(name=name))

    def internal_view(self, name):
        return self.as_tech(lambda: internal.get_request_presentation(name=name))

    def group_of(self, presentation, key):
        return next(group for group in presentation["action_groups"] if group["group_key"] == key)


class TestThePreview(PresentationCase):
    def test_the_header_and_the_summary_of_a_preview(self):
        out = self.preview()
        request = out["request"]

        self.assertEqual(
            {key: request[key] for key in ("name", "status", "customer", "priority", "details", "submitted_at")},
            {
                "name": None,
                "status": "Draft",
                "customer": self.customer,
                "priority": "High",
                "details": "Marie starts on Monday.",
                "submitted_at": None,
            },
        )
        self.assertEqual(
            request["badges"],
            [
                {"tone": "slate", "label": "DRAFT"},
                {"tone": "slate", "label": "HIGH"},
                {"tone": "amber", "label": "2 NEW ENTITIES"},
            ],
        )
        self.assertEqual(
            request["customer_approval"],
            {"state": "not_applicable", "by_name": None, "at": None, "label": "Not applicable yet"},
        )
        self.assertEqual(request["nexgen_status_label"], "Draft")
        self.assertIsNone(request["rejection"])
        self.assertEqual(request["details_by"], request["requester_name"])
        self.assertEqual(
            out["summary"], {"people": 3, "requested_actions": 4, "concrete_targets": 4, "new_entities": 2}
        )
        self.assertEqual(
            [(row["subject_key"], row["type"], row["related_work_count"]) for row in out["subjects"]],
            [("new:marie", "new", 4), (f"user:{self.helen}", "existing", 0), (f"user:{self.franck}", "existing", 1)],
        )
        self.assertIsNone(out["fulfilment_outcome"])

    def test_every_action_group_is_explained_by_the_server(self):
        out = self.preview()
        m365 = self.group_of(out, "grp:m365")

        self.assertEqual(
            {key: m365[key] for key in ("operation_label", "context_label", "impact_label", "impact_detail", "badges")},
            {
                "operation_label": f"Add {self.m365_name}",
                "context_label": "Personal service",
                "impact_label": "1 target from 2 people",
                "impact_detail": "1 left unchanged",
                "badges": [],
            },
        )
        self.assertEqual(
            m365["unchanged"],
            [{"subject_key": f"user:{self.helen}", "person_label": self.helen_name, "reason": "Left out by the requester."}],
        )
        self.assertEqual(
            m365["targets"],
            [
                {
                    "line_idx": None,
                    "subject_key": "new:marie",
                    "person_label": self.marie_name,
                    "person_is_new": True,
                    "target_label": f"{self.m365_name} · Personal",
                    "target_kind": "requested_client_user",
                    "target_badge": "NEW",
                    "operation_label": f"Add {self.m365_name}",
                    "state_at_request": "Not assigned",
                    "state_changed": False,
                    "relationship": None,
                    "line_status": None,
                    "rejection_reason": None,
                    "work_cancelled": False,
                }
            ],
        )

        transfer = self.group_of(out, "grp:transfer")
        relationship = {"from_label": self.franck_name, "to_label": self.marie_name, "to_is_new": True, "note": None}
        self.assertEqual(
            {key: transfer[key] for key in ("operation_label", "context_label", "impact_label", "impact_detail", "badges", "relationship")},
            {
                "operation_label": "Change holder",
                "context_label": f"{self.hostname} · Device operation",
                "impact_label": "1 Device",
                "impact_detail": "Existing Device",
                "badges": [],
                "relationship": relationship,
            },
        )
        target = transfer["targets"][0]
        self.assertEqual(
            (target["target_kind"], target["target_label"], target["state_at_request"], target["relationship"]),
            ("managed_device", self.hostname, f"Held by {self.franck_name}", relationship),
        )

        sophos = self.group_of(out, "grp:sophos")
        self.assertEqual(
            {key: sophos[key] for key in ("operation_label", "context_label", "impact_label", "impact_detail", "badges")},
            {
                "operation_label": f"Add {self.sophos_name}",
                "context_label": "Device service",
                "impact_label": "1 requested Device",
                "impact_detail": None,
                "badges": [],
            },
        )
        self.assertEqual(
            {key: sophos["targets"][0][key] for key in ("target_kind", "target_label", "target_badge", "state_at_request")},
            {
                "target_kind": "requested_device",
                "target_label": "New laptop",
                "target_badge": "UNRESOLVED",
                "state_at_request": "Not assigned",
            },
        )

    def test_the_requested_entities_and_what_needs_attention(self):
        out = self.preview()
        person, machine = out["requested_entities"]

        self.assertEqual(
            {key: person[key] for key in ("kind", "name", "key", "display_name", "status", "readiness", "badge", "resolved_to", "requested_work_count", "relationship_summary")},
            {
                "kind": "client_user",
                "name": None,
                "key": "new:marie",
                "display_name": self.marie_name,
                "status": "Open",
                "readiness": "needs_review",
                "badge": "NEW",
                "resolved_to": None,
                "requested_work_count": 4,
                "relationship_summary": [
                    f"New laptop: Unassigned → {self.marie_name}",
                    f"{self.hostname}: {self.franck_name} → {self.marie_name}",
                ],
            },
        )
        self.assertEqual(person["context_label"], f"Requested Client User · {self.department}")
        self.assertEqual(
            {key: machine[key] for key in ("kind", "name", "key", "display_name", "context_label", "badge", "requested_work_count", "relationship_summary")},
            {
                "kind": "device",
                "name": None,
                "key": "new-device:laptop",
                "display_name": "New laptop",
                "context_label": "Requested Device · Laptop",
                "badge": "UNRESOLVED",
                "requested_work_count": 2,
                "relationship_summary": [f"Intended for {self.marie_name}"],
            },
        )
        self.assertEqual(out["attention"], [])
        text = frappe.as_json(out)
        self.assertEqual([sentence for sentence in REMOVED if sentence in text], [])

    def test_a_group_of_several_targets_keeps_its_counts(self):
        payload = self.scenario()
        marie = payload["subjects"][0]
        helen = payload["subjects"][1]
        payload["action_groups"][0]["targets"].append(self.target(helen))
        payload["action_groups"][0]["exclusions"] = [
            {
                "subject_key": f"user:{self.franck}",
                "client_user": self.franck,
                "full_name": self.franck_name,
                "reason_code": "UNCHECKED",
                "reason": "Left out by the requester.",
            }
        ]
        out = self.preview(payload)
        m365 = self.group_of(out, "grp:m365")

        self.assertEqual([target["subject_key"] for target in m365["targets"]], [marie["subject_key"], helen["subject_key"]])
        self.assertEqual(m365["badges"], [{"tone": "amber", "label": "1 NEW PERSON"}])
        self.assertEqual(m365["impact_detail"], "1 left unchanged")

    def test_a_preview_writes_nothing(self):
        def counts():
            return (
                frappe.db.count(REQUEST, {"customer": self.customer}),
                frappe.db.count(REQUESTED_CLIENT_USER, {"customer": self.customer}),
                frappe.db.count(REQUESTED_DEVICE, {"customer": self.customer}),
                frappe.db.sql(
                    """select count(*) from `tabMSP Request Line` line
                       join `tabMSP Request` request on request.name = line.parent
                       where request.customer = %s""",
                    self.customer,
                )[0][0],
            )

        before = counts()

        out = self.preview()

        self.assertEqual(out["summary"]["concrete_targets"], 4)
        self.assertEqual(counts(), before)


class TestAPersistedRequest(PresentationCase):
    def test_the_submitted_request_says_what_the_preview_said(self):
        payload = self.scenario()
        preview = self.preview(payload)
        name = self.send(**payload)["name"]
        out = self.portal_view(name)
        request = out["request"]
        manager = frappe.db.get_value("User", self.manager, "full_name")

        self.assertEqual(request["name"], name)
        self.assertEqual(
            request["badges"],
            [
                {"tone": "blue", "label": "SUBMITTED"},
                {"tone": "slate", "label": "HIGH"},
                {"tone": "amber", "label": "2 NEW ENTITIES"},
            ],
        )
        self.assertEqual(request["customer_approval"]["state"], "approved")
        self.assertEqual(request["customer_approval"]["label"], f"Approved · {manager} · {day(frappe.utils.today())}")
        self.assertEqual(request["nexgen_status_label"], "Submitted")
        self.assertIsNotNone(request["submitted_at"])
        self.assertEqual(out["summary"], preview["summary"])

        shape = ("group_key", "operation_label", "context_label", "impact_label", "impact_detail", "badges", "relationship", "unchanged")
        self.assertEqual(
            [{key: group[key] for key in shape} for group in out["action_groups"]],
            [{key: group[key] for key in shape} for group in preview["action_groups"]],
        )
        self.assertEqual(
            [(row["subject_key"], row["related_work_count"]) for row in out["subjects"]],
            [(row["subject_key"], row["related_work_count"]) for row in preview["subjects"]],
        )

        targets = [target for group in out["action_groups"] for target in group["targets"]]
        self.assertEqual(sorted(target["line_idx"] for target in targets), [1, 2, 3, 4])
        self.assertEqual({target["line_status"] for target in targets}, {"Pending"})

        rcu = frappe.get_all(REQUESTED_CLIENT_USER, filters={"request": name}, pluck="name")[0]
        self.assertEqual(out["subjects"][0]["requested_client_user"], rcu)
        self.assertEqual(
            [(entity["name"] is not None, entity["badge"]) for entity in out["requested_entities"]],
            [(True, "NEEDS REVIEW"), (True, "NEEDS REVIEW")],
        )

    def test_a_changed_holder_is_flagged_without_rewriting_the_snapshot(self):
        name = self.send(**self.scenario())["name"]
        frappe.db.set_value("MSP Managed Device", self.laptop, "assigned_client_user", self.helen)
        frappe.db.commit()

        out = self.internal_view(name)
        target = self.group_of(out, "grp:transfer")["targets"][0]

        self.assertTrue(target["state_changed"])
        self.assertEqual(target["state_at_request"], f"Held by {self.franck_name}")
        self.assertIn("Current state has changed since this request was submitted.", out["attention"])
        self.assertFalse(self.group_of(out, "grp:m365")["targets"][0]["state_changed"])

    def test_decided_lines_carry_their_verdict(self):
        name = self.send(**self.scenario())["name"]
        self.as_tech(lambda: RequestService.run_action(name=name, action="start_review"))

        for row in frappe.get_doc(REQUEST, name).lines:
            verdict = "Rejected" if row.operation_code == "device.transfer" else "Approved"
            self.as_tech(
                lambda idx=row.idx, verdict=verdict: RequestService.set_line_status(
                    name=name, idx=idx, line_status=verdict, reason="Not this week" if verdict == "Rejected" else None
                )
            )

        out = self.internal_view(name)

        self.assertEqual(
            {
                group["group_key"]: [(target["line_status"], target["rejection_reason"]) for target in group["targets"]]
                for group in out["action_groups"]
            },
            {
                "grp:m365": [("Approved", None)],
                "grp:assign": [("Approved", None)],
                "grp:sophos": [("Approved", None)],
                "grp:transfer": [("Rejected", "Not this week")],
            },
        )
        self.assertIsNone(out["fulfilment_outcome"])

    def test_a_completed_request_keeps_its_intent_and_appends_the_outcome(self):
        marie = self.marie(username=f"zz.p{self.tag[:4]}")
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
        underway = self.internal_view(name)
        self.assertEqual(underway["request"]["status"], "Approved")
        self.assertIsNone(underway["fulfilment_outcome"])

        person = self.as_tech(lambda: RequestedClientUserService.resolve_create(self.requested(name)[0]))
        hostname = f"ZZPR{self.tag[:4]}"
        device = self.as_tech(
            lambda: RequestedDeviceService.resolve_new(
                self.requested(name, REQUESTED_DEVICE)[0],
                {"hostname": hostname, "serial_number": f"ZZTEST-PR-{self.tag}"},
            )
        )

        for card in self.cards(self.plan(name)):
            self.execute(card["name"])

        self.as_tech(lambda: RequestExecutionService.complete_request(request=name))

        out = self.internal_view(name)
        request = out["request"]

        self.assertEqual(request["badges"], [{"tone": "emerald", "label": "COMPLETED"}, {"tone": "slate", "label": "MEDIUM"}])
        self.assertEqual(request["nexgen_status_label"], f"Completed · {day(request['completed_at'])}")
        self.assertEqual(out["summary"], {"people": 1, "requested_actions": 2, "concrete_targets": 2, "new_entities": 2})
        self.assertEqual(out["attention"], [])

        m365 = self.group_of(out, "grp:m365")["targets"][0]
        sophos = self.group_of(out, "grp:sophos")["targets"][0]
        self.assertEqual(
            (m365["target_kind"], m365["person_is_new"], m365["target_badge"], m365["state_at_request"], m365["line_status"]),
            ("requested_client_user", True, None, "Not assigned", "Approved"),
        )
        self.assertEqual((sophos["target_kind"], sophos["target_label"], sophos["target_badge"]), ("requested_device", "New laptop", None))
        self.assertEqual([entity["badge"] for entity in out["requested_entities"]], ["RESOLVED", "RESOLVED"])

        self.assertEqual(
            out["fulfilment_outcome"],
            {
                "entities": [
                    {
                        "kind": "client_user",
                        "display_name": self.marie_name,
                        "context_label": "Requested Client User",
                        "badge": "RESOLVED",
                        "resolved_label": self.marie_name,
                        "resolved_note": "Created during fulfilment",
                        "link": {"doctype": "MSP Client User", "name": person},
                    },
                    {
                        "kind": "device",
                        "display_name": "New laptop",
                        "context_label": f"Requested Device for {self.marie_name}",
                        "badge": "RESOLVED",
                        "resolved_label": frappe.db.get_value("MSP Managed Device", device, "hostname"),
                        "resolved_note": "Registered during fulfilment",
                        "link": {"doctype": "MSP Managed Device", "name": device},
                    },
                ],
                "work": {"completed": 2, "unresolved": 0, "cancelled": 0, "badge": "COMPLETED"},
            },
        )
        self.assertEqual(self.portal_view(name)["fulfilment_outcome"], out["fulfilment_outcome"])


class TestSaidOnce(PresentationCase):
    def test_two_future_people_and_two_requested_devices_are_each_said_once_by_their_badge(self):
        kanto = self.marie(subject_key="new:kanto", full_name=f"ZZTEST Kanto {self.tag}")
        idriss = self.marie(subject_key="new:idriss", full_name=f"ZZTEST New Idriss {self.tag}")
        name = self.approved(
            [kanto, idriss],
            [
                self.group(
                    "grp:kanto",
                    "device.assign",
                    [
                        self.target(
                            kanto,
                            "Device",
                            device_requirement_key="new-device:kanto",
                            requested_holder_subject_key="new:kanto",
                        )
                    ],
                ),
                self.group(
                    "grp:idriss",
                    "device.assign",
                    [
                        self.target(
                            idriss,
                            "Device",
                            device_requirement_key="new-device:idriss",
                            requested_holder_subject_key="new:idriss",
                        )
                    ],
                ),
            ],
            requested_devices=[
                self.new_laptop(
                    device_requirement_key="new-device:kanto",
                    display_label="PC-KANTO",
                    device_type="PC",
                    intended_holder_subject_key="new:kanto",
                ),
                self.new_laptop(
                    device_requirement_key="new-device:idriss",
                    display_label=None,
                    intended_holder_subject_key="new:idriss",
                ),
            ],
        )

        for out in (self.internal_view(name), self.portal_view(name)):
            self.assertEqual(out["request"]["status"], "Approved")
            text = frappe.as_json(out)
            self.assertEqual([sentence for sentence in REMOVED if sentence in text], [])
            self.assertEqual(out["attention"], [])
            self.assertIsNone(out["fulfilment_outcome"])
            self.assertEqual(len(out["requested_entities"]), 4)

            for key, person in (("grp:kanto", kanto["full_name"]), ("grp:idriss", idriss["full_name"])):
                group = self.group_of(out, key)
                self.assertEqual((group["badges"], group["impact_detail"]), ([], None))
                self.assertEqual(group["relationship"], {"from_label": None, "to_label": person, "to_is_new": True, "note": None})
                [target] = group["targets"]
                self.assertEqual(
                    (target["target_kind"], target["target_badge"], target["state_at_request"], target["line_status"]),
                    ("requested_device", "UNRESOLVED", None, "Approved"),
                )
                self.assertEqual(target["relationship"], group["relationship"])

            targets = [target for group in out["action_groups"] for target in group["targets"]]
            self.assertEqual([target["target_badge"] for target in targets].count("UNRESOLVED"), 2)
            self.assertEqual(
                sorted(target["relationship"]["to_label"] for target in targets if target["relationship"]["to_is_new"]),
                sorted([kanto["full_name"], idriss["full_name"]]),
            )
            self.assertEqual(len({target["target_label"] for target in targets}), 2)
            self.assertIn("PC-KANTO", {target["target_label"] for target in targets})


class TestApprovalAndRejection(PresentationCase):
    def test_a_request_refused_by_the_company_says_who_refused_it(self):
        asker = self.make_account("customer", "MSP Customer Manager", self.customer, suffix=f"wa{self.tag[:3]}")
        self.grant(asker, can_submit=1, can_approve=0)
        payload = self.scenario()
        name = self.as_user(asker, lambda: portal.create_request(customer=self.customer, **{
            key: frappe.as_json(value) if isinstance(value, list) else value for key, value in payload.items()
        }))["name"]
        self.track(REQUEST, name)

        waiting = self.portal_view(name, asker)["request"]
        self.assertEqual(waiting["badges"][0], {"tone": "amber", "label": "AWAITING CUSTOMER APPROVAL"})
        self.assertEqual(
            waiting["customer_approval"], {"state": "pending", "by_name": None, "at": None, "label": "Awaiting approval"}
        )
        self.assertEqual(waiting["nexgen_status_label"], "Not submitted yet")
        self.assertEqual(self.internal_view(name).get("code"), "NOT_FOUND")

        self.as_manager(lambda: portal.reject_request(name=name, reason="Not this quarter"))
        request = self.portal_view(name, asker)["request"]
        manager = frappe.db.get_value("User", self.manager, "full_name")

        self.assertEqual(request["badges"][0], {"tone": "red", "label": "REJECTED"})
        self.assertEqual(request["customer_approval"]["state"], "rejected")
        self.assertEqual(
            {key: request["rejection"][key] for key in ("reason", "by", "by_name")},
            {"reason": "Not this quarter", "by": "customer", "by_name": manager},
        )

    def test_a_nexgen_rejection_does_not_name_the_technician_to_the_customer(self):
        name = self.send(**self.scenario())["name"]
        self.as_tech(lambda: RequestService.run_action(name=name, action="reject", reason="Out of contract"))

        inside = self.internal_view(name)["request"]["rejection"]
        seen = self.portal_view(name)
        outside = seen["request"]

        self.assertEqual(
            (inside["by"], inside["by_name"], inside["reason"]),
            ("nexgen", frappe.db.get_value("User", self.tech, "full_name"), "Out of contract"),
        )
        self.assertEqual(
            (outside["rejection"]["by"], outside["rejection"]["by_name"], outside["rejection"]["reason"]),
            ("nexgen", None, "Out of contract"),
        )
        self.assertEqual(outside["nexgen_status_label"], f"Rejected · {day(inside['at'])}")
        self.assertEqual(seen["attention"], [])


class TestOnlyTheirOwn(PresentationCase):
    def test_a_customer_account_is_refused_elsewhere_and_on_the_internal_call(self):
        name = self.send(**self.scenario())["name"]
        elsewhere = self.make_customer(f"WX{self.tag[:4]}")
        stranger = self.make_account("customer", "MSP Customer Manager", elsewhere, suffix=f"wx{self.tag[:3]}")
        payload = self.scenario()

        self.assertEqual(self.portal_view(name, stranger).get("code"), "PERMISSION_DENIED")
        self.assertEqual(
            self.as_user(
                stranger,
                lambda: portal.preview_request(
                    customer=self.customer,
                    subjects=frappe.as_json(payload["subjects"]),
                    requested_devices=frappe.as_json(payload["requested_devices"]),
                    action_groups=frappe.as_json(payload["action_groups"]),
                ),
            ).get("code"),
            "PERMISSION_DENIED",
        )
        self.assertEqual(
            self.as_user(
                stranger,
                lambda: portal.preview_request(
                    customer=elsewhere,
                    subjects=frappe.as_json([self.existing(self.helen)]),
                    requested_devices="[]",
                    action_groups="[]",
                ),
            ).get("code"),
            "VALIDATION_ERROR",
        )
        self.assertEqual(
            self.as_manager(lambda: internal.get_request_presentation(name=name)).get("code"), "PERMISSION_DENIED"
        )
