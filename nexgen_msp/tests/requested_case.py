"""Fixtures shared by the Requested Client User and Requested Device tests."""

import frappe

from .base import MSPTestCase

REQUESTED_CLIENT_USER = "MSP Requested Client User"
REQUESTED_DEVICE = "MSP Requested Device"
WORK_ORDER = "MSP Work Order"


class RequestedCase(MSPTestCase):
    """Two customers, a department, one known person and a draft request."""

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(f"RQ{self.tag[:4]}")
        self.other_customer = self.make_customer(f"RX{self.tag[:4]}")
        self.department = self.make_department("Requested")
        self.person = self.make_person(self.customer, f"Anna {self.tag}", department="Requested")
        self.stranger = self.make_person(self.other_customer, f"Omar {self.tag}")
        self.service = self.make_service(f"RQ{self.tag[:3]}", scope="User")
        self.second_service = self.make_service(f"RS{self.tag[:3]}", scope="User")
        self.device_service = self.make_service(f"RD{self.tag[:3]}", scope="Device")
        self.request = self.open_request()

    def tearDown(self):
        frappe.set_user("Administrator")
        customers = (self.customer, self.other_customer)
        requests = frappe.get_all(
            "MSP Request", filters={"customer": ("in", customers)}, pluck="name"
        )

        if requests:
            for order in frappe.get_all(
                WORK_ORDER, filters={"request": ("in", requests)}, pluck="name"
            ):
                frappe.delete_doc(WORK_ORDER, order, force=True, ignore_permissions=True)

        for doctype in (REQUESTED_DEVICE, REQUESTED_CLIENT_USER):
            for name in frappe.get_all(doctype, filters={"customer": ("in", customers)}, pluck="name"):
                frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)

        for request in requests:
            frappe.delete_doc("MSP Request", request, force=True, ignore_permissions=True)

        for name in frappe.get_all(
            "MSP Managed Device", filters={"customer": ("in", customers)}, pluck="name"
        ):
            frappe.delete_doc("MSP Managed Device", name, force=True, ignore_permissions=True)

        for name in frappe.get_all("MSP Client User", filters={"customer": ("in", customers)}, pluck="name"):
            frappe.delete_doc("MSP Client User", name, force=True, ignore_permissions=True)

        frappe.db.commit()
        super().tearDown()

    def service_line(self, service=None, **extra):
        row = {
            "target_scope": "User",
            "client_user": self.person,
            "requested_service": service or self.service,
            "operation_code": "service.add",
            "action": "Add",
        }
        row.update(extra)
        return row

    def open_request(self, customer=None, person=None):
        customer = customer or self.customer
        doc = frappe.get_doc(
            {
                "doctype": "MSP Request",
                "customer": customer,
                "request_type": "Add",
                "priority": "Medium",
                "status": "Draft",
                "source": "Internal",
                "requester": frappe.session.user,
                "lines": [self.service_line(client_user=person or self.person)],
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()

        return self.track("MSP Request", doc.name)

    def add_lines(self, request, *rows):
        doc = frappe.get_doc("MSP Request", request)

        for row in rows:
            doc.append("lines", row)

        doc.save(ignore_permissions=True)
        frappe.db.commit()

        return doc

    def submit(self, request=None):
        frappe.db.set_value("MSP Request", request or self.request, "status", "Submitted")
        frappe.db.commit()

    def carry_out(self, people=(), devices=(), request=None):
        """Put a line on each Requested entity, then start the work and approve every line."""
        from nexgen_msp.api.internal.services.request_service import RequestService

        request = request or self.request
        rows = [self.service_line(client_user=None, requested_client_user=name) for name in people]
        rows += [
            self.service_line(
                self.device_service, target_scope="Device", client_user=None, requested_device=name
            )
            for name in devices
        ]

        if rows:
            self.add_lines(request, *rows)

        self.submit(request)
        RequestService.run_action(name=request, action="start_review")

        for row in frappe.get_doc("MSP Request", request).lines:
            RequestService.set_line_status(name=request, idx=row.idx, line_status="Approved")

        RequestService.run_action(name=request, action="approve")

        return request

    def person_with(self, status, suffix):
        name = self.make_person(self.customer, f"{status} {suffix} {self.tag}")

        if status != "Active":
            frappe.db.set_value(
                "MSP Client User",
                name,
                {
                    "lifecycle_status": status,
                    "disabled_date": frappe.utils.today() if status in ("Disabled", "Archived") else None,
                },
            )
            frappe.db.commit()

        return name

    def work_order(self, **values):
        doc = {
            "doctype": WORK_ORDER,
            "request": self.request,
            "customer": self.customer,
            "work_type": "Service Action",
            "action": "Add",
            "service_item": self.service,
            "target_scope": "User",
            "status": "Open",
        }
        doc.update(values)
        order = frappe.get_doc(doc).insert(ignore_permissions=True)
        frappe.db.commit()

        return order.name

    def serial(self, suffix):
        return f"ZZTEST-RQ-{self.tag}-{suffix}"

    def count(self, doctype, filters=None):
        return frappe.db.count(doctype, filters or {})

    def users(self):
        return frappe.db.sql(
            "select count(*) from `tabUser` where name like %(tag)s or full_name like %(tag)s or email like %(tag)s "
            "or email = 'marie@example.invalid'",
            {"tag": f"%{self.tag}%"},
        )[0][0]
