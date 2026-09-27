# Nexgen MSP — full journey test plan

One company, from nothing to a paid and disputed invoice, driven entirely through the browser
by the people who would really do it. No fixture shortcut where a human would click: the plan
below only uses `bench` to create the empty company and its four accounts, because those are
the two things nobody can do from inside the application without already being inside it.

Everything else — the people, the machines, the contract, the rates, the requests, the work,
the billing, the dispute — is done by clicking, as the four roles, in one continuous run.

The point is not to prove that the happy path works. It is to walk every door, including the
ones that should be shut, and to open every detail page on the way so that a screen which
quietly breaks is caught by the run rather than by a customer.

---

## Roles the run signs in as

```text
admin      MSP System Admin        catalogue, contract, rates, billing, disputes
technician MSP Technician          fulfilment: review, execute, prepare, verify
manager    MSP Customer Manager    raises requests for the customer, and approves them
operator   MSP Customer Operator   reads the customer's file, raises nothing
```

Each signs in once through the application's own two-step door (password, then a TOTP code
computed from a secret the fixture seeds). `/api/method/login` is closed and stays closed.

---

## Phase 0 — the ground

| Step | Done by | Checked |
| --- | --- | --- |
| Create the Customer and the four accounts | `bench` | the four sessions open |
| Open `/msp/customers/{customer}` | admin | the company reads as empty: 0 people, 0 devices, 0 services |

**Deliberate error:** open `/msp/requests/new` as operator → `You may not raise requests`, and
no `Select existing` button anywhere on the page.

---

## Phase 1 — the catalogue, and what the migration did to it

| Step | Checked |
| --- | --- |
| Open `/msp/services` as admin | the listing shows Service / Scope / MSP availability / Companies using it / Open assignments, and **no** ERPNext Item or ERPNext status column |
| Read the three real services | each is `Available`, each has exactly one MSP Service Definition |
| Count Items without a definition | they exist and are untouched — a plain ERPNext Item is not an MSP service |
| Open the detail of one service | scope, invoice label, contracts, and the assignments it carries |

**What this proves about the patch:** `msp_service_definitions` gave a definition to the Items
that were really used as MSP services and left every other Item alone. The run asserts both
halves — the used ones resolve, the unused ones are still nothing but ERPNext rows.

**Deliberate error:** as technician, open `/msp/services` → sent back to the dashboard, because
the catalogue is an administrator's screen.

---

## Phase 2 — people, created every way there is

Three doors, and the run uses all three for the same company:

1. **Direct creation**, admin, from `/msp/users` → a person exists immediately.
2. **Through a request**, manager raises a request for a person who does not exist yet; the
   technician creates them during fulfilment, from `Create {N} Client Users`.
3. **Through a Department load**, manager loads a whole Department into the People table — a
   snapshot of people who already exist.

| Checked at each door | |
| --- | --- |
| The person's detail page opens | name, Department, no portal account anywhere on it |
| A Client User is never a login | no account is created by any of the three doors |
| The new person carries a Department | required where they are created, not where they are asked for |

**Deliberate errors:**
- create a person with no name → `Enter the person's full name.`
- give two people of the same company the same username → `Username "…" is already used by another Client User for this Customer.`
- load a Department that has nobody → `No active Client User from this Customer is currently in this Department.`

---

## Phase 3 — machines

| Step | Checked |
| --- | --- |
| Register a Device, admin | it lands in stock, held by nobody |
| Hand it to a person | the holder spell opens; the person's page shows it |
| Register a second Device through a request | prepared by the technician from `Prepare {N} Devices` |
| Open each Device's detail page | hostname, serial, holder, services, history |

**Deliberate errors:**
- register two Devices with the same serial → refused, naming the other machine
- hand a Device to somebody who already holds it → refused
- ask for a Device-scoped service for somebody who holds no machine → the action is offered
  but the machine lands on the preparation list rather than the service being silently
  attached to the person

---

## Phase 4 — the contract and the rates

| Step | Checked |
| --- | --- |
| Create the contract, admin | period, billing frequency, proration method |
| Put the three services on it | each with a rate |
| Open `/msp/customers/{customer}/contract` | the services and their rates read back |

**Deliberate errors:**
- a service with no rate → the request that asks for it is refused at the moment of opening
  the service, not at submission
- a rate of zero → accepted, and the run checks the invoice line is zero rather than absent

---

## Phase 5b — a Department asked for as a whole, minus one person

Its own Department, so nothing here depends on how the other phases arranged theirs.

| Step | Checked |
| --- | --- |
| Two people are named one by one | both land on the People table |
| A whole Department is loaded on top | its three people join them, the two named ones stay |
| One person of that Department is unticked in the impact review | the act is added for the rest |
| The People step is opened again | the unticked person is **still a subject of the request** |
| The technician reviews | there are lines for the kept people and **none** for them |
| The work is carried out | the kept people hold the service; the unticked one holds nothing |
| Their page and the register | they are still in the same Department |

**What this settles about the model:** leaving somebody out of an act is not removing them from
the request, and not moving them out of their group. The subject stays; the action group's
targets are the ones that were kept, so no request line is ever drawn for the person who was
unticked. A person who already holds the service is dropped from the targets by the application
itself, with a reason, which is a different thing from being unticked by hand.

---

## Phase 5c — somebody who does not exist yet, with the name they will use

| Step | Checked |
| --- | --- |
| The customer names a person who is not on file | the `New user` form takes a **Username** as well |
| A service is asked for them | the request carries the username with it |
| The technician executes | `Complete N usernames` is **not** asked: it was already given |
| `Create 1 Client Users` | the name, the Department and the username are already in the form |
| The person's page | they hold the username the customer asked for |

**Deliberate error:** add the same act twice in one request → the row says it is already asked
for, the button is shut, and the recap carries it once.

---

## Phase 5 — requests, in every shape

The manager raises them; the technician answers them.

| Request | Shape | Outcome the run forces |
| --- | --- | --- |
| A | one person, one service | accepted whole, executed, completed |
| B | a Department, one service | partly applicable — the run checks the unchanged people are named with a reason and produce no line |
| C | entire company, `End` | accepted, then **rejected line by line** with a reason |
| D | a new person + a Device service | the full preparation chain: create the person, prepare the machine, then execute |
| E | raised by the manager, approved by the manager | allowed, and the approval is recorded as theirs |

**Checked on every one:** the customer's own page shows the act they asked for with the counts
it was raised with; the technician's review offers `Accept all {N}` and `Reject all {N}`; the
execution runs `Execute {N} ready` and reports partial failure honestly.

**Deliberate errors:**
- submit with no people → `Add at least one person before continuing.`
- submit with no action → `Add at least one requested action before continuing.`
- reject without a reason → refused
- ask twice for the same thing in one request → collapsed to one line
- ask for something already running → the action is not offered at all

---

## Phase 6 — direct actions, beside the request

The technician does things nobody asked for, which is what `More actions` and the `⋯` menus
are for.

| Step | Checked |
| --- | --- |
| Suspend a running service directly | the assignment suspends, the suspension period opens |
| Resume it | the period closes |
| End another directly | `Ended`, with an end date, still visible in history |
| Add a service outside any request | `origin = Technician`, no action group |

**Checked:** the recap tells the two apart — `REQUESTED` against `ADDITIONAL ACTION`.

---

## Phase 7 — withdrawing a service

| Step | Checked |
| --- | --- |
| `Remove from MSP` on a service in use, keeping what runs | availability becomes `Not available` |
| As manager, open a new request | the withdrawn service is **not** offered to add |
| On somebody who has it | `End` is still offered — a service nobody may take up must still be one they can stop |
| What is running | still `Active`, still `Billable` |
| `Make available in MSP` from the same row | reopens on **that** service, not on an empty search |

---

## Phase 8 — billing, and the periods actually consumed

This is the phase the whole run exists for.

Set up deliberately before drawing the run:

```text
service 1  running the whole period            -> billed in full
service 2  suspended mid-period, resumed       -> billed for the days outside the pause
service 3  ended mid-period                    -> billed up to the end date, and no further
service 4  opened mid-period                   -> billed from its start date
service 5  withdrawn from the catalogue        -> still billed, because it is still running
```

| Step | Checked |
| --- | --- |
| Draw the run, admin | every assignment above has exactly one line |
| Read each line | the billable months match the consumed period, not the calendar |
| The invoice | totals match the lines |
| Open the run's detail page | the lines, their services, their people |

**Deliberate errors:**
- draw the same period twice → the second is refused or clearly marked as an adjustment
- a person with no service in the period → no line at all, rather than a zero line

---

## Phase 9 — the dispute

| Step | Done by | Checked |
| --- | --- | --- |
| Open the invoice from the portal | manager | the lines read as the customer sees them |
| Dispute it, with a reason | manager | a request is raised — a dispute **is** a request |
| Read it internally | admin | the dispute names the invoice and the reason |
| Resolve it | admin | the request closes, and the invoice carries the outcome |

**Deliberate error:** dispute with no reason → refused.

---

## Phase 10 — every detail page, once

The run opens each of these and asserts the page rendered its own heading rather than an error
boundary, because a page that throws in production throws here too:

```text
/msp                          dashboard, each role
/msp/users        + detail    person
/msp/devices      + detail    machine
/msp/services     + detail    service
/msp/requests     + detail    request, in each state it passed through
/msp/customers    + detail    company, and its contract
/msp/billing      + detail    run, and its invoice
/msp/accounts     + detail    account
/msp/activity                 history
/msp/settings                 departments, and the rest
```

---

## What counts as a failure

- a screen that renders an error boundary, a blank table where rows exist, or a count that
  disagrees with the rows beneath it;
- a door that is offered and then refused by the server, or refused and then reachable anyway;
- a billed period that does not match what was consumed;
- an act that reaches a target the customer did not choose, or misses one they did;
- anything the run has to be told twice to see, which is a sign the screen is guessing rather
  than reading.

Every failure found is written down here with what it was, not only that it was fixed.

---

## Findings

What the run found, in the order it found them. Each one is written down as what it was, not
only that it was fixed.

| # | Found in | What it was | Fixed |
| --- | --- | --- | --- |
| 1 | `router/index.tsx` | **`Customer360` was routed nowhere.** Both `customers/:customer` and `customers/:customer/contract` rendered `CustomerContract`, so a whole screen — the company's people, machines, services, counts, and the only button leading to its contract — could not be reached by anybody | `customers/:customer` now renders the file it was written for |
| 2 | `CustomersList.tsx` | The register made the whole `<tr>` clickable with no focusable control, so it was the one listing a keyboard could not open | the name is a button, as in every other listing; the row stays clickable for the mouse |
| 3 | `user_service.py`, `portal_service.py` | A person's ended Device services vanished from the register the day they handed the machine back, while their own page still showed them. The register counted 1 where the page showed 2 | current states follow the machine's holder today; what ended is read under whoever held it while it ran |
| 4 | listings | `Inactive services` meant `!= Active` — ended, suspended and pending setup in one figure that named none of them | two figures that say what they count: `Suspended` and `Ended` |
| 5 | `device_lifecycle_service.py` | Retiring a machine wrote `Out of service on …` into the note log, a sentence nobody typed | what happened goes to the activity log; the note log holds only what somebody wrote |
| 6 | whole app | The same thing was called `Remarks` on a machine, `Internal Notes` on a person and `Internal note` in every dialog | one word everywhere |
| 7 | `ServicesList.tsx` | `Make available in MSP` ignored the row it was clicked on and opened an empty search | it opens on that service |
| 8 | modals | 128 inputs in the internal screens, 15 with an accessible name. A dialog whose fields cannot be named cannot be driven by a keyboard or a screen reader either | named the fields the journey types into; the rest is outstanding |
| 9 | `contract_service.py` | Saving a rate answered `Not permitted`. An `Item Price` is an ERPNext record and no MSP role holds rights on it, so the screen offered a button the server always refused | the authorisation happens at this application's own boundary, and the write goes through |
| 10 | `AddDeviceModal.tsx` | The Hostname and Serial number fields had a visible label and no accessible name, so neither a screen reader nor a keyboard could say which field was which | both are named |
| 11 | every register | Listings were sorted alphabetically, so a record somebody had just created landed wherever its name fell — page five of two hundred rows. What you just made is what you want to see | people, machines, services, companies, accounts and the customer's own listings all read newest first |
| 12 | `RowActionsMenu.tsx` | The `⋯` menu was a plain stack of buttons: nothing said it was a menu, so a screen reader announced eleven loose buttons and a keyboard had no menu to move inside | `aria-haspopup`, `aria-expanded`, `role="menu"` and `role="menuitem"` |
| 13 | `DeviceDetail.tsx`, `ExecutionWorkspace.tsx`, `ApplyActionModal.tsx` | The same four acts had three names. Stopping a service was `Stop service` on a person, `Close service` on a machine and `End service` in the fulfilment workbench — and the dialog that then opened said `Stop service` whichever one you clicked | one wording everywhere: Suspend, Resume, Change service, Stop service |
| 14 | `ServiceActionModal.tsx` | The internal note had a visible label and no accessible name, so the one field that must hold exactly what somebody typed could not be addressed by name | named `Internal note`, as everywhere else |
| 15 | `billing_service.py` | An administrator could not invoice at all: drawing the Sales Order, the Sales Invoice and posting it are ERPNext writes, and no MSP role holds rights on those records. The screen offered `Approve and invoice` and the server answered `Not permitted` every time | authorised at this application's own boundary (`_guard_admin`), then the three ERPNext writes go through |
| 16 | `portal_service.py`, `PortalInvoiceDetail.tsx` | Settling a dispute cleared the flag the portal rendered on, so the whole episode vanished from the customer's invoice the moment it was answered: no record that they had argued, and no sign of our reply | the invoice keeps the dispute once settled, with what they said and what we answered |
| 17 | `e2e_fixture.py` | The journey's teardown removed the company with `force`, which left its submitted Sales Orders and Sales Invoices behind as orphans pointing at a party that no longer existed — fourteen of them after a night of runs | the accounting documents are cancelled and removed first, while their party is still there, and the run now leaves nothing at all |
| 18 | `RequestActionsStep.tsx` | The same act could be added twice for the same person, and the recap then showed `Add Sophos · 1 target · Franck Mbassi` twice — two identical lines for one thing the customer wants once | the row says what is already asked for, the button is shut when every target is covered, and the impact review unticks and locks the ones already asked |
| 19 | `RequestPeopleStep.tsx`, `portal_service.py` | A person asked for before they existed could not be given the username they would use, so the work stopped to ask for it again at execution — a fact the customer had and we did not | the `New user` form takes a Username, and it travels to the request line |
| 20 | `request_execution_service.py`, `PrepareWorkModal.tsx` | The preparation panel prefilled the name and the Department of a person still to be created, but left the username blank even when the request carried one | the requirement carries the username and the email, and the form opens with them |
| 21 | `RequestActionsStep.tsx` | Step 2 listed services and Device operations as two-column cards, which reads badly for what is a plain list of rows | both are tables with a header and a line per row, actions right-aligned |

### Found in the run's own tooling, not the application

Worth recording, because each one was first mistaken for a product fault: a row opener that
clicked the `⋯` menu instead of the record's name, a misplaced `await`, a navigation that
typed addresses instead of clicking menus, a service creation that was not waited for, and
three counts asserted as fixed numbers while another phase legitimately changed them, and a
duplicate serial asserted at submission when the application — rightly — refuses it at the
field it was typed in and never enables the button.

Four more were worth the hour they cost, because each one was the application being right:

- two fulfilment steps were written with `if (await button.count())` around them, so when the
  button was not there the step was skipped and the test still passed. The request sat at
  `0 of 1 work items done` while the run reported success. A step that may be skipped is not a
  test; both now fail if the work is not offered;
- a technician was refused an end date in the past, and that is the rule: arranging periods that
  are already behind us belongs to an administrator, so that phase signs in as one;
- every line billed a full month until the contract was given a proration method. The test had
  picked one at random; with `Daily Actual Days` the days actually consumed are what is billed;
- opening a dispute takes you to the invoice it argues with rather than to a request page, which
  is right, and which is why the sweep now opens a service request by the person it names.
