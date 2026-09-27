"""Give every Item MSP ever sold as a service its own MSP Service Definition.

What MSP knew about a service used to be written on the ERPNext Item itself, in custom fields.
The Item belongs to the site, not to us: from this release the MSP configuration lives in its
own record, one per Item, and the Item keeps only what ERPNext itself needs.

Nothing about an Item is rewritten here. The definition is created from what is already on
file — the old custom fields when they were filled in, and the scopes the existing assignments
were actually made at when they were not. A definition is switched on only when the old
configuration was explicit and the Item really is ready; anything else is put on file disabled,
for somebody to look at.
"""

import frappe

from nexgen_msp.api.internal.services.service_definition_service import (
    DEFINITION,
    SCOPES,
    ServiceDefinitionService,
)
from nexgen_msp.utils import catalogue as items

# the Item custom fields this migration reads for the last time
LEGACY_FIELDS = ("msp_service_scope", "msp_invoice_label", "msp_service_enabled")


def execute():
    created, enabled, review = 0, 0, 0

    for item in sorted(_items_msp_knows()):
        if frappe.db.exists(DEFINITION, {"item": item}):
            continue

        legacy = _legacy(item)
        scope = _scope(item, legacy)
        offered = _offered(item, legacy, scope)

        frappe.get_doc(
            {
                "doctype": DEFINITION,
                "item": item,
                "enabled": 1 if offered else 0,
                "service_scope": scope,
                "invoice_label": (legacy.get("msp_invoice_label") or "").strip() or None,
            }
        ).insert(ignore_permissions=True)

        created += 1
        enabled += 1 if offered else 0
        review += 0 if offered else 1

    frappe.db.commit()

    print(f"service definitions: {created} created, {enabled} available in MSP, {review} to review")
    _drop_enabled_field()


def _items_msp_knows():
    """Every Item MSP configured, sold, contracted or billed."""
    found = set()

    for field in ("msp_service_scope", "msp_invoice_label", "msp_service_enabled"):
        if frappe.db.has_column("Item", field):
            found.update(
                frappe.db.sql_list(
                    f"select name from `tabItem` where ifnull(`{field}`, '') not in ('', '0')"
                )
            )

    found.update(frappe.db.sql_list("select distinct service_item from `tabMSP Service Assignment`"))
    found.update(frappe.db.sql_list("select distinct service_item from `tabMSP Contract Service`"))
    found.update(
        frappe.db.sql_list("select distinct service_item from `tabMSP Billing Run Line`")
        if frappe.db.exists("DocType", "MSP Billing Run Line")
        else []
    )

    return {item for item in found if item and frappe.db.exists("Item", item)}


def _legacy(item):
    fields = [field for field in LEGACY_FIELDS if frappe.db.has_column("Item", field)]

    if not fields:
        return {}

    return frappe.db.get_value("Item", item, fields, as_dict=True) or {}


def _scope(item, legacy):
    """The scope the old configuration declared, or the one the history was actually made at."""
    declared = (legacy.get("msp_service_scope") or "").strip()

    if declared in SCOPES:
        return declared

    observed = set(
        frappe.db.sql_list(
            """
            select distinct assignment_scope from `tabMSP Service Assignment`
            where service_item = %(item)s and ifnull(assignment_scope, '') != ''
            """,
            {"item": item},
        )
    )

    if observed == {"User"}:
        return "User"

    if observed == {"Device"}:
        return "Device"

    if observed == {"User", "Device"}:
        return "Both"

    return None


def _offered(item, legacy, scope):
    """Availability is never inferred from history: the old configuration had to say so."""
    if (legacy.get("msp_service_scope") or "").strip() not in SCOPES:
        return False

    if scope not in SCOPES:
        return False

    card = items.read_item(item)

    if not card:
        return False

    blockers = [
        code
        for code in ServiceDefinitionService.blockers(
            item, definition={"enabled": 1, "service_scope": scope}, card=card
        )
        if code != "MSP_DEFINITION_MISSING"
    ]

    return not blockers


def _drop_enabled_field():
    """The availability flag belongs to the definition, so the Item no longer carries one.

    It was added by the previous release and never belonged on a generic ERPNext Item. The
    two older fields stay for one compatibility release and are removed once production has
    been verified.
    """
    name = frappe.db.get_value(
        "Custom Field", {"dt": "Item", "fieldname": "msp_service_enabled"}, "name"
    )

    if not name:
        return

    frappe.delete_doc("Custom Field", name, ignore_permissions=True, force=True)
    frappe.db.commit()

    print("service definitions: Item.msp_service_enabled removed")
