# PoT Phase 0 Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the scaffold described in [`docs/superpowers/specs/2026-05-12-pot-phase-0-scaffold-design.md`](../specs/2026-05-12-pot-phase-0-scaffold-design.md) on branch `pot/scaffold` — 8 spike directories with identical anatomy, 6 seeded ADRs at Proposed status, no spike execution.

**Architecture:** Pure config + documentation work on branch `pot/scaffold`. Five compose files boot heterogeneous telephony/data stacks for later spike execution; three more are documented stubs (external-dep blocked). One Makefile dispatcher routes to per-spike Makefiles. Six ADRs follow MADR 4.0 lite format and remain at `Proposed` status (evidence pending PoT).

**Tech Stack:** Markdown (READMEs, ADRs, runbooks), Docker Compose v2 (5 runnable + 3 stub), GNU Make (1 dispatcher + 8 per-spike), no application code.

**TDD exception note** — per CLAUDE.md §4a, TDD does not apply: this is throwaway scaffold for throwaway spikes, all content is config/doc, no behavioral code lands. Verification follows CLAUDE.md §6 instead — every compose file passes `docker compose config`, the dispatcher's `make help` lists all 40 targets, and the spec §9 success criteria run end-to-end at task 11.

**Branch:** `pot/scaffold` (already cut, design spec already committed at 06322bb). All tasks below commit on this branch.

---

## File Structure

```
docs/adr/
  README.md                               # task 1
  template.md                             # task 1
  0013-redaction-pipeline.md              # task 1
  0015-temporal-cloud-tier.md             # task 1
  0016-ari-leader-design.md               # task 1
  0018-supavisor-pooling.md               # task 1
  0019-caddy-le-posture.md                # task 1
  0024-queue-dequeue-budget.md            # task 1
pot/
  README.md                               # task 2
  Makefile                                # task 2
  pot-readout.md                          # task 2
  S1-telephony-happy-path/                # task 3 (runnable)
  S2-queue-dequeue-latency/               # task 4 (runnable + NestJS arbiter Dockerfile)
  S3-ari-leader-hard-stop/                # task 5 (runnable)
  S4-redaction-accuracy/                  # task 6 (stub)
  S5-supavisor-set-local/                 # task 7 (runnable)
  S6-ncall-fixture-capture/               # task 8 (stub)
  S7-temporal-baa/                        # task 9 (stub)
  S8-caddy-le-posture/                    # task 10 (runnable)
```

Final verification gate at task 11 runs spec §9 success criteria.

Per-spike directories all have the same internal anatomy (per spec §4.2):

```
pot/S<N>-<slug>/
  README.md           # 8-section structure: Hypothesis, Signal, Owner, Prereqs, Runbook, Recording, Yellow remediation, ADR linkage
  runbook.md          # step-by-step execution prose
  docker-compose.yml  # runnable (S1/S2/S3/S5/S8) or stub (S4/S6/S7)
  Makefile            # 5 targets: up, test, teardown, snapshot-results, status
  fixtures/.gitkeep
  results/.gitkeep
  .gitignore          # ignore results/* except .gitkeep
```

---

## Task 1: ADR template, index, and 6 seeded ADRs

**Files:**
- Create: `docs/adr/README.md`
- Create: `docs/adr/template.md`
- Create: `docs/adr/0013-redaction-pipeline.md`
- Create: `docs/adr/0015-temporal-cloud-tier.md`
- Create: `docs/adr/0016-ari-leader-design.md`
- Create: `docs/adr/0018-supavisor-pooling.md`
- Create: `docs/adr/0019-caddy-le-posture.md`
- Create: `docs/adr/0024-queue-dequeue-budget.md`

- [ ] **Step 1: Write `docs/adr/template.md`**

```markdown
# ADR-NNNN: <decision title>

- **Status:** Proposed
- **Date:** YYYY-MM-DD
- **Deciders:** <roles>
- **Consulted:** <roles>
- **Informed:** <roles>

## Context

<Forces, constraints, prior options. Why is a decision needed now? What goes wrong if we don't decide?>

## Decision

<The choice in one paragraph. Active voice, present tense.>

## Consequences

- **Positive:** …
- **Negative / cost:** …
- **Neutral:** …

## Evidence

<Links to PoT spike results, benchmarks, vendor letters, prior ADRs. Use absolute repo paths or relative links.>

## Alternatives considered

<One paragraph each on the rejected options + why each was rejected.>
```

- [ ] **Step 2: Write `docs/adr/README.md`**

```markdown
# Architecture Decision Records

ADRs use **MADR 4.0 lite** format. Each decision lives in one file, kebab-case-numbered. To add: copy `template.md`, take the next number, fill in, link from the index.

## Index

| # | Title | Status | Spike | Owner |
|---|---|---|---|---|
| 0013 | [Two-pass redaction pipeline](./0013-redaction-pipeline.md) | Proposed | S4 | Backend + Compliance |
| 0015 | [Temporal Cloud Enterprise tier with EU namespace](./0015-temporal-cloud-tier.md) | Proposed | S7 | Compliance |
| 0016 | [ARI leader 100 ms hard-stop heartbeat](./0016-ari-leader-design.md) | Proposed | S3 | Telephony |
| 0018 | [Supavisor as transaction-mode pooler](./0018-supavisor-pooling.md) | Proposed | S5 | SRE |
| 0019 | [Caddy 2.10+ on-demand TLS posture](./0019-caddy-le-posture.md) | Proposed | S8 | SRE |
| 0024 | [Queue dequeue latency budget = 200 ms p95](./0024-queue-dequeue-budget.md) | Proposed | S2 | Backend |

## Status lifecycle

`Proposed` → `Accepted` (after PoT evidence + Sprint 0 ratification) → `Deprecated` or `Superseded by ADR-XXXX`.

## Out of scope here

The Sprint-0 30-ADR gate (ARCH v0.4 §9) includes 24 more ADRs that don't depend on PoT evidence. Those land during Sprint 0, not this branch.
```

- [ ] **Step 3: Write `docs/adr/0013-redaction-pipeline.md`**

```markdown
# ADR-0013: Two-pass redaction pipeline (forced-align + NER + over-bleep)

- **Status:** Proposed
- **Date:** 2026-05-12
- **Deciders:** Backend lead, Compliance lead
- **Consulted:** Telephony lead, Security eng
- **Informed:** All MVP engineers

## Context

PCI-DSS and HIPAA require that PAN, MRN, DOB, account numbers, and similar PII spoken on recorded calls be unrecoverable from stored audio. Forced-aligned bleeping over ASR transcripts is the industry default but has documented blind spots: numbers spoken digit-by-digit, account IDs mixed with letters, accented speakers, and audio recorded at telephony sample rates (8 kHz μ-law) all degrade ASR boundaries. RISKS v0.2 §1 flags this as a load-bearing unknown — no published WER on 8 kHz μ-law for medical PII.

Pure ASR-bleep is insufficient. Pure manual QA is uneconomic at our target scale. We need a layered pipeline that catches each class of failure with a different mechanism.

## Decision

Adopt a two-pass redaction pipeline:

1. **Pass 1 — ASR + forced alignment.** AssemblyAI Universal-3 Pro Medical (or equivalent medical-domain ASR) produces word-level timestamps. Microsoft Presidio's NER recognises PII spans. The intersection produces a high-confidence redaction mask.
2. **Pass 2 — segment-boundary fallback over-bleep.** For any span where Presidio confidence < threshold or the ASR confidence on the boundary words < threshold, the system over-bleeps to the next silence boundary or 1.5 s, whichever is shorter. This trades intelligibility for safety.
3. **Manual QA gate.** A 2% random sample of redacted recordings is queued for human review weekly. Findings feed the threshold-tuning loop.

## Consequences

- **Positive:** Defence-in-depth — three failure modes (ASR misses, NER misses, threshold mistune) require independent failures to leak PII. Manual QA catches the long tail.
- **Negative / cost:** AssemblyAI Universal-3 Pro Medical is a paid API; per-minute cost flows into per-tenant billing. Over-bleep degrades caller intelligibility on recorded playback (operator note review). Manual QA is real headcount.
- **Neutral:** Threshold tuning is an ongoing operations task, not a one-time decision.

## Evidence

Pending PoT spike S4 — see [`pot/S4-redaction-accuracy/results/`](../../pot/S4-redaction-accuracy/results/). Target signal: recall ≥ 95% on 90 planted PII spans across 30 fixtures, F1 ≥ 0.92, mean over-bleep ≤ 1.5 s, manual-QA backlog ≤ 2% of spans.

## Alternatives considered

- **Single-pass ASR-bleep only.** Documented to miss digit-by-digit numbers and accented speakers. Rejected: insufficient for HIPAA medical workloads.
- **Delegated capture via Telnyx Pay / Stripe terminal for the entire call.** Works for PCI but not HIPAA — PHI conversation can't be routed to a third-party IVR. Adopted as the PCI-only path for the card-entry segment (see compliance-posture memory); not a general redaction substitute.
- **Disable recording for HIPAA tenants.** Removes the operator-quality and dispute-resolution use cases entirely. Rejected: would close off the medical answering service vertical, the largest target market.
```

- [ ] **Step 4: Write `docs/adr/0015-temporal-cloud-tier.md`**

```markdown
# ADR-0015: Temporal Cloud Enterprise tier with EU namespace

- **Status:** Proposed
- **Date:** 2026-05-12
- **Deciders:** Compliance lead, Backend lead
- **Consulted:** Senior architect, Security eng
- **Informed:** Platform team

## Context

Long-running orchestrations (call retry/escalation chains, scheduled callbacks, reminder workflows, multi-step compliance pipelines) need a durable workflow engine. The architecture chose Temporal as the workflow runtime (ARCH v0.4 §6). Two operating-model questions then arise: hosted (Temporal Cloud) vs self-hosted, and — if hosted — does the EU-namespace metadata stay in the EU?

HIPAA requires a signed BAA with any subprocessor that touches PHI metadata. GDPR requires that EU-tenant workflow metadata (Search Attributes, workflow inputs) not egress to a US control plane. Temporal Cloud Enterprise tier markets BAA + EU residency, but the Search Attribute behaviour at the namespace level is not in public docs.

## Decision

Default to **Temporal Cloud Enterprise tier with an EU namespace** for EU tenants and a US namespace for US tenants. Sales-letter confirmation of (a) BAA availability and (b) EU-namespace metadata residency is a prerequisite.

If sales declines the BAA or cannot confirm EU metadata residency, fall back to **self-hosted Temporal via the v1.0.0 Helm chart on EU-residency Kubernetes**. The application-layer Temporal SDK code is identical either way; only the connection string changes.

## Consequences

- **Positive:** Hosted Temporal removes a high-skill operational burden (Cassandra/PostgreSQL backing store, history-shard tuning, frontend scaling). Enterprise tier provides 99.9% SLA and direct support.
- **Negative / cost:** Per-action billing; cost grows with workflow volume. Vendor lock-in at the operations layer (mitigated by SDK portability).
- **Neutral:** EU vs US namespace doubles the operational surface (two control planes to monitor) but is required by GDPR regardless.

## Evidence

Pending PoT spike S7 — see [`pot/S7-temporal-baa/results/`](../../pot/S7-temporal-baa/results/). Target signal: signed sales letter attached confirming BAA terms + EU-namespace metadata residency. If Red, this ADR's Decision section flips to the self-hosted path before Sprint 0 closes.

## Alternatives considered

- **Self-hosted from day one.** Removes vendor risk but adds 0.5–1 FTE of platform-engineering load on day one. Rejected as MVP default — kept as the documented Yellow/Red fallback.
- **Different workflow engine (Cadence, Argo Workflows, AWS Step Functions).** Cadence is Temporal's predecessor — strictly inferior. Argo is K8s-native but lacks Temporal's signal/query/timer primitives that compliance retry chains need. Step Functions is AWS-only and breaks the cloud-portability principle (P9). Rejected.
- **No workflow engine — bespoke retry tables in PostgreSQL.** Rejected on past-team experience: bespoke implementations re-derive Temporal poorly and become the bug source.
```

- [ ] **Step 5: Write `docs/adr/0016-ari-leader-design.md`**

```markdown
# ADR-0016: ARI leader 100 ms hard-stop heartbeat

- **Status:** Proposed
- **Date:** 2026-05-12
- **Deciders:** Telephony lead, Backend lead
- **Consulted:** SRE, Senior architect
- **Informed:** Platform team

## Context

Asterisk's ARI (Asterisk REST Interface) Stasis app model assumes one WebSocket consumer per Asterisk instance per Stasis app. If two NestJS instances both subscribe to the same Stasis app on the same Asterisk, channel-event delivery becomes non-deterministic (Asterisk fan-outs but app state assumes single ownership). Multi-instance NestJS with Asterisk requires a leader election: one NestJS holds the WS, others stand by.

The risk: a leader that pauses (long GC, kernel scheduling, Redis stall) for >100 ms while still holding its WS produces a window where channel events arrive but no business logic acts on them — calls hang, retries don't fire, the user hears silence. The leader must hard-stop its WS within 100 ms of detecting a missed heartbeat, freeing the standby to pick up.

## Decision

Implement leader election with a Redis-held lease + 100 ms hard-stop:

1. Each NestJS instance attempts `SET pot:ari-leader:<asterisk-id> <instance-id> NX PX 1000` once per second.
2. Holder maintains `EXPIRE` to 1 s on every heartbeat.
3. If a heartbeat fails or returns "lost lease," the holder closes its ARI WS within 100 ms (`process.nextTick` after the failure callback, no awaiting outstanding handlers).
4. Replacement leader observes the missing key on its next heartbeat (1 s window) and opens its own WS.
5. Asterisk's `WebSocketEvent` log records the close at the Asterisk side; tcpdump confirms FIN within 100 ms of the simulated leader pause.

Total worst-case unmanaged-event window: 1.1 s (1 s detection + 100 ms close + new leader's WS handshake). For our call volume this is acceptable; tighter windows require Asterisk-side leader awareness which doesn't exist.

## Consequences

- **Positive:** Deterministic leader transfer. Bounded event-loss window. No Asterisk modifications required.
- **Negative / cost:** Adds a Redis dependency to every Asterisk leader/standby NestJS instance. Network partitions between NestJS and Redis cause split-brain; mitigated by Asterisk only accepting one WS per Stasis app (the second connection rejects).
- **Neutral:** 100 ms is a soft target — measurement may show 80 ms is achievable, or 150 ms is necessary. Spike tunes the actual number before the ADR moves to Accepted.

## Evidence

Pending PoT spike S3 — see [`pot/S3-ari-leader-hard-stop/results/`](../../pot/S3-ari-leader-hard-stop/results/). Target signal: chaos-paused leader observed close WS within 100 ms via Asterisk WebSocketEvent log + tcpdump; replacement leader closes orphaned channels within 7 s.

## Alternatives considered

- **Asterisk-side leader awareness.** Doesn't exist in Asterisk 22.x ARI. Would require core patch. Rejected.
- **Redis Sentinel / Redlock for leader election instead of single-key lease.** Stronger split-brain guarantees but adds operational complexity disproportionate to the call-event durability requirement. Rejected: single-key lease is sufficient given Asterisk's one-WS-per-app constraint.
- **No leader — multiple WS subscribers, deduplicate at NestJS.** Asterisk doesn't fan out events to multiple WS for the same Stasis app reliably; the receive-side dedup design is fragile. Rejected.
```

- [ ] **Step 6: Write `docs/adr/0018-supavisor-pooling.md`**

```markdown
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
```

- [ ] **Step 7: Write `docs/adr/0019-caddy-le-posture.md`**

```markdown
# ADR-0019: Caddy 2.10+ on-demand TLS posture + LE rate-limit exemption

- **Status:** Proposed
- **Date:** 2026-05-12
- **Deciders:** SRE
- **Consulted:** Senior architect, Security eng
- **Informed:** Platform team

## Context

Multi-tenant SaaS that supports tenant-custom domains (e.g., `support.acme.com` CNAMEd to our edge) needs on-demand TLS issuance — Caddy's `on_demand_tls` is the standard mechanism. Two known failure modes:

1. **certmagic #174** — Caddy can hit the storage backend on every request for declined domains, effectively self-DDoSing storage when scanned by SNI probes. Mitigation requires the `permission http` endpoint to be checked **before** the storage lookup; whether that ordering holds in all Caddy versions/configurations is community-debated.
2. **Let's Encrypt rate limits** — the public ACME endpoint enforces 50 certificates per registered domain per week and 300 new orders per account per 3 h. A SaaS at scale exceeds these; ISRG offers a rate-limit exemption application with a 2–4 week turnaround.

RISKS v0.2 §4 flags both. Either failure can degrade the entire tenant-domain feature, or worse, take the edge offline.

## Decision

1. Run **Caddy 2.10+** with `on_demand_tls.ask` pointing at our `permission http` endpoint. The endpoint returns 200 only for tenant-confirmed domains; everything else gets 403, which Caddy LRU-caches as declined.
2. Front Caddy with **HAProxy 3.0** rate-limiting unknown SNI to 1k/sec/source — trips before storage thrash even if Caddy LRU misses.
3. Submit the ISRG rate-limit exemption application before Sprint 8 (when custom domains first ship). 2–4 week turnaround is acceptable.

## Consequences

- **Positive:** Defence in depth — three independent layers (HAProxy rate limit, Caddy LRU, ISRG exemption) each fail independently. Custom-domain feature ships unblocked.
- **Negative / cost:** HAProxy adds another network hop. Tuning the LRU + permission cache requires monitoring. ISRG exemption requires writing a defensible production-volume justification.
- **Neutral:** Caddy 2.10+ is the current stable; pinning is conservative.

## Evidence

Pending PoT spike S8 — see [`pot/S8-caddy-le-posture/results/`](../../pot/S8-caddy-le-posture/results/). Target signal: 1 k unknown-SNI probes/sec sustained for 10 min keeps Caddy storage RPS under 50/sec; HAProxy trips before Caddy. Separately: ISRG exemption form submitted with receipt attached.

## Alternatives considered

- **Disable on-demand TLS — require tenants to upload their own certs.** Operationally hostile; loses competitive parity with Cloudflare/Vercel. Rejected.
- **Use a managed TLS provider (Cloudflare for SaaS).** Vendor lock-in to Cloudflare; per-domain pricing at scale exceeds Caddy + LE cost. Kept as a v2 escape hatch, not MVP.
- **Wildcard certs only.** Doesn't solve tenant-custom-domain (which is the whole point). Rejected.
```

- [ ] **Step 8: Write `docs/adr/0024-queue-dequeue-budget.md`**

```markdown
# ADR-0024: Queue dequeue latency budget = 200 ms p95 (NestJS-arbitrated)

- **Status:** Proposed
- **Date:** 2026-05-12
- **Deciders:** Backend lead, Telephony lead
- **Consulted:** Senior architect, Product
- **Informed:** All MVP engineers

## Context

PRD v2 §5.3.5 requires queue routing strategies beyond Asterisk's built-in `Queue()`: priority queues, sticky-last-operator, longest-idle, skill-based. Implementing these in Asterisk dialplan is awkward; doing them in NestJS keeps the strategy code testable and changeable without restarting Asterisk. The cost is added latency: NestJS arbitrates the dequeue (operator-WS `accept` → resolve waiting caller → ARI `Bridge` → operator-WS `ring`), and that round-trip must stay under a budget the user perceives as snappy.

FR-Q10 in the PRD asserts "p95 ringing latency ≤ 200 ms from accept to ring" but flags it as unproven. ARCH v0.4 §9 ratifies the 200 ms target subject to PoT measurement.

## Decision

The queue dequeue path stays in NestJS for all strategies (FIFO, priority, sticky-last-operator, longest-idle, skills). Architecture:

- Per-queue priority heap held in-memory in the NestJS shard that owns the queue (sticky-hash on `queue_id`).
- Redis stores only the cross-shard ownership lock + a recovery snapshot every 5 s.
- NATS notifies eligible-operator WS gateways on heap changes.

Latency budget: **p95 ≤ 200 ms** from operator-WS `accept` to operator-WS `ring`, measured under 200-caller MOH load.

If PoT S2 shows the budget is unmet, **fall back to Asterisk `Queue()` for FIFO-only queues**. NestJS handles only the priority/sticky/skills variants where the strategy logic justifies the latency.

## Consequences

- **Positive:** All strategies implemented in one place (TypeScript) with consistent test coverage. Strategy changes don't require Asterisk restart.
- **Negative / cost:** NestJS becomes a hard dependency on the call-routing critical path; a NestJS outage means new calls don't get routed. Mitigated by N+1 NestJS shards behind a load balancer.
- **Neutral:** 200 ms is a perceptual budget, not a physical one — operator humans perceive <300 ms as instant; PoT measures the actual.

## Evidence

Pending PoT spike S2 — see [`pot/S2-queue-dequeue-latency/results/`](../../pot/S2-queue-dequeue-latency/results/). Target signal: SIPp drives 200 callers into a single Queue; NestJS dequeue → ARI `Bridge` → operator-WS `ring` p95 ≤ 200 ms over a 10-minute window. Failure modes (Redis lock contention, NATS lag) explicitly probed.

## Alternatives considered

- **Asterisk `Queue()` for everything.** Loses priority and skills routing. Rejected: PRD requires those.
- **Tighter budget (100 ms p95).** Below the wire-time floor for the Redis + NATS round-trip. Rejected as physically optimistic.
- **Queue logic in Kamailio.** Kamailio is signalling-plane only; doesn't have call-state to know which operators are eligible. Rejected.
```

- [ ] **Step 9: Verify all ADR files exist and parse as Markdown**

Run:
```bash
ls docs/adr/
```
Expected: 8 files: `README.md`, `template.md`, `0013-redaction-pipeline.md`, `0015-temporal-cloud-tier.md`, `0016-ari-leader-design.md`, `0018-supavisor-pooling.md`, `0019-caddy-le-posture.md`, `0024-queue-dequeue-budget.md`.

Run:
```bash
for f in docs/adr/00*.md; do head -5 "$f" | grep -q "^# ADR-" && echo "OK: $f" || echo "FAIL: $f"; done
```
Expected: 6 lines, all `OK: ...`.

- [ ] **Step 10: Commit**

```bash
git add docs/adr/
git commit -m "$(cat <<'EOF'
docs(adr): seed PoT-validated ADRs (0013, 0015, 0016, 0018, 0019, 0024)

MADR 4.0 lite template + index + 6 ADRs at Proposed status with
evidence pending PoT S2/S3/S4/S5/S7/S8. Other 24 Sprint-0 ADRs
land later.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: PoT program scaffold (`pot/README.md`, `pot/Makefile`, `pot/pot-readout.md`)

**Files:**
- Create: `pot/README.md`
- Create: `pot/Makefile`
- Create: `pot/pot-readout.md`

- [ ] **Step 1: Write `pot/README.md`**

```markdown
# Phase 0 — Proof of Technology

Eight throwaway spikes that kill the load-bearing unknowns from RISKS v0.2 before MVP construction starts. Source: [ARCHITECTURE.v0.4 §2](../ARCHITECTURE.v0.4.md). Spike code is throwaway; only fixtures, scripts, and ADR evidence carry forward.

## Phase context

```
PHASE 0 — PROOF OF TECHNOLOGY        4–6 weeks
  └─ Exit gate G0: every spike Green or accepted-Yellow
        ↓
PHASE 1 — SPRINT 0 (ADR ratification)   2–3 weeks (overlaps PoT)
  └─ Exit gate G1: 30 ADRs merged + 2 external sign-offs
        ↓
PHASE 2 — MVP BUILD                    9–11 months
```

## The 8 spikes

| # | Spike | Owner role | Compose | Status |
|---|---|---|---|---|
| [S1](./S1-telephony-happy-path/) | End-to-end telephony happy path | Telephony eng | runnable | Not started |
| [S2](./S2-queue-dequeue-latency/) | NestJS-arbitrated queue dequeue latency | Telephony + backend | runnable | Not started |
| [S3](./S3-ari-leader-hard-stop/) | ARI leader 100 ms hard-stop | Telephony eng | runnable | Not started |
| [S4](./S4-redaction-accuracy/) | Two-pass redaction accuracy on 8 kHz μ-law | Backend + compliance | stub | Not started |
| [S5](./S5-supavisor-set-local/) | Supavisor `SET LOCAL` parity | SRE | runnable | Not started |
| [S6](./S6-ncall-fixture-capture/) | `/v1` byte-for-byte fixture capture | Compliance + backend | stub | Not started |
| [S7](./S7-temporal-baa/) | Temporal Cloud BAA + EU namespace | Compliance | stub | Not started |
| [S8](./S8-caddy-le-posture/) | Caddy 2.10+ permission + LE rate-limit | SRE | runnable | Not started |

Update the **Status** column inline as spikes execute. Statuses: Not started · In progress · Green · Yellow · Red.

## Running a spike (human)

```bash
cd pot/S<N>-<slug>
cat README.md       # confirm prereqs
make up             # boot the spike's stack
make test           # run the measurement harness
make snapshot-results
make teardown
```

Then update the matching `pot-readout.md` section with status, result paragraph, and evidence path.

## Running a spike (LLM agent)

1. Read `pot/S<N>-<slug>/README.md` end-to-end.
2. Verify all prereqs in §Prereqs are satisfied. Stop and ask the user if any external dep is missing.
3. Follow `runbook.md` step by step.
4. After `make snapshot-results`, write the `pot-readout.md` section as evidence, then propose a status (Green/Yellow/Red) for the user to confirm.

## Exit gate G0

(Quoted from ARCH v0.4 §2.4.)

- All 8 spikes Green, **or** any Yellow has a written remediation plan signed by the senior architect + the spike's owner + the on-call compliance lead. **Red blocks MVP kickoff.**
- The 8 spike directories are tagged `pot/<spike>` in git for forensic reference and then deleted from `main` (their fixtures and ADR evidence carry forward).
- `pot/pot-readout.md` committed with one paragraph per spike + measurement traces.

## Cross-references

- [ARCHITECTURE.v0.4 §2](../ARCHITECTURE.v0.4.md) — full PoT spec.
- [RISKS.v0.2.md](../RISKS.v0.2.md) — what each spike is killing.
- [docs/adr/](../docs/adr/) — the ADRs PoT evidence flows into.
```

- [ ] **Step 2: Write `pot/Makefile`**

```make
# PoT dispatcher — forwards per-spike targets to each spike's Makefile.
# Usage: make help · make status · make up-S5-supavisor-set-local · make test-S5-supavisor-set-local

SPIKES := S1-telephony-happy-path \
          S2-queue-dequeue-latency \
          S3-ari-leader-hard-stop \
          S4-redaction-accuracy \
          S5-supavisor-set-local \
          S6-ncall-fixture-capture \
          S7-temporal-baa \
          S8-caddy-le-posture

ACTIONS := up test teardown snapshot-results status

.PHONY: help status all-targets $(foreach a,$(ACTIONS),$(addprefix $(a)-,$(SPIKES)))

help:
	@echo "PoT spike dispatcher"
	@echo ""
	@echo "Per-spike targets (replace <spike> with one of):"
	@for s in $(SPIKES); do echo "  $$s"; done
	@echo ""
	@echo "Actions:"
	@for a in $(ACTIONS); do echo "  make $$a-<spike>"; done
	@echo ""
	@echo "Aggregate:"
	@echo "  make status            # show ps + results dir for all spikes"
	@echo "  make all-targets       # list every dispatch target"

status:
	@for s in $(SPIKES); do \
	  echo "=== $$s ==="; \
	  $(MAKE) -C $$s status 2>/dev/null || echo "  (no Makefile or not booted)"; \
	done

all-targets:
	@for a in $(ACTIONS); do for s in $(SPIKES); do echo "$$a-$$s"; done; done

# Pattern targets: forward to per-spike Makefile.
$(foreach a,$(ACTIONS),$(eval $(a)-%: ; @$$(MAKE) -C $$* $(a)))
```

- [ ] **Step 3: Verify Makefile dispatcher lists 40 targets**

Run:
```bash
make -C pot all-targets | wc -l
```
Expected: `40` (5 actions × 8 spikes).

Run:
```bash
make -C pot help
```
Expected: prints help text listing the 8 spikes and 5 actions.

(Note: `up-S5-supavisor-set-local` etc. will fail to actually execute until task 7 lands the per-spike Makefile. Dispatcher syntax is what we verify here.)

- [ ] **Step 4: Write `pot/pot-readout.md`**

```markdown
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

- **Status:** Not started
- **Run dates:** —
- **Owner:** —
- **Result:** —
- **Evidence:** `pot/S5-supavisor-set-local/results/`
- **ADR(s) updated:** ADR-0018

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
```

- [ ] **Step 5: Commit**

```bash
git add pot/README.md pot/Makefile pot/pot-readout.md
git commit -m "$(cat <<'EOF'
chore(pot): add program README, Makefile dispatcher, readout skeleton

Dispatcher routes 5 actions × 8 spikes = 40 targets to per-spike
Makefiles. Readout is the G0 sign-off artefact.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: S1 — telephony happy path (runnable)

**Files:**
- Create: `pot/S1-telephony-happy-path/README.md`
- Create: `pot/S1-telephony-happy-path/runbook.md`
- Create: `pot/S1-telephony-happy-path/docker-compose.yml`
- Create: `pot/S1-telephony-happy-path/Makefile`
- Create: `pot/S1-telephony-happy-path/.gitignore`
- Create: `pot/S1-telephony-happy-path/fixtures/.gitkeep`
- Create: `pot/S1-telephony-happy-path/results/.gitkeep`

- [ ] **Step 1: Write `pot/S1-telephony-happy-path/README.md`**

```markdown
# S1 — End-to-end telephony happy path

## Hypothesis

Kamailio dispatcher + rtpengine + Asterisk 22.9 LTS + ARI Outbound WS sustains a single registered softphone call through a Kamailio fail-over.

## Go/no-go signal

- **Green:** New INVITEs route to a healthy Kamailio node within 30 s of primary kill; in-flight call on the failed node drops cleanly (no zombie channels in `ARI GET /channels` after 60 s reconciliation). p95 screen-pop ≤ 800 ms at idle.
- **Yellow:** Failover works but reconciliation takes 60–120 s, or one of the metrics is borderline. Document remediation in `results/yellow-remediation.md`.
- **Red:** Failover drops calls, leaves zombie channels, or screen-pop p95 > 1500 ms. Architecture renegotiation required.

## Owner role

Telephony engineer.

## Prereqs

- Docker 24+, Docker Compose v2.
- Host RAM ≥ 8 GB free (rtpengine kernel module is not loaded — userspace mode is fine for PoT).
- Linux host preferred (rtpengine `--no-fallback` works best on Linux). macOS works but media performance is degraded.
- No external accounts required.

## Runbook

```
make up && make test && make snapshot-results
```

Step-by-step in [`runbook.md`](./runbook.md).

## Recording protocol

`results/<timestamp>/` contains:
- `failover-trace.txt` — `kamailio.log` + `asterisk.log` covering the kill window
- `screen-pop-latency.csv` — 100 calls × (call_id, invite_received_ms, channel_event_to_ari_ms)
- `channels-after-60s.json` — output of `ari curl GET /channels` 60 s post-failover
- `summary.md` — one paragraph per metric

## Yellow remediation

Per ARCH v0.4 §2.3: extend reconciliation window to match measured value, document in summary, propose ADR amendment to the leader-election design (ADR-0016) if reconciliation > 90 s.

## ADR linkage

Evidence flows into [ADR-0016 (ARI leader hard-stop)](../../docs/adr/0016-ari-leader-design.md) for the channel-reconciliation parameter.
```

- [ ] **Step 2: Write `pot/S1-telephony-happy-path/runbook.md`**

```markdown
# S1 Runbook

## Setup

```
make up
```

Boots: 2× kamailio (primary + standby), rtpengine, asterisk, baresip softphone client.

Wait for `make status` to show all 5 containers healthy. Asterisk takes ~20 s to fully load PJSIP realtime.

## Test phase 1: register softphone

The baresip container auto-registers `1001@local` against the kamailio dispatcher VIP at startup. Verify:

```
docker compose logs baresip | grep -i registered
```

Expected: `1001@local: registered`.

## Test phase 2: place an outbound call to the loopback echo extension

```
docker compose exec baresip baresip -e "/dial 9999"
```

`9999` is configured in fixtures/asterisk/extensions.conf as an Echo() loop. The call should connect within 2 s and you should see media flowing in `docker compose logs rtpengine`.

## Test phase 3: simulated kamailio primary kill

While the call is live:

```
docker compose pause kamailio-primary
```

Place a NEW outbound call from baresip:

```
docker compose exec baresip baresip -e "/dial 9999"
```

Record the time-to-200-OK. Expected: ≤ 30 s.

The original in-flight call: observe whether it drops cleanly (BYE within 60 s) or leaves a zombie channel:

```
sleep 60
docker compose exec asterisk asterisk -rx 'core show channels'
```

Expected: 0 channels (the zombie is the failure case).

## Test phase 4: screen-pop latency

Loop 100 calls through phase 2 (with kamailio healthy), measuring INVITE-received-at-asterisk → StasisStart-event-to-ari-app:

```
docker compose exec asterisk /scripts/screen-pop-loop.sh 100 > results/screen-pop-latency.csv
```

(Script lives in `fixtures/asterisk/scripts/` — write at execution time, not scaffold time.)

## Snapshot

```
make snapshot-results
```

Copies all relevant logs and the CSV into `results/<timestamp>/`.

## Teardown

```
make teardown
```
```

- [ ] **Step 3: Write `pot/S1-telephony-happy-path/docker-compose.yml`**

```yaml
# S1 — telephony happy path. Boots Kamailio HA pair + rtpengine + Asterisk + baresip softphone.
# Image versions match ARCHITECTURE.v0.4 §6 and S1 hypothesis (Asterisk 22.9 LTS, Kamailio 6.0).

services:
  rtpengine:
    image: drachtio/rtpengine:mr12
    network_mode: host
    command: >
      --interface=127.0.0.1
      --listen-ng=127.0.0.1:2223
      --port-min=30000 --port-max=30100
      --no-fallback
    healthcheck:
      test: ["CMD", "pgrep", "rtpengine"]
      interval: 5s
      timeout: 2s
      retries: 5

  kamailio-primary:
    image: ghcr.io/kamailio/kamailio:6.0.0-alpine
    depends_on:
      rtpengine:
        condition: service_healthy
    volumes:
      - ./fixtures/kamailio/kamailio.cfg:/etc/kamailio/kamailio.cfg:ro
      - ./fixtures/kamailio/dispatcher.list:/etc/kamailio/dispatcher.list:ro
    ports:
      - "5060:5060/udp"
      - "5060:5060/tcp"
    healthcheck:
      test: ["CMD", "kamcmd", "core.uptime"]
      interval: 5s
      timeout: 2s
      retries: 5

  kamailio-standby:
    image: ghcr.io/kamailio/kamailio:6.0.0-alpine
    depends_on:
      rtpengine:
        condition: service_healthy
    volumes:
      - ./fixtures/kamailio/kamailio.cfg:/etc/kamailio/kamailio.cfg:ro
      - ./fixtures/kamailio/dispatcher.list:/etc/kamailio/dispatcher.list:ro
    ports:
      - "5061:5060/udp"
      - "5061:5060/tcp"

  asterisk:
    image: andrius/asterisk:22.9-current
    depends_on:
      - kamailio-primary
    volumes:
      - ./fixtures/asterisk:/etc/asterisk:ro
    ports:
      - "8088:8088"  # ARI HTTP
    healthcheck:
      test: ["CMD-SHELL", "asterisk -rx 'core show uptime' | grep -q 'System uptime'"]
      interval: 10s
      timeout: 3s
      retries: 6

  baresip:
    image: ghcr.io/baresip/baresip:latest
    depends_on:
      asterisk:
        condition: service_healthy
    volumes:
      - ./fixtures/baresip:/root/.baresip:ro
    command: ["-f", "/root/.baresip"]
```

- [ ] **Step 4: Write `pot/S1-telephony-happy-path/Makefile`**

```make
# S1 — telephony happy path
.PHONY: up test teardown snapshot-results status

TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

up:
	docker compose up -d
	@echo "Waiting for healthchecks..."
	@for i in $$(seq 1 30); do \
	  if docker compose ps --format json | grep -q '"Health":"unhealthy"'; then \
	    sleep 2; \
	  else break; fi; \
	done
	docker compose ps

test:
	@echo "S1 test harness: see runbook.md — execute phases 1-4 manually for now."
	@echo "Spike-execution time will replace this with an automated driver."
	@false

teardown:
	docker compose down -v

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	docker compose logs > results/$(TIMESTAMP)/all-logs.txt 2>&1
	docker compose ps --format json > results/$(TIMESTAMP)/ps.json
	@echo "Snapshot at results/$(TIMESTAMP)/"

status:
	@docker compose ps
	@echo "---"
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
```

- [ ] **Step 5: Write `pot/S1-telephony-happy-path/.gitignore`**

```gitignore
results/*
!results/.gitkeep
```

- [ ] **Step 6: Create empty placeholders**

Run:
```bash
mkdir -p pot/S1-telephony-happy-path/fixtures pot/S1-telephony-happy-path/results
touch pot/S1-telephony-happy-path/fixtures/.gitkeep pot/S1-telephony-happy-path/results/.gitkeep
```

- [ ] **Step 7: Validate compose**

Run:
```bash
docker compose -f pot/S1-telephony-happy-path/docker-compose.yml config -q
```
Expected: exits 0, no output.

- [ ] **Step 8: Commit**

```bash
git add pot/S1-telephony-happy-path/
git commit -m "$(cat <<'EOF'
chore(pot): scaffold S1 telephony happy path spike

Boots Kamailio 6.0 HA pair + rtpengine mr12 + Asterisk 22.9 + baresip.
Compose validates; runbook documents the 4-phase failover test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: S2 — queue dequeue latency (runnable, with NestJS arbiter Dockerfile)

**Files:**
- Create: `pot/S2-queue-dequeue-latency/README.md`
- Create: `pot/S2-queue-dequeue-latency/runbook.md`
- Create: `pot/S2-queue-dequeue-latency/docker-compose.yml`
- Create: `pot/S2-queue-dequeue-latency/arbiter/Dockerfile`
- Create: `pot/S2-queue-dequeue-latency/arbiter/package.json`
- Create: `pot/S2-queue-dequeue-latency/arbiter/index.js`
- Create: `pot/S2-queue-dequeue-latency/Makefile`
- Create: `pot/S2-queue-dequeue-latency/.gitignore`
- Create: `pot/S2-queue-dequeue-latency/fixtures/.gitkeep`
- Create: `pot/S2-queue-dequeue-latency/results/.gitkeep`

- [ ] **Step 1: Write `pot/S2-queue-dequeue-latency/README.md`**

```markdown
# S2 — NestJS-arbitrated queue dequeue latency

## Hypothesis

NestJS holding 200 callers in MOH bridges and dequeueing on operator-accept stays under 200 ms p95 ringing latency (FR-Q10 risk).

## Go/no-go signal

- **Green:** SIPp drives 200 callers into a single Queue; NestJS dequeue → ARI `Bridge` → operator-WS `ring` event p95 ≤ 200 ms over a 10-minute window. Failure modes (Redis lock contention, NATS lag) explicitly probed and stay within budget.
- **Yellow:** p95 200–300 ms; FIFO-only fallback to Asterisk `Queue()` accepted for FIFO workloads, NestJS handles only priority/sticky/skills.
- **Red:** p95 > 300 ms or Redis/NATS contention dominates. ADR-0024 wording renegotiated before MVP.

## Owner role

Telephony engineer + backend engineer.

## Prereqs

- Docker 24+, Docker Compose v2.
- Host: 4 cores, 8 GB RAM minimum (200 MOH bridges + SIPp + NestJS is non-trivial).
- SIPp 3.7 (image used directly from Compose).
- No external accounts.

## Runbook

```
make up && make test && make snapshot-results
```

Step-by-step in [`runbook.md`](./runbook.md).

## Recording protocol

`results/<timestamp>/`:
- `dequeue-latency.csv` — per-call: caller_id, enqueued_at_ms, accept_received_at_ms, ring_emitted_at_ms, dequeue_latency_ms
- `redis-lock-contention.txt` — Redis `INFO commandstats` snapshots at minute 0, 5, 10
- `nats-lag.txt` — NATS `varz`/`connz` snapshots at the same intervals
- `summary.md` — p50/p95/p99 + failure-mode notes

## Yellow remediation

Per ADR-0024: fall back to Asterisk `Queue()` for FIFO-only queues; NestJS handles priority/sticky/skills variants only. Document the breakdown in `summary.md`.

## ADR linkage

Evidence flows into [ADR-0024 (queue dequeue budget)](../../docs/adr/0024-queue-dequeue-budget.md) — primary signal for moving status from Proposed to Accepted.

The NestJS arbiter container in `arbiter/` is a **PoT-only stub** — minimal heap + NATS publish + ARI bridge call, not the production M30 module. Do not carry it forward into Sprint 1.
```

- [ ] **Step 2: Write `pot/S2-queue-dequeue-latency/runbook.md`**

```markdown
# S2 Runbook

## Setup

```
make up
```

Boots: postgres:17, redis:7, nats:2.10, asterisk (extends from S1's), nestjs-arbiter (built from `arbiter/`), sipp (driver, runs on demand).

## Test

The full test takes ~12 minutes (10 minutes of load + setup/teardown).

```
make test
```

What `make test` does:
1. Resets Redis + NATS state.
2. Starts the `arbiter` consuming Asterisk Stasis events.
3. Launches a SIPp scenario from `fixtures/sipp/200-callers.xml` that establishes 200 INVITEs over 30 s.
4. Launches a synthetic operator simulator that emits `accept` to the arbiter at 10 calls/sec.
5. Records per-call timing into `results/dequeue-latency.csv`.
6. Snapshots Redis `INFO commandstats` and NATS `varz` at minute 0, 5, 10.

## Failure mode probes

Run these after the main test (separate `make test-redis-contention` and `make test-nats-lag` targets — write at spike-execution time):

- Throttle Redis with `tc qdisc add dev eth0 root netem delay 50ms`. Re-run for 1 min. Record latency delta.
- Add NATS jetstream lag with a deliberately slow consumer. Record delta.

## Snapshot

```
make snapshot-results
```

## Teardown

```
make teardown
```
```

- [ ] **Step 3: Write `pot/S2-queue-dequeue-latency/docker-compose.yml`**

```yaml
# S2 — queue dequeue latency. Boots Postgres + Redis + NATS + minimal NestJS arbiter + Asterisk.

services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_PASSWORD: pot
      POSTGRES_DB: pot
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 2s
      retries: 5

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 2s
      retries: 5

  nats:
    image: nats:2.10-alpine
    command: ["-js", "-m", "8222"]
    ports:
      - "8222:8222"  # monitoring
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "-", "http://localhost:8222/healthz"]
      interval: 5s
      timeout: 2s
      retries: 5

  asterisk:
    image: andrius/asterisk:22.9-current
    volumes:
      - ./fixtures/asterisk:/etc/asterisk:ro
    ports:
      - "8088:8088"
      - "5060:5060/udp"
    healthcheck:
      test: ["CMD-SHELL", "asterisk -rx 'core show uptime' | grep -q 'System uptime'"]
      interval: 10s
      timeout: 3s
      retries: 6

  arbiter:
    build: ./arbiter
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      nats:
        condition: service_healthy
      asterisk:
        condition: service_healthy
    environment:
      REDIS_URL: redis://redis:6379
      NATS_URL: nats://nats:4222
      ARI_URL: http://asterisk:8088/ari
      ARI_USER: pot
      ARI_PASS: pot
      ARI_APP: pot-queue
    ports:
      - "3000:3000"  # operator WS

  sipp:
    image: ctaloi/sipp:3.7
    profiles: ["driver"]   # only runs when explicitly invoked
    depends_on:
      - asterisk
    volumes:
      - ./fixtures/sipp:/sipp:ro
```

- [ ] **Step 4: Write `pot/S2-queue-dequeue-latency/arbiter/package.json`**

```json
{
  "name": "pot-s2-arbiter",
  "version": "0.0.1",
  "private": true,
  "description": "PoT-only NestJS-arbiter stub. Throwaway. Do not carry into Sprint 1.",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "ari-client": "^2.2.0",
    "ioredis": "^5.4.1",
    "nats": "^2.28.0",
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 5: Write `pot/S2-queue-dequeue-latency/arbiter/index.js`**

```javascript
// PoT S2 arbiter stub. Minimal heap + ARI bridge + operator-WS ring emit.
// Throwaway by design — production M30 is rewritten test-first in Sprint 1.

const ari = require('ari-client');
const Redis = require('ioredis');
const { connect: natsConnect } = require('nats');
const { WebSocketServer } = require('ws');

const REDIS_URL = process.env.REDIS_URL;
const NATS_URL = process.env.NATS_URL;
const ARI_URL = process.env.ARI_URL;
const ARI_USER = process.env.ARI_USER;
const ARI_PASS = process.env.ARI_PASS;
const ARI_APP = process.env.ARI_APP;

const waiting = []; // [{ channelId, enqueuedAt }]
const operators = new Map(); // operatorId -> ws
const traceLog = [];

async function main() {
  const redis = new Redis(REDIS_URL);
  const nats = await natsConnect({ servers: NATS_URL });
  const client = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);

  client.on('StasisStart', (event, channel) => {
    const enqueuedAt = Date.now();
    waiting.push({ channelId: channel.id, enqueuedAt });
    traceLog.push({ event: 'enqueue', channelId: channel.id, ts: enqueuedAt });
  });

  const wss = new WebSocketServer({ port: 3000 });
  wss.on('connection', (ws) => {
    let operatorId;
    ws.on('message', async (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'register') {
        operatorId = msg.operatorId;
        operators.set(operatorId, ws);
      } else if (msg.type === 'accept') {
        const acceptAt = Date.now();
        const callee = waiting.shift();
        if (!callee) return;
        const bridge = await client.bridges.create({ type: 'mixing' });
        await bridge.addChannel({ channel: callee.channelId });
        const ringAt = Date.now();
        ws.send(JSON.stringify({
          type: 'ring',
          channelId: callee.channelId,
          dequeueLatencyMs: ringAt - acceptAt,
          totalWaitMs: ringAt - callee.enqueuedAt,
        }));
        traceLog.push({
          event: 'dequeue',
          channelId: callee.channelId,
          enqueuedAt: callee.enqueuedAt,
          acceptAt,
          ringAt,
          dequeueLatencyMs: ringAt - acceptAt,
        });
      }
    });
    ws.on('close', () => operators.delete(operatorId));
  });

  await client.start(ARI_APP);
  console.log(`arbiter started; ARI app=${ARI_APP}; ws on :3000`);

  process.on('SIGTERM', () => {
    console.log(JSON.stringify(traceLog));
    process.exit(0);
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 6: Write `pot/S2-queue-dequeue-latency/arbiter/Dockerfile`**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
CMD ["node", "index.js"]
```

- [ ] **Step 7: Write `pot/S2-queue-dequeue-latency/Makefile`**

```make
# S2 — queue dequeue latency
.PHONY: up test teardown snapshot-results status

TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

up:
	docker compose up -d --build
	@echo "Waiting for healthchecks..."
	@sleep 15
	docker compose ps

test:
	@echo "S2 test harness: see runbook.md — full driver lands at spike-execution time."
	@echo "Manual smoke: docker compose --profile driver run sipp /usr/bin/sipp -sf /sipp/200-callers.xml asterisk:5060"
	@false

teardown:
	docker compose down -v

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	docker compose logs > results/$(TIMESTAMP)/all-logs.txt 2>&1
	@echo "Snapshot at results/$(TIMESTAMP)/"

status:
	@docker compose ps
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
```

- [ ] **Step 8: Write `pot/S2-queue-dequeue-latency/.gitignore`**

```gitignore
results/*
!results/.gitkeep
arbiter/node_modules/
```

- [ ] **Step 9: Create empty placeholders**

Run:
```bash
mkdir -p pot/S2-queue-dequeue-latency/fixtures pot/S2-queue-dequeue-latency/results
touch pot/S2-queue-dequeue-latency/fixtures/.gitkeep pot/S2-queue-dequeue-latency/results/.gitkeep
```

- [ ] **Step 10: Validate compose**

Run:
```bash
docker compose -f pot/S2-queue-dequeue-latency/docker-compose.yml config -q
```
Expected: exits 0.

- [ ] **Step 11: Commit**

```bash
git add pot/S2-queue-dequeue-latency/
git commit -m "$(cat <<'EOF'
chore(pot): scaffold S2 queue dequeue latency spike

Postgres + Redis + NATS + Asterisk + minimal NestJS arbiter (throwaway).
Compose validates; runbook documents 200-caller load harness.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: S3 — ARI leader hard-stop (runnable)

**Files:**
- Create: `pot/S3-ari-leader-hard-stop/README.md`
- Create: `pot/S3-ari-leader-hard-stop/runbook.md`
- Create: `pot/S3-ari-leader-hard-stop/docker-compose.yml`
- Create: `pot/S3-ari-leader-hard-stop/leader/Dockerfile`
- Create: `pot/S3-ari-leader-hard-stop/leader/package.json`
- Create: `pot/S3-ari-leader-hard-stop/leader/index.js`
- Create: `pot/S3-ari-leader-hard-stop/Makefile`
- Create: `pot/S3-ari-leader-hard-stop/.gitignore`
- Create: `pot/S3-ari-leader-hard-stop/fixtures/.gitkeep`
- Create: `pot/S3-ari-leader-hard-stop/results/.gitkeep`

- [ ] **Step 1: Write `pot/S3-ari-leader-hard-stop/README.md`**

```markdown
# S3 — ARI leader 100 ms hard-stop

## Hypothesis

The ADR-0016 design (close WS within 100 ms of missed Redis heartbeat) is implementable on Asterisk 22.9 LTS with `@ipcom/asterisk-ari` (or equivalent ari-client lib).

## Go/no-go signal

- **Green:** Chaos test pauses leader process for 5 s. WS observed closed at the Asterisk side within 100 ms of heartbeat miss (verified via Asterisk `WebSocketEvent` log + tcpdump). Replacement leader closes orphaned channels within 7 s.
- **Yellow:** Close window 100–250 ms or replacement reconciliation 7–15 s. Document tunable target for the production design.
- **Red:** Close window > 250 ms or replacement leaves channels open > 15 s. ADR-0016 design renegotiated before MVP.

## Owner role

Telephony engineer.

## Prereqs

- Docker 24+, Docker Compose v2.
- Host: 4 GB RAM.
- `tcpdump` available on host (to capture FIN at the Asterisk side).
- No external accounts.

## Runbook

```
make up && make test && make snapshot-results
```

Step-by-step in [`runbook.md`](./runbook.md).

## Recording protocol

`results/<timestamp>/`:
- `pause-trace.pcap` — tcpdump of port 8088 covering the chaos window
- `asterisk-websocket-events.log` — `WebSocketEvent` lines from Asterisk
- `leader-close-latency-ms.txt` — observed time from heartbeat-miss → FIN
- `reconciliation-time-s.txt` — observed time from FIN → orphan channels closed
- `summary.md`

## Yellow remediation

If close window 100–250 ms: tune the heartbeat interval (currently 1 s) downward to 500 ms. Document new total worst-case window (heartbeat-miss + close = ~750 ms) and update ADR-0016 Decision section.

## ADR linkage

Primary evidence for [ADR-0016 (ARI leader hard-stop)](../../docs/adr/0016-ari-leader-design.md). If Red, ADR-0016 Decision section is rewritten before Sprint 0 closes.
```

- [ ] **Step 2: Write `pot/S3-ari-leader-hard-stop/runbook.md`**

```markdown
# S3 Runbook

## Setup

```
make up
```

Boots: asterisk + redis + leader-A + leader-B (both pointing at the same Asterisk Stasis app).

Leader-A acquires the lease first (random startup jitter is unavoidable; if leader-B wins, swap roles in the steps below). Verify:

```
docker compose logs leader-a leader-b | grep -E "(acquired|standby)"
```

## Test phase 1: chaos pause leader-A

Start tcpdump on the Asterisk side:

```
docker compose exec asterisk tcpdump -i any -w /tmp/pause.pcap port 8088 &
TCPDUMP_PID=$!
```

Pause leader-A:

```
docker compose pause leader-a
```

Wait 5 s, then:

```
docker compose unpause leader-a
sleep 2
docker compose exec asterisk pkill tcpdump
docker cp $(docker compose ps -q asterisk):/tmp/pause.pcap results/pause-trace.pcap
```

## Test phase 2: measure close latency

Inspect the pcap for the FIN from Asterisk → leader-A WS. Compare timestamp against the heartbeat-miss event in `docker compose logs leader-a` (the leader logs `heartbeat lost at <ts>`).

Expected: FIN within 100 ms of `heartbeat lost`.

## Test phase 3: measure reconciliation

After the FIN, leader-B should pick up within 1 s and orphan-channel-close within 7 s. Verify:

```
docker compose exec asterisk asterisk -rx 'core show channels'
```

Expected: 0 channels within 7 s of FIN.

## Snapshot

```
make snapshot-results
```

## Teardown

```
make teardown
```
```

- [ ] **Step 3: Write `pot/S3-ari-leader-hard-stop/docker-compose.yml`**

```yaml
# S3 — ARI leader 100 ms hard-stop. Boots Asterisk + Redis + 2 leader stubs.

services:
  asterisk:
    image: andrius/asterisk:22.9-current
    volumes:
      - ./fixtures/asterisk:/etc/asterisk:ro
    ports:
      - "8088:8088"
    healthcheck:
      test: ["CMD-SHELL", "asterisk -rx 'core show uptime' | grep -q 'System uptime'"]
      interval: 10s
      timeout: 3s
      retries: 6

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 2s
      retries: 5

  leader-a:
    build: ./leader
    depends_on:
      asterisk:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      INSTANCE_ID: leader-a
      REDIS_URL: redis://redis:6379
      ARI_URL: http://asterisk:8088/ari
      ARI_USER: pot
      ARI_PASS: pot
      ARI_APP: pot-leader-test
      LEASE_KEY: pot:ari-leader:asterisk-1

  leader-b:
    build: ./leader
    depends_on:
      asterisk:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      INSTANCE_ID: leader-b
      REDIS_URL: redis://redis:6379
      ARI_URL: http://asterisk:8088/ari
      ARI_USER: pot
      ARI_PASS: pot
      ARI_APP: pot-leader-test
      LEASE_KEY: pot:ari-leader:asterisk-1
```

- [ ] **Step 4: Write `pot/S3-ari-leader-hard-stop/leader/package.json`**

```json
{
  "name": "pot-s3-leader",
  "version": "0.0.1",
  "private": true,
  "description": "PoT-only ARI leader stub. Throwaway.",
  "main": "index.js",
  "scripts": { "start": "node index.js" },
  "dependencies": {
    "ari-client": "^2.2.0",
    "ioredis": "^5.4.1"
  }
}
```

- [ ] **Step 5: Write `pot/S3-ari-leader-hard-stop/leader/index.js`**

```javascript
// PoT S3 leader stub. Tries to hold a Redis lease; if held, opens ARI WS.
// On heartbeat loss, closes WS within 100 ms via process.nextTick.

const ari = require('ari-client');
const Redis = require('ioredis');

const INSTANCE_ID = process.env.INSTANCE_ID;
const REDIS_URL = process.env.REDIS_URL;
const ARI_URL = process.env.ARI_URL;
const ARI_USER = process.env.ARI_USER;
const ARI_PASS = process.env.ARI_PASS;
const ARI_APP = process.env.ARI_APP;
const LEASE_KEY = process.env.LEASE_KEY;
const HEARTBEAT_INTERVAL_MS = 1000;
const LEASE_TTL_MS = 1000;

let ariClient = null;
let isLeader = false;
const redis = new Redis(REDIS_URL);

async function tryAcquire() {
  const result = await redis.set(LEASE_KEY, INSTANCE_ID, 'NX', 'PX', LEASE_TTL_MS);
  return result === 'OK';
}

async function renew() {
  const current = await redis.get(LEASE_KEY);
  if (current !== INSTANCE_ID) return false;
  await redis.pexpire(LEASE_KEY, LEASE_TTL_MS);
  return true;
}

async function becomeLeader() {
  if (isLeader) return;
  isLeader = true;
  console.log(JSON.stringify({ instance: INSTANCE_ID, event: 'acquired', ts: Date.now() }));
  ariClient = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);
  await ariClient.start(ARI_APP);
}

function loseLeadership(reason) {
  if (!isLeader) return;
  const ts = Date.now();
  console.log(JSON.stringify({ instance: INSTANCE_ID, event: 'heartbeat lost', reason, ts }));
  isLeader = false;
  process.nextTick(() => {
    if (ariClient) {
      const closeTs = Date.now();
      console.log(JSON.stringify({ instance: INSTANCE_ID, event: 'ws closing', closeTs, deltaMs: closeTs - ts }));
      ariClient.stop();
      ariClient = null;
    }
  });
}

async function heartbeat() {
  try {
    if (isLeader) {
      const ok = await renew();
      if (!ok) loseLeadership('lease lost');
    } else {
      const acquired = await tryAcquire();
      if (acquired) await becomeLeader();
      else console.log(JSON.stringify({ instance: INSTANCE_ID, event: 'standby', ts: Date.now() }));
    }
  } catch (err) {
    loseLeadership(`heartbeat error: ${err.message}`);
  }
}

setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
heartbeat();
```

- [ ] **Step 6: Write `pot/S3-ari-leader-hard-stop/leader/Dockerfile`**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
CMD ["node", "index.js"]
```

- [ ] **Step 7: Write `pot/S3-ari-leader-hard-stop/Makefile`**

```make
.PHONY: up test teardown snapshot-results status
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

up:
	docker compose up -d --build
	@sleep 10
	docker compose ps

test:
	@echo "S3 chaos test: see runbook.md — pcap capture is host-side, run manually."
	@false

teardown:
	docker compose down -v

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	docker compose logs > results/$(TIMESTAMP)/leader-logs.txt 2>&1
	@echo "Snapshot at results/$(TIMESTAMP)/"

status:
	@docker compose ps
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
```

- [ ] **Step 8: Write `pot/S3-ari-leader-hard-stop/.gitignore`**

```gitignore
results/*
!results/.gitkeep
leader/node_modules/
```

- [ ] **Step 9: Create placeholders**

Run:
```bash
mkdir -p pot/S3-ari-leader-hard-stop/fixtures pot/S3-ari-leader-hard-stop/results
touch pot/S3-ari-leader-hard-stop/fixtures/.gitkeep pot/S3-ari-leader-hard-stop/results/.gitkeep
```

- [ ] **Step 10: Validate compose**

Run:
```bash
docker compose -f pot/S3-ari-leader-hard-stop/docker-compose.yml config -q
```
Expected: exits 0.

- [ ] **Step 11: Commit**

```bash
git add pot/S3-ari-leader-hard-stop/
git commit -m "$(cat <<'EOF'
chore(pot): scaffold S3 ARI leader hard-stop spike

Asterisk + Redis + 2 leader stubs (Node, throwaway). Chaos via
docker pause, FIN observed via host tcpdump per runbook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: S4 — redaction accuracy (stub)

**Files:**
- Create: `pot/S4-redaction-accuracy/README.md`
- Create: `pot/S4-redaction-accuracy/runbook.md`
- Create: `pot/S4-redaction-accuracy/docker-compose.yml`
- Create: `pot/S4-redaction-accuracy/Makefile`
- Create: `pot/S4-redaction-accuracy/.gitignore`
- Create: `pot/S4-redaction-accuracy/fixtures/.gitkeep`
- Create: `pot/S4-redaction-accuracy/results/.gitkeep`

- [ ] **Step 1: Write `pot/S4-redaction-accuracy/README.md`**

```markdown
# S4 — Two-pass redaction accuracy on 8 kHz μ-law

> **Status: STUB — external dependencies required before this spike runs.** See §Prereqs.

## Hypothesis

AssemblyAI Universal-3 Pro Medical + Microsoft Presidio NER + segment-boundary fallback achieves ≥ 95% recall on planted MRN/DOB/account/phone spans and over-bleeps by ≤ 3 s per false-low-confidence span.

## Go/no-go signal

- **Green:** Recall ≥ 95%, F1 ≥ 0.92, mean over-bleep ≤ 1.5 s, manual-QA backlog ≤ 2% of spans on a 30-fixture test set with 90 planted PII spans (mix of clean, noisy, accented).
- **Yellow:** Recall 90–95% — manual-QA percentage in ADR-0013 increases above 2% to compensate.
- **Red:** Recall < 90% on numbers spans — pipeline design renegotiated, possibly adding redundant per-token confidence-based bleeping.

## Owner role

Backend engineer + compliance lead.

## Prereqs (BLOCKED — needs user-side action)

- **AssemblyAI API key with Universal-3 Pro Medical access.** Contact AssemblyAI sales for medical-tier provisioning.
- **30 audio fixtures @ 8 kHz μ-law** with documented PII span ground-truth (start_ms, end_ms, kind, value). Fixtures must cover: clean studio, telephony noise, accented (5+ accents), digit-by-digit numbers, account IDs with letters. Fixtures do **not** commit to the repo — they go in `fixtures/redaction-audio/` which is gitignored. The user provides them out-of-band.
- **Presidio installed via Docker.** No external acct.
- **Compute:** GPU recommended for batch ASR (1× A10 sufficient); CPU works at 5–10× wall time.

## Runbook

When prereqs land, see [`runbook.md`](./runbook.md). Until then, `make test` prints a checklist and exits 1.

## Recording protocol

`results/<timestamp>/`:
- `predictions.jsonl` — one line per fixture: predicted spans + confidence
- `ground-truth.jsonl` — copy of the ground-truth file used
- `metrics.json` — recall, precision, F1, over-bleep mean/p95, per-PII-class breakdown
- `manual-qa-queue.csv` — spans flagged for review
- `summary.md`

## Yellow remediation

Per ADR-0013: increase manual-QA sample percentage from 2% to whatever rate compensates for the recall gap. Document new operational headcount cost.

## ADR linkage

Primary evidence for [ADR-0013 (two-pass redaction pipeline)](../../docs/adr/0013-redaction-pipeline.md).
```

- [ ] **Step 2: Write `pot/S4-redaction-accuracy/runbook.md`**

```markdown
# S4 Runbook (DRAFT — to be expanded when prereqs land)

## Prereq check

```
make check-prereqs
```

Verifies: ASSEMBLYAI_API_KEY env var set, fixtures/ has 30 audio files + ground-truth.jsonl, presidio container builds.

## Setup

```
make up
```

## Test

```
make test
```

What `make test` does (when implemented at spike-execution time):
1. For each fixture in fixtures/: send audio to AssemblyAI Universal-3 Pro Medical, get word-level timestamps + transcript.
2. Run Presidio NER over the transcript.
3. Intersect: produce candidate spans with confidence.
4. For each span with confidence < 0.9, extend to next silence boundary (max +1.5 s).
5. Compare against ground-truth, compute metrics into `results/<ts>/metrics.json`.

## Snapshot

```
make snapshot-results
```

## Teardown

```
make teardown
```
```

- [ ] **Step 3: Write `pot/S4-redaction-accuracy/docker-compose.yml`**

```yaml
# S4 — STUB. External dependency: AssemblyAI API key + audio fixtures.
# This compose file is intentionally minimal — Presidio runs locally; ASR is HTTPS to vendor.
# When prereqs land, expand with the actual harness container.

services:
  presidio-analyzer:
    image: mcr.microsoft.com/presidio-analyzer:latest
    ports:
      - "5001:5001"
```

- [ ] **Step 4: Write `pot/S4-redaction-accuracy/Makefile`**

```make
.PHONY: up test teardown snapshot-results status check-prereqs
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

check-prereqs:
	@test -n "$$ASSEMBLYAI_API_KEY" || { echo "MISSING: ASSEMBLYAI_API_KEY env var"; exit 1; }
	@test -f fixtures/ground-truth.jsonl || { echo "MISSING: fixtures/ground-truth.jsonl"; exit 1; }
	@count=$$(ls fixtures/*.wav 2>/dev/null | wc -l); \
	  test "$$count" -ge 30 || { echo "MISSING: need ≥30 wav fixtures, have $$count"; exit 1; }
	@echo "Prereqs OK"

up:
	docker compose up -d
	@sleep 5
	docker compose ps

test:
	@echo "S4 is BLOCKED on external prereqs:"
	@echo "  - AssemblyAI Universal-3 Pro Medical API key"
	@echo "  - 30 audio fixtures @ 8 kHz μ-law in fixtures/"
	@echo "  - ground-truth.jsonl describing planted PII spans"
	@echo "Run 'make check-prereqs' once prereqs are in place."
	@exit 1

teardown:
	docker compose down -v

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	docker compose logs > results/$(TIMESTAMP)/presidio-logs.txt 2>&1 || true
	@echo "Snapshot at results/$(TIMESTAMP)/"

status:
	@docker compose ps 2>/dev/null || echo "not booted"
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
```

- [ ] **Step 5: Write `pot/S4-redaction-accuracy/.gitignore`**

```gitignore
results/*
!results/.gitkeep
fixtures/*.wav
fixtures/*.mp3
fixtures/ground-truth.jsonl
```

- [ ] **Step 6: Create placeholders**

Run:
```bash
mkdir -p pot/S4-redaction-accuracy/fixtures pot/S4-redaction-accuracy/results
touch pot/S4-redaction-accuracy/fixtures/.gitkeep pot/S4-redaction-accuracy/results/.gitkeep
```

- [ ] **Step 7: Validate compose**

Run:
```bash
docker compose -f pot/S4-redaction-accuracy/docker-compose.yml config -q
```
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add pot/S4-redaction-accuracy/
git commit -m "$(cat <<'EOF'
chore(pot): scaffold S4 redaction accuracy stub

Stub: external prereqs (AssemblyAI key + 30 audio fixtures) blocked
until user provides. Presidio analyzer container ready; harness
TBD at spike-execution time. make test exits 1 with checklist.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: S5 — Supavisor SET LOCAL (runnable, fastest spike)

**Files:**
- Create: `pot/S5-supavisor-set-local/README.md`
- Create: `pot/S5-supavisor-set-local/runbook.md`
- Create: `pot/S5-supavisor-set-local/docker-compose.yml`
- Create: `pot/S5-supavisor-set-local/Makefile`
- Create: `pot/S5-supavisor-set-local/.gitignore`
- Create: `pot/S5-supavisor-set-local/fixtures/.gitkeep`
- Create: `pot/S5-supavisor-set-local/results/.gitkeep`

- [ ] **Step 1: Write `pot/S5-supavisor-set-local/README.md`**

```markdown
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
- `probe-output.txt` — raw psql output of both transactions, including `pg_backend_pid()` for each (proves both transactions reused the same server connection)
- `summary.md` — one paragraph: Green or Red, exact value seen in transaction 2

## Yellow remediation

Not applicable — this is a binary signal.

## ADR linkage

Primary evidence for [ADR-0018 (Supavisor as transaction-mode pooler)](../../docs/adr/0018-supavisor-pooling.md). Red here flips the Decision section to PgBouncer 1.22+ before Sprint 0.
```

- [ ] **Step 2: Write `pot/S5-supavisor-set-local/runbook.md`**

```markdown
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
```

- [ ] **Step 3: Write `pot/S5-supavisor-set-local/docker-compose.yml`**

```yaml
# S5 — Supavisor SET LOCAL parity. Smallest, fastest spike.

services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_PASSWORD: pot
      POSTGRES_DB: pot
      POSTGRES_USER: postgres
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 3s
      timeout: 2s
      retries: 5

  supavisor:
    image: supabase/supavisor:1.1.66
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://postgres:pot@postgres:5432/_supavisor
      SECRET_KEY_BASE: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
      VAULT_ENC_KEY: 0123456789abcdef0123456789abcdef
      API_JWT_SECRET: dev
      METRICS_JWT_SECRET: dev
      REGION: pot
      ERL_AFLAGS: "-proto_dist inet_tcp"
      RELEASE_COOKIE: cookie
      RELEASE_NODE: supavisor@127.0.0.1
    ports:
      - "5432:5432"  # transaction mode
      - "4000:4000"  # admin API

  runner:
    image: postgres:17-alpine  # reuse for psql
    depends_on:
      - supavisor
    volumes:
      - ./fixtures:/fixtures:ro
      - ./results:/results
    entrypoint: ["sleep", "infinity"]  # keep alive; tests invoke psql exec
```

- [ ] **Step 4: Write `pot/S5-supavisor-set-local/Makefile`**

```make
.PHONY: up test teardown snapshot-results status
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)
RESULT_DIR := results/$(TIMESTAMP)

up:
	docker compose up -d
	@echo "Waiting for Supavisor to be ready..."
	@sleep 30
	docker compose ps

test:
	@mkdir -p $(RESULT_DIR)
	@echo "Configuring Supavisor pool of size 1 against postgres..."
	@curl -sS -X PUT http://localhost:4000/api/tenants/pot \
	  -H "Authorization: Bearer dev" \
	  -H "Content-Type: application/json" \
	  -d '{"tenant":{"db_host":"postgres","db_port":5432,"db_database":"pot","require_user":false,"users":[{"db_user_alias":"postgres","db_user":"postgres","db_password":"pot","pool_size":1,"mode_type":"transaction"}]}}' \
	  > $(RESULT_DIR)/tenant-create.json || true
	@echo "Running probe..."
	@docker compose exec -T runner sh -c '\
	  export PGPASSWORD=pot; \
	  echo "=== transaction 1 ==="; \
	  psql -h supavisor -p 5432 -U "postgres.pot" -d pot -X -A -c "BEGIN; SET LOCAL app.tenant_id = '\''tenant-A'\''; SELECT current_setting('\''app.tenant_id'\'') AS t1_value, pg_backend_pid() AS pid_t1; COMMIT;"; \
	  echo "=== transaction 2 ==="; \
	  psql -h supavisor -p 5432 -U "postgres.pot" -d pot -X -A -c "BEGIN; SELECT current_setting('\''app.tenant_id'\'', true) AS t2_value, pg_backend_pid() AS pid_t2; COMMIT;"' \
	  > $(RESULT_DIR)/probe-output.txt 2>&1
	@cat $(RESULT_DIR)/probe-output.txt
	@echo ""
	@second_tx=$$(awk '/=== transaction 2 ===/,0' $(RESULT_DIR)/probe-output.txt); \
	 if echo "$$second_tx" | grep -q "tenant-A"; then \
	   echo "RED: Supavisor LEAKED SET LOCAL across transactions"; \
	   echo "Red: Supavisor LEAKED SET LOCAL across transactions on a shared backend. Transaction 2 saw 'tenant-A'. See probe-output.txt." > $(RESULT_DIR)/summary.md; \
	   exit 1; \
	 else \
	   echo "GREEN: Supavisor honoured SET LOCAL boundary"; \
	   echo "Green: Supavisor honoured SET LOCAL boundary; transaction 2 did not see the value set in transaction 1. See probe-output.txt." > $(RESULT_DIR)/summary.md; \
	 fi

teardown:
	docker compose down -v

snapshot-results:
	@echo "Results already in $(RESULT_DIR)/ from make test."
	@ls -la results/

status:
	@docker compose ps
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
```

- [ ] **Step 5: Write `pot/S5-supavisor-set-local/.gitignore`**

```gitignore
results/*
!results/.gitkeep
```

- [ ] **Step 6: Create placeholders**

Run:
```bash
mkdir -p pot/S5-supavisor-set-local/fixtures pot/S5-supavisor-set-local/results
touch pot/S5-supavisor-set-local/fixtures/.gitkeep pot/S5-supavisor-set-local/results/.gitkeep
```

- [ ] **Step 7: Validate compose**

Run:
```bash
docker compose -f pot/S5-supavisor-set-local/docker-compose.yml config -q
```
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add pot/S5-supavisor-set-local/
git commit -m "$(cat <<'EOF'
chore(pot): scaffold S5 Supavisor SET LOCAL parity spike

Postgres 17 + Supavisor 1.1.66 + psql runner. Smallest spike;
make test runs the two-transaction probe end-to-end and writes
Green/Red summary directly. Self-contained, ~5 min wall time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: S6 — nCall fixture capture (stub)

**Files:**
- Create: `pot/S6-ncall-fixture-capture/README.md`
- Create: `pot/S6-ncall-fixture-capture/runbook.md`
- Create: `pot/S6-ncall-fixture-capture/docker-compose.yml`
- Create: `pot/S6-ncall-fixture-capture/Makefile`
- Create: `pot/S6-ncall-fixture-capture/.gitignore`
- Create: `pot/S6-ncall-fixture-capture/fixtures/.gitkeep`
- Create: `pot/S6-ncall-fixture-capture/results/.gitkeep`

- [ ] **Step 1: Write `pot/S6-ncall-fixture-capture/README.md`**

```markdown
# S6 — `/v1` byte-for-byte fixture capture from live nCall

> **Status: STUB — needs vendor live-instance access before this spike runs.**

## Hypothesis

A read-only test tenant on a real nCall instance can be cloned into golden fixtures sufficient for M25 (the `/v1` compatibility module) to pass round-trip tests.

## Go/no-go signal

- **Green:** 200 captured XML responses (every consumed resource, every consumed query shape) committed to `/contracts/fixtures/v1-xml/`. Unknown-quirk inventory committed to `docs/ncall-compat/quirks.md`.
- **Yellow:** 100–200 fixtures captured; remaining endpoints documented for later capture during Sprint 1.
- **Red:** Vendor blocks the test tenant. Fall back to scraping the existing CRM's response cache (lower fidelity but extractable).

## Owner role

Compliance lead + backend engineer.

## Prereqs (BLOCKED — needs user-side action)

- **Live nCall instance access.** Either an existing tenant where a read-only user can be created, or a vendor-provided sandbox.
- **HTTP Basic Auth credentials** for the test tenant.
- **List of endpoints currently consumed by the existing CRM.** Source: CRM source code, access logs, or developer interview.
- No infra prereqs — the capture is a curl loop.

## Runbook

When prereqs land, see [`runbook.md`](./runbook.md). The capture script template is in `fixtures/capture.sh.template` (write at execution time).

## Recording protocol

- Captured XML lands in `fixtures/v1-xml/<resource>/<query-fingerprint>.xml` — one file per (resource, query-shape) pair.
- Quirks (undocumented behaviour, deviation from PRD §7.5 spec) land in `results/<timestamp>/quirks.md`.
- Capture script lands in `results/<timestamp>/capture.sh` (the actual run, with creds redacted).

## Yellow remediation

Per ARCH §2.3: scrape the existing CRM's response cache. Fidelity is lower (no synthesised query shapes), but cache is sufficient for the endpoints the CRM actually uses today.

## ADR linkage

No ADR — this spike feeds the M25 module spec directly. Carries forward as `/contracts/fixtures/v1-xml/`.
```

- [ ] **Step 2: Write `pot/S6-ncall-fixture-capture/runbook.md`**

```markdown
# S6 Runbook (DRAFT)

## Prereq check

```
make check-prereqs
```

Verifies: NCALL_BASE_URL, NCALL_USER, NCALL_PASS env vars set.

## Capture loop

When prereqs land, the capture script (to be written at spike-execution time) iterates over:
- Resources: `time`, `me`, `Users`, `Calls`, `Messages`, `Contacts`, `Clients`, `todo`, `KPI`, per-client `billing` (per crm-api-compat memory + PRD §7.5).
- Per resource: `field_names.xml`, `find.xml`, `find.xml?<field>=<value>` × known query shapes (today / yesterday / greater_than_X / less_than_X / output_fields=).

For each request, save the raw XML to `fixtures/v1-xml/<resource>/<sanitised-query>.xml`.

## Quirk inventory

After capture, diff observed responses against PRD §7.5 spec. Anything undocumented gets a one-line entry in `results/<ts>/quirks.md`.

## Snapshot

```
make snapshot-results
```

## Teardown

Nothing to tear down — pure curl loop.
```

- [ ] **Step 3: Write `pot/S6-ncall-fixture-capture/docker-compose.yml`**

```yaml
# S6 — STUB. No infra; capture is a curl loop run from the host or a one-shot container.
# This compose file exists only so `docker compose config` validates.

services:
  curl:
    image: curlimages/curl:8.10.1
    entrypoint: ["sleep", "infinity"]
    profiles: ["manual"]
```

- [ ] **Step 4: Write `pot/S6-ncall-fixture-capture/Makefile`**

```make
.PHONY: up test teardown snapshot-results status check-prereqs
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

check-prereqs:
	@test -n "$$NCALL_BASE_URL" || { echo "MISSING: NCALL_BASE_URL env var (e.g., https://acme.ncall.com)"; exit 1; }
	@test -n "$$NCALL_USER" || { echo "MISSING: NCALL_USER env var"; exit 1; }
	@test -n "$$NCALL_PASS" || { echo "MISSING: NCALL_PASS env var"; exit 1; }
	@echo "Prereqs OK"

up:
	@echo "S6 has no boot — capture is a curl loop. Run 'make test' once prereqs are in place."

test:
	@echo "S6 is BLOCKED on external prereqs:"
	@echo "  - live nCall instance access (NCALL_BASE_URL, NCALL_USER, NCALL_PASS)"
	@echo "  - list of CRM-consumed endpoints"
	@echo "Capture script template will land in fixtures/capture.sh.template at spike-execution time."
	@exit 1

teardown:
	docker compose down -v 2>/dev/null || true

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	@echo "Snapshot at results/$(TIMESTAMP)/ — fill manually with quirks.md + redacted capture.sh"

status:
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
	@ls -1 fixtures/v1-xml/ 2>/dev/null | head -10 || echo "no fixtures yet"
```

- [ ] **Step 5: Write `pot/S6-ncall-fixture-capture/.gitignore`**

```gitignore
results/*
!results/.gitkeep
fixtures/capture.sh
```

(Captured XML fixtures are NOT gitignored — they are the carry-forward artefact.)

- [ ] **Step 6: Create placeholders**

Run:
```bash
mkdir -p pot/S6-ncall-fixture-capture/fixtures pot/S6-ncall-fixture-capture/results
touch pot/S6-ncall-fixture-capture/fixtures/.gitkeep pot/S6-ncall-fixture-capture/results/.gitkeep
```

- [ ] **Step 7: Validate compose**

Run:
```bash
docker compose -f pot/S6-ncall-fixture-capture/docker-compose.yml config -q
```
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add pot/S6-ncall-fixture-capture/
git commit -m "$(cat <<'EOF'
chore(pot): scaffold S6 nCall fixture capture stub

Stub: needs live nCall vendor access. Capture is a curl loop;
no boot infra. make test exits 1 with checklist until creds land.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: S7 — Temporal BAA (stub)

**Files:**
- Create: `pot/S7-temporal-baa/README.md`
- Create: `pot/S7-temporal-baa/runbook.md`
- Create: `pot/S7-temporal-baa/docker-compose.yml`
- Create: `pot/S7-temporal-baa/Makefile`
- Create: `pot/S7-temporal-baa/.gitignore`
- Create: `pot/S7-temporal-baa/fixtures/.gitkeep`
- Create: `pot/S7-temporal-baa/results/.gitkeep`

- [ ] **Step 1: Write `pot/S7-temporal-baa/README.md`**

```markdown
# S7 — Temporal Cloud BAA + EU namespace metadata egress

> **Status: STUB — sales/legal correspondence, no infra.**

## Hypothesis

Temporal Cloud Enterprise tier signs the BAA and confirms in writing that EU-namespace Search Attribute metadata does not egress to the US control plane.

## Go/no-go signal

- **Green:** Sales letter attached to ADR-0015 confirming both clauses (BAA + EU residency of namespace metadata).
- **Yellow:** BAA confirmed; EU namespace residency caveated (e.g., metadata in EU but billing/audit in US). Documented and accepted by compliance lead.
- **Red:** Either clause refused. Pivot to self-host Temporal via the Helm chart v1.0.0 on EU-residency K8s. Update ADR-0015 Decision section before Sprint 0 closes.

## Owner role

Compliance lead.

## Prereqs (BLOCKED — needs user-side action)

- **Initiate sales contact with Temporal Technologies.** Specifically: Enterprise tier, BAA terms request, EU namespace data-residency question.
- **Email/letter template** drafted (see `runbook.md`).
- 2–6 weeks calendar time for sales/legal cycle.

## Runbook

See [`runbook.md`](./runbook.md) — checklist of correspondence items.

## Recording protocol

`results/`:
- `correspondence.md` — chronological log of sales touchpoints
- `baa-letter.pdf` — the signed sales letter (when received)
- `summary.md` — one paragraph: Green / Yellow / Red

## Yellow remediation

Per ADR-0015: self-host Temporal via Helm chart v1.0.0 on EU-residency K8s. Architecture-equivalent for application code; operations cost +0.5 FTE.

## ADR linkage

Primary evidence for [ADR-0015 (Temporal Cloud Enterprise tier)](../../docs/adr/0015-temporal-cloud-tier.md). Red flips Decision section to self-host before Sprint 0.
```

- [ ] **Step 2: Write `pot/S7-temporal-baa/runbook.md`**

```markdown
# S7 Runbook

## Step 1: Initial outreach

Send to sales@temporal.io (or the Enterprise contact form):

> Subject: Enterprise tier BAA + EU namespace data residency
>
> Hello — we're evaluating Temporal Cloud Enterprise tier for a multi-tenant healthcare SaaS (HIPAA + GDPR scope). Two questions before proceeding:
>
> 1. Does Enterprise tier include a signed Business Associate Agreement (BAA) covering Temporal as a subprocessor for PHI metadata in workflow Search Attributes?
>
> 2. For an EU-region namespace, does Search Attribute metadata + workflow input metadata stay within EU infrastructure, or does any of it transit to the US control plane (e.g., for billing aggregation, telemetry, audit)?
>
> Happy to share volume estimates and architecture context on a call.

## Step 2: Track correspondence

Log every email/call in `results/correspondence.md` with timestamp, party, summary.

## Step 3: Receive sales letter

When the letter arrives:
- Save the PDF as `results/baa-letter.pdf`.
- Verify both clauses present.
- Write `results/summary.md`:

```
## S7 outcome

Status: Green | Yellow | Red

BAA: <yes/no, terms summary>
EU namespace residency: <yes/no, caveats>

Decision: <accept | escalate to legal | trigger ADR-0015 fallback>
```

## Step 4: Update ADR-0015

- Green: status → Accepted; evidence link to baa-letter.pdf.
- Yellow: status → Accepted with caveat in Consequences/Negative.
- Red: rewrite Decision to self-host Temporal via Helm; status remains Proposed pending Sprint 0 ratification.

## No teardown

Pure correspondence — nothing to tear down.
```

- [ ] **Step 3: Write `pot/S7-temporal-baa/docker-compose.yml`**

```yaml
# S7 — STUB. Sales/legal correspondence, no infra at PoT time.
# This compose file exists only so `docker compose config` validates.

services:
  noop:
    image: alpine:3.20
    entrypoint: ["sleep", "infinity"]
    profiles: ["manual"]
```

- [ ] **Step 4: Write `pot/S7-temporal-baa/Makefile`**

```make
.PHONY: up test teardown snapshot-results status
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

up:
	@echo "S7 has no boot — sales/legal correspondence only. See README and runbook."

test:
	@echo "S7 is BLOCKED on external action: sales contact with Temporal."
	@echo "Track progress in results/correspondence.md."
	@exit 1

teardown:
	@true

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	@cp results/correspondence.md results/$(TIMESTAMP)/correspondence.md 2>/dev/null || true
	@cp results/baa-letter.pdf results/$(TIMESTAMP)/baa-letter.pdf 2>/dev/null || true
	@echo "Snapshot at results/$(TIMESTAMP)/"

status:
	@test -f results/baa-letter.pdf && echo "BAA letter: present" || echo "BAA letter: not yet received"
	@test -f results/correspondence.md && echo "Correspondence log: present" || echo "Correspondence log: not yet started"
```

- [ ] **Step 5: Write `pot/S7-temporal-baa/.gitignore`**

```gitignore
# Keep correspondence.md and baa-letter.pdf in git for forensic reference.
results/2*
```

- [ ] **Step 6: Create placeholders**

Run:
```bash
mkdir -p pot/S7-temporal-baa/fixtures pot/S7-temporal-baa/results
touch pot/S7-temporal-baa/fixtures/.gitkeep pot/S7-temporal-baa/results/.gitkeep
```

- [ ] **Step 7: Validate compose**

Run:
```bash
docker compose -f pot/S7-temporal-baa/docker-compose.yml config -q
```
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add pot/S7-temporal-baa/
git commit -m "$(cat <<'EOF'
chore(pot): scaffold S7 Temporal BAA stub

Stub: sales/legal correspondence with Temporal. No infra.
Email template + correspondence log workflow in runbook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: S8 — Caddy 2.10+ + LE posture (runnable, k6 load gen)

**Files:**
- Create: `pot/S8-caddy-le-posture/README.md`
- Create: `pot/S8-caddy-le-posture/runbook.md`
- Create: `pot/S8-caddy-le-posture/docker-compose.yml`
- Create: `pot/S8-caddy-le-posture/Makefile`
- Create: `pot/S8-caddy-le-posture/.gitignore`
- Create: `pot/S8-caddy-le-posture/fixtures/.gitkeep`
- Create: `pot/S8-caddy-le-posture/results/.gitkeep`

- [ ] **Step 1: Write `pot/S8-caddy-le-posture/README.md`**

```markdown
# S8 — Caddy 2.10+ permission + LE rate-limit posture

## Hypothesis

The `permission http` endpoint sustains the storage-flood class (certmagic #174) and the LE rate-limit exemption application is in flight.

## Go/no-go signal

- **Green:** 1 k unknown-SNI probes/sec → permission endpoint declined-LRU absorbs, Caddy storage RPS stays under 50/sec, HAProxy rate-limits before Caddy is reached. Separately: ISRG exemption form submitted, 2–4 week turnaround acceptable.
- **Yellow:** Storage RPS 50–200/sec under flood; tunable headroom remains. ISRG exemption submitted but not yet processed.
- **Red:** Storage RPS > 200/sec — permission endpoint check is happening AFTER storage lookup. Caddy version pin moves up or HAProxy rate limit tightens.

## Owner role

SRE.

## Prereqs

- Docker 24+, Docker Compose v2.
- Host: 4 GB RAM (k6 load gen + Caddy + HAProxy).
- ISRG exemption form is **org-side** — track separately, not gated on this spike's runnable bits.
- No external accounts for the load test.

## Runbook

```
make up && make test && make snapshot-results
```

The k6 load test runs locally; storage thrash is observed via Caddy admin API metrics.

## Recording protocol

`results/<timestamp>/`:
- `k6-summary.json` — k6 output (req/sec, latencies, error rates)
- `caddy-storage-rps.csv` — sampled at 5 s intervals during the 10-min load
- `haproxy-stats.csv` — sampled HAProxy stats (rate-limit drops, throughput)
- `summary.md`
- `isrg-exemption-receipt.pdf` — manually attached when org submits the form

## Yellow remediation

If storage RPS 50–200/sec: tune Caddy `on_demand_tls.ask` LRU size up; document new minimum cache size.

## ADR linkage

Primary evidence for [ADR-0019 (Caddy 2.10+ on-demand TLS posture)](../../docs/adr/0019-caddy-le-posture.md).
```

- [ ] **Step 2: Write `pot/S8-caddy-le-posture/runbook.md`**

```markdown
# S8 Runbook

## Setup

```
make up
```

Boots: caddy:2.10+, haproxy:3.0, k6:0.50, plus a dummy permission endpoint (Python http.server returning 403 for everything).

## Test

```
make test
```

What `make test` does:
1. Starts the k6 scenario from `fixtures/k6/sni-flood.js` — 1 k requests/sec to random unknown SNI hostnames for 10 minutes.
2. In parallel, samples Caddy's `/metrics` admin API every 5 s, extracting `caddy_certificates_managed_total` and storage I/O counters.
3. Samples HAProxy stats socket every 5 s for rate-limit drops.
4. After 10 min, computes storage RPS (delta cert events / wall time) and writes summary.md.

## Snapshot

```
make snapshot-results
```

## Teardown

```
make teardown
```
```

- [ ] **Step 3: Write `pot/S8-caddy-le-posture/docker-compose.yml`**

```yaml
# S8 — Caddy 2.10+ permission + LE rate-limit posture.

services:
  permission:
    image: python:3.12-alpine
    command: ["python", "-m", "http.server", "8080"]
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8080 >/dev/null"]
      interval: 5s
      timeout: 2s
      retries: 5

  caddy:
    image: caddy:2.10-alpine
    depends_on:
      permission:
        condition: service_healthy
    volumes:
      - ./fixtures/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
    ports:
      - "8081:80"
      - "8443:443"
      - "2019:2019"  # admin API

  haproxy:
    image: haproxy:3.0-alpine
    depends_on:
      - caddy
    volumes:
      - ./fixtures/haproxy/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    ports:
      - "8082:80"
      - "8444:443"
      - "8404:8404"  # stats

  k6:
    image: grafana/k6:0.50.0
    profiles: ["driver"]
    volumes:
      - ./fixtures/k6:/scripts:ro
      - ./results:/results
    entrypoint: ["sleep", "infinity"]
```

- [ ] **Step 4: Write `pot/S8-caddy-le-posture/Makefile`**

```make
.PHONY: up test teardown snapshot-results status
TIMESTAMP := $(shell date -u +%Y%m%dT%H%M%SZ)

up:
	docker compose up -d
	@sleep 5
	docker compose ps

test:
	@echo "S8 load test: see runbook.md — k6 scenario script lands at spike-execution time."
	@echo "Manual: docker compose --profile driver run k6 run /scripts/sni-flood.js"
	@exit 1

teardown:
	docker compose down -v

snapshot-results:
	mkdir -p results/$(TIMESTAMP)
	docker compose logs > results/$(TIMESTAMP)/all-logs.txt 2>&1
	@curl -sS http://localhost:2019/metrics > results/$(TIMESTAMP)/caddy-metrics.txt 2>/dev/null || true
	@curl -sS http://localhost:8404/stats\;csv > results/$(TIMESTAMP)/haproxy-stats.csv 2>/dev/null || true
	@echo "Snapshot at results/$(TIMESTAMP)/"

status:
	@docker compose ps
	@ls -1 results/ 2>/dev/null | tail -5 || echo "no results yet"
```

- [ ] **Step 5: Write `pot/S8-caddy-le-posture/.gitignore`**

```gitignore
results/*
!results/.gitkeep
```

- [ ] **Step 6: Create placeholders**

Run:
```bash
mkdir -p pot/S8-caddy-le-posture/fixtures pot/S8-caddy-le-posture/results
touch pot/S8-caddy-le-posture/fixtures/.gitkeep pot/S8-caddy-le-posture/results/.gitkeep
```

- [ ] **Step 7: Validate compose**

Run:
```bash
docker compose -f pot/S8-caddy-le-posture/docker-compose.yml config -q
```
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add pot/S8-caddy-le-posture/
git commit -m "$(cat <<'EOF'
chore(pot): scaffold S8 Caddy LE posture spike

Caddy 2.10 + HAProxy 3.0 + k6 0.50 load gen + dummy permission
endpoint. Storage-thrash detection via Caddy /metrics + HAProxy
stats CSV. ISRG exemption tracked org-side, not in scope.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Final verification gate (spec §9 success criteria)

This task runs the spec's success criteria as one final pass. Nothing new is created; failures here mean fixing earlier tasks.

- [ ] **Step 1: Verify all spec §4 files exist**

Run:
```bash
test -f docs/adr/README.md && \
test -f docs/adr/template.md && \
test -f docs/adr/0013-redaction-pipeline.md && \
test -f docs/adr/0015-temporal-cloud-tier.md && \
test -f docs/adr/0016-ari-leader-design.md && \
test -f docs/adr/0018-supavisor-pooling.md && \
test -f docs/adr/0019-caddy-le-posture.md && \
test -f docs/adr/0024-queue-dequeue-budget.md && \
test -f pot/README.md && \
test -f pot/Makefile && \
test -f pot/pot-readout.md && \
for s in S1-telephony-happy-path S2-queue-dequeue-latency S3-ari-leader-hard-stop \
         S4-redaction-accuracy S5-supavisor-set-local S6-ncall-fixture-capture \
         S7-temporal-baa S8-caddy-le-posture; do \
  test -f pot/$s/README.md && \
  test -f pot/$s/runbook.md && \
  test -f pot/$s/docker-compose.yml && \
  test -f pot/$s/Makefile && \
  test -f pot/$s/.gitignore && \
  test -f pot/$s/fixtures/.gitkeep && \
  test -f pot/$s/results/.gitkeep || { echo "MISSING in $s"; exit 1; }; \
done && echo "ALL FILES PRESENT"
```
Expected: `ALL FILES PRESENT`.

- [ ] **Step 2: Verify all 8 compose files validate**

Run:
```bash
for s in pot/S*/; do \
  echo "=== $s ==="; \
  docker compose -f "$s/docker-compose.yml" config -q && echo "OK" || { echo "FAIL: $s"; exit 1; }; \
done
```
Expected: 8 `OK` lines.

- [ ] **Step 3: Verify dispatcher lists 40 targets**

Run:
```bash
test "$(make -C pot all-targets | wc -l | tr -d ' ')" = "40" && echo "OK: 40 targets" || { echo "FAIL: target count wrong"; exit 1; }
```
Expected: `OK: 40 targets`.

- [ ] **Step 4: Verify each ADR has non-empty Context and Decision sections**

Run:
```bash
for f in docs/adr/00*.md; do \
  awk '/^## Context/,/^## /' "$f" | tail -n +2 | head -n -1 | grep -qv '^$' || { echo "FAIL Context: $f"; exit 1; }; \
  awk '/^## Decision/,/^## /' "$f" | tail -n +2 | head -n -1 | grep -qv '^$' || { echo "FAIL Decision: $f"; exit 1; }; \
done && echo "ALL ADRS HAVE CONTEXT + DECISION"
```
Expected: `ALL ADRS HAVE CONTEXT + DECISION`.

- [ ] **Step 5: Verify no spike has been executed**

Run:
```bash
for s in pot/S*/; do \
  count=$(ls "$s/results/" 2>/dev/null | grep -v '^.gitkeep$' | wc -l | tr -d ' '); \
  test "$count" = "0" || { echo "FAIL: $s has results"; exit 1; }; \
done && echo "OK: no spike has been executed"
```
Expected: `OK: no spike has been executed`.

- [ ] **Step 6: Print branch summary and stop**

Run:
```bash
git log --oneline main..HEAD
echo "---"
git diff --stat main..HEAD
```

This is the final state. No commit at this step — verification only. If all passes, hand back to user with a one-line summary of branch state and offer next steps (tag, PR, or pause).

---

## Notes

- **Parallelization:** Tasks 3–10 (per-spike scaffolds) are independent of each other once tasks 1–2 land. If executing via subagent-driven-development, dispatch tasks 3–10 in parallel after task 2 completes.
- **Branch hygiene:** Every task ends with a commit so the branch can be reviewed commit-by-commit.
- **Throwaway by design:** Nothing in this branch is intended to survive into Sprint 1 untouched. Per ARCH §2.4, fixtures and ADR evidence carry forward; spike code does not.
- **Compose schema validation ≠ image pull.** Task 11 step 2 only verifies YAML schema (`docker compose config -q`). Several image pins are educated guesses against the architecture-doc target versions (e.g., `caddy:2.10-alpine` is target-state at PoT time; `andrius/asterisk:22.9-current`, `ghcr.io/baresip/baresip:latest`, `supabase/supavisor:1.1.66` are best-guess tags). The scaffold contract is "compose YAML is valid and semantically describes the right stack" — if any image fails to actually pull at spike-execution time, the spike-execution branch resolves the pin. This is intentional: scaffold stages, execution resolves.
- **Supavisor tenant config in S5:** the `make test` step posts a tenant-create JSON to Supavisor's admin API. The exact API shape is version-sensitive; the JSON in this plan targets 1.1.x. If 1.1.66 changes the contract, the test step adjusts at execution time — the probe SQL itself is the load-bearing logic and stays.
