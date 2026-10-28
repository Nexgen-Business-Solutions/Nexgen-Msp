"""Sending an invoice that already exists, by hand.

Issue #23. A posted invoice sometimes has to reach somebody again: the accounting contact
changed, the first mail was lost, a customer asks for last quarter's document. That is an
email and nothing else — the invoice, its amounts, its dates and the ledger behind it are
read, never touched, and no billing run is started to produce a document that already
exists.

Nothing is invented here. Who can be written to is the choice the billing run already
offers, `BillingService.recipients_of`: the company's designated billing contact, and its
own accounts to copy. What is written is the `MSP Invoice Issued` template this application
already sends, with the invoice printed as this application already prints it. The only
thing this module adds is that an invoice no longer needs a run to be sent, and that
whoever sends it may choose who is copied — which is what #23 asks for and #21 does not.

Who may do it is the commercial authority of this application, the same one that draws the
invoices: an administrator or an MSP System Admin who is not a customer account. A
technician is staff and still may not send invoices. The screen hides the action, and every
call checks again, because a hidden button is not a permission.
"""

import frappe
from frappe.utils import now_datetime

from nexgen_msp.api.internal.services.billing_service import BillingService
from nexgen_msp.utils import access, invoice_pdf, notifications
from nexgen_msp.utils.errors import NotFoundError, ValidationError

AUDIT_TAG = "invoice-email"

QUEUE_STATES = {
    "Not Sent": "Queued",
    "Sending": "Queued",
    "Partially Sent": "Sent",
    "Sent": "Sent",
    "Error": "Failed",
    "Expired": "Failed",
}


class InvoiceEmailService:
    @staticmethod
    def _guard():
        """The authority that draws invoices is the one that may send them again."""
        access.require("manage_contracts")

    @staticmethod
    def _invoice(name):
        """The posted invoice this caller is allowed to read, or nothing at all.

        An invoice of a customer this account may not reach answers exactly as one that
        does not exist: the existence of another company's document is not information
        this endpoint gives away.
        """
        InvoiceEmailService._guard()

        if not name:
            raise ValidationError("name is required.", "VALIDATION_ERROR")

        doc = frappe.db.get_value(
            "Sales Invoice",
            name,
            [
                "name",
                "customer",
                "customer_name",
                "docstatus",
                "status",
                "posting_date",
                "currency",
                "grand_total",
                "is_return",
            ],
            as_dict=True,
        )

        if not doc or not access.may_reach(doc.customer):
            raise NotFoundError(f"Sales Invoice {name} not found.", "NOT_FOUND")

        if doc.docstatus != 1:
            raise ValidationError(
                f"{name} is {'cancelled' if doc.docstatus == 2 else 'a draft'}. Only a "
                "posted invoice can be sent.",
                "INVALID_TRANSITION",
            )

        return doc

    @staticmethod
    def _print_format():
        """The format this application already prints its invoices with.

        Nothing new is invented here: the mail carries the same document the portal and
        the billing run hand over, and if that format has gone the site's own default for
        a Sales Invoice is used instead.
        """
        if frappe.db.exists("Print Format", {"name": invoice_pdf.PRINT_FORMAT, "disabled": 0}):
            return invoice_pdf.PRINT_FORMAT

        return (
            frappe.db.get_value(
                "Property Setter",
                {"doc_type": "Sales Invoice", "property": "default_print_format"},
                "value",
            )
            or None
        )

    @staticmethod
    def recipients(name=None):
        """This invoice, who it can be sent to, and what was sent before.

        The choice is the billing run's own: the named contact, addressed to, and the
        company's accounts to copy. The screen shows this list and nothing else, and the
        send checks the addresses it is handed against the same list.
        """
        doc = InvoiceEmailService._invoice(name)
        offered = BillingService.recipients_of(doc.customer)

        return {
            "invoice": doc.name,
            "customer": doc.customer,
            "customer_name": doc.customer_name,
            "posting_date": doc.posting_date,
            "period": frappe.utils.formatdate(doc.posting_date, "MMMM yyyy"),
            "currency": doc.currency,
            "grand_total": doc.grand_total,
            "is_return": bool(doc.is_return),
            "status": doc.status,
            "billing_contact": offered["billing_contact"],
            "portal_users": offered["portal_users"],
            "pdf": {
                "filename": f"Invoice-{doc.name}.pdf",
                "print_format": InvoiceEmailService._print_format(),
            },
            "attempts": InvoiceEmailService.history(doc.name)["attempts"],
        }

    @staticmethod
    def _summary(invoice):
        """What this very document says, line by line, for the body of the mail."""
        doc = frappe.get_doc("Sales Invoice", invoice)
        # the currency decides how many decimals the figure has: a 23.48 that reads 23 in the
        # mail is not the amount the document says
        money = lambda amount: frappe.utils.fmt_money(amount, currency=doc.currency)
        rows = [(item.item_name or item.item_code, money(item.amount)) for item in doc.items]
        total = doc.grand_total if doc.grand_total is not None else doc.net_total
        rows.append(("Total", money(total)))

        return notifications.summary_table(rows)

    @staticmethod
    def _once(chosen):
        """The addresses as chosen, each of them once: nobody is sent two copies."""
        wanted = []
        seen = set()

        for entry in chosen or []:
            address = str(entry or "").strip()

            if not address or address.lower() in seen:
                continue

            seen.add(address.lower())
            wanted.append(address)

        return wanted

    @staticmethod
    def send(name=None, recipients=None, request_id=None):
        """Queue this invoice to the addresses chosen, with its own PDF attached.

        What comes back says the mail was queued, because that is all that is known at
        this point: the email infrastructure says later whether it went out. Nothing of
        the invoice, the ledger or the customer's saved contact is written.
        """
        doc = InvoiceEmailService._invoice(name)
        chosen = frappe.parse_json(recipients) if isinstance(recipients, str) else recipients

        if isinstance(chosen, str):
            chosen = [chosen]

        # the same allowlist the billing run's notice goes through: an address the screen
        # never offered is refused, and the contact is written to while the rest are copied
        wanted, copies = BillingService._chosen_recipients(
            doc.customer, InvoiceEmailService._once(chosen), allow_cc=True
        )

        if not wanted:
            raise ValidationError(
                f"Choose who {doc.name} goes to. Nobody is written to by default.",
                "VALIDATION_ERROR",
            )

        # two clicks on one decision are one decision: the attempt is held under the
        # invoice's own row, so a double click or a retried request finds the first one
        # rather than queueing a second mail. A later resend carries another id and goes.
        frappe.db.sql(
            "select name from `tabSales Invoice` where name = %(invoice)s for update",
            {"invoice": doc.name},
        )
        already = InvoiceEmailService._attempt_of(doc.name, request_id)

        if already:
            return already

        # the document itself, printed as this application prints it. A mail with the
        # wrong invoice attached is worse than no mail, so nothing is queued until the
        # bytes exist.
        pdf = invoice_pdf.render(doc.name, elevated=True)

        queued = notifications.send(
            "MSP Invoice Issued",
            wanted,
            {
                "full_name": "there",
                "customer": doc.customer_name or doc.customer,
                "invoice": doc.name,
                "period": frappe.utils.formatdate(doc.posting_date, "MMMM yyyy"),
                "summary": InvoiceEmailService._summary(doc.name),
                "link": notifications.portal_url("/records"),
            },
            reference_doctype="Sales Invoice",
            reference_name=doc.name,
            cc=copies,
            attachments=[{"fname": f"Invoice-{doc.name}.pdf", "fcontent": pdf}],
        )

        if not queued:
            raise ValidationError(
                f"{doc.name} could not be queued for sending. Nothing was sent.",
                "VALIDATION_ERROR",
            )

        attempt = {
            "invoice": doc.name,
            "attempt": getattr(queued, "name", None),
            "request_id": request_id or None,
            "state": "Queued",
            "to": wanted,
            "cc": copies,
            "by": frappe.session.user,
            "on": now_datetime(),
        }
        InvoiceEmailService._record(doc.name, attempt)
        frappe.db.commit()

        return attempt

    @staticmethod
    def _record(invoice, attempt):
        """The attempt written against the invoice, so the mail can be traced to a person."""
        copies = f", copied to {', '.join(attempt['cc'])}" if attempt["cc"] else ""
        frappe.get_doc(
            {
                "doctype": "Comment",
                "comment_type": "Comment",
                "reference_doctype": "Sales Invoice",
                "reference_name": invoice,
                "content": (
                    f"[{AUDIT_TAG}] queued to {', '.join(attempt['to'])}{copies}"
                    f" by {attempt['by']}"
                    f" · attempt {attempt['attempt'] or 'unknown'}"
                    f" · request {attempt['request_id'] or '—'}"
                ),
            }
        ).insert(ignore_permissions=True)

    @staticmethod
    def _attempt_of(invoice, request_id):
        """The attempt this very request already made, when it is being replayed."""
        if not request_id:
            return None

        # the request is the last thing the line says, so the match is the whole of it: a
        # shorter identifier is not a replay of a longer one that happens to start with it
        tail = f"· request {request_id}"
        said = frappe.db.get_value(
            "Comment",
            {
                "reference_doctype": "Sales Invoice",
                "reference_name": invoice,
                "content": ["like", f"%[{AUDIT_TAG}]%{tail}"],
            },
            ["name", "content", "creation", "owner"],
            as_dict=True,
        )

        if not said or not said.content.endswith(tail):
            return None

        for attempt in InvoiceEmailService.history(invoice)["attempts"]:
            if attempt["request_id"] == request_id:
                return attempt

        return {
            "invoice": invoice,
            "attempt": None,
            "request_id": request_id,
            "state": "Queued",
            "to": [],
            "cc": [],
            "by": said.owner,
            "on": said.creation,
            "repeated": True,
        }

    @staticmethod
    def history(name=None):
        """Every time this invoice was mailed from here, and what became of it.

        Queued, sent and failed are read off the email queue itself. Nothing here claims
        the mail was delivered: that is the recipient's server's answer, not ours.
        """
        doc = InvoiceEmailService._invoice(name)
        requests = {}

        for said in frappe.get_all(
            "Comment",
            filters={
                "reference_doctype": "Sales Invoice",
                "reference_name": doc.name,
                "content": ["like", f"%[{AUDIT_TAG}]%"],
            },
            fields=["content", "creation", "owner"],
        ):
            mark = said.content.split("attempt ")[-1].split(" ")[0]
            requests[mark] = said

        attempts = []

        for row in frappe.get_all(
            "Email Queue",
            filters={"reference_doctype": "Sales Invoice", "reference_name": doc.name},
            fields=["name", "status", "error", "creation", "owner"],
            order_by="creation desc",
        ):
            said = requests.get(row.name)
            attempts.append(
                {
                    "invoice": doc.name,
                    "attempt": row.name,
                    "request_id": (
                        said.content.split("request ")[-1].strip() if said else None
                    ),
                    "state": QUEUE_STATES.get(row.status, row.status),
                    "to": frappe.get_all(
                        "Email Queue Recipient",
                        filters={"parent": row.name},
                        pluck="recipient",
                        order_by="idx asc",
                    ),
                    "cc": [],
                    "by": (said.owner if said else row.owner),
                    "on": row.creation,
                    "error": row.error or None,
                }
            )

        return {"invoice": doc.name, "attempts": attempts}
