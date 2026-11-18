"""When a reminder is owed, to whom, how often, and when it is owed nothing."""

import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import frappe

from nexgen_msp.api.internal.services import notification_registry as registry
from nexgen_msp.api.internal.services.notification_dispatch_service import (
    NotificationDispatchService,
)
from nexgen_msp.api.internal.services.notification_reminder_service import (
    REASONS,
    NotificationReminderService,
)
from nexgen_msp.api.internal.services.notification_settings_service import (
    NotificationSettingsService,
)
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import notifications, reminders
from nexgen_msp.utils.errors import ValidationError

from .base import PREFIX
from .test_notification_settings import (
    AUDIT,
    DISPATCH,
    REFERENCE,
    RULE,
    NotificationCase,
)
from .writer_case import WriterCase

APPROVAL = "request_approval_pending"
WAITING = "request_waiting_internal"

UTC = ZoneInfo("UTC")
MONTREAL = ZoneInfo("America/Montreal")
LONG_AGO = "2000-01-01 00:00:00"


def local(*moment, zone=MONTREAL):
    return datetime.datetime(*moment, tzinfo=zone)


def as_site_clock(moment):
    """How Frappe stores an instant: naive, on the site's own clock."""
    return moment.astimezone(ZoneInfo(frappe.utils.get_system_timezone())).replace(tzinfo=None)


class StateCase(NotificationCase):
    """Reminder arithmetic on records that exist only as a name and a date.

    The engine reads a record's dates and what has already been queued for it, so the
    arithmetic can be exercised on a name of its own with the rule's numbers passed in,
    without touching the site's configuration or any real request.
    """

    def current(self, rule_key=APPROVAL, **over):
        base = {
            **NotificationSettingsService.effective(rule_key),
            "enabled": True,
            "timezone": "America/Montreal",
            "initial_delay_value": 1,
            "initial_delay_unit": "Days",
            "repeat_interval_value": 3,
            "repeat_interval_unit": "Days",
            "max_sends": 3,
            "quiet_hours_enabled": 0,
            "quiet_start": None,
            "quiet_end": None,
            "escalation_after_iteration": 0,
            "escalation_audience_key": None,
            "schedule_effective_at": None,
        }

        return {**base, **over}

    def record(self, anchor):
        return frappe._dict(
            name=self.reference("rec"), creation=anchor, submitted_on=anchor, customer_approved_at=anchor
        )

    def state(self, row, current, now, rule_key=APPROVAL):
        return NotificationReminderService.state_of(
            rule_key,
            row,
            current,
            registry.condition(registry.rule(rule_key)["condition_key"]),
            ZoneInfo(current["timezone"]),
            now=now,
        )

    def queue_iteration(self, row, iteration, rule_key=APPROVAL):
        out = NotificationDispatchService.deliver(
            rule_key,
            self.address("q"),
            self.context(),
            business_doctype=REFERENCE,
            business_name=row.name,
            iteration=iteration,
            occurrence=f"iteration:{iteration}",
        )
        self.assertEqual(out["status"], "Queued")

        return out


class TestTheFirstReminderFallsDueOnTime(StateCase):
    def test_it_is_due_exactly_at_the_anchor_plus_the_configured_delay(self):
        anchor = local(2027, 6, 10, 9, 30)

        for value, unit, expected in (
            (1, "Days", local(2027, 6, 11, 9, 30)),
            (36, "Hours", local(2027, 6, 11, 21, 30)),
            (1, "Weeks", local(2027, 6, 17, 9, 30)),
            (0, "Hours", anchor),
        ):
            with self.subTest(delay=f"{value} {unit}"):
                current = self.current(initial_delay_value=value, initial_delay_unit=unit)
                row = self.record(anchor)

                before = self.state(row, current, expected - datetime.timedelta(seconds=1))
                at = self.state(row, current, expected)

                self.assertEqual(at["next_due"], expected)
                self.assertEqual(at["reason"], "eligible")
                self.assertEqual(at["iteration"], 0)

                if value:
                    self.assertEqual(before["reason"], "not_due")
                    self.assertEqual(before["next_due"], expected)

    def test_before_the_delay_has_passed_the_record_is_not_due(self):
        row = self.record(local(2027, 6, 10, 9, 30))

        state = self.state(row, self.current(), local(2027, 6, 10, 20, 0))

        self.assertEqual(state["reason"], "not_due")

    def test_a_day_is_the_same_wall_clock_time_across_a_clock_change(self):
        row = self.record(local(2027, 3, 13, 12, 0))

        state = self.state(row, self.current(), local(2027, 3, 1, 0, 0))

        self.assertEqual(state["next_due"], local(2027, 3, 14, 12, 0))
        self.assertEqual(state["next_due"].astimezone(UTC), local(2027, 3, 14, 16, 0, zone=UTC))


class TestIterationsAndTheMaximum(StateCase):
    def test_successive_iterations_fall_at_the_configured_interval(self):
        anchor = local(2027, 6, 10, 9, 30)
        row = self.record(anchor)
        current = self.current()
        far = local(2027, 6, 1, 0, 0)
        due = []

        for iteration in range(3):
            due.append(self.state(row, current, far)["next_due"])

            if iteration:
                self.assertEqual(self.state(row, current, far)["iteration"], iteration)

            self.queue_iteration(row, iteration + 1)

        self.assertEqual(
            due,
            [local(2027, 6, 11, 9, 30), local(2027, 6, 14, 9, 30), local(2027, 6, 17, 9, 30)],
        )

    def test_the_repeat_interval_may_be_in_hours_or_weeks(self):
        anchor = local(2027, 6, 10, 9, 30)

        for value, unit, expected in (
            (6, "Hours", local(2027, 6, 11, 15, 30)),
            (2, "Weeks", local(2027, 6, 25, 9, 30)),
        ):
            with self.subTest(interval=f"{value} {unit}"):
                row = self.record(anchor)
                current = self.current(repeat_interval_value=value, repeat_interval_unit=unit)
                self.queue_iteration(row, 1)

                self.assertEqual(self.state(row, current, anchor)["next_due"], expected)

    def test_after_the_maximum_the_state_says_so_and_nothing_is_due(self):
        row = self.record(local(2027, 6, 10, 9, 30))
        current = self.current(max_sends=2)
        self.queue_iteration(row, 1)
        self.queue_iteration(row, 2)

        state = self.state(row, current, local(2028, 1, 1, 0, 0))

        self.assertEqual(state["reason"], "max_reached")
        self.assertIsNone(state["next_due"])
        self.assertEqual(state["iteration"], 2)

    def test_a_test_send_does_not_count_towards_the_maximum(self):
        row = self.record(local(2027, 6, 10, 9, 30))
        NotificationDispatchService.deliver(
            APPROVAL,
            self.address("t"),
            self.context(),
            business_doctype=REFERENCE,
            business_name=row.name,
            iteration=1,
            is_test=True,
        )

        state = self.state(row, self.current(max_sends=1), local(2028, 1, 1, 0, 0))

        self.assertEqual(state["iteration"], 0)
        self.assertEqual(state["reason"], "eligible")

    def test_an_iteration_that_failed_to_queue_does_not_count_towards_the_maximum(self):
        row = self.record(local(2027, 6, 10, 9, 30))
        with patch("frappe.sendmail", side_effect=RuntimeError("smtp down")):
            out = NotificationDispatchService.deliver(
                APPROVAL,
                self.address("f"),
                self.context(),
                business_doctype=REFERENCE,
                business_name=row.name,
                iteration=1,
                occurrence="iteration:1",
            )

        state = self.state(row, self.current(max_sends=1), local(2028, 1, 1, 0, 0))

        self.assertEqual(out["status"], "Unknown")
        self.assertEqual(state["iteration"], 0)
        self.assertEqual(state["reason"], "eligible")


class TestNoBacklogBurst(StateCase):
    def test_a_record_waiting_long_before_the_rule_was_enabled_gets_exactly_one_iteration(self):
        enabled_at = local(2027, 6, 10, 8, 0)
        row = self.record(enabled_at - datetime.timedelta(days=60))
        current = self.current(schedule_effective_at=as_site_clock(enabled_at))
        queued = 0

        for minutes in range(0, 24 * 60, 10):
            now = enabled_at + datetime.timedelta(minutes=minutes)
            state = self.state(row, current, now)

            if state["reason"] == "eligible":
                self.queue_iteration(row, state["iteration"] + 1)
                queued += 1

        self.assertEqual(queued, 1, "one prospective reminder, not one per interval missed")

    def test_the_first_iteration_of_such_a_record_is_due_at_the_boundary_and_not_before(self):
        enabled_at = local(2027, 6, 10, 8, 0)
        row = self.record(enabled_at - datetime.timedelta(days=60))
        current = self.current(schedule_effective_at=as_site_clock(enabled_at))

        state = self.state(row, current, enabled_at - datetime.timedelta(hours=1))

        self.assertEqual(state["next_due"], enabled_at)
        self.assertEqual(state["reason"], "not_due")

    def test_the_boundary_does_not_delay_a_record_that_became_due_after_it(self):
        enabled_at = local(2027, 6, 1, 8, 0)
        row = self.record(local(2027, 6, 10, 9, 30))
        current = self.current(schedule_effective_at=as_site_clock(enabled_at))

        state = self.state(row, current, local(2027, 6, 20, 0, 0))

        self.assertEqual(state["next_due"], local(2027, 6, 11, 9, 30))

    def test_saving_a_changed_schedule_moves_the_boundary_to_now(self):
        frappe.db.set_value(RULE, APPROVAL, "schedule_effective_at", LONG_AGO)
        frappe.db.commit()

        NotificationSettingsService.save(APPROVAL, changes={"repeat_interval_value": 2})

        moved = frappe.utils.get_datetime(self.stored(APPROVAL, "schedule_effective_at"))
        self.assertGreater(moved, frappe.utils.get_datetime(LONG_AGO) + datetime.timedelta(days=365))

    def test_switching_a_rule_on_again_moves_the_boundary_to_now(self):
        NotificationSettingsService.save(APPROVAL, changes={"enabled": 0})
        frappe.db.set_value(RULE, APPROVAL, "schedule_effective_at", LONG_AGO)
        frappe.db.commit()

        NotificationSettingsService.save(APPROVAL, changes={"enabled": 1})

        moved = frappe.utils.get_datetime(self.stored(APPROVAL, "schedule_effective_at"))
        self.assertGreater(moved, frappe.utils.get_datetime(LONG_AGO) + datetime.timedelta(days=365))


class TestQuietHours(StateCase):
    def quiet(self, start="22:00:00", end="07:00:00", **over):
        return self.current(
            quiet_hours_enabled=1, quiet_start=start, quiet_end=end, initial_delay_value=1,
            initial_delay_unit="Hours", **over,
        )

    def test_a_due_instant_in_the_night_is_deferred_to_the_morning_not_dropped(self):
        row = self.record(local(2027, 6, 10, 21, 30))

        during = self.state(row, self.quiet(), local(2027, 6, 10, 23, 0))
        after = self.state(row, self.quiet(), local(2027, 6, 11, 7, 0))

        self.assertEqual(during["next_due"], local(2027, 6, 11, 7, 0))
        self.assertEqual(during["reason"], "quiet_hours")
        self.assertTrue(during["deferred"])
        self.assertEqual(after["reason"], "eligible")

    def test_a_window_crossing_midnight_also_holds_the_early_hours_of_the_same_date(self):
        row = self.record(local(2027, 6, 11, 2, 0))

        state = self.state(row, self.quiet(), local(2027, 6, 11, 3, 30))

        self.assertEqual(state["next_due"], local(2027, 6, 11, 7, 0))
        self.assertEqual(state["reason"], "quiet_hours")

    def test_a_window_inside_one_day_defers_to_its_end(self):
        row = self.record(local(2027, 6, 10, 11, 15))

        state = self.state(row, self.quiet("12:00:00", "13:00:00"), local(2027, 6, 10, 12, 30))

        self.assertEqual(state["next_due"], local(2027, 6, 10, 13, 0))
        self.assertEqual(state["reason"], "quiet_hours")

    def test_an_instant_outside_the_window_is_not_moved(self):
        row = self.record(local(2027, 6, 10, 10, 0))

        state = self.state(row, self.quiet(), local(2027, 6, 10, 12, 0))

        self.assertEqual(state["next_due"], local(2027, 6, 10, 11, 0))
        self.assertFalse(state["deferred"])
        self.assertEqual(state["reason"], "eligible")

    def test_the_window_is_half_open_it_includes_its_start_and_excludes_its_end(self):
        at_start = self.state(self.record(local(2027, 6, 10, 21, 0)), self.quiet(), local(2027, 6, 10, 22, 30))
        at_end = self.state(self.record(local(2027, 6, 11, 6, 0)), self.quiet(), local(2027, 6, 11, 8, 0))

        self.assertTrue(at_start["deferred"])
        self.assertEqual(at_end["next_due"], local(2027, 6, 11, 7, 0))
        self.assertFalse(at_end["deferred"])

    def test_the_window_is_read_on_the_rules_own_clock_not_the_servers(self):
        row = self.record(local(2027, 6, 10, 21, 30))
        paris = self.quiet(timezone="Europe/Paris")

        state = self.state(row, paris, local(2027, 6, 10, 0, 0))

        self.assertEqual(state["next_due"], local(2027, 6, 11, 7, 0, zone=ZoneInfo("Europe/Paris")))

    def test_with_quiet_hours_switched_off_the_window_is_ignored(self):
        row = self.record(local(2027, 6, 10, 21, 30))
        current = self.quiet()
        current["quiet_hours_enabled"] = 0

        state = self.state(row, current, local(2027, 6, 10, 22, 45))

        self.assertEqual(state["reason"], "eligible")

    def test_a_deferred_iteration_is_still_the_same_iteration(self):
        row = self.record(local(2027, 6, 10, 21, 30))

        state = self.state(row, self.quiet(), local(2027, 6, 11, 7, 0))

        self.assertEqual(state["iteration"], 0)


class TestTimezoneAndClockChanges(StateCase):
    def test_a_due_time_in_the_spring_forward_gap_resolves_to_a_real_instant(self):
        row = self.record(local(2027, 3, 13, 2, 30))

        state = self.state(row, self.current(), local(2027, 3, 1, 0, 0))
        due = state["next_due"]

        self.assertEqual(due.astimezone(UTC), local(2027, 3, 14, 7, 0, zone=UTC))
        round_trip = due.astimezone(UTC).astimezone(MONTREAL)
        self.assertEqual(round_trip.replace(tzinfo=None), due.replace(tzinfo=None))
        self.assertEqual(due.utcoffset(), datetime.timedelta(hours=-4))

    def test_a_reminder_due_inside_the_gap_is_sent_once_the_clock_has_passed_it(self):
        row = self.record(local(2027, 3, 13, 2, 30))

        before = self.state(row, self.current(), local(2027, 3, 14, 6, 59, zone=UTC))
        after = self.state(row, self.current(), local(2027, 3, 14, 7, 0, zone=UTC))

        self.assertEqual(before["reason"], "not_due")
        self.assertEqual(after["reason"], "eligible")

    def test_an_hour_delay_across_the_gap_is_counted_in_elapsed_time(self):
        row = self.record(local(2027, 3, 14, 1, 30))

        state = self.state(
            row, self.current(initial_delay_value=1, initial_delay_unit="Hours"), local(2027, 3, 1, 0, 0)
        )

        self.assertEqual(state["next_due"].astimezone(UTC), local(2027, 3, 14, 7, 30, zone=UTC))

    def test_the_repeated_autumn_hour_yields_exactly_one_iteration(self):
        row = self.record(local(2027, 11, 6, 1, 30))
        current = self.current()
        first = self.state(row, current, local(2027, 11, 1, 0, 0))["next_due"]
        queued = []

        for step in range(0, 6 * 60, 30):
            now = local(2027, 11, 7, 4, 0, zone=UTC) + datetime.timedelta(minutes=step)
            state = self.state(row, current, now)

            if state["reason"] == "eligible":
                self.queue_iteration(row, state["iteration"] + 1)
                queued.append(now)

        self.assertEqual(first.astimezone(UTC), local(2027, 11, 7, 5, 30, zone=UTC))
        self.assertEqual(len(queued), 1)
        self.assertEqual(queued[0], local(2027, 11, 7, 5, 30, zone=UTC))
        self.assertEqual(frappe.db.count(DISPATCH, {"business_name": row.name}), 1)

    def test_after_the_repeated_hour_the_next_iteration_keeps_the_wall_clock(self):
        row = self.record(local(2027, 11, 6, 1, 30))
        self.queue_iteration(row, 1)

        state = self.state(row, self.current(), local(2027, 11, 7, 12, 0))

        self.assertEqual(state["next_due"], local(2027, 11, 10, 1, 30))

    def test_the_stored_timestamp_is_read_on_the_site_clock(self):
        site = ZoneInfo(frappe.utils.get_system_timezone())
        naive = datetime.datetime(2027, 6, 10, 12, 0)
        row = self.record(naive)

        state = self.state(row, self.current(), local(2027, 6, 1, 0, 0))

        self.assertEqual(state["next_due"], naive.replace(tzinfo=site).astimezone(MONTREAL) + datetime.timedelta(days=1))


class RequestCase(NotificationCase, WriterCase):
    """Real requests, a requester who cannot approve, an approver who can, and our team."""

    def setUp(self):
        super().setUp()
        # the engine's walk remembers where it stopped, on purpose and across restarts. A
        # test whose request is dated into the past sits behind whatever the last test left
        # there, so each one starts the walk from the top
        for rule_key in (APPROVAL, WAITING):
            NotificationReminderService._remember(rule_key, None)

        frappe.db.commit()
        self.tech = self.make_account("internal", "MSP Technician", suffix=f"rt{self.tag[:3]}")
        self.second_tech = self.make_account("internal", "MSP Technician", suffix=f"rs{self.tag[:3]}")
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"ra{self.tag[:3]}"
        )
        self.approver = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"rp{self.tag[:3]}"
        )
        self.grant(self.asker, can_submit=1, can_approve=0)
        self.grant(self.approver, can_submit=1, can_approve=1)

    def simple(self):
        self.asked = getattr(self, "asked", 0) + 1
        person = self.helen if self.asked == 1 else self.make_person(self.customer, f"Extra {self.asked}")
        helen = self.existing(person)

        return {
            "priority": "Medium",
            "details": None,
            "requested_date": frappe.utils.today(),
            "subjects": [helen],
            "requested_devices": [],
            "action_groups": [
                self.group("grp:m365", "service.add", [self.target(helen)], service=self.m365)
            ],
        }

    def raise_as(self, user):
        out = self.as_user(
            user,
            lambda: PortalService.create_request(customer=self.customer, **self.simple()),
        )
        self.track(REFERENCE, out["name"])
        self.refs[REFERENCE].add(out["name"])

        return out["name"]

    def awaiting(self):
        name = self.raise_as(self.asker)
        self.assertEqual(frappe.db.get_value(REFERENCE, name, "status"), "Awaiting Customer Approval")

        return name

    def submitted(self):
        name = self.raise_as(self.approver)
        self.assertEqual(frappe.db.get_value(REFERENCE, name, "status"), "Submitted")

        return name

    def configure(self, rule_key, **fields):
        values = {
            "enabled": 1,
            "initial_delay_value": 0,
            "initial_delay_unit": "Hours",
            "repeat_interval_value": 3,
            "repeat_interval_unit": "Days",
            "max_sends": 3,
            "schedule_effective_at": LONG_AGO,
            "quiet_hours_enabled": 0,
            "escalation_after_iteration": 0,
            "escalation_audience_key": None,
            **fields,
        }
        frappe.db.set_value(RULE, rule_key, values)
        frappe.db.commit()

    def age(self, name, when):
        for field in ("creation", "submitted_on", "customer_approved_at"):
            frappe.db.set_value(REFERENCE, name, field, when, update_modified=False)

        frappe.db.commit()

    def mails(self, name):
        return frappe.db.count("Email Queue", {"reference_doctype": REFERENCE, "reference_name": name})

    def recipients(self, name, rule_key=None):
        filters = {"business_name": name, "rule": rule_key or ("in", (APPROVAL, WAITING))}

        return {
            row.recipient
            for row in frappe.get_all(DISPATCH, filters=filters, fields=["recipient"])
            if row.recipient
        }

    def iterations(self, name):
        return sorted(
            frappe.get_all(
                DISPATCH,
                filters={"business_name": name, "rule": ("in", (APPROVAL, WAITING))},
                pluck="reminder_iteration",
            )
        )

    def reminder_rows(self, name):
        return frappe.db.count(DISPATCH, {"business_name": name, "rule": ("in", (APPROVAL, WAITING))})

    def only(self, *names):
        """Look at these requests and no others, whatever else the site holds."""
        real = NotificationReminderService._candidates

        def narrowed(adapter, limit=None, **read):
            """The named requests only, however the engine asks for its page.

            The engine's own paging is not what these tests are about, and taking whatever
            keywords it uses keeps them from breaking when it changes how it walks.
            """
            found = [
                row for row in real(adapter, limit=200, stop_key=read.get("stop_key")) if row.name in names
            ]

            # the walk stops when a page comes back empty, so a narrowed read answers once
            return [] if read.get("after") else found

        return patch.object(NotificationReminderService, "_candidates", side_effect=narrowed)


class TestAReminderStopsWhenTheRecordIsSettled(RequestCase):
    def test_a_request_that_leaves_its_status_between_listing_and_sending_is_skipped(self):
        name = self.awaiting()
        self.configure(APPROVAL)
        real = NotificationReminderService._candidates
        before = self.mails(name)

        def list_then_settle(adapter, limit=None, **read):
            if read.get("after"):
                return []

            rows = [
                row for row in real(adapter, limit=200, stop_key=read.get("stop_key")) if row.name == name
            ]
            frappe.db.set_value(REFERENCE, name, "status", "Under Review")

            return rows

        with patch.object(NotificationReminderService, "_candidates", side_effect=list_then_settle):
            out = NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(out, {"sent": 0, "skipped": 1})
        self.assertEqual(self.mails(name), before)
        self.assertEqual(frappe.db.count(DISPATCH, {"business_name": name, "rule": APPROVAL}), 0)
        skipped = self.audits(APPROVAL, action="Skipped", business_name=name)
        self.assertEqual([row.reason_code for row in skipped], ["resolved"])

    def test_a_request_the_company_refused_is_no_longer_reminded_about(self):
        name = self.awaiting()
        self.configure(APPROVAL)
        frappe.db.set_value(REFERENCE, name, "refused_by_customer", 1)
        frappe.db.commit()
        before = self.mails(name)

        with self.only(name):
            out = NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(out["sent"], 0)
        self.assertEqual(self.mails(name), before)

    def test_a_request_already_taken_up_is_never_listed_for_a_waiting_reminder(self):
        name = self.submitted()
        self.configure(WAITING)
        frappe.db.set_value(REFERENCE, name, "status", "Under Review")
        frappe.db.commit()
        before = self.mails(name)

        with self.only(name):
            out = NotificationReminderService.run_one(WAITING)

        self.assertEqual(out, {"sent": 0, "skipped": 0})
        self.assertEqual(self.mails(name), before)


class TestTheChosenStopConditionGovernsEligibility(RequestCase):
    STOPS = ("left_trigger_status", "refused_by_customer")

    def watched(self, name, stop_key, rule_key=APPROVAL):
        adapter = registry.condition(registry.rule(rule_key)["condition_key"])
        filters = registry.watch_filters(adapter, stop_key)

        return bool(frappe.db.count(REFERENCE, {**filters, "name": name}))

    def test_the_two_stop_conditions_merge_to_different_filters(self):
        adapter = registry.condition(APPROVAL)

        floor = registry.watch_filters(adapter, "left_trigger_status")
        refused = registry.watch_filters(adapter, "refused_by_customer")

        self.assertEqual(floor, {"status": "Awaiting Customer Approval"})
        self.assertEqual(refused, {"status": "Awaiting Customer Approval", "refused_by_customer": 0})
        self.assertEqual(registry.watch_filters(adapter, "nonsense"), floor)

    def test_a_refused_request_still_in_the_trigger_status_is_watched_only_under_the_floor(self):
        name = self.awaiting()
        frappe.db.set_value(REFERENCE, name, "refused_by_customer", 1)
        frappe.db.commit()

        self.assertTrue(self.watched(name, "left_trigger_status"))
        self.assertFalse(self.watched(name, "refused_by_customer"))

    def test_the_stored_choice_decides_what_the_engine_lists(self):
        name = self.awaiting()
        frappe.db.set_value(REFERENCE, name, "refused_by_customer", 1)
        frappe.db.commit()

        for stop_key, listed in (("left_trigger_status", True), ("refused_by_customer", False)):
            self.configure(APPROVAL, stop_condition_key=stop_key)
            doc = frappe.get_doc(REFERENCE, name)
            adapter = registry.condition(APPROVAL)

            self.assertEqual(
                NotificationReminderService._still_waiting(doc, adapter, stop_key), listed, stop_key
            )

    def test_a_request_that_left_the_trigger_status_is_never_reminded_whatever_the_stop_condition(self):
        name = self.awaiting()
        frappe.db.set_value(REFERENCE, name, "status", "Under Review")
        frappe.db.commit()
        doc = frappe.get_doc(REFERENCE, name)

        for stop_key in self.STOPS:
            self.configure(APPROVAL, stop_condition_key=stop_key)
            before = self.mails(name)

            with self.only(name):
                out = NotificationReminderService.run_one(APPROVAL)

            self.assertFalse(
                NotificationReminderService._still_waiting(doc, registry.condition(APPROVAL), stop_key)
            )
            self.assertFalse(self.watched(name, stop_key))
            self.assertEqual(out["sent"], 0, stop_key)
            self.assertEqual(self.mails(name), before, stop_key)

    def test_saving_refuses_a_stop_condition_the_rule_does_not_declare(self):
        with self.assertRaises(ValidationError):
            NotificationSettingsService.save(APPROVAL, changes={"stop_condition_key": "when_it_feels_like"})

        self.assertNotEqual(self.stored(APPROVAL, "stop_condition_key"), "when_it_feels_like")

    def test_changing_the_stop_condition_moves_the_boundary_and_clears_the_cursor(self):
        frappe.db.set_value(RULE, APPROVAL, "stop_condition_key", "left_trigger_status")
        frappe.db.set_value(RULE, APPROVAL, "schedule_effective_at", LONG_AGO)
        NotificationReminderService._remember(APPROVAL, (LONG_AGO, self.reference("cur")))
        frappe.db.commit()
        self.assertIsNotNone(NotificationReminderService._cursor(APPROVAL))

        NotificationSettingsService.save(APPROVAL, changes={"stop_condition_key": "refused_by_customer"})

        moved = frappe.utils.get_datetime(self.stored(APPROVAL, "schedule_effective_at"))
        self.assertGreater(moved, frappe.utils.get_datetime(LONG_AGO) + datetime.timedelta(days=365))
        self.assertIsNone(NotificationReminderService._cursor(APPROVAL))


class TestTheConditionARuleWatchesIsConfigurable(RequestCase):
    def spy(self):
        seen = []

        def record(adapter, limit=None, **read):
            seen.append(dict(adapter["filters"]))

            return []

        return seen, patch.object(NotificationReminderService, "_candidates", side_effect=record)

    def test_each_reminder_declares_exactly_one_condition(self):
        self.assertEqual(registry.allowed_conditions(APPROVAL), (APPROVAL,))
        self.assertEqual(registry.allowed_conditions(WAITING), (WAITING,))
        self.assertEqual([entry["key"] for entry in registry.choices(APPROVAL)["conditions"]], [APPROVAL])

    def test_a_rule_with_no_stored_condition_watches_the_one_it_declares(self):
        self.configure(APPROVAL, condition_key=None)
        seen, spy = self.spy()

        with spy:
            NotificationReminderService.run_one(APPROVAL)

        self.assertTrue(all(found["status"] == "Awaiting Customer Approval" for found in seen), seen)

    def test_saving_refuses_a_condition_the_rule_does_not_declare(self):
        for refused in ("every_invoice", WAITING):
            with self.assertRaises(ValidationError):
                NotificationSettingsService.save(APPROVAL, changes={"condition_key": refused})

            self.assertNotEqual(self.stored(APPROVAL, "condition_key"), refused)

    def test_a_condition_over_another_doctype_is_never_listable(self):
        other = lambda rule_key=None: {  # noqa: E731
            "doctype": "MSP Invoice",
            "filters": {"status": "Issued"},
            "stops": {"left_trigger_status": {}},
        }

        with (
            patch.dict(registry.CONDITIONS, {"invoice_overdue": other}),
            patch.dict(
                registry.RULES[APPROVAL],
                {"conditions": ("request_approval_pending", "invoice_overdue")},
            ),
        ):
            self.assertEqual(registry.allowed_conditions(APPROVAL), ("request_approval_pending",))
            self.assertEqual(
                [entry["key"] for entry in registry.choices(APPROVAL)["conditions"]],
                ["request_approval_pending"],
            )

            with self.assertRaises(ValidationError):
                NotificationSettingsService.save(APPROVAL, changes={"condition_key": "invoice_overdue"})

    def test_the_choices_offer_the_declared_condition_with_a_label_and_its_own_stops(self):
        offered = registry.choices(APPROVAL)

        self.assertEqual([entry["key"] for entry in offered["conditions"]], [APPROVAL])
        self.assertTrue(all(entry["label"] for entry in offered["conditions"]))
        self.assertEqual(
            [entry["key"] for entry in offered["stop_conditions"]],
            list(registry.condition(APPROVAL)["stop_conditions"]),
        )

    def test_switching_condition_moves_the_boundary_clears_the_cursor_and_is_audited(self):
        frappe.db.set_value(RULE, APPROVAL, "schedule_effective_at", LONG_AGO)
        NotificationReminderService._remember(APPROVAL, (LONG_AGO, self.reference("cur")))
        frappe.db.commit()

        with patch.dict(registry.RULES[APPROVAL], {"conditions": (APPROVAL, WAITING)}):
            NotificationSettingsService.save(APPROVAL, changes={"condition_key": WAITING})

        moved = frappe.utils.get_datetime(self.stored(APPROVAL, "schedule_effective_at"))
        self.assertGreater(moved, frappe.utils.get_datetime(LONG_AGO) + datetime.timedelta(days=365))
        self.assertIsNone(NotificationReminderService._cursor(APPROVAL))
        self.assertEqual(self.stored(APPROVAL, "condition_key"), WAITING)
        edits = self.audits(APPROVAL, action="Rule Edited")
        details = [frappe.db.get_value(AUDIT, row.name, "detail") for row in edits]
        self.assertTrue(any("condition_key" in (detail or "") for detail in details), details)


class TestTheMigrationLeavesAChosenStopConditionAlone(NotificationCase):
    """Moving a value nobody chose is a repair; moving one somebody chose is a reset."""

    def seed_the_floor(self, rule_key=APPROVAL):
        frappe.db.set_value(RULE, rule_key, "stop_condition_key", "left_trigger_status")
        frappe.db.commit()

    def chose_it(self, action, rule_key=APPROVAL):
        self.seed_the_floor(rule_key)
        NotificationSettingsService._write_audit(
            action=action,
            rule=rule_key,
            reason_code="settings_saved",
            detail="stop_condition_key: refused_by_customer -> left_trigger_status",
        )
        frappe.db.commit()

    def migrate(self):
        from nexgen_msp.patches import keep_reminders_stopping_on_refusal

        keep_reminders_stopping_on_refusal.execute()

        return self.stored(APPROVAL, "stop_condition_key")

    def stored(self, rule_key, field):
        return frappe.db.get_value(RULE, rule_key, field)

    def test_a_value_nobody_chose_is_moved_to_what_the_engine_has_always_done(self):
        self.seed_the_floor()

        self.assertEqual(self.migrate(), "refused_by_customer")

    def test_a_choice_recorded_as_an_edit_is_left_alone(self):
        self.chose_it("Rule Edited")

        self.assertEqual(self.migrate(), "left_trigger_status")

    def test_a_choice_made_while_switching_the_rule_on_is_left_alone(self):
        """One save that also switches the rule is recorded as `Rule Enabled`, not an edit."""
        self.chose_it("Rule Enabled")

        self.assertEqual(self.migrate(), "left_trigger_status")

    def test_a_choice_made_while_switching_the_rule_off_is_left_alone(self):
        self.chose_it("Rule Disabled")

        self.assertEqual(self.migrate(), "left_trigger_status")

    def test_a_save_that_touched_other_fields_is_no_evidence_of_a_choice(self):
        self.seed_the_floor()
        NotificationSettingsService._write_audit(
            action="Rule Edited",
            rule=APPROVAL,
            reason_code="settings_saved",
            detail="max_sends: 3 -> 5",
        )
        frappe.db.commit()

        self.assertEqual(self.migrate(), "refused_by_customer")


class TestADeliveryThatNeverReachedAnybodyIsOwedAgain(RequestCase):
    """The record's cadence is one question; whether each address got its mail is another."""

    def setUp(self):
        super().setUp()
        self.first = self.address("a")
        self.second = self.address("b")

    def both(self):
        return patch.object(registry, "resolve_audience", return_value=[self.first, self.second])

    def leave_unknown(self, name, address):
        """A claim whose worker never came back, as the engine finds it two hours on."""
        key = NotificationDispatchService.dedup_key(APPROVAL, REFERENCE, name, "iteration:1", address)
        held = NotificationDispatchService._reserve(
            key,
            rule_key=APPROVAL,
            revision=1,
            business_doctype=REFERENCE,
            business_name=name,
            occurrence="iteration:1",
            iteration=1,
            recipient=address,
            template_name="MSP Request Approval Reminder",
        )
        dispatch = held["dispatch"].name
        frappe.db.set_value(
            DISPATCH,
            dispatch,
            "reserved_at",
            frappe.utils.add_to_date(frappe.utils.now(), hours=-2),
            update_modified=False,
        )
        frappe.db.commit()
        NotificationDispatchService.deliver(
            APPROVAL,
            address,
            self.context(),
            business_doctype=REFERENCE,
            business_name=name,
            iteration=1,
            occurrence="iteration:1",
        )
        self.assertEqual(frappe.db.get_value(DISPATCH, dispatch, "status"), "Unknown")

        return dispatch

    def attest(self, dispatch):
        NotificationDispatchService.resolve(
            dispatch, "not_sent", note="Nothing in the queue for this address and request."
        )
        self.assertEqual(frappe.db.get_value(DISPATCH, dispatch, "skip_reason"), "attested_not_sent")

    def strand_second(self, **over):
        """One iteration: the first address is queued, the second is attested as never sent."""
        name = self.awaiting()
        self.configure(APPROVAL, **over)
        dispatch = self.leave_unknown(name, self.second)

        with self.only(name), self.both():
            NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(self.queued_to(self.first), 1)
        self.assertEqual(self.queued_to(self.second), 0)
        self.attest(dispatch)

        return name, dispatch

    def state(self, name):
        row = frappe._dict(name=name, creation=frappe.db.get_value(REFERENCE, name, "creation"))
        current = NotificationSettingsService.effective(APPROVAL)

        return NotificationReminderService.state_of(
            APPROVAL, row, current, registry.condition(APPROVAL), ZoneInfo(current["timezone"])
        )

    def test_an_address_attested_as_not_sent_is_mailed_at_its_iteration_even_at_the_maximum(self):
        name, _dispatch = self.strand_second(max_sends=1)

        self.assertEqual(self.state(name)["reason"], "max_reached")

        with self.only(name), self.both():
            out = NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(out["sent"], 1)
        self.assertEqual(self.queued_to(self.second), 1)
        self.assertEqual(self.queued_to(self.first), 1, "and nothing more to the one already mailed")
        self.assertEqual(self.iterations(name), [1, 1])
        self.assertEqual(self.state(name)["reason"], "max_reached")

    def test_with_more_iterations_allowed_the_missed_one_is_delivered_and_the_cadence_is_unchanged(self):
        name, _dispatch = self.strand_second(max_sends=3)
        before = self.state(name)

        with self.only(name), self.both():
            out = NotificationReminderService.run_one(APPROVAL)

        after = self.state(name)

        self.assertEqual(out["sent"], 1)
        self.assertEqual(self.queued_to(self.second), 1)
        self.assertEqual(self.queued_to(self.first), 1)
        self.assertEqual(self.iterations(name), [1, 1], "the retry created no iteration of its own")
        self.assertEqual((after["iteration"], after["reason"]), (before["iteration"], before["reason"]))
        self.assertEqual(after["next_due"], before["next_due"])

    def test_a_record_that_left_the_trigger_status_is_not_reminded_whatever_is_owed(self):
        name, _dispatch = self.strand_second(max_sends=1)
        frappe.db.set_value(REFERENCE, name, "status", "Submitted", update_modified=False)
        frappe.db.commit()

        with self.only(name), self.both():
            NotificationReminderService.run_one(APPROVAL)

        declared = registry.rule(APPROVAL)
        current = NotificationSettingsService.effective(APPROVAL)
        listed = frappe._dict(name=name)
        direct = NotificationReminderService._redeliver(
            declared, current, registry.condition(APPROVAL), listed, [(1, self.second, "x")]
        )

        self.assertEqual(direct, {"sent": 0, "skipped": 1})
        self.assertEqual(self.queued_to(self.second), 0)
        self.assertEqual(self.queued_to(self.first), 1)

    def test_a_rule_switched_off_raises_nothing_outstanding(self):
        name, _dispatch = self.strand_second(max_sends=1)
        self.configure(APPROVAL, enabled=0, max_sends=1)

        with self.only(name), self.both():
            out = NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(out, {"sent": 0, "skipped": 0})
        self.assertEqual(self.queued_to(self.second), 0)

    def test_two_ticks_in_a_row_mail_the_missed_address_once(self):
        name, _dispatch = self.strand_second(max_sends=1)

        with self.only(name), self.both():
            first = NotificationReminderService.run_one(APPROVAL)
            second = NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(first["sent"], 1)
        self.assertEqual(second["sent"], 0)
        self.assertEqual(self.queued_to(self.second), 1)
        self.assertEqual(self.queued_to(self.first), 1)

    def test_an_address_no_longer_in_the_audience_is_not_sent_an_old_iteration(self):
        """Approving for a company is an authority people lose, and a reprise must ask again."""
        name, dispatch = self.strand_second(max_sends=1)

        with self.only(name), patch.object(registry, "resolve_audience", return_value=[self.first]):
            NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(self.queued_to(self.second), 0, "no longer theirs to receive")
        self.assertEqual(self.queued_to(self.first), 1)
        self.assertEqual(frappe.db.get_value(DISPATCH, dispatch, "status"), "Skipped")
        self.assertEqual(
            frappe.db.get_value(DISPATCH, dispatch, "skip_reason"), "no_longer_addressed"
        )
        self.assertEqual(NotificationReminderService._owed(APPROVAL, [name]), {})
        told = self.audits(APPROVAL, action="Skipped", business_name=name)
        self.assertIn("no_longer_addressed", [row.reason_code for row in told])

    def test_a_delivery_another_worker_has_claimed_is_not_closed_underneath_them(self):
        """Closing is held under the same lock a claim takes, and only while it is nobody's."""
        name, dispatch = self.strand_second(max_sends=1)

        frappe.db.set_value(DISPATCH, dispatch, {"status": "Pending", "skip_reason": None})
        frappe.db.commit()

        self.assertFalse(NotificationReminderService._close(dispatch))
        self.assertEqual(frappe.db.get_value(DISPATCH, dispatch, "status"), "Pending")

        frappe.db.set_value(
            DISPATCH, dispatch, {"status": "Failed", "skip_reason": "attested_not_sent"}
        )
        frappe.db.commit()

        self.assertTrue(NotificationReminderService._close(dispatch))
        self.assertEqual(frappe.db.get_value(DISPATCH, dispatch, "status"), "Skipped")
        self.assertFalse(NotificationReminderService._close(dispatch), "and only once")
        self.assertEqual(name, frappe.db.get_value(DISPATCH, dispatch, "business_name"))

    def test_an_address_put_back_in_the_audience_before_the_tick_is_still_served(self):
        name, _dispatch = self.strand_second(max_sends=1)

        with self.only(name), self.both():
            NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(self.queued_to(self.second), 1)

    def test_an_extra_recipient_an_administrator_added_is_addressed_on_a_reprise(self):
        name, _dispatch = self.strand_second(max_sends=1)
        rule = frappe.get_doc(RULE, APPROVAL)
        rule.append("recipients", {"email": self.second, "kind": "To"})
        rule.save(ignore_permissions=True)
        frappe.db.commit()

        with self.only(name), patch.object(registry, "resolve_audience", return_value=[self.first]):
            NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(self.queued_to(self.second), 1, "still addressed, by hand")

    def test_a_reprise_waits_for_the_quiet_period_to_end(self):
        name, dispatch = self.strand_second(max_sends=1)
        current = NotificationSettingsService.effective(APPROVAL)
        now = frappe.utils.get_datetime(frappe.utils.now()).astimezone(
            ZoneInfo(current["timezone"])
        )
        self.configure(
            APPROVAL,
            max_sends=1,
            quiet_hours_enabled=1,
            quiet_start=(now - datetime.timedelta(hours=1)).strftime("%H:%M:%S"),
            quiet_end=(now + datetime.timedelta(hours=1)).strftime("%H:%M:%S"),
        )

        with self.only(name), self.both():
            NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(self.queued_to(self.second), 0, "deferred, not dropped")
        self.assertEqual(frappe.db.get_value(DISPATCH, dispatch, "status"), "Failed")

        self.configure(APPROVAL, max_sends=1, quiet_hours_enabled=0)

        with self.only(name), self.both():
            NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(self.queued_to(self.second), 1, "and owed still, once the window ends")

    def test_the_owed_list_holds_only_failed_untried_deliveries_in_order(self):
        name, dispatch = self.strand_second(max_sends=1)

        self.assertEqual(
            NotificationReminderService._owed(APPROVAL, [name]),
            {name: [(1, self.second, dispatch)]},
        )

        frappe.db.set_value(DISPATCH, dispatch, "is_test", 1)

        self.assertEqual(NotificationReminderService._owed(APPROVAL, [name]), {})

    def test_a_delivery_whose_template_failed_to_render_is_picked_up_once_it_renders(self):
        name = self.awaiting()
        self.configure(APPROVAL, max_sends=1)
        real = notifications.render

        def fails_for_the_second(template, context):
            if context.get("full_name") == self.second:
                raise ValueError("template broken")

            return real(template, context)

        with (
            self.only(name),
            self.both(),
            patch.object(notifications, "render", side_effect=fails_for_the_second),
        ):
            NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(self.queued_to(self.first), 1)
        self.assertEqual(self.queued_to(self.second), 0)
        self.assertEqual(
            frappe.db.get_value(DISPATCH, {"business_name": name, "recipient": self.second}, "skip_reason"),
            "render_failed",
        )

        with self.only(name), self.both():
            out = NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(out["sent"], 1)
        self.assertEqual(self.queued_to(self.second), 1)
        self.assertEqual(self.queued_to(self.first), 1)


class TestWhoIsReminded(RequestCase):
    def test_the_approval_reminder_goes_to_the_approvers_of_the_request(self):
        name = self.awaiting()
        self.configure(APPROVAL)
        expected = {
            address.lower() for address in PortalService._approvers_of(frappe.get_doc(REFERENCE, name))
        }

        with self.only(name):
            out = NotificationReminderService.run_one(APPROVAL)

        self.assertIn(self.approver, expected)
        self.assertNotIn(self.asker, expected)
        self.assertEqual(self.recipients(name, APPROVAL), expected)
        self.assertEqual(out["sent"], len(expected))

    def test_the_internal_reminder_goes_to_our_team_without_the_requester(self):
        name = self.submitted()
        self.configure(WAITING)
        frappe.db.set_value(REFERENCE, name, "requester", self.tech)
        frappe.db.commit()
        team = {address.lower() for address in PortalService._our_team()}

        with self.only(name):
            out = NotificationReminderService.run_one(WAITING)

        reached = self.recipients(name, WAITING)
        self.assertIn(self.tech, team)
        self.assertIn(self.second_tech, team)
        self.assertEqual(reached, team - {self.tech})
        self.assertNotIn(self.tech, reached)
        self.assertEqual(out["sent"], len(team) - 1)

    def test_the_internal_reminder_reaches_the_whole_team_when_the_requester_is_a_customer(self):
        name = self.submitted()
        self.configure(WAITING)
        team = {address.lower() for address in PortalService._our_team()}

        with self.only(name):
            NotificationReminderService.run_one(WAITING)

        self.assertEqual(self.recipients(name, WAITING), team)
        self.assertNotIn(self.approver, self.recipients(name, WAITING))

    def test_a_reminder_never_goes_to_somebody_the_rule_is_not_addressed_to(self):
        name = self.awaiting()
        self.configure(APPROVAL)

        with self.only(name):
            NotificationReminderService.run_one(APPROVAL)

        self.assertNotIn(self.tech, self.recipients(name, APPROVAL))
        self.assertNotIn(self.asker, self.recipients(name, APPROVAL))


class TestAReminderIsSentOnce(RequestCase):
    def test_running_the_rule_twice_in_a_row_queues_nothing_the_second_time(self):
        name = self.awaiting()
        self.configure(APPROVAL)
        before = self.mails(name)

        with self.only(name):
            first = NotificationReminderService.run_one(APPROVAL)
            queued = self.mails(name)
            second = NotificationReminderService.run_one(APPROVAL)

        self.assertGreater(first["sent"], 0)
        self.assertEqual(queued, before + first["sent"])
        self.assertEqual(second["sent"], 0)
        self.assertEqual(self.mails(name), queued)
        self.assertEqual(set(self.iterations(name)), {1})

    def test_delivering_an_iteration_already_queued_queues_nothing_more(self):
        name = self.awaiting()
        self.configure(APPROVAL)

        with self.only(name):
            NotificationReminderService.run_one(APPROVAL)

        queued = self.mails(name)
        address = sorted(self.recipients(name, APPROVAL))[0]

        again = NotificationDispatchService.deliver(
            APPROVAL,
            address,
            self.context(),
            business_doctype=REFERENCE,
            business_name=name,
            iteration=1,
            occurrence="iteration:1",
        )

        self.assertEqual(again["reason"], "already_dispatched")
        self.assertEqual(self.mails(name), queued)

    def reserved_delivery(self, name, address):
        """A delivery claimed and not finished: the row a worker leaves when it stops."""
        key = NotificationDispatchService.dedup_key(APPROVAL, REFERENCE, name, "iteration:1", address)
        held = NotificationDispatchService._reserve(
            key,
            rule_key=APPROVAL,
            revision=1,
            business_doctype=REFERENCE,
            business_name=name,
            occurrence="iteration:1",
            iteration=1,
            recipient=address,
            template_name="MSP Request Approval Reminder",
        )
        self.assertTrue(held["reserved"])
        frappe.db.commit()

        return held["dispatch"].name

    def deliver_once(self, name, address):
        return NotificationDispatchService.deliver(
            APPROVAL,
            address,
            self.context(),
            business_doctype=REFERENCE,
            business_name=name,
            iteration=1,
            occurrence="iteration:1",
        )

    def test_a_reservation_somebody_is_still_working_on_is_left_alone(self):
        """Whoever claimed it is most likely inside sendmail, and racing them sends twice."""
        name = self.awaiting()
        address = self.address("r")
        self.reserved_delivery(name, address)
        before = self.mails(name)

        outcome = self.deliver_once(name, address)

        self.assertEqual(outcome["reason"], "held_by_another_worker")
        self.assertEqual(self.mails(name), before)

    def test_an_abandoned_delivery_can_be_settled_by_an_administrator(self):
        """Unknown is a safe place to stop, not a place to stay.

        The engine cannot tell whether that mail went, and must not guess. Somebody who can
        look at the queue can tell, and whichever way they answer is written down with their
        name against it.
        """
        name = self.awaiting()
        address = self.address("r")
        dispatch = self.reserved_delivery(name, address)
        frappe.db.set_value(
            "MSP Notification Dispatch",
            dispatch,
            "reserved_at",
            frappe.utils.add_to_date(frappe.utils.now(), hours=-2),
            update_modified=False,
        )
        frappe.db.commit()
        self.deliver_once(name, address)

        self.assertEqual(frappe.db.get_value(DISPATCH, dispatch, "status"), "Unknown")

        shown = NotificationDispatchService.evidence(dispatch)
        self.assertEqual(shown["dispatch"]["name"], dispatch)
        self.assertEqual(sorted(shown["decisions"]), ["link", "not_sent"])

        with self.assertRaises(ValidationError):
            NotificationDispatchService.resolve(dispatch, "not_sent", note="")

        before = self.mails(name)
        NotificationDispatchService.resolve(
            dispatch, "not_sent", note="Nothing in the queue for this address and request."
        )

        self.assertEqual(frappe.db.get_value(DISPATCH, dispatch, "status"), "Failed")
        self.assertEqual(
            frappe.db.get_value(DISPATCH, dispatch, "skip_reason"), "attested_not_sent"
        )

        settled = self.audits(APPROVAL, action="Retry Decided", business_name=name)
        self.assertIn("resolved_not_sent", [row.reason_code for row in settled])
        self.assertTrue(all(row.actor for row in settled), "whoever decided is on the record")

        # and the ordinary path finishes it, once
        for _ in range(2):
            self.deliver_once(name, address)

        self.assertEqual(self.mails(name), before + 1)

    def test_a_reservation_whose_worker_never_came_back_is_left_for_review(self):
        """Nothing ties a dispatch to a queue entry, so neither answer can be guessed at.

        The worker stopped somewhere between writing the mail and recording that it had.
        Sending again might send twice; adopting whatever mail is addressed to that person
        about that record might adopt a different notification entirely and lose this one.
        So the row says it does not know, and somebody looks.
        """
        name = self.awaiting()
        address = self.address("r")
        dispatch = self.reserved_delivery(name, address)
        frappe.db.set_value(
            "MSP Notification Dispatch",
            dispatch,
            "reserved_at",
            frappe.utils.add_to_date(frappe.utils.now(), hours=-2),
            update_modified=False,
        )
        frappe.db.commit()
        before = self.mails(name)

        outcome = self.deliver_once(name, address)

        self.assertEqual(outcome["reason"], "needs_investigation")
        self.assertEqual(frappe.db.get_value(DISPATCH, dispatch, "status"), "Unknown")
        self.assertEqual(self.mails(name), before, "and nothing was sent a second time")

        # and asking again changes nothing, however many times it is asked
        self.deliver_once(name, address)

        self.assertEqual(self.mails(name), before)
        self.assertEqual(self.reminder_rows(name), 1)

    def test_the_maximum_stops_run_one_from_sending_anything_more(self):
        name = self.awaiting()
        self.configure(APPROVAL, max_sends=1, repeat_interval_value=1, repeat_interval_unit="Hours")
        self.age(name, frappe.utils.add_to_date(frappe.utils.now_datetime(), days=-30))

        with self.only(name):
            first = NotificationReminderService.run_one(APPROVAL)
            queued = self.mails(name)
            second = NotificationReminderService.run_one(APPROVAL)

        row = frappe._dict(name=name, creation=frappe.db.get_value(REFERENCE, name, "creation"))
        state = NotificationReminderService.state_of(
            APPROVAL,
            row,
            NotificationSettingsService.effective(APPROVAL),
            registry.condition(APPROVAL),
            ZoneInfo(NotificationSettingsService.effective(APPROVAL)["timezone"]),
        )

        self.assertGreater(first["sent"], 0)
        self.assertEqual(second["sent"], 0)
        self.assertEqual(self.mails(name), queued)
        self.assertEqual(state["reason"], "max_reached")

    def test_the_polling_tick_reminds_both_kinds_of_request_once_whatever_its_frequency(self):
        waiting = self.awaiting()
        ours = self.submitted()
        self.configure(APPROVAL)
        self.configure(WAITING)

        with self.only(waiting, ours):
            first = reminders.tick()
            second = reminders.tick()
            third = reminders.every_three_hours()

        self.assertGreater(first["sent"], 0)
        self.assertEqual(second["sent"], 0)
        self.assertEqual(third["sent"], 0)
        self.assertTrue(self.recipients(waiting, APPROVAL))
        self.assertTrue(self.recipients(ours, WAITING))
        self.assertEqual(set(self.iterations(waiting)), {1})
        self.assertEqual(set(self.iterations(ours)), {1})

    def test_a_disabled_rule_is_not_polled(self):
        name = self.awaiting()
        self.configure(APPROVAL, enabled=0)
        before = self.mails(name)

        with self.only(name):
            out = NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(out, {"sent": 0, "skipped": 0})
        self.assertEqual(self.mails(name), before)


class TestEscalation(RequestCase):
    def escalate(self, after=2, to="internal", **over):
        self.configure(
            APPROVAL, escalation_after_iteration=after, escalation_audience_key=to, **over
        )

    def remind(self, name, iteration):
        declared = registry.rule(APPROVAL)
        current = NotificationSettingsService.effective(APPROVAL)
        row = frappe._dict(name=name)

        return NotificationReminderService._remind(
            declared, current, registry.condition(APPROVAL), row, iteration
        )

    def test_an_iteration_before_the_configured_one_goes_to_the_normal_audience(self):
        name = self.awaiting()
        self.escalate(after=2)

        self.remind(name, 1)

        self.assertEqual(
            self.recipients(name, APPROVAL),
            {address.lower() for address in PortalService._approvers_of(frappe.get_doc(REFERENCE, name))},
        )
        self.assertNotIn(self.tech, self.recipients(name, APPROVAL))

    def test_an_iteration_after_the_configured_one_goes_only_to_the_escalation_audience(self):
        name = self.awaiting()
        self.escalate(after=2)
        doc = frappe.get_doc(REFERENCE, name)

        self.remind(name, 3)

        self.assertEqual(
            self.recipients(name, APPROVAL),
            {address.lower() for address in registry.resolve_audience("internal", doc)},
        )
        self.assertNotIn(self.approver, self.recipients(name, APPROVAL))

    def test_the_configured_iteration_itself_is_not_escalated(self):
        """"After reminder two" means the ones that follow it, which is what the field says.

        The reading matters because it is the difference between escalating three times and
        escalating twice, and the screen offers the number under the words "escalate after
        reminder iteration".
        """
        name = self.awaiting()
        self.escalate(after=2)
        doc = frappe.get_doc(REFERENCE, name)

        self.remind(name, 2)

        self.assertEqual(
            self.recipients(name, APPROVAL),
            {
                address.lower()
                for address in PortalService._approvers_of(frappe.get_doc(REFERENCE, name))
            },
        )
        self.assertNotIn(self.tech, self.recipients(name, APPROVAL))

    def test_the_one_after_the_configured_iteration_is_escalated(self):
        name = self.awaiting()
        self.escalate(after=2, max_sends=3)
        doc = frappe.get_doc(REFERENCE, name)

        self.remind(name, 3)

        self.assertEqual(
            self.recipients(name, APPROVAL),
            {address.lower() for address in registry.resolve_audience("internal", doc)},
        )

    def test_without_an_escalation_every_iteration_goes_to_the_normal_audience(self):
        name = self.awaiting()
        self.configure(APPROVAL)

        self.remind(name, 3)

        self.assertNotIn(self.tech, self.recipients(name, APPROVAL))

    def test_an_escalating_rule_still_stops_at_the_maximum(self):
        name = self.awaiting()
        self.escalate(after=1, max_sends=2, repeat_interval_value=1, repeat_interval_unit="Hours")
        self.age(name, frappe.utils.add_to_date(frappe.utils.now_datetime(), days=-30))
        sent = []

        with self.only(name):
            for _ in range(4):
                sent.append(NotificationReminderService.run_one(APPROVAL)["sent"])
                frappe.db.sql(
                    "update `tabMSP Notification Rule` set schedule_effective_at = %s where name = %s",
                    (LONG_AGO, APPROVAL),
                )

        self.assertEqual(sorted(set(self.iterations(name))), [1, 2])
        self.assertEqual(sent[2:], [0, 0])

    def test_an_escalation_after_an_iteration_that_can_never_come_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            NotificationSettingsService.save(
                APPROVAL,
                changes={
                    "max_sends": 2,
                    "escalation_after_iteration": 3,
                    "escalation_audience_key": "internal",
                },
            )


class TestEligibilityIsExplained(RequestCase):
    def reasons(self, *names):
        out = NotificationReminderService.eligibility(APPROVAL)
        rows = {row["business_name"]: row for row in out["rows"] if row["business_name"] in names}

        return rows

    def test_every_record_is_given_a_reason_and_the_reason_a_label(self):
        due = self.awaiting()
        fresh = self.awaiting()
        spent = self.awaiting()
        self.configure(APPROVAL, initial_delay_value=1, initial_delay_unit="Days", max_sends=2)
        three_days_ago = frappe.utils.add_to_date(frappe.utils.now_datetime(), days=-3)
        self.age(due, three_days_ago)
        self.age(spent, three_days_ago)
        stub = frappe._dict(name=spent)

        for iteration in (1, 2):
            NotificationDispatchService.deliver(
                APPROVAL,
                self.address("e"),
                self.context(),
                business_doctype=REFERENCE,
                business_name=stub.name,
                iteration=iteration,
                occurrence=f"iteration:{iteration}",
            )

        rows = self.reasons(due, fresh, spent)

        self.assertEqual(rows[due]["reason"], "eligible")
        self.assertEqual(rows[fresh]["reason"], "not_due")
        self.assertEqual(rows[spent]["reason"], "max_reached")

        for name, row in rows.items():
            with self.subTest(record=name):
                self.assertEqual(row["reason_label"], REASONS[row["reason"]])
                self.assertTrue(row["reason_label"])

        self.assertEqual(rows[spent]["iteration"], 2)
        self.assertEqual(rows[spent]["max_sends"], 2)
        self.assertIsNone(rows[spent]["next_due"])
        self.assertTrue(rows[fresh]["next_due"])

    def test_a_disabled_rule_labels_every_record_as_switched_off(self):
        names = [self.awaiting(), self.awaiting()]
        self.configure(APPROVAL, enabled=0)

        rows = self.reasons(*names)

        self.assertEqual(set(rows), set(names))

        for row in rows.values():
            self.assertEqual(row["reason"], "disabled")
            self.assertEqual(row["reason_label"], REASONS["disabled"])
            self.assertIsNone(row["next_due"])

    def test_a_record_inside_a_quiet_window_says_it_is_deferred(self):
        name = self.awaiting()
        zone = NotificationSettingsService.effective(APPROVAL)["timezone"]
        now = frappe.utils.now_datetime().replace(tzinfo=ZoneInfo(frappe.utils.get_system_timezone()))
        hour = now.astimezone(ZoneInfo(zone))
        start = (hour - datetime.timedelta(hours=1)).strftime("%H:%M:00")
        end = (hour + datetime.timedelta(hours=1)).strftime("%H:%M:00")
        self.configure(APPROVAL, quiet_hours_enabled=1, quiet_start=start, quiet_end=end)

        rows = self.reasons(name)

        self.assertEqual(rows[name]["reason"], "quiet_hours")
        self.assertEqual(rows[name]["reason_label"], REASONS["quiet_hours"])

    def test_a_record_that_has_left_the_trigger_status_is_not_listed_as_waiting(self):
        name = self.awaiting()
        self.configure(APPROVAL)
        frappe.db.set_value(REFERENCE, name, "status", "Under Review")
        frappe.db.commit()

        self.assertEqual(self.reasons(name), {})

    def test_every_reason_the_engine_can_give_has_a_label(self):
        for reason in ("eligible", "not_due", "max_reached", "resolved", "quiet_hours", "disabled"):
            self.assertTrue(REASONS.get(reason), reason)

    def test_an_event_notification_watches_no_records(self):
        out = NotificationReminderService.eligibility("request_received")

        self.assertEqual(out["rows"], [])
        self.assertEqual(out["total"], 0)


class TestACopiedAddressIsOwedOneMailPerIteration(RequestCase):
    """A reminder is addressed to an audience; a copy rides on that message.

    One iteration is one business event, so however many people the rule is addressed to,
    an address configured in copy is owed one mail and not one per person.
    """

    def policies(self, rule_key, *rows):
        from nexgen_msp.api.internal.services.notification_settings_service import (
            NotificationSettingsService,
        )

        NotificationSettingsService.save(rule_key, changes={"recipients": list(rows)})
        frappe.db.commit()

    def desk(self, suffix):
        """An internal alias with no account of its own — a rota, a shared mailbox.

        Deliberately not a team account: the team is this reminder's own audience, so a
        colleague named as a copy is deduplicated onto the To channel and there is no copy
        left to observe. An alias is both permitted and outside the audience.
        """
        return f"{PREFIX.lower()}.{suffix}{self.tag}@example.invalid"

    def staff(self, suffix):
        return self.make_account("internal", "MSP Technician", suffix=f"{suffix}{self.tag[:3]}")

    def test_one_copy_however_many_people_are_written_to_directly(self):
        name = self.submitted()
        copied = self.desk("cp")
        self.configure(WAITING)
        self.policies(
            WAITING, {"channel": "CC", "recipient_source": None, "fixed_address": copied, "enabled": True}
        )

        with self.only(name):
            out = NotificationReminderService.run_one(WAITING)

        direct = frappe.get_all(
            DISPATCH,
            filters={"business_name": name, "rule": WAITING, "channel": "To"},
            pluck="recipient",
        )

        self.assertGreater(len(direct), 1, "the rule is addressed to more than one person")
        self.assertEqual(out["sent"], len(direct))
        self.assertNotIn(copied, direct, "the alias is a copy and not an audience member")
        self.assertEqual(self.queued_to(copied), 1)

    def test_a_blind_copy_is_owed_one_mail_as_well(self):
        name = self.submitted()
        hidden = self.desk("bp")
        self.configure(WAITING)
        self.policies(
            WAITING, {"channel": "BCC", "recipient_source": None, "fixed_address": hidden, "enabled": True}
        )

        with self.only(name):
            NotificationReminderService.run_one(WAITING)

        self.assertEqual(self.queued_to(hidden), 1)

    def test_a_copy_added_after_the_mail_went_is_not_recorded_against_it(self):
        """A send that already happened carried what was configured then, not what is now.

        Writing today's copy against yesterday's queue entry would report a delivery to
        somebody who was never on that message.
        """
        name = self.submitted()
        self.configure(WAITING)

        with self.only(name):
            NotificationReminderService.run_one(WAITING)

        late = self.desk("la")
        self.policies(
            WAITING, {"channel": "CC", "recipient_source": None, "fixed_address": late, "enabled": True}
        )

        with self.only(name):
            NotificationReminderService.run_one(WAITING)

        self.assertEqual(self.queued_to(late), 0, "nothing was sent to them")
        self.assertFalse(
            frappe.db.exists(
                DISPATCH, {"business_name": name, "rule": WAITING, "recipient": late}
            ),
            "and nothing claims they were reached",
        )

    def test_running_the_rule_again_sends_the_copy_nothing_more(self):
        name = self.submitted()
        copied = self.desk("cr")
        self.configure(WAITING)
        self.policies(
            WAITING, {"channel": "CC", "recipient_source": None, "fixed_address": copied, "enabled": True}
        )

        with self.only(name):
            NotificationReminderService.run_one(WAITING)
            NotificationReminderService.run_one(WAITING)

        self.assertEqual(self.queued_to(copied), 1)

    def test_a_rule_with_copies_and_nobody_to_address_sends_nothing_and_says_so(self):
        name = self.awaiting()
        copied = self.desk("cn")
        # the approval reminder is addressed to the approvers of the request; with none
        # named there is no message for a copy to ride on
        self.configure(APPROVAL)
        self.policies(
            APPROVAL, {"channel": "CC", "recipient_source": None, "fixed_address": copied, "enabled": True}
        )

        # the audience resolves to nobody on this record, so there is no message for the
        # copy to ride on. Stated outright rather than arranged through the authority
        # matrix, because what is being tested is the engine and not who may approve
        with self.only(name), patch.object(registry, "resolve_audience", return_value=[]):
            NotificationReminderService.run_one(APPROVAL)

        self.assertEqual(self.queued_to(copied), 0)
        reasons = [row.reason_code for row in self.audits(APPROVAL, business_name=name)]
        self.assertIn("no_recipient", reasons)

    def test_an_unconfirmed_first_send_does_not_hand_the_copy_on_to_the_next(self):
        """An Unknown outcome does not prove the queue was never reached.

        The mail may be sitting in it. Carrying the copies on to the next direct recipient
        would be the one message this iteration owes them, sent twice.
        """
        name = self.submitted()
        copied = self.desk("cu")
        self.configure(WAITING)
        self.policies(
            WAITING, {"channel": "CC", "recipient_source": None, "fixed_address": copied, "enabled": True}
        )
        real = frappe.sendmail
        calls = {"n": 0}

        def unsure(*args, **kwargs):
            calls["n"] += 1

            if calls["n"] == 1:
                raise RuntimeError("the queue answered nothing")

            return real(*args, **kwargs)

        with self.only(name), patch.object(frappe, "sendmail", side_effect=unsure):
            NotificationReminderService.run_one(WAITING)

        self.assertGreater(calls["n"], 1, "a second direct recipient was written to")
        self.assertEqual(self.queued_to(copied), 0)

    def test_a_mail_that_reached_the_queue_before_the_failure_leaves_the_copy_on_record(self):
        """The ambiguous case: the queue took the message, then the send raised anyway.

        Nobody can say whether it went. The copies must not be handed to the next
        recipient, and must not read as delivered either — but they have to be on the
        record, or an administrator reconciling the attempt sees only the direct address
        and has no idea anybody else was on it.
        """
        name = self.submitted()
        copied = self.desk("cq")
        hidden = self.desk("hq")
        self.configure(WAITING)
        self.policies(
            WAITING,
            {"channel": "CC", "recipient_source": None, "fixed_address": copied, "enabled": True},
            {"channel": "BCC", "recipient_source": None, "fixed_address": hidden, "enabled": True},
        )
        real = frappe.sendmail
        calls = {"n": 0}

        def queued_then_unsure(*args, **kwargs):
            calls["n"] += 1
            queued = real(*args, **kwargs)

            if calls["n"] == 1:
                # the message is in the queue; what comes back says nothing about it
                raise RuntimeError("the queue took it and then said nothing")

            return queued

        with self.only(name), patch.object(frappe, "sendmail", side_effect=queued_then_unsure):
            NotificationReminderService.run_one(WAITING)

        rows = {
            row.recipient: row
            for row in frappe.get_all(
                DISPATCH,
                filters={"business_name": name, "rule": WAITING},
                fields=["recipient", "channel", "status", "email_queue_id", "bcc_snapshot"],
            )
        }

        for address, channel in ((copied, "CC"), (hidden, "BCC")):
            with self.subTest(address=address):
                self.assertIn(address, rows, "the copy is on the record")
                self.assertEqual(rows[address].channel, channel)
                self.assertEqual(rows[address].status, "Unknown", "and not claimed as sent")
                self.assertIsNone(rows[address].email_queue_id)

        # the copies stopped at the uncertain attempt rather than riding the next one
        self.assertEqual(self.queued_to(copied), 1)
        self.assertEqual(self.queued_to(hidden), 1)

    def test_the_addresses_an_attempt_meant_to_reach_are_on_its_own_row(self):
        name = self.submitted()
        copied = self.desk("sq")
        hidden = self.desk("sh")
        self.configure(WAITING)
        self.policies(
            WAITING,
            {"channel": "CC", "recipient_source": None, "fixed_address": copied, "enabled": True},
            {"channel": "BCC", "recipient_source": None, "fixed_address": hidden, "enabled": True},
        )

        with self.only(name):
            NotificationReminderService.run_one(WAITING)

        carried = frappe.get_all(
            DISPATCH,
            filters={"business_name": name, "rule": WAITING, "channel": "To"},
            fields=["cc_snapshot", "bcc_snapshot"],
        )
        bearing = [row for row in carried if copied in (row.cc_snapshot or "")]

        self.assertEqual(len(bearing), 1, "one direct message carried the copies")
        self.assertIn(hidden, bearing[0].bcc_snapshot or "")

    def test_each_copied_address_gets_its_own_line_against_the_one_mail(self):
        name = self.submitted()
        copied = self.desk("cl")
        hidden = self.desk("hl")
        self.configure(WAITING)
        self.policies(
            WAITING,
            {"channel": "CC", "recipient_source": None, "fixed_address": copied, "enabled": True},
            {"channel": "BCC", "recipient_source": None, "fixed_address": hidden, "enabled": True},
        )

        with self.only(name):
            NotificationReminderService.run_one(WAITING)

        rows = {
            row.recipient: row
            for row in frappe.get_all(
                DISPATCH,
                filters={"business_name": name, "rule": WAITING},
                fields=["recipient", "channel", "status", "email_queue_id", "reminder_iteration"],
            )
        }

        self.assertIn(copied, rows)
        self.assertIn(hidden, rows)
        self.assertEqual(rows[copied].channel, "CC")
        self.assertEqual(rows[hidden].channel, "BCC")
        self.assertEqual(rows[copied].status, "Queued")
        self.assertEqual(rows[copied].reminder_iteration, 1)
        direct = [row for address, row in rows.items() if row.channel == "To"]
        self.assertTrue(direct)
        self.assertIn(rows[copied].email_queue_id, {row.email_queue_id for row in direct})

    def test_a_copy_written_in_somebody_elses_language_says_so(self):
        # the approval reminder is addressed to the company's approvers, so one of our own
        # accounts is a copy here and nothing else
        name = self.awaiting()
        copied = self.staff("cf")
        frappe.db.set_value("User", copied, "language", "fr", update_modified=False)
        frappe.db.commit()
        self.configure(APPROVAL)
        self.policies(
            APPROVAL, {"channel": "CC", "recipient_source": None, "fixed_address": copied, "enabled": True}
        )

        with self.only(name):
            NotificationReminderService.run_one(APPROVAL)

        row = frappe.db.get_value(
            DISPATCH,
            {"business_name": name, "rule": APPROVAL, "recipient": copied},
            ["channel", "language_source", "fallback_reason"],
            as_dict=True,
        )

        self.assertEqual(row.channel, "CC")
        self.assertEqual(row.language_source, "account")
        self.assertEqual(row.fallback_reason, "shared_message")

