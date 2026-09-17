import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.utils import identifiers
from nexgen_msp.utils import remarks as remarks_util

from nexgen_msp.utils.meta import select_options


from nexgen_msp.api.internal.services.request_service import (
    ADMIN_ROLES,
    RequestService,
)
from nexgen_msp.utils.errors import NotFoundError, ValidationError
from nexgen_msp.utils.assignments import OPEN_ASSIGNMENT_STATUSES


LIFECYCLE_STATUSES = ("Pending", "Active", "Disabled", "Archived")

MAX_PAGE_LENGTH = 200

COVERAGE_FILTERS = (
    "no_device",
    "no_personal_service",
    "no_service",
    "disabled_with_services",
    "open_requests",
    "needs_attention",
)

# what the 360 view flags, said once in SQL so the register and the page agree
NEEDS_ATTENTION = """(
    exists (
        select 1 from `tabMSP Managed Device` device
        where device.assigned_client_user = cu.name
          and ifnull(device.serial_number, '') = ''
    )
    or (
        cu.lifecycle_status in ('Disabled', 'Archived')
        and (
            exists (
                select 1 from `tabMSP Service Assignment` sa
                where sa.client_user = cu.name and sa.operational_status in %(open)s
            )
            or exists (
                select 1 from `tabMSP Managed Device` device
                where device.assigned_client_user = cu.name
            )
        )
    )
    or (
        ifnull(cu.username, '') = ''
        and exists (
            select 1 from `tabMSP Service Assignment` sa
            where sa.client_user = cu.name and sa.assignment_scope = 'User'
              and sa.operational_status in %(open)s
        )
    )
)"""

# a request still waiting inside the customer's own company has not reached us
OPEN_REQUEST_FOR = """exists (
    select 1
    from `tabMSP Service Request Line` srl
    join `tabMSP Service Request` sr on sr.name = srl.parent
    where (srl.client_user = cu.name or srl.requested_for_user = cu.name)
      and sr.status in ('Submitted', 'Under Review', 'Approved', 'In Progress')
)"""

class UserService:
    @staticmethod
    def get_filter_options():
        """Options for the user register filter bar."""
        RequestService._guard_internal()

        departments = frappe.db.sql_list(
            """
            select distinct department from `tabMSP Client User`
            where department is not null and department != ''
            order by department asc
            """
        )

        services = frappe.db.sql(
            """
            select distinct sa.service_item as value,
                   coalesce(item.item_name, sa.service_item) as label
            from `tabMSP Service Assignment` sa
            left join `tabItem` item on item.name = sa.service_item
            order by label asc
            """,
            as_dict=True,
        )

        return {
            "customers": frappe.get_all("Customer", pluck="name", order_by="name asc"),
            "departments": departments,
            "services": services,
            "statuses": select_options("MSP Client User", "lifecycle_status"),
            "coverage": list(COVERAGE_FILTERS),
        }

    @staticmethod
    def get_stats(
        search=None,
        customer=None,
        status=None,
        department=None,
        service=None,
        coverage=None,
    ):
        """Counters a technician acts on, over the same scope the list is showing.

        They share the list's own WHERE clause: a figure that ignored the filters would
        contradict the rows underneath it, and the cards double as shortcuts into that very
        list.
        """
        RequestService._guard_internal()

        where, params = UserService._conditions(
            search, customer, status, department, service, coverage
        )
        params = {**params}

        def count(predicate):
            clause = f"{where} and {predicate}" if where else f" where {predicate}"
            return frappe.db.sql(
                f"select count(distinct cu.name) from `tabMSP Client User` cu {clause}", params
            )[0][0]

        active = count("cu.lifecycle_status = 'Active'")

        without_device = count(
            """cu.lifecycle_status = 'Active'
               and not exists (
                   select 1 from `tabMSP Managed Device` device
                   where device.assigned_client_user = cu.name and device.status = 'Active'
               )"""
        )

        disabled_with_services = count(
            """cu.lifecycle_status in ('Disabled', 'Archived')
               and exists (
                   select 1 from `tabMSP Service Assignment` sa
                   left join `tabMSP Managed Device` device on device.name = sa.managed_device
                   where sa.operational_status in %(open)s
                     and (sa.client_user = cu.name or device.assigned_client_user = cu.name)
               )"""
        )

        # the people whose machine runs nothing — the same rows the "no_service" coverage lists
        users_with_idle_device = count(
            """cu.lifecycle_status = 'Active'
               and exists (
                   select 1 from `tabMSP Managed Device` device
                   where device.assigned_client_user = cu.name and device.status = 'Active'
                     and not exists (
                         select 1 from `tabMSP Service Assignment` sa
                         where sa.managed_device = device.name
                           and sa.operational_status in %(open)s
                     )
               )"""
        )

        return {
            "active_users": active,
            "without_device": without_device,
            "disabled_with_services": disabled_with_services,
            "users_with_idle_device": users_with_idle_device,
        }

    @staticmethod
    def _conditions(search, customer, status, department, service, coverage):
        conditions = []
        params = {"open": OPEN_ASSIGNMENT_STATUSES}

        if customer:
            conditions.append("cu.customer = %(customer)s")
            params["customer"] = customer

        if status:
            conditions.append("cu.lifecycle_status = %(status)s")
            params["status"] = status

        if department:
            # a sub-account carries its entity as a prefix, so "Avittal" has to reach
            # "Avittal — Accounting" as well
            conditions.append("cu.department like %(department)s")
            params["department"] = f"%{department}%"

        if service:
            conditions.append(
                """exists (
                    select 1 from `tabMSP Service Assignment` sa
                    left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                    where sa.service_item = %(service)s
                      and sa.operational_status in %(open)s
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name)
                )"""
            )
            params["service"] = service

        if coverage == "no_device":
            conditions.append("cu.lifecycle_status = 'Active'")
            conditions.append(
                """not exists (
                    select 1 from `tabMSP Managed Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active'
                )"""
            )
        elif coverage == "no_service":
            conditions.append("cu.lifecycle_status = 'Active'")
            conditions.append(
                """exists (
                    select 1 from `tabMSP Managed Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active'
                      and not exists (
                          select 1 from `tabMSP Service Assignment` sa
                          where sa.managed_device = device.name
                            and sa.operational_status in %(open)s
                      )
                )"""
            )
        elif coverage == "no_personal_service":
            conditions.append("cu.lifecycle_status = 'Active'")
            conditions.append(
                """not exists (
                    select 1 from `tabMSP Service Assignment` sa
                    where sa.client_user = cu.name and sa.assignment_scope = 'User'
                      and sa.operational_status in %(open)s
                )"""
            )
        elif coverage == "open_requests":
            conditions.append(OPEN_REQUEST_FOR)
        elif coverage == "needs_attention":
            conditions.append(NEEDS_ATTENTION)
        elif coverage == "disabled_with_services":
            conditions.append("cu.lifecycle_status in ('Disabled', 'Archived')")
            conditions.append(
                """exists (
                    select 1 from `tabMSP Service Assignment` sa
                    left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                    where sa.operational_status in %(open)s
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name)
                )"""
            )

        if search:
            conditions.append(
                """(
                    cu.full_name like %(search)s
                    or cu.username like %(search)s
                    or cu.email like %(search)s
                    or cu.department like %(search)s
                    or exists (
                        select 1 from `tabMSP Managed Device` device
                        where device.assigned_client_user = cu.name
                          and (
                            device.hostname like %(search)s
                            or device.serial_number like %(search)s
                          )
                    )
                )"""
            )
            params["search"] = f"%{search}%"

        return (" where " + " and ".join(conditions)) if conditions else "", params

    @staticmethod
    def list_users(
        search=None,
        customer=None,
        status=None,
        department=None,
        service=None,
        coverage=None,
        start=0,
        page_length=20,
    ):
        """The user register: one row per person, with their device and service footprint."""
        RequestService._guard_internal()

        start = max(frappe.utils.cint(start), 0)
        page_length = min(max(frappe.utils.cint(page_length) or 20, 1), MAX_PAGE_LENGTH)

        where, params = UserService._conditions(
            search, customer, status, department, service, coverage
        )

        total = frappe.db.sql(f"select count(*) from `tabMSP Client User` cu {where}", params)[0][0]
        attention = NEEDS_ATTENTION

        rows = frappe.db.sql(
            f"""
            select
                cu.name, cu.full_name, cu.username, cu.department, cu.customer, cu.lifecycle_status,
                cu.start_date, cu.disabled_date, cu.email,
                cu.last_billed_on, cu.covered_until,
                (select r.note from `tabMSP Remark` r
                    where r.parent = cu.name and r.parenttype = 'MSP Client User'
                    order by r.idx desc limit 1) as remarks,
                (select group_concat(device.hostname separator ', ')
                    from `tabMSP Managed Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active')
                    as hostnames,
                -- what is engraved on those machines: the export is read next to the
                -- vendor's own list, where the serial is what the two are matched on
                (select group_concat(device.serial_number separator ', ')
                    from `tabMSP Managed Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active'
                      and ifnull(device.serial_number, '') != '')
                    as serial_numbers,
                (select device.device_type from `tabMSP Managed Device` device
                    where device.assigned_client_user = cu.name and device.status = 'Active'
                    limit 1) as device_type,
                (select count(*) from `tabMSP Service Assignment` sa
                    left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                    where sa.operational_status = 'Active'
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name))
                    as active_services,
                -- theirs, and their machines': counted apart, because they are owned apart
                (select count(*) from `tabMSP Service Assignment` sa
                    where sa.client_user = cu.name and sa.assignment_scope = 'User'
                      and sa.operational_status in %(open)s) as personal_services,
                (select count(*) from `tabMSP Service Assignment` sa
                    join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                    where sad.assigned_client_user = cu.name and sa.assignment_scope = 'Device'
                      and sa.operational_status in %(open)s) as device_services,
                (select count(*) from `tabMSP Managed Device` device
                    where device.assigned_client_user = cu.name) as current_devices,
                (select count(distinct sr.name)
                    from `tabMSP Service Request Line` srl
                    join `tabMSP Service Request` sr on sr.name = srl.parent
                    where (srl.client_user = cu.name or srl.requested_for_user = cu.name)
                      and sr.status in ('Submitted', 'Under Review', 'Approved', 'In Progress'))
                    as open_requests,
                {attention} as needs_attention,
                (select count(*) from `tabMSP Service Assignment` sa
                    left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                    where sa.operational_status != 'Active'
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name))
                    as inactive_services,
                (select group_concat(distinct coalesce(item.item_name, sa.service_item)
                        order by item.item_name separator ', ')
                    from `tabMSP Service Assignment` sa
                    left join `tabItem` item on item.name = sa.service_item
                    left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                    where sa.operational_status in %(open)s
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name))
                    as services,
                (select group_concat(distinct coalesce(item.item_name, sa.service_item)
                        order by item.item_name separator ', ')
                    from `tabMSP Service Assignment` sa
                    left join `tabItem` item on item.name = sa.service_item
                    left join `tabMSP Managed Device` sad on sad.name = sa.managed_device
                    where sa.operational_status not in %(open)s
                      and (sa.client_user = cu.name or sad.assigned_client_user = cu.name))
                    as inactive_service_names
            from `tabMSP Client User` cu
            {where}
            order by cu.full_name asc
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
    def get_user(name=None):
        """One person's whole situation, read through the Phase 5 ownership rule.

        The endpoint stays where it was; what it answers with is a different shape, because
        the old one said a machine's services belonged to whoever happened to hold it.
        """
        from nexgen_msp.api.internal.services.user_360_service import User360Service

        return User360Service.get_user(name=name)

    @staticmethod
    def add_device(
        client_user=None,
        hostname=None,
        device_type=None,
        interfaces=None,
        assigned_date=None,
        serial_number=None,
        remarks=None,
        source_request=None,
        manufacturer=None,
        model=None,
        operating_system=None,
    ):
        """Register hardware for a user. No billing impact until a service is attached to it."""
        from nexgen_msp.api.internal.services.device_service import DeviceService

        if not client_user:
            raise ValidationError("client_user is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Client User", client_user):
            raise NotFoundError(f"Client User {client_user} not found.", "NOT_FOUND")

        DeviceService.create_device(
            hostname=hostname,
            device_type=device_type,
            serial_number=serial_number,
            assigned_client_user=client_user,
            assigned_date=assigned_date,
            interfaces=interfaces,
            remarks=remarks,
            source_request=source_request,
            manufacturer=manufacturer,
            model=model,
            operating_system=operating_system,
        )

        return UserService.get_user(client_user)

    @staticmethod
    def _end_date_for(assignment, effective_date, allow_past=False):
        """The day a service stops.

        A service often stops before anyone gets round to recording it, so the date has to
        be allowed into the past — even behind a period already invoiced. That invoice is
        not touched and no credit note is issued: the date records where our own follow-up
        of the service ends, and the next run simply has nothing more to bill for it.

        Backdating is the administrator's call.
        """
        end_on = frappe.utils.getdate(effective_date or frappe.utils.today())
        today = frappe.utils.getdate(frappe.utils.today())

        if assignment.effective_start_date and end_on < frappe.utils.getdate(
            assignment.effective_start_date
        ):
            raise ValidationError(
                f"The service started on {frappe.utils.formatdate(assignment.effective_start_date)}; "
                "it cannot end before it began.",
                "VALIDATION_ERROR",
            )

        if end_on > today:
            raise ValidationError("A service cannot be ended in the future.", "VALIDATION_ERROR")

        if end_on < today and not allow_past:
            if not RequestService._roles().intersection(ADMIN_ROLES):
                raise ValidationError(
                    "Only an administrator can end a service on a past date.",
                    "PERMISSION_DENIED",
                    403,
                )

        return end_on

    @staticmethod
    def _billed_to(assignment):
        """The last day this assignment has been invoiced for, if it ever was."""
        return frappe.db.sql(
            """
            select max(br.billing_period_end)
            from `tabMSP Billing Run Line` brl
            join `tabMSP Billing Run` br on br.name = brl.parent
            join `tabMSP Service Assignment` sa on sa.name = brl.service_assignment
            where brl.service_assignment = %s
              -- only that company's own runs can have billed it
              and br.customer = sa.customer
              and br.docstatus = 1
              and ifnull(br.credit_note_of, '') = ''
            """,
            assignment,
        )[0][0]

    @staticmethod
    def _checked_request(source_request, customer):
        """A reference is only meaningful if it belongs to the same customer."""
        if not source_request:
            return None

        owner = frappe.db.get_value("MSP Service Request", source_request, "customer")

        if not owner:
            raise NotFoundError(f"Service Request {source_request} not found.", "NOT_FOUND")

        if owner != customer:
            raise ValidationError(
                f"Service Request {source_request} belongs to {owner}, not {customer}.",
                "VALIDATION_ERROR",
            )

        return source_request

    @staticmethod
    def assign_service(
        client_user=None,
        service_item=None,
        effective_date=None,
        device_mode=None,
        managed_device=None,
        hostname=None,
        device_type=None,
        interfaces=None,
        serial_number=None,
        username=None,
        notes=None,
        source_request=None,
        target_scope=None,
    ):
        """Open a service from the user's screen: resolve the target, then let the domain open it.

        Everything commercial — the catalogue, the contract, the rate, the duplicate — is the
        lifecycle service's to ask. This door only works out which machine, if any, the
        technician meant, and records what they had in front of them.
        """
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        RequestService._guard_internal()

        if not client_user or not service_item:
            raise ValidationError("client_user and service_item are required.", "VALIDATION_ERROR")

        user = frappe.db.get_value("MSP Client User", client_user, ["name", "customer"], as_dict=True)

        if not user:
            raise NotFoundError(f"Client User {client_user} not found.", "NOT_FOUND")

        declared = RequestService._service_scope(service_item)
        scope = (target_scope or "User") if declared == "Both" else declared

        interfaces = frappe.parse_json(interfaces) if isinstance(interfaces, str) else interfaces
        interfaces = [
            interface
            for interface in (interfaces or [])
            if (interface.get("mac_address") or "").strip()
        ]

        device = RequestService._resolve_device(
            user.customer,
            user.name,
            device_mode,
            managed_device,
            hostname,
            device_type,
            interfaces,
            serial_number,
        )

        if scope == "Device" and not device:
            raise ValidationError(
                f"{service_item} is a device service — select or create a device.",
                "VALIDATION_ERROR",
            )

        # a licence is issued against a username, a machine service against a serial
        if scope == "User" or declared == "Both":
            identifiers.require_username(user.name, username)
        if scope == "Device":
            identifiers.require_serial(device, serial_number)

        ServiceLifecycleService.activate(
            customer=user.customer,
            service_item=service_item,
            target_scope=scope,
            client_user=user.name if scope == "User" else None,
            managed_device=device if scope == "Device" else None,
            effective_date=effective_date,
            source_request=source_request,
            notes=notes,
        )

        # what the service will later be refused a closure for not having, taken while the
        # technician still has the machine and the licence in front of them
        UserService._record_identifiers(user.name, device, serial_number, username)
        frappe.db.commit()

        return UserService.get_user(client_user)

    @staticmethod
    def _record_identifiers(client_user, device, serial_number, username):
        """Fill the serial and the account name the closure will ask for.

        Only where nothing is on file: a value already recorded was put there by someone
        who had the machine in their hands, and is not overwritten from a form.
        """
        identifiers.record_serial(device, serial_number)
        identifiers.record_username(client_user, username)

    @staticmethod
    def change_service(
        assignment=None,
        action=None,
        effective_date=None,
        notes=None,
        source_request=None,
        confirm_billed=0,
        quantity=None,
        service_item=None,
    ):
        """Suspend, resume, change or end a running service, directly from its page.

        The act itself belongs to the lifecycle service: the days a pause covers, the day a
        service really stopped, and the note left beside it rather than over the assignment's
        own. This door only says which user's page to show afterwards.
        """
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        RequestService._guard_internal()

        if not assignment or not action:
            raise ValidationError("assignment and action are required.", "VALIDATION_ERROR")

        acts = {
            "Suspend": ServiceLifecycleService.suspend,
            "Resume": ServiceLifecycleService.resume,
            "End": ServiceLifecycleService.end,
            "Change": ServiceLifecycleService.change,
        }

        if action not in acts:
            raise ValidationError(f"Unknown action '{action}'.", "VALIDATION_ERROR")

        if not frappe.db.exists("MSP Service Assignment", assignment):
            raise NotFoundError(f"Service Assignment {assignment} not found.", "NOT_FOUND")

        extra = {"confirm_billed": confirm_billed} if action in ("Suspend", "Resume") else {}

        if action == "Change":
            extra = {"quantity": quantity, "service_item": service_item or None}

        acts[action](
            assignment=assignment,
            effective_date=effective_date,
            source_request=source_request,
            notes=notes,
            **extra,
        )

        client_user, managed_device = frappe.db.get_value(
            "MSP Service Assignment", assignment, ["client_user", "managed_device"]
        )

        return UserService.get_user(
            client_user
            or frappe.db.get_value("MSP Managed Device", managed_device, "assigned_client_user")
        )

    @staticmethod
    def create_client_user(
        customer=None,
        full_name=None,
        department=None,
        email=None,
        username=None,
        start_date=None,
        remarks=None,
        source_request=None,
        request_line=None,
        department_already_agreed=False,
        _commit=True,
    ):
        """Create the person a request asked for, and tie the line back to them."""
        RequestService._guard_internal()

        if not full_name:
            raise ValidationError("full_name is required.", "VALIDATION_ERROR")

        if source_request and not customer:
            customer = frappe.db.get_value("MSP Service Request", source_request, "customer")

        if not customer:
            raise ValidationError("customer is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("Customer", customer):
            raise NotFoundError(f"Customer {customer} not found.", "NOT_FOUND")

        source_request = UserService._checked_request(source_request, customer)

        doc = frappe.get_doc(
            {
                "doctype": "MSP Client User",
                "full_name": full_name,
                "customer": customer,
                "department": department or None,
                "email": email or None,
                # the account name a licence is issued against, when the service needs one
                "username": (username or "").strip() or None,
                "lifecycle_status": "Active",
                "start_date": start_date or frappe.utils.today(),
                "remarks": remarks or None,
            }
        )

        # the department was agreed when the request was approved; retiring it since is not
        # a reason to refuse the person that request asked for
        doc.flags.department_already_agreed = bool(department_already_agreed)
        doc.insert()

        if source_request and request_line:
            request = frappe.get_doc("MSP Service Request", source_request)
            row = next(
                (line for line in request.lines if line.idx == frappe.utils.cint(request_line)),
                None,
            )
            if row:
                # the customer wrote this person once and asked for several things: every
                # line describing them is now about the record just created, or the next
                # line would offer to create them a second time
                same_subject = row.subject_key
                was_new = bool(row.is_new_user)

                for line in request.lines:
                    if line.client_user:
                        continue
                    if line.idx == row.idx or (
                        was_new
                        and line.is_new_user
                        and line.subject_key == same_subject
                    ):
                        # no longer "new": the request must still save once they exist,
                        # and a line on an existing machine names it, not them
                        line.db_set("is_new_user", 0)
                        if line.target_scope != "Device" or line.is_new_device:
                            line.db_set("client_user", doc.name)

        reference = f" for {source_request}" if source_request else ""
        doc.add_comment("Comment", f"Created by {frappe.session.user}{reference}.")
        if _commit:
            frappe.db.commit()

        return {"name": doc.name, "full_name": doc.full_name, "customer": doc.customer}

    @staticmethod
    def update_client_user(
        name=None,
        full_name=None,
        department=None,
        email=None,
        username=None,
        start_date=None,
        remarks=None,
    ):
        """Correct what we hold about a person. Their customer and status never move here.

        Moving someone between customers would orphan their services. Their status has its
        own two doors, disabling and reactivating, so it is never changed in passing.
        """
        RequestService._guard_internal()

        if not name or not frappe.db.exists("MSP Client User", name):
            raise NotFoundError(f"Client User {name} not found.", "NOT_FOUND")

        doc = frappe.get_doc("MSP Client User", name)

        if full_name is not None:
            if not str(full_name).strip():
                raise ValidationError("A person needs a name.", "VALIDATION_ERROR")
            doc.full_name = str(full_name).strip()

        for field, value in (
            ("department", department),
            ("email", email),
            ("username", username),
            ("start_date", start_date),
        ):
            if value is not None:
                doc.set(field, value or None)

        # a remark is added to the log, never written over: the point is to follow what was
        # noted and when, which a single overwritten field cannot do
        remarks_util.add(doc, remarks)

        doc.save()
        frappe.db.commit()

        return UserService.get_user(name)

    @staticmethod
    def disable_client_user(name=None, effective_date=None, reason=None, end_services=0):
        """Record that somebody has left, optionally ending the services shown under them."""
        RequestService._guard_internal()

        doc = UserService._client_user(name)

        if doc.lifecycle_status in ("Disabled", "Archived"):
            raise ValidationError(
                f"{doc.full_name} is already {doc.lifecycle_status.lower()}.", "VALIDATION_ERROR"
            )

        reasons = frappe.get_meta("MSP Client User").get_field("disabled_reason").options.split("\n")

        if reason and reason not in reasons:
            raise ValidationError(f"'{reason}' is not a reason we record.", "VALIDATION_ERROR")

        on_date = frappe.utils.getdate(effective_date or frappe.utils.today())
        doc.lifecycle_status = "Disabled"
        doc.disabled_date = on_date
        doc.disabled_reason = reason or None
        doc.save()

        closed = []
        if frappe.utils.cint(end_services):
            from nexgen_msp.api.internal.services.service_lifecycle_service import (
                ServiceLifecycleService,
            )

            devices = frappe.get_all(
                "MSP Device Holder",
                filters={
                    "client_user": doc.name,
                    "is_current": 1,
                    "parenttype": "MSP Managed Device",
                },
                pluck="parent",
            )
            assignments = set(
                frappe.get_all(
                    "MSP Service Assignment",
                    filters={
                        "client_user": doc.name,
                        "operational_status": ("in", ("Active", "Suspended", "Pending Removal")),
                    },
                    pluck="name",
                )
            )
            if devices:
                assignments.update(
                    frappe.get_all(
                        "MSP Service Assignment",
                        filters={
                            "managed_device": ("in", devices),
                            "operational_status": ("in", ("Active", "Suspended", "Pending Removal")),
                        },
                        pluck="name",
                    )
                )

            for assignment in assignments:
                ServiceLifecycleService.end(
                    assignment=assignment,
                    effective_date=on_date,
                    notes=f"Ended when {doc.full_name} was disabled.",
                    _commit=False,
                )
                closed.append(assignment)

        frappe.db.commit()

        result = UserService.get_user(name)
        result["closed_assignments"] = closed
        return result

    @staticmethod
    def reactivate_client_user(name=None):
        """Bring back somebody who had left. Nothing they used to have comes back with them."""
        RequestService._guard_internal()

        doc = UserService._client_user(name)

        if doc.lifecycle_status != "Disabled":
            raise ValidationError(
                f"Only a disabled person can be reactivated; {doc.full_name} is "
                f"{doc.lifecycle_status.lower()}.",
                "VALIDATION_ERROR",
            )

        doc.lifecycle_status = "Active"
        doc.save()
        frappe.db.commit()

        return UserService.get_user(name)

    @staticmethod
    def stop_all_services(name=None, effective_date=None, notes=None, source_request=None):
        """Close every personal service a person still has, from one day, one by one.

        Each one goes through the same door as closing it by hand. What runs on the machines
        they hold stays with the machines.
        """
        from nexgen_msp.api.internal.services.service_lifecycle_service import (
            ServiceLifecycleService,
        )

        RequestService._guard_internal()
        doc = UserService._client_user(name)

        open_services = frappe.get_all(
            "MSP Service Assignment",
            filters={
                "client_user": doc.name,
                "assignment_scope": "User",
                "operational_status": ("in", ("Active", "Suspended", "Pending Removal")),
            },
            pluck="name",
        )

        if not open_services:
            raise ValidationError(
                f"{doc.full_name} has no personal service to stop.", "VALIDATION_ERROR"
            )

        for assignment in open_services:
            ServiceLifecycleService.end(
                assignment=assignment,
                effective_date=effective_date,
                source_request=source_request or None,
                notes=notes,
                _commit=False,
            )

        frappe.db.commit()

        return UserService.get_user(doc.name)

    @staticmethod
    def _client_user(name):
        if not name or not frappe.db.exists("MSP Client User", name):
            raise NotFoundError(f"Client User {name} not found.", "NOT_FOUND")

        return frappe.get_doc("MSP Client User", name)

    @staticmethod
    def deletion_blockers(name):
        """What stands in the way of erasing a person, named so it can be acted on.

        Anything that ties them to work done or money owed keeps them: a service they hold,
        a request they appear in, a billed line, a device in their hands.
        Erasing those would leave documents pointing at nothing.
        """
        checks = (
            (
                "service assignment(s)",
                frappe.db.count("MSP Service Assignment", {"client_user": name}),
            ),
            (
                "device(s) in their hands",
                frappe.db.count("MSP Managed Device", {"assigned_client_user": name}),
            ),
            (
                "request line(s)",
                frappe.db.count("MSP Service Request Line", {"client_user": name}),
            ),
            (
                "billed line(s)",
                frappe.db.count("MSP Billing Run Line", {"client_user": name}),
            ),
            (
                "past device holding(s)",
                frappe.db.count("MSP Device Holder", {"client_user": name}),
            ),
        )

        blockers = [f"{count} {label}" for label, count in checks if count]


        return blockers

    @staticmethod
    def delete_client_user(name=None):
        """Erase a person who never carried anything — a test record, a typo."""
        ContractService._guard_admin()

        if not name or not frappe.db.exists("MSP Client User", name):
            raise NotFoundError(f"Client User {name} not found.", "NOT_FOUND")

        blockers = UserService.deletion_blockers(name)

        if blockers:
            raise ValidationError(
                frappe.db.get_value("MSP Client User", name, "full_name")
                + " cannot be deleted: "
                + ", ".join(blockers)
                + ".",
                "VALIDATION_ERROR",
            )

        frappe.delete_doc("MSP Client User", name, ignore_permissions=True)
        frappe.db.commit()

        return {"deleted": name}
