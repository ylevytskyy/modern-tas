# PoC tracer-bullet — design spec

> Status: **Draft, pending user review** · Date: 2026-05-13 · Owner: founder + senior architect (TBD) · Follow-up: writing-plans skill produces an implementation plan from this spec.

## 1. Goal

Prove that the validated Phase-0 PoT pieces (S1 + S2 + S3 + S5 + S8 Green; S4 + S6 + S7 resolved as part of G0 closure) **compose** into one runnable system that executes the canonical TAS call story end-to-end on the production-shaped stack.

The PoC artifact is the first commit of the MVP codebase — its e2e test suite **becomes** the MVP's e2e harness on day 1. PoC scenarios evolve into ARCH v0.4 §4.3 AC #1–#20 over the MVP build.

## 2. Audience and what "done" proves

- **Audience:** founder + senior architect. Internal review of integration risk before MVP feature work begins.
- **Done proves:** PoT-validated components compose under one wire-protocol stack without surprise integration risk; the MVP can start feature work on top, not infrastructure work.

## 3. Gating

PoC kickoff is **hard-gated** on G0 closure. Sprint-0 must complete every item in §11 (Sprint-0 prerequisites) before Slice 1's first commit.

## 4. Exit criteria

All five must hold simultaneously to declare PoC Green:

1. **Five scenarios pass as automated e2e tests** on a developer laptop (`make poc-e2e`), deterministic, <5 min wall-clock for the full suite:
   - **S-1 Happy path:** 1 call → operator answers → message saved → recording stored → delivery workflow completes.
   - **S-2 PCI pause/resume:** recording file has the silenced span; rejoined audio plays back without artifacts; `recording_redaction_interval` row records start/end timestamps.
   - **S-3 Caller hangs up mid-message:** recording finalizes cleanly; partial message persists; no orphan Asterisk channel.
   - **S-4 Operator declines, arbiter re-routes:** second operator's screen-pop arrives within ADR-0024 200 ms p95 budget; call completes.
   - **S-5 ARI leader failover mid-call:** standby leader takes over within S3-validated TTFOK + reconcile budget; call audio continues uninterrupted; no zombie channels.
2. **No layer is stubbed.** Asterisk + Kamailio + rtpengine real; NestJS arbiter real; Postgres + Supavisor real; Temporal real (self-host or Cloud per G0 path); CRM `/v1` endpoints real for whatever subset the 5 scenarios touch.
3. **Tenant scoping flows through every layer end-to-end.** Even with one provisioned tenant, every code path (SIP routing → arbiter → DB → CRM → recording) carries and asserts a `tenant_id`. (Multi-tenant *isolation tests* are out of scope; the *plumbing* is in scope.)
4. **All five scenarios run green in CI on every commit.** No "works on my machine."
5. **One architectural readout** at `poc/readout.md` documents what integrated cleanly, what required mid-flight design changes, and any new risks PoT didn't catch — same shape as PoT spike readouts.

**Out of exit criteria (deliberate cuts):** UX polish, billing, admin UI, tenant signup UX, observability dashboards (X05 / X09), multi-region, perf targets beyond what ADRs already set, load testing, security pen-test, compliance proof (AC #10 is Sprint 12–15).

## 5. Architecture & stack

Stack is locked by ARCH v0.4 and ratified ADRs. The PoC does not re-decide architecture — it implements a thin slice of the MVP module catalogue (§4.2) using the stack the PoT validated piecewise.

```
   PSTN/SIP test caller (SIPp test plan)
         │ INVITE
         ▼
   Kamailio (registrar + edge routing, S1-validated)            ┐
         │                                                       │
         ▼                                                       │
   Asterisk Model B + rtpengine (S1-validated)                   │   M16 / M18
         │ ARI events / Stasis                                   │
         ▼                                                       ┘
   ARI leader (S3-validated, ADR-0016)            ─── NestJS app ────┐
         │ NATS                                                       │
         ▼                                                            │   arbiter +
   NestJS arbiter (S2-validated, ADR-0024) — picks operator           │   /v1 facade
         │ WS event                                                   │
         ▼                                                            │
   F03 operator UI (Next.js App Router) ─── /v1 GET ──┐               │
         │ types message                              │               │
         ▼                                            ▼               │
   /v1 REST facade (M25) ──── reads ──── Postgres via Supavisor ──────┘
         │ writes                              (S5-validated, ADR-0018)
         ▼
   Postgres (single primary)
         │ on call hangup
         ▼
   Temporal workflow (S7 path — self-host or Cloud, per G0 closure)
         │ delivery (in-PoC: in-app WS toast to F03 "Sent Messages")
         ▼
   Recording pipeline (M10): MixMonitor → on-disk WAV → S3-equiv local bucket
                             PCI pause = silenced span via MixMonitor stop/start
                             + recording_redaction_interval row (operator-initiated)
```

ML redaction pipeline (ADR-0013 / S4) is **NOT** in the PoC tracer — it runs as a
separate pipeline in MVP Sprint 1–3 build-out of M10. See §5.2 cuts and §9 R2.

### 5.1 Module subset (extends ARCH v0.4 §4.2)

| Module | Why in PoC | What's deliberately thin |
|---|---|---|
| M16 Telephony (Asterisk + ARI leader) | every slice | dial-plan covers inbound → arbiter only; no IVR, no transfer |
| M18 SIP edge (Kamailio + rtpengine) | every slice | one inbound route; no registration UI; rtpengine kernel-bypass off |
| M30 Queue Routing | S1, S4 | `fifo` strategy only; no skills, overflow, priority |
| M03 Contacts | S1 | one seeded account + contact; no CRUD UI |
| M07 Messages | S1, S3 | one form; no media attachments |
| M08 Dispatch | S1 | single channel (in-app WS toast); not the 5-channel fanout |
| M10 Recordings + operator-initiated PCI pause logging | S1, S2, S3 | captures audio + writes `recording_redaction_interval` rows for operator pauses. ML redaction pipeline (ADR-0013 / S4) is **out of scope** — see §5.2. |
| M25 `/v1` REST facade | S1 | only the endpoints the screen-pop needs (Q4 below) |
| F03 Operator UI | S1, S4 | one screen: incoming-call screen-pop + message form + accept/decline + PCI pause toggle; no inbox, no tabs, no auth UI |
| Temporal workflow | S1 | one workflow `DispatchMessage` with one activity; default retry policy |

### 5.2 Explicit cuts (NOT in PoC)

- M01 Operator Home full panel set (only the screen-pop pane exists).
- **M10 ML redaction pipeline (ADR-0013 / S4).** Pipeline is Green by PoC kickoff (Sprint-0 work), but is not wired into the PoC tracer. It runs as its own MVP Sprint 1–3 deliverable against the corpus assembled during S4 Sprint-0 work. PoC asserts only operator-initiated PCI pause spans.
- M31 Voicemail, M32 IVR, M33 Inbound SMS — entire modules.
- M11 Reminders / Tasks.
- F04 Authoring, F05 Supervisor, F06 Client portal — entire frontends.
- Auth/RBAC beyond hardcoded JWT for one operator + one admin.
- Observability (X05 Homer + Prom + Jaeger, X09) — stdout structured logs only.
- i18n + a11y baseline (ADR-28) — Sprint 1–3 work.
- PHI-scrub middleware (ADR-29 / FR-AU5) — Sprint 1–3 work.
- Migration-assistance (M28) — entire module.

### 5.3 Deployment target

Local `docker compose up` on one host. `make poc-up` boots; `make poc-e2e` runs all 5 scenarios. Staging / cloud deploy is **not** a PoC exit criterion.

## 6. Slice plan

Five vertical scenario slices, one commit (or short chain) per slice on `main` (or `mvp/`). Each slice is TDD-shaped: red (new failing scenario) → green (minimum code to pass) → refactor (stay green). Prior slices' tests stay green at every commit.

### Slice 1 — Happy path (foundation slice; ~70% of total PoC effort, 2–3 weeks)

**Red:** `poc-e2e-s1-happy-path.spec.ts` — SIPp INVITE → expect operator-UI screen-pop, type a message, expect Postgres row + recording file + `DispatchMessage` workflow completed log line. Fails initially because nothing's wired.

**Green delta:**

- `infra/docker-compose.yml` with Kamailio, Asterisk, rtpengine, NestJS app, Postgres + Supavisor, Temporal, Caddy, MinIO.
- NestJS workspace skeleton: `apps/api` (hosts /v1 + arbiter + ARI leader — co-located at PoC scale).
- DB schema migrations: `tenant`, `account`, `contact`, `did`, `user`, `queue`, `queue_call`, `call`, `recording`, `recording_redaction_interval`, `message`, `dispatch_attempt`.
- Seed: 1 tenant, 1 account, 1 contact, 1 DID bound to 1 fifo queue with 1 operator.
- Kamailio dialplan: route INVITE for test DID into Asterisk.
- Asterisk Model B + ARI: `StasisStart` handler publishes NATS `telephony.event.stasis_start`.
- Arbiter: subscribes; picks the operator off `queue_call`; emits ARI `bridge.create` + `bridge.add_channel`; emits WS `incoming_call` to F03.
- F03 (Next.js App Router): one screen — incoming-call panel + message form + accept button. On WS event, GETs `/v1/Account/:id` + `/v1/Contact/:id` + `/v1/Form/:id`.
- Recording: MixMonitor on bridge create → WAV in MinIO; `recording` row created.
- Temporal worker: `DispatchMessage` workflow + one activity (in-app WS toast to F03 "Sent Messages" panel); marks `dispatch_attempt.delivered_at`.
- e2e harness: `apps/e2e` Playwright + SIPp orchestrator + assertion helpers.

### Slice 2 — PCI pause/resume (2–3 days)

**Red:** `poc-e2e-s2-pci-pause.spec.ts` — mid-call: operator clicks "Pause" → SIPp DTMF-injected card-number-shaped audio → operator clicks "Resume" → assert WAV has silenced span covering the pause window AND `recording_redaction_interval` row records start/end.

**Green delta:** F03 pause/resume button + WS commands. Arbiter ARI MixMonitor stop+restart on the call's bridge. e2e audio assertion helper (WAV silence detection, ±50 ms tolerance).

### Slice 3 — Caller hangs up mid-message (2–3 days)

**Red:** `poc-e2e-s3-caller-hangup.spec.ts` — SIPp INVITE → operator answers → SIPp BYE while operator is mid-typing → expect: recording file finalized; `call.ended_by = 'caller'`; in-flight draft persists when operator saves (`message.created_at` after `call.ended_at` is allowed); no orphan ARI channel.

**Green delta:** Asterisk graceful Stasis hangup handler (stop MixMonitor, finalize WAV, emit `StasisEnd`). Arbiter updates `call.ended_at`; does NOT cancel the UI session. F03 "Caller hung up" banner; message form stays active. ARI channels-empty assertion.

### Slice 4 — Operator declines, arbiter re-routes (3–5 days)

**Red:** `poc-e2e-s4-decline-reroute.spec.ts` — Add operator B to seed. SIPp INVITE → operator A receives screen-pop → A clicks Decline (or 10 s ring timeout) → expect operator B receives screen-pop within ADR-0024 200 ms p95 of decline → B answers → happy path completes.

**Green delta:** Seed adds operator B. F03 Decline button + WS command. Arbiter re-route logic — on decline or arbiter-side ring timeout, pick next operator, ARI bridge swap, WS to operator B. Maintains ADR-0024 budget. `queue_call.attempts` + `call.routed_through` chain.

### Slice 5 — ARI leader failover mid-call (~1 week; highest-risk slice)

**Red:** `poc-e2e-s5-leader-failover.spec.ts` — SIPp INVITE → connected → mid-call: `docker compose kill` the active NestJS leader → expect: standby leader takes over within S3-validated TTFOK (573 ms PoT-measured) + reconcile (1474 ms PoT-measured) budgets; RTP packets to rtpengine continued uninterrupted (media is independent of ARI); post-failover hangup `StasisEnd` fires; no zombie channels.

**Green delta:** Two NestJS instances in compose with NATS-based leader election (per ADR-0016 amendments: TTL > HB 3:1 ratio, multi-WS accepted). e2e process-kill helper + media-continuity assertion (RTP packet capture). Leader election state in Redis or Postgres (per ADR-0016).

### Slice effort sense

| Slice | Effort | Cumulative |
|---|---|---|
| 1 Happy path | 2–3 weeks | 2–3 weeks |
| 2 PCI pause | 2–3 days | ~3 weeks |
| 3 Caller hangup | 2–3 days | ~3.5 weeks |
| 4 Decline reroute | 3–5 days | ~4 weeks |
| 5 Leader failover | ~1 week | ~5 weeks |

**Total: 4–6 weeks honest** (4–5 weeks nominal + ±25% PRD §10.1 volatility).

## 7. Test harness

| Layer | Tool | Role |
|---|---|---|
| SIP caller | **SIPp** (inherits S1's `sipp-image/`) | Deterministic INVITE/BYE/DTMF scripting |
| Operator UI | **Playwright** (headless Chrome) | Hardcoded JWT, button clicks, WS event assertions |
| API/DB | **vitest** (or jest per NestJS scaffold default) | Drizzle/Prisma queries; assertions on row state, dispatch_attempt, redaction_interval |
| Recording file | Custom helper `apps/e2e/lib/audio.ts` (~50 LOC) | WAV silence detection vs expected window |
| Asterisk state | ARI REST queries | `/channels` empty assertions, leader-key inspection |
| Process chaos | `docker compose kill` + handoff helpers | Slice 5 only |

**Orchestrator:** `apps/e2e/scripts/run-scenario.ts` — boots SIPp + Playwright in parallel, executes both flows against the running stack, runs DB / file / ARI assertions. One pass/fail per scenario.

**Make targets:**

```
make poc-up           # docker compose up; healthchecks; seed
make poc-down         # tear down
make poc-e2e          # all 5 scenarios sequentially; <5 min
make poc-e2e-s1       # single scenario
make poc-readout      # scaffold readout.md from last run
```

**CI:** GitHub Actions workflow `poc-e2e.yml` runs `make poc-up && make poc-e2e` on every push to `main`/`mvp/*`. **Linux runner only** (Ubuntu); macOS not supported — S1/S8 surfaced macOS-Docker fragility, dev-laptop loop stays macOS but CI is canonical.

**Determinism rules (inherited from PoT discipline):**

- Every scenario produces `apps/e2e/results/<ISO-timestamp>/` with SIPp logs, Playwright trace, recording WAV, DB dump, ARI snapshot.
- Tests fail loud, no retries. Wall-clock budgets are upper-bound assertions.
- Deterministic seed (tenant + user IDs fixed); deterministic ports.

## 8. Repo layout

```
tas/
├── apps/
│   ├── api/              # NestJS — /v1 facade + arbiter + ARI leader
│   ├── web/              # Next.js App Router — F03 operator screen-pop
│   ├── temporal-worker/  # Temporal worker — DispatchMessage workflow
│   └── e2e/              # Playwright + SIPp orchestrator + helpers
├── packages/
│   ├── db/               # Drizzle schema + migrations + seed
│   ├── shared-types/     # Cross-app TS types
│   └── ari-client/       # Thin ARI WS client + leader election (ADR-0016)
├── infra/
│   ├── docker-compose.yml
│   ├── kamailio/         # inherits S1 patterns
│   ├── asterisk/         # inherits S1 patterns
│   ├── rtpengine/        # ng-control config
│   ├── caddy/            # inherits S8 ADR-0019 baseline
│   └── temporal/         # self-host fragment OR cloud-creds
├── pot/                  # KEPT until post-PoC; deleted only after PoC Green
├── docs/
│   ├── adr/
│   └── superpowers/specs/
└── tools/
```

**Workspace tool:** plain pnpm workspaces (Q1 decision, see §10).

## 9. Risks

| # | Risk | Slice that exposes it | Mitigation |
|---|---|---|---|
| R1 | rtpengine on Linux unverified (S1 Layer 2 deferred, macOS-fragile) | S1 | Sprint-0 executes S1 Layer 2 *before* PoC Slice 1 kickoff. Hard gate. |
| R2 | PoC validates **engineering** integration, not **compliance** integration. AC #10 is Sprint 12–15. | none (out of scope) | Be explicit in readout: PoC Green ≠ compliance ready. |
| R3 | No load. ADR-0024 200 ms p95 + S1 800 ms screen-pop budgets measured in PoT in isolation; PoC exercises once, not under contention. | all (single-call deep) | Flag explicitly; NFR-P1/P3 re-measured in MVP Sprint 1–3 per ARCH v0.4 §4.1. |
| R4 | Dev = macOS, CI = Linux drift; PoT surfaced env-specific fragility | all | CI is canonical. Local-only passes don't count for slice Green. |
| R5 | Slice 5 (leader failover) last concentrates highest composition risk late | S5 | Accepted tradeoff. Optional 1-day Slice 5 spike *before* Slice 1 if early de-risking wanted. |
| R6 | e2e suite rot — if PoC suite becomes legacy harness, MVP loses day-1 e2e gate | post-PoC | Plan baked in: PoC's `apps/e2e` *is* the MVP e2e harness; AC #1–#20 written against it. |
| R7 | G0-closure path uncertainty leaks into PoC scope (Path A vs Path B changes S6 endpoints + S7 Temporal target) | S1 | G0 path decided in Sprint 0, *before* PoC kickoff. |

## 10. Decisions (resolves open questions Q1–Q8)

Recommendations are written in as decisions. Q1–Q3 are durable MVP choices and are marked **pending Sprint-0 architect ratification**; Q4–Q8 are operational and resolve here.

| # | Decision | Status |
|---|---|---|
| Q1 | **Workspace tool:** plain pnpm workspaces. (Lowest fixed cost; Nx/Turbo caching wins matter at 20+ package size.) | Pending Sprint-0 architect ratification |
| Q2 | **Operator UI framework:** Next.js App Router. (F04/F06 will need SSR + routing; durable.) | Pending Sprint-0 architect ratification |
| Q3 | **Postgres ORM:** Drizzle. (Closest to raw SQL → ADR-29 PHI-scrub middleware lands cleanly.) | Pending Sprint-0 architect ratification |
| Q4 | **CRM `/v1` endpoint subset for Slice 1:** `/v1/Account/:id` + `/v1/Contact/:id` + `/v1/Form/:id`. Other endpoints deferred to MVP Sprint 4–11. | Decided |
| Q5 | **Spike chain merge timing:** PoT chain merges to `main` *before* Slice 1; PoC starts on clean `main`. | Decided |
| Q6 | **`pot/` retention:** kept until *after* PoC Green; readouts serve as forensic context for `poc/readout.md`. | Decided |
| Q7 | **Dispatch single-channel:** in-app WebSocket toast to F03 "Sent Messages" panel. Exercises WS round-trip needed for Sprint 4–7 inbox UI anyway. | Decided |
| Q8 | **Temporal target:** inherits whichever G0 path lands (self-host if Path B fallback adopted; Cloud if Path A vendor-landed). | Inherited from G0 |

## 11. Sprint-0 prerequisites (the hard gate before Slice 1 kickoff)

Every item must be checked before Slice 1 commit 1:

- [ ] All 8 PoT spikes Green or Deferred-with-fallback-plan signed off (senior architect + compliance lead)
- [ ] G0 enum decision made (Path A strict vs Path B pragmatic) and recorded
- [ ] ADR-0013 ratified (live AssemblyAI path OR fallback rewrite)
- [ ] ADR-0015 ratified (Temporal Cloud OR self-host fallback)
- [ ] S1 Layer 2 (rtpengine media smoke on Linux) executed and Green
- [ ] PoT spike chain merged to `main`; tags preserved
- [ ] G0 closure recorded in `pot/g0-closed.md` (or equivalent forensic note)
- [ ] Q1–Q3 architect-ratified (pnpm-workspaces / Next.js App Router / Drizzle)

PoC has **no** dependencies on Sprint-0 work *during* the PoC; once kickoff happens, Slice 1 runs uninterrupted.

## 12. Done definition (summary)

PoC is Green when all of:

1. Five e2e scenarios green in CI on `main` (or `mvp/main`).
2. All exit criteria in §4 hold.
3. `poc/readout.md` committed, mirroring the PoT readout shape (what integrated cleanly / what required mid-flight design changes / new risks surfaced).
4. Senior architect sign-off recorded in the readout.

After PoC Green: `pot/` directories are deleted; MVP Sprint 1–3 (Foundations) begins on the same codebase; AC #1–#20 are written against `apps/e2e` over Sprints 1–15.

---

*Spec written 2026-05-13. Next step: writing-plans skill produces an implementation plan from this spec for Sprint-0 closure + Slice-1 kickoff.*
