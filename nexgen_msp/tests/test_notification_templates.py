"""The wording of our mail: who may write it, what it may say, and in whose language it goes.

Three things are being protected here and they pull in different directions. An
administrator must be able to rewrite any of it, a half-written translation must never
reach a customer, and a mail already handed to the queue must read tomorrow exactly as it
read when it was built.
"""

import frappe

from nexgen_msp.api.internal.services import notification_registry as registry
from nexgen_msp.api.internal.services.notification_dispatch_service import (
    NotificationDispatchService,
)
from nexgen_msp.api.internal.services.notification_settings_service import (
    NotificationSettingsService,
)
from nexgen_msp.api.internal.services.notification_template_service import (
    NotificationTemplateService,
)
from nexgen_msp.utils import access, notifications
from nexgen_msp.utils.errors import NotFoundError, ValidationError

from .base import PREFIX
from .test_notification_settings import NotificationCase

LOCALE = "MSP Email Template Locale"
REVISION = "MSP Email Template Revision"
TEMPLATE = "MSP Request Received"
PROTECTED = "MSP Password Reset"


class TemplateCase(NotificationCase):
    """Leaves the site with exactly the localized wording it had before.

    The removal itself lives in NotificationCase: every suite can publish a wording, and
    a published wording changes what every later send renders.
    """

    # ------------------------------------------------------------------ helpers
    def wording(self, locale, body=None):
        return {
            "subject": f"{PREFIX} {locale} {{{{ request }}}}",
            "html": body or f"<p>{PREFIX} {locale} for {{{{ full_name }}}}</p>",
            "text": f"{PREFIX} {locale} for {{{{ full_name }}}}",
        }

    def publish(self, locale, template=TEMPLATE, body=None, note=None):
        content = self.wording(locale, body)
        NotificationTemplateService.save_draft(
            template,
            locale,
            subject=content["subject"],
            html=content["html"],
            text=content["text"],
        )

        return NotificationTemplateService.publish(template, locale, change_note=note)

    def state(self, locale, template=TEMPLATE):
        for entry in NotificationTemplateService.detail(template, locale)["locales"]:
            if entry["locale"] == locale:
                return entry

        raise AssertionError(f"{locale} is not a language of this template")

    def speaker(self, language, suffix):
        """An account whose own setting says which language it reads."""
        email = self.make_account("internal", "MSP Technician", suffix=suffix)
        frappe.db.set_value("User", email, "language", language, update_modified=False)
        self.refs["MSP Request"].add(email)

        return email


class TestEachLanguageIsWrittenOnItsOwn(TemplateCase):
    def test_a_template_starts_with_both_languages_unconfigured(self):
        for entry in NotificationTemplateService.detail(TEMPLATE)["locales"]:
            self.assertFalse(entry["configured"])
            self.assertIsNone(entry["published_revision"])
            self.assertIsNone(entry["draft_html"])

    def test_publishing_one_language_leaves_the_other_untouched(self):
        self.publish("fr")

        self.assertTrue(self.state("fr")["configured"])
        self.assertFalse(self.state("en")["configured"])
        self.assertIsNone(self.state("en")["draft_subject"])

    def test_each_language_keeps_its_own_wording(self):
        self.publish("en")
        self.publish("fr")

        self.assertIn("en", NotificationTemplateService.published(TEMPLATE, "en")["subject"])
        self.assertIn("fr", NotificationTemplateService.published(TEMPLATE, "fr")["subject"])

    def test_a_language_this_application_does_not_publish_is_refused(self):
        with self.assertRaises(ValidationError) as refused:
            NotificationTemplateService.save_draft(TEMPLATE, "de", subject="x", html="<p>x</p>")

        self.assertEqual(refused.exception.code, "VALIDATION_ERROR")

    def test_a_template_this_application_does_not_own_is_refused(self):
        with self.assertRaises(NotFoundError):
            NotificationTemplateService.detail("Password Reset")


class TestADraftChangesNothingBeingSent(TemplateCase):
    def test_saving_a_draft_publishes_nothing(self):
        NotificationTemplateService.save_draft(
            TEMPLATE, "en", subject=f"{PREFIX} draft", html="<p>draft</p>"
        )

        self.assertIsNone(NotificationTemplateService.published(TEMPLATE, "en"))
        self.assertFalse(self.state("en")["configured"])
        self.assertTrue(self.state("en")["has_unpublished_changes"])

    def test_a_draft_over_a_publication_leaves_the_publication_as_it_was(self):
        self.publish("en")
        published = NotificationTemplateService.published(TEMPLATE, "en")["subject"]

        NotificationTemplateService.save_draft(
            TEMPLATE, "en", subject=f"{PREFIX} newer", html="<p>newer</p>"
        )

        self.assertEqual(NotificationTemplateService.published(TEMPLATE, "en")["subject"], published)
        self.assertTrue(self.state("en")["has_unpublished_changes"])

    def test_a_published_draft_no_longer_reads_as_unpublished(self):
        self.publish("en")

        self.assertFalse(self.state("en")["has_unpublished_changes"])

    def test_there_is_nothing_to_publish_before_anything_is_written(self):
        with self.assertRaises(ValidationError) as refused:
            NotificationTemplateService.publish(TEMPLATE, "en")

        self.assertEqual(refused.exception.code, "VALIDATION_ERROR")


class TestAPublishedRevisionIsKeptForEver(TemplateCase):
    def test_publishing_twice_leaves_both_revisions_and_points_at_the_second(self):
        self.publish("en", note="first")
        self.publish("en", body=f"<p>{PREFIX} second</p>", note="second")

        history = NotificationTemplateService.history(TEMPLATE, "en")
        self.assertEqual([row["revision_number"] for row in history["rows"]], [2, 1])
        self.assertEqual(history["published_revision"], 2)
        self.assertEqual([row["change_note"] for row in history["rows"]], ["second", "first"])

    def test_a_revision_cannot_be_edited(self):
        self.publish("en")
        doc = frappe.get_doc(REVISION, f"{TEMPLATE}::en::1")
        doc.subject = f"{PREFIX} rewritten"

        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

    def test_a_revision_cannot_be_deleted(self):
        self.publish("en")

        with self.assertRaises(frappe.ValidationError):
            frappe.delete_doc(REVISION, f"{TEMPLATE}::en::1", ignore_permissions=True)

    def test_every_revision_carries_a_checksum_of_what_it_says(self):
        self.publish("en")
        self.publish("en", body=f"<p>{PREFIX} other</p>")
        rows = NotificationTemplateService.history(TEMPLATE, "en")["rows"]

        self.assertTrue(all(row["content_checksum"] for row in rows))
        self.assertEqual(len({row["content_checksum"] for row in rows}), 2)

    def test_restoring_an_old_revision_writes_a_new_one_rather_than_reopening_it(self):
        self.publish("en", body=f"<p>{PREFIX} one</p>")
        self.publish("en", body=f"<p>{PREFIX} two</p>")

        NotificationTemplateService.restore(TEMPLATE, "en", 1)
        NotificationTemplateService.publish(TEMPLATE, "en", change_note="back to one")

        history = NotificationTemplateService.history(TEMPLATE, "en")
        self.assertEqual([row["revision_number"] for row in history["rows"]], [3, 2, 1])
        self.assertEqual(history["published_revision"], 3)
        self.assertIn("one", NotificationTemplateService.published(TEMPLATE, "en")["html_body"])
        self.assertIn("two", frappe.db.get_value(REVISION, f"{TEMPLATE}::en::2", "html_body"))

    def test_restoring_alone_sends_nothing_new(self):
        self.publish("en", body=f"<p>{PREFIX} one</p>")
        self.publish("en", body=f"<p>{PREFIX} two</p>")

        NotificationTemplateService.restore(TEMPLATE, "en", 1)

        self.assertIn("two", NotificationTemplateService.published(TEMPLATE, "en")["html_body"])

    def test_a_revision_that_was_never_published_cannot_be_restored(self):
        with self.assertRaises(NotFoundError):
            NotificationTemplateService.restore(TEMPLATE, "en", 7)


class TestTwoAdministratorsCannotOverwriteEachOthersWording(TemplateCase):
    def test_a_draft_saved_against_a_stale_version_is_refused(self):
        NotificationTemplateService.save_draft(
            TEMPLATE, "en", subject=f"{PREFIX} first", html="<p>first</p>", draft_revision=0
        )

        with self.assertRaises(ValidationError) as conflict:
            NotificationTemplateService.save_draft(
                TEMPLATE, "en", subject=f"{PREFIX} second", html="<p>second</p>", draft_revision=0
            )

        self.assertEqual(conflict.exception.code, "VERSION_CONFLICT")
        self.assertEqual(conflict.exception.http_status_code, 409)
        self.assertEqual(self.state("en")["draft_subject"], f"{PREFIX} first")

    def test_a_draft_saved_against_the_current_version_is_accepted(self):
        NotificationTemplateService.save_draft(
            TEMPLATE, "en", subject=f"{PREFIX} first", html="<p>first</p>", draft_revision=0
        )

        NotificationTemplateService.save_draft(
            TEMPLATE, "en", subject=f"{PREFIX} second", html="<p>second</p>", draft_revision=1
        )

        self.assertEqual(self.state("en")["draft_subject"], f"{PREFIX} second")
        self.assertEqual(self.state("en")["draft_revision"], 2)

    def test_publishing_against_a_stale_version_is_refused_and_publishes_nothing(self):
        NotificationTemplateService.save_draft(
            TEMPLATE, "en", subject=f"{PREFIX} first", html="<p>first</p>"
        )

        with self.assertRaises(ValidationError) as conflict:
            NotificationTemplateService.publish(TEMPLATE, "en", draft_revision=0)

        self.assertEqual(conflict.exception.code, "VERSION_CONFLICT")
        self.assertIsNone(NotificationTemplateService.published(TEMPLATE, "en"))


class TestOnlyWhatTheTemplateWasBuiltAroundMayBeNamed(TemplateCase):
    def test_the_allowlist_is_what_the_shipped_wording_already_uses(self):
        names = {entry["name"] for entry in notifications.variables_for(TEMPLATE)}

        self.assertIn("full_name", names)
        self.assertIn("request", names)
        self.assertIn("summary", names)
        self.assertIn("app_name", names)
        self.assertNotIn("invoice_number", names)

    def test_a_name_this_template_does_not_supply_is_refused(self):
        with self.assertRaises(ValidationError) as refused:
            NotificationTemplateService.save_draft(
                TEMPLATE, "en", subject=f"{PREFIX} x", html="<p>{{ invoice_number }}</p>"
            )

        self.assertIn("invoice_number", refused.exception.args[0])

    def test_an_expression_is_not_a_placeholder(self):
        for attempt in (
            "{{ frappe.get_doc('User', 'Administrator') }}",
            "{{ full_name.upper() }}",
            "{{ request.owner }}",
            "{{ 1 + 1 }}",
            "{{ self.__class__ }}",
        ):
            with self.subTest(attempt=attempt):
                with self.assertRaises(ValidationError):
                    NotificationTemplateService.save_draft(
                        TEMPLATE, "en", subject=f"{PREFIX} x", html=f"<p>{attempt}</p>"
                    )

    def test_only_a_condition_over_a_permitted_name_is_a_statement(self):
        for attempt in (
            "{% for row in rows %}{% endfor %}",
            "{% set x = 1 %}",
            "{% include 'x.html' %}",
            "{% if invoice_number %}{% endif %}",
        ):
            with self.subTest(attempt=attempt):
                with self.assertRaises(ValidationError):
                    NotificationTemplateService.save_draft(
                        TEMPLATE, "en", subject=f"{PREFIX} x", html=f"<p>{attempt}</p>"
                    )

    def test_an_unbalanced_condition_is_refused(self):
        for attempt in ("{% if request %}<p>x</p>", "<p>x</p>{% endif %}", "{% else %}x"):
            with self.subTest(attempt=attempt):
                with self.assertRaises(ValidationError):
                    NotificationTemplateService.save_draft(
                        TEMPLATE, "en", subject=f"{PREFIX} x", html=attempt
                    )

    def test_a_condition_over_a_permitted_name_is_accepted_and_obeyed(self):
        NotificationTemplateService.save_draft(
            TEMPLATE,
            "en",
            subject=f"{PREFIX} x",
            html="<p>{% if request %}got {{ request }}{% else %}nothing{% endif %}</p>",
        )
        NotificationTemplateService.publish(TEMPLATE, "en")

        with_it = NotificationTemplateService.render(TEMPLATE, "en", {"request": "SR-1"})
        without = NotificationTemplateService.render(TEMPLATE, "en", {"request": ""})

        self.assertIn("got SR-1", with_it["html"])
        self.assertNotIn("nothing", with_it["html"])
        self.assertIn("nothing", without["html"])

    def test_a_subject_is_plain_text(self):
        with self.assertRaises(ValidationError):
            NotificationTemplateService.save_draft(
                TEMPLATE, "en", subject="<b>bold</b>", html="<p>x</p>"
            )

    def test_a_mail_with_no_subject_or_no_body_is_refused(self):
        with self.assertRaises(ValidationError):
            NotificationTemplateService.save_draft(TEMPLATE, "en", subject="", html="<p>x</p>")

        with self.assertRaises(ValidationError):
            NotificationTemplateService.save_draft(TEMPLATE, "en", subject=f"{PREFIX} x", html="  ")


class TestStoredWordingCannotCarryActiveContent(TemplateCase):
    def stored_html(self, html):
        NotificationTemplateService.save_draft(
            TEMPLATE, "en", subject=f"{PREFIX} x", html=html
        )

        return self.state("en")["draft_html"]

    def test_a_script_is_removed_with_its_contents(self):
        stored = self.stored_html("<p>keep</p><script>alert(1)</script>")

        self.assertIn("keep", stored)
        self.assertNotIn("script", stored.lower())
        self.assertNotIn("alert", stored)

    def test_an_event_handler_is_removed(self):
        stored = self.stored_html('<p onclick="alert(1)">keep</p>')

        self.assertIn("keep", stored)
        self.assertNotIn("onclick", stored.lower())

    def test_a_javascript_link_keeps_no_address_at_all(self):
        stored = self.stored_html('<a href="javascript:alert(1)">keep</a>')

        self.assertIn("keep", stored)
        self.assertNotIn("javascript", stored.lower())

    def test_an_iframe_is_removed(self):
        stored = self.stored_html('<p>keep</p><iframe src="https://example.invalid"></iframe>')

        self.assertIn("keep", stored)
        self.assertNotIn("iframe", stored.lower())

    def test_the_layout_a_mail_needs_survives(self):
        stored = self.stored_html(
            '<table role="presentation" cellpadding="0" cellspacing="0" width="100%">'
            '<tr><td align="center" style="color:#0f172a;">{{ full_name }}</td></tr></table>'
        )

        for kept in ('role="presentation"', 'cellpadding="0"', 'width="100%"', 'align="center"'):
            self.assertIn(kept, stored)

        self.assertIn("{{ full_name }}", stored)


class TestAValueIsEscapedForWhereItLands(TemplateCase):
    def setUp(self):
        super().setUp()
        NotificationTemplateService.save_draft(
            TEMPLATE,
            "en",
            subject=f"{PREFIX} {{{{ request }}}}",
            html="<p>{{ full_name }}</p>{{ summary }}<a href=\"{{ link }}\">go</a>",
            text="{{ full_name }} / {{ summary }} / {{ link }}",
        )
        NotificationTemplateService.publish(TEMPLATE, "en")

    def render(self, **context):
        return NotificationTemplateService.render(
            TEMPLATE,
            "en",
            {
                "full_name": "<b>Marie</b>",
                "request": "SR-1",
                "summary": "<table><tr><td>Customer</td><td>ZZTEST</td></tr></table>",
                "link": "https://example.invalid/msp",
                **context,
            },
        )

    def test_a_text_value_is_escaped_in_the_html_body(self):
        self.assertIn("&lt;b&gt;Marie&lt;/b&gt;", self.render()["html"])

    def test_our_own_html_is_inserted_as_html(self):
        self.assertIn("<table>", self.render()["html"])

    def test_our_own_html_is_read_as_lines_in_the_plain_text_body(self):
        text = self.render()["text"]

        self.assertIn("Customer: ZZTEST", text)
        self.assertNotIn("<table>", text)

    def test_a_text_value_is_not_escaped_in_the_plain_text_body(self):
        self.assertIn("<b>Marie</b>", self.render()["text"])

    def test_a_link_that_is_not_a_web_address_becomes_no_address(self):
        rendered = self.render(link="javascript:alert(1)")

        self.assertNotIn("javascript", rendered["html"].lower())
        self.assertIn('href=""', rendered["html"])

    def test_a_value_the_record_does_not_have_renders_as_nothing(self):
        self.assertIn("<p></p>", self.render(full_name=None)["html"])

    def test_the_subject_is_read_as_plain_text_so_nothing_is_escaped_into_entities(self):
        subject = self.render(request="<i>SR-1</i>")["subject"]

        self.assertIn("<i>SR-1</i>", subject)
        self.assertNotIn("&lt;", subject)


class TestALanguageIsOnlyEverSomebodysOwnWord(TemplateCase):
    def test_a_regional_variant_is_read_as_the_language_it_is(self):
        for stored, expected in (
            ("fr-CA", "fr"),
            ("fr_BE", "fr"),
            ("FR", "fr"),
            ("en-GB", "en"),
            ("en-US", "en"),
        ):
            with self.subTest(stored=stored):
                self.assertEqual(NotificationTemplateService.normalise_locale(stored), expected)

    def test_a_language_this_application_does_not_publish_is_no_preference_at_all(self):
        for stored in ("de", "es-MX", "", None, "zz"):
            with self.subTest(stored=stored):
                self.assertIsNone(NotificationTemplateService.normalise_locale(stored))

    def test_the_account_setting_is_what_decides(self):
        reader = self.speaker("fr", f"lf{self.tag[:3]}")

        self.assertEqual(
            NotificationTemplateService.locale_for(reader),
            {"locale": "fr", "source": "account"},
        )

    def test_the_customer_is_asked_only_when_the_account_says_nothing(self):
        self.customer = self.make_customer(f"TL{self.tag[:4]}")
        frappe.db.set_value("Customer", self.customer, "language", "fr", update_modified=False)
        reader = self.make_account("internal", "MSP Technician", suffix=f"lc{self.tag[:3]}")
        frappe.db.set_value("User", reader, "language", None, update_modified=False)

        self.assertEqual(
            NotificationTemplateService.locale_for(reader, self.customer),
            {"locale": "fr", "source": "customer"},
        )

    def test_the_account_setting_wins_over_the_customers(self):
        self.customer = self.make_customer(f"TW{self.tag[:4]}")
        frappe.db.set_value("Customer", self.customer, "language", "fr", update_modified=False)
        reader = self.speaker("en", f"lw{self.tag[:3]}")

        self.assertEqual(
            NotificationTemplateService.locale_for(reader, self.customer),
            {"locale": "en", "source": "account"},
        )

    def test_nobody_having_said_anything_is_recorded_as_exactly_that(self):
        reader = self.make_account("internal", "MSP Technician", suffix=f"ln{self.tag[:3]}")
        frappe.db.set_value("User", reader, "language", None, update_modified=False)

        self.assertEqual(
            NotificationTemplateService.locale_for(reader),
            {"locale": registry.FALLBACK_LOCALE, "source": "fallback"},
        )

    def test_a_language_is_never_read_off_an_address(self):
        reader = self.make_account("internal", "MSP Technician", suffix=f"lb{self.tag[:3]}")
        frappe.db.set_value("User", reader, "language", None, update_modified=False)
        frappe.db.set_value("User", reader, "first_name", "Jean-Baptiste", update_modified=False)

        self.assertEqual(NotificationTemplateService.locale_for(reader)["source"], "fallback")


class TestWhatAnAddressIsActuallySent(TemplateCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer(f"TS{self.tag[:4]}")

    def built(self, address, **context):
        return NotificationTemplateService.for_delivery(
            TEMPLATE, address, self.customer, {**self.context(), **context}
        )

    def test_a_published_french_variant_reaches_a_french_reader(self):
        self.publish("fr")
        self.publish("en")
        built = self.built(self.speaker("fr", f"sf{self.tag[:3]}"))

        self.assertEqual(built["locale"], "fr")
        self.assertEqual(built["language_source"], "account")
        self.assertIsNone(built["fallback_reason"])
        self.assertIn("fr", built["subject"])

    def test_a_published_english_variant_reaches_an_english_reader(self):
        self.publish("fr")
        self.publish("en")
        built = self.built(self.speaker("en", f"se{self.tag[:3]}"))

        self.assertEqual(built["locale"], "en")
        self.assertIn("en", built["subject"])

    def test_a_reader_with_no_preference_gets_the_fallback_language_and_it_says_so(self):
        self.publish("en")
        reader = self.make_account("internal", "MSP Technician", suffix=f"sn{self.tag[:3]}")
        frappe.db.set_value("User", reader, "language", None, update_modified=False)
        # the company has to be silent too, or it is the company that answers — which is
        # the point of the level below, tested on its own
        frappe.db.set_value("Customer", self.customer, "language", None, update_modified=False)
        built = self.built(reader)

        self.assertEqual(built["locale"], registry.FALLBACK_LOCALE)
        self.assertEqual(built["language_source"], "fallback")
        self.assertEqual(built["fallback_reason"], "no_preference")

    def test_a_french_reader_whose_variant_is_unpublished_gets_the_fallback_and_it_says_so(self):
        self.publish("en")
        built = self.built(self.speaker("fr", f"su{self.tag[:3]}"))

        self.assertEqual(built["locale"], "en")
        self.assertEqual(built["language_source"], "account")
        self.assertEqual(built["fallback_reason"], "variant_not_published")

    def test_a_missing_translation_is_never_invented(self):
        self.publish("en", body=f"<p>{PREFIX} english only</p>")
        built = self.built(self.speaker("fr", f"sm{self.tag[:3]}"))

        self.assertIn("english only", built["html"])
        self.assertIsNone(NotificationTemplateService.published(TEMPLATE, "fr"))

    def test_with_nothing_published_at_all_the_original_template_is_what_goes_out(self):
        built = self.built(self.speaker("fr", f"sl{self.tag[:3]}"))

        self.assertIsNone(built["locale"])
        self.assertIsNone(built["revision"])
        self.assertEqual(built["fallback_reason"], "legacy_template")
        self.assertIn("queued for review", built["html"])

    def test_a_security_notification_still_goes_out_with_no_variant_published(self):
        built = NotificationTemplateService.for_delivery(
            PROTECTED,
            self.speaker("fr", f"sp{self.tag[:3]}"),
            None,
            {"full_name": "Marie", "link": "https://example.invalid/reset"},
        )

        self.assertEqual(built["fallback_reason"], "legacy_template")
        self.assertIn("Password reset", built["html"])

    def test_the_revision_a_delivery_used_is_the_one_it_names(self):
        self.publish("en", body=f"<p>{PREFIX} one</p>")
        first = self.built(self.speaker("en", f"sr{self.tag[:3]}"))
        self.publish("en", body=f"<p>{PREFIX} two</p>")
        second = self.built(self.speaker("en", f"sr{self.tag[:3]}"))

        self.assertEqual(first["revision"], 1)
        self.assertEqual(second["revision"], 2)


class TestAnAudienceThatDoesNotShareALanguageGetsSeveralMails(TemplateCase):
    """One message cannot be in two languages, so an audience that does not share one
    becomes several messages — each traceable on its own, and nobody told in a language
    somebody else chose."""

    def setUp(self):
        super().setUp()
        self.publish("en")
        self.publish("fr")

    def mails_to(self, address):
        return frappe.db.sql(
            """select q.name, q.message from `tabEmail Queue` q
            join `tabEmail Queue Recipient` r on r.parent = q.name
            where r.recipient = %s""",
            address,
            as_dict=True,
        )

    def test_each_reader_gets_one_mail_in_their_own_language(self):
        english = self.speaker("en", f"me{self.tag[:3]}")
        french = self.speaker("fr", f"mf{self.tag[:3]}")
        reference = self.reference("mix")

        notifications.send(
            "MSP Request Received",
            [english, french],
            self.context(),
            reference_doctype="MSP Request",
            reference_name=reference,
        )

        for address, expected, other in ((english, "en", "fr"), (french, "fr", "en")):
            with self.subTest(address=address):
                mails = self.mails_to(address)
                self.assertEqual(len(mails), 1)
                self.assertIn(f"{PREFIX} {expected}", mails[0].message)
                self.assertNotIn(f"{PREFIX} {other}", mails[0].message)

    def test_the_two_mails_are_two_queue_entries(self):
        english = self.speaker("en", f"qe{self.tag[:3]}")
        french = self.speaker("fr", f"qf{self.tag[:3]}")
        reference = self.reference("two")

        notifications.send(
            "MSP Request Received",
            [english, french],
            self.context(),
            reference_doctype="MSP Request",
            reference_name=reference,
        )

        self.assertNotEqual(self.mails_to(english)[0].name, self.mails_to(french)[0].name)

    def test_readers_of_one_language_still_share_one_mail(self):
        first = self.speaker("fr", f"s1{self.tag[:3]}")
        second = self.speaker("fr", f"s2{self.tag[:3]}")
        reference = self.reference("one")

        notifications.send(
            "MSP Request Received",
            [first, second],
            self.context(),
            reference_doctype="MSP Request",
            reference_name=reference,
        )

        self.assertEqual(self.mails_to(first)[0].name, self.mails_to(second)[0].name)

    def test_every_reader_gets_their_own_delivery_record_naming_their_language(self):
        english = self.speaker("en", f"de{self.tag[:3]}")
        french = self.speaker("fr", f"df{self.tag[:3]}")
        reference = self.reference("rec")

        notifications.send(
            "MSP Request Received",
            [english, french],
            self.context(),
            reference_doctype="MSP Request",
            reference_name=reference,
        )

        rows = {
            row.recipient: row
            for row in frappe.get_all(
                "MSP Notification Dispatch",
                filters={"business_name": reference},
                fields=["recipient", "resolved_locale", "template_revision", "language_source"],
            )
        }

        self.assertEqual(rows[english].resolved_locale, "en")
        self.assertEqual(rows[french].resolved_locale, "fr")
        self.assertEqual(rows[english].template_revision, 1)
        self.assertEqual(rows[french].language_source, "account")


class TestAQueuedMailIsNotChangedByALaterPublication(TemplateCase):
    def test_publishing_again_leaves_an_already_queued_delivery_naming_its_own_revision(self):
        self.publish("en", body=f"<p>{PREFIX} first wording</p>")
        reader = self.speaker("en", f"st{self.tag[:3]}")
        reference = self.reference("stable")

        notifications.send(
            "MSP Request Received",
            [reader],
            self.context(),
            reference_doctype="MSP Request",
            reference_name=reference,
        )
        self.publish("en", body=f"<p>{PREFIX} second wording</p>")

        row = frappe.db.get_value(
            "MSP Notification Dispatch",
            {"business_name": reference, "recipient": reader},
            ["template_revision", "resolved_locale"],
            as_dict=True,
        )
        queued = frappe.db.sql(
            """select q.message from `tabEmail Queue` q
            join `tabEmail Queue Recipient` r on r.parent = q.name
            where r.recipient = %s""",
            reader,
        )

        self.assertEqual(row.template_revision, 1)
        self.assertEqual(len(queued), 1)
        self.assertIn("first wording", queued[0][0])

    def test_publishing_again_queues_nothing_by_itself(self):
        self.publish("en")
        before = frappe.db.count("Email Queue")

        self.publish("en", body=f"<p>{PREFIX} later</p>")

        self.assertEqual(frappe.db.count("Email Queue"), before)


class TestAPreviewSendsNothing(TemplateCase):
    def test_a_preview_of_a_draft_shows_the_draft(self):
        NotificationTemplateService.save_draft(
            TEMPLATE, "fr", subject=f"{PREFIX} fr {{{{ request }}}}", html="<p>{{ full_name }}</p>"
        )
        before = frappe.db.count("Email Queue")

        preview = NotificationTemplateService.preview(TEMPLATE, "fr", source="draft")

        self.assertIn(PREFIX, preview["subject"])
        self.assertIn("Sample Recipient", preview["html"])
        self.assertEqual(frappe.db.count("Email Queue"), before)

    def test_a_preview_of_what_is_published_shows_what_is_published(self):
        self.publish("en", body=f"<p>{PREFIX} published wording</p>")
        NotificationTemplateService.save_draft(
            TEMPLATE, "en", subject=f"{PREFIX} newer", html=f"<p>{PREFIX} newer wording</p>"
        )

        self.assertIn(
            "published wording",
            NotificationTemplateService.preview(TEMPLATE, "en", source="published")["html"],
        )
        self.assertIn(
            "newer wording",
            NotificationTemplateService.preview(TEMPLATE, "en", source="draft")["html"],
        )

    def test_a_preview_of_a_language_with_nothing_in_it_says_so(self):
        with self.assertRaises(NotFoundError):
            NotificationTemplateService.preview(TEMPLATE, "fr", source="draft")

        with self.assertRaises(NotFoundError):
            NotificationTemplateService.preview(TEMPLATE, "fr", source="published")

    def test_every_managed_template_previews_with_the_sample_values(self):
        for name in registry.BY_TEMPLATE:
            with self.subTest(template=name):
                NotificationTemplateService.save_draft(
                    name, "en", subject=f"{PREFIX} {{{{ app_name }}}}", html=notifications.shipped_html(name)
                )
                preview = NotificationTemplateService.preview(name, "en", source="draft")
                self.assertTrue(preview["html"])


class TestATestSendGoesOnlyToAnAdministrator(TemplateCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer(f"TT{self.tag[:4]}")
        self.admin = self.make_account("internal", "MSP System Admin", suffix=f"ta{self.tag[:3]}")
        self.technician = self.make_account("internal", "MSP Technician", suffix=f"tt{self.tag[:3]}")
        NotificationTemplateService.save_draft(
            TEMPLATE, "fr", subject=f"{PREFIX} fr draft", html=f"<p>{PREFIX} fr draft</p>"
        )

    def test_a_draft_can_be_tested_before_it_is_published(self):
        out = NotificationTemplateService.test_send(TEMPLATE, "fr", self.admin, source="draft")

        self.assertEqual(out["status"], "Queued")
        self.assertEqual(self.queued_to(self.admin), 1)
        self.assertIsNone(NotificationTemplateService.published(TEMPLATE, "fr"))

    def test_a_test_cannot_be_sent_to_somebody_who_is_not_an_administrator(self):
        with self.assertRaises(ValidationError) as refused:
            NotificationTemplateService.test_send(TEMPLATE, "fr", self.technician)

        self.assertEqual(refused.exception.http_status_code, 403)
        self.assertEqual(self.queued_to(self.technician), 0)

    def test_a_test_cannot_be_sent_to_an_address_somebody_simply_typed(self):
        with self.assertRaises(ValidationError):
            NotificationTemplateService.test_send(
                TEMPLATE, "fr", f"{PREFIX.lower()}.stranger@example.invalid"
            )

    def test_a_test_is_marked_as_one_and_counts_as_no_reminder(self):
        NotificationTemplateService.test_send(TEMPLATE, "fr", self.admin, source="draft")
        rows = frappe.get_all(
            "MSP Notification Dispatch",
            filters={"recipient": self.admin},
            fields=["is_test", "reminder_iteration"],
        )

        self.assertTrue(rows)
        self.assertTrue(all(row.is_test for row in rows))
        self.assertTrue(all(row.reminder_iteration == 0 for row in rows))

    def test_three_tests_in_a_row_all_go_out(self):
        for _ in range(3):
            NotificationTemplateService.test_send(TEMPLATE, "fr", self.admin, source="draft")

        self.assertEqual(self.queued_to(self.admin), 3)


class TestOnlyAnAdministratorMayWriteOurMail(TemplateCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer(f"TP{self.tag[:4]}")
        self.admin = self.make_account("internal", "MSP System Admin", suffix=f"pa{self.tag[:3]}")
        self.technician = self.make_account("internal", "MSP Technician", suffix=f"pt{self.tag[:3]}")
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"pm{self.tag[:3]}"
        )

    def doors(self):
        return {
            "overview": lambda: NotificationTemplateService.overview(),
            "detail": lambda: NotificationTemplateService.detail(TEMPLATE, "en"),
            "history": lambda: NotificationTemplateService.history(TEMPLATE, "en"),
            "draft": lambda: NotificationTemplateService.save_draft(
                TEMPLATE, "en", subject=f"{PREFIX} x", html="<p>x</p>"
            ),
            "publish": lambda: NotificationTemplateService.publish(TEMPLATE, "en"),
            "restore": lambda: NotificationTemplateService.restore(TEMPLATE, "en", 1),
            "preview": lambda: NotificationTemplateService.preview(TEMPLATE, "en"),
            "test": lambda: NotificationTemplateService.test_send(TEMPLATE, "en", self.admin),
        }

    def test_an_administrator_is_let_through_every_door(self):
        for door in ("overview", "detail", "history", "draft", "publish", "preview"):
            with self.subTest(door=door):
                self.assertIsNotNone(self.as_user(self.admin, self.doors()[door]))

    def test_a_technician_and_a_customer_manager_are_refused_at_every_door(self):
        for user in (self.technician, self.manager):
            for door, call in self.doors().items():
                with self.subTest(user=user, door=door):
                    with self.assertRaises(ValidationError) as refused:
                        self.as_user(user, call)

                    self.assertEqual(refused.exception.code, access.REFUSED)
                    self.assertEqual(refused.exception.http_status_code, 403)

    def test_a_refused_draft_is_not_written(self):
        with self.assertRaises(ValidationError):
            self.as_user(self.technician, self.doors()["draft"])

        self.assertFalse(frappe.db.exists(LOCALE, f"{TEMPLATE}::en"))

    def test_neither_store_may_be_written_through_the_doctype_permissions(self):
        for doctype in (LOCALE, REVISION):
            for role in ("MSP System Admin", "System Manager"):
                permission = frappe.db.get_value(
                    "DocPerm", {"parent": doctype, "role": role}, ["read", "write", "create", "delete"], as_dict=True
                )

                with self.subTest(doctype=doctype, role=role):
                    self.assertEqual(permission.read, 1)
                    self.assertEqual(permission.write, 0)
                    self.assertEqual(permission.create, 0)
                    self.assertEqual(permission.delete, 0)


class TestLocalizedWordingSurvivesAMigration(TemplateCase):
    def test_a_published_revision_is_untouched_by_the_template_seed(self):
        self.publish("fr", body=f"<p>{PREFIX} notre formulation</p>")

        notifications.ensure_templates()
        NotificationSettingsService.seed()

        published = NotificationTemplateService.published(TEMPLATE, "fr")
        self.assertIn("notre formulation", published["html_body"])
        self.assertEqual(published["revision_number"], 1)

    def test_a_language_nobody_configured_stays_unconfigured(self):
        notifications.ensure_templates()
        NotificationSettingsService.seed()

        for entry in NotificationTemplateService.detail(TEMPLATE)["locales"]:
            with self.subTest(locale=entry["locale"]):
                self.assertFalse(entry["configured"])
                self.assertIsNone(entry["draft_html"])

    def test_the_original_template_is_left_exactly_as_it_was(self):
        before = frappe.db.get_value(
            "Email Template", TEMPLATE, ["subject", "response_html"], as_dict=True
        )
        self.publish("en")

        notifications.ensure_templates()

        after = frappe.db.get_value(
            "Email Template", TEMPLATE, ["subject", "response_html"], as_dict=True
        )
        self.assertEqual(dict(before), dict(after))

    def test_running_the_seed_twice_adds_no_second_revision(self):
        self.publish("en")

        notifications.ensure_templates()
        NotificationSettingsService.seed()
        notifications.ensure_templates()
        NotificationSettingsService.seed()

        self.assertEqual(len(NotificationTemplateService.history(TEMPLATE, "en")["rows"]), 1)
