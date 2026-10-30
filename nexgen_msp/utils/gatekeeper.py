import frappe
from frappe import _
from werkzeug.routing import RequestRedirect

# the desk, under both the names Frappe answers to
DESK_PREFIXES = ("/app", "/desk", "/apps")

# everything the browser fetches rather than navigates to: rewriting those would break the
# session cookie and the calls the page makes back to its own origin
MACHINE_PREFIXES = ("/api/", "/assets/", "/files/", "/private/", "/socket.io", "/.well-known/")

# the front door, for an account the rules give no home of its own
HOME = "/"

APP_METHOD_PREFIXES = (
	"/api/method/nexgen_msp.",
	"/api/v2/method/nexgen_msp.",
)

RESOURCE_PREFIXES = (
	"/api/resource",
	"/api/v2/document",
)

# These are the only application calls needed to establish or inspect a session before its
# second factor is complete. Everything else under nexgen_msp is application data.
TWO_FACTOR_EXEMPT_METHODS = frozenset(
	{
		"nexgen_msp.api.auth.endpoints.v1.pre_login",
		"nexgen_msp.api.auth.endpoints.v1.complete_login",
		"nexgen_msp.api.two_factor.endpoints.v1.start_two_factor_setup",
		"nexgen_msp.api.two_factor.endpoints.v1.verify_two_factor_setup",
		"nexgen_msp.api.two_factor.endpoints.v1.verify_two_factor",
		"nexgen_msp.api.core.endpoints.v1.get_session_context",
		"nexgen_msp.api.core.endpoints.v1.get_csrf_token",
	}
)

SESSION_EXEMPT_PATHS = frozenset(
	{
		"/api/method/logout",
		"/api/method/frappe.auth.get_logged_user",
		"/api/v2/method/logout",
		"/api/v2/method/frappe.auth.get_logged_user",
	}
)


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


def _app_method(path):
	for prefix in APP_METHOD_PREFIXES:
		if path.startswith(prefix):
			return f"nexgen_msp.{path[len(prefix):].rstrip('/')}"

	return None


def _is_protected_api(path):
	return _app_method(path) is not None or any(
		path == prefix or path.startswith(prefix + "/") for prefix in RESOURCE_PREFIXES
	)


def require_two_factor(*args, **kwargs):
	"""Refuse protected API calls until this exact session has cleared TOTP.

	The browser route guards are useful guidance, not a security boundary. This hook runs
	after Frappe resumes the session and before it dispatches the whitelisted method or the
	generic document API, so a caller cannot bypass 2FA by talking to either API directly.
	"""
	request = getattr(frappe.local, "request", None)

	if not request or not _is_protected_api(request.path):
		return

	user = frappe.session.user if frappe.session else None

	if not user or user == "Guest":
		return

	method = _app_method(request.path)

	if request.path.rstrip("/") in SESSION_EXEMPT_PATHS or method in TWO_FACTOR_EXEMPT_METHODS:
		return

	from nexgen_msp.api.two_factor.services.two_factor_service import TwoFactorService

	if not TwoFactorService.gate_passed(user):
		frappe.throw(
			_("Complete two-factor authentication before continuing."),
			frappe.PermissionError,
			title=_("Two-factor authentication required"),
		)


def guard(*args, **kwargs):
	"""Send somebody who lands on the desk without a door to it back to their own home.

	It used to send every Website User to the site's front door. That was the right answer
	while this was the only application here, and the wrong one as soon as it was not:
	somebody else's portal account was pushed off their own pages onto a login screen. Now
	each account goes where its own rule says it belongs, and only an account the rules give
	no home at all falls back to the front door.

Whether an account can get in at all is one question, asked in one place, so that the
	screen offering the door and the request shutting it cannot disagree. It is both halves
	at once: the rule has to open the door, and Frappe has to be willing to let them through
	it — our own technicians are Website Users on purpose, and being shown Frappe's refusal
	page is worse for them than being taken home.

	While the routing switch is off, so is all of this: the guard goes back to turning away
	whoever has no desk seat, which is what it did before there were rules. A switch that
	left the desk decided by rules would not be a way back from a bad one.

	The builtin Administrator always passes. It is the account that has to be able to reach
	the desk and correct a rule that shut everybody out, including itself.

	Nobody is ever moved between hostnames. Frappe writes its session cookie without a
	Domain, so it belongs to the host that issued it: carrying someone across to the portal
	address would hand them a host their session was never given to, and drop them on the
	login screen. The portal address is therefore used only in the links we email out.
	"""
	request = getattr(frappe.local, "request", None)

	if not request or not _is_page_request(request):
		return

	user = frappe.session.user if frappe.session else None

	if not user or user == "Guest" or not _wants_desk(request.path):
		return

	from nexgen_msp.api.core.services.login_rule_service import LoginRuleService

	if LoginRuleService.desk_reachable(user):
		return

	if not LoginRuleService.routing_enabled():
		raise SeeOther(HOME)

	raise SeeOther(LoginRuleService.home_for(user) or HOME)
