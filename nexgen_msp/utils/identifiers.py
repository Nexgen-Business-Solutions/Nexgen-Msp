"""The two identifiers a closure is refused for, written the one way the records accept.

A serial number names one machine and a username one account at a customer; both rules
live on the records themselves. A write that goes around `save()` must still ask them, or
the next edit of that record is refused for something a form did months earlier.
"""

import frappe

from nexgen_msp.utils.errors import ValidationError


def record_serial(device, serial, overwrite=False):
    """Put a serial on a machine. Returns whether anything was written."""
    serial = (serial or "").strip()

    if not serial or not device:
        return False

    doc = frappe.get_doc("MSP Managed Device", device)

    # a value already on file was put there by someone who had the machine in their
    # hands, and is not overwritten from a form
    if (doc.serial_number or "").strip() and not overwrite:
        return False

    doc.serial_number = serial
    _ask(doc.validate_unique_serial)
    doc.db_set("serial_number", doc.serial_number)

    return True


def record_username(client_user, username, overwrite=False):
    """Put an account name on a person. Returns whether anything was written."""
    username = (username or "").strip()

    if not username or not client_user:
        return False

    doc = frappe.get_doc("MSP Client User", client_user)

    if (doc.username or "").strip() and not overwrite:
        return False

    doc.username = username
    _ask(doc.validate_unique_username)
    doc.db_set("username", doc.username)

    return True


def _ask(rule):
    try:
        rule()
    except frappe.ValidationError as exc:
        raise ValidationError(frappe.utils.strip_html(str(exc)), "VALIDATION_ERROR") from exc
