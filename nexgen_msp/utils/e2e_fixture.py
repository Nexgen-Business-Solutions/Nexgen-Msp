"""The company a browser run needs, made and taken away again.

A headless run reads real screens, so it needs real records behind them: people in two
departments, machines somebody holds, services running and services that stopped, and two
accounts to sign in with. Everything it writes carries the test prefix, and `teardown`
removes all of it whether the run finished or not.

    bench --site msp.localhost execute nexgen_msp.utils.e2e_fixture.setup
    bench --site msp.localhost execute nexgen_msp.utils.e2e_fixture.teardown

Never run it against production. It creates a customer, accounts and services.
"""

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


def _contract(services):
    price_list = frappe.db.get_value(
        "Price List", {"selling": 1, "enabled": 1}, ["name", "currency"], as_dict=True
    )
    started = frappe.utils.add_days(frappe.utils.today(), -365)
    existing = frappe.db.get_value("MSP Contract", {"customer": CUSTOMER}, "name")

    contract = (
        frappe.get_doc("MSP Contract", existing)
        if existing
        else frappe.get_doc(
            {
                "doctype": "MSP Contract",
                "customer": CUSTOMER,
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
            "Item Price", {"item_code": service, "customer": CUSTOMER, "selling": 1}
        ):
            frappe.get_doc(
                {
                    "doctype": "Item Price",
                    "item_code": service,
                    "price_list": price_list.name,
                    "customer": CUSTOMER,
                    "selling": 1,
                    "buying": 0,
                    "currency": price_list.currency,
                    "price_list_rate": 25.0,
                    "valid_from": started,
                }
            ).insert(ignore_permissions=True)

    return contract.name


def _department(name):
    full = f"{PREFIX} {name}"
    existing = frappe.db.get_value(
        "MSP Department", {"customer": CUSTOMER, "department_name": full}, "name"
    )

    if existing:
        return existing

    return frappe.get_doc(
        {"doctype": "MSP Department", "customer": CUSTOMER, "department_name": full}
    ).insert(ignore_permissions=True).name


def _person(full_name, department=None):
    existing = frappe.db.get_value(
        "MSP Client User", {"customer": CUSTOMER, "full_name": f"{PREFIX} {full_name}"}, "name"
    )

    if existing:
        return existing

    return frappe.get_doc(
        {
            "doctype": "MSP Client User",
            "customer": CUSTOMER,
            "full_name": f"{PREFIX} {full_name}",
            "department": department,
            "lifecycle_status": "Active",
            "start_date": frappe.utils.add_days(frappe.utils.today(), -200),
        }
    ).insert(ignore_permissions=True).name


def _device(hostname, holder=None):
    serial = f"{PREFIX}-SN-{hostname}"
    existing = frappe.db.get_value("MSP Managed Device", {"serial_number": serial}, "name")

    if existing:
        return existing

    doc = frappe.get_doc(
        {
            "doctype": "MSP Managed Device",
            "customer": CUSTOMER,
            "hostname": f"{PREFIX}-{hostname}",
            "device_type": "PC",
            "status": "Stock",
            "serial_number": serial,
        }
    ).insert(ignore_permissions=True)

    if holder:
        device_holders.hand_over(doc, holder)
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


def submitted_request():
    """A V3 request the fulfilment screens can be read against, raised the way a customer does.

    Two people, one act: end the mailbox for the whole selection. One of them does not have
    it, so the request carries one line and records the other as untouched — which is exactly
    the shape the approval and review screens have to show.
    """
    from nexgen_msp.api.portal.services.request_v3_service import RequestV3Service

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
        options = RequestV3Service.operation_options(customer=CUSTOMER, subjects=subjects)
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


def add_request():
    """A second request whose work cannot run until somebody enters two usernames.

    This is the shape the prerequisite dialogs exist for: the customer was never asked for a
    username, so the work is ready in every other respect and waits on information only the
    people doing it can find.
    """
    from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
    from nexgen_msp.api.internal.services.request_service import RequestService
    from nexgen_msp.api.portal.services.request_v3_service import RequestV3Service

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
        options = RequestV3Service.operation_options(customer=CUSTOMER, subjects=subjects)
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


def new_person_request():
    """A request for somebody who does not exist yet, and a machine nobody has settled.

    Two services for one new person: a personal one and one that runs on a machine they do
    not hold, because they do not exist yet. That is the shape the preparation dialogs are
    for — a Client User to create, a Device to settle, and a username to record.
    """
    from nexgen_msp.api.internal.services.request_execution_service import RequestExecutionService
    from nexgen_msp.api.internal.services.request_service import RequestService
    from nexgen_msp.api.portal.services.request_v3_service import RequestV3Service

    subjects = [
        {"subject_key": "new:e2e-recruit", "is_new_user": True, "full_name": f"{PREFIX} Recruit"}
    ]
    frappe.set_user(f"{PREFIX.lower()}.manager@example.invalid")
    frappe.clear_cache(user=frappe.session.user)

    try:
        options = RequestV3Service.operation_options(customer=CUSTOMER, subjects=subjects)
        groups = []

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
            customer=CUSTOMER, subjects=subjects, action_groups=groups
        )
    finally:
        frappe.set_user("Administrator")

    name = out["name"]
    frappe.set_user(f"{PREFIX.lower()}.tech@example.invalid")
    frappe.clear_cache(user=frappe.session.user)

    try:
        for idx in range(1, len(groups) + 1):
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
                "requirements": sorted({row["kind"] for row in plan["requirements"]}),
            },
            indent=2,
        )
    )


JOURNEY = f"{PREFIX} Journey"


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
    }
    frappe.db.commit()

    print(
        json.dumps(
            {
                "customer": JOURNEY,
                "password": PASSWORD,
                "departments": [f"{PREFIX} Finance", f"{PREFIX} Support"],
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


def journey_teardown():
    """Take the journey's company away again, whatever state the run left it in."""
    frappe.set_user("Administrator")

    for doctype, field in (
        ("MSP Service Work Order", "customer"),
        ("MSP Service Request", "customer"),
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


def teardown():
    """Take every row the run wrote away again, children before parents."""
    frappe.set_user("Administrator")
    people = frappe.get_all("MSP Client User", filters={"customer": CUSTOMER}, pluck="name")
    devices = frappe.get_all("MSP Managed Device", filters={"customer": CUSTOMER}, pluck="name")
    requests = frappe.get_all("MSP Service Request", filters={"customer": CUSTOMER}, pluck="name")

    for request in requests:
        for order in frappe.get_all(
            "MSP Service Work Order", filters={"service_request": request}, pluck="name"
        ):
            frappe.delete_doc("MSP Service Work Order", order, force=True, ignore_permissions=True)
        frappe.delete_doc("MSP Service Request", request, force=True, ignore_permissions=True)

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
