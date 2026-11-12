"""What a person or a machine already has, what it may be given, and what it may not.

The question a detail page asks is never merely "what is in the catalogue". It is what this
exact target already has and what can be recorded next. Only what the customer's contract
covers is offered; a covered service with no rate yet is shown with a warning beside it.
"""

import frappe

from nexgen_msp.api.internal.services.request_service import ADMIN_ROLES, RequestService
from nexgen_msp.api.internal.services.service_definition_service import (
    ServiceDefinitionService,
)
from nexgen_msp.api.internal.services.service_lifecycle_service import (
    ACTIVATABLE_DEVICE_STATUSES,
    ACTIVATABLE_USER_LIFECYCLE,
    TARGET_FIELD,
    ServiceLifecycleService,
)
from nexgen_msp.utils.assignments import OPEN_ASSIGNMENT_STATUSES
from nexgen_msp.utils.errors import NotFoundError, ValidationError

# what the catalogue allows to be sold at a given target scope. A company service stands
# alone: something the company itself holds is never also a person's or a machine's
SELLABLE_AT = {
    "User": ("User", "Both"),
    "Device": ("Device", "Both"),
    "Customer": ("Customer",),
}

# and what it plainly does not: a device service is not an option for a person
NEVER_AT = {
    "User": ("Device", "Customer"),
    "Device": ("User", "Customer"),
    "Customer": ("User", "Device", "Both"),
}

WRONG_SCOPE_REASON = {
    "User": "User only",
    "Device": "Device only",
    "Both": "User or Device only",
    "Customer": "Company only",
}


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

    @staticmethod
    def for_customer(customer=None):
        """What the company itself holds, and what it may be sold next.

        A retainer, a block of storage, a line: a service with no person and no machine
        behind it. The reading is the same one a person and a machine get — the target is
        simply the company, and the catalogue's half that needs a target is out of reach.
        """
        RequestService._guard_internal()

        return ServiceAvailabilityService.read_customer(customer)

    @staticmethod
    def read_customer(customer=None):
        """The company's own reading, for a caller that has established its right to it."""
        if not customer:
            raise ValidationError("customer is required.", "VALIDATION_ERROR")

        company = frappe.db.get_value(
            "Customer", customer, ["name", "customer_name", "disabled"], as_dict=True
        )

        if not company:
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        label = company.customer_name or company.name
        refusal = (
            f"{label} is disabled and cannot be sold a new service."
            if frappe.utils.cint(company.disabled)
            else None
        )

        return ServiceAvailabilityService._answer(
            customer=company.name,
            scope="Customer",
            target=company.name,
            label=label,
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
                    item, reason=WRONG_SCOPE_REASON[item.service_scope]
                )
                for item in ServiceAvailabilityService._catalogue(NEVER_AT[scope])
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
            warnings.append(
                "No valid customer service rate is available yet. Configure a rate before "
                "generating billable coverage for these services."
            )

        return " ".join(warnings) or None

    @staticmethod
    def _catalogue(scopes):
        """Every service the MSP catalogue still sells at these scopes."""
        return [
            frappe._dict(
                name=row["name"],
                item_name=row["item_name"],
                service_scope=row["service_scope"],
            )
            for row in ServiceDefinitionService.available_rows(scopes)
        ]

    @staticmethod
    def _current(customer, scope, target):
        """The periods open on this exact target: this customer, this scope, this one target."""
        filters = {
            "customer": customer,
            "assignment_scope": scope,
            "operational_status": ("in", OPEN_ASSIGNMENT_STATUSES),
        }

        # a company service has no target field to match on: the company is the target
        if scope in TARGET_FIELD:
            filters[TARGET_FIELD[scope]] = target

        rows = frappe.get_all(
            "MSP Service Assignment",
            filters=filters,
            fields=[
                "name",
                "service_item",
                "operational_status",
                "billing_status",
                "quantity",
                # what the quantity counts: a block of storage is not a month
                "uom",
                "effective_start_date",
            ],
            order_by="effective_start_date asc",
        )

        for row in rows:
            row["item_name"] = ServiceLifecycleService._label(row["service_item"])
            row["service_scope"] = ServiceDefinitionService.scope_of(row["service_item"])

        return rows

    @staticmethod
    def _entry(item, reason=None, warning=None):
        entry = {
            "service_item": item.name,
            "item_name": item.item_name or item.name,
            "service_scope": item.service_scope,
        }

        if reason:
            entry["reason"] = reason
        if warning:
            entry["warning"] = warning

        return entry
