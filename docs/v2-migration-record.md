# V2 migration record — `msp.localhost`

Required by `.vscode/07_MIGRATION_QA_AND_ACCEPTANCE_V2.md` §2 and §3.

## Before migration (§2)

```text
site          msp.localhost
backup        20260925_034912-msp_localhost-database.sql.gz (49.9 MiB, verified)
              20260925_034912-msp_localhost-site_config_backup.json
timestamp     2026-09-25 03:49:37
base commit   e07cea6ec6139108a1158fa269068c2b2d2bf955
```

The "before" column below is read back from that backup, not from memory: the dump is parsed
table by table, so every figure can be reproduced from the file itself.

## Data counts (§3)

| Count | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Items | 7 | 3 | −4 |
| Items with `msp_service_scope` | 7 | 3 | −4 |
| Items with `msp_invoice_label` | 1 | 1 | 0 |
| MSP Service Definitions | 0 | 3 | +3 |
| Assignments — Active | 561 | 555 | −6 |
| Assignments — Ended | 142 | 142 | 0 |
| Assignments — Pending Removal | 0 | 0 | 0 |
| MSP Contract Service rows | 12 | 6 | −6 |
| Customer-role accounts | 9 | 5 | −4 |
| Requests — Approved | 5 | 5 | 0 |
| Requests — Completed | 5 | 4 | −1 |
| Requests — Rejected | 2 | 1 | −1 |
| Requests — Cancelled | 1 | 1 | 0 |
| Requests — Draft | 1 | 0 | −1 |
| Request Lines | 23 | 19 | −4 |
| Work Orders — Completed | 17 | 14 | −3 |
| Work Orders — Open | 8 | 8 | 0 |
| Client Users | 384 | 376 | −8 |
| Managed Devices | 278 | 273 | −5 |
| Customers | 13 | 9 | −4 |

## Every intentional delta

| Delta | Why |
| --- | --- |
| Definitions 0 → 3 | LOT V2-02: one `MSP Service Definition` per MSP Item, written by `patches/msp_service_definitions.py`. Three Items are MSP services, so three definitions, each resolvable and enabled |
| Items 7 → 3, scope 7 → 3 | The four removed Items are `ZZTEST-UI-BACKUP`, `ZZTEST-UI-M365`, `ZZTEST-UI-SOPHOS`, `ZZTEST-UI-VPN`: the disposable dataset built to exercise the V2 screens. The three real ones — Parallels, Sophos, Nextcloud — are untouched, disabled = 0, `stock_uom` and `sales_uom` unchanged |
| Customers 13 → 9 | `ZZTEST Customer e139d8`, `ZZTEST UI Acme`, `ZZTEST UI NewCo`, `ZZTEST UI Other` |
| Client Users 384 → 376 | Four people of `ZZTEST UI Acme` and four left over from earlier runs, all named `ZZTEST …` and pointing at a customer that no longer existed |
| Devices 278 → 273 | Five machines with a `ZZTEST` serial or hostname |
| Assignments Active 561 → 555 | Six assignments belonging to the ZZTEST customers. No Ended assignment was removed: history is kept, including the 142 that were already there |
| Contract Service 12 → 6 | The six contract rows that covered the ZZTEST services |
| Requests 14 → 11, Lines 23 → 19, Work Orders 25 → 22 | The three requests raised for `ZZTEST UI Acme` while the screens were being tested, with their lines and their work orders |
| Customer-role accounts 9 → 5 | `zztest.rbe13@`, `zztest.ui.manager@`, `zztest.ui.operator@`, `zztest.ui.other@`. The five real accounts keep their rights |

Nothing else changed. No Ended assignment, no billing record and no real customer document was
touched by the clean-up, and `Pending Removal` was 0 before and stays 0.

## Orphan definitions

The suite created 1 304 definitions for Items its own fixtures then deleted. They were removed,
and `tests/base.py` now deletes an Item's definition with the Item, so a run leaves none behind.

Proven rather than assumed: the whole suite — 1 087 tests — was re-run after the clean-up, and
every count above was identical before and after it. Three definitions, three Items, 555 active
and 142 ended assignments, 376 people, 273 machines, nine customers, six contract lines, and not
one row carrying the test prefix.

## Full regression (LOT V2-09)

```text
1087 tests, 2170s, 2 red
nexgen_msp.tests.test_device_callers.TestDeviceCallers
    .test_retiring_a_held_machine_closes_its_spell_and_its_services
nexgen_msp.tests.test_access_guards.TestRawDocumentBoundary
    .test_generic_lists_return_no_msp_rows_to_a_customer_contact
```

Both were already red before this work and neither belongs to a V2 lot: the first expects
retiring a machine to close its services, which commit `0ef3f64` stopped doing by default; the
second expects a generic list to come back empty for a customer contact, which commit `458f84c`
turned into a refusal by removing the customer DocPerms. They are left as they are, and named
here so nobody reads them as V2 damage.
