"""What the data says about itself, before anybody migrates or releases on top of it.

Every rule the application enforces today was enforced from some day onwards. Rows written
before that day, or written around the application, can still contradict it. This reads the
whole site and reports what it finds, in the same words the rules are written in.

It never repairs anything. A figure that cannot be explained is a decision for a person, and
inventing a date or an owner to make a report look clean is how bad history gets written.
"""

import frappe

# a finding nobody can resolve from the data alone: the spec calls these release blockers
BLOCKING = (
    "devices_with_two_current_holders",
    "assignments_open_twice_on_one_target",
    "holder_periods_that_cannot_be_ordered",
)


def _count(query, values=None):
    return frappe.db.sql(query, values or {})[0][0]


def devices():
    """§16: what the machines say about who is holding them."""
    return {
        "inspected": frappe.db.count("MSP Managed Device"),
        "active_without_holder": _count(
            """
            select count(*) from `tabMSP Managed Device` device
            where device.status = 'Active'
              and not exists (
                select 1 from `tabMSP Device Holder` holder
                where holder.parent = device.name
                  and holder.parenttype = 'MSP Managed Device'
                  and holder.is_current = 1
              )
            """
        ),
        "not_active_with_holder": _count(
            """
            select count(*) from `tabMSP Managed Device` device
            where device.status != 'Active'
              and exists (
                select 1 from `tabMSP Device Holder` holder
                where holder.parent = device.name
                  and holder.parenttype = 'MSP Managed Device'
                  and holder.is_current = 1
              )
            """
        ),
        "devices_with_two_current_holders": _count(
            """
            select count(*) from (
                select holder.parent
                from `tabMSP Device Holder` holder
                where holder.parenttype = 'MSP Managed Device' and holder.is_current = 1
                group by holder.parent
                having count(*) > 1
            ) as doubled
            """
        ),
        "stale_holder_cache": _count(
            """
            select count(*) from `tabMSP Managed Device` device
            left join `tabMSP Device Holder` holder
              on holder.parent = device.name
             and holder.parenttype = 'MSP Managed Device'
             and holder.is_current = 1
            where ifnull(device.assigned_client_user, '') <> ifnull(holder.client_user, '')
            """
        ),
        "holder_periods_that_cannot_be_ordered": _count(
            """
            select count(*) from `tabMSP Device Holder` holder
            where holder.parenttype = 'MSP Managed Device'
              and (
                holder.from_date is null
                or (holder.to_date is not null and holder.to_date < holder.from_date)
              )
            """
        ),
    }


def services():
    """§17: what the service periods say about ownership and about billing."""
    return {
        "inspected": frappe.db.count("MSP Service Assignment"),
        "user_scope_without_person": _count(
            """
            select count(*) from `tabMSP Service Assignment`
            where assignment_scope = 'User' and ifnull(client_user, '') = ''
            """
        ),
        "device_scope_without_machine": _count(
            """
            select count(*) from `tabMSP Service Assignment`
            where assignment_scope = 'Device' and ifnull(managed_device, '') = ''
            """
        ),
        "device_scope_carrying_a_person": _count(
            """
            select count(*) from `tabMSP Service Assignment`
            where assignment_scope = 'Device' and ifnull(client_user, '') <> ''
            """
        ),
        "assignments_open_twice_on_one_target": _count(
            """
            select count(*) from (
                select customer, service_item, assignment_scope,
                       coalesce(client_user, managed_device) as target
                from `tabMSP Service Assignment`
                where operational_status in ('Active', 'Suspended', 'Pending Setup',
                                             'Pending Removal')
                  and coalesce(client_user, managed_device) is not null
                group by customer, service_item, assignment_scope, target
                having count(*) > 1
            ) as doubled
            """
        ),
        "suspended_without_an_open_pause": _count(
            """
            select count(*) from `tabMSP Service Assignment` sa
            where sa.operational_status = 'Suspended'
              and not exists (
                select 1 from `tabMSP Service Suspension` pause
                where pause.parent = sa.name
                  and pause.parenttype = 'MSP Service Assignment'
                  and pause.resumed_on is null
              )
            """
        ),
        "active_with_an_open_pause": _count(
            """
            select count(*) from `tabMSP Service Assignment` sa
            where sa.operational_status = 'Active'
              and exists (
                select 1 from `tabMSP Service Suspension` pause
                where pause.parent = sa.name
                  and pause.parenttype = 'MSP Service Assignment'
                  and pause.resumed_on is null
              )
            """
        ),
        "ended_but_still_billable": _count(
            """
            select count(*) from `tabMSP Service Assignment`
            where operational_status in ('Ended', 'Cancelled') and billing_status = 'Billable'
            """
        ),
        "started_after_it_ended": _count(
            """
            select count(*) from `tabMSP Service Assignment`
            where effective_end_date is not null
              and effective_end_date < effective_start_date
            """
        ),
    }


def departments():
    """§18: the catalogue, and the words still being used outside it."""
    known = {
        (row or "").strip().casefold()
        for row in frappe.db.sql_list("select department_name from `tabMSP Department`")
    }

    worn = frappe.db.sql_list(
        """
        select distinct department from `tabMSP Client User`
        where ifnull(department, '') <> ''
        union
        select distinct department from `tabMSP Approver`
        where ifnull(department, '') <> ''
        """
    )
    strangers = sorted(
        {value for value in worn if (value or "").strip().casefold() not in known}
    )

    return {
        "catalogue": len(known),
        "worn_by_records": len(worn),
        "not_in_the_catalogue": len(strangers),
        "examples": strangers[:10],
    }


def requests():
    """§19: how much of the new execution context the old requests carry."""
    total = frappe.db.count("MSP Service Request Line")

    return {
        "inspected": total,
        "without_a_subject_key": _count(
            "select count(*) from `tabMSP Service Request Line` where ifnull(subject_key, '') = ''"
        ),
        "device_lines_without_a_person": _count(
            """
            select count(*) from `tabMSP Service Request Line`
            where target_scope = 'Device'
              and ifnull(requested_for_user, '') = ''
              and ifnull(client_user, '') = ''
            """
        ),
    }


def billing():
    """§21: which runs carry their own history, and which are legacy."""
    return {
        "runs": frappe.db.count("MSP Billing Run"),
        "lines": frappe.db.count("MSP Billing Run Line"),
        "lines_without_a_snapshot": _count(
            """
            select count(*) from `tabMSP Billing Run Line`
            where ifnull(service_name_snapshot, '') = ''
            """
        ),
        "approved_lines_without_a_snapshot": _count(
            """
            select count(*) from `tabMSP Billing Run Line` brl
            join `tabMSP Billing Run` br on br.name = brl.parent
            where br.docstatus = 1 and ifnull(brl.service_name_snapshot, '') = ''
            """
        ),
        "device_lines_carrying_a_person": _count(
            """
            select count(*) from `tabMSP Billing Run Line`
            where assignment_scope = 'Device' and ifnull(client_user, '') <> ''
            """
        ),
    }


def report():
    """The whole reading, and whether anything in it should stop a release."""
    sections = {
        "devices": devices(),
        "services": services(),
        "departments": departments(),
        "requests": requests(),
        "billing": billing(),
    }

    blockers = [
        f"{section}.{key} = {value}"
        for section, findings in sections.items()
        for key, value in findings.items()
        if key in BLOCKING and value
    ]

    return {"sections": sections, "blockers": blockers, "clean": not blockers}


def print_report():
    """Read on the command line before a migration or a release."""
    found = report()

    for section, findings in found["sections"].items():
        print(f"\n{section.upper()}")
        for key, value in findings.items():
            print(f"  {key:40} {value}")

    print("\nBLOCKERS")
    if found["blockers"]:
        for blocker in found["blockers"]:
            print(f"  {blocker}")
    else:
        print("  none")

    return found
