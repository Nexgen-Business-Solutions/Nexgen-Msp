# Review — `hassanAI/user-service-timeline`

Required by `.vscode/06_HASSAN_BRANCH_REVIEW_PROTOCOL.md`. No branch code was integrated before
this report existed, and nothing was merged or cherry-picked: what is adopted is ported by hand
onto the V2 model.

## Comparison base

```text
Base branch:        deploy-main
Base commit:        e07cea6ec6139108a1158fa269068c2b2d2bf955
Hassan branch:      origin/hassanAI/user-service-timeline
Hassan head commit: c518f4d6d9962a6f68df87aac8e86463b337c73a
Author / date:      Nexgen-hj · Thu 24 Sep 2026 23:19 +0300
Merge base:         e07cea6 (the branch is one commit on top of our base)
Subject:            "user page shows every service in any state, and every device holding"
```

Commands run: `git fetch --all --prune`, `git branch -r`, `git log --oneline --decorate BASE..REMOTE`,
`git diff --stat|--name-status BASE...REMOTE`, `git diff BASE...REMOTE`, and `git show REMOTE:<file>`
for the files judged below.

Diff shape: 12 files, +1482 / −636, of which 2 files (1090 lines) are built frontend assets.

---

## Classification

| Commit / File | Change | Classification | Reason | Conflict with V2 spec | Implementation action |
| --- | --- | --- | --- | --- | --- |
| `c518f4d` `user_360_service.py` — `association_window()` | Pure date arithmetic: the days a person and a machine's service were together, cut at the hand-back, `None` when they never overlapped | **ADOPT** | This is exactly the ownership rule of protocol §8: a Device service may appear on a person's page only for the holder period during which it ran. It is a pure function, fully covered by its own tests | None | Ported verbatim (docstring kept) into `user_360_service.py` |
| `c518f4d` `user_360_service.py` — `_service_timeline()` | Builds one row per assignment, and one row **per holding spell** for Device services, each with `association_from` / `association_until` | **ADAPT** | Better than the V2 reading I had written, which showed Device services only for currently-held machines and lost the dates. Its row shape has to become the V2 shape (`services` with `target`, `assignment_scope`) so the page contract stays the one spec 02 §8 names | Sorting reads `OPEN_ASSIGNMENT_STATUSES`, which no longer contains `Pending Removal` — harmless | Ported as `_service_portfolio`, keeping V2 keys and adding `association_from` / `association_until` / `holding_period` / `current_holding` |
| `c518f4d` `user_360_service.py` — `_holdings()` / `_device_history()` | Every spell this person held a machine, current first | **ADOPT** | Factual, model-backed, and the natural source for a person's device history | None | Ported as `device_history` on the person's reading |
| `c518f4d` `user_360_service.py` — `_count_by_status()` | Counts assignments by operational status | **ADOPT** | Cheap, factual, and lets the page label its own filter chips | None | Ported as `service_counts` |
| `c518f4d` `user_360_service.py` — `_describe_service(key=…)` | Lets the describer read the assignment under another key | **ADOPT** | Needed by the timeline rows, harmless elsewhere | None | Ported |
| `c518f4d` `UserDetail.tsx` — table over `data.services` with `Type` / `Associated since` / `Associated until` / `Billing status` / `Service status` | The person's page reads the backend list instead of stitching two open-only lists together | **ADAPT** | The reading is right; the column names are not ours to choose. Spec 02 §8 fixes them to `Service / Target / Started / Ended / Billing / Status / Actions` | Yes — column names and the `Services · {n}` title both contradict spec 02 §7–§8 | Kept V2 columns and chips; the association window is shown as a secondary line under `Target` for a Device row |
| `c518f4d` `UserDetail.tsx` — `statusSummary()` with `STATUS_ORDER` | A one-line count summary above the table | **ADAPT** | Spec 02 §7 forbids count wording above that table, and the order list contains `Pending Removal`, which V2 withdraws | Yes — §7, and the withdrawn state | Replaced by the four filter chips (`All / Current / Suspended / Ended`), which say the same thing without a claim |
| `c518f4d` `UserDetail.tsx` — no row actions once `current_holding` is false | A machine given back is acted on from its next holder's page | **ADOPT** | Correct ownership: a Device service follows the Device, never the previous holder | None | Ported, alongside the V2 rule that an `Ended` row offers no action at all (spec 02 §9) |
| `c518f4d` `UserHistoryPanel.tsx` — removes "Past devices" and "Past personal services" | The history panel stops repeating what the main tables now show | **ADOPT** | Consistent with spec 02 §6: history lives in the listing, not in a second panel | None | Ported |
| `c518f4d` `StatusBadge.tsx` — adds two status tones | Tones for statuses the timeline surfaces | **ALREADY IMPLEMENTED** | Our badge map already covers every state, and the `Pending Removal` tone is deliberately gone | The added `Pending Removal` tone contradicts spec 02 §18 | Not ported |
| `c518f4d` `internal.ts` — `UserServiceTimelineEntry` | Types the timeline row | **ADAPT** | Same reading, V2 names: our `UserPortfolioEntry` gains the association fields | None | Ported into `UserPortfolioEntry` |
| `c518f4d` `test_user_service_timeline.py` (291 lines) | 6 unit tests on the window, 14 integration tests on the reading | **ADOPT** | This is the coverage protocol §7 asks for, and it pins the ownership rule | Two tests name `Pending Removal`; one asserts the old open-only lists | Ported as `tests/test_user_service_timeline.py`, minus the withdrawn state, plus the V2 keys |
| `c518f4d` `PortalFiles.test.tsx`, `UserDetail.test.tsx` | Fixtures and assertions for the above | **ADAPT** | Our fixtures already carry `services`; the assertions follow the V2 column names | None | Merged by hand into the existing tests |
| `c518f4d` `public/frontend/assets/index-*.js`, `public/frontend/index.html`, `www/msp.html` | Rebuilt bundle | **REJECT** | Build artefacts. They are generated, never reviewed, and this repository does not take them from a branch | None | Not ported |

---

## Compatibility gates (protocol §6)

Checked against the branch, each one clear:

| Gate | Verdict |
| --- | --- |
| Reintroduces `MSP Request Action` | No |
| Reads/writes Item MSP custom fields | No — it never touches the catalogue |
| Treats `Item.disabled` as MSP availability | No |
| Creates new `Pending Removal` | No — it only *names* the state in a sort order and a badge map, both dropped |
| Hides Ended services | No — the opposite; this is the branch's whole point |
| Couples Client User to Frappe User | No |
| Changes Device ownership/holder rules | No — it reads `MSP Device Holder` as authoritative |
| Treats a Device service as the holder's | No — the association window is precisely what prevents that |
| Introduces heuristic "security coverage" | No |
| Broad ERPNext Item mutation patches | No |
| Weakens Customer access reconciliation | No |
| Bypasses lifecycle services | No — it is read-only |
| Deletes historical assignments | No |
| Changes billing history | No — `billing_status` and `last_billed_on` are read as stored |

---

## What was ported, and where

| Source (branch) | Destination (this repository) |
| --- | --- |
| `association_window()` | `nexgen_msp/api/internal/services/user_360_service.py` |
| `_holdings()`, `_device_history()`, `_count_by_status()`, `_describe_service(key=…)` | same file |
| `_service_timeline()` | same file, as `_service_portfolio()` in the V2 row shape |
| `UserServiceTimelineEntry` | `frontend/src/lib/api/internal.ts`, as fields on `UserPortfolioEntry` |
| person-page table reading `data.services`, no action once the machine is gone | `frontend/src/features/internal/pages/UserDetail.tsx` |
| `UserHistoryPanel` without the two repeated lists | `frontend/src/features/internal/components/UserHistoryPanel.tsx` |
| `test_user_service_timeline.py` | `nexgen_msp/tests/test_user_service_timeline.py` |

Nothing else from the branch is used. The vocabulary of protocol §9 is respected: the ported code
states facts (`Service started`, `Service ended`, `Device assigned`, holder periods) and interprets
nothing.
