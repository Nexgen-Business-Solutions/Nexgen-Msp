"""One person's situation, read the way somebody who has to act on it needs to read it.

The rule the whole reading turns on is an ownership rule, and it is not new — Phase 2 set it
and this only stops contradicting it:

    a person owns their personal services
    a person holds a machine
    the machine owns the services running on it

So a service running on the laptop somebody holds today is shown under that laptop, never
among the services that are theirs. Hand the laptop to somebody else and the service goes
with the laptop, not with the person: the previous holder's own history never gains, and
never loses, a service that was always the machine's.

Nothing here decides anything. Availability comes from the service domain, holding periods
from the device domain, and what a request is asking for from the request rules.
"""

import frappe

from nexgen_msp.api.internal.services.request_service import (
    CUSTOMER_STATUS,
    OPEN_STATUSES,
    RequestService,
)
from nexgen_msp.api.internal.services.service_availability_service import (
    ServiceAvailabilityService,
)
from nexgen_msp.utils import remarks as remarks_util
from nexgen_msp.utils import request_intents
from nexgen_msp.utils.assignments import OPEN_ASSIGNMENT_STATUSES
from nexgen_msp.utils.errors import NotFoundError, ValidationError

CLIENT_USER = "MSP Client User"
ASSIGNMENT = "MSP Service Assignment"
DEVICE = "MSP Managed Device"

# a request the person can see moving: a draft belongs to whoever is writing it, and one
# still waiting inside the customer's own company has not reached us
VISIBLE_REQUEST_STATUSES = tuple(status for status in OPEN_STATUSES if status != "Draft")

# how much of the past the first reading carries; the rest is asked for when it is wanted
RECENT_ACTIVITY = 20


class User360Service:
    # ------------------------------------------------------------------ the reading
    @staticmethod
    def get_user(name=None):
        RequestService._guard_internal()

        return User360Service.read_user(name)

    @staticmethod
    def read_user(name=None, internal=True):
        """The person's situation now: who they are, what is theirs, what they hold, what is moving."""
        person = User360Service._person(name)

        devices = User360Service._current_devices(person, internal=internal)
        personal = User360Service._personal_services(person, internal=internal)
        requests = User360Service._open_requests(person)
        attention = User360Service._attention(person, devices, personal, requests)

        reading = {
            "user": User360Service._identity(person, internal=internal),
            "summary": {
                "current_devices": len(devices),
                "active_personal_services": len(personal["current"]),
                "active_device_services": sum(
                    len(slot["services"]["current"]) for slot in devices
                ),
                "open_requests": len(requests),
                "attention_count": len(attention),
            },
            "personal_services": personal,
            "devices": devices,
            "open_requests": requests,
            "attention": attention,
            "recent_activity": User360Service._activity(person, limit=RECENT_ACTIVITY),
        }

        if internal:
            blockers = User360Service._deletion_blockers(person.name)
            reading["can_delete"] = not blockers
            reading["delete_blockers"] = blockers
            reading["billing"] = {
                "covered_until": person.covered_until,
                "last_billed_on": person.last_billed_on,
            }
            reading["notes"] = User360Service._notes(person.name)

        return reading

    @staticmethod
    def get_user_history(name=None, limit=50):
        """The past, asked for only when somebody wants to see it."""
        RequestService._guard_internal()

        return User360Service.read_history(name, limit=limit)

    @staticmethod
    def read_history(name=None, limit=50):
        person = User360Service._person(name)
        limit = min(max(frappe.utils.cint(limit) or 50, 1), 200)

        return {
            "past_devices": User360Service._past_devices(person),
            "past_personal_services": User360Service._closed_personal_services(person),
            "past_requests": User360Service._closed_requests(person, limit=limit),
            "activity": User360Service._activity(person, limit=limit),
        }

    # ------------------------------------------------------------------ who they are
    @staticmethod
    def _person(name):
        if not name:
            raise ValidationError("name is required.", "VALIDATION_ERROR")

        person = frappe.db.get_value(
            CLIENT_USER,
            name,
            [
                "name",
                "full_name",
                "department",
                "customer",
                "email",
                "username",
                "lifecycle_status",
                "start_date",
                "disabled_date",
                "covered_until",
                "last_billed_on",
            ],
            as_dict=True,
        )

        if not person:
            raise NotFoundError(f"Client User {name} not found.", "NOT_FOUND")

        return person

    @staticmethod
    def _identity(person, internal):
        return {
            "name": person.name,
            "full_name": person.full_name,
            "department": person.department,
            "customer": person.customer,
            "email": person.email,
            "username": person.username,
            "lifecycle_status": person.lifecycle_status,
            "start_date": person.start_date,
            "disabled_date": person.disabled_date,
        }

    # ------------------------------------------------------------------ what is theirs
    @staticmethod
    def _personal_services(person, internal):
        """Only what was issued to the person. A machine's services are the machine's."""
        rows = frappe.db.sql(
            """
            select sa.name, sa.service_item,
                   coalesce(item.item_name, sa.service_item) as service_name,
                   sa.operational_status, sa.billing_status, sa.quantity,
                   sa.effective_start_date, sa.effective_end_date, sa.source_request
            from `tabMSP Service Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            where sa.client_user = %(user)s and sa.assignment_scope = 'User'
              and sa.operational_status in %(open)s
            order by sa.effective_start_date desc
            """,
            {"user": person.name, "open": OPEN_ASSIGNMENT_STATUSES},
            as_dict=True,
        )

        pending = User360Service._pending_on([row["name"] for row in rows])

        for row in rows:
            User360Service._describe_service(row, pending)

        offer = ServiceAvailabilityService.read_user(person.name) if internal else None

        return {
            "current": rows,
            "available": offer["available"] if offer else [],
            "blocked": offer["blocked"] if offer else [],
            "target_reason": offer["target_reason"] if offer else None,
        }

    @staticmethod
    def _closed_personal_services(person):
        rows = frappe.db.sql(
            """
            select sa.name, sa.service_item,
                   coalesce(item.item_name, sa.service_item) as service_name,
                   sa.operational_status, sa.quantity,
                   sa.effective_start_date, sa.effective_end_date, sa.source_request
            from `tabMSP Service Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            where sa.client_user = %(user)s and sa.assignment_scope = 'User'
              and sa.operational_status not in %(open)s
            order by sa.effective_end_date desc, sa.effective_start_date desc
            """,
            {"user": person.name, "open": OPEN_ASSIGNMENT_STATUSES},
            as_dict=True,
        )

        return rows

    @staticmethod
    def _pending_on(assignments):
        """Which of these services somebody is already asking for something on.

        One query for the lot. Asked service by service, a person with a dozen of them
        would cost a dozen round trips to draw one page.
        """
        if not assignments:
            return {}

        rows = frappe.db.sql(
            """
            select srl.source_service_assignment as assignment, min(sr.name) as request
            from `tabMSP Service Request Line` srl
            join `tabMSP Service Request` sr on sr.name = srl.parent
            where srl.source_service_assignment in %(assignments)s
              and sr.status in %(in_flight)s
            group by srl.source_service_assignment
            """,
            {
                "assignments": tuple(assignments),
                "in_flight": request_intents.IN_FLIGHT_STATUSES,
            },
            as_dict=True,
        )

        return {row.assignment: row.request for row in rows}

    @staticmethod
    def _describe_service(row, pending=None):
        """What may still be asked of this service, and whether somebody is already asking."""
        asked = (
            pending.get(row["name"])
            if pending is not None
            else (request_intents.in_flight_requests_for(row["name"]) or [None])[0]
        )

        row["allowed_actions"] = list(
            request_intents.ALLOWED_ACTIONS.get(row["operational_status"], ())
        )
        row["pending_request"] = asked

        if asked:
            # somebody is already changing it; offering a second, contradictory ask here is
            # the very thing Phase 3 refuses at the door
            row["allowed_actions"] = []

        return row

    # ------------------------------------------------------------------ what they hold
    @staticmethod
    def _current_devices(person, internal):
        """The machines in their hands today, each carrying its own services."""
        devices = frappe.db.sql(
            """
            select device.name, device.hostname, device.device_type, device.status,
                   device.serial_number, device.assigned_date as in_service_since,
                   holder.from_date as holder_since
            from `tabMSP Managed Device` device
            join `tabMSP Device Holder` holder
              on holder.parent = device.name
             and holder.parenttype = 'MSP Managed Device'
             and holder.is_current = 1
            where holder.client_user = %(user)s
            order by device.hostname asc
            """,
            {"user": person.name},
            as_dict=True,
        )

        if not devices:
            return []

        names = [device.name for device in devices]
        interfaces = {}

        for row in frappe.get_all(
            "MSP Network Interface",
            filters={"parent": ("in", names)},
            fields=["parent", "interface_type", "mac_address"],
        ):
            interfaces.setdefault(row.parent, []).append(
                {"interface_type": row.interface_type, "mac_address": row.mac_address}
            )

        running = {}
        history = {}

        for row in frappe.db.sql(
            """
            select sa.name, sa.managed_device, sa.service_item,
                   coalesce(item.item_name, sa.service_item) as service_name,
                   sa.operational_status, sa.billing_status, sa.quantity,
                   sa.effective_start_date, sa.effective_end_date, sa.source_request
            from `tabMSP Service Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            where sa.managed_device in %(devices)s and sa.assignment_scope = 'Device'
              and sa.operational_status in %(open)s
            order by sa.effective_start_date desc
            """,
            {"devices": names, "open": OPEN_ASSIGNMENT_STATUSES},
            as_dict=True,
        ):
            running.setdefault(row.managed_device, []).append(row)

        pending = User360Service._pending_on(
            [row["name"] for rows in running.values() for row in rows]
        )

        for rows in running.values():
            for row in rows:
                User360Service._describe_service(row, pending)

        # The page is used by the MSP team and customer administrators, not by the
        # individual holder. Keep the machine's closed service history visible after a
        # transfer, while keeping it separate from what is running now.
        for row in frappe.db.sql(
            """
            select sa.name, sa.managed_device, sa.service_item,
                   coalesce(item.item_name, sa.service_item) as service_name,
                   sa.operational_status, sa.billing_status, sa.quantity,
                   sa.effective_start_date, sa.effective_end_date, sa.source_request
            from `tabMSP Service Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            where sa.managed_device in %(devices)s and sa.assignment_scope = 'Device'
              and sa.operational_status not in %(open)s
            order by sa.effective_end_date desc, sa.effective_start_date desc
            """,
            {"devices": names, "open": OPEN_ASSIGNMENT_STATUSES},
            as_dict=True,
        ):
            history.setdefault(row.managed_device, []).append(row)

        return [
            {
                "device": {
                    "name": device.name,
                    "hostname": device.hostname,
                    "device_type": device.device_type,
                    "status": device.status,
                    "serial_number": device.serial_number,
                    "in_service_since": device.in_service_since,
                },
                "holder_since": device.holder_since,
                "interfaces": interfaces.get(device.name, []),
                "services": {
                    "current": running.get(device.name, []),
                    "history": history.get(device.name, []),
                    # availability is read per machine: a service on one laptop says nothing
                    # about the next one
                    "available": (
                        ServiceAvailabilityService.read_device(device.name)["available"]
                        if internal
                        else []
                    ),
                },
            }
            for device in devices
        ]

    @staticmethod
    def _past_devices(person):
        """Every holding period that is over, each one on its own.

        Somebody can hold the same machine twice. Two periods are two lines, not one.
        """
        return frappe.db.sql(
            """
            select holder.name as period, device.name, device.hostname,
                   device.device_type, device.serial_number, device.status,
                   holder.from_date as held_from, holder.to_date as held_until
            from `tabMSP Device Holder` holder
            join `tabMSP Managed Device` device on device.name = holder.parent
            where holder.parenttype = 'MSP Managed Device'
              and holder.client_user = %(user)s
              and holder.is_current = 0
            order by holder.from_date desc
            """,
            {"user": person.name},
            as_dict=True,
        )

    # ------------------------------------------------------------------ what is moving
    @staticmethod
    def _requests_touching(person, statuses, limit=None):
        """Every request that speaks of this person, whichever way it names them.

        A line about a machine names the machine, and the person it was raised for beside it.
        Looking only at the person the line targets would lose exactly those.
        """
        return frappe.db.sql(
            f"""
            select distinct sr.name, sr.status, sr.priority, sr.request_type,
                   sr.creation, sr.modified
            from `tabMSP Service Request` sr
            join `tabMSP Service Request Line` srl on srl.parent = sr.name
            where (srl.client_user = %(user)s or srl.requested_for_user = %(user)s)
              and sr.status in %(statuses)s
              and sr.status != %(hidden)s
            order by sr.creation desc
            {"limit " + str(frappe.utils.cint(limit)) if limit else ""}
            """,
            {"user": person.name, "statuses": statuses, "hidden": CUSTOMER_STATUS},
            as_dict=True,
        )

    @staticmethod
    def _open_requests(person):
        rows = User360Service._requests_touching(person, VISIBLE_REQUEST_STATUSES)

        for row in rows:
            row["lines"] = User360Service._request_lines(row.name, person.name)
            row.update(User360Service._work_progress(row.name))

        return rows

    @staticmethod
    def _closed_requests(person, limit):
        rows = User360Service._requests_touching(
            person, ("Completed", "Rejected", "Cancelled"), limit=limit
        )

        for row in rows:
            row["lines"] = User360Service._request_lines(row.name, person.name)

        return rows

    @staticmethod
    def _request_lines(request, person):
        """Only the lines of that request that are about this person."""
        return frappe.db.sql(
            """
            select srl.idx, srl.action,
                   coalesce(item.item_name, srl.requested_service) as service_name,
                   srl.line_status, device.hostname
            from `tabMSP Service Request Line` srl
            left join `tabItem` item on item.name = srl.requested_service
            left join `tabMSP Managed Device` device on device.name = srl.managed_device
            where srl.parent = %(request)s
              and (srl.client_user = %(user)s or srl.requested_for_user = %(user)s)
            order by srl.idx asc
            """,
            {"request": request, "user": person},
            as_dict=True,
        )

    @staticmethod
    def _work_progress(request):
        """How far the technician has got, told by the work rather than by the status word."""
        rows = frappe.get_all(
            "MSP Service Work Order",
            filters={"service_request": request},
            fields=["status", "assigned_technician"],
        )

        if not rows:
            return {"work_total": 0, "work_done": 0, "technician": None}

        technician = next((row.assigned_technician for row in rows if row.assigned_technician), None)

        return {
            "work_total": len(rows),
            "work_done": len([row for row in rows if row.status in ("Completed", "Cancelled")]),
            "technician": frappe.db.get_value("User", technician, "full_name")
            if technician
            else None,
        }

    # ------------------------------------------------------------------ what is wrong
    @staticmethod
    def _attention(person, devices, personal, requests):
        """Anomalies said in the backend's own words, so no screen has to invent rules."""
        signals = []

        for slot in devices:
            if not (slot["device"]["serial_number"] or "").strip():
                signals.append(
                    {
                        "code": "DEVICE_SERIAL_MISSING",
                        "severity": "warning",
                        "entity_type": "Device",
                        "entity": slot["device"]["name"],
                        "message": f"{slot['device']['hostname']} has no serial number.",
                    }
                )

        if person.lifecycle_status in ("Disabled", "Archived"):
            if personal["current"]:
                signals.append(
                    {
                        "code": "DISABLED_WITH_OPEN_SERVICES",
                        "severity": "warning",
                        "entity_type": "User",
                        "entity": person.name,
                        "message": f"{person.lifecycle_status} but {len(personal['current'])} "
                        "personal service(s) are still open.",
                    }
                )

            if devices:
                signals.append(
                    {
                        "code": "DISABLED_WITH_DEVICE",
                        "severity": "warning",
                        "entity_type": "User",
                        "entity": person.name,
                        "message": f"{person.lifecycle_status} but still holds "
                        f"{len(devices)} device(s).",
                    }
                )

        if personal["current"] and not (person.username or "").strip():
            signals.append(
                {
                    "code": "ACCOUNT_NAME_MISSING",
                    "severity": "warning",
                    "entity_type": "User",
                    "entity": person.name,
                    "message": "No account name is recorded for the licences issued to them.",
                }
            )

        for request in requests:
            if request.status == "Submitted":
                signals.append(
                    {
                        "code": "REQUEST_AWAITING_REVIEW",
                        "severity": "info",
                        "entity_type": "Request",
                        "entity": request.name,
                        "message": f"{request.name} is waiting to be reviewed.",
                    }
                )

        return signals

    # ------------------------------------------------------------------ what happened
    @staticmethod
    def _activity(person, limit):
        """A single line of events, built from the records that already hold them.

        A machine's own life is only this person's business while they were holding it, so a
        service opened on a laptop before they were given it is not part of their story.
        """
        held = frappe.db.sql(
            """
            select device.name, device.hostname, holder.from_date, holder.to_date
            from `tabMSP Device Holder` holder
            join `tabMSP Managed Device` device on device.name = holder.parent
            where holder.parenttype = 'MSP Managed Device' and holder.client_user = %(user)s
            """,
            {"user": person.name},
            as_dict=True,
        )

        events = []

        for period in held:
            events.append(
                {
                    "on": period.from_date,
                    "kind": "device",
                    "entity": period.name,
                    "what": f"{period.hostname} handed over",
                }
            )

            if period.to_date:
                events.append(
                    {
                        "on": period.to_date,
                        "kind": "device",
                        "entity": period.name,
                        "what": f"{period.hostname} given back",
                    }
                )

        for row in frappe.db.sql(
            """
            select sa.name, coalesce(item.item_name, sa.service_item) as service_name,
                   sa.effective_start_date, sa.effective_end_date, sa.source_request
            from `tabMSP Service Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            where sa.client_user = %(user)s and sa.assignment_scope = 'User'
            """,
            {"user": person.name},
            as_dict=True,
        ):
            events.append(
                {
                    "on": row.effective_start_date,
                    "kind": "service",
                    "entity": row.name,
                    "what": f"{row.service_name} activated",
                    "via": row.source_request,
                }
            )

            if row.effective_end_date:
                events.append(
                    {
                        "on": row.effective_end_date,
                        "kind": "service",
                        "entity": row.name,
                        "what": f"{row.service_name} ended",
                        "via": row.source_request,
                    }
                )

        events += User360Service._device_service_events(held)

        for row in User360Service._requests_touching(
            person, VISIBLE_REQUEST_STATUSES + ("Completed", "Rejected", "Cancelled")
        ):
            events.append(
                {
                    "on": frappe.utils.getdate(row.creation),
                    "kind": "request",
                    "entity": row.name,
                    "what": f"Request {row.name} raised",
                }
            )

        events = [event for event in events if event["on"]]
        events.sort(key=lambda event: (str(event["on"]), event["what"]), reverse=True)

        return events[:limit]

    @staticmethod
    def _device_service_events(held):
        """What happened on their machines, while they were the ones holding them."""
        if not held:
            return []

        rows = frappe.db.sql(
            """
            select sa.name, sa.managed_device,
                   coalesce(item.item_name, sa.service_item) as service_name,
                   sa.effective_start_date, sa.effective_end_date, sa.source_request,
                   device.hostname
            from `tabMSP Service Assignment` sa
            join `tabMSP Managed Device` device on device.name = sa.managed_device
            left join `tabItem` item on item.name = sa.service_item
            where sa.managed_device in %(devices)s and sa.assignment_scope = 'Device'
            """,
            {"devices": [period.name for period in held]},
            as_dict=True,
        )

        windows = {}
        for period in held:
            windows.setdefault(period.name, []).append((period.from_date, period.to_date))

        def theirs(device, on):
            return any(
                on and start and on >= start and (not end or on <= end)
                for start, end in windows.get(device, [])
            )

        events = []

        for row in rows:
            if theirs(row.managed_device, row.effective_start_date):
                events.append(
                    {
                        "on": row.effective_start_date,
                        "kind": "device-service",
                        "entity": row.name,
                        "what": f"{row.service_name} activated on {row.hostname}",
                        "via": row.source_request,
                    }
                )

            if row.effective_end_date and theirs(row.managed_device, row.effective_end_date):
                events.append(
                    {
                        "on": row.effective_end_date,
                        "kind": "device-service",
                        "entity": row.name,
                        "what": f"{row.service_name} ended on {row.hostname}",
                        "via": row.source_request,
                    }
                )

        return events

    # ------------------------------------------------------------------ the rest
    @staticmethod
    def _notes(name):
        log = remarks_util.log(CLIENT_USER, name)

        # oldest first is how it is written; the one worth showing first is the last one
        return {"latest": log[-1] if log else None, "count": len(log), "log": log}

    @staticmethod
    def _deletion_blockers(name):
        from nexgen_msp.api.internal.services.user_service import UserService

        return UserService.deletion_blockers(name)
