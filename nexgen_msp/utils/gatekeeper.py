import frappe
from werkzeug.routing import RequestRedirect

# the desk, under both the names Frappe answers to
DESK_PREFIXES = ("/app", "/desk", "/apps")

# everything the browser fetches rather than navigates to: rewriting those would break the
# session cookie and the calls the page makes back to its own origin
MACHINE_PREFIXES = ("/api/", "/assets/", "/files/", "/private/", "/socket.io", "/.well-known/")

# anyone without a desk seat is sent back to the front door
HOME = "/"


class SeeOther(RequestRedirect):
	code = 302


def _is_page_request(request):
	if request.method not in ("GET", "HEAD"):
		return False

	return not request.path.startswith(MACHINE_PREFIXES)


def _wants_desk(path):
	return any(path == prefix or path.startswith(prefix + "/") for prefix in DESK_PREFIXES)


def portal_origin():
	"""The address invited users are meant to use, when one has been set."""
	if not frappe.db:
		return None

	try:
		origin = frappe.db.get_single_value("MSP Portal Settings", "portal_url")
	except Exception:
		return None

	return (origin or "").strip().rstrip("/") or None


def guard(*args, **kwargs):
	"""Send an invited user who lands on the desk back to the application.

	Nobody is ever moved between hostnames. Frappe writes its session cookie without a
	Domain, so it belongs to the host that issued it: carrying someone across to the portal
	address would hand them a host their session was never given to, and drop them on the
	login screen. The portal address is therefore used only in the links we email out.
	"""
	request = getattr(frappe.local, "request", None)

	if not request or not _is_page_request(request):
		return

	user = frappe.session.user if frappe.session else None

	if not user or user == "Guest":
		return

	is_website_user = (frappe.session.data or {}).get("user_type") == "Website User"

	if is_website_user and _wants_desk(request.path):
		raise SeeOther(HOME)
