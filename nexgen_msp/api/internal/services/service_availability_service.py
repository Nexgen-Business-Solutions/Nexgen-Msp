"""What a person or a machine already has, what it may be given, and what it may not.

The question a detail page asks is never merely "what is in the catalogue". It is what this
exact target already has and what can be recorded next. Only what the customer's contract
covers is offered; a covered service with no rate yet is shown with a warning beside it.
"""

import frappe

from nexgen_msp.api.internal.services.request_service import ADMIN_ROLES, RequestService
from nexgen_msp.api.internal.services.service_lifecycle_service import (
    ACTIVATABLE_DEVICE_STATUSES,
    ACTIVATABLE_USER_LIFECYCLE,
    TARGET_FIELD,
    ServiceLifecycleService,
)
from nexgen_msp.utils.assignments import OPEN_ASSIGNMENT_STATUSES
from nexgen_msp.utils.errors import NotFoundError, ValidationError

# what the catalogue allows to be sold at a given target scope
SELLABLE_AT = {"User": ("User", "Both"), "Device": ("Device", "Both")}

# and what it plainly does not: a device service is not an option for a person
NEVER_AT = {"User": "Device", "Device": "User"}

WRONG_SCOPE_REASON = {"User": "User only", "Device": "Device only"}


class ServiceAvailabilityService:
    # ------------------------------------------------------------------ the answers
    @staticmethod
    def for_user(client_user=None):
        """What this person holds, what they may be given, and what is out of reach."""
        RequestService._guard_internal()

        return ServiceAvailabilityService.read_user(client_user)

    @staticmethod
    def read_user(client_user=None):
        """The same reading, for a caller that has already established its own right to it.

        The portal asks this too, about its own people: it checks the customer rather than
        the workspace, and there is no reason for the rules themselves to exist twice.
        """
        if not client_user:
            raise ValidationError("client_user is required.", "VALIDATION_ERROR")

        person = frappe.db.get_value(
            "MSP Client User",
            client_user,
            ["name", "customer", "full_name", "lifecycle_status"],
            as_dict=True,
        )

        if not person:
            raise NotFoundError(f"Client User {client_user} not found.", "NOT_FOUND")

        refusal = (
            None
            if person.lifecycle_status in ACTIVATABLE_USER_LIFECYCLE
            else f"{person.full_name or person.name} is {person.lifecycle_status.lower()} "
            "and cannot be given a new service."
        )

        return ServiceAvailabilityService._answer(
            customer=person.customer,
            scope="User",
            target=person.name,
            label=person.full_name or person.name,
            refusal=refusal,
        )

    @staticmethod
    def for_device(managed_device=None):
        """The same reading for one machine, and for that machine alone."""
        RequestService._guard_internal()

        return ServiceAvailabilityService.read_device(managed_device)

    @staticmethod
    def read_device(managed_device=None):
        """The machine's own reading, for a caller that has established its right to it."""
        if not managed_device:
            raise ValidationError("managed_device is required.", "VALIDATION_ERROR")

        device = frappe.db.get_value(
            "MSP Managed Device",
            managed_device,
            ["name", "customer", "hostname", "status"],
            as_dict=True,
        )

        if not device:
            raise NotFoundError(f"Managed Device {managed_device} not found.", "NOT_FOUND")

        refusal = (
            None
            if device.status in ACTIVATABLE_DEVICE_STATUSES
            else f"{device.hostname or device.name} is {device.status.lower()} and cannot take "
            "a new service."
        )

        return ServiceAvailabilityService._answer(
            customer=device.customer,
            scope="Device",
            target=device.name,
            label=device.hostname or device.name,
            refusal=refusal,
        )

    # --------------------------------------------------------------- what they share
    @staticmethod
    def _answer(customer, scope, target, label, refusal):
        """Read the catalogue once, and sort it into what is had, offered and refused."""
        is_admin = bool(RequestService._roles().intersection(ADMIN_ROLES))
        on_date = frappe.utils.getdate(frappe.utils.today())

        current = ServiceAvailabilityService._current(customer, scope, target)
        available = []
        blocked = []

        for item in ServiceAvailabilityService._catalogue(SELLABLE_AT[scope]):
            if ServiceLifecycleService._open_assignment(customer, item.name, scope, target):
                # already had: neither an offer nor a refusal, it is simply in CURRENT
                continue

            # only what their contract covers is offered (Idriss, 2026-09-14)
            if not ServiceLifecycleService._contract(customer, item.name, on_date):
                if is_admin:
                    blocked.append(
                        ServiceAvailabilityService._entry(item, reason="Not in their contract")
                    )
                continue

            warning = ServiceAvailabilityService._commercial_warning(
                customer, item.name, on_date
            )

            if not refusal:
                available.append(ServiceAvailabilityService._entry(item, warning=warning))
            elif is_admin:
                blocked.append(ServiceAvailabilityService._entry(item, reason=refusal))

        if is_admin:
            # the catalogue's other half, named for what it is rather than left unexplained
            blocked += [
                ServiceAvailabilityService._entry(
                    item, reason=WRONG_SCOPE_REASON[NEVER_AT[scope]]
                )
                for item in ServiceAvailabilityService._catalogue((NEVER_AT[scope],))
            ]

        return {
            "target": {
                "scope": scope,
                "name": target,
                "label": label,
                "customer": customer,
            },
            "is_admin": is_admin,
            "target_reason": refusal,
            "current": current,
            "available": available,
            "blocked": blocked,
        }

    @staticmethod
    def _commercial_warning(customer, service_item, on_date):
        """Commercial gaps are visible context, never an operational refusal."""
        warnings = []

        if not ServiceLifecycleService._contract(customer, service_item, on_date):
            warnings.append("No active contract covers this service on the selected date.")

        pricing = ServiceLifecycleService._rate(customer, service_item, on_date)
        if pricing.get("price_source") == "Unpriced":
            warnings.append("No billing rate is on file yet.")

        return " ".join(warnings) or None

    @staticmethod
    def _catalogue(scopes):
        """Every service the catalogue still sells at these scopes."""
        items = frappe.get_all(
            "Item",
            filters={"disabled": 0, "is_stock_item": 0},
            fields=["name", "item_name", "msp_service_scope"],
            order_by="item_name asc",
        )

        # a service that does not say where it is sold is sold to both
        for item in items:
            item.msp_service_scope = item.msp_service_scope or "Both"

        return [item for item in items if item.msp_service_scope in scopes]

    @staticmethod
    def _current(customer, scope, target):
        """The periods open on this exact target: this customer, this scope, this one target."""
        rows = frappe.get_all(
            "MSP Service Assignment",
            filters={
                "customer": customer,
                "assignment_scope": scope,
                TARGET_FIELD[scope]: target,
                "operational_status": ("in", OPEN_ASSIGNMENT_STATUSES),
            },
            fields=[
                "name",
                "service_item",
                "operational_status",
                "billing_status",
                "quantity",
                "effective_start_date",
            ],
            order_by="effective_start_date asc",
        )

        for row in rows:
            row["item_name"] = ServiceLifecycleService._label(row["service_item"])
            row["service_scope"] = (
                frappe.db.get_value("Item", row["service_item"], "msp_service_scope") or "Both"
            )

        return rows

    @staticmethod
    def _entry(item, reason=None, warning=None):
        entry = {
            "service_item": item.name,
            "item_name": item.item_name or item.name,
            "service_scope": item.msp_service_scope,
        }

        if reason:
            entry["reason"] = reason
        if warning:
            entry["warning"] = warning

        return entry
