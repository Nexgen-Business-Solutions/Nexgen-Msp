"""Every notification this application owns, named once and never from the browser.

A rule is configurable; what it is remains ours. The browser may say "send this one to the
approvers instead" — it may not say "send this arbitrary template on this arbitrary event
to this arbitrary address", because that is a notification engine and not a settings
screen. So each managed notification is declared here with its event or condition, its
template, the audiences it is allowed to reach and whether it may be switched off at all.

What the administrator may change lives in `MSP Notification Rule`. What may be changed
*to* lives here, and a saved rule is validated against it.
"""

import frappe

REQUEST = "MSP Request"

EVENT = "Event"
REMINDER = "Reminder"

CATEGORIES = ("Requests", "Billing", "Accounts", "Operations")


# --------------------------------------------------------------------------- audiences
def _requester(doc):
    return [doc.requester] if doc.get("requester") else []


def _approvers(doc):
    from nexgen_msp.api.portal.services.portal_service import PortalService

    return PortalService._approvers_of(doc)


def _internal(doc):
    from nexgen_msp.api.portal.services.portal_service import PortalService

    return PortalService._our_team()


def _internal_without_requester(doc):
    """The team reminder has always left out whoever raised the request."""
    requester = doc.get("requester")

    return [address for address in _internal(doc) if address != requester]


def _request_audience(doc):
    from nexgen_msp.api.internal.services.request_service import RequestService

    return RequestService._people_to_tell(doc)


def _work_technicians(doc):
    """The technicians who carried out this request's work.

    Nothing in this product assigns a request to anybody, so there is nobody to name
    before the work is done. What can be named is who did it, read from the work orders
    themselves — which is empty until somebody has.
    """
    if not doc.get("name"):
        return []

    return frappe.get_all(
        "MSP Work Order",
        filters={"request": doc.name, "completed_by": ("is", "set")},
        pluck="completed_by",
        distinct=True,
    )


def _account_holder(doc):
    """The one account a security or invitation mail is about."""
    return [doc.name] if doc.get("name") else []


def _billing_contact(doc):
    """The one address a billing notice is addressed to, from the customer's own record.

    Read through the billing service rather than resolved here: who a company is billed
    through is its own decision, recorded in one place, and an address this application
    was never given is refused there rather than mailed from here.
    """
    from nexgen_msp.api.internal.services.billing_service import BillingService

    customer = doc.get("customer")

    if not customer:
        return []

    address, _refusal = BillingService.billing_contact_email(customer)

    return [address] if address else []


AUDIENCES = {
    "requester": {"label": "Requester", "resolver": _requester},
    "approvers": {"label": "Customer approvers", "resolver": _approvers},
    "internal": {"label": "MSP internal team", "resolver": _internal},
    "internal_without_requester": {
        "label": "MSP internal team, excluding the requester",
        "resolver": _internal_without_requester,
    },
    "request_audience": {
        "label": "Everyone the request concerns",
        "resolver": _request_audience,
    },
    "work_technicians": {
        "label": "Technicians who carried out the work",
        "resolver": _work_technicians,
    },
    "account_holder": {"label": "The account holder", "resolver": _account_holder},
    "billing_contact": {"label": "Customer billing contact", "resolver": _billing_contact},
}


# --------------------------------------------------------------------------- conditions
# what each way of stopping adds to the trigger. Leaving the trigger status adds nothing:
# the trigger filter already tests it, so it is the floor under every other choice
REQUEST_STOPS = {
    "left_trigger_status": {},
    "refused_by_customer": {"refused_by_customer": 0},
}


def _awaiting_customer(rule_key=None):
    """Requests their own company has not yet agreed to."""
    return {
        "doctype": REQUEST,
        "filters": {"status": "Awaiting Customer Approval"},
        # nothing on the record says when it began waiting for its company: the normal path
        # creates it in that state, so creation is that moment. A draft written days earlier
        # and sent later anchors early by the age of the draft — a known limitation, bounded
        # by the rule's own activation boundary, which never lets a backlog out
        "anchor_fields": ("creation",),
        "stops": dict(REQUEST_STOPS),
    }


def _waiting_for_us(rule_key=None):
    """Requests that reached us and that nobody has started."""
    return {
        "doctype": REQUEST,
        "filters": {"status": "Submitted"},
        # the day it reached us, which is the field the queue is measured from
        "anchor_fields": ("submitted_on", "customer_approved_at", "creation"),
        "stops": dict(REQUEST_STOPS),
    }


CONDITIONS = {
    "request_approval_pending": _awaiting_customer,
    "request_waiting_internal": _waiting_for_us,
}

def trigger_label(trigger_key):
    """The trigger key as words: the underscores are ours, not the reader's."""
    return (trigger_key or "").replace("_", " ").capitalize()


CONDITION_LABELS = {
    "request_approval_pending": "Request waiting for customer approval",
    "request_waiting_internal": "Submitted request waiting for our team",
}

STOP_CONDITIONS = {
    "left_trigger_status": "Stop when the record leaves the status that made it eligible",
    "refused_by_customer": "Stop when the customer refuses the request",
}

# every code this application writes about a notification, said once. A screen prints what
# is here and never the code itself: the same fact read on two pages must read the same, and
# a code invented in one service must not be spelled out again in a table that shows it
REASON_LABELS = {
    "eligible": "Due now",
    "not_due": "Not due yet",
    "max_reached": "The maximum number of reminders has been sent",
    "resolved": "The record no longer matches the condition",
    "quiet_hours": "Deferred until the quiet period ends",
    "before_activation": "Waiting for the first send under the current settings",
    "disabled": "This reminder is switched off",
    "render_failed": "The message could not be built",
    "attested_not_sent": "Recorded as never sent, after an administrator checked",
    "no_longer_addressed": "The recipient is no longer in this rule's audience",
    "no_recipient": "Nobody to write to",
    "rule_disabled": "The rule was switched off",
    "enqueue_failed": "The mail queue refused it",
    "queue_id_unknown": "Handed to the queue, which named no entry to follow",
    "reservation_abandoned": "A send was started and never finished",
    "queued": "Handed to the mail queue",
    "settings_saved": "An administrator saved this rule",
    "needs_investigation": "Needs a look before anything is sent again",
    "draft_saved": "An administrator saved a draft of this wording",
    "template_published": "An administrator published a new revision of this wording",
    "template_restored": "An administrator brought an older revision back into the editor",
    "preferred_variant": "The recipient's own language was published",
    "no_preference": "No language preference on the account or the customer",
    "variant_not_published": "That language has no published wording yet",
    "legacy_template": "No language has been published; the original template was used",
    "policy_disabled": "This copy is switched off",
    "unsupported_source": "That source is not one this notification can be copied to",
    "not_permitted": "That address belongs to a customer's own contact",
    "shared_message": "Copied on another recipient's message, in that recipient's language",
    "no_record": "There is no business record to resolve this source against",
    "invalid_address": "Not an email address",
    "other_customer": "That address belongs to another company",
    "already_addressed": "Already written to on a more open channel",
    "protected_notification": "This notification reaches the account holder and nobody else",
    "policies_saved": "An administrator changed who this notification is copied to",
}


# the languages a managed template may be published in, and the one a mail falls back to
# when nobody has told us the recipient's. Decided once here rather than per send path: a
# language chosen differently in two places is two different mails for the same event
LOCALES = ("en", "fr")
LOCALE_LABELS = {"en": "English", "fr": "Français"}
FALLBACK_LOCALE = "en"

# where the language of a mail came from, said in words on the delivery it produced
LANGUAGE_SOURCES = {
    "account": "The recipient's own account setting",
    "customer": "The customer's language",
    "fallback": "Nobody has told us this recipient's language",
}


def locale_label(locale):
    """A language as the screens name it."""
    return LOCALE_LABELS.get(locale) or (locale or "").upper()


def language_source_label(code):
    """Where a language came from, in words."""
    if not code:
        return None

    return LANGUAGE_SOURCES.get(code) or trigger_label(code)


def reason_label(code):
    """What a code means in words. An unknown one is read out rather than hidden."""
    if not code:
        return None

    return REASON_LABELS.get(code) or trigger_label(code)


def rule_label(rule_key, stored=None):
    """What a rule is called, the one name every screen shows for it."""
    if stored:
        return stored

    return (RULES.get(rule_key) or {}).get("display_name") or trigger_label(rule_key)


# --------------------------------------------------------------------------- copies
# Who a notification may be copied to, beyond the audience it is addressed to. A source is
# listable only where its resolver reads fields the rule's own record has: pointing one at
# a record that cannot answer it would mail nobody and say nothing about why.
#
# The technicians a request can name are the ones who carried its work out. Nothing in
# this product assigns a request to anybody beforehand — whoever opens it carries it out —
# so a source promising an assigned technician would be a guess wearing the name of a fact.
REQUEST_SOURCES = (
    "requester",
    "approvers",
    "request_audience",
    "internal",
    "internal_without_requester",
    "work_technicians",
    "billing_contact",
)

# a record that names a company but no requester and no approvers: an invoice, a dispute
CUSTOMER_SOURCES = ("billing_contact", "internal")

# raised without any business record at all, so only our own team can be resolved
INTERNAL_SOURCES = ("internal",)


# --------------------------------------------------------------------------- the rules
def _event(
    key,
    name,
    category,
    template,
    audience,
    source,
    protected=False,
    alternates=(),
    copies=(),
):
    return {
        "rule_key": key,
        "kind": EVENT,
        "display_name": name,
        "category": category,
        "trigger_key": key,
        "template_name": template,
        "audience_key": audience,
        "audiences": (audience,),
        "templates": (template,) + tuple(alternates),
        "protected": protected,
        # a notification that carries the means of signing in as somebody is never copied
        "copies": () if protected else tuple(copies),
        "source": source,
    }


def _reminder(
    key, name, category, template, audience, source, condition, conditions=(), copies=()
):
    return {
        "rule_key": key,
        "kind": REMINDER,
        "display_name": name,
        "category": category,
        "trigger_key": condition,
        "condition_key": condition,
        "template_name": template,
        "audience_key": audience,
        "audiences": (audience,),
        "templates": (template,),
        "conditions": tuple(conditions) or (condition,),
        "protected": False,
        "copies": tuple(copies),
        "source": source,
        # what the two live reminders have always done, kept as the shape of a brand new
        # rule only. An existing rule's own numbers are never overwritten by a migration
        "suggested": {
            "initial_delay_value": 1,
            "initial_delay_unit": "Days",
            "repeat_interval_value": 3,
            "repeat_interval_unit": "Days",
            "max_sends": 3,
            # what the two live reminders stop on today: the trigger status and the refusal
            # both. Seeding the floor alone would start reminding about refused requests
            "stop_condition_key": "refused_by_customer",
        },
    }


RULES = {
    rule["rule_key"]: rule
    for rule in (
        # ---------------------------------------------------------------- accounts
        _event(
            "portal_invitation",
            "Portal invitation",
            "Accounts",
            "MSP Portal Invitation",
            "account_holder",
            "team_service.invite",
            protected=True,
        ),
        _event(
            "team_invitation",
            "Team invitation",
            "Accounts",
            "MSP Team Invitation",
            "account_holder",
            "team_service.invite",
            protected=True,
        ),
        _event(
            "password_reset",
            "Password reset",
            "Accounts",
            "MSP Password Reset",
            "account_holder",
            "overrides.user.reset_password",
            protected=True,
        ),
        # ---------------------------------------------------------------- requests
        _event(
            "request_received",
            "Request received",
            "Requests",
            "MSP Request Received",
            "requester",
            "portal_service.create_request",
            copies=REQUEST_SOURCES,
        ),
        _event(
            "request_for_our_team",
            "Request for our team",
            "Requests",
            "MSP Request For Our Team",
            "internal",
            "portal_service.create_request",
            copies=REQUEST_SOURCES,
        ),
        _event(
            "request_awaiting_approval",
            "Request awaiting customer approval",
            "Requests",
            "MSP Request Awaiting Approval",
            "approvers",
            "portal_service.create_request",
            copies=REQUEST_SOURCES,
        ),
        _event(
            "request_modified",
            "Request modified",
            "Requests",
            "MSP Request Modified",
            "approvers",
            "portal_service.modify_request",
            copies=REQUEST_SOURCES,
        ),
        _event(
            "request_approved_by_customer",
            "Request approved by the customer",
            "Requests",
            "MSP Request Approved By Customer",
            "internal",
            "portal_service.approve_request",
            copies=REQUEST_SOURCES,
        ),
        _event(
            "request_decision",
            "Request decision",
            "Requests",
            "MSP Request Decision",
            "request_audience",
            "request_service.decide",
            copies=REQUEST_SOURCES,
        ),
        _event(
            "request_completed",
            "Request completed",
            "Requests",
            "MSP Request Completed",
            "request_audience",
            "request_service.complete",
            copies=REQUEST_SOURCES,
        ),
        # ---------------------------------------------------------------- billing
        _event(
            "invoice_issued",
            "Invoice issued",
            "Billing",
            "MSP Invoice Issued",
            "billing_contact",
            "invoice_email_service.send",
            copies=CUSTOMER_SOURCES,
        ),
        _event(
            "invoice_disputed",
            "Invoice disputed",
            "Billing",
            "MSP Invoice Disputed",
            "internal",
            "portal_service.dispute_invoice",
            copies=CUSTOMER_SOURCES,
        ),
        _event(
            "dispute_acknowledged",
            "Dispute acknowledged",
            "Billing",
            "MSP Dispute Acknowledged",
            "billing_contact",
            "portal_service.dispute_invoice",
            copies=CUSTOMER_SOURCES,
        ),
        _event(
            "dispute_settled",
            "Dispute settled",
            "Billing",
            "MSP Dispute Settled",
            "billing_contact",
            "billing_service.settle_dispute",
            copies=CUSTOMER_SOURCES,
        ),
        # ---------------------------------------------------------------- operations
        _event(
            "authority_gap",
            "Approval authority gap",
            "Operations",
            "MSP Authority Gap",
            "internal",
            "approval.report_gap",
            copies=INTERNAL_SOURCES,
        ),
        # ---------------------------------------------------------------- reminders
        _reminder(
            "request_approval_pending",
            "Request waiting for customer approval",
            "Requests",
            "MSP Request Approval Reminder",
            "approvers",
            "reminders.remind_approvers",
            "request_approval_pending",
            copies=REQUEST_SOURCES,
        ),
        _reminder(
            "request_waiting_internal",
            "Submitted request waiting for our team",
            "Requests",
            "MSP Request Waiting Reminder",
            "internal_without_requester",
            "reminders.remind_our_team",
            "request_waiting_internal",
            copies=REQUEST_SOURCES,
        ),
    )
}

PROTECTED = tuple(key for key, rule in RULES.items() if rule["protected"])

# the one that must keep working whatever the settings say, because losing it locks people
# out of their own account
CRITICAL = "password_reset"


# every managed notification owns its template outright: one template, one rule, so the
# template a send already names is enough to find the settings that govern it
BY_TEMPLATE = {found["template_name"]: key for key, found in RULES.items()}


def rule_of_template(template_name):
    """The rule a template belongs to, or nothing when the template is not managed here."""
    return BY_TEMPLATE.get(template_name)


def rule(rule_key):
    """The declaration of one managed notification, or nothing when it is not ours."""
    return RULES.get(rule_key)


def require(rule_key):
    from nexgen_msp.utils.errors import NotFoundError

    found = RULES.get(rule_key)

    if not found:
        raise NotFoundError(f"{rule_key} is not a notification this application owns.", "NOT_FOUND")

    return found


def keys(kind=None):
    return tuple(
        key for key, found in RULES.items() if kind is None or found["kind"] == kind
    )


def copy_sources(rule_key):
    """The audiences this notification may also be copied to, and no others.

    A source outside this list is refused when a policy is saved and skipped if one ever
    reaches a send another way: the addresses of a company's approvers have no business on
    an invoice notice, whichever table the row sits in.
    """
    found = RULES.get(rule_key)

    if not found or found["protected"]:
        return ()

    return tuple(key for key in found["copies"] if key in AUDIENCES)


def is_protected(rule_key):
    return bool((RULES.get(rule_key) or {}).get("protected"))


def condition(condition_key):
    """The eligibility adapter of a reminder condition, read fresh each time it is asked."""
    builder = CONDITIONS.get(condition_key)

    if not builder:
        return None

    found = builder()
    found["stop_conditions"] = tuple(found.get("stops", {}))

    return found


def allowed_conditions(rule_key):
    """The conditions this rule may be pointed at: declared, and watching its own doctype.

    A condition over another doctype is fed a context the rule's template was never built
    for, so it is never listable however the declaration reads.

    Sharing a doctype is not sharing a meaning either. Each rule declares the one condition
    its template and its audience were written for: the approval reminder tells a company
    its own people are still waiting on it, and pointing that letter at requests already
    submitted to us would send it to the wrong people about the wrong moment. A second
    condition for a rule would be a second notification, declared here with the template
    and the audience that go with it.
    """
    found = RULES.get(rule_key)

    if not found or found["kind"] != REMINDER:
        return ()

    own = (condition(found["condition_key"]) or {}).get("doctype")

    return tuple(
        key
        for key in found["conditions"]
        if key in CONDITIONS and (condition(key) or {}).get("doctype") == own
    )


def effective_condition_key(rule_key, stored=None):
    """The condition a rule watches: the stored choice when it is still allowed, else the declaration."""
    if stored and stored in allowed_conditions(rule_key):
        return stored

    return (RULES.get(rule_key) or {}).get("condition_key")


def watch_filters(adapter, stop_condition_key=None):
    """What a rule watches: the trigger, plus whatever its chosen stop condition adds.

    An unknown key falls back to the trigger alone, which is the floor: a record that left
    the trigger status is never watched, whichever way the rule was told to stop.
    """
    return {**adapter["filters"], **(adapter.get("stops") or {}).get(stop_condition_key, {})}


def audience(audience_key):
    return AUDIENCES.get(audience_key)


def resolve_audience(audience_key, doc):
    """Who this audience is, on this record, right now.

    Read from the business record every time rather than stored on the rule: who may
    approve for a company changes, and a list frozen at configuration time would mail
    somebody who no longer holds that authority.
    """
    found = AUDIENCES.get(audience_key)

    if not found:
        return []

    return [address for address in (found["resolver"](doc) or []) if address]


def templates_for(rule_key):
    """The templates this rule may be pointed at.

    Only templates whose rendering context this event really supplies: a template asking
    for an invoice number cannot be put on a request notification, because the render
    would quietly produce an empty line in somebody's mail.
    """
    found = RULES.get(rule_key)

    if not found:
        return []

    return [name for name in found["templates"] if frappe.db.exists("Email Template", name)]


def choices(rule_key, condition_key=None):
    """Everything a rule editor may offer for this rule, and nothing else.

    The stop conditions offered are those of the selected condition's own adapter.
    """
    found = require(rule_key)
    options = {
        "templates": templates_for(rule_key),
        "sources": [
            {"key": key, "label": AUDIENCES[key]["label"]} for key in copy_sources(rule_key)
        ],
        "channels": ["To", "CC", "BCC"],
        "audiences": [
            {"key": key, "label": AUDIENCES[key]["label"]} for key in found["audiences"]
        ],
        "categories": list(CATEGORIES),
        "protected": found["protected"],
        "kind": found["kind"],
    }

    if found["kind"] == REMINDER:
        adapter = condition(effective_condition_key(rule_key, condition_key)) or {}
        options["conditions"] = [
            {"key": key, "label": CONDITION_LABELS.get(key, trigger_label(key))}
            for key in allowed_conditions(rule_key)
        ]
        options["stop_conditions"] = [
            {"key": key, "label": STOP_CONDITIONS[key]}
            for key in adapter.get("stop_conditions", ())
        ]
        options["business_doctype"] = adapter.get("doctype")
        options["units"] = ["Hours", "Days", "Weeks"]
        options["suggested"] = found["suggested"]

    return options
