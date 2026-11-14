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
    "account_holder": {"label": "The account holder", "resolver": _account_holder},
    "billing_contact": {"label": "Customer billing contact", "resolver": _billing_contact},
}


# --------------------------------------------------------------------------- conditions
def _awaiting_customer(rule_key=None):
    """Requests their own company has not yet agreed to."""
    return {
        "doctype": REQUEST,
        "filters": {"status": "Awaiting Customer Approval", "refused_by_customer": 0},
        # nothing on the record says when it began waiting for its company: the normal path
        # creates it in that state, so creation is that moment. A draft written days earlier
        # and sent later anchors early by the age of the draft — a known limitation, bounded
        # by the rule's own activation boundary, which never lets a backlog out
        "anchor_fields": ("creation",),
        "stop_conditions": ("left_trigger_status", "refused_by_customer"),
    }


def _waiting_for_us(rule_key=None):
    """Requests that reached us and that nobody has started."""
    return {
        "doctype": REQUEST,
        "filters": {"status": "Submitted", "refused_by_customer": 0},
        # the day it reached us, which is the field the queue is measured from
        "anchor_fields": ("submitted_on", "customer_approved_at", "creation"),
        "stop_conditions": ("left_trigger_status", "refused_by_customer"),
    }


CONDITIONS = {
    "request_approval_pending": _awaiting_customer,
    "request_waiting_internal": _waiting_for_us,
}

STOP_CONDITIONS = {
    "left_trigger_status": "Stop when the record leaves the status that made it eligible",
    "refused_by_customer": "Stop when the customer refuses the request",
}


# --------------------------------------------------------------------------- the rules
def _event(key, name, category, template, audience, source, protected=False, alternates=()):
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
        "source": source,
    }


def _reminder(key, name, category, template, audience, source, condition):
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
        "protected": False,
        "source": source,
        # what the two live reminders have always done, kept as the shape of a brand new
        # rule only. An existing rule's own numbers are never overwritten by a migration
        "suggested": {
            "initial_delay_value": 1,
            "initial_delay_unit": "Days",
            "repeat_interval_value": 3,
            "repeat_interval_unit": "Days",
            "max_sends": 3,
            "stop_condition_key": "left_trigger_status",
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
        ),
        _event(
            "request_for_our_team",
            "Request for our team",
            "Requests",
            "MSP Request For Our Team",
            "internal",
            "portal_service.create_request",
        ),
        _event(
            "request_awaiting_approval",
            "Request awaiting customer approval",
            "Requests",
            "MSP Request Awaiting Approval",
            "approvers",
            "portal_service.create_request",
        ),
        _event(
            "request_modified",
            "Request modified",
            "Requests",
            "MSP Request Modified",
            "approvers",
            "portal_service.modify_request",
        ),
        _event(
            "request_approved_by_customer",
            "Request approved by the customer",
            "Requests",
            "MSP Request Approved By Customer",
            "internal",
            "portal_service.approve_request",
        ),
        _event(
            "request_decision",
            "Request decision",
            "Requests",
            "MSP Request Decision",
            "request_audience",
            "request_service.decide",
        ),
        _event(
            "request_completed",
            "Request completed",
            "Requests",
            "MSP Request Completed",
            "request_audience",
            "request_service.complete",
        ),
        # ---------------------------------------------------------------- billing
        _event(
            "invoice_issued",
            "Invoice issued",
            "Billing",
            "MSP Invoice Issued",
            "billing_contact",
            "invoice_email_service.send",
        ),
        _event(
            "invoice_disputed",
            "Invoice disputed",
            "Billing",
            "MSP Invoice Disputed",
            "internal",
            "portal_service.dispute_invoice",
        ),
        _event(
            "dispute_acknowledged",
            "Dispute acknowledged",
            "Billing",
            "MSP Dispute Acknowledged",
            "billing_contact",
            "portal_service.dispute_invoice",
        ),
        _event(
            "dispute_settled",
            "Dispute settled",
            "Billing",
            "MSP Dispute Settled",
            "billing_contact",
            "billing_service.settle_dispute",
        ),
        # ---------------------------------------------------------------- operations
        _event(
            "authority_gap",
            "Approval authority gap",
            "Operations",
            "MSP Authority Gap",
            "internal",
            "approval.report_gap",
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
        ),
        _reminder(
            "request_waiting_internal",
            "Submitted request waiting for our team",
            "Requests",
            "MSP Request Waiting Reminder",
            "internal_without_requester",
            "reminders.remind_our_team",
            "request_waiting_internal",
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


def is_protected(rule_key):
    return bool((RULES.get(rule_key) or {}).get("protected"))


def condition(condition_key):
    """The eligibility adapter of a reminder condition, read fresh each time it is asked."""
    builder = CONDITIONS.get(condition_key)

    return builder() if builder else None


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


def choices(rule_key):
    """Everything a rule editor may offer for this rule, and nothing else."""
    found = require(rule_key)
    options = {
        "templates": templates_for(rule_key),
        "audiences": [
            {"key": key, "label": AUDIENCES[key]["label"]} for key in found["audiences"]
        ],
        "categories": list(CATEGORIES),
        "protected": found["protected"],
        "kind": found["kind"],
    }

    if found["kind"] == REMINDER:
        adapter = condition(found["condition_key"]) or {}
        options["stop_conditions"] = [
            {"key": key, "label": STOP_CONDITIONS[key]}
            for key in adapter.get("stop_conditions", ())
        ]
        options["business_doctype"] = adapter.get("doctype")
        options["units"] = ["Hours", "Days", "Weeks"]
        options["suggested"] = found["suggested"]

    return options
