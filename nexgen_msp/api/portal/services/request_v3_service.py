"""What the Request Builder reads: who is selected, and what may be asked of them.

Two readings, one engine. `scope_projection` answers the People table — one row per selected
person, with the machines they hold and the services running on them today. `operation_options`
answers the Actions workspace — the acts that at least one target in the chosen scope can
actually use, grouped by domain, each with its exact targets and the reason every other
subject is left out.

Eligibility is decided here and nowhere else. The frontend never reads a status string and
concludes anything from it: it receives targets, counts and stable reason codes. The state is
loaded in a handful of queries for the whole selection rather than one query per target, so a
five-hundred-person Department answers as quickly as one person does.

This is the reading. The authority is still the submission path, which revalidates every
target one at a time before a line is written.
"""

import frappe

from nexgen_msp.api.internal.services.service_definition_service import ServiceDefinitionService
from nexgen_msp.utils import operations
from nexgen_msp.utils.assignments import OPEN_ASSIGNMENT_STATUSES
from nexgen_msp.utils.errors import ValidationError
from nexgen_msp.utils.request_intents import IN_FLIGHT_STATUSES

ASSIGNMENT = "MSP Service Assignment"
CLIENT_USER = "MSP Client User"
DEVICE = "MSP Managed Device"
CURRENT_STATUSES = ("Pending Setup", "Active", "Suspended")
LIVE_LIFECYCLE = ("Pending", "Active")

# every refusal a customer can meet, said the same way everywhere
REASON_TEXT = {
    "NO_CURRENT_ASSIGNMENT": "No current assignment for this service.",
    "ALREADY_ACTIVE": "Service is already active.",
    "NOT_SUSPENDED": "Service is not suspended.",
    "SERVICE_NOT_AVAILABLE": "Service is not available for this Customer.",
    "PENDING_CONFLICT": "Another request is already changing this service.",
    "PERSON_DISABLED": "Person is disabled.",
    "NO_CURRENT_DEVICE": "Person has no current Device.",
    "DEVICE_STATE_INVALID": "Device state does not allow this operation.",
    "SAME_DEVICE_HOLDER": "This Device is already held by that person.",
    "CROSS_CUSTOMER_TARGET": "One or more selected people no longer belong to this Customer.",
    "NEW_PERSON": "This person does not exist yet and will be prepared during fulfilment.",
}

SERVICE_CODES = ("service.add", "service.suspend", "service.resume", "service.end")
DEVICE_CODES = ("device.transfer", "device.repossess")

# what the card offers, in the order the prototype shows them
SHORT_LABEL = {
    "service.add": "Add",
    "service.suspend": "Suspend",
    "service.resume": "Resume",
    "service.end": "End",
}


class RequestV3Service:
    # ------------------------------------------------------------------ People table
    @staticmethod
    def scope_projection(customer=None, subjects=None):
        """One canonical row per selected person, whatever door they came in through."""
        from nexgen_msp.api.portal.services.portal_service import PortalService

        customer = PortalService._resolve_customer(customer)
        drafts = _parse(subjects)
        state = _load_state(customer, drafts)

        return {
            "customer": customer,
            "subjects": [_project(draft, state) for draft in drafts],
        }

    # ------------------------------------------------------------------ Actions workspace
    @staticmethod
    def operation_options(customer=None, subjects=None, subject_keys=None):
        """The acts available to this scope, by domain, with their exact targets."""
        from nexgen_msp.api.portal.services.portal_service import PortalService

        customer = PortalService._resolve_customer(customer)
        drafts = _parse(subjects)
        chosen = set(_parse(subject_keys) or [draft["subject_key"] for draft in drafts])
        scoped = [draft for draft in drafts if draft["subject_key"] in chosen]

        if not scoped:
            raise ValidationError(
                "Add at least one person before continuing.", "VALIDATION_ERROR"
            )

        state = _load_state(customer, drafts)
        rows = [_project(draft, state) for draft in scoped]
        domains = []

        services = _service_domain(customer, rows, state)

        if services["options"]:
            domains.append(services)

        devices = _device_domain(rows, state)

        if devices["options"]:
            domains.append(devices)

        return {
            "customer": customer,
            "selected_subject_count": len(rows),
            "domains": domains,
        }


# ---------------------------------------------------------------------- state
def _parse(value):
    if isinstance(value, str):
        value = frappe.parse_json(value)

    return value or []


def _load_state(customer, drafts):
    """Everything the whole selection needs, read once."""
    existing = [draft["client_user"] for draft in drafts if draft.get("client_user")]
    people = {
        row.name: row
        for row in frappe.get_all(
            CLIENT_USER,
            filters={"name": ("in", existing)} if existing else {"name": ("in", [""])},
            fields=["name", "full_name", "department", "email", "customer", "lifecycle_status"],
        )
    }
    holdings = _holdings(customer, existing)
    devices = sorted({row["name"] for rows in holdings.values() for row in rows})
    assignments = _assignments(customer, existing, devices)

    return {
        "customer": customer,
        "people": people,
        "holdings": holdings,
        "assignments": assignments,
        "billed": _billed_through(
            [row["assignment"] for rows in assignments["by_user"].values() for row in rows]
        ),
        "in_flight": _in_flight(customer),
        "offered": _offered(customer),
        "labels": {},
    }


def _holdings(customer, people):
    """The machines each of these people holds right now."""
    found = {}

    if not people:
        return found

    for row in frappe.db.sql(
        """
        select holder.client_user as person, device.name, device.hostname,
               device.serial_number, device.status
        from `tabMSP Managed Device` device
        join `tabMSP Device Holder` holder
          on holder.parent = device.name and holder.parenttype = 'MSP Managed Device'
        where holder.client_user in %(people)s and holder.is_current = 1
          and device.customer = %(customer)s
        order by device.hostname asc, device.name asc
        """,
        {"people": tuple(people), "customer": customer},
        as_dict=True,
    ):
        found.setdefault(row.person, []).append(
            {
                "name": row.name,
                "label": row.hostname or row.serial_number or row.name,
                "status": row.status,
            }
        )

    return found


def _assignments(customer, people, devices):
    """Every service currently running on the selection, personal or on its machines."""
    by_user, by_device = {}, {}

    if not people and not devices:
        return {"by_user": by_user, "by_device": by_device}

    rows = frappe.db.sql(
        """
        select sa.name as assignment, sa.service_item, sa.assignment_scope, sa.client_user,
               sa.managed_device, sa.operational_status,
               coalesce(item.item_name, sa.service_item) as label
        from `tabMSP Service Assignment` sa
        left join `tabItem` item on item.name = sa.service_item
        where sa.customer = %(customer)s
          and sa.operational_status in %(open)s
          and (
            (sa.assignment_scope = 'User' and sa.client_user in %(people)s)
            or (sa.assignment_scope = 'Device' and sa.managed_device in %(devices)s)
          )
        """,
        {
            "customer": customer,
            "open": OPEN_ASSIGNMENT_STATUSES,
            "people": tuple(people) or ("",),
            "devices": tuple(devices) or ("",),
        },
        as_dict=True,
    )

    for row in rows:
        entry = dict(row)

        if row.assignment_scope == "User":
            by_user.setdefault(row.client_user, []).append(entry)
        else:
            by_device.setdefault(row.managed_device, []).append(entry)

    return {"by_user": by_user, "by_device": by_device}


def _billed_through(assignments):
    """The last day each personal service was invoiced for, in one query."""
    if not assignments:
        return {}

    rows = frappe.db.sql(
        """
        select brl.service_assignment as assignment, max(br.billing_period_end) as billed_to
        from `tabMSP Billing Run Line` brl
        join `tabMSP Billing Run` br on br.name = brl.parent
        join `tabMSP Service Assignment` sa on sa.name = brl.service_assignment
        where brl.service_assignment in %(assignments)s
          and br.customer = sa.customer
          and br.docstatus = 1
          and ifnull(br.credit_note_of, '') = ''
        group by brl.service_assignment
        """,
        {"assignments": tuple(assignments)},
        as_dict=True,
    )

    return {row.assignment: row.billed_to for row in rows}


def _in_flight(customer):
    """What other open requests are already asking of this customer's targets."""
    rows = frappe.db.sql(
        """
        select srl.requested_service, srl.target_scope, srl.client_user, srl.managed_device,
               srl.action, srl.source_service_assignment
        from `tabMSP Service Request Line` srl
        join `tabMSP Service Request` sr on sr.name = srl.parent
        where sr.customer = %(customer)s and sr.status in %(in_flight)s
        """,
        {"customer": customer, "in_flight": IN_FLIGHT_STATUSES},
        as_dict=True,
    )
    additions, touched = set(), set()

    for row in rows:
        if row.source_service_assignment:
            touched.add(row.source_service_assignment)

        if row.action == "Add":
            target = row.managed_device if row.target_scope == "Device" else row.client_user
            additions.add((row.requested_service, row.target_scope, target))

    return {"additions": additions, "touched": touched}


def _offered(customer):
    """The services this customer may ask for, each already resolved by its definition.

    A customer selector is their contracted catalogue; our own team raising a request on
    their behalf is not restricted the same way, which is what a `None` restriction means.
    """
    from nexgen_msp.api.portal.services.portal_service import PortalService
    from nexgen_msp.api.portal.services.request_builder_service import RequestBuilderService

    allowed = RequestBuilderService._selectable_services(customer)
    items = [row["name"] for row in PortalService.list_catalogue(customer)["items"]]
    labels = ServiceDefinitionService.labels_by_item(items)

    return {
        item: {
            "service_item": item,
            "label": labels.get(item) or item,
            "scope": ServiceDefinitionService.scope_of(item),
        }
        for item in items
        if allowed is None or item in allowed
    }


# ---------------------------------------------------------------------- projection
def _project(draft, state):
    """One person as the People table shows them."""
    key = draft["subject_key"]
    person = state["people"].get(draft.get("client_user") or "")

    if draft.get("is_new_user") or not person:
        return {
            "subject_key": key,
            "client_user": None,
            "is_new_user": 1,
            "full_name": draft.get("full_name") or draft.get("full_name_snapshot") or "",
            "department": draft.get("department"),
            "email": draft.get("email"),
            "added_via": draft.get("added_via") or "New",
            "selection_label": draft.get("selection_label"),
            "devices": [],
            "current_services": [],
            "last_billed": None,
            "usable": bool(draft.get("full_name") or draft.get("full_name_snapshot")),
            "reason_code": None,
        }

    devices = state["holdings"].get(person.name, [])
    personal = state["assignments"]["by_user"].get(person.name, [])
    on_devices = [
        row
        for device in devices
        for row in state["assignments"]["by_device"].get(device["name"], [])
    ]
    billed = [state["billed"].get(row["assignment"]) for row in personal]
    billed = [day for day in billed if day]
    usable = person.customer == state["customer"] and person.lifecycle_status in LIVE_LIFECYCLE

    return {
        "subject_key": key,
        "client_user": person.name,
        "is_new_user": 0,
        "full_name": person.full_name,
        "department": person.department,
        "email": person.email,
        "added_via": draft.get("added_via") or "Existing",
        "selection_label": draft.get("selection_label"),
        "devices": devices,
        "current_services": [
            {
                "assignment": row["assignment"],
                "service_item": row["service_item"],
                "label": row["label"],
                "scope": row["assignment_scope"],
                "status": row["operational_status"],
                "managed_device": row.get("managed_device"),
            }
            for row in sorted(personal + on_devices, key=lambda row: row["label"])
        ],
        "last_billed": max(billed) if billed else None,
        "usable": usable,
        "reason_code": None
        if usable
        else ("CROSS_CUSTOMER_TARGET" if person.customer != state["customer"] else "PERSON_DISABLED"),
    }


# ---------------------------------------------------------------------- domains
def _service_domain(customer, rows, state):
    """One card per service the scope can act on, with only the acts that have a target."""
    running = {}

    for row in rows:
        for service in row["current_services"]:
            running.setdefault(service["service_item"], service["label"])

    catalogue = dict(running)

    for item, offer in state["offered"].items():
        catalogue.setdefault(item, offer["label"])

    options = []

    for item in sorted(catalogue, key=lambda item: catalogue[item].lower()):
        scope = (
            state["offered"][item]["scope"]
            if item in state["offered"]
            else ServiceDefinitionService.scope_of(item)
        )
        card = {
            "object_key": item,
            "object_label": catalogue[item],
            "service_scope": scope,
            "current_count": 0,
            "without_count": 0,
            "actions": [],
        }
        evaluated = {code: _evaluate_service(code, item, scope, rows, state) for code in SERVICE_CODES}
        card["current_count"] = evaluated["service.end"]["applicable_target_count"]
        card["without_count"] = evaluated["service.add"]["applicable_target_count"]

        for code in SERVICE_CODES:
            outcome = evaluated[code]

            if not outcome["applicable_target_count"]:
                continue

            card["actions"].append(
                {
                    "operation_code": code,
                    "operation_label": SHORT_LABEL[code],
                    "operation_label_snapshot": f"{SHORT_LABEL[code]} {catalogue[item]}",
                    **outcome,
                }
            )

        if card["actions"]:
            options.append(card)

    return {"key": "Service", "label": "Services", "options": options}


def _evaluate_service(code, item, scope, rows, state):
    """Who this act can reach inside the scope, and why it misses the others."""
    available = item in state["offered"]
    targets, exclusions = [], []

    for row in rows:
        if not row["usable"]:
            exclusions.append(_exclusion(row, row["reason_code"] or "PERSON_DISABLED"))
            continue

        if row["is_new_user"]:
            # a person who does not exist yet can only be given something new
            if code == "service.add" and available:
                targets.append(_target(row, scope, None, None))
            else:
                exclusions.append(_exclusion(row, "NEW_PERSON"))

            continue

        if scope == "Device":
            devices = [device for device in row["devices"] if device["status"] == "Active"]

            if not devices:
                exclusions.append(_exclusion(row, "NO_CURRENT_DEVICE"))
                continue

            for device in devices:
                _sort_service(code, item, scope, row, device, state, available, targets, exclusions)

            continue

        _sort_service(code, item, scope, row, None, state, available, targets, exclusions)

    reached = {entry["subject_key"] for entry in targets}

    return {
        "targets": targets,
        "exclusions": exclusions,
        "applicable_target_count": len(targets),
        "applicable_subject_count": len(reached),
        "excluded_subject_count": len({entry["subject_key"] for entry in exclusions} - reached),
    }


def _sort_service(code, item, scope, row, device, state, available, targets, exclusions):
    """One concrete target, kept or refused with a code the copy catalogue can read."""
    holder = device["name"] if device else row["client_user"]
    current = next(
        (
            service
            for service in row["current_services"]
            if service["service_item"] == item
            and service["scope"] == scope
            and (service.get("managed_device") == device["name"] if device else True)
        ),
        None,
    )
    entry = _target(row, scope, device, current)

    if code == "service.add":
        if current:
            exclusions.append(_exclusion(row, "ALREADY_ACTIVE", device))
        elif not available:
            exclusions.append(_exclusion(row, "SERVICE_NOT_AVAILABLE", device))
        elif (item, scope, holder) in state["in_flight"]["additions"]:
            exclusions.append(_exclusion(row, "PENDING_CONFLICT", device))
        else:
            targets.append(entry)

        return

    if not current:
        exclusions.append(_exclusion(row, "NO_CURRENT_ASSIGNMENT", device))

        return

    if current["assignment"] in state["in_flight"]["touched"]:
        exclusions.append(_exclusion(row, "PENDING_CONFLICT", device))

        return

    if code not in operations.for_service_state(current["status"]):
        exclusions.append(
            _exclusion(row, "ALREADY_ACTIVE" if code == "service.resume" else "NOT_SUSPENDED", device)
        )

        return

    targets.append(entry)


def _device_domain(rows, state):
    """What can be asked of the machines the scope actually holds."""
    held = [
        {"device": device, "row": row}
        for row in rows
        for device in row["devices"]
        if row["usable"] and device["status"] == "Active"
    ]
    options = []

    if not held:
        return {"key": "Device", "label": "Devices", "options": options}

    people = sorted({entry["row"]["client_user"] for entry in held})

    for code in DEVICE_CODES:
        definition = operations.get(code)
        targets = [
            {
                "subject_key": entry["row"]["subject_key"],
                "client_user": entry["row"]["client_user"],
                "full_name": entry["row"]["full_name"],
                "target_scope": "Device",
                "managed_device": entry["device"]["name"],
                "device_label": entry["device"]["label"],
                "current_holder": entry["row"]["client_user"],
                "current_holder_label": entry["row"]["full_name"],
                "source_service_assignment": None,
            }
            for entry in held
        ]
        options.append(
            {
                "operation_code": code,
                "operation_label": definition["label"],
                "operation_label_snapshot": definition["label"],
                "object_key": None,
                "object_label": definition["label"],
                "targets": targets,
                "exclusions": [
                    _exclusion(row, "NO_CURRENT_DEVICE")
                    for row in rows
                    if row["usable"] and not [d for d in row["devices"] if d["status"] == "Active"]
                ],
                "applicable_target_count": len(targets),
                "applicable_subject_count": len(people),
                "excluded_subject_count": len(
                    [row for row in rows if not row["devices"] and row["usable"]]
                ),
                "device_count": len({entry["device"]["name"] for entry in held}),
                "holder_options": [
                    {"value": row["client_user"], "label": row["full_name"]}
                    for row in rows
                    if row["client_user"] and row["usable"]
                ],
            }
        )

    return {"key": "Device", "label": "Devices", "options": options}


def _target(row, scope, device, current):
    return {
        "subject_key": row["subject_key"],
        "client_user": row["client_user"],
        "full_name": row["full_name"],
        "department": row["department"],
        "target_scope": scope,
        "managed_device": device["name"] if device else None,
        "device_label": device["label"] if device else None,
        "source_service_assignment": current["assignment"] if current else None,
        "current_state": current["status"] if current else None,
    }


def _exclusion(row, code, device=None):
    return {
        "subject_key": row["subject_key"],
        "client_user": row["client_user"],
        "full_name": row["full_name"],
        "managed_device": device["name"] if device else None,
        "device_label": device["label"] if device else None,
        "current_state": None,
        "reason_code": code,
        "reason": REASON_TEXT.get(code, REASON_TEXT["NO_CURRENT_ASSIGNMENT"]),
    }
