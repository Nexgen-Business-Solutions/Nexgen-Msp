"""An identifier from a browser is not an authorisation.

Every endpoint that takes the name of a customer, a person, a machine, a request or a billing
run is asked here to answer for one that belongs to somebody else. The answer must always be
the same: not found, or not allowed. Never the record.

The point is not that the screen hides it. The point is that the service refuses it, because
the identifier reaching the server is whatever the caller decided to type.
"""

import frappe

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.user_360_service import User360Service
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils import device_holders as holders
from nexgen_msp.utils.errors import NexgenError

from .base import MSPTestCase


class CrossCustomerCase(MSPTestCase):
    """Two companies that have nothing to do with each other, and one account of the first."""

    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)

        self.mine = self.make_customer(self.tag)
        self.theirs = self.make_customer(f"{self.tag}B")
        self.track("MSP Approval Authority", self.mine)
        self.track("MSP Approval Authority", self.theirs)

        self.my_person = self.make_person(self.mine, "Mine")
        self.their_person = self.make_person(self.theirs, "Theirs")

        self.my_device = self.laptop(self.mine, "MINE", self.my_person)
        self.their_device = self.laptop(self.theirs, "THEIRS", self.their_person)

        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.mine, suffix=f"xa{self.tag[:3]}"
        )
        self.grant(self.manager)

    def laptop(self, customer, hostname, holder):
        device = self.make_device(customer, hostname=f"{hostname}{self.tag[:3]}")
        doc = frappe.get_doc("MSP Managed Device", device)
        holders.hand_over(doc, holder)
        doc.status = "Active"
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        return device

    def as_manager(self, fn):
        frappe.set_user(self.manager)
        frappe.clear_cache(user=self.manager)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def refused(self, fn, what):
        with self.assertRaises((NexgenError, frappe.PermissionError), msg=what):
            self.as_manager(fn)

    def offering(self, suffix, customer, scope="User"):
        service = self.make_service(f"{suffix}{self.tag[:3]}", scope=scope)
        self.cover_service(customer, service)

        return service

    def their_request(self):
        service = self.offering("XREQ", self.theirs)
        asker = self.make_account(
            "customer", "MSP Customer Manager", self.theirs, suffix=f"xb{self.tag[:3]}"
        )
        self.grant(asker)

        frappe.set_user(asker)
        frappe.clear_cache(user=asker)
        try:
            out = PortalService.create_request(
                customer=self.theirs,
                request_type="Add",
                lines=[
                    {
                        "request_action": self.action(),
                        "action": "Add",
                        "target_scope": "User",
                        "client_user": self.their_person,
                        "requested_service": service,
                    }
                ],
            )
        finally:
            frappe.set_user("Administrator")

        return self.track("MSP Service Request", out["name"])


class TestNothingOfAnotherCompanyIsReadable(CrossCustomerCase):
    def test_their_people_are_not_listed(self):
        listed = self.as_manager(lambda: PortalService.list_client_users())

        self.assertNotIn(
            self.their_person, [row["name"] for row in listed["rows"]]
        )

    def test_naming_their_person_outright_is_refused(self):
        self.refused(
            lambda: PortalService.get_user_detail(self.their_person), "their person"
        )

    def test_naming_their_company_outright_is_refused(self):
        self.refused(
            lambda: PortalService.list_client_users(customer=self.theirs), "their people"
        )

    def test_their_machines_are_not_listed(self):
        listed = self.as_manager(lambda: PortalService.list_devices())

        self.assertNotIn(self.their_device, [row["name"] for row in listed["rows"]])

    def test_naming_their_company_for_machines_is_refused(self):
        self.refused(
            lambda: PortalService.list_devices(customer=self.theirs), "their machines"
        )

    def test_their_requests_are_not_listed(self):
        theirs = self.their_request()
        listed = self.as_manager(lambda: PortalService.list_requests())

        self.assertNotIn(theirs, [row["name"] for row in listed["rows"]])

    def test_naming_their_request_outright_is_refused(self):
        theirs = self.their_request()

        self.refused(lambda: PortalService.get_request(theirs), "their request")

    def test_their_services_are_not_listed(self):
        service = self.offering("XSVC", self.theirs)
        opened = ServiceLifecycleService.activate(
            customer=self.theirs,
            service_item=service,
            target_scope="User",
            client_user=self.their_person,
        )
        self.track("MSP Service Assignment", opened["name"])

        listed = self.as_manager(
            lambda: PortalService.list_service_rows(service_item=service, page_length=200)
        )

        self.assertEqual([row for row in listed["rows"] if row["name"] == opened["name"]], [])


class TestTheInternalWorkspaceIsClosedToACustomer(CrossCustomerCase):
    def test_the_internal_user_register_is_refused(self):
        self.refused(lambda: User360Service.get_user(self.my_person), "the internal reading")

    def test_the_internal_device_register_is_refused(self):
        self.refused(lambda: DeviceService.get_device(self.my_device), "the internal machine")

    def test_the_internal_request_queue_is_refused(self):
        self.refused(lambda: RequestService.list_requests(), "the internal queue")

    def test_drawing_a_billing_run_is_refused(self):
        self.refused(
            lambda: BillingService.generate(
                contract="anything", period_start="2026-08-01", period_end="2026-08-31"
            ),
            "drawing a run",
        )

    def test_opening_a_service_is_refused(self):
        service = self.offering("XACT", self.mine)

        self.refused(
            lambda: ServiceLifecycleService.activate(
                customer=self.mine,
                service_item=service,
                target_scope="User",
                client_user=self.my_person,
            ),
            "opening a service",
        )


class TestTheirBillingIsTheirOwn(CrossCustomerCase):
    def their_run(self):
        service = self.offering("XBIL", self.theirs)
        opened = ServiceLifecycleService.activate(
            customer=self.theirs,
            service_item=service,
            target_scope="User",
            client_user=self.their_person,
            effective_date=frappe.utils.add_days(frappe.utils.today(), -200),
        )
        self.track("MSP Service Assignment", opened["name"])

        contract = frappe.db.get_value("MSP Contract", {"customer": self.theirs}, "name")
        first = frappe.utils.add_months(frappe.utils.getdate(frappe.utils.today()), -1).replace(
            day=1
        )
        last = frappe.utils.add_days(frappe.utils.add_months(first, 1), -1)

        drawn = BillingService.generate(
            contract=contract, period_start=str(first), period_end=str(last)
        )

        return self.track("MSP Billing Run", drawn["name"])

    def test_naming_their_run_outright_is_refused(self):
        theirs = self.their_run()

        self.refused(lambda: PortalService.get_billing_detail(theirs), "their run")

    def test_their_runs_are_not_listed(self):
        theirs = self.their_run()
        listed = self.as_manager(lambda: PortalService.list_billing())

        self.assertNotIn(theirs, [row["name"] for row in listed])

    def test_their_breakdown_is_refused(self):
        theirs = self.their_run()

        self.refused(lambda: PortalService.download_breakdown(theirs), "their breakdown")


class TestARoleAloneIsNotAnAuthorisation(CrossCustomerCase):
    def test_a_staff_role_on_a_customer_account_widens_nothing(self):
        """A role handed out by mistake must not turn a contact into our own team."""
        account = frappe.get_doc("User", self.manager)
        account.append("roles", {"role": "MSP Technician"})
        account.save(ignore_permissions=True)
        frappe.db.commit()

        self.refused(
            lambda: PortalService.get_user_detail(self.their_person),
            "their person, with a staff role bolted on",
        )

    def test_removing_the_link_removes_the_access(self):
        """The permission is the authorisation. Take it away and the door closes."""
        for row in frappe.get_all(
            "User Permission",
            filters={"user": self.manager, "allow": "Customer", "for_value": self.mine},
            pluck="name",
        ):
            frappe.delete_doc("User Permission", row, ignore_permissions=True)

        frappe.db.commit()
        frappe.clear_cache(user=self.manager)

        self.refused(
            lambda: PortalService.get_user_detail(self.my_person),
            "their own person, once the link is gone",
        )
