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


class TestTheThreeHourlyReminders(MailCase):
    def test_a_request_waiting_for_its_company_is_pointed_out_to_the_approver(self):
        name = self.raise_as(self.asker, self.simple())
        self.sent.clear()

        counts = reminders.every_three_hours()

        reminded = [row for row in self.mails("MSP Request Approval Reminder") if row["reference"] == name]
        self.assertTrue(reminded)
        self.assertIn(self.approver, {address for row in reminded for address in row["to"]})
        self.assertIn("still needs your approval", reminded[0]["subject"])
        self.assertGreaterEqual(counts["approvals"], 1)

    def test_a_request_waiting_on_us_is_pointed_out_to_our_team(self):
        name = self.raise_as(self.approver, self.simple())
        self.sent.clear()

        reminders.every_three_hours()

        reminded = [row for row in self.mails("MSP Request Waiting Reminder") if row["reference"] == name]
        self.assertTrue(reminded)
        self.assertIn(self.tech, {address for row in reminded for address in row["to"]})
        self.assertIn(self.customer, reminded[0]["subject"], "the subject frames it at a glance")
        self.assertIn("Wanted for", reminded[0]["message"])
        self.assertIn("What is asked", reminded[0]["message"])

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

    def test_the_reminder_is_registered_to_run_every_three_hours(self):
        from nexgen_msp import hooks

        self.assertEqual(
            hooks.scheduler_events["cron"]["0 */3 * * *"],
            ["nexgen_msp.utils.reminders.every_three_hours"],
        )


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
