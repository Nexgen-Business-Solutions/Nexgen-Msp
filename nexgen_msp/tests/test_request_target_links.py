"""The explicit target pairs on subjects, lines and work orders, and the shared target helper."""

import frappe

from nexgen_msp.api.internal.services.requested_client_user_service import RequestedClientUserService
from nexgen_msp.api.internal.services.requested_device_service import RequestedDeviceService
from nexgen_msp.utils import request_targets
from nexgen_msp.utils.errors import NotFoundError, ValidationError

from .requested_case import WORK_ORDER, RequestedCase

LINE = "MSP Request Line"


class TestRequestTargetLinks(RequestedCase):
    def setUp(self):
        super().setUp()
        self.marie = RequestedClientUserService.create_or_update_draft(
            self.request, "new:marie", {"full_name": f"ZZTEST Marie {self.tag}"}
        )
        self.laptop = RequestedDeviceService.create_or_update_draft(
            self.request, "new-device:laptop", {"display_label": "New laptop"}
        )
        self.device = self.make_device(
            self.customer, hostname=f"L{self.tag[:4]}", holder=self.person, serial=self.serial("L")
        )
        frappe.db.commit()

    def refused_line(self, message, **values):
        doc = frappe.get_doc("MSP Request", self.request)
        doc.append("lines", self.service_line(**values))

        with self.assertRaisesRegex(frappe.ValidationError, message):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

        self.assertEqual(frappe.db.count(LINE, {"parent": self.request}), 1)

    def test_a_line_names_one_member_of_each_pair(self):
        both = "not both"
        self.refused_line(both, requested_client_user=self.marie)
        self.refused_line(
            both,
            target_scope="Device",
            client_user=None,
            requested_service=self.device_service,
            managed_device=self.device,
            requested_device=self.laptop,
        )
        self.refused_line(
            both,
            target_scope="Device",
            client_user=None,
            managed_device=self.device,
            operation_code="device.transfer",
            requested_holder=self.person,
            requested_holder_requested_client_user=self.marie,
        )

        doc = self.add_lines(
            self.request,
            self.service_line(client_user=None, requested_client_user=self.marie),
            self.service_line(self.device_service, target_scope="Device", client_user=None, requested_device=self.laptop),
            self.service_line(
                self.device_service,
                target_scope="Device",
                client_user=None,
                managed_device=self.device,
                operation_code="device.transfer",
                requested_holder_requested_client_user=self.marie,
            ),
        )
        self.assertEqual(
            [(row.requested_client_user, row.requested_device, row.requested_holder_requested_client_user) for row in doc.lines],
            [(None, None, None), (self.marie, None, None), (None, self.laptop, None), (None, None, self.marie)],
        )

    def test_a_subject_names_one_person(self):
        doc = frappe.get_doc("MSP Request", self.request)
        doc.append(
            "subjects",
            {
                "subject_key": "new:marie",
                "client_user": self.person,
                "requested_client_user": self.marie,
                "full_name_snapshot": "ZZTEST Marie",
            },
        )

        with self.assertRaisesRegex(frappe.ValidationError, "not both"):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

        doc = frappe.get_doc("MSP Request", self.request)
        doc.append(
            "subjects",
            {"subject_key": "new:marie", "requested_client_user": self.marie, "full_name_snapshot": "ZZTEST Marie"},
        )
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        self.assertEqual(
            frappe.db.get_value("MSP Request Subject", {"parent": self.request}, ["client_user", "requested_client_user"]),
            (None, self.marie),
        )

    def test_a_requested_entity_of_another_request_or_customer_is_refused(self):
        sibling = self.open_request()
        theirs = RequestedClientUserService.create_or_update_draft(
            sibling, "new:marie", {"full_name": f"ZZTEST Other Marie {self.tag}"}
        )
        foreign_request = self.open_request(self.other_customer, self.stranger)
        foreign = RequestedDeviceService.create_or_update_draft(
            foreign_request, "new-device:laptop", {"display_label": "New laptop"}
        )
        frappe.db.commit()

        self.refused_line(request_targets.CROSS_REQUEST, client_user=None, requested_client_user=theirs)
        self.refused_line(
            request_targets.CROSS_CUSTOMER,
            target_scope="Device",
            client_user=None,
            requested_service=self.device_service,
            requested_device=foreign,
        )
        self.refused_line(request_targets.CROSS_REQUEST, requested_for_requested_client_user=theirs)

        with self.assertRaisesRegex(frappe.ValidationError, request_targets.CROSS_REQUEST):
            self.work_order(client_user=None, requested_client_user=theirs)
        frappe.db.rollback()

        with self.assertRaisesRegex(frappe.ValidationError, request_targets.CROSS_CUSTOMER):
            self.work_order(
                service_item=self.device_service, target_scope="Device", client_user=None, requested_device=foreign
            )
        frappe.db.rollback()

        self.assertEqual(frappe.db.count(WORK_ORDER, {"request": self.request}), 0)

    def test_a_historical_row_carrying_both_stays_saveable(self):
        row = frappe.db.get_value(LINE, {"parent": self.request}, "name")
        frappe.db.set_value(LINE, row, "requested_client_user", self.marie)
        frappe.db.commit()

        doc = frappe.get_doc("MSP Request", self.request)
        doc.details = "Touched after migration"
        doc.lines[0].comment = "Still readable"
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        self.assertEqual(
            frappe.db.get_value(LINE, row, ["client_user", "requested_client_user", "comment"]),
            (self.person, self.marie, "Still readable"),
        )

        doc = self.add_lines(self.request, self.service_line(self.second_service))
        self.assertEqual(len(doc.lines), 2)

    def test_submitted_lines_stay_unchanged_after_resolution(self):
        self.add_lines(
            self.request,
            self.service_line(client_user=None, requested_client_user=self.marie),
            self.service_line(self.device_service, target_scope="Device", client_user=None, requested_device=self.laptop),
            self.service_line(
                self.device_service,
                target_scope="Device",
                client_user=None,
                managed_device=self.device,
                operation_code="device.transfer",
                requested_holder_requested_client_user=self.marie,
            ),
        )
        self.carry_out()

        def lines():
            return frappe.db.sql(
                """select idx, target_scope, client_user, requested_client_user, managed_device,
                          requested_device, requested_holder, requested_holder_requested_client_user,
                          requested_for_user, requested_for_requested_client_user, line_status
                   from `tabMSP Request Line` where parent = %s order by idx""",
                self.request,
            )

        before = lines()
        RequestedClientUserService.resolve_existing(self.marie, self.person)
        RequestedDeviceService.resolve_new(
            self.laptop, {"hostname": f"zz-res-{self.tag}", "serial_number": self.serial("R")}
        )

        self.assertEqual(lines(), before)
        self.assertEqual({row[-1] for row in before}, {"Approved"})
        self.assertEqual(frappe.db.get_value("MSP Request", self.request, "status"), "Approved")

    def test_a_work_order_keeps_the_requested_reference_beside_its_resolution(self):
        with self.assertRaisesRegex(frappe.ValidationError, "not both"):
            self.work_order(client_user=self.person, requested_client_user=self.marie)
        frappe.db.rollback()

        self.carry_out([self.marie])
        order = frappe.db.get_value(WORK_ORDER, {"request": self.request, "requested_client_user": self.marie})
        self.assertEqual(frappe.db.get_value(WORK_ORDER, order, "client_user"), None)
        RequestedClientUserService.resolve_existing(self.marie, self.person)

        self.assertEqual(
            frappe.db.get_value(WORK_ORDER, order, ["client_user", "requested_client_user"]), (self.person, self.marie)
        )

        other = self.person_with("Active", "Override")
        doc = frappe.get_doc(WORK_ORDER, order)
        doc.client_user = other
        with self.assertRaisesRegex(frappe.ValidationError, "not both"):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

        doc = frappe.get_doc(WORK_ORDER, order)
        doc.execution_notes = "Unrelated change"
        doc.save(ignore_permissions=True)
        frappe.db.commit()

    def test_the_request_carries_a_requested_date(self):
        doc = frappe.get_doc("MSP Request", self.request)
        doc.requested_date = "2026-10-15"
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        self.assertEqual(
            str(frappe.db.get_value("MSP Request", self.request, "requested_date")), "2026-10-15"
        )

    def test_the_client_user_target_helper(self):
        existing = request_targets.resolve_client_user_target(client_user=self.person)
        self.assertEqual(
            existing,
            {
                "resolved": self.person,
                "requested": None,
                "waiting": False,
                "label": frappe.db.get_value("MSP Client User", self.person, "full_name"),
            },
        )

        waiting = request_targets.resolve_client_user_target(requested_client_user=self.marie)
        self.assertEqual(
            waiting,
            {"resolved": None, "requested": self.marie, "waiting": True, "label": f"ZZTEST Marie {self.tag}"},
        )

        self.carry_out([self.marie])
        created = RequestedClientUserService.resolve_create(self.marie, {"department": self.department})
        resolved = request_targets.resolve_client_user_target(requested_client_user=self.marie)
        self.assertEqual(
            resolved,
            {"resolved": created, "requested": self.marie, "waiting": False, "label": f"ZZTEST Marie {self.tag}"},
        )

        with self.assertRaises(ValidationError) as both:
            request_targets.resolve_client_user_target(client_user=self.person, requested_client_user=self.marie)
        self.assertEqual(both.exception.message, request_targets.BOTH_TARGETS)

        with self.assertRaises(ValidationError) as missing:
            request_targets.resolve_client_user_target(required=True)
        self.assertEqual(missing.exception.message, request_targets.TARGET_REQUIRED)

        self.assertEqual(
            request_targets.resolve_client_user_target(),
            {"resolved": None, "requested": None, "waiting": False, "label": None},
        )

        with self.assertRaises(NotFoundError):
            request_targets.resolve_client_user_target(requested_client_user="RCU-MISSING")

    def test_the_device_and_holder_target_helpers(self):
        self.carry_out([self.marie], [self.laptop])
        self.assertEqual(
            request_targets.resolve_device_target(requested_device=self.laptop),
            {"resolved": None, "requested": self.laptop, "waiting": True, "label": "New laptop"},
        )

        RequestedDeviceService.resolve_existing(self.laptop, self.device)
        self.assertEqual(
            request_targets.resolve_device_target(requested_device=self.laptop),
            {
                "resolved": self.device,
                "requested": self.laptop,
                "waiting": False,
                "label": frappe.db.get_value("MSP Managed Device", self.device, "hostname"),
            },
        )

        with self.assertRaises(ValidationError):
            request_targets.resolve_device_target(managed_device=self.device, requested_device=self.laptop)

        with self.assertRaises(ValidationError):
            request_targets.resolve_device_target(required=True)

        self.assertEqual(
            request_targets.resolve_holder_target(requested_holder_requested_client_user=self.marie),
            {"resolved": None, "requested": self.marie, "waiting": True, "label": f"ZZTEST Marie {self.tag}"},
        )
        self.assertEqual(request_targets.resolve_holder_target(requested_holder=self.person)["resolved"], self.person)

        with self.assertRaises(ValidationError):
            request_targets.resolve_holder_target(
                requested_holder=self.person, requested_holder_requested_client_user=self.marie
            )

        RequestedClientUserService.cancel(self.marie, "Not coming")
        self.assertEqual(
            request_targets.resolve_holder_target(requested_holder_requested_client_user=self.marie),
            {"resolved": None, "requested": self.marie, "waiting": False, "label": f"ZZTEST Marie {self.tag}"},
        )
