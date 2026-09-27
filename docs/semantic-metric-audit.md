# Nexgen MSP — Semantic metric audit

Scope: every product statement (KPI, caption, filter description, attention signal, empty state)
whose wording claims more than its predicate proves. Required by
`.vscode/04_SEMANTIC_AUDIT_AND_KPI_CLEANUP.md` §19 and gated by
`.vscode/07_MIGRATION_QA_AND_ACCEPTANCE_V2.md` §8.

Repository scan terms: `security`, `licence`, `license`, `idle`, `reclaim`, `health`,
`billed for nothing`, `unprotected`, `coverage gap`, `needs attention`, `incomplete`.

Base commit: `e07cea6` · site `msp.localhost` · backup `20260925_034912` · audited 2026-09-25.

---

## 1. Metric contracts kept

| UI title | UI description | Backend predicate | Why the predicate proves the title | Drill-down | Empty state | Roles |
| --- | --- | --- | --- | --- | --- | --- |
| Open requests | Requests still in progress | `MSP Service Request.status in OPEN_STATUSES and not refused_by_customer` | The title counts requests in an open status; the predicate is exactly that status set | `list_kpi_rows("open_requests")` | `No open request.` | internal + customer |
| Under review | — | `status = 'Under Review'` | One status, counted | request list filter | `No request is under review.` | internal |
| Requests to execute | — | approved lines with no resulting assignment yet | Counts requests whose accepted lines have produced no assignment | request list filter | `Nothing waiting to be carried out.` | internal |
| Ageing over 48h | — | open requests with `creation` older than 48h | Arithmetic on a timestamp | request list filter | `Nothing has been waiting more than two days.` | internal |
| Active services | Currently running service assignments | `MSP Service Assignment.operational_status = 'Active'` | One status, counted | `list_kpi_rows("active_services")` | `No service is running yet.` | internal + customer |
| Active users | Managed people currently active | `MSP Client User.lifecycle_status = 'Active'` | One status, counted | users list, status filter | `No active person yet.` | internal + customer |
| Active devices | Devices currently deployed | `MSP Managed Device.status = 'Active'` | One status, counted | devices list, status filter | `No device is deployed yet.` | internal + customer |
| Billable assignments | Every assignment currently flagged as billable | `billing_status = 'Billable'` | Reads the billing flag itself | `list_kpi_rows("billable_services")` | `No billable assignment.` | internal admin |
| Services started this month | Assignments whose service began inside the current month | `effective_start_date >= month_start and operational_status != 'Cancelled'` | Date arithmetic on the start date | `list_kpi_rows("services_added")` | `No service started this month.` | internal admin |
| Services ended this month | Assignments closed inside the current month | `effective_end_date >= month_start` | Date arithmetic on the end date | `list_kpi_rows("services_removed")` | `No service ended this month.` | internal admin |

---

## 2. Decisions on flagged wording

| Location | Old wording | Predicate | Decision | New wording | Reason |
| --- | --- | --- | --- | --- | --- |
| `InternalDashboard.tsx` §Service health | `Service health` / `Coverage gaps and licences that are still being billed for nothing.` | section containing only the two heuristic KPIs below | REMOVE | — (section deleted, not replaced) | Spec 04 §15: a section made only of heuristic KPIs goes; card count is not a reason to keep it |
| `InternalDashboard.tsx` | `Licences to reclaim` / `List the licences to reclaim` | open assignment whose User-scoped holder **or** current Device holder is Disabled/Archived | REMOVE | — | Spec 04 §6: mixes Device-scoped services with holder lifecycle; a Device service belongs to its Device whoever holds it. Not every service is a licence |
| `dashboard_service.py` `KPI_SOURCES["reclaimable_licences"]` | `Licences to reclaim` / `Every one of these is billed for nothing.` | same | REMOVE | — | Same; the drill-down asserted a billing loss the data does not prove |
| `dashboard_service.py` `_hygiene()` | `reclaimable_licences`, `devices_without_services` | see above / below | REMOVE | — | Both counters exist only for the removed cards |
| `InternalDashboard.tsx` | `Devices without services` | `Device.status = 'Active'` and no open Device-scoped assignment | REMOVE as KPI | — | Spec 04 §3: proves absence of a service assignment only, not insecurity or risk |
| `PortalDashboard.tsx` | `Licences to reclaim` / `Services still running for users who have left — cancel them to stop being billed.` | portal copy of the same predicate | REMOVE | replaced by `Active users` card | Spec 04 §6 and §14 |
| `PortalDashboard.tsx` | `Devices without services` / `Active devices without security` | portal copy | REMOVE | replaced by `Active devices` card | Spec 04 §3: the caption claimed security from an assignment count |
| `portal_service.py` `KPI_SOURCES` | `reclaimable_licences`, `devices_without_services` | same | REMOVE | — | Drill-downs of removed cards |
| `portal_service.get_summary` | `reclaimable_licences`, `devices_without_services` keys | same | REMOVE | — | No consumer remains |
| `UsersList.tsx` | `With an idle device` / `Active devices with no security` (ShieldAlert icon) | active person holding an active Device with no open Device-scoped assignment | REMOVE | — | Spec 04 §5: "idle" and "no security" are both inferences; the icon added a third |
| `user_service.get_user_stats` | `users_with_idle_device` | same | REMOVE | — | Spec 04 §5: counter has no other valid use |
| `UsersList.tsx` | `Disabled with services` / `Offboarding never completed` / `Show incomplete offboardings` | disabled person with an open assignment, **including** Device-scoped through a held Device | KEEP, FIX PREDICATE + RENAME | `Disabled with personal services` / `Disabled or archived people with open User-scoped services.` / `Show disabled people with personal services` | Spec 04 §7–§8: factual attention signal, User-scoped only |
| `user_service.get_user_stats` | `disabled_with_services` | includes Device-scoped assignments | FIX PREDICATE | User-scoped assignments only | Spec 04 §8: a Device service is not the person's |
| `UsersList.tsx` coverage filter `disabled_with_services` | `Disabled with open services` / `Offboarding never completed` | same | RENAME + FIX | `Disabled with personal services` / `Disabled or archived people with open User-scoped services.` | Same |
| `UsersList.tsx` coverage filter `needs_attention` | `Needs attention` / `A missing serial, a missing username, or an unfinished offboarding` | serial missing OR username missing OR disabled-with-services | REMOVE the username leg | `Needs attention` / `A missing serial, or a disabled person with open personal services.` | Spec 04 §10: a missing username is not an invariant breach for every service |
| `user_service._conditions` `needs_attention` | includes `username is null` | — | FIX PREDICATE | serial missing OR disabled-with-personal-services | Same |
| new | — | disabled/archived person with an open Device Holder period | ADD as factual filter | `Disabled user still holds a Device` / `The person is disabled or archived, but a current Device Holder period is still open.` | Spec 04 §9: separate signal, not merged with billing |
| `user_360_service._attention` | `ACCOUNT_NAME_MISSING` — `No username is recorded for the services issued to them.` | any open personal service and empty username | REMOVE | — | Spec 04 §10: username is required by a specific operation, not by every service. Execution asks for it contextually (`identifiers.require_username`) |
| `user_360_service._attention` | `DISABLED_WITH_SERVICES` — `{status} but N personal service(s) are still open.` | already User-scoped only | KEEP | unchanged | Predicate matches the wording |
| `user_360_service._attention` | `DISABLED_WITH_DEVICE` — `{status} but still holds N device(s).` | open holder period | KEEP | unchanged | Factual, matches spec 04 §9 |
| `DevicesList.tsx` | KPI card `No MAC recorded` / `Identification still incomplete` | Device with no `MSP Network Interface` MAC | REMOVE as KPI | — | Spec 04 §11: MAC is not a universal Device invariant |
| `DevicesList.tsx` coverage filter `no_mac` | `No MAC recorded` / `Identification incomplete` | same | KEEP, NEUTRAL DESCRIPTION | `No MAC recorded` / `Devices with no MAC address recorded.` | Spec 04 §11: the filter is factual; the alert wording is not |
| `DevicesList.tsx` coverage filter `no_service` | `No service` / — | active Device with no open Device-scoped assignment | KEEP, RENAME | `No current service` / `Active Devices with no current Device-scoped service assignment.` | Spec 04 §4: exact factual filter copy, no shield iconography |
| `DeviceDetail.tsx` | `Nothing runs on this machine, so it is billed for nothing.` | zero service rows | REPLACE | `No service assignment is recorded for this Device.` | Spec 04 §12 |
| `PortalServices.tsx` | `Active licences` | `operational_status = 'Active'` count | RENAME | `Active assignments` | Spec 04 §13: generic services are not licences |
| `EditClientUserModal.tsx` | placeholder `The account their licences are issued against` | username field | RENAME | `The username services are issued against` | Spec 04 §13 |
| `ApplyActionModal.tsx` | placeholder `The name on the licence` | username field | RENAME | `The username this service is issued against` | Spec 04 §13 |
| `AddUserServiceModal.tsx`, `DeviceServiceModal.tsx` | `Billing setup needs attention` + `Set rates on the assignments — or on the contract` | no valid rate found for customer/service/date | REWORD | `No valid customer service rate is available yet. Configure a rate before generating billable coverage for these services.` | Spec 04 §17: the contract is not the default rate store in the validated model |
| `flag_username_services.py` (patch) | comment `the services whose licence is issued against a named account` | historical patch, already applied | KEEP | unchanged | Not runtime product copy; rewriting an applied patch's comment changes nothing a user reads |
| `ServiceActionModal.tsx` (staff) | `Close this service` / `Close service` / `Close on` | `ServiceLifecycleService.end` | RENAME | `Stop this service?` / `Stop service` / `Stop on` · note placeholder `Why is this service being stopped?` | Spec 02 §5: one sovereign staff action, named for what it does, with no second lifecycle state |
| `UserDetail.tsx` row menu | `Close` | same | RENAME | `Stop service` | Same |
| operations registry, `ApplyActionModal.tsx`, `ExecutionWorkspace.tsx` | `service.remove` / `Remove service` / `Close` | `ServiceLifecycleService.end` | RENAME | `service.end` / `End service` | Spec 02 §3–§4: the customer-requestable final action is End service; the assignment remains visible in history |
| `ExecutionRecap.tsx`, `ExecutionWorkspace.tsx` | `Request line` / `Additional` | work order origin | RENAME | `REQUESTED` / `ADDITIONAL ACTION` | Spec 05 §14/§16: the tags the workbench names, with no lifecycle claim attached |
| `DevicesList.tsx` KPI `No service` (ShieldAlert) | `Active devices with no active service` | active Device with no open Device-scoped assignment | KEEP, NEUTRALISE | `No current service` / `Active Devices with no current Device-scoped service assignment` with a neutral icon | Spec 04 §4: a factual list counter, never an alert |
| `PortalDevices.tsx` KPI `No service` | `Active, with no active service` | portal copy of the same | REMOVE | — | Its counter is gone from the customer's summary; the coverage filter remains |

---

## 3. Remaining scan matches, justified

| Location | Term | Why it stays |
| --- | --- | --- |
| every `*/doctype/*/*.py` header, `hooks.py: app_license` | `license` | Frappe boilerplate and the app's own licence declaration |
| `utils/session_timeout.py`, `hooks.py: expire_idle_session`, `patches/portal_url_moves_home.py` | `idle` | An idle **session** is a real, measured invariant (time since last activity), unrelated to service semantics |
| `utils/gatekeeper.py` docstring | `security` | Describes the request-level permission boundary, which is exactly what it is |
| `shared/layout/UserMenu.tsx`, `MyTwoFactorModal` | `security` | Account security (2FA) is genuinely security |
| `AccessReferencesPanel.tsx` `HEALTHY` | `health` | Names the reconciliation outcome of Customer access references, a computed state with an explicit contract |
| `ResetPassword.tsx`, `ServiceDetail.tsx`, `CustomerModal.tsx`, `UserImportPanel.tsx` | `incomplete` | Describe an incomplete **link, response or form**, each verifiable at the point of use |
| `RequestsList.tsx`, `InternalDashboard.tsx` Needs attention panel | `needs attention` | Scoped to open requests by priority/age — explicit predicates, kept per spec 04 §15 |
| `CustomersList.tsx` `priced: 'incomplete'` | `incomplete` | Means "contract services without a rate", which is exactly the predicate |
| `device_lifecycle_service.py` — "a retirement is not a licence to rewrite a bill" | `licence` | Ordinary English for permission, in a comment about invoices; nothing here classifies a service |
| `BillingRunDetail.tsx` `attention` | `attention` | Points at the billing stage holding exceptions, a counted fact |

---

## 4. Later verification

Re-run after LOT V2-08, on the whole repository, with the same term list: the only remaining
matches are the ones listed in §3, plus the renamed strings recorded in §2. `Pending Removal`
no longer appears in any runtime path (spec 02 §18), and `msp_service_enabled` no longer exists
as an Item field (spec 00 §4).

## 5. Rules adopted for future metrics

- A KPI ships only with the seven-line contract of §1 filled in.
- No metric may be derived from an Item name, group or description (spec 04 §20).
- No service is called a licence, a security service or a protection unless an explicit
  capability model says so; none exists in this release (spec 00 §16).
- Neutral list filters may state an absence; only an explicit business rule may call it a risk.
