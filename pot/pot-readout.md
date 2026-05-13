# PoT Readout — Phase 0 Exit Gate G0 Deliverable

This document is filled in as spikes execute and signed off at G0. One section per spike.

Status legend: **Not started** · **In progress** · **Green** (signal met) · **Yellow** (signal partially met, remediation accepted) · **Red** (signal not met, ADR renegotiation required).

---

## S1 — End-to-end telephony happy path

- **Status:** Not started
- **Run dates:** —
- **Owner:** —
- **Result:** —
- **Evidence:** `pot/S1-telephony-happy-path/results/`
- **ADR(s) updated:** —

## S2 — NestJS-arbitrated queue dequeue latency

- **Status:** Not started
- **Run dates:** —
- **Owner:** —
- **Result:** —
- **Evidence:** `pot/S2-queue-dequeue-latency/results/`
- **ADR(s) updated:** ADR-0024

## S3 — ARI leader 100 ms hard-stop

- **Status:** Not started
- **Run dates:** —
- **Owner:** —
- **Result:** —
- **Evidence:** `pot/S3-ari-leader-hard-stop/results/`
- **ADR(s) updated:** ADR-0016

## S4 — Two-pass redaction accuracy on 8 kHz μ-law

- **Status:** Not started
- **Run dates:** —
- **Owner:** —
- **Result:** —
- **Evidence:** `pot/S4-redaction-accuracy/results/`
- **ADR(s) updated:** ADR-0013

## S5 — Supavisor `SET LOCAL` parity

- **Status:** Green
- **Run dates:** 2026-05-13
- **Owner:** SRE (Claude / lion@levytskyy)
- **Result:** Supavisor 1.1.66 in transaction mode honours the `SET LOCAL` boundary across transactions on a reused server backend. Two transactions in a single psql client session (tenant `pot`, `pool_size=1`, `mode_type=transaction`, `require_user=true`) both ran on backend pid 134; transaction 1 set `app.tenant_id = 'tenant-A'` via `SET LOCAL`; transaction 2 read `current_setting('app.tenant_id', true)` and got NULL/empty. No leak across the COMMIT boundary on the shared backend.
- **Probe note:** the original scaffold's probe (two separate psql invocations) was structurally invalid — distinct client sessions land on distinct server backends even at `pool_size=1`, so any "no leak" result would have been trivially true and unrelated to the `SET LOCAL` mechanic. The probe was corrected to run both transactions in a single psql client session and assert `pid_t1 == pid_t2`; the scaffold also gained `fixtures/init.sql` (creates `_supavisor` database + schema), a `supavisor-migrate` one-shot compose service (runs `bin/supavisor eval "Supavisor.Release.migrate"`), and a JWT-minting step in `fixtures/probe.sh` (Supavisor's admin API rejects literal `Bearer dev`; it expects HS256 signed with `API_JWT_SECRET`).
- **Evidence:** `pot/S5-supavisor-set-local/results/20260513T033050Z/` (`probe-output.txt`, `summary.md`, `tenant-create.json`)
- **ADR(s) updated:** ADR-0018 (pending Decision flip from Proposed → Accepted on user confirmation)

## S6 — `/v1` byte-for-byte fixture capture

- **Status:** Not started
- **Run dates:** —
- **Owner:** —
- **Result:** —
- **Evidence:** `pot/S6-ncall-fixture-capture/results/`
- **ADR(s) updated:** —

## S7 — Temporal Cloud BAA + EU namespace

- **Status:** Not started
- **Run dates:** —
- **Owner:** —
- **Result:** —
- **Evidence:** `pot/S7-temporal-baa/results/`
- **ADR(s) updated:** ADR-0015

## S8 — Caddy 2.10+ permission + LE rate-limit

- **Status:** Not started
- **Run dates:** —
- **Owner:** —
- **Result:** —
- **Evidence:** `pot/S8-caddy-le-posture/results/`
- **ADR(s) updated:** ADR-0019

---

## G0 sign-off

- [ ] All 8 spikes Green, or written remediation for Yellow
- [ ] All spike directories tagged `pot/<spike>` in git
- [ ] Senior architect signature: ___________________ date: ____________
- [ ] Compliance lead signature: ___________________ date: ____________
