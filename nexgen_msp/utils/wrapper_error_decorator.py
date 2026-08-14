from functools import wraps

import frappe

from nexgen_msp.utils import response
from nexgen_msp.utils.errors import NexgenError


def handle_errors(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except NexgenError as e:
            frappe.db.rollback()
            return response.error(
                e.message, code=e.code, fallback_status=getattr(e, "http_status_code", None)
            )
        except frappe.PermissionError as e:
            frappe.db.rollback()
            return response.error(
                str(e) or frappe._("Not permitted"), code="PERMISSION_DENIED", http_status=403
            )
        except frappe.AuthenticationError as e:
            frappe.db.rollback()
            return response.error(
                str(e) or frappe._("Authentication failed"),
                code="AUTHENTICATION_FAILED",
                http_status=401,
            )
        except frappe.ValidationError as e:
            frappe.db.rollback()
            return response.error(
                str(e) or frappe._("Validation error"), code="VALIDATION_ERROR", http_status=400
            )
        except Exception as e:
            frappe.db.rollback()
            frappe.log_error(title="Nexgen MSP API error", message=frappe.get_traceback())
            return response.error(str(e), code="INTERNAL_ERROR", http_status=500)

    return wrapper
