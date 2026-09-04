"""Every filter, every KPI, every "see the people / see the machines", for every role.

A number on a card and the rows behind it come from one predicate, so they must agree;
a filter must be honoured, an unknown one refused; and what a customer's account may ask
of the internal lists is nothing at all.
"""

import inspect

import frappe

from nexgen_msp.api.internal.services.dashboard_service import DashboardService
from nexgen_msp.api.internal.services.device_service import DeviceService
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.utils.errors import NotFoundError, ValidationError

from .base import MSPTestCase

REFUSED = (ValidationError, NotFoundError, frappe.PermissionError, frappe.ValidationError)
PORTAL_KPIS = ("active_services", "open_requests", "reclaimable_licences", "devices_without_services")
INTERNAL_KPIS = ("reclaimable_licences", "devices_without_services", "billable_services", "services_added", "services_removed")


class TestFiltersByRole(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.elsewhere = self.make_customer(suffix="B")

        self.alice = self.make_person(self.customer, "Alice", department="Sales")
        frappe.db.set_value("MSP Client User", self.alice, "username", "a.alice")
        self.bob = self.make_person(self.customer, "Bob")
        self.box1 = self.make_device(self.customer, hostname="BOX1", holder=self.alice, serial="SN-F1")
        self.box2 = self.make_device(self.customer, hostname="BOX2")

        self.svc_user = self.make_service("FU", scope="User")
        self.svc_dev = self.make_service("FD", scope="Device")

        self.manager = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="flm")
        self.operator = self.make_account("customer", "MSP Customer Operator", self.customer, suffix="flo")
        self.stranger = self.make_account("customer", "MSP Customer Manager", self.elsewhere, suffix="fls")
        self.tech = self.make_account("internal", "MSP Technician", suffix="flt")
        self.admin = self.make_account("internal", "MSP System Admin", suffix="fla")

        # alice runs one service in her own name, and one through the machine in her hands
        self.as_user(self.tech, lambda: UserService.assign_service(client_user=self.alice, service_item=self.svc_user))
        self.as_user(
            self.tech,
            lambda: UserService.assign_service(
                client_user=self.alice, service_item=self.svc_dev, device_mode="existing", managed_device=self.box1
            ),
        )
        for name in frappe.get_all("MSP Service Assignment", filters={"customer": self.customer}, pluck="name"):
            self.track("MSP Service Assignment", name)

    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def names(self, listed):
        return [row["name"] for row in listed["rows"]]

    def total(self, listed):
        return listed["total"] if "total" in listed else len(listed["rows"])

    # ------------------------------------------------- see the people / the machines
    def test_see_the_people_shows_who_holds_it_in_their_name_or_through_their_machine(self):
        for viewer in (self.manager, self.operator):
            by_name = self.names(self.as_user(viewer, lambda: PortalService.list_client_users(service=self.svc_user, page_length=100)))
            self.assertEqual(by_name, [self.alice], viewer)

            by_machine = self.names(self.as_user(viewer, lambda: PortalService.list_client_users(service=self.svc_dev, page_length=100)))
            self.assertEqual(by_machine, [self.alice], "held through BOX1")

    def test_see_the_machines_shows_the_machines_that_run_it(self):
        listed = self.names(self.as_user(self.manager, lambda: PortalService.list_devices(service=self.svc_dev, page_length=100)))
        self.assertEqual(listed, [self.box1])

        none = self.names(self.as_user(self.manager, lambda: PortalService.list_devices(service=self.svc_user, page_length=100)))
        self.assertEqual(none, [])

    def test_the_count_on_the_catalogue_matches_what_is_listed(self):
        subscribed = self.as_user(self.manager, lambda: PortalService.list_subscribed_services())
        active = {row["service_item"]: row["active"] for row in subscribed["services"]}

        self.assertEqual(active[self.svc_user], len(self.names(self.as_user(self.manager, lambda: PortalService.list_client_users(service=self.svc_user, page_length=100)))))
        self.assertEqual(active[self.svc_dev], len(self.names(self.as_user(self.manager, lambda: PortalService.list_devices(service=self.svc_dev, page_length=100)))))

    def test_another_company_lists_nothing_of_ours(self):
        self.assertEqual(self.names(self.as_user(self.stranger, lambda: PortalService.list_client_users(service=self.svc_user, page_length=100))), [])
        self.assertEqual(self.names(self.as_user(self.stranger, lambda: PortalService.list_devices(page_length=100))), [])

    # ---------------------------------------------------------------- portal filters
    def test_status_filter_and_username_search_are_honoured(self):
        frappe.db.set_value("MSP Client User", self.bob, "lifecycle_status", "Disabled")
        frappe.db.set_value("MSP Client User", self.bob, "disabled_date", frappe.utils.today())

        active = self.names(self.as_user(self.manager, lambda: PortalService.list_client_users(status="Active", page_length=100)))
        self.assertIn(self.alice, active)
        self.assertNotIn(self.bob, active)

        found = self.names(self.as_user(self.operator, lambda: PortalService.list_client_users(search="a.alice", page_length=100)))
        self.assertEqual(found, [self.alice], "the username is searchable")

        serial = self.names(self.as_user(self.operator, lambda: PortalService.list_devices(search="SN-F1", page_length=100)))
        self.assertEqual(serial, [self.box1], "the serial is searchable")

    def test_the_filter_options_offered_are_ones_the_records_can_hold(self):
        options = self.as_user(self.manager, lambda: PortalService.portal_filter_options())
        user_meta = frappe.get_meta("MSP Client User").get_field("lifecycle_status").options.split("\n")
        device_meta = frappe.get_meta("MSP Managed Device").get_field("status").options.split("\n")
        type_meta = frappe.get_meta("MSP Managed Device").get_field("device_type").options.split("\n")

        self.assertTrue(set(options["user_statuses"]) <= set(user_meta))
        self.assertTrue(set(options["device_statuses"]) <= set(device_meta))
        self.assertTrue(set(options["device_types"]) <= set(type_meta))
        self.assertIn("Phone", type_meta)

    # ------------------------------------------------------------------ portal KPIs
    def test_every_portal_kpi_agrees_with_its_card_for_both_customer_roles(self):
        for viewer in (self.manager, self.operator):
            summary = self.as_user(viewer, lambda: PortalService.get_summary())
            for kpi in PORTAL_KPIS:
                rows = self.as_user(viewer, lambda: PortalService.list_kpi_rows(kpi, None, 0, 200))
                self.assertEqual(rows["total"], summary[kpi], f"{viewer} {kpi}")
                self.assertEqual(len(rows["rows"]), summary[kpi], f"{viewer} {kpi}")

        with self.assertRaises(REFUSED):
            self.as_user(self.manager, lambda: PortalService.list_kpi_rows("no_such_kpi", None, 0, 10))

    def test_the_idle_machine_kpi_names_the_right_machine(self):
        rows = self.as_user(self.manager, lambda: PortalService.list_kpi_rows("devices_without_services", None, 0, 200))
        self.assertEqual([row["name"] for row in rows["rows"]], [self.box2])

        elsewhere = self.as_user(self.stranger, lambda: PortalService.list_kpi_rows("devices_without_services", None, 0, 200))
        self.assertEqual(elsewhere["rows"], [])

    # ---------------------------------------------------------------- internal lists
    def test_each_coverage_card_counts_exactly_the_rows_its_filter_lists(self):
        for viewer in (self.tech, self.admin):
            users = self.as_user(viewer, lambda: UserService.get_stats(customer=self.customer))
            for stat, coverage in (("without_device", "no_device"), ("disabled_with_services", "disabled_with_services")):
                listed = self.as_user(viewer, lambda: UserService.list_users(customer=self.customer, coverage=coverage, page_length=200))
                self.assertEqual(self.total(listed), users[stat], f"{viewer} {coverage}")

            devices = self.as_user(viewer, lambda: DeviceService.get_stats(customer=self.customer))
            for stat, coverage in (("devices_without_services", "no_service"), ("unassigned_devices", "unassigned"), ("devices_without_mac", "no_mac")):
                listed = self.as_user(viewer, lambda: DeviceService.list_devices(customer=self.customer, coverage=coverage, page_length=200))
                self.assertEqual(self.total(listed), devices[stat], f"{viewer} {coverage}")

        idle = self.as_user(self.tech, lambda: DeviceService.list_devices(customer=self.customer, coverage="no_service", page_length=200))
        self.assertEqual(self.names(idle), [self.box2])

    def test_the_users_list_knows_no_portal_access_filter_any_more(self):
        from nexgen_msp.api.internal.endpoints import v1

        for fn in (UserService.list_users, UserService.get_stats, v1.list_users, v1.get_user_stats, v1.export_users):
            self.assertNotIn("portal", inspect.signature(fn).parameters, fn.__name__)

        listed = self.as_user(self.tech, lambda: UserService.list_users(customer=self.customer, service=self.svc_dev, page_length=200))
        self.assertEqual(self.names(listed), [self.alice], "held through her machine, on our side too")

    # ----------------------------------------------------------------- internal KPIs
    def test_internal_kpis_for_the_administrator_and_what_the_technician_may_not_see(self):
        for kpi in INTERNAL_KPIS:
            self.assertIn("rows", self.as_user(self.admin, lambda: DashboardService.list_kpi_rows(kpi, 0, 50)), kpi)

        for kpi in ("reclaimable_licences", "devices_without_services", "services_added", "services_removed"):
            self.assertIn("rows", self.as_user(self.tech, lambda: DashboardService.list_kpi_rows(kpi, 0, 50)), kpi)

        with self.assertRaises(REFUSED):
            self.as_user(self.tech, lambda: DashboardService.list_kpi_rows("billable_services", 0, 50))
        with self.assertRaises(REFUSED):
            self.as_user(self.admin, lambda: DashboardService.list_kpi_rows("no_such_kpi", 0, 50))

        self.assertIsNone(self.as_user(self.tech, DashboardService.get_dashboard).get("portfolio"))
        self.assertIsNotNone(self.as_user(self.admin, DashboardService.get_dashboard).get("portfolio"))

    # ------------------------------------------------- a customer on our side of the wall
    def test_a_customer_account_reaches_none_of_the_internal_lists(self):
        for viewer in (self.manager, self.operator):
            for call in (
                lambda: UserService.list_users(page_length=10),
                lambda: UserService.get_stats(),
                lambda: DeviceService.list_devices(page_length=10),
                lambda: DashboardService.list_kpi_rows("devices_without_services", 0, 10),
                lambda: DashboardService.get_dashboard(),
            ):
                with self.assertRaises(REFUSED, msg=viewer):
                    self.as_user(viewer, call)


class TestTheRequestQueueCards(MSPTestCase):
    """Each card on the request queue lists exactly what it counts."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.person = self.make_person(self.customer, "Subject")
        self.service = self.make_service("RQ", scope="User")
        self.both = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="rqb")
        self.grant(self.both)
        self.tech = self.make_account("internal", "MSP Technician", suffix="rqt")

    def as_user(self, email, fn):
        frappe.set_user(email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def raise_one(self, priority):
        out = self.as_user(
            self.both,
            lambda: PortalService.create_request(
                customer=self.customer,
                request_type="Add",
                priority=priority,
                lines=[
                    {
                        "request_action": self.action(),
                        "action": "Add",
                        "target_scope": "User",
                        "client_user": self.person,
                        "requested_service": self.service,
                    }
                ],
            ),
        )
        return self.track("MSP Service Request", out["name"])

    def test_every_card_lists_what_it_counts(self):
        from nexgen_msp.api.internal.services.request_service import RequestService

        urgent = self.raise_one("Urgent")
        high = self.raise_one("High")
        medium = self.raise_one("Medium")
        old = self.raise_one("Low")
        frappe.db.set_value("MSP Service Request", old, "creation", frappe.utils.add_days(frappe.utils.now_datetime(), -3), update_modified=False)
        self.as_user(self.tech, lambda: RequestService.run_action(medium, "start_review"))

        stats = self.as_user(self.tech, lambda: RequestService.get_stats())
        listed = lambda **f: self.as_user(self.tech, lambda: RequestService.list_requests(page_length=500, **f))
        names = lambda out: {row["name"] for row in out["rows"]}

        opened = listed(scope="open")
        self.assertEqual(opened["total"], stats["open"])
        self.assertTrue({urgent, high, medium, old} <= names(opened))

        attention = listed(scope="attention")
        self.assertEqual(attention["total"], stats["urgent_open"])
        self.assertTrue({urgent, high} <= names(attention))
        self.assertFalse({medium, old} & names(attention))

        ageing = listed(scope="ageing")
        self.assertEqual(ageing["total"], stats["ageing_open"])
        self.assertIn(old, names(ageing))
        self.assertNotIn(urgent, names(ageing))

        reviewing = listed(scope="all", status="Under Review")
        self.assertEqual(reviewing["total"], stats["under_review"])
        self.assertIn(medium, names(reviewing))


class TestEveryCardListsWhatItCounts(MSPTestCase):
    """The number on a card and the rows its eye opens come from one predicate — on every page."""

    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.alice = self.make_person(self.customer, "Alice")
        self.bob = self.make_person(self.customer, "Bob")
        frappe.db.set_value("MSP Client User", self.bob, {"lifecycle_status": "Disabled", "disabled_date": frappe.utils.today()})
        self.carl = self.make_person(self.customer, "Carl")
        frappe.db.set_value("MSP Client User", self.carl, "lifecycle_status", "Pending")
        self.box1 = self.make_device(self.customer, hostname="BOX1", holder=self.alice, serial="SN-C1")
        self.box2 = self.make_device(self.customer, hostname="BOX2", serial="SN-C2")
        frappe.db.set_value("MSP Managed Device", self.box2, {"status": "Retired", "retired_date": frappe.utils.today()})
        self.box3 = self.make_device(self.customer, hostname="BOX3", serial="SN-C3")
        frappe.db.set_value("MSP Managed Device", self.box3, "status", "Stock")
        self.service = self.make_service("EC", scope="User")
        self.manager = self.make_account("customer", "MSP Customer Manager", self.customer, suffix="ecm")
        self.grant(self.manager)
        self.tech = self.make_account("internal", "MSP Technician", suffix="ect")
        self.admin = self.make_account("internal", "MSP System Admin", suffix="eca")

    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def test_the_portal_people_and_machine_cards(self):
        summary = self.as_user(self.manager, lambda: PortalService.get_summary())
        people = lambda **f: self.as_user(self.manager, lambda: PortalService.list_client_users(page_length=500, **f))["total"]
        machines = lambda **f: self.as_user(self.manager, lambda: PortalService.list_devices(page_length=500, **f))["total"]

        self.assertEqual(summary["client_users"], people())
        self.assertEqual(summary["active_client_users"], people(status="Active"))
        self.assertEqual(summary["disabled_client_users"], people(status="Disabled"))
        self.assertEqual(summary["disabled_client_users"], 1, "pending is not disabled")

        self.assertEqual(summary["active_devices"], machines(status="Active"))
        self.assertEqual(summary["retired_devices"], machines(status="Retired"))
        self.assertEqual(summary["retired_devices"], 1, "stock is not retired")
        self.assertEqual(summary["devices_without_services"], machines(coverage="no_service"))
        self.assertEqual(summary["devices_without_services"], 1, "BOX1 runs nothing; the others are not active")

    def test_the_internal_dashboard_cards_and_their_queues(self):
        from nexgen_msp.api.internal.services.request_service import RequestService

        name = self.track("MSP Service Request", self.as_user(
            self.manager,
            lambda: PortalService.create_request(
                customer=self.customer, request_type="Add",
                lines=[{"request_action": self.action(), "action": "Add", "target_scope": "User", "client_user": self.alice, "requested_service": self.service}],
            ),
        )["name"])
        self.as_user(self.tech, lambda: RequestService.run_action(name, "start_review"))
        self.as_user(self.tech, lambda: RequestService.set_line_status(name, 1, "Approved"))
        self.as_user(self.tech, lambda: RequestService.run_action(name, "approve"))

        board = self.as_user(self.admin, DashboardService.get_dashboard)
        counters = board["requests"]
        listed = lambda **f: self.as_user(self.admin, lambda: RequestService.list_requests(page_length=500, **f))
        names = lambda out: {row["name"] for row in out["rows"]}

        self.assertEqual(listed(scope="open")["total"], counters["open"])
        self.assertEqual(listed(scope="all", status="Under Review")["total"], counters["under_review"])
        self.assertEqual(listed(scope="ageing")["total"], counters["ageing_open"])
        to_execute = listed(scope="to_execute")
        self.assertEqual(to_execute["total"], counters["requests_to_execute"])
        self.assertIn(name, names(to_execute), "approved, nothing delivered yet")
        self.assertGreaterEqual(counters["lines_to_execute"], 1)

        for kpi in ("reclaimable_licences", "devices_without_services"):
            rows = self.as_user(self.admin, lambda: DashboardService.list_kpi_rows(kpi, 0, 500))
            self.assertEqual(rows["total"], board["hygiene"][kpi], kpi)

        self.assertEqual(
            board["portfolio"]["active_client_users"],
            self.as_user(self.admin, lambda: UserService.list_users(status="Active", page_length=2000))["total"],
        )

    def test_the_internal_people_cards(self):
        stats = self.as_user(self.tech, lambda: UserService.get_stats(customer=self.customer))
        listed = lambda **f: self.as_user(self.tech, lambda: UserService.list_users(customer=self.customer, page_length=500, **f))["total"]

        self.assertEqual(stats["active_users"], listed(status="Active"))
        self.assertEqual(stats["users_with_idle_device"], listed(coverage="no_service"))
        self.assertEqual(stats["users_with_idle_device"], 1, "alice, whose BOX1 runs nothing")

        devices = self.as_user(self.tech, lambda: DeviceService.get_stats(customer=self.customer))
        machines = lambda **f: self.as_user(self.tech, lambda: DeviceService.list_devices(customer=self.customer, page_length=500, **f))["total"]
        self.assertEqual(devices["active_devices"], machines(status="Active"))
