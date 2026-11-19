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
            REQUEST,
            name,
            ["name", "status", "customer", "requester", "source", "refused_by_customer"],
            as_dict=True,
        )

        if not doc:
            raise RequestCommentService._missing(name)

        if access.is_staff():
            RequestService._guard_internal()

            # a request still waiting for its own company's decision is not ours to read,
            # and neither is the conversation on it. Neither is one the company refused
            # before sending it: it never reached us, and the request page says so too
            if doc.status in (DRAFT, CUSTOMER_APPROVAL) or doc.refused_by_customer:
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
        seen = {}

        return {
            "request": doc.name,
            "side": side,
            # the work is done and the exchange about it with it; what was said stays
            # readable, which is the whole point of writing it down
            "may_post": doc.status != COMPLETED,
            "awaiting_customer_approval": doc.status == CUSTOMER_APPROVAL,
            "comments": [
                RequestCommentService._card(row, seen)
                for row in frappe.get_all(
                    COMMENT,
                    filters={"request": doc.name},
                    fields=[
                        "name",
                        "author_user",
                        "author_name",
                        "author_side",
                        "body",
                        "creation",
                    ],
                    order_by="creation asc, name asc",
                    limit_page_length=0,
                )
            ],
        }

    @staticmethod
    def _card(row, seen=None):
        """One message as a reader sees it, named by the role of whoever wrote it.

        The role is read from the account, never copied beside the message: there is one
        place that says what somebody is, and a second copy of it would be wrong the day
        it changes.
        """
        seen = {} if seen is None else seen

        if row["author_user"] not in seen:
            seen[row["author_user"]] = RequestCommentService._role_of(row["author_user"])

        return {
            "name": row["name"],
            "author": row["author_user"],
            "author_name": row["author_name"] or row["author_user"],
            "side": row["author_side"],
            "role": seen[row["author_user"]],
            "body": row["body"],
            "created_at": RequestCommentService._instant(row["creation"]),
        }

    # what somebody is, when they hold several: an account with both Technician and System
    # Admin is a System Admin, the way the person themselves would answer the question
    ROLES = (
        "MSP System Admin",
        "MSP Technician",
        "MSP Customer Manager",
        "MSP Customer Operator",
    )

    @staticmethod
    def _instant(value):
        """When it was written, as an instant and not as a reading of somebody's clock.

        The database keeps the site's own time with nothing said about which that is, so a
        reader in another country saw their own hour on somebody else's message.
        """
        from zoneinfo import ZoneInfo

        moment = frappe.utils.get_datetime(value)

        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=ZoneInfo(frappe.utils.get_system_timezone()))

        return moment.isoformat()

    @staticmethod
    def _role_of(user):
        """The highest role this account holds, read from the account itself."""
        from nexgen_msp.utils import access

        held = access.roles(user)

        for role in RequestCommentService.ROLES:
            if role in held:
                return role

        return None

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

        # two posts of the same intention can both find nothing above and both insert, so
        # the unique key is what really decides. A duplicate unique *field* raises
        # UniqueValidationError, a duplicate name DuplicateEntryError, and the savepoint
        # keeps the refusal from taking the rest of the transaction with it
        savepoint = "request_comment"
        frappe.db.savepoint(savepoint)

        try:
            comment.insert(ignore_permissions=True)
        except (frappe.exceptions.DuplicateEntryError, frappe.exceptions.UniqueValidationError):
            frappe.db.rollback(save_point=savepoint)
            written = frappe.db.get_value(
                COMMENT,
                {"request": doc.name, "author_user": author, "idempotency_key": key},
                "name",
            )

            # the same key under another request or another author is not this comment,
            # and answering with it would hand somebody else's words back
            if not written:
                raise

            return RequestCommentService._written(written)

        # the message is on the record before anybody is told about it, and a mail that
        # cannot be queued never takes it back off. `notified` is written in the same
        # transaction as the message itself — it is a field of it — so a send that never
        # happened leaves a row saying so, and `deliver_owed` finds it later
        frappe.db.commit()
        RequestCommentService._deliver(doc, comment)

        return RequestCommentService._written(comment.name)

    @staticmethod
    def _deliver(doc, comment):
        """Tell the other side, and write it down only once that has actually been done.

        A send nobody could hand to the queue leaves the message owed, which is what makes
        it come back. Nobody to tell is settled, not owed: there is no mail to recover.
        """
        if not RequestCommentService._tell(doc, comment):
            return False

        frappe.db.set_value(COMMENT, comment.name, "notified", 1, update_modified=False)
        frappe.db.commit()

        return True

    @staticmethod
    def deliver_owed(limit=50):
        """Every comment whose notification never went out, tried again.

        A process that stops between writing a message and handing it to the mail queue
        leaves the message on the record and nobody told. Replaying is safe: each send is
        identified by the comment itself, so the queue recognises one it already holds and
        nobody is written to twice.
        """
        # no age cuts a message off from the notification it is owed: an outage that lasts
        # a week ends with the week's messages told, not with them quietly dropped
        owed = frappe.get_all(
            COMMENT,
            filters={"notified": 0},
            fields=["name", "request"],
            order_by="creation asc",
            limit_page_length=limit,
        )
        done = 0

        for row in owed:
            request = frappe.db.get_value(
                REQUEST,
                row["request"],
                ["name", "status", "customer", "refused_by_customer"],
                as_dict=True,
            )

            if not request:
                continue

            try:
                RequestCommentService._deliver(request, frappe.get_doc(COMMENT, row["name"]))
                done += 1
            except Exception:
                # never rolled back: this runs inside whatever else the tick is doing, and
                # undoing that to report one mail would cost more than the mail
                frappe.log_error(
                    title="MSP comment notification could not be sent",
                    message=frappe.get_traceback(),
                )

        return {"owed": len(owed), "sent": done}

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
        if doc.status == CUSTOMER_APPROVAL or doc.refused_by_customer:
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
            return True

        return notifications.send(
            template,
            recipients,
            RequestCommentService._context(doc, comment),
            reference_doctype=REQUEST,
            reference_name=doc.name,
            occurrence=f"comment:{comment.name}",
            # nobody is told about their own comment, including by a copy policy that
            # happens to resolve to them — nor anybody a previous attempt at this same
            # comment already handed to the queue, which is what makes a retry a retry
            exclude=[comment.author_user, *RequestCommentService._already_told(comment)],
        )

    @staticmethod
    def _already_told(comment):
        """Addresses an earlier attempt at this comment already handed to the mail queue.

        A send that fell over halfway leaves the first messages queued and the rest owed.
        Only a delivery that certainly never left is tried again: an unconfirmed one may
        well be sitting in the queue, and sending it twice to find out is how one message
        becomes two.
        """
        return frappe.get_all(
            "MSP Notification Dispatch",
            filters={
                "event_occurrence_key": f"event:comment:{comment.name}",
                "status": ("!=", "Failed"),
            },
            pluck="recipient",
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
        side = RequestCommentService._role_of(comment.author_user) or (
            "Nexgen MSP" if comment.author_side == MSP else "Customer"
        )

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
