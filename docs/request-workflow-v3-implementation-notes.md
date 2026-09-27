# Request Workflow V3 — implementation notes

What was built against the V3 pack in `.vscode/`, what was reused rather than rewritten,
and every place the production screens differ from the supplied HTML prototype.

---

## What the prototype fixed, and what the production app does

| Contract (`nexgen-request-builder-unified-v3.html`) | Production |
| --- | --- |
| Four steps: People / Actions / Details / Review | `NewServiceRequest.tsx`, same order, same labels, counters on the first two |
| Table-first People step, four sources feeding one table | `RequestPeopleStep.tsx` — Select existing, New user, Department, Entire company, all appending rows to one table |
| Columns Person / Last billed / Devices / Current services / remove | same, exactly |
| `+ N more` collapse with a full list in the title | same, for both Devices and Current services |
| Actions step: ~300 px rail, right workspace | `RequestActionsStep.tsx`, `lg:grid-cols-[19rem_minmax(0,1fr)]` |
| Rail: Groups (All selected, Departments) then People | same, with counts and a `NEW` badge |
| Service cards with only the applicable quick actions | same, labels `Add · N`, `Suspend · N`, `Resume · N`, `End · N` |
| Impact modal with checkboxes, Current state, Result | same, ineligible rows disabled, `Will apply` / `Left unchanged` |
| Device cards: Configure transfers, Review Devices | same |
| Requested-actions strip at the bottom | same, chips with the act, the target count, the scope and a remove |
| Details: Requested date / Priority / note | `RequestScheduleStep.tsx` |
| Review: three summary cards, People, Requested actions, Details | `RequestReviewStep.tsx` |

Built with Tailwind v4 utilities only. No `tailwind.config.js`, no copied prototype CSS, no
second font, no inline style objects for layout.

---

## Deviations from the prototype

Each one has a technical reason, not a preference.

| Deviation | Why |
| --- | --- |
| The prototype computes eligibility in the browser (`appl()`); production asks the server | Spec 02 §13 forbids the browser deciding business eligibility. The counts on the cards are the server's, so a button never offers an act that would be refused |
| The prototype's Priority keeps four values in the DocType; the customer builder offers three | Spec 01 §30 lists Low / Medium / High. `Urgent` stays on `MSP Service Request` for internal use and is untouched on existing records |
| No per-line date on the Details step | Spec 01 §30: the step carries shared business context only. The requested date applies to the request; a per-target date is an execution decision |
| The Details note is labelled `Request note`, not `Business note` | Changed in the repository by the product owner after the spec was written. Kept as they left it |
| The prototype's modals are bespoke; production uses the shared `Modal` | Spec 00 §1 asks for existing shared components where they reproduce the contract. Focus handling, escape, and the portal layer are already solved there |
| Header shows `Discard` next to `Save draft` when a draft exists | Pre-existing behaviour the spec does not mention; removing it would lose the only way to drop a draft |

---

## Reused rather than rewritten

Per spec 00 §1 and 04 §19, and the product owner's instruction to reuse what already
performs the work:

```text
Modal, Select, FieldLabel, WorkflowHeader, WorkflowStepper, RowActionsMenu, PeopleWorkspace
useRequestUserSearch, useDepartmentSelection, useCompanySelection, useNewUserRequestContext
ApplyActionModal, MoreActionsModal, DeviceOperationModal, RequestDeviceOperationModal
ExecutionWorkspace and its ⋯ row menus, ExecutionRecap, FinalValidation
PortalService.create_request and every guard it already ran
RequestExecutionService.execute_service_action / execute_device_operation / execute_user_setup
```

The fulfilment side keeps its flexibility on purpose: the `⋯` menus and `More actions`
remain exactly where they were, so a technician can still do something the request never
asked for. What changed is the primary control — the button that runs the customer's own
act is now `Execute {N} ready`, on the act the customer added.

`RequestDeviceOperationModal` still seeds a request from a machine's page, and that path
still travels as `lines`. It is the one flow that does not go through action groups, and it
is left alone because it already names exactly one machine and one act.

---

## Grouping is stored, never guessed

Two places used to rebuild the customer's grouping by matching service and action strings,
which spec 00 §7 forbids:

```text
LineReview.tsx        the "shared decision" block
ExecutionWorkspace.tsx the "grouped execution" block
```

Both now key on `action_group_key`. A request raised before V3 has no key, and only then do
they fall back to the old pairing — so an old request still offers a group decision rather
than nothing.

---

## Reported rather than invented

- **No assignment.** Nothing assigns a request to a technician, and no `Assign this request
  to me` exists. Whoever carries the work out is who did it, and the Work Order records
  that. Confirmed by the product owner on 2026-09-26.
- **`execute_work_orders`** was added beside `execute_service_actions` rather than replacing
  it: the existing endpoint is service-only but correct, and several screens and tests rely
  on it.
- **People domain.** Spec 01 §22 says to render a People domain only when a customer-
  requestable people-domain operation exists. None does today (`client_user.create` is
  internal), so the section does not appear. Nothing was hardcoded to hide it — it is
  absent because the registry offers nothing.

---

## Checked in a real browser

`frontend/e2e/`, headless Chromium, against `msp.localhost` with a disposable company
(`ZZE2E`) built and removed by the run itself. Sign-in goes through the application's own
two-step flow — password, then a TOTP code — because `/api/method/login` is closed.

```text
portal-request.spec.ts   the builder: pick a person, add an act, review, submit
                         a Department loaded into the same table
                         the entire company counted before it is added
                         the rail narrowing the scope, and the workspace following
fulfilment.spec.ts       the customer reading their request as action groups
                         the people an act did not reach, named with the reason
                         one decision for the whole act (Accept all 2)
                         Execute 2 ready, each target carried out on its own
internal-person.spec.ts  the person page, its filter and its padding
internal-device.spec.ts  the machine page
portal-services.spec.ts  the portfolio
roles.spec.ts            the same application read by four people:
                         a customer manager, a customer operator, a technician, an admin
```

The prerequisite journey is the one spec 05 §22 asks for, scaled to two people: the work is
ready in every other respect and waits on two usernames, one is entered and saved, the page
is reloaded, exactly one remains owed, and a username already taken is refused on its own row
in the catalogue's words.

Two defects were found and fixed this way rather than by reading the code: a `+ N more`
cell whose folded values are only in the title, and a stepper that opens on whatever stage
the server reports, which a test must select explicitly rather than assume.

## The prerequisites a customer was never asked for

The identifier rule used to live in the browser (`identifiersMissing` decided that personal
services need a username and Device ones a serial). Spec 04 §9 forbids that, so it now lives
on the execution plan: every Work Order carries its `requirements`, and the plan carries the
same requirements gathered per record — five services waiting on one person's username are
one username to enter, not five.

```ts
{ key, kind, blocking, satisfied, owner_type, owner_name, owner_label,
  owner_department, owner_modified, label, current_value, reason, can_batch_edit }
```

`save_required_identifiers` writes them, one row at a time:

- a row saves on its own, and what saved stays saved across a route change or a reload;
- a row carries the `modified` it was read with, and a record that moved since is refused
  with `PREPARATION_STATE_CHANGED` rather than silently overwritten;
- a clash is re-worded to the catalogue's copy (`USERNAME_CONFLICT`, `SERIAL_CONFLICT`) while
  anything else arrives exactly as the domain said it;
- one line is added to the request's activity for the whole batch, not one per value.

Nothing keeps a second copy of a username. The `MSP Client User` owns it, which is why
leaving and coming back finds it where it was left.

## Preparation, done row by row

`Prepare {N} Devices` and `Create {N} Client Users` drive the executors that already did this
work one at a time — `execute_device_provisioning` and `execute_user_setup` — through the
generic `execute_work_orders`. Each row is dispatched to the lifecycle service that owns the
thing being prepared, runs on its own and commits on its own, so a machine that could not be
settled leaves the ones already prepared exactly as they are.

Both dialogs freeze the list they opened with. A row that saves leaves the plan behind it, and
counting the live list would shrink the total under the person reading it.

### Two server rules had to change for this

| Rule | Was | Is | Why |
| --- | --- | --- | --- |
| A new person needs a Department **at request time** | `validate_department(..., required=True)` in the Request controller and in the portal line builder | Optional, still validated against the catalogue when given | Spec 01 §13 and spec 07: only the full name is required of the customer, and `No Department yet` is an offered value |
| A created Client User must have a Department | Read-only on the creation dialog, taken from the request | Chosen where the person is actually created — in the batch dialog and in `ClientUserModal`, both required — and still proven on the Work Order | The person does end up with a Department. What changed is only where it is settled: not by the customer raising the request, but by whoever creates them |

The distinction is the product owner's, stated on 2026-09-26: *a new person must have a
Department, just not necessarily specified when the request is created*. So the obligation
moved rather than disappeared, and both ends are pinned by tests — the request is accepted
without one, and `Create this person` stays disabled until one is chosen.

A Device-scoped service asked for somebody who holds no machine — which is every person who
does not exist yet — now writes its line as `is_new_device`, so the machine lands on the
preparation list instead of quietly becoming a personal service.

## Two tests that had been red since before this work

Both asserted a mechanism the application had deliberately moved on from, and both were
fixed by pinning the promise instead of the machinery.

| Test | What it asserted | What is true now |
| --- | --- | --- |
| `test_device_callers.test_retiring_a_held_machine_closes_its_spell_and_its_services` | Retiring a machine ends its services | Ending somebody's services costs them money, so it is asked for explicitly (`end_services`), and the retire dialog offers it unticked. The test now passes the flag, and a second test pins the default: a machine leaves service without touching what it was billed for |
| `test_access_guards.test_generic_lists_return_no_msp_rows_to_a_customer_contact` | `frappe.get_list` comes back empty for a customer contact | Since the customer DocPerms were withdrawn it refuses outright, which is the stronger of the two. The test now accepts either and checks the promise: no MSP row reaches a customer account through the generic API |

## What is left

The twelve lots are delivered. One thing is deliberately left standing:

- **`MSP Request Action`** no longer has a single caller in the application, but the DocType
  and five historical rows are still on the site, and `MSP Service Request Line` still carries
  the `request_action` column its old rows point at. Dropping them is a data migration of its
  own and was not bundled into this one.

Removed in V3-12, because the V3 flow no longer renders them:

```text
RequestSubjectStep.tsx   RequestChangesStep.tsx
RequestBulkChanges.tsx   RequestGroupStep.tsx (+ test)   RequestServiceCard.tsx
```
