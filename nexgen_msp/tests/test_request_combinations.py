"""Every shape of request, carried out, and what each one is supposed to change.

One test proving one path is worth little: the risk lives in the combinations. A suspend on a
machine's service reads differently from a suspend on a person's; a request refused inside the
company must change nothing at all; a line we turn down must leave the state it names exactly
where it was while its neighbours go through.

So this module is a table. Each case says what the world looks like before, what is asked, who
decides, and what must be true afterwards — the record, and the history the person's own page
tells. A case that changes nothing says so as loudly as one that changes everything.

The cases are driven through the real services, in the order a real request goes through them:
raised by the customer, agreed to inside their company when their matrix says so, decided line
by line by us, then carried out. Nothing is written directly.
"""

import frappe

from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.user_360_service import User360Service
from nexgen_msp.api.portal.services.portal_service import PortalService

from .base import MSPTestCase

WORK_ORDER = "MSP Service Work Order"
ASSIGNMENT = "MSP Service Assignment"


class RequestMatrixCase(MSPTestCase):
    """One company, two people, two machines, three services: enough to combine."""

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(f"RC{self.tag[:4]}")
        self.track("MSP Approval Authority", self.customer)

        self.alice = self.make_person(self.customer, "Alice")
        self.bruno = self.make_person(self.customer, "Bruno")

        self.laptop = self.make_device(
            self.customer,
            hostname=f"LT-{self.tag[:4]}",
            holder=self.alice,
            serial=f"ZZTEST-A-{self.tag}",
        )
        self.spare = self.make_device(
            self.customer, hostname=f"SP-{self.tag[:4]}", serial=f"ZZTEST-S-{self.tag}"
        )

        self.personal = self.make_service(f"RP{self.tag[:3]}", scope="User")
        self.machine = self.make_service(f"RM{self.tag[:3]}", scope="Device")
        self.cover_service(self.customer, self.personal)
        self.cover_service(self.customer, self.machine)

        # one who asks and decides, one who only asks: both doors into the same queue
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"rm{self.tag[:3]}"
        )
        self.grant(self.manager, can_submit=1, can_approve=1)

        self.clerk = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"rc{self.tag[:3]}"
        )
        self.grant(self.clerk, can_submit=1, can_approve=0)

        self.tech = self.make_account("internal", "MSP Technician", suffix=f"rt{self.tag[:3]}")
        self.admin = self.make_account("internal", "MSP System Admin", suffix=f"ra{self.tag[:3]}")

    def tearDown(self):
        """Take this company's services away, whether or not a test asked for them by name.

        Work carried out here opens assignments nobody tracked: they are a side effect of the
        act, not a fixture. Left behind they outlive the people they name, and a later run
        whose person is given the same identifier inherits them.
        """
        frappe.set_user("Administrator")

        for name in frappe.get_all(ASSIGNMENT, filters={"customer": self.customer}, pluck="name"):
            frappe.delete_doc(ASSIGNMENT, name, force=True, ignore_permissions=True)

        super().tearDown()

    # ------------------------------------------------------------------ driving it
    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def raise_as(self, who, *lines):
        out = self.as_user(
            who, lambda: PortalService.create_request(customer=self.customer, lines=list(lines))
        )

        return self.track("MSP Service Request", out["name"])

    def decide(self, name, idx, status, reason=None, actor=None):
        self.as_user(
            actor or self.tech,
            lambda: RequestService.set_line_status(
                name=name, idx=idx, line_status=status, reason=reason
            ),
        )

    def start_work(self, name, actor=None):
        self.as_user(actor or self.tech, lambda: RequestService.run_action(name=name, action="approve"))

        for order in frappe.get_all(WORK_ORDER, filters={"service_request": name}, pluck="name"):
            self.track(WORK_ORDER, order)

    def carry_out(self, name, actor=None):
        """Run every work order the request planned, whatever kind it is."""
        done = []

        for order in frappe.get_all(
            WORK_ORDER,
            filters={"service_request": name},
            fields=["name", "work_type", "status", "operation_code", "service_item"],
            order_by="creation asc",
        ):
            if order.status in ("Completed", "Cancelled"):
                continue

            if order.work_type == "Device Operation":
                self.as_user(
                    actor or self.tech,
                    lambda o=order.name: RequestExecutionService.execute_device_operation(
                        work_order=o
                    ),
                )
            elif order.work_type == "Service Action":
                # the service says it is identified by a username, and the work is where that
                # is given: doing it any other way would be testing a door we do not use
                # a change names the service it changes to; every other act acts on the one
                # already there, so passing it would say nothing
                wanted = order.service_item if order.operation_code == "service.change" else None
                # one username per person, because the application holds them unique per
                # customer and is right to: two people cannot be the same account
                who = frappe.db.get_value(WORK_ORDER, order.name, "client_user") or "none"
                mine = f"zz.{who.lower().replace('-', '')}"

                self.as_user(
                    actor or self.tech,
                    lambda o=order.name, w=wanted, u=mine: (
                        RequestExecutionService.execute_service_action(
                            work_order=o, username=u, service_item=w
                        )
                    ),
                )
            else:
                continue

            done.append(order.name)

        return done

    def through(self, line, decision="Approved", actor=None, who=None, reason=None):
        """Raise one line, decide it, and carry out whatever it planned."""
        name = self.raise_as(who or self.manager, line)
        doc = frappe.get_doc("MSP Service Request", name)

        for row in doc.lines:
            self.decide(name, row.idx, decision, reason=reason, actor=actor)

        if decision == "Approved":
            self.start_work(name, actor=actor)
            self.carry_out(name, actor=actor)
            # a request left open holds its targets: the application refuses a second act on
            # an assignment somebody is already changing, and it is right to
            self.as_user(
                actor or self.tech,
                lambda: RequestService.run_action(name=name, action="complete"),
            )

        return name

    # ------------------------------------------------------------------ the world
    def running(self, service, scope="User", device=None, person=None, started=-30):
        """A service already open, so acts that need one have something to act on."""
        out = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope=scope,
            client_user=None if scope == "Device" else (person or self.alice),
            managed_device=device or (self.laptop if scope == "Device" else None),
            effective_date=str(frappe.utils.add_days(frappe.utils.today(), started)),
        )

        return self.track(ASSIGNMENT, out["name"])

    def state(self, assignment):
        return frappe.db.get_value(
            ASSIGNMENT, assignment, ["operational_status", "billing_status"], as_dict=True
        )

    def holder_of(self, device):
        return frappe.db.get_value("MSP Managed Device", device, "assigned_client_user")

    def history_of(self, person):
        page = User360Service.read_user(person)

        return " | ".join(str(event.get("what") or "") for event in page["recent_activity"])

    def one_of(self, person, service):
        """The single assignment this person holds of that service, and it must be single."""
        found = frappe.get_all(
            ASSIGNMENT,
            filters={"client_user": person, "service_item": service},
            fields=["name"],
        )

        self.assertEqual(len(found), 1, f"expected one {service} on {person}, found {len(found)}")
        self.track(ASSIGNMENT, found[0].name)

        return found[0].name

    def line(self, code, **fields):
        return {"operation_code": code, "target_scope": "User", **fields}

    def service_line(self, code, assignment=None, **fields):
        fields.setdefault("requested_service", self.personal)
        fields.setdefault("client_user", self.alice)
        row = self.line(code, **fields)

        if assignment:
            row["source_service_assignment"] = assignment

        return row


class TestTheHarness(RequestMatrixCase):
    """Two cases first, so the table below leans on machinery that is known to work."""

    def test_adding_a_personal_service_opens_it_and_the_page_says_so(self):
        self.through(self.service_line("service.add"))

        opened = frappe.get_all(
            ASSIGNMENT,
            filters={"client_user": self.alice, "service_item": self.personal},
            fields=["name", "operational_status"],
        )

        self.assertEqual(len(opened), 1, "one ask, one service")
        self.assertEqual(opened[0].operational_status, "Active")
        self.track(ASSIGNMENT, opened[0].name)
        self.assertIn("activated", self.history_of(self.alice))

    def test_a_line_we_turn_down_changes_nothing_at_all(self):
        before = frappe.db.count(ASSIGNMENT, {"client_user": self.alice})

        name = self.through(
            self.service_line("service.add"), decision="Rejected", reason="not this quarter"
        )

        self.assertEqual(frappe.db.count(ASSIGNMENT, {"client_user": self.alice}), before)
        self.assertEqual(
            frappe.db.count(WORK_ORDER, {"service_request": name}),
            0,
            "a refused line plans no work",
        )


class TestEveryServiceActOnAPerson(RequestMatrixCase):
    """The five acts a service knows, asked on a person, one at a time."""

    def test_add_opens_a_service_that_was_not_there(self):
        self.through(self.service_line("service.add"))
        opened = self.one_of(self.alice, self.personal)

        self.assertEqual(self.state(opened).operational_status, "Active")
        self.assertEqual(self.state(opened).billing_status, "Billable")

    def test_suspend_holds_it_without_closing_it(self):
        running = self.running(self.personal)

        self.through(self.service_line("service.suspend", assignment=running))

        self.assertEqual(self.state(running).operational_status, "Suspended")
        self.assertEqual(
            self.state(running).billing_status, "On Hold", "a held service is not billed"
        )
        self.assertIsNone(
            frappe.db.get_value(ASSIGNMENT, running, "effective_end_date"),
            "suspending is not ending",
        )

    def test_resume_puts_a_held_service_back(self):
        running = self.running(self.personal)
        self.through(self.service_line("service.suspend", assignment=running))

        self.through(self.service_line("service.resume", assignment=running))

        self.assertEqual(self.state(running).operational_status, "Active")
        self.assertEqual(self.state(running).billing_status, "Billable")

    def test_end_closes_it_and_leaves_it_on_the_record(self):
        running = self.running(self.personal)

        self.through(self.service_line("service.end", assignment=running))

        self.assertEqual(self.state(running).operational_status, "Ended")
        self.assertIsNotNone(
            frappe.db.get_value(ASSIGNMENT, running, "effective_end_date"),
            "what ended says when",
        )
        self.assertTrue(frappe.db.exists(ASSIGNMENT, running), "ending is not erasing")

    def test_change_closes_one_and_opens_the_other(self):
        running = self.running(self.personal)
        wanted = self.make_service(f"RW{self.tag[:3]}", scope="User")
        self.cover_service(self.customer, wanted)

        self.through(
            self.service_line("service.change", assignment=running, requested_service=wanted)
        )

        self.assertEqual(self.state(running).operational_status, "Ended")

        fresh = self.one_of(self.alice, wanted)
        self.assertEqual(self.state(fresh).operational_status, "Active")


class TestEveryServiceActOnAMachine(RequestMatrixCase):
    """The same five acts, on a machine's service: the target moves, the rules do not."""

    def machine_line(self, code, assignment=None, device=None, **fields):
        row = {
            "operation_code": code,
            "target_scope": "Device",
            "managed_device": device or self.laptop,
            "requested_service": self.machine,
            **fields,
        }

        if assignment:
            row["source_service_assignment"] = assignment

        return row

    def test_add_opens_it_on_the_machine_not_on_the_person(self):
        self.through(self.machine_line("service.add"))

        opened = frappe.get_all(
            ASSIGNMENT,
            filters={"managed_device": self.laptop, "service_item": self.machine},
            fields=["name", "assignment_scope", "client_user"],
        )

        self.assertEqual(len(opened), 1)
        self.assertEqual(opened[0].assignment_scope, "Device")
        self.assertIsNone(opened[0].client_user, "a machine's service belongs to the machine")
        self.track(ASSIGNMENT, opened[0].name)

    def test_suspend_and_resume_read_on_the_machine(self):
        running = self.running(self.machine, scope="Device")

        self.through(self.machine_line("service.suspend", assignment=running))
        self.assertEqual(self.state(running).operational_status, "Suspended")

        self.through(self.machine_line("service.resume", assignment=running))
        self.assertEqual(self.state(running).operational_status, "Active")

    def test_end_closes_it_and_the_machine_keeps_its_history(self):
        running = self.running(self.machine, scope="Device")

        self.through(self.machine_line("service.end", assignment=running))

        self.assertEqual(self.state(running).operational_status, "Ended")
        self.assertEqual(
            frappe.db.get_value(ASSIGNMENT, running, "managed_device"),
            self.laptop,
            "the machine it ran on is not forgotten",
        )

    def test_the_holder_reads_it_while_they_hold_the_machine(self):
        self.running(self.machine, scope="Device")

        page = User360Service.read_user(self.alice)
        names = [row["service_name"] for row in page["services"]]

        self.assertTrue(
            any(self.machine in row["service_item"] for row in page["services"]),
            f"the machine's service is on the holder's page: {names}",
        )


class TestEveryMachineAct(RequestMatrixCase):
    """What can be asked of a machine itself, and who ends up holding it."""

    def machine_op(self, code, **fields):
        return {
            "operation_code": code,
            "target_scope": "Device",
            "managed_device": self.laptop,
            **fields,
        }

    def test_a_holder_change_hands_it_over(self):
        self.through(self.machine_op("device.transfer", requested_holder=self.bruno))

        self.assertEqual(self.holder_of(self.laptop), self.bruno)

    def test_returning_it_leaves_it_with_nobody(self):
        self.through(self.machine_op("device.repossess"))

        self.assertIsNone(self.holder_of(self.laptop))
        self.assertEqual(
            frappe.db.get_value("MSP Managed Device", self.laptop, "status"),
            "Stock",
            "a machine nobody holds is in stock, not retired",
        )

    def test_assigning_a_free_machine_gives_it_to_them(self):
        self.through(
            {
                "operation_code": "device.assign",
                "target_scope": "Device",
                "managed_device": self.spare,
                "requested_holder": self.bruno,
            }
        )

        self.assertEqual(self.holder_of(self.spare), self.bruno)

    def test_asking_for_a_machine_somebody_holds_is_a_holder_change(self):
        name = self.raise_as(
            self.manager,
            {
                "operation_code": "device.assign",
                "target_scope": "Device",
                "managed_device": self.laptop,
                "requested_holder": self.bruno,
            },
        )

        line = frappe.get_doc("MSP Service Request", name).lines[0]

        self.assertEqual(line.operation_code, "device.transfer")
        self.assertEqual(line.requested_holder, self.bruno)

    def test_the_machine_is_untouched_until_the_work_runs(self):
        name = self.raise_as(self.manager, self.machine_op("device.transfer", requested_holder=self.bruno))

        self.assertEqual(self.holder_of(self.laptop), self.alice, "asking is not doing")

        doc = frappe.get_doc("MSP Service Request", name)
        for row in doc.lines:
            self.decide(name, row.idx, "Approved")
        self.start_work(name)

        self.assertEqual(self.holder_of(self.laptop), self.alice, "nor is accepting")

        self.carry_out(name)

        self.assertEqual(self.holder_of(self.laptop), self.bruno, "doing is doing")


class TestWhatIsRefusedAtTheDoor(RequestMatrixCase):
    """Combinations the application must not let through, each for its own reason."""

    def refused(self, line, saying):
        with self.assertRaises(Exception) as caught:
            self.raise_as(self.manager, line)

        self.assertIn(saying, str(getattr(caught.exception, "message", caught.exception)))

    def test_a_new_person_cannot_have_a_service_changed(self):
        self.refused(
            {
                "operation_code": "service.change",
                "target_scope": "User",
                "is_new_user": 1,
                "new_user_full_name": "ZZTEST Newcomer",
                "requested_service": self.personal,
            },
            "A new person can only be granted a service",
        )

    def test_a_service_nobody_holds_cannot_be_suspended(self):
        self.refused(
            self.service_line("service.suspend"),
            "say which service is to be suspend",
        )

    def test_a_customer_cannot_ask_for_a_machine_to_be_retired(self):
        self.refused(
            {
                "operation_code": "device.retire",
                "target_scope": "Device",
                "managed_device": self.laptop,
            },
            "",
        )

    def test_a_machine_of_another_company_is_refused(self):
        other = self.make_customer(f"RX{self.tag[:4]}")
        theirs = self.make_device(other, hostname=f"OT-{self.tag[:4]}", serial=f"ZZTEST-O-{self.tag}")

        self.refused(
            {
                "operation_code": "device.repossess",
                "target_scope": "Device",
                "managed_device": theirs,
            },
            "does not belong to",
        )


class TestRequestsMadeOfSeveralThings(RequestMatrixCase):
    """One request, several lines: each one stands or falls on its own."""

    def raise_many(self, *lines):
        return self.raise_as(self.manager, *lines)

    def statuses(self, name):
        return [row.line_status for row in frappe.get_doc("MSP Service Request", name).lines]

    def test_two_people_one_service_is_two_lines_carried_out_together(self):
        name = self.raise_many(
            self.service_line("service.add"),
            self.service_line("service.add", client_user=self.bruno),
        )

        for row in frappe.get_doc("MSP Service Request", name).lines:
            self.decide(name, row.idx, "Approved")

        self.start_work(name)
        self.carry_out(name)

        self.assertEqual(self.state(self.one_of(self.alice, self.personal)).operational_status, "Active")
        self.assertEqual(self.state(self.one_of(self.bruno, self.personal)).operational_status, "Active")

    def test_one_line_accepted_and_one_refused_leaves_only_one_mark(self):
        name = self.raise_many(
            self.service_line("service.add"),
            self.service_line("service.add", client_user=self.bruno),
        )
        rows = frappe.get_doc("MSP Service Request", name).lines

        self.decide(name, rows[0].idx, "Approved")
        self.decide(name, rows[1].idx, "Rejected", reason="Bruno is leaving")

        self.start_work(name)
        self.carry_out(name)

        self.assertEqual(sorted(self.statuses(name)), ["Approved", "Rejected"])
        self.one_of(self.alice, self.personal)
        self.assertEqual(
            frappe.db.count(ASSIGNMENT, {"client_user": self.bruno, "service_item": self.personal}),
            0,
            "what we turned down left nothing behind",
        )

    def test_a_personal_and_a_machine_act_in_one_request_reach_both_targets(self):
        name = self.raise_many(
            self.service_line("service.add"),
            {
                "operation_code": "service.add",
                "target_scope": "Device",
                "managed_device": self.laptop,
                "requested_service": self.machine,
            },
        )

        for row in frappe.get_doc("MSP Service Request", name).lines:
            self.decide(name, row.idx, "Approved")

        self.start_work(name)
        self.carry_out(name)

        self.one_of(self.alice, self.personal)
        self.assertEqual(
            frappe.db.count(
                ASSIGNMENT, {"managed_device": self.laptop, "service_item": self.machine}
            ),
            1,
        )

    def test_a_service_act_and_a_machine_act_together_are_one_mixed_request(self):
        name = self.raise_many(
            self.service_line("service.add"),
            {
                "operation_code": "device.transfer",
                "target_scope": "Device",
                "managed_device": self.laptop,
                "requested_holder": self.bruno,
            },
        )

        self.assertEqual(
            frappe.db.get_value("MSP Service Request", name, "request_type"),
            "Mixed",
            "a request about both is called neither",
        )

        for row in frappe.get_doc("MSP Service Request", name).lines:
            self.decide(name, row.idx, "Approved")

        self.start_work(name)
        self.carry_out(name)

        self.one_of(self.alice, self.personal)
        self.assertEqual(self.holder_of(self.laptop), self.bruno)

    def test_rejecting_every_line_leaves_the_whole_request_with_nothing_to_do(self):
        name = self.raise_many(
            self.service_line("service.add"),
            self.service_line("service.add", client_user=self.bruno),
        )

        for row in frappe.get_doc("MSP Service Request", name).lines:
            self.decide(name, row.idx, "Rejected", reason="not this quarter")

        self.assertEqual(set(self.statuses(name)), {"Rejected"})
        self.assertEqual(frappe.db.count(WORK_ORDER, {"service_request": name}), 0)

    def test_asking_twice_for_the_same_thing_never_opens_it_twice(self):
        """One wish, one service, however many times it was written down.

        Acts on a service already open are refused as a pair at the door, because they name
        the assignment they touch. Two additions name nothing yet, so the guard cannot see
        them — what must hold is the outcome: the person ends up holding it once.
        """
        name = self.raise_many(self.service_line("service.add"), self.service_line("service.add"))

        for row in frappe.get_doc("MSP Service Request", name).lines:
            self.decide(name, row.idx, "Approved")

        self.start_work(name)
        self.carry_out(name)

        opened = frappe.get_all(
            ASSIGNMENT,
            filters={"client_user": self.alice, "service_item": self.personal},
            fields=["name", "operational_status"],
        )

        for row in opened:
            self.track(ASSIGNMENT, row.name)

        live = [row for row in opened if row.operational_status not in ("Ended", "Cancelled")]

        self.assertEqual(len(live), 1, f"asked twice, opened {len(live)} times")

    def test_two_contradictory_acts_on_one_service_are_refused_as_a_pair(self):
        running = self.running(self.personal)

        with self.assertRaises(Exception) as caught:
            self.raise_many(
                self.service_line("service.suspend", assignment=running),
                self.service_line("service.end", assignment=running),
            )

        self.assertIn(
            "already asks for something on that same service",
            str(getattr(caught.exception, "message", caught.exception)),
        )


class TestTheAccordInsideTheCompany(RequestMatrixCase):
    """Who may decide, and what a request does while it waits."""

    def test_somebody_who_cannot_decide_sends_it_to_their_own_company_first(self):
        name = self.raise_as(self.clerk, self.service_line("service.add"))

        self.assertEqual(
            frappe.db.get_value("MSP Service Request", name, "status"),
            "Awaiting Customer Approval",
        )
        self.assertEqual(
            frappe.db.count(ASSIGNMENT, {"client_user": self.alice, "service_item": self.personal}),
            0,
            "nothing is opened while it waits",
        )

    def test_the_accord_sends_it_to_us(self):
        name = self.raise_as(self.clerk, self.service_line("service.add"))

        self.as_user(self.manager, lambda: PortalService.approve_request(name=name))

        self.assertEqual(
            frappe.db.get_value("MSP Service Request", name, "status"), "Submitted"
        )

    def test_a_refusal_inside_the_company_stops_it_there(self):
        name = self.raise_as(self.clerk, self.service_line("service.add"))

        self.as_user(
            self.manager,
            lambda: PortalService.reject_request(name=name, reason="not this quarter"),
        )

        self.assertEqual(
            frappe.db.get_value("MSP Service Request", name, "status"), "Rejected"
        )
        self.assertEqual(
            frappe.db.count(ASSIGNMENT, {"client_user": self.alice, "service_item": self.personal}),
            0,
        )

    def test_a_refusal_without_a_reason_is_refused(self):
        name = self.raise_as(self.clerk, self.service_line("service.add"))

        with self.assertRaises(Exception) as caught:
            self.as_user(self.manager, lambda: PortalService.reject_request(name=name))

        self.assertIn(
            "reason is required", str(getattr(caught.exception, "message", caught.exception))
        )

    def test_somebody_who_holds_both_rights_reaches_us_in_one_gesture(self):
        name = self.raise_as(self.manager, self.service_line("service.add"))

        self.assertEqual(
            frappe.db.get_value("MSP Service Request", name, "status"),
            "Submitted",
            "deciding for yourself is deciding",
        )


class TestWhoCarriesItOut(RequestMatrixCase):
    """The same request, done by a technician and by an administrator."""

    def test_a_technician_carries_it_out(self):
        self.through(self.service_line("service.add"), actor=self.tech)

        self.assertEqual(self.state(self.one_of(self.alice, self.personal)).operational_status, "Active")

    def test_an_administrator_carries_the_same_thing_out(self):
        self.through(self.service_line("service.add", client_user=self.bruno), actor=self.admin)

        self.assertEqual(self.state(self.one_of(self.bruno, self.personal)).operational_status, "Active")

    def test_a_customer_account_cannot_decide_our_lines(self):
        name = self.raise_as(self.manager, self.service_line("service.add"))
        row = frappe.get_doc("MSP Service Request", name).lines[0]

        with self.assertRaises(Exception):
            self.decide(name, row.idx, "Approved", actor=self.manager)


class TestHowThePeopleWereChosen(RequestMatrixCase):
    """The same act, asked through each door into the People table.

    What a request does must not depend on how its people were picked — but what it *remembers*
    must: a line chosen from a Department says so, and keeps saying so a year later when the
    person has moved on.
    """

    def setUp(self):
        super().setUp()
        self.sales = self.make_department("Sales")
        frappe.db.set_value("MSP Client User", self.alice, "department", self.sales)
        frappe.db.set_value("MSP Client User", self.bruno, "department", self.sales)

    def from_scope(self, person, origin, label, key=None):
        return self.service_line(
            "service.add",
            client_user=person,
            selection_origin=origin,
            selection_group_key=key,
            selection_label=label,
        )

    def test_a_person_named_one_by_one_carries_no_group(self):
        name = self.through(self.service_line("service.add"))
        line = frappe.get_doc("MSP Service Request", name).lines[0]

        # the word the application uses for somebody picked on their own
        self.assertEqual(line.selection_origin, "Individual")
        self.one_of(self.alice, self.personal)

    def test_a_department_load_remembers_the_department_it_came_from(self):
        name = self.through(
            self.from_scope(self.alice, "Department", self.sales, key=self.sales)
        )
        line = frappe.get_doc("MSP Service Request", name).lines[0]

        self.assertEqual(line.selection_origin, "Department")
        self.assertEqual(line.selection_label, self.sales)
        self.one_of(self.alice, self.personal)

    def test_the_whole_company_remembers_it_was_the_whole_company(self):
        name = self.through(
            self.from_scope(self.bruno, "Company", "Entire company")
        )
        line = frappe.get_doc("MSP Service Request", name).lines[0]

        self.assertEqual(line.selection_origin, "Company")
        self.one_of(self.bruno, self.personal)

    def test_a_department_of_two_reaches_both_and_says_so_on_each(self):
        name = self.raise_as(
            self.manager,
            self.from_scope(self.alice, "Department", self.sales, key=self.sales),
            self.from_scope(self.bruno, "Department", self.sales, key=self.sales),
        )

        for row in frappe.get_doc("MSP Service Request", name).lines:
            self.decide(name, row.idx, "Approved")

        self.start_work(name)
        self.carry_out(name)

        for row in frappe.get_doc("MSP Service Request", name).lines:
            self.assertEqual(row.selection_origin, "Department")

        self.one_of(self.alice, self.personal)
        self.one_of(self.bruno, self.personal)

    def test_a_person_who_does_not_exist_yet_is_created_by_the_work(self):
        name = self.raise_as(
            self.manager,
            {
                "operation_code": "service.add",
                "target_scope": "User",
                "is_new_user": 1,
                "new_user_full_name": f"ZZTEST Newcomer {self.tag[:4]}",
                "new_user_department": self.sales,
                "new_user_username": f"zz.new{self.tag[:4]}",
                "requested_service": self.personal,
            },
        )

        for row in frappe.get_doc("MSP Service Request", name).lines:
            self.decide(name, row.idx, "Approved")

        self.start_work(name)

        waiting = frappe.get_all(
            WORK_ORDER,
            filters={"service_request": name, "work_type": "User Setup"},
            fields=["name", "status"],
        )

        self.assertEqual(len(waiting), 1, "somebody has to be put on file first")

        self.as_user(
            self.tech,
            lambda: RequestExecutionService.execute_user_setup(
                work_order=waiting[0].name,
                username=f"zz.new{self.tag[:4]}",
                department=self.sales,
            ),
        )

        person = frappe.db.get_value(
            "MSP Client User",
            {"customer": self.customer, "full_name": f"ZZTEST Newcomer {self.tag[:4]}"},
            "name",
        )

        self.assertIsNotNone(person, "the work put them on file")
        self.track("MSP Client User", person)

        self.assertTrue(frappe.db.exists("MSP Client User", person))
        self.assertEqual(
            frappe.db.get_value("MSP Client User", person, "department"),
            self.sales,
            "a new person ends up with the Department they were asked for",
        )

    def test_the_same_act_reaches_the_same_state_whichever_door_it_came_through(self):
        """The point of the whole class: how they were picked changes the memory, not the act."""
        one = self.through(self.service_line("service.add"))
        two = self.through(
            self.from_scope(self.bruno, "Department", self.sales, key=self.sales)
        )

        for name, person in ((one, self.alice), (two, self.bruno)):
            held = self.one_of(person, self.personal)

            self.assertEqual(self.state(held).operational_status, "Active")
            self.assertEqual(self.state(held).billing_status, "Billable")
            self.assertEqual(
                frappe.db.get_value("MSP Service Request", name, "status"), "Completed"
            )


class TestWhoCanBeGivenAMachine(RequestMatrixCase):
    """The people a holder change may name.

    The picker used to be built from the request's own subjects, so asking to hand one machine
    over offered nobody: the only person selected was the one already holding it. Giving a
    machine to a colleague is not a reason to add that colleague to the request.
    """

    def options(self, subjects):
        from nexgen_msp.api.portal.services.request_v3_service import RequestV3Service

        out = self.as_user(
            self.manager,
            lambda: RequestV3Service.operation_options(customer=self.customer, subjects=subjects),
        )

        for domain in out["domains"]:
            if domain["key"] != "Device":
                continue

            for option in domain["options"]:
                if option["operation_code"] == "device.transfer":
                    return option

        return None

    def test_the_whole_company_is_offered_even_when_one_person_is_selected(self):
        option = self.options(
            [{"subject_key": f"user:{self.alice}", "client_user": self.alice, "full_name": "Alice"}]
        )

        self.assertIsNotNone(option, "a holder change is offered for somebody holding a machine")

        offered = {row["value"] for row in option["holder_options"]}

        self.assertIn(self.alice, offered)
        self.assertIn(
            self.bruno,
            offered,
            "somebody who is not in the request can still be given the machine",
        )

    def test_a_person_added_to_the_company_later_is_offered_too(self):
        fresh = self.make_person(self.customer, "Chantal")

        option = self.options(
            [{"subject_key": f"user:{self.alice}", "client_user": self.alice, "full_name": "Alice"}]
        )
        offered = {row["value"] for row in option["holder_options"]}

        self.assertIn(fresh, offered, "the picker reads the company, not a snapshot")

    def test_the_machine_really_goes_to_somebody_the_request_never_named(self):
        self.through(
            {
                "operation_code": "device.transfer",
                "target_scope": "Device",
                "managed_device": self.laptop,
                "requested_holder": self.bruno,
            }
        )

        self.assertEqual(self.holder_of(self.laptop), self.bruno)
