import frappe

from nexgen_msp.utils.errors import ValidationError

PRINT_FORMAT = "Nexgen MSP Invoice"

MISSING_RENDERER = (
    "No PDF renderer is available on this server, so the invoice cannot be produced yet. "
    "Install wkhtmltopdf and try again."
)


def _generator():
    """Chrome renders without a system package, but only Frappe 16 knows about it.

    On Frappe 15 the field does not exist and wkhtmltopdf is the only backend, so the
    call has to go out without a generator rather than with one Frappe cannot honour.
    """
    if not frappe.get_meta("Print Format").get_field("pdf_generator"):
        return None

    from frappe.utils.print_utils import find_or_download_chromium_executable

    try:
        if find_or_download_chromium_executable():
            return "chrome"
    except Exception:
        frappe.log_error("Chromium unavailable, falling back to wkhtmltopdf")

    return None


def render(invoice):
    """The printed invoice as PDF bytes, or a message naming what the server is missing."""
    # the caller has already established the invoice belongs to whoever is asking, so the
    # document is handed over ready-made rather than re-read under the portal's permissions
    doc = frappe.get_doc("Sales Invoice", invoice)

    kwargs = {
        "doc": doc,
        "print_format": PRINT_FORMAT,
        "as_pdf": True,
        "no_letterhead": 1,
    }

    generator = _generator()

    if generator:
        kwargs["pdf_generator"] = generator

    try:
        return frappe.get_print("Sales Invoice", invoice, **kwargs)
    except OSError as exception:
        raise ValidationError(MISSING_RENDERER, "VALIDATION_ERROR") from exception


def respond(invoice):
    """Hand the PDF to the browser as a download.

    "download" makes Frappe read the mime type off the file name and send it as an
    attachment, so the file lands in the user's downloads whatever the browser.
    """
    frappe.local.response.filename = f"{invoice}.pdf"
    frappe.local.response.filecontent = render(invoice)
    frappe.local.response.type = "download"
