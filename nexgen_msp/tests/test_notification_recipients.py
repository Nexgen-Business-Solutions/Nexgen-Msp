"""Who a notification reaches, and everybody it must not.

The interesting cases here are all failures of containment rather than failures of
delivery: an address copied onto a company's business that belongs to another company, a
blind copy that turns out not to be blind, a reset link redirected to somebody helpful.
"""

from unittest.mock import patch

import frappe

from nexgen_msp.api.internal.services import notification_registry as registry
from nexgen_msp.api.internal.services.notification_recipient_policy_service import (
    NotificationRecipientPolicyService,
)
from nexgen_msp.api.internal.services.notification_settings_service import (
    NotificationSettingsService,
)
from nexgen_msp.utils import access, notifications
from nexgen_msp.utils.errors import ValidationError

from .base import PREFIX
from .test_notification_settings import NotificationCase

RULE = "request_received"
REFERENCE = "MSP Request"


class PolicyCase(NotificationCase):
    """The rules' own recipient tables are restored by NotificationCase, rows and all."""

    def policy(self, channel, source=None, address=None, enabled=True):
        return {
            "channel": channel,
            "recipient_source": source,
            "fixed_address": address,
            "enabled": enabled,
        }

    def configure(self, *policies, rule_key=RULE):
        return NotificationSettingsService.save(rule_key, changes={"recipients": list(policies)})

    def stored_policies(self, rule_key=RULE):
        return NotificationRecipientPolicyService.policies(rule_key)["rows"]

    def resolved(self, recipients, cc=None, reference=None, customer=None, rule_key=RULE):
        return NotificationRecipientPolicyService.resolve(
            rule_key,
            recipients,
            cc=cc,
            business_doctype=REFERENCE if reference else None,
            business_name=reference,
            customer=customer,
        )

    def reasons(self, skipped):
        return {entry["target"]: entry["reason"] for entry in skipped}

    def mailbox(self, suffix):
        """One of our own mailboxes, the only kind a fixed copy may name."""
        return self.make_account("internal", "MSP Technician", suffix=f"{suffix}{self.tag[:3]}")


class TestWhatMayBeConfigured(PolicyCase):
    def test_the_three_channels_are_offered(self):
        self.assertEqual(
            NotificationRecipientPolicyService.choices(RULE)["channels"], ["To", "CC", "BCC"]
        )

    def test_a_channel_that_is_not_one_is_refused(self):
        with self.assertRaises(ValidationError):
            self.configure(self.policy("Reply-To", address="x@example.invalid"))

    def test_a_policy_names_either_an_address_or_a_source_and_not_both(self):
        for attempt in (
            self.policy("CC", source="internal", address="x@example.invalid"),
            self.policy("CC"),
        ):
            with self.subTest(attempt=attempt):
                with self.assertRaises(ValidationError):
                    self.configure(attempt)

    def test_an_address_that_is_not_one_is_refused(self):
        with self.assertRaises(ValidationError) as refused:
            self.configure(self.policy("CC", address="not-an-address"))

        self.assertIn("not-an-address", refused.exception.args[0])

    def test_a_mailbox_with_no_account_of_its_own_is_accepted(self):
        desk = f"{PREFIX.lower()}.rota{self.tag}@example.invalid"

        self.configure(self.policy("CC", address=desk))

        self.assertEqual(self.stored_policies()[0]["fixed_address"], desk)

    def test_a_customers_own_contact_cannot_be_named_as_a_fixed_copy(self):
        self.customer = self.make_customer(f"RF{self.tag[:4]}")
        contact = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"rf{self.tag[:3]}"
        )

        with self.assertRaises(ValidationError):
            self.configure(self.policy("CC", address=contact))

    def test_one_of_our_own_mailboxes_is_accepted(self):
        desk = self.mailbox("rk")

        self.configure(self.policy("CC", address=desk))

        self.assertEqual(self.stored_policies()[0]["fixed_address"], desk)

    def test_a_source_this_notification_cannot_be_copied_to_is_refused(self):
        with self.assertRaises(ValidationError) as refused:
            self.configure(self.policy("CC", source="account_holder"))

        self.assertIn("account_holder", refused.exception.args[0])

    def test_no_rule_offers_an_assigned_technician_because_nothing_assigns_one(self):
        for rule_key in registry.RULES:
            with self.subTest(rule=rule_key):
                self.assertNotIn(
                    "assigned_technician", registry.copy_sources(rule_key)
                )

    def test_an_invoice_notice_cannot_be_copied_to_a_requests_audience(self):
        self.assertNotIn("approvers", registry.copy_sources("invoice_issued"))
        self.assertIn("billing_contact", registry.copy_sources("invoice_issued"))

    def test_a_notification_raised_without_a_record_offers_only_our_own_team(self):
        self.assertEqual(registry.copy_sources("authority_gap"), ("internal",))

    def test_what_was_configured_is_what_is_read_back(self):
        ops = self.mailbox("ro")
        desk = self.mailbox("rd")
        self.configure(
            self.policy("CC", address=ops),
            self.policy("BCC", source="internal"),
            self.policy("To", address=desk, enabled=False),
        )
        rows = self.stored_policies()

        self.assertEqual(
            [(row["channel"], row["recipient_source"], row["fixed_address"], row["enabled"]) for row in rows],
            [
                ("CC", None, ops, True),
                ("BCC", "internal", None, True),
                ("To", None, desk, False),
            ],
        )
        self.assertEqual(rows[1]["recipient_source_label"], "MSP internal team")


class TestAProtectedNotificationIsNeverRedirected(PolicyCase):
    PROTECTED = ("password_reset", "portal_invitation", "team_invitation")

    def test_a_policy_cannot_be_configured_on_one(self):
        for rule_key in self.PROTECTED:
            with self.subTest(rule=rule_key):
                with self.assertRaises(ValidationError) as refused:
                    self.configure(
                        self.policy("BCC", address="elsewhere@example.invalid"), rule_key=rule_key
                    )

                self.assertEqual(refused.exception.http_status_code, 403)

    def test_none_of_them_offers_a_source_either(self):
        for rule_key in self.PROTECTED:
            with self.subTest(rule=rule_key):
                self.assertEqual(registry.copy_sources(rule_key), ())

    def test_a_copy_the_caller_passes_is_dropped_at_the_point_of_sending(self):
        holder = f"{PREFIX.lower()}.holder{self.tag}@example.invalid"
        resolved = self.resolved([holder], cc=["elsewhere@example.invalid"], rule_key="password_reset")

        self.assertEqual(resolved["to"], [holder])
        self.assertEqual(resolved["cc"], [])
        self.assertEqual(resolved["bcc"], [])
        self.assertEqual(
            self.reasons(resolved["skipped"])["elsewhere@example.invalid"],
            "protected_notification",
        )

    def test_the_reset_mail_still_reaches_only_the_account_holder(self):
        holder = f"{PREFIX.lower()}.reset{self.tag}@example.invalid"

        notifications.send(
            "MSP Password Reset",
            [holder],
            {"full_name": PREFIX, "link": "https://example.invalid/reset"},
            cc=["elsewhere@example.invalid"],
        )

        queued = frappe.db.sql_list(
            "select distinct parent from `tabEmail Queue Recipient` where recipient = %s", holder
        )
        self.assertTrue(queued)

        for parent in queued:
            written = set(
                frappe.get_all("Email Queue Recipient", filters={"parent": parent}, pluck="recipient")
            )
            self.assertEqual(written, {holder})
            frappe.db.sql("delete from `tabEmail Queue Recipient` where parent = %s", parent)
            frappe.db.sql("delete from `tabEmail Queue` where name = %s", parent)

        frappe.db.commit()


class TestAnAddressStaysOnTheMostOpenChannelItIsOn(PolicyCase):
    def test_an_address_both_written_to_and_copied_is_only_written_to(self):
        shared = f"{PREFIX.lower()}.both{self.tag}@example.invalid"
        resolved = self.resolved([shared], cc=[shared])

        self.assertEqual(resolved["to"], [shared])
        self.assertEqual(resolved["cc"], [])
        self.assertEqual(self.reasons(resolved["skipped"])[shared], "already_addressed")

    def test_an_address_copied_and_blind_copied_is_only_copied(self):
        shared = self.mailbox("rc")
        self.configure(
            self.policy("CC", address=shared),
            self.policy("BCC", address=shared),
        )
        resolved = self.resolved([f"{PREFIX.lower()}.to{self.tag}@example.invalid"])

        self.assertEqual(resolved["cc"], [shared])
        self.assertEqual(resolved["bcc"], [])

    def test_the_same_address_twice_on_one_channel_is_written_once(self):
        twice = f"{PREFIX.lower()}.twice{self.tag}@example.invalid"
        resolved = self.resolved([twice, twice.upper(), f" {twice} "])

        self.assertEqual(resolved["to"], [twice])

    def test_the_precedence_is_stated_rather_than_left_to_be_guessed(self):
        self.assertIn("To, then CC, then BCC", NotificationRecipientPolicyService.choices(RULE)["precedence_note"])


class TestAnAddressIsCheckedBeforeItIsUsed(PolicyCase):
    def test_an_address_that_is_not_one_is_left_out_and_said_so(self):
        resolved = self.resolved([f"{PREFIX.lower()}.ok{self.tag}@example.invalid", "nonsense"])

        self.assertEqual(resolved["to"], [f"{PREFIX.lower()}.ok{self.tag}@example.invalid"])
        self.assertEqual(self.reasons(resolved["skipped"])["nonsense"], "invalid_address")

    def test_a_switched_off_policy_writes_to_nobody_and_says_why(self):
        off = self.mailbox("rv")
        self.configure(self.policy("CC", address=off, enabled=False))
        resolved = self.resolved([f"{PREFIX.lower()}.to{self.tag}@example.invalid"])

        self.assertEqual(resolved["cc"], [])
        self.assertEqual(self.reasons(resolved["skipped"])[off], "policy_disabled")

    def test_a_source_with_no_record_to_read_is_left_out_and_said_so(self):
        self.configure(self.policy("CC", source="approvers"))
        resolved = self.resolved([f"{PREFIX.lower()}.to{self.tag}@example.invalid"])

        self.assertEqual(resolved["cc"], [])
        self.assertEqual(self.reasons(resolved["skipped"])["approvers"], "no_record")

    def test_every_reason_a_copy_can_be_left_out_has_a_label(self):
        for code in (
            "policy_disabled",
            "unsupported_source",
            "not_permitted",
            "no_record",
            "invalid_address",
            "other_customer",
            "already_addressed",
            "protected_notification",
        ):
            with self.subTest(code=code):
                self.assertIn(code, registry.REASON_LABELS)
                self.assertNotEqual(registry.reason_label(code), registry.trigger_label(code))


class TestNobodyIsToldAboutAnotherCompanysBusiness(PolicyCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer(f"RA{self.tag[:4]}")
        self.other = self.make_customer(f"RB{self.tag[:4]}")
        self.ours = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"ra{self.tag[:3]}"
        )
        self.theirs = self.make_account(
            "customer", "MSP Customer Manager", self.other, suffix=f"rb{self.tag[:3]}"
        )
        self.technician = self.make_account(
            "internal", "MSP Technician", suffix=f"rt{self.tag[:3]}"
        )

    def test_a_contact_of_another_company_is_left_out_and_said_so(self):
        resolved = self.resolved([self.ours, self.theirs], customer=self.customer)

        self.assertEqual(resolved["to"], [self.ours])
        self.assertEqual(self.reasons(resolved["skipped"])[self.theirs], "other_customer")

    def test_our_own_team_reaches_every_company_by_their_role(self):
        resolved = self.resolved([self.technician], customer=self.customer)

        self.assertEqual(resolved["to"], [self.technician])

    def test_one_of_our_own_mailboxes_may_be_copied_on_any_company(self):
        desk = self.mailbox("rm")
        self.configure(self.policy("CC", address=desk))
        resolved = self.resolved([self.ours], customer=self.customer)

        self.assertEqual(resolved["cc"], [desk])

    def test_a_contact_whose_company_links_were_never_set_up_reaches_none(self):
        unlinked = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"ru{self.tag[:3]}"
        )
        frappe.db.sql(
            "delete from `tabUser Permission` where user = %s and allow = 'Customer'", unlinked
        )
        frappe.db.commit()
        resolved = self.resolved([unlinked], customer=self.customer)

        self.assertEqual(resolved["to"], [])
        self.assertEqual(self.reasons(resolved["skipped"])[unlinked], "other_customer")

    def test_a_row_written_straight_into_the_database_reaches_no_send(self):
        doc = frappe.get_doc("MSP Notification Rule", RULE)
        doc.append("recipients", {"email": self.theirs, "kind": "BCC", "enabled": 1})
        doc.flags.ignore_validate = True
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        resolved = self.resolved([self.ours], customer=self.customer)

        self.assertEqual(resolved["bcc"], [])
        self.assertEqual(self.reasons(resolved["skipped"])[self.theirs], "not_permitted")

    def test_with_no_company_in_play_nothing_is_dropped_for_crossing_one(self):
        resolved = self.resolved([self.ours, self.theirs])

        self.assertEqual(resolved["to"], [self.ours, self.theirs])


class TestASourceIsResolvedFromTheRecordOnEverySend(PolicyCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer(f"RS{self.tag[:4]}")
        self.technician = self.make_account(
            "internal", "MSP Technician", suffix=f"rs{self.tag[:3]}"
        )
        self.request = self.reference("src")
        doc = frappe.new_doc(REFERENCE)
        doc.name = self.request
        doc.customer = self.customer
        doc.requester = self.technician
        doc.status = "Submitted"
        doc.flags.ignore_validate = True
        doc.flags.ignore_mandatory = True
        doc.insert(ignore_permissions=True, set_name=self.request)
        frappe.db.commit()

    def test_a_source_resolves_to_whoever_the_record_names_now(self):
        self.configure(self.policy("CC", source="requester"))
        resolved = self.resolved(
            [f"{PREFIX.lower()}.to{self.tag}@example.invalid"],
            reference=self.request,
            customer=self.customer,
        )

        self.assertEqual(resolved["cc"], [self.technician])

    def test_a_source_resolving_to_nobody_is_recorded_as_such(self):
        frappe.db.set_value(REFERENCE, self.request, "requester", None, update_modified=False)
        self.configure(self.policy("CC", source="requester"))
        resolved = self.resolved(
            [f"{PREFIX.lower()}.to{self.tag}@example.invalid"],
            reference=self.request,
            customer=self.customer,
        )

        self.assertEqual(resolved["cc"], [])
        self.assertEqual(self.reasons(resolved["skipped"])["requester"], "no_recipient")


class TestABlindCopyStaysBlind(PolicyCase):
    def setUp(self):
        super().setUp()
        self.reader = f"{PREFIX.lower()}.read{self.tag}@example.invalid"
        self.copied = self.mailbox("bc")
        self.hidden = self.mailbox("bh")
        self.configure(
            self.policy("CC", address=self.copied),
            self.policy("BCC", address=self.hidden),
        )

    def queued(self):
        return frappe.db.sql(
            """select distinct q.name, q.message, q.show_as_cc from `tabEmail Queue` q
            join `tabEmail Queue Recipient` r on r.parent = q.name
            where r.recipient = %s""",
            self.reader,
            as_dict=True,
        )

    def test_everybody_configured_is_written_to(self):
        notifications.send(
            "MSP Request Received",
            [self.reader],
            self.context(),
            reference_doctype=REFERENCE,
            reference_name=self.reference("blind"),
        )
        mails = self.queued()
        self.assertEqual(len(mails), 1)

        written = set(
            frappe.get_all(
                "Email Queue Recipient", filters={"parent": mails[0].name}, pluck="recipient"
            )
        )
        self.assertEqual(written, {self.reader, self.copied, self.hidden})

    def test_the_copied_address_is_in_the_headers_and_the_blind_one_is_not(self):
        notifications.send(
            "MSP Request Received",
            [self.reader],
            self.context(),
            reference_doctype=REFERENCE,
            reference_name=self.reference("headers"),
        )
        mails = self.queued()

        self.assertIn(self.copied, mails[0].message)
        self.assertNotIn(self.hidden, mails[0].message)
        self.assertIn(self.copied, mails[0].show_as_cc or "")
        self.assertNotIn(self.hidden, mails[0].show_as_cc or "")


class TestOnlyAnAdministratorMaySayWhoIsCopied(PolicyCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer(f"RP{self.tag[:4]}")
        self.admin = self.make_account("internal", "MSP System Admin", suffix=f"pa{self.tag[:3]}")
        self.technician = self.make_account(
            "internal", "MSP Technician", suffix=f"pt{self.tag[:3]}"
        )
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"pm{self.tag[:3]}"
        )

    def doors(self):
        return {
            "read": lambda: NotificationRecipientPolicyService.policies(RULE),
            "write": lambda: self.configure(self.policy("CC", address=self.admin)),
        }

    def test_an_administrator_is_let_through(self):
        for door, call in self.doors().items():
            with self.subTest(door=door):
                self.assertIsNotNone(self.as_user(self.admin, call))

    def test_a_technician_and_a_customer_manager_are_refused(self):
        for user in (self.technician, self.manager):
            for door, call in self.doors().items():
                with self.subTest(user=user, door=door):
                    with self.assertRaises(ValidationError) as refused:
                        self.as_user(user, call)

                    self.assertEqual(refused.exception.code, access.REFUSED)
                    self.assertEqual(refused.exception.http_status_code, 403)

    def test_a_refused_write_changes_nothing(self):
        with self.assertRaises(ValidationError):
            self.as_user(self.technician, self.doors()["write"])

        self.assertEqual(self.stored_policies(), [])


class TestAFailureToResolveTheCopiesDropsTheCopies(PolicyCase):
    """The one line that refuses to copy a password reset must not have a way around it.

    A failure here still writes to the audience the event is about — that was resolved
    from the record by the service that raised it — and sends no copies at all.
    """

    def broken(self):
        return patch.object(
            NotificationRecipientPolicyService,
            "resolve",
            side_effect=RuntimeError("the policy table is unreachable"),
        )

    def test_the_audience_is_still_written_to(self):
        holder = f"{PREFIX.lower()}.still{self.tag}@example.invalid"
        reference = self.reference("broken")

        with self.broken():
            notifications.send(
                "MSP Request Received",
                [holder],
                self.context(),
                reference_doctype=REFERENCE,
                reference_name=reference,
            )

        self.assertEqual(self.queued_to(holder), 1)

    def test_a_copy_the_caller_passed_is_not_sent(self):
        holder = f"{PREFIX.lower()}.held{self.tag}@example.invalid"
        copied = f"{PREFIX.lower()}.lost{self.tag}@example.invalid"
        reference = self.reference("dropped")

        with self.broken():
            notifications.send(
                "MSP Request Received",
                [holder],
                self.context(),
                reference_doctype=REFERENCE,
                reference_name=reference,
                cc=[copied],
            )

        self.assertEqual(self.queued_to(holder), 1)
        self.assertEqual(self.queued_to(copied), 0)

    def test_the_copies_that_were_dropped_are_recorded(self):
        holder = f"{PREFIX.lower()}.rec{self.tag}@example.invalid"
        copied = f"{PREFIX.lower()}.recl{self.tag}@example.invalid"
        reference = self.reference("recorded")

        with self.broken():
            notifications.send(
                "MSP Request Received",
                [holder],
                self.context(),
                reference_doctype=REFERENCE,
                reference_name=reference,
                cc=[copied],
            )

        reasons = [row.reason_code for row in self.audits(RULE, business_name=reference)]
        self.assertIn("policies_unavailable", reasons)


class TestEveryAddressAMailReachedHasItsOwnLine(PolicyCase):
    def setUp(self):
        super().setUp()
        self.reader = f"{PREFIX.lower()}.dr{self.tag}@example.invalid"
        self.copied = self.mailbox("dc")
        self.hidden = self.mailbox("dh")
        self.configure(
            self.policy("CC", address=self.copied),
            self.policy("BCC", address=self.hidden),
        )
        self.reference_name = self.reference("lines")
        notifications.send(
            "MSP Request Received",
            [self.reader],
            self.context(),
            reference_doctype=REFERENCE,
            reference_name=self.reference_name,
        )

    def rows(self):
        return {
            row.recipient: row
            for row in frappe.get_all(
                "MSP Notification Dispatch",
                filters={"business_name": self.reference_name},
                fields=["recipient", "channel", "status", "email_queue_id"],
            )
        }

    def test_the_direct_recipient_and_both_copies_each_have_a_line(self):
        self.assertEqual(set(self.rows()), {self.reader, self.copied, self.hidden})

    def test_each_line_names_the_channel_the_address_was_on(self):
        rows = self.rows()

        self.assertEqual(rows[self.reader].channel, "To")
        self.assertEqual(rows[self.copied].channel, "CC")
        self.assertEqual(rows[self.hidden].channel, "BCC")

    def test_all_three_point_at_the_one_mail_they_really_were(self):
        queues = {row.email_queue_id for row in self.rows().values()}

        self.assertEqual(len(queues), 1)
        self.assertTrue(all(row.status == "Queued" for row in self.rows().values()))


class TestEachAddressKeepsItsOwnLanguageDecision(PolicyCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer(f"RL{self.tag[:4]}")
        frappe.db.set_value("Customer", self.customer, "language", None, update_modified=False)

    def speaker(self, language, suffix):
        email = self.make_account("internal", "MSP Technician", suffix=f"{suffix}{self.tag[:3]}")
        frappe.db.set_value("User", email, "language", language, update_modified=False)
        self.refs[REFERENCE].add(email)

        return email

    def test_two_readers_of_one_language_keep_the_reason_each_of_them_had(self):
        from nexgen_msp.api.internal.services.notification_template_service import (
            NotificationTemplateService,
        )

        NotificationTemplateService.save_draft(
            "MSP Request Received",
            "en",
            subject=f"{PREFIX} en {{{{ request }}}}",
            html=f"<p>{PREFIX} en</p>",
        )
        NotificationTemplateService.publish("MSP Request Received", "en")
        chose = self.speaker("en", "lc")
        silent = self.speaker(None, "ls")
        reference = self.reference("lang")

        notifications.send(
            "MSP Request Received",
            [chose, silent],
            self.context(),
            reference_doctype=REFERENCE,
            reference_name=reference,
        )

        rows = {
            row.recipient: row
            for row in frappe.get_all(
                "MSP Notification Dispatch",
                filters={"business_name": reference},
                fields=["recipient", "resolved_locale", "language_source", "fallback_reason"],
            )
        }

        self.assertEqual(rows[chose].resolved_locale, "en")
        self.assertEqual(rows[silent].resolved_locale, "en")
        self.assertEqual(rows[chose].language_source, "account")
        self.assertIsNone(rows[chose].fallback_reason)
        self.assertEqual(rows[silent].language_source, "fallback")
        self.assertEqual(rows[silent].fallback_reason, "no_preference")

    def test_they_still_share_the_one_mail_they_both_read(self):
        chose = self.speaker("en", "sc")
        silent = self.speaker(None, "ss")
        reference = self.reference("share")

        notifications.send(
            "MSP Request Received",
            [chose, silent],
            self.context(),
            reference_doctype=REFERENCE,
            reference_name=reference,
        )

        queues = frappe.db.sql_list(
            """select distinct q.name from `tabEmail Queue` q
            join `tabEmail Queue Recipient` r on r.parent = q.name
            where r.recipient in (%s, %s)""",
            (chose, silent),
        )
        self.assertEqual(len(queues), 1)


class TestACustomersContactIsNotAFixedCopy(PolicyCase):
    """A contact is often deliberately not an account at all — the accountant who receives
    the invoices never signs in. Belonging therefore has to be read from the contact
    record, or the one kind of recipient this isolation exists for is the one kind it
    cannot see."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer(f"RC{self.tag[:4]}")
        self.other = self.make_customer(f"RD{self.tag[:4]}")
        self.accountant = self.contact(self.customer, "pay")

    def contact(self, customer, label):
        from nexgen_msp.api.internal.services.customer_service import CustomerService

        email = f"{PREFIX.lower()}.{label}{self.tag}@example.invalid"
        CustomerService.add_billing_contact(
            customer=customer, full_name=f"{PREFIX} {label}", email=email
        )
        frappe.db.commit()

        return email

    def test_the_contact_really_has_no_account(self):
        self.assertFalse(frappe.db.exists("User", self.accountant))

    def test_it_cannot_be_named_as_a_fixed_copy(self):
        with self.assertRaises(ValidationError) as refused:
            self.configure(self.policy("CC", address=self.accountant))

        self.assertIn("customer's own contact", refused.exception.args[0])

    def test_a_row_written_straight_into_the_database_reaches_no_send(self):
        doc = frappe.get_doc("MSP Notification Rule", RULE)
        doc.append("recipients", {"email": self.accountant, "kind": "CC", "enabled": 1})
        doc.flags.ignore_validate = True
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        resolved = self.resolved(
            [f"{PREFIX.lower()}.to{self.tag}@example.invalid"], customer=self.other
        )

        self.assertEqual(resolved["cc"], [])
        self.assertEqual(self.reasons(resolved["skipped"])[self.accountant], "not_permitted")

    def test_it_is_dropped_from_another_companys_mail_even_when_it_got_there(self):
        resolved = self.resolved([self.accountant], customer=self.other)

        self.assertEqual(resolved["to"], [])
        self.assertEqual(self.reasons(resolved["skipped"])[self.accountant], "other_customer")

    def test_it_still_reaches_its_own_companys_mail(self):
        resolved = self.resolved([self.accountant], customer=self.customer)

        self.assertEqual(resolved["to"], [self.accountant])

    def test_an_internal_alias_with_no_account_is_untouched_by_any_of_this(self):
        alias = f"{PREFIX.lower()}.rota{self.tag}@example.invalid"

        self.configure(self.policy("CC", address=alias))
        resolved = self.resolved([f"{PREFIX.lower()}.x{self.tag}@example.invalid"], customer=self.other)

        self.assertEqual(resolved["cc"], [alias])
