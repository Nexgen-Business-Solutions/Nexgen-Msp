"""The wording of our mail: what an administrator writes, and what actually goes out.

Two things live here and they are deliberately not the same thing. A draft is what somebody
is working on; a revision is what a mail was built from. Saving the first can never change
the second, because an administrator halfway through a translation must not be sending it,
and a message already in the queue must not change wording under it.

The stored wording is not run as Jinja. It is read as a very small language — a value, and
a condition over a value — whose names are the ones the shipped template was built around.
A template editor that evaluates arbitrary expressions is a way to run code on the server
through a text box, and no amount of escaping afterwards makes that safe.
"""

import hashlib
import re
from urllib.parse import urlparse

import frappe

from nexgen_msp.api.internal.services import notification_registry as registry
from nexgen_msp.utils import access, notifications
from nexgen_msp.utils.errors import NotFoundError, ValidationError

LOCALE = "MSP Email Template Locale"
REVISION = "MSP Email Template Revision"
AUDIT = "MSP Notification Audit"

_TOKEN = re.compile(r"\{\{(.*?)\}\}|\{%(.*?)%\}", re.DOTALL)
_NAME = re.compile(r"^[a-z_][a-z0-9_]*$")
_IF = re.compile(r"^if\s+([a-z_][a-z0-9_]*)$")
_TAG = re.compile(r"<[a-z!/]", re.IGNORECASE)

# our own HTML read back as the lines it stands for, when a plain-text body asks for it
_BLOCK_END = re.compile(r"(?i)</(tr|li|p|div|table|h[1-6])>")
_CELL_BREAK = re.compile(r"(?i)</td>\s*<td[^>]*>")


class NotificationTemplateService:
    # ------------------------------------------------------------------ permissions
    @staticmethod
    def _guard():
        """Writing the mail this company sends is an administrator's job and nobody else's."""
        access.require("manage_settings")

    # ------------------------------------------------------------------ the small language
    @staticmethod
    def _tokens(source, allowed):
        """The stored wording read as tokens, refusing anything that is not one.

        `allowed` is what this template may name. A placeholder outside it is refused at
        the moment somebody writes it rather than rendered as a blank line in a customer's
        mail weeks later.
        """
        tokens = []
        at = 0

        for match in _TOKEN.finditer(source or ""):
            if match.start() > at:
                tokens.append(("text", source[at : match.start()]))

            at = match.end()
            value, statement = match.group(1), match.group(2)

            if value is not None:
                name = value.strip()

                if not _NAME.match(name):
                    raise ValidationError(
                        f"{{{{ {name} }}}} is not a value: a placeholder is one name, "
                        "with nothing done to it.",
                        "VALIDATION_ERROR",
                    )

                if name not in allowed:
                    raise ValidationError(
                        f"This template cannot use {{{{ {name} }}}}. "
                        f"It has: {', '.join(sorted(allowed))}.",
                        "VALIDATION_ERROR",
                    )

                tokens.append(("value", name))
                continue

            statement = " ".join((statement or "").split())
            condition = _IF.match(statement)

            if condition:
                if condition.group(1) not in allowed:
                    raise ValidationError(
                        f"This template cannot test {condition.group(1)}. "
                        f"It has: {', '.join(sorted(allowed))}.",
                        "VALIDATION_ERROR",
                    )

                tokens.append(("if", condition.group(1)))
            elif statement == "else":
                tokens.append(("else", None))
            elif statement == "endif":
                tokens.append(("endif", None))
            else:
                raise ValidationError(
                    f"{{% {statement} %}} is not something a template may do. "
                    "Only {% if name %}, {% else %} and {% endif %} are.",
                    "VALIDATION_ERROR",
                )

        if at < len(source or ""):
            tokens.append(("text", source[at:]))

        NotificationTemplateService._check_balance(tokens)

        return tokens

    @staticmethod
    def _check_balance(tokens):
        depth = 0

        for kind, _value in tokens:
            if kind == "if":
                depth += 1
            elif kind == "endif":
                depth -= 1

                if depth < 0:
                    raise ValidationError(
                        "There is an {% endif %} with no {% if %} before it.",
                        "VALIDATION_ERROR",
                    )
            elif kind == "else" and depth == 0:
                raise ValidationError(
                    "There is an {% else %} outside any {% if %}.", "VALIDATION_ERROR"
                )

        if depth:
            raise ValidationError(
                "An {% if %} was opened and never closed with {% endif %}.",
                "VALIDATION_ERROR",
            )

    @staticmethod
    def _emit(tokens, context, allowed, mode):
        """The tokens with the record's own values in them, each escaped for where it lands."""
        out = []
        stack = []

        for kind, value in tokens:
            if kind == "if":
                stack.append(bool(context.get(value)))
                continue

            if kind == "else":
                stack[-1] = not stack[-1]
                continue

            if kind == "endif":
                stack.pop()
                continue

            if not all(stack):
                continue

            if kind == "text":
                out.append(value)
            else:
                out.append(
                    NotificationTemplateService._value(value, context, allowed, mode)
                )

        return "".join(out)

    @staticmethod
    def _value(name, context, allowed, mode):
        raw = context.get(name)
        text = "" if raw is None else raw if isinstance(raw, str) else str(raw)
        kind = allowed.get(name, "text")

        if kind == "url":
            return NotificationTemplateService._url(text, mode)

        if kind == "html":
            return text if mode == "html" else NotificationTemplateService._as_text(text)

        return frappe.utils.escape_html(text) if mode == "html" else text

    @staticmethod
    def _url(url, mode):
        """A link, as a link and nothing else.

        Anything that is not plain web address becomes no address at all: a mail with a
        dead button is a nuisance, a mail with a `javascript:` button is an attack.
        """
        if urlparse(url).scheme not in ("http", "https"):
            return ""

        return frappe.utils.escape_html(url) if mode == "html" else url

    @staticmethod
    def _as_text(html):
        """Our own HTML read as the lines it stands for, for a plain-text body."""
        broken = _CELL_BREAK.sub(": ", html)
        broken = _BLOCK_END.sub("\n", broken)
        lines = (line.strip() for line in frappe.utils.strip_html(broken).splitlines())

        return "\n".join(line for line in lines if line)

    @staticmethod
    def _fallback_source(template_name):
        """The wording a preview or a test is built from when nothing has been saved."""
        shipped = NotificationTemplateService._shipped(template_name)

        if not shipped["html"]:
            raise NotFoundError("There is no wording to show for this template.", "NOT_FOUND")

        return {
            "subject": shipped["subject"] or "",
            "html_body": shipped["html"],
            "text_body": shipped["text"] or "",
            "from_shipped": True,
        }

    @staticmethod
    def _shipped(template_name):
        """The wording this application ships for a template, as the editor would hold it.

        One place says what is being sent when nobody has published anything: the same
        source the mail itself falls back to. Read rather than copied, so the two cannot
        drift apart.
        """
        from nexgen_msp.utils import notifications

        spec = notifications.TEMPLATES.get(template_name) or {}
        subject = spec.get("subject")
        html = notifications.shipped_html(template_name) or ""

        # the record is what the mail falls back to, and an administrator may have edited
        # it in the desk years ago. Showing the wording shipped in the code instead would
        # offer to "take over" a letter nobody is being sent
        if frappe.db.exists("Email Template", template_name):
            doc = frappe.db.get_value(
                "Email Template", template_name, ["subject", "response_html", "response"], as_dict=True
            )
            subject = doc.subject or subject
            html = doc.response_html or doc.response or html

        return {
            "subject": subject,
            "html": html or None,
            "text": NotificationTemplateService._as_text(html) if html else None,
        }

    # ------------------------------------------------------------------ validation
    @staticmethod
    def _allowed(template_name):
        """What this template may name, as a name to kind map."""
        return {
            entry["name"]: entry["kind"]
            for entry in notifications.variables_for(template_name)
        }

    @staticmethod
    def _validated(template_name, subject, html, text):
        """The content as it will be stored: read as tokens, and stripped of active content.

        Both passes run, and on purpose. The token pass refuses what the administrator
        meant to write and says why; the sanitiser catches whatever neither of us thought
        of, which is the only kind of hole worth guarding against.
        """
        allowed = NotificationTemplateService._allowed(template_name)
        subject = " ".join((subject or "").split())

        if not subject:
            raise ValidationError("A mail needs a subject.", "VALIDATION_ERROR")

        if _TAG.search(subject):
            raise ValidationError("A subject is plain text, with no markup.", "VALIDATION_ERROR")

        if not (html or "").strip():
            raise ValidationError("A mail needs an HTML body.", "VALIDATION_ERROR")

        for source in (subject, html, text or ""):
            NotificationTemplateService._tokens(source, allowed)

        clean = frappe.utils.sanitize_html(html, always_sanitize=True)
        NotificationTemplateService._tokens(clean, allowed)

        return {
            "subject": subject,
            "html": clean,
            "text": text or "",
            "variables": sorted(
                {
                    name
                    for source in (subject, clean, text or "")
                    for kind, name in NotificationTemplateService._tokens(source, allowed)
                    if kind in ("value", "if")
                }
            ),
        }

    # ------------------------------------------------------------------ rendering
    @staticmethod
    def render(template_name, locale, context, source=None):
        """The published wording of this template in this language, with the record in it.

        Nothing at all when that language has nothing published: the caller falls back,
        and says in the delivery evidence that it did. Returning the legacy template from
        here instead would make a fallback indistinguishable from a choice.
        """
        published = source or NotificationTemplateService.published(template_name, locale)

        if not published:
            return None

        allowed = NotificationTemplateService._allowed(template_name)
        context = {
            "app_name": notifications.APP_NAME,
            "year": frappe.utils.now_datetime().year,
            **(context or {}),
        }

        return {
            "subject": NotificationTemplateService._emit(
                NotificationTemplateService._tokens(published.get("subject"), allowed),
                context,
                allowed,
                "text",
            ),
            "html": NotificationTemplateService._emit(
                NotificationTemplateService._tokens(published.get("html_body"), allowed),
                context,
                allowed,
                "html",
            ),
            "text": NotificationTemplateService._emit(
                NotificationTemplateService._tokens(published.get("text_body"), allowed),
                context,
                allowed,
                "text",
            )
            or None,
            "locale": locale,
            "revision": published.get("revision_number"),
        }

    @staticmethod
    def published(template_name, locale):
        """The revision a send must be built from, or nothing when there is none.

        Read through the locale row's pointer rather than by taking the highest number:
        the pointer is what publishing moves, and a revision created by a restore that
        has not been published yet must not reach anybody.
        """
        pointer = frappe.db.get_value(
            LOCALE,
            {"template_name": template_name, "locale": locale},
            "published_revision",
        )

        if not pointer:
            return None

        return frappe.db.get_value(
            REVISION,
            f"{template_name}::{locale}::{frappe.utils.cint(pointer)}",
            ["subject", "html_body", "text_body", "revision_number"],
            as_dict=True,
        )

    # ------------------------------------------------------------------ reads
    @staticmethod
    def _require(template_name):
        """The rule this template belongs to, refusing a template that is not ours.

        A template outside the registry is somebody else's mail — Frappe's own, or another
        app's — and this screen is not a general editor for every template on the site.
        """
        rule_key = registry.rule_of_template(template_name)

        if not rule_key:
            raise NotFoundError(
                f"{template_name} is not a template this application owns.", "NOT_FOUND"
            )

        return rule_key

    @staticmethod
    def _require_locale(locale):
        if locale not in registry.LOCALES:
            raise ValidationError(
                f"{locale} is not a language this application publishes.", "VALIDATION_ERROR"
            )

        return locale

    @staticmethod
    def _state(template_name, locale):
        """What exists for one template in one language, without writing anything.

        A read never creates the row. A language nobody has opened yet has to read as
        unconfigured, and a row written by somebody merely looking at a list would make it
        read as a draft they never wrote.
        """
        row = frappe.db.get_value(
            LOCALE,
            {"template_name": template_name, "locale": locale},
            [
                "template_name",
                "locale",
                "draft_subject",
                "draft_html",
                "draft_text",
                "draft_revision",
                "published_revision",
                "last_edited_by",
                "last_edited_at",
            ],
            as_dict=True,
        )
        published = {}

        if row and row.published_revision:
            name = f"{template_name}::{locale}::{frappe.utils.cint(row.published_revision)}"
            found = frappe.db.get_value(
                REVISION, name, ["subject", "html_body", "text_body"], as_dict=True
            )

            if found:
                published[name] = found

        return NotificationTemplateService._read(template_name, locale, row, published)

    @staticmethod
    def _read(template_name, locale, row, published):
        """One language's state, built from rows already in hand.

        The one shape every screen reads, whether it was fetched for a single template or
        for a whole list: two readings of the same fact that disagree are worse than a
        slower page.
        """
        if not row or not (row.draft_html or "").strip():
            # a wording nobody has edited yet opens on the letter that is going out today,
            # not on an empty page: taking over what is being sent is the whole point of
            # the screen, and retyping it by hand would be a different letter by accident
            shipped = NotificationTemplateService._shipped(template_name)

            return {
                "locale": locale,
                "locale_label": registry.locale_label(locale),
                "configured": False,
                "draft_revision": frappe.utils.cint(row.draft_revision) if row else 0,
                "published_revision": None,
                "draft_subject": shipped["subject"],
                "draft_html": shipped["html"],
                "draft_text": shipped["text"],
                "from_shipped": True,
                "last_edited_by": row.last_edited_by if row else None,
                "last_edited_at": row.last_edited_at if row else None,
                "has_unpublished_changes": False,
            }

        pointer = frappe.utils.cint(row.published_revision)

        return {
            "locale": locale,
            "locale_label": registry.locale_label(locale),
            "configured": bool(pointer),
            "draft_revision": frappe.utils.cint(row.draft_revision),
            "published_revision": pointer or None,
            "draft_subject": row.draft_subject,
            "draft_html": row.draft_html,
            "draft_text": row.draft_text,
            "from_shipped": False,
            "last_edited_by": row.last_edited_by,
            "last_edited_at": row.last_edited_at,
            "has_unpublished_changes": NotificationTemplateService._differs(
                row, published.get(f"{template_name}::{locale}::{pointer}")
            ),
        }

    @staticmethod
    def _differs(row, published):
        """Whether the draft says something other than what is published."""
        if not published:
            return bool((row.draft_html or "").strip())

        return (
            (row.draft_subject or "") != (published.get("subject") or "")
            or (row.draft_html or "") != (published.get("html_body") or "")
            or (row.draft_text or "") != (published.get("text_body") or "")
        )

    @staticmethod
    def overview():
        """Every template this application owns, with where each language stands.

        Read in three queries rather than six per template. The list is short today, but
        asking each row for its own name, its own draft and its own publication is how a
        screen that was fine at eighteen rows becomes unusable at a hundred.
        """
        NotificationTemplateService._guard()
        notifications.ensure_templates()

        names = dict(
            frappe.get_all("MSP Notification Rule", fields=["name", "display_name"], as_list=True)
        )
        drafts = {
            (row.template_name, row.locale): row
            for row in frappe.get_all(
                LOCALE,
                fields=[
                    "template_name",
                    "locale",
                    "draft_subject",
                    "draft_html",
                    "draft_text",
                    "draft_revision",
                    "published_revision",
                    "last_edited_by",
                    "last_edited_at",
                ],
                limit_page_length=0,
            )
        }
        wanted = [
            f"{row.template_name}::{row.locale}::{frappe.utils.cint(row.published_revision)}"
            for row in drafts.values()
            if row.published_revision
        ]
        published = (
            {
                row.name: row
                for row in frappe.get_all(
                    REVISION,
                    filters={"name": ("in", wanted)},
                    fields=["name", "subject", "html_body", "text_body"],
                    limit_page_length=0,
                )
            }
            if wanted
            else {}
        )

        rows = []

        for template_name, rule_key in registry.BY_TEMPLATE.items():
            declared = registry.RULES[rule_key]
            locales = [
                NotificationTemplateService._read(
                    template_name, locale, drafts.get((template_name, locale)), published
                )
                for locale in registry.LOCALES
            ]
            edited = [entry["last_edited_at"] for entry in locales if entry["last_edited_at"]]

            rows.append(
                {
                    "template_name": template_name,
                    "rule_key": rule_key,
                    "rule_label": registry.rule_label(rule_key, names.get(rule_key)),
                    "category": declared["category"],
                    "kind": declared["kind"],
                    "protected": declared["protected"],
                    "locales": locales,
                    "last_edited_at": max(edited) if edited else None,
                }
            )

        rows.sort(key=lambda row: (row["category"], row["template_name"]))

        return {
            "rows": rows,
            "locales": [
                {"key": locale, "label": registry.locale_label(locale)}
                for locale in registry.LOCALES
            ],
            "fallback_locale": registry.FALLBACK_LOCALE,
        }

    @staticmethod
    def detail(template_name, locale=None):
        """One template: both languages, what it may name, and what it falls back to."""
        NotificationTemplateService._guard()
        rule_key = NotificationTemplateService._require(template_name)
        locale = NotificationTemplateService._require_locale(locale or registry.FALLBACK_LOCALE)
        legacy = frappe.db.get_value(
            "Email Template", template_name, ["subject", "response_html", "response"], as_dict=True
        )

        return {
            "template_name": template_name,
            "rule_key": rule_key,
            "rule_label": registry.rule_label(
                rule_key, frappe.db.get_value("MSP Notification Rule", rule_key, "display_name")
            ),
            "locale": locale,
            "locales": [
                NotificationTemplateService._state(template_name, entry)
                for entry in registry.LOCALES
            ],
            "variables": notifications.variables_for(template_name),
            "published": NotificationTemplateService.published(template_name, locale),
            "legacy": {
                "subject": (legacy or {}).get("subject"),
                "html": (legacy or {}).get("response_html") or (legacy or {}).get("response"),
            },
            "fallback_locale": registry.FALLBACK_LOCALE,
            "revisions": NotificationTemplateService.history(template_name, locale)["rows"],
        }

    @staticmethod
    def history(template_name, locale):
        """Every revision ever published for one language, newest first."""
        NotificationTemplateService._guard()
        NotificationTemplateService._require(template_name)
        NotificationTemplateService._require_locale(locale)
        pointer = frappe.db.get_value(
            LOCALE, {"template_name": template_name, "locale": locale}, "published_revision"
        )
        rows = frappe.get_all(
            REVISION,
            filters={"template_name": template_name, "locale": locale},
            fields=[
                "name",
                "revision_number",
                "subject",
                "html_body",
                "text_body",
                "variables_used",
                "change_note",
                "content_checksum",
                "owner",
                "creation",
            ],
            order_by="revision_number desc",
        )

        for row in rows:
            row["is_published"] = frappe.utils.cint(pointer) == row["revision_number"]

        return {"rows": rows, "published_revision": frappe.utils.cint(pointer) or None}

    # ------------------------------------------------------------------ writes
    @staticmethod
    def _for_update(template_name, locale, expected):
        """The locale row, locked, and only if the caller is editing the version it read.

        Two administrators with the screen open is the normal case, not the exotic one. The
        second save is refused rather than merged, because nobody can tell from the stored
        text which half of it each of them meant.
        """
        name = f"{template_name}::{locale}"
        frappe.db.sql(
            f"select name from `tab{LOCALE}` where name = %(name)s for update", {"name": name}
        )
        held = frappe.utils.cint(frappe.db.get_value(LOCALE, name, "draft_revision"))

        if expected is not None and frappe.utils.cint(expected) != held:
            raise ValidationError(
                "Somebody else has saved this template since you opened it. Reload it and "
                "put your change on top of theirs.",
                "VERSION_CONFLICT",
                409,
            )

        if frappe.db.exists(LOCALE, name):
            return frappe.get_doc(LOCALE, name)

        doc = frappe.new_doc(LOCALE)
        doc.template_name = template_name
        doc.locale = locale
        doc.draft_revision = 0

        return doc

    @staticmethod
    def _store(doc):
        """Write the row, turning a lost race into the conflict it really is.

        Locking a row that does not exist yet locks nothing, so two administrators opening
        a language for the first time can both reach the insert. The database refuses the
        second, and the second is told what happened rather than shown a traceback.
        """
        savepoint = "template_locale_store"
        frappe.db.savepoint(savepoint)

        try:
            doc.save(ignore_permissions=True)
        except (
            frappe.exceptions.UniqueValidationError,
            frappe.exceptions.DuplicateEntryError,
        ):
            frappe.db.rollback(save_point=savepoint)

            raise ValidationError(
                "Somebody else has just started this language. Reload it and put your "
                "change on top of theirs.",
                "VERSION_CONFLICT",
                409,
            )

        return doc

    @staticmethod
    def _audit(action, rule_key, template_name, locale, reason_code, detail, subject=None):
        from nexgen_msp.api.internal.services.notification_settings_service import (
            NotificationSettingsService,
        )

        return NotificationSettingsService._write_audit(
            action=action,
            rule=rule_key,
            template_name=template_name,
            subject_snapshot=(subject or "")[:140] or None,
            reason_code=reason_code,
            detail=f"{registry.locale_label(locale)}: {detail}",
        )

    @staticmethod
    def save_draft(
        template_name, locale, subject=None, html=None, text=None, draft_revision=None
    ):
        """Keep what an administrator is writing, without changing a single mail.

        What production reads is the published revision. This touches the draft and the
        draft only, so a half-written translation is never somebody's invoice notice.
        """
        NotificationTemplateService._guard()
        rule_key = NotificationTemplateService._require(template_name)
        NotificationTemplateService._require_locale(locale)
        content = NotificationTemplateService._validated(template_name, subject, html, text)
        row = NotificationTemplateService._for_update(template_name, locale, draft_revision)

        row.draft_subject = content["subject"]
        row.draft_html = content["html"]
        row.draft_text = content["text"]
        row.draft_revision = frappe.utils.cint(row.draft_revision) + 1
        row.last_edited_by = frappe.session.user
        row.last_edited_at = frappe.utils.now()
        NotificationTemplateService._store(row)
        NotificationTemplateService._audit(
            "Template Drafted",
            rule_key,
            template_name,
            locale,
            "draft_saved",
            "the draft was saved. Nothing being sent has changed.",
            content["subject"],
        )

        return NotificationTemplateService.detail(template_name, locale)

    @staticmethod
    def publish(template_name, locale, change_note=None, draft_revision=None):
        """Turn the draft into a revision, and point production at it.

        One transaction, so a published pointer never names a revision that was not
        written. The revision itself is never touched again: restoring old wording writes
        a new one, because the history of what customers were sent is the only thing here
        worth keeping.
        """
        NotificationTemplateService._guard()
        rule_key = NotificationTemplateService._require(template_name)
        NotificationTemplateService._require_locale(locale)
        row = NotificationTemplateService._for_update(template_name, locale, draft_revision)

        if not (row.get("draft_html") or "").strip():
            raise ValidationError(
                "There is nothing to publish yet: write the wording first.", "VALIDATION_ERROR"
            )

        content = NotificationTemplateService._validated(
            template_name, row.draft_subject, row.draft_html, row.draft_text
        )
        highest = frappe.db.sql(
            f"select max(revision_number) from `tab{REVISION}` "
            "where template_name = %(template)s and locale = %(locale)s",
            {"template": template_name, "locale": locale},
        )
        number = frappe.utils.cint(highest and highest[0][0]) + 1

        revision = frappe.new_doc(REVISION)
        revision.template_name = template_name
        revision.locale = locale
        revision.revision_number = number
        revision.subject = content["subject"]
        revision.html_body = content["html"]
        revision.text_body = content["text"]
        revision.variables_used = ", ".join(content["variables"])
        revision.change_note = change_note
        revision.content_checksum = NotificationTemplateService._checksum(content)
        revision.insert(ignore_permissions=True)

        row.published_revision = number
        NotificationTemplateService._store(row)
        NotificationTemplateService._audit(
            "Template Published",
            rule_key,
            template_name,
            locale,
            "template_published",
            f"revision {number} is now what this language sends.",
            content["subject"],
        )

        return NotificationTemplateService.detail(template_name, locale)

    @staticmethod
    def _checksum(content):
        joined = "\n".join((content["subject"], content["html"], content["text"]))

        return hashlib.sha256(joined.encode("utf-8")).hexdigest()

    @staticmethod
    def restore(template_name, locale, revision_number, draft_revision=None):
        """Bring an old revision back as the draft, leaving the history as it was.

        Deliberately two steps. Restoring loads the old wording into the editor; publishing
        it writes a new revision over nothing. A rollback that rewrote revision 3 would
        destroy the evidence of what revision 3 actually sent.
        """
        NotificationTemplateService._guard()
        rule_key = NotificationTemplateService._require(template_name)
        NotificationTemplateService._require_locale(locale)
        number = frappe.utils.cint(revision_number)
        old = frappe.db.get_value(
            REVISION,
            f"{template_name}::{locale}::{number}",
            ["subject", "html_body", "text_body"],
            as_dict=True,
        )

        if not old:
            raise NotFoundError(
                f"There is no revision {number} of this language.", "NOT_FOUND"
            )

        row = NotificationTemplateService._for_update(template_name, locale, draft_revision)
        row.draft_subject = old.subject
        row.draft_html = old.html_body
        row.draft_text = old.text_body
        row.draft_revision = frappe.utils.cint(row.draft_revision) + 1
        row.last_edited_by = frappe.session.user
        row.last_edited_at = frappe.utils.now()
        NotificationTemplateService._store(row)
        NotificationTemplateService._audit(
            "Template Restored",
            rule_key,
            template_name,
            locale,
            "template_restored",
            f"revision {number} is back in the editor. It is sent once published.",
            old.subject,
        )

        return NotificationTemplateService.detail(template_name, locale)

    # ------------------------------------------------------------------ language
    @staticmethod
    def normalise_locale(value):
        """A stored language code as one of ours, or nothing when it is neither.

        `fr-CA` and `fr_BE` are French; `de` is not a language this application publishes,
        and saying so is better than quietly treating it as English.
        """
        code = (value or "").strip().lower().replace("_", "-").split("-")[0]

        return code if code in registry.LOCALES else None

    @staticmethod
    def locale_for(address, customer=None):
        """Which language to write to this address in, and on whose word.

        Only a preference somebody actually holds counts. The account's own setting comes
        first, because the person set it themselves; then the company's, because somebody
        at that company told us. Nothing is ever read off a name, a domain or a country: a
        guess dressed as a preference is how a customer gets a letter in a language nobody
        at their office reads.
        """
        account = frappe.db.get_value("User", address, "language") if address else None
        chosen = NotificationTemplateService.normalise_locale(account)

        if chosen:
            return {"locale": chosen, "source": "account"}

        company = frappe.db.get_value("Customer", customer, "language") if customer else None
        chosen = NotificationTemplateService.normalise_locale(company)

        if chosen:
            return {"locale": chosen, "source": "customer"}

        return {"locale": registry.FALLBACK_LOCALE, "source": "fallback"}

    @staticmethod
    def for_delivery(template_name, address, customer, context):
        """The mail one address is owed, in the language we can justify writing it in.

        Always an answer, and always one that says how it was reached: the language used,
        where that language came from, which published revision built it, and why it fell
        back if it did. A security mail is never lost because a translation is missing —
        the original template is the floor under all of this.
        """
        chosen = NotificationTemplateService.locale_for(address, customer)
        tried = [
            (
                chosen["locale"],
                "no_preference" if chosen["source"] == "fallback" else "preferred_variant",
            )
        ]

        if chosen["locale"] != registry.FALLBACK_LOCALE:
            tried.append((registry.FALLBACK_LOCALE, "variant_not_published"))

        for locale, reason in tried:
            rendered = NotificationTemplateService.render(template_name, locale, context)

            if rendered:
                return {
                    **rendered,
                    "language_source": chosen["source"],
                    "fallback_reason": None if reason == "preferred_variant" else reason,
                }

        subject, message = notifications.render(template_name, context)

        return {
            "subject": subject,
            "html": message,
            "text": None,
            "locale": None,
            "revision": None,
            "language_source": chosen["source"],
            "fallback_reason": "legacy_template",
        }

    # ------------------------------------------------------------------ preview and test
    @staticmethod
    def _source(template_name, locale, source):
        """The wording a preview or a test is built from: the draft, or what is published."""
        if source == "published":
            found = NotificationTemplateService.published(template_name, locale)

            if found:
                return {**found, "locale": locale}

            # nothing published in this language is not nothing to show, and it is not the
            # shipped wording either: a send falls back to the original language first, and
            # a preview of "what is being sent" has to follow the same road to the end
            if locale != registry.FALLBACK_LOCALE:
                original = NotificationTemplateService.published(
                    template_name, registry.FALLBACK_LOCALE
                )

                if original:
                    return {**original, "locale": registry.FALLBACK_LOCALE}

            return NotificationTemplateService._fallback_source(template_name)

        row = frappe.db.get_value(
            LOCALE,
            {"template_name": template_name, "locale": locale},
            ["draft_subject", "draft_html", "draft_text"],
            as_dict=True,
        )

        if not row or not (row.draft_html or "").strip():
            return NotificationTemplateService._fallback_source(template_name)

        return {
            "subject": row.draft_subject,
            "html_body": row.draft_html,
            "text_body": row.draft_text,
            "revision_number": None,
        }

    @staticmethod
    def preview(template_name, locale, source="draft"):
        """What this wording looks like, built from sample values and sent to nobody.

        Sample values rather than a real record, for the same reason the rule preview uses
        them: a preview that reaches for the first invoice it can find shows one customer's
        business to whoever opened the screen.
        """
        NotificationTemplateService._guard()
        NotificationTemplateService._require(template_name)
        NotificationTemplateService._require_locale(locale)

        from nexgen_msp.api.internal.services.notification_settings_service import (
            NotificationSettingsService,
        )

        content = NotificationTemplateService._source(template_name, locale, source)
        rendered = NotificationTemplateService.render(
            template_name,
            locale,
            dict(NotificationSettingsService.SAMPLE),
            source=content,
        )

        return {
            **rendered,
            "source": source,
            # which wording this was built from, which is not always the language asked
            # for: a send falls back, and a preview that hid that would show a letter
            # nobody receives
            "built_from_locale": content.get("locale"),
            "from_shipped": bool(content.get("from_shipped")),
            "context_note": "Rendered with sample values and sent to nobody. A real send "
            "uses the record's own data.",
        }

    @staticmethod
    def test_send(template_name, locale, recipient, source="draft"):
        """Send this wording once, to an administrator, marked as a test.

        A test goes through the same reservation, queue and audit as a real send, so what
        the screen shows afterwards is the real thing rather than a simulation. It never
        counts as a reminder iteration, and it is never built from a customer's data.
        """
        NotificationTemplateService._guard()
        rule_key = NotificationTemplateService._require(template_name)
        NotificationTemplateService._require_locale(locale)

        from nexgen_msp.api.internal.services.notification_dispatch_service import (
            NotificationDispatchService,
        )
        from nexgen_msp.api.internal.services.notification_settings_service import (
            NotificationSettingsService,
        )

        address = NotificationSettingsService._allowed_test_address(recipient)
        content = NotificationTemplateService._source(template_name, locale, source)
        rendered = NotificationTemplateService.render(
            template_name,
            locale,
            dict(NotificationSettingsService.SAMPLE),
            source=content,
        )

        return NotificationDispatchService.deliver(
            rule_key,
            address,
            context=dict(NotificationSettingsService.SAMPLE),
            business_doctype=None,
            business_name=None,
            is_test=True,
            rendered={**rendered, "language_source": "fallback", "fallback_reason": None},
        )
