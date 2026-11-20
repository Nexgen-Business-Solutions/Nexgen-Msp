"""#47: two workers meeting on one comment, on real connections to the real engine.

The immediate send that follows a post and the sweep that comes round for what is owed
can land on the same message at the same time. Everything else about that guarantee can
be argued from the code; this is the only place it is shown — two database connections,
one row, and a count of what actually reached the mail queue.

Deliberately not in the fast suite's style: it starts threads, each with its own Frappe
connection, and synchronises them with events rather than with sleeps.
"""

import threading
from unittest.mock import patch

import frappe

from nexgen_msp.api.internal.services.request_comment_service import RequestCommentService
from nexgen_msp.utils import notifications

from .test_request_comments import CommentCase

COMMENT = "MSP Request Comment"
REQUEST = "MSP Request"
WAIT = 30


class TwoWorkerCase(CommentCase):
    """A worker is a thread with a connection of its own, as a background job would be."""

    def worker(self, label, work, outcome):
        site = frappe.local.site

        def run():
            frappe.init(site=site)
            frappe.connect()
            try:
                outcome[label] = work()
            except Exception as error:  # recorded rather than swallowed into a dead thread
                outcome[label] = error
            finally:
                frappe.db.commit()
                frappe.destroy()

        thread = threading.Thread(target=run, name=label, daemon=True)
        thread.start()

        return thread


class TestTwoWorkersOnOneComment(TwoWorkerCase):
    def test_the_second_waits_and_queues_nothing_more(self):
        name = self.approved(self.awaiting())

        with patch.object(notifications, "send", return_value=False):
            written = self.post(self.tech, name, "Said once, to both of them.")

        frappe.db.commit()
        holding = threading.Event()
        carry_on = threading.Event()
        calls = []
        outcome = {}

        def sending(*args, **kwargs):
            calls.append(threading.current_thread().name)

            if threading.current_thread().name == "first":
                holding.set()
                carry_on.wait(WAIT)

            return True

        def deliver():
            return RequestCommentService._deliver(
                frappe.get_doc(REQUEST, name), frappe.get_doc(COMMENT, written["name"])
            )

        with patch.object(notifications, "send", side_effect=sending):
            first = self.worker("first", deliver, outcome)

            self.assertTrue(holding.wait(WAIT), "the first worker took the row and is sending")

            second = self.worker("second", deliver, outcome)
            second.join(timeout=2)

            self.assertTrue(second.is_alive(), "the second worker waits on the row it cannot have")

            carry_on.set()
            first.join(timeout=WAIT)
            second.join(timeout=WAIT)

        # this connection has a snapshot of its own, opened before the workers wrote: what
        # they committed is read by starting a transaction after them, not before
        frappe.db.commit()

        self.assertFalse(first.is_alive(), "no deadlock")
        self.assertFalse(second.is_alive(), "no deadlock")
        self.assertEqual(calls, ["first"], "one message, one send")
        self.assertEqual(outcome, {"first": True, "second": True})
        self.assertEqual(frappe.db.get_value(COMMENT, written["name"], "notified"), 1)

    def test_what_one_of_them_queued_the_other_does_not_queue_again(self):
        """The partial failure: the first hands one address over and then falls over."""
        from nexgen_msp.api.internal.services.notification_dispatch_service import (
            NotificationDispatchService,
        )

        name = self.approved(self.awaiting())

        with patch.object(notifications, "send", return_value=False):
            written = self.post(self.tech, name, "Half of it went out.")

        NotificationDispatchService.record_event(
            rule_key="request_comment_for_customer",
            revision=1,
            recipient=self.asker,
            channel="To",
            template_name="MSP Request Comment For Customer",
            subject="[MSP Request] New comment",
            occurrence=f"event:comment:{written['name']}",
            queue_id=None,
            business_doctype=REQUEST,
            business_name=name,
        )
        frappe.db.commit()
        before = self.queued_to(self.asker)
        outcome = {}

        worker = self.worker(
            "sweep", lambda: RequestCommentService.deliver_owed(), outcome
        )
        worker.join(timeout=WAIT)
        frappe.db.commit()

        self.assertFalse(worker.is_alive(), "no deadlock")
        self.assertEqual(
            self.queued_to(self.asker), before, "an address already handed over is not written again"
        )
        self.assertEqual(frappe.db.get_value(COMMENT, written["name"], "notified"), 1)
