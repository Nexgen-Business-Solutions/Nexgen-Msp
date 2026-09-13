"""What a service goes through, from the day somebody asks for it to the day it stops.

A service is opened on one target — a person or a machine — under a contract that covers it
and a rate somebody agreed to, and from then on every act writes a period rather than editing
one. These tests ask the domain directly: the same questions Billing will later ask of the
records they leave behind.
"""

import frappe

from nexgen_msp.api.internal.services.device_lifecycle_service import DeviceLifecycleService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.utils.errors import ValidationError

from .base import MSPTestCase


class TestServiceLifecycle(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.customer = self.make_customer()
        self.john = self.make_person(self.customer, "John")
        self.bob = self.make_person(self.customer, "Bob")
        self.today = frappe.utils.today()

    def tearDown(self):
        # a submitted billing run refuses an ordinary delete, and it holds the very
        # assignments the rest of the clean-up is about to remove
        frappe.set_user("Administrator")

        for run in frappe.get_all("MSP Billing Run", filters={"customer": self.customer}, pluck="name"):
            frappe.db.sql("delete from `tabMSP Billing Run Line` where parent = %s", run)
            frappe.db.sql("delete from `tabMSP Billing Run` where name = %s", run)

        frappe.db.commit()
        super().tearDown()

    # ------------------------------------------------------------------ fixtures
    def days_ago(self, days):
        return frappe.utils.add_days(self.today, -days)

    def selling_price_list(self):
        row = frappe.db.get_value(
            "Price List", {"selling": 1, "enabled": 1}, ["name", "currency"], as_dict=True
        )

        if row:
            return row.name, row.currency

        doc = frappe.get_doc(
            {
                "doctype": "Price List",
                "price_list_name": "ZZTEST Selling",
                "selling": 1,
                "enabled": 1,
                "currency": frappe.defaults.get_global_default("currency") or "USD",
            }
        ).insert(ignore_permissions=True)
        self.track("Price List", doc.name)

        return doc.name, doc.currency

    def cover(self, service, rate=25.0):
        """Put a service on the customer's live contract, at a rate that is in force today."""
        price_list, currency = self.selling_price_list()
        existing = frappe.db.get_value("MSP Contract", {"customer": self.customer}, "name")

        doc = (
            frappe.get_doc("MSP Contract", existing)
            if existing
            else frappe.get_doc(
                {
                    "doctype": "MSP Contract",
                    "customer": self.customer,
                    "status": "Active",
                    "start_date": self.days_ago(365),
                    "billing_frequency": "Monthly",
                    "billing_timing": "In Arrears",
                    "proration_method": "Daily Actual Days",
                    "invoice_grouping": "One Invoice",
                    "price_list": price_list,
                    "currency": currency,
                }
            )
        )

        if not any(row.service_item == service for row in doc.services):
            doc.append("services", {"service_item": service})

        doc.save(ignore_permissions=True)
        self.track("MSP Contract", doc.name)

        if rate:
            self.price(service, rate, price_list, currency)

        frappe.db.commit()

        return doc.name

    def price(self, service, rate, price_list, currency):
        existing = frappe.db.get_value(
            "Item Price", {"item_code": service, "customer": self.customer, "selling": 1}, "name"
        )

        if existing:
            return existing

        doc = frappe.get_doc(
            {
                "doctype": "Item Price",
                "item_code": service,
                "price_list": price_list,
                "customer": self.customer,
                "selling": 1,
                "buying": 0,
                "currency": currency,
                "price_list_rate": rate,
                "valid_from": self.days_ago(365),
            }
        ).insert(ignore_permissions=True)

        return self.track("Item Price", doc.name)

    def offering(self, suffix, scope="User", rate=25.0):
        """A catalogue entry this customer is contracted for."""
        service = self.make_service(suffix, scope=scope)
        self.cover(service, rate=rate)

        return service

    def open_service(self, service, scope="User", **kwargs):
        outcome = ServiceLifecycleService.activate(
            customer=self.customer,
            service_item=service,
            target_scope=scope,
            client_user=kwargs.pop("client_user", self.john if scope == "User" else None),
            managed_device=kwargs.pop("managed_device", None),
            **kwargs,
        )
        self.track("MSP Service Assignment", outcome["name"])

        return outcome

    def reload(self, assignment):
        return frappe.get_doc("MSP Service Assignment", assignment)

    def invoice(self, assignment, period_start, period_end):
        """A run the customer has already been sent, in the only shape _billed_to reads."""
        run = frappe.get_doc(
            {
                "doctype": "MSP Billing Run",
                "customer": self.customer,
                "status": "Draft",
                "billing_period_start": period_start,
                "billing_period_end": period_end,
                "lines": [
                    {
                        "service_assignment": assignment,
                        "service_item": frappe.db.get_value(
                            "MSP Service Assignment", assignment, "service_item"
                        ),
                        "quantity": 1,
                        "billable_months": 1,
                        "unit_rate": 25,
                        "amount": 25,
                        "price_source": "Contract",
                    }
                ],
            }
        ).insert(ignore_permissions=True)
        run.submit()
        frappe.db.commit()

        return run.name

    # --------------------------------------------------------------- opening a service
    def test_a_user_service_opens_on_a_person(self):
        service = self.offering("LIFEU")
        outcome = self.open_service(service)
        doc = self.reload(outcome["name"])

        self.assertEqual(doc.operational_status, "Active")
        self.assertEqual(doc.billing_status, "Billable")
        self.assertEqual(doc.assignment_scope, "User")
        self.assertEqual(doc.client_user, self.john)
        self.assertIsNone(doc.managed_device)
        self.assertEqual(frappe.utils.getdate(doc.effective_start_date), frappe.utils.getdate(self.today))
        self.assertEqual(doc.quantity, 1)
        self.assertEqual(doc.price_source, "Contract")

    def test_a_service_sold_either_way_runs_for_the_person_and_the_machine_at_once(self):
        service = self.offering("LIFEBOTH", scope="Both")
        device = self.make_device(self.customer, hostname="BOTH", serial="SN-LIFE-BOTH")

        personal = self.open_service(service, scope="User")
        machine = self.open_service(service, scope="Device", managed_device=device)

        self.assertEqual(self.reload(personal["name"]).operational_status, "Active")
        self.assertEqual(self.reload(machine["name"]).operational_status, "Active")
        self.assertEqual(self.reload(machine["name"]).managed_device, device)
        self.assertIsNone(self.reload(machine["name"]).client_user)

    def test_one_device_service_runs_on_two_machines_of_the_same_customer(self):
        service = self.offering("LIFEDEV", scope="Device")
        first = self.make_device(self.customer, hostname="ONE", serial="SN-LIFE-ONE")
        second = self.make_device(self.customer, hostname="TWO", serial="SN-LIFE-TWO")

        a = self.open_service(service, scope="Device", managed_device=first)
        b = self.open_service(service, scope="Device", managed_device=second)

        self.assertNotEqual(a["name"], b["name"])
        self.assertEqual(self.reload(a["name"]).managed_device, first)
        self.assertEqual(self.reload(b["name"]).managed_device, second)

    def test_the_same_service_cannot_be_opened_twice_on_one_target(self):
        service = self.offering("LIFEDUP")
        self.open_service(service)

        with self.assertRaises(ValidationError):
            self.open_service(service)

    def test_a_service_can_be_opened_again_after_it_was_closed(self):
        service = self.offering("LIFEAGAIN")
        first = self.open_service(service, effective_date=self.days_ago(30))
        ServiceLifecycleService.end(assignment=first["name"], effective_date=self.days_ago(20))

        second = self.open_service(service, effective_date=self.days_ago(10))

        self.assertNotEqual(first["name"], second["name"])
        self.assertEqual(self.reload(first["name"]).operational_status, "Ended")
        self.assertEqual(self.reload(second["name"]).operational_status, "Active")

    def test_a_retired_catalogue_entry_cannot_be_sold(self):
        service = self.offering("LIFEOFF")
        frappe.db.set_value("Item", service, "disabled", 1)
        frappe.db.commit()

        with self.assertRaises(ValidationError):
            self.open_service(service)

        frappe.db.set_value("Item", service, "disabled", 0)
        frappe.db.commit()

    def test_a_service_no_contract_covers_is_still_recorded(self):
        service = self.make_service("LIFENOCON", scope="User")

        opened = self.open_service(service)

        self.assertEqual(self.reload(opened["name"]).price_source, "Unpriced")

    def test_a_suspended_contract_does_not_stop_a_real_service(self):
        service = self.offering("LIFESUSPCON")
        contract = frappe.db.get_value("MSP Contract", {"customer": self.customer}, "name")
        frappe.db.set_value("MSP Contract", contract, "status", "Suspended")
        frappe.db.commit()

        opened = self.open_service(service)

        self.assertEqual(self.reload(opened["name"]).operational_status, "Active")

    def test_a_service_without_a_rate_is_recorded_as_unpriced(self):
        service = self.offering("LIFENORATE", rate=None)

        opened = self.open_service(service)

        self.assertEqual(self.reload(opened["name"]).price_source, "Unpriced")

    def test_a_manual_rate_carries_its_reason_onto_the_assignment(self):
        service = self.offering("LIFEMANUAL", rate=None)
        outcome = self.open_service(
            service, agreed_rate=42, rate_override_reason="Agreed with the account manager."
        )
        doc = self.reload(outcome["name"])

        self.assertEqual(doc.price_source, "Manual Override")
        self.assertEqual(doc.agreed_rate, 42)
        self.assertTrue(doc.rate_override_reason)

    def test_a_manual_rate_without_a_reason_is_refused(self):
        service = self.offering("LIFEMANUALNO", rate=None)

        with self.assertRaises(ValidationError):
            self.open_service(service, agreed_rate=42)

    # ------------------------------------------------------------ who may receive one
    def test_a_person_who_has_left_is_given_no_new_service(self):
        service = self.offering("LIFEGONE")

        for status in ("Disabled", "Archived"):
            frappe.db.set_value("MSP Client User", self.john, "lifecycle_status", status)
            frappe.db.commit()

            with self.assertRaises(ValidationError):
                self.open_service(service)

        frappe.db.set_value("MSP Client User", self.john, "lifecycle_status", "Active")
        frappe.db.commit()

    def test_a_machine_on_the_shelf_takes_a_service_and_a_retired_one_does_not(self):
        service = self.offering("LIFESTOCK", scope="Device")
        stock = self.make_device(self.customer, hostname="SHELF", serial="SN-LIFE-SHELF")
        gone = self.make_device(self.customer, hostname="GONE", serial="SN-LIFE-GONE")

        opened = self.open_service(service, scope="Device", managed_device=stock)
        self.assertEqual(self.reload(opened["name"]).operational_status, "Active")

        frappe.db.set_value("MSP Managed Device", gone, "status", "Retired")
        frappe.db.commit()

        with self.assertRaises(ValidationError):
            self.open_service(service, scope="Device", managed_device=gone)

    def test_a_user_only_service_is_refused_on_a_device(self):
        service = self.offering("LIFEUONLY")
        device = self.make_device(self.customer, hostname="WRONG", serial="SN-LIFE-WRONG")

        with self.assertRaises(ValidationError):
            self.open_service(service, scope="Device", managed_device=device)

    # ------------------------------------------------------------------- pausing it
    def test_suspending_writes_one_open_pause_and_holds_the_billing(self):
        service = self.offering("LIFEPAUSE")
        opened = self.open_service(service, effective_date=self.days_ago(30))

        ServiceLifecycleService.suspend(
            assignment=opened["name"], effective_date=self.days_ago(5), notes="Sur demande"
        )
        doc = self.reload(opened["name"])
        running = [row for row in doc.suspension_log if not row.resumed_on]

        self.assertEqual(doc.operational_status, "Suspended")
        self.assertEqual(doc.billing_status, "On Hold")
        self.assertEqual(len(doc.suspension_log), 1)
        self.assertEqual(len(running), 1)
        self.assertEqual(frappe.utils.getdate(running[0].suspended_on), frappe.utils.getdate(self.days_ago(5)))
        self.assertEqual(running[0].suspended_by, frappe.session.user)

    def test_a_suspended_service_cannot_be_suspended_again(self):
        service = self.offering("LIFEPAUSE2")
        opened = self.open_service(service, effective_date=self.days_ago(30))
        ServiceLifecycleService.suspend(assignment=opened["name"], effective_date=self.days_ago(5))

        with self.assertRaises(ValidationError):
            ServiceLifecycleService.suspend(assignment=opened["name"])

    def test_resuming_closes_the_pause_and_bills_again(self):
        service = self.offering("LIFERESUME")
        opened = self.open_service(service, effective_date=self.days_ago(30))
        ServiceLifecycleService.suspend(assignment=opened["name"], effective_date=self.days_ago(10))

        ServiceLifecycleService.resume(assignment=opened["name"], effective_date=self.days_ago(3))
        doc = self.reload(opened["name"])

        self.assertEqual(doc.operational_status, "Active")
        self.assertEqual(doc.billing_status, "Billable")
        self.assertEqual(len(doc.suspension_log), 1)
        self.assertEqual(
            frappe.utils.getdate(doc.suspension_log[0].resumed_on), frappe.utils.getdate(self.days_ago(3))
        )
        self.assertEqual(doc.suspension_log[0].resumed_by, frappe.session.user)

    def test_a_running_service_cannot_be_resumed(self):
        service = self.offering("LIFERESUME2")
        opened = self.open_service(service)

        with self.assertRaises(ValidationError):
            ServiceLifecycleService.resume(assignment=opened["name"])

    def test_a_resume_cannot_predate_the_pause_it_closes(self):
        service = self.offering("LIFERESUME3")
        opened = self.open_service(service, effective_date=self.days_ago(30))
        ServiceLifecycleService.suspend(assignment=opened["name"], effective_date=self.days_ago(5))

        with self.assertRaises(ValidationError):
            ServiceLifecycleService.resume(assignment=opened["name"], effective_date=self.days_ago(10))

    def test_a_pause_behind_an_invoiced_period_goes_through_and_is_noted(self):
        service = self.offering("LIFEBILLED")
        opened = self.open_service(service, effective_date=self.days_ago(60))
        self.invoice(opened["name"], self.days_ago(60), self.days_ago(31))

        ServiceLifecycleService.suspend(
            assignment=opened["name"], effective_date=self.days_ago(40)
        )

        doc = self.reload(opened["name"])
        self.assertEqual(doc.operational_status, "Suspended")
        self.assertIn("invoice", (doc.suspension_log[0].note or "").lower())

    def test_confirmed_it_goes_through_and_says_so_in_the_history(self):
        service = self.offering("LIFEBILLOK")
        opened = self.open_service(service, effective_date=self.days_ago(60))
        run = self.invoice(opened["name"], self.days_ago(60), self.days_ago(31))
        amount = frappe.db.get_value("MSP Billing Run Line", {"parent": run}, "amount")

        ServiceLifecycleService.suspend(
            assignment=opened["name"], effective_date=self.days_ago(40), confirm_billed=1
        )

        doc = self.reload(opened["name"])
        self.assertEqual(doc.operational_status, "Suspended")
        self.assertIn("invoice", (doc.suspension_log[0].note or "").lower())
        self.assertEqual(frappe.db.get_value("MSP Billing Run Line", {"parent": run}, "amount"), amount)

    def test_a_resume_behind_an_invoiced_period_goes_through_the_same_way(self):
        service = self.offering("LIFEBILLRS")
        opened = self.open_service(service, effective_date=self.days_ago(60))
        ServiceLifecycleService.suspend(assignment=opened["name"], effective_date=self.days_ago(50))
        self.invoice(opened["name"], self.days_ago(60), self.days_ago(31))

        ServiceLifecycleService.resume(assignment=opened["name"], effective_date=self.days_ago(40))
        self.assertEqual(self.reload(opened["name"]).operational_status, "Active")

    def test_a_service_is_changed_directly_onto_another_one(self):
        from nexgen_msp.api.internal.services.user_service import UserService

        old = self.offering("LIFECHGA")
        new = self.offering("LIFECHGB")
        opened = self.open_service(old, effective_date=self.days_ago(30))

        UserService.change_service(
            assignment=opened["name"], action="Change", effective_date=self.days_ago(5), service_item=new
        )

        self.assertEqual(self.reload(opened["name"]).operational_status, "Ended")
        replacement = frappe.db.get_value(
            "MSP Service Assignment",
            {"service_item": new, "client_user": self.reload(opened["name"]).client_user, "operational_status": "Active"},
            "name",
        )
        self.assertTrue(replacement)
        self.track("MSP Service Assignment", replacement)

    def test_a_pause_after_the_invoiced_period_asks_nothing(self):
        service = self.offering("LIFEBILLAF")
        opened = self.open_service(service, effective_date=self.days_ago(60))
        self.invoice(opened["name"], self.days_ago(60), self.days_ago(31))

        ServiceLifecycleService.suspend(assignment=opened["name"], effective_date=self.days_ago(10))
        self.assertEqual(self.reload(opened["name"]).operational_status, "Suspended")

    # ------------------------------------------------------------------ closing it
    def test_a_service_can_be_closed_behind_a_period_already_invoiced(self):
        """Recorded late, it still closes: the invoice stays and no credit note appears."""
        service = self.offering("LIFEENDBILLED")
        opened = self.open_service(service, effective_date=self.days_ago(60))
        run = self.invoice(opened["name"], self.days_ago(60), self.days_ago(1))
        lines_before = frappe.get_all(
            "MSP Billing Run Line",
            filters={"parent": run},
            fields=["amount", "billable_months", "covered_to"],
        )

        ServiceLifecycleService.end(assignment=opened["name"], effective_date=self.days_ago(20))

        doc = self.reload(opened["name"])
        self.assertEqual(doc.operational_status, "Ended")
        self.assertEqual(frappe.utils.getdate(doc.effective_end_date), frappe.utils.getdate(self.days_ago(20)))
        self.assertEqual(
            frappe.get_all(
                "MSP Billing Run Line",
                filters={"parent": run},
                fields=["amount", "billable_months", "covered_to"],
            ),
            lines_before,
        )
        self.assertFalse(frappe.db.exists("MSP Billing Run", {"credit_note_of": run}))

    def test_closing_a_suspended_service_keeps_its_pause_open(self):
        service = self.offering("LIFECLOSED")
        opened = self.open_service(service, effective_date=self.days_ago(30))
        ServiceLifecycleService.suspend(assignment=opened["name"], effective_date=self.days_ago(10))

        ServiceLifecycleService.end(assignment=opened["name"], effective_date=self.days_ago(2))
        doc = self.reload(opened["name"])

        self.assertEqual(doc.operational_status, "Ended")
        self.assertEqual(doc.billing_status, "Ended")
        self.assertEqual(frappe.utils.getdate(doc.effective_end_date), frappe.utils.getdate(self.days_ago(2)))
        self.assertEqual(len(doc.suspension_log), 1)
        self.assertIsNone(doc.suspension_log[0].resumed_on)

    def test_a_closed_service_cannot_be_closed_again(self):
        service = self.offering("LIFECLOSE2")
        opened = self.open_service(service, effective_date=self.days_ago(10))
        ServiceLifecycleService.end(assignment=opened["name"], effective_date=self.days_ago(2))

        with self.assertRaises(ValidationError):
            ServiceLifecycleService.end(assignment=opened["name"])

    # --------------------------------------------------------- prepared and dropped
    def test_a_prepared_service_goes_into_service_when_it_is_provisioned(self):
        service = self.offering("LIFEPREP")
        prepared = ServiceLifecycleService.create_pending(
            customer=self.customer,
            service_item=service,
            target_scope="User",
            client_user=self.john,
        )
        self.track("MSP Service Assignment", prepared["name"])

        self.assertEqual(prepared["operational_status"], "Pending Setup")
        self.assertEqual(prepared["billing_status"], "Pending")

        ServiceLifecycleService.activate_pending(assignment=prepared["name"])
        doc = self.reload(prepared["name"])

        self.assertEqual(doc.operational_status, "Active")
        self.assertEqual(doc.billing_status, "Billable")
        self.assertEqual(frappe.utils.getdate(doc.effective_start_date), frappe.utils.getdate(self.today))

    def test_only_a_prepared_service_can_be_cancelled(self):
        service = self.offering("LIFECANCEL")
        prepared = ServiceLifecycleService.create_pending(
            customer=self.customer,
            service_item=service,
            target_scope="User",
            client_user=self.john,
        )
        self.track("MSP Service Assignment", prepared["name"])

        ServiceLifecycleService.cancel(assignment=prepared["name"], notes="Plus besoin")
        doc = self.reload(prepared["name"])

        self.assertEqual(doc.operational_status, "Cancelled")
        self.assertEqual(doc.billing_status, "Not Billable")

        running = self.open_service(self.offering("LIFECANCEL2"))

        with self.assertRaises(ValidationError):
            ServiceLifecycleService.cancel(assignment=running["name"])

    # --------------------------------------------------------------- planned removal
    def test_a_scheduled_removal_can_be_called_off(self):
        service = self.offering("LIFEREMOVAL")
        opened = self.open_service(service, effective_date=self.days_ago(10))

        ServiceLifecycleService.schedule_removal(
            assignment=opened["name"], effective_date=frappe.utils.add_days(self.today, 15)
        )
        doc = self.reload(opened["name"])

        self.assertEqual(doc.operational_status, "Pending Removal")
        self.assertEqual(doc.billing_status, "Billable")

        ServiceLifecycleService.cancel_removal(assignment=opened["name"])
        doc = self.reload(opened["name"])

        self.assertEqual(doc.operational_status, "Active")
        self.assertEqual(doc.billing_status, "Billable")

        with self.assertRaises(ValidationError):
            ServiceLifecycleService.cancel_removal(assignment=opened["name"])

    def test_a_service_awaiting_removal_can_still_be_closed(self):
        service = self.offering("LIFEREMOVAL2")
        opened = self.open_service(service, effective_date=self.days_ago(10))
        ServiceLifecycleService.schedule_removal(assignment=opened["name"])

        ServiceLifecycleService.end(assignment=opened["name"], effective_date=self.days_ago(1))

        self.assertEqual(self.reload(opened["name"]).operational_status, "Ended")

    # ------------------------------------------------------------------- changing it
    def test_changing_the_quantity_writes_two_periods_that_do_not_overlap(self):
        service = self.offering("LIFEQTY")
        opened = self.open_service(service, effective_date=self.days_ago(30), quantity=10)

        replacement = ServiceLifecycleService.change(
            assignment=opened["name"], effective_date=self.days_ago(10), quantity=15
        )
        self.track("MSP Service Assignment", replacement["name"])

        old = self.reload(opened["name"])
        new = self.reload(replacement["name"])

        self.assertEqual(old.operational_status, "Ended")
        self.assertEqual(old.quantity, 10)
        self.assertEqual(frappe.utils.getdate(old.effective_end_date), frappe.utils.getdate(self.days_ago(11)))

        self.assertEqual(new.operational_status, "Active")
        self.assertEqual(new.quantity, 15)
        self.assertEqual(frappe.utils.getdate(new.effective_start_date), frappe.utils.getdate(self.days_ago(10)))
        self.assertEqual(new.client_user, old.client_user)
        self.assertEqual(replacement["replaced"], opened["name"])

        # the two periods have to survive the doctype's own reading of them, one after the other
        old.save()
        new.save()

    def test_changing_the_service_moves_the_person_onto_the_new_plan(self):
        basic = self.offering("LIFEBASIC")
        premium = self.offering("LIFEPREMIUM")
        opened = self.open_service(basic, effective_date=self.days_ago(20))

        replacement = ServiceLifecycleService.change(
            assignment=opened["name"], effective_date=self.days_ago(5), service_item=premium
        )
        self.track("MSP Service Assignment", replacement["name"])

        self.assertEqual(self.reload(opened["name"]).service_item, basic)
        self.assertEqual(self.reload(replacement["name"]).service_item, premium)
        self.assertEqual(self.reload(replacement["name"]).quantity, 1)

    def test_an_invalid_replacement_keeps_the_original_service_active(self):
        current = self.offering("LIFEATOMIC")
        unavailable = self.make_service("LIFEWRONGSCOPE", scope="Device")
        opened = self.open_service(current, effective_date=self.days_ago(20))

        with self.assertRaises(ValidationError):
            ServiceLifecycleService.change(
                assignment=opened["name"],
                effective_date=self.days_ago(5),
                service_item=unavailable,
            )

        original = self.reload(opened["name"])
        self.assertEqual(original.operational_status, "Active")
        self.assertIsNone(original.effective_end_date)
        self.assertFalse(
            frappe.db.exists(
                "MSP Service Assignment",
                {"customer": self.customer, "service_item": unavailable},
            )
        )

    def test_a_closed_service_has_no_running_period_to_change(self):
        service = self.offering("LIFECHANGE3")
        opened = self.open_service(service, effective_date=self.days_ago(20))
        ServiceLifecycleService.end(assignment=opened["name"], effective_date=self.days_ago(5))

        with self.assertRaises(ValidationError):
            ServiceLifecycleService.change(assignment=opened["name"], quantity=4)

    # ---------------------------------------------------- the machine owns its services
    def test_moving_a_machine_between_people_leaves_its_services_alone(self):
        service = self.offering("LIFEOWN", scope="Device")
        device = self.make_device(
            self.customer, hostname="OWNED", holder=self.john, serial="SN-LIFE-OWNED"
        )
        opened = self.open_service(service, scope="Device", managed_device=device)

        fields = [
            "operational_status",
            "billing_status",
            "client_user",
            "managed_device",
            "effective_start_date",
            "effective_end_date",
            "modified",
        ]
        before = frappe.db.get_value("MSP Service Assignment", opened["name"], fields, as_dict=True)

        DeviceLifecycleService.transfer(device=device, client_user=self.bob)
        after = frappe.db.get_value("MSP Service Assignment", opened["name"], fields, as_dict=True)
        self.assertEqual(after, before, "a machine changing hands keeps what it is billed for")

        DeviceLifecycleService.repossess(device=device)
        after = frappe.db.get_value("MSP Service Assignment", opened["name"], fields, as_dict=True)
        self.assertEqual(after, before, "a machine taken back keeps what it is billed for")
        self.assertEqual(after.operational_status, "Active")
