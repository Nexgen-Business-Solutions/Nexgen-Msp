"""The rows the v3 snapshot patch builds must satisfy the DocTypes they are appended to.

The patch runs once per site, so a field that became mandatory after it was written is
invisible on every bench that already ran it, and stops the migration on the one that has
not. These tests read the mandatory fields from the meta rather than naming them, so the
next field to become required is caught here instead of in production.
"""

import frappe

from nexgen_msp.patches.request_v3_snapshot import _groups_of, _subjects_of

from .base import MSPTestCase

GROUP = "MSP Request Action Group"
SUBJECT = "MSP Request Subject"


def mandatory(doctype):
    return [field.fieldname for field in frappe.get_meta(doctype).fields if field.reqd]


class TestRequestSnapshotPatch(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.lines = [
            frappe._dict(
                name="line-1",
                idx=1,
                subject_key=None,
                client_user=None,
                is_new_user=1,
                new_user_full_name="Legacy Person",
                new_user_department=None,
                new_user_email="legacy@example.com",
                operation_code="service.add",
                operation_label_snapshot=None,
                requested_service="SRV-LEGACY",
                target_scope="User",
                action_group_key=None,
            )
        ]

    def test_every_group_row_carries_the_fields_its_doctype_requires(self):
        rows = _groups_of(self.lines)
        self.assertTrue(rows)

        for field in mandatory(GROUP):
            for row in rows:
                self.assertTrue(row.get(field), f"{GROUP}.{field} is required and was not written")

    def test_a_legacy_group_holds_an_empty_configuration_rather_than_none(self):
        row = _groups_of(self.lines)[0]

        self.assertEqual(frappe.parse_json(row["configuration_snapshot_json"]), {})

    def test_every_subject_row_carries_the_fields_its_doctype_requires(self):
        rows = list(_subjects_of(self.lines).values())
        self.assertTrue(rows)

        for field in mandatory(SUBJECT):
            for row in rows:
                self.assertTrue(row.get(field), f"{SUBJECT}.{field} is required and was not written")
