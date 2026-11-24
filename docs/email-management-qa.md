# Email Management — QA scenarios

Manual scenarios for features #40 (email management) and #47 (request comments), written to
be run in a browser against a site where real sending is off.

Nothing in this file sends mail outside the machine. On `msp.localhost` three things stop
it: `mute_emails: 1` in the site config, an inactive scheduler, and no default outgoing
account. A queued mail is still built in full, so the letter can be read from the queue
entry — which is what these scenarios look at.

**Site** `msp.localhost` · **App** `http://msp.localhost:8000/msp` ·
**Email Management** Settings → Email Management (`/msp/notifications`)

Runner: `node /tmp/claude-1000/.../scenarios.mjs` drives these steps in one visible window.
The letter produced by a step is shown as an overlay over the page it came from.

| Case | What it protects | Needs |
| --- | --- | --- |
| EM-01 | A template can be read, edited and published | Admin |
| EM-02 | A draft changes nothing being sent | Admin |
| EM-03 | A published revision can be rolled back | Admin |
| EM-04 | A language with nothing published is previewed as the letter that is sent | Admin |
| EM-05 | A test send is marked as one and carries both bodies | Admin |
| EM-06 | A disabled rule sends nothing and says why | Admin |
| EM-07 | A protected notification refuses every copy | Admin |
| EM-08 | A copy is added, then removed, and the send follows | Admin |
| EM-09 | Reminders stop when the record moves | Admin |
| EM-10 | One occurrence is never sent twice | Admin |
| EM-11 | Delivery history names the queue entry behind a send | Admin |
| EM-12 | A comment from our team reaches the customer | Admin |
| EM-13 | A customer answer reaches our team | Customer account |
| EM-14 | Another customer sees nothing of it | Second customer account |
| EM-15 | A conversation before handover stays on the customer side | Customer account |

Run on 2026-11-24 against `msp.localhost`, in a browser: EM-01 to EM-07, EM-09, EM-11 and
EM-12 green. EM-08 and EM-13 to EM-15 were not run — one needs a rule that admits copies,
the others a customer account. EM-10 cannot be reached from the screen at all: sending
once is an identity held in the service, and only its own tests can put two workers on the
same occurrence.

---

## EM-01 — A template can be read, edited and published

**Preconditions** Logged in as an MSP System Admin.

1. Click Settings in the sidebar, then Email Management.
2. Click the Templates tab.
3. Click Edit on `MSP Request Received`.
4. Read the HTML body: it holds the wording the application ships, and the panel says so.
5. Change the subject, click Save draft.
6. Click Publish, confirm.

**Expected** The language shows "Revision 1 published". The editor opens on the shipped
letter rather than an empty box, and the published revision carries the edited subject.

## EM-02 — A draft changes nothing being sent

**Preconditions** EM-01 done, so a revision is published.

1. Templates tab → Edit the same template.
2. Change the HTML body, click Save draft, do not publish.
3. Click the Preview tab.

**Expected** The badge reads "Draft not published". The preview is built from the saved
draft and is marked as a draft, and the published revision number does not move.

## EM-03 — A published revision can be rolled back

**Preconditions** Two revisions published on the same template and language.

1. Templates tab → Edit the template → History.
2. Click Restore on the first revision.
3. Click Publish.

**Expected** A new revision is created holding the older wording; no revision is deleted or
rewritten. What goes out is the restored wording.

## EM-04 — A language with nothing published is previewed as the letter that is sent

**Preconditions** English published on a template, French not configured.

1. Templates tab → Edit that template.
2. Click Français in the Language switch.
3. Read the banner: it says the send falls back to English.
4. Click the Preview tab.

**Expected** The preview holds the published English letter, not the shipped original, and
says it fell back to English. This is the one that was wrong before `7ea4ef2`.

## EM-05 — A test send is marked as one and carries both bodies

**Preconditions** Logged in as an MSP System Admin; a published revision. The test
address must be an administrator's real address — `Administrator` is a user name, not one.

1. Templates tab → Edit → the test panel.
2. Type your own address, click Send test.
3. Read the toast.
4. Open the letter from the queue entry (the runner shows it as an overlay).

**Expected** The subject is prefixed `[Test]`. The letter has an HTML part and a plain-text
part, and the text part is the one that was published — not a reading of the HTML. The
dispatch row is marked as a test and counts as no reminder.

## EM-06 — A disabled rule sends nothing and says why

1. Notification rules tab → open a rule.
2. Switch it off, save.
3. Make the event happen (the runner raises it).
4. Delivery history tab → find the occurrence.

**Expected** Nothing is queued. The history carries a skip whose reason is
`rule_disabled`, so the silence is recorded rather than assumed.

## EM-07 — A protected notification refuses every copy

1. Notification rules tab → open `Password reset`.
2. Try to add a copy: a recipient policy, then a fixed address.

**Expected** Both are refused at save time (`no_copies_permitted` / `protected_notification`).
A policy written before the refusal existed is stripped at send time as well.

## EM-08 — A copy is added, then removed, and the send follows

1. Notification rules tab → open a rule that admits copies.
2. Add a copy source, save.
3. Raise the event; read the history.
4. Remove the copy source, save; raise the event again.

**Expected** The first send carries the copy, the second does not. Each send names the rule
revision it was decided under.

## EM-09 — Reminders stop when the record moves

**Preconditions** A rule with reminders, and a record it waits on.

1. Let the reminder engine tick (the runner calls it).
2. Delivery history tab → read the iterations.
3. Move the record forward (approve it).
4. Tick again.

**Expected** Iterations stop at the move. No reminder is sent for a record that no longer
waits, and the stop is recorded.

## EM-10 — One occurrence is never sent twice

1. Raise the same event twice (the runner does).
2. Delivery history tab → filter on the record.

**Expected** One dispatch row, one queue entry. The second attempt finds the first by its
identity rather than queueing another mail.

## EM-11 — Delivery history names the queue entry behind a send

1. Delivery history tab → read a row's Details column.
2. On a row whose state is Failed or Unknown, click Investigate — the button exists for
   those two states only, because nothing else needs looking into.

**Expected** Every row that reached the queue names its entry (`Queue <id>`). The
investigation panel names the candidates, the recipient and the outcome, and nothing is
resolved without somebody putting their name against it.

## EM-12 — A comment from our team reaches the customer

**Preconditions** A request that has been handed over (Submitted or later).

1. Requests → open the request.
2. Scroll to Comments, write a message, click Post comment.
3. Read the thread: name, role, time.
4. Open the letter produced (overlay).

**Expected** The comment is in the thread at once. One mail goes to the customer side
carrying the whole comment body, and the author is not written to.

## EM-13 — A customer answer reaches our team

**Preconditions** EM-12 done. Logged in as that customer's portal account.

1. Open the same request in the portal.
2. Write an answer, click Post comment.
3. Read the letter produced.

**Expected** The answer joins the same thread, in order. Our team is written to; the
customer who wrote it is not.

## EM-14 — Another customer sees nothing of it

**Preconditions** A second customer account.

1. Log in as the other customer.
2. Open the request by its address.

**Expected** The same "does not exist" answer as for a request that was never created — the
refusal does not reveal that the request exists.

## EM-15 — A conversation before handover stays on the customer side

**Preconditions** A request still awaiting customer approval.

1. As the customer, open it and post a comment.
2. Read the note above the thread.
3. As our team, open the same request.

**Expected** The note says the conversation will be visible to Nexgen MSP after approval.
Nobody of ours is written to. Once the request is submitted, our team reads the whole
thread, including what was written before the handover.
