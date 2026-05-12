# ADR-0018: Supavisor as transaction-mode pooler (PgBouncer fallback)

- **Status:** Proposed
- **Date:** 2026-05-12
- **Deciders:** SRE, Backend lead
- **Consulted:** Senior architect, Security eng
- **Informed:** All backend engineers

## Context

The multi-tenant data isolation design (ARCH v0.4 §6) layers PostgreSQL Row-Level Security on top of `app.tenant_id` set per transaction via `SET LOCAL app.tenant_id = '<uuid>'`. RLS policies reference `current_setting('app.tenant_id')`. This design is sound only if the connection pooler honours `SET LOCAL` boundaries — the setting must not leak across transactions on the same pooled server connection.

PgBouncer 1.22+ in transaction mode is the documented baseline that honours this. Supavisor (the Elixir/Postgrex clean-room reimplementation Supabase uses) markets transaction-mode parity but does not state `SET LOCAL` boundary behaviour explicitly in its docs. RISKS v0.2 §1 (N6) flags this — community-assumed behaviour, no vendor assertion, no open issues either way.

If `SET LOCAL` leaks, every multi-tenant query becomes a cross-tenant data leak waiting to happen. The entire RLS-as-defence-in-depth design relies on this.

## Decision

Use Supavisor as the primary pooler (better operational story than PgBouncer for multi-cluster routing), pinned to 1.1+ for the connection-routing improvements landed in that release. PoT spike S5 verifies `SET LOCAL` parity with a deliberate negative-case test.

If S5 returns Red (parity not honoured), fall back to **PgBouncer 1.22+ in transaction mode**. The application code is identical either way — both speak the standard PostgreSQL protocol. Only the deployment topology changes.

## Consequences

- **Positive:** Supavisor's multi-cluster routing simplifies the future read-replica + per-region split. Active development.
- **Negative / cost:** Less operational maturity than PgBouncer. The negative-case test is a permanent CI gate, not a one-time check — every Supavisor upgrade re-runs it.
- **Neutral:** Both options are open-source and free at our scale.

## Evidence

Pending PoT spike S5 — see [`pot/S5-supavisor-set-local/results/`](../../pot/S5-supavisor-set-local/results/). Target signal: a two-transaction probe (`BEGIN; SET LOCAL app.tenant_id = '...'; ...; COMMIT;` then a second transaction's `current_setting('app.tenant_id', true)` returns NULL/empty on the same pooler connection) returns Green.

## Alternatives considered

- **PgBouncer 1.22+ as primary.** Adopted as the Yellow/Red fallback. Loses Supavisor's routing features but is the conservative choice if S5 fails.
- **No pooler — direct PostgreSQL connections per NestJS instance.** Connection-storm risk; PostgreSQL 17 still tops out around a few hundred connections per node. Rejected.
- **Statement-mode pooling.** Drops `SET LOCAL` semantics entirely. Would force RLS context into per-statement parameters — significant ORM impact. Rejected.
