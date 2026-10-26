"""Sending an invoice that already exists, by hand.

Issue #23. The document is read and mailed; it is never drawn again. What is tested here is
who may do it, that the addresses offered are the billing run's own choice and no address
may be invented, what is attached, and that the invoice and the ledger behind it come out
of the operation exactly as they went in.
"""

import frappe

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.api.internal.services.customer_service import CustomerService
from nexgen_msp.api.internal.services.invoice_email_service import InvoiceEmailService
from nexgen_msp.utils import notifications
from nexgen_msp.utils.errors import NotFoundError, ValidationError as ServiceRefused

from .test_sales_invoices import InvoiceCase


class InvoiceMailCase(InvoiceCase):
    def posted_invoice(self, **drawn):
        """An invoice the desk really holds: only a posted one can be sent."""
        name = self.an_invoice(**drawn)
        doc = frappe.get_doc("Sales Invoice", name)
        doc.flags.ignore_permissions = True
        doc.submit()
        frappe.db.commit()

        return name

    def accountant(self, email=None):
        """The one address naming a billing contact means."""
        made = CustomerService.add_billing_contact(
            customer=self.customer,
            full_name="Accounts Payable",
            email=email or f"zztest.pay{self.tag}@example.invalid",
        )
        self.track("Contact", made["contact"])

        return made["email"]

    def an_account(self, mark="cc"):
        """One of the company's own portal accounts, which is what may be copied."""
        return self.make_account(
            "customer",
            "MSP Customer Manager",
            customer=self.customer,
            suffix=f"{mark}{self.tag[:3]}",
        )

    def queued_for(self, invoice):
        return frappe.get_all(
            "Email Queue",
            filters={"reference_doctype": "Sales Invoice", "reference_name": invoice},
            fields=["name", "status", "message"],
        )

    def recipients_of(self, queue):
        return frappe.get_all(
            "Email Queue Recipient", filters={"parent": queue}, pluck="recipient"
        )


class TestWhatTheScreenIsOffered(InvoiceMailCase):
    def test_a_posted_invoice_with_no_run_offers_the_contact_and_the_company_accounts(self):
        name = self.posted_invoice()
        address = self.accountant()
        account = self.an_account()

        offered = InvoiceEmailService.recipients(name)

        self.assertEqual(offered["invoice"], name)
        self.assertEqual(offered["billing_contact"]["email"], address)
        self.assertIn(account, [row["email"] for row in offered["portal_users"]])
        self.assertEqual(offered["pdf"]["filename"], f"Invoice-{name}.pdf")
        self.assertEqual(offered["attempts"], [])

    def test_nothing_is_typed_here_so_nothing_is_proposed_but_the_company_s_own(self):
        name = self.posted_invoice()
        self.accountant()
        stranger = self.make_account("internal", "MSP Technician", suffix=f"st{self.tag[:3]}")

        offered = InvoiceEmailService.recipients(name)

        self.assertNotIn(stranger, [row["email"] for row in offered["portal_users"]])

    def test_a_customer_with_no_contact_says_so_rather_than_guessing(self):
        name = self.posted_invoice()

        offered = InvoiceEmailService.recipients(name)

        self.assertIsNone(offered["billing_contact"]["email"])
        self.assertIn("billing contact", offered["billing_contact"]["refusal"])

    def test_a_draft_invoice_is_refused(self):
        company = frappe.defaults.get_global_default("company")
        doc = frappe.get_doc(
            {
                "doctype": "Sales Invoice",
                "company": company,
                "customer": self.customer,
                "posting_date": "2026-08-31",
                "set_posting_time": 1,
                "due_date": "2026-09-30",
                "items": [
                    {
                        "item_code": self.offering("MAILDRAFT"),
                        "qty": 1,
                        "rate": 10.0,
                        "income_account": frappe.db.get_value(
                            "Company", company, "default_income_account"
                        ),
                    }
                ],
            }
        )
        doc.flags.ignore_permissions = True
        doc.insert(ignore_permissions=True)
        self.track("Sales Invoice", doc.name)

        with self.assertRaisesRegex(ServiceRefused, "a draft"):
            InvoiceEmailService.recipients(doc.name)

    def test_a_cancelled_invoice_is_refused(self):
        name = self.posted_invoice()
        doc = frappe.get_doc("Sales Invoice", name)
        doc.flags.ignore_permissions = True
        doc.cancel()
        frappe.db.commit()

        with self.assertRaisesRegex(ServiceRefused, "cancelled"):
            InvoiceEmailService.recipients(name)

    def test_an_invoice_that_does_not_exist_says_only_that(self):
        with self.assertRaises(NotFoundError):
            InvoiceEmailService.recipients("ACC-SINV-NOPE-0001")


class TestWhoMaySend(InvoiceMailCase):
    def test_a_customer_operator_is_refused_by_the_service_itself(self):
        name = self.posted_invoice()
        account = self.make_account(
            "customer", "MSP Customer Operator", customer=self.customer, suffix=f"mo{self.tag[:3]}"
        )
        session = frappe.session.user
        frappe.set_user(account)

        try:
            with self.assertRaises(Exception) as refusal:
                InvoiceEmailService.recipients(name)

            self.assertIn("administrator", str(refusal.exception).lower())
        finally:
            frappe.set_user(session)

    def test_a_technician_is_staff_and_still_may_not_send_invoices(self):
        name = self.posted_invoice()
        account = self.make_account("internal", "MSP Technician", suffix=f"tc{self.tag[:3]}")
        session = frappe.session.user
        frappe.set_user(account)

        try:
            with self.assertRaises(Exception):
                InvoiceEmailService.recipients(name)
        finally:
            frappe.set_user(session)

    def test_sending_is_refused_for_the_same_accounts_not_merely_hidden(self):
        name = self.posted_invoice()
        address = self.accountant()
        account = self.make_account(
            "customer", "MSP Customer Manager", customer=self.customer, suffix=f"mm{self.tag[:3]}"
        )
        session = frappe.session.user
        frappe.set_user(account)

        try:
            with self.assertRaises(Exception):
                InvoiceEmailService.send(name=name, recipients=[address], request_id="x1")
        finally:
            frappe.set_user(session)

        self.assertEqual(self.queued_for(name), [], "nothing was queued on the way to the refusal")


class TestWhatIsSent(InvoiceMailCase):
    def test_the_invoice_goes_out_with_its_own_pdf_attached(self):
        name = self.posted_invoice(total=4200.0)
        address = self.accountant()

        attempt = InvoiceEmailService.send(
            name=name, recipients=[address], request_id="first"
        )

        self.assertEqual(attempt["state"], "Queued", "queued is not delivered")
        self.assertEqual(attempt["to"], [address])
        queued = self.queued_for(name)
        self.assertEqual(len(queued), 1, queued)
        self.assertEqual(self.recipients_of(queued[0]["name"]), [address])
        self.assertIn(f"Invoice-{name}.pdf", queued[0]["message"])

    def test_the_mail_is_the_template_this_application_already_sends(self):
        name = self.posted_invoice()
        address = self.accountant()

        InvoiceEmailService.send(name=name, recipients=[address], request_id="template")

        queued = self.queued_for(name)[0]
        self.assertIn(f"Invoice {name}", queued["message"], "the subject of MSP Invoice Issued")
        self.assertIn("Your invoice is ready", queued["message"])

    def test_the_contact_is_written_to_and_the_accounts_chosen_are_copied(self):
        name = self.posted_invoice()
        address = self.accountant()
        account = self.an_account()

        attempt = InvoiceEmailService.send(
            name=name, recipients=[address, account], request_id="copies"
        )

        self.assertEqual(attempt["to"], [address])
        self.assertEqual(attempt["cc"], [account], "#23 asks for the copies #21 withholds")
        self.assertIn(account, self.recipients_of(self.queued_for(name)[0]["name"]))

    def test_several_accounts_are_copied_at_once(self):
        name = self.posted_invoice()
        address = self.accountant()
        one = self.an_account("c1")
        two = self.an_account("c2")

        attempt = InvoiceEmailService.send(
            name=name, recipients=[address, one, two], request_id="many"
        )

        self.assertEqual(attempt["to"], [address])
        self.assertEqual(sorted(attempt["cc"]), sorted([one, two]))
        self.assertEqual(
            sorted(self.recipients_of(self.queued_for(name)[0]["name"])),
            sorted([address, one, two]),
        )

    def test_an_address_the_screen_never_offered_is_refused(self):
        name = self.posted_invoice()
        self.accountant()

        with self.assertRaisesRegex(ServiceRefused, "not an address of"):
            InvoiceEmailService.send(
                name=name,
                recipients=["somebody.else@example.invalid"],
                request_id="stranger",
            )

        self.assertEqual(self.queued_for(name), [])

    def test_a_copy_is_sent_once_and_never_twice(self):
        name = self.posted_invoice()
        address = self.accountant()

        attempt = InvoiceEmailService.send(
            name=name, recipients=[address, address, address], request_id="dedupe"
        )

        self.assertEqual(attempt["to"], [address])
        self.assertEqual(attempt["cc"], [])
        self.assertEqual(self.recipients_of(self.queued_for(name)[0]["name"]), [address])

    def test_nothing_goes_out_without_somebody_to_write_to(self):
        name = self.posted_invoice()
        self.accountant()

        with self.assertRaisesRegex(ServiceRefused, "Choose who"):
            InvoiceEmailService.send(name=name, recipients=[], request_id="empty")

        self.assertEqual(self.queued_for(name), [])

    def test_the_same_attempt_replayed_queues_one_mail(self):
        name = self.posted_invoice()
        address = self.accountant()
        asked = {"name": name, "recipients": [address], "request_id": "double-click"}

        first = InvoiceEmailService.send(**asked)
        again = InvoiceEmailService.send(**asked)

        self.assertEqual(len(self.queued_for(name)), 1, "a replayed request is one send")
        self.assertEqual(again["attempt"], first["attempt"])

    def test_a_deliberate_resend_is_allowed_and_traceable(self):
        name = self.posted_invoice()
        address = self.accountant()

        InvoiceEmailService.send(name=name, recipients=[address], request_id="one")
        InvoiceEmailService.send(name=name, recipients=[address], request_id="two")

        self.assertEqual(len(self.queued_for(name)), 2)
        attempts = InvoiceEmailService.history(name)["attempts"]
        self.assertEqual(len(attempts), 2)
        self.assertTrue(all(row["state"] == "Queued" for row in attempts), attempts)
        self.assertTrue(all(row["by"] for row in attempts))


class TestWhenTheQueueItselfFails(InvoiceMailCase):
    def setUp(self):
        super().setUp()
        self.real_send = notifications.send
        notifications.send = lambda *args, **kwargs: False

    def tearDown(self):
        notifications.send = self.real_send
        super().tearDown()

    def test_a_mail_that_could_not_be_queued_is_said_so_and_left_untraced(self):
        name = self.posted_invoice()
        address = self.accountant()

        with self.assertRaisesRegex(ServiceRefused, "could not be queued"):
            InvoiceEmailService.send(name=name, recipients=[address], request_id="broken")

        self.assertEqual(self.queued_for(name), [])
        self.assertEqual(
            InvoiceEmailService.history(name)["attempts"],
            [],
            "a send that never left is not written down as one that did",
        )

    def test_the_same_invoice_can_be_sent_again_once_the_queue_works(self):
        name = self.posted_invoice()
        address = self.accountant()

        with self.assertRaises(ServiceRefused):
            InvoiceEmailService.send(name=name, recipients=[address], request_id="broken")

        notifications.send = self.real_send
        attempt = InvoiceEmailService.send(
            name=name, recipients=[address], request_id="retried"
        )

        self.assertEqual(attempt["state"], "Queued")
        self.assertEqual(len(self.queued_for(name)), 1, "the retry is the only mail queued")


class TestWhatIsNotTouched(InvoiceMailCase):
    def test_the_invoice_the_ledger_and_the_contact_come_out_as_they_went_in(self):
        name = self.posted_invoice(total=777.0)
        self.accountant()
        account = self.an_account()
        before = frappe.db.get_value(
            "Sales Invoice",
            name,
            ["modified", "grand_total", "outstanding_amount", "status", "posting_date"],
            as_dict=True,
        )
        entries = frappe.db.count("GL Entry", {"voucher_no": name})
        contact = frappe.db.get_value("Customer", self.customer, "msp_billing_contact")

        InvoiceEmailService.send(name=name, recipients=[account], request_id="untouched")

        after = frappe.db.get_value(
            "Sales Invoice",
            name,
            ["modified", "grand_total", "outstanding_amount", "status", "posting_date"],
            as_dict=True,
        )

        self.assertEqual(before, after, "the document itself is not written to")
        self.assertEqual(frappe.db.count("GL Entry", {"voucher_no": name}), entries)
        self.assertEqual(
            frappe.db.get_value("Customer", self.customer, "msp_billing_contact"),
            contact,
            "writing to one address this once is not a change of contact",
        )
        self.assertEqual(
            frappe.db.count("MSP Billing Run", {"customer": self.customer}),
            0,
            "no run is drawn by sending a document that already exists",
        )

    def test_the_notice_that_follows_a_run_still_keeps_its_copies_to_itself(self):
        """#21 is not reopened by #23: only the per-invoice send chooses who is copied."""
        address = self.accountant()
        account = self.an_account()

        to, copies = BillingService._chosen_recipients(self.customer, [address, account])

        self.assertEqual(to, [address])
        self.assertEqual(copies, [], "the automatic notice writes to the contact alone")
