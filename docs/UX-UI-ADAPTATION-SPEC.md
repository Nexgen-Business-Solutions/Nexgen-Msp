# Nexgen MSP — Request Workflow
## Consolidated UX/UI Adaptation Specification

**Target frontend:** React + TypeScript + Tailwind CSS v4  
**Scope:** Request creation, customer internal approval, technician fulfilment  
**Reference prototypes:**  
1. `01-request-creation.html`  
2. `02-customer-approval.html`  
3. `03-technician-fulfilment.html`

---

# 1. Purpose

This specification translates the three validated interactive prototypes into the production Nexgen MSP frontend.

The prototypes define the intended interaction model and information hierarchy. They are not a mandate to copy standalone CSS or mock data literally. Production implementation must use the existing React application architecture, real backend APIs, permissions, server-side validation, and Tailwind CSS v4.

The core UX objective is to keep a Request understandable from customer intent through technician execution without exposing internal complexity prematurely.

---

# 2. Rule classification

Every requirement below is classified explicitly.

### VALIDATED BUSINESS RULE
A product/business rule explicitly validated by the product owner. It is mandatory.

### TECHNICAL IMPLEMENTATION
A technical behavior necessary to implement the validated rule safely and consistently.

### PROPOSAL — REQUIRES APPROVAL
A recommendation that must not be implemented as a product requirement until explicitly approved.

### FORBIDDEN
A behavior explicitly prohibited.

---

# 3. Global domain model reflected by the UI

## 3.1 Request versus execution

**VALIDATED BUSINESS RULE**

A Request expresses customer intent. Submitting or approving a Request does not itself mutate Client Users, Devices, Service Assignments, billing data, or other lifecycle resources.

The UI must preserve the distinction:

- Request = what was asked.
- Customer approval = permission for Nexgen to process the request.
- Technician review = which request lines Nexgen accepts or rejects for execution.
- Work execution = what Nexgen actually performs.
- Verify = recap of what was actually performed.
- Final validation = close the fulfilment workflow.

The original customer Request must remain historically intact.

## 3.2 Subjects and lines

**VALIDATED BUSINESS RULE**

One Request may concern:

- one Client User;
- several explicitly selected Client Users;
- a Department snapshot;
- all active Client Users snapshot.

A Request may contain multiple requested action lines.

Each line must preserve enough context to understand:

- subject/person;
- service;
- target scope: User or Device;
- requested/admin-defined action;
- resolved target when known;
- unresolved Device target when no Device exists yet;
- current state snapshot where relevant;
- requested state/intention.

## 3.3 Portal separation

**FORBIDDEN**

There must never be a Client User ↔ Frappe User / portal User coupling.

Do not add or expose any of the following in these interfaces:

- `portal_visible`
- `portal_user`
- `portal_access`
- `needs_portal_access`
- portal invitation actions
- Frappe User creation from Client User
- Client User creation from Frappe User
- identity synchronization by email
- portal role derivation from Client User
- customer access derivation from Client User

A Client User is an internal managed-person business record only.

---

# 4. Shared UX principles

## 4.1 Keep customer intent visible

**VALIDATED BUSINESS RULE**

The customer intent is the anchor of the workflow.

Do not replace the original request lines with technician actions. Technician-added actions are additional work and must remain visibly distinct and auditable.

## 4.2 Dynamic actions

**VALIDATED BUSINESS RULE**

Available request and technician actions are dynamic and admin/backend-driven.

The frontend must not hardcode product action labels such as:

- Request service
- Pause access
- Stop subscription
- Modify service
- Request installation

Those labels are examples only.

**TECHNICAL IMPLEMENTATION**

The backend should return action descriptors such as:

- action record identifier
- label
- internal action type/taxonomy if needed
- target scope
- allowed / not allowed
- optional reason for ineligibility
- state/target constraints

The frontend renders what it receives.

## 4.3 Group operations are UI accelerators

**VALIDATED BUSINESS RULE**

Bulk/group operations are allowed.

**TECHNICAL IMPLEMENTATION**

A group action is not a blind single mutation.

For every affected subject/target, the server must re-evaluate:

- target existence;
- current lifecycle state;
- action eligibility;
- permission;
- duplicate/conflicting pending work;
- relevant service constraints.

Results must remain individually traceable.

The UI must support partial results such as:

- 17 completed
- 1 failed

without losing the affected subject identities.

## 4.4 Responsive behavior

**TECHNICAL IMPLEMENTATION**

Desktop is the primary operational layout, but all screens must remain usable on tablet/mobile.

On narrow screens:

- cards stack vertically;
- bulk actions wrap;
- large tables become cards or horizontally scrollable regions only when necessary;
- primary action remains visible;
- modals become full-width sheets/dialogs with safe scrolling.

---

# 5. Screen A — New Request

Reference: `01-request-creation.html`

## 5.1 Workflow

**VALIDATED BUSINESS RULE**

The creation stepper is:

1. People
2. Changes
3. Details
4. Review

Keep the stepper simple. Do not add technical provisioning steps.

---

## 5.2 Step 1 — People

### Selection modes

**VALIDATED BUSINESS RULE**

The user can build the Request subject set using:

- individual people;
- an entire Department;
- all active Client Users.

The selected set is a snapshot for this Request.

If a person is created or moved later, that later change must not silently change the already submitted Request.

Disabled Client Users are excluded from Department/Everyone bulk selection by default.

Do not create duplicates when the same person is included by multiple selection paths.

### Individual selection

**VALIDATED BUSINESS RULE**

Individual search should support practical identifiers such as:

- name;
- email;
- Department;
- Client User ID.

### New person

**VALIDATED BUSINESS RULE**

Preserve the previously validated lightweight "New person" path in individual mode.

Only ask the customer for:

- Full name
- Department
- Email

Do not ask for technical provisioning data.

### Department

**VALIDATED BUSINESS RULE**

Departments are global/centrally managed, not Customer-specific.

Display concise counts:

- Department name
- active people count
- disabled people excluded, when useful

### Everyone

**VALIDATED BUSINESS RULE**

"Everyone" means all eligible active Client Users for the Customer at selection/submission time.

It is not a live audience that changes after submission.

### Large selections

**VALIDATED BUSINESS RULE**

Do not render dozens or hundreds of full person cards by default.

Show a compact summary such as:

- total selected
- counts by Department
- `View selected people`

The expanded list remains available for verification.

---

# 6. Step 2 — Changes

## 6.1 Target selector

**VALIDATED BUSINESS RULE**

The user can apply requested changes to:

- one selected person;
- one selected Department;
- all selected people.

A single Request may contain different changes for different target groups.

## 6.2 Personal services

**VALIDATED BUSINESS RULE**

For User-scoped services, show:

- currently assigned personal services;
- server-provided allowed actions;
- available services that can be requested.

The actual Service Assignment target is the Client User.

## 6.3 Device services

**VALIDATED BUSINESS RULE**

For Device-scoped services:

- show the person's current Device(s) when known;
- show current Device services and permitted actions;
- show available Device services.

A Device service belongs to the Device, never to the current holder.

## 6.4 Missing Device

**VALIDATED BUSINESS RULE**

When a person has no current Device, a customer may still request a Device-scoped service.

The line must remain Device-scoped with unresolved Device target.

Never convert it to User scope.

Customer creation UI must not require:

- hostname;
- serial number;
- asset tag;
- technical provisioning data.

Nexgen resolves the Device during fulfilment.

## 6.5 Bulk eligibility

**VALIDATED BUSINESS RULE**

A bulk action must visibly distinguish eligible from ineligible subjects.

Example UI:

- 76 eligible
- 7 not eligible
- View exceptions

**TECHNICAL IMPLEMENTATION**

Eligibility must be returned/revalidated by the server per subject and target.

The browser must not infer lifecycle eligibility from labels or stale local state.

---

# 7. Step 3 — Details

**VALIDATED BUSINESS RULE**

Details apply to the whole Request.

Keep this step intentionally small:

- requested date
- priority
- reason / instructions

Avoid adding provisioning fields that belong to Nexgen fulfilment.

---

# 8. Step 4 — Review

**VALIDATED BUSINESS RULE**

Review must communicate:

- who is affected;
- what is requested;
- User versus Device scope;
- unresolved Device target when relevant;
- requested date;
- priority;
- business note.

For person-specific selections, group by person.

For very large selections, preserve enough grouping/summary to remain readable.

Submission creates/updates the Request and its lines only. It must not execute resource lifecycle changes.

---

# 9. Screen B — Customer Internal Approval

Reference: `02-customer-approval.html`

## 9.1 Page model

**VALIDATED BUSINESS RULE**

Approval is a single Request Detail view.

There is no approval stepper.

The page exists to support one decision:

- Approve
- Reject

Reject requires a reason.

## 9.2 Approval authority

**VALIDATED BUSINESS RULE**

Approval authority is independent of `Customer Manager` / `Customer Operator` role.

A separate authority matrix controls:

- can_submit
- can_approve
- optional Department scope

The UI may explain authority coverage but must not imply that portal role itself grants approval power.

## 9.3 Adaptive rendering

**VALIDATED BUSINESS RULE**

The detail view adapts to the shape of the Request.

### Explicit people

When people were selected individually and have different changes:

show what changes for whom.

Display:

- person
- Department
- service/action
- target context
- current state → requested state when meaningful

### Department / Everyone

When an action is genuinely shared by many subjects:

compress it into a grouped presentation.

Display:

- scope
- affected people count
- affected Departments
- shared action

Provide `View people` / snapshot inspection.

### Mixed request

When a Request contains both shared and individual changes:

show:

1. shared/grouped changes;
2. individual exceptions/additional changes.

Do not flatten everything into either a huge per-person list or an over-compressed group.

## 9.4 Exact snapshot

**VALIDATED BUSINESS RULE**

Even when the UI compresses the presentation, the approver must be able to inspect the exact subject snapshot represented by the Request.

## 9.5 Approval effect

**VALIDATED BUSINESS RULE**

Approve does not execute services/devices/users.

It marks customer approval and allows the Request to enter Nexgen processing.

Reject stores the rejection decision/reason and does not execute domain mutations.

---

# 10. Screen C — Technician Fulfilment

Reference: `03-technician-fulfilment.html`

## 10.1 Global request context

**VALIDATED BUSINESS RULE**

Remove a separate right-side `Request summary` panel.

Instead, Request information stays available at the top throughout the technician workflow.

Display concise context such as:

- Customer
- requester
- requested date
- priority
- people count
- line count
- requester note

## 10.2 Requester note

**VALIDATED BUSINESS RULE**

The requester comment must be visually distinct from generic metadata.

Presentation should include:

- requester identity
- requester label
- timestamp
- readable message block

Do not bury it in a small metadata line.

---

# 11. Technician workflow

**VALIDATED BUSINESS RULE**

The technician stepper is:

1. Review lines
2. Execute
3. Verify
4. Final validation

There is no separate information step.

---

# 12. Technician Step 1 — Review lines

## 12.1 Purpose

**VALIDATED BUSINESS RULE**

This step does not execute anything.

The technician decides which requested action lines Nexgen will execute.

Every original Request line receives an execution disposition:

- accepted
- rejected

Rejected lines require a reason.

## 12.2 Group decisions

**VALIDATED BUSINESS RULE**

Where multiple lines clearly share the same decision, grouped decisions are allowed.

Examples:

- Accept both VPN lines
- Accept all currently pending lines

**TECHNICAL IMPLEMENTATION**

Group decision still writes an individual disposition/result against every affected line.

## 12.3 Historical integrity

**VALIDATED BUSINESS RULE**

Accepting/rejecting must not rewrite the original customer intent.

**TECHNICAL IMPLEMENTATION**

Represent technician disposition separately from the immutable Request line, e.g. through Work Order action/execution records or equivalent.

The exact database object name may follow the real repository architecture.

---

# 13. Technician Step 2 — Execute

This is the main technician workstation.

## 13.1 Main work plan

**VALIDATED BUSINESS RULE**

Only accepted Request lines become primary requested work.

Explicit requested lines must remain visually prioritized.

Rejected lines are not execution tasks.

## 13.2 Missing Client User

**VALIDATED BUSINESS RULE**

If an accepted action requires a Client User that does not exist yet:

1. show `Create Client User`;
2. open a modal;
3. collect/confirm required business fields;
4. create the Client User;
5. immediately unlock dependent actions.

No portal/Frappe User logic is allowed.

## 13.3 Missing Device

**VALIDATED BUSINESS RULE**

If an accepted Device-scoped action has no resolved Device:

1. show `Prepare Device`;
2. open a Device modal;
3. allow context-appropriate resolution such as:
   - choose an available stock Device;
   - register a new Device;
4. collect missing Device information;
5. assign/associate through the real Device lifecycle;
6. immediately unlock dependent Device-scoped actions.

## 13.4 Device lifecycle

**TECHNICAL IMPLEMENTATION**

The UI action "Assign Device" must use the real Device lifecycle service / holder-period logic.

Do not implement ownership/assignment by directly treating `assigned_client_user` as the source of truth.

Customer owns the Device.

The Client User is the holder during an interval.

Holder history is the authoritative relationship.

## 13.5 Context-sensitive extra technician actions

**VALIDATED BUSINESS RULE**

The technician must have broad operational flexibility.

Each relevant person/target exposes a secondary `More actions` entry.

The available actions are adapted to current context.

Examples may include:

- add another User-scoped service;
- change an existing service;
- add a Device-scoped service;
- remove a service;
- transfer a Device;
- repossess a Device.

These are examples only.

**TECHNICAL IMPLEMENTATION**

`More actions` must be populated by backend `allowed_actions` / lifecycle capability data, not hardcoded labels.

The server should consider:

- selected Client User;
- selected/resolved Device;
- current service assignments;
- service scope;
- lifecycle state;
- permissions;
- active/pending conflicting work.

## 13.6 Additional technician actions

**VALIDATED BUSINESS RULE**

A technician-added action does not become a customer Request line.

It is additional Work Order/execution work.

It must record:

- target/subject
- action
- target scope
- technician
- reason/note
- execution result
- timestamps

It must remain visually secondary to the original accepted Request lines.

## 13.7 Priority

**VALIDATED BUSINESS RULE**

The accepted customer request remains the primary work plan.

Extra technician flexibility must not hide or replace the requested actions.

## 13.8 Group execution

**VALIDATED BUSINESS RULE**

When the same action is ready for multiple subjects, grouped execution is allowed.

The UI can expose actions like:

`Apply VPN to 12 people`

**TECHNICAL IMPLEMENTATION**

Execution remains individually revalidated and audited.

Partial success/failure must be representable.

---

# 14. Technician Step 3 — Verify

## 14.1 Purpose

**VALIDATED BUSINESS RULE**

Verify is not a prerequisite checklist.

Verify is a recap of what was actually performed.

## 14.2 Recap contents

Show performed operations grouped naturally, preferably by person/target.

The recap includes, when applicable:

- Client User created/completed;
- Device registered;
- stock Device assigned;
- holder/assignment action;
- original accepted Request action performed;
- technician-added action performed;
- timestamps;
- target context.

Visually distinguish:

- request-line execution;
- technician-added execution;
- object creation/preparation.

## 14.3 Source of data

**TECHNICAL IMPLEMENTATION**

The recap must come from persisted execution/audit records, not from a purely client-side reconstruction.

On reload, the same recap must be reproducible.

---

# 15. Technician Step 4 — Final validation

**VALIDATED BUSINESS RULE**

Final validation closes the technician fulfilment workflow after Verify.

The final screen should summarize at minimum:

- accepted Request lines completed;
- rejected Request lines recorded;
- technician-added actions completed;
- execution recap/audit availability.

Completing the Request must not rewrite historical Request content.

---

# 16. Data/API adaptation guidance

## 16.1 Request creation payload

**TECHNICAL IMPLEMENTATION**

The frontend should submit an explicit snapshot, not a live selector definition only.

A conceptual payload may include:

```ts
type RequestSubject = {
  client_user?: string;
  new_person?: {
    full_name: string;
    department: string;
    email?: string;
  };
};

type RequestLine = {
  subject_key: string;
  service_item: string;
  target_scope: "User" | "Device";
  managed_device?: string | null;
  requested_for_user?: string | null;
  request_action: string;
  action_type?: string;
};
```

Exact field names must follow the real backend.

## 16.2 Bulk selector metadata

**TECHNICAL IMPLEMENTATION**

Preserve optional source metadata for UI/audit presentation, e.g.:

- selection_origin = Individual / Department / Everyone
- source_department where relevant

But the Request must still persist the explicit subject snapshot.

## 16.3 Technician disposition

**TECHNICAL IMPLEMENTATION**

Do not overwrite Request intent.

Store per-line technician decision separately:

```ts
type LineDisposition = {
  request_line: string;
  decision: "Accepted" | "Rejected";
  rejection_reason?: string;
  decided_by: string;
  decided_at: string;
};
```

Exact storage model should reuse existing Work Order structures when possible.

## 16.4 Execution action

**TECHNICAL IMPLEMENTATION**

Execution needs a record capable of representing both requested and technician-added work:

```ts
type ExecutionAction = {
  source: "Request" | "Technician";
  request_line?: string;
  subject: string;
  target_scope: "User" | "Device";
  target?: string;
  action: string;
  technician_reason?: string;
  execution_status: string;
  executed_by?: string;
  executed_at?: string;
  result?: unknown;
};
```

Do not create a parallel data model if the existing Work Order/Action records already support this cleanly.

---

# 17. State synchronization

**TECHNICAL IMPLEMENTATION**

After any mutation:

- invalidate/refetch relevant Request/Work Order state;
- do not rely on optimistic assumptions for lifecycle changes unless rollback is robust;
- server remains authoritative for eligibility and current state.

Especially refetch after:

- Client User creation;
- Device registration;
- Device assignment/transfer/repossess;
- service lifecycle mutation;
- bulk operation;
- technician-added action.

---

# 18. Loading, failure and partial-success UX

## 18.1 Mutation state

**TECHNICAL IMPLEMENTATION**

Every action button must have:

- pending/loading state;
- duplicate-submit protection;
- success feedback;
- actionable error feedback.

## 18.2 Bulk partial failure

**TECHNICAL IMPLEMENTATION**

For group operations, never reduce the outcome to a generic "failed".

Show counts and drill-down:

- completed
- skipped/ineligible
- failed

Allow retry only for appropriate failed subjects.

## 18.3 Stale state

**TECHNICAL IMPLEMENTATION**

If server revalidation says the resource changed since page load:

- do not silently force the operation;
- refresh current state;
- tell the technician why the action is no longer available.

---

# 19. Component architecture

**TECHNICAL IMPLEMENTATION**

Recommended production component decomposition:

```text
RequestContextHeader
RequesterNote

NewRequestWizard
  PeopleSelector
    IndividualSelector
    DepartmentSelector
    EveryoneSelector
    SelectedPeopleSummary
  RequestChanges
    ApplyToSelector
    UserServiceActions
    DeviceServiceActions
    BulkEligibilitySummary
  RequestDetails
  RequestReview

CustomerApprovalDetail
  RequestScopeSummary
  SharedChanges
  IndividualChanges
  SubjectSnapshotDrawer
  ApprovalDecision

TechnicianFulfilment
  TechnicianStepper
  LineReview
    ReviewLineCard
    GroupDecisionBar
  ExecutionWorkspace
    SubjectExecutionCard
    RequestedActionLine
    AdditionalActionLauncher
    ClientUserModal
    DeviceModal
    GroupExecutionBar
  ExecutionRecap
  FinalValidation
```

Prefer composition from existing design-system primitives where already available.

---

# 20. Tailwind CSS v4 adaptation

**TECHNICAL IMPLEMENTATION**

The standalone prototype CSS is not production CSS.

Implement using Tailwind CSS v4 and the project's existing tokens/primitives.

Maintain the visual qualities of the prototypes:

- low visual noise;
- neutral page background;
- white operational cards;
- soft borders;
- modest radii;
- compact typography;
- blue primary actions;
- green completed/success states;
- amber attention/waiting states;
- red rejection/destructive states;
- violet or equivalent subtle treatment for technician-added actions.

Do not copy arbitrary prototype pixel values if the production design system already defines spacing, radius, typography, shadows, or colors.

Use semantic reusable variants rather than scattered utility strings when repeated across many components.

---

# 21. Accessibility

**TECHNICAL IMPLEMENTATION**

Required:

- proper button semantics;
- labels connected to inputs;
- keyboard operable dialogs;
- focus trap in modals/dialogs;
- return focus to triggering control on close;
- visible focus rings;
- status changes exposed accessibly;
- do not communicate status using color alone;
- confirmation or protection for destructive/rejection actions where appropriate.

---

# 22. Permissions and security

**VALIDATED BUSINESS RULE**

The UI never defines authority.

**TECHNICAL IMPLEMENTATION**

Server must enforce:

- customer visibility;
- submit authority;
- approve authority;
- Department authority scope;
- internal technician permissions;
- service/device lifecycle permissions;
- allowed actions.

Frontend hiding/disabling is UX only, never authorization.

---

# 23. Explicitly excluded / forbidden behavior

**FORBIDDEN**

Do not:

- link Client User to portal/Frappe User;
- invite portal users from Client User or Request flows;
- derive portal roles from Client User;
- convert unresolved Device-scoped requests to User scope;
- execute lifecycle mutations during Request submission;
- let grouped actions bypass individual validation;
- rewrite old invoices/billing history when service lifecycle changes;
- treat Device holder as Device owner;
- let technician-added actions overwrite original Request lines;
- hardcode admin-defined action labels in the frontend.

---

# 24. Prototype-only fields not approved as product requirements

**PROPOSAL — REQUIRES APPROVAL**

The prototype may contain convenience fields such as:

- `Internal reference` in Client User modal
- `Site / location` in Device modal

These are not approved requirements.

Do not implement them unless the real DocTypes already contain equivalent fields and the product owner explicitly confirms they belong in this workflow.

---

# 25. Open business decision

**PROPOSAL — REQUIRES APPROVAL**

Multi-subject Request approval when subjects span Departments and an approver covers only some Departments is still unresolved.

Do not invent behavior.

Possible future policies include:

- approver must cover the whole Request;
- split approval/work by authority scope;
- split Request automatically.

No option is approved yet.

---

# 26. Acceptance criteria

## Request creation

- User can select individual people, Department, or Everyone.
- Snapshot is explicit and duplicate-free.
- Disabled Client Users are excluded from Department/Everyone selection.
- New person remains minimal: name, Department, email.
- User and Device services are clearly separated.
- Dynamic actions come from backend.
- Missing Device remains Device-scoped.
- Bulk eligibility is per subject.
- Review clearly shows intended changes.
- Submit performs no lifecycle mutation.

## Customer approval

- Single detail page, no stepper.
- Presentation adapts to individual/group/mixed Request.
- Exact snapshot is inspectable.
- Authority is independent of customer portal role.
- Approve/Reject only changes approval workflow state.
- Reject requires reason.

## Technician fulfilment

- Request context and requester note remain visible throughout.
- Stepper is exactly:
  1. Review lines
  2. Execute
  3. Verify
  4. Final validation
- Review lines performs no lifecycle action.
- Every requested line receives Accepted or Rejected disposition.
- Rejection requires reason.
- Group decisions write individual outcomes.
- Execute shows accepted work first.
- Missing Client User opens creation/completion modal.
- Missing Device opens Device modal.
- Dependencies unlock immediately after successful creation/preparation.
- `More actions` offers backend-driven context-sensitive technician actions.
- Technician-added actions remain visually and historically separate.
- Group execution supports individual validation/results.
- Verify is an execution recap, not a prerequisite checklist.
- Final validation closes without modifying original Request history.

---

# 27. Implementation instruction for coding agents

Use the three HTML prototypes as interaction/visual references, not as production source files.

Before coding:

1. Inspect the current React routing, Request components, Work Order components, APIs and DocTypes.
2. Map existing data structures to this specification.
3. Reuse existing domain services instead of duplicating lifecycle logic.
4. Identify any schema gap before creating a new DocType/field.
5. Do not implement any `PROPOSAL — REQUIRES APPROVAL` item as a mandatory behavior.
6. Do not weaken existing server-side permission checks.
7. Implement UI with Tailwind CSS v4.
8. Add tests for the business-critical transitions and bulk partial-result behavior.

The production result should preserve the simplicity of the prototypes while using the real Nexgen MSP domain model and backend as the source of truth.
