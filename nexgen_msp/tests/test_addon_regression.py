"""What the customer-management work must not have quietly loosened elsewhere.

Giving a customer a page of their own means giving a customer account a door into the
application, and the risk of that is never the page itself. It is that the door turns out
to reach further than the page: into the lifecycle of a person, of a machine, of a service,
into the departments everybody shares, into a request only we may carry out.

Each test here opens one of those doors from a customer session and expects it shut. The
last two are about history rather than access: a request keeps the shape Phase 3 gave it,
and a run keeps saying what it said on the day it was drawn.
"""

import frappe

from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import ValidationError as Refused

from .base import MSPTestCase


class RegressionCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.customer = self.make_customer(self.tag)
        self.track("MSP Approval Authority", self.customer)
        self.john = self.make_person(self.customer, "John")
        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.customer, suffix=f"ar{self.tag[:3]}"
        )

    def as_manager(self, call):
        frappe.set_user(self.manager)
        frappe.clear_cache(user=self.manager)
        try:
            return call()
        finally:
            frappe.set_user("Administrator")

    def refused(self, call):
        """Whatever the layer calls it, the answer has to be no."""
        with self.assertRaises((Refused, frappe.PermissionError, frappe.ValidationError)):
            self.as_manager(call)


class TestTheProfilePageIsNotADoorway(RegressionCase):
    def test_a_manager_cannot_correct_a_person_on_our_side(self):
        from nexgen_msp.api.internal.services.user_service import UserService

        self.refused(
            lambda: UserService.update_client_user(name=self.john, full_name="ZZTEST Renamed")
        )
        self.assertNotEqual(
            frappe.db.get_value("MSP Client User", self.john, "full_name"), "ZZTEST Renamed"
        )

    def test_a_manager_cannot_delete_a_person_either(self):
        from nexgen_msp.api.internal.services.user_service import UserService

        self.refused(lambda: UserService.delete_client_user(name=self.john))
        self.assertTrue(frappe.db.exists("MSP Client User", self.john))

    def test_a_manager_cannot_open_or_close_a_service(self):
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        service = self.make_service(f"AR{self.tag[:3]}")
        self.cover_service(self.customer, service)

        self.refused(
            lambda: ServiceLifecycleService.activate(
                customer=self.customer,
                service_item=service,
                target_scope="User",
                client_user=self.john,
            )
        )

    def test_a_manager_cannot_hand_over_or_retire_a_machine(self):
        from nexgen_msp.api.internal.services.device_lifecycle_service import (
            DeviceLifecycleService,
        )

        device = self.make_device(self.customer, "ARBOX", serial=f"ZZTEST-AR-{self.tag}")

        self.refused(lambda: DeviceLifecycleService.assign(device=device, client_user=self.john))
        self.refused(lambda: DeviceLifecycleService.retire(device=device))

    def test_a_manager_cannot_carry_out_a_request(self):
        from nexgen_msp.api.internal.services.request_execution_service import (
            RequestExecutionService,
        )

        self.refused(lambda: RequestExecutionService.get_execution_plan(request="whatever"))

    def test_a_manager_cannot_add_a_department_everybody_shares(self):
        """A department is global: one customer inventing one changes every other's screen."""
        from nexgen_msp.api.internal.services.department_service import DepartmentService

        self.refused(
            lambda: DepartmentService.save_department(
                department={"department_name": f"ZZTEST Invented {self.tag}", "enabled": 1}
            )
        )
        self.assertFalse(
            frappe.db.exists("MSP Department", {"department_name": f"ZZTEST Invented {self.tag}"})
        )

    def test_saving_their_own_profile_still_works(self):
        """The point of the tests above is the boundary, not a locked account."""
        from nexgen_msp.api.internal.services.customer_service import CustomerService

        saved = self.as_manager(
            lambda: CustomerService.save_customer(
                customer=self.customer, details={"website": "https://acme.example"}
            )
        )

        self.assertEqual(saved["website"], "https://acme.example")


class TestARequestKeepsTheShapePhase3GaveIt(RegressionCase):
    """The addon let a customer pick any machine on the site and made them pick one at all.

    Ours does neither. A machine the customer names has to be one of theirs, and a machine
    they cannot name is not asked for: the line stays about the person, carries the fact
    that a machine is owed, and a technician settles which one in Phase 4.
    """

    def setUp(self):
        super().setUp()
        self.grant(self.manager, can_submit=1, can_approve=0)
        self.service = self.make_service(f"ARD{self.tag[:3]}", scope="Device")
        self.cover_service(self.customer, self.service)

    def raise_request(self, **line):
        out = self.as_manager(
            lambda: PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=[
                    {
                        "request_action": self.action("Add"),
                        "action": "Add",
                        "requested_service": self.service,
                        **line,
                    }
                ],
            )
        )

        return self.track("MSP Service Request", out["name"])

    def only_line(self, request):
        return frappe.get_all(
            "MSP Service Request Line",
            filters={"parent": request},
            fields=["target_scope", "client_user", "managed_device", "device_requirement_key"],
        )[0]

    def test_a_machine_the_customer_names_is_what_the_line_is_about(self):
        device = self.make_device(self.customer, "ARPICK", serial=f"ZZTEST-ARP-{self.tag}")
        line = self.only_line(self.raise_request(managed_device=device, client_user=self.john))

        self.assertEqual(line.target_scope, "Device")
        self.assertEqual(line.managed_device, device)
        self.assertEqual(line.device_requirement_key, f"device:{device}")

    def test_the_person_it_was_raised_for_is_kept_beside_it(self):
        """The machine may change hands; the line must not lose who asked."""
        device = self.make_device(self.customer, "ARKEEP", serial=f"ZZTEST-ARK-{self.tag}")
        request = self.raise_request(managed_device=device, client_user=self.john)

        self.assertEqual(
            frappe.db.get_value(
                "MSP Service Request Line", {"parent": request}, "requested_for_user"
            ),
            self.john,
        )

    def test_nobody_is_made_to_pick_a_machine(self):
        line = self.only_line(self.raise_request(client_user=self.john))

        self.assertEqual(line.target_scope, "User")
        self.assertIsNone(line.managed_device)
        self.assertEqual(line.client_user, self.john)

    def test_a_machine_still_to_be_provided_is_recorded_as_owed(self):
        line = self.only_line(self.raise_request(client_user=self.john, is_new_device=1))

        self.assertIsNone(line.managed_device)
        self.assertEqual(line.device_requirement_key, f"new-device:user:{self.john}")

    def test_two_services_owed_a_machine_share_one_of_them(self):
        """One person asking for two device services is provisioned one machine, not two."""
        second = self.make_service(f"ARD2{self.tag[:3]}", scope="Device")
        self.cover_service(self.customer, second)

        out = self.as_manager(
            lambda: PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                lines=[
                    {
                        "request_action": self.action("Add"),
                        "action": "Add",
                        "requested_service": service,
                        "client_user": self.john,
                        "is_new_device": 1,
                    }
                    for service in (self.service, second)
                ],
            )
        )
        request = self.track("MSP Service Request", out["name"])

        keys = frappe.get_all(
            "MSP Service Request Line",
            filters={"parent": request},
            pluck="device_requirement_key",
        )

        self.assertEqual(len(set(keys)), 1)

    def test_another_company_s_machine_is_refused(self):
        """There is no global picker, and naming one from outside is not a way around it."""
        stranger = self.make_customer(f"{self.tag}X")
        theirs = self.make_device(stranger, "ARFAR", serial=f"ZZTEST-ARF-{self.tag}")

        with self.assertRaises(Refused):
            self.raise_request(managed_device=theirs, client_user=None)


class TestARunKeepsSayingWhatItSaid(RegressionCase):
    """Phase 7 froze what each line was about. This freezes who the whole run was billed to,
    so a company that moves office in September does not rewrite August."""

    def setUp(self):
        super().setUp()
        from nexgen_msp.api.internal.services.billing_service import BillingService

        self.billing = BillingService
        self.service = self.make_service(f"ARB{self.tag[:3]}")
        self.contract = self.cover_service(self.customer, self.service)

        frappe.db.set_value("Customer", self.customer, "tax_id", f"TX-{self.tag}")
        self.address = frappe.get_doc(
            {
                "doctype": "Address",
                "address_title": f"ZZTEST Old {self.tag}",
                "address_type": "Billing",
                "address_line1": "10 Old Street",
                "city": "Douala",
                "country": frappe.db.get_value("Country", {"name": "Cameroon"}, "name")
                or frappe.db.get_value("Country", {}, "name"),
                "links": [{"link_doctype": "Customer", "link_name": self.customer}],
            }
        ).insert(ignore_permissions=True)
        self.track("Address", self.address.name)
        frappe.db.commit()

        self.assignment = self.open_service(self.customer, self.service, self.john)

    def open_service(self, customer, service, person):
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        out = ServiceLifecycleService.activate(
            customer=customer,
            service_item=service,
            target_scope="User",
            client_user=person,
            effective_date=frappe.utils.add_days(frappe.utils.today(), -40),
        )

        return self.track("MSP Service Assignment", out["name"])

    def draw_a_run(self):
        month = frappe.utils.add_months(frappe.utils.today(), -1)
        run = self.billing.generate(
            contract=self.contract,
            period_start=frappe.utils.get_first_day(month),
            period_end=frappe.utils.get_last_day(month),
        )

        return self.track("MSP Billing Run", run["name"])

    def test_the_run_records_who_it_was_billed_to(self):
        run = self.billing.get_run(self.draw_a_run())

        self.assertEqual(run["billing_identity"]["tax_id_snapshot"], f"TX-{self.tag}")
        self.assertIn("10 Old Street", run["billing_identity"]["billing_address_snapshot"])

    def test_moving_office_does_not_rewrite_it(self):
        name = self.draw_a_run()

        moved = frappe.get_doc("Address", self.address.name)
        moved.address_line1 = "40 New Street"
        moved.save(ignore_permissions=True)
        frappe.db.commit()

        run = self.billing.get_run(name)

        self.assertIn("10 Old Street", run["billing_identity"]["billing_address_snapshot"])
        self.assertNotIn("40 New Street", run["billing_identity"]["billing_address_snapshot"])

    def test_a_renamed_company_does_not_rewrite_it_either(self):
        name = self.draw_a_run()
        before = self.billing.get_run(name)["billing_identity"]["customer_name_snapshot"]

        frappe.db.set_value("Customer", self.customer, "customer_name", f"ZZTEST Renamed {self.tag}")
        frappe.db.commit()

        self.assertEqual(
            self.billing.get_run(name)["billing_identity"]["customer_name_snapshot"], before
        )

    def test_saving_the_profile_rewrites_no_invoice_of_theirs(self):
        """A draft invoice is a financial document. Only the workbench touches it."""
        from nexgen_msp.api.internal.services.customer_service import CustomerService

        invoice = frappe.get_doc(
            {
                "doctype": "Sales Invoice",
                "customer": self.customer,
                "customer_address": self.address.name,
                "due_date": frappe.utils.add_days(frappe.utils.today(), 30),
                "items": [
                    {
                        "item_code": self.service,
                        "qty": 1,
                        "rate": 25,
                        "income_account": frappe.db.get_value(
                            "Company",
                            frappe.defaults.get_global_default("company"),
                            "default_income_account",
                        ),
                    }
                ],
            }
        ).insert(ignore_permissions=True)
        self.track("Sales Invoice", invoice.name)
        frappe.db.commit()

        printed = frappe.db.get_value("Sales Invoice", invoice.name, "address_display")
        stamped = frappe.db.get_value("Sales Invoice", invoice.name, "modified")

        moved = frappe.get_doc("Address", self.address.name)
        moved.address_line1 = "40 New Street"
        moved.save(ignore_permissions=True)
        CustomerService.save_customer(
            customer=self.customer, details={"website": "https://moved.example"}
        )
        frappe.db.commit()

        self.assertEqual(
            frappe.db.get_value("Sales Invoice", invoice.name, "address_display"), printed
        )
        self.assertEqual(
            frappe.db.get_value("Sales Invoice", invoice.name, "modified"), stamped
        )

    def test_a_run_drawn_before_the_freeze_reads_the_records_as_they_stand(self):
        """Nothing was recorded for it, and a blank invoice header helps nobody."""
        name = self.draw_a_run()

        for field in (
            "customer_name_snapshot",
            "tax_id_snapshot",
            "billing_address_snapshot",
            "billing_contact_snapshot",
        ):
            frappe.db.set_value("MSP Billing Run", name, field, None, update_modified=False)

        frappe.db.commit()

        self.assertIn("10 Old Street", self.billing.get_run(name)["billing_identity"]["billing_address_snapshot"])
