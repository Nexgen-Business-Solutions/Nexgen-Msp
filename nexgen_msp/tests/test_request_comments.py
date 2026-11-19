"""#47: the conversation a request carries, and everybody it must not reach.

The interesting cases are the ones where a reader is not entitled to the request at all:
a conversation must never become a second door into a request, nor a way to learn that one
exists. The rest is the ordinary life of a thread — written once, read by both sides, and
carried over whole when the company hands the request to us.
"""

import frappe

from nexgen_msp.api.internal.services.request_comment_service import RequestCommentService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import NotFoundError, ValidationError

from .test_notification_reminders import RequestCase

COMMENT = "MSP Request Comment"
REQUEST = "MSP Request"


class CommentCase(RequestCase):
    def setUp(self):
        super().setUp()
        self.written = []

    def tearDown(self):
        if self.written:
            frappe.db.sql(
                "delete from `tabMSP Request Comment` where name in %s", (tuple(self.written),)
            )
            frappe.db.commit()

        super().tearDown()

    def post(self, user, request, body="Could you confirm the date?", key=None):
        out = self.as_user(
            user,
            lambda: RequestCommentService.post(
                request=request,
                body=body,
                idempotency_key=key or frappe.generate_hash(length=12),
            ),
        )
        self.written.append(out["name"])

        return out

    def thread(self, user, request):
        return self.as_user(user, lambda: RequestCommentService.thread(request=request))

    def refused(self, fn):
        with self.assertRaises((NotFoundError, ValidationError)):
            fn()

    def approved(self, name):
        self.as_user(self.approver, lambda: PortalService.approve_request(name=name))
        frappe.db.commit()

        return name

    def rows(self, request):
        return frappe.get_all(COMMENT, filters={"request": request}, pluck="name")


class TestWhoMayOpenAConversation(CommentCase):
    def test_a_draft_carries_no_conversation_even_for_the_person_who_wrote_it(self):
        name = self.submitted()
        frappe.db.set_value(REQUEST, name, "status", "Draft", update_modified=False)
        frappe.db.commit()

        self.refused(lambda: self.thread(self.approver, name))
        self.refused(lambda: self.post(self.approver, name))
        self.refused(lambda: self.thread(self.tech, name))
        self.assertEqual(self.rows(name), [])

    def test_our_team_cannot_read_a_request_its_company_has_not_sent_yet(self):
        name = self.awaiting()

        self.refused(lambda: self.thread(self.tech, name))
        self.refused(lambda: self.post(self.tech, name))

    def test_a_request_that_does_not_exist_reads_the_same_as_one_that_is_not_yours(self):
        name = self.awaiting()
        other = self.make_account(
            "customer", "MSP Customer Manager", self.make_customer(f"OT{self.tag[:4]}")
        )

        with self.assertRaises(NotFoundError) as refused:
            self.thread(other, name)

        with self.assertRaises(NotFoundError) as missing:
            self.thread(other, f"{name}-NOPE")

        self.assertEqual(
            str(refused.exception).replace(name, "X"),
            str(missing.exception).replace(f"{name}-NOPE", "X"),
        )


class TestTheCompanyTalksBeforeItSends(CommentCase):
    def test_the_requester_and_the_approver_answer_each_other(self):
        name = self.awaiting()

        self.post(self.asker, name, "Is this the right licence count?")
        self.post(self.approver, name, "Yes, go ahead.")

        read = self.thread(self.asker, name)

        self.assertEqual([row["body"] for row in read["comments"]],
                         ["Is this the right licence count?", "Yes, go ahead."])
        self.assertEqual({row["side"] for row in read["comments"]}, {"Customer"})
        self.assertTrue(read["awaiting_customer_approval"])

    def test_nobody_of_ours_is_written_to_before_the_request_is_sent(self):
        name = self.awaiting()
        before = self.queued_to(self.tech)

        self.post(self.asker, name, "Please confirm.")

        self.assertEqual(self.queued_to(self.tech), before)
        self.assertGreater(self.queued_to(self.approver), 0)

    def test_posting_decides_nothing_about_the_request(self):
        name = self.awaiting()

        self.post(self.asker, name, "A question before you decide.")

        self.assertEqual(
            frappe.db.get_value(REQUEST, name, "status"), "Awaiting Customer Approval"
        )


class TestTheThreadIsCarriedOverWhole(CommentCase):
    def test_our_team_reads_what_was_written_before_the_handover(self):
        name = self.awaiting()
        self.post(self.asker, name, "Before the handover.")
        self.approved(name)

        read = self.thread(self.tech, name)

        self.assertEqual([row["body"] for row in read["comments"]], ["Before the handover."])
        self.assertEqual(read["side"], "MSP")
        self.assertEqual(len(self.rows(name)), 1, "the same thread, not a copy of it")

    def test_both_sides_then_read_the_same_thread_in_the_same_order(self):
        name = self.approved(self.awaiting())
        self.post(self.tech, name, "We have started.")
        self.post(self.asker, name, "Thank you.")

        ours = self.thread(self.tech, name)["comments"]
        theirs = self.thread(self.asker, name)["comments"]

        self.assertEqual([row["name"] for row in ours], [row["name"] for row in theirs])
        self.assertEqual([row["side"] for row in ours], ["MSP", "Customer"])


class TestWhoIsWrittenToOnceTheRequestIsOurs(CommentCase):
    def test_a_comment_of_ours_reaches_the_company_and_not_its_author(self):
        name = self.approved(self.awaiting())
        before = self.queued_to(self.tech)

        self.post(self.tech, name, "We need one more detail.")

        self.assertGreater(self.queued_to(self.asker), 0)
        self.assertEqual(self.queued_to(self.tech), before, "nobody is sent their own comment")

    def test_a_comment_of_theirs_reaches_our_team(self):
        name = self.approved(self.awaiting())
        before = self.queued_to(self.asker)

        self.post(self.asker, name, "Here is the detail.")

        self.assertGreater(self.queued_to(self.tech), 0)
        self.assertEqual(self.queued_to(self.asker), before)


class TestSayingItOnce(CommentCase):
    def test_the_same_key_twice_is_the_same_comment(self):
        name = self.approved(self.awaiting())
        key = frappe.generate_hash(length=12)

        first = self.post(self.tech, name, "Only once.", key=key)
        second = self.post(self.tech, name, "Only once.", key=key)

        self.assertEqual(first["name"], second["name"])
        self.assertEqual(len(self.rows(name)), 1)

    def test_two_keys_are_two_comments(self):
        name = self.approved(self.awaiting())

        self.post(self.tech, name, "First.")
        self.post(self.tech, name, "Second.")

        self.assertEqual(len(self.rows(name)), 2)


class TestWhatACommentMayHold(CommentCase):
    def test_an_empty_comment_is_refused_and_nothing_is_written(self):
        name = self.approved(self.awaiting())

        self.refused(lambda: self.post(self.tech, name, "   \n  "))
        self.assertEqual(self.rows(name), [])

    def test_a_comment_longer_than_the_limit_is_refused(self):
        name = self.approved(self.awaiting())

        self.refused(lambda: self.post(self.tech, name, "x" * 4001))
        self.assertEqual(self.rows(name), [])

    def test_a_comment_is_kept_as_text_and_escaped_where_it_is_shown(self):
        name = self.approved(self.awaiting())
        written = "<script>alert(1)</script>\nsecond line"

        self.post(self.tech, name, written)
        read = self.thread(self.asker, name)["comments"][0]
        doc = frappe.get_doc(COMMENT, read["name"])
        context = RequestCommentService._context(
            frappe.get_doc(REQUEST, name), doc
        )

        self.assertEqual(read["body"], written)
        self.assertNotIn("<script>", context["comment_body"])
        self.assertIn("&lt;script&gt;", context["comment_body"])
        self.assertIn("<br>", context["comment_body"])


class TestAWrittenCommentStays(CommentCase):
    def test_it_can_be_neither_changed_nor_deleted(self):
        name = self.approved(self.awaiting())
        written = self.post(self.tech, name, "As it was said.")
        doc = frappe.get_doc(COMMENT, written["name"])
        doc.body = "As it was not said."

        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

        with self.assertRaises(frappe.ValidationError):
            frappe.delete_doc(COMMENT, written["name"], ignore_permissions=True)


class TestWhatIsClosedWhenTheWorkIsDone(CommentCase):
    """The exchange about a request ends with the request; what was said stays readable."""

    def completed(self):
        name = self.approved(self.awaiting())
        self.post(self.tech, name, "Done on our side.")
        frappe.db.set_value(REQUEST, name, "status", "Completed", update_modified=False)
        frappe.db.commit()

        return name

    def test_a_completed_request_takes_no_new_comment(self):
        name = self.completed()

        self.refused(lambda: self.post(self.tech, name, "One more thing."))
        self.refused(lambda: self.post(self.asker, name, "And from us."))
        self.assertEqual(len(self.rows(name)), 1)

    def test_what_was_said_is_still_read_by_both_sides(self):
        name = self.completed()

        ours = self.thread(self.tech, name)
        theirs = self.thread(self.asker, name)

        self.assertEqual([row["body"] for row in ours["comments"]], ["Done on our side."])
        self.assertEqual([row["body"] for row in theirs["comments"]], ["Done on our side."])
        self.assertFalse(ours["may_post"])
        self.assertFalse(theirs["may_post"])


class TestNothingOfOursIsCopiedBeforeTheHandover(CommentCase):
    """A copy policy is a standing instruction; it must not reach a conversation that is
    not ours yet. The notification for that stage is declared with no copy sources at all,
    so this holds by construction rather than by vigilance."""

    def test_the_rule_for_that_stage_admits_no_copy_at_all(self):
        from nexgen_msp.api.internal.services import notification_registry as registry

        self.assertEqual(registry.copy_sources("request_comment_before_handover"), ())

    def test_a_fixed_internal_address_hears_nothing_until_the_request_is_sent(self):
        from nexgen_msp.api.internal.services.notification_settings_service import (
            NotificationSettingsService,
        )

        desk = f"zztest.desk{self.tag}@example.invalid"
        NotificationSettingsService.save(
            "request_comment_for_customer",
            changes={
                "recipients": [
                    {
                        "channel": "CC",
                        "recipient_source": None,
                        "fixed_address": desk,
                        "enabled": True,
                    }
                ]
            },
        )
        frappe.db.commit()
        name = self.awaiting()

        self.post(self.asker, name, "Still ours to decide.")

        self.assertEqual(self.queued_to(desk), 0)
        self.assertEqual(self.queued_to(self.tech), 0)
