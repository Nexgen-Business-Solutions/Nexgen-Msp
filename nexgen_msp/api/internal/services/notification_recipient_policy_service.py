"""Who a notification reaches, beyond the one person it is about.

A notification already knows its own audience: the requester of a request, the holder of an
account, the company's billing contact. What lives here is everything an administrator adds
on top of that — a team address in copy, a manager blind-copied — and the rules that keep
such an addition from turning a notification into a leak.

Three of those rules are not negotiable. A notification that carries the means of signing
in as somebody is never copied anywhere. An address is never told about a company it does
not belong to. And a blind copy stays blind: it is never promoted onto a channel the other
recipients can read.
"""

import frappe

from nexgen_msp.api.internal.services import notification_registry as registry
from nexgen_msp.utils import access
from nexgen_msp.utils.errors import ValidationError

RULE = "MSP Notification Rule"
POLICY = "MSP Notification Recipient"

CHANNELS = ("To", "CC", "BCC")

# an address written to directly knows that it was; a copied one is visible to everybody on
# the message; a blind copy is visible to nobody. So an address appearing on two channels is
# kept on the most open of them and dropped from the others — never the other way round,
# because moving somebody from To to BCC would hide a disclosure that already happened
PRECEDENCE = {"To": 0, "CC": 1, "BCC": 2}

CHANNEL_NOTE = (
    "An address on more than one channel is kept on the most open one it appears on: "
    "To, then CC, then BCC."
)


class NotificationRecipientPolicyService:
    # ------------------------------------------------------------------ permissions
    @staticmethod
    def _guard():
        access.require("manage_settings")

    # ------------------------------------------------------------------ reads
    @staticmethod
    def choices(rule_key):
        """The channels and the sources this notification may be copied to, and nothing else."""
        declared = registry.require(rule_key)

        return {
            "channels": list(CHANNELS),
            "sources": [
                {"key": key, "label": registry.AUDIENCES[key]["label"]}
                for key in registry.copy_sources(rule_key)
            ],
            "protected": declared["protected"],
            "precedence_note": CHANNEL_NOTE,
        }

    @staticmethod
    def rows(rule_key):
        """The policies stored for this rule, in the order an administrator put them in."""
        return frappe.get_all(
            POLICY,
            filters={"parenttype": RULE, "parent": rule_key},
            fields=["email", "kind", "recipient_source", "enabled", "idx"],
            order_by="idx asc",
        )

    @staticmethod
    def policies(rule_key):
        """Every copy this rule is configured to send, with what may be configured."""
        NotificationRecipientPolicyService._guard()
        declared = registry.require(rule_key)
        stored = [] if declared["protected"] else NotificationRecipientPolicyService.rows(rule_key)

        return {
            "rule_key": rule_key,
            "rows": [
                {
                    "channel": row.kind,
                    "recipient_source": row.recipient_source,
                    "recipient_source_label": (
                        registry.AUDIENCES.get(row.recipient_source, {}).get("label")
                        if row.recipient_source
                        else None
                    ),
                    "fixed_address": row.email,
                    "enabled": bool(row.enabled),
                }
                for row in stored
            ],
            "choices": NotificationRecipientPolicyService.choices(rule_key),
            # the audience the notification is addressed to in the first place, which is
            # the application's and not an administrator's to change
            "audience_key": declared["audience_key"],
            "audience_label": registry.AUDIENCES[declared["audience_key"]]["label"],
        }

    # ------------------------------------------------------------------ validation
    @staticmethod
    def validated_row(rule_key, entry):
        """One policy as it may be stored, or a refusal saying what is wrong with it.

        Exactly one of an address and a source: a row naming both would be two policies
        pretending to be one, and the next person reading it could not tell which of them
        the mail actually went to.
        """
        entry = entry or {}
        channel = entry.get("kind") or entry.get("channel")

        if channel not in CHANNELS:
            raise ValidationError(
                f"{channel or 'A policy'} is not a channel. Use To, CC or BCC.",
                "VALIDATION_ERROR",
            )

        address = (entry.get("email") or entry.get("fixed_address") or "").strip().lower()
        source = (entry.get("recipient_source") or "").strip() or None

        if bool(address) == bool(source):
            raise ValidationError(
                "A policy names either one fixed address or one recipient source, not both "
                "and not neither.",
                "VALIDATION_ERROR",
            )

        if source and source not in registry.copy_sources(rule_key):
            raise ValidationError(
                f"{source} is not a source {registry.rule_label(rule_key)} can be copied to.",
                "VALIDATION_ERROR",
            )

        if address:
            from frappe.utils import validate_email_address

            if not validate_email_address(address, throw=False):
                raise ValidationError(f"{address} is not an email address.", "VALIDATION_ERROR")

            if not NotificationRecipientPolicyService._permitted_fixed(address):
                raise ValidationError(
                    f"{address} belongs to a customer's own contact. A fixed copy is sent "
                    "for every record this notification fires for, so naming them here "
                    "would copy them on another company's business. Use a recipient "
                    "source, which is resolved from the record itself.",
                    "VALIDATION_ERROR",
                )

        return {
            "email": address or None,
            "kind": channel,
            "recipient_source": source,
            "enabled": 0 if entry.get("enabled") in (0, False, "0", "false") else 1,
        }

    # ------------------------------------------------------------------ sending
    @staticmethod
    def resolve(
        rule_key,
        recipients,
        cc=None,
        business_doctype=None,
        business_name=None,
        customer=None,
    ):
        """The three channels of one send, resolved from the record and bounded by it.

        Returns the addresses per channel and, beside them, every address or source that
        was left out and why — because "nobody was told" has to have an answer, and a
        recipient quietly dropped is the one case where silence is indistinguishable from
        a bug.

        Nothing in here may stop a mail. A policy that cannot be resolved is recorded as
        skipped; the notification still reaches the person it is about.
        """
        declared = registry.rule(rule_key) or {}
        channels = {
            "To": [address for address in (recipients or []) if address],
            "CC": [address for address in (cc or []) if address],
            "BCC": [],
        }
        skipped = []

        if declared.get("protected"):
            # the refusal is already in place when a policy is saved; it is here as well
            # because this is the line that puts an address on a mail. Whatever the caller
            # passed in copy goes too: a reset link reaches the account holder and nobody
            # else, however the call site was written
            for channel in ("CC", "BCC"):
                for address in channels[channel]:
                    skipped.append(
                        {"target": address, "channel": channel, "reason": "protected_notification"}
                    )

                channels[channel] = []

            return NotificationRecipientPolicyService._bounded(channels, customer, skipped)

        record = None

        for row in NotificationRecipientPolicyService.rows(rule_key):
            if not row.enabled:
                skipped.append(
                    {
                        "target": row.recipient_source or row.email,
                        "channel": row.kind,
                        "reason": "policy_disabled",
                    }
                )
                continue

            if row.email:
                if not NotificationRecipientPolicyService._permitted_fixed(row.email):
                    # refused when the policy was saved, and refused again here: a row
                    # written before that refusal existed, or straight into the database,
                    # must not reach a send either
                    skipped.append(
                        {"target": row.email, "channel": row.kind, "reason": "not_permitted"}
                    )
                    continue

                channels.setdefault(row.kind, []).append(row.email)
                continue

            if row.recipient_source not in registry.copy_sources(rule_key):
                skipped.append(
                    {"target": row.recipient_source, "channel": row.kind, "reason": "unsupported_source"}
                )
                continue

            if record is None:
                record = NotificationRecipientPolicyService._record(
                    business_doctype, business_name
                )

            if not record:
                skipped.append(
                    {"target": row.recipient_source, "channel": row.kind, "reason": "no_record"}
                )
                continue

            found = registry.resolve_audience(row.recipient_source, record)

            if not found:
                skipped.append(
                    {"target": row.recipient_source, "channel": row.kind, "reason": "no_recipient"}
                )
                continue

            channels.setdefault(row.kind, []).extend(found)

        return NotificationRecipientPolicyService._bounded(channels, customer, skipped)

    @staticmethod
    def _record(business_doctype, business_name):
        """The business record a source is resolved against, or nothing when there is none.

        A notification raised without a record — a company stuck with nobody able to
        approve, say — can still be copied to a fixed address, but there is nothing for a
        source to read, and inventing one would mail the wrong people.
        """
        if not business_doctype or not business_name:
            return None

        try:
            return frappe.get_doc(business_doctype, business_name)
        except Exception:
            return None

    @staticmethod
    def _bounded(channels, customer, skipped):
        """Every channel validated, kept inside the company, and deduplicated."""
        from frappe.utils import validate_email_address

        seen = {}

        for channel in sorted(channels, key=lambda name: PRECEDENCE.get(name, 9)):
            kept = []

            for address in channels[channel]:
                address = (address or "").strip().lower()

                if not address:
                    continue

                if not validate_email_address(address, throw=False):
                    skipped.append(
                        {"target": address, "channel": channel, "reason": "invalid_address"}
                    )
                    continue

                if not NotificationRecipientPolicyService._reaches(address, customer):
                    skipped.append(
                        {"target": address, "channel": channel, "reason": "other_customer"}
                    )
                    continue

                if address in seen:
                    if seen[address] != channel:
                        skipped.append(
                            {"target": address, "channel": channel, "reason": "already_addressed"}
                        )

                    continue

                seen[address] = channel
                kept.append(address)

            channels[channel] = kept

        return {
            "to": channels.get("To", []),
            "cc": channels.get("CC", []),
            "bcc": channels.get("BCC", []),
            "skipped": skipped,
        }

    @staticmethod
    def _permitted_fixed(address):
        """Whether this address may be named as a fixed copy.

        A customer's own contact may not. A fixed policy has no record behind it: it fires
        for every record the rule fires for, so naming one company's contact there would
        copy them on another company's business — which is the one thing isolation exists
        to prevent.

        An address with no account at all is a mailbox an administrator named on purpose —
        a desk, a rota, an alias — and stays allowed, because a fixed internal address is
        exactly what the feature asks for and most of them have no account of their own.
        What more than that makes an address *permitted* — an explicit allowlist of our own
        mailboxes — is a product decision, and this code does not invent one.
        """
        if not address:
            return False

        if access.is_staff(address):
            return True

        return not access.is_customer_account(address)

    @staticmethod
    def _reaches(address, customer):
        """Whether this address may be told about this company's business.

        A staff account reaches every company by its role. A customer account reaches the
        companies it is a contact of and no others. An address that is no account at all
        is one an administrator typed in on purpose: it belongs to no company, so there is
        no company whose business it is crossing.
        """
        if not customer:
            return True

        if not frappe.db.exists("User", address):
            return True

        if access.is_staff(address):
            return True

        # an account that is not ours reaches the companies it is a contact of and no
        # others. An empty list is not a pass: a contact whose company links were never
        # set up has not been shown to belong anywhere, and treating "we do not know" as
        # "anywhere" is how one company's business reaches another's inbox
        return customer in access.customer_memberships(address)
