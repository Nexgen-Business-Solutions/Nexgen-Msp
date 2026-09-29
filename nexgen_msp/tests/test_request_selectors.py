"""The builder's pickers list every person and every machine of the customer, greyed where they cannot be chosen."""

import frappe

from nexgen_msp.api.portal.endpoints import v1
from nexgen_msp.utils import request_targets

from .writer_case import WriterCase


class SelectorCase(WriterCase):
    def setUp(self):
        super().setUp()
        self.pending = self.person_in("Pending", "Pat")
        self.disabled = self.person_in("Disabled", "Dora")
        self.archived = self.person_in("Archived", "Arlo")
        self.shelf = self.make_device(self.customer, hostname=f"SS{self.tag[:4]}", serial=f"ZZTEST-SS-{self.tag}")
        self.broken = self.device_in("Damaged", "SD")
        self.lost = self.device_in("Lost", "SL")
        self.retired = self.device_in("Retired", "SR")
        self.other = self.make_customer(f"SX{self.tag[:4]}")
        self.outsider = self.make_person(self.other, f"Omar {self.tag}")
        self.far = self.make_device(self.other, hostname=f"SX{self.tag[:4]}", serial=f"ZZTEST-SX-{self.tag}")

    def person_in(self, status, label):
        name = self.make_person(self.customer, f"{label} {self.tag}")
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

    def device_in(self, status, label):
        name = self.make_device(
            self.customer, hostname=f"{label}{self.tag[:4]}", serial=f"ZZTEST-{label}-{self.tag}"
        )
        frappe.db.set_value("MSP Managed Device", name, "status", status)
        frappe.db.commit()

        return name

    def people_page(self, **kwargs):
        return self.as_manager(lambda: v1.list_selectable_client_users(customer=self.customer, **kwargs))

    def devices_page(self, **kwargs):
        return self.as_manager(lambda: v1.list_selectable_devices(customer=self.customer, **kwargs))

    def people(self, **kwargs):
        return self.people_page(**kwargs)["rows"]

    def devices(self, **kwargs):
        return self.devices_page(**kwargs)["rows"]


class TestChoosingAPerson(SelectorCase):
    def test_every_person_of_the_customer_is_listed(self):
        rows = {row["name"]: row for row in self.people()}

        for person in (self.helen, self.franck, self.pending, self.disabled, self.archived):
            self.assertIn(person, rows)

        self.assertNotIn(self.outsider, rows)

    def test_active_and_pending_people_can_be_chosen(self):
        rows = {row["name"]: row for row in self.people()}

        for person in (self.helen, self.pending):
            self.assertTrue(rows[person]["selectable"])
            self.assertIsNone(rows[person]["disabled_reason"])

    def test_disabled_and_archived_people_are_shown_greyed_with_the_reason(self):
        rows = {row["name"]: row for row in self.people()}

        for person in (self.disabled, self.archived):
            self.assertFalse(rows[person]["selectable"])
            self.assertEqual(rows[person]["disabled_reason"], request_targets.DISABLED_SELECTION)

    def test_each_row_says_who_the_person_is(self):
        row = next(row for row in self.people() if row["name"] == self.helen)

        for field in ("full_name", "department", "username", "email", "lifecycle_status"):
            self.assertIn(field, row)

        self.assertEqual(row["department"], self.department)

    def test_the_search_narrows_the_list(self):
        rows = self.people(search="Dora")

        self.assertEqual([row["name"] for row in rows], [self.disabled])

    def test_another_customer_is_refused(self):
        out = self.as_manager(lambda: v1.list_selectable_client_users(customer=self.other))

        self.assertIsInstance(out, dict)
        self.assertFalse(out["success"])


class TestChoosingAMachine(SelectorCase):
    def test_every_machine_of_the_customer_is_listed_whatever_its_state(self):
        rows = {row["name"]: row for row in self.devices()}

        for device in (self.laptop, self.shelf, self.broken, self.lost, self.retired):
            self.assertIn(device, rows)

        self.assertNotIn(self.far, rows)

    def test_a_held_machine_is_listed_with_its_holder_and_can_be_chosen(self):
        row = next(row for row in self.devices() if row["name"] == self.laptop)

        self.assertEqual(row["status"], "Active")
        self.assertEqual(row["current_holder"], self.franck)
        self.assertEqual(row["current_holder_name"], frappe.db.get_value("MSP Client User", self.franck, "full_name"))
        self.assertTrue(row["selectable"])

    def test_a_machine_in_stock_can_be_chosen(self):
        row = next(row for row in self.devices() if row["name"] == self.shelf)

        self.assertIsNone(row["current_holder"])
        self.assertTrue(row["selectable"])

    def test_a_retired_machine_is_shown_greyed_with_the_reason(self):
        rows = {row["name"]: row for row in self.devices()}

        self.assertFalse(rows[self.retired]["selectable"])
        self.assertEqual(rows[self.retired]["unavailable_reason"], request_targets.RETIRED_DEVICE)

        for device in (self.broken, self.lost):
            self.assertTrue(rows[device]["selectable"], "only Retired is unavailable today")

    def test_each_row_says_what_the_machine_is(self):
        row = next(row for row in self.devices() if row["name"] == self.laptop)

        for field in ("hostname", "serial_number", "device_type", "status", "current_holder"):
            self.assertIn(field, row)

    def test_the_search_narrows_the_list(self):
        rows = self.devices(search=f"ZZTEST-SS-{self.tag}")

        self.assertEqual([row["name"] for row in rows], [self.shelf])

    def test_another_customer_is_refused(self):
        out = self.as_manager(lambda: v1.list_selectable_devices(customer=self.other))

        self.assertIsInstance(out, dict)
        self.assertFalse(out["success"])

    def test_the_builder_chooser_offers_the_same_machines(self):
        from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

        options = self.as_manager(
            lambda: RequestScopeService.operation_options(
                customer=self.customer, subjects=[self.existing(self.helen)]
            )
        )
        assign = next(
            option
            for domain in options["domains"]
            if domain["key"] == "Device"
            for option in domain["options"]
            if option["operation_code"] == "device.assign"
        )
        stock = {row["value"]: row for row in assign["stock_options"]}

        self.assertEqual(set(stock), {row["name"] for row in self.devices()})
        self.assertFalse(stock[self.retired]["selectable"])
        self.assertTrue(stock[self.laptop]["selectable"])
        self.assertEqual(stock[self.laptop]["current_holder"], self.franck)


class TestTheSelectorsAreBounded(SelectorCase):
    def test_the_people_list_stops_at_the_limit_and_says_how_many_match(self):
        everyone = frappe.db.count("MSP Client User", {"customer": self.customer})
        page = self.people_page(limit=2)

        self.assertEqual(everyone, 5)
        self.assertEqual(len(page["rows"]), 2)
        self.assertEqual(page["total"], 5)
        self.assertTrue(page["truncated"])

        whole = self.people_page()
        self.assertEqual((len(whole["rows"]), whole["total"], whole["truncated"]), (5, 5, False))

    def test_the_machine_list_stops_at_the_limit_and_says_how_many_match(self):
        page = self.devices_page(limit="3")

        self.assertEqual(len(page["rows"]), 3)
        self.assertEqual(page["total"], 5)
        self.assertTrue(page["truncated"])
        self.assertEqual(
            {row["name"] for row in self.devices_page()["rows"]},
            {self.laptop, self.shelf, self.broken, self.lost, self.retired},
        )

    def test_with_a_search_the_limit_and_the_total_apply_to_the_matches(self):
        people = self.people_page(search=self.tag, limit=1)
        machines = self.devices_page(search="ZZTEST-S", limit=1)

        self.assertEqual((len(people["rows"]), people["total"], people["truncated"]), (1, 5, True))
        self.assertEqual((len(machines["rows"]), machines["total"], machines["truncated"]), (1, 4, True))

        dora = self.people_page(search="Dora", limit=1)
        self.assertEqual(([row["name"] for row in dora["rows"]], dora["total"], dora["truncated"]), ([self.disabled], 1, False))

    def test_the_limit_never_exceeds_two_hundred_and_defaults_to_fifty(self):
        from nexgen_msp.api.internal.services.requested_device_service import selector_limit

        self.assertEqual(selector_limit(None), 50)
        self.assertEqual(selector_limit(""), 50)
        self.assertEqual(selector_limit(500), 200)
        self.assertEqual(selector_limit("7"), 7)
        self.assertFalse(self.people_page(limit=0)["success"])

    def test_greyed_rows_are_still_returned_within_the_limit(self):
        greyed = self.people_page(search="Arlo", limit=1)["rows"]
        retired = self.devices_page(search=f"ZZTEST-SR-{self.tag}", limit=1)["rows"]

        self.assertEqual([(row["name"], row["selectable"]) for row in greyed], [(self.archived, False)])
        self.assertEqual([(row["name"], row["selectable"]) for row in retired], [(self.retired, False)])

    def test_the_internal_selectors_answer_the_same_shape(self):
        from nexgen_msp.api.internal.endpoints import v1 as internal

        tech = self.make_account("internal", "MSP Technician", suffix=f"sl{self.tag[:3]}")
        people = self.as_user(tech, lambda: internal.list_selectable_client_users(customer=self.customer, limit=2))
        machines = self.as_user(tech, lambda: internal.list_selectable_devices(customer=self.customer, limit=250))

        self.assertEqual((len(people["rows"]), people["total"], people["truncated"]), (2, 5, True))
        self.assertEqual((len(machines["rows"]), machines["total"], machines["truncated"]), (5, 5, False))
        self.assertFalse(self.as_manager(lambda: internal.list_selectable_devices(customer=self.customer))["success"])
