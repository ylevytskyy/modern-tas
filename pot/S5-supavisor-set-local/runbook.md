# S5 Runbook

## Setup

```
make up
```

Boots: postgres:17 + supavisor (pinned to 1.1+) + a thin test runner container.

Wait ~30 s for Supavisor to detect Postgres and create its pool.

## Test

```
make test
```

What `make test` does:

1. Connects to Postgres **directly** (not via pooler), creates a tenant column with `SET LOCAL`-readable behaviour:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
   ```
2. Configures Supavisor pool size = 1 (forces connection reuse).
3. Runs the probe via the test runner:
   ```sql
   -- transaction 1 (via pooler)
   BEGIN;
   SET LOCAL app.tenant_id = 'tenant-A';
   SELECT current_setting('app.tenant_id') AS t1_value, pg_backend_pid() AS pid_t1;
   COMMIT;

   -- transaction 2 (via pooler, MUST reuse the same backend)
   BEGIN;
   SELECT current_setting('app.tenant_id', true) AS t2_value, pg_backend_pid() AS pid_t2;
   COMMIT;
   ```
4. Asserts: `pid_t1 == pid_t2` (proves connection reuse) AND `t2_value IS NULL OR t2_value = ''` (proves SET LOCAL boundary honoured).
5. Writes `results/probe-output.txt` and `summary.md`.

## Expected outcomes

- **Green path:** assertion holds. Write `summary.md` with "Green: Supavisor honours SET LOCAL boundary; transaction 2 saw NULL with same backend pid."
- **Red path:** assertion fails. Write `summary.md` with "Red: Supavisor LEAKS SET LOCAL across transactions on shared backend. Transaction 2 saw '<value>' with pid <X>. Falling back to PgBouncer per ADR-0018."

## Snapshot

```
make snapshot-results
```

## Teardown

```
make teardown
```
