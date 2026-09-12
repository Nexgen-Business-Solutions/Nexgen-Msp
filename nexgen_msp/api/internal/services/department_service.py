import frappe

from nexgen_msp.api.internal.services.contract_service import ContractService
from nexgen_msp.api.internal.services.request_service import CLOSED_STATUSES
from nexgen_msp.utils.errors import NotFoundError, ValidationError

DOCTYPE = "MSP Department"


class DepartmentService:
    """The MSP-managed department catalogue.

    Almost all of it is global: one "Accounting" serves every customer, administered once
    and consumed everywhere as a controlled list rather than typed by hand. A department may
    exceptionally name a Customer, and is then offered to that company alone — the names stay
    unique across the whole catalogue either way, since a record carries the label itself.
    """

    @staticmethod
    def _guard_admin():
        """Only the platform administrator maintains the catalogue itself."""
        ContractService._guard_admin()

    @staticmethod
    def _normalized(value):
        return " ".join((value or "").split()).casefold()

    @staticmethod
    def _get(name):
        if not name or not frappe.db.exists(DOCTYPE, name):
            raise NotFoundError(f"Department {name} not found.", "NOT_FOUND")

        return frappe.get_doc(DOCTYPE, name)

    @staticmethod
    def list_departments(enabled_only=True, customer=None):
        """Every department, for the admin table, or only the active ones for a form.

        A form only ever offers what is currently enabled; the Settings screen needs to
        see a disabled entry too, so it stays the one place that can bring one back.

        Nearly every department is global: it carries no customer and everyone may use it.
        The rare one that belongs to a single company is offered to that company alone, so
        a form asked on behalf of a customer sees the global list plus their own.
        """
        enabled_only = frappe.utils.cint(enabled_only)

        if enabled_only:
            return frappe.db.sql(
                """
                select name, department_name, enabled, description, sort_order, customer
                from `tabMSP Department`
                where enabled = 1
                  and (ifnull(customer, '') = '' or customer = %(customer)s)
                order by sort_order asc, department_name asc
                """,
                {"customer": customer or ""},
                as_dict=True,
            )

        DepartmentService._guard_admin()

        return frappe.db.sql(
            """
            select
                d.name, d.department_name, d.enabled, d.description, d.sort_order, d.customer,
                (
                    (select count(*) from `tabMSP Client User` cu
                        where lower(trim(cu.department)) = lower(trim(d.department_name)))
                    + (select count(*) from `tabMSP Approver` a
                        where lower(trim(a.department)) = lower(trim(d.department_name)))
                    + (select count(*) from `tabMSP Service Request Line` srl
                        join `tabMSP Service Request` sr on sr.name = srl.parent
                        where lower(trim(srl.new_user_department)) = lower(trim(d.department_name))
                          and sr.status not in %(closed)s)
                ) as used
            from `tabMSP Department` d
            order by d.sort_order asc, d.department_name asc
            """,
            {"closed": CLOSED_STATUSES},
            as_dict=True,
        )

    @staticmethod
    def create_department(
        department_name=None, description=None, enabled=1, sort_order=None, customer=None
    ):
        DepartmentService._guard_admin()

        department_name = " ".join((department_name or "").strip().split())

        if not department_name:
            raise ValidationError("A department name is required.", "VALIDATION_ERROR")

        if DepartmentService._find_by_name(department_name):
            raise ValidationError(
                f"A department named '{department_name}' already exists.", "VALIDATION_ERROR"
            )

        doc = frappe.new_doc(DOCTYPE)
        doc.department_name = department_name
        doc.customer = customer or None
        doc.description = description
        doc.enabled = frappe.utils.cint(enabled)
        doc.sort_order = frappe.utils.cint(sort_order) if sort_order not in (None, "") else None
        doc.insert(ignore_permissions=True)
        frappe.db.commit()

        return DepartmentService.list_departments(enabled_only=False)

    @staticmethod
    def update_department(
        name=None,
        department_name=None,
        description=None,
        enabled=None,
        sort_order=None,
        customer=None,
    ):
        DepartmentService._guard_admin()

        doc = DepartmentService._get(name)
        old_label = doc.department_name

        if department_name is not None:
            new_name = " ".join(department_name.strip().split())

            if not new_name:
                raise ValidationError("A department name is required.", "VALIDATION_ERROR")

            existing = DepartmentService._find_by_name(new_name)

            if existing and existing != doc.name:
                raise ValidationError(
                    f"A department named '{new_name}' already exists.", "VALIDATION_ERROR"
                )

            doc.department_name = new_name

        if description is not None:
            doc.description = description

        if customer is not None:
            doc.customer = customer or None

        if enabled is not None:
            doc.enabled = frappe.utils.cint(enabled)

        if sort_order is not None:
            doc.sort_order = frappe.utils.cint(sort_order) if sort_order != "" else None

        new_label = doc.department_name
        renamed_from = doc.name if doc.name != new_label else None

        doc.save(ignore_permissions=True)

        # The DocType hooks also propagate the label to current Data-field references.
        if renamed_from:
            frappe.rename_doc(DOCTYPE, renamed_from, new_label, force=True)

        if old_label != new_label:
            DepartmentService.rename_references(old_label, new_label)

        frappe.db.commit()

        return DepartmentService.list_departments(enabled_only=False)

    @staticmethod
    def save_department(name=None, department=None):
        """One call for the modal, whichever the user meant: adding or editing."""
        department = frappe.parse_json(department) if isinstance(department, str) else (department or {})

        if name:
            return DepartmentService.update_department(
                name=name,
                department_name=department.get("department_name"),
                description=department.get("description"),
                enabled=department.get("enabled"),
                customer=department.get("customer"),
                sort_order=(
                    ""
                    if "sort_order" in department and department.get("sort_order") is None
                    else department.get("sort_order")
                ),
            )

        return DepartmentService.create_department(
            department_name=department.get("department_name"),
            description=department.get("description"),
            enabled=department.get("enabled", 1),
            customer=department.get("customer"),
            sort_order=department.get("sort_order"),
        )

    @staticmethod
    def disable_department(name=None):
        """The preferred way to retire a department: it disappears from new choices but
        every record that already carries it keeps it."""
        return DepartmentService.update_department(name=name, enabled=0)

    @staticmethod
    def delete_department(name=None):
        """Only a department nothing points at may be deleted outright."""
        DepartmentService._guard_admin()

        doc = DepartmentService._get(name)

        DepartmentService.ensure_unused(doc.department_name)

        frappe.delete_doc(DOCTYPE, doc.name, ignore_permissions=True)
        frappe.db.commit()

        return DepartmentService.list_departments(enabled_only=False)

    @staticmethod
    def validate_department(department, *, required=False, allow_disabled=False):
        """Exists, and is currently enabled. Used by every consumer, server-side, so a raw
        API call cannot smuggle in a department nobody configured.

        Returns the catalogue's own canonical spelling, so a value that reaches us with
        different casing or stray whitespace is corrected rather than left to drift.
        """
        normalized = DepartmentService._normalized(department)

        if not normalized:
            if required:
                raise ValidationError("Select a department for the new user.", "VALIDATION_ERROR")
            return None

        name = DepartmentService._find_by_name(department)
        if not name:
            raise ValidationError(f"Department '{department}' does not exist.", "VALIDATION_ERROR")

        row = frappe.db.get_value(
            DOCTYPE, name, ["department_name", "enabled"], as_dict=True
        )

        if not row.enabled and not allow_disabled:
            raise ValidationError(f"Department '{row.department_name}' is disabled.", "VALIDATION_ERROR")

        return row.department_name

    @staticmethod
    def ensure_unused(department_name):
        """Shared by the custom API and standard document deletion paths."""
        if DepartmentService._usage_count(department_name):
            raise ValidationError(
                "This department is currently in use.\nDisable it instead of deleting it.",
                "VALIDATION_ERROR",
            )

    @staticmethod
    def rename_references(old, new):
        """Update current labels, never completed request or billing snapshots."""
        if not old or old == new:
            return

        values = {"old": old, "new": new, "closed": CLOSED_STATUSES}
        for doctype in ("MSP Client User", "MSP Approver"):
            frappe.db.set_value(
                doctype, {"department": old}, "department", new, update_modified=False
            )

        active_lines = frappe.db.sql_list(
            """select line.name from `tabMSP Service Request Line` line
                join `tabMSP Service Request` request on request.name = line.parent
                where line.new_user_department = %(old)s
                  and request.status not in %(closed)s""",
            values,
        )
        for name in active_lines:
            frappe.db.set_value(
                "MSP Service Request Line", name, "new_user_department", new, update_modified=False
            )

    @staticmethod
    def _find_by_name(department_name):
        normalized = DepartmentService._normalized(department_name)
        for row in frappe.get_all(DOCTYPE, fields=["name", "department_name"]):
            if DepartmentService._normalized(row.department_name) == normalized:
                return row.name
        return None

    @staticmethod
    def _usage_count(department_name):
        rows = frappe.db.sql(
            """
            select
                (select count(*) from `tabMSP Client User` cu
                    where lower(trim(cu.department)) = %(normalized)s)
                + (select count(*) from `tabMSP Approver` a
                    where lower(trim(a.department)) = %(normalized)s)
                + (select count(*) from `tabMSP Service Request Line` srl
                    join `tabMSP Service Request` sr on sr.name = srl.parent
                    where lower(trim(srl.new_user_department)) = %(normalized)s
                      and sr.status not in %(closed)s) as used
            """,
            {"normalized": DepartmentService._normalized(department_name), "closed": CLOSED_STATUSES},
            as_dict=True,
        )

        return rows[0].used if rows else 0
