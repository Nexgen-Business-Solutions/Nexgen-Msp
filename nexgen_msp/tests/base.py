"""What every test here needs: a customer of its own, and nothing left behind.

The suite runs against a real site with real data, so nothing it makes may collide with
what is already there and nothing may survive it. Every record it creates carries the
ZZTEST prefix and is torn down in reverse order.

Accounts are removed with SQL rather than delete_doc: a User that a service has just
committed is often still held by Frappe's own document lock, and a test must not hang
waiting for it.
"""

import frappe
from frappe.tests import IntegrationTestCase

PREFIX = "ZZTEST"


class MSPTestCase(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")

    def setUp(self):
        frappe.set_user("Administrator")
        self._trash = []

    def tearDown(self):
        frappe.set_user("Administrator")

        for doctype, name in reversed(self._trash):
            try:
                # anything the record sent must go with it: a queued mail outlives the
                # document it refers to and would sit in the site's outbox for ever
                self._purge_mail(doctype, name)

                if doctype == "User":
                    self._purge_account(name)
                elif frappe.db.exists(doctype, name):
                    frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)

                # one record at a time: a single stubborn one used to roll back the whole
                # clean-up, and what it left behind then broke the next module's fixtures
                frappe.db.commit()
            except Exception:
                frappe.db.rollback()

    # ------------------------------------------------------------------ helpers
    def track(self, doctype, name):
        self._trash.append((doctype, name))
        return name

    def _purge_mail(self, doctype, name):
        queued = frappe.get_all(
            "Email Queue", filters={"reference_doctype": doctype, "reference_name": name}, pluck="name"
        )

        if doctype == "User":
            queued += frappe.db.sql_list(
                "select distinct parent from `tabEmail Queue Recipient` where recipient = %s", name
            )

        for row in set(queued):
            frappe.db.sql("delete from `tabEmail Queue Recipient` where parent = %s", row)
            frappe.db.sql("delete from `tabEmail Queue` where name = %s", row)

    def _purge_account(self, email):
        contacts = set(frappe.get_all("Contact", filters={"user": email}, pluck="name"))
        # a contact whose link back to the account was lost still bears its name, and a
        # name is what the next account of the same fixture would collide with
        contacts.update(
            frappe.db.sql_list(
                "select distinct parent from `tabContact Email` where email_id = %s", email
            )
        )

        for contact in contacts:
            frappe.db.sql("delete from `tabDynamic Link` where parenttype='Contact' and parent=%s", contact)
            frappe.db.sql("delete from `tabContact Email` where parent=%s", contact)
            frappe.db.sql("delete from `tabContact` where name=%s", contact)

        frappe.db.sql("delete from `tabUser Permission` where user=%s", email)
        frappe.db.sql("delete from `tabHas Role` where parent=%s", email)
        frappe.db.sql("delete from `tabUser` where name=%s", email)

    def make_customer(self, suffix="A"):
        name = f"{PREFIX} Customer {suffix}"

        # the matrix is named after the customer and would otherwise carry rows from an
        # earlier test — accounts long purged, rights nobody gave in this one
        if frappe.db.exists("MSP Approval Authority", name):
            frappe.delete_doc("MSP Approval Authority", name, force=True, ignore_permissions=True)
            frappe.db.commit()
        self.track("MSP Approval Authority", name)

        if not frappe.db.exists("Customer", name):
            frappe.get_doc(
                {
                    "doctype": "Customer",
                    "customer_name": name,
                    "customer_type": "Company",
                    "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
                    "territory": frappe.db.get_value("Territory", {"is_group": 0}, "name"),
                }
            ).insert(ignore_permissions=True)

        frappe.db.commit()

        return self.track("Customer", name)

    def make_service(self, suffix="A", scope="User"):
        """A billable service in the catalogue, at the scope the test needs."""
        code = f"{PREFIX}-SVC-{suffix}"

        if not frappe.db.exists("Item", code):
            frappe.get_doc(
                {
                    "doctype": "Item",
                    "item_code": code,
                    "item_name": f"{PREFIX} Service {suffix}",
                    "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
                    "is_stock_item": 0,
                    "stock_uom": "Month",
                    "msp_service_scope": scope,
                }
            ).insert(ignore_permissions=True)
        else:
            frappe.db.set_value("Item", code, "msp_service_scope", scope)

        frappe.db.commit()

        return self.track("Item", code)

    def make_person(self, customer, full_name="Someone", department=None):
        doc = frappe.get_doc(
            {
                "doctype": "MSP Client User",
                "customer": customer,
                "full_name": f"{PREFIX} {full_name}",
                "department": department,
                "lifecycle_status": "Active",
                "start_date": frappe.utils.today(),
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()

        return self.track("MSP Client User", doc.name)

    def make_device(self, customer, hostname="BOX", holder=None, serial=None):
        # a serial names one machine: whatever an interrupted run left behind with it goes first
        if serial:
            for stale in frappe.get_all("MSP Managed Device", filters={"serial_number": serial}, pluck="name"):
                frappe.db.sql("delete from `tabMSP Service Assignment` where managed_device=%s", stale)
                frappe.delete_doc("MSP Managed Device", stale, force=True, ignore_permissions=True)
            frappe.db.commit()

        doc = frappe.get_doc(
            {
                "doctype": "MSP Managed Device",
                "customer": customer,
                "hostname": f"{PREFIX}-{hostname}",
                "device_type": "PC",
                "status": "Active",
                "serial_number": serial,
            }
        ).insert(ignore_permissions=True)

        # the holder mirrors the hand-over history and is read-only on the device itself,
        # so a fixture has to go through the same door the application uses
        if holder:
            from nexgen_msp.utils import device_holders

            device_holders.hand_over(doc, holder)
            doc.save(ignore_permissions=True)

        frappe.db.commit()

        return self.track("MSP Managed Device", doc.name)

    def make_account(self, kind, role, customer=None, suffix="a"):
        from nexgen_msp.api.internal.services.team_service import TeamService

        email = f"{PREFIX.lower()}.{suffix}@example.invalid"
        self._purge_account(email)
        frappe.db.commit()

        TeamService.create_account(
            email=email,
            first_name=f"{PREFIX} {suffix}",
            kind=kind,
            role=role,
            customer=customer,
            send_email=0,
        )

        return self.track("User", email)

    def grant(self, email, can_submit=1, can_approve=1):
        """Name an account in its company's matrix. Both rights make a request reach us at once."""
        from nexgen_msp.api.internal.services.authority_service import AuthorityService

        AuthorityService.set_account_rights(email, {"can_submit": can_submit, "can_approve": can_approve})

    def action(self, action_type="Add"):
        name = frappe.db.get_value("MSP Request Action", {"action_type": action_type}, "name")
        self.assertIsNotNone(name, f"no request action of type {action_type} is seeded")

        return name
