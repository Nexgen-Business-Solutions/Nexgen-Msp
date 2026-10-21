"""An invoice is announced to one named person, or to nobody at all.

Issue #21. The notice used to go to every enabled account holding a permission on the
customer — an answer to "who may sign in", never to "who does the accounting" — and it
reached people it was never meant for. The company now names one contact; there is no
fallback, because guessing one is exactly what caused the incident.
"""

import frappe

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.api.internal.services.customer_service import CustomerService
from nexgen_msp.utils.errors import NotFoundError, ValidationError as ServiceRefused

from .base import MSPTestCase


class BillingContactCase(MSPTestCase):
    def setUp(self):
        super().setUp()
        self.tag = frappe.generate_hash(length=4)
        self.mine = self.make_customer(f"BC{self.tag}A")
        self.theirs = self.make_customer(f"BC{self.tag}B")

    def accountant(self, customer=None, email=None, name="Accounts Payable"):
        return CustomerService.add_billing_contact(
            customer=customer or self.mine,
            full_name=name,
            email=email or f"zztest.pay{self.tag}@example.invalid",
        )


class TestNamingTheContact(BillingContactCase):
    def test_nobody_is_named_to_begin_with(self):
        told = CustomerService.billing_contact(self.mine)

        self.assertIsNone(told["contact"])
        self.assertIsNone(told["email"])
        self.assertIn("has no billing contact", told["refusal"])

    def test_an_accountant_can_be_added_without_an_account(self):
        told = self.accountant()

        self.assertIsNotNone(told["contact"])
        self.assertEqual(told["email"], f"zztest.pay{self.tag}@example.invalid")
        self.assertIsNone(told["refusal"])
        self.track("Contact", told["contact"])
        self.assertIsNone(
            frappe.db.get_value("Contact", told["contact"], "user"),
            "the accountant needs no portal account",
        )

    def test_an_address_the_company_already_holds_names_that_contact(self):
        """Typing a known address picks the person up; it does not make a second record."""
        first = self.accountant(name="Accounts Payable")
        self.track("Contact", first["contact"])
        before = frappe.db.count("Contact")

        CustomerService.set_billing_contact(customer=self.mine, contact=None)
        again = self.accountant(name="Accounts Payable Again")

        self.assertEqual(again["contact"], first["contact"])
        self.assertEqual(frappe.db.count("Contact"), before)

    def test_the_same_address_at_another_company_is_a_contact_of_its_own(self):
        """Two companies can both deal with the same accountant, each on their own record."""
        mine = self.accountant()
        self.track("Contact", mine["contact"])
        theirs = self.accountant(customer=self.theirs)
        self.track("Contact", theirs["contact"])

        self.assertNotEqual(mine["contact"], theirs["contact"])

    def test_an_existing_contact_of_the_company_can_be_named(self):
        made = self.accountant()
        self.track("Contact", made["contact"])

        CustomerService.set_billing_contact(customer=self.mine, contact=None)
        self.assertIsNone(CustomerService.billing_contact(self.mine)["contact"])

        told = CustomerService.set_billing_contact(customer=self.mine, contact=made["contact"])
        self.assertEqual(told["contact"], made["contact"])

    def test_a_contact_of_another_company_is_refused(self):
        theirs = self.accountant(customer=self.theirs, email=f"zztest.other{self.tag}@example.invalid")
        self.track("Contact", theirs["contact"])

        with self.assertRaises(ServiceRefused) as refusal:
            CustomerService.set_billing_contact(customer=self.mine, contact=theirs["contact"])

        self.assertIn("is not a contact of", str(refusal.exception))

    def test_a_contact_that_does_not_exist_is_refused(self):
        with self.assertRaises(NotFoundError):
            CustomerService.set_billing_contact(customer=self.mine, contact="no-such-contact")

    def test_an_address_that_is_not_one_is_refused(self):
        with self.assertRaises(ServiceRefused):
            CustomerService.add_billing_contact(
                customer=self.mine, full_name="No Address", email="not-an-email"
            )

    def test_a_nameless_contact_is_refused(self):
        with self.assertRaises(ServiceRefused):
            CustomerService.add_billing_contact(
                customer=self.mine, full_name="  ", email="someone@example.invalid"
            )

    def test_the_company_contacts_are_offered_for_the_choice(self):
        made = self.accountant()
        self.track("Contact", made["contact"])

        offered = CustomerService.contacts_of(customer=self.mine)

        self.assertIn(made["contact"], [row["name"] for row in offered])
        row = next(r for r in offered if r["name"] == made["contact"])
        self.assertFalse(row["has_account"])
        self.assertEqual(row["email"], f"zztest.pay{self.tag}@example.invalid")

    def test_the_contacts_of_another_company_are_not_offered(self):
        theirs = self.accountant(customer=self.theirs, email=f"zztest.o{self.tag}@example.invalid")
        self.track("Contact", theirs["contact"])

        offered = CustomerService.contacts_of(customer=self.mine)

        self.assertNotIn(theirs["contact"], [row["name"] for row in offered])


class TestWhoTheInvoiceReaches(BillingContactCase):
    def test_the_named_contact_and_nobody_else(self):
        made = self.accountant()
        self.track("Contact", made["contact"])

        email, refusal = BillingService.billing_contact_email(self.mine)

        self.assertEqual(email, f"zztest.pay{self.tag}@example.invalid")
        self.assertIsNone(refusal)

    def test_an_account_holding_a_permission_is_not_a_reason_to_write_to_them(self):
        """The old rule, stated as what must no longer happen."""
        self.make_account("customer", "MSP Customer Manager", customer=self.mine,
                          suffix=f"bc{self.tag}")

        email, refusal = BillingService.billing_contact_email(self.mine)

        self.assertIsNone(email)
        self.assertIn("has no billing contact", refusal)

    def test_with_nobody_named_nothing_is_sent_and_no_fallback_is_taken(self):
        email, refusal = BillingService.billing_contact_email(self.mine)

        self.assertIsNone(email)
        self.assertIsNotNone(refusal)

    def test_a_contact_with_no_address_sends_nothing(self):
        doc = frappe.get_doc({
            "doctype": "Contact", "first_name": f"ZZTEST silent {self.tag}",
            "links": [{"link_doctype": "Customer", "link_name": self.mine}],
        }).insert(ignore_permissions=True)
        self.track("Contact", doc.name)
        frappe.db.set_value("Customer", self.mine, "msp_billing_contact", doc.name)
        frappe.db.commit()

        email, refusal = BillingService.billing_contact_email(self.mine)

        self.assertIsNone(email)
        self.assertIn("no email address", refusal)

    def test_a_contact_unlinked_from_the_company_afterwards_sends_nothing(self):
        """The link is checked when the invoice goes out, not only when it was chosen."""
        made = self.accountant()
        self.track("Contact", made["contact"])
        frappe.db.sql(
            "delete from `tabDynamic Link` where parenttype='Contact' and parent=%s",
            made["contact"],
        )
        frappe.db.commit()

        email, refusal = BillingService.billing_contact_email(self.mine)

        self.assertIsNone(email)
        self.assertIn("is not a contact of", refusal)

    def test_each_company_is_told_through_its_own_contact(self):
        mine = self.accountant()
        theirs = self.accountant(customer=self.theirs, email=f"zztest.t{self.tag}@example.invalid")
        self.track("Contact", mine["contact"])
        self.track("Contact", theirs["contact"])

        self.assertNotEqual(
            BillingService.billing_contact_email(self.mine)[0],
            BillingService.billing_contact_email(self.theirs)[0],
        )


class TestChoosingWhoIsTold(BillingContactCase):
    """The notice is addressed to the named contact and copied to whoever was chosen.

    Choosing is not trusting: the screen offers this company's own addresses, and the
    submit checks what it is handed against that same list. An address nobody named is
    refused outright — writing to one is the incident this whole path exists to prevent.
    """

    def setUp(self):
        super().setUp()
        self.named = self.accountant()
        self.track("Contact", self.named["contact"])
        self.pay = self.named["email"]

    def test_the_company_accounts_are_offered_as_copies(self):
        account = self.make_account(
            "customer", "MSP Customer Manager", customer=self.mine, suffix=f"cc{self.tag}"
        )

        offered = BillingService.recipients_of(self.mine)

        self.assertEqual(offered["billing_contact"]["email"], self.pay)
        self.assertIn(account, [row["email"] for row in offered["portal_users"]])

    def test_another_company_account_is_not_offered(self):
        stranger = self.make_account(
            "customer", "MSP Customer Manager", customer=self.theirs, suffix=f"out{self.tag}"
        )

        offered = BillingService.recipients_of(self.mine)

        self.assertNotIn(stranger, [row["email"] for row in offered["portal_users"]])

    def test_the_contact_is_not_offered_as_a_copy_of_itself(self):
        account = self.make_account(
            "customer", "MSP Customer Manager", customer=self.mine, suffix=f"self{self.tag}"
        )
        contact = frappe.db.get_value("Contact", {"user": account}, "name")
        CustomerService.set_billing_contact(customer=self.mine, contact=contact)

        offered = BillingService.recipients_of(self.mine)

        self.assertEqual(offered["billing_contact"]["email"], account)
        self.assertNotIn(account, [row["email"] for row in offered["portal_users"]])

    def test_the_contact_alone_is_the_recipient(self):
        to, copies = BillingService._chosen_recipients(self.mine, [self.pay])

        self.assertEqual(to, [self.pay])
        self.assertEqual(copies, [])

    def test_copies_are_held_back_until_the_requirement_allows_them(self):
        """#21 asks for one recipient: a chosen copy waits behind the setting."""
        account = self.make_account(
            "customer", "MSP Customer Manager", customer=self.mine, suffix=f"cc2{self.tag}"
        )

        to, copies = BillingService._chosen_recipients(self.mine, [self.pay, account])

        self.assertEqual(to, [self.pay])
        self.assertEqual(copies, [])

    def test_the_others_chosen_are_copied_once_it_is_allowed(self):
        account = self.make_account(
            "customer", "MSP Customer Manager", customer=self.mine, suffix=f"cc2b{self.tag}"
        )
        frappe.db.set_single_value("MSP Invoice Settings", "billing_manual_cc_enabled", 1)
        frappe.db.commit()
        self.addCleanup(
            lambda: frappe.db.set_single_value(
                "MSP Invoice Settings", "billing_manual_cc_enabled", 0
            )
        )

        to, copies = BillingService._chosen_recipients(self.mine, [self.pay, account])

        self.assertEqual(to, [self.pay])
        self.assertEqual(copies, [account])

    def test_with_the_contact_unticked_the_rest_are_written_to_directly(self):
        """A copy with nobody to copy is simply the recipient."""
        account = self.make_account(
            "customer", "MSP Customer Manager", customer=self.mine, suffix=f"cc3{self.tag}"
        )

        to, copies = BillingService._chosen_recipients(self.mine, [account])

        self.assertEqual(to, [account])
        self.assertEqual(copies, [])

    def test_nobody_chosen_writes_to_nobody(self):
        self.assertEqual(BillingService._chosen_recipients(self.mine, []), ([], []))

    def test_an_account_of_another_company_is_refused(self):
        stranger = self.make_account(
            "customer", "MSP Customer Manager", customer=self.theirs, suffix=f"bad{self.tag}"
        )

        with self.assertRaisesRegex(ServiceRefused, "is not an address of"):
            BillingService._chosen_recipients(self.mine, [self.pay, stranger])

    def test_an_address_nobody_named_is_refused(self):
        with self.assertRaisesRegex(ServiceRefused, "is not an address of"):
            BillingService._chosen_recipients(self.mine, ["someone@elsewhere.invalid"])

    def test_a_disabled_account_is_not_offered_and_not_accepted(self):
        account = self.make_account(
            "customer", "MSP Customer Manager", customer=self.mine, suffix=f"off{self.tag}"
        )
        frappe.db.set_value("User", account, "enabled", 0)
        frappe.db.commit()

        offered = BillingService.recipients_of(self.mine)

        self.assertNotIn(account, [row["email"] for row in offered["portal_users"]])
        with self.assertRaisesRegex(ServiceRefused, "is not an address of"):
            BillingService._chosen_recipients(self.mine, [account])


class TestTheRestOfTheMailIsUntouched(MSPTestCase):
    def test_the_invoice_notice_is_sent_again_and_only_through_the_contact(self):
        import inspect

        source = inspect.getsource(BillingService.submit_invoice)
        live = "\n".join(
            line for line in source.splitlines() if not line.strip().startswith("#")
        )

        self.assertIn("_notify_customer", live, "the notice is sent again")
        self.assertIn("cint(notify)", live, "and still only when asked for")

    def test_nothing_resolves_invoice_recipients_from_user_permissions_any_more(self):
        import inspect

        source = inspect.getsource(BillingService._notify_customer)

        self.assertNotIn("User Permission", source)
        self.assertIn("billing_contact_email", source)

    def test_the_dispute_mail_towards_our_team_is_untouched(self):
        import inspect

        from nexgen_msp.api.portal.services.portal_service import PortalService

        source = inspect.getsource(PortalService.dispute_invoice)

        self.assertIn("MSP System Admin", source)
