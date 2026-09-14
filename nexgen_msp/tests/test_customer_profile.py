"""A company's own details: what they may correct, and what is ours to set.

Where they are and who to call is theirs. What they are called commercially, what currency
they are billed in and on what terms is the agreement, and a party to an agreement does not
edit the agreement.

Two things make this more than a field list. A field somebody may not set is refused rather
than quietly dropped, because silently ignoring it tells the caller their change went through
when it did not. And a record two companies share is nobody's to correct alone: editing it
would change the other company's records without anyone there asking.
"""

import frappe

from nexgen_msp.api.internal.services.customer_service import CustomerService
from nexgen_msp.utils.errors import NexgenError
from nexgen_msp.utils.errors import ValidationError as Refused

from .base import MSPTestCase


class ProfileCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=6)
        self.acme = self.make_customer(self.tag)
        self.beta = self.make_customer(f"{self.tag}B")

        self.manager = self.make_account(
            "customer", "MSP Customer Manager", self.acme, suffix=f"pa{self.tag[:3]}"
        )
        self.technician = self.make_account(
            "internal", "MSP Technician", suffix=f"pt{self.tag[:3]}"
        )
        self.admin = self.make_account(
            "internal", "MSP System Admin", suffix=f"ps{self.tag[:3]}"
        )

    def as_user(self, email, fn):
        frappe.set_user(email)
        frappe.clear_cache(user=email)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")

    def as_manager(self, fn):
        return self.as_user(self.manager, fn)

    def as_admin(self, fn):
        return self.as_user(self.admin, fn)

    def address(self, **fields):
        return {
            "address_line1": f"{self.tag} High Street",
            "city": "Douala",
            "country": "Cameroon",
            **fields,
        }

    def shared_address(self):
        doc = frappe.get_doc(
            {
                "doctype": "Address",
                "address_title": f"ZZTEST Shared {self.tag}",
                "address_type": "Billing",
                "is_primary_address": 1,
                "address_line1": f"{self.tag} Shared Way",
                "city": "Douala",
                "country": "Cameroon",
                "links": [
                    {"link_doctype": "Customer", "link_name": self.acme},
                    {"link_doctype": "Customer", "link_name": self.beta},
                ],
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()

        return self.track("Address", doc.name)

    def contact_of(self, customer, user=None):
        doc = frappe.get_doc(
            {
                "doctype": "Contact",
                "first_name": f"ZZTEST Reach {self.tag}",
                "user": user,
                "links": [{"link_doctype": "Customer", "link_name": customer}],
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()

        return self.track("Contact", doc.name)


class TestWhatACompanyMayCorrectAboutItself(ProfileCase):
    def test_the_country_picker_loads_without_disclosing_commercial_catalogues(self):
        options = self.as_manager(CustomerService.options)

        self.assertTrue(options["countries"])
        for key in (
            "customer_types",
            "customer_groups",
            "territories",
            "currencies",
            "price_lists",
            "payment_terms",
        ):
            self.assertEqual(options[key], [], key)

    def test_they_may_set_their_website(self):
        self.as_manager(
            lambda: CustomerService.save_customer(
                customer=self.acme, details={"website": "https://acme.example"}
            )
        )

        self.assertEqual(
            frappe.db.get_value("Customer", self.acme, "website"), "https://acme.example"
        )

    def test_they_may_correct_where_they_are(self):
        self.as_manager(
            lambda: CustomerService.save_customer(
                customer=self.acme, address=self.address(city="Yaoundé")
            )
        )

        reading = self.as_manager(lambda: CustomerService.get_customer(self.acme))

        self.assertEqual(reading["address"]["city"], "Yaoundé")

    def test_they_may_say_who_to_call(self):
        self.as_manager(
            lambda: CustomerService.save_customer(
                customer=self.acme,
                contact={"first_name": "Marie", "email_id": f"marie{self.tag}@acme.invalid"},
            )
        )

        reading = self.as_manager(lambda: CustomerService.get_customer(self.acme))

        self.assertEqual(reading["contact"]["first_name"], "Marie")

    def test_a_commercial_field_is_refused_and_not_quietly_dropped(self):
        with self.assertRaises(Refused) as caught:
            self.as_manager(
                lambda: CustomerService.save_customer(
                    customer=self.acme, details={"default_currency": "USD"}
                )
            )

        self.assertIn("default_currency", str(caught.exception))
        self.assertNotEqual(
            frappe.db.get_value("Customer", self.acme, "default_currency"), "USD"
        )

    def test_their_own_name_is_not_theirs_to_change(self):
        was = frappe.db.get_value("Customer", self.acme, "customer_name")

        with self.assertRaises(Refused):
            self.as_manager(
                lambda: CustomerService.save_customer(
                    customer=self.acme, details={"customer_name": "Something Else"}
                )
            )

        self.assertEqual(frappe.db.get_value("Customer", self.acme, "customer_name"), was)

    def test_a_field_nobody_has_heard_of_is_refused(self):
        with self.assertRaises(Refused) as caught:
            self.as_manager(
                lambda: CustomerService.save_customer(
                    customer=self.acme, details={"secret_discount": 90}
                )
            )

        self.assertIn("secret_discount", str(caught.exception))

    def test_another_company_is_not_theirs_at_all(self):
        with self.assertRaises(NexgenError):
            self.as_manager(
                lambda: CustomerService.save_customer(
                    customer=self.beta, details={"website": "https://beta.example"}
                )
            )

    def test_our_own_administrator_sets_the_commercial_terms(self):
        self.as_admin(
            lambda: CustomerService.save_customer(
                customer=self.acme, details={"website": "https://acme.example", "tax_id": "TX-1"}
            )
        )

        self.assertEqual(frappe.db.get_value("Customer", self.acme, "tax_id"), "TX-1")


class TestARecordTwoCompaniesShare(ProfileCase):
    def test_a_shared_address_is_read_only_to_a_manager(self):
        self.shared_address()

        with self.assertRaises(Refused) as caught:
            self.as_manager(
                lambda: CustomerService.save_customer(
                    customer=self.acme, address=self.address(city="Kribi")
                )
            )

        self.assertIn("shared", str(caught.exception).lower())

    def test_our_own_administrator_maintains_it(self):
        self.shared_address()

        self.as_admin(
            lambda: CustomerService.save_customer(
                customer=self.acme, address=self.address(city="Kribi")
            )
        )

        reading = self.as_admin(lambda: CustomerService.get_customer(self.acme))

        self.assertEqual(reading["address"]["city"], "Kribi")

    def test_the_reading_says_it_is_shared(self):
        self.shared_address()

        reading = self.as_manager(lambda: CustomerService.get_customer(self.acme))

        self.assertTrue(reading["shared"]["address"])

    def test_a_shared_contact_is_read_only_to_a_manager(self):
        contact = frappe.get_doc(
            {
                "doctype": "Contact",
                "first_name": f"ZZTEST Both {self.tag}",
                "links": [
                    {"link_doctype": "Customer", "link_name": self.acme},
                    {"link_doctype": "Customer", "link_name": self.beta},
                ],
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        self.track("Contact", contact.name)

        with self.assertRaises(Refused) as caught:
            self.as_manager(
                lambda: CustomerService.save_customer(
                    customer=self.acme,
                    contact={"name": contact.name, "first_name": "Renamed"},
                )
            )

        self.assertIn("shared", str(caught.exception).lower())

    def test_a_contact_of_another_company_is_refused(self):
        theirs = self.contact_of(self.beta)

        with self.assertRaises(Refused):
            self.as_manager(
                lambda: CustomerService.save_customer(
                    customer=self.acme, contact={"name": theirs, "first_name": "Mine now"}
                )
            )


class TestAContactIsNotADoorway(ProfileCase):
    def test_typing_an_email_links_no_account(self):
        """Whether somebody may sign in is the accounts workflow's business, not this one."""
        self.as_manager(
            lambda: CustomerService.save_customer(
                customer=self.acme,
                contact={"first_name": "Walk In", "email_id": self.technician},
            )
        )

        reading = self.as_manager(lambda: CustomerService.get_customer(self.acme))
        contact = frappe.get_doc("Contact", reading["contact"]["name"])

        self.assertIsNone(contact.user, "an email in a form is not an account")

    def test_it_grants_no_permission_either(self):
        before = frappe.db.count(
            "User Permission", {"user": self.technician, "allow": "Customer"}
        )

        self.as_manager(
            lambda: CustomerService.save_customer(
                customer=self.acme,
                contact={"first_name": "Walk In", "email_id": self.technician},
            )
        )

        self.assertEqual(
            frappe.db.count("User Permission", {"user": self.technician, "allow": "Customer"}),
            before,
        )


class TestAProfileSavesWholeOrNotAtAll(ProfileCase):
    def test_a_contact_that_will_not_save_leaves_the_address_as_it_was(self):
        self.as_manager(
            lambda: CustomerService.save_customer(
                customer=self.acme, address=self.address(city="Douala")
            )
        )

        with self.assertRaises(NexgenError):
            self.as_manager(
                lambda: CustomerService.save_customer(
                    customer=self.acme,
                    address=self.address(city="Limbe"),
                    contact={"first_name": "   "},
                )
            )

        reading = self.as_manager(lambda: CustomerService.get_customer(self.acme))

        self.assertEqual(
            reading["address"]["city"], "Douala", "half a profile is worse than none"
        )

    def test_a_refused_field_writes_nothing_at_all(self):
        was = frappe.db.get_value("Customer", self.acme, "website")

        with self.assertRaises(Refused):
            self.as_manager(
                lambda: CustomerService.save_customer(
                    customer=self.acme,
                    details={"website": "https://sneaky.example", "default_currency": "USD"},
                )
            )

        self.assertEqual(frappe.db.get_value("Customer", self.acme, "website"), was)


class TestPuttingACompanyOnFile(ProfileCase):
    def test_our_administrator_may(self):
        created = self.as_admin(
            lambda: CustomerService.create_customer(
                customer_name=f"ZZTEST Newco {self.tag}", address=self.address()
            )
        )
        self.track("Customer", created["name"])

        self.assertTrue(frappe.db.exists("Customer", created["name"]))
        self.assertEqual(created["address"]["city"], "Douala")

    def test_a_technician_may_not(self):
        with self.assertRaises(Refused):
            self.as_user(
                self.technician,
                lambda: CustomerService.create_customer(
                    customer_name=f"ZZTEST Sneak {self.tag}"
                ),
            )

    def test_a_customer_may_not(self):
        with self.assertRaises(Refused):
            self.as_manager(
                lambda: CustomerService.create_customer(customer_name=f"ZZTEST Theirs {self.tag}")
            )

    def test_a_name_erpnext_refuses_is_refused_here_too(self):
        with self.assertRaises(NexgenError):
            self.as_admin(lambda: CustomerService.create_customer(customer_name="   "))


class TestTheDirectory(ProfileCase):
    def test_a_manager_sees_only_their_own(self):
        listed = self.as_manager(lambda: CustomerService.list_customers())

        self.assertEqual([row.name for row in listed], [self.acme])

    def test_our_own_people_see_them_all(self):
        listed = self.as_user(self.technician, lambda: CustomerService.list_customers())
        names = [row.name for row in listed]

        self.assertIn(self.acme, names)
        self.assertIn(self.beta, names)

    def test_it_says_how_much_each_one_carries(self):
        self.make_person(self.acme, "Somebody")

        listed = self.as_manager(lambda: CustomerService.list_customers())

        self.assertEqual(listed[0].users, 1)


class TestTheReadingSaysWhatMayBeDone(ProfileCase):
    def test_a_manager_is_told_what_is_theirs(self):
        reading = self.as_manager(lambda: CustomerService.get_customer(self.acme))

        self.assertTrue(reading["can"]["edit_profile"])
        self.assertFalse(reading["can"]["edit_commercial"])
        self.assertFalse(reading["can"]["manage_pricing"])

    def test_our_administrator_is_told_everything_is(self):
        reading = self.as_admin(lambda: CustomerService.get_customer(self.acme))

        self.assertTrue(reading["can"]["edit_commercial"])
        self.assertTrue(reading["can"]["manage_contracts"])

    def test_a_technician_reads_it_but_changes_nothing(self):
        reading = self.as_user(
            self.technician, lambda: CustomerService.get_customer(self.acme)
        )

        self.assertFalse(reading["can"]["edit_commercial"])

        with self.assertRaises(Refused):
            self.as_user(
                self.technician,
                lambda: CustomerService.save_customer(
                    customer=self.acme, details={"website": "https://nope.example"}
                ),
            )
