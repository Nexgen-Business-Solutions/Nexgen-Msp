# Request Workflow V3 — API contract

Required by `.vscode/00_IMPLEMENTATION_AUTHORITY_AND_SCOPE.md` §10.

Everything here is additive. No existing endpoint changed its meaning, and every previous
caller — internal screens, tests, the machine-page request seed — keeps working unchanged.

---

## Reading the selection

### `evaluate_request_scope`

```text
GET nexgen_msp.api.portal.endpoints.v1.evaluate_request_scope
    customer?   the company the request is for
    subjects    JSON array of subject drafts
```

Answer:

```ts
{
  customer: string
  subjects: {
    subject_key: string
    client_user: string | null
    is_new_user: 0 | 1
    full_name: string
    department: string | null
    email: string | null
    added_via: "Existing" | "New" | "Department" | "Company"
    selection_label: string | null
    devices: { name: string; label: string; status: string }[]
    current_services: {
      assignment: string
      service_item: string
      label: string
      scope: "User" | "Device"
      status: string
      managed_device: string | null
    }[]
    last_billed: string | null
    usable: boolean
    reason_code: string | null
  }[]
}
```

`last_billed` is the latest posted billing coverage across that person's **User-scoped**
assignments only. A service running on a machine they hold is never counted, which is what
the column's tooltip says on screen.

`current_services` holds what is current — `Pending Setup`, `Active`, `Suspended` — and
never what ended. It includes the services running on the machines the person holds today,
because those are the targets the Actions step will reach for a Device-scoped service.

### `evaluate_request_operations`

```text
GET nexgen_msp.api.portal.endpoints.v1.evaluate_request_operations
    customer?
    subjects      JSON array of subject drafts (the whole selection)
    subject_keys  JSON array — the scope chosen in the rail
```

Answer:

```ts
{
  customer: string
  selected_subject_count: number
  domains: (
    | { key: "Service"; label: string; options: ServiceCard[] }
    | { key: "Device";  label: string; options: OperationOption[] }
  )[]
}
```

```ts
type ServiceCard = {
  object_key: string          // the Item
  object_label: string        // what the customer calls it
  service_scope: "User" | "Device" | "Both"
  current_count: number
  without_count: number
  actions: OperationOption[]  // only the acts with at least one target
}

type OperationOption = {
  operation_code: string
  operation_label: string            // "Add", "Suspend", "Resume", "End", "Change holder"
  operation_label_snapshot: string   // "End Nextcloud"
  targets: RequestTarget[]
  exclusions: RequestExclusion[]
  applicable_target_count: number
  applicable_subject_count: number
  excluded_subject_count: number
  device_count?: number
  holder_options?: { value: string; label: string }[]
}
```

A domain is omitted when nothing in it applies. An act is omitted when no target can use it.

Eligibility is decided server-side and returned as targets plus stable reason codes. The
browser never reads a status string and concludes anything from it.

Reason codes in use:

```text
NO_CURRENT_ASSIGNMENT   ALREADY_ACTIVE       NOT_SUSPENDED
SERVICE_NOT_AVAILABLE   PENDING_CONFLICT     PERSON_DISABLED
NO_CURRENT_DEVICE       DEVICE_STATE_INVALID SAME_DEVICE_HOLDER
CROSS_CUSTOMER_TARGET   NEW_PERSON
```

Cost: the whole selection is read in a fixed handful of queries rather than one per target.
Measured on production data, 231 people answer `scope_projection` in 0.05 s and
`operation_options` in 0.03 s.

---

## Writing the request

`create_request` and `save_request_draft` accept two new arguments:

```ts
{
  subjects: RequestSubjectDraft[]
  action_groups: RequestActionGroupDraft[]
}
```

When `action_groups` is given, the server derives the atomic lines itself; anything the
caller sent as `lines` is ignored. The existing `lines` form still works for the flows that
use it (a request seeded from a machine's page, internal tooling, older tests).

```ts
type RequestActionGroupDraft = {
  group_key: string
  operation_code: string
  operation_label_snapshot: string
  domain: "Service" | "Device" | "People"
  service_item?: string | null
  source_scope_type: "All" | "Department" | "Person"
  source_scope_key?: string | null
  source_scope_label: string
  selected_subject_count: number
  targets: RequestTarget[]      // what the customer kept
  exclusions: RequestExclusion[] // what the act could not reach, with its reason
}
```

What is written:

```text
one MSP Request Subject per selected person
one MSP Request Action Group per act
one MSP Service Request Line per kept target
zero lines for a subject the act could not reach
```

Each line carries `subject_key` and `action_group_key`. Every guard that existed before
still runs on the derived lines: the selection is read again, duplicates collapse, and a
request reaching several Departments still demands a company-wide approver.

---

## Reading the request back

`get_request` — on both the portal and the internal side — now also returns:

```ts
{
  subjects: RequestSubjectSnapshot[]
  action_groups: RequestActionGroupSnapshot[]   // with `impact`, parsed
}
```

`impact` is the audit record taken at submission: every subject in the scope, whether the
act reached them, the concrete targets, and the reason code for the ones it did not. It is
presentation and audit data; it never overrides server revalidation.

---

## Carrying the work out

`MSP Service Work Order` gained `action_group_key`, copied from the line it was planned
from. Technician-added work has none, which is how the two are told apart without guessing.

The execution plan returns a second projection over the same Work Orders:

```ts
{
  groups: SubjectWorkGroup[]      // by person, unchanged
  action_groups: ActionWorkGroup[] // by act
}
```

```ts
type ActionWorkGroup = {
  group_key: string | null
  operation_code: string | null
  label: string
  scope_label: string | null
  origin: "Customer" | "Technician"
  total: number
  remaining: number
  ready: number
  needs_information: number
  by_status: Record<string, number>
  work: WorkCard[]
}
```

No Work Order is duplicated: these are two readings of one set of records.

### `execute_work_orders`

```text
POST nexgen_msp.api.internal.endpoints.v1.execute_work_orders
     request
     executions  [{ work_order, inputs? }]
```

Every Work Order must belong to that Request. Each one is dispatched to the executor its
own work type calls for, runs on its own, commits on its own and is reported on its own:

```ts
{ completed: number; failed: number; skipped: number; results: [...]; plan: ExecutionPlan }
```

The existing `execute_service_actions` is untouched and still used where it fits; the new
endpoint is the operation-aware form the V3 grouped execution needs.
