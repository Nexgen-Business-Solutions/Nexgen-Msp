import frappe

from nexgen_msp.utils.meta import select_options

from nexgen_msp.utils import identifiers, permissions
from nexgen_msp.utils.errors import NotFoundError, ValidationError

ADMIN_ROLES = ("MSP System Admin", "System Manager", "Administrator")

DISPUTE_TYPE = "Billing Dispute"
# everyone who works the floor: everything but the money
TECHNICIAN_ROLES = ("MSP Technician",) + ADMIN_ROLES

OPEN_STATUSES = (
    "Draft",
    "Submitted",
    "Under Review",
    "Approved",
    "In Progress",
)

CLOSED_STATUSES = ("Completed", "Rejected", "Cancelled")

# a request still waiting for its own company's accord has not reached us: it stays out of
# every internal queue and every count until the customer has decided
CUSTOMER_STATUS = "Awaiting Customer Approval"

REQUEST_STATUSES = OPEN_STATUSES + CLOSED_STATUSES

REQUEST_TYPES = ("Add", "Change", "Suspend", "Resume", "Remove", "Mixed")

PRIORITIES = ("Low", "Medium", "High", "Urgent")

MAX_PAGE_LENGTH = 200

ACTIONS = {
    "start_review": {
        "label": "Start review",
        "from": ("Submitted",),
        "to": "Under Review",
        "roles": TECHNICIAN_ROLES,
        "stamp": None,
    },
    "approve": {
        "label": "Approve request",
        "from": ("Under Review",),
        "to": "Approved",
        "roles": TECHNICIAN_ROLES,
        "stamp": "review",
        "requires_decided_lines": True,
    },
    "start_work": {
        "label": "Start work",
        "from": ("Approved",),
        "to": "In Progress",
        "roles": TECHNICIAN_ROLES,
        "stamp": None,
    },
    "complete": {
        "label": "Mark completed",
        "from": ("In Progress",),
        "to": "Completed",
        "roles": TECHNICIAN_ROLES,
        "stamp": None,
        "requires_delivery_details": True,
    },
    "reject": {
        "label": "Reject",
        "from": OPEN_STATUSES,
        "to": "Rejected",
        "roles": TECHNICIAN_ROLES,
        "stamp": None,
        "needs_reason": True,
    },
    "cancel": {
        "label": "Cancel",
        "from": OPEN_STATUSES,
        "to": "Cancelled",
        "roles": ADMIN_ROLES,
        "stamp": None,
        "needs_reason": True,
    },
}

LINE_STATUSES = ("Pending", "Approved", "Rejected")

# a request can end before anyone ruled on its lines
ABANDONED_STATUSES = ("Cancelled", "Rejected")


def effective_line_status(line_status, request_status):
    """What a line actually came to, rather than the mark it was left with.

    A line nobody decided on a request that was cancelled or refused is not waiting for
    anything, and showing it as pending says the opposite of what happened.
    """
    if line_status == "Pending" and request_status in ABANDONED_STATUSES:
        return request_status

    return line_status


class RequestService:
    @staticmethod
    def _roles():
        return set(frappe.get_roles())

    @staticmethod
    def _guard_internal():
        if permissions.is_customer_contact() or not RequestService._roles().intersection(
            TECHNICIAN_ROLES
        ):
            raise ValidationError(
                "This workspace is reserved for Nexgen staff.", "PERMISSION_DENIED", 403
            )

    @staticmethod
    def _can(action):
        return bool(RequestService._roles().intersection(ACTIONS[action]["roles"]))

    @staticmethod
    def _allowed_actions(status):
        return [
            {"action": key, "label": spec["label"], "needs_reason": bool(spec.get("needs_reason"))}
            for key, spec in ACTIONS.items()
            if status in spec["from"] and RequestService._can(key)
        ]

    @staticmethod
    def get_filter_options():
        """Everything the request list filter bar needs to render itself."""
        RequestService._guard_internal()

        customers = frappe.get_all(
            "MSP Service Request", distinct=True, pluck="customer", order_by="customer asc"
        )

        return {
            "customers": [customer for customer in customers if customer],
            "statuses": [
                status
                for status in select_options("MSP Service Request", "status")
                if status != CUSTOMER_STATUS
            ],
            "open_statuses": list(OPEN_STATUSES),
            # only an administrator handles disputes, so only they can filter on them
            "request_types": (
                [*REQUEST_TYPES, DISPUTE_TYPE]
                if RequestService._roles().intersection(ADMIN_ROLES)
                else list(REQUEST_TYPES)
            ),
            "priorities": select_options("MSP Service Request", "priority"),
            "is_admin": bool(RequestService._roles().intersection(ADMIN_ROLES)),
        }

    @staticmethod
    def _list_conditions(search, status, priority, request_type, customer, scope):
        conditions = []
        params = {}

        # not ours until the customer has agreed to it
        conditions.append("sr.status != %(customer_status)s")
        params["customer_status"] = CUSTOMER_STATUS

        # a draft has not been sent: it belongs to whoever is still writing it
        conditions.append("(sr.status != 'Draft' or sr.requester = %(me)s)")
        params["me"] = frappe.session.user

        # turned down inside the company, before it was ever ours to look at
        conditions.append("ifnull(sr.refused_by_customer, 0) = 0")

        # a billing dispute is a commercial matter, so it stays out of the technician queue
        if not RequestService._roles().intersection(ADMIN_ROLES):
            conditions.append("sr.request_type != %(dispute_type)s")
            params["dispute_type"] = DISPUTE_TYPE

        if status:
            conditions.append("sr.status = %(status)s")
            params["status"] = status
        elif scope == "open":
            conditions.append("sr.status in %(open_statuses)s")
            params["open_statuses"] = OPEN_STATUSES
        elif scope == "closed":
            conditions.append("sr.status in %(closed_statuses)s")
            params["closed_statuses"] = CLOSED_STATUSES
        # the two cards on the queue header: what needs attention first, and what has waited
        # too long — the very predicates their counters are made of
        elif scope == "attention":
            conditions.append("sr.status in %(open_statuses)s and sr.priority in ('Urgent', 'High')")
            params["open_statuses"] = OPEN_STATUSES
        elif scope == "ageing":
            conditions.append(
                "sr.status in %(open_statuses)s and timestampdiff(hour, sr.creation, now()) > 48"
            )
            params["open_statuses"] = OPEN_STATUSES
        elif scope == "to_execute":
            # approved work nobody has delivered yet: the dashboard's card, as a queue
            conditions.append(
                """sr.status in ('Approved', 'In Progress')
                   and exists (
                       select 1 from `tabMSP Service Request Line` srl
                       where srl.parent = sr.name and srl.line_status = 'Approved'
                         and not exists (
                             select 1 from `tabMSP Service Assignment` sa
                             left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                             where sa.source_request = srl.parent
                               and sa.service_item = srl.requested_service
                               and (srl.client_user is null or srl.client_user = ''
                                    or sa.client_user = srl.client_user
                                    or sad.assigned_client_user = srl.client_user)
                         )
                   )"""
            )

        if scope == "mine":
            conditions.append(
                "sr.status in %(open_statuses)s and %(user)s in (sr.technical_approved_by, sr.owner)"
            )
            params["open_statuses"] = OPEN_STATUSES
            params["user"] = frappe.session.user

        if priority:
            conditions.append("sr.priority = %(priority)s")
            params["priority"] = priority

        if request_type:
            conditions.append("sr.request_type = %(request_type)s")
            params["request_type"] = request_type

        if customer:
            conditions.append("sr.customer = %(customer)s")
            params["customer"] = customer

        if search:
            conditions.append(
                """(
                    sr.name like %(search)s
                    or sr.customer like %(search)s
                    or exists (
                        select 1 from `tabMSP Service Request Line` srl
                        left join `tabMSP Client User` cu on cu.name = srl.client_user
                        where srl.parent = sr.name
                          and (cu.full_name like %(search)s or srl.new_user_full_name like %(search)s)
                    )
                )"""
            )
            params["search"] = f"%{search}%"

        return (" where " + " and ".join(conditions)) if conditions else "", params

    @staticmethod
    def list_requests(
        search=None,
        status=None,
        priority=None,
        request_type=None,
        customer=None,
        scope=None,
        start=0,
        page_length=20,
    ):
        """Request queue, ranked so the work that waits longest surfaces first."""
        RequestService._guard_internal()

        start = max(frappe.utils.cint(start), 0)
        page_length = min(max(frappe.utils.cint(page_length) or 20, 1), MAX_PAGE_LENGTH)

        where, params = RequestService._list_conditions(
            search, status, priority, request_type, customer, scope
        )

        total = frappe.db.sql(f"select count(*) from `tabMSP Service Request` sr {where}", params)[0][0]

        rows = frappe.db.sql(
            f"""
            select
                sr.name,
                sr.customer,
                sr.request_type,
                sr.status,
                sr.priority,
                sr.source,
                sr.requester,
                sr.billing_run,
                sr.creation,
                sr.modified,
                (select count(*) from `tabMSP Service Request Line` srl where srl.parent = sr.name)
                    as line_count,
                (select count(*) from `tabMSP Service Request Line` srl
                    where srl.parent = sr.name and srl.line_status = 'Pending') as pending_lines,
                coalesce(
                    (select group_concat(distinct coalesce(cu.full_name, srl.new_user_full_name)
                        order by srl.idx separator ', ')
                        from `tabMSP Service Request Line` srl
                        left join `tabMSP Client User` cu on cu.name = srl.client_user
                        where srl.parent = sr.name),
                    -- a dispute carries no service line, so whoever raised it is the person
                    (select u.full_name from `tabUser` u where u.name = sr.requester)
                ) as users,
                timestampdiff(hour, sr.creation, now()) as age_hours
            from `tabMSP Service Request` sr
            {where}
            order by sr.creation desc
            limit {page_length} offset {start}
            """,
            params,
            as_dict=True,
        )

        return {
            "rows": rows,
            "start": start,
            "page_length": page_length,
            "total": total,
            "has_more": start + len(rows) < total,
        }

    @staticmethod
    def get_stats(
        search=None, status=None, priority=None, request_type=None, customer=None, scope=None
    ):
        """Counters for the queue header, over the same scope the list is showing."""
        RequestService._guard_internal()

        where, params = RequestService._list_conditions(
            search, status, priority, request_type, customer, scope
        )

        rows = frappe.db.sql(
            f"""
            select sr.status, sr.priority, count(*) as total,
                   sum(timestampdiff(hour, sr.creation, now()) > 48) as ageing
            from `tabMSP Service Request` sr
            {where}
            group by sr.status, sr.priority
            """,
            params,
            as_dict=True,
        )

        by_status = {}
        open_total = 0
        urgent_open = 0
        ageing_open = 0

        for row in rows:
            by_status[row.status] = by_status.get(row.status, 0) + row.total
            if row.status in OPEN_STATUSES:
                open_total += row.total
                ageing_open += frappe.utils.cint(row.ageing)
                if row.priority in ("Urgent", "High"):
                    urgent_open += row.total

        return {
            "open": open_total,
            "urgent_open": urgent_open,
            "ageing_open": ageing_open,
            "under_review": by_status.get("Under Review", 0),
            "awaiting_review": by_status.get("Submitted", 0),
            "in_progress": by_status.get("In Progress", 0),
            "completed": by_status.get("Completed", 0),
            "by_status": by_status,
        }

    @staticmethod
    def get_request(name=None):
        RequestService._guard_internal()

        if not name:
            raise ValidationError("name is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Service Request", name):
            raise NotFoundError(f"Service Request {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Service Request", name)

        # not ours until the customer has agreed to it, whatever the address bar says
        if doc.status == CUSTOMER_STATUS:
            raise NotFoundError(f"Service Request {name} not found.", "NOT_FOUND")

        if doc.status == "Draft" and doc.requester != frappe.session.user:
            raise NotFoundError(f"Service Request {name} not found.", "NOT_FOUND")

        if doc.refused_by_customer:
            raise NotFoundError(f"Service Request {name} not found.", "NOT_FOUND")

        lines = frappe.db.sql(
            """
            select
                srl.idx, srl.action, srl.request_action,
                coalesce(ra.title, srl.action) as action_label,
                ra.description as action_description,
                srl.target_scope, srl.is_new_user,
                srl.client_user,
                coalesce(cu.full_name, holder.full_name) as client_user_name,
                coalesce(cu.department, holder.department) as client_user_department,
                srl.new_user_full_name, srl.new_user_department, srl.new_user_email,
                srl.new_user_username,
                srl.needs_portal_access,
                srl.is_new_device, srl.new_device_label, srl.new_device_type,
                srl.new_device_serial,
                srl.managed_device, device.hostname as device_hostname,
                device.serial_number as device_serial, device.device_type as device_type,
                -- the person a device line is really about, so their profile stays one click away
                device.assigned_client_user as device_holder,
                coalesce(cu.username, holder.username) as client_username,
                srl.requested_service, item.item_name as requested_service_name,
                srl.requested_quantity, srl.requested_effective_date,
                srl.comment, srl.line_status, srl.rejection_reason
            from `tabMSP Service Request Line` srl
            left join `tabMSP Client User` cu on cu.name = srl.client_user
            left join `tabMSP Managed Device` device on device.name = srl.managed_device
            left join `tabMSP Client User` holder on holder.name = device.assigned_client_user
            left join `tabItem` item on item.name = srl.requested_service
            left join `tabMSP Request Action` ra on ra.name = srl.request_action
            where srl.parent = %(parent)s
            order by srl.idx asc
            """,
            {"parent": name},
            as_dict=True,
        )

        for line in lines:
            line["line_status"] = effective_line_status(line.get("line_status"), doc.status)

            # said per line so the technician sees what is still owed before being refused
            # a closure for it
            scope = RequestService._service_scope(line.get("requested_service"))
            line["needs_serial"] = bool(
                scope in ("Device", "Both")
                and line.get("managed_device")
                and not (line.get("device_serial") or "").strip()
            )
            line["needs_username"] = bool(
                scope in ("User", "Both")
                and line.get("client_user")
                and not (line.get("client_username") or "").strip()
            )

        return {
            "name": doc.name,
            "customer": doc.customer,
            "billing_run": doc.billing_run,
            "request_type": doc.request_type,
            "status": doc.status,
            "priority": doc.priority,
            "source": doc.source,
            "requester": doc.requester,
            "requester_name": frappe.db.get_value("User", doc.requester, "full_name")
            if doc.requester
            else None,
            "creation": doc.creation,
            "modified": doc.modified,
            "reviewed_by": frappe.db.get_value("User", doc.technical_approved_by, "full_name")
            if doc.technical_approved_by
            else None,
            "reviewed_at": doc.technical_approved_at,
            "rejection_reason": doc.rejection_reason,
            "lines": lines,
            "available_actions": RequestService._allowed_actions(doc.status),
            "can_decide_lines": doc.status == "Under Review" and RequestService._can("approve"),
            "review": RequestService._review_checks(doc),
        }

    @staticmethod
    def run_action(name=None, action=None, reason=None):
        """Move a request along its lifecycle, refusing transitions the role may not perform."""
        RequestService._guard_internal()

        if not name:
            raise ValidationError("name is required.", "VALIDATION_ERROR")

        spec = ACTIONS.get(action)
        if not spec:
            raise ValidationError(f"Unknown action '{action}'.", "VALIDATION_ERROR")

        if not RequestService._can(action):
            raise ValidationError(
                f"Your role cannot {spec['label'].lower()}.", "PERMISSION_DENIED", 403
            )

        if not frappe.db.exists("MSP Service Request", name):
            raise NotFoundError(f"Service Request {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Service Request", name)

        if doc.status not in spec["from"]:
            raise ValidationError(
                f"A request in status '{doc.status}' cannot be moved to '{spec['to']}'.",
                "INVALID_TRANSITION",
            )

        reason = (reason or "").strip()
        if spec.get("needs_reason") and not reason:
            raise ValidationError("A reason is required.", "VALIDATION_ERROR")

        if spec.get("requires_decided_lines"):
            pending = [row.idx for row in doc.lines if row.line_status == "Pending"]
            if pending:
                raise ValidationError(
                    f"Decide every line first. Still pending: {', '.join(str(i) for i in pending)}.",
                    "VALIDATION_ERROR",
                )

        if spec.get("requires_delivery_details"):
            RequestService._guard_delivery_details(doc)

        doc.status = spec["to"]

        # a request that ends without a ruling leaves its undecided lines nowhere: they
        # close on the outcome the request itself came to, and a line already decided
        # keeps the verdict someone gave it
        if doc.status in ABANDONED_STATUSES:
            for row in doc.lines:
                if row.line_status == "Pending":
                    row.line_status = doc.status

        if spec["stamp"] == "review":
            doc.technical_approved_by = frappe.session.user
            doc.technical_approved_at = frappe.utils.now()

        if reason:
            doc.rejection_reason = reason

        doc.save()
        doc.add_comment("Comment", f"{spec['label']}{': ' + reason if reason else ''}")
        frappe.db.commit()

        RequestService._notify_requester(doc, action, reason)

        return RequestService.get_request(name)

    @staticmethod
    def set_line_status(name=None, idx=None, line_status=None, reason=None):
        """Approve or reject one line without touching the others."""
        RequestService._guard_internal()

        if not RequestService._can("approve"):
            raise ValidationError("Your role cannot decide request lines.", "PERMISSION_DENIED", 403)

        if not name or not idx:
            raise ValidationError("name and idx are required.", "VALIDATION_ERROR")

        if line_status not in LINE_STATUSES:
            raise ValidationError(f"Unknown line status '{line_status}'.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Service Request", name):
            raise NotFoundError(f"Service Request {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Service Request", name)

        if doc.status == CUSTOMER_STATUS:
            raise NotFoundError(f"Service Request {name} not found.", "NOT_FOUND")

        if doc.status in CLOSED_STATUSES:
            raise ValidationError(
                f"Request {name} is {doc.status.lower()} and can no longer be edited.",
                "INVALID_TRANSITION",
            )

        idx = frappe.utils.cint(idx)
        row = next((line for line in doc.lines if line.idx == idx), None)

        if not row:
            raise NotFoundError(f"Line {idx} not found on {name}.", "NOT_FOUND")

        reason = (reason or "").strip()
        if line_status == "Rejected" and not reason:
            raise ValidationError("A reason is required to reject a line.", "VALIDATION_ERROR")

        row.line_status = line_status
        row.rejection_reason = reason or None

        doc.save()
        frappe.db.commit()

        return RequestService.get_request(name)

    @staticmethod
    def _service_scope(service_item):
        """Declared on the Item; older services fall back to how they are already assigned."""
        declared = frappe.db.get_value("Item", service_item, "msp_service_scope")

        if declared:
            return declared

        row = frappe.db.sql(
            """
            select assignment_scope, count(*) as total
            from `tabMSP Service Assignment`
            where service_item = %(item)s
            group by assignment_scope
            order by total desc
            limit 1
            """,
            {"item": service_item},
            as_dict=True,
        )
        return row[0].assignment_scope if row else "User"

    @staticmethod
    def _find_open_assignment(customer, client_user, service_item):
        """The assignment a Change/Suspend/Resume/Remove line acts upon."""
        found = frappe.db.sql(
            """
            select sa.name
            from `tabMSP Service Assignment` sa
            left join `tabMSP Managed Device` device on device.name = sa.managed_device
            where sa.customer = %(customer)s
              and sa.service_item = %(service_item)s
              and sa.operational_status in ('Pending Setup', 'Active', 'Suspended', 'Pending Removal')
              and (sa.client_user = %(client_user)s or device.assigned_client_user = %(client_user)s)
            order by sa.effective_start_date desc
            limit 1
            """,
            {
                "customer": customer,
                "service_item": service_item,
                "client_user": client_user or "",
            },
        )
        return found[0][0] if found else None

    @staticmethod
    def _resolve_device(
        customer,
        client_user,
        device_mode,
        managed_device,
        hostname,
        device_type,
        interfaces,
        serial_number=None,
    ):
        if device_mode == "existing":
            if not managed_device:
                raise ValidationError("Select a device.", "VALIDATION_ERROR")

            device = frappe.get_doc("MSP Managed Device", managed_device)

            if device.customer != customer:
                raise ValidationError(
                    f"Device {managed_device} does not belong to {customer}.", "VALIDATION_ERROR"
                )

            if client_user and not device.assigned_client_user:
                device.assigned_client_user = client_user

            if device_type:
                device.device_type = device_type

            if interfaces:
                known = {
                    (interface.mac_address or "").upper() for interface in device.network_interfaces
                }
                for interface in interfaces:
                    mac = (interface.get("mac_address") or "").strip().upper()
                    if mac and mac not in known:
                        device.append(
                            "network_interfaces",
                            {
                                "interface_type": interface.get("interface_type") or "Other",
                                "mac_address": mac,
                            },
                        )

            device.save()
            return device.name

        if device_mode == "new":
            if not hostname:
                raise ValidationError("A hostname is required for a new device.", "VALIDATION_ERROR")

            # the serial number is what tells two machines apart, whatever the door the
            # machine comes in through
            serial_number = (serial_number or "").strip()

            if not serial_number:
                raise ValidationError(
                    "A serial number is required: it is what identifies the machine.",
                    "VALIDATION_ERROR",
                )

            twin = frappe.db.get_value(
                "MSP Managed Device",
                {"serial_number": serial_number},
                ["hostname", "customer"],
                as_dict=True,
            )

            if twin:
                raise ValidationError(
                    f"Serial number {serial_number} is already on {twin.hostname} "
                    f"({twin.customer}).",
                    "VALIDATION_ERROR",
                )

            device = frappe.get_doc(
                {
                    "doctype": "MSP Managed Device",
                    "customer": customer,
                    "holder_log": [{"client_user": client_user}] if client_user else [],
                    "hostname": hostname.strip().upper(),
                    "serial_number": serial_number,
                    "device_type": device_type or "Other",
                    "status": "Active",
                    "assigned_date": frappe.utils.today(),
                    "network_interfaces": [
                        {
                            "interface_type": interface.get("interface_type") or "Other",
                            "mac_address": (interface.get("mac_address") or "").strip().upper(),
                        }
                        for interface in interfaces
                    ],
                }
            ).insert()

            return device.name

        return None


    @staticmethod
    def set_delivery_detail(name=None, idx=None, serial_number=None, username=None):
        """Record, from the request itself, what the technician found on the bench.

        The closure is refused without these two facts, so they are collected where the
        work is being done rather than on another screen.
        """
        RequestService._guard_internal()

        if not name or not idx:
            raise ValidationError("name and idx are required.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Service Request", name):
            raise NotFoundError(f"Service Request {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Service Request", name)

        if doc.status in CLOSED_STATUSES or doc.status == CUSTOMER_STATUS:
            raise ValidationError(
                f"Request {name} is {doc.status.lower()} and can no longer be edited.",
                "INVALID_TRANSITION",
            )

        row = next((line for line in doc.lines if line.idx == frappe.utils.cint(idx)), None)

        if not row:
            raise NotFoundError(f"Line {idx} does not exist on {name}.", "NOT_FOUND")

        serial = (serial_number or "").strip()
        account = (username or "").strip()

        if serial:
            device = row.managed_device

            if not device:
                raise ValidationError("This line carries no machine.", "VALIDATION_ERROR")

            identifiers.record_serial(device, serial, overwrite=True)

        if account:
            person = row.client_user

            if not person:
                raise ValidationError("This line carries no person.", "VALIDATION_ERROR")

            identifiers.record_username(person, account, overwrite=True)

        frappe.db.commit()

        return RequestService.get_request(name)

    @staticmethod
    def _guard_delivery_details(doc):
        """What a technician must hold before a request can be called done.

        The customer is not asked for either of these when they raise the request — they
        rarely know them. They are collected while the work is carried out, and this is the
        gate that stops a request being closed without them.

        What is required follows the scope the service is sold under. A service that lands
        on a machine needs that machine's serial number; one that licenses a person needs
        their account name; one sold against both needs both. The scope is a catalogue
        fact, so the rule reads it there rather than from a list written here.
        """
        missing = []

        for row in doc.lines:
            if row.line_status in ("Rejected", "Cancelled"):
                continue

            # a person or a machine the customer asked us to create has to exist before the
            # request that asked for them can be called done
            if row.is_new_user and not row.client_user:
                missing.append(f"line {row.idx}: {row.new_user_full_name} has not been created")
                continue

            if row.is_new_device and not row.managed_device:
                missing.append(f"line {row.idx}: {row.new_device_label} has not been registered")
                continue

            scope = RequestService._service_scope(row.requested_service)
            service = frappe.db.get_value("Item", row.requested_service, "item_name")

            if scope in ("Device", "Both"):
                device = row.managed_device

                if device and not (
                    frappe.db.get_value("MSP Managed Device", device, "serial_number") or ""
                ).strip():
                    hostname = frappe.db.get_value("MSP Managed Device", device, "hostname")
                    missing.append(f"line {row.idx}: {hostname} has no serial number for {service}")

            if scope in ("User", "Both"):
                person = row.client_user

                if person and not (
                    frappe.db.get_value("MSP Client User", person, "username") or ""
                ).strip():
                    full_name = frappe.db.get_value("MSP Client User", person, "full_name")
                    missing.append(f"line {row.idx}: {full_name} has no username for {service}")

        if missing:
            raise ValidationError(
                "This request cannot be closed yet — " + "; ".join(missing) + ".",
                "VALIDATION_ERROR",
            )

    @staticmethod
    def _review_checks(doc):
        """The commercial half of a review: contract, rate, duplicates — per line."""
        if doc.status not in ("Submitted", "Under Review"):
            return None

        from nexgen_msp.api.internal.services.contract_service import ContractService

        is_admin = bool(RequestService._roles().intersection(ADMIN_ROLES))

        # the live contract is what says a service is covered, and Item Price what it costs
        contract = frappe.db.sql(
            """
            select name, title, status, currency
            from `tabMSP Contract`
            where customer = %(customer)s and status in ('Active', 'Suspended')
            order by (status = 'Active') desc, start_date desc
            limit 1
            """,
            {"customer": doc.customer},
            as_dict=True,
        )
        contract = contract[0] if contract else None

        covered = set()
        if contract:
            covered = set(
                frappe.get_all(
                    "MSP Contract Service", filters={"parent": contract.name}, pluck="service_item"
                )
            )

        lines = []

        for row in doc.lines:
            in_contract = row.requested_service in covered
            rate_row = (
                ContractService.current_rate(doc.customer, row.requested_service)
                if in_contract
                else None
            )
            priced = bool(rate_row and (rate_row.price_list_rate or 0) > 0)

            duplicate = None
            if row.action == "Add":
                if row.managed_device:
                    duplicate = frappe.db.get_value(
                        "MSP Service Assignment",
                        {
                            "managed_device": row.managed_device,
                            "service_item": row.requested_service,
                            "operational_status": (
                                "in",
                                ("Pending Setup", "Active", "Suspended", "Pending Removal"),
                            ),
                        },
                        "name",
                    )
                elif row.client_user:
                    duplicate = RequestService._find_open_assignment(
                        doc.customer, row.client_user, row.requested_service
                    )

            lines.append(
                {
                    "idx": row.idx,
                    "in_contract": in_contract,
                    "priced": priced,
                    "rate": rate_row.price_list_rate if (priced and is_admin) else None,
                    "duplicate": duplicate,
                }
            )

        return {
            "has_contract": bool(contract),
            "contract": contract.name if contract else None,
            "contract_status": contract.status if contract else None,
            "contract_active": bool(contract and contract.status == "Active"),
            "currency": contract.currency if contract else None,
            "shows_rates": is_admin,
            "lines": lines,
        }


    @staticmethod
    def _people_to_tell(doc):
        """Who at the customer should hear what became of this request.

        Whoever raised it from the portal, and the people it is actually about — a request
        we opened on a customer's behalf still has to reach them, and that is most of them.

        Our own staff are left out: they are the ones deciding, and telling them by email
        what they have just done in front of them is noise.
        """
        addresses = []

        if doc.source == "Portal" and doc.requester:
            addresses.append(doc.requester)

        # the people a request is about no longer sign in — a seat we service and a login
        # are separate things — so the company hears through the accounts it holds
        addresses.extend(
            frappe.db.sql_list(
                """
                select distinct up.user
                from `tabUser Permission` up
                join `tabUser` u on u.name = up.user
                where up.allow = 'Customer' and up.for_value = %(customer)s and u.enabled = 1
                """,
                {"customer": doc.customer},
            )
        )

        return [
            address
            for address in dict.fromkeys(addresses)
            if address and not permissions.is_internal(address)
        ]

    @staticmethod
    def _notify_requester(doc, action, reason=None):
        """Tell the customer what became of their request. Never let mail break the transition."""
        from nexgen_msp.utils import notifications

        people = RequestService._people_to_tell(doc)

        if not people:
            return

        decided = {
            "approve": ("approved", "Your request has been approved and is now being carried out."),
            "reject": ("declined", "After review, we are not able to carry out this request."),
            "cancel": ("cancelled", "This request has been cancelled."),
        }

        if action not in decided and action != "complete":
            return

        approved = sum(1 for row in doc.lines if row.line_status == "Approved")
        declined = sum(1 for row in doc.lines if row.line_status == "Rejected")

        summary = notifications.summary_table(
            [
                ("Request", doc.name),
                ("Services requested", str(len(doc.lines))),
                ("Approved", str(approved)),
                ("Declined", str(declined)),
            ]
        )

        context = {
            "request": doc.name,
            "summary": summary,
            "link": notifications.portal_url(f"/requests/{doc.name}"),
        }

        def tell(template):
            # one mail each, so everyone is greeted by their own name
            for address in people:
                notifications.send(
                    template,
                    [address],
                    {
                        **context,
                        "full_name": frappe.db.get_value("User", address, "full_name") or address,
                    },
                    reference_doctype="MSP Service Request",
                    reference_name=doc.name,
                )

        if action == "complete":
            tell("MSP Request Completed")
            return

        outcome, headline = decided[action]
        context["outcome"] = outcome
        context["headline"] = headline
        context["reason_block"] = (
            f'<div style="margin:16px 0;padding:12px 14px;background:#fef2f2;'
            f'border:1px solid #fecaca;border-radius:10px;color:#991b1b;font-size:13px;">'
            f"<strong>Why:</strong> {frappe.utils.escape_html(reason)}</div>"
            if reason
            else ""
        )

        tell("MSP Request Decision")
