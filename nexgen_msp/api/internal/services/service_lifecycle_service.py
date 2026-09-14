"""What may happen to a service, from the day it is opened to the day it stops.

A service assignment is a real period of provision to a real target: a person or a machine,
never both, and never the person who happens to hold the machine today. Every act here
writes a period rather than editing one, because a period that has been provided has often
already been billed, and a bill is not rewritten by changing a record behind it.

Opening a service validates the service and its target. Contract coverage, pricing and past
invoices are billing information: they are recorded or surfaced as warnings, but never stop
the operational record from matching what happened in reality.
"""

import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.api.internal.services.request_service import RequestService
from nexgen_msp.api.internal.services.user_service import UserService
from nexgen_msp.utils import remarks as remarks_util
from nexgen_msp.utils import service_suspensions
from nexgen_msp.utils.assignments import OPEN_ASSIGNMENT_STATUSES
from nexgen_msp.utils.device_status import DEPLOYED_STATUSES
from nexgen_msp.utils.errors import NotFoundError, ValidationError

# where a service can actually be provided: the catalogue may allow either, a period never does
TARGET_SCOPES = ("User", "Device")

TARGET_FIELD = {"User": "client_user", "Device": "managed_device"}

# a machine takes a new service while it is out in the field or on the shelf, and no later
ACTIVATABLE_DEVICE_STATUSES = DEPLOYED_STATUSES + ("Stock",)

# a person is given a new service while they are expected or already here
ACTIVATABLE_USER_LIFECYCLE = ("Pending", "Active")

ENDABLE_STATUSES = ("Active", "Suspended", "Pending Removal")

CHANGEABLE_STATUSES = ("Active", "Suspended")

class ServiceLifecycleService:
    # ------------------------------------------------------------------ the acts
    @staticmethod
    def activate(
        customer=None,
        service_item=None,
        target_scope=None,
        client_user=None,
        managed_device=None,
        effective_date=None,
        quantity=1,
        source_request=None,
        notes=None,
        agreed_rate=None,
        rate_override_reason=None,
        _commit=True,
    ):
        """Open a service for a target, from a stated day, and start billing it."""
        RequestService._guard_internal()

        return ServiceLifecycleService._open(
            "Active",
            customer=customer,
            service_item=service_item,
            target_scope=target_scope,
            client_user=client_user,
            managed_device=managed_device,
            effective_date=effective_date,
            quantity=quantity,
            source_request=source_request,
            notes=notes,
            agreed_rate=agreed_rate,
            rate_override_reason=rate_override_reason,
            _commit=_commit,
        )

    @staticmethod
    def create_pending(
        customer=None,
        service_item=None,
        target_scope=None,
        client_user=None,
        managed_device=None,
        effective_date=None,
        quantity=1,
        source_request=None,
        notes=None,
        agreed_rate=None,
        rate_override_reason=None,
    ):
        """Approve a service that is not provisioned yet: everything checked, nothing billed."""
        RequestService._guard_internal()

        return ServiceLifecycleService._open(
            "Pending Setup",
            customer=customer,
            service_item=service_item,
            target_scope=target_scope,
            client_user=client_user,
            managed_device=managed_device,
            effective_date=effective_date,
            quantity=quantity,
            source_request=source_request,
            notes=notes,
            agreed_rate=agreed_rate,
            rate_override_reason=rate_override_reason,
        )

    @staticmethod
    def activate_pending(assignment=None, effective_date=None, notes=None):
        """Put a prepared service into service, once it is really provisioned.

        The target and the rate are asked again: the record was written on an earlier day,
        and a person can have left or a machine been retired since.
        """
        RequestService._guard_internal()

        doc = ServiceLifecycleService._assignment(assignment)

        if doc.operational_status != "Pending Setup":
            raise ValidationError(
                f"This service is {doc.operational_status.lower()}, not waiting for setup.",
                "INVALID_TRANSITION",
            )

        on_date = ServiceLifecycleService._day(effective_date)

        target = ServiceLifecycleService._target(
            doc.customer, doc.assignment_scope, doc.client_user, doc.managed_device
        )
        ServiceLifecycleService._confirm_rate(doc, on_date)

        doc.effective_start_date = doc.effective_start_date or on_date
        doc.operational_status = "Active"

        ServiceLifecycleService._write(
            doc,
            "Activated",
            f"{ServiceLifecycleService._label(doc.service_item)} in service for {target.label} "
            f"on {frappe.utils.formatdate(doc.effective_start_date)}",
            notes,
        )

        return ServiceLifecycleService._outcome(doc)

    @staticmethod
    def suspend(
        assignment=None,
        effective_date=None,
        source_request=None,
        notes=None,
        confirm_billed=0,
        _commit=True,
    ):
        """Pause a running service from a stated day, and write the days down.

        The pause is the only record of what was not provided, so it is kept beside the
        period rather than replacing it.
        """
        RequestService._guard_internal()

        doc = ServiceLifecycleService._assignment(assignment)

        if doc.operational_status != "Active":
            raise ValidationError(
                f"This service is {doc.operational_status.lower()} and cannot be suspended.",
                "INVALID_TRANSITION",
            )

        on_date = ServiceLifecycleService._day(effective_date)
        ServiceLifecycleService._after_start(doc, on_date)
        notes = ServiceLifecycleService._after_invoices(doc, on_date, confirm_billed, notes)

        request = UserService._checked_request(source_request, doc.customer)

        doc.append(
            "suspension_log",
            {
                "suspended_on": on_date,
                "suspended_by": frappe.session.user,
                "source_request": request,
                "note": notes or None,
            },
        )
        doc.operational_status = "Suspended"

        ServiceLifecycleService._write(
            doc,
            "Suspended",
            f"Paused from {frappe.utils.formatdate(on_date)}"
            + (f" in reference to {request}" if request else ""),
            notes,
            commit=_commit,
        )

        return ServiceLifecycleService._outcome(doc)

    @staticmethod
    def resume(
        assignment=None,
        effective_date=None,
        source_request=None,
        notes=None,
        confirm_billed=0,
        _commit=True,
    ):
        """Start a paused service again, closing the pause on the day it becomes billable."""
        RequestService._guard_internal()

        doc = ServiceLifecycleService._assignment(assignment)

        if doc.operational_status != "Suspended":
            raise ValidationError(
                f"This service is {doc.operational_status.lower()} and is not suspended.",
                "INVALID_TRANSITION",
            )

        running = service_suspensions.open_row(doc)

        if not running:
            raise ValidationError(
                "This service carries no open suspension to resume.", "INVALID_TRANSITION"
            )

        on_date = ServiceLifecycleService._day(effective_date)
        suspended_on = frappe.utils.getdate(running.suspended_on)

        if on_date < suspended_on:
            raise ValidationError(
                f"The service was suspended on {frappe.utils.formatdate(suspended_on)}; "
                "it cannot resume before that day.",
                "VALIDATION_ERROR",
            )

        notes = ServiceLifecycleService._after_invoices(doc, on_date, confirm_billed, notes)

        request = UserService._checked_request(source_request, doc.customer)

        running.resumed_on = on_date
        running.resumed_by = frappe.session.user
        doc.operational_status = "Active"

        ServiceLifecycleService._write(
            doc,
            "Resumed",
            f"Billable again from {frappe.utils.formatdate(on_date)}"
            + (f" in reference to {request}" if request else ""),
            notes,
            commit=_commit,
        )

        return ServiceLifecycleService._outcome(doc)

    @staticmethod
    def schedule_removal(assignment=None, effective_date=None, notes=None):
        """Record that a running service is to be closed, while it is still being provided.

        Nothing about the billing changes: the service is still there until somebody stops
        it, and the day it is meant to stop is kept as a trace rather than as a field.
        """
        RequestService._guard_internal()

        doc = ServiceLifecycleService._assignment(assignment)

        if doc.operational_status != "Active":
            raise ValidationError(
                f"This service is {doc.operational_status.lower()} and no removal can be "
                "scheduled for it.",
                "INVALID_TRANSITION",
            )

        planned = ServiceLifecycleService._planned_day(doc, effective_date)
        doc.operational_status = "Pending Removal"

        ServiceLifecycleService._write(
            doc,
            "Removal scheduled",
            f"To be closed on {frappe.utils.formatdate(planned)}, still provided until then",
            notes,
        )

        return ServiceLifecycleService._outcome(doc)

    @staticmethod
    def cancel_removal(assignment=None, notes=None):
        """Call off a scheduled removal: the service goes on as before."""
        RequestService._guard_internal()

        doc = ServiceLifecycleService._assignment(assignment)

        if doc.operational_status != "Pending Removal":
            raise ValidationError(
                f"This service is {doc.operational_status.lower()}; no removal is scheduled.",
                "INVALID_TRANSITION",
            )

        doc.operational_status = "Active"

        ServiceLifecycleService._write(
            doc, "Removal cancelled", "The scheduled removal was called off", notes
        )

        return ServiceLifecycleService._outcome(doc)

    @staticmethod
    def end(assignment=None, effective_date=None, source_request=None, notes=None, _commit=True):
        """Close a service for good, on the day it really stopped.

        A service closed while it was suspended keeps that suspension open: Billing clips it
        to the end date, and inventing a resume day would invent billable days with it.
        """
        RequestService._guard_internal()

        doc = ServiceLifecycleService._assignment(assignment)

        if doc.operational_status not in ENDABLE_STATUSES:
            raise ValidationError(
                f"This service is {doc.operational_status.lower()} and cannot be closed.",
                "INVALID_TRANSITION",
            )

        end_on = UserService._end_date_for(doc, effective_date)
        request = UserService._checked_request(source_request, doc.customer)

        doc.effective_end_date = end_on
        doc.operational_status = "Ended"

        ServiceLifecycleService._write(
            doc,
            "Closed",
            f"Stopped on {frappe.utils.formatdate(end_on)}"
            + (f" in reference to {request}" if request else ""),
            notes,
            commit=_commit,
        )

        return ServiceLifecycleService._outcome(doc)

    @staticmethod
    def cancel(assignment=None, notes=None):
        """Drop a prepared service that was never provided. Nothing was ever billable."""
        RequestService._guard_internal()

        doc = ServiceLifecycleService._assignment(assignment)

        if doc.operational_status != "Pending Setup":
            raise ValidationError(
                f"This service is {doc.operational_status.lower()}; only a service waiting "
                "for setup can be cancelled.",
                "INVALID_TRANSITION",
            )

        doc.operational_status = "Cancelled"

        ServiceLifecycleService._write(doc, "Cancelled", "Dropped before it was ever provided", notes)

        return ServiceLifecycleService._outcome(doc)

    @staticmethod
    def change(
        assignment=None,
        effective_date=None,
        quantity=None,
        service_item=None,
        notes=None,
        source_request=None,
        _commit=True,
    ):
        """Move a service onto new terms from a stated day, without touching the old period.

        The running period is closed the day before and a replacement opens on the day, so
        each invoice keeps reading the terms that were really in force over its days.
        """
        RequestService._guard_internal()

        doc = ServiceLifecycleService._assignment(assignment)

        if doc.operational_status not in CHANGEABLE_STATUSES:
            raise ValidationError(
                f"This service is {doc.operational_status.lower()} and has no running period "
                "to change.",
                "INVALID_TRANSITION",
            )

        on_date = ServiceLifecycleService._day(effective_date)

        wanted_item = service_item or doc.service_item
        wanted_quantity = doc.quantity if quantity is None else frappe.utils.flt(quantity)

        if wanted_item == doc.service_item and wanted_quantity == frappe.utils.flt(doc.quantity):
            raise ValidationError(
                "Nothing about this service would change.", "VALIDATION_ERROR"
            )

        if doc.effective_start_date and on_date <= frappe.utils.getdate(doc.effective_start_date):
            raise ValidationError(
                f"This service started on {frappe.utils.formatdate(doc.effective_start_date)}; "
                "a change takes effect after the day it began.",
                "VALIDATION_ERROR",
            )

        savepoint = "service_assignment_change"
        frappe.db.savepoint(savepoint)
        try:
            ServiceLifecycleService.end(
                assignment=doc.name,
                effective_date=frappe.utils.add_days(on_date, -1),
                source_request=source_request,
                notes=notes,
                _commit=False,
            )

            outcome = ServiceLifecycleService.activate(
                customer=doc.customer,
                service_item=wanted_item,
                target_scope=doc.assignment_scope,
                client_user=doc.client_user,
                managed_device=doc.managed_device,
                effective_date=on_date,
                quantity=wanted_quantity,
                source_request=source_request or doc.source_request,
                notes=notes,
                _commit=False,
            )
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise

        if _commit:
            frappe.db.commit()

        outcome["replaced"] = doc.name

        return outcome

    # --------------------------------------------------------------- what they share
    @staticmethod
    def _open(
        status,
        customer=None,
        service_item=None,
        target_scope=None,
        client_user=None,
        managed_device=None,
        effective_date=None,
        quantity=1,
        source_request=None,
        notes=None,
        agreed_rate=None,
        rate_override_reason=None,
        _commit=True,
    ):
        """Validate the operational facts and record the new service period."""
        if not customer:
            raise ValidationError("customer is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        item = ServiceLifecycleService._service(service_item)
        scope = ServiceLifecycleService._scope(item, target_scope)
        target = ServiceLifecycleService._target(customer, scope, client_user, managed_device)
        on_date = ServiceLifecycleService._day(effective_date)
        wanted = ServiceLifecycleService._quantity(quantity)

        contract = ServiceLifecycleService._contract(customer, item.name, on_date)
        pricing = ServiceLifecycleService._rate(
            customer, item.name, on_date, agreed_rate, rate_override_reason
        )

        # The duplicate check and insert must be one serial operation. Without this lock,
        # two technicians can both observe no open assignment and create the same service
        # for the same target. Locking the owning target also works before the first
        # assignment row exists, when there is nothing in the assignment table to lock.
        ServiceLifecycleService._lock_target(scope, target.name)
        running = ServiceLifecycleService._open_assignment(customer, item.name, scope, target.name)

        if running:
            raise ValidationError(
                f"{target.label} already holds an open {item.name} assignment ({running}).",
                "VALIDATION_ERROR",
            )

        doc = frappe.get_doc(
            {
                "doctype": "MSP Service Assignment",
                "customer": customer,
                "service_item": item.name,
                "assignment_scope": scope,
                "client_user": target.name if scope == "User" else None,
                "managed_device": target.name if scope == "Device" else None,
                "quantity": wanted,
                "uom": item.stock_uom or "Unit",
                "operational_status": status,
                "effective_start_date": on_date
                if status == "Active"
                else (frappe.utils.getdate(effective_date) if effective_date else None),
                "source_request": UserService._checked_request(source_request, customer),
                "internal_notes": notes or None,
                **pricing,
            }
        )

        line = (
            f"{ServiceLifecycleService._label(item.name)} for {target.label}"
            f" from {frappe.utils.formatdate(on_date)}"
            + (f" under {contract}" if contract else "")
        )

        ServiceLifecycleService._write(
            doc, "Opened" if status == "Active" else "Prepared", line, notes, commit=_commit
        )

        return ServiceLifecycleService._outcome(doc)

    @staticmethod
    def _lock_target(scope, target):
        doctype = "MSP Client User" if scope == "User" else "MSP Managed Device"
        frappe.db.sql(f"select name from `tab{doctype}` where name = %s for update", target)

    @staticmethod
    def _assignment(assignment):
        if not assignment:
            raise ValidationError("assignment is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Service Assignment", assignment):
            raise NotFoundError(f"Service Assignment {assignment} not found.", "NOT_FOUND")

        return frappe.get_doc("MSP Service Assignment", assignment)

    @staticmethod
    def _day(effective_date):
        """The day it happened. Tomorrow has not happened yet."""
        on_date = frappe.utils.getdate(effective_date or frappe.utils.today())

        if on_date > frappe.utils.getdate(frappe.utils.today()):
            raise ValidationError(
                "A service cannot change on a future date.", "VALIDATION_ERROR"
            )

        return on_date

    @staticmethod
    def _planned_day(doc, effective_date):
        """The day something is meant to happen, which may well be ahead of us."""
        planned = frappe.utils.getdate(effective_date or frappe.utils.today())

        if doc.effective_start_date and planned < frappe.utils.getdate(doc.effective_start_date):
            raise ValidationError(
                f"This service started on {frappe.utils.formatdate(doc.effective_start_date)}; "
                "it cannot be removed before it began.",
                "VALIDATION_ERROR",
            )

        return planned

    @staticmethod
    def _quantity(quantity):
        wanted = frappe.utils.flt(1 if quantity is None else quantity)

        if wanted <= 0:
            raise ValidationError("Quantity must be greater than zero.", "VALIDATION_ERROR")

        return wanted

    @staticmethod
    def _service(service_item):
        """A catalogue entry a new service may be sold from."""
        if not service_item:
            raise ValidationError("service_item is required.", "VALIDATION_ERROR")

        item = frappe.db.get_value(
            "Item",
            service_item,
            ["name", "item_name", "disabled", "is_stock_item", "msp_service_scope", "stock_uom"],
            as_dict=True,
        )

        if not item:
            raise NotFoundError(f"Service {service_item} not found.", "NOT_FOUND")

        if item.disabled:
            raise ValidationError(
                f"{item.item_name or item.name} has been retired from the catalogue and cannot "
                "be sold.",
                "VALIDATION_ERROR",
            )

        if item.is_stock_item:
            raise ValidationError(
                f"{item.item_name or item.name} is stock, not a service.", "VALIDATION_ERROR"
            )

        # a service that does not say where it is sold is sold to both
        item.msp_service_scope = item.msp_service_scope or "Both"

        if item.msp_service_scope not in TARGET_SCOPES + ("Both",):
            raise ValidationError(
                f"{item.item_name or item.name} does not say where it may be sold. Set its "
                "scope in the catalogue before opening it for anybody.",
                "VALIDATION_ERROR",
            )

        return item

    @staticmethod
    def _scope(item, target_scope):
        """Where this period is really provided, which the catalogue has to allow."""
        scope = target_scope or (
            item.msp_service_scope if item.msp_service_scope in TARGET_SCOPES else None
        )

        if not scope:
            raise ValidationError(
                f"{item.item_name or item.name} can be sold to a user or to a device; say "
                "which one.",
                "VALIDATION_ERROR",
            )

        if scope not in TARGET_SCOPES:
            raise ValidationError(
                f"'{scope}' is not a target a service can be provided to.", "VALIDATION_ERROR"
            )

        if item.msp_service_scope != "Both" and item.msp_service_scope != scope:
            raise ValidationError(
                f"{item.name} is a {item.msp_service_scope} service and cannot be assigned at "
                f"{scope} scope.",
                "VALIDATION_ERROR",
            )

        return scope

    @staticmethod
    def _target(customer, scope, client_user, managed_device):
        """The person or the machine the service is for: theirs, and able to take it."""
        if scope == "User":
            if managed_device:
                raise ValidationError(
                    "A user service carries no device.", "VALIDATION_ERROR"
                )

            if not client_user:
                raise ValidationError(
                    "client_user is required for a user service.", "VALIDATION_ERROR"
                )

            person = frappe.db.get_value(
                "MSP Client User",
                client_user,
                ["name", "customer", "lifecycle_status", "full_name"],
                as_dict=True,
            )

            if not person:
                raise NotFoundError(f"Client User {client_user} not found.", "NOT_FOUND")

            if person.customer != customer:
                raise ValidationError(
                    f"{client_user} belongs to {person.customer}, not {customer}.",
                    "VALIDATION_ERROR",
                )

            if person.lifecycle_status not in ACTIVATABLE_USER_LIFECYCLE:
                raise ValidationError(
                    f"{person.full_name or client_user} is {person.lifecycle_status.lower()} "
                    "and cannot be given a new service.",
                    "VALIDATION_ERROR",
                )

            person.label = person.full_name or person.name

            return person

        if client_user:
            raise ValidationError("A device service carries no user.", "VALIDATION_ERROR")

        if not managed_device:
            raise ValidationError(
                "managed_device is required for a device service.", "VALIDATION_ERROR"
            )

        device = frappe.db.get_value(
            "MSP Managed Device",
            managed_device,
            ["name", "customer", "status", "hostname"],
            as_dict=True,
        )

        if not device:
            raise NotFoundError(f"Managed Device {managed_device} not found.", "NOT_FOUND")

        if device.customer != customer:
            raise ValidationError(
                f"{managed_device} belongs to {device.customer}, not {customer}.",
                "VALIDATION_ERROR",
            )

        if device.status not in ACTIVATABLE_DEVICE_STATUSES:
            raise ValidationError(
                f"{device.hostname or managed_device} is {device.status.lower()} and cannot "
                "take a new service.",
                "VALIDATION_ERROR",
            )

        device.label = device.hostname or device.name

        return device

    @staticmethod
    def _contract(customer, service_item, on_date=None):
        """The active contract covering this service on that day, when one exists.

        Coverage informs billing but never decides whether an operational service period may
        be recorded. ``None`` therefore means "review billing", not "refuse the action".
        """
        on_date = frappe.utils.getdate(on_date or frappe.utils.today())

        rows = frappe.db.sql(
            """
            select c.name, c.title, c.status, c.start_date, c.end_date
            from `tabMSP Contract` c
            join `tabMSP Contract Service` cs on cs.parent = c.name
            where c.customer = %(customer)s and cs.service_item = %(item)s
            order by c.start_date desc
            """,
            {"customer": customer, "item": service_item},
            as_dict=True,
        )

        def holds(row):
            return frappe.utils.getdate(row.start_date) <= on_date and (
                not row.end_date or frappe.utils.getdate(row.end_date) >= on_date
            )

        live = next((row for row in rows if row.status == "Active" and holds(row)), None)

        if live:
            return live.title or live.name

        legacy = ServiceLifecycleService._profile_offer(customer, service_item)

        if legacy:
            return legacy

        return None

    @staticmethod
    def _profile_offer(customer, service_item):
        """What a customer older than contracts is offered, read off their profile."""
        profile = frappe.db.get_value(
            "MSP Customer Profile",
            {"customer": customer},
            ["name", "contract_status"],
            as_dict=True,
        )

        if not profile or profile.contract_status != "Active":
            return None

        eligible = frappe.db.exists(
            "MSP Service Eligibility",
            {
                "parenttype": "MSP Customer Profile",
                "parent": profile.name,
                "service_item": service_item,
                "is_eligible": 1,
            },
        )

        return profile.name if eligible else None

    @staticmethod
    def _rate(customer, service_item, on_date, agreed_rate=None, rate_override_reason=None):
        """What this service is sold at, and where that number comes from.

        A rate the customer negotiated wins, then the rate in force on the contract's price
        list, then a price written for this customer alone. An administrator may override all
        three, but only out loud: the reason is stored with the number, because it is the one
        rate Billing takes literally.
        """
        if agreed_rate not in (None, ""):
            rate = frappe.utils.flt(agreed_rate)

            if rate < 0:
                raise ValidationError("Agreed Rate cannot be negative.", "VALIDATION_ERROR")

            if not (rate_override_reason or "").strip():
                raise ValidationError(
                    "A manual rate needs a reason on file.", "VALIDATION_ERROR"
                )

            return {
                "price_source": "Manual Override",
                "agreed_rate": rate,
                "rate_override_reason": rate_override_reason.strip(),
            }

        if ServiceLifecycleService._negotiated_rate(customer, service_item, on_date):
            return {"price_source": "Contract"}

        price = ContractService.current_rate(customer, service_item, on_date)

        if price and frappe.utils.flt(price.price_list_rate):
            return {"price_source": "Contract"}

        if ServiceLifecycleService._customer_price(customer, service_item, on_date):
            return {"price_source": "Item Price"}

        # Operations must reflect reality even before the commercial setup is complete.
        # Billing will flag this assignment as missing a rate when somebody prepares a run.
        return {"price_source": "Unpriced"}

    @staticmethod
    def _negotiated_rate(customer, service_item, on_date):
        """A rate written into the customer's own eligibility grid, if there is one."""
        rows = frappe.db.sql(
            """
            select se.negotiated_rate
            from `tabMSP Service Eligibility` se
            join `tabMSP Customer Profile` profile on profile.name = se.parent
            where profile.customer = %(customer)s
              and se.parenttype = 'MSP Customer Profile'
              and se.service_item = %(item)s
              and se.is_eligible = 1
              and ifnull(se.negotiated_rate, 0) > 0
              and (se.valid_from is null or se.valid_from <= %(on_date)s)
              and (se.valid_upto is null or se.valid_upto >= %(on_date)s)
            """,
            {"customer": customer, "item": service_item, "on_date": on_date},
            pluck=True,
        )

        return frappe.utils.flt(rows[0]) if rows else None

    @staticmethod
    def _customer_price(customer, service_item, on_date):
        """A selling price written for this customer and still in force on the day."""
        rows = frappe.db.sql(
            """
            select price.price_list_rate
            from `tabItem Price` price
            where price.item_code = %(item)s
              and price.customer = %(customer)s
              and price.selling = 1
              and ifnull(price.price_list_rate, 0) > 0
              and (price.valid_from is null or price.valid_from <= %(on_date)s)
              and (price.valid_upto is null or price.valid_upto >= %(on_date)s)
            order by price.valid_from desc
            limit 1
            """,
            {"customer": customer, "item": service_item, "on_date": on_date},
            pluck=True,
        )

        return frappe.utils.flt(rows[0]) if rows else None

    @staticmethod
    def _confirm_rate(doc, on_date):
        """A prepared service still has to be sellable on the day it really starts."""
        if doc.price_source == "Manual Override":
            if doc.agreed_rate is None or not (doc.rate_override_reason or "").strip():
                raise ValidationError(
                    "This service carries a manual rate without a number or a reason.",
                    "VALIDATION_ERROR",
                )

            return

        ServiceLifecycleService._rate(doc.customer, doc.service_item, on_date)

    @staticmethod
    def _open_assignment(customer, service_item, scope, target):
        """The open period this exact service already has on this exact target, if any.

        The target is the whole question: the same service runs on two machines of the same
        person at once, and a device service never answers for the person holding the device.
        """
        filters = {
            "customer": customer,
            "service_item": service_item,
            "assignment_scope": scope,
            TARGET_FIELD[scope]: target,
            "operational_status": ("in", OPEN_ASSIGNMENT_STATUSES),
        }

        found = frappe.get_all("MSP Service Assignment", filters=filters, pluck="name", limit=1)

        return found[0] if found else None

    @staticmethod
    def _after_start(doc, on_date):
        if doc.effective_start_date and on_date < frappe.utils.getdate(doc.effective_start_date):
            raise ValidationError(
                f"This service started on {frappe.utils.formatdate(doc.effective_start_date)}; "
                "nothing can be dated before that day.",
                "VALIDATION_ERROR",
            )

    @staticmethod
    def _after_invoices(doc, on_date, confirm_billed=0, notes=None):
        """Record that an act crossed an invoice boundary without stopping the act.

        ``confirm_billed`` remains accepted for older API callers but is deliberately ignored:
        an issued invoice is never rewritten, and an operational change is never refused.
        """
        billed_to = UserService._billed_to(doc.name)

        if not billed_to or on_date > frappe.utils.getdate(billed_to):
            return notes

        remark = f"Recorded behind an invoice covering up to {frappe.utils.formatdate(billed_to)}."

        return f"{notes} — {remark}" if notes else remark

    @staticmethod
    def _label(service_item):
        return frappe.db.get_value("Item", service_item, "item_name") or service_item

    @staticmethod
    def _write(doc, action, line, note, *, commit=True):
        """Save the act, and leave it readable where people actually look.

        The note goes to the person or the machine, never over the assignment's own note:
        what was written when the service was opened stays what it was.
        """
        doc.flags.via_service_lifecycle = True
        doc.save(ignore_permissions=True)
        doc.add_comment("Comment", f"{action} by {frappe.session.user} — {line}.")
        remarks_util.on_assignment(doc, action, note)
        if commit:
            frappe.db.commit()

    @staticmethod
    def _outcome(doc):
        return {
            "name": doc.name,
            "customer": doc.customer,
            "service_item": doc.service_item,
            "assignment_scope": doc.assignment_scope,
            "client_user": doc.client_user,
            "managed_device": doc.managed_device,
            "operational_status": doc.operational_status,
            "billing_status": doc.billing_status,
            "quantity": doc.quantity,
            "effective_start_date": doc.effective_start_date,
            "effective_end_date": doc.effective_end_date,
        }
