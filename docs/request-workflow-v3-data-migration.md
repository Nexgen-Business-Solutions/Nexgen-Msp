# Request Workflow V3 — data migration

Required by `.vscode/08_MIGRATION_TESTS_AND_DEFINITION_OF_DONE.md` §2–§4.

## Before migration

```text
site          msp.localhost
backup        20260926_053523-msp_localhost-database.sql.gz (54.2 MiB, verified)
              20260926_053523-msp_localhost-site_config_backup.json
timestamp     2026-09-26 05:35:56
base commit   e07cea6ec6139108a1158fa269068c2b2d2bf955
```

## Preflight (§3)

Counted before anything was written:

| Count | Value |
| --- | ---: |
| Requests | 11 |
| Request Lines | 19 |
| Distinct `subject_key` on lines | 11 |
| Lines without `subject_key` | 1 |
| Work Orders | 22 |
| Work Orders without `request_line_name` | 4 |
| Legacy `MSP Request Action` rows | 5 |
| Lines still referencing `request_action` | 19 |
| Lines carrying an `operation_code` | 19 |

Requests by status: Approved 5, Completed 4, Cancelled 1, Rejected 1.

## Schema

Two child DocTypes, owned by `MSP Service Request`:

```text
MSP Request Subject      -> field `subjects`
MSP Request Action Group -> field `action_groups`
```

One field added on each of `MSP Service Request Line` and `MSP Service Work Order`:

```text
action_group_key
```

Nothing was renamed, nothing was dropped.

## Migration — `patches/request_v3_snapshot.py`

What it does, per Request:

1. one `MSP Request Subject` per distinct `subject_key`, keyed `user:{CLIENT_USER}` for an
   existing person and `new:legacy-{hash}` for one that never existed as a record;
2. one `MSP Request Action Group` per (operation, service) pair inside that Request;
3. `action_group_key` stamped on every line and on every Work Order that points at a line.

Result on `msp.localhost`:

```text
15 subject(s), 19 legacy group(s), 19 line(s) stamped, 18 Work Order(s) stamped
```

Four Work Orders carry no group key because they carry no `request_line_name` either: they
are technician-added work, which by design belongs to no customer action group.

## What the migration does not claim (§4)

The grouping a customer saw when they raised a Request before V3 was never recorded, and it
cannot be recovered from atomic lines. Every group this patch writes is therefore marked:

```text
group_origin = LegacyMigration
```

No historical line, Work Order or assignment was modified beyond the two key fields, and
none was deleted. A migrated Request reads exactly as it did before, with its acts grouped
by what they did rather than by what the customer clicked.
