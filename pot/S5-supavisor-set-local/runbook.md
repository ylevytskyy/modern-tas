# S5 Runbook

## Setup

```
make up
```

Boots four services in order via compose `depends_on`:

1. `postgres:17-alpine` — runs `fixtures/init.sql` on first boot (creates `_supavisor` database + schema).
2. `supavisor-migrate` — one-shot that runs `bin/supavisor eval "Supavisor.Release.migrate"`. Populates the `_supavisor.*` tables Supavisor expects. Exits 0.
3. `supavisor` (image `supabase/supavisor:1.1.66`) — gated on the migrate one-shot's clean exit.
4. `runner` (postgres image, reused for `psql`) — sleeps; the probe `docker compose exec`s into it.

`make up` then sleeps 10 s and prints `docker compose ps`.

## Test

```
make test
```

What `fixtures/probe.sh` does:

1. Mints an admin JWT (HS256, `role=admin`, signed with `API_JWT_SECRET=dev`).
2. Configures the `pot` tenant via Supavisor's admin API:
   - `require_user: true` (vanilla Postgres auth — no Supabase `auth.users` dependency)
   - one user `postgres` flagged `is_manager: true`
   - `pool_size: 1`, `mode_type: transaction`
3. Runs the probe in a **single psql client session** (both transactions in one heredoc). This is the critical bit: separate psql invocations land on different server backends even at `pool_size=1`, which would make any "no leak" result trivially true and unrelated to `SET LOCAL`.
   ```sql
   -- transaction 1
   BEGIN;
   SET LOCAL app.tenant_id = 'tenant-A';
   SELECT current_setting('app.tenant_id') AS t1_value, pg_backend_pid() AS pid_t1;
   COMMIT;

   -- transaction 2 (same psql session, same Supavisor client_handler,
   --                same server backend since pool_size=1)
   BEGIN;
   SELECT current_setting('app.tenant_id', true) AS t2_value, pg_backend_pid() AS pid_t2;
   COMMIT;
   ```
4. Asserts both conditions:
   - `pid_t1 == pid_t2` — without this, the test does not exercise the SET LOCAL boundary at all.
   - `t2_value IS NULL OR t2_value = ''` — proves the boundary held.
5. Writes `results/<ts>/tenant-create.json`, `probe-output.txt`, `summary.md`.

## Expected outcomes

- **Green** (exit 0): both assertions hold. `summary.md`: "Green: Supavisor honoured SET LOCAL boundary across transactions on a shared backend (pid_t1=pid_t2=<N>); transaction 2 read NULL/empty for app.tenant_id."
- **Red** (exit 1): pids match but `t2_value` is `'tenant-A'`. `summary.md`: "Red: Supavisor LEAKED SET LOCAL ... ADR-0018 fallback (PgBouncer 1.22+) required."
- **Inconclusive** (exit 2): pids differ, or parsing failed. Probe needs revision before a verdict can be recorded.

## Snapshot

```
make snapshot-results
```

## Teardown

```
make teardown
```
