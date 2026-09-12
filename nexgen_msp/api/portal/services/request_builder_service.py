"""What the customer needs to see in order to ask for something sensible.

The old form asked for a service, an action and a scope as three independent questions, and
let the customer put together combinations that could never be carried out. This reads the
real state instead and hands the screen what is actually true: what this person already has,
what they could be given, which machines they hold and what each of those runs — with the
acts that genuinely apply to each, named as the customer knows them.

None of the rules live here. Availability is Phase 2's, the acts a service can receive are
the request-intent rules', and this only arranges their answers for one screen.
"""

import frappe

from nexgen_msp.api.internal.services.service_availability_service import (
    ServiceAvailabilityService,
)
from nexgen_msp.utils import approval, request_intents
from nexgen_msp.utils.errors import NotFoundError, ValidationError

MAX_SEARCH_RESULTS = 25


class RequestBuilderService:
    # ------------------------------------------------------------------ who
    @staticmethod
    def search_users(customer=None, search=None, limit=None):
        """The people a request can be raised for, narrowed by what was typed.

        The form used to load every person of the company at once, which is fine until a
        customer has a few thousand of them.
        """
        from nexgen_msp.api.portal.services.portal_service import PortalService

        customer = PortalService._resolve_customer(customer)
        limit = min(frappe.utils.cint(limit) or MAX_SEARCH_RESULTS, MAX_SEARCH_RESULTS)

        conditions = ["cu.customer = %(customer)s", "cu.lifecycle_status in ('Pending', 'Active')"]
        values = {"customer": customer, "limit": limit}

        if search:
            conditions.append(
                "(cu.full_name like %(search)s or cu.email like %(search)s"
                " or cu.department like %(search)s)"
            )
            values["search"] = f"%{search}%"

        return frappe.db.sql(
            f"""
            select cu.name, cu.full_name, cu.email, cu.department, cu.lifecycle_status
            from `tabMSP Client User` cu
            where {" and ".join(conditions)}
            order by cu.full_name asc
            limit %(limit)s
            """,
            values,
            as_dict=True,
        )

    # ------------------------------------------------------------------ the subject
    @staticmethod
    def subject_context(client_user=None):
        """Everything one screen needs about one person, already decided.

        The frontend rebuilds nothing: what is current, what is available, and which act
        each of them can receive are all answered here.
        """
        from nexgen_msp.api.portal.services.portal_service import PortalService

        if not client_user:
            raise ValidationError("client_user is required.", "VALIDATION_ERROR")

        person = frappe.db.get_value(
            "MSP Client User",
            client_user,
            ["name", "customer", "full_name", "email", "department", "lifecycle_status"],
            as_dict=True,
        )

        if not person:
            raise NotFoundError(f"Client User {client_user} not found.", "NOT_FOUND")

        # the caller may only read their own company's people
        PortalService._resolve_customer(person.customer)

        personal = ServiceAvailabilityService.read_user(person.name)

        return {
            "user": person,
            "personal_services": {
                "current": [
                    RequestBuilderService._current_entry(row) for row in personal["current"]
                ],
                "available": [
                    RequestBuilderService._offer_entry(row) for row in personal["available"]
                ],
            },
            "target_reason": personal.get("target_reason"),
            "devices": RequestBuilderService._devices_of(person),
        }

    @staticmethod
    def _devices_of(person):
        """The machines this person holds today, each with what it runs and what it could.

        Only theirs: a colleague's machine and the ones sitting in stock are not the
        customer's to pick from, and handing one out is the technician's decision.
        """
        devices = frappe.get_all(
            "MSP Managed Device",
            filters={"customer": person.customer, "assigned_client_user": person.name},
            fields=["name", "hostname", "serial_number", "device_type", "status", "assigned_date"],
            order_by="hostname asc",
        )

        for device in devices:
            reading = ServiceAvailabilityService.read_device(device.name)
            device["services"] = {
                "current": [
                    RequestBuilderService._current_entry(row, device=device)
                    for row in reading["current"]
                ],
                "available": [
                    RequestBuilderService._offer_entry(row) for row in reading["available"]
                ],
            }
            device["target_reason"] = reading.get("target_reason")

        return devices

    # ------------------------------------------------------------------ new person
    @staticmethod
    def new_user_context(customer=None):
        """What can be asked for somebody who does not exist yet.

        Nothing is held, so everything the contract covers is on offer — for the person and
        for a machine a technician will identify later.
        """
        from nexgen_msp.api.internal.services.department_service import DepartmentService
        from nexgen_msp.api.portal.services.portal_service import PortalService

        customer = PortalService._resolve_customer(customer)

        return {
            "customer": customer,
            "departments": [
                {"value": row.department_name, "label": row.department_name}
                for row in DepartmentService.list_departments()
            ],
            "available_user_services": RequestBuilderService._offered(customer, "User"),
            "available_device_services": RequestBuilderService._offered(customer, "Device"),
        }

    @staticmethod
    def _offered(customer, scope):
        """Everything the contract lets this customer be sold at a given scope.

        Read against the customer rather than a target, because there is no target yet: a
        person who does not exist holds nothing, so nothing can be filtered out as already
        had.
        """
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )
        from nexgen_msp.utils.errors import NexgenError

        sellable = ("User", "Both") if scope == "User" else ("Device", "Both")
        offered = []

        for item in frappe.get_all(
            "Item",
            filters={"disabled": 0, "is_stock_item": 0, "msp_service_scope": ("in", sellable)},
            fields=["name", "item_name", "msp_service_scope"],
            order_by="item_name asc",
        ):
            try:
                ServiceLifecycleService._contract(customer, item.name)
                ServiceLifecycleService._rate(
                    customer, item.name, frappe.utils.getdate(frappe.utils.today())
                )
            except NexgenError:
                continue

            offered.append(
                {
                    "service_item": item.name,
                    "item_name": item.item_name or item.name,
                    "service_scope": item.msp_service_scope,
                    "allowed_request_actions": RequestBuilderService._actions_for(("Add",)),
                }
            )

        return offered

    # ------------------------------------------------------------------ what happens next
    @staticmethod
    def submission_context(customer=None):
        """Whether sending this reaches us straight away, or waits for the company's accord."""
        from nexgen_msp.api.portal.services.portal_service import PortalService

        customer = PortalService._resolve_customer(customer)
        rights = approval.rights_of(customer)
        has_approvers = approval.has_approvers(customer)
        decides_own = bool(rights.get("can_approve"))

        waits = has_approvers and not decides_own

        return {
            "customer": customer,
            "may_submit": rights.get("can_submit", True) if rights else True,
            "needs_customer_approval": waits,
            "message": (
                "This request will first wait for approval inside your company."
                if waits
                else "This request will be sent to Nexgen for review."
            ),
        }

    # ------------------------------------------------------------------ the pieces
    @staticmethod
    def _current_entry(row, device=None):
        """One service already running, with the acts it can still receive.

        A service somebody has already asked about offers nothing further: the answer to
        that request is what decides what happens to it next.
        """
        pending = request_intents.in_flight_requests_for(row["name"])

        return {
            "assignment": row["name"],
            "service_item": row["service_item"],
            "label": row.get("item_name") or row["service_item"],
            "status": row["operational_status"],
            "since": row.get("effective_start_date"),
            "quantity": row.get("quantity"),
            "managed_device": device["name"] if device else None,
            "hostname": device["hostname"] if device else None,
            "pending_request": pending[0] if pending else None,
            "allowed_request_actions": (
                []
                if pending
                else RequestBuilderService._actions_for(
                    request_intents.allowed_actions(row["operational_status"])
                )
            ),
        }

    @staticmethod
    def _offer_entry(row):
        return {
            "service_item": row["service_item"],
            "item_name": row.get("item_name") or row["service_item"],
            "service_scope": row.get("service_scope"),
            "allowed_request_actions": RequestBuilderService._actions_for(("Add",)),
        }

    @staticmethod
    def _actions_for(action_types):
        """The acts on offer, named the way the administrator chose to name them.

        The customer never handles an action type: they read "Temporarily suspend" and the
        record behind it says what that mechanically is.
        """
        if not action_types:
            return []

        return frappe.get_all(
            "MSP Request Action",
            filters={"enabled": 1, "action_type": ("in", list(action_types))},
            fields=["name", "title", "action_type", "description"],
            order_by="title asc",
        )
