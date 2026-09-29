"""Give every existing Request the snapshot its screens read: its subjects and its action groups.

Historical Requests were written one atomic line at a time, and the grouping the customer
actually saw was never recorded. This patch does not pretend otherwise: it derives one
subject per distinct person and one group per (operation, service) pair inside a Request,
and marks every group it creates as a migration, so nothing downstream mistakes it for
customer intent that was really captured.

No line, no Work Order and no historical record is deleted.
"""

import json

import frappe

REQUEST = "MSP Request"
LINE = "MSP Request Line"
WORK_ORDER = "MSP Work Order"


def execute():
    requests = frappe.get_all(REQUEST, pluck="name")
    subjects = groups = stamped = 0

    for name in requests:
        lines = frappe.get_all(
            LINE,
            filters={"parent": name, "parenttype": REQUEST},
            fields=[
                "name", "idx", "subject_key", "client_user", "is_new_user",
                "new_user_full_name", "new_user_department", "new_user_email",
                "operation_code", "operation_label_snapshot", "requested_service",
                "target_scope", "action_group_key",
            ],
            order_by="idx asc",
        )

        if not lines:
            continue

        doc = frappe.get_doc(REQUEST, name)

        if not doc.get("subjects"):
            for key, row in _subjects_of(lines).items():
                doc.append("subjects", row)
                subjects += 1

        if not doc.get("action_groups"):
            for row in _groups_of(lines):
                doc.append("action_groups", row)
                groups += 1

        doc.flags.ignore_validate = True
        doc.flags.ignore_permissions = True
        doc.save()

        for line in lines:
            key = _group_key(line)

            if line.action_group_key == key and line.subject_key:
                continue

            frappe.db.set_value(
                LINE,
                line.name,
                {"action_group_key": key, "subject_key": line.subject_key or _subject_key(line)},
                update_modified=False,
            )
            stamped += 1

        for order in frappe.get_all(
            WORK_ORDER, filters={"request": name}, fields=["name", "request_line_name"]
        ):
            line = next((row for row in lines if row.name == order.request_line_name), None)

            if not line:
                continue

            frappe.db.set_value(
                WORK_ORDER, order.name, "action_group_key", _group_key(line), update_modified=False
            )

    frappe.db.commit()
    print(
        f"request snapshot: {subjects} subject(s), {groups} legacy group(s), {stamped} line(s) stamped"
    )


def _subject_key(line):
    """The key a line should already carry, rebuilt the same way every time it is read."""
    if line.client_user:
        return f"user:{line.client_user}"

    identity = "|".join(
        str(line.get(field) or "")
        for field in ("new_user_full_name", "new_user_email", "new_user_department")
    )

    return f"new:legacy-{frappe.generate_hash(identity, 12)}"


def _subjects_of(lines):
    found = {}

    for line in lines:
        key = line.subject_key or _subject_key(line)

        if key in found:
            continue

        person = (
            frappe.db.get_value(
                "MSP Client User", line.client_user, ["full_name", "department", "email"], as_dict=True
            )
            if line.client_user
            else None
        )
        found[key] = {
            "subject_key": key,
            "client_user": line.client_user,
            "is_new_user": 1 if line.is_new_user else 0,
            "full_name_snapshot": (
                line.new_user_full_name
                or (person.full_name if person else None)
                or line.client_user
                or "Unknown"
            ),
            "department_snapshot": line.new_user_department or (person.department if person else None),
            "email_snapshot": line.new_user_email or (person.email if person else None),
            "added_via": "New" if line.is_new_user else "Existing",
            "context_snapshot_json": json.dumps({}),
        }

    return found


def _group_key(line):
    service = line.requested_service or "none"

    return f"legacy:{line.operation_code or line.target_scope or 'unknown'}:{service}"


def _groups_of(lines):
    found = {}

    for line in lines:
        key = _group_key(line)
        row = found.get(key)

        if not row:
            row = {
                "group_key": key,
                "operation_code": line.operation_code or "unknown",
                "operation_label_snapshot": line.operation_label_snapshot or "Legacy grouped action",
                "domain": "Device" if (line.operation_code or "").startswith("device.") else "Service",
                "service_item": line.requested_service,
                "group_origin": "LegacyMigration",
                "source_scope_type": "All",
                "source_scope_label": "Legacy request",
                "selected_subject_count": 0,
                "applicable_target_count": 0,
                "excluded_subject_count": 0,
                "impact": [],
            }
            found[key] = row

        row["applicable_target_count"] += 1
        row["impact"].append(
            {"subject_key": line.subject_key or _subject_key(line), "status": "selected"}
        )

    for row in found.values():
        row["selected_subject_count"] = len({entry["subject_key"] for entry in row["impact"]})
        row["impact_snapshot_json"] = json.dumps(row.pop("impact"))

    return list(found.values())
