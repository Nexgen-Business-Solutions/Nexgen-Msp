"""The conversation a request carries, read and written by both sides of it.

One thread per request, shared: what the customer wrote before handing the request over is
the same thread our team answers in afterwards, not a copy of it. Who may read or write is
never decided here from a status or from knowing an identifier — it is asked of the same
services that decide whether that person may open the request at all, so a conversation
cannot become a second door into a request its reader was never allowed to see.
"""

import frappe

from nexgen_msp.utils import notifications
from nexgen_msp.utils.errors import NotFoundError, ValidationError

COMMENT = "MSP Request Comment"
REQUEST = "MSP Request"
DRAFT = "Draft"
CUSTOMER_APPROVAL = "Awaiting Customer Approval"
COMPLETED = "Completed"
MAX_BODY = 4000

MSP = "MSP"
CUSTOMER = "Customer"

FOR_CUSTOMER = "MSP Request Comment For Customer"
FOR_OUR_TEAM = "MSP Request Comment For Our Team"
BEFORE_HANDOVER = "MSP Request Comment Before Handover"


class RequestCommentService:
    # ------------------------------------------------------------------ access
    @staticmethod
    def _missing(name):
        """What a reader who may not see this request is told: the same as for one that never existed."""
        return NotFoundError(f"Request {name} does not exist.", "NOT_FOUND")

    @staticmethod
    def _reader(name):
        """The request, and which side of it the reader is on.

        Staff membership is read first and on its own: an account that also holds a customer
        role keeps the access its staff roles give it, rather than being narrowed to one
        company because of a second hat.
        """
        from nexgen_msp.api.internal.services.request_service import RequestService
        from nexgen_msp.api.portal.services.portal_service import PortalService
        from nexgen_msp.utils import access

        if not name:
            raise ValidationError("request is required.", "VALIDATION_ERROR")

        doc = frappe.db.get_value(
            REQUEST, name, ["name", "status", "customer", "requester", "source"], as_dict=True
        )

        if not doc:
            raise RequestCommentService._missing(name)

        if access.is_staff():
            RequestService._guard_internal()

            # a request still waiting for its own company's decision is not ours to read,
            # and neither is the conversation on it
            if doc.status in (DRAFT, CUSTOMER_APPROVAL):
                raise RequestCommentService._missing(name)

            return doc, MSP

        try:
            PortalService._resolve_customer(doc.customer)
        except ValidationError:
            # a refusal that names the company would say that this request exists and whose
            # it is. Here it reads exactly like a request that was never written
            raise RequestCommentService._missing(name)

        # a draft is nobody's conversation yet: it has not been asked for
        if doc.status == DRAFT:
            raise RequestCommentService._missing(name)

        return doc, CUSTOMER

    # ------------------------------------------------------------------ reading
    @staticmethod
    def thread(request=None):
        """Every message on this request, oldest first, with who may add to it."""
        doc, side = RequestCommentService._reader(request)

        return {
            "request": doc.name,
            "side": side,
            # the work is done and the exchange about it with it; what was said stays
            # readable, which is the whole point of writing it down
            "may_post": doc.status != COMPLETED,
            "awaiting_customer_approval": doc.status == CUSTOMER_APPROVAL,
            "comments": [
                RequestCommentService._card(row)
                for row in frappe.get_all(
                    COMMENT,
                    filters={"request": doc.name},
                    fields=["name", "author_user", "author_name", "author_side", "body", "creation"],
                    order_by="creation asc, name asc",
                    limit_page_length=0,
                )
            ],
        }

    @staticmethod
    def _card(row):
        return {
            "name": row["name"],
            "author": row["author_user"],
            "author_name": row["author_name"] or row["author_user"],
            "side": row["author_side"],
            "body": row["body"],
            "created_at": str(row["creation"]),
        }

    # ------------------------------------------------------------------ writing
    @staticmethod
    def post(request=None, body=None, idempotency_key=None):
        """Add one message to this request's conversation, once.

        The key the browser sends is what makes a retry a retry: a post that reached us and
        whose answer did not reach the browser comes back as the message it already wrote,
        rather than saying it again to everybody.
        """
        doc, side = RequestCommentService._reader(request)

        if doc.status == COMPLETED:
            raise ValidationError(
                "This request is completed; its conversation is closed to new comments.",
                "VALIDATION_ERROR",
            )

        text = (body or "").strip()

        if not text:
            raise ValidationError("A comment cannot be empty.", "VALIDATION_ERROR")

        if len(text) > MAX_BODY:
            raise ValidationError(
                f"A comment is at most {MAX_BODY} characters.", "VALIDATION_ERROR"
            )

        key = (idempotency_key or "").strip()

        if not key:
            raise ValidationError("idempotency_key is required.", "VALIDATION_ERROR")

        author = frappe.session.user
        already = frappe.db.get_value(
            COMMENT, {"request": doc.name, "author_user": author, "idempotency_key": key}, "name"
        )

        if already:
            return RequestCommentService._written(already)

        comment = frappe.get_doc(
            {
                "doctype": COMMENT,
                "request": doc.name,
                "author_user": author,
                "author_name": frappe.db.get_value("User", author, "full_name") or author,
                "author_side": side,
                "body": text,
                "idempotency_key": key,
            }
        )

        try:
            comment.insert(ignore_permissions=True)
        except frappe.exceptions.DuplicateEntryError:
            frappe.db.rollback()
            written = frappe.db.get_value(COMMENT, {"idempotency_key": key}, "name")

            if not written:
                raise

            return RequestCommentService._written(written)

        # the message is on the record before anybody is told about it, and a mail that
        # cannot be queued never takes it back off
        frappe.db.commit()
        RequestCommentService._tell(doc, comment)

        return RequestCommentService._written(comment.name)

    @staticmethod
    def _written(name):
        row = frappe.db.get_value(
            COMMENT,
            name,
            ["name", "author_user", "author_name", "author_side", "body", "creation"],
            as_dict=True,
        )

        return RequestCommentService._card(row)

    # ------------------------------------------------------------------ telling
    @staticmethod
    def _tell(doc, comment):
        """Everybody the other side of this conversation, and never its author.

        While the request is still waiting for its own company's decision it has not reached
        us at all, so the message stays inside the company: notifying our team there would
        hand over a conversation the customer has not yet decided to send.
        """
        if doc.status == CUSTOMER_APPROVAL:
            # its own notification, declared with no copy sources at all: a fixed internal
            # address configured on the ordinary comment rule would otherwise read a
            # conversation the company has not decided to send us
            template, addresses = BEFORE_HANDOVER, RequestCommentService._company_side(doc)
        elif comment.author_side == CUSTOMER:
            template, addresses = FOR_OUR_TEAM, RequestCommentService._our_team()
        else:
            template, addresses = FOR_CUSTOMER, RequestCommentService._company_side(doc)

        recipients = [
            address for address in dict.fromkeys(addresses) if address and address != comment.author_user
        ]

        if not recipients:
            return

        notifications.send(
            template,
            recipients,
            RequestCommentService._context(doc, comment),
            reference_doctype=REQUEST,
            reference_name=doc.name,
            occurrence=f"comment:{comment.name}",
        )

    @staticmethod
    def _our_team():
        from nexgen_msp.api.portal.services.portal_service import PortalService

        return PortalService._our_team()

    @staticmethod
    def _company_side(doc):
        """The company's own people on this request: who raised it and who may decide it."""
        from nexgen_msp.api.internal.services.request_service import RequestService
        from nexgen_msp.api.portal.services.portal_service import PortalService

        record = frappe.get_doc(REQUEST, doc.name)

        return list(RequestService._people_to_tell(record)) + list(
            PortalService._approvers_of(record)
        )

    @staticmethod
    def _context(doc, comment):
        side = "Nexgen MSP" if comment.author_side == MSP else "Customer"

        return {
            "request": doc.name,
            "author": comment.author_name or comment.author_user,
            "author_side": side,
            "commented_at": frappe.utils.format_datetime(comment.creation),
            "comment_body": frappe.utils.escape_html(comment.body).replace("\n", "<br>"),
            "summary": notifications.summary_table(
                [
                    ("Request", doc.name),
                    ("Comment from", f"{comment.author_name or comment.author_user} ({side})"),
                    ("Written", frappe.utils.format_datetime(comment.creation)),
                ]
            ),
            "link": notifications.portal_url(f"/requests/{doc.name}"),
        }
