"""What the administrator may change about our notifications, and what must never change."""

from unittest.mock import patch

import frappe

from nexgen_msp.api.internal.services import notification_registry as registry
from nexgen_msp.api.internal.services.notification_dispatch_service import (
    NotificationDispatchService,
)
from nexgen_msp.api.internal.services.notification_reminder_service import (
    NotificationReminderService,
)
from nexgen_msp.api.internal.services.notification_settings_service import (
    NotificationSettingsService,
)
from nexgen_msp.utils import access, notifications
from nexgen_msp.utils.errors import ValidationError

from .base import PREFIX, MSPTestCase

RULE = "MSP Notification Rule"
RECIPIENT = "MSP Notification Recipient"
AUDIT = "MSP Notification Audit"
DISPATCH = "MSP Notification Dispatch"
TEMPLATE = "Email Template"
REFERENCE = "MSP Request"

SNAPSHOT_SKIP = {"name", "creation", "modified", "modified_by", "owner", "docstatus", "idx"}


class NotificationCase(MSPTestCase):
    """Leaves the site's notification settings, audit trail and dispatch records as found.

    The rules are the site's real configuration, so each test restores exactly what it
    read. The audit and the dispatch refuse deletion through the ORM by design, which is
    why what a test added to them is removed by name, and only what it added.
    """

    def setUp(self):
        super().setUp()
        self.tag = getattr(self, "tag", None) or frappe.generate_hash(length=6)
        self.refs = {REFERENCE: set()}
        self.rules_before = {
            row["name"]: {k: v for k, v in row.items() if k not in SNAPSHOT_SKIP}
            for row in frappe.get_all(RULE, fields=["*"])
        }
        self.recipients_before = frappe.get_all(
            RECIPIENT,
            filters={"parenttype": RULE},
            fields=["parent", "email", "kind", "idx"],
            order_by="parent asc, idx asc",
        )
        self.audit_before = set(frappe.get_all(AUDIT, pluck="name"))
        self.dispatch_before = set(frappe.get_all(DISPATCH, pluck="name"))

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        self.restore_rules()
        self.remove_what_the_test_added()
        frappe.db.commit()
        super().tearDown()

    def restore_rules(self):
        names = tuple(self.rules_before)

        for rule in registry.RULES:
            if rule not in self.rules_before and frappe.db.exists(RULE, rule):
                frappe.db.sql("delete from `tabMSP Notification Rule` where name = %s", rule)

        for name, values in self.rules_before.items():
            if frappe.db.exists(RULE, name):
                frappe.db.set_value(RULE, name, values, update_modified=False)

        if names:
            frappe.db.sql(
                "delete from `tabMSP Notification Recipient` where parenttype = %s and parent in %s",
                (RULE, names),
            )

        for row in self.recipients_before:
            frappe.db.sql(
                """insert into `tabMSP Notification Recipient`
                (name, parent, parenttype, parentfield, idx, email, kind, creation, modified)
                values (%s, %s, %s, 'recipients', %s, %s, %s, now(), now())""",
                (frappe.generate_hash(length=10), row.parent, RULE, row.idx, row.email, row.kind),
            )

    def remove_what_the_test_added(self):
        mine = self.refs[REFERENCE]

        if getattr(self, "customer", None):
            mine.update(frappe.get_all(REFERENCE, filters={"customer": self.customer}, pluck="name"))

        def ours(row):
            name = row.get("business_name") or ""

            return (
                not name
                or name in mine
                or name.startswith(PREFIX)
                or (row.get("recipient") or row.get("recipients") or "").endswith("@example.invalid")
            )

        dispatches = [
            row.name
            for row in frappe.get_all(
                DISPATCH, fields=["name", "business_name", "recipient"], limit_page_length=0
            )
            if row.name not in self.dispatch_before and ours(row)
        ]
        audits = [
            row.name
            for row in frappe.get_all(
                AUDIT, fields=["name", "business_name", "recipients"], limit_page_length=0
            )
            if row.name not in self.audit_before and ours(row)
        ]

        for table, names in (("MSP Notification Dispatch", dispatches), ("MSP Notification Audit", audits)):
            for start in range(0, len(names), 100):
                chunk = tuple(names[start : start + 100])
                frappe.db.sql(f"delete from `tab{table}` where name in %s", (chunk,))

    # ------------------------------------------------------------------ helpers
    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def address(self, label="a"):
        """A mailbox of this test's own, whose queued mail is swept with it."""
        email = f"{PREFIX.lower()}.n{label}{self.tag}@example.invalid"
        self.track("User", email)
        self.refs[REFERENCE].add(email)

        return email

    def reference(self, label="r"):
        name = f"{PREFIX}-{label}-{self.tag}"
        self.track(REFERENCE, name)

        return name

    def stored(self, rule_key, field):
        return frappe.db.get_value(RULE, rule_key, field)

    def queued_to(self, address):
        return frappe.db.sql(
            "select count(distinct parent) from `tabEmail Queue Recipient` where recipient = %s",
            address,
        )[0][0]

    def audits(self, rule_key, **filters):
        return [
            row
            for row in frappe.get_all(
                AUDIT,
                filters={"rule": rule_key, **filters},
                fields=["name", "action", "reason_code", "rule_revision", "business_name", "actor"],
                order_by="creation asc",
            )
            if row.name not in self.audit_before
        ]

    def dispatch_row(
        self, address, reference, rule="request_received", status="Queued", queue=None, doctype=REFERENCE
    ):
        doc = frappe.new_doc(DISPATCH)
        doc.dedup_key = f"{PREFIX}-{frappe.generate_hash(length=12)}"
        doc.rule = rule
        doc.business_doctype = doctype
        doc.business_name = reference
        doc.recipient = address
        doc.status = status
        doc.email_queue_id = queue
        doc.reserved_at = frappe.utils.now()
        doc.attempt = 1
        doc.insert(ignore_permissions=True)

        return doc

    def context(self):
        return {
            "full_name": "Marie",
            "request": "SR-0001",
            "customer": "ZZTEST",
            "summary": "",
            "headline": "x",
            "waiting_since": "today",
            "acts": "",
            "link": "https://example.invalid/msp",
        }


class TestWhoMayAdministerNotifications(NotificationCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer(f"NS{self.tag[:4]}")
        self.admin = self.make_account("internal", "MSP System Admin", suffix=f"na{self.tag[:3]}")
        self.technician = self.make_account("internal", "MSP Technician", suffix=f"nt{self.tag[:3]}")
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"nm{self.tag[:3]}"
        )
        self.operator = self.make_account(
            "customer", "MSP Customer Operator", self.customer, suffix=f"no{self.tag[:3]}"
        )

    def doors(self):
        return {
            "overview": lambda: NotificationSettingsService.overview(),
            "detail": lambda: NotificationSettingsService.detail("request_received"),
            "save": lambda: NotificationSettingsService.save(
                "request_received", changes={"display_name": f"{PREFIX} Request received"}
            ),
            "history": lambda: NotificationDispatchService.history(),
            "eligibility": lambda: NotificationReminderService.eligibility("request_approval_pending"),
        }

    def test_the_built_in_administrator_and_an_msp_system_admin_may_use_every_door(self):
        for user in ("Administrator", self.admin):
            for door, call in self.doors().items():
                with self.subTest(user=user, door=door):
                    self.assertTrue(self.as_user(user, call) is not None)

    def test_a_technician_and_both_customer_roles_are_refused_at_every_door(self):
        for user in (self.technician, self.manager, self.operator):
            for door, call in self.doors().items():
                with self.subTest(user=user, door=door):
                    with self.assertRaises(ValidationError) as refused:
                        self.as_user(user, call)

                    self.assertEqual(refused.exception.code, access.REFUSED)
                    self.assertEqual(refused.exception.http_status_code, 403)

    def test_a_refused_save_changes_nothing(self):
        revision = self.stored("request_received", "revision")

        with self.assertRaises(ValidationError):
            self.as_user(self.technician, self.doors()["save"])

        self.assertEqual(self.stored("request_received", "revision"), revision)
        self.assertNotEqual(self.stored("request_received", "display_name"), f"{PREFIX} Request received")


class TestSeedingIsIdempotent(NotificationCase):
    def wipe_the_rules(self):
        names = tuple(self.rules_before)
        self.assertEqual(len(names), len(registry.RULES), "the site is expected to carry every rule")
        frappe.db.sql(
            "delete from `tabMSP Notification Recipient` where parenttype = %s and parent in %s",
            (RULE, names),
        )
        frappe.db.sql("delete from `tabMSP Notification Rule` where name in %s", (names,))
        frappe.db.commit()

        self.assertEqual(frappe.db.count(RULE), 0)

    def test_seeding_an_empty_table_creates_every_rule_once_and_seeding_again_creates_none(self):
        self.wipe_the_rules()

        first = NotificationSettingsService.seed()
        second = NotificationSettingsService.seed()

        self.assertEqual(len(registry.RULES), 17)
        self.assertEqual(sorted(first), sorted(registry.RULES))
        self.assertEqual(second, [])
        self.assertEqual(frappe.db.count(RULE), 17)
        self.assertEqual(set(frappe.get_all(RULE, pluck="name")), set(registry.RULES))

    def test_a_rule_the_administrator_edited_is_not_reset_by_a_later_seed(self):
        NotificationSettingsService.save(
            "request_approval_pending", changes={"max_sends": 7, "repeat_interval_value": 5}
        )
        revision = self.stored("request_approval_pending", "revision")

        self.assertEqual(NotificationSettingsService.seed(), [])

        self.assertEqual(self.stored("request_approval_pending", "max_sends"), 7)
        self.assertEqual(self.stored("request_approval_pending", "repeat_interval_value"), 5)
        self.assertEqual(self.stored("request_approval_pending", "revision"), revision)

    def test_a_missing_rule_is_recreated_and_the_others_are_left_alone(self):
        NotificationSettingsService.save("request_approval_pending", changes={"max_sends": 9})
        frappe.db.sql("delete from `tabMSP Notification Rule` where name = %s", "request_modified")
        frappe.db.commit()

        self.assertEqual(NotificationSettingsService.seed(), ["request_modified"])

        self.assertEqual(frappe.db.count(RULE), 17)
        self.assertEqual(self.stored("request_approval_pending", "max_sends"), 9)

    def test_the_three_account_notifications_are_protected_and_the_rest_are_not(self):
        self.assertEqual(
            sorted(registry.PROTECTED), ["password_reset", "portal_invitation", "team_invitation"]
        )
        self.assertEqual(len(registry.keys(registry.EVENT)), 15)
        self.assertEqual(len(registry.keys(registry.REMINDER)), 2)


class TestAProtectedNotificationCannotBeSwitchedOff(NotificationCase):
    def test_switching_password_reset_off_is_refused_and_it_stays_enabled(self):
        for key in registry.PROTECTED:
            with self.subTest(rule=key):
                with self.assertRaises(ValidationError):
                    NotificationSettingsService.save(key, changes={"enabled": 0})

                self.assertEqual(self.stored(key, "enabled"), 1)

    def test_a_row_forced_off_in_the_database_still_reads_as_enabled(self):
        frappe.db.set_value(RULE, "password_reset", "enabled", 0)

        self.assertEqual(self.stored("password_reset", "enabled"), 0)
        self.assertTrue(NotificationSettingsService.effective("password_reset")["enabled"])

    def test_a_password_reset_mail_still_goes_when_its_row_is_forced_off(self):
        frappe.db.set_value(RULE, "password_reset", "enabled", 0)
        address = self.address()

        sent = notifications.send("MSP Password Reset", [address], self.context())

        self.assertTrue(sent)
        self.assertEqual(self.queued_to(address), 1)


class TestTheRegistryDecidesWhatARuleMayBecome(NotificationCase):
    def test_a_template_outside_the_rules_registry_entry_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            NotificationSettingsService.save(
                "request_received", changes={"template_name": "MSP Invoice Issued"}
            )

        self.assertEqual(self.stored("request_received", "template_name"), "MSP Request Received")

    def test_an_audience_outside_the_rules_registry_entry_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            NotificationSettingsService.save("request_received", changes={"audience_key": "internal"})

        self.assertEqual(self.stored("request_received", "audience_key"), "requester")

    def test_a_key_that_is_not_editable_is_refused_whatever_it_says(self):
        revision = self.stored("request_received", "revision")

        for key, value in (
            ("rule_key", "request_decision"),
            ("kind", "Reminder"),
            ("trigger_key", "request_decision"),
            ("protected", 1),
            ("category", "Billing"),
        ):
            with self.subTest(key=key):
                with self.assertRaises(ValidationError):
                    NotificationSettingsService.save("request_received", changes={key: value})

        self.assertEqual(self.stored("request_received", "revision"), revision)
        self.assertEqual(self.stored("request_received", "kind"), "Event")
        self.assertEqual(self.stored("request_received", "protected"), 0)

    def test_a_rule_the_application_does_not_own_is_not_found(self):
        with self.assertRaises(Exception) as raised:
            NotificationSettingsService.save("not_a_rule", changes={"enabled": 0})

        self.assertEqual(raised.exception.code, "NOT_FOUND")

    def test_a_reminder_cannot_escalate_to_an_audience_nobody_resolves(self):
        with self.assertRaises(frappe.ValidationError):
            NotificationSettingsService.save(
                "request_approval_pending",
                changes={"escalation_after_iteration": 2, "escalation_audience_key": "everyone"},
            )

    def test_every_template_names_exactly_one_rule(self):
        self.assertEqual(len(registry.BY_TEMPLATE), len(registry.RULES))

        for key, declared in registry.RULES.items():
            self.assertEqual(registry.rule_of_template(declared["template_name"]), key)

        self.assertIsNone(registry.rule_of_template("Some Other Template"))


class TestTwoAdministratorsCannotOverwriteEachOther(NotificationCase):
    def test_a_save_with_a_stale_revision_is_refused_and_changes_nothing(self):
        revision = self.stored("request_received", "revision")
        NotificationSettingsService.save(
            "request_received", expected_revision=revision, changes={"display_name": f"{PREFIX} first"}
        )

        with self.assertRaises(ValidationError) as conflict:
            NotificationSettingsService.save(
                "request_received",
                expected_revision=revision,
                changes={"display_name": f"{PREFIX} second", "enabled": 0},
            )

        self.assertEqual(conflict.exception.code, "VERSION_CONFLICT")
        self.assertEqual(self.stored("request_received", "display_name"), f"{PREFIX} first")
        self.assertEqual(self.stored("request_received", "enabled"), 1)
        self.assertEqual(self.stored("request_received", "revision"), revision + 1)

    def test_a_save_with_the_current_revision_succeeds_and_raises_it_by_one(self):
        revision = self.stored("request_received", "revision")

        out = NotificationSettingsService.save(
            "request_received", expected_revision=revision, changes={"display_name": f"{PREFIX} edited"}
        )

        self.assertEqual(out["rule"]["revision"], revision + 1)
        self.assertEqual(self.stored("request_received", "revision"), revision + 1)
        self.assertEqual(self.stored("request_received", "display_name"), f"{PREFIX} edited")

    def test_a_refused_validation_does_not_consume_a_revision(self):
        revision = self.stored("request_received", "revision")

        with self.assertRaises(frappe.ValidationError):
            NotificationSettingsService.save(
                "request_received", expected_revision=revision, changes={"audience_key": "internal"}
            )

        self.assertEqual(self.stored("request_received", "revision"), revision)


class TestEveryChangeLeavesAnAuditLine(NotificationCase):
    def test_a_save_appends_one_audit_row_naming_the_rule_and_the_revision(self):
        before = len(self.audits("request_received"))
        revision = self.stored("request_received", "revision")

        NotificationSettingsService.save("request_received", changes={"display_name": f"{PREFIX} audited"})

        rows = self.audits("request_received")
        self.assertEqual(len(rows), before + 1)
        self.assertEqual(rows[-1].rule_revision, revision + 1)
        self.assertEqual(rows[-1].action, "Rule Edited")
        self.assertEqual(rows[-1].actor, "Administrator")
        self.assertIn("display_name", frappe.db.get_value(AUDIT, rows[-1].name, "detail"))

    def test_switching_a_rule_off_and_on_is_audited_as_such(self):
        NotificationSettingsService.save("request_received", changes={"enabled": 0})
        NotificationSettingsService.save("request_received", changes={"enabled": 1})

        self.assertEqual(
            [row.action for row in self.audits("request_received")], ["Rule Disabled", "Rule Enabled"]
        )

    def test_an_existing_audit_row_cannot_be_modified_through_the_orm(self):
        NotificationSettingsService.save("request_received", changes={"display_name": f"{PREFIX} fixed"})
        name = self.audits("request_received")[-1].name
        detail = frappe.db.get_value(AUDIT, name, "detail")

        doc = frappe.get_doc(AUDIT, name)
        doc.detail = "tidied"

        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

        frappe.db.rollback()
        self.assertEqual(frappe.db.get_value(AUDIT, name, "detail"), detail)

    def test_an_existing_audit_row_cannot_be_deleted_through_the_orm(self):
        NotificationSettingsService.save("request_received", changes={"display_name": f"{PREFIX} kept"})
        name = self.audits("request_received")[-1].name

        with self.assertRaises(frappe.ValidationError):
            frappe.delete_doc(AUDIT, name, force=True, ignore_permissions=True)

        frappe.db.rollback()
        self.assertTrue(frappe.db.exists(AUDIT, name))


class TestAnEventObeysItsSetting(NotificationCase):
    def send(self, address, reference):
        return notifications.send(
            "MSP Request Received",
            [address],
            self.context(),
            reference_doctype=REFERENCE,
            reference_name=reference,
        )

    def test_a_disabled_event_queues_nothing_returns_falsy_and_is_audited(self):
        address = self.address()
        reference = self.reference()
        NotificationSettingsService.save("request_received", changes={"enabled": 0})

        sent = self.send(address, reference)

        self.assertFalse(sent)
        self.assertEqual(self.queued_to(address), 0)
        skipped = self.audits("request_received", action="Skipped", business_name=reference)
        self.assertEqual([row.reason_code for row in skipped], ["rule_disabled"])

    def test_enabling_it_again_lets_the_next_event_through(self):
        address = self.address()
        reference = self.reference()
        NotificationSettingsService.save("request_received", changes={"enabled": 0})
        self.send(address, reference)

        NotificationSettingsService.save("request_received", changes={"enabled": 1})
        sent = self.send(address, reference)

        self.assertTrue(sent)
        self.assertEqual(self.queued_to(address), 1)

    def test_a_setting_saved_a_moment_ago_reaches_the_very_next_send(self):
        address = self.address()
        reference = self.reference()

        self.assertTrue(self.send(address, reference))
        NotificationSettingsService.save("request_received", changes={"enabled": 0})
        self.assertFalse(self.send(address, reference))

        self.assertEqual(self.queued_to(address), 1)

    def test_an_unmanaged_template_is_never_held_back(self):
        self.assertIsNone(notifications._settings_for("Some Other Template"))


class TestTemplatesSurviveAMigration(NotificationCase):
    NAME = "MSP Request Received"

    def setUp(self):
        super().setUp()
        notifications.ensure_templates()
        self.original = frappe.db.get_value(
            TEMPLATE, self.NAME, ["subject", "response_html", "use_html"], as_dict=True
        )

    def tearDown(self):
        frappe.set_user("Administrator")

        if frappe.db.exists(TEMPLATE, self.NAME):
            frappe.db.set_value(TEMPLATE, self.NAME, dict(self.original))
        else:
            doc = frappe.new_doc(TEMPLATE)
            doc.name = self.NAME
            doc.update(self.original)
            doc.insert(ignore_permissions=True)

        frappe.db.commit()
        super().tearDown()

    def test_an_edited_template_is_left_exactly_as_the_administrator_wrote_it(self):
        frappe.db.set_value(
            TEMPLATE,
            self.NAME,
            {"subject": f"{PREFIX} our own subject", "response_html": f"<p>{PREFIX} our own wording</p>"},
        )
        frappe.db.commit()

        created = notifications.ensure_templates()

        self.assertNotIn(self.NAME, created)
        stored = frappe.db.get_value(TEMPLATE, self.NAME, ["subject", "response_html"], as_dict=True)
        self.assertEqual(stored.subject, f"{PREFIX} our own subject")
        self.assertEqual(stored.response_html, f"<p>{PREFIX} our own wording</p>")
        self.assertIn(self.NAME, notifications.drifted_templates())

    def test_a_template_that_was_deleted_is_recreated_with_the_shipped_wording(self):
        frappe.delete_doc(TEMPLATE, self.NAME, force=True, ignore_permissions=True)
        frappe.db.commit()
        self.assertFalse(frappe.db.exists(TEMPLATE, self.NAME))

        created = notifications.ensure_templates()

        self.assertEqual(created, [self.NAME])
        self.assertEqual(
            frappe.db.get_value(TEMPLATE, self.NAME, "subject"), notifications.TEMPLATES[self.NAME]["subject"]
        )
        self.assertNotIn(self.NAME, notifications.drifted_templates())

    def test_running_it_again_creates_nothing(self):
        self.assertEqual(notifications.ensure_templates(), [])


class TestADeliveryHappensOnce(NotificationCase):
    def key(self, **over):
        parts = {
            "rule_key": "request_received",
            "business_doctype": REFERENCE,
            "business_name": "SR-1",
            "occurrence": "event:1",
            "recipient": "someone@example.invalid",
            **over,
        }

        return NotificationDispatchService.dedup_key(**parts)

    def deliver(self, address, reference, **over):
        return NotificationDispatchService.deliver(
            "request_received",
            address,
            self.context(),
            business_doctype=REFERENCE,
            business_name=reference,
            occurrence="event:1",
            **over,
        )

    def test_the_key_is_stable_for_the_same_inputs(self):
        self.assertEqual(self.key(), self.key())
        self.assertEqual(len(self.key()), 64)

    def test_the_key_differs_when_any_one_input_differs(self):
        base = self.key()

        for field, value in (
            ("rule_key", "request_decision"),
            ("business_doctype", "MSP Invoice"),
            ("business_name", "SR-2"),
            ("occurrence", "event:2"),
            ("recipient", "another@example.invalid"),
        ):
            with self.subTest(field=field):
                self.assertNotEqual(self.key(**{field: value}), base)

    def test_inputs_that_would_run_together_do_not_collide(self):
        self.assertNotEqual(
            self.key(business_doctype="MSP", business_name="Request SR"),
            self.key(business_doctype="MSP Request", business_name=" SR"),
        )

    def test_recipients_differing_only_by_case_or_whitespace_are_one_recipient(self):
        self.assertEqual(self.key(recipient="Someone@Example.invalid"), self.key())
        self.assertEqual(self.key(recipient="  someone@example.invalid "), self.key())

    def test_delivering_twice_queues_one_mail_and_writes_one_dispatch(self):
        address = self.address()
        reference = self.reference()

        first = self.deliver(address, reference)
        second = self.deliver(address, reference)

        self.assertEqual(first["status"], "Queued")
        self.assertEqual(second["reason"], "already_dispatched")
        self.assertEqual(second["dispatch"], first["dispatch"])
        self.assertEqual(frappe.db.count(DISPATCH, {"business_name": reference}), 1)
        self.assertEqual(self.queued_to(address), 1)

    def test_the_same_person_written_differently_is_not_mailed_twice(self):
        address = self.address()
        reference = self.reference()

        self.deliver(address, reference)
        again = self.deliver(f"  {address.upper()} ", reference)

        self.assertEqual(again["reason"], "already_dispatched")
        self.assertEqual(frappe.db.count(DISPATCH, {"business_name": reference}), 1)
        self.assertEqual(self.queued_to(address), 1)

    def test_a_different_occurrence_is_a_different_delivery(self):
        address = self.address()
        reference = self.reference()

        self.deliver(address, reference)
        NotificationDispatchService.deliver(
            "request_received",
            address,
            self.context(),
            business_doctype=REFERENCE,
            business_name=reference,
            occurrence="event:2",
        )

        self.assertEqual(frappe.db.count(DISPATCH, {"business_name": reference}), 2)
        self.assertEqual(self.queued_to(address), 2)

    def test_the_database_itself_refuses_a_second_row_with_the_same_key(self):
        address = self.address()
        reference = self.reference()
        done = self.deliver(address, reference)
        key = frappe.db.get_value(DISPATCH, done["dispatch"], "dedup_key")

        twin = frappe.new_doc(DISPATCH)
        twin.dedup_key = key
        twin.rule = "request_received"
        twin.recipient = address
        twin.business_name = reference

        with self.assertRaises(frappe.UniqueValidationError):
            twin.insert(ignore_permissions=True)

        frappe.db.rollback()

    def test_a_worker_that_loses_the_race_is_handed_the_winners_delivery_not_an_error(self):
        address = self.address()
        reference = self.reference()
        won = self.deliver(address, reference)
        key = frappe.db.get_value(DISPATCH, won["dispatch"], "dedup_key")
        real = frappe.db.get_value
        lookups = []

        def blind_first_lookup(doctype, filters=None, *args, **kwargs):
            if doctype == DISPATCH and isinstance(filters, dict) and filters.get("dedup_key") == key:
                lookups.append(1)

                if len(lookups) == 1:
                    return None

            return real(doctype, filters, *args, **kwargs)

        with patch.object(frappe.db, "get_value", side_effect=blind_first_lookup):
            lost = self.deliver(address, reference)

        self.assertEqual(lost["reason"], "already_dispatched")
        self.assertEqual(self.queued_to(address), 1)

    def test_a_disabled_rule_delivers_nothing_and_says_why(self):
        address = self.address()
        reference = self.reference()
        NotificationSettingsService.save("request_received", changes={"enabled": 0})

        out = self.deliver(address, reference)

        self.assertEqual(out, {"status": "Skipped", "reason": "rule_disabled"})
        self.assertEqual(self.queued_to(address), 0)
        self.assertEqual(frappe.db.count(DISPATCH, {"business_name": reference}), 0)

    def test_a_blank_recipient_is_skipped(self):
        self.assertEqual(self.deliver("   ", self.reference())["reason"], "no_recipient")


class TestTheHistoryTellsWhatHappened(NotificationCase):
    def setUp(self):
        super().setUp()
        self.technician = self.make_account("internal", "MSP Technician", suffix=f"ht{self.tag[:3]}")

    def deliver(self, address, reference, **over):
        return NotificationDispatchService.deliver(
            "request_received",
            address,
            self.context(),
            business_doctype=REFERENCE,
            business_name=reference,
            occurrence="event:1",
            **over,
        )

    def test_it_is_for_an_administrator_and_nobody_else(self):
        with self.assertRaises(ValidationError):
            self.as_user(self.technician, lambda: NotificationDispatchService.history())

        self.assertIn("rows", NotificationDispatchService.history())

    def test_it_reports_the_real_status_and_the_mail_it_points_at(self):
        address = self.address()
        reference = self.reference()
        self.deliver(address, reference)

        rows = NotificationDispatchService.history(rule_key="request_received", search=address)["rows"]

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].status, "Queued")
        self.assertEqual(rows[0].recipient, address)
        self.assertEqual(rows[0].business_name, reference)
        self.assertFalse(rows[0].is_test)
        self.assertTrue(frappe.db.exists("Email Queue", rows[0].email_queue_id))

    def test_a_test_send_is_flagged_and_can_be_told_from_a_real_one(self):
        address = self.address()
        reference = self.reference()
        self.deliver(address, reference)
        self.deliver(address, reference, is_test=True)

        rows = NotificationDispatchService.history(rule_key="request_received", search=address)["rows"]

        self.assertEqual(sorted(row.is_test for row in rows), [0, 1])
        test = next(row for row in rows if row.is_test)
        self.assertTrue(test.subject_snapshot)
        raw = frappe.db.get_value("Email Queue", test.email_queue_id, "message")
        self.assertIn("[Test]", raw)

    def test_a_test_send_does_not_stand_in_for_the_real_delivery(self):
        address = self.address()
        reference = self.reference()

        self.deliver(address, reference, is_test=True)
        real = self.deliver(address, reference)

        self.assertEqual(real["status"], "Queued")
        self.assertEqual(self.queued_to(address), 2)

    def test_it_can_be_filtered_by_status_and_record(self):
        address = self.address()
        reference = self.reference()
        self.deliver(address, reference)

        by_record = NotificationDispatchService.history(business_name=reference)
        by_status = NotificationDispatchService.history(business_name=reference, status="Failed")

        self.assertEqual(by_record["total"], 1)
        self.assertEqual(by_status["total"], 0)


class TestASecurityNotificationReachesNobodyElse(NotificationCase):
    """A reset link is the account. Copying it hands the account to whoever holds the copy.

    The rule being impossible to switch off protects its delivery, not its contents: a
    notification that still reaches the right person *and* an address somebody added is
    worse than one that does not arrive at all.
    """

    PROTECTED = ("password_reset", "portal_invitation", "team_invitation")

    def test_a_copy_cannot_be_configured_on_one(self):
        for rule_key in self.PROTECTED:
            with self.assertRaises(ValidationError, msg=rule_key):
                NotificationSettingsService.save(
                    rule_key,
                    changes={"recipients": [{"email": "elsewhere@example.invalid", "kind": "CC"}]},
                )

    def test_a_row_written_straight_into_the_database_reaches_no_send(self):
        for rule_key in self.PROTECTED:
            doc = frappe.get_doc(RULE, rule_key)
            doc.append("recipients", {"email": f"old-{rule_key}@example.invalid", "kind": "CC"})
            doc.flags.ignore_validate = True
            doc.save(ignore_permissions=True)

        frappe.db.commit()

        for rule_key in self.PROTECTED:
            current = NotificationSettingsService.effective(rule_key)

            self.assertEqual(current["cc"], [], rule_key)
            self.assertEqual(current["extra"], [], rule_key)

    def test_the_reset_mail_is_addressed_to_the_account_holder_alone(self):
        holder = f"zztest-holder-{self.tag}@example.invalid"
        doc = frappe.get_doc(RULE, "password_reset")
        doc.append("recipients", {"email": "elsewhere@example.invalid", "kind": "CC"})
        doc.flags.ignore_validate = True
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        notifications.send(
            "MSP Password Reset",
            [holder],
            {"full_name": "ZZTEST", "link": "https://example.invalid/reset"},
        )

        queued = frappe.db.sql_list(
            "select distinct parent from `tabEmail Queue Recipient` where recipient = %s", holder
        )
        self.assertTrue(queued, "the holder was written to")

        for parent in queued:
            written = set(
                frappe.get_all("Email Queue Recipient", filters={"parent": parent}, pluck="recipient")
            )
            self.assertEqual(written, {holder}, "and nobody else was")
            frappe.db.sql("delete from `tabEmail Queue Recipient` where parent = %s", parent)
            frappe.db.sql("delete from `tabEmail Queue` where name = %s", parent)

        frappe.db.commit()


class TestARetriedDeliveryIsQueuedOnce(NotificationCase):
    def deliver(self, address, reference, **over):
        return NotificationDispatchService.deliver(
            "request_received",
            address,
            self.context(),
            business_doctype=REFERENCE,
            business_name=reference,
            occurrence="event:1",
            **over,
        )

    def fail_the_render_once(self, address, reference):
        with patch.object(notifications, "render", side_effect=ValueError("broken template")):
            return self.deliver(address, reference)

    def settle(self, name, note="Looked at the mail log"):
        return NotificationDispatchService.resolve(name, "not_sent", note=note)

    def test_a_render_failure_then_a_corrected_template_queues_exactly_one_mail(self):
        address = self.address()
        reference = self.reference()

        failed = self.fail_the_render_once(address, reference)
        self.assertEqual(failed["status"], "Failed")
        self.assertEqual(self.queued_to(address), 0)

        again = self.deliver(address, reference)

        self.assertEqual(again["status"], "Queued")
        self.assertEqual(again["dispatch"], failed["dispatch"])
        self.assertEqual(self.queued_to(address), 1)
        self.assertEqual(frappe.db.get_value(DISPATCH, failed["dispatch"], "status"), "Queued")
        self.assertEqual(self.deliver(address, reference)["reason"], "already_dispatched")
        self.assertEqual(self.queued_to(address), 1)

    def test_a_second_delivery_while_the_first_retry_holds_the_claim_queues_nothing(self):
        address = self.address()
        reference = self.reference()
        failed = self.fail_the_render_once(address, reference)
        held = frappe.get_doc(DISPATCH, failed["dispatch"])

        self.assertTrue(NotificationDispatchService._claim(held))
        second = self.deliver(address, reference)

        self.assertEqual(second["reason"], "held_by_another_worker")
        self.assertEqual(second["status"], "Pending")
        self.assertEqual(self.queued_to(address), 0)

    def test_an_unknown_delivery_is_never_sent_again_on_its_own(self):
        address = self.address()
        reference = self.reference()
        first = self.deliver(address, reference)
        frappe.db.set_value(DISPATCH, first["dispatch"], "status", "Unknown")

        again = self.deliver(address, reference)

        self.assertEqual(again["reason"], "needs_investigation")
        self.assertEqual(frappe.db.get_value(DISPATCH, first["dispatch"], "status"), "Unknown")
        self.assertEqual(self.queued_to(address), 1)

    def test_nothing_was_sent_leaves_the_delivery_failed_and_the_next_delivery_queues_one_mail(self):
        address = self.address()
        reference = self.reference()
        first = self.deliver(address, reference)
        frappe.db.set_value(DISPATCH, first["dispatch"], {"status": "Unknown", "email_queue_id": None})
        frappe.db.sql("delete from `tabEmail Queue Recipient` where recipient = %s", address)

        outcome = self.settle(first["dispatch"])
        row = frappe.db.get_value(
            DISPATCH, first["dispatch"], ["status", "skip_reason", "email_queue_id"], as_dict=True
        )

        self.assertEqual(outcome["status"], "Failed")
        self.assertEqual(outcome["retry"], "manual")
        self.assertEqual(row.status, "Failed")
        self.assertEqual(row.skip_reason, "attested_not_sent")
        self.assertFalse(row.email_queue_id)
        self.assertEqual(self.queued_to(address), 0)

        again = self.deliver(address, reference)

        self.assertEqual(again["status"], "Queued")
        self.assertEqual(again["dispatch"], first["dispatch"])
        self.assertEqual(self.queued_to(address), 1)
        self.assertEqual(self.deliver(address, reference)["reason"], "already_dispatched")
        self.assertEqual(self.queued_to(address), 1)

    def test_nothing_was_sent_on_a_reminder_says_the_scheduler_will_raise_it_while_the_record_still_matches(
        self,
    ):
        reminder = registry.keys(registry.REMINDER)[0]
        address = self.address()
        row = self.dispatch_row(address, "Administrator", rule=reminder, status="Unknown", doctype="User")
        adapter = {"doctype": "User", "filters": {"enabled": 1}}

        with patch.object(registry, "condition", return_value=adapter):
            outcome = self.settle(row.name)

        self.assertEqual(outcome, {"status": "Failed", "retry": "scheduled"})

    def test_nothing_was_sent_on_a_reminder_whose_record_no_longer_matches_says_to_repeat_the_action(self):
        reminder = registry.keys(registry.REMINDER)[0]
        address = self.address()
        row = self.dispatch_row(address, "Administrator", rule=reminder, status="Unknown", doctype="User")

        with patch.object(registry, "condition", return_value={"doctype": "User", "filters": {"enabled": 0}}):
            self.assertEqual(self.settle(row.name)["retry"], "manual")

    def test_nothing_was_sent_on_a_reminder_whose_record_is_gone_says_to_repeat_the_action(self):
        reminder = registry.keys(registry.REMINDER)[0]
        address = self.address()
        row = self.dispatch_row(address, self.reference(), rule=reminder, status="Unknown")

        with patch.object(registry, "condition", return_value={"doctype": REFERENCE, "filters": {}}):
            self.assertEqual(self.settle(row.name)["retry"], "manual")

    def test_nothing_was_sent_on_an_event_says_to_repeat_the_action(self):
        address = self.address()
        row = self.dispatch_row(address, self.reference(), rule="request_received", status="Unknown")

        self.assertEqual(self.settle(row.name)["retry"], "manual")


class TestReconciliationReachesEveryDelivery(NotificationCase):
    def setUp(self):
        super().setUp()
        NotificationDispatchService._remember(None)

    def tearDown(self):
        NotificationDispatchService._remember(None)
        super().tearDown()

    def queue_entry(self, address, reference, status):
        entry = frappe.get_doc(
            {
                "doctype": "Email Queue",
                "sender": "noreply@example.invalid",
                "message": "x",
                "status": status,
                "reference_doctype": REFERENCE,
                "reference_name": reference,
                "recipients": [{"recipient": address}],
            }
        ).insert(ignore_permissions=True)

        return entry.name

    def make_rows(self, count):
        address = self.address()
        reference = self.reference()
        waiting = self.queue_entry(address, reference, "Not Sent")
        rows = [
            self.dispatch_row(address, reference, status="Queued", queue=waiting).name
            for _ in range(count - 1)
        ]
        done = self.queue_entry(address, reference, "Sent")
        rows.append(self.dispatch_row(address, reference, status="Queued", queue=done).name)

        return rows

    def test_a_delivery_beyond_the_first_two_hundred_is_eventually_reconciled(self):
        rows = self.make_rows(201)

        for _ in range(100):
            NotificationDispatchService.reconcile()

            if frappe.db.get_value(DISPATCH, rows[-1], "status") == "Sent":
                break

        self.assertEqual(frappe.db.get_value(DISPATCH, rows[-1], "status"), "Sent")
        self.assertEqual(frappe.db.get_value(DISPATCH, rows[0], "status"), "Queued")

    def test_reconciling_twice_over_the_same_data_changes_nothing_the_second_time(self):
        rows = self.make_rows(3)

        for _ in range(100):
            NotificationDispatchService.reconcile()

            if frappe.db.get_value(DISPATCH, rows[-1], "status") == "Sent":
                break

        def snapshot():
            return {
                name: frappe.db.get_value(DISPATCH, name, ["status", "modified"], as_dict=True)
                for name in rows
            }

        before = snapshot()
        NotificationDispatchService.reconcile()
        NotificationDispatchService.reconcile()

        self.assertEqual(snapshot(), before)


class TestAQueueEntryIsTiedToItsDeliveryByAMark(NotificationCase):
    def deliver(self, address, reference, occurrence="event:1", **over):
        return NotificationDispatchService.deliver(
            "request_received",
            address,
            self.context(),
            business_doctype=REFERENCE,
            business_name=reference,
            occurrence=occurrence,
            **over,
        )

    def entry_of(self, dispatch):
        return frappe.db.get_value(DISPATCH, dispatch, "email_queue_id")

    def lose_the_link(self, dispatch):
        frappe.db.set_value(DISPATCH, dispatch, {"status": "Unknown", "email_queue_id": None})

    def written_by_hand(self, address, reference, message_id=None, cc=None):
        entry = frappe.get_doc(
            {
                "doctype": "Email Queue",
                "sender": "noreply@example.invalid",
                "message": "x",
                "status": "Not Sent",
                "message_id": message_id,
                "reference_doctype": REFERENCE,
                "reference_name": reference,
                "recipients": [{"recipient": person} for person in [address, *(cc or [])]],
            }
        ).insert(ignore_permissions=True)

        return entry.name

    def candidate(self, dispatch, entry):
        found = [
            row
            for row in NotificationDispatchService.evidence(dispatch)["candidates"]
            if row["email_queue"] == entry
        ]

        return found[0] if found else None

    def test_a_queued_delivery_records_its_own_name_on_the_entry_and_evidence_reports_it_matched(self):
        address = self.address()
        reference = self.reference()
        sent = self.deliver(address, reference)
        entry = self.entry_of(sent["dispatch"])
        self.assertEqual(frappe.db.get_value("Email Queue", entry, "message_id"), sent["dispatch"])

        self.lose_the_link(sent["dispatch"])
        frappe.db.set_value(DISPATCH, sent["dispatch"], "reserved_at", frappe.utils.add_to_date(None, minutes=-5))

        found = self.candidate(sent["dispatch"], entry)

        self.assertTrue(found["matched"])

    def test_a_link_to_an_entry_marked_for_another_delivery_is_refused_and_the_status_stays(self):
        address = self.address()
        reference = self.reference()
        first = self.deliver(address, reference, occurrence="event:1")
        second = self.deliver(address, reference, occurrence="event:2")
        self.lose_the_link(first["dispatch"])

        with self.assertRaises(ValidationError):
            NotificationDispatchService.resolve(
                first["dispatch"], "link", email_queue=self.entry_of(second["dispatch"]), note="Looked"
            )

        self.assertEqual(frappe.db.get_value(DISPATCH, first["dispatch"], "status"), "Unknown")
        self.assertFalse(self.entry_of(first["dispatch"]))

    def test_a_link_to_the_entry_marked_for_this_delivery_is_accepted(self):
        address = self.address()
        reference = self.reference()
        sent = self.deliver(address, reference)
        entry = self.entry_of(sent["dispatch"])
        self.lose_the_link(sent["dispatch"])

        outcome = NotificationDispatchService.resolve(
            sent["dispatch"], "link", email_queue=entry, note="Looked"
        )

        self.assertEqual(outcome["status"], "Queued")
        self.assertEqual(self.entry_of(sent["dispatch"]), entry)

    def test_an_entry_with_no_mark_still_links_as_before_and_is_reported_unmatched(self):
        address = self.address()
        reference = self.reference()
        row = self.dispatch_row(address, reference, status="Unknown")
        entry = self.written_by_hand(address, reference)

        self.assertFalse(self.candidate(row.name, entry)["matched"])

        outcome = NotificationDispatchService.resolve(row.name, "link", email_queue=entry, note="Looked")

        self.assertEqual(outcome["status"], "Queued")
        self.assertEqual(self.entry_of(row.name), entry)

    def test_two_deliveries_to_one_person_about_one_record_are_told_apart_by_the_mark(self):
        address = self.address()
        reference = self.reference()
        first = self.deliver(address, reference, occurrence="event:1")
        second = self.deliver(address, reference, occurrence="event:2")
        mine = self.entry_of(first["dispatch"])
        theirs = self.entry_of(second["dispatch"])
        self.lose_the_link(first["dispatch"])
        self.lose_the_link(second["dispatch"])

        for name in (first["dispatch"], second["dispatch"]):
            frappe.db.set_value(DISPATCH, name, "reserved_at", frappe.utils.add_to_date(None, minutes=-5))

        offered = NotificationDispatchService.evidence(first["dispatch"])["candidates"]

        self.assertEqual([row["email_queue"] for row in offered], [mine])
        self.assertTrue(offered[0]["matched"])
        self.assertEqual(
            [row["email_queue"] for row in NotificationDispatchService.evidence(second["dispatch"])["candidates"]],
            [theirs],
        )

        with self.assertRaises(ValidationError):
            NotificationDispatchService.resolve(first["dispatch"], "link", email_queue=theirs, note="Looked")

        NotificationDispatchService.resolve(second["dispatch"], "link", email_queue=theirs, note="Looked")

        self.assertEqual(self.entry_of(second["dispatch"]), theirs)

    def test_an_address_that_was_only_copied_is_not_read_as_that_deliverys_own_mail(self):
        address = self.address("to")
        copied = self.address("cc")
        reference = self.reference()
        sent = self.deliver(address, reference, cc=[copied])
        entry = self.entry_of(sent["dispatch"])
        own = self.dispatch_row(copied, reference, status="Unknown")
        frappe.db.set_value(DISPATCH, own.name, "reserved_at", frappe.utils.add_to_date(None, minutes=-5))

        self.assertIsNone(self.candidate(own.name, entry))

        with self.assertRaises(ValidationError):
            NotificationDispatchService.resolve(own.name, "link", email_queue=entry, note="Looked")

        self.assertEqual(frappe.db.get_value(DISPATCH, own.name, "status"), "Unknown")

    def test_a_marker_that_is_not_one_of_ours_says_nothing(self):
        self.assertIsNone(NotificationDispatchService.marker_of("<abc123@example.invalid>"))
        self.assertIsNone(NotificationDispatchService.marker_of(None))

    def test_a_disabled_reminder_is_not_promised_a_retry(self):
        reminder = registry.keys(registry.REMINDER)[0]
        address = self.address()
        row = self.dispatch_row(address, "Administrator", rule=reminder, status="Unknown", doctype="User")
        adapter = {"doctype": "User", "filters": {"enabled": 1}}
        frappe.db.set_value(RULE, reminder, "enabled", 0)

        with patch.object(registry, "condition", return_value=adapter):
            self.assertEqual(NotificationDispatchService._retry_of(row), "manual")


class TestEachDeliveryStateIsCountedForWhatItIs(NotificationCase):
    """A record waiting to be taken is not mail in the queue, and neither one has been sent.

    The page counted the two together under Queued, which read as mail handed to Frappe
    when nothing had picked it up yet. One counter per state the record really holds.
    """

    def setUp(self):
        super().setUp()
        self.reference = f"{PREFIX}-FIG-{self.tag}"

    def figures(self, **counts):
        for status, total in counts.items():
            for _ in range(total):
                self.dispatch_row(
                    f"{frappe.generate_hash(length=6)}@example.invalid",
                    self.reference,
                    status=status,
                )

        return NotificationSettingsService._figures()

    def test_waiting_to_be_taken_is_not_waiting_in_the_queue(self):
        before = NotificationSettingsService._figures()
        after = self.figures(Pending=2, Queued=1)

        self.assertEqual(after["pending"] - before["pending"], 2)
        self.assertEqual(after["queued"] - before["queued"], 1)

    def test_what_went_out_is_counted_on_its_own(self):
        before = NotificationSettingsService._figures()
        after = self.figures(Sent=3)

        self.assertEqual(after["sent"] - before["sent"], 3)
        self.assertEqual(after["queued"], before["queued"])
        self.assertEqual(after["pending"], before["pending"])

    def test_the_states_that_need_a_look_keep_their_own_counters(self):
        before = NotificationSettingsService._figures()
        after = self.figures(Failed=1, Unknown=2)

        self.assertEqual(after["failed"] - before["failed"], 1)
        self.assertEqual(after["unknown"] - before["unknown"], 2)


class TestTheSameFactReadsTheSameOnEveryScreen(NotificationCase):
    """One name per rule, one sentence per code, said in the registry and nowhere else.

    The rules table showed the name an administrator gave a rule; the delivery history
    showed the key underneath it, and the reason a delivery stopped as the code the engine
    writes. Two screens, one fact, two texts.
    """

    def setUp(self):
        super().setUp()
        self.reference = f"{PREFIX}-LBL-{self.tag}"

    def history_of(self, dispatch):
        rows = NotificationDispatchService.history(page_length=200)["rows"]
        mine = [row for row in rows if row["name"] == dispatch]

        self.assertEqual(len(mine), 1)

        return mine[0]

    def test_a_delivery_is_named_after_its_rule_the_way_the_rules_table_names_it(self):
        row = NotificationSettingsService._row("request_received")
        sent = self.dispatch_row("someone@example.invalid", self.reference)

        self.assertEqual(self.history_of(sent.name)["rule_label"], row["display_name"])

    def test_a_name_an_administrator_gave_is_the_one_the_history_shows(self):
        NotificationSettingsService.save("request_received", changes={"display_name": "Ticket opened"})
        sent = self.dispatch_row("someone@example.invalid", self.reference)

        self.assertEqual(self.history_of(sent.name)["rule_label"], "Ticket opened")

    def test_a_stored_code_is_read_out_in_words(self):
        sent = self.dispatch_row("someone@example.invalid", self.reference, status="Skipped")
        frappe.db.set_value(DISPATCH, sent.name, "skip_reason", "no_longer_addressed")
        frappe.db.commit()

        self.assertEqual(
            self.history_of(sent.name)["reason_label"],
            registry.REASON_LABELS["no_longer_addressed"],
        )

    def test_what_the_mail_server_said_is_not_dressed_up(self):
        sent = self.dispatch_row("someone@example.invalid", self.reference, status="Failed")
        frappe.db.set_value(DISPATCH, sent.name, "failure_reason", "550 mailbox unavailable")
        frappe.db.commit()

        self.assertEqual(self.history_of(sent.name)["reason_label"], "550 mailbox unavailable")

    def test_the_reminder_engine_reads_its_reasons_from_the_same_place(self):
        from nexgen_msp.api.internal.services.notification_reminder_service import REASONS

        self.assertIs(REASONS, registry.REASON_LABELS)
