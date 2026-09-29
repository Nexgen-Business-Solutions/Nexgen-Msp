"""A request may be about a few people, a Department, or the whole company — never a live query.

Choosing a Department resolves, there and then, to the exact people it contains. Whoever is added
to that Department afterwards is not in the request: the selection is a snapshot of a decision,
and the request says who was included. Whoever left since cannot be worked on, and that is said
out loud rather than silently dropped.
"""

import frappe

from nexgen_msp.api.internal.services.authority_service import AuthorityService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.api.portal.services.request_builder_service import RequestBuilderService
from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService
from nexgen_msp.utils.errors import NexgenError

from .base import MSPTestCase


class ScopeCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(f"SCO{self.tag[:4]}")
        self.track("MSP Approval Authority", self.customer)
        self.finance = self.make_department("Finance")
        self.commercial = self.make_department("Commercial")
        self.service = self.make_service(f"SCO{self.tag[:3]}", scope="User")
        self.cover_service(self.customer, self.service)
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"sa{self.tag[:3]}"
        )
        self.grant(self.asker)

    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def person(self, name, department, status="Active"):
        who = self.make_person(self.customer, name, department=department)
        frappe.db.set_value("MSP Client User", who, "lifecycle_status", status)
        frappe.db.commit()

        return who


class TestChoosingAGroup(ScopeCase):
    def setUp(self):
        super().setUp()
        self.alice = self.person("Alice", self.finance)
        self.bob = self.person("Bob", self.finance)
        self.gone = self.person("Gone", self.finance, status="Disabled")
        self.carla = self.person("Carla", self.commercial)

    def test_a_department_resolves_to_its_active_people_of_this_customer(self):
        out = self.as_user(
            self.asker,
            lambda: RequestBuilderService.department_selection(
                customer=self.customer, department=self.finance
            ),
        )
        chosen = {row["name"] for row in out["people"]}

        self.assertEqual(chosen, {self.alice, self.bob})
        self.assertEqual(out["active_count"], 2)
        self.assertEqual(out["excluded_disabled_count"], 1)
        self.assertEqual(out["selection_origin"], "Department")
        self.assertEqual(out["selection_label"], self.finance)

    def test_a_department_never_reaches_another_customer(self):
        elsewhere = self.make_customer(f"OTH{self.tag[:4]}")
        self.track("MSP Approval Authority", elsewhere)
        stranger = self.make_person(elsewhere, "Stranger", department=self.finance)

        out = self.as_user(
            self.asker,
            lambda: RequestBuilderService.department_selection(
                customer=self.customer, department=self.finance
            ),
        )

        self.assertNotIn(stranger, {row["name"] for row in out["people"]})

    def test_the_whole_company_resolves_to_every_active_person(self):
        out = self.as_user(
            self.asker, lambda: RequestBuilderService.company_selection(customer=self.customer)
        )

        self.assertEqual({row["name"] for row in out["people"]}, {self.alice, self.bob, self.carla})
        self.assertEqual(out["excluded_disabled_count"], 1)
        self.assertGreaterEqual(out["department_count"], 2)
        self.assertEqual(out["selection_label"], "Entire company")

    def test_a_department_with_nobody_says_so(self):
        empty = self.make_department("Empty Wing")

        out = self.as_user(
            self.asker,
            lambda: RequestBuilderService.department_selection(
                customer=self.customer, department=empty
            ),
        )

        self.assertEqual(out["active_count"], 0)
        self.assertEqual(out["people"], [])

    def test_a_selection_is_a_snapshot_and_never_a_live_query(self):
        before = self.as_user(
            self.asker, lambda: RequestBuilderService.company_selection(customer=self.customer)
        )
        newcomer = self.person("Newcomer", self.finance)
        after = self.as_user(
            self.asker, lambda: RequestBuilderService.company_selection(customer=self.customer)
        )

        self.assertNotIn(newcomer, {row["name"] for row in before["people"]})
        self.assertIn(newcomer, {row["name"] for row in after["people"]})

    def test_naming_no_department_is_refused(self):
        with self.assertRaises(NexgenError) as refused:
            self.as_user(
                self.asker,
                lambda: RequestBuilderService.department_selection(customer=self.customer),
            )

        self.assertEqual(str(refused.exception), "Choose a Department.")


class TestExpandingOneChangeOverMany(ScopeCase):
    def setUp(self):
        super().setUp()
        self.alice = self.person("Alice", self.finance)
        self.bob = self.person("Bob", self.finance)
        self.machine_service = self.make_service(f"SCD{self.tag[:3]}", scope="Device")
        self.cover_service(self.customer, self.machine_service)

    def options(self, people):
        subjects = [
            {
                "subject_key": f"user:{person}",
                "kind": "existing",
                "client_user": person,
                "full_name": frappe.db.get_value("MSP Client User", person, "full_name"),
                "added_via": "Existing",
            }
            for person in people
        ]

        return self.as_user(
            self.asker,
            lambda: RequestScopeService.operation_options(customer=self.customer, subjects=subjects),
        )

    def targets(self, operation_code, service, people):
        """The act one service offers to these people, with its targets and its exceptions."""
        domain = next(
            (row for row in self.options(people)["domains"] if row["key"] == "Service"), {"options": []}
        )
        card = next((row for row in domain["options"] if row["object_key"] == service), {"actions": []})

        return next(
            (row for row in card["actions"] if row["operation_code"] == operation_code),
            {"targets": [], "exclusions": []},
        )

    def test_a_user_service_expands_to_one_line_per_person(self):
        out = self.targets("service.add", self.service, [self.alice, self.bob])

        self.assertEqual(len(out["targets"]), 2)
        self.assertEqual(out["exclusions"], [])
        self.assertEqual({row["target_scope"] for row in out["targets"]}, {"User"})

    def test_somebody_who_already_has_it_is_named_as_an_exception(self):
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        opened = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=self.service,
            target_scope="User",
            client_user=self.alice,
        )
        self.track("MSP Service Assignment", opened["name"])

        out = self.targets("service.add", self.service, [self.alice, self.bob])
        excluded = {row["client_user"]: row["reason_code"] for row in out["exclusions"]}

        self.assertEqual([row["client_user"] for row in out["targets"]], [self.bob])
        self.assertEqual(excluded[self.alice], "ALREADY_ACTIVE")

    def test_a_disabled_person_is_never_a_target(self):
        left = self.person("Left", self.finance, status="Disabled")

        out = self.targets("service.add", self.service, [self.alice, left])

        self.assertNotIn(left, [row["client_user"] for row in out["targets"]])
        self.assertIn(left, [row["client_user"] for row in out["exclusions"]])

    def test_a_device_service_reaches_the_machines_those_people_hold(self):
        one = self.make_device(
            self.customer, hostname=f"BK1-{self.tag[:4]}", holder=self.alice, serial=f"ZZTEST-1{self.tag}"
        )
        two = self.make_device(
            self.customer, hostname=f"BK2-{self.tag[:4]}", holder=self.alice, serial=f"ZZTEST-2{self.tag}"
        )

        out = self.targets("service.add", self.machine_service, [self.alice, self.bob])
        excluded = {row["client_user"]: row["reason_code"] for row in out["exclusions"]}

        self.assertEqual(
            {row["managed_device"] for row in out["targets"]}, {one, two}, "both machines, not one"
        )
        self.assertEqual(excluded[self.bob], "NO_CURRENT_DEVICE")

    def test_an_existing_assignment_operation_needs_a_matching_assignment(self):
        out = self.targets("service.suspend", self.service, [self.alice])

        self.assertEqual(out["targets"], [])
        self.assertTrue(
            all(row["reason_code"] == "NO_CURRENT_ASSIGNMENT" for row in out["exclusions"])
        )

    def test_a_holder_operation_names_each_machine_rather_than_a_crowd(self):
        one = self.make_device(
            self.customer, hostname=f"BH1-{self.tag[:4]}", holder=self.alice, serial=f"ZZTEST-H{self.tag}"
        )

        devices = next(row for row in self.options([self.alice, self.bob])["domains"] if row["key"] == "Device")
        transfer = next(row for row in devices["options"] if row["operation_code"] == "device.transfer")

        self.assertEqual([row["managed_device"] for row in transfer["targets"]], [one])
        self.assertEqual(transfer["targets"][0]["current_holder"], self.alice)
        self.assertEqual([row["reason_code"] for row in transfer["exclusions"]], ["NO_CURRENT_DEVICE"])


class TestWhatTheRequestKeeps(ScopeCase):
    def setUp(self):
        super().setUp()
        self.alice = self.person("Alice", self.finance)
        self.bob = self.person("Bob", self.finance)

    def line(self, person, **fields):
        return {
            "operation_code": "service.add",
            "target_scope": "User",
            "client_user": person,
            "requested_service": self.service,
            **fields,
        }

    def raised(self, *lines):
        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(customer=self.customer, lines=list(lines)),
        )

        return self.track("MSP Request", out["name"])

    def test_the_same_person_picked_twice_is_asked_for_once(self):
        name = self.raised(
            self.line(self.alice, selection_origin="Individual"),
            self.line(self.alice, selection_origin="Department", selection_label=self.finance),
        )

        rows = frappe.get_all(
            "MSP Request Line", filters={"parent": name}, fields=["client_user"]
        )

        self.assertEqual([row.client_user for row in rows], [self.alice])

    def test_how_a_subject_was_chosen_is_kept_on_the_line(self):
        stamped = frappe.utils.now()
        name = self.raised(
            self.line(
                self.bob,
                selection_origin="Department",
                selection_group_key=f"department:{self.finance}",
                selection_label=self.finance,
                selection_snapshot_at=stamped,
            )
        )

        row = frappe.db.get_value(
            "MSP Request Line",
            {"parent": name},
            ["selection_origin", "selection_group_key", "selection_label"],
            as_dict=True,
        )

        self.assertEqual(row.selection_origin, "Department")
        self.assertEqual(row.selection_group_key, f"department:{self.finance}")
        self.assertEqual(row.selection_label, self.finance)

    def test_somebody_who_left_between_writing_and_sending_blocks_the_request(self):
        lines = [self.line(self.alice), self.line(self.bob)]
        frappe.db.set_value("MSP Client User", self.bob, "lifecycle_status", "Disabled")
        frappe.db.commit()

        with self.assertRaises(NexgenError) as refused:
            self.as_user(
                self.asker,
                lambda: PortalService.create_request(customer=self.customer, lines=lines),
            )

        self.assertEqual(refused.exception.code, "REQUEST_SCOPE_CHANGED")
        self.assertEqual(
            refused.exception.message,
            "Some selected people changed after they were added to this request.",
        )
        self.assertIn(self.bob, [row["client_user"] for row in refused.exception.detail["people"]])


class TestTheLoadOneRequestMayCarry(ScopeCase):
    """§V2-03-23: a company-wide request on a real company, measured rather than assumed."""

    def test_five_hundred_people_and_three_services_make_one_request(self):
        import time

        services = [self.service]

        for suffix in ("PF1", "PF2"):
            extra = self.make_service(f"{suffix}{self.tag[:3]}", scope="User")
            self.cover_service(self.customer, extra)
            services.append(extra)

        people = []

        for index in range(500):
            doc = frappe.get_doc(
                {
                    "doctype": "MSP Client User",
                    "customer": self.customer,
                    "full_name": f"ZZTEST Load {self.tag} {index}",
                    "department": self.finance,
                    "lifecycle_status": "Active",
                    "start_date": frappe.utils.today(),
                }
            ).insert(ignore_permissions=True)
            people.append(self.track("MSP Client User", doc.name))

        frappe.db.commit()

        started = time.time()
        selection = self.as_user(
            self.asker, lambda: RequestBuilderService.company_selection(customer=self.customer)
        )
        selecting = time.time() - started

        self.assertGreaterEqual(selection["active_count"], 500)
        self.assertLess(selecting, 10, f"resolving the company took {selecting:.1f}s")

        subjects = [
            {
                "subject_key": f"user:{person}",
                "kind": "existing",
                "client_user": person,
                "full_name": f"ZZTEST Load {self.tag} {index}",
                "added_via": "Company",
            }
            for index, person in enumerate(people)
        ]

        started = time.time()
        options = self.as_user(
            self.asker,
            lambda: RequestScopeService.operation_options(customer=self.customer, subjects=subjects),
        )
        expanding = time.time() - started
        resolved = [
            {"service_item": card["object_key"], "targets": action["targets"]}
            for domain in options["domains"]
            if domain["key"] == "Service"
            for card in domain["options"]
            if card["object_key"] in services
            for action in card["actions"]
            if action["operation_code"] == "service.add"
        ]
        targets = sum(len(row["targets"]) for row in resolved)

        self.assertEqual(targets, 1500)
        self.assertLess(expanding, 60, f"expanding 1500 targets took {expanding:.1f}s")

        lines = [
            {
                "operation_code": "service.add",
                "target_scope": "User",
                "client_user": row["client_user"],
                "requested_service": answer["service_item"],
                "selection_origin": "Company",
                "selection_label": "Entire company",
            }
            for answer in resolved
            for row in answer["targets"]
        ]

        started = time.time()
        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(customer=self.customer, lines=lines),
        )
        submitting = time.time() - started
        name = self.track("MSP Request", out["name"])

        self.assertEqual(frappe.db.count("MSP Request Line", {"parent": name}), 1500)
        self.assertLess(submitting, 120, f"submitting 1500 lines took {submitting:.1f}s")

        started = time.time()
        detail = self.as_user(self.asker, lambda: PortalService.get_request(name))
        reading = time.time() - started

        self.assertEqual(len(detail["lines"]), 1500)
        self.assertLess(reading, 30, f"reading 1500 lines took {reading:.1f}s")


class TestWhoMayAgreeToIt(ScopeCase):
    def setUp(self):
        super().setUp()
        self.alice = self.person("Alice", self.finance)
        self.carla = self.person("Carla", self.commercial)

    def line(self, person):
        return {
            "operation_code": "service.add",
            "target_scope": "User",
            "client_user": person,
            "requested_service": self.service,
        }

    def test_a_request_across_departments_needs_a_company_wide_approver(self):
        AuthorityService.set_account_rights(
            self.asker, {"can_submit": 1, "can_approve": 1, "department": self.finance}
        )

        with self.assertRaises(NexgenError) as refused:
            self.as_user(
                self.asker,
                lambda: PortalService.create_request(
                    customer=self.customer, lines=[self.line(self.alice), self.line(self.carla)]
                ),
            )

        self.assertEqual(refused.exception.code, "COMPANY_APPROVER_REQUIRED")
        self.assertEqual(
            refused.exception.message,
            "This request affects multiple Departments and requires a company-wide approver. "
            "Configure one before submitting this request.",
        )

    def test_one_department_is_covered_by_its_own_approver(self):
        AuthorityService.set_account_rights(
            self.asker, {"can_submit": 1, "can_approve": 1, "department": self.finance}
        )

        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer, lines=[self.line(self.alice)]
            ),
        )
        name = self.track("MSP Request", out["name"])

        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Submitted")

    def test_a_company_wide_approver_settles_it(self):
        AuthorityService.set_account_rights(self.asker, {"can_submit": 1, "can_approve": 1})

        out = self.as_user(
            self.asker,
            lambda: PortalService.create_request(
                customer=self.customer, lines=[self.line(self.alice), self.line(self.carla)]
            ),
        )
        name = self.track("MSP Request", out["name"])

        self.assertEqual(frappe.db.get_value("MSP Request", name, "status"), "Submitted")
