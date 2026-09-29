"""Everything the customer asked for is still there once the request exists.

The builder hands over people and grouped acts; the lines are ours to derive. That derivation
is where a request came to announce four actions and carry three: two acts asking for two
different machines for the same newcomer were stripped of the machines they named, became
identical, and one of them was quietly discarded. Nothing said so. The review screen counted
the lines, the execution plan grouped the work orders, and the second machine existed in no
reading anybody acts on.

The older matrix could not catch it: it raises requests by handing over lines directly, which
is the door the builder never uses. So this module goes in the front door — subjects and
action groups — and asks the question that was never asked: does every act that went in come
out?
"""

import frappe

from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase

ASSIGNMENT = "MSP Service Assignment"
WORK_ORDER = "MSP Work Order"
REQUESTED_CLIENT_USER = "MSP Requested Client User"


class ActsCase(MSPTestCase):
    """One company, one person who exists, one who does not, and machines in stock."""

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(f"AS{self.tag[:4]}")
        self.track("MSP Approval Authority", self.customer)

        self.department = self.make_department("Logistics")
        self.helen = self.make_person(self.customer, "Helen")

        self.first = self.make_device(
            self.customer, hostname=f"F1-{self.tag[:4]}", serial=f"ZZTEST-F-{self.tag}"
        )
        self.second = self.make_device(
            self.customer, hostname=f"S2-{self.tag[:4]}", serial=f"ZZTEST-S-{self.tag}"
        )

        self.on_a_machine = self.make_service(f"AM{self.tag[:3]}", scope="Device")
        self.on_a_person = self.make_service(f"AP{self.tag[:3]}", scope="User")
        self.cover_service(self.customer, self.on_a_machine)
        self.cover_service(self.customer, self.on_a_person)

        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"am{self.tag[:3]}"
        )
        self.grant(self.manager, can_submit=1, can_approve=1)

        self.tech = self.make_account("internal", "MSP Technician", suffix=f"at{self.tag[:3]}")

    def tearDown(self):
        frappe.set_user("Administrator")

        for name in frappe.get_all(ASSIGNMENT, filters={"customer": self.customer}, pluck="name"):
            frappe.delete_doc(ASSIGNMENT, name, force=True, ignore_permissions=True)

        for doctype in ("MSP Requested Device", REQUESTED_CLIENT_USER):
            for name in frappe.get_all(doctype, filters={"customer": self.customer}, pluck="name"):
                frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)

        for name in frappe.get_all("MSP Client User", filters={"customer": self.customer}, pluck="name"):
            self.track("MSP Client User", name)

        frappe.db.commit()
        super().tearDown()

    # ------------------------------------------------------------------ the front door
    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def newcomer(self, key="new:one", name="Nadia Newcomer"):
        return {
            "subject_key": key,
            "kind": "new",
            "client_user": None,
            "full_name": name,
            "department": self.department,
            "email": None,
            "username": None,
            "added_via": "New",
        }

    def existing(self, person):
        return {
            "subject_key": f"user:{person}",
            "kind": "existing",
            "client_user": person,
            "full_name": frappe.db.get_value("MSP Client User", person, "full_name"),
            "added_via": "Existing",
        }

    def machine_act(self, code, subject, device=None, holder=None, label=None):
        """One act on a machine, shaped the way the builder shapes it."""
        return {
            "group_key": f"grp:{frappe.generate_hash(length=8)}",
            "operation_code": code,
            "operation_label_snapshot": label or "Assign device",
            "domain": "Device",
            "service_item": None,
            "source_scope_type": "Person",
            "source_scope_key": subject["subject_key"],
            "source_scope_label": subject["full_name"],
            "selected_subject_count": 1,
            "requested_effective_date": frappe.utils.today(),
            "targets": [
                {
                    "subject_key": subject["subject_key"],
                    "client_user": subject["client_user"],
                    "full_name": subject["full_name"],
                    "target_scope": "Device",
                    "managed_device": device,
                    "requested_holder": holder,
                    "source_service_assignment": None,
                }
            ],
            "exclusions": [],
        }

    def service_act(self, subject, service, scope="User", device=None):
        return {
            "group_key": f"grp:{frappe.generate_hash(length=8)}",
            "operation_code": "service.add",
            "operation_label_snapshot": f"Add {service}",
            "domain": "Service",
            "service_item": service,
            "source_scope_type": "Person",
            "source_scope_key": subject["subject_key"],
            "source_scope_label": subject["full_name"],
            "selected_subject_count": 1,
            "requested_effective_date": frappe.utils.today(),
            "targets": [
                {
                    "subject_key": subject["subject_key"],
                    "client_user": subject["client_user"],
                    "full_name": subject["full_name"],
                    "target_scope": scope,
                    "managed_device": device,
                    "source_service_assignment": None,
                }
            ],
            "exclusions": [],
        }

    def raise_it(self, subjects, groups, who=None):
        out = self.as_user(
            who or self.manager,
            lambda: PortalService.create_request(
                customer=self.customer,
                subjects=subjects,
                action_groups=groups,
            ),
        )

        return self.track("MSP Request", out["name"])


class TestEveryActReachesTheRequest(ActsCase):
    """The count the customer was shown and the work the request carries are the same count."""

    def test_two_machines_for_one_newcomer_are_two_lines(self):
        nadia = self.newcomer()
        name = self.raise_it(
            [nadia],
            [
                self.machine_act("device.assign", nadia, device=self.first),
                self.machine_act("device.assign", nadia, device=self.second),
            ],
        )
        doc = frappe.get_doc("MSP Request", name)

        self.assertEqual(
            len(doc.lines), 2, "two machines were asked for and two must be on the request"
        )
        self.assertEqual(
            sorted(row.managed_device for row in doc.lines),
            sorted([self.first, self.second]),
            "each line names the machine it was asked for",
        )
        self.assertEqual(
            [row.requested_device for row in doc.lines],
            [None, None],
            "a machine that was named is not a machine still to be found",
        )

    def test_the_machine_a_newcomer_was_shown_stays_on_the_line(self):
        nadia = self.newcomer()
        name = self.raise_it(
            [nadia], [self.machine_act("device.assign", nadia, device=self.first)]
        )
        line = frappe.get_doc("MSP Request", name).lines[0]

        self.assertEqual(line.managed_device, self.first)
        self.assertEqual(line.target_scope, "Device")
        self.assertTrue(
            line.requested_for_requested_client_user, "the person is still the one to be created"
        )
        self.assertEqual(
            frappe.db.get_value(
                REQUESTED_CLIENT_USER, line.requested_for_requested_client_user, "full_name"
            ),
            "Nadia Newcomer",
            "and the line still says who they are",
        )

    def test_two_machines_asked_for_without_naming_them_are_still_two(self):
        nadia = self.newcomer()
        name = self.raise_it(
            [nadia],
            [
                self.machine_act("device.assign", nadia),
                self.machine_act("device.assign", nadia),
            ],
        )
        doc = frappe.get_doc("MSP Request", name)

        self.assertEqual(len(doc.lines), 2, "asking twice for a machine is asking for two")
        self.assertEqual(
            len({row.device_requirement_key for row in doc.lines}),
            2,
            "and two machines are prepared, not one shared between them",
        )

    def test_one_act_reaching_a_person_twice_is_still_one_line(self):
        """Picked by hand and again through a Department: one thing to do, said twice."""
        helen = self.existing(self.helen)
        group = self.service_act(helen, self.on_a_person)
        group["targets"].append(dict(group["targets"][0]))

        name = self.raise_it([helen], [group])

        self.assertEqual(
            len(frappe.get_doc("MSP Request", name).lines),
            1,
            "one act naming the same person twice is one line",
        )

    def test_the_same_machine_asked_for_twice_is_refused(self):
        nadia = self.newcomer()

        with self.assertRaises(ValidationError) as caught:
            self.raise_it(
                [nadia],
                [
                    self.machine_act("device.assign", nadia, device=self.first),
                    self.machine_act("device.assign", nadia, device=self.first),
                ],
            )

        self.assertIn("twice", str(caught.exception))

    def test_the_same_service_asked_for_twice_is_refused_not_dropped(self):
        """The refusal is the point: it used to keep one and say nothing about the other."""
        helen = self.existing(self.helen)

        with self.assertRaises(ValidationError) as caught:
            self.raise_it(
                [helen],
                [
                    self.service_act(helen, self.on_a_person),
                    self.service_act(helen, self.on_a_person),
                ],
            )

        self.assertIn("twice", str(caught.exception))

    def test_a_newcomer_may_be_given_a_machine_somebody_else_holds(self):
        """It becomes a change of holder, and names nobody who does not exist yet."""
        owner = self.make_person(self.customer, "Owen")
        held = self.make_device(
            self.customer,
            hostname=f"H4-{self.tag[:4]}",
            holder=owner,
            serial=f"ZZTEST-N-{self.tag}",
        )
        nadia = self.newcomer()
        name = self.raise_it([nadia], [self.machine_act("device.assign", nadia, device=held)])
        line = frappe.get_doc("MSP Request", name).lines[0]

        self.assertEqual(line.operation_code, "device.transfer")
        self.assertEqual(line.managed_device, held)
        self.assertTrue(
            line.requested_for_requested_client_user, "the person is still one to create"
        )
        self.assertFalse(
            line.requested_for_user,
            "a person who does not exist yet is not the person the machine is leaving",
        )

    def test_a_request_of_many_acts_carries_one_line_per_target(self):
        """The invariant the suite never stated: nothing asked for goes missing."""
        nadia = self.newcomer()
        helen = self.existing(self.helen)
        groups = [
            self.machine_act("device.assign", nadia, device=self.first),
            self.machine_act("device.assign", nadia, device=self.second),
            self.service_act(helen, self.on_a_person),
            self.service_act(nadia, self.on_a_person),
        ]
        name = self.raise_it([nadia, helen], groups)
        doc = frappe.get_doc("MSP Request", name)

        self.assertEqual(
            len(doc.lines),
            sum(len(group["targets"]) for group in groups),
            "one line per concrete target, for every act",
        )
        self.assertEqual(
            {row.action_group_key for row in doc.lines},
            {group["group_key"] for group in groups},
            "and every act the customer added is represented by at least one line",
        )
        self.assertEqual(
            len(doc.action_groups),
            len(groups),
            "the count the review screen reads is the count the lines answer",
        )


class TestTheMachinesAreReallyHandedOver(ActsCase):
    """Two lines are worth nothing if the work only ever hands over one machine."""

    def test_both_machines_end_up_with_the_person_who_was_created(self):
        nadia = self.newcomer()
        name = self.raise_it(
            [nadia],
            [
                self.machine_act("device.assign", nadia, device=self.first),
                self.machine_act("device.assign", nadia, device=self.second),
            ],
        )
        doc = frappe.get_doc("MSP Request", name)
        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="start_review"))

        for row in doc.lines:
            self.as_user(
                self.tech,
                lambda idx=row.idx: RequestService.set_line_status(
                    name=name, idx=idx, line_status="Approved"
                ),
            )

        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="approve"))

        orders = frappe.get_all(
            WORK_ORDER,
            filters={"request": name},
            fields=["name", "work_type", "managed_device", "requested_holder", "requested_holder_requested_client_user"],
            order_by="creation asc",
        )

        for order in orders:
            self.track(WORK_ORDER, order.name)

        requested = frappe.get_all(REQUESTED_CLIENT_USER, filters={"request": name}, pluck="name")
        machines = [row for row in orders if row.work_type == "Device Operation"]

        self.assertEqual(len(requested), 1, "one person to resolve")
        self.assertEqual([row.work_type for row in orders], ["Device Operation", "Device Operation"])
        self.assertEqual(
            sorted(row.managed_device for row in machines),
            sorted([self.first, self.second]),
            "each work order carries the machine its line named",
        )
        self.assertEqual(
            [row.requested_holder for row in machines],
            [None, None],
            "nobody is named as holder while the person does not exist",
        )
        self.assertEqual(
            [row.requested_holder_requested_client_user for row in machines],
            requested * 2,
            "both machines wait for the same requested person",
        )

        person = self.as_user(
            self.tech,
            lambda: RequestedClientUserService.resolve_create(
                requested[0], {"username": f"zz.nadia.{self.tag[:4]}", "department": self.department}
            ),
        )
        self.track("MSP Client User", person)

        self.assertTrue(person, "the person the machines are for now exists")

        self.assertEqual(
            sorted(
                frappe.get_all(
                    WORK_ORDER,
                    filters={"name": ("in", [row.name for row in machines])},
                    pluck="requested_holder",
                )
            ),
            [person, person],
            "and the machines asked for them now name them, without being told again",
        )

        # carried out with nothing further supplied: the work order knows who it is for
        for order in machines:
            self.as_user(
                self.tech,
                lambda o=order.name: RequestExecutionService.execute_device_operation(
                    work_order=o
                ),
            )

        held = frappe.get_all(
            "MSP Managed Device",
            filters={"assigned_client_user": person},
            pluck="name",
        )

        self.assertEqual(
            sorted(held),
            sorted([self.first, self.second]),
            "the person asked for two machines and holds two",
        )
        self.assertEqual(
            {row.requested_holder_requested_client_user for row in frappe.get_doc("MSP Request", name).lines},
            set(requested),
            "the lines still name the requested person",
        )


class TestAMachineArrivingOpensItsServices(ActsCase):
    """A service that runs on a machine, for somebody the request is giving a machine to."""

    def offered(self, subjects, groups=None):
        return self.as_user(
            self.manager,
            lambda: RequestScopeService.operation_options(
                customer=self.customer,
                subjects=subjects,
                action_groups=groups,
            ),
        )

    def add_action(self, options, service):
        for domain in options["domains"]:
            if domain["key"] != "Service":
                continue

            for card in domain["options"]:
                if card["object_key"] != service:
                    continue

                for action in card["actions"]:
                    if action["operation_code"] == "service.add":
                        return action

        return None

    def test_without_a_machine_the_service_is_still_refused(self):
        helen = self.existing(self.helen)
        action = self.add_action(self.offered([helen]), self.on_a_machine)

        self.assertIsNotNone(action, "the act is offered, and shut")
        self.assertEqual(action["applicable_target_count"], 0)
        self.assertEqual(
            {row["reason_code"] for row in action["exclusions"]},
            {"NO_CURRENT_DEVICE"},
            "they hold no machine, and that is the whole reason",
        )

    def test_a_machine_this_request_hands_over_counts_as_theirs(self):
        helen = self.existing(self.helen)
        giving = self.machine_act("device.assign", helen, device=self.first, holder=self.helen)
        action = self.add_action(self.offered([helen], [giving]), self.on_a_machine)

        self.assertIsNotNone(action)
        self.assertEqual(
            action["applicable_target_count"],
            1,
            "the machine arriving in this same request is a machine they will have",
        )
        self.assertEqual(
            action["targets"][0]["managed_device"],
            self.first,
            "and the service is put on that machine, not on some other one",
        )

    def test_a_machine_asked_for_without_naming_one_opens_nothing(self):
        """No machine has been chosen, so there is none for a service to run on."""
        helen = self.existing(self.helen)
        vague = self.machine_act("device.assign", helen, holder=self.helen)
        action = self.add_action(self.offered([helen], [vague]), self.on_a_machine)

        self.assertEqual(action["applicable_target_count"], 0)
        self.assertEqual(
            {row["reason_code"] for row in action["exclusions"]}, {"NO_CURRENT_DEVICE"}
        )

    def test_a_machine_being_transferred_counts_for_the_person_receiving_it(self):
        other = self.make_person(self.customer, "Owen")
        held = self.make_device(
            self.customer,
            hostname=f"H3-{self.tag[:4]}",
            holder=other,
            serial=f"ZZTEST-H-{self.tag}",
        )
        helen = self.existing(self.helen)
        moving = self.machine_act(
            "device.transfer",
            self.existing(other),
            device=held,
            holder=self.helen,
            label="Change holder",
        )
        action = self.add_action(self.offered([helen], [moving]), self.on_a_machine)

        self.assertEqual(
            action["applicable_target_count"],
            1,
            "the machine is on its way to them, whoever holds it today",
        )
        self.assertEqual(action["targets"][0]["managed_device"], held)
