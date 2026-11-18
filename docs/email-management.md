# Email Management

How the mail this application sends is configured, worded and traced, and how to undo a
change that went wrong.

## What is where

| Screen | What it decides |
|---|---|
| Notification rules | Whether a notification is on, who it is addressed to, and — for reminders — how often it repeats |
| Templates | The wording itself: subject, HTML, plain text, per language |
| Delivery history | What was actually attempted, to whom, and what the mail queue said |
| Notification sources | Every notification on the site, including the ones Frappe and ERPNext own and this screen never changes |

A notification owns exactly one template. The rule decides *when* and *to whom*; the
template decides *what it says*. The rule editor's **Content** section shows where each
language of its template stands and hands it over to the Templates editor.

## Writing a template

Each template has independent wording per language (`en` and `fr`).

1. Open **Templates**, find the notification, press **Edit**.
2. Pick the language. Each language keeps its own draft; switching does not carry one
   wording into the other.
3. On a language nobody has written yet, **Start from the current wording** loads the
   original template into the editor. Nothing is translated for you: the content you load
   is in whatever language it was already in, and it becomes that language's wording only
   because you published it there.
4. Write the subject, the HTML body and, if you want one, the plain-text body. Click a
   variable to insert it where the caret is.
5. **Save draft** keeps your work. It changes nothing that is being sent.
6. **Publish** turns the draft into a numbered revision and points production at it.

### Variables

A template may only name the values its own notification supplies. The picker lists them,
and anything else is refused when you save, with the permitted names in the message. Three
kinds:

- **text** — escaped where it lands, so a customer name containing `<` cannot break the mail.
- **html** — a block this application builds itself (`summary`, `acts`, `reason_block`),
  inserted as it is, and read back as plain lines in a text body.
- **url** — checked as a web address. Anything that is not `http` or `https` becomes no
  address at all rather than a live link.

The only things a template may *do* are `{{ name }}`, `{% if name %}`, `{% else %}` and
`{% endif %}`. Expressions, loops, includes and attribute access are refused. Scripts,
event handlers, frames and `javascript:` links are stripped when the draft is saved.

### Preview and test

**Preview** renders the wording with sample values and sends nothing. **Send test** goes
only to your own address or another administrator's, is marked as a test in the delivery
history, and never counts towards any record's reminders. A draft can be tested before it
is published.

## Which language a recipient gets

Decided per recipient, at the moment of sending, and only ever on somebody's own word:

1. the language on the recipient's **own account** (`User.language`, which they set
   themselves in My Settings);
2. otherwise the language on their **customer record** (`Customer.language`);
3. otherwise the fallback, **English**.

Nothing is read off a name, an address, a domain, a country or a browser setting.
Regional variants are normalised (`fr-CA` → `fr`, `en-GB` → `en`); a language this
application does not publish is treated as no preference at all.

If the chosen language has no published revision, the mail goes out in English; if English
has none either, it goes out from the original Frappe template. Every delivery records
which language was used, where that language came from, which revision built it, and why
it fell back. A security or invitation mail is therefore never lost because a translation
is missing.

When one audience does not share a language, the notification becomes several messages —
one per language, each its own queue entry and its own delivery record. Nobody is written
to in a language somebody else chose.

## Who a notification is copied to

A notification already knows its own audience — the requester of a request, the holder of
an account, a company's billing contact — and that is resolved from the record itself, not
configured. Everything you add in the rule editor is sent **in addition**.

Each copy is one policy: a channel (**To**, **CC** or **BCC**), either one fixed address or
one recipient source, and a switch. A policy switched off is kept and written to nobody.

### Sources

A source is resolved from the business record on every send, so somebody who has since lost
the authority to approve for their company stops receiving that company's request
summaries. Only sources whose resolver can read the rule's own record are offered: a
request notification can be copied to the requester, the approvers, everyone the request
concerns, our team or the billing contact; an invoice notice, which names a company but no
requester, can be copied to the billing contact or our team; a notification raised without
any record at all can only be copied to our team.

There is deliberately **no assigned-technician source**. Nothing in this product assigns a
request to anybody — whoever opens it carries it out — so a resolver for it would be a
guess wearing the name of a fact.

### What happens at send time

1. addresses are resolved from the record, never from a list frozen at configuration time;
2. every address is validated;
3. an address belonging to another company is dropped. Our own team reaches every company
   by their role; a customer contact reaches only the companies they are a contact of; an
   address that is no account at all belongs to no company, so there is nothing for it to
   cross;
4. an address appearing on more than one channel is kept on the most open one it appears
   on — **To**, then **CC**, then **BCC** — and dropped from the rest. Never the other way
   round: moving somebody from To to BCC would hide a disclosure that already happened;
5. a blind copy stays blind. It never appears in any header, and a language group holding
   only blind copies is sent as blind copies rather than given a visible recipient;
6. everything left out is recorded with its reason, so "why was nobody told" has an answer.

Password-reset, portal-invitation and team-invitation notifications cannot be copied or
redirected at all. The refusal holds in the screen, in the API, on a row written straight
into the database, and again on the line that puts an address on a mail.

## Revisions and rollback

A published revision is immutable: it cannot be edited or deleted, through the screen or
through the API, because it is the evidence of what a customer was actually sent.

To go back to older wording:

1. open the template, go to **Revision history**;
2. **Restore** the revision you want — it comes back into the editor and nothing is sent yet;
3. **Publish** it. That writes a *new* revision with that content. The revision you
   restored from is left exactly as it was.

To return to the original template instead, there is no "unpublish". Restore and publish
the wording you want; if there has never been a publication in a language, that language
already falls back to the original template.

Two administrators with the same template open cannot overwrite each other. The second
save is refused with a conflict and the first one's work stands; reload and put your
change on top of theirs.

## Deployment

`bench --site <site> migrate` is all that is needed.

The migration is additive and idempotent:

- it creates the two stores (`MSP Email Template Locale`, `MSP Email Template Revision`)
  and the language columns on `MSP Notification Dispatch`;
- it creates **no** wording. Both languages of every template start unconfigured, because
  labelling the existing content as English or French would be claiming a language nobody
  verified;
- `ensure_templates()` still only creates missing `Email Template` records. It has never
  overwritten an administrator's edit and does not now;
- published revisions, drafts, rules, dispatches, queue references and reminder iteration
  history all survive repeated migrations;
- no old notification is replayed and no reminder backlog is produced.

## What the delivery states mean

**Queued** means Frappe's email queue accepted the message. **Sent** means it was handed
to the mail server — not that it reached an inbox. **Unknown** means the outcome could not
be confirmed and nothing may be resent until somebody reconciles it against the queue.

## Permissions

Everything on this screen is administration of this company's own mail. Only the built-in
Administrator and **MSP System Admin** may read or change any of it. Technicians and both
customer roles are refused — in the screen, in the API, and in the DocType permissions,
which grant read and nothing else. All writes go through the service, which checks the
caller every time.
