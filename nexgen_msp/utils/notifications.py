import re
from urllib.parse import urlparse

import frappe

APP_NAME = "Nexgen MSP"
APP_TAGLINE = "Service and billing portal"

SHELL = """<div style="margin:0;padding:24px 0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;max-width:92%;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:24px 28px 20px;border-bottom:1px solid #f1f5f9;">
          <div style="font-size:16px;font-weight:700;color:#0f172a;">{app_name}</div>
          <div style="font-size:12px;color:#1d4ed8;margin-top:2px;">{tagline}</div>
        </td></tr>
        <tr><td style="padding:28px;color:#334155;font-size:14px;line-height:1.65;">
          {body}
        </td></tr>
        <tr><td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #f1f5f9;color:#94a3b8;font-size:12px;">
          Sent by {app_name}. If you were not expecting this message, you can ignore it.
        </td></tr>
      </table>
      <div style="color:#94a3b8;font-size:11px;padding:16px 0;">&copy; {year} Nexgen Business Solutions</div>
    </td></tr>
  </table>
</div>"""

BUTTON = """<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;">
  <tr><td style="border-radius:8px;background:#2563eb;">
    <a href="{{{{ {url} }}}}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">{label}</a>
  </td></tr>
</table>"""

HEADING = '<div style="font-size:19px;font-weight:700;color:#0f172a;margin:0 0 14px;">{text}</div>'

MUTED = '<div style="color:#64748b;font-size:13px;margin-top:18px;">{text}</div>'


def _card(rows):
    cells = "".join(
        f'<tr><td style="padding:6px 0;color:#64748b;width:42%;">{label}</td>'
        f'<td style="padding:6px 0;color:#0f172a;font-weight:600;">{value}</td></tr>'
        for label, value in rows
    )
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        'style="margin:18px 0;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;'
        f'border-radius:10px;font-size:13px;">{cells}</table>'
    )


TEMPLATES = {
    "MSP Portal Invitation": {
        "subject": "Your {{ app_name }} portal access",
        "body": HEADING.format(text="Welcome aboard")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>An access to the {{ app_name }} portal has been created for "
        "<strong>{{ customer }}</strong>.</p>"
        + "<p>From the portal you can review your users, devices and services, and submit "
        "requests to our team.</p>"
        + BUTTON.format(url="link", label="Set my password")
        + MUTED.format(
            text="If the button does not work, copy this address into your browser:<br>"
            "{{ link }}<br><br>This link can only be used once."
        ),
    },
    "MSP Team Invitation": {
        "subject": "Your {{ app_name }} account",
        "body": HEADING.format(text="Welcome to the team")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>An account has been created for you on {{ app_name }} as "
        "<strong>{{ role }}</strong>.</p>"
        + "<p>From there you handle customer requests, the people and machines we manage, "
        "and the services running on them.</p>"
        + BUTTON.format(url="link", label="Set my password")
        + MUTED.format(
            text="If the button does not work, copy this address into your browser:<br>"
            "{{ link }}<br><br>This link can only be used once."
        ),
    },
    "MSP Password Reset": {
        "subject": "Reset your {{ app_name }} password",
        "body": HEADING.format(text="Password reset")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>We received a request to reset the password of your {{ app_name }} account.</p>"
        + BUTTON.format(url="link", label="Choose a new password")
        + MUTED.format(
            text="If the button does not work, copy this address into your browser:<br>"
            "{{ link }}<br><br>This link can only be used once. If you did not ask for it, "
            "your password stays unchanged and no action is needed."
        ),
    },
    "MSP Request Received": {
        "subject": "{{ request }} received - {{ app_name }}",
        "body": HEADING.format(text="We have your request")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>Your request has reached our team and is queued for review.</p>"
        + "{{ summary }}"
        + BUTTON.format(url="link", label="Follow my request")
        + MUTED.format(text="You will be notified as soon as it has been reviewed."),
    },
    "MSP Request For Our Team": {
        "subject": "{{ request }} · {{ customer }} · {{ headline }} - {{ app_name }}",
        "body": HEADING.format(text="A request has come in")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>{{ customer }} has raised a request. Whoever opens it first carries it out.</p>"
        + "{{ summary }}"
        + "{{ acts }}"
        + BUTTON.format(url="link", label="Open the request"),
    },
    "MSP Authority Gap": {
        "subject": "{{ customer }}: {{ missing }} - {{ app_name }}",
        "body": HEADING.format(text="A company is stuck")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>At <b>{{ customer }}</b>, {{ missing }}. "
        + "{% if request %}Request {{ request }} is waiting on an accord nobody can give.{% endif %}</p>"
        + "<p>The company has {{ accounts }} enabled account(s). Name the right person on the "
        + "authority matrix, or open an account for them.</p>"
        + BUTTON.format(url="link", label="Open the customer"),
    },
    "MSP Request Awaiting Approval": {
        "subject": "{{ request }} needs your approval - {{ app_name }}",
        "body": HEADING.format(text="A request is waiting for you")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>{{ raised_by }} has raised a request for {{ customer }}. It reaches Nexgen only "
        + "once you have approved it.</p>"
        + "{{ summary }}"
        + BUTTON.format(url="link", label="Review it"),
    },
    "MSP Request Modified": {
        "subject": "{{ request }} was modified - {{ app_name }}",
        "body": HEADING.format(text="A request has changed")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>{{ modified_by }} has modified request {{ request }} for {{ customer }}. "
        + "What is written below replaces what was asked before.</p>"
        + "{{ summary }}"
        + BUTTON.format(url="link", label="Open the request"),
    },
    "MSP Request Approval Reminder": {
        "subject": "Reminder: {{ request }} still needs your approval - {{ app_name }}",
        "body": HEADING.format(text="Still waiting for your approval")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>Request {{ request }} for {{ customer }} has been waiting since {{ waiting_since }}. "
        + "It reaches Nexgen only once you have approved it.</p>"
        + "{{ summary }}"
        + BUTTON.format(url="link", label="Review it"),
    },
    "MSP Request Waiting Reminder": {
        "subject": "Reminder: {{ request }} · {{ customer }} · {{ headline }} - {{ app_name }}",
        "body": HEADING.format(text="A request is still waiting")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>{{ customer }} is waiting on request {{ request }}, received {{ waiting_since }}. "
        + "Nobody has started the work on it yet.</p>"
        + "{{ summary }}"
        + "{{ acts }}"
        + BUTTON.format(url="link", label="Open the request"),
    },
    "MSP Request Approved By Customer": {
        "subject": "{{ request }} approved - {{ app_name }}",
        "body": HEADING.format(text="Your request has been approved")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>{{ approver }} approved your request, and it has reached our team.</p>"
        + "{{ summary }}"
        + BUTTON.format(url="link", label="Follow my request"),
    },
    "MSP Request Decision": {
        "subject": "{{ request }} {{ outcome }} - {{ app_name }}",
        "body": HEADING.format(text="Your request has been reviewed")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>{{ headline }}</p>"
        + "{{ summary }}"
        + "{{ reason_block }}"
        + BUTTON.format(url="link", label="See the detail"),
    },
    "MSP Request Completed": {
        "subject": "{{ request }} completed - {{ app_name }}",
        "body": HEADING.format(text="Everything is in place")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>The work on your request is done. The services are visible in your portal.</p>"
        + "{{ summary }}"
        + BUTTON.format(url="link", label="See my services"),
    },
    "MSP Invoice Issued": {
        "subject": "Invoice {{ invoice }} for {{ period }} - {{ app_name }}",
        "body": HEADING.format(text="Your invoice is ready")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>Here is the summary of the services billed to <strong>{{ customer }}</strong> "
        "for {{ period }}.</p>"
        + "{{ summary }}"
        + BUTTON.format(url="link", label="Review my services")
        + MUTED.format(
            text="The detail of every user and device behind these figures is available in your portal."
        ),
    },
    "MSP Invoice Disputed": {
        "subject": "Invoice {{ invoice }} disputed by {{ customer }} - {{ app_name }}",
        "body": HEADING.format(text="An invoice has been disputed")
        + "<p><strong>{{ customer }}</strong> disputes invoice {{ invoice }} "
        "for {{ period }}.</p>"
        + "<p><strong>Reason given</strong></p><p>{{ reason }}</p>"
        + BUTTON.format(url="link", label="Review the billing run"),
    },
    "MSP Dispute Settled": {
        "subject": "Your dispute on {{ invoice }} has been reviewed - {{ app_name }}",
        "body": HEADING.format(text="Your dispute has been reviewed")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>We have finished reviewing your dispute on invoice {{ invoice }} "
        "for {{ period }}.</p>"
        + "<p><strong>Outcome</strong></p><p>{{ outcome }}</p>"
        + BUTTON.format(url="link", label="See the invoice"),
    },
    "MSP Dispute Acknowledged": {
        "subject": "We received your dispute on {{ invoice }} - {{ app_name }}",
        "body": HEADING.format(text="Your dispute has been recorded")
        + "<p>Hello {{ full_name }},</p>"
        + "<p>We have recorded your dispute on invoice {{ invoice }} for {{ period }} and our "
        "team is reviewing it.</p>"
        + "<p><strong>What you told us</strong></p><p>{{ reason }}</p>"
        + BUTTON.format(url="link", label="See the invoice")
        + MUTED.format(text="We will come back to you once the review is complete."),
    },
}



# the HTML this application builds itself and hands a template whole: a summary card, the
# list of acts, a reason block. They are not escaped on the way in, because they were never
# anybody's input
HTML_VARIABLES = ("summary", "acts", "reason_block")

# where a mail sends somebody, which is checked as an address rather than printed as one
URL_VARIABLES = ("link",)

# supplied on every send, whatever the template asks for
ALWAYS = ("app_name", "year")

_PLACEHOLDER = re.compile(r"\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}")
_CONDITION = re.compile(r"\{%\s*if\s+([a-z_][a-z0-9_]*)\s*%\}")


def variables_for(template_name):
    """The names a stored wording of this template may use, and what each one carries.

    Read off the wording this application ships rather than written out a second time next
    to it. A name an event does not supply would render as a blank line in somebody's mail,
    so what a template may ask for is exactly what it was built around, and the two cannot
    drift apart.
    """
    spec = TEMPLATES.get(template_name)

    if not spec:
        return []

    source = f"{spec['subject']} {spec['body']}"
    found = list(ALWAYS) + _PLACEHOLDER.findall(source) + _CONDITION.findall(source)
    kinds = []

    for name in dict.fromkeys(found):
        if name in HTML_VARIABLES:
            kind = "html"
        elif name in URL_VARIABLES:
            kind = "url"
        else:
            kind = "text"

        kinds.append({"name": name, "kind": kind})

    return kinds


def shipped_html(template_name):
    """The whole document this application ships for a template, shell and all."""
    spec = TEMPLATES.get(template_name)

    if not spec:
        return None

    return SHELL.format(
        app_name=APP_NAME, tagline=APP_TAGLINE, body=spec["body"], year="{{ year }}"
    )

def ensure_templates():
    """Create every template this app sends, so a fresh site is never mute.

    Create, and nothing else. This used to reassign the subject and the HTML of templates
    that already existed, which meant every `bench migrate` quietly threw away whatever an
    administrator had written — their wording, their signature, their translations. A
    template on the record is theirs from then on, and this walks past it.

    Returns the names it had to create, so a migration can say what it did.
    """
    created = []

    for name, spec in TEMPLATES.items():
        if frappe.db.exists("Email Template", name):
            continue

        doc = frappe.new_doc("Email Template")
        doc.name = name
        doc.subject = spec["subject"]
        doc.use_html = 1
        doc.response_html = shipped_html(name)
        doc.insert(ignore_permissions=True)
        created.append(name)

    if created:
        frappe.db.commit()

    return created


def drifted_templates():
    """The templates whose stored wording no longer matches the one shipped in the code.

    Read-only, and reported rather than corrected: a difference here is almost always an
    administrator's own edit, and the whole point of leaving it alone is that nobody can
    tell the difference between their wording and a stale default without being told.
    """
    drifted = []

    for name, spec in TEMPLATES.items():
        stored = frappe.db.get_value(
            "Email Template", name, ["subject", "response_html"], as_dict=True
        )

        if not stored:
            continue

        if stored.subject != spec["subject"] or (stored.response_html or "") != shipped_html(name):
            drifted.append(name)

    return drifted


def render(name, context):
    if not frappe.db.exists("Email Template", name):
        ensure_templates()

    template = frappe.get_doc("Email Template", name)
    context = {
        "app_name": APP_NAME,
        "year": frappe.utils.now_datetime().year,
        **context,
    }

    return (
        frappe.render_template(template.subject, context),
        frappe.render_template(template.response_html or template.response, context),
    )


def _settings_for(template_name):
    """How the administrator has configured the notification this template belongs to.

    Asked of the settings on every send rather than once at import: a change made in the
    screen has to reach the next mail, and a module holding yesterday's answer would keep
    sending what somebody switched off this morning.

    Returns nothing at all when the notification is not one this application manages, or
    when the settings cannot be read — a mail that has always gone out keeps going out
    rather than being lost to a table being momentarily unavailable.
    """
    try:
        from nexgen_msp.api.internal.services import notification_registry as registry
        from nexgen_msp.api.internal.services.notification_settings_service import (
            NotificationSettingsService,
        )

        rule_key = registry.rule_of_template(template_name)

        if not rule_key:
            return None

        return NotificationSettingsService.effective(rule_key)
    except Exception:
        frappe.log_error(
            title=f"Notification settings unavailable for {template_name}",
            message=frappe.get_traceback(),
        )

        return None


def _record_refusal(settings, template_name, recipients, reference_doctype, reference_name):
    """Note that an event produced no mail because the settings said so.

    Written so that "why did nobody get told" has an answer. It must never be the reason a
    business operation fails, so a failure to write it is swallowed here as well.
    """
    try:
        from nexgen_msp.api.internal.services.notification_settings_service import (
            NotificationSettingsService,
        )

        NotificationSettingsService._write_audit(
            action="Skipped",
            rule=settings["rule_key"],
            rule_revision=settings.get("revision"),
            business_doctype=reference_doctype,
            business_name=reference_name,
            recipients=", ".join(recipients)[:500],
            template_name=template_name,
            reason_code="rule_disabled",
            detail="The event happened; this notification is switched off.",
        )
    except Exception:
        frappe.log_error(
            title=f"Could not record the refusal of {template_name}",
            message=frappe.get_traceback(),
        )


def _record_event_send(
    settings,
    template_name,
    recipients,
    cc,
    subject,
    queued,
    reference_doctype,
    reference_name,
    occurrence=None,
    language=None,
):
    """Record that this event produced this mail, so the delivery history is the whole story.

    One row per address written to, all of them pointing at the one queue entry the mail
    really is: the history question is "was this person told", and that is answered per
    person even when a single message carried several of them.

    Events are not deduplicated here, and deliberately so. A business record can legitimately
    produce the same notification twice — a request decided, reopened and decided again — and
    nothing a call site passes today identifies one occurrence from the next. Giving them a
    shared identity would silence the second decision, which is worse than recording two.
    So the default is a fresh token, and it cannot be derived from the record: the record is
    the same before and after the reopening. Only the caller knows what makes this decision
    a different one from the last, and it says so by passing `occurrence`.

    Nothing in here may break the operation that triggered the mail, so every failure is
    logged and swallowed.
    """
    try:
        from nexgen_msp.api.internal.services.notification_dispatch_service import (
            NotificationDispatchService,
        )

        queue_id = getattr(queued, "name", None) or (queued if isinstance(queued, str) else None)

        for address in recipients:
            NotificationDispatchService.record_event(
                rule_key=settings["rule_key"],
                revision=settings.get("revision"),
                recipient=address,
                cc=cc,
                template_name=template_name,
                subject=subject,
                occurrence=occurrence,
                queue_id=queue_id,
                business_doctype=reference_doctype,
                business_name=reference_name,
                language=language,
            )
    except Exception:
        frappe.log_error(
            title=f"Could not record the delivery of {template_name}",
            message=frappe.get_traceback(),
        )


def send(
    name,
    recipients,
    context,
    reference_doctype=None,
    reference_name=None,
    now=False,
    cc=None,
    attachments=None,
    occurrence=None,
):
    """Queue a branded email. Never let a mail failure break the operation that triggered it.

    What comes back is the queued row when there is one, so a caller that has to trace its
    own mail can; it is still only ever read as "something was queued" or "nothing was".

    `occurrence` is a stable identifier for this business event, chosen by the caller, so
    that the same event retried is recognised as the same delivery. Left out, every call is
    recorded as its own delivery.
    """
    recipients = [address for address in (recipients or []) if address]
    cc = [address for address in (cc or []) if address and address not in recipients]

    if not recipients:
        return False

    settings = _settings_for(name)

    if settings and not settings["enabled"]:
        # the administrator switched this notification off, so the next event stops
        # producing it. The business operation that triggered it is not affected: it
        # already happened, and a mail was only ever its consequence
        _record_refusal(settings, name, recipients, reference_doctype, reference_name)

        return False

    # every channel of this send, resolved from the record, bounded by the company it is
    # about and deduplicated. The refusal of a copy on a protected notification is applied
    # in there as well, because that is the line that puts an address on a mail and it must
    # hold even if something above it ever stops holding
    bcc = []
    customer = _company_of(reference_doctype, reference_name)

    if settings:
        channels = _channels(
            settings, name, recipients, cc, reference_doctype, reference_name, customer
        )
        recipients, cc, bcc = channels["to"], channels["cc"], channels["bcc"]
        _record_skips(settings, name, channels["skipped"], reference_doctype, reference_name)

        if not recipients and not cc and not bcc:
            return False

    try:
        # the template the settings name, which is the one an administrator chose. Today the
        # registry permits exactly one per notification, so this is the same template the
        # caller passed — and it stays right the day a second one is registered, instead of
        # silently sending the old one
        template_name = (settings or {}).get("template_name") or name
        occurrence = (
            f"event:{occurrence}" if occurrence else f"event:{frappe.generate_hash(length=12)}"
        )
        sent = None

        for group in _by_language(template_name, recipients, cc, bcc, customer, context):
            queued = frappe.sendmail(
                recipients=group["recipients"],
                cc=group["cc"] or None,
                bcc=group["bcc"] or None,
                subject=group["subject"],
                message=group["html"],
                reference_doctype=reference_doctype,
                reference_name=reference_name,
                attachments=attachments or None,
                now=now,
            )
            sent = sent or queued or True

            if settings:
                _record_event_send(
                    settings,
                    name,
                    group["recipients"] + group["bcc"],
                    group["cc"],
                    group["subject"],
                    queued,
                    reference_doctype,
                    reference_name,
                    occurrence=occurrence,
                    language=group["language"],
                )

        return sent or True
    except Exception:
        frappe.log_error(title=f"{name} could not be sent", message=frappe.get_traceback())
        return False


def _company_of(reference_doctype, reference_name):
    """The company this event is about, when its record names one."""
    from nexgen_msp.api.internal.services.notification_dispatch_service import (
        NotificationDispatchService,
    )

    return NotificationDispatchService._customer_of(reference_doctype, reference_name)


def _channels(settings, name, recipients, cc, reference_doctype, reference_name, customer):
    """Who this notification reaches on each channel, or the caller's own list if asking fails.

    Resolving a copy must never be the reason a mail does not go out. When this cannot be
    answered the notification still reaches the people the call site named, which is what
    it did before any of this existed.
    """
    try:
        from nexgen_msp.api.internal.services.notification_recipient_policy_service import (
            NotificationRecipientPolicyService,
        )

        return NotificationRecipientPolicyService.resolve(
            settings["rule_key"],
            recipients,
            cc=cc,
            business_doctype=reference_doctype,
            business_name=reference_name,
            customer=customer,
        )
    except Exception:
        frappe.log_error(
            title=f"Could not resolve who {name} goes to",
            message=frappe.get_traceback(),
        )

        return {"to": recipients, "cc": cc, "bcc": [], "skipped": []}


def _record_skips(settings, name, skipped, reference_doctype, reference_name):
    """Note every copy that was left out, so "why was nobody told" has an answer.

    One line for all of them rather than one each: they belong to a single send, and a
    screen reading them wants the send's story and not a row per address.
    """
    if not skipped:
        return

    try:
        from nexgen_msp.api.internal.services.notification_settings_service import (
            NotificationSettingsService,
        )

        NotificationSettingsService._write_audit(
            action="Skipped",
            rule=settings["rule_key"],
            rule_revision=settings.get("revision"),
            business_doctype=reference_doctype,
            business_name=reference_name,
            recipients=", ".join(f"{entry['target']}" for entry in skipped)[:500],
            template_name=name,
            reason_code=skipped[0]["reason"],
            detail="; ".join(
                f"{entry['channel']} {entry['target']}: {entry['reason']}" for entry in skipped
            )[:500],
        )
    except Exception:
        frappe.log_error(
            title=f"Could not record the copies {name} left out",
            message=frappe.get_traceback(),
        )


def _by_language(template_name, recipients, cc, bcc, customer, context):
    """One message per language, each addressed only to the people who read it.

    A single message cannot be in two languages, so a mail whose audience does not share
    one becomes several — each a delivery of its own, recorded with its own language and
    its own queue entry. Grouping is what keeps that honest: nobody is told in a language
    they never chose so that somebody else could share their message.

    A language whose group holds only copied addresses is still sent, as copies and
    nothing else: a blind copy moved onto the To line to give the message a recipient
    would disclose the one address nobody was meant to see.
    """
    from nexgen_msp.api.internal.services.notification_template_service import (
        NotificationTemplateService,
    )

    groups = {}

    for channel, addresses in (("recipients", recipients), ("cc", cc), ("bcc", bcc)):
        for address in addresses:
            built = NotificationTemplateService.for_delivery(
                template_name, address, customer, context
            )
            key = (built["locale"], built["revision"])
            group = groups.setdefault(
                key,
                {
                    "recipients": [],
                    "cc": [],
                    "bcc": [],
                    "subject": built["subject"],
                    "html": built["html"],
                    "language": built,
                },
            )
            group[channel].append(address)

    # a language whose group holds only copies is sent as copies: Frappe's queue takes a
    # message with no direct recipient, and a blind copy promoted onto the To line would
    # disclose exactly what a blind copy is for
    return list(groups.values())


def request_headline(request):
    """The request in one line, for a subject somebody scans in a list of mail."""
    doc = request if hasattr(request, "lines") else frappe.get_doc("MSP Request", request)
    groups = [
        group.operation_label_snapshot or group.operation_code
        for group in (doc.get("action_groups") or [])
    ]

    if not groups:
        return _plural(len(doc.lines), "action", "actions")

    if len(groups) == 1:
        return groups[0]

    return f"{groups[0]} +{len(groups) - 1}"


def request_briefing(request):
    """What a request is about, in the few lines somebody reads before opening it.

    A technician who opens their mail wants to know whose company it is, when it is wanted
    for, and what is actually being asked — not a count of lines. The acts are listed as the
    customer grouped them, with what each one reaches, and whatever has to be created first
    is named, because that is the part that cannot be done in a minute.
    """
    doc = request if hasattr(request, "lines") else frappe.get_doc("MSP Request", request)
    people = {row.subject_key for row in doc.lines if row.subject_key}
    machines = {row.managed_device for row in doc.lines if row.managed_device}
    newcomers = frappe.db.count(
        "MSP Requested Client User", {"request": doc.name, "status": "Open"}
    )
    new_machines = frappe.db.count(
        "MSP Requested Device", {"request": doc.name, "status": "Open"}
    )
    reach = ", ".join(
        filter(
            None,
            (
                _plural(len(people), "person", "people") if people else "",
                _plural(len(machines), "machine", "machines") if machines else "",
            ),
        )
    )
    to_create = ", ".join(
        filter(
            None,
            (
                _plural(newcomers, "person", "people") if newcomers else "",
                _plural(new_machines, "machine", "machines") if new_machines else "",
            ),
        )
    )

    rows = [
        ("Customer", doc.customer),
        ("Raised by", frappe.db.get_value("User", doc.requester, "full_name") or doc.requester or "-"),
        ("Wanted for", frappe.utils.formatdate(doc.requested_date) if doc.requested_date else "As soon as possible"),
        ("Priority", doc.priority or "Medium"),
        ("Reaches", reach or "-"),
    ]

    if to_create:
        rows.append(("To create first", to_create))

    if doc.details:
        rows.append(("Note", frappe.utils.escape_html(doc.details)))

    return {"summary": _card(rows), "acts": _acts(doc)}


def _plural(count, one, many):
    return f"{count} {one if count == 1 else many}"


def _acts(doc):
    """Every act the customer grouped, with what it reaches, as a plain list."""
    counts = {}

    for row in doc.lines:
        counts[row.action_group_key] = counts.get(row.action_group_key, 0) + 1

    items = []

    for group in doc.get("action_groups") or []:
        reached = counts.get(group.group_key, 0)

        if not reached:
            continue

        items.append(
            '<li style="margin:4px 0;color:#0f172a;">'
            f"<strong>{frappe.utils.escape_html(group.operation_label_snapshot or group.operation_code)}</strong>"
            f' <span style="color:#64748b;">· {_plural(reached, "target", "targets")}'
            + (
                f" · {frappe.utils.escape_html(group.source_scope_label)}"
                if group.source_scope_label and group.source_scope_type != "All"
                else ""
            )
            + "</span></li>"
        )

    if not items:
        return ""

    return (
        '<div style="margin:18px 0;"><div style="font-size:13px;font-weight:700;color:#0f172a;'
        'margin-bottom:6px;">What is asked</div>'
        f'<ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5;">{"".join(items)}</ul></div>'
    )


def summary_table(rows):
    return _card(rows)


def portal_url(path=""):
    """Where a customer is sent, which is not always where the staff works.

    When the portal answers on its own address, every link we mail out has to carry that
    address: the site's canonical host is the internal one, and `get_url` knows nothing else.
    """
    from nexgen_msp.utils.gatekeeper import portal_origin

    origin = portal_origin()

    return f"{origin}/msp{path}" if origin else frappe.utils.get_url(f"/msp{path}")


def on_portal_host(link):
    """Move a link Frappe built onto the portal address, when there is one."""
    from nexgen_msp.utils.gatekeeper import portal_origin

    origin = portal_origin()

    if not origin or not link:
        return link

    parsed = urlparse(link)

    return f"{origin}{parsed.path}" + (f"?{parsed.query}" if parsed.query else "")
