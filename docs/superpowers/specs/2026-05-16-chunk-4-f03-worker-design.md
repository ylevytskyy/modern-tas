# Chunk 4 — F03 operator UI + Temporal worker (design spec)

> Status: **Draft (pending user review)** · Date: 2026-05-16 · Owner: founder (solo) · Branch: `mvp/chunk-4-f03-worker` · Source: [`docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md`](./2026-05-14-local-mvp-chunk-plan-design.md) §"Chunk 4" · Prior chunks closed in `40182a6`.

## 0. Scope and framing

This document is the **design spec for Chunk 4** of the local-runnable MVP. The master chunk-plan (2026-05-14) fixes the chunk's goal, scope, and exit criteria; this spec fleshes out architecture, component boundaries, test layers, error handling, and the parallel subagent dispatch plan that will drive implementation.

**What this chunk delivers:** A real SIP INVITE through the running compose stack reaches the seeded operator on `http://localhost:3001`, the screen-pop renders within 800 ms, the operator types a message, submits, and the `DispatchMessage` Temporal workflow runs to completion — `dispatch_attempt.delivered_at` becomes non-null, the workflow is visible as Completed in Temporal Web UI. End-to-end observable, no e2e harness (Chunk 5 owns that).

**Settled procedural decisions (this brainstorm session):**

1. **One plan covers both apps** (`apps/web` + `apps/temporal-worker`). The demo deliverable requires both; tasks parallelise inside via subagent dispatch.
2. **Feature branch `mvp/chunk-4-f03-worker`**; merge to main at chunk close. PoT-phase direct-to-main convention ends here.
3. **Vitest component tests with mocked WS** on the web side; no Playwright in Chunk 4 (explicit Chunk 5 scope).
4. **Dev-only `GET /v1/dev/operator-token`** endpoint in `apps/api` for JWT issuance; scales to Chunk 6's operator B by query param.
5. **PCI pause toggle = local component state** only; no backend coupling. Chunk 6 wires the MixMonitor stop/restart path.
6. **Demo artifact = `poc/smoke-chunk4.md`** mirroring `poc/smoke-chunk3.md`.

## 1. Goal & exit criteria

**Goal:** End-to-end manual walkthrough is green: INVITE → screen-pop within 800 ms → operator submits message → `DispatchMessage` workflow completes → `dispatch_attempt.delivered_at` non-null. No e2e automation.

**Exit criteria:**

1. `DispatchMessage` workflow vitest test red → green (TDD).
2. `apps/web` component tests red → green:
   - `ScreenPop` renders on mocked `call.screen-pop` event;
   - `MessageForm` POSTs to `/v1/Message` with Bearer JWT;
   - Accept and PCI-pause toggles flip local state.
   Mocked WS, no compose required.
3. SDK identity regression grep on the running worker log:
   ```
   grep -E 'version.*mismatch|sdk.*incompatible|proto.*incompatible|registration.*mismatch' \
     apps/temporal-worker/worker.log
   ```
   exits 0 (no match) after the first `DispatchMessage` execution. Self-host baseline path per [ADR-0015-cloud-sdk-deferred](../../adr/0015-cloud-sdk-deferred.md).
4. Browser screen-pop renders within 800 ms of INVITE — observed in DevTools Network panel; recorded in `poc/smoke-chunk4.md`.
5. Temporal Web UI (`http://localhost:8080`) shows the workflow Completed.
6. `dispatch_attempt.delivered_at` is non-null in Postgres for the demo run.
7. `pnpm --filter @tas/web run dev` (port 3001, Next.js) and `pnpm --filter @tas/temporal-worker run dev` (with `--inspect`) both attach in VS Code.

## 2. Architecture

### 2.1 Workspace layout

```
apps/
  web/                              # Next.js App Router, port 3001
    app/
      layout.tsx                    # server component, RootLayout
      operator/page.tsx             # 'use client', mounts ScreenPop
    lib/
      ws.ts                         # WebSocket client, {event,data} envelope parser
      api.ts                        # fetch wrapper, attaches Bearer JWT
      token.ts                      # fetches /v1/dev/operator-token on mount
    components/
      ScreenPop.tsx                 # incoming-call panel, Accept, PCI-pause toggle
      MessageForm.tsx               # textarea + submit → POST /v1/Message
    test/
      ScreenPop.spec.tsx
      MessageForm.spec.tsx
      ws-client.spec.ts

  temporal-worker/
    src/
      worker.ts                     # @temporalio/worker, taskQueue 'dispatch-message'
      workflows/
        dispatch-message.ts         # DispatchMessage workflow
      activities/
        deliver-via-ws.ts           # POST /internal/dispatch-deliver
        mark-delivered.ts           # UPDATE dispatch_attempt SET delivered_at
    test/
      dispatch-message.spec.ts      # @temporalio/testing
      deliver-via-ws.spec.ts        # mocked fetch
      mark-delivered.spec.ts        # testcontainers PG
```

### 2.2 Changes to `apps/api` (existing from Chunk 2/3)

- **`POST /v1/Message`** — currently inserts the message row. Add: inject the singleton `TemporalClient` from `TemporalModule`, call `client.workflow.start('DispatchMessage', { args: [{ messageId, operatorId, tenantId }], taskQueue: 'dispatch-message', workflowId: \`dispatch-${messageId}\` })`. Returns 201 with `{ messageId, workflowId }`.
- **`GET /v1/dev/operator-token?operatorId=:id`** — new dev-only route. Guard: `NODE_ENV !== 'production'` → returns 404 in prod. Mints HS256 JWT signed with `APP_JWT_SECRET`; payload `{ sub: operatorId, tenantId, role: 'operator' }`; **no `exp` claim is set** — the token never expires, accepted only because PoC dev parity outweighs key-rotation hygiene at this stage.
- **`POST /internal/dispatch-deliver`** — new route called by the worker activity. Header `X-Internal-Token` must match `INTERNAL_API_TOKEN` env (random hex, set in compose `.env`). Body: `{ operatorId, payload }`. Pushes through existing `WsGateway.sendToOperator(operatorId, payload)`. Returns 200 with `{ delivered: bool }` based on `WsGateway` socket-OPEN check.
- **`TemporalModule`** — new NestJS module wrapping `@temporalio/client` `Connection.connect()` + `Client` instantiation; lifecycle bound to `OnApplicationShutdown`. Pattern mirrors existing `NatsClientService`.

### 2.3 Data flow (happy path)

```
SIPp / pjsua INVITE
   ↓
Kamailio → Asterisk                                    (compose)
   ↓ ARI StasisStart
apps/api: StasisStartHandler → Arbiter
   ↓ NATS 'stasis.start' (Chunk 3 wire)
apps/api: WsGateway.sendToOperator(operatorId, {callId,...})
   ↓ WS frame {event:'call.screen-pop', data:{...}}
apps/web/lib/ws.ts → ScreenPop renders                 (≤800 ms budget)
   ↓ operator clicks Accept, types message, submits
apps/web → POST /v1/Message  (Bearer JWT)
   ↓
apps/api: MessageController
   → INSERT message row
   → temporalClient.workflow.start('DispatchMessage', {messageId,...})
   ↓
apps/temporal-worker: DispatchMessage workflow
   → activity deliver-via-ws → POST /internal/dispatch-deliver (X-Internal-Token)
       ↓ apps/api: WsGateway.sendToOperator(...)
   → activity mark-delivered → UPDATE dispatch_attempt SET delivered_at = now()
   → workflow Completed                                 (Temporal Web UI)
```

### 2.4 Why the worker loops back through `apps/api`

The `WsGateway` owns the `Map<operatorId, WebSocket>` registry — sockets live in the NestJS process. The worker stays stateless and process-restart-safe. The extra HTTP hop costs ~5 ms LAN-local; ADR-0024's 200 ms re-route p95 budget is a Chunk 6 concern, not Chunk 4's, and Chunk 4's screen-pop budget (800 ms) is dominated by Asterisk/ARI/NATS upstream — well inside tolerance.

### 2.5 Workflow shape: two activities, not one

`DispatchMessage` calls two activities sequentially:

1. `deliver-via-ws` — best-effort, idempotent at the WS layer (re-sending is harmless because the screen-pop is itself state-keyed by `messageId`). Default Temporal retry policy.
2. `mark-delivered` — exactly-once intent: writes `dispatch_attempt.delivered_at`. Idempotent by `messageId` (`UPDATE … WHERE messageId = ? AND delivered_at IS NULL`).

Separation lets each activity own a different retry profile and isolates transport failures from persistence failures. Single-activity alternative is viable but loses that separation; rejected for clarity.

## 3. Testing

| Layer | Tool | Compose? | Notes |
|---|---|---|---|
| `DispatchMessage` workflow happy path + retry | vitest + `@temporalio/testing` | No | TDD entry point |
| `deliver-via-ws` activity | vitest, mocked fetch | No | Asserts `X-Internal-Token` + payload |
| `mark-delivered` activity | vitest + testcontainers PG | No | Asserts `delivered_at` set; idempotency on re-run |
| `ws-client.ts` parses `{event,data}` envelope | vitest, fake WebSocket | No | Asserts unknown events ignored; bad JSON drops frame |
| `ScreenPop` renders on mocked WS event | vitest + RTL + hand-rolled mock WS | No | Asserts ≤800 ms via `vi.useFakeTimers()` |
| `MessageForm` POSTs with Bearer JWT | vitest + RTL + mocked fetch | No | Asserts Authorization header |
| Accept + PCI-pause toggles | vitest + RTL | No | Local state only |
| `POST /internal/dispatch-deliver` rejects without secret | vitest | No (testcontainers) | 401 expected |
| `POST /v1/Message` triggers workflow start | vitest, mocked `TemporalClient` | No | Asserts `workflow.start` called |
| `GET /v1/dev/operator-token` 404 in prod | vitest | No | `NODE_ENV=production` fixture |
| SDK identity grep | shell | Yes | Chunk 4 exit |
| Manual ≤800 ms DevTools observation | manual | Yes | `poc/smoke-chunk4.md` |
| Full Playwright e2e | — | — | **Chunk 5**, not here |

**TDD ordering:** write the `DispatchMessage` workflow vitest first (red); make green; then activities; then web components; then api glue.

## 4. Error handling (scope-bounded)

- **Workflow failures:** Temporal defaults — `startToCloseTimeout: 30s`, `maximumAttempts: 3`. Failure leaves `delivered_at` NULL — surfaced in Postgres and Temporal Web UI as Failed. No retry surface in the operator UI (Chunk 6 owns operator-facing retry).
- **WS disconnect mid-call:** `WsGateway.sendToOperator` already no-ops when the socket isn't OPEN. The worker activity's HTTP POST still returns 200; `dispatch_attempt.delivered_at` is still written. The operator screen will not update — gap is documented in `poc/smoke-chunk4.md` and ticketed for Chunk 6 (browser-side reconnect logic).
- **`/v1/dev/operator-token` accessed in prod:** 404, asserted by test.
- **`/internal/dispatch-deliver` without `X-Internal-Token`:** 401, asserted by test.
- **No fallback UI states beyond the above** — explicitly YAGNI for Chunk 4. The chunk's purpose is demonstrating the happy-path workflow; failure-mode UX is Chunk 6+.

## 5. Risks

1. **SDK identity regression.** Self-host baseline only. Pin `@temporalio/worker` and the compose `temporalio/auto-setup` image to the same patch version. The exit-criterion grep catches drift on every chunk-close run. Risk severity: low (mechanical), bounded by exit gate.
2. **Next.js client/server component split.** WebSocket is a client-side API; `app/operator/page.tsx` and its descendants need `'use client'`. RootLayout stays server-rendered to keep cold-start fast. Easy to miss on first scaffold; first build error surfaces it loudly.
3. **TemporalClient connection leak.** Avoided by `TemporalModule` instantiating exactly one `Client` at module init (singleton-scoped) and binding shutdown via `OnApplicationShutdown`. Pattern mirrors `NatsClientService`. Never instantiate a fresh client per request.
4. **JWT secret divergence.** `apps/api` signs and verifies with `APP_JWT_SECRET`. As long as REST and WS share env (currently same NestJS process), no divergence. Flag in `.env.example` and `infra/docker-compose.yml`.
5. **WS-socket lifetime vs workflow runtime.** Workflow runs in seconds; sockets typically live for the operator's session. Race only matters if the operator disconnects between accept and delivery — covered by the "WS disconnect mid-call" gap above.

## 6. Parallel subagent dispatch plan

Per CLAUDE.md §6 and the operator's preference from last session (subagent-driven). Sonnet + ultrathink + self-critique with confidence score, per CLAUDE.md.

**Subagent A — `apps/temporal-worker`:** scaffold pnpm workspace package, write `DispatchMessage` workflow + both activities + their vitests TDD-style. Self-contained, no api/web touch. Reports back with confidence ≥70 or it loops.

**Subagent B — `apps/web`:** scaffold Next.js App Router app on port 3001, write `ScreenPop` + `MessageForm` + WS client + component vitests TDD-style. Mocked WS, mocked fetch. Self-contained, no api/worker touch.

**Main thread, after A+B return:** wire api-side glue — `TemporalModule`, `POST /v1/Message` workflow trigger, `GET /v1/dev/operator-token`, `POST /internal/dispatch-deliver`. Small enough to keep in main thread per CLAUDE.md §6.

**Then:** manual end-to-end smoke against compose; record evidence in `poc/smoke-chunk4.md`; run SDK identity grep; close the chunk via PR from `mvp/chunk-4-f03-worker` → `main`.

## 7. Out of scope (explicit cuts — do not re-litigate)

- Playwright / any e2e harness — Chunk 5.
- PCI pause/resume real wiring (MixMonitor stop/restart) — Chunk 6 / S-2.
- Decline + re-route — Chunk 6 / S-4.
- ARI leader failover / second NestJS instance — Chunk 7 / S-5.
- Browser-side WS reconnect logic — Chunk 6.
- Operator login form / real auth — out of PoC scope.
- Cloud-side Temporal SDK validation — deferred per ADR-0015-cloud-sdk-deferred.

## 8. Effort

Master spec budget: **4–5 days**. This spec stays inside that envelope:

- Subagent A (worker + tests): ~1.5 days.
- Subagent B (web + tests): ~1.5 days.
- API glue (TemporalModule, three routes, tests): ~0.5 day.
- Manual smoke + `poc/smoke-chunk4.md` + SDK grep + PR: ~0.5 day.
- Slack for surprises: ~0.5–1 day.

## 9. What's next

Per `superpowers:brainstorming` flow, this spec is the input for the Chunk 4 implementation plan. The implementation plan will be produced by `superpowers:writing-plans` once this spec is user-approved.
