"""The patch that gives historical requests their Requested Client Users and Requested Devices."""

import json

import frappe

from nexgen_msp.patches import requested_entities

from .base import PREFIX, MSPTestCase

REQUEST = "MSP Request"
SUBJECT = "MSP Request Subject"
LINE = "MSP Request Line"
WORK_ORDER = "MSP Work Order"
RCU = "MSP Requested Client User"
RDEV = "MSP Requested Device"

HISTORY = {
    SUBJECT: (
        "subject_key", "client_user", "is_new_user", "full_name_snapshot", "department_snapshot",
        "email_snapshot", "username_snapshot",
    ),
    LINE: (
        "target_scope", "client_user", "requested_for_user",
        "managed_device", "requested_holder", "requested_effective_date", "line_status", "is_new_user",
        "new_user_full_name", "new_user_department", "new_user_email", "new_user_username", "is_new_device",
        "new_device_label", "new_device_type", "new_device_serial",
    ),
    WORK_ORDER: (
        "work_type", "status", "action", "plan_key", "client_user",
        "managed_device", "requested_holder", "resulting_client_user", "resulting_device",
    ),
}

LINKS = {
    SUBJECT: ("requested_client_user",),
    LINE: (
        "requested_client_user", "requested_for_requested_client_user", "requested_device",
        "requested_holder_requested_client_user",
    ),
    WORK_ORDER: ("requested_client_user", "requested_device", "requested_holder_requested_client_user"),
}


class TestRequestedEntitiesPatch(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(f"RE{self.tag[:4]}")
        self.department = self.make_department("Requested")
        self.anchor = self.make_person(self.customer, f"Anchor {self.tag}")
        self.service = self.make_service("REQENT", scope="User")
        self.requests = []

    def request(self, lines, subjects=(), status="Submitted"):
        """A request written the way the builder used to, then rewritten into its historical shape."""
        doc = frappe.get_doc(
            {
                "doctype": REQUEST,
                "customer": self.customer,
                "request_type": "Add",
                "priority": "Medium",
                "status": "Draft",
                "source": "Internal",
                "requester": frappe.session.user,
                "subjects": [
                    {
                        "subject_key": f"user:{self.anchor}",
                        "client_user": self.anchor,
                        "full_name_snapshot": "placeholder",
                    }
                    for _subject in subjects
                ],
                "lines": [
                    {
                        "target_scope": "User",
                        "client_user": self.anchor,
                        "requested_service": self.service,
                        "operation_code": "service.add",
                        "action": "Add",
                    }
                    for _line in lines
                ],
            }
        ).insert(ignore_permissions=True)
        self.track(REQUEST, doc.name)
        self.requests.append(doc.name)

        for row, values in zip(doc.subjects, subjects):
            frappe.db.set_value(
                SUBJECT, row.name, {"client_user": None, "requested_client_user": None, **values}, update_modified=False
            )

        for row, values in zip(doc.lines, lines):
            frappe.db.set_value(
                LINE,
                row.name,
                {"client_user": None, "requested_for_user": None, "subject_key": None, **values},
                update_modified=False,
            )

        frappe.db.set_value(REQUEST, doc.name, "status", status, update_modified=False)
        frappe.db.commit()

        return doc.name, [row.name for row in doc.subjects], [row.name for row in doc.lines]

    def order(self, request, work_type, action, history, **values):
        doc = frappe.get_doc(
            {
                "doctype": WORK_ORDER,
                "request": request,
                "customer": self.customer,
                "work_type": work_type,
                "action": action,
                "target_scope": "Device" if work_type in ("Device Provisioning", "Device Operation") else "User",
                "status": "Open",
                **values,
            }
        ).insert(ignore_permissions=True)
        if history:
            frappe.db.set_value(WORK_ORDER, doc.name, history, update_modified=False)

        frappe.db.commit()

        return doc.name

    def future(self, name, key, **values):
        return {
            "is_new_user": 1,
            "new_user_full_name": name,
            "new_user_department": self.department,
            "new_user_email": f"{PREFIX.lower()}.{self.tag}@example.invalid",
            "subject_key": key,
            **values,
        }

    def slug(self, name):
        return f"new-user:{' '.join(name.split()).casefold()}"

    def run_patch(self):
        return requested_entities.execute(requests=self.requests)

    def history(self):
        state = {}

        for doctype, fields in HISTORY.items():
            if doctype == WORK_ORDER:
                rows = frappe.get_all(
                    doctype, filters={"request": ("in", self.requests)}, fields=["name", *fields]
                )
            else:
                rows = frappe.get_all(
                    doctype, filters={"parent": ("in", self.requests)}, fields=["name", *fields]
                )

            state[doctype] = sorted((row.name, tuple(row[field] for field in fields)) for row in rows)

        return state

    def snapshot(self):
        state = {"history": self.history()}

        for doctype, fields in LINKS.items():
            key = "request" if doctype == WORK_ORDER else "parent"
            rows = frappe.get_all(doctype, filters={key: ("in", self.requests)}, fields=["name", *fields])
            state[doctype] = sorted((row.name, tuple(row[field] for field in fields)) for row in rows)

        for doctype in (RCU, RDEV):
            state[doctype] = sorted(
                (row.name, tuple(sorted((k, str(v)) for k, v in row.items())))
                for row in frappe.get_all(doctype, filters={"request": ("in", self.requests)}, fields=["*"])
            )

        state[REQUEST] = sorted(
            frappe.get_all(
                REQUEST, filters={"name": ("in", self.requests)}, fields=["name", "status", "requested_date", "modified"]
            ),
            key=lambda row: row.name,
        )

        return state

    def one(self, doctype, request):
        names = frappe.get_all(doctype, filters={"request": request}, pluck="name")
        self.assertEqual(len(names), 1, names)

        return frappe.get_doc(doctype, names[0])

    def test_pure_historical_new_person(self):
        name = f"{PREFIX} Nora {self.tag}"
        subject_key = f"new:{self.tag}n"
        request, subjects, lines = self.request(
            [self.future(name, self.slug(name), requested_effective_date="2026-10-01")],
            [{"subject_key": subject_key, "is_new_user": 1, "full_name_snapshot": name, "department_snapshot": self.department}],
        )
        before = self.history()

        report = self.run_patch()

        person = self.one(RCU, request)
        self.assertEqual(person.subject_key, subject_key)
        self.assertEqual(person.source_key, f"requested-user:{request}:{subject_key}")
        self.assertEqual(person.status, "Open")
        self.assertFalse(person.resolved_client_user)
        self.assertEqual(person.full_name, name)
        self.assertEqual(person.department, self.department)
        self.assertEqual(person.email, f"{PREFIX.lower()}.{self.tag}@example.invalid")
        self.assertEqual(json.loads(person.requested_snapshot_json)["full_name"], name)
        self.assertEqual(frappe.db.get_value(SUBJECT, subjects[0], "requested_client_user"), person.name)
        self.assertEqual(frappe.db.get_value(LINE, lines[0], "requested_client_user"), person.name)
        self.assertEqual(str(frappe.db.get_value(REQUEST, request, "requested_date")), "2026-10-01")
        self.assertEqual(report["counters"]["requested client users created"], 1)
        self.assertEqual(report["counters"]["historical resolutions recovered"], 0)
        self.assertEqual(self.history(), before)

    def test_historical_new_person_already_materialized(self):
        name = f"{PREFIX} Omar {self.tag}"
        created = self.make_person(self.customer, f"Omar {self.tag}")
        key = self.slug(name)
        subject_key = f"new:{self.tag}o"
        request, subjects, lines = self.request(
            [
                self.future(name, key, is_new_user=0, client_user=created, requested_for_user=created),
                self.future(
                    name, key, is_new_user=0, target_scope="Device", requested_for_user=created,
                    operation_code="device.assign", requested_holder=created,
                ),
                self.future(
                    name, f"user:{created}", is_new_user=0, client_user=created, requested_for_user=created,
                ),
            ],
            [{"subject_key": subject_key, "is_new_user": 1, "full_name_snapshot": name}],
            status="Completed",
        )
        setup = self.order(
            request, "User Setup", "Create User",
            {"status": "Completed", "resulting_client_user": created, "completed_at": "2026-09-01 10:00:00"},
            subject_key=key,
        )
        service = self.order(
            request, "Service Action", "Add", {"client_user": created},
            subject_key=key, request_line_name=lines[2], service_item=self.service,
        )
        before = self.history()

        report = self.run_patch()

        person = self.one(RCU, request)
        self.assertEqual(person.subject_key, subject_key)
        self.assertEqual(person.status, "Resolved")
        self.assertEqual(person.resolved_client_user, created)
        self.assertEqual(person.resolution_mode, "Create New")
        self.assertEqual(frappe.db.get_value(SUBJECT, subjects[0], "requested_client_user"), person.name)
        self.assertEqual(frappe.db.get_value(LINE, lines[0], "requested_client_user"), person.name)
        self.assertEqual(
            frappe.db.get_value(
                LINE, lines[1], ["requested_for_requested_client_user", "requested_holder_requested_client_user"]
            ),
            (person.name, person.name),
        )
        self.assertEqual(
            frappe.db.get_value(WORK_ORDER, setup, ["requested_client_user", "resulting_client_user"]),
            (person.name, created),
        )
        self.assertEqual(frappe.db.get_value(LINE, lines[2], ["requested_client_user", "client_user"]), (person.name, created))
        self.assertEqual(frappe.db.get_value(WORK_ORDER, service, ["requested_client_user", "client_user"]), (person.name, created))
        self.assertEqual(report["counters"]["historical resolutions recovered"], 1)
        self.assertEqual(report["counters"]["work orders linked"], 2)
        self.assertEqual(self.history(), before)

    def test_unresolved_new_device(self):
        key = f"new-device:user:{self.anchor}"
        request, _subjects, lines = self.request(
            [
                {
                    "target_scope": "Device",
                    "subject_key": f"user:{self.anchor}",
                    "requested_for_user": self.anchor,
                    "is_new_device": 1,
                    "new_device_label": f"{PREFIX} laptop {self.tag}",
                    "new_device_type": "Laptop",
                    "new_device_serial": f"{PREFIX}-SN-{self.tag}",
                    "device_requirement_key": key,
                }
            ]
        )
        before = self.history()

        self.run_patch()

        device = self.one(RDEV, request)
        self.assertEqual(device.source_key, f"requested-device:{request}:{key}")
        self.assertEqual(device.device_requirement_key, key)
        self.assertEqual(device.status, "Open")
        self.assertEqual(device.display_label, f"{PREFIX} laptop {self.tag}")
        self.assertEqual(device.device_type, "Laptop")
        self.assertEqual(device.serial_number, f"{PREFIX}-SN-{self.tag}")
        self.assertEqual(device.intended_holder_client_user, self.anchor)
        self.assertEqual(device.subject_key, f"user:{self.anchor}")
        self.assertFalse(device.resolved_managed_device)
        self.assertEqual(frappe.db.get_value(LINE, lines[0], "requested_device"), device.name)
        self.assertEqual(self.count(RCU, request), 0)
        self.assertEqual(self.history(), before)

    def test_resolved_device_provisioning(self):
        key = f"new-device:user:{self.anchor}"
        machine = self.make_device(self.customer, f"RE-{self.tag}")
        request, _subjects, lines = self.request(
            [
                {
                    "target_scope": "Device",
                    "subject_key": f"user:{self.anchor}",
                    "requested_for_user": self.anchor,
                    "managed_device": machine,
                    "new_device_type": "PC",
                    "device_requirement_key": key,
                }
            ],
            status="Completed",
        )
        order = self.order(
            request, "Device Provisioning", "Register Device",
            {"status": "Completed", "resulting_device": machine, "managed_device": machine},
            device_requirement_key=key,
        )
        before = self.history()

        report = self.run_patch()

        device = self.one(RDEV, request)
        self.assertEqual(device.status, "Resolved")
        self.assertEqual(device.resolved_managed_device, machine)
        self.assertEqual(device.resolution_mode, "Register New")
        self.assertEqual(device.display_label, "New PC")
        self.assertEqual(frappe.db.get_value(LINE, lines[0], ["requested_device", "managed_device"]), (device.name, machine))
        self.assertEqual(
            frappe.db.get_value(WORK_ORDER, order, ["requested_device", "resulting_device"]), (device.name, machine)
        )
        self.assertEqual(report["counters"]["historical resolutions recovered"], 1)
        self.assertEqual(self.history(), before)

    def test_one_requested_device_for_two_services(self):
        key = f"new-device:user:{self.anchor}"
        shared = {
            "target_scope": "Device",
            "subject_key": f"user:{self.anchor}",
            "requested_for_user": self.anchor,
            "is_new_device": 1,
            "device_requirement_key": key,
        }
        request, _subjects, lines = self.request([dict(shared), dict(shared)])

        report = self.run_patch()

        device = self.one(RDEV, request)
        self.assertEqual(device.display_label, "New device")
        self.assertEqual(
            [frappe.db.get_value(LINE, line, "requested_device") for line in lines], [device.name, device.name]
        )
        self.assertEqual(report["counters"]["requested devices created"], 1)
        self.assertEqual(report["counters"]["request lines linked"], 2)

    def test_running_again_changes_nothing(self):
        name = f"{PREFIX} Lina {self.tag}"
        key = self.slug(name)
        device_key = f"new-device:{key}"
        request, _subjects, _lines = self.request(
            [
                self.future(name, key, requested_effective_date="2026-11-02"),
                self.future(
                    name, key, target_scope="Device", is_new_device=1, device_requirement_key=device_key,
                    requested_effective_date="2026-11-02",
                ),
            ],
            [{"subject_key": f"new:{self.tag}l", "is_new_user": 1, "full_name_snapshot": name}],
            status="Approved",
        )
        self.order(request, "User Setup", "Create User", {}, subject_key=key)
        self.order(request, "Device Provisioning", "Register Device", {}, device_requirement_key=device_key)

        first = self.run_patch()
        after_first = self.snapshot()
        second = self.run_patch()
        third = self.run_patch()

        self.assertEqual(self.snapshot(), after_first)
        self.assertEqual(self.count(RCU, request), 1)
        self.assertEqual(self.count(RDEV, request), 1)
        self.assertEqual(first["counters"]["requested client users created"], 1)
        self.assertEqual(first["counters"]["requested devices created"], 1)
        self.assertEqual(
            frappe.db.get_value(RDEV, {"request": request}, "intended_holder_requested_client_user"),
            frappe.db.get_value(RCU, {"request": request}, "name"),
        )

        for report in (second, third):
            counters = report["counters"]
            self.assertEqual(counters["requested client users created"], 0)
            self.assertEqual(counters["requested devices created"], 0)
            self.assertEqual(counters["requested client users already present"], 1)
            self.assertEqual(counters["requested devices already present"], 1)
            self.assertEqual(counters["subjects linked"], 0)
            self.assertEqual(counters["request lines linked"], 0)
            self.assertEqual(counters["work orders linked"], 0)
            self.assertEqual(counters["requested dates backfilled"], 0)
            self.assertEqual(report["ambiguities"], first["ambiguities"])

    def test_existing_records_are_not_overwritten(self):
        name = f"{PREFIX} Sami {self.tag}"
        subject_key = f"new:{self.tag}s"
        request, _subjects, _lines = self.request(
            [self.future(name, self.slug(name))],
            [{"subject_key": subject_key, "is_new_user": 1, "full_name_snapshot": name, "department_snapshot": self.department}],
        )
        prepared = frappe.get_doc(
            {
                "doctype": RCU,
                "request": request,
                "customer": self.customer,
                "subject_key": subject_key,
                "status": "Open",
                "full_name": f"{PREFIX} Samira {self.tag}",
                "requested_snapshot_json": json.dumps({"full_name": "as agreed"}),
                "reviewed_by": "Administrator",
                "reviewed_at": "2026-09-20 09:00:00",
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        record = frappe.get_doc(RCU, prepared.name).as_dict()

        report = self.run_patch()

        self.assertEqual(frappe.get_doc(RCU, prepared.name).as_dict(), record)
        self.assertEqual(self.count(RCU, request), 1)
        self.assertEqual(report["counters"]["requested client users created"], 0)
        self.assertEqual(report["counters"]["requested client users already present"], 1)

    def test_ambiguous_relations_are_logged_not_guessed(self):
        name = f"{PREFIX} Yara {self.tag}"
        first = self.make_person(self.customer, f"Yara one {self.tag}")
        second = self.make_person(self.customer, f"Yara two {self.tag}")
        key = self.slug(name)
        request, subjects, lines = self.request(
            [
                self.future(name, key, is_new_user=0, client_user=first, requested_for_user=first,
                            requested_effective_date="2026-10-01"),
                self.future(name, key, is_new_user=0, client_user=second, requested_for_user=second,
                            requested_effective_date="2026-10-05"),
            ],
            [{"subject_key": f"new:{self.tag}y", "is_new_user": 1, "full_name_snapshot": name}],
        )
        twin = f"{PREFIX} Twin {self.tag}"
        twins, twin_subjects, twin_lines = self.request(
            [self.future(twin, self.slug(twin))],
            [
                {"subject_key": f"new:{self.tag}t1", "full_name_snapshot": twin},
                {"subject_key": f"new:{self.tag}t2", "full_name_snapshot": twin},
            ],
        )
        before = self.history()

        report = self.run_patch()

        person = self.one(RCU, request)
        self.assertEqual(person.status, "Open")
        self.assertFalse(person.resolved_client_user)
        self.assertEqual(frappe.db.get_value(SUBJECT, subjects[0], "requested_client_user"), person.name)
        self.assertEqual([frappe.db.get_value(LINE, line, "requested_client_user") for line in lines], [None, None])
        self.assertIsNone(frappe.db.get_value(REQUEST, request, "requested_date"))
        self.assertEqual(self.count(RCU, twins), 0)
        self.assertIsNone(frappe.db.get_value(LINE, twin_lines[0], "requested_client_user"))
        self.assertEqual(
            [frappe.db.get_value(SUBJECT, row, "requested_client_user") for row in twin_subjects], [None, None]
        )

        logged = report["ambiguities"]
        conflict = [row for row in logged if row["request"] == request and row["key"] == f"new:{self.tag}y"]
        self.assertEqual(len(conflict), 1)
        self.assertEqual(set(conflict[0]["records"]), set(lines))
        self.assertIn(first, conflict[0]["reason"])
        self.assertIn(second, conflict[0]["reason"])
        self.assertTrue(
            any(row["request"] == request and "different dates" in row["reason"] for row in logged)
        )
        self.assertTrue(
            any(row["request"] == twins and set(twin_subjects) <= set(row["records"]) for row in logged)
        )
        self.assertEqual(report["counters"]["historical resolutions recovered"], 0)
        self.assertGreaterEqual(report["counters"]["ambiguous historical relations skipped"], 4)
        self.assertEqual(self.history(), before)

    def test_completed_request_stays_completed(self):
        name = f"{PREFIX} Hugo {self.tag}"
        request, _subjects, _lines = self.request(
            [
                self.future(name, self.slug(name), requested_effective_date="2026-08-03"),
                {"client_user": self.anchor, "subject_key": f"user:{self.anchor}", "requested_effective_date": "2026-08-03"},
            ],
            status="Completed",
        )
        before = frappe.db.get_value(REQUEST, request, ["status", "modified"], as_dict=True)

        self.run_patch()

        after = frappe.db.get_value(REQUEST, request, ["status", "modified", "requested_date"], as_dict=True)
        self.assertEqual(after.status, "Completed")
        self.assertEqual(after.modified, before.modified)
        self.assertEqual(str(after.requested_date), "2026-08-03")
        person = self.one(RCU, request)
        self.assertEqual(person.subject_key, self.slug(name))
        self.assertEqual(person.source_key, f"requested-user:{request}:{self.slug(name)}")

    def test_no_historical_value_is_erased(self):
        name = f"{PREFIX} Ines {self.tag}"
        created = self.make_person(self.customer, f"Ines {self.tag}")
        machine = self.make_device(self.customer, f"RI-{self.tag}")
        key = self.slug(name)
        device_key = f"new-device:{key}"
        request, _subjects, _lines = self.request(
            [
                self.future(name, key, is_new_user=0, client_user=created, requested_for_user=created,
                            new_user_username=f"ines{self.tag}"),
                self.future(name, key, is_new_user=0, target_scope="Device", requested_for_user=created,
                            managed_device=machine, new_device_label="Ines laptop", new_device_type="Laptop",
                            device_requirement_key=device_key),
            ],
            [{"subject_key": f"new:{self.tag}i", "is_new_user": 1, "full_name_snapshot": name,
              "username_snapshot": f"ines{self.tag}"}],
            status="Completed",
        )
        self.order(request, "User Setup", "Create User",
                   {"status": "Completed", "resulting_client_user": created, "client_user": created}, subject_key=key)
        self.order(request, "Device Provisioning", "Assign Device",
                   {"status": "Completed", "resulting_device": machine, "managed_device": machine},
                   device_requirement_key=device_key)
        before = self.history()

        self.run_patch()
        self.run_patch()

        self.assertEqual(self.history(), before)
        device = self.one(RDEV, request)
        self.assertEqual(device.resolution_mode, "Use Existing")
        self.assertEqual(device.resolved_managed_device, machine)
        self.assertEqual(device.intended_holder_requested_client_user, self.one(RCU, request).name)
        self.assertEqual(self.one(RCU, request).username, f"ines{self.tag}")
        self.assertEqual(frappe.db.count(LINE, {"parent": request, "is_new_user": 0, "new_user_full_name": name}), 2)

    def test_name_derived_keys_take_the_subject_key(self):
        name = f"{PREFIX} Rami {self.tag}"
        key = self.slug(name)
        subject_key = f"new:{self.tag}r"
        created = self.make_person(self.customer, f"Rami {self.tag}")
        request, _subjects, lines = self.request(
            [
                self.future(name, key),
                self.future(name, key, target_scope="Device", operation_code="device.assign"),
                self.future(name, f"user:{created}", is_new_user=0, client_user=created, requested_for_user=created),
                self.future(name, f"user:{self.anchor}", is_new_user=0, target_scope="Device"),
            ],
            [{"subject_key": subject_key, "is_new_user": 1, "full_name_snapshot": name}],
            status="Approved",
        )
        setup = self.order(
            request, "User Setup", "Create User",
            {"plan_key": f"{request}:user:{key}", "status": "Completed", "resulting_client_user": created},
            subject_key=key,
        )
        service = self.order(
            request, "Service Action", "Add", {"plan_key": f"{request}:service:{lines[0]}"},
            subject_key=key, request_line_name=lines[0], service_item=self.service,
        )
        rewritten = self.order(
            request, "Service Action", "Add", {"plan_key": f"{request}:service:{lines[2]}"},
            subject_key=key, request_line_name=lines[2], service_item=self.service,
        )
        self.order(
            request, "Service Action", "Add", {"plan_key": f"{request}:service:{lines[3]}"},
            subject_key=key, request_line_name=lines[3], service_item=self.service,
        )
        plan_keys = {order: frappe.db.get_value(WORK_ORDER, order, "plan_key") for order in (setup, service)}

        first = self.run_patch()
        after_first = self.snapshot()
        second = self.run_patch()

        person = self.one(RCU, request)
        self.assertEqual(person.subject_key, subject_key)
        self.assertEqual(person.resolved_client_user, created)
        self.assertEqual(
            frappe.db.get_value(LINE, lines[3], ["requested_for_requested_client_user", "subject_key"]),
            (person.name, f"user:{self.anchor}"),
        )
        self.assertEqual(
            [frappe.db.get_value(LINE, line, "subject_key") for line in lines[:3]],
            [subject_key, subject_key, subject_key],
        )
        self.assertEqual(
            [frappe.db.get_value(WORK_ORDER, order, "subject_key") for order in (setup, service, rewritten)],
            [subject_key, subject_key, subject_key],
        )
        self.assertEqual(
            {order: frappe.db.get_value(WORK_ORDER, order, "plan_key") for order in (setup, service)}, plan_keys
        )
        self.assertEqual(first["counters"]["keys aligned"], 6)
        self.assertEqual(second["counters"]["keys aligned"], 0)
        self.assertEqual(self.snapshot(), after_first)

    def count(self, doctype, request):
        return frappe.db.count(doctype, {"request": request})

    def test_the_former_rule_gives_a_lost_device_key_back(self):
        request, _subjects, lines = self.request(
            [
                {
                    "target_scope": "Device",
                    "operation_code": "device.assign",
                    "action": "Change",
                    "requested_service": None,
                    "requested_for_user": self.anchor,
                    "subject_key": f"user:{self.anchor}",
                    "is_new_device": 1,
                    "device_requirement_key": None,
                    "action_group_key": f"grp:lost{index}",
                }
                for index in range(2)
            ]
        )

        report = self.run_patch()
        wanted = ["new-device:grp:lost0", "new-device:grp:lost1"]

        self.assertEqual(
            sorted(
                frappe.get_all(RDEV, filters={"request": request}, pluck="device_requirement_key")
            ),
            wanted,
        )
        self.assertEqual(
            sorted(frappe.get_all(LINE, filters={"parent": request}, pluck="device_requirement_key")),
            wanted,
        )
        self.assertEqual(len({frappe.db.get_value(LINE, line, "requested_device") for line in lines}), 2)
        self.assertEqual(report["counters"]["ambiguous historical relations skipped"], 0)

    def provisioning(self, holder=None, action="Assign Device"):
        machine = self.make_device(self.customer, f"RP-{self.tag}-{len(self.requests)}", holder=holder)
        request, _subjects, lines = self.request(
            [{"target_scope": "Device", "client_user": self.anchor, "subject_key": f"user:{self.anchor}"}],
            status="Approved",
        )
        order = self.order(
            request,
            "Device Provisioning",
            action,
            {"managed_device": machine, "requested_holder": self.anchor, "request_line_name": lines[0]},
            device_requirement_key=f"device:{machine}",
        )

        return request, machine, order, lines[0]

    def test_a_free_machine_becomes_an_assignment_the_screen_can_carry_out(self):
        request, machine, order, line = self.provisioning()

        report = self.run_patch()
        doc = frappe.get_doc(WORK_ORDER, order)

        self.assertEqual(report["counters"]["historical work orders turned into device operations"], 1)
        self.assertEqual(
            (doc.name, doc.request, doc.request_line_name, doc.work_type, doc.operation_code, doc.status),
            (order, request, line, "Device Operation", "device.assign", "Open"),
        )
        self.assertEqual((doc.managed_device, doc.requested_holder), (machine, self.anchor))

        from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService

        RequestExecutionService.execute_device_operation(work_order=order, _plan=False)

        self.assertEqual(frappe.db.get_value("MSP Managed Device", machine, "assigned_client_user"), self.anchor)
        self.assertEqual(frappe.db.get_value(WORK_ORDER, order, "status"), "Completed")

    def test_a_machine_somebody_else_holds_becomes_a_change_of_holder(self):
        other = self.make_person(self.customer, f"Other {self.tag}")
        _request, _machine, order, _line = self.provisioning(holder=other)

        self.run_patch()

        self.assertEqual(
            frappe.db.get_value(WORK_ORDER, order, ["work_type", "operation_code", "status"]),
            ("Device Operation", "device.transfer", "Open"),
        )

    def test_a_machine_its_person_already_holds_is_settled(self):
        _request, machine, order, _line = self.provisioning(holder=self.anchor)

        report = self.run_patch()

        self.assertEqual(report["counters"]["historical work orders settled"], 1)
        self.assertEqual(
            frappe.db.get_value(WORK_ORDER, order, ["work_type", "status", "resulting_client_user", "resulting_device"]),
            ("Device Provisioning", "Completed", self.anchor, machine),
        )

    def test_an_orphan_user_setup_is_logged_and_cancelled(self):
        request, _subjects, _lines = self.request([{}], status="Approved")
        orphan = self.order(request, "User Setup", "Create User", {"subject_key": None}, subject_key="new-user:orphan")

        report = self.run_patch()

        self.assertEqual(
            frappe.db.get_value(WORK_ORDER, orphan, ["status", "failure_reason"]),
            ("Cancelled", requested_entities.SUPERSEDED),
        )
        self.assertEqual(report["counters"]["historical work orders cancelled"], 1)
        self.assertIn(orphan, [record for row in report["ambiguities"] for record in row["records"]])
        self.assertEqual(report["counters"]["ambiguous historical relations skipped"], 1)

    def test_finished_orders_are_never_touched_and_a_second_run_does_nothing(self):
        request, machine, order, _line = self.provisioning()
        done = self.order(
            request, "User Setup", "Create User", {"status": "Completed", "subject_key": None}, subject_key="new-user:done"
        )
        dropped = self.order(
            request,
            "Device Provisioning",
            "Assign Device",
            {"status": "Cancelled", "managed_device": machine},
            device_requirement_key=f"device:{machine}",
        )
        before = frappe.get_all(
            WORK_ORDER, filters={"name": ("in", [done, dropped])}, fields=["name", "status", "work_type", "modified"],
            order_by="name asc",
        )

        self.run_patch()
        converted = frappe.db.get_value(WORK_ORDER, order, ["work_type", "operation_code"])
        second = self.run_patch()

        self.assertEqual(converted, ("Device Operation", "device.assign"))
        self.assertEqual(frappe.db.get_value(WORK_ORDER, order, ["work_type", "operation_code"]), converted)
        self.assertEqual(
            frappe.get_all(
                WORK_ORDER, filters={"name": ("in", [done, dropped])}, fields=["name", "status", "work_type", "modified"],
                order_by="name asc",
            ),
            before,
        )

        for counter in (
            "historical work orders turned into device operations",
            "historical work orders settled",
            "historical work orders cancelled",
        ):
            self.assertEqual(second["counters"][counter], 0)
