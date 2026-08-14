import frappe

from nexgen_msp.utils.error_status import CODE_HTTP_STATUS, DEFAULT_ERROR_STATUS


def success(data: dict | None = None, **kwargs):
    return {"success": True, **(data or {}), **kwargs}


def error(
    message: str,
    code: str,
    http_status: int | None = None,
    fallback_status: int | None = None,
    **kwargs,
):
    status = http_status or CODE_HTTP_STATUS.get(code) or fallback_status or DEFAULT_ERROR_STATUS
    try:
        frappe.local.response["http_status_code"] = status
    except Exception:
        pass
    return {"success": False, "error": message, "code": code, **kwargs}
