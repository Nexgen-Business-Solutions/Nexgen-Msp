import frappe

from nexgen_msp.utils import permissions
from nexgen_msp.utils.errors import NotFoundError, ValidationError

CLIENT_USER_FIELDS = [
    "name",
    "full_name",
    "department",
    "email",
    "lifecycle_status",
    "start_date",
    "disabled_date",
    "customer",
]

DEVICE_FIELDS = [
    "name",
    "hostname",
    "device_type",
    "status",
    "assigned_client_user",
    "assigned_date",
    "retired_date",
    "serial_number",
    "manufacturer",
    "model",
    "operating_system",
    "customer",
]

ASSIGNMENT_FIELDS = [
    "name",
    "service_item",
    "assignment_scope",
    "client_user",
    "managed_device",
    "customer_site",
    "quantity",
    "uom",
    "operational_status",
    "billing_status",
    "effective_start_date",
    "effective_end_date",
    "customer_visible_notes",
    "customer",
]

REQUEST_FIELDS = [
    "name",
    "request_type",
    "status",
    "priority",
    "source",
    "requester",
    "customer",
    "creation",
    "modified",
]

REQUEST_LINE_FIELDS = [
    "idx",
    "target_scope",
    "client_user",
    "managed_device",
    "customer_site",
    "requested_service",
    "requested_quantity",
    "requested_effective_date",
    "comment",
    "line_status",
    "rejection_reason",
]

MAX_PAGE_LENGTH = 200


class PortalService:
    @staticmethod
    def get_context():
        customers = permissions.get_allowed_customers()

        if not customers:
            raise ValidationError(
                "No customer is linked to your account. Contact Nexgen support.",
                "PERMISSION_DENIED",
                403,
            )

        user = frappe.db.get_value(
            "User", frappe.session.user, ["full_name", "user_image"], as_dict=True
        )

        return {
            "user": frappe.session.user,
            "full_name": user.full_name if user else frappe.session.user,
            "user_image": user.user_image if user else None,
            "customers": customers,
            "customer": customers[0],
            "roles": frappe.get_roles(),
        }

    @staticmethod
    def get_summary(customer=None):
        customer = PortalService._resolve_customer(customer)
        base = {"customer": customer}

        return {
            "customer": customer,
            "client_users": frappe.db.count("Client User", base),
            "active_client_users": frappe.db.count(
                "Client User", {**base, "lifecycle_status": "Active"}
            ),
            "devices": frappe.db.count("Managed Device", base),
            "active_devices": frappe.db.count("Managed Device", {**base, "status": "Active"}),
            "service_assignments": frappe.db.count("Service Assignment", base),
            "active_services": frappe.db.count(
                "Service Assignment", {**base, "operational_status": "Active"}
            ),
            "open_requests": frappe.db.count(
                "Service Request",
                {
                    **base,
                    "status": ["not in", ["Completed", "Rejected", "Cancelled"]],
                },
            ),
        }

    @staticmethod
    def list_client_users(customer=None, search=None, status=None, start=0, page_length=20):
        filters = PortalService._base_filters(customer)
        if status:
            filters["lifecycle_status"] = status

        return PortalService._paginated(
            "Client User", CLIENT_USER_FIELDS, filters, search, ["full_name", "email"], start, page_length
        )

    @staticmethod
    def list_devices(customer=None, search=None, status=None, start=0, page_length=20):
        filters = PortalService._base_filters(customer)
        if status:
            filters["status"] = status

        return PortalService._paginated(
            "Managed Device", DEVICE_FIELDS, filters, search, ["hostname", "serial_number"], start, page_length
        )

    @staticmethod
    def list_service_assignments(
        customer=None, search=None, status=None, client_user=None, start=0, page_length=20
    ):
        filters = PortalService._base_filters(customer)
        if status:
            filters["operational_status"] = status
        if client_user:
            filters["client_user"] = client_user

        return PortalService._paginated(
            "Service Assignment", ASSIGNMENT_FIELDS, filters, search, ["service_item"], start, page_length
        )

    @staticmethod
    def list_requests(customer=None, search=None, status=None, start=0, page_length=20):
        filters = PortalService._base_filters(customer)
        if status:
            filters["status"] = status

        return PortalService._paginated(
            "Service Request", REQUEST_FIELDS, filters, search, ["name"], start, page_length
        )

    @staticmethod
    def get_request(name=None):
        if not name:
            raise ValidationError("name is required.", "VALIDATION_ERROR")

        if not frappe.db.exists("Service Request", name):
            raise NotFoundError(f"Service Request {name} does not exist.", "NOT_FOUND")

        doc = frappe.get_doc("Service Request", name)
        doc.check_permission("read")

        return {
            **{field: doc.get(field) for field in REQUEST_FIELDS},
            "lines": [
                {field: row.get(field) for field in REQUEST_LINE_FIELDS} for row in doc.lines
            ],
        }

    @staticmethod
    def create_request(customer=None, request_type=None, priority=None, lines=None):
        customer = PortalService._resolve_customer(customer)

        if not request_type:
            raise ValidationError("request_type is required.", "VALIDATION_ERROR")

        lines = frappe.parse_json(lines) if isinstance(lines, str) else lines
        if not lines:
            raise ValidationError("At least one line is required.", "VALIDATION_ERROR")

        doc = frappe.get_doc(
            {
                "doctype": "Service Request",
                "customer": customer,
                "request_type": request_type,
                "priority": priority or "Medium",
                "source": "Portal",
                "status": "Submitted",
                "requester": frappe.session.user,
                "lines": [
                    {
                        "target_scope": line.get("target_scope"),
                        "client_user": line.get("client_user"),
                        "managed_device": line.get("managed_device"),
                        "customer_site": line.get("customer_site"),
                        "requested_service": line.get("requested_service"),
                        "requested_quantity": line.get("requested_quantity") or 1,
                        "requested_effective_date": line.get("requested_effective_date"),
                        "comment": line.get("comment"),
                    }
                    for line in lines
                ],
            }
        ).insert()

        frappe.db.commit()

        return PortalService.get_request(doc.name)

    @staticmethod
    def list_catalogue(customer=None):
        PortalService._resolve_customer(customer)

        items = frappe.get_all(
            "Item",
            filters={"disabled": 0, "is_stock_item": 0},
            fields=["name", "item_name", "stock_uom", "description"],
            order_by="item_name asc",
            limit_page_length=0,
        )

        return {"items": items, "count": len(items)}

    @staticmethod
    def _resolve_customer(customer=None):
        allowed = permissions.get_allowed_customers()

        if not allowed:
            raise ValidationError(
                "No customer is linked to your account.", "PERMISSION_DENIED", 403
            )

        if not customer:
            return allowed[0]

        if customer not in allowed:
            raise ValidationError(
                f"You are not allowed to access customer {customer}.", "PERMISSION_DENIED", 403
            )

        return customer

    @staticmethod
    def _base_filters(customer=None):
        return {"customer": PortalService._resolve_customer(customer)}

    @staticmethod
    def _paginated(doctype, fields, filters, search, search_fields, start, page_length):
        start = max(0, frappe.utils.cint(start))
        page_length = min(MAX_PAGE_LENGTH, max(1, frappe.utils.cint(page_length) or 20))

        or_filters = None
        if search:
            or_filters = [[field, "like", f"%{search}%"] for field in search_fields]

        rows = frappe.get_list(
            doctype,
            filters=filters,
            or_filters=or_filters,
            fields=fields,
            limit_start=start,
            limit_page_length=page_length,
            order_by="modified desc",
        )

        counted = frappe.get_list(
            doctype,
            filters=filters,
            or_filters=or_filters,
            fields=[{"COUNT": "*"}],
            as_list=True,
        )
        total = counted[0][0] if counted else 0

        return {
            "rows": rows,
            "start": start,
            "page_length": page_length,
            "total": total,
            "has_more": start + len(rows) < total,
        }
