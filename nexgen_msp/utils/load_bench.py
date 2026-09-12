"""How the screens behave on a company far larger than any we have, measured rather than hoped.

The spec asks for figures at five thousand people and ten thousand services. Nobody has a
customer that size, so the data is made, measured against, and taken away again. Everything
it writes carries the test prefix and is removed at the end, whether the run finished or not.

It reports two numbers per reading: the wall time, and the number of queries. The second is
the one that matters — a page whose query count grows with the rows on it will be slow on
somebody's data long before it is slow on ours.

    bench --site msp.localhost execute nexgen_msp.utils.load_bench.run
    bench --site msp.localhost execute nexgen_msp.utils.load_bench.run --kwargs "{'people': 5000}"

Never run it against production. It writes thousands of rows before it deletes them.
"""

import time

import frappe

PREFIX = "ZZBENCH"


def _timed(label, call):
    """Run one reading, and say what it cost.

    Frappe keeps no query counter, so the database call is wrapped for the duration of the
    reading and put back afterwards. Everything above it, get_value and get_all included,
    goes through that one method.

    The reading is taken twice and the second one is kept. The first pays for loading every
    doctype definition it touches, which a running server has already done and no visitor
    ever waits for.
    """
    try:
        call()
    except Exception as error:
        return {"reading": label, "failed": str(error)[:120]}

    database = frappe.local.db
    original = database.sql
    counted = {"n": 0}

    def counting(*args, **kwargs):
        counted["n"] += 1
        return original(*args, **kwargs)

    database.sql = counting
    started = time.perf_counter()

    try:
        outcome = call()
    except Exception as error:  # a reading that cannot run is a result too
        return {"reading": label, "failed": str(error)[:120]}
    finally:
        database.sql = original

    elapsed = (time.perf_counter() - started) * 1000
    size = len(outcome) if isinstance(outcome, (list, dict)) else 0

    return {
        "reading": label,
        "ms": round(elapsed, 1),
        "queries": counted["n"],
        "size": size,
    }


def _service_item():
    """One catalogue service, scoped to a person, reused across runs."""
    code = f"{PREFIX}-SVC"

    if not frappe.db.exists("Item", code):
        frappe.get_doc(
            {
                "doctype": "Item",
                "item_code": code,
                "item_name": f"{PREFIX} Service",
                "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
                "is_stock_item": 0,
                "stock_uom": "Month",
                "msp_service_scope": "User",
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()

    return code


def _contract(customer, item, today):
    """A live contract covering the one service, priced, so billing has something to read."""
    price_list = frappe.db.get_value(
        "Price List", {"selling": 1, "enabled": 1}, ["name", "currency"], as_dict=True
    )
    started = frappe.utils.add_days(today, -365)

    contract = frappe.get_doc(
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
            "services": [{"service_item": item}],
        }
    ).insert(ignore_permissions=True)

    frappe.get_doc(
        {
            "doctype": "Item Price",
            "item_code": item,
            "price_list": price_list.name,
            "customer": customer,
            "selling": 1,
            "buying": 0,
            "currency": price_list.currency,
            "price_list_rate": 25,
            "valid_from": started,
        }
    ).insert(ignore_permissions=True)

    frappe.db.commit()

    return contract.name


def _requests(customer, item, people, count, tag, today):
    """A queue of the size the spec names, half of it still open."""
    print(f"  building {count} requests...")

    statuses = ("Submitted", "Under Review", "Approved", "Completed", "Rejected")

    for index in range(count):
        name = f"{PREFIX}-SR-{tag}-{index}"
        frappe.db.sql(
            """
            insert into `tabMSP Service Request`
                (name, creation, modified, owner, modified_by, customer, request_type,
                 status, priority, source)
            values (%s, now(), now(), 'Administrator', 'Administrator', %s, 'Add',
                    %s, 'Medium', 'Portal')
            """,
            (name, customer, statuses[index % len(statuses)]),
        )
        frappe.db.sql(
            """
            insert into `tabMSP Service Request Line`
                (name, creation, modified, owner, modified_by, parent, parenttype,
                 parentfield, idx, target_scope, client_user, requested_service,
                 requested_quantity, requested_effective_date, line_status, action)
            values (%s, now(), now(), 'Administrator', 'Administrator', %s,
                    'MSP Service Request', 'lines', 1, 'User', %s, %s, 1, %s,
                    'Pending', 'Add')
            """,
            (f"{PREFIX}-SRL-{tag}-{index}", name, f"{PREFIX}-U-{tag}-{index % people}",
             item, today),
        )


def _build(people, devices, services_per_person, requests, tag=None):
    """A company of the size the spec asks about."""
    tag = tag or frappe.generate_hash(length=6)
    customer = frappe.get_doc(
        {"doctype": "Customer", "customer_name": f"{PREFIX} {tag}", "customer_type": "Company"}
    ).insert(ignore_permissions=True)

    item = _service_item()
    today = frappe.utils.today()

    print(f"  building {people} people, {devices} machines...")

    for index in range(people):
        frappe.db.sql(
            """
            insert into `tabMSP Client User`
                (name, creation, modified, owner, modified_by, customer, full_name,
                 lifecycle_status, start_date, portal_visible)
            values (%s, now(), now(), 'Administrator', 'Administrator', %s, %s,
                    'Active', %s, 1)
            """,
            (f"{PREFIX}-U-{tag}-{index}", customer.name, f"{PREFIX} Person {index}", today),
        )

    for index in range(devices):
        frappe.db.sql(
            """
            insert into `tabMSP Managed Device`
                (name, creation, modified, owner, modified_by, customer, hostname,
                 device_type, status, serial_number)
            values (%s, now(), now(), 'Administrator', 'Administrator', %s, %s,
                    'PC', 'Stock', %s)
            """,
            (f"{PREFIX}-D-{tag}-{index}", customer.name, f"{PREFIX}-HOST-{tag}-{index}",
             f"{PREFIX}-SN-{tag}-{index}"),
        )

    contract = _contract(customer.name, item, today)

    total = people * services_per_person
    print(f"  building {total} services...")

    for index in range(total):
        frappe.db.sql(
            """
            insert into `tabMSP Service Assignment`
                (name, creation, modified, owner, modified_by, customer, service_item,
                 assignment_scope, client_user, quantity, uom, price_source, agreed_rate,
                 operational_status, billing_status, effective_start_date)
            values (%s, now(), now(), 'Administrator', 'Administrator', %s, %s, 'User', %s,
                    1, 'Month', 'Manual Override', 25, 'Active', 'Billable', %s)
            """,
            (f"{PREFIX}-SA-{tag}-{index}", customer.name, item,
             f"{PREFIX}-U-{tag}-{index % people}", today),
        )

    frappe.db.commit()

    _requests(customer.name, item, people, requests, tag, today)

    frappe.db.commit()

    return customer.name, contract, tag


def _purge(tag):
    """Everything this run wrote, and nothing else."""
    for table, column in (
        ("MSP Service Request Line", "name"),
        ("MSP Service Request", "name"),
        ("MSP Service Assignment", "name"),
        ("MSP Device Holder", "parent"),
        ("MSP Managed Device", "name"),
        ("MSP Client User", "name"),
    ):
        frappe.db.sql(
            f"delete from `tab{table}` where {column} like %s", f"{PREFIX}-%-{tag}-%"
        )

    for doctype in ("MSP Contract", "Item Price"):
        for row in frappe.get_all(
            doctype, filters={"customer": ["like", f"{PREFIX} {tag}%"]}, pluck="name"
        ):
            frappe.delete_doc(doctype, row, force=True, ignore_permissions=True)

    frappe.db.sql("delete from `tabCustomer` where name like %s", f"{PREFIX} {tag}%")

    # the catalogue service too: a benchmark leaves nothing on the site, not even an item
    # nobody would notice
    if frappe.db.exists("Item", f"{PREFIX}-SVC"):
        frappe.delete_doc("Item", f"{PREFIX}-SVC", force=True, ignore_permissions=True)

    frappe.db.commit()


def run(people=5000, devices=3000, services_per_person=2, requests=1000):
    """Build, measure, purge. Prints a table and returns it."""
    from nexgen_msp.api.internal.services.billing_service import BillingService
    from nexgen_msp.api.internal.services.request_service import RequestService
    from nexgen_msp.api.internal.services.user_360_service import User360Service
    from nexgen_msp.api.internal.services.user_service import UserService
    from nexgen_msp.api.portal.services.request_builder_service import RequestBuilderService

    people = int(people)
    devices = int(devices)
    services_per_person = int(services_per_person)
    requests = int(requests)
    today = frappe.utils.today()

    tag = None

    try:
        tag = frappe.generate_hash(length=6)
        customer, contract, tag = _build(
            people, devices, services_per_person, requests, tag
        )
        somebody = f"{PREFIX}-U-{tag}-0"

        readings = [
            _timed(
                "user register, first page",
                lambda: UserService.list_users(customer=customer, page_length=20),
            ),
            _timed(
                "user register, searched",
                lambda: UserService.list_users(
                    customer=customer, search=f"Person {people - 1}", page_length=20
                ),
            ),
            _timed("one person, whole reading", lambda: User360Service.get_user(somebody)),
            _timed("that person's past", lambda: User360Service.get_user_history(somebody)),
            _timed(
                "request builder, searching for somebody",
                lambda: RequestBuilderService.search_users(
                    customer=customer, search=f"Person {people - 1}"
                ),
            ),
            _timed(
                "request queue, first page",
                lambda: RequestService.list_requests(customer=customer, page_length=20),
            ),
            _timed(
                "billing candidates for the month",
                lambda: BillingService.preview(
                    contract=contract,
                    period_start=frappe.utils.get_first_day(today),
                    period_end=frappe.utils.get_last_day(today),
                ),
            ),
        ]
    finally:
        if tag:
            _purge(tag)

    print(
        f"\n{people} people · {devices} machines · "
        f"{people * services_per_person} services · {requests} requests\n"
    )
    print(f"  {'reading':40} {'ms':>8} {'queries':>9}")

    for row in readings:
        if row.get("failed"):
            print(f"  {row['reading']:40} {'—':>8} {'—':>9}  {row['failed']}")
        else:
            print(f"  {row['reading']:40} {row['ms']:>8} {row['queries']:>9}")

    return readings
