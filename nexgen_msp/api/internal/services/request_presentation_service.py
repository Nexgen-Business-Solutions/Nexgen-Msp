import copy
import json

import frappe

from nexgen_msp.api.internal.services.request_service import (
    ACTIONS,
    CUSTOMER_STATUS,
    RequestService,
    effective_line_status,
)
from nexgen_msp.api.internal.services.requested_entity_presentation import (
    RequestedEntityPresentation,
)
from nexgen_msp.nexgen_msp.doctype.msp_request.msp_request import MODIFIED_COMMENT
from nexgen_msp.utils import operations, permissions, request_targets
from nexgen_msp.utils.errors import NotFoundError, ValidationError

REQUEST = "MSP Request"
WORK_ORDER = "MSP Work Order"
REQUESTED_CLIENT_USER = "MSP Requested Client User"
REQUESTED_DEVICE = "MSP Requested Device"

DONE_STATUSES = ("Completed", "Awaiting Verification")
CLOSED_STATUSES = ("Completed", "Rejected", "Cancelled")
REQUESTED_WORK = ("Service Action", "Device Operation")
HOLDER_CODES = ("device.assign", "device.transfer")

STATUS_TONE = {
    "Draft": "slate",
    CUSTOMER_STATUS: "amber",
    "Submitted": "blue",
    "Under Review": "blue",
    "Approved": "blue",
    "In Progress": "blue",
    "Completed": "emerald",
    "Rejected": "red",
    "Cancelled": "slate",
}

NEXGEN_STATUS = {
    "Draft": "Draft",
    CUSTOMER_STATUS: "Not submitted yet",
    "Submitted": "Submitted",
    "Under Review": "Under review",
    "Approved": "Approved",
    "In Progress": "In progress",
    "Cancelled": "Cancelled",
}

SERVICE_VERB = {
    "service.add": "Add",
    "service.change": "Change",
    "service.suspend": "Suspend",
    "service.resume": "Resume",
    "service.end": "End",
}

RESOLVED_NOTE = {
    ("client_user", "Create New"): "Created during fulfilment",
    ("client_user", "Use Existing"): "Existing Client User selected",
    ("device", "Use Existing"): "Existing Device selected",
    ("device", "Register New"): "Registered during fulfilment",
}

STATE_CHANGED = "Current state has changed since this request was submitted."

PERSON_FIELDS = ("full_name", "department", "email", "username", "external_employee_id", "start_date")
DEVICE_FIELDS = (
    "display_label",
    "device_type",
    "hostname",
    "serial_number",
    "asset_tag",
    "manufacturer",
    "model",
    "operating_system",
)


def _parsed(value, empty):
    if isinstance(value, str):
        value = frappe.parse_json(value) if value.strip() else None

    return value if value is not None else empty


def _day(value):
    if not value:
        return None

    day = frappe.utils.getdate(value)

    return f"{day.day} {day.strftime('%b %Y')}"


def _plural(count, one, many):
    return f"{count} {one if count == 1 else many}"


def _user_name(user):
    if not user:
        return None

    return frappe.db.get_value("User", user, "full_name") or user


class _Labels:
    """Display names read once per presentation."""

    def __init__(self):
        self.cache = {}

    def _get(self, doctype, name, field):
        if not name:
            return None

        key = (doctype, name, field)

        if key not in self.cache:
            self.cache[key] = frappe.db.get_value(doctype, name, field) or name

        return self.cache[key]

    def service(self, item):
        return self._get("Item", item, "item_name")

    def device(self, device):
        return self._get("MSP Managed Device", device, "hostname")

    def person(self, client_user):
        return self._get("MSP Client User", client_user, "full_name")


class RequestPresentationService:
    @staticmethod
    def for_portal(name=None):
        """A request as the customer reads it, answered only for the caller's own company."""
        from nexgen_msp.api.portal.services.portal_service import PortalService

        doc = RequestPresentationService._existing(name)
        PortalService._resolve_customer(doc.customer)

        if doc.status == "Draft" and doc.requester != frappe.session.user:
            raise NotFoundError(f"Request {name} does not exist.", "NOT_FOUND")

        return RequestPresentationService.for_request(doc.name, portal=True)

    @staticmethod
    def for_internal(name=None):
        """A request as Nexgen staff read it, behind the internal guard."""
        RequestService._guard_internal()
        doc = RequestPresentationService._existing(name)

        if (
            doc.status == CUSTOMER_STATUS
            or doc.refused_by_customer
            or (doc.status == "Draft" and doc.requester != frappe.session.user)
        ):
            raise NotFoundError(f"Request {name} not found.", "NOT_FOUND")

        return RequestPresentationService.for_request(doc.name)

    @staticmethod
    def _existing(name):
        if not name:
            raise ValidationError("name is required.", "VALIDATION_ERROR")

        if not frappe.db.exists(REQUEST, name):
            raise NotFoundError(f"Request {name} does not exist.", "NOT_FOUND")

        return frappe.get_doc(REQUEST, name)

    @staticmethod
    def for_request(name, portal=False):
        """The presentation of a persisted request: its intent, its decisions and its outcome."""
        doc = frappe.get_doc(REQUEST, name)
        labels = _Labels()
        entities = RequestedEntityPresentation.for_request(doc.name)
        people_entities = {row["name"]: row for row in entities if row["kind"] == "client_user"}
        machine_entities = {row["name"]: row for row in entities if row["kind"] == "device"}
        orders = frappe.get_all(
            WORK_ORDER,
            filters={"request": doc.name},
            fields=["name", "request_line_name", "status", "work_type", "origin"],
        )
        done_lines = {
            order.request_line_name for order in orders if order.request_line_name and order.status in DONE_STATUSES
        }
        cancelled_lines = {
            order.request_line_name for order in orders if order.request_line_name and order.status == "Cancelled"
        }

        people = {}

        for row in doc.get("subjects") or []:
            people[row.subject_key] = {
                "subject_key": row.subject_key,
                "full_name": row.full_name_snapshot,
                "department": row.department_snapshot,
                "kind": "new" if row.requested_client_user else "existing",
                "client_user": row.client_user,
                "requested_client_user": row.requested_client_user,
            }

        for line in doc.lines:
            key = RequestPresentationService._line_subject(line)

            if key and key not in people:
                requested = line.requested_client_user or line.requested_for_requested_client_user
                person = line.client_user or line.requested_for_user
                entity = people_entities.get(requested) or {}
                people[key] = {
                    "subject_key": key,
                    "full_name": entity.get("display_name") if requested else labels.person(person),
                    "department": None
                    if requested
                    else frappe.db.get_value("MSP Client User", person, "department"),
                    "kind": "new" if requested else "existing",
                    "client_user": None if requested else person,
                    "requested_client_user": requested,
                }

        machines = {}

        for entity in machine_entities.values():
            machines[entity["key"]] = {
                "key": entity["key"],
                "display_label": entity["display_name"],
                "open": entity["status"] == "Open",
            }

        machine_keys = {entity["name"]: entity["key"] for entity in machine_entities.values()}
        opened = {entity["name"] for entity in people_entities.values() if entity["status"] == "Open"}

        groups = []
        grouped = {}

        for group in doc.get("action_groups") or []:
            configuration = _parsed(group.configuration_snapshot_json, {}) or {}
            impact = _parsed(group.impact_snapshot_json, []) or []
            entry = {
                "group_key": group.group_key,
                "operation_code": group.operation_code,
                "domain": group.domain,
                "service_item": group.service_item,
                "source_scope_type": group.source_scope_type,
                "source_scope_label": group.source_scope_label,
                "selected_subject_count": group.selected_subject_count or 0,
                "configured": {
                    RequestPresentationService._target_key(target): target
                    for target in configuration.get("targets") or []
                },
                "exclusions": configuration.get("exclusions")
                or [row for row in impact if row.get("status") == "inapplicable"],
                "rows": [],
            }
            groups.append(entry)
            grouped[group.group_key] = entry

        for line in sorted(doc.lines, key=lambda row: row.idx):
            entry = grouped.get(line.action_group_key)

            if not entry:
                code = line.operation_code or operations.from_legacy_action(line.action) or "service.add"
                key = f"line:{code}:{line.requested_service or ''}"
                entry = grouped.get(key)

                if not entry:
                    entry = {
                        "group_key": key,
                        "operation_code": code,
                        "domain": "Device" if code.startswith("device.") else "Service",
                        "service_item": line.requested_service,
                        "source_scope_type": None,
                        "source_scope_label": None,
                        "selected_subject_count": 0,
                        "configured": {},
                        "exclusions": [],
                        "rows": [],
                    }
                    groups.append(entry)
                    grouped[key] = entry

            subject_key = RequestPresentationService._line_subject(line)
            requested_person = line.requested_client_user or line.requested_for_requested_client_user
            machine_key = None

            if line.requested_device:
                machine_key = (
                    machine_keys.get(line.requested_device) or line.device_requirement_key or line.requested_device
                )

            holder = None

            if line.requested_holder:
                holder = {"label": labels.person(line.requested_holder), "is_new": False, "open": False}
            elif line.requested_holder_requested_client_user:
                entity = people_entities.get(line.requested_holder_requested_client_user) or {}
                holder = {
                    "label": entity.get("display_name") or line.requested_holder_requested_client_user,
                    "is_new": True,
                    "open": line.requested_holder_requested_client_user in opened,
                }

            entry["rows"].append(
                {
                    "line_idx": line.idx,
                    "subject_key": subject_key,
                    "person_new": bool(requested_person) or (people.get(subject_key) or {}).get("kind") == "new",
                    "person_open": (requested_person or (people.get(subject_key) or {}).get("requested_client_user"))
                    in opened,
                    "target_scope": line.target_scope or "User",
                    "managed_device": line.managed_device,
                    "machine_key": machine_key,
                    "holder": holder,
                    "holder_subject_key": None,
                    "holder_requested": line.requested_holder_requested_client_user,
                    "holder_client_user": line.requested_holder,
                    "state_snapshot": _parsed(line.state_snapshot, {}) or {},
                    "configured": entry["configured"].get(
                        (subject_key, line.managed_device or machine_key or "")
                    )
                    or {},
                    "line_status": effective_line_status(line.line_status, doc.status),
                    "rejection_reason": line.rejection_reason,
                    "work_done": line.name in done_lines,
                    "work_cancelled": line.name in cancelled_lines,
                    "source_service_assignment": line.source_service_assignment,
                }
            )

        header = RequestPresentationService._header(doc, portal)
        presentation = RequestPresentationService._present(
            header,
            people,
            machines,
            groups,
            entities,
            labels,
            persisted=doc.status != "Draft",
            closed=doc.status in CLOSED_STATUSES,
        )
        presentation["fulfilment_outcome"] = RequestPresentationService._outcome(doc, orders, entities)

        if portal:
            for entity in presentation["requested_entities"]:
                entity["prepared_values"].pop("notes", None)

        return presentation

    @staticmethod
    def for_draft(
        customer=None,
        priority=None,
        details=None,
        requested_date=None,
        subjects=None,
        requested_devices=None,
        action_groups=None,
    ):
        """The presentation of what the builder holds, with nothing written."""
        from nexgen_msp.api.portal.services.portal_service import PortalService

        customer = PortalService._resolve_customer(customer)
        subjects = copy.deepcopy(_parsed(subjects, []))
        requested_devices = copy.deepcopy(_parsed(requested_devices, []))
        action_groups = copy.deepcopy(_parsed(action_groups, []))
        targets = [target for group in action_groups for target in group.get("targets") or []]

        PortalService._refuse_former_keys(subjects, requested_devices, action_groups, targets)

        drafted = PortalService._drafted_subjects(subjects)
        drafted_machines = PortalService._drafted_devices(requested_devices, drafted)
        PortalService._mint_group_devices(action_groups, drafted, drafted_machines)

        for row in drafted.values():
            RequestPresentationService._own("MSP Client User", row.get("client_user"), customer)

        for row in drafted_machines.values():
            RequestPresentationService._own("MSP Client User", row.get("intended_holder_client_user"), customer)

        for target in targets:
            RequestPresentationService._own("MSP Managed Device", target.get("managed_device"), customer)
            RequestPresentationService._own("MSP Client User", target.get("requested_holder"), customer)

        labels = _Labels()
        people = {}

        for key, row in drafted.items():
            existing = row["kind"] == "existing"
            record = (
                frappe.db.get_value(
                    "MSP Client User", row["client_user"], ["full_name", "department"], as_dict=True
                )
                if existing
                else None
            ) or {}
            people[key] = {
                "subject_key": key,
                "full_name": (row.get("full_name") or record.get("full_name") or row.get("client_user"))
                if not existing
                else (record.get("full_name") or row.get("full_name") or row["client_user"]),
                "department": row.get("department") or record.get("department"),
                "kind": row["kind"],
                "client_user": row.get("client_user") if existing else None,
                "requested_client_user": row.get("requested_client_user") if not existing else None,
                "draft": row,
            }

        machines = {}

        for key, row in drafted_machines.items():
            machines[key] = {
                "key": key,
                "display_label": RequestPresentationService._device_label(row),
                "open": True,
                "draft": row,
            }

        groups = []

        for group in action_groups:
            rows = []

            for target in group.get("targets") or []:
                subject = people.get(target.get("subject_key")) or {}
                holder_key = target.get("requested_holder_subject_key")
                holder = None

                if target.get("requested_holder"):
                    holder = {"label": labels.person(target["requested_holder"]), "is_new": False, "open": False}
                elif holder_key and holder_key in people:
                    new = people[holder_key]["kind"] == "new"
                    holder = {"label": people[holder_key]["full_name"], "is_new": new, "open": new}

                device = target.get("managed_device")
                code = group.get("operation_code") or ""
                rows.append(
                    {
                        "line_idx": None,
                        "subject_key": target.get("subject_key"),
                        "person_new": subject.get("kind") == "new",
                        "person_open": subject.get("kind") == "new",
                        "target_scope": target.get("target_scope") or "User",
                        "managed_device": device,
                        "machine_key": target.get("device_requirement_key"),
                        "holder": holder,
                        "holder_subject_key": holder_key,
                        "holder_requested": None,
                        "holder_client_user": target.get("requested_holder"),
                        "state_snapshot": operations.snapshot_device(device)
                        if device and code.startswith("device.")
                        else {},
                        "configured": target,
                        "line_status": None,
                        "rejection_reason": None,
                        "work_done": False,
                        "source_service_assignment": target.get("source_service_assignment"),
                    }
                )

            groups.append(
                {
                    "group_key": group.get("group_key"),
                    "operation_code": group.get("operation_code"),
                    "domain": group.get("domain") or "Service",
                    "service_item": group.get("service_item"),
                    "source_scope_type": group.get("source_scope_type"),
                    "source_scope_label": group.get("source_scope_label"),
                    "selected_subject_count": group.get("selected_subject_count") or 0,
                    "exclusions": group.get("exclusions") or [],
                    "rows": rows,
                }
            )

        entities = RequestPresentationService._draft_entities(people, machines, groups, labels)
        requester = frappe.session.user
        details = (details or "").strip() or None
        header = {
            "name": None,
            "status": "Draft",
            "customer": customer,
            "customer_name": frappe.db.get_value("Customer", customer, "customer_name"),
            "requester": requester,
            "requester_name": _user_name(requester),
            "requested_date": requested_date or None,
            "priority": priority or "Medium",
            "source": "Internal" if permissions.is_internal() else "Portal",
            "submitted_at": None,
            "details": details,
            "details_by": _user_name(requester) if details else None,
            "details_at": None,
            "customer_approval": RequestPresentationService._approval(None),
            "nexgen_status_label": NEXGEN_STATUS["Draft"],
            "rejection": None,
            "completed_at": None,
            "modified": None,
        }
        presentation = RequestPresentationService._present(
            header, people, machines, groups, entities, labels, persisted=False, closed=False
        )
        presentation["fulfilment_outcome"] = None

        return presentation

    @staticmethod
    def _own(doctype, name, customer):
        if name and frappe.db.get_value(doctype, name, "customer") != customer:
            raise ValidationError(request_targets.CROSS_CUSTOMER, "VALIDATION_ERROR")

    @staticmethod
    def _device_label(row):
        if row.get("display_label"):
            return row["display_label"]

        if row.get("hostname"):
            return row["hostname"]

        if row.get("device_type"):
            return f"New {row['device_type']}"

        return "New device"

    @staticmethod
    def _line_subject(line):
        if line.subject_key:
            return line.subject_key

        person = line.client_user or line.requested_for_user

        return f"user:{person}" if person else None

    @staticmethod
    def _target_key(target):
        return (
            target.get("subject_key"),
            target.get("managed_device") or target.get("device_requirement_key") or "",
        )

    @staticmethod
    def _draft_entities(people, machines, groups, labels):
        rows = [row for group in groups for row in group["rows"]]
        entities = []

        for key, person in people.items():
            if person["kind"] != "new":
                continue

            draft = person["draft"]
            related = [row for row in rows if row["subject_key"] == key or row["holder_subject_key"] == key]
            department = person["department"]
            entities.append(
                {
                    "kind": "client_user",
                    "name": person["requested_client_user"],
                    "key": key,
                    "display_name": person["full_name"],
                    "context_label": "Requested Client User" + (f" · {department}" if department else ""),
                    "status": "Open",
                    "readiness": "needs_review",
                    "badge": "NEW",
                    "resolved_to": None,
                    "requested_snapshot": {field: draft.get(field) for field in PERSON_FIELDS},
                    "prepared_values": {},
                    "requested_work_count": len(related),
                    "relationship_summary": [
                        f"{RequestPresentationService._machine_label(row, machines, labels)}: "
                        f"{RequestPresentationService._holder_before(row, labels) or 'Unassigned'} → {person['full_name']}"
                        for row in related
                        if row["holder_subject_key"] == key
                    ],
                }
            )

        for key, machine in machines.items():
            draft = machine["draft"]
            holder = labels.person(draft.get("intended_holder_client_user")) or (
                people.get(draft.get("intended_holder_subject_key")) or {}
            ).get("full_name")
            device_type = draft.get("device_type")
            entities.append(
                {
                    "kind": "device",
                    "name": draft.get("requested_device") or None,
                    "key": key,
                    "display_name": machine["display_label"],
                    "context_label": "Requested Device" + (f" · {device_type}" if device_type else ""),
                    "status": "Open",
                    "readiness": "needs_review",
                    "badge": "UNRESOLVED",
                    "resolved_to": None,
                    "requested_snapshot": {
                        **{field: draft.get(field) for field in DEVICE_FIELDS},
                        "display_label": machine["display_label"],
                    },
                    "prepared_values": {},
                    "requested_work_count": len([row for row in rows if row["machine_key"] == key]),
                    "relationship_summary": [f"Intended for {holder}"] if holder else [],
                }
            )

        return entities

    @staticmethod
    def _machine_label(row, machines, labels):
        if row["managed_device"]:
            return labels.device(row["managed_device"])

        if row["machine_key"]:
            return (machines.get(row["machine_key"]) or {}).get("display_label") or row["machine_key"]

        return "Device"

    @staticmethod
    def _holder_before(row, labels):
        holder = (row["state_snapshot"] or {}).get("current_holder") or (row["configured"] or {}).get(
            "current_holder"
        )

        return labels.person(holder) if holder else None

    @staticmethod
    def _present(header, people, machines, groups, entities, labels, persisted, closed):
        presented_groups = [
            RequestPresentationService._group(group, people, machines, labels, persisted, closed)
            for group in groups
        ]
        rows = [row for group in groups for row in group["rows"]]
        targets = [target for group in presented_groups for target in group["targets"]]
        open_entities = [entity for entity in entities if entity["status"] == "Open"]
        header["badges"] = [
            {"tone": STATUS_TONE.get(header["status"], "slate"), "label": header["status"].upper()},
            {"tone": "slate", "label": (header["priority"] or "").upper()},
        ]

        if open_entities:
            header["badges"].append(
                {"tone": "amber", "label": _plural(len(open_entities), "NEW ENTITY", "NEW ENTITIES")}
            )

        subjects = []

        for key, person in people.items():
            subjects.append(
                {
                    "subject_key": key,
                    "full_name": person["full_name"],
                    "department": person["department"],
                    "type": person["kind"],
                    "client_user": person["client_user"],
                    "requested_client_user": person["requested_client_user"],
                    "related_work_count": len(
                        [row for row in rows if RequestPresentationService._concerns(row, key, person)]
                    ),
                }
            )

        attention = []

        if not closed and any(target["state_changed"] for target in targets):
            attention.append(STATE_CHANGED)

        return {
            "request": header,
            "summary": {
                "people": len(people),
                "requested_actions": len(presented_groups),
                "concrete_targets": len(targets),
                "new_entities": len(entities),
            },
            "subjects": subjects,
            "action_groups": presented_groups,
            "requested_entities": entities,
            "attention": attention,
        }

    @staticmethod
    def _concerns(row, key, person):
        if row["subject_key"] == key or row["holder_subject_key"] == key:
            return True

        if person["requested_client_user"] and row["holder_requested"] == person["requested_client_user"]:
            return True

        return bool(person["client_user"]) and row["holder_client_user"] == person["client_user"]

    @staticmethod
    def _group(group, people, machines, labels, persisted, closed):
        code = group["operation_code"] or ""
        service = labels.service(group["service_item"])
        operation_label = (
            f"{SERVICE_VERB[code]} {service}" if code in SERVICE_VERB and service else operations.label(code)
        )
        targets = [
            RequestPresentationService._target(
                row, code, operation_label, service, people, machines, labels, persisted, closed
            )
            for row in group["rows"]
        ]
        reached = {row["subject_key"] for row in group["rows"]}
        unchanged = []

        for row in group["exclusions"]:
            key = row.get("subject_key")

            if key in reached or key in {entry["subject_key"] for entry in unchanged}:
                continue

            unchanged.append(
                {
                    "subject_key": key,
                    "person_label": (people.get(key) or {}).get("full_name") or row.get("full_name") or key,
                    "reason": row.get("reason") or RequestPresentationService._reason(row.get("reason_code")),
                }
            )

        count = len(targets)
        on_device = code.startswith("device.")
        requested_machines = [target for target in targets if target["target_kind"] == "requested_device"]
        all_requested = bool(targets) and len(requested_machines) == count
        scope = (
            group["source_scope_label"]
            if group["source_scope_type"] in ("Department", "Person") and group["source_scope_label"]
            else None
        )

        if on_device:
            names = {target["target_label"] for target in targets}
            context = [names.pop() if len(names) == 1 else scope, "Device operation"]
        elif targets and all(row["target_scope"] == "Device" for row in group["rows"]):
            context = [scope, "Device service"]
        else:
            context = [scope, "Personal service"]

        if all_requested:
            impact_label = _plural(count, "requested Device", "requested Devices")
        elif on_device:
            impact_label = _plural(count, "Device", "Devices")
        else:
            subjects = group["selected_subject_count"] or len(reached | {entry["subject_key"] for entry in unchanged})
            impact_label = f"{_plural(count, 'target', 'targets')} from {_plural(subjects, 'person', 'people')}"

        if unchanged:
            impact_detail = f"{len(unchanged)} left unchanged"
        elif on_device and targets and all(target["target_kind"] == "managed_device" for target in targets):
            impact_detail = "Existing Device" if count == 1 else "Existing Devices"
        else:
            impact_detail = None

        badges = []
        new_people = {target["subject_key"] for target in targets if target["person_is_new"]}

        if count > 1 and new_people:
            badges.append({"tone": "amber", "label": _plural(len(new_people), "NEW PERSON", "NEW PEOPLE")})

        if count > 1 and requested_machines:
            badges.append(
                {
                    "tone": "amber",
                    "label": "NEW DEVICE"
                    if len(requested_machines) == 1
                    else f"{len(requested_machines)} NEW DEVICES",
                }
            )

        if count > 1 and code in SERVICE_VERB and code != "service.add":
            badges.append({"tone": "slate", "label": "CURRENT ASSIGNMENTS"})

        relationship = None

        if code in HOLDER_CODES and count == 1 and targets[0]["relationship"]:
            relationship = dict(targets[0]["relationship"])

        return {
            "group_key": group["group_key"],
            "operation_code": code,
            "operation_label": operation_label,
            "domain": group["domain"] or ("Device" if on_device else "Service"),
            "context_label": " · ".join(part for part in context if part),
            "impact_label": impact_label,
            "impact_detail": impact_detail,
            "target_count": count,
            "unchanged_count": len(unchanged),
            "badges": badges,
            "relationship": relationship,
            "targets": targets,
            "unchanged": unchanged,
        }

    @staticmethod
    def _reason(code):
        from nexgen_msp.api.portal.services.request_scope_service import REASON_TEXT

        return REASON_TEXT.get(code) or "Left unchanged."

    @staticmethod
    def _target(row, code, operation_label, service, people, machines, labels, persisted, closed):
        person = people.get(row["subject_key"]) or {}
        configured = row["configured"] or {}

        if row["machine_key"]:
            machine = machines.get(row["machine_key"]) or {}
            kind = "requested_device"
            label = machine.get("display_label") or row["machine_key"]
            badge = "UNRESOLVED" if machine.get("open", True) else None
            state = None
        elif row["managed_device"]:
            kind = "managed_device"
            label = labels.device(row["managed_device"])
            badge = None
            state = None
        else:
            kind = "requested_client_user" if row["person_new"] else "client_user"
            label = f"{service} · Personal" if service else person.get("full_name") or row["subject_key"]
            badge = "NEW" if row["person_new"] and row["person_open"] else None
            state = None

        snapshot = row["state_snapshot"] or {}

        if kind == "managed_device" and code.startswith("device."):
            holder = snapshot.get("current_holder") or configured.get("current_holder")

            if holder:
                state = f"Held by {labels.person(holder)}"
            elif snapshot.get("device_status") == "Stock":
                state = "In stock"
            else:
                state = snapshot.get("device_status") or configured.get("current_state")
        elif state is None:
            state = configured.get("current_state") or ("Not assigned" if code == "service.add" else None)

        relationship = None

        if code in HOLDER_CODES and row["holder"]:
            to_is_new = bool(row["holder"]["is_new"] and row["holder"]["open"])
            relationship = {
                "from_label": RequestPresentationService._holder_before(row, labels) if kind == "managed_device" else None,
                "to_label": row["holder"]["label"],
                "to_is_new": to_is_new,
                "note": None,
            }

        return {
            "line_idx": row["line_idx"],
            "subject_key": row["subject_key"],
            "person_label": person.get("full_name"),
            "person_is_new": bool(row["person_new"]),
            "target_label": label,
            "target_kind": kind,
            "target_badge": badge,
            "operation_label": operation_label,
            "state_at_request": state,
            "state_changed": bool(persisted and not closed and not row["work_done"])
            and RequestPresentationService._changed(row, code, kind),
            "relationship": relationship,
            "line_status": row["line_status"],
            "rejection_reason": row["rejection_reason"],
            "work_cancelled": bool(row.get("work_cancelled")),
        }

    @staticmethod
    def _changed(row, code, kind):
        snapshot = row["state_snapshot"] or {}

        if kind == "managed_device" and code.startswith("device.") and snapshot:
            today = operations.snapshot_device(row["managed_device"])

            return (today.get("current_holder"), today.get("device_status")) != (
                snapshot.get("current_holder"),
                snapshot.get("device_status"),
            )

        then = (row["configured"] or {}).get("current_state")

        if row["source_service_assignment"] and then:
            return (
                frappe.db.get_value(
                    "MSP Service Assignment", row["source_service_assignment"], "operational_status"
                )
                != then
            )

        return False

    @staticmethod
    def _moments(doc):
        moments = []

        for version in frappe.get_all(
            "Version",
            filters={"ref_doctype": REQUEST, "docname": doc.name},
            fields=["data", "owner", "creation"],
            order_by="creation asc",
        ):
            data = json.loads(version.data or "{}")

            for field, before, after in data.get("changed") or []:
                if field == "status":
                    moments.append({"from": before, "to": after, "by": version.owner, "at": version.creation})

        return moments

    @staticmethod
    def _acted(doc, action):
        """Who moved the request along with this lifecycle action, and when, from the note it left."""
        rows = frappe.get_all(
            "Comment",
            filters={
                "comment_type": "Comment",
                "reference_doctype": REQUEST,
                "reference_name": doc.name,
                "content": ("like", f"{ACTIONS[action]['label']}%"),
            },
            fields=["owner", "creation"],
            order_by="creation desc",
            limit=1,
        )

        return {"by": rows[0].owner, "at": rows[0].creation} if rows else {}

    @staticmethod
    def _header(doc, portal):
        moments = RequestPresentationService._moments(doc)
        submitted_at = None

        if doc.status != "Draft":
            submitted_at = next(
                (moment["at"] for moment in moments if moment["from"] == "Draft"), doc.creation
            )

        completed_at = None

        if doc.status == "Completed":
            completed_at = RequestPresentationService._acted(doc, "complete").get("at") or next(
                (moment["at"] for moment in reversed(moments) if moment["to"] == "Completed"), None
            )

        rejection = None

        if doc.status == "Rejected":
            if doc.refused_by_customer:
                rejection = {
                    "reason": doc.rejection_reason or "",
                    "by": "customer",
                    "by_name": _user_name(doc.customer_approved_by),
                    "at": doc.customer_approved_at,
                }
            else:
                moment = RequestPresentationService._acted(doc, "reject") or next(
                    (moment for moment in reversed(moments) if moment["to"] == "Rejected"), {}
                )
                rejection = {
                    "reason": doc.rejection_reason or "",
                    "by": "nexgen",
                    "by_name": None if portal else _user_name(moment.get("by")),
                    "at": moment.get("at"),
                }

        if doc.status == "Completed":
            nexgen_status = f"Completed · {_day(completed_at)}" if completed_at else "Completed"
        elif doc.status == "Rejected":
            nexgen_status = (
                "Not sent to Nexgen"
                if doc.refused_by_customer
                else "Rejected" + (f" · {_day(rejection['at'])}" if rejection["at"] else "")
            )
        else:
            nexgen_status = NEXGEN_STATUS.get(doc.status, doc.status)

        details = (doc.details or "").strip() or None
        requester_name = _user_name(doc.requester)

        return {
            "name": doc.name,
            "status": doc.status,
            "customer": doc.customer,
            "customer_name": frappe.db.get_value("Customer", doc.customer, "customer_name"),
            "requester": doc.requester,
            "requester_name": requester_name,
            "requested_date": doc.get("requested_date"),
            "priority": doc.priority,
            "source": doc.source,
            "submitted_at": submitted_at,
            "details": details,
            "details_by": requester_name if details else None,
            "details_at": submitted_at if details else None,
            "customer_approval": RequestPresentationService._approval(doc),
            "nexgen_status_label": nexgen_status,
            "rejection": rejection,
            "completed_at": completed_at,
            "modified": RequestPresentationService._modified(doc),
        }

    @staticmethod
    def _modified(doc):
        """The last modification its requester made to the request after sending it."""
        rows = frappe.get_all(
            "Comment",
            filters={
                "comment_type": "Comment",
                "reference_doctype": REQUEST,
                "reference_name": doc.name,
                "content": MODIFIED_COMMENT,
            },
            fields=["owner", "creation"],
            order_by="creation desc",
            limit=1,
        )

        return {"by_name": _user_name(rows[0].owner), "at": rows[0].creation} if rows else None

    @staticmethod
    def _approval(doc):
        if doc is None or doc.status == "Draft":
            return {"state": "not_applicable", "by_name": None, "at": None, "label": "Not applicable yet"}

        if doc.status == CUSTOMER_STATUS:
            return {"state": "pending", "by_name": None, "at": None, "label": "Awaiting approval"}

        if not doc.customer_approved_by:
            return {"state": "not_applicable", "by_name": None, "at": None, "label": "Not required"}

        state = "rejected" if doc.refused_by_customer else "approved"
        by_name = _user_name(doc.customer_approved_by)
        parts = ["Rejected" if doc.refused_by_customer else "Approved", by_name, _day(doc.customer_approved_at)]

        return {
            "state": state,
            "by_name": by_name,
            "at": doc.customer_approved_at,
            "label": " · ".join(part for part in parts if part),
        }

    @staticmethod
    def _outcome(doc, orders, entities):
        work = [
            order for order in orders if order.work_type in REQUESTED_WORK and order.origin != "Technician"
        ]

        if not orders or doc.status != "Completed":
            return None

        completed = len([order for order in work if order.status in DONE_STATUSES])
        unresolved = len([order for order in work if order.status not in DONE_STATUSES + ("Cancelled",)])
        cancelled = len([order for order in work if order.status == "Cancelled"])

        badge = "COMPLETED"

        rows = []

        for entity in entities:
            resolved = entity["resolved_to"]
            context = "Requested Client User"

            if entity["kind"] == "device":
                prepared = entity["prepared_values"]
                holder = RequestedEntityPresentation._person_label(
                    prepared.get("intended_holder_client_user"),
                    prepared.get("intended_holder_requested_client_user"),
                )
                context = "Requested Device" + (f" for {holder}" if holder else "")

            rows.append(
                {
                    "kind": entity["kind"],
                    "display_name": entity["display_name"],
                    "context_label": context,
                    "badge": entity["badge"],
                    "resolved_label": resolved["label"] if resolved else None,
                    "resolved_note": RESOLVED_NOTE.get((entity["kind"], resolved["mode"])) if resolved else None,
                    "link": {"doctype": resolved["doctype"], "name": resolved["name"]} if resolved else None,
                }
            )

        return {
            "entities": rows,
            "work": {"completed": completed, "unresolved": unresolved, "cancelled": cancelled, "badge": badge},
        }
