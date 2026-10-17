"""A site whose code is newer than its database says so, instead of naming a column.

Signing in on 17 October 2026 answered "The server is unavailable", because Frappe asked
`tabUser` for a column a migration had not created yet. The cause was one command away and
nothing on the screen pointed at it.
"""

from unittest.mock import patch

import frappe

from nexgen_msp.utils import schema_health

from .base import MSPTestCase


class TestWhatTheSiteSaysAboutItself(MSPTestCase):
    def test_a_site_in_step_with_its_code_says_nothing(self):
        with patch.object(schema_health, "apps_behind", return_value=[]):
            self.assertIsNone(schema_health.warning())

    def test_a_site_left_behind_names_the_apps_and_the_command(self):
        with patch.object(
            schema_health, "apps_behind", return_value=["frappe 16.18.3 → 16.52.0"]
        ):
            said = schema_health.warning()

        self.assertIn("frappe 16.18.3 → 16.52.0", said)
        self.assertIn("migrate", said)
        self.assertIn(frappe.local.site, said)

    def test_this_very_site_is_in_step(self):
        """It is, right now. If this fails, the site needs migrating before anything else."""
        self.assertEqual(schema_health.apps_behind(), [])

    def test_a_recorded_version_is_compared_against_the_one_on_disk(self):
        recorded = {"frappe": "1.0.0"}

        with patch.object(schema_health, "_recorded", return_value=recorded):
            behind = schema_health.apps_behind()

        self.assertEqual(len(behind), 1)
        self.assertIn("1.0.0", behind[0])
        self.assertIn(frappe.__version__, behind[0])

    def test_an_app_that_is_not_installed_on_disk_is_passed_over(self):
        with patch.object(schema_health, "_recorded", return_value={"not_an_app": "1.0.0"}):
            self.assertEqual(schema_health.apps_behind(), [])


class TestWhatAFailedCallAnswers(MSPTestCase):
    def endpoint(self):
        from nexgen_msp.utils.wrapper_error_decorator import handle_errors

        @handle_errors
        def raises():
            raise Exception("Unknown column 'send_read_receipt' in 'SELECT'")

        return raises

    def test_an_unexpected_failure_normally_reports_itself(self):
        with patch.object(schema_health, "warning", return_value=None):
            answer = self.endpoint()()

        self.assertEqual(answer["code"], "INTERNAL_ERROR")
        self.assertIn("send_read_receipt", answer["error"])

    def test_the_same_failure_on_a_site_left_behind_names_the_cause(self):
        with patch.object(schema_health, "warning", return_value="Run migrate, please."):
            answer = self.endpoint()()

        self.assertEqual(answer["code"], "SCHEMA_BEHIND")
        self.assertEqual(answer["error"], "Run migrate, please.")
        self.assertNotIn("send_read_receipt", answer["error"])
