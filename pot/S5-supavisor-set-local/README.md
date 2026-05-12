# S5 — Supavisor `SET LOCAL` parity

## Hypothesis

Supavisor transaction-mode pooling honours `SET LOCAL` boundaries even when the underlying server connection is reused across transactions (the entire RLS-defence-in-depth design depends on this).

## Go/no-go signal

- **Green:** A two-transaction probe (`BEGIN; SET LOCAL app.tenant_id = 't1'; SELECT current_setting('app.tenant_id'); COMMIT;` → `BEGIN; SELECT current_setting('app.tenant_id', true); COMMIT;`) on the SAME pooler-server connection returns the tenant value in transaction 1 and NULL/empty in transaction 2.
- **Yellow:** N/A — there is no middle ground for this signal. Either it leaks or it doesn't.
- **Red:** Transaction 2 sees `t1`. Switch to PgBouncer 1.22+ per ADR-0018 fallback. Update ADR-0018 Decision section before Sprint 0 closes.

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
- `probe-output.txt` — raw psql output of both transactions
- `connection-id-trace.txt` — `pg_backend_pid()` proves both transactions reused the same server connection
- `summary.md` — one paragraph: Green or Red, exact value seen in transaction 2

## Yellow remediation

Not applicable — this is a binary signal.

## ADR linkage

Primary evidence for [ADR-0018 (Supavisor as transaction-mode pooler)](../../docs/adr/0018-supavisor-pooling.md). Red here flips the Decision section to PgBouncer 1.22+ before Sprint 0.
