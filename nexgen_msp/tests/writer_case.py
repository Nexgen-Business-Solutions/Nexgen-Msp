"""Fixtures shared by the tests that write a request through the portal."""

import frappe

from nexgen_msp.api.portal.services.portal_service import PortalService

from .base import MSPTestCase

REQUEST = "MSP Request"
LINE = "MSP Request Line"
REQUESTED_CLIENT_USER = "MSP Requested Client User"
REQUESTED_DEVICE = "MSP Requested Device"

GROUP_FIELDS = (
    "group_key",
    "operation_code",
    "operation_label_snapshot",
    "domain",
    "service_item",
    "source_scope_type",
    "source_scope_key",
    "source_scope_label",
    "selected_subject_count",
)


class WriterCase(MSPTestCase):
    """A customer with two people, a machine one of them holds, two services and a manager."""

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(f"WR{self.tag[:4]}")
        self.track("MSP Approval Authority", self.customer)
        self.department = self.make_department("Purchasing")
        self.helen = self.make_person(self.customer, f"Helen {self.tag}", department="Purchasing")
        self.franck = self.make_person(self.customer, f"Franck {self.tag}", department="Purchasing")
        self.m365 = self.make_service(f"WM{self.tag[:3]}", scope="User")
        self.sophos = self.make_service(f"WS{self.tag[:3]}", scope="Device")
        self.cover_service(self.customer, self.m365)
        self.cover_service(self.customer, self.sophos)
        self.laptop = self.make_device(
            self.customer, hostname=f"WL{self.tag[:4]}", holder=self.franck, serial=f"ZZTEST-WL-{self.tag}"
        )
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"wm{self.tag[:3]}"
        )
        self.grant(self.manager, can_submit=1, can_approve=1)

    def tearDown(self):
        frappe.set_user("Administrator")

        for doctype in (REQUESTED_DEVICE, REQUESTED_CLIENT_USER, "MSP Service Assignment"):
            for name in frappe.get_all(doctype, filters={"customer": self.customer}, pluck="name"):
                frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)

        for name in frappe.get_all(REQUEST, filters={"customer": self.customer}, pluck="name"):
            self.track(REQUEST, name)

        for name in frappe.get_all("MSP Client User", filters={"customer": self.customer}, pluck="name"):
            self.track("MSP Client User", name)

        frappe.db.commit()
        super().tearDown()

    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def as_manager(self, fn):
        return self.as_user(self.manager, fn)

    def marie(self, **values):
        return {
            "subject_key": "new:marie",
            "kind": "new",
            "client_user": None,
            "full_name": f"ZZTEST Marie {self.tag}",
            "department": self.department,
            "added_via": "New",
            **values,
        }

    def existing(self, person):
        return {
            "subject_key": f"user:{person}",
            "kind": "existing",
            "client_user": person,
            "full_name": frappe.db.get_value("MSP Client User", person, "full_name"),
            "added_via": "Existing",
        }

    def new_laptop(self, **values):
        return {
            "device_requirement_key": "new-device:laptop",
            "display_label": "New laptop",
            "device_type": "Laptop",
            "intended_holder_subject_key": "new:marie",
            **values,
        }

    def target(self, subject, scope="User", **values):
        return {
            "subject_key": subject["subject_key"],
            "client_user": subject.get("client_user"),
            "full_name": subject.get("full_name"),
            "target_scope": scope,
            "managed_device": None,
            "source_service_assignment": None,
            **values,
        }

    def group(self, key, code, targets, service=None, exclusions=None, label=None):
        return {
            "group_key": key,
            "operation_code": code,
            "operation_label_snapshot": label or code,
            "domain": "Service" if code.startswith("service.") else "Device",
            "service_item": service,
            "source_scope_type": "All",
            "source_scope_key": None,
            "source_scope_label": "All selected",
            "selected_subject_count": len(targets) + len(exclusions or []),
            "targets": targets,
            "exclusions": exclusions or [],
        }

    def scenario(self):
        """Marie to come, a laptop for her, Microsoft 365 for her, Sophos on the laptop, Franck's machine to her."""
        marie = self.marie()
        helen = self.existing(self.helen)
        franck = self.existing(self.franck)

        return {
            "priority": "High",
            "details": "Marie starts on Monday.",
            "requested_date": frappe.utils.add_days(frappe.utils.today(), 7),
            "subjects": [marie, helen, franck],
            "requested_devices": [self.new_laptop()],
            "action_groups": [
                self.group(
                    "grp:m365",
                    "service.add",
                    [self.target(marie)],
                    service=self.m365,
                    exclusions=[
                        {
                            "subject_key": helen["subject_key"],
                            "client_user": self.helen,
                            "full_name": helen["full_name"],
                            "reason_code": "UNCHECKED",
                            "reason": "Left out by the requester.",
                        }
                    ],
                ),
                self.group(
                    "grp:assign",
                    "device.assign",
                    [
                        self.target(
                            marie,
                            "Device",
                            device_requirement_key="new-device:laptop",
                            requested_holder_subject_key="new:marie",
                        )
                    ],
                ),
                self.group(
                    "grp:sophos",
                    "service.add",
                    [self.target(marie, "Device", device_requirement_key="new-device:laptop")],
                    service=self.sophos,
                ),
                self.group(
                    "grp:transfer",
                    "device.transfer",
                    [
                        self.target(
                            franck,
                            "Device",
                            managed_device=self.laptop,
                            current_holder=self.franck,
                            requested_holder_subject_key="new:marie",
                        )
                    ],
                ),
            ],
        }

    def save(self, name=None, **payload):
        out = self.as_manager(
            lambda: PortalService.save_draft(name=name, customer=self.customer, **payload)
        )
        self.track(REQUEST, out["name"])

        return out

    def send(self, name=None, **payload):
        out = self.as_manager(
            lambda: PortalService.create_request(name=name, customer=self.customer, **payload)
        )
        self.track(REQUEST, out["name"])

        return out

    def reopen(self, name):
        return self.as_manager(lambda: PortalService.get_request(name))

    def payload_of(self, reopened):
        """What the builder sends back after reopening a draft, unchanged."""
        return {
            "priority": reopened["priority"],
            "details": reopened["details"],
            "requested_date": reopened["requested_date"],
            "subjects": reopened["subjects"],
            "requested_devices": reopened["requested_devices"],
            "action_groups": [
                {
                    **{field: group[field] for field in GROUP_FIELDS},
                    "targets": group["configuration"]["targets"],
                    "exclusions": group["configuration"]["exclusions"],
                }
                for group in reopened["action_groups"]
            ],
        }

    def count(self, doctype, request):
        return frappe.db.count(doctype, {"request": request})
