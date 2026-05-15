# Local-runnable MVP — chunk-level execution plan

> Status: **Approved (user-confirmed 2026-05-14)** · Date: 2026-05-14 · Owner: founder (solo) · Source spec: [`docs/superpowers/specs/2026-05-13-poc-tracer-bullet-design.md`](./2026-05-13-poc-tracer-bullet-design.md) · Existing Slice-1 plan: [`docs/superpowers/plans/2026-05-13-poc-slice1-foundation.md`](../plans/2026-05-13-poc-slice1-foundation.md) · ADRs: [`docs/adr/`](../../adr/) (0013, 0015–0016, 0018–0019, 0024)

## 0. Scope and framing

This document is a **chunk-level execution plan** for the local-runnable MVP. It does *not* re-decide architecture — the PoC tracer-bullet spec (2026-05-13) is the source of truth for what gets built; this document decides *how the work is sliced into executable units*.

**Settled scope (user-confirmed, do not re-litigate):**

1. **Scope = PoC tracer-bullet** (5 scenario slices S-1..S-5). PoC §5.2 explicit cuts stay cut.
2. **Chunk 0 absorbs Sprint-0 gate closure**: G0 enum sign-off, ADR-0013 + ADR-0015 disposition, S1 Layer-2 rtpengine on Linux executed Green, S4 ML pipeline Green, Q1-Q3 ratification. Solo founder acts as architect + compliance lead.
3. **Debug model = hybrid**: `apps/api`, `apps/web`, `apps/temporal-worker` run on host via `pnpm` with VS Code attach (port 9229 etc.). Asterisk + Kamailio + rtpengine + Postgres + Supavisor + Temporal + MinIO + Caddy + **Redis** + NATS in `docker compose`. A `make poc-up-all-docker` target boots the apps inside compose for CI / clean-repro parity. Local dev = macOS; canonical CI = Linux (per PoC §7).

**How this document was produced:** a planner subagent and an independent verifier subagent iterated three rounds, each self-critiquing with a calibrated 0-100 confidence score. Round 3 converged at planner=91, verifier=90 ("ship"). Iteration artifacts are at `.scratch/mvp-loop/`.

---

## 1. Chunks

### Chunk 0 — Sprint-0 gate closure

- **Goal:** Ratify all Sprint-0 prerequisites so Slice-1 kickoff is unblocked.
- **Scope:**
  - G0 enum sign-off (Path B Pragmatic) — architect + compliance lead signatures on `pot/g0-closed.md`
  - ADR-0013 ratified (S4 compliance: Option A acquire AssemblyAI key OR Option C disable recording for HIPAA tenants)
  - ADR-0015: **verify** partial-check evidence already filed (`docs/adr/0015-sdk-identity-evidence.md`); confirm self-host path is Green; decide Cloud-side SDK identity disposition — either (a) run `sprint-0/temporal-sdk-validation/` worker against a Cloud sandbox and upgrade evidence to full, or (b) file `docs/adr/0015-cloud-sdk-deferred.md` with written justification (Temporal published portability claim + Open Risk #4 acknowledged). One of the two outputs required to close Chunk 0.
  - S1 Layer-2 rtpengine media smoke executed Green on Linux host
  - Q1–Q3 architect-ratified (pnpm / Next.js App Router / Drizzle recorded in `g0-closed.md`)
  - PoT spike chain merged to `main`; spike dirs deleted per ARCH §2.4
  - `pot/g0-closed.md` committed
- **Out of scope:** any application code, any Docker Compose wiring, any UI.
- **Deliverable:** `pot/g0-closed.md` committed on `main`; ADR-0015 Cloud-side disposition file present.
- **Exit criteria:**
  - `grep 'G0 closed' pot/g0-closed.md` exits 0
  - `grep '\*\*Status:\*\* Accepted' docs/adr/0013-redaction-pipeline.md` exits 0
  - `grep '\*\*Status:\*\* Accepted' docs/adr/0015-temporal-cloud-tier.md` exits 0 (already true — verify it stayed)
  - One of: `docs/adr/0015-sdk-identity-evidence.md` shows Cloud run log OR `docs/adr/0015-cloud-sdk-deferred.md` present with written justification
  - S1 Layer-2 Linux readout file present in `pot/S1-telephony-happy-path/results/`
  - Slice-1 plan Task 0 checklist passes in full (steps 1–8)
- **Effort:** 3–5 days (calendar-bound: compliance review + architect sign-off; Cloud-side SDK disposition adds ≤1 day if sandbox is available, 0 days if deferral chosen).
- **Dependencies:** none (root).
- **Risks:**
  - S4 compliance sub-decision could extend beyond 2 weeks (RISKS.v0.2 N1). Mitigation: ADR-0013 Option C is the fast-path fallback.
  - Cloud-side SDK validation may be blocked by sandbox availability. Mitigation: deferral path is pre-approved; no blockage to chunk if justification doc is filed.

---

### Chunk 1 — Monorepo skeleton + infra compose

- **Goal:** Boot the full docker-compose stack and confirm every service is healthy.
- **Scope:**
  - pnpm workspace root + `tsconfig.base` (Slice-1 plan Task 1)
  - `packages/db` Drizzle scaffold + schema migrations (Tasks 2–5) + seed script (Task 6)
  - `infra/docker-compose.yml` with Kamailio, Asterisk, rtpengine, Postgres+Supavisor, NATS, **Redis**, Temporal self-host, MinIO, Caddy (Tasks 7–14). Redis: `redis:7-alpine`, healthcheck `redis-cli ping`, port 6379 published. ADR-0016 §Decision item 1 satisfied.
  - `infra/caddy/Caddyfile.local` using `tls internal` — self-signed cert for `localhost` and `*.localhost`. No `on_demand_tls.ask`, no LE interaction. Note in file header: "Local dev only; production uses ADR-0019 HAProxy+Caddy chain."
  - `Makefile` with `poc-up`, `poc-down`, `poc-seed` targets (Task 15)
  - `make poc-up` smoke: all services healthy; `make poc-seed` idempotent; Temporal `default` namespace created
- **Out of scope:** NestJS app code, Next.js app, e2e harness, any scenario test.
- **Deliverable:** `make poc-up && make poc-seed` exits 0 with all Docker healthchecks green on macOS host.
- **Exit criteria:**
  - `docker compose ps` shows all services healthy **including Redis**
  - `redis-cli -p 6379 ping` returns PONG
  - `psql` can connect through Supavisor; `drizzle-kit migrate` exits 0; seed inserts 1 tenant / 1 operator / 1 DID / 1 queue
  - Temporal `temporal workflow list` returns empty (not error)
  - MinIO bucket accessible at `localhost:9000`
  - `Caddyfile.local` present; `curl -k https://localhost` returns Caddy response (no LE request fired)
  - Debuggable on host: `pnpm --filter @ncall/db run seed` connects to compose Postgres
- **Effort:** 4–5 days.
- **Dependencies:** Chunk 0.
- **Risks:**
  - Kamailio / rtpengine configs from `pot/S1` may need Linux-specific tuning. Mitigation: verify both macOS dev loop and Linux CI at this chunk.

---

### Chunk 2 — NestJS API skeleton + /v1 facade

- **Goal:** NestJS `apps/api` runs on host (port 3000) with debugger attach and unit tests green in CI without a live compose stack.
- **Scope:**
  - `apps/api` NestJS scaffold + hardcoded JWT guard (Tasks 16–20)
  - `/v1/Account/:id`, `/v1/Contact/:id`, `/v1/Form/:id`, `POST /v1/Message` — real Drizzle queries against compose Postgres (host dev) OR testcontainers Postgres (unit test context)
  - `packages/shared-types` (REST DTOs, NATS event types, WS event types)
  - Unit tests (vitest): use **testcontainers** (`@testcontainers/postgresql`) to spin up an ephemeral Postgres per test run — no live compose required in CI `pnpm test`. Testcontainers images pulled once; cached in CI by layer cache. **`apps/api/test/vitest.globalSetup.ts`** runs `drizzle-kit migrate` against the testcontainers Postgres connection string before any test suite; without this step, tests fail with "relation does not exist".
  - Integration tests (hitting compose Postgres) live under `test/integration/` and are gated by `make poc-up` — run in Chunk 5's CI step, not in plain `pnpm test`.
  - `pnpm --filter @ncall/api run dev` with `--inspect` on port 9229
  - **S6 trigger rule:** If `/v1/Account/:id` controller in Chunk 2 requires a recorded CRM fixture response to pass its unit tests, assign S6 cache-scraper stub work to Chunk 2 scope at that point. Otherwise S6 stays unowned for the PoC.
- **Out of scope:** NATS wiring, ARI client, WebSocket gateway, Temporal worker, F03 UI.
- **Deliverable:** `pnpm --filter @ncall/api run test` green in CI (no compose required); API reachable at `localhost:3000/v1/Account/1` with seeded data on dev.
- **Exit criteria:**
  - Unit tests red → green (TDD slices) via testcontainers — confirmed in `pnpm test` CI step without `make poc-up`; `vitest.globalSetup.ts` runs `drizzle-kit migrate` before suite
  - VS Code "Attach to API" launch config works (port 9229, breakpoint in AccountController hits)
  - `make poc-up` running; `curl localhost:3000/v1/Account/1` returns seeded account JSON
- **Effort:** 3–4 days.
- **Dependencies:** Chunk 1 (compose + seed for dev; testcontainers for unit tests are independent).
- **Risks:** Testcontainers cold-pull on CI first run; mitigate with GH Actions `docker/setup-buildx-action` layer cache or pre-pull in workflow.

---

### Chunk 3 — Telephony wiring: ARI leader + arbiter + NATS + WebSocket

- **Goal:** A real SIPp INVITE through compose Kamailio→Asterisk fires a `StasisStart`, arbiter picks the seeded operator, and a WebSocket `incoming_call` event arrives at a connected client. **Automated test gate exits red before wiring, green after.**
- **Scope:**
  - NATS client in `apps/api` (Task 21)
  - `packages/ari-client` thin wrapper with Redis-backed leader election (Task 22); TTL = 1500 ms, HB = 500 ms (3:1 ratio per ADR-0016)
  - **Unit test for ARI leader hard-stop** (in `packages/ari-client/test/leader-hardstop.spec.ts`): simulates lease-loss via mock Redis returning "lost lease"; asserts WS close callback fires within 100 ms — red before ari-client lease logic, green after. Satisfies ADR-0016 / RISKS.v0.2 N4 **callback-path only**. Note: this unit test verifies the callback-path latency only. Real wire-level FIN < 100 ms evidence (ADR-0016 §Decision item 3) is produced by the Chunk 7 S-5 spec running two real NestJS instances against real Redis. See Chunk 7 scope.
  - StasisStart handler (Task 23); Arbiter service (Tasks 24–25); WS gateway (Task 25); Recording service: MixMonitor → WAV in MinIO, `recording` row (Task 26)
  - **Vitest integration test** (`apps/api/test/integration/chunk3-smoke.spec.ts`): uses compose stack; sends SIPp INVITE; asserts (a) `stasis_start` NATS message received, (b) WS client receives `incoming_call` event within 800 ms (ADR-0024 budget), **(c) WS event payload has `event.type === 'incoming_call'` AND `event.callId` matches UUID v4 pattern AND `event.tenantId === seeded-tenant-id`** (eliminates false-green from stub emission). Marked `@requires-compose`; runs via `make poc-test-chunk3`, not plain `pnpm test`. Red on empty compose, green after Chunk 3 wired. Cross-link: Chunk 7 produces ADR-0016 wire-level FIN evidence.
  - Manual smoke scenario documented in `poc/smoke-chunk3.md`
- **Out of scope:** F03 UI, Temporal workflow, e2e automation, leader failover.
- **Deliverable:** `make poc-test-chunk3` green; manual smoke in `poc/smoke-chunk3.md`; `queue_call` + `recording` rows present.
- **Exit criteria:**
  - Leader hard-stop unit test red → green (TDD, no compose needed); caveat: verifies callback path only, not wire-level FIN (see Chunk 7)
  - `make poc-test-chunk3` (integration): SIPp INVITE → NATS message + WS event within 800 ms, both asserted; WS payload asserts `event.type === 'incoming_call'`, `event.callId` UUID v4, `event.tenantId === seeded-tenant-id`
  - `recording` row created in Postgres with correct `tenant_id`; `queue_call` row has correct `tenant_id`; WAV file appears in MinIO
  - All services debuggable on host (api + NATS visible in VS Code)
- **Effort:** 5–7 days.
- **Dependencies:** Chunk 2 (NestJS API), Chunk 1 (compose stack + Redis).
- **Risks:**
  - ARI reconnection / leader reconciliation under compose restarts. Mitigation: no leader failover yet (Chunk 7); single instance sufficient.
  - rtpengine ng-control handshake timing. Mitigation: log every ng-control exchange; inherited from pot/S1 configs.

---

### Chunk 4 — F03 operator UI + Temporal worker

- **Goal:** Operator browser screen-pop accepts a call, types a message, and `DispatchMessage` Temporal workflow completes — all observable end-to-end without e2e automation.
- **Scope:**
  - `apps/web` Next.js App Router scaffold (Tasks 27–30): incoming-call panel + message form + accept + PCI pause toggle stub
  - WebSocket client in browser (`lib/ws.ts`) — connects to api WS gateway, renders screen-pop on `incoming_call`
  - `apps/temporal-worker` — `DispatchMessage` workflow + in-app WS delivery activity (Tasks 31–32)
  - `POST /v1/Message` inserts row + triggers `DispatchMessage` workflow start
  - `dispatch_attempt.delivered_at` set on workflow completion
  - `apps/web` runs on host port 3001 with Next.js hot reload
- **Out of scope:** PCI pause/resume logic (Chunk 6), decline/re-route (Chunk 6), leader failover (Chunk 7), e2e harness wiring.
- **Deliverable:** Manual walkthrough: SIPp INVITE → browser shows screen-pop → operator types message → submit → Temporal workflow log shows completed → `dispatch_attempt` row shows `delivered_at`.
- **Exit criteria:**
  - `DispatchMessage` unit test (vitest) red → green (TDD)
  - **SDK identity regression check:** first `DispatchMessage` workflow execution produces zero version-skew error in Temporal worker logs, confirmed by: `grep -E 'version.*mismatch|sdk.*incompatible|proto.*incompatible|registration.*mismatch' worker.log` exits 0 (no matches). If self-host-only deferral was chosen in Chunk 0, note it here and confirm matching SDK version across worker + self-host server.
  - Browser screen-pop renders within 800 ms of INVITE (observe via DevTools Network)
  - Temporal Web UI (`localhost:8080`) shows `DispatchMessage` workflow Completed
  - `dispatch_attempt.delivered_at` non-null in Postgres
  - `pnpm --filter @ncall/web run dev` + `pnpm --filter @ncall/temporal-worker run dev` both debuggable on host
- **Effort:** 4–5 days.
- **Dependencies:** Chunk 3 (NATS + WS + ARI wiring), Chunk 1 (Temporal in compose).
- **Risks:** SDK identity open risk (ADR-0015 Open Risk #4) surfaces here if Cloud-side deferral was chosen. Bounded: divergence caught by exit criterion grep; fix is connection-string change, not workflow code change.

---

### Chunk 5 — e2e harness + S-1 CI green

- **Goal:** `make poc-e2e-s1` passes in CI (Linux) deterministically.
- **Scope:**
  - `apps/e2e` scaffold: Playwright config, SIPp orchestrator, `run-scenario.ts` (Tasks 33–35)
  - SIPp Docker image + `happy-path.xml` scenario (Task 34)
  - Assertion helpers: DB queries (with `tenant_id` check), ARI channel check, recording file check (Task 35)
  - `poc-e2e-s1-happy-path.spec.ts` — includes explicit `tenant_id` assertion: every DB row (call, recording, dispatch_attempt) and every NATS/WS event carries `tenant_id = seeded-tenant-id` (spec §4 exit criterion 3)
  - GitHub Actions `poc-e2e.yml` — Linux Ubuntu runner: `make poc-up && pnpm --filter @ncall/api run test && make poc-e2e` (unit tests with testcontainers + integration harness)
  - **`make poc-up-all-docker`** task: Dockerfiles for `apps/api`, `apps/web`, `apps/temporal-worker` + `docker-compose.all-in.yml` override file. Three Dockerfiles required before this target can exit 0. Named deliverable, not absorbed text.
  - `poc/readout-slice1.md` scaffolded (Task 39)
- **Out of scope:** S-2 through S-5 scenarios.
- **Deliverable:** `poc-e2e-s1-happy-path` green in GitHub Actions on every push to `mvp/*`.
- **Exit criteria:**
  - `make poc-e2e-s1` exits 0 locally on macOS (hybrid mode)
  - CI run green on Linux — `pnpm test` step (testcontainers) passes; `make poc-e2e-s1` passes
  - `tenant_id` assertion passes in S-1 spec
  - `make poc-up-all-docker` exits 0 on Linux
  - Results artifact committed; `poc/readout-slice1.md` committed
- **Effort:** 5–6 days (4–5 base + 1 day for Dockerfiles / all-in-docker target).
- **Dependencies:** Chunk 4 (full S-1 path working manually).
- **Risks:** testcontainers cold-pull in CI; SIPp timing sensitivity.

---

### Chunk 6 — Slices 2, 3, 4 (PCI pause + caller hangup + decline reroute)

- **Goal:** Three additional e2e scenarios green in CI; suite wall-clock < 3.5 min for S-1 through S-4.
- **Scope:**
  - **S-2 PCI pause/resume**: F03 pause/resume → MixMonitor stop+restart → `apps/e2e/lib/audio.ts` WAV silence detection. **MinIO object poll**: before silence detection, poll `s3.headObject` for the WAV ETag until present, with a documented upper bound of 10 s (100 ms intervals × 100 retries = 10 s); test fails if not present within bound. No arbitrary sleeps. `recording_redaction_interval` row assertions + `tenant_id` check.
  - **S-3 caller hangup**: StasisEnd handler → recording finalized → `call.ended_by='caller'` → no orphan channels → F03 "Caller hung up" banner. `tenant_id` check on call row.
  - **S-4 decline reroute**: seed operator B → F03 Decline → arbiter re-route → `queue_call.attempts` chain → screen-pop to operator B within ADR-0024 200 ms p95. `tenant_id` check on both attempts.
  - Three e2e spec files; S-1 stays green throughout.
  - **Wall-clock benchmark**: after S-4 lands, `make poc-e2e` (S-1 through S-4) must run < 3.5 min. If exceeded, flag immediately and pause Chunk 7 until resolved — do not defer detection to Chunk 7.
- **Out of scope:** leader failover (Chunk 7), ML redaction pipeline (spec §5.2 cut), multi-tenant isolation.
- **Deliverable:** `make poc-e2e` exits 0 for scenarios 1–4 in CI in < 3.5 min.
- **Exit criteria:**
  - All three new specs red → green (TDD)
  - **Per-scenario wall-clock budgets** (each scenario asserts its own ceiling in addition to the aggregate): S-1 ≤ 75 s, S-2 ≤ 60 s (including MinIO ETag poll; poll upper bound is 10 s, leaving 50 s for call setup + DTMF + silence assertion), S-3 ≤ 45 s, S-4 ≤ 30 s. Sum = 210 s ≤ 3.5 min; headroom for S-5 preserves total < 5 min. Each spec times itself and fails if its ceiling is exceeded.
  - WAV silence-detection: MinIO ETag poll exits before 10 s upper bound (grounded in S-2 ≤ 60 s budget; 10 s poll is a hard inner bound within that envelope); ±50 ms tolerance asserted
  - ADR-0024 200 ms p95 screen-pop assertion in S-4 (real-clock, not mocked)
  - `tenant_id` assertion in all three new specs
  - `make poc-e2e` (S-1..S-4) wall-clock < 3.5 min (measured in CI, flagged immediately if missed)
  - CI green on Linux for all four scenarios
- **Effort:** 7–9 days.
- **Dependencies:** Chunk 5.
- **Risks:**
  - S-4 200 ms ADR-0024 budget tight under compose latency. Mitigation: p95 over 10 runs; NFR-P3 re-measured in MVP Sprint 1–3 if needed.
  - MinIO write latency may approach 10 s upper bound under CI load. Mitigation: alert in PR if poll approaches 8 s; tune upper bound in follow-on if triggered. Per-scenario budget (S-2 ≤ 60 s) makes the interaction between poll latency and the 3.5 min gate diagnosable.

---

### Chunk 7 — Slice 5: ARI leader failover + PoC readout

- **Goal:** S-5 leader failover scenario green in CI; full suite < 5 min; PoC declared Green.
- **Scope:**
  - Two NestJS instances in compose with Redis-backed leader election (ADR-0016, 3:1 TTL/HB)
  - `poc-e2e-s5-leader-failover.spec.ts`: `docker compose kill` active leader → standby takes over within TTFOK 573 ms + reconcile 1474 ms → StasisEnd fires → no zombie channels. `tenant_id` check on post-failover call row. **This spec also produces ADR-0016 §Decision item 3 wire-level FIN < 100 ms evidence**: two real NestJS instances run against real Redis, and `tcpdump` (or equivalent packet-capture helper) confirms FIN arrives within 100 ms of lease expiry. This evidence is not produced by the Chunk 3 mock-Redis unit test; see Chunk 3 caveat.
  - RTP continuity assertion (Asterisk RTP stats or packet-capture helper)
  - `poc/readout.md` — full PoC readout; architect sign-off line
  - All-five `make poc-e2e` < 5 min wall-clock (spec §4 exit criterion 1)
- **Out of scope:** anything beyond spec §12 done definition; MVP Sprint 1–3 work.
- **Deliverable:** `make poc-e2e` exits 0 for all 5 scenarios < 5 min; `poc/readout.md` committed with sign-off.
- **Exit criteria:**
  - `poc-e2e-s5-leader-failover` red → green (TDD)
  - Standby takeover within TTFOK + reconcile budgets asserted in test
  - No zombie channels post-failover
  - **ADR-0016 §Decision item 3 wire-level FIN < 100 ms** confirmed in S-5 spec (real Redis, real NestJS instances, packet-capture evidence)
  - `tenant_id` assertion in S-5 spec
  - All 5 scenarios green in CI; wall-clock < 5 min
  - `poc/readout.md` committed with architect sign-off
- **Effort:** 6–7 days.
- **Dependencies:** Chunk 6.
- **Risks:**
  - Leader election under compose process-kill non-deterministic; 3:1 TTL/HB ratio mitigates.
  - `docker compose kill` timing affects RTP continuity assertion; 200 ms grace in continuity window.

---

## 2. Total effort + critical path

- **Total:** 37–48 days (~8–10 weeks elapsed for a solo founder). Chunk 0: 3–5 d; Chunk 1: 4–5 d; Chunk 2: 3–4 d; Chunk 3: 5–7 d; Chunk 4: 4–5 d; Chunk 5: 5–6 d; Chunk 6: 7–9 d; Chunk 7: 6–7 d. Spec §6 estimated 4–6 weeks for slices 1–5; the discrepancy is honest — testcontainers setup, Chunk 3 integration test harness, explicit Dockerfiles, and Chunk 0 gate closure are real costs the spec did not enumerate.
- **Critical path:** Chunk 0 → Chunk 1 → Chunk 3 → Chunk 4 → Chunk 5 → Chunk 6 → Chunk 7.
- **Parallelisable:** Chunk 2 can start once pnpm workspace exists (Chunk 1 Task 1). Chunk 4's temporal-worker can scaffold in parallel with Chunk 3, joining at WS gateway.

---

## 3. How the local debug story holds together

`apps/api` (port 3000, `--inspect` 9229), `apps/web` (port 3001, Next.js dev), and `apps/temporal-worker` run via `pnpm` on the macOS host. All infra (Asterisk, Kamailio, rtpengine, Postgres+Supavisor, NATS, **Redis**, Temporal, MinIO, Caddy) runs inside `docker compose up`. Host apps connect via `localhost:*` published ports. Unit tests (Chunks 2–4) use testcontainers — compose not required. `make poc-test-chunk3` integration tests require compose. CI always runs `make poc-up-all-docker` (all-in-docker) for parity; Linux is canonical for CI pass/fail.

---

## 4. Tenant-id e2e plumbing

Every e2e spec (Chunks 5, 6, 7) asserts `tenant_id` directly via a shared assertion helper `apps/e2e/lib/assert-tenant.ts`. The helper accepts a DB client and an expected `tenant_id` (the seeded tenant), then queries each relevant table (`call`, `recording`, `dispatch_attempt`, `queue_call`, `recording_redaction_interval`) post-scenario and asserts every row's `tenant_id` matches. WS and NATS event payloads are additionally sniffed for a `tenantId` field. The assertion is called once per spec as a post-scenario block, satisfying spec §4 exit criterion 3 across all scenarios without duplicating row-level checks.

Chunk 3's `chunk3-smoke.spec.ts` lives in `apps/api/test/integration/` rather than `apps/e2e/`. To avoid cross-package imports, Chunk 3 either (a) duplicates the row-level checks inline for `recording` and `queue_call` only (correctness preserved; ~10 LOC duplication), or (b) lifts the helper to a `packages/test-helpers` sibling. **Decision to be made on Chunk 3 implementation day** — both are valid; (a) is the lower-friction default.

---

## 5. Residual risks (acknowledged, not blocking)

These were surfaced by verifier-v3 as LOW-severity. They do not block execution but should be tracked.

1. **Chunk 3 (5–7 days) underestimate risk.** ARI + NATS + Redis + bridging + integration test harness in one chunk is high complexity. The integration test stub adds ~0.5 days; real risk is the ARI bridging glue. Historical context: pot/S1 surfaced macOS Docker fragility and rtpengine kernel-bypass concerns. Mitigation: if Chunk 3 exceeds 8 days, pause and re-scope before Chunk 4.
2. **Testcontainers pull time in CI.** First CI run without layer cache can add 2–4 min. Mitigated by GH Actions cache config but not eliminated.
3. **S-1 ≤ 75 s budget not derived from measurement.** Plausible but unverified. Mitigation: if S-1 exceeds 75 s on macOS during Chunk 5 development, adjust the per-scenario ceiling before Chunk 6's wall-clock gate is wired.
4. **`registration.*mismatch` regex** in the Chunk 4 SDK-skew grep may have false-positive risk against NestJS module-registration log lines. Bounded: false negatives are the real failure mode (grep exits 0 on no match — the safe direction), and Temporal SDK skew more commonly emits proto errors.
5. **S6 CRM cache-scraper remains unowned.** Trigger rule in Chunk 2 captures the only realistic surface; if not triggered, S6 work is deferred past the PoC.

---

## 6. What's next

Per superpowers:writing-plans, this design spec is the input for per-chunk implementation plans. Recommended order:

1. Implementation plan for Chunk 0 (Sprint-0 gate closure) — needed first.
2. Implementation plan for Chunk 1 (monorepo skeleton + infra compose) — largest deterministic chunk; benefits most from upfront task decomposition.
3. Subsequent chunks: produce implementation plans just-in-time at chunk kickoff, so that mid-flight learnings from earlier chunks shape later ones.

---

*Spec written 2026-05-14. Produced via a planner+verifier subagent loop (3 rounds, planner=91 / verifier=90 at convergence). Iteration artifacts retained at `.scratch/mvp-loop/`.*
