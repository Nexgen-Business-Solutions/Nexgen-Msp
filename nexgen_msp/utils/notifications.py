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
        "service requests to our team.</p>"
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
}


def ensure_templates():
    """Create or refresh every template this app sends, so a fresh site is never mute."""
    for name, spec in TEMPLATES.items():
        html = SHELL.format(
            app_name=APP_NAME,
            tagline=APP_TAGLINE,
            body=spec["body"],
            year="{{ year }}",
        )

        if frappe.db.exists("Email Template", name):
            doc = frappe.get_doc("Email Template", name)
        else:
            doc = frappe.new_doc("Email Template")
            doc.name = name

        doc.subject = spec["subject"]
        doc.use_html = 1
        doc.response_html = html
        doc.save(ignore_permissions=True)

    frappe.db.commit()


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


def send(name, recipients, context, reference_doctype=None, reference_name=None, now=False):
    """Queue a branded email. Never let a mail failure break the operation that triggered it."""
    recipients = [address for address in (recipients or []) if address]

    if not recipients:
        return False

    try:
        subject, message = render(name, context)
        frappe.sendmail(
            recipients=recipients,
            subject=subject,
            message=message,
            reference_doctype=reference_doctype,
            reference_name=reference_name,
            now=now,
        )
        return True
    except Exception:
        frappe.log_error(title=f"{name} could not be sent", message=frappe.get_traceback())
        return False


def summary_table(rows):
    return _card(rows)


def portal_url(path=""):
    return frappe.utils.get_url(f"/msp{path}")
