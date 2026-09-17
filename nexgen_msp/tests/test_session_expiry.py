"""A session idle past its own limit ends, whether it is read from the cache or the table.

Frappe checks a session's own idle limit only when the session comes out of the cache. Once the
cache is emptied — a restart, a deploy — the session is read back from the table and weighed
against the site-wide limit instead, and a customer idle for a day came back to life.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.test_api import make_request
from frappe.utils import get_test_client

from nexgen_msp.utils import session_timeout

from .base import MSPTestCase


class TestAnIdleSessionIsOver(MSPTestCase):
    def test_idle_past_its_limit_is_over(self):
        nine_hours_ago = frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-9)

        self.assertTrue(
            session_timeout.has_expired({"session_expiry": "08:00:00", "last_updated": str(nine_hours_ago)})
        )

    def test_idle_within_its_limit_is_not(self):
        an_hour_ago = frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-1)

        self.assertFalse(
            session_timeout.has_expired({"session_expiry": "08:00:00", "last_updated": str(an_hour_ago)})
        )

    def test_a_session_that_says_nothing_about_its_limit_is_left_alone(self):
        self.assertFalse(session_timeout.has_expired({}))
        self.assertFalse(session_timeout.has_expired(None))


class TestASessionReadBackFromTheTable(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", self.customer)
        self.account = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"se{self.tag[:3]}"
        )

    def tearDown(self):
        frappe.db.delete("Sessions", {"user": self.account})
        frappe.db.commit()
        super().tearDown()

    def opened(self, idle_hours, limit="08:00:00"):
        """A session for the account, idle that long, and gone from the cache as after a restart."""
        from frappe.auth import CookieManager, LoginManager
        from frappe.utils import set_request

        set_request(path="/")
        frappe.local.cookie_manager = CookieManager()
        frappe.local.login_manager = LoginManager()
        frappe.local.login_manager.login_as(self.account)
        sid = frappe.session.sid
        frappe.set_user("Administrator")
        frappe.db.commit()

        data = frappe.parse_json(
            frappe.db.sql("select sessiondata from `tabSessions` where sid = %s", sid)[0][0]
        )
        idle_since = frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-idle_hours)
        data["session_expiry"] = limit
        data["last_updated"] = str(idle_since)

        frappe.db.sql(
            "update `tabSessions` set sessiondata = %s, lastupdate = %s where sid = %s",
            (json.dumps(data), idle_since, sid),
        )
        frappe.db.commit()
        frappe.cache.hdel("session", sid)

        return sid

    def alive(self, sid):
        return bool(frappe.db.sql("select 1 from `tabSessions` where sid = %s", sid))

    def call_with(self, sid):
        client = get_test_client(use_cookies=False)
        make_request(
            target=client.get,
            args=("/api/method/frappe.auth.get_logged_user",),
            kwargs={"headers": {"Cookie": f"sid={sid}"}},
        )
        frappe.db.rollback()

    def test_a_session_idle_past_its_limit_ends_even_when_read_from_the_table(self):
        sid = self.opened(idle_hours=9)

        self.call_with(sid)

        self.assertFalse(self.alive(sid))

    def test_a_session_still_within_its_limit_goes_on(self):
        sid = self.opened(idle_hours=1)

        self.call_with(sid)

        self.assertTrue(self.alive(sid))

    def test_without_the_guard_frappe_would_have_let_it_back_in(self):
        """Why the guard exists: the table is read against the site-wide week, not the 8 hours."""
        sid = self.opened(idle_hours=9)

        with patch.object(session_timeout, "expire_idle_session", lambda: None):
            self.call_with(sid)

        self.assertTrue(self.alive(sid))
