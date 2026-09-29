"""A Requested Client User: written from a draft, frozen at submission, resolved once."""

import json

import frappe

from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.requested_client_user_service import (
    RequestedClientUserService as Service,
)
from nexgen_msp.api.internal.services.requested_entity_presentation import (
    RequestedEntityPresentation as Reading,
)
from nexgen_msp.utils import request_targets
from nexgen_msp.utils.errors import ValidationError

from .requested_case import REQUESTED_CLIENT_USER, WORK_ORDER, RequestedCase


class TestRequestedClientUsers(RequestedCase):
    def draft(self, subject_key="new:marie", **values):
        requested = {"full_name": f"ZZTEST Marie {self.tag}", "department": self.department}
        requested.update(values)
        name = Service.create_or_update_draft(self.request, subject_key, requested)
        frappe.db.commit()

        return name

    def readiness(self, name):
        return Reading.client_user(name)["readiness"]

    def test_a_draft_person_is_an_open_record_of_its_request(self):
        name = self.draft(email=" marie@example.invalid ", username="")
        doc = frappe.get_doc(REQUESTED_CLIENT_USER, name)

        self.assertTrue(name.startswith("RCU-"))
        self.assertEqual(doc.status, "Open")
        self.assertEqual(doc.request, self.request)
        self.assertEqual(doc.customer, self.customer)
        self.assertEqual(doc.subject_key, "new:marie")
        self.assertEqual(doc.source_key, f"requested-user:{self.request}:new:marie")
        self.assertEqual(doc.full_name, f"ZZTEST Marie {self.tag}")
        self.assertEqual(doc.department, self.department)
        self.assertEqual(doc.email, "marie@example.invalid")
        self.assertIsNone(doc.username)
        self.assertFalse(doc.resolution_mode)
        self.assertIsNone(doc.resolved_client_user)
        self.assertEqual(
            json.loads(doc.requested_snapshot_json),
            {
                "full_name": f"ZZTEST Marie {self.tag}",
                "department": self.department,
                "email": "marie@example.invalid",
                "username": None,
                "external_employee_id": None,
                "start_date": None,
            },
        )
        self.assertEqual(self.readiness(name), "needs_review")
        self.assertEqual(self.count(REQUESTED_CLIENT_USER, {"request": self.request}), 1)

    def test_the_same_subject_key_yields_one_record(self):
        first = self.draft()
        second = self.draft(full_name=f"ZZTEST Marie Claire {self.tag}", username="mclaire")
        other = self.draft(subject_key="new:paul", full_name=f"ZZTEST Paul {self.tag}")

        self.assertEqual(first, second)
        self.assertNotEqual(first, other)
        self.assertEqual(self.count(REQUESTED_CLIENT_USER, {"request": self.request}), 2)

        doc = frappe.get_doc(REQUESTED_CLIENT_USER, first)
        self.assertEqual(doc.full_name, f"ZZTEST Marie Claire {self.tag}")
        self.assertEqual(doc.username, "mclaire")
        self.assertEqual(json.loads(doc.requested_snapshot_json)["username"], "mclaire")
        self.assertEqual(
            frappe.db.get_value(REQUESTED_CLIENT_USER, other, "source_key"),
            f"requested-user:{self.request}:new:paul",
        )

    def test_the_source_key_is_computed_and_unique(self):
        name = self.draft()

        twin = frappe.get_doc(
            {
                "doctype": REQUESTED_CLIENT_USER,
                "request": self.request,
                "customer": self.customer,
                "subject_key": "new:marie",
                "source_key": "anything",
                "status": "Open",
                "full_name": "ZZTEST Twin",
                "requested_snapshot_json": "{}",
            }
        )

        with self.assertRaises(frappe.DuplicateEntryError):
            twin.insert(ignore_permissions=True)
        frappe.db.rollback()

        doc = frappe.get_doc(REQUESTED_CLIENT_USER, name)
        doc.source_key = "tampered"
        doc.save(ignore_permissions=True)
        self.assertEqual(doc.source_key, f"requested-user:{self.request}:new:marie")
        self.assertEqual(self.count(REQUESTED_CLIENT_USER, {"request": self.request}), 1)

    def test_a_record_must_share_the_customer_of_its_request(self):
        doc = frappe.get_doc(
            {
                "doctype": REQUESTED_CLIENT_USER,
                "request": self.request,
                "customer": self.other_customer,
                "subject_key": "new:elsewhere",
                "status": "Open",
                "full_name": "ZZTEST Elsewhere",
                "requested_snapshot_json": "{}",
            }
        )

        with self.assertRaisesRegex(frappe.ValidationError, request_targets.CROSS_CUSTOMER):
            doc.insert(ignore_permissions=True)
        frappe.db.rollback()

        self.assertEqual(self.count(REQUESTED_CLIENT_USER, {"customer": self.other_customer}), 0)

    def test_a_resolved_client_user_of_another_customer_is_refused(self):
        name = self.draft()
        doc = frappe.get_doc(REQUESTED_CLIENT_USER, name)
        doc.resolved_client_user = self.stranger
        doc.status = "Resolved"

        with self.assertRaisesRegex(frappe.ValidationError, request_targets.CROSS_CUSTOMER):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()
        self.carry_out([name])

        with self.assertRaises(ValidationError) as refused:
            Service.resolve_existing(name, self.stranger)

        self.assertEqual(refused.exception.message, request_targets.CROSS_CUSTOMER)
        row = frappe.db.get_value(
            REQUESTED_CLIENT_USER, name, ["status", "resolved_client_user", "resolution_mode"], as_dict=True
        )
        self.assertEqual((row.status, row.resolved_client_user, row.resolution_mode), ("Open", None, ""))

    def test_resolved_status_requires_the_resolved_link(self):
        doc = frappe.get_doc(REQUESTED_CLIENT_USER, self.draft())
        doc.status = "Resolved"

        with self.assertRaisesRegex(frappe.ValidationError, "must name the record it resolved to"):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

    def test_resolve_create_is_idempotent_and_creates_no_account(self):
        name = self.draft(email="marie@example.invalid", username=f"marie{self.tag}")
        self.carry_out([name])
        people = self.count("MSP Client User", {"customer": self.customer})
        accounts = self.users()

        created = Service.resolve_create(
            name, {"external_employee_id": f"EMP-{self.tag}", "notes": "Badge ready"}
        )
        retried = Service.resolve_create(name, {"full_name": "ZZTEST Someone Else"})

        self.assertEqual(created, retried)
        self.assertEqual(self.count("MSP Client User", {"customer": self.customer}), people + 1)
        self.assertEqual(self.users(), accounts)

        person = frappe.get_doc("MSP Client User", created)
        self.assertEqual(person.customer, self.customer)
        self.assertEqual(person.full_name, f"ZZTEST Marie {self.tag}")
        self.assertEqual(person.department, self.department)
        self.assertEqual(person.email, "marie@example.invalid")
        self.assertEqual(person.username, f"marie{self.tag}")
        self.assertEqual(person.external_employee_id, f"EMP-{self.tag}")
        self.assertEqual(person.lifecycle_status, "Active")

        doc = frappe.get_doc(REQUESTED_CLIENT_USER, name)
        self.assertEqual(doc.status, "Resolved")
        self.assertEqual(doc.resolution_mode, "Create New")
        self.assertEqual(doc.resolved_client_user, created)
        self.assertEqual(doc.resolved_by, "Administrator")
        self.assertIsNotNone(doc.resolved_at)
        self.assertEqual(doc.notes, "Badge ready")
        self.assertEqual(doc.full_name, f"ZZTEST Marie {self.tag}")
        self.assertEqual(self.readiness(name), "resolved")

        for doctype in (REQUESTED_CLIENT_USER, "MSP Client User"):
            links = {
                field.fieldname
                for field in frappe.get_meta(doctype).fields
                if field.fieldtype in ("Link", "Dynamic Link") and field.options == "User"
            }
            self.assertTrue(links <= {"reviewed_by", "resolved_by", "cancelled_by"}, links)

    def test_resolve_create_requires_a_department(self):
        name = self.draft(department=None)
        self.carry_out([name])
        people = self.count("MSP Client User", {"customer": self.customer})

        with self.assertRaises(ValidationError) as refused:
            Service.resolve_create(name)

        self.assertEqual(refused.exception.message, "Select a department for the new user.")
        self.assertEqual(self.count("MSP Client User", {"customer": self.customer}), people)
        self.assertEqual(frappe.db.get_value(REQUESTED_CLIENT_USER, name, "status"), "Open")

    def test_resolve_existing_is_an_explicit_choice(self):
        same_name = frappe.db.get_value("MSP Client User", self.person, "full_name")
        name = self.draft(full_name=same_name)

        doc = frappe.get_doc(REQUESTED_CLIENT_USER, name)
        self.assertEqual(doc.status, "Open")
        self.assertIsNone(doc.resolved_client_user)
        self.assertEqual(self.readiness(name), "needs_review")
        self.carry_out([name])

        people = self.count("MSP Client User", {"customer": self.customer})
        self.assertEqual(Service.resolve_existing(name, self.person), self.person)
        self.assertEqual(Service.resolve_existing(name, self.person), self.person)

        doc.reload()
        self.assertEqual(
            (doc.status, doc.resolution_mode, doc.resolved_client_user),
            ("Resolved", "Use Existing", self.person),
        )
        self.assertEqual(self.count("MSP Client User", {"customer": self.customer}), people)

    def test_a_conflicting_second_resolution_is_refused(self):
        name = self.draft()
        other = self.person_with("Active", "Second")
        self.carry_out([name])
        Service.resolve_existing(name, self.person)

        with self.assertRaises(ValidationError) as refused:
            Service.resolve_existing(name, other)
        self.assertEqual(
            refused.exception.message,
            "This requested target has already been resolved to a different record. "
            "Refresh the request before continuing.",
        )

        with self.assertRaises(ValidationError) as again:
            Service.resolve_create(name)
        self.assertEqual(again.exception.message, request_targets.CONFLICTING_RESOLUTION)

        self.assertEqual(frappe.db.get_value(REQUESTED_CLIENT_USER, name, "resolved_client_user"), self.person)

    def test_disabled_and_archived_people_cannot_be_chosen(self):
        asked = {status: self.draft(subject_key=f"new:{status.lower()}") for status in ("Disabled", "Archived", "Pending")}
        self.carry_out(list(asked.values()))

        for status in ("Disabled", "Archived"):
            name = asked[status]
            person = self.person_with(status, "Gone")

            with self.assertRaises(ValidationError) as refused:
                Service.resolve_existing(name, person)

            self.assertEqual(refused.exception.message, "This record is disabled and cannot be selected.")
            self.assertEqual(frappe.db.get_value(REQUESTED_CLIENT_USER, name, "status"), "Open")

        pending = self.person_with("Pending", "Soon")
        self.assertEqual(Service.resolve_existing(asked["Pending"], pending), pending)

    def test_a_resolved_link_is_never_silently_erased(self):
        name = self.draft()
        self.carry_out([name])
        Service.resolve_existing(name, self.person)

        doc = frappe.get_doc(REQUESTED_CLIENT_USER, name)
        doc.resolved_client_user = None
        doc.status = "Open"
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

        doc = frappe.get_doc(REQUESTED_CLIENT_USER, name)
        doc.status = "Cancelled"
        with self.assertRaisesRegex(frappe.ValidationError, "cannot leave the Resolved status"):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

        with self.assertRaises(ValidationError):
            Service.cancel(name, "Changed our mind")

        self.assertEqual(
            frappe.db.get_value(REQUESTED_CLIENT_USER, name, ["status", "resolved_client_user"]),
            ("Resolved", self.person),
        )

    def test_the_resolution_outlives_the_request(self):
        name = self.draft()
        self.carry_out([name])
        created = Service.resolve_create(name)
        frappe.db.set_value("MSP Request", self.request, "status", "Completed")
        frappe.db.commit()

        payload = Reading.client_user(name)
        self.assertEqual(payload["status"], "Resolved")
        self.assertEqual(payload["readiness"], "resolved")
        self.assertEqual(payload["resolved_to"]["name"], created)
        self.assertEqual(payload["resolved_to"]["label"], f"ZZTEST Marie {self.tag}")
        self.assertEqual([row["name"] for row in Reading.for_request(self.request)], [name])

    def test_readiness_is_derived(self):
        name = self.draft(department=None)
        cancelled = self.draft(subject_key="new:cancelled")
        self.assertEqual(self.readiness(name), "needs_review")
        self.carry_out([name, cancelled])

        payload = Service.mark_reviewed(name, {"email": "m@example.invalid"})
        self.assertEqual(payload["readiness"], "needs_information")
        self.assertEqual(frappe.db.get_value(REQUESTED_CLIENT_USER, name, "reviewed_by"), "Administrator")
        self.assertEqual(payload["prepared_values"]["email"], "m@example.invalid")

        self.assertEqual(Service.mark_reviewed(name, {"department": self.department})["readiness"], "ready")
        self.assertEqual(
            Service.mark_reviewed(name, {"resolution_mode": "Use Existing"})["readiness"],
            "needs_information",
        )

        Service.resolve_existing(name, self.person)
        self.assertEqual(self.readiness(name), "resolved")

        with self.assertRaises(ValidationError) as refused:
            Service.cancel(cancelled, "  ")
        self.assertEqual(refused.exception.message, "A reason is required to cancel.")

        payload = Service.cancel(cancelled, "Left before starting")
        self.assertEqual(payload["readiness"], "cancelled")
        self.assertEqual(
            frappe.db.get_value(REQUESTED_CLIENT_USER, cancelled, ["cancel_reason", "cancelled_by"]),
            ("Left before starting", "Administrator"),
        )

        with self.assertRaises(ValidationError) as closed:
            Service.resolve_create(cancelled)
        self.assertEqual(closed.exception.message, request_targets.CANCELLED_TARGET)

    def test_the_requested_snapshot_is_frozen_after_submission(self):
        name = self.draft()
        original = frappe.db.get_value(REQUESTED_CLIENT_USER, name, "requested_snapshot_json")

        frappe.db.set_value(REQUESTED_CLIENT_USER, name, "username", f"final{self.tag}")
        self.assertEqual(Service.freeze(self.request), [name])
        frozen = json.loads(frappe.db.get_value(REQUESTED_CLIENT_USER, name, "requested_snapshot_json"))
        self.assertEqual(frozen["username"], f"final{self.tag}")
        frappe.db.commit()

        self.submit()

        doc = frappe.get_doc(REQUESTED_CLIENT_USER, name)
        doc.requested_snapshot_json = original
        with self.assertRaisesRegex(frappe.ValidationError, "cannot change once the request has been submitted"):
            doc.save(ignore_permissions=True)
        frappe.db.rollback()

        with self.assertRaises(ValidationError):
            self.draft(full_name="ZZTEST Rewritten")

        RequestService.run_action(name=self.request, action="start_review")
        Service.mark_reviewed(name, {"full_name": f"ZZTEST Marie Prepared {self.tag}"})
        doc = frappe.get_doc(REQUESTED_CLIENT_USER, name)
        self.assertEqual(doc.full_name, f"ZZTEST Marie Prepared {self.tag}")
        self.assertEqual(json.loads(doc.requested_snapshot_json), frozen)

    def test_selectable_client_users_lists_everyone_of_the_customer(self):
        active = self.person_with("Active", "Lister")
        pending = self.person_with("Pending", "Lister")
        disabled = self.person_with("Disabled", "Lister")
        archived = self.person_with("Archived", "Lister")

        page = Service.selectable_client_user_page(self.customer)
        rows = {row.name: row for row in page["rows"]}

        self.assertEqual(set(rows), {self.person, active, pending, disabled, archived})
        self.assertNotIn(self.stranger, rows)
        self.assertEqual((page["total"], page["truncated"]), (5, False))

        for name, status in ((active, "Active"), (pending, "Pending")):
            self.assertEqual(rows[name].lifecycle_status, status)
            self.assertTrue(rows[name].selectable)
            self.assertIsNone(rows[name].disabled_reason)

        for name, status in ((disabled, "Disabled"), (archived, "Archived")):
            self.assertEqual(rows[name].lifecycle_status, status)
            self.assertFalse(rows[name].selectable)
            self.assertEqual(rows[name].disabled_reason, "This record is disabled and cannot be selected.")

        self.assertEqual(
            set(rows[active]),
            {"name", "full_name", "department", "username", "email", "lifecycle_status", "selectable", "disabled_reason"},
        )

        found = Service.selectable_client_user_page(self.customer, search=f"Archived Lister {self.tag}")
        self.assertEqual([row.name for row in found["rows"]], [archived])
        self.assertEqual(found["total"], 1)
        self.assertEqual(found["total"], 1)

    def test_resolution_refreshes_open_work_orders_and_never_rewrites_lines(self):
        name = self.draft()
        device = self.make_device(self.customer, hostname=f"T{self.tag[:4]}", holder=self.person, serial=self.serial("T"))
        self.add_lines(
            self.request,
            self.service_line(client_user=None, requested_client_user=name),
            self.service_line(
                self.device_service,
                target_scope="Device",
                client_user=None,
                managed_device=device,
                operation_code="device.transfer",
                requested_holder_requested_client_user=name,
            ),
        )
        self.carry_out()

        open_order = frappe.db.get_value(
            WORK_ORDER, {"request": self.request, "requested_client_user": name, "work_type": "Service Action"}
        )
        closed_order = self.work_order(client_user=None, requested_client_user=name, status="Cancelled")
        transfer = frappe.db.get_value(
            WORK_ORDER,
            {"request": self.request, "operation_code": "device.transfer", "requested_holder_requested_client_user": name},
        )
        self.assertTrue(open_order and transfer)

        before = frappe.db.sql(
            """select idx, client_user, requested_client_user, requested_holder,
                      requested_holder_requested_client_user, managed_device
               from `tabMSP Request Line` where parent = %s order by idx""",
            self.request,
        )

        created = Service.resolve_create(name)

        after = frappe.db.sql(
            """select idx, client_user, requested_client_user, requested_holder,
                      requested_holder_requested_client_user, managed_device
               from `tabMSP Request Line` where parent = %s order by idx""",
            self.request,
        )
        self.assertEqual(before, after)

        self.assertEqual(
            frappe.db.get_value(WORK_ORDER, open_order, ["client_user", "requested_client_user"]),
            (created, name),
        )
        self.assertEqual(
            frappe.db.get_value(WORK_ORDER, closed_order, ["client_user", "requested_client_user"]),
            (None, name),
        )
        self.assertEqual(
            frappe.db.get_value(
                WORK_ORDER, transfer, ["requested_holder", "requested_holder_requested_client_user", "managed_device"]
            ),
            (created, name, device),
        )

        work = Reading.requested_work("client_user", name)
        self.assertEqual([(row["line_idx"], row["role"]) for row in work], [(2, "target"), (3, "holder")])
        self.assertEqual(work[0]["operation_code"], "service.add")
        self.assertEqual(work[0]["target_label"], frappe.db.get_value("Item", self.service, "item_name"))
        self.assertEqual(work[0]["work_order"], open_order)
        self.assertEqual((work[1]["operation_code"], work[1]["work_order"]), ("device.transfer", transfer))
