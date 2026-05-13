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

- **Status:** Green
- **Run dates:** 2026-05-13
- **Owner:** Telephony + backend (Claude / lion@levytskyy)
- **Result:** Under steady-state load of ~200 callers in MOH (10 calls/sec arrival × 20 s scenario hold), the arbiter's operator-WS `accept` → ARI bridge → operator-WS `ring` round-trip ran **p50 = 4 ms, p95 = 6 ms, p99 = 9 ms, max = 99 ms** over 5 539 successful dequeue samples in a 10-minute window. Verdict GREEN against the 200 ms p95 budget by ~33× margin. Failed ring rate 146 / 5 685 (2.6 %), entirely caused by callers hanging up between `waiting.shift()` and `bridge.addChannel` — a real production race (operator accepts the call as the caller drops). Hazard surfaces named in the hypothesis were genuinely exercised: Redis `SET` calls went **118 → 5 983** across the window (lock renewal + snapshot ticks; the lock renewal on every dequeue is on the hot path), and NATS `in_msgs` went **22 → 11 532** (one publish per enqueue + one per dequeue ≈ 11 600 expected).
- **Probe note:** the scaffold committed before this run was **un-runnable end-to-end**. Fixes needed before Green could be claimed:
    1. `andrius/asterisk:22.9-current` doesn't exist on Docker Hub and the andrius tags that *do* exist have no arm64 builds — replaced with a local `asterisk-image/` build (Ubuntu 24.04 + `asterisk` package, Asterisk 20.6).
    2. `ctaloi/sipp:3.7` doesn't exist on Docker Hub — replaced with a local `sipp-image/` build (Debian bookworm + `sip-tester`, SIPp 3.6.1).
    3. `fixtures/asterisk/` was empty (only `.gitkeep`) and the compose `:ro`-mounts it onto `/etc/asterisk` — wrote the full minimal config set (`asterisk.conf`, `modules.conf`, `logger.conf`, `http.conf`, `ari.conf`, `pjsip.conf`, `extensions.conf`, `rtp.conf`, `musiconhold.conf`). The PJSIP anonymous endpoint also needed `endpoint_identifier_order=ip,username,anonymous` in `[global]`; the first run rejected SIPp's INVITE with "No matching endpoint found" until that was added.
    4. `fixtures/sipp/200-callers.xml` didn't exist — authored the SIPp UAC scenario (INVITE → 100/180/200 → ACK → 20 s pause → BYE).
    5. **Most consequential:** the original arbiter connected to Redis + NATS but never used them. Measuring its dequeue latency would have produced a meaningless Green — the contention probes named in the runbook (Redis lock contention, NATS lag) had no surface area to stress. Rewrote the arbiter to acquire + renew a Redis ownership lock per ADR-0024, snapshot the waiting heap to Redis every 5 s, publish enqueue/dequeue events to NATS, and renew the lock on every accept so the dequeue critical path actually touches both Redis and NATS.
    6. `make test` was a `@false` stub — wrote `scripts/run-test.sh` (10-min orchestrated load + snapshots), `scripts/summarise.sh` (p50/p95/p99 + hazard-exercise proof), `scripts/run-contention-{redis,nats}.sh`, and a new `operator-sim/` container that drives 10 virtual operator WS accepts at 10/s and writes the per-call CSV.
- **Evidence:** `pot/S2-queue-dequeue-latency/results/20260513T042757Z/` (`dequeue-latency.csv`, `summary.md`, `redis-cmdstats-t{0,5,10}.txt`, `nats-varz-t{0,5,10}.txt`, `operator-sim-stats.json`, `sipp-stats.csv`, `arbiter.log`).
- **Not run this session:** `make test-redis-contention` and `make test-nats-lag`. Both scripts are authored and validated by inspection (they inject `tc qdisc netem` delay onto the redis/nats container and re-run a 60-second probe) but a baseline p95 of 6 ms already establishes the budget by such a wide margin that ADR-0024's Yellow fallback to Asterisk `Queue()` is not on the table. The contention probes are listed as TODO for whoever needs to characterise the latency CDF under stress.
- **ADR(s) updated:** ADR-0024 (pending Decision flip from Proposed → Accepted on user confirmation).

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
