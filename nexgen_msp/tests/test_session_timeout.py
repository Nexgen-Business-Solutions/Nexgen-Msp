"""A customer's session sits idle only as long as the administrator allows.

The limit is handed to the session the moment it opens, in the very field Frappe reads
back on every request — so what these tests look at is what Frappe will enforce.
"""

import json

import frappe
import frappe.auth
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request
from frappe.sessions import Session, delete_session, get_expiry_in_seconds, get_expiry_period

from nexgen_msp.api.internal.services.settings_service import SettingsService
from nexgen_msp.patches import portal_url_moves_home
from nexgen_msp.utils import session_timeout
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase


class SessionCase(MSPTestCase):
    """Accounts, the setting, and a way to open a session the way a login does."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.client = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="sto")
        self.staff = self.make_account("internal", "MSP Technician", suffix="stt")
        self.before = frappe.db.get_single_value("MSP Portal Settings", "customer_session_timeout")
        self.kept = (getattr(frappe.local, "session_obj", None), frappe.local.session)

    def tearDown(self):
        self.restore()
        frappe.db.set_single_value("MSP Portal Settings", "customer_session_timeout", self.before or "")
        frappe.db.commit()
        super().tearDown()

    def restore(self):
        """The runner has no session object of its own; only put back what was there."""
        session_obj, session = self.kept
        if session_obj is not None:
            frappe.local.session_obj = session_obj
        elif hasattr(frappe.local, "session_obj"):
            del frappe.local.session_obj
        frappe.local.session = session

    def choose(self, choice):
        frappe.db.set_single_value("MSP Portal Settings", "customer_session_timeout", choice)
        frappe.db.commit()

    def open_session_for(self, email):
        """What Frappe does at login, then our hook, then the session as Frappe stored it."""
        user_type = frappe.db.get_value("User", email, "user_type")
        # a session is opened by a request; the runner has none, so one is lent to it
        had_request = hasattr(frappe.local, "request")
        frappe.local.request = Request(EnvironBuilder(path="/api/method/login").get_environ())
        frappe.local.request_ip = "127.0.0.1"
        frappe.local.session_obj = Session(user=email, resume=False, full_name=email, user_type=user_type)
        frappe.local.session = frappe.local.session_obj.data
        try:
            session_timeout.on_session_creation()
            sid = frappe.session.sid
            stored = frappe.cache.hget("session", sid)["data"]["session_expiry"]
            # tabSessions is Frappe's own table, without the usual creation column
            row = frappe.db.sql("select sessiondata from `tabSessions` where sid = %s", sid)
            in_db = frappe.parse_json(row[0][0])["session_expiry"]
            return stored, in_db
        finally:
            delete_session(frappe.session.sid)
            self.restore()
            if not had_request:
                del frappe.local.request


class TestCustomerSessionTimeout(SessionCase):
    def test_the_hook_is_wired(self):
        self.assertIn(
            "nexgen_msp.utils.session_timeout.on_session_creation",
            frappe.get_hooks("on_session_creation"),
        )

    def test_a_customer_session_carries_the_chosen_limit(self):
        self.choose("2 hours")

        stored, in_db = self.open_session_for(self.client)

        self.assertEqual(stored, "02:00:00")
        self.assertEqual(in_db, "02:00:00")
        self.assertEqual(get_expiry_in_seconds(stored), 2 * 60 * 60)

    def test_seven_days_is_the_ceiling_and_reads_back_whole(self):
        self.choose("7 days")

        stored, _ = self.open_session_for(self.client)

        self.assertEqual(stored, "168:00:00")
        self.assertEqual(get_expiry_in_seconds(stored), 7 * 24 * 60 * 60)
        self.assertEqual(max(session_timeout.TIMEOUTS.values()), 7 * 24 * 60 * 60)
        self.assertEqual(min(session_timeout.TIMEOUTS.values()), 60 * 60)

    def test_staff_keep_the_site_limit(self):
        self.choose("1 hour")

        stored, _ = self.open_session_for(self.staff)

        self.assertEqual(stored, get_expiry_period())

    def test_left_to_the_site_a_customer_keeps_the_site_limit(self):
        self.choose("")

        stored, _ = self.open_session_for(self.client)

        self.assertEqual(stored, get_expiry_period())

    def test_the_setting_offers_the_list_and_refuses_anything_else(self):
        offered = SettingsService.get_portal_settings()["timeout_options"]
        self.assertEqual(offered, list(session_timeout.TIMEOUTS))

        with self.assertRaises(ValidationError):
            SettingsService.save_portal_settings({"customer_session_timeout": "30 minutes"})

        saved = SettingsService.save_portal_settings({"customer_session_timeout": "1 day"})
        self.assertEqual(saved["customer_session_timeout"], "1 day")
        self.assertEqual(session_timeout.customer_timeout_seconds(), 24 * 60 * 60)

    def test_left_unset_the_seed_gives_eight_hours(self):
        self.choose("")

        portal_url_moves_home.execute()

        self.assertEqual(
            frappe.db.get_single_value("MSP Portal Settings", "customer_session_timeout"), "8 hours"
        )
        self.assertEqual(session_timeout.customer_timeout_seconds(), 8 * 60 * 60)

        stored, _ = self.open_session_for(self.client)
        self.assertEqual(stored, "08:00:00")


class TestTheLimitIsEnforced(SessionCase):
    """Not only stored: what Frappe does when the session comes back after sitting idle.

    A request resumes the session through `Session(resume=True)`, which is where the idle
    time is compared with the limit — the very path the web worker runs.
    """

    def idle_then_resume(self, email, minutes):
        user_type = frappe.db.get_value("User", email, "user_type")
        had_request = hasattr(frappe.local, "request")
        frappe.local.request = Request(EnvironBuilder(path="/api/method/login").get_environ())
        frappe.local.request_ip = "127.0.0.1"
        frappe.local.session_obj = Session(user=email, resume=False, full_name=email, user_type=user_type)
        frappe.local.session = frappe.local.session_obj.data
        try:
            session_timeout.on_session_creation()
            sid = frappe.session.sid

            # the session sat idle: what Frappe compares against is last_updated, in Redis
            # and in the table — read fresh, never from this process's own copy
            stale = str(frappe.utils.add_to_date(frappe.utils.now_datetime(), minutes=-minutes))
            frappe.local.cache.clear()
            data = frappe.cache.hget("session", sid)
            data["data"]["last_updated"] = stale
            frappe.cache.hset("session", sid, data)
            frappe.db.sql(
                "update `tabSessions` set sessiondata = %s, lastupdate = %s where sid = %s",
                (json.dumps(data["data"], default=str), stale, sid),
            )
            frappe.db.commit()
            frappe.local.cache.clear()

            # the next request arrives with the cookie; an expiry clears it, through the
            # cookie manager a real request always carries
            frappe.local.cookie_manager = frappe.auth.CookieManager()
            frappe.local.request = Request(
                EnvironBuilder(path="/api/method/ping", headers={"Cookie": f"sid={sid}"}).get_environ()
            )
            resumed = Session(user=None, resume=True)

            return resumed.user, bool(frappe.db.sql("select 1 from `tabSessions` where sid = %s", sid))
        finally:
            delete_session(frappe.session.sid)
            self.restore()
            if not had_request:
                del frappe.local.request

    def test_a_customer_idle_past_the_limit_is_signed_out(self):
        self.choose("1 hour")

        user, still_there = self.idle_then_resume(self.client, 70)

        self.assertEqual(user, "Guest")
        self.assertFalse(still_there, "the session is gone from the table too")

    def test_a_customer_idle_within_the_limit_stays_signed_in(self):
        self.choose("1 hour")

        user, still_there = self.idle_then_resume(self.client, 50)

        self.assertEqual(user, self.client)
        self.assertTrue(still_there)

    def test_staff_idle_past_the_customer_limit_stay_signed_in(self):
        self.choose("1 hour")

        user, _ = self.idle_then_resume(self.staff, 70)

        self.assertEqual(user, self.staff)
