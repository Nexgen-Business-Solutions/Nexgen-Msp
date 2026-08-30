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
		origin = frappe.db.get_single_value("MSP Invoice Settings", "portal_url")
	except Exception:
		return None

	return (origin or "").strip().rstrip("/") or None


def guard(*args, **kwargs):
	"""Send people to the door that is theirs.

	An invited user who lands on the desk is not committing an offence, so they are shown
	their portal rather than told they lack a permission. And when the portal answers on its
	own address, each audience is kept on the address meant for it — a courtesy, not a
	barrier: what actually separates them is the permission model.
	"""
	request = getattr(frappe.local, "request", None)

	if not request or not _is_page_request(request):
		return

	user = frappe.session.user if frappe.session else None

	if not user or user == "Guest":
		return

	is_website_user = (frappe.session.data or {}).get("user_type") == "Website User"
	origin = portal_origin()

	if is_website_user and _wants_desk(request.path):
		raise SeeOther(f"{origin}{HOME}" if origin else HOME)

	if not origin:
		return

	here = request.host_url.rstrip("/")
	there = origin

	if is_website_user and here != there:
		raise SeeOther(f"{there}{request.full_path.rstrip('?')}")

	if not is_website_user and here == there:
		raise SeeOther(f"{frappe.utils.get_url()}{request.full_path.rstrip('?')}")
