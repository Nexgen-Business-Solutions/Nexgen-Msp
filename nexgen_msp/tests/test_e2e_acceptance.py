"""Whole business journeys, walked end to end, checked against the records they leave.

Every phase has its own tests and they all pass on their own. What these ask is different:
that the phases are one product. A customer asks for something, a technician carries it out,
a machine changes hands, an invoice is drawn — and at each step the screen, the database, the
history and the money have to be telling the same story.

Nothing here asserts on a screen. A journey is judged by what it left behind.
"""

import zlib

import frappe
from frappe.utils import add_days, getdate

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.api.internal.services.department_service import DepartmentService
from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.user_360_service import User360Service
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import device_holders as holders
from nexgen_msp.utils.errors import NexgenError

from .base import MSPTestCase

WORK_ORDER = "MSP Service Work Order"


class AcceptanceCase(MSPTestCase):
    """One company per journey, and everything it needs to be walked from end to end."""

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", self.customer)
        self.today = frappe.utils.today()

        self.john = self.make_person(self.customer, "John", department="Accounting")
        frappe.db.set_value("MSP Client User", self.john, "username", f"j.{self.tag}")
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"ac{self.tag[:3]}"
        )
        self.grant(self.asker)
        self.tech = self.make_account("internal", "MSP Technician", suffix=f"at{self.tag[:3]}")

        self.contract = None
        self.price_list = None
        self.currency = None

    # ------------------------------------------------------------------ acting
    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def customer_does(self, fn):
        return self.as_user(self.asker, fn)

    def technician_does(self, fn):
        return self.as_user(self.tech, fn)

    # ------------------------------------------------------------------ the world
    def days_ago(self, days):
        return frappe.utils.add_days(self.today, -days)

    def offering(self, suffix, scope="User"):
        service = self.make_service(f"{suffix}{self.tag[:3]}", scope=scope)
        self.cover_service(self.customer, service)
        self.contract = frappe.db.get_value("MSP Contract", {"customer": self.customer}, "name")

        return service

    def laptop(self, hostname, holder=None, since=200, serial=None):
        device = self.make_device(
            self.customer, hostname=f"{hostname}{self.tag[:3]}", serial=serial
        )

        if holder:
            doc = frappe.get_doc("MSP Managed Device", device)
            holders.hand_over(doc, holder, on_date=self.days_ago(since))
            doc.status = "Active"
            doc.save(ignore_permissions=True)
            frappe.db.commit()

        return device

    def running(self, service, scope="User", started=200, **target):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope=scope,
            effective_date=self.days_ago(started),
            **target,
        )
        frappe.db.commit()

        return self.track("MSP Service Assignment", outcome["name"])

    # ------------------------------------------------------------------ the journey
    def line(self, service, **fields):
        action = fields.pop("action", "Add")

        return {
            "request_action": self.action(action),
            "action": action,
            "target_scope": "User",
            "client_user": self.john,
            "requested_service": service,
            **fields,
        }

    def raise_request(self, *lines):
        out = self.customer_does(
            lambda: PortalService.create_request(
                customer=self.customer, request_type="Add", lines=list(lines)
            )
        )

        return self.track("MSP Service Request", out["name"])

    def approve_request(self, name):
        doc = frappe.get_doc("MSP Service Request", name)

        for row in doc.lines:
            self.technician_does(
                lambda idx=row.idx: RequestService.set_line_status(
                    name=name, idx=idx, line_status="Approved"
                )
            )

        self.technician_does(lambda: RequestService.run_action(name=name, action="approve"))
        self.sweep(name)

        return name

    def sweep(self, request):
        for order in frappe.get_all(WORK_ORDER, filters={"service_request": request}, pluck="name"):
            self.track(WORK_ORDER, order)

        for assignment in frappe.get_all(
            "MSP Service Assignment", filters={"source_request": request}, pluck="name"
        ):
            self.track("MSP Service Assignment", assignment)

    def work(self, request, work_type, index=0):
        return frappe.get_all(
            WORK_ORDER,
            filters={"service_request": request, "work_type": work_type},
            fields=["name", "action", "status", "service_item"],
            order_by="request_line_idx asc, creation asc",
        )[index]

    def carry_out(self, request, work_order, checklist=True):
        """Run one service action and sign it off, the way the workbench does."""
        self.technician_does(
            lambda: RequestExecutionService.execute_service_action(work_order=work_order)
        )
        self.sweep(request)

        if checklist:
            self.technician_does(
                lambda: RequestExecutionService.verify_work_item(
                    work_order=work_order,
                    checklist={"Confirmed working for the customer": 1},
                )
            )

    def status_of(self, assignment):
        return frappe.db.get_value("MSP Service Assignment", assignment, "operational_status")


# ---------------------------------------------------------------------------------------
# §24-27 — somebody already on file asks for three changes at once
# ---------------------------------------------------------------------------------------
class TestJourneyOfAnExistingPerson(AcceptanceCase):
    def setUp(self):
        super().setUp()
        self.m365 = self.offering("E365")
        self.vpn = self.offering("EVPN")
        self.adobe = self.offering("EADO")
        self.rmm = self.offering("ERMM", scope="Device")
        self.sophos = self.offering("ESOP", scope="Device")

        self.laptop_a = self.laptop("LAPA", holder=self.john, serial=f"LA-{self.tag}")
        self.running(self.m365, client_user=self.john)
        self.running(self.sophos, scope="Device", managed_device=self.laptop_a)

        self.vpn_line = self.running(self.vpn, client_user=self.john)
        ServiceLifecycleService.suspend(
            assignment=self.vpn_line, effective_date=self.days_ago(30)
        )
        frappe.db.commit()

    def test_the_whole_journey_from_the_ask_to_the_final_state(self):
        request = self.raise_request(
            self.line(self.adobe),
            self.line(self.vpn, action="Resume", source_service_assignment=self.vpn_line),
            self.line(
                self.rmm, client_user=None, target_scope="Device", managed_device=self.laptop_a
            ),
        )

        # §25: three atomic lines, each naming exactly what it acts on
        rows = frappe.get_all(
            "MSP Service Request Line",
            filters={"parent": request},
            fields=[
                "action",
                "client_user",
                "requested_for_user",
                "managed_device",
                "source_service_assignment",
                "requested_service",
            ],
            order_by="idx asc",
        )

        self.assertEqual([row.action for row in rows], ["Add", "Resume", "Add"])
        self.assertEqual(rows[1].source_service_assignment, self.vpn_line)
        self.assertEqual(rows[2].managed_device, self.laptop_a)
        self.assertEqual(rows[2].requested_for_user, self.john, "a device line still says who for")

        # §26: nothing to prepare — the person and the machine are both on file
        self.approve_request(request)

        self.assertEqual(frappe.db.count(WORK_ORDER, {"service_request": request}), 3)
        self.assertEqual(
            frappe.db.count(WORK_ORDER, {"service_request": request, "work_type": "User Setup"}), 0
        )

        plan = self.technician_does(
            lambda: RequestExecutionService.get_execution_plan(request=request)
        )
        stages = {row["key"]: row["state"] for row in plan["stages"]["stages"]}

        self.assertEqual(stages["prepare"], "skipped")

        for order in frappe.get_all(
            WORK_ORDER, filters={"service_request": request}, pluck="name"
        ):
            self.carry_out(request, order)

        self.technician_does(lambda: RequestExecutionService.complete_request(request=request))

        # §27: the final state, read off the records rather than off a screen
        self.assertEqual(
            frappe.db.get_value("MSP Service Request", request, "status"), "Completed"
        )
        self.assertEqual(self.status_of(self.vpn_line), "Active")

        reading = self.technician_does(lambda: User360Service.get_user(self.john))
        personal = {row["service_item"] for row in reading["personal_services"]["current"]}
        machine = {
            row["service_item"]
            for slot in reading["devices"]
            for row in slot["services"]["current"]
        }

        self.assertEqual(personal, {self.m365, self.vpn, self.adobe})
        self.assertEqual(machine, {self.sophos, self.rmm})


# ---------------------------------------------------------------------------------------
# §28-31 — a person who does not exist yet, and a machine nobody has chosen
# ---------------------------------------------------------------------------------------
class TestJourneyOfSomebodyNew(AcceptanceCase):
    def new_person_line(self, service, **fields):
        return self.line(
            service,
            client_user=None,
            is_new_user=1,
            new_user_full_name="Marie Dupont",
            new_user_department=self.make_department("Human Resources"),
            **fields,
        )

    def test_one_person_one_machine_however_many_services_were_asked_for(self):
        request = self.raise_request(
            self.new_person_line(self.offering("N365")),
            self.new_person_line(self.offering("NVPN")),
            self.new_person_line(self.offering("NSOP", scope="Device"), is_new_device=1),
            self.new_person_line(self.offering("NRMM", scope="Device"), is_new_device=1),
        )

        # §29: every line about Marie shares one subject; the two machine lines share one machine
        keys = frappe.get_all(
            "MSP Service Request Line",
            filters={"parent": request},
            fields=["subject_key", "device_requirement_key"],
        )

        self.assertEqual(len({row.subject_key for row in keys}), 1)
        self.assertEqual(
            len({row.device_requirement_key for row in keys if row.device_requirement_key}), 1
        )

        self.approve_request(request)

        # §30: one account to open, one machine to settle, four acts
        self.assertEqual(
            frappe.db.count(WORK_ORDER, {"service_request": request, "work_type": "User Setup"}), 1
        )
        self.assertEqual(
            frappe.db.count(
                WORK_ORDER, {"service_request": request, "work_type": "Device Provisioning"}
            ),
            1,
        )
        self.assertEqual(
            frappe.db.count(
                WORK_ORDER, {"service_request": request, "work_type": "Service Action"}
            ),
            4,
        )

        setup = self.work(request, "User Setup")
        self.technician_does(
            lambda: RequestExecutionService.execute_user_setup(
                work_order=setup.name, username=f"m.{self.tag}"
            )
        )
        marie = frappe.db.get_value(WORK_ORDER, setup.name, "resulting_client_user")
        self.track("MSP Client User", marie)

        provisioning = self.work(request, "Device Provisioning")
        self.technician_does(
            lambda: RequestExecutionService.execute_device_provisioning(
                work_order=provisioning.name,
                mode="new",
                hostname=f"laptop-{self.tag}",
                serial_number=f"NEW-{self.tag}",
            )
        )
        device = frappe.db.get_value(WORK_ORDER, provisioning.name, "resulting_device")
        self.track("MSP Managed Device", device)

        for index in range(4):
            self.carry_out(request, self.work(request, "Service Action", index).name)

        self.technician_does(lambda: RequestExecutionService.complete_request(request=request))

        # §31: one person, one holding period, one machine, four services. Never four of each.
        self.assertEqual(frappe.db.count("MSP Client User", {"full_name": "Marie Dupont"}), 1)
        self.assertEqual(
            frappe.db.count(
                "MSP Device Holder",
                {"parenttype": "MSP Managed Device", "client_user": marie, "is_current": 1},
            ),
            1,
        )
        self.assertEqual(
            frappe.db.count("MSP Service Assignment", {"source_request": request}), 4
        )
        self.assertEqual(
            frappe.db.get_value("MSP Service Request", request, "status"), "Completed"
        )


# ---------------------------------------------------------------------------------------
# §32-35 — a machine's life, and whose story it belongs to
# ---------------------------------------------------------------------------------------
class TestJourneyOfAMachine(AcceptanceCase):
    def setUp(self):
        super().setUp()
        self.alice = self.make_person(self.customer, "Alice")
        self.bob = self.make_person(self.customer, "Bob")
        self.sophos = self.offering("MSOP", scope="Device")

    def test_taking_a_machine_back_leaves_its_services_on_the_machine(self):
        """§32: repossession. The laptop goes to the shelf; Sophos stays on the laptop."""
        device = self.laptop("MREP", holder=self.john, serial=f"MR-{self.tag}")
        sophos = self.running(self.sophos, scope="Device", managed_device=device)

        DeviceLifecycleService.repossess(device=device)
        frappe.db.commit()

        card = frappe.db.get_value(
            "MSP Managed Device", device, ["status", "assigned_client_user"], as_dict=True
        )

        self.assertEqual(card.status, "Stock")
        self.assertIsNone(card.assigned_client_user)
        self.assertEqual(self.status_of(sophos), "Active", "the service is the machine's")

        reading = self.technician_does(lambda: User360Service.get_user(self.john))
        past = self.technician_does(lambda: User360Service.get_user_history(self.john))

        self.assertEqual(reading["devices"], [])
        self.assertEqual([row["name"] for row in past["past_devices"]], [device])

    def test_giving_it_back_to_the_same_person_opens_a_second_period(self):
        """§33: two holding periods for one person and one machine is ordinary."""
        device = self.laptop("MAGA", holder=self.john, since=300, serial=f"MA-{self.tag}")

        DeviceLifecycleService.repossess(device=device, effective_date=self.days_ago(150))
        DeviceLifecycleService.assign(
            device=device, client_user=self.john, effective_date=self.days_ago(30)
        )
        frappe.db.commit()

        periods = frappe.get_all(
            "MSP Device Holder",
            filters={"parenttype": "MSP Managed Device", "parent": device},
            fields=["client_user", "from_date", "to_date", "is_current"],
            order_by="from_date asc",
        )

        self.assertEqual(len(periods), 2)
        self.assertEqual({row.client_user for row in periods}, {self.john})
        self.assertEqual([row.is_current for row in periods], [0, 1])

        reading = self.technician_does(lambda: User360Service.get_user(self.john))

        self.assertEqual(
            str(reading["devices"][0]["holder_since"]), str(getdate(self.days_ago(30)))
        )

    def test_handing_it_on_moves_the_machine_and_not_the_service(self):
        """§34: transfer. The assignment never changes hands, the machine does."""
        device = self.laptop("MTRA", holder=self.alice, serial=f"MT-{self.tag}")
        sophos = self.running(self.sophos, scope="Device", managed_device=device)

        DeviceLifecycleService.transfer(device=device, client_user=self.bob)
        frappe.db.commit()

        assignment = frappe.db.get_value(
            "MSP Service Assignment", sophos, ["managed_device", "client_user"], as_dict=True
        )

        self.assertEqual(assignment.managed_device, device)
        self.assertIsNone(assignment.client_user)

        hers = self.technician_does(lambda: User360Service.get_user(self.alice))
        his = self.technician_does(lambda: User360Service.get_user(self.bob))

        self.assertEqual(hers["devices"], [])
        self.assertEqual(hers["personal_services"]["current"], [])
        self.assertEqual(
            [row["name"] for slot in his["devices"] for row in slot["services"]["current"]],
            [sophos],
        )


# ---------------------------------------------------------------------------------------
# §44-46 — the reference data, read from every side
# ---------------------------------------------------------------------------------------
class TestTheSharedCatalogue(AcceptanceCase):
    def test_one_department_serves_two_companies(self):
        """§44: Accounting is created once and picked by everybody."""
        elsewhere = self.make_customer(f"{self.tag}B")
        theirs = self.make_person(elsewhere, "Stranger")

        shared = self.make_department("Accounting")

        doc = frappe.get_doc("MSP Client User", theirs)
        doc.department = shared
        doc.save(ignore_permissions=True)

        self.assertEqual(
            frappe.db.get_value("MSP Client User", self.john, "department"), shared
        )
        self.assertEqual(frappe.db.get_value("MSP Client User", theirs, "department"), shared)
        self.assertEqual(
            frappe.db.count("MSP Department", {"department_name": shared}),
            1,
            "one entry, not one per company",
        )

    def test_retiring_a_department_changes_nothing_already_written(self):
        """§45: it stops being offered; everything that carries it keeps it."""
        admin = self.make_account("internal", "MSP System Admin", suffix=f"ad{self.tag[:3]}")
        retired = self.make_department(f"Retired {self.tag}")

        doc = frappe.get_doc("MSP Client User", self.john)
        doc.department = retired
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        self.as_user(admin, lambda: DepartmentService.disable_department(name=retired))

        self.assertNotIn(
            retired, [row.name for row in DepartmentService.list_departments()]
        )
        self.assertEqual(
            frappe.db.get_value("MSP Client User", self.john, "department"),
            retired,
            "history keeps what it was written with",
        )

        reading = self.technician_does(lambda: User360Service.get_user(self.john))

        self.assertEqual(reading["user"]["department"], retired)

    def test_hiding_an_offer_never_takes_the_act_from_the_engine(self):
        """§46: Settings governs what a customer may ask for, not what the engine can do."""
        service = self.offering("OFFR")
        assignment = self.running(service, client_user=self.john)

        offer = frappe.db.get_value(
            "MSP Request Action", {"action_type": "Suspend", "enabled": 1}, "name"
        )
        frappe.db.set_value("MSP Request Action", offer, "enabled", 0)
        frappe.db.commit()
        self.addCleanup(lambda: frappe.db.set_value("MSP Request Action", offer, "enabled", 1))

        offered = self.customer_does(
            lambda: PortalService.list_request_actions()
        )

        self.assertNotIn("Suspend", [row["action_type"] for row in offered])

        ServiceLifecycleService.suspend(assignment=assignment)

        self.assertEqual(self.status_of(assignment), "Suspended")


# ---------------------------------------------------------------------------------------
# §47-49 — two people acting at once, and work that will not go through
# ---------------------------------------------------------------------------------------
class TestWhenTwoThingsHappenAtOnce(AcceptanceCase):
    def test_asking_for_something_somebody_else_has_just_granted_is_refused(self):
        """§47: the builder was opened before the service existed. Submitting is stale."""
        service = self.offering("STAL")
        lines = [self.line(service)]

        self.running(service, client_user=self.john)

        # the doctype's own rule speaks through frappe; the service layer through ours
        with self.assertRaises((NexgenError, frappe.ValidationError)) as caught:
            self.customer_does(
                lambda: PortalService.create_request(
                    customer=self.customer, request_type="Add", lines=lines
                )
            )

        self.assertIn("already", str(caught.exception).lower())
        self.assertEqual(
            frappe.db.count(
                "MSP Service Assignment",
                {"customer": self.customer, "service_item": service},
            ),
            1,
            "no second assignment was opened",
        )

    def test_a_blocker_holds_the_file_open_and_lets_everything_else_through(self):
        """§49: Sophos is blocked at the vendor; M365 still goes out."""
        m365 = self.offering("B365")
        sophos = self.offering("BSOP")
        request = self.approve_request(self.raise_request(self.line(m365), self.line(sophos)))

        first, second = (self.work(request, "Service Action", index) for index in range(2))

        self.technician_does(
            lambda: RequestExecutionService.block_work_item(
                work_order=second.name, reason="No licence from the vendor yet"
            )
        )
        self.carry_out(request, first.name)

        self.assertEqual(
            frappe.db.get_value("MSP Service Request", request, "status"), "In Progress"
        )

        with self.assertRaises(NexgenError) as caught:
            self.technician_does(
                lambda: RequestExecutionService.complete_request(request=request)
            )

        self.assertIn("vendor", str(caught.exception))

        self.technician_does(
            lambda: RequestExecutionService.cancel_work_item(
                work_order=second.name, reason="The customer withdrew it"
            )
        )
        self.technician_does(lambda: RequestExecutionService.complete_request(request=request))

        self.assertEqual(
            frappe.db.get_value("MSP Service Request", request, "status"), "Completed"
        )


# ---------------------------------------------------------------------------------------
# §35, §50 — an approved run is history, and history does not move
# ---------------------------------------------------------------------------------------
class TestAnApprovedRunNeverMoves(AcceptanceCase):
    def month(self):
        back = 1 + zlib.crc32(self._testMethodName.encode()) % 5
        first = frappe.utils.add_months(getdate(self.today), -back).replace(day=1)

        return str(first), str(getdate(add_days(frappe.utils.add_months(first, 1), -1)))

    def test_nothing_that_happens_afterwards_rewrites_it(self):
        """§50: rename the person, move their department, hand the machine on. August holds."""
        bob = self.make_person(self.customer, "Bob")
        personal = self.offering("IM365")
        on_device = self.offering("ISOP", scope="Device")
        device = self.laptop("IMMU", holder=self.john, serial=f"IM-{self.tag}")

        self.running(personal, client_user=self.john)
        self.running(on_device, scope="Device", managed_device=device)

        start, end = self.month()
        drawn = BillingService.generate(
            contract=self.contract, period_start=start, period_end=end
        )
        run = self.track("MSP Billing Run", drawn["name"])
        BillingService.approve(name=run)

        before = {
            row["service_assignment"]: dict(row) for row in BillingService.get_run(run)["lines"]
        }
        total = frappe.db.get_value("MSP Billing Run", run, "total_amount")

        # the world moves on
        person = frappe.get_doc("MSP Client User", self.john)
        person.full_name = f"ZZTEST Renamed {self.tag}"
        person.department = self.make_department("Finance")
        person.save(ignore_permissions=True)

        item = frappe.get_doc("Item", personal)
        item.item_name = f"ZZTEST Relabelled {self.tag}"
        item.save(ignore_permissions=True)

        DeviceLifecycleService.transfer(device=device, client_user=bob)
        frappe.db.commit()

        after = {
            row["service_assignment"]: dict(row) for row in BillingService.get_run(run)["lines"]
        }

        for assignment, was in before.items():
            now = after[assignment]

            for field in (
                "service_name",
                "user_name",
                "department",
                "hostname",
                "serial_number",
                "unit_rate",
                "billable_months",
                "amount",
            ):
                self.assertEqual(was[field], now[field], f"{field} moved on {assignment}")

        self.assertEqual(
            frappe.db.get_value("MSP Billing Run", run, "total_amount"), total
        )
        self.assertNotIn(
            "Bob", str([row.get("user_name") for row in after.values()])
        )
