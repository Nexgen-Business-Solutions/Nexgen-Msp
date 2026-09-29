"""The company a browser run needs, made and taken away again.

A headless run reads real screens, so it needs real records behind them: people in two
departments, machines somebody holds, services running and services that stopped, and two
accounts to sign in with. Everything it writes carries the test prefix, and `teardown`
removes all of it whether the run finished or not.

    bench --site msp.localhost execute nexgen_msp.utils.e2e_fixture.setup
    bench --site msp.localhost execute nexgen_msp.utils.e2e_fixture.teardown

Never run it against production. It creates a customer, accounts and services.
"""

import functools
import json

import frappe
import pyotp
from frappe.utils.password import encrypt

from nexgen_msp.api.internal.services.authority_service import AuthorityService
from nexgen_msp.api.internal.services.service_lifecycle_service import ServiceLifecycleService
from nexgen_msp.api.internal.services.team_service import TeamService
from nexgen_msp.api.portal.services.portal_service import PortalService
from nexgen_msp.api.two_factor.services.two_factor_service import TwoFactorService
from nexgen_msp.utils import device_holders
from nexgen_msp.utils.auth_constants import DEFAULTS_PARENT_2FA

PREFIX = "ZZE2E"
PASSWORD = "Zze2e-Headless-2026"
CUSTOMER = f"{PREFIX} Customer"


def test_site_only(fn):
    """Refuse to run on a site that does not allow tests, production first of all."""

    @functools.wraps(fn)
    def guarded(*args, **kwargs):
        if not frappe.conf.allow_tests:
            frappe.throw("This fixture only runs on a site that allows tests.")

        return fn(*args, **kwargs)

    return guarded


def _customer():
    if not frappe.db.exists("Customer", CUSTOMER):
        frappe.get_doc(
            {
                "doctype": "Customer",
                "customer_name": CUSTOMER,
                "customer_type": "Company",
                "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
                "territory": frappe.db.get_value("Territory", {"is_group": 0}, "name"),
            }
        ).insert(ignore_permissions=True)

    return CUSTOMER


def _service(code, scope, label):
    item = f"{PREFIX}-SVC-{code}"

    if not frappe.db.exists("Item", item):
        frappe.get_doc(
            {
                "doctype": "Item",
                "item_code": item,
                "item_name": f"{PREFIX} {label}",
                "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
                "is_stock_item": 0,
                "is_sales_item": 1,
                "stock_uom": "Month",
                "sales_uom": "Month",
                "uoms": [{"uom": "Month", "conversion_factor": 1}],
            }
        ).insert(ignore_permissions=True)

    if not frappe.db.exists("MSP Service Definition", {"item": item}):
        frappe.get_doc(
            {
                "doctype": "MSP Service Definition",
                "item": item,
                "enabled": 1,
                "service_scope": scope,
            }
        ).insert(ignore_permissions=True)

    return item


def _contract(services, customer=CUSTOMER):
    price_list = frappe.db.get_value(
        "Price List", {"selling": 1, "enabled": 1}, ["name", "currency"], as_dict=True
    )
    started = frappe.utils.add_days(frappe.utils.today(), -365)
    existing = frappe.db.get_value("MSP Contract", {"customer": customer}, "name")

    contract = (
        frappe.get_doc("MSP Contract", existing)
        if existing
        else frappe.get_doc(
            {
                "doctype": "MSP Contract",
                "customer": customer,
                "status": "Active",
                "start_date": started,
                "billing_frequency": "Monthly",
                "billing_timing": "In Arrears",
                "proration_method": "Daily Actual Days",
                "invoice_grouping": "One Invoice",
                "price_list": price_list.name,
                "currency": price_list.currency,
            }
        )
    )

    for service in services:
        if not any(row.service_item == service for row in contract.services):
            contract.append("services", {"service_item": service})

    contract.save(ignore_permissions=True)

    for service in services:
        if not frappe.db.exists(
            "Item Price", {"item_code": service, "customer": customer, "selling": 1}
        ):
            frappe.get_doc(
                {
                    "doctype": "Item Price",
                    "item_code": service,
                    "price_list": price_list.name,
                    "customer": customer,
                    "selling": 1,
                    "buying": 0,
                    "currency": price_list.currency,
                    "price_list_rate": 25.0,
                    "valid_from": started,
                }
            ).insert(ignore_permissions=True)

    return contract.name


def _department(name, customer=CUSTOMER):
    full = f"{PREFIX} {name}"
    existing = frappe.db.get_value(
        "MSP Department", {"customer": customer, "department_name": full}, "name"
    )

    if existing:
        return existing

    return frappe.get_doc(
        {"doctype": "MSP Department", "customer": customer, "department_name": full}
    ).insert(ignore_permissions=True).name


def _person(full_name, department=None, customer=CUSTOMER, username=None):
    existing = frappe.db.get_value(
        "MSP Client User", {"customer": customer, "full_name": f"{PREFIX} {full_name}"}, "name"
    )

    if existing:
        return existing

    return frappe.get_doc(
        {
            "doctype": "MSP Client User",
            "customer": customer,
            "full_name": f"{PREFIX} {full_name}",
            "department": department,
            "username": username,
            "lifecycle_status": "Active",
            "start_date": frappe.utils.add_days(frappe.utils.today(), -200),
        }
    ).insert(ignore_permissions=True).name


def _device(hostname, holder=None, customer=CUSTOMER, held_since=None):
    serial = f"{PREFIX}-SN-{hostname}"
    existing = frappe.db.get_value("MSP Managed Device", {"serial_number": serial}, "name")

    if existing:
        return existing

    doc = frappe.get_doc(
        {
            "doctype": "MSP Managed Device",
            "customer": customer,
            "hostname": f"{PREFIX}-{hostname}",
            "device_type": "PC",
            "status": "Stock",
            "serial_number": serial,
        }
    ).insert(ignore_permissions=True)

    if holder:
        device_holders.hand_over(doc, holder, on_date=held_since)
        doc.status = "Active"
        doc.save(ignore_permissions=True)

    return doc.name


def _account(kind, role, suffix, customer=None, rights=None):
    email = f"{PREFIX.lower()}.{suffix}@example.invalid"

    if not frappe.db.exists("User", email):
        TeamService.create_account(
            email=email,
            first_name=f"{PREFIX} {suffix}",
            kind=kind,
            role=role,
            customer=customer,
            send_email=0,
        )

    user = frappe.get_doc("User", email)
    user.new_password = PASSWORD
    user.enabled = 1
    user.save(ignore_permissions=True)

    if rights:
        AuthorityService.set_account_rights(email, rights)

    # the run signs in the way anybody does — password, then a code — so the phone
    # a person would hold is replaced by a secret the test knows
    secret = pyotp.random_base32()
    frappe.db.set_default(
        TwoFactorService._key(email), encrypt(secret), parent=DEFAULTS_PARENT_2FA
    )

    return {"email": email, "secret": secret}


@test_site_only
def setup():
    """Build the company, and say what the browser run should open.

    A run that stopped half-way leaves records behind, and a second run would then
    open a service somebody already has. So the ground is cleared first, every time.
    """
    frappe.set_user("Administrator")
    teardown()
    _customer()

    mail = _service("MAIL", "User", "Mailbox")
    vpn = _service("VPN", "User", "VPN access")
    antivirus = _service("AV", "Device", "Antivirus")
    # the fulfilment run really ends what it is given, so it is given a service of its own
    helpdesk = _service("DESK", "User", "Helpdesk")
    _contract([mail, vpn, antivirus, helpdesk])

    finance = _department("Finance")
    sales = _department("Sales")
    alice = _person("Alice", finance)
    bob = _person("Bob", finance)
    carol = _person("Carol", sales)
    _person("Dan")

    laptop = _device("PC-ALICE", alice)
    _device("PC-CAROL", carol)
    _device("PC-STOCK")

    running = ServiceLifecycleService.activate(
        customer=CUSTOMER,
        service_item=mail,
        target_scope="User",
        client_user=alice,
        effective_date=frappe.utils.add_days(frappe.utils.today(), -120),
    )["name"]
    stopped = ServiceLifecycleService.activate(
        customer=CUSTOMER,
        service_item=vpn,
        target_scope="User",
        client_user=alice,
        effective_date=frappe.utils.add_days(frappe.utils.today(), -100),
    )["name"]
    ServiceLifecycleService.activate(
        customer=CUSTOMER,
        service_item=mail,
        target_scope="User",
        client_user=bob,
        effective_date=frappe.utils.add_days(frappe.utils.today(), -90),
    )
    ServiceLifecycleService.activate(
        customer=CUSTOMER,
        service_item=antivirus,
        target_scope="Device",
        managed_device=laptop,
        effective_date=frappe.utils.add_days(frappe.utils.today(), -80),
    )
    ServiceLifecycleService.end(
        assignment=stopped, effective_date=frappe.utils.add_days(frappe.utils.today(), -10)
    )

    for person in (alice, bob):
        ServiceLifecycleService.activate(
            customer=CUSTOMER,
            service_item=helpdesk,
            target_scope="User",
            client_user=person,
            effective_date=frappe.utils.add_days(frappe.utils.today(), -70),
        )

    technician = _account("internal", "MSP Technician", "tech")
    administrator = _account("internal", "MSP System Admin", "admin")
    operator = _account(
        "customer", "MSP Customer Operator", "operator", customer=CUSTOMER, rights={"can_submit": 0, "can_approve": 0}
    )
    manager = _account(
        "customer",
        "MSP Customer Manager",
        "manager",
        customer=CUSTOMER,
        rights={"can_submit": 1, "can_approve": 1},
    )
    requester = _account(
        "customer",
        "MSP Customer Manager",
        "asker",
        customer=CUSTOMER,
        rights={"can_submit": 1, "can_approve": 0},
    )
    frappe.db.commit()

    print(
        json.dumps(
            {
                "customer": CUSTOMER,
                "password": PASSWORD,
                "technician": technician["email"],
                "technician_secret": technician["secret"],
                "administrator": administrator["email"],
                "administrator_secret": administrator["secret"],
                "operator": operator["email"],
                "operator_secret": operator["secret"],
                "manager": manager["email"],
                "manager_secret": manager["secret"],
                "requester": requester["email"],
                "requester_secret": requester["secret"],
                "person": alice,
                "colleague": bob,
                "other_department": carol,
                "device": laptop,
                "running": running,
                "stopped": stopped,
                "services": {
                    "user": mail,
                    "second": vpn,
                    "device": antivirus,
                    "fulfilment": helpdesk,
                },
            },
            indent=2,
        )
    )


@test_site_only
def submitted_request():
    """A request the fulfilment screens can be read against, raised the way a customer does.

    Two people, one act: end the mailbox for the whole selection. One of them does not have
    it, so the request carries one line and records the other as untouched — which is exactly
    the shape the approval and review screens have to show.
    """
    from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

    frappe.set_user(f"{PREFIX.lower()}.manager@example.invalid")
    frappe.clear_cache(user=frappe.session.user)

    try:
        people = frappe.get_all(
            "MSP Client User",
            filters={"customer": CUSTOMER},
            fields=["name", "full_name", "department"],
            order_by="full_name asc",
        )
        subjects = [
            {
                "subject_key": f"user:{row.name}",
                "client_user": row.name,
                "full_name": row.full_name,
                "department": row.department,
                "added_via": "Company",
            }
            for row in people
        ]
        options = RequestScopeService.operation_options(customer=CUSTOMER, subjects=subjects)
        card = next(
            option
            for domain in options["domains"]
            if domain["key"] == "Service"
            for option in domain["options"]
            if option["object_label"].endswith("Helpdesk")
        )
        action = next(
            row for row in card["actions"] if row["operation_code"] == "service.end"
        )
        out = PortalService.create_request(
            customer=CUSTOMER,
            subjects=subjects,
            action_groups=[
                {
                    "group_key": "grp:e2e-end-helpdesk",
                    "operation_code": "service.end",
                    "operation_label_snapshot": action["operation_label_snapshot"],
                    "domain": "Service",
                    "service_item": card["object_key"],
                    "source_scope_type": "All",
                    "source_scope_label": "All selected",
                    "selected_subject_count": len(subjects),
                    "targets": action["targets"],
                    "exclusions": action["exclusions"],
                }
            ],
            details="Raised by the browser fixture.",
        )
    finally:
        frappe.set_user("Administrator")

    frappe.db.commit()
    print(json.dumps({"request": out["name"], "targets": len(action["targets"])}, indent=2))


@test_site_only
def add_request():
    """A second request whose work cannot run until somebody enters two usernames.

    This is the shape the prerequisite dialogs exist for: the customer was never asked for a
    username, so the work is ready in every other respect and waits on information only the
    people doing it can find.
    """
    from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
    from nexgen_msp.api.internal.services.request_service import RequestService
    from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

    people = frappe.get_all(
        "MSP Client User",
        filters={"customer": CUSTOMER, "full_name": ("in", (f"{PREFIX} Carol", f"{PREFIX} Dan"))},
        fields=["name", "full_name", "department"],
        order_by="full_name asc",
    )

    for row in people:
        frappe.db.set_value("MSP Client User", row.name, "username", None)

    frappe.db.commit()

    subjects = [
        {
            "subject_key": f"user:{row.name}",
            "client_user": row.name,
            "full_name": row.full_name,
            "department": row.department,
            "added_via": "Existing",
        }
        for row in people
    ]
    frappe.set_user(f"{PREFIX.lower()}.manager@example.invalid")
    frappe.clear_cache(user=frappe.session.user)

    try:
        options = RequestScopeService.operation_options(customer=CUSTOMER, subjects=subjects)
        card = next(
            option
            for domain in options["domains"]
            if domain["key"] == "Service"
            for option in domain["options"]
            if option["object_label"].endswith("VPN access")
        )
        action = next(row for row in card["actions"] if row["operation_code"] == "service.add")
        out = PortalService.create_request(
            customer=CUSTOMER,
            subjects=subjects,
            action_groups=[
                {
                    "group_key": "grp:e2e-add-vpn",
                    "operation_code": "service.add",
                    "operation_label_snapshot": action["operation_label_snapshot"],
                    "domain": "Service",
                    "service_item": card["object_key"],
                    "source_scope_type": "All",
                    "source_scope_label": "All selected",
                    "selected_subject_count": len(subjects),
                    "targets": action["targets"],
                    "exclusions": action["exclusions"],
                }
            ],
        )
    finally:
        frappe.set_user("Administrator")

    name = out["name"]
    frappe.set_user(f"{PREFIX.lower()}.tech@example.invalid")
    frappe.clear_cache(user=frappe.session.user)

    try:
        RequestService.run_action(name=name, action="start_review")

        for idx in range(1, len(action["targets"]) + 1):
            RequestService.set_line_status(name=name, idx=idx, line_status="Approved")

        RequestService.run_action(name=name, action="approve")
        plan = RequestExecutionService.get_execution_plan(request=name)
    finally:
        frappe.set_user("Administrator")

    frappe.db.commit()
    print(
        json.dumps(
            {
                "request": name,
                "targets": len(action["targets"]),
                "requirements": len(plan["requirements"]),
            },
            indent=2,
        )
    )


@test_site_only
def new_person_request():
    """A request for somebody who does not exist yet, and a machine nobody has settled.

    Two services for one new person: a personal one and one that runs on a machine they do
    not hold, because they do not exist yet. That is the shape the preparation dialogs are
    for — a Client User to create, a Device to settle, and a username to record. Its lines
    are left undecided: the browser run reviews them itself.
    """
    from nexgen_msp.api.portal.services.request_scope_service import RequestScopeService

    subjects = [
        {
            "subject_key": "new:e2e-recruit",
            "kind": "new",
            "client_user": None,
            "full_name": f"{PREFIX} Recruit",
            "added_via": "New",
        }
    ]
    requested_devices = [
        {
            "device_requirement_key": "new-device:e2e-recruit",
            "display_label": "New laptop",
            "device_type": "Laptop",
            "intended_holder_subject_key": "new:e2e-recruit",
        }
    ]
    frappe.set_user(f"{PREFIX.lower()}.manager@example.invalid")
    frappe.clear_cache(user=frappe.session.user)

    try:
        options = RequestScopeService.operation_options(
            customer=CUSTOMER, subjects=subjects, requested_devices=requested_devices
        )
        groups = [
            {
                "group_key": "grp:e2e-recruit-laptop",
                "operation_code": "device.assign",
                "operation_label_snapshot": "Assign device",
                "domain": "Device",
                "service_item": None,
                "source_scope_type": "Person",
                "source_scope_key": "new:e2e-recruit",
                "source_scope_label": f"{PREFIX} Recruit",
                "selected_subject_count": 1,
                "targets": [
                    {
                        "subject_key": "new:e2e-recruit",
                        "client_user": None,
                        "full_name": f"{PREFIX} Recruit",
                        "target_scope": "Device",
                        "managed_device": None,
                        "device_requirement_key": "new-device:e2e-recruit",
                        "requested_holder_subject_key": "new:e2e-recruit",
                        "source_service_assignment": None,
                    }
                ],
                "exclusions": [],
            }
        ]

        for domain in options["domains"]:
            if domain["key"] != "Service":
                continue

            for option in domain["options"]:
                if not option["object_label"].endswith(("Antivirus", "Mailbox")):
                    continue

                action = option["actions"][0]
                groups.append(
                    {
                        "group_key": f"grp:e2e-recruit-{option['object_key']}",
                        "operation_code": "service.add",
                        "operation_label_snapshot": action["operation_label_snapshot"],
                        "domain": "Service",
                        "service_item": option["object_key"],
                        "source_scope_type": "Person",
                        "source_scope_key": "new:e2e-recruit",
                        "source_scope_label": f"{PREFIX} Recruit",
                        "selected_subject_count": 1,
                        "targets": action["targets"],
                        "exclusions": action["exclusions"],
                    }
                )

        out = PortalService.create_request(
            customer=CUSTOMER,
            subjects=subjects,
            requested_devices=requested_devices,
            action_groups=groups,
        )
    finally:
        frappe.set_user("Administrator")

    frappe.db.commit()
    print(json.dumps({"request": out["name"], "lines": len(out["lines"])}, indent=2))


JOURNEY = f"{PREFIX} Journey"


@test_site_only
def journey_ground():
    """The only two things a browser run cannot do for itself: a company, and a way in.

    Everything else the full journey needs — the people, the machines, the services, the
    contract, the rates, the requests, the work, the billing, the dispute — is done by
    clicking, because that is the point of the run.
    """
    frappe.set_user("Administrator")

    if not frappe.db.exists("Customer", JOURNEY):
        frappe.get_doc(
            {
                "doctype": "Customer",
                "customer_name": JOURNEY,
                "customer_type": "Company",
                "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
                "territory": frappe.db.get_value("Territory", {"is_group": 0}, "name"),
            }
        ).insert(ignore_permissions=True)

    # Logistics exists for the one scenario that needs a Department of its own: a whole group
    # asked for at once, minus one person who must stay in the group and get nothing
    for name in ("Finance", "Support", "Logistics"):
        full = f"{PREFIX} {name}"

        if not frappe.db.exists(
            "MSP Department", {"customer": JOURNEY, "department_name": full}
        ):
            frappe.get_doc(
                {"doctype": "MSP Department", "customer": JOURNEY, "department_name": full}
            ).insert(ignore_permissions=True)

    accounts = {
        "admin": _journey_account("internal", "MSP System Admin", "jadmin"),
        "technician": _journey_account("internal", "MSP Technician", "jtech"),
        "manager": _journey_account(
            "customer", "MSP Customer Manager", "jmanager", rights={"can_submit": 1, "can_approve": 1}
        ),
        "operator": _journey_account(
            "customer", "MSP Customer Operator", "joperator", rights={"can_submit": 0, "can_approve": 0}
        ),
        # raises requests but decides nothing: what they send waits for the manager's accord,
        # which is the only way the run ever reaches that screen
        "requester": _journey_account(
            "customer", "MSP Customer Manager", "jasker", rights={"can_submit": 1, "can_approve": 0}
        ),
    }
    frappe.db.commit()

    print(
        json.dumps(
            {
                "customer": JOURNEY,
                "password": PASSWORD,
                "departments": [f"{PREFIX} Finance", f"{PREFIX} Support", f"{PREFIX} Logistics"],
                **{
                    f"{who}{suffix}": value
                    for who, row in accounts.items()
                    for suffix, value in (("", row["email"]), ("_secret", row["secret"]))
                },
            },
            indent=2,
        )
    )


def _journey_account(kind, role, suffix, rights=None):
    return _account(
        kind, role, suffix, customer=JOURNEY if kind == "customer" else None, rights=rights
    )


@test_site_only
def journey_teardown():
    """Take the journey's company away again, whatever state the run left it in."""
    frappe.set_user("Administrator")

    for doctype, field in (
        ("MSP Work Order", "customer"),
        ("MSP Requested Device", "customer"),
        ("MSP Requested Client User", "customer"),
        ("MSP Request", "customer"),
        ("MSP Billing Run", "customer"),
    ):
        for row in frappe.get_all(doctype, filters={field: JOURNEY}, pluck="name"):
            frappe.db.sql(f"delete from `tab{doctype}` where name = %s", row)

    frappe.db.sql("delete from `tabMSP Service Assignment` where customer = %s", JOURNEY)

    for doctype in ("MSP Managed Device", "MSP Client User", "MSP Contract", "MSP Department"):
        for row in frappe.get_all(doctype, filters={"customer": JOURNEY}, pluck="name"):
            frappe.delete_doc(doctype, row, force=True, ignore_permissions=True)

    for row in frappe.get_all("MSP Approval Authority", filters={"name": JOURNEY}, pluck="name"):
        frappe.delete_doc("MSP Approval Authority", row, force=True, ignore_permissions=True)

    for price in frappe.get_all("Item Price", filters={"customer": JOURNEY}, pluck="name"):
        frappe.delete_doc("Item Price", price, force=True, ignore_permissions=True)

    for item in frappe.get_all(
        "Item", filters={"name": ["like", f"{PREFIX}-JS-%"]}, pluck="name"
    ):
        for definition in frappe.get_all(
            "MSP Service Definition", filters={"item": item}, pluck="name"
        ):
            frappe.delete_doc(
                "MSP Service Definition", definition, force=True, ignore_permissions=True
            )

        frappe.delete_doc("Item", item, force=True, ignore_permissions=True)

    for email in frappe.get_all(
        "User", filters={"name": ["like", f"{PREFIX.lower()}.j%"]}, pluck="name"
    ):
        _purge_journey_account(email)

    _purge_journey_ledger()

    # a customer the run created through the browser goes too
    for name in frappe.get_all(
        "Customer", filters={"name": ["like", f"{PREFIX}%"]}, pluck="name"
    ):
        if frappe.db.exists("Customer", name):
            frappe.delete_doc("Customer", name, force=True, ignore_permissions=True)

    frappe.db.commit()
    print(f"{JOURNEY}: removed")


def _purge_journey_ledger():
    """Take the run's accounting documents away as well.

    Invoicing a run draws a Sales Order and a Sales Invoice, and both are submitted. Deleting
    the customer with ``force`` leaves them behind as orphans that no screen can reach and no
    later run accounts for, so they are cancelled and removed here — invoice first, because the
    order is what it was drawn from. Only this run's own company is touched.
    """
    for doctype in ("Sales Invoice", "Sales Order"):
        for name in frappe.get_all(
            doctype, filters={"customer": ["like", f"{PREFIX}%"]}, pluck="name"
        ):
            doc = frappe.get_doc(doctype, name)
            doc.flags.ignore_permissions = True

            if doc.docstatus == 1:
                doc.flags.ignore_links = True
                doc.cancel()

            frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)


def _purge_journey_account(email):
    for contact in frappe.db.sql_list(
        "select distinct parent from `tabContact Email` where email_id = %s", email
    ):
        frappe.db.sql("delete from `tabDynamic Link` where parenttype='Contact' and parent=%s", contact)
        frappe.db.sql("delete from `tabContact Email` where parent=%s", contact)
        frappe.db.sql("delete from `tabContact` where name=%s", contact)

    frappe.db.sql("delete from `tabUser Permission` where user=%s", email)
    frappe.db.sql("delete from `tabHas Role` where parent=%s", email)
    frappe.db.sql("delete from `tabNotification Settings` where name=%s", email)
    frappe.db.sql("delete from `tabDefaultValue` where parent=%s", email)
    frappe.db.sql("delete from tabUser where name=%s", email)


@test_site_only
def teardown():
    """Take every row the run wrote away again, children before parents."""
    frappe.set_user("Administrator")
    people = frappe.get_all("MSP Client User", filters={"customer": CUSTOMER}, pluck="name")
    devices = frappe.get_all("MSP Managed Device", filters={"customer": CUSTOMER}, pluck="name")
    requests = frappe.get_all("MSP Request", filters={"customer": CUSTOMER}, pluck="name")

    for request in requests:
        for order in frappe.get_all(
            "MSP Work Order", filters={"request": request}, pluck="name"
        ):
            frappe.delete_doc("MSP Work Order", order, force=True, ignore_permissions=True)
        for doctype in ("MSP Requested Device", "MSP Requested Client User"):
            for row in frappe.get_all(doctype, filters={"request": request}, pluck="name"):
                frappe.delete_doc(doctype, row, force=True, ignore_permissions=True)
        frappe.delete_doc("MSP Request", request, force=True, ignore_permissions=True)

    frappe.db.sql("delete from `tabMSP Service Assignment` where customer = %s", CUSTOMER)

    for run in frappe.get_all("MSP Billing Run", filters={"customer": CUSTOMER}, pluck="name"):
        frappe.db.sql("delete from `tabMSP Billing Run Line` where parent = %s", run)
        frappe.db.sql("delete from `tabMSP Billing Run` where name = %s", run)

    for device in devices:
        frappe.delete_doc("MSP Managed Device", device, force=True, ignore_permissions=True)

    for person in people:
        frappe.delete_doc("MSP Client User", person, force=True, ignore_permissions=True)

    for doctype, field in (
        ("MSP Contract", "customer"),
        ("MSP Department", "customer"),
        ("MSP Approval Authority", "name"),
    ):
        for row in frappe.get_all(doctype, filters={field: CUSTOMER}, pluck="name"):
            frappe.delete_doc(doctype, row, force=True, ignore_permissions=True)

    for price in frappe.get_all("Item Price", filters={"customer": CUSTOMER}, pluck="name"):
        frappe.delete_doc("Item Price", price, force=True, ignore_permissions=True)

    for item in frappe.get_all("Item", filters={"name": ["like", f"{PREFIX}-%"]}, pluck="name"):
        for definition in frappe.get_all(
            "MSP Service Definition", filters={"item": item}, pluck="name"
        ):
            frappe.delete_doc(
                "MSP Service Definition", definition, force=True, ignore_permissions=True
            )
        frappe.delete_doc("Item", item, force=True, ignore_permissions=True)

    for email in frappe.get_all("User", filters={"name": ["like", f"{PREFIX.lower()}.%"]}, pluck="name"):
        for contact in frappe.db.sql_list(
            "select distinct parent from `tabContact Email` where email_id = %s", email
        ):
            frappe.db.sql("delete from `tabDynamic Link` where parenttype='Contact' and parent=%s", contact)
            frappe.db.sql("delete from `tabContact Email` where parent=%s", contact)
            frappe.db.sql("delete from `tabContact` where name=%s", contact)

        frappe.db.sql("delete from `tabUser Permission` where user=%s", email)
        frappe.db.sql("delete from `tabHas Role` where parent=%s", email)
        frappe.db.sql("delete from `tabNotification Settings` where name=%s", email)
        frappe.db.sql("delete from `tabUser` where name=%s", email)

    if frappe.db.exists("Customer", CUSTOMER):
        frappe.delete_doc("Customer", CUSTOMER, force=True, ignore_permissions=True)

    frappe.db.commit()
    print(f"{PREFIX}: removed")


MATRIX = f"{PREFIX} Matrix"
MATRIX_ACCOUNTS = {
    "admin": ("internal", "MSP System Admin", "mxadmin", None),
    "technician": ("internal", "MSP Technician", "mxtech", None),
    "manager": ("customer", "MSP Customer Manager", "mxmanager", {"can_submit": 1, "can_approve": 1}),
    "operator": ("customer", "MSP Customer Operator", "mxoperator", {"can_submit": 0, "can_approve": 0}),
    "requester": ("customer", "MSP Customer Manager", "mxasker", {"can_submit": 1, "can_approve": 0}),
}
MATRIX_SERVICES = (
    ("MX-MAIL", "User", "Matrix Mailbox"),
    ("MX-VPN", "User", "Matrix VPN"),
    ("MX-ARCH1", "User", "Matrix Archive One"),
    ("MX-ARCH2", "User", "Matrix Archive Two"),
    ("MX-AV", "Device", "Matrix Antivirus"),
    ("MX-BACKUP", "Device", "Matrix Backup"),
)
MATRIX_PEOPLE = (
    ("bare", 60),
    ("named", 15),
    ("user_active", 30),
    ("user_suspended", 15),
    ("device_active", 23),
    ("device_suspended", 12),
    ("holder", 15),
    ("archive_one", 2),
    ("archive_two", 2),
)
MATRIX_STOCK = 20
MATRIX_TEAMS = 8
MATRIX_TEAM_SIZE = 3
MATRIX_REAL = ("MSP Service Assignment", "MSP Client User", "MSP Managed Device", "MSP Request")


def _matrix_email(suffix):
    return f"{PREFIX.lower()}.{suffix}@example.invalid"


def _matrix_counts():
    """How many rows each register holds, split by whose they are."""
    counts = {}

    for doctype in MATRIX_REAL:
        rows = frappe.db.sql(
            f"""
            select
                sum(case when customer = %(matrix)s then 1 else 0 end),
                sum(case when customer like 'ZZ%%' and customer != %(matrix)s then 1 else 0 end),
                sum(case when customer is null or customer not like 'ZZ%%' then 1 else 0 end)
            from `tab{doctype}`
            """,
            {"matrix": MATRIX},
        )[0]
        counts[doctype] = {
            "matrix": int(rows[0] or 0),
            "other_tests": int(rows[1] or 0),
            "real": int(rows[2] or 0),
        }

    return counts


@test_site_only
def matrix_counts():
    """Print the register counts, the matrix's own apart from everybody else's."""
    print(json.dumps(_matrix_counts(), indent=2))


@test_site_only
def matrix_ground():
    """Build the matrix company: a pool of people and machines addressed by index, and five ways in."""
    frappe.set_user("Administrator")
    before = _matrix_counts()

    if not frappe.db.exists("Customer", MATRIX):
        frappe.get_doc(
            {
                "doctype": "Customer",
                "customer_name": MATRIX,
                "customer_type": "Company",
                "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
                "territory": frappe.db.get_value("Territory", {"is_group": 0}, "name"),
            }
        ).insert(ignore_permissions=True)

    services = {code: _service(code, scope, label) for code, scope, label in MATRIX_SERVICES}
    _contract(list(services.values()), customer=MATRIX)
    labels = {code: f"{PREFIX} {label}" for code, _scope, label in MATRIX_SERVICES}

    alpha = _department("Matrix Alpha", customer=MATRIX)
    beta = _department("Matrix Beta", customer=MATRIX)
    teams = {
        f"{PREFIX} Matrix Team {index:02d}": _department(f"Matrix Team {index:02d}", customer=MATRIX)
        for index in range(1, MATRIX_TEAMS + 1)
    }

    past = frappe.utils.add_days(frappe.utils.today(), -120)
    paused = frappe.utils.add_days(frappe.utils.today(), -30)
    number = {"person": 0, "machine": 0}

    def person(department, username=False):
        number["person"] += 1
        label = f"Matrix P{number['person']:03d}"
        name = _person(
            label,
            department,
            customer=MATRIX,
            username=f"zze2e.mx.p{number['person']:03d}" if username else None,
        )
        return name, f"{PREFIX} {label}"

    def machine(holder=None):
        number["machine"] += 1
        hostname = f"MATRIX-D{number['machine']:03d}"
        return (
            _device(hostname, holder, customer=MATRIX, held_since=frappe.utils.add_days(frappe.utils.today(), -200)),
            f"{PREFIX}-{hostname}",
        )

    def activate(code, client_user=None, managed_device=None):
        return ServiceLifecycleService.activate(
            customer=MATRIX,
            service_item=services[code],
            target_scope="Device" if managed_device else "User",
            client_user=client_user,
            managed_device=managed_device,
            effective_date=past,
        )["name"]

    people = {}
    held = {}

    for kind, size in MATRIX_PEOPLE:
        people[kind] = []

        for index in range(size):
            department = beta if index % 4 == 3 else alpha
            name, full = person(department, username=kind == "named")
            people[kind].append(full)

            if kind == "user_active":
                activate("MX-MAIL", client_user=name)
                activate("MX-VPN", client_user=name)
            elif kind == "user_suspended":
                ServiceLifecycleService.suspend(
                    assignment=activate("MX-MAIL", client_user=name), effective_date=paused
                )
            elif kind in ("device_active", "device_suspended", "holder"):
                device, hostname = machine(name)
                held[full] = hostname

                if kind == "device_active":
                    activate("MX-AV", managed_device=device)
                elif kind == "device_suspended":
                    ServiceLifecycleService.suspend(
                        assignment=activate("MX-AV", managed_device=device), effective_date=paused
                    )
            elif kind == "archive_one":
                activate("MX-ARCH1", client_user=name)
            elif kind == "archive_two":
                activate("MX-ARCH2", client_user=name)

    stock = [machine()[1] for _index in range(MATRIX_STOCK)]
    members = {}

    for team, department in teams.items():
        members[team] = [person(department)[1] for _index in range(MATRIX_TEAM_SIZE)]

    accounts = {
        who: _account(kind, role, suffix, customer=MATRIX if kind == "customer" else None, rights=rights)
        for who, (kind, role, suffix, rights) in MATRIX_ACCOUNTS.items()
    }
    frappe.db.commit()

    print(
        json.dumps(
            {
                "customer": MATRIX,
                "password": PASSWORD,
                "departments": {"alpha": f"{PREFIX} Matrix Alpha", "beta": f"{PREFIX} Matrix Beta"},
                "services": labels,
                "people": people,
                "held": held,
                "stock": stock,
                "teams": members,
                "counts_before": before,
                "counts_after": _matrix_counts(),
                **{
                    f"{who}{suffix}": value
                    for who, row in accounts.items()
                    for suffix, value in (("", row["email"]), ("_secret", row["secret"]))
                },
            },
            indent=2,
        )
    )


def _matrix_names():
    """Every record the matrix owns, by name, listed before anything is removed."""
    requests = frappe.get_all("MSP Request", filters={"customer": MATRIX}, pluck="name")
    names = {
        "MSP Request": requests,
        "MSP Work Order": [],
        "MSP Requested Client User": [],
        "MSP Requested Device": [],
    }

    for request in requests:
        for doctype in ("MSP Work Order", "MSP Requested Client User", "MSP Requested Device"):
            names[doctype] += frappe.get_all(doctype, filters={"request": request}, pluck="name")

    for doctype in (
        "MSP Work Order",
        "MSP Requested Client User",
        "MSP Requested Device",
        "MSP Service Assignment",
        "MSP Managed Device",
        "MSP Client User",
        "MSP Contract",
        "MSP Department",
    ):
        names[doctype] = sorted(
            set(names.get(doctype, []))
            | set(frappe.get_all(doctype, filters={"customer": MATRIX}, pluck="name"))
        )

    names["MSP Approval Authority"] = frappe.get_all(
        "MSP Approval Authority", filters={"name": MATRIX}, pluck="name"
    )
    names["Item Price"] = frappe.get_all("Item Price", filters={"customer": MATRIX}, pluck="name")
    items = [f"{PREFIX}-SVC-{code}" for code, _scope, _label in MATRIX_SERVICES]
    names["Item"] = [item for item in items if frappe.db.exists("Item", item)]
    names["MSP Service Definition"] = [
        definition
        for item in names["Item"]
        for definition in frappe.get_all("MSP Service Definition", filters={"item": item}, pluck="name")
    ]
    names["User"] = [
        _matrix_email(suffix)
        for _kind, _role, suffix, _rights in MATRIX_ACCOUNTS.values()
        if frappe.db.exists("User", _matrix_email(suffix))
    ]
    names["Customer"] = [MATRIX] if frappe.db.exists("Customer", MATRIX) else []

    return names


def _matrix_residue():
    """Rows still carrying the matrix's name, per register."""
    return {
        "MSP Client User": frappe.db.count("MSP Client User", {"full_name": ["like", f"{MATRIX}%"]}),
        "MSP Managed Device": frappe.db.count(
            "MSP Managed Device", {"hostname": ["like", f"{PREFIX}-MATRIX%"]}
        ),
        "MSP Department": frappe.db.count("MSP Department", {"name": ["like", f"{MATRIX}%"]}),
        "MSP Service Assignment": frappe.db.count("MSP Service Assignment", {"customer": MATRIX}),
        "MSP Request": frappe.db.count("MSP Request", {"customer": MATRIX}),
        "MSP Work Order": frappe.db.count("MSP Work Order", {"customer": MATRIX}),
        "MSP Requested Client User": frappe.db.count("MSP Requested Client User", {"customer": MATRIX}),
        "MSP Requested Device": frappe.db.count("MSP Requested Device", {"customer": MATRIX}),
        "MSP Contract": frappe.db.count("MSP Contract", {"customer": MATRIX}),
        "Item": frappe.db.count("Item", {"item_name": ["like", f"{MATRIX}%"]}),
        "Item Price": frappe.db.count("Item Price", {"customer": MATRIX}),
        "User": sum(
            1
            for _kind, _role, suffix, _rights in MATRIX_ACCOUNTS.values()
            if frappe.db.exists("User", _matrix_email(suffix))
        ),
        "Customer": frappe.db.count("Customer", {"name": MATRIX}),
    }


@test_site_only
def matrix_teardown():
    """Remove the matrix company by the names it owns, counting before and after."""
    frappe.set_user("Administrator")
    before = _matrix_counts()
    names = _matrix_names()
    listed = {doctype: len(rows) for doctype, rows in names.items()}

    for doctype in (
        "MSP Work Order",
        "MSP Requested Device",
        "MSP Requested Client User",
        "MSP Request",
        "MSP Service Assignment",
        "MSP Managed Device",
        "MSP Client User",
        "MSP Contract",
        "MSP Department",
        "MSP Approval Authority",
        "Item Price",
        "MSP Service Definition",
        "Item",
    ):
        for name in names[doctype]:
            if frappe.db.exists(doctype, name):
                frappe.delete_doc(
                    doctype, name, force=True, ignore_permissions=True, delete_permanently=True
                )

    for email in names["User"]:
        _purge_journey_account(email)

    for name in names["Customer"]:
        frappe.delete_doc("Customer", name, force=True, ignore_permissions=True, delete_permanently=True)

    frappe.db.commit()
    after = _matrix_counts()
    print(
        json.dumps(
            {
                "listed": listed,
                "counts_before": before,
                "counts_after": after,
                "residue": _matrix_residue(),
            },
            indent=2,
        )
    )


def _matrix_holdings(client_user=None, managed_device=None):
    field = "client_user" if client_user else "managed_device"
    rows = frappe.get_all(
        "MSP Service Assignment",
        filters={"customer": MATRIX, field: client_user or managed_device},
        fields=["name", "service_item", "operational_status", "effective_start_date", "effective_end_date"],
        order_by="creation asc",
    )

    return [
        {
            "service": frappe.db.get_value("Item", row.service_item, "item_name"),
            "status": row.operational_status,
            "start": str(row.effective_start_date or ""),
            "end": str(row.effective_end_date or ""),
        }
        for row in rows
    ]


@test_site_only
def matrix_facts(note=None, people=None, machines=None):
    """Read, and only read, what one matrix request left in the records."""
    frappe.set_user("Administrator")
    people = json.loads(people) if isinstance(people, str) else list(people or [])
    machines = json.loads(machines) if isinstance(machines, str) else list(machines or [])
    request = None

    if note:
        found = frappe.get_all(
            "MSP Request",
            filters={"customer": MATRIX, "details": note},
            pluck="name",
            order_by="creation desc",
        )
        request = found[0] if found else None

    person_name = lambda name: frappe.db.get_value("MSP Client User", name, "full_name") if name else None
    hostname = lambda name: frappe.db.get_value("MSP Managed Device", name, "hostname") if name else None
    item_name = lambda name: frappe.db.get_value("Item", name, "item_name") if name else None
    facts = {
        "request": None,
        "count": 0,
        "total": frappe.db.count("MSP Request", {"customer": MATRIX}),
    }

    if request:
        doc = frappe.get_doc("MSP Request", request)
        facts["count"] = len(frappe.get_all("MSP Request", filters={"customer": MATRIX, "details": note}))
        requested_people = frappe.get_all(
            "MSP Requested Client User",
            filters={"request": request},
            fields=["name", "full_name", "department", "username", "email", "status", "resolution_mode", "resolved_client_user", "cancel_reason"],
        )
        requested_machines = frappe.get_all(
            "MSP Requested Device",
            filters={"request": request},
            fields=["name", "display_label", "hostname", "serial_number", "device_type", "status", "resolution_mode", "resolved_managed_device", "cancel_reason"],
        )
        requested_label = {row.name: row.full_name for row in requested_people}
        requested_label.update({row.name: row.display_label for row in requested_machines})
        orders = frappe.get_all(
            "MSP Work Order",
            filters={"request": request},
            fields=[
                "name", "operation_code", "status", "effective_date", "client_user", "requested_client_user",
                "managed_device", "requested_device", "service_item", "requested_holder",
                "requested_holder_requested_client_user", "resulting_assignment", "request_line_idx", "origin",
                "override_reason",
            ],
            order_by="request_line_idx asc",
        )
        facts["request"] = {
            "name": doc.name,
            "status": doc.status,
            "requested_date": str(doc.requested_date or ""),
            "requester": doc.requester,
            "rejection_reason": doc.rejection_reason,
            "modified_by": doc.modified_by,
        }
        facts["lines"] = [
            {
                "idx": line.idx,
                "operation": line.operation_code,
                "status": line.line_status,
                "reason": line.rejection_reason,
                "person": person_name(line.client_user) or requested_label.get(line.requested_client_user),
                "machine": hostname(line.managed_device) or requested_label.get(line.requested_device),
                "service": item_name(line.requested_service),
                "holder": person_name(line.requested_holder)
                or requested_label.get(line.requested_holder_requested_client_user),
                "date": str(line.requested_effective_date or ""),
            }
            for line in doc.lines
        ]
        facts["work_orders"] = [
            {
                "line": row.request_line_idx,
                "operation": row.operation_code,
                "status": row.status,
                "date": str(row.effective_date or ""),
                "person": person_name(row.client_user) or requested_label.get(row.requested_client_user),
                "machine": hostname(row.managed_device) or requested_label.get(row.requested_device),
                "service": item_name(row.service_item),
                "holder": person_name(row.requested_holder)
                or requested_label.get(row.requested_holder_requested_client_user),
                "origin": row.origin,
                "override_reason": row.override_reason,
            }
            for row in orders
        ]
        facts["requested_people"] = [
            {
                "name": row.full_name,
                "department": row.department,
                "username": row.username,
                "email": row.email,
                "status": row.status,
                "mode": row.resolution_mode,
                "resolved": person_name(row.resolved_client_user),
                "cancel_reason": row.cancel_reason,
            }
            for row in requested_people
        ]
        facts["requested_machines"] = [
            {
                "label": row.display_label,
                "hostname": row.hostname,
                "serial": row.serial_number,
                "type": row.device_type,
                "status": row.status,
                "mode": row.resolution_mode,
                "resolved": hostname(row.resolved_managed_device),
                "cancel_reason": row.cancel_reason,
            }
            for row in requested_machines
        ]

    facts["people"] = {}

    for full_name in people:
        found = frappe.get_all(
            "MSP Client User",
            filters={"customer": MATRIX, "full_name": full_name},
            fields=["name", "username", "department", "email", "lifecycle_status"],
        )
        facts["people"][full_name] = (
            {
                "exists": len(found),
                "username": found[0].username,
                "department": found[0].department,
                "email": found[0].email,
                "machines": frappe.get_all(
                    "MSP Managed Device",
                    filters={"customer": MATRIX, "assigned_client_user": found[0].name},
                    pluck="hostname",
                    order_by="hostname asc",
                ),
                "services": _matrix_holdings(client_user=found[0].name),
            }
            if found
            else {"exists": 0}
        )

    facts["machines"] = {}

    for label in machines:
        found = frappe.get_all(
            "MSP Managed Device",
            filters={"customer": MATRIX, "hostname": label},
            fields=["name", "status", "assigned_client_user", "serial_number", "device_type"],
        )
        facts["machines"][label] = (
            {
                "exists": len(found),
                "status": found[0].status,
                "serial": found[0].serial_number,
                "type": found[0].device_type,
                "holder": person_name(found[0].assigned_client_user),
                "services": _matrix_holdings(managed_device=found[0].name),
            }
            if found
            else {"exists": 0}
        )

    print(json.dumps(facts, indent=2, default=str))
