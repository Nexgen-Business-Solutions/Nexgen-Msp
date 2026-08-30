app_name = "nexgen_msp"
app_title = "Nexgen MSP"
app_publisher = "Nexgen Business Solutions"
app_description = "MSP service, request, work order and billing management for Nexgen"
app_email = "devteam@nxgensolutions.com"
app_license = "mit"

# Apps
# ------------------

required_apps = ["erpnext"]

fixtures = [
	{
		"dt": "Role",
		"filters": [
			[
				"name",
				"in",
				[
					"MSP System Admin",
					"MSP Operator",
					"MSP Technician",
					"Customer Portal Manager",
				],
			]
		],
	},
	{
		"dt": "Custom Field",
		"filters": [
			[
				"name",
				"in",
				[
					"Customer-msp_free_of_charge",
					"Customer-msp_last_billed_on",
					"Item-msp_invoice_label",
					"Item-msp_service_scope",
					"Item Price-msp_discount_percent",
					"Sales Invoice Item-msp_billed_count",
					"Sales Order Item-msp_billed_count",
				],
			]
		],
	},
	{
		"dt": "Email Template",
		"filters": [
			[
				"name",
				"in",
				[
					"MSP Portal Invitation",
					"MSP Password Reset",
					"MSP Request Received",
					"MSP Request Decision",
					"MSP Request Completed",
					"MSP Invoice Issued",
				],
			]
		],
	},
]

override_doctype_class = {"User": "nexgen_msp.overrides.user.MSPUser"}

before_request = ["nexgen_msp.utils.gatekeeper.guard"]

after_migrate = [
	"nexgen_msp.utils.notifications.ensure_templates",
	"nexgen_msp.utils.import_mappings.ensure_mappings",
	"nexgen_msp.utils.permissions.keep_technicians_off_desk",
]

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "nexgen_msp",
# 		"logo": "/assets/nexgen_msp/logo.png",
# 		"title": "Nexgen MSP",
# 		"route": "/nexgen_msp",
# 		"has_permission": "nexgen_msp.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/nexgen_msp/css/nexgen_msp.css"
# app_include_js = "/assets/nexgen_msp/js/nexgen_msp.js"

# include js, css files in header of web template
# web_include_css = "/assets/nexgen_msp/css/nexgen_msp.css"
# web_include_js = "/assets/nexgen_msp/js/nexgen_msp.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "nexgen_msp/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "nexgen_msp/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

website_route_rules = [
	{"from_route": "/msp", "to_route": "msp"},
	{"from_route": "/msp/<path:subpath>", "to_route": "msp"},
]

website_redirects = [
	{"source": "/", "target": "/msp/login", "redirect_http_status": 302},
	{"source": "/index", "target": "/msp/login", "redirect_http_status": 302},
	{
		"source": "/login",
		"target": "/msp/login",
		"redirect_http_status": 302,
		"forward_query_parameters": True,
	},
	{
		"source": "/update-password",
		"target": "/msp/reset-password",
		"redirect_http_status": 302,
		"forward_query_parameters": True,
	},
]

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "nexgen_msp.utils.jinja_methods",
# 	"filters": "nexgen_msp.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "nexgen_msp.install.before_install"
# after_install = "nexgen_msp.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "nexgen_msp.uninstall.before_uninstall"
# after_uninstall = "nexgen_msp.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "nexgen_msp.utils.before_app_install"
# after_app_install = "nexgen_msp.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "nexgen_msp.utils.before_app_uninstall"
# after_app_uninstall = "nexgen_msp.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "nexgen_msp.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "nexgen_msp.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	"Contact": {
		"after_insert": "nexgen_msp.utils.permissions.sync_contact_user_permission",
		"on_update": "nexgen_msp.utils.permissions.sync_contact_user_permission",
	}
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"nexgen_msp.tasks.all"
# 	],
# 	"daily": [
# 		"nexgen_msp.tasks.daily"
# 	],
# 	"hourly": [
# 		"nexgen_msp.tasks.hourly"
# 	],
# 	"weekly": [
# 		"nexgen_msp.tasks.weekly"
# 	],
# 	"monthly": [
# 		"nexgen_msp.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "nexgen_msp.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "nexgen_msp.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "nexgen_msp.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "nexgen_msp.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["nexgen_msp.utils.before_request"]
# after_request = ["nexgen_msp.utils.after_request"]

# Job Events
# ----------
# before_job = ["nexgen_msp.utils.before_job"]
# after_job = ["nexgen_msp.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"nexgen_msp.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

