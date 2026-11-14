"""Every mail a request sends: on which action, to whom, and when nothing must leave."""

import frappe

from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import notifications, reminders

from .writer_case import REQUEST, WriterCase


class MailCase(WriterCase):
    """The writer's company, plus a requester who cannot approve and an approver who can."""

    def setUp(self):
        super().setUp()
        self.tech = self.make_account("internal", "MSP Technician", suffix=f"mt{self.tag[:3]}")
        self.asker = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"ma{self.tag[:3]}"
        )
        self.approver = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"mp{self.tag[:3]}"
        )
        self.grant(self.asker, can_submit=1, can_approve=0)
        self.grant(self.approver, can_submit=1, can_approve=1)
        self.sent = []
        self.real_send = notifications.send
        notifications.send = self.record

    def tearDown(self):
        notifications.send = self.real_send
        super().tearDown()

    def record(self, template, recipients, context, **kwargs):
        """Keep what would have been mailed, and still render it so a broken template fails here."""
        subject, message = notifications.render(template, context)
        self.sent.append(
            {
                "template": template,
                "to": sorted(recipients or []),
                "subject": subject,
                "message": message,
                "reference": kwargs.get("reference_name"),
            }
        )

        return True

    def mails(self, template):
        return [row for row in self.sent if row["template"] == template]

    def due_now(self, rule_key):
        """Configure a reminder the way an administrator would to have it owed at once.

        The engine answers to the settings, so a test about a reminder has to set them.
        Nothing is owed before the rule says so, which is the point of the boundary, and a
        test that did not move it would be testing the boundary rather than the reminder.
        """
        from nexgen_msp.api.internal.services.notification_settings_service import (
            NotificationSettingsService,
        )

        NotificationSettingsService.save(
            rule_key,
            changes={
                "enabled": 1,
                "initial_delay_value": 0,
                "initial_delay_unit": "Hours",
                "repeat_interval_value": 1,
                "repeat_interval_unit": "Hours",
                "max_sends": 3,
            },
        )
        frappe.db.set_value(
            "MSP Notification Rule",
            rule_key,
            "schedule_effective_at",
            frappe.utils.add_to_date(frappe.utils.now(), hours=-1),
            update_modified=False,
        )
        frappe.db.commit()

    def queued(self, subject_fragment, reference=None):
        """The mails really handed to Frappe's queue, which is where reminders now go.

        Reminders are sent through the dispatch records that make one impossible to send
        twice, so they no longer pass the seam this case patches. Reading the queue instead
        tests the path that actually runs.
        """
        rows = frappe.get_all(
            "Email Queue",
            filters={"status": ("in", ("Not Sent", "Sending", "Sent"))},
            fields=["name", "message", "reference_name"],
            order_by="creation desc",
            limit=50,
        )
        out = []

        for row in rows:
            if reference and row.reference_name != reference:
                continue

            if subject_fragment not in (row.message or ""):
                continue

            out.append(
                {
                    "message": row.message,
                    "reference": row.reference_name,
                    "to": sorted(
                        frappe.get_all(
                            "Email Queue Recipient",
                            filters={"parent": row.name},
                            pluck="recipient",
                        )
                    ),
                }
            )

        return out

    def addressed(self, template):
        return sorted({address for row in self.mails(template) for address in row["to"]})

    def raise_as(self, user, payload=None):
        out = self.as_user(
            user,
            lambda: PortalService.create_request(customer=self.customer, **(payload or self.scenario())),
        )
        self.track(REQUEST, out["name"])

        return out["name"]

    def carry_out(self, name):
        """Start the work, accept every line and approve it, through the real services."""
        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="start_review"))

        for row in frappe.get_doc(REQUEST, name).lines:
            self.as_user(
                self.tech,
                lambda idx=row.idx: RequestService.set_line_status(
                    name=name, idx=idx, line_status="Approved"
                ),
            )

        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="approve"))

        orders = frappe.get_all(
            "MSP Work Order", filters={"request": name, "status": "Open"}, pluck="name"
        )
        out = self.as_user(
            self.tech,
            lambda: RequestExecutionService.execute_work_orders(
                request=name,
                executions=[
                    {"work_order": order, "inputs": {"username": f"zztest.{self.tag[:4]}"}}
                    for order in orders
                ],
            ),
        )

        self.assertEqual(out["failed"], 0, out["results"])

    def simple(self):
        """One existing person, one service: the shape of a mail test, not of the writer."""
        helen = self.existing(self.helen)

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


class TestTheMailsARequestSends(MailCase):
    def test_a_request_needing_an_accord_reaches_its_approver_and_not_our_team(self):
        name = self.raise_as(self.asker, self.simple())

        self.assertEqual(
            frappe.db.get_value(REQUEST, name, "status"), "Awaiting Customer Approval"
        )
        self.assertIn(self.approver, self.addressed("MSP Request Awaiting Approval"))
        self.assertNotIn(self.asker, self.addressed("MSP Request Awaiting Approval"))
        self.assertIn("needs your approval", self.mails("MSP Request Awaiting Approval")[0]["subject"])
        self.assertFalse(self.mails("MSP Request For Our Team"), "not ours until they agree")
        self.assertFalse(self.mails("MSP Request Received"))

    def test_the_approver_accepting_tells_the_requester_and_our_team(self):
        name = self.raise_as(self.asker, self.simple())
        self.sent.clear()

        self.as_user(self.approver, lambda: PortalService.approve_request(name=name))

        self.assertEqual(self.addressed("MSP Request Approved By Customer"), [self.asker])
        self.assertIn(self.tech, self.addressed("MSP Request For Our Team"))
        self.assertNotIn(self.asker, self.addressed("MSP Request For Our Team"))
        self.assertEqual(
            {row["reference"] for row in self.sent}, {name}, "every mail points at the request"
        )

    def test_the_approver_refusing_tells_the_requester_with_the_reason_and_nobody_else(self):
        name = self.raise_as(self.asker, self.simple())
        self.sent.clear()

        self.as_user(
            self.approver,
            lambda: PortalService.reject_request(name=name, reason="Not this quarter"),
        )

        decision = self.mails("MSP Request Decision")
        self.assertEqual([row["to"] for row in decision], [[self.asker]])
        self.assertIn("Not this quarter", decision[0]["message"])
        self.assertIn("refused", decision[0]["subject"])
        self.assertFalse(self.mails("MSP Request For Our Team"), "a refusal never reaches us")

    def test_a_request_sent_by_somebody_who_may_approve_reaches_our_team_at_once(self):
        self.raise_as(self.approver, self.simple())

        self.assertEqual(self.addressed("MSP Request Received"), [self.approver])
        self.assertIn(self.tech, self.addressed("MSP Request For Our Team"))
        self.assertFalse(self.mails("MSP Request Awaiting Approval"))

    def test_completing_the_work_tells_the_customer(self):
        name = self.raise_as(self.approver, self.simple())
        self.carry_out(name)
        self.sent.clear()

        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="complete"))

        completed = self.mails("MSP Request Completed")
        self.assertTrue(completed)
        self.assertIn(self.approver, self.addressed("MSP Request Completed"))
        self.assertNotIn(self.tech, self.addressed("MSP Request Completed"))
        self.assertIn("completed", completed[0]["subject"])

    def test_our_refusal_tells_the_customer_why(self):
        name = self.raise_as(self.approver, self.simple())
        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="start_review"))
        self.sent.clear()

        self.as_user(
            self.tech,
            lambda: RequestService.run_action(name=name, action="reject", reason="Out of contract"),
        )

        decision = self.mails("MSP Request Decision")
        self.assertIn(self.approver, self.addressed("MSP Request Decision"))
        self.assertIn("Out of contract", decision[0]["message"])


class TestAModificationIsAnnounced(MailCase):
    def modify(self, name, user):
        payload = self.payload_of(self.as_user(user, lambda: PortalService.get_request(name)))
        payload["priority"] = "Low"

        return self.as_user(user, lambda: PortalService.update_request(name=name, **payload))

    def test_modifying_a_request_still_awaiting_approval_tells_its_approver(self):
        name = self.raise_as(self.asker, self.simple())
        self.sent.clear()

        self.modify(name, self.asker)

        self.assertIn(self.approver, self.addressed("MSP Request Modified"))
        self.assertNotIn(self.tech, self.addressed("MSP Request Modified"))
        self.assertIn("was modified", self.mails("MSP Request Modified")[0]["subject"])
        self.assertEqual(
            frappe.db.get_value(REQUEST, name, "status"),
            "Awaiting Customer Approval",
            "the mail says it changed, not that it moved on",
        )

    def test_modifying_a_request_already_with_us_tells_our_team(self):
        name = self.raise_as(self.approver, self.simple())
        self.sent.clear()

        self.modify(name, self.approver)

        self.assertIn(self.tech, self.addressed("MSP Request Modified"))
        self.assertNotIn(self.approver, self.addressed("MSP Request Modified"))
        self.assertEqual(frappe.db.get_value(REQUEST, name, "status"), "Submitted")

    def test_the_person_making_the_change_is_never_mailed_about_it(self):
        name = self.raise_as(self.approver, self.simple())
        self.sent.clear()

        self.modify(name, self.approver)

        for row in self.mails("MSP Request Modified"):
            self.assertNotIn(self.approver, row["to"])


class TestTheTechnicianMailsFrameTheRequest(MailCase):
    def test_the_team_mail_names_the_company_the_day_the_acts_and_what_is_to_be_created(self):
        self.raise_as(self.approver, self.scenario())

        mail = self.mails("MSP Request For Our Team")[0]

        self.assertIn(self.customer, mail["subject"], "the company is read before opening it")
        self.assertIn("What is asked", mail["message"])
        self.assertIn("Wanted for", mail["message"])
        self.assertIn("Priority", mail["message"])
        self.assertIn("To create first", mail["message"], "a newcomer and a machine are the slow part")
        self.assertIn("person", mail["message"])
        self.assertIn("machine", mail["message"])

    def test_the_acts_are_listed_as_the_customer_grouped_them(self):
        self.raise_as(self.approver, self.scenario())

        mail = self.mails("MSP Request For Our Team")[0]

        for group in frappe.get_doc(REQUEST, mail["reference"]).action_groups:
            self.assertIn(group.operation_label_snapshot, mail["message"], group.group_key)

        self.assertEqual(mail["message"].count("<li"), 4, "one line per act, and no empty act")

    def test_a_request_with_nothing_to_create_says_so_by_leaving_the_line_out(self):
        self.raise_as(self.approver, self.simple())

        mail = self.mails("MSP Request For Our Team")[0]

        self.assertNotIn("To create first", mail["message"])
        self.assertIn("What is asked", mail["message"])

    def test_the_note_the_customer_wrote_travels_with_it(self):
        payload = self.simple()
        payload["details"] = "They start on Monday."
        self.raise_as(self.approver, payload)

        self.assertIn("They start on Monday.", self.mails("MSP Request For Our Team")[0]["message"])


class TestTheConfiguredReminders(MailCase):
    """What a reminder says, now that when it is said is the administrator's to set.

    The two conditions are the ones this application has always reminded about. What the
    engine changed is that the cadence is configured, finite, and recorded — so a test
    about the wording sets the cadence first and reads the queue the engine really used.
    """

    def test_a_request_waiting_for_its_company_is_pointed_out_to_the_approver(self):
        name = self.raise_as(self.asker, self.simple())
        self.due_now("request_approval_pending")

        outcome = reminders.every_three_hours()

        reminded = self.queued("still needs your approval", reference=name)
        self.assertTrue(reminded, f"nothing was queued: {outcome}")
        self.assertIn(self.approver, {address for row in reminded for address in row["to"]})
        self.assertGreaterEqual(outcome["sent"], 1)

    def test_a_request_waiting_on_us_is_pointed_out_to_our_team(self):
        name = self.raise_as(self.approver, self.simple())
        self.due_now("request_waiting_internal")

        outcome = reminders.every_three_hours()

        reminded = self.queued("Wanted for", reference=name)
        self.assertTrue(reminded, f"nothing was queued: {outcome}")
        self.assertIn(self.tech, {address for row in reminded for address in row["to"]})
        self.assertIn("What is asked", reminded[0]["message"])

    def test_the_old_entry_point_still_reaches_the_engine(self):
        """A deployed site may still hold a scheduled job naming the three-hourly call."""
        self.assertEqual(
            sorted(reminders.every_three_hours()), ["sent", "skipped"]
        )

    def test_a_request_somebody_has_started_is_never_reminded_about(self):
        name = self.raise_as(self.approver, self.simple())
        self.as_user(self.tech, lambda: RequestService.run_action(name=name, action="start_review"))
        self.sent.clear()

        reminders.every_three_hours()

        self.assertFalse([row for row in self.sent if row["reference"] == name])

    def test_a_request_the_company_refused_is_never_reminded_about(self):
        name = self.raise_as(self.asker, self.simple())
        self.as_user(self.approver, lambda: PortalService.reject_request(name=name, reason="No"))
        self.sent.clear()

        reminders.every_three_hours()

        self.assertFalse([row for row in self.sent if row["reference"] == name])

    def test_the_reminders_are_polled_every_ten_minutes_while_each_rule_keeps_its_own_cadence(self):
        from nexgen_msp import hooks
        from nexgen_msp.api.internal.services import notification_registry as registry

        self.assertEqual(
            hooks.scheduler_events["cron"]["*/10 * * * *"],
            ["nexgen_msp.utils.reminders.tick"],
        )
        self.assertNotIn("0 */3 * * *", hooks.scheduler_events["cron"])
        self.assertEqual(list(hooks.scheduler_events["cron"]), ["*/10 * * * *"])

        for key in registry.keys(registry.REMINDER):
            suggested = registry.rule(key)["suggested"]
            interval = suggested["repeat_interval_value"] * {"Hours": 1, "Days": 24, "Weeks": 168}[
                suggested["repeat_interval_unit"]
            ]

            self.assertGreater(interval, 1, f"{key} is not reminded at the polling frequency")


class TestEveryTemplateRenders(MailCase):
    def test_every_template_this_app_sends_exists_and_renders(self):
        notifications.ensure_templates()

        for name in notifications.TEMPLATES:
            self.assertTrue(frappe.db.exists("Email Template", name), name)
            subject, message = notifications.render(
                name,
                {
                    "full_name": "Marie",
                    "request": "SR-0001",
                    "customer": self.customer,
                    "raised_by": "Marie",
                    "approver": "Paul",
                    "modified_by": "Paul",
                    "outcome": "approved",
                    "headline": "Reviewed.",
                    "reason_block": "",
                    "summary": "",
                    "waiting_since": "today",
                    "acts": "",
                    "link": "https://example.invalid/msp",
                    "role": "MSP Technician",
                    "missing": "nobody may approve",
                    "accounts": "2",
                    "invoice": "INV-1",
                    "period": "Q3",
                    "reason": "-",
                },
            )

            self.assertTrue(subject.strip(), name)
            self.assertNotIn("{{", subject, name)
            self.assertNotIn("{{", message, name)
            self.assertIn("Nexgen MSP", message, name)
