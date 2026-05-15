# S5 — Supavisor `SET LOCAL` parity

## Hypothesis

Supavisor transaction-mode pooling honours `SET LOCAL` boundaries even when the underlying server connection is reused across transactions (the entire RLS-defence-in-depth design depends on this).

## Go/no-go signal

- **Green:** A two-transaction probe in a **single psql client session** (`BEGIN; SET LOCAL app.tenant_id = 'tenant-A'; SELECT current_setting('app.tenant_id'), pg_backend_pid(); COMMIT;` → `BEGIN; SELECT current_setting('app.tenant_id', true), pg_backend_pid(); COMMIT;`) returns `tenant-A` in transaction 1 and NULL/empty in transaction 2, with `pid_t1 == pid_t2` (proves the same server backend served both transactions through the pooler at `pool_size=1`).
- **Yellow:** N/A — there is no middle ground for this signal. Either it leaks or it doesn't.
- **Red:** Transaction 2 sees `tenant-A`. Switch to PgBouncer 1.22+ per ADR-0018 fallback. Update ADR-0018 Decision section before Sprint 0 closes.
- **Inconclusive:** `pid_t1 != pid_t2` (test failed to exercise the boundary because the transactions did not share a backend). Probe must be revised before a Green/Red verdict can be claimed.

## Owner role

SRE.

## Prereqs

- Docker 24+, Docker Compose v2.
- Host: 2 GB RAM (smallest spike).
- No external accounts.
- ~5 minutes wall time.

## Runbook

```
make up && make test && make snapshot-results
```

Step-by-step in [`runbook.md`](./runbook.md).

## Recording protocol

`results/<timestamp>/`:
- `tenant-create.json` — Supavisor admin API response for the tenant config (HTTP 201 with tenant body proves auth+config landed).
- `probe-output.txt` — raw psql output of both transactions, including `pg_backend_pid()` for each (proves both transactions reused the same server connection).
- `summary.md` — one paragraph: Green / Red / Inconclusive, with the parsed `pid_t1`, `pid_t2`, and `t2_value`.

## Yellow remediation

Not applicable — this is a binary signal.

## ADR linkage

Primary evidence for [ADR-0018 (Supavisor as transaction-mode pooler)](../../docs/adr/0018-supavisor-pooling.md). Red here flips the Decision section to PgBouncer 1.22+ before Sprint 0.
