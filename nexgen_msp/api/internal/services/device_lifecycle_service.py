"""What may happen to a machine, and what each of those things does to it.

The customer owns the machine; a person only holds it for a while. Every act here is
written as a spell in the holder history, and the status follows from it: a machine is
Active because somebody has it, not the other way round.
"""

import frappe

from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.utils import device_holders as holders
from nexgen_msp.utils import remarks as remarks_util
from nexgen_msp.utils.assignments import OPEN_ASSIGNMENT_STATUSES
from nexgen_msp.utils.device_status import (
    AVAILABLE_STATUSES,
    DEPLOYED_STATUSES,
    REINSTATABLE_FROM,
    RETIRABLE_FROM,
    TERMINAL_STATUSES,
)
from nexgen_msp.utils.errors import NotFoundError, ValidationError


class DeviceLifecycleService:
    # ------------------------------------------------------------------ the acts
    @staticmethod
    def assign(device=None, client_user=None, effective_date=None, note=None, _commit=True):
        """Give a machine on the shelf to somebody, from a stated day.

        Somebody who had it before may have it again: that is a new spell, not a mistake.
        """
        RequestService._guard_internal()

        doc = DeviceLifecycleService._device(device)
        on_date = DeviceLifecycleService._day(effective_date)
        current = holders._open_row(doc)

        if current and current.client_user == client_user:
            raise ValidationError(
                f"{current.full_name or current.client_user} already holds {doc.hostname}.",
                "VALIDATION_ERROR",
            )

        if current:
            raise ValidationError(
                f"{doc.hostname} is already held by {current.full_name or current.client_user}; "
                "use Transfer instead of Assign.",
                "INVALID_TRANSITION",
            )

        if doc.status not in AVAILABLE_STATUSES:
            raise ValidationError(
                f"{doc.hostname} is {doc.status.lower()} and cannot be given to anybody.",
                "INVALID_TRANSITION",
            )

        holder = DeviceLifecycleService._holder(doc, client_user)
        DeviceLifecycleService._after_history(doc, on_date)

        holders.hand_over(doc, client_user, on_date, note=note)
        doc.status = "Active"
        DeviceLifecycleService._first_day_in_service(doc, on_date)

        DeviceLifecycleService._write(
            doc,
            "Assigned",
            f"Given to {holder.full_name or client_user} on {frappe.utils.formatdate(on_date)}",
            note,
            commit=_commit,
        )

        return DeviceLifecycleService._outcome(doc)

    @staticmethod
    def transfer(device=None, client_user=None, effective_date=None, note=None, _commit=True):
        """Pass a machine from the person who has it to somebody else, the same day.

        What the machine is billed for stays with the machine: a service follows the box,
        not the hands it is in.
        """
        RequestService._guard_internal()

        doc = DeviceLifecycleService._device(device)
        on_date = DeviceLifecycleService._day(effective_date)
        current = holders._open_row(doc)

        if not current:
            raise ValidationError(
                f"Nobody holds {doc.hostname}; assign it instead of transferring it.",
                "INVALID_TRANSITION",
            )

        if current.client_user == client_user:
            raise ValidationError(
                f"{current.full_name or current.client_user} already holds {doc.hostname}.",
                "VALIDATION_ERROR",
            )

        holder = DeviceLifecycleService._holder(doc, client_user)
        DeviceLifecycleService._after_history(doc, on_date)

        holders.hand_over(doc, client_user, on_date, note=note)
        doc.status = "Active"
        DeviceLifecycleService._first_day_in_service(doc, on_date)

        DeviceLifecycleService._write(
            doc,
            "Transferred",
            f"Passed from {current.full_name or current.client_user} to "
            f"{holder.full_name or client_user} on {frappe.utils.formatdate(on_date)}",
            note,
            commit=_commit,
        )

        return DeviceLifecycleService._outcome(doc)

    @staticmethod
    def repossess(device=None, effective_date=None, note=None):
        """Take a machine back onto the shelf.

        Nothing it is billed for is closed: it goes back out to the next person with its
        services intact, which is the whole point of taking it back rather than retiring it.
        """
        RequestService._guard_internal()

        doc = DeviceLifecycleService._device(device)
        on_date = DeviceLifecycleService._day(effective_date)
        current = holders._open_row(doc)

        if not current:
            raise ValidationError(f"Nobody holds {doc.hostname}.", "INVALID_TRANSITION")

        DeviceLifecycleService._after_history(doc, on_date)

        holders.hand_over(doc, None, on_date, note=note)
        doc.status = "Stock"

        DeviceLifecycleService._write(
            doc,
            "Returned to stock",
            f"Taken back from {current.full_name or current.client_user} on "
            f"{frappe.utils.formatdate(on_date)}",
            note,
        )

        return DeviceLifecycleService._outcome(doc)

    @staticmethod
    def retire(device=None, effective_date=None, note=None, end_services=0):
        """Take a machine out of service, optionally ending its open services."""
        RequestService._guard_internal()

        doc = DeviceLifecycleService._device(device)
        on_date = DeviceLifecycleService._day(effective_date)

        if doc.status in TERMINAL_STATUSES:
            raise ValidationError(f"{doc.hostname} is already retired.", "INVALID_TRANSITION")

        if doc.status not in RETIRABLE_FROM:
            raise ValidationError(
                f"{doc.hostname} is {doc.status.lower()} and cannot be retired.",
                "INVALID_TRANSITION",
            )

        current = holders._open_row(doc)

        if current:
            DeviceLifecycleService._after_history(doc, on_date)

        closed = (
            DeviceLifecycleService._end_device_services(doc, on_date)
            if frappe.utils.cint(end_services)
            else []
        )

        # Ending a service can append a remark to the device and therefore update its
        # modification timestamp. Reload before writing the retirement itself while
        # keeping every remark and holder row produced in the same transaction.
        if closed:
            doc.reload()

        if current:
            holders.hand_over(doc, None, on_date, note=note)

        doc.status = "Retired"
        doc.retired_date = on_date

        DeviceLifecycleService._write(
            doc, "Retired", f"Out of service on {frappe.utils.formatdate(on_date)}", note
        )

        outcome = DeviceLifecycleService._outcome(doc)
        outcome["closed_assignments"] = closed

        return outcome

    @staticmethod
    def reinstate(device=None, effective_date=None, client_user=None, note=None):
        """Bring a machine back into service, onto the shelf or straight into somebody's hands.

        Services are left exactly as retirement recorded them. Nothing is restarted here.
        """
        RequestService._guard_internal()

        doc = DeviceLifecycleService._device(device)
        on_date = DeviceLifecycleService._day(effective_date)

        if doc.status in DEPLOYED_STATUSES + AVAILABLE_STATUSES:
            raise ValidationError(
                f"{doc.hostname} is {doc.status.lower()} and is already in service.",
                "INVALID_TRANSITION",
            )

        if doc.status not in REINSTATABLE_FROM:
            raise ValidationError(
                f"{doc.hostname} is {doc.status.lower()} and cannot be reinstated.",
                "INVALID_TRANSITION",
            )

        holder = None

        if client_user:
            holder = DeviceLifecycleService._holder(doc, client_user)
            DeviceLifecycleService._after_history(doc, on_date)
            holders.hand_over(doc, client_user, on_date, note=note)
            doc.status = "Active"
            DeviceLifecycleService._first_day_in_service(doc, on_date)
        else:
            doc.status = "Stock"

        doc.retired_date = None

        line = (
            f"Back in service with {holder.full_name or client_user}"
            if holder
            else "Back in service, on the shelf"
        )
        DeviceLifecycleService._write(
            doc, "Reinstated", f"{line} on {frappe.utils.formatdate(on_date)}", note
        )

        return DeviceLifecycleService._outcome(doc)

    # --------------------------------------------------------------- what they share
    @staticmethod
    def _device(device):
        if not device:
            raise ValidationError("device is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Managed Device", device):
            raise NotFoundError(f"Managed Device {device} not found.", "NOT_FOUND")

        return frappe.get_doc("MSP Managed Device", device)

    @staticmethod
    def _day(effective_date):
        """The day it happened. Tomorrow has not happened yet."""
        on_date = frappe.utils.getdate(effective_date or frappe.utils.today())

        if on_date > frappe.utils.getdate(frappe.utils.today()):
            raise ValidationError(
                "A device cannot change hands on a future date.", "VALIDATION_ERROR"
            )

        return on_date

    @staticmethod
    def _holder(doc, client_user):
        """The person a machine may be given to: theirs to hold, and still here to hold it."""
        if not client_user:
            raise ValidationError("client_user is required.", "VALIDATION_ERROR")

        person = frappe.db.get_value(
            "MSP Client User",
            client_user,
            ["customer", "lifecycle_status", "full_name"],
            as_dict=True,
        )

        if not person:
            raise NotFoundError(f"Client User {client_user} not found.", "NOT_FOUND")

        if person.customer != doc.customer:
            raise ValidationError(
                f"{client_user} belongs to {person.customer}, not {doc.customer}.",
                "VALIDATION_ERROR",
            )

        if person.lifecycle_status not in holders.HOLDABLE_LIFECYCLE:
            raise ValidationError(
                f"{person.full_name or client_user} is {person.lifecycle_status.lower()} and "
                "cannot be given a device.",
                "VALIDATION_ERROR",
            )

        return person

    @staticmethod
    def _after_history(doc, on_date):
        """A machine cannot change hands before the last thing its history already says."""
        last = holders.last_transition(doc)

        if last and on_date < last:
            raise ValidationError(
                f"The holder history already reaches {frappe.utils.formatdate(last)}; "
                "nothing can be dated before that day.",
                "VALIDATION_ERROR",
            )

    @staticmethod
    def _first_day_in_service(doc, on_date):
        """The day the machine first went out to somebody, written once and never again.

        Since when the person who has it now has had it is in their own spell; this is
        about the machine.
        """
        if not doc.assigned_date:
            doc.assigned_date = on_date

    @staticmethod
    def _end_device_services(doc, on_date):
        """Stop what the machine itself is billed for, on the day it left service.

        The day is the one the rest of the app works out for ending a service, invoices
        and backdating included: a retirement is not a licence to rewrite a bill.
        """
        closed = []

        from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService

        for name in frappe.get_all(
            "MSP Service Assignment",
            filters={
                "assignment_scope": "Device",
                "managed_device": doc.name,
                "operational_status": ("in", OPEN_ASSIGNMENT_STATUSES),
            },
            pluck="name",
        ):
            ServiceLifecycleService.end(
                assignment=name,
                effective_date=on_date,
                notes=f"Ended automatically when {doc.hostname} was retired.",
                _commit=False,
            )
            closed.append(name)

        return closed

    @staticmethod
    def _write(doc, action, line, note, *, commit=True):
        remarks_util.add(doc, line + (f" — {note}" if (note or "").strip() else ""))
        doc.save()
        doc.add_comment("Comment", f"{action} by {frappe.session.user}.")
        if commit:
            frappe.db.commit()

    @staticmethod
    def _outcome(doc):
        return {
            "name": doc.name,
            "hostname": doc.hostname,
            "status": doc.status,
            "assigned_client_user": doc.assigned_client_user,
        }
