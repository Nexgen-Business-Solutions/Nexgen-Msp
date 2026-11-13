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
from nexgen_msp.api.internal.services.service_definition_service import (
    ServiceDefinitionService,
)
from nexgen_msp.utils import access, approval, operations, permissions, request_intents
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

        # our own team lists nobody until it has said which customer it acts for
        if not customer and permissions.is_internal():
            return []

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
    # ------------------------------------------------------------------ a group of people
    @staticmethod
    def department_selection(customer=None, department=None):
        """The people a Department would add, resolved now and never re-read later.

        The Department list is the site's own and global; who belongs to it is always read
        inside this one Customer. Whoever is disabled or archived is left out and counted, so
        the screen can say how many rather than silently shrink.
        """
        from nexgen_msp.api.portal.services.portal_service import PortalService

        customer = PortalService._resolve_customer(customer)
        department = (department or "").strip()

        if not department:
            raise ValidationError("Choose a Department.", "VALIDATION_ERROR")

        return RequestBuilderService._selection(
            customer,
            origin="Department",
            label=department,
            condition="cu.department like %(department)s",
            values={"department": f"%{department}%"},
        )

    @staticmethod
    def company_selection(customer=None):
        """Every active person this Customer has, resolved now, as a snapshot."""
        from nexgen_msp.api.portal.services.portal_service import PortalService

        customer = PortalService._resolve_customer(customer)

        return RequestBuilderService._selection(
            customer, origin="Company", label="Entire company", condition="1 = 1", values={}
        )

    @staticmethod
    def _selection(customer, origin, label, condition, values):
        """Who is added, who is left out, and what the screen says about both."""
        params = {"customer": customer, **values}
        rows = frappe.db.sql(
            f"""
            select cu.name, cu.full_name, cu.email, cu.department, cu.lifecycle_status
            from `tabMSP Client User` cu
            where cu.customer = %(customer)s and {condition}
            order by cu.full_name asc
            """,
            params,
            as_dict=True,
        )

        active = [row for row in rows if row.lifecycle_status in ("Pending", "Active")]
        excluded = [row for row in rows if row.lifecycle_status not in ("Pending", "Active")]
        departments = sorted({(row.department or "").strip() for row in active if row.department})

        return {
            "customer": customer,
            "selection_origin": origin,
            "selection_label": label,
            "selection_group_key": f"{origin.lower()}:{label}",
            "selection_snapshot_at": frappe.utils.now(),
            "active_count": len(active),
            "excluded_disabled_count": len(excluded),
            "department_count": len(departments),
            "departments": departments,
            "people": active,
            "excluded": excluded,
        }

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
            [
                "name",
                "customer",
                "full_name",
                "email",
                "department",
                "lifecycle_status",
                "username",
                "start_date",
            ],
            as_dict=True,
        )

        if not person or person.customer not in access.allowed_customers():
            raise NotFoundError(f"Client User {client_user} not found.", "NOT_FOUND")

        # the caller may only read their own company's people
        PortalService._resolve_customer(person.customer)
        selectable_services = RequestBuilderService._selectable_services(person.customer)

        personal = ServiceAvailabilityService.read_user(person.name)

        return {
            "user": person,
            "personal_services": {
                "current": [
                    RequestBuilderService._current_entry(row) for row in personal["current"]
                ],
                "available": [
                    RequestBuilderService._offer_entry(row)
                    for row in personal["available"]
                    if selectable_services is None or row["service_item"] in selectable_services
                ],
            },
            "target_reason": personal.get("target_reason"),
            "devices": RequestBuilderService._devices_of(person, selectable_services),
        }

    @staticmethod
    def _devices_of(person, selectable_services=None):
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
                    RequestBuilderService._offer_entry(row)
                    for row in reading["available"]
                    if selectable_services is None or row["service_item"] in selectable_services
                ],
            }
            device["target_reason"] = reading.get("target_reason")

        return devices

    # ------------------------------------------------------------------ new person
    @staticmethod
    def new_person_context(customer=None):
        """What can be asked for somebody who does not exist yet.

        Nothing is held, so every compatible catalogue service is on offer — for the person
        and for a machine a technician will identify later.
        """
        from nexgen_msp.api.internal.services.department_service import DepartmentService
        from nexgen_msp.api.portal.services.portal_service import PortalService

        customer = PortalService._resolve_customer(customer)
        selectable_services = RequestBuilderService._selectable_services(customer)

        return {
            "customer": customer,
            "departments": [
                {"value": row.department_name, "label": row.department_name}
                for row in DepartmentService.list_departments(customer=customer)
            ],
            "available_user_services": RequestBuilderService._offered(
                customer, "User", selectable_services
            ),
            "available_device_services": RequestBuilderService._offered(
                customer, "Device", selectable_services
            ),
        }

    @staticmethod
    def _offered(customer, scope, selectable_services=None):
        """Every compatible catalogue service at a given scope.

        Read against the customer rather than a target, because there is no target yet: a
        person who does not exist holds nothing, so nothing can be filtered out as already
        had.
        """
        sellable = ("User", "Both") if scope == "User" else ("Device", "Both")
        offered = []

        for item in ServiceDefinitionService.available_rows():
            if item["service_scope"] not in sellable:
                continue
            if selectable_services is not None and item["name"] not in selectable_services:
                continue

            warning = ServiceAvailabilityService._commercial_warning(
                customer, item["name"], frappe.utils.getdate(frappe.utils.today())
            )

            offered.append(
                {
                    "service_item": item["name"],
                    "item_name": item["item_name"],
                    "service_scope": item["service_scope"],
                    "warning": warning,
                    "allowed_operations": RequestBuilderService._operations_for(("service.add",)),
                }
            )

        return offered

    @staticmethod
    def _selectable_services(customer):
        """Restrict customer selectors to their contract, without restricting staff tools.

        Internal service-management screens intentionally allow operational reality to be
        recorded even when billing setup is incomplete.  A customer request is different:
        its service picker is their contracted catalogue, so an uncovered item is omitted
        rather than offered with an internal billing warning.
        """
        if permissions.is_internal():
            return None

        from nexgen_msp.api.portal.services.portal_service import PortalService

        return {row["name"] for row in PortalService.list_catalogue(customer)["items"]}

    # ------------------------------------------------------------------ what happens next
    @staticmethod
    def submission_context(customer=None):
        """Whether sending this reaches us straight away, or waits for the company's accord."""
        from nexgen_msp.api.portal.services.portal_service import PortalService

        customer = PortalService._resolve_customer(customer)
        rights = approval.rights_of(customer)
        decides_own = bool(rights.get("can_approve"))

        # the same rule the request itself follows when it is sent
        waits = not decides_own and not permissions.is_internal()

        return {
            "customer": customer,
            "may_submit": bool(rights.get("can_submit")) or permissions.is_internal(),
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
            "allowed_operations": (
                []
                if pending
                else RequestBuilderService._operations_for(
                    operations.for_service_state(row["operational_status"])
                )
            ),
        }

    @staticmethod
    def _offer_entry(row):
        return {
            "service_item": row["service_item"],
            "item_name": row.get("item_name") or row["service_item"],
            "service_scope": row.get("service_scope"),
            "warning": row.get("warning"),
            "allowed_operations": RequestBuilderService._operations_for(("service.add",)),
        }

    @staticmethod
    def _operations_for(codes):
        """What may be asked here, from the operations this application performs."""
        return operations.offered([code for code in codes if operations.get(code)])
