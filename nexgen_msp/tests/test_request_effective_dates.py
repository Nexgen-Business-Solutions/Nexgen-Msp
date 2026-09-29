"""The work of a request is dated from the day the request was created onward, the future included."""

import frappe
from frappe.utils import add_days, formatdate, getdate, now_datetime, today

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import ValidationError as Refused

from .test_request_combinations import ASSIGNMENT, WORK_ORDER, RequestMatrixCase
from .test_requested_execution import RequestedWorkCase
from .writer_case import REQUEST, REQUESTED_DEVICE

HOLDER = "MSP Device Holder"
SERVICE_FUTURE = "A service cannot change on a future date."
END_FUTURE = "A service cannot be ended in the future."
DEVICE_FUTURE = "A device cannot change hands on a future date."
ADMIN_ONLY = "Only an administrator can end a service on a past date."


def day(offset):
    return getdate(add_days(today(), offset))


def too_early(floor):
    return f"The effective date cannot be before the request was created ({formatdate(floor)})."


class DatedRequestCase(RequestMatrixCase):
    """A request raised, decided and started, whose work is then carried out on chosen days."""

    def started(self, *lines, requested_date=None, created=0):
        out = self.as_user(
            self.manager,
            lambda: PortalService.create_request(
                customer=self.customer, lines=list(lines), requested_date=requested_date
            ),
        )
        name = self.track("MSP Request", out["name"])

        for row in frappe.get_doc("MSP Request", name).lines:
            self.decide(name, row.idx, "Approved")

        self.start_work(name)

        if created:
            frappe.db.set_value(
                "MSP Request", name, "creation", add_days(now_datetime(), created), update_modified=False
            )
            frappe.db.commit()

        return name

    def orders(self, name):
        return frappe.get_all(
            WORK_ORDER,
            filters={"request": name},
            fields=["name", "operation_code", "status", "effective_date", "resulting_assignment"],
            order_by="request_line_idx asc, creation asc",
        )

    def order(self, name, index=0):
        return self.orders(name)[index].name

    def do_service(self, order, on, actor=None, **inputs):
        who = frappe.db.get_value(WORK_ORDER, order, "client_user")
        username = {"username": f"zz.{who.lower().replace('-', '')}"} if who else {}

        return self.as_user(
            actor or self.tech,
            lambda: RequestExecutionService.execute_service_action(
                work_order=order, effective_date=str(on), **username, **inputs
            ),
        )

    def do_device(self, order, on, actor=None):
        return self.as_user(
            actor or self.tech,
            lambda: RequestExecutionService.execute_device_operation(work_order=order, effective_date=str(on)),
        )

    def refused(self, fn, message):
        with self.assertRaises(Refused) as caught:
            fn()

        self.assertEqual(caught.exception.message, message)

    def assignment(self, name):
        return frappe.get_doc(ASSIGNMENT, name)

    def spells(self, device):
        return frappe.get_all(
            HOLDER,
            filters={"parent": device, "parenttype": "MSP Managed Device"},
            fields=["client_user", "from_date", "to_date", "is_current"],
            order_by="idx asc",
        )

    def added_to(self, person, service):
        return frappe.get_all(
            ASSIGNMENT, filters={"client_user": person, "service_item": service}, pluck="name"
        )

    def withdraw(self, name):
        self.as_user(self.admin, lambda: RequestService.run_action(name=name, action="cancel", reason="Test over."))


class TestEveryServiceActOfARequestTakesItsOwnDay(DatedRequestCase):
    def test_a_service_added_on_a_future_day_opens_on_that_day(self):
        name = self.started(self.service_line("service.add"), requested_date=str(day(30)))

        self.do_service(self.order(name), day(30))

        [opened] = self.added_to(self.alice, self.personal)
        record = self.assignment(opened)
        self.assertEqual(getdate(record.effective_start_date), day(30))
        self.assertEqual(record.operational_status, "Active")
        self.assertEqual(getdate(frappe.db.get_value(WORK_ORDER, self.order(name), "effective_date")), day(30))
        self.assertEqual(frappe.db.get_value(WORK_ORDER, self.order(name), "status"), "Completed")

    def test_a_service_added_on_the_creation_day_of_an_older_request_opens_on_that_day(self):
        name = self.started(self.service_line("service.add"), created=-5)

        self.do_service(self.order(name), day(-5))

        [opened] = self.added_to(self.alice, self.personal)
        self.assertEqual(getdate(self.assignment(opened).effective_start_date), day(-5))

    def test_a_service_added_the_day_before_the_request_was_created_is_refused_and_nothing_is_written(self):
        name = self.started(self.service_line("service.add"), created=-5)

        self.refused(lambda: self.do_service(self.order(name), day(-6)), too_early(day(-5)))

        self.assertEqual(self.added_to(self.alice, self.personal), [])
        self.assertNotEqual(frappe.db.get_value(WORK_ORDER, self.order(name), "status"), "Completed")

    def test_a_suspension_on_a_future_day_pauses_from_that_day(self):
        running = self.running(self.personal)
        name = self.started(self.service_line("service.suspend", assignment=running))

        self.do_service(self.order(name), day(12))

        record = self.assignment(running)
        self.assertEqual(record.operational_status, "Suspended")
        self.assertEqual([getdate(row.suspended_on) for row in record.suspension_log], [day(12)])
        self.assertEqual([row.source_request for row in record.suspension_log], [name])

    def test_a_resume_on_a_future_day_closes_the_pause_on_that_day(self):
        running = self.running(self.personal)
        ServiceLifecycleService.suspend(assignment=running, effective_date=str(day(-10)))
        name = self.started(self.service_line("service.resume", assignment=running))

        self.do_service(self.order(name), day(9))

        record = self.assignment(running)
        self.assertEqual(record.operational_status, "Active")
        self.assertEqual(
            [(getdate(row.suspended_on), getdate(row.resumed_on)) for row in record.suspension_log],
            [(day(-10), day(9))],
        )

    def test_an_end_on_a_future_day_is_recorded_on_that_day_by_a_technician(self):
        running = self.running(self.personal)
        name = self.started(self.service_line("service.end", assignment=running))

        self.do_service(self.order(name), day(7))

        record = self.assignment(running)
        self.assertEqual(record.operational_status, "Ended")
        self.assertEqual(getdate(record.effective_end_date), day(7))

    def test_a_device_service_added_on_a_future_day_opens_on_that_day(self):
        name = self.started(
            {
                "operation_code": "service.add",
                "target_scope": "Device",
                "requested_service": self.machine,
                "managed_device": self.laptop,
            }
        )

        self.do_service(self.order(name), day(20))

        [opened] = frappe.get_all(
            ASSIGNMENT, filters={"managed_device": self.laptop, "service_item": self.machine}, pluck="name"
        )
        self.assertEqual(getdate(self.assignment(opened).effective_start_date), day(20))

    def test_device_service_acts_on_a_future_day_keep_that_day(self):
        for code, field, offset in (
            ("service.suspend", "suspended_on", 4),
            ("service.end", "effective_end_date", 6),
        ):
            with self.subTest(code):
                running = self.running(self.machine, scope="Device")
                name = self.started(
                    {
                        "operation_code": code,
                        "target_scope": "Device",
                        "requested_service": self.machine,
                        "managed_device": self.laptop,
                        "source_service_assignment": running,
                    }
                )

                self.do_service(self.order(name), day(offset))

                record = self.assignment(running)
                recorded = (
                    record.suspension_log[-1].suspended_on if field == "suspended_on" else record.effective_end_date
                )
                self.assertEqual(getdate(recorded), day(offset))
                self.withdraw(name)
                frappe.delete_doc(ASSIGNMENT, running, force=True, ignore_permissions=True)
                frappe.db.commit()

    def test_every_service_act_the_day_before_the_request_was_created_is_refused_and_nothing_moves(self):
        running = self.running(self.personal, started=-60)
        suspended = self.running(self.personal, person=self.bruno, started=-60)
        ServiceLifecycleService.suspend(assignment=suspended, effective_date=str(day(-40)))

        for code, assignment, status in (
            ("service.suspend", running, "Active"),
            ("service.end", running, "Active"),
            ("service.resume", suspended, "Suspended"),
        ):
            with self.subTest(code):
                person = self.alice if assignment == running else self.bruno
                name = self.started(
                    self.service_line(code, assignment=assignment, client_user=person), created=-3
                )
                before = self.assignment(assignment)

                self.refused(lambda: self.do_service(self.order(name), day(-4), actor=self.admin), too_early(day(-3)))

                after = self.assignment(assignment)
                self.assertEqual(after.operational_status, status)
                self.assertEqual(after.effective_end_date, before.effective_end_date)
                self.assertEqual(len(after.suspension_log), len(before.suspension_log))
                self.assertIsNone(after.suspension_log[-1].resumed_on if after.suspension_log else None)
                self.withdraw(name)


class TestTheRuleForEndingOnAPastDayStillHoldsInsideTheRequest(DatedRequestCase):
    def test_a_technician_cannot_end_between_the_creation_day_and_today_an_administrator_can(self):
        running = self.running(self.personal, started=-60)
        name = self.started(self.service_line("service.end", assignment=running), created=-5)

        self.refused(lambda: self.do_service(self.order(name), day(-2)), ADMIN_ONLY)
        self.assertEqual(self.assignment(running).operational_status, "Active")

        self.do_service(self.order(name), day(-2), actor=self.admin)

        self.assertEqual(getdate(self.assignment(running).effective_end_date), day(-2))

    def test_a_technician_ends_on_the_creation_day_when_that_day_is_today(self):
        running = self.running(self.personal)
        name = self.started(self.service_line("service.end", assignment=running))

        self.do_service(self.order(name), day(0))

        self.assertEqual(getdate(self.assignment(running).effective_end_date), day(0))


class TestEveryMachineActOfARequestTakesItsOwnDay(DatedRequestCase):
    def assign_line(self, device, holder):
        return {
            "operation_code": "device.assign",
            "target_scope": "Device",
            "managed_device": device,
            "requested_holder": holder,
        }

    def test_a_machine_from_stock_is_given_on_a_future_day(self):
        name = self.started(self.assign_line(self.spare, self.bruno))

        self.do_device(self.order(name), day(15))

        self.assertEqual(
            [(row.client_user, getdate(row.from_date), row.to_date) for row in self.spells(self.spare)],
            [(self.bruno, day(15), None)],
        )
        self.assertEqual(self.holder_of(self.spare), self.bruno)
        self.assertEqual(getdate(frappe.db.get_value("MSP Managed Device", self.spare, "assigned_date")), day(15))

    def test_a_holder_change_on_a_future_day_closes_the_old_spell_that_day(self):
        name = self.started(self.assign_line(self.laptop, self.bruno))

        self.do_device(self.order(name), day(1))

        self.assertEqual(
            [(row.client_user, getdate(row.from_date), row.to_date and getdate(row.to_date)) for row in self.spells(self.laptop)],
            [(self.alice, day(0), day(1)), (self.bruno, day(1), None)],
        )
        self.assertEqual(self.holder_of(self.laptop), self.bruno)

    def test_a_return_to_stock_on_a_future_day_closes_the_spell_that_day(self):
        name = self.started({"operation_code": "device.repossess", "target_scope": "Device", "managed_device": self.laptop})

        self.do_device(self.order(name), day(3))

        self.assertEqual(
            [(row.client_user, row.to_date and getdate(row.to_date)) for row in self.spells(self.laptop)],
            [(self.alice, day(3))],
        )
        self.assertEqual(frappe.db.get_value("MSP Managed Device", self.laptop, "status"), "Stock")

    def test_every_machine_act_the_day_before_the_request_was_created_is_refused_and_nothing_moves(self):
        for label, line, device in (
            ("assign", self.assign_line(self.spare, self.bruno), self.spare),
            ("change holder", self.assign_line(self.laptop, self.bruno), self.laptop),
            ("return to stock", {"operation_code": "device.repossess", "target_scope": "Device", "managed_device": self.laptop}, self.laptop),
        ):
            with self.subTest(label):
                name = self.started(line)
                before = self.spells(device)

                self.refused(lambda: self.do_device(self.order(name), day(-1)), too_early(day(0)))

                self.assertEqual(self.spells(device), before)
                self.assertNotEqual(frappe.db.get_value(WORK_ORDER, self.order(name), "status"), "Completed")
                self.withdraw(name)


class TestABatchCarriesEachRowOnItsOwnDay(DatedRequestCase):
    def test_rows_dated_correctly_are_carried_out_and_the_row_dated_too_early_is_refused_on_its_own(self):
        other = self.make_service(f"RQ{self.tag[:3]}", scope="User")
        self.cover_service(self.customer, other)
        name = self.started(
            self.service_line("service.add"),
            self.service_line("service.add", client_user=self.bruno),
            self.service_line("service.add", requested_service=other),
            created=-2,
        )
        first, second, third = (row.name for row in self.orders(name))

        out = self.as_user(
            self.tech,
            lambda: RequestExecutionService.execute_work_orders(
                request=name,
                executions=[
                    {"work_order": first, "inputs": {"effective_date": str(day(3)), "username": "zz.a1"}},
                    {"work_order": second, "inputs": {"effective_date": str(day(10)), "username": "zz.b1"}},
                    {"work_order": third, "inputs": {"effective_date": str(day(-3)), "username": "zz.a1"}},
                ],
            ),
        )

        self.assertEqual((out["completed"], out["failed"]), (2, 1))
        self.assertEqual(
            [(row["work_order"], row["ok"], row["message"]) for row in out["results"]],
            [(first, True, None), (second, True, None), (third, False, too_early(day(-2)))],
        )
        self.assertEqual(
            getdate(self.assignment(self.added_to(self.alice, self.personal)[0]).effective_start_date), day(3)
        )
        self.assertEqual(
            getdate(self.assignment(self.added_to(self.bruno, self.personal)[0]).effective_start_date), day(10)
        )
        self.assertEqual(self.added_to(self.alice, other), [])

    def test_a_group_carried_out_on_one_future_day_opens_every_service_on_that_day(self):
        frappe.db.set_value("MSP Client User", self.alice, "username", f"zz.al{self.tag}")
        frappe.db.set_value("MSP Client User", self.bruno, "username", f"zz.br{self.tag}")
        name = self.started(
            self.service_line("service.add"),
            self.service_line("service.add", client_user=self.bruno),
            requested_date=str(day(14)),
        )

        out = self.as_user(
            self.tech,
            lambda: RequestExecutionService.execute_service_actions(
                work_orders=[row.name for row in self.orders(name)], effective_date=str(day(14))
            ),
        )

        self.assertEqual((out["completed"], out["failed"]), (2, 0))
        self.assertEqual(
            {
                getdate(self.assignment(self.added_to(person, self.personal)[0]).effective_start_date)
                for person in (self.alice, self.bruno)
            },
            {day(14)},
        )

    def test_a_group_carried_out_before_the_creation_day_is_refused_row_by_row(self):
        frappe.db.set_value("MSP Client User", self.alice, "username", f"zz.al{self.tag}")
        frappe.db.set_value("MSP Client User", self.bruno, "username", f"zz.br{self.tag}")
        name = self.started(
            self.service_line("service.add"),
            self.service_line("service.add", client_user=self.bruno),
        )

        out = self.as_user(
            self.tech,
            lambda: RequestExecutionService.execute_service_actions(
                work_orders=[row.name for row in self.orders(name)], effective_date=str(day(-1))
            ),
        )

        self.assertEqual((out["completed"], out["failed"]), (0, 2))
        self.assertEqual({row["message"] for row in out["results"]}, {too_early(day(0))})
        self.assertEqual(self.added_to(self.alice, self.personal) + self.added_to(self.bruno, self.personal), [])


class TestOutsideARequestNothingChanged(DatedRequestCase):
    def test_a_service_act_on_a_future_day_is_refused_as_before(self):
        running = self.running(self.personal)

        self.refused(
            lambda: ServiceLifecycleService.activate(
                customer=self.customer, service_item=self.personal, target_scope="User",
                client_user=self.bruno, effective_date=str(day(1)),
            ),
            SERVICE_FUTURE,
        )
        self.refused(lambda: ServiceLifecycleService.suspend(assignment=running, effective_date=str(day(1))), SERVICE_FUTURE)
        self.refused(lambda: ServiceLifecycleService.end(assignment=running, effective_date=str(day(1))), END_FUTURE)
        self.refused(
            lambda: ServiceLifecycleService.change(assignment=running, quantity=2, effective_date=str(day(1))),
            SERVICE_FUTURE,
        )
        ServiceLifecycleService.suspend(assignment=running, effective_date=str(day(-2)))
        self.refused(lambda: ServiceLifecycleService.resume(assignment=running, effective_date=str(day(1))), SERVICE_FUTURE)

        self.assertEqual(self.added_to(self.bruno, self.personal), [])
        record = self.assignment(running)
        self.assertEqual(record.operational_status, "Suspended")
        self.assertIsNone(record.effective_end_date)

    def test_a_direct_act_that_only_names_a_request_is_still_refused_in_the_future(self):
        running = self.running(self.personal)
        name = self.started(self.service_line("service.end", assignment=running))

        self.refused(
            lambda: self.as_user(
                self.admin,
                lambda: UserService.change_service(
                    assignment=running, action="End", effective_date=str(day(2)), source_request=name
                ),
            ),
            END_FUTURE,
        )
        self.refused(
            lambda: ServiceLifecycleService.suspend(assignment=running, effective_date=str(day(2)), source_request=name),
            SERVICE_FUTURE,
        )
        self.assertEqual(self.assignment(running).operational_status, "Active")

    def test_a_machine_act_on_a_future_day_is_refused_as_before(self):
        self.refused(
            lambda: DeviceLifecycleService.assign(device=self.spare, client_user=self.bruno, effective_date=str(day(1))),
            DEVICE_FUTURE,
        )
        self.refused(
            lambda: DeviceLifecycleService.transfer(device=self.laptop, client_user=self.bruno, effective_date=str(day(1))),
            DEVICE_FUTURE,
        )
        self.refused(lambda: DeviceLifecycleService.repossess(device=self.laptop, effective_date=str(day(1))), DEVICE_FUTURE)

        self.assertEqual(self.holder_of(self.laptop), self.alice)
        self.assertIsNone(self.holder_of(self.spare))

    def test_a_pause_written_in_the_future_outside_a_request_is_refused_by_the_record_itself(self):
        running = self.running(self.personal)
        doc = self.assignment(running)
        doc.append("suspension_log", {"suspended_on": day(5)})
        doc.operational_status = "Suspended"
        doc.flags.via_service_lifecycle = True

        with self.assertRaises(frappe.ValidationError) as caught:
            doc.save(ignore_permissions=True)

        self.assertIn("a suspension cannot start in the future", str(caught.exception))

    def test_a_pause_planned_by_a_request_does_not_block_what_comes_after_it(self):
        running = self.running(self.personal)
        name = self.started(self.service_line("service.suspend", assignment=running))
        self.do_service(self.order(name), day(5))
        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="complete"))
        ending = self.started(self.service_line("service.end", assignment=running))

        self.do_service(self.order(ending), day(8))

        record = self.assignment(running)
        self.assertEqual((record.operational_status, getdate(record.effective_end_date)), ("Ended", day(8)))
        self.assertEqual([getdate(row.suspended_on) for row in record.suspension_log], [day(5)])


class TestWhatAFutureDayMeansForWhatPeopleRead(DatedRequestCase):
    def contract(self):
        return frappe.db.get_value("MSP Contract", {"customer": self.customer}, "name")

    def billed(self, assignment, start, end):
        lines, _terms = BillingService.build_lines(self.contract(), str(start), str(end))

        return [row for row in lines if row["service_assignment"] == assignment]

    def test_a_service_added_for_later_is_active_on_its_record_and_billed_only_from_its_first_day(self):
        name = self.started(self.service_line("service.add"), requested_date=str(day(20)))
        self.do_service(self.order(name), day(20))
        [opened] = self.added_to(self.alice, self.personal)

        self.assertEqual(self.assignment(opened).operational_status, "Active")
        self.assertEqual(self.billed(opened, day(0), day(19)), [], "a period entirely before its start bills nothing")

        [billed] = self.billed(opened, day(0), day(29))
        self.assertEqual(getdate(billed["covered_from"]), day(20))
        self.assertEqual(billed["billable_days"], 10)

    def test_a_service_ended_for_later_is_billed_until_that_day_and_not_after(self):
        running = self.running(self.personal, started=-40)
        name = self.started(self.service_line("service.end", assignment=running))
        self.do_service(self.order(name), day(6))

        self.assertEqual(self.assignment(running).operational_status, "Ended")

        [billed] = self.billed(running, day(0), day(30))
        self.assertEqual(getdate(billed["covered_to"]), day(6))
        self.assertEqual(billed["billable_days"], 7)
        self.assertEqual(self.billed(running, day(7), day(30)), [])

    def test_a_service_paused_for_later_is_billed_until_the_day_before_the_pause(self):
        running = self.running(self.personal, started=-40)
        name = self.started(self.service_line("service.suspend", assignment=running))
        self.do_service(self.order(name), day(4))

        [billed] = self.billed(running, day(0), day(20))
        self.assertEqual(getdate(billed["covered_to"]), day(3))
        self.assertEqual(billed["billable_days"], 4)

    def test_a_machine_changing_hands_later_is_read_by_date_in_its_history(self):
        name = self.started(
            {"operation_code": "device.assign", "target_scope": "Device", "managed_device": self.laptop, "requested_holder": self.bruno}
        )
        self.do_device(self.order(name), day(2))

        alice = frappe.db.get_value("MSP Client User", self.alice, "full_name")
        bruno = frappe.db.get_value("MSP Client User", self.bruno, "full_name")

        self.assertEqual(self.holder_of(self.laptop), self.bruno, "the record names the holder the request gave it to")
        self.assertEqual(BillingService._holder_context(self.laptop, str(day(0)), str(day(1))), f"{alice}: {day(0)} → {day(1)}")
        self.assertEqual(BillingService._holder_context(self.laptop, str(day(3)), str(day(9))), f"{bruno}: {day(3)} → {day(9)}")


class TestTheHandOverAtResolutionTakesTheRequestsRule(RequestedWorkCase):
    def asked_for_franck(self):
        franck = self.existing(self.franck)
        groups = [
            self.group(
                "grp:sophos",
                "service.add",
                [self.target(franck, "Device", device_requirement_key="new-device:laptop")],
                service=self.sophos,
            )
        ]
        name = self.approved(
            [franck],
            groups,
            requested_devices=[
                self.new_laptop(intended_holder_subject_key=None, intended_holder_client_user=self.franck)
            ],
        )

        return name, self.requested(name, REQUESTED_DEVICE)[0]

    def test_a_machine_chosen_for_its_person_is_handed_over_on_a_future_day(self):
        _name, rdev = self.asked_for_franck()
        shelf = self.make_device(self.customer, hostname=f"HF{self.tag[:4]}", serial=f"ZZTEST-HF-{self.tag}")

        self.as_tech(lambda: RequestedDeviceService.resolve_existing(rdev, shelf, effective_date=str(day(10))))

        spells = frappe.get_all(HOLDER, filters={"parent": shelf}, fields=["client_user", "from_date"])
        self.assertEqual([(row.client_user, getdate(row.from_date)) for row in spells], [(self.franck, day(10))])

    def test_a_hand_over_the_day_before_the_request_was_created_is_refused_and_nothing_is_resolved(self):
        name, rdev = self.asked_for_franck()
        shelf = self.make_device(self.customer, hostname=f"HB{self.tag[:4]}", serial=f"ZZTEST-HB-{self.tag}")

        with self.assertRaises(Refused) as caught:
            self.as_tech(lambda: RequestedDeviceService.resolve_existing(rdev, shelf, effective_date=str(day(-1))))

        self.assertEqual(caught.exception.message, too_early(getdate(frappe.db.get_value(REQUEST, name, "creation"))))
        self.assertEqual(frappe.db.get_value(REQUESTED_DEVICE, rdev, ["status", "resolved_managed_device"]), ("Open", None))
        self.assertEqual(frappe.db.count(HOLDER, {"parent": shelf}), 0)

    def test_a_hand_over_without_a_day_is_dated_the_day_it_is_done(self):
        _name, rdev = self.asked_for_franck()
        shelf = self.make_device(self.customer, hostname=f"HT{self.tag[:4]}", serial=f"ZZTEST-HT-{self.tag}")

        self.as_tech(lambda: RequestedDeviceService.resolve_existing(rdev, shelf))

        self.assertEqual(getdate(frappe.db.get_value(HOLDER, {"parent": shelf}, "from_date")), day(0))


class TestTheRequestedDateStartsOnTheCreationDay(RequestedWorkCase):
    def payload(self, requested_date, person=None):
        subject = self.existing(person or self.helen)
        groups = [self.group("grp:m365", "service.add", [self.target(subject)], service=self.m365)]

        return {"subjects": [subject], "action_groups": groups, "requested_date": requested_date}

    def mine(self):
        return frappe.db.count(REQUEST, {"customer": self.customer})

    def test_a_request_asked_for_yesterday_is_refused_and_nothing_is_written(self):
        with self.assertRaises(Refused) as caught:
            self.send(**self.payload(str(day(-1))))

        self.assertEqual(
            caught.exception.message,
            f"The requested date cannot be before the request was created ({formatdate(day(0))}).",
        )
        self.assertEqual(self.mine(), 0)

    def test_a_request_asked_for_today_or_later_is_sent_with_that_date(self):
        for offset, person in ((0, self.helen), (45, self.franck)):
            with self.subTest(offset):
                out = self.send(**self.payload(str(day(offset)), person))

                self.assertEqual(getdate(frappe.db.get_value(REQUEST, out["name"], "requested_date")), day(offset))

    def test_a_draft_saved_yesterday_and_sent_today_is_measured_against_the_day_it_was_created(self):
        draft = self.save(**self.payload(str(day(0))))["name"]
        frappe.db.set_value(REQUEST, draft, "creation", add_days(now_datetime(), -1), update_modified=False)
        frappe.db.commit()

        with self.assertRaises(Refused) as caught:
            self.send(name=draft, **self.payload(str(day(-2))))

        self.assertIn(f"({formatdate(day(-1))})", caught.exception.message)
        self.assertEqual(frappe.db.get_value(REQUEST, draft, "status"), "Draft")

        self.send(name=draft, **self.payload(str(day(-1))))

        self.assertEqual(getdate(frappe.db.get_value(REQUEST, draft, "requested_date")), day(-1))
        self.assertNotEqual(frappe.db.get_value(REQUEST, draft, "status"), "Draft")

    def test_a_modification_keeps_the_creation_day_of_the_request_as_its_floor(self):
        name = self.send(**self.payload(str(day(0))))["name"]
        frappe.db.set_value(REQUEST, name, "creation", add_days(now_datetime(), -3), update_modified=False)
        frappe.db.commit()

        with self.assertRaises(Refused):
            self.as_manager(lambda: PortalService.update_request(name=name, **self.payload(str(day(-4)))))

        self.assertEqual(getdate(frappe.db.get_value(REQUEST, name, "requested_date")), day(0))

        self.as_manager(lambda: PortalService.update_request(name=name, **self.payload(str(day(-3)))))

        self.assertEqual(getdate(frappe.db.get_value(REQUEST, name, "requested_date")), day(-3))

    def test_the_record_refuses_a_requested_date_before_its_creation_day_whatever_door_writes_it(self):
        name = self.send(**self.payload(str(day(0))))["name"]
        doc = frappe.get_doc(REQUEST, name)
        doc.requested_date = str(day(-1))

        with self.assertRaises(frappe.ValidationError) as caught:
            doc.save(ignore_permissions=True)

        self.assertIn("The requested date cannot be before the request was created", str(caught.exception))

    def test_an_older_request_whose_date_was_before_its_creation_day_can_still_be_saved(self):
        name = self.send(**self.payload(str(day(0))))["name"]
        frappe.db.set_value(REQUEST, name, "requested_date", str(day(-9)), update_modified=False)
        frappe.db.commit()
        doc = frappe.get_doc(REQUEST, name)
        doc.priority = "High"

        doc.save(ignore_permissions=True)

        self.assertEqual(frappe.db.get_value(REQUEST, name, "priority"), "High")
