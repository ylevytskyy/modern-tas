# Chunk 6 — S-4 decline reroute (design delta)

> Status: **Draft (pending user review)** · Date: 2026-05-18 · Owner: founder (solo) · Predecessor spec: [`2026-05-17-chunk-6-slices-2-3-4-design.md`](./2026-05-17-chunk-6-slices-2-3-4-design.md) §3.3 · Predecessor PRs merged: #3 (S-3), #4 (S-2), #5 (cleanup) · Base: `main` at `a923e20` · ADRs: [ADR-0024 queue budget](../../adr/0024-queue-budget.md)

## 0. Purpose & scope of this document

The parent chunk-6 spec (§3.3) defines S-4 at the architecture level: F03 Decline button, `POST /v1/calls/:id/decline`, arbiter reroute, `queue_call.attempts` JSON chain, 200ms p95 screen-pop SLA. This document captures the **implementation-level decisions the parent spec quietly deferred**, surfaced by a code-state audit performed 2026-05-18. The parent spec remains canonical for high-level intent; this document is canonical for the per-slice implementation.

**Why a delta doc, not an edit:** the parent spec was frozen across three PRs (S-3, S-2, S-4). Editing it now risks rewriting decisions that already shipped. The delta pattern keeps S-2 and S-3 history immutable and isolates S-4's late-bound choices.

## 1. Gap analysis: spec vs. current code (2026-05-18)

The parent §3.3 made several claims that don't match the code on `main` after PR #4 and #5 merged:

| Spec claim | Actual state | Implication |
|---|---|---|
| Arbiter "operator-selection heuristic (round-robin or LRU)" | Literal hardcode to one seeded operator UUID in `apps/api/src/arbiter/arbiter.service.ts:8,36` — no heuristic at all | S-4 must introduce the selector itself; cannot just extend an existing one |
| HC#4: `callerE164:''` replaced by `call.fromE164` lookup in arbiter | `NatsStasisStartPayload` does not carry `fromE164`; arbiter can't read it without an extra DB roundtrip or payload change | Choose payload-extension over DB lookup |
| Two Playwright browser contexts as operator A and operator B | Web app bakes operator identity at build time via `NEXT_PUBLIC_OPERATOR_ID`; both contexts would register as operator A | Use direct WS-client registration for operator B+, keep operator A as a single real browser context |
| `queue_call.attempts` JSON format is "convention, not schema" | Confirmed safe — no existing reader assumes a format | Proceed with JSON-string-per-element |
| `Banner.tsx` reused from S-3 | Confirmed present at `apps/web/components/Banner.tsx` with required variants | Consume as-is |

## 2. Decisions locked in

**D1 — Arbiter selector (minimum-viable exclusion list).** Replace the single-UUID hardcode with:

```sql
SELECT id FROM operator
WHERE status = 'available'
  AND id NOT IN (<UUIDs parsed from queue_call.attempts>)
ORDER BY id ASC
LIMIT 1
```

Deterministic ordering by UUID ascending. Defer real FIFO/LRU/round-robin to a later chunk. ~30 LOC for the selector function plus an empty-result branch that emits `queue_call.status='exhausted'` and a `call.exhausted` WS event so SIPp gets a clean failure.

**D2 — HC#4 fix via NATS payload extension.** Add `fromE164: string` to `NatsStasisStartPayload`. `StasisStartHandler` already has the value from `event.channel.caller.number` (`apps/api/src/telephony/stasis-start.handler.ts:32`); pass it through to the arbiter unchanged. Eliminates the DB roundtrip and the ordering hazard (arbiter firing before `call` row commit).

**D3 — Operator B+ as WS-client harness, not browser.** New helper `apps/e2e/lib/wsOperator.ts` exposes `WsOperator.register(operatorId)` (opens a Node WebSocket against `ws.gateway`, sends the register frame, exposes a Promise-returning `awaitScreenPop({timeoutMs})`) plus `WsOperator.decline(callId)` (HTTP POST to `/v1/calls/:id/decline`). Operator A remains a real Playwright browser context with a real Decline-button click. Operators B–K are pure Node WebSocket clients.

**D4 — p95 measurement = 10 reroutes within one SIPp call.** Seed 11 operators (A–K). One SIPp INVITE with ~25 s hold. Operator A declines via browser; operators B–J (9 WS clients) each decline via POST after receiving screen-pop. Operator K (11th) is the terminal: receives screen-pop, test records the WS-receive timestamp, then test ends (no `/v1/calls/:id/accept` — out of scope per §3 below). Server records dispatch-latency for each of the 10 reroutes; test asserts `p95 < 200 ms`.

**D5 — Operator A cleanup: optimistic close on POST 200.** No new `call.routed-away` WS event. `ScreenPop.tsx` closes itself when `POST /v1/calls/:id/decline` resolves 200. On non-200, surface the API error in a `warning` Banner. Matches the pattern the future Accept button will likely follow.

**D6 — `/v1/calls/:id/accept` is out of scope for S-4.** S-4 proves the *decline-reroute* path. Full call acceptance (which would also need `Channel.answer()` ARI call, `dispatch_message` finalization, etc.) is its own slice. The S-4 e2e test ends when the terminal operator's screen-pop arrives. The SIPp `s4-decline-reroute.xml` scenario explicitly sends `CANCEL` after the test signals it is done (via a TCP control fd or via the test killing the SIPp process); the INVITE never receives `200 OK`. SIPp exits 0 because `CANCEL` is the scripted next step. Test assertions all complete before the CANCEL is sent.

**D7 — Aggregate sequential CI gate lands in the S-4 PR.** Per parent spec §0 decision #6, the gate runs after S-4. Added to `.github/workflows/poc-e2e.yml` as a second job in this PR. Initial `continue-on-error: true`; flipped to `false` after one green CI run on `main` (separate trivial PR).

## 3. Architecture

```
SIPp INVITE
    │
    ▼
StasisStartHandler  ─►  call row written (fromE164, tenantId, …)
    │
    │   NATS publish: stasis.start { callId, tenantId, fromE164 }   ← D2
    ▼
arbiter.dispatch(callId)
    │
    │   exclusion-list SELECT (D1)
    │   server.now() recorded as t_dispatch_start
    ▼
ws.gateway.sendToOperator(opId, { type:'screen-pop', callId, fromE164, … })
    │
    │   t_dispatch_end recorded; (t_end - t_start) appended to in-memory ring buffer
    ▼
Operator clicks F03 Decline (A=browser, B..J=WS clients)
    │
    ▼
POST /v1/calls/:id/decline
    │
    │   ① BEGIN; SELECT … FOR UPDATE on queue_call row
    │   ② append JSON {operatorId, outcome:'declined', at} to attempts text[]
    │   ③ COMMIT
    │   ④ arbiter.dispatch(callId)   (recurses)
    │
    ▼
200 OK  +  WS push to next operator
    │
    (A's ScreenPop closes optimistically on 200)
```

**Why the FOR UPDATE row lock:** S-4 e2e is single-call so contention is theoretical, but a double-click on the Decline button could fire two concurrent POSTs. Row lock serializes them; the second sees the first's append and returns 409 (`'accepted'` or duplicate `'declined'` from same operator).

**Latency ring buffer + retrieval:** Server holds an in-memory ring buffer of the last 100 `(callId, latencyMs)` samples in `ArbiterService`. New internal-only endpoint `GET /v1/internal/dispatch-latencies?callId=<uuid>` returns the samples for one call (JWT-guarded with `INTERNAL_API_TOKEN`, same pattern as existing internal endpoints). Test fixture only — not exposed in OpenAPI / not consumed by web. Avoids leaking telemetry to NATS just for one test.

## 4. Component delta

| Area | Change | New / Modified | LOC est. |
|---|---|---|---|
| NATS payload | Add `fromE164: string` to `NatsStasisStartPayload` schema; `StasisStartHandler` passes through | Modified: `apps/api/src/telephony/stasis-start.handler.ts`, payload type def | ~10 |
| Arbiter | Replace single-UUID hardcode with exclusion-list selector + recursion entry point for reroute; instrument latency timing | Modified: `apps/api/src/arbiter/arbiter.service.ts`; new unit tests `arbiter.service.spec.ts` extension | ~80 |
| Calls controller | `POST /v1/calls/:id/decline` — validate caller is the dispatched operator, transactional append to `attempts`, call `arbiter.dispatch(callId)`, return 200 | Modified: `apps/api/src/calls/calls.controller.ts`; new tests | ~60 |
| Internal endpoint | `GET /v1/internal/dispatch-latencies?callId=` | New: small controller method on existing internal module | ~20 |
| Web | F03 Decline button in `ScreenPop.tsx`; POST + optimistic close + warning banner on error | Modified: `apps/web/components/ScreenPop.tsx` | ~30 |
| Test harness | `WsOperator` helper (register, awaitScreenPop, decline) | New: `apps/e2e/lib/wsOperator.ts` | ~80 |
| DB seed | Seed operators A–K (UUIDs sortable alphabetically) when `SEED_PROFILE=s4` env present; default profile unchanged | Modified: `packages/db/src/seed.ts` | ~30 |
| SIPp scenario | `s4-decline-reroute.xml` — INVITE, ~25 s hold, BYE on timeout | New: `apps/e2e/scenarios/s4-decline-reroute.xml` | ~60 |
| E2E spec | `apps/e2e/specs/poc-e2e-s4-decline-reroute.spec.ts` | New | ~250 |
| Makefile | `poc-e2e-s4` target; `poc-e2e` chains s1..s4 | Modified | ~10 |
| CI | Add `s4` to scenario matrix; new aggregate sequential job (continue-on-error: true initially) | Modified: `.github/workflows/poc-e2e.yml` | ~30 |

Total est.: ~660 LOC including tests. Zero migrations.

## 5. Data shape — `queue_call.attempts` JSON convention

Each `text[]` element is `JSON.stringify({...})` of:

```ts
type AttemptEntry = {
  operatorId: string;   // UUID
  outcome: 'declined' | 'accepted' | 'timeout';  // 'timeout' reserved, not exercised in S-4
  at: string;           // ISO-8601 UTC, ms precision
};
```

**Append order = dispatch order.** No `at`-based sort needed. Final entry's outcome is the terminal state for the queue_call.

S-4 e2e assertions on the chain:
- `attempts.length === 10` — operators A–J each declined once.
- All operatorIds distinct and sort ascending = [A, B, …, J].
- All outcomes are `'declined'`.

Operator K (the 11th, terminal) is **not** in `attempts`. `attempts` records outcomes for operators who *acted on* a dispatch (declined or accepted); K only *received* the dispatch and the test ends before K acts. This is intentional and consistent: §6 D4 specifies K as the terminal probe (we measure WS-arrival latency on K's dispatch but never POST decline as K).

## 6. p95 measurement protocol

1. Test starts SIPp s4 scenario (INVITE, 25s hold).
2. Test waits for operator A's Playwright page to render screen-pop (signals arbiter.dispatch fired for first time).
3. Test clicks Decline; awaits POST resolution; records browser-side latency (sanity check, not the SLA value).
4. For i in [1..9]: WS-client operator B+i receives screen-pop → POSTs decline → next operator receives screen-pop. Test orchestrates serially (each WS client `awaitScreenPop` resolves before the next decline POST fires).
5. Operator K (11th) `awaitScreenPop` resolves. Test stops.
6. Test fetches `GET /v1/internal/dispatch-latencies?callId=<uuid>` — server returns 10 latency samples (one per dispatch invocation after a decline POST committed).
7. Test computes p95 (sort ascending, take element at index `Math.ceil(0.95 * n) - 1` for n=10 → index 9, i.e., the max) and asserts `p95 < 200`.

**SLA window definition (codified here, supplementing ADR-0024):** start = entry of arbiter.dispatch in the API process *after* the decline POST's commit; end = server-side `WebSocket.send()` return on the next operator's socket. This is a server-internal measurement, excludes network RTT to the operator's browser, and is what the spec means by "POST entry → WS push."

This differs from ADR-0024's original framing, which measured operator-WS `accept` → operator-WS `ring` under 200-caller load. The PoT measurement (p95 = 6 ms, 33× headroom) supports the tighter scoped reading; if the assertion fails consistently in CI an NFR-P3 re-measurement ticket is filed but the PR is not blocked, per parent spec §1.4.

## 7. Error paths

| Condition | Response | UI behavior |
|---|---|---|
| Decline POST: caller not the dispatched operator | 400 `wrong-operator` | (Not reachable from real browser flow; covered by unit test only) |
| Decline POST: `attempts` already contains `'accepted'` | 409 `call-already-accepted` | Browser shows `warning` banner; ScreenPop stays open |
| Decline POST: `callId` not found | 404 | Browser shows `warning` banner; ScreenPop stays open |
| Arbiter exclusion list empty | `queue_call.status='exhausted'`; `call.exhausted` WS event emitted | Out of S-4 e2e scope; smoke-tested via unit test only |
| WS push fails (operator disconnected mid-flight) | Existing `ws.gateway` reconnect handler; arbiter does NOT retry within same dispatch — operator will see screen-pop on next dispatch or call is lost | Existing behavior; S-4 e2e does NOT simulate disconnects (flaky-test territory; covered conceptually by S-3's caller-hangup path) |

## 8. Testing strategy

**Unit tests (extend existing files):**
- `arbiter.service.spec.ts` — exclusion-list selector picks first non-attempted operator by UUID asc; HC#4 `fromE164` propagates from payload; empty-result branch emits exhausted; latency ring-buffer push.
- `calls.controller.spec.ts` — decline endpoint covers 200 happy path, 400 wrong-operator, 404 missing callId, 409 already-accepted; transactional append serializes concurrent declines.

**E2E spec** (`apps/e2e/specs/poc-e2e-s4-decline-reroute.spec.ts`):
- Setup: `SEED_PROFILE=s4 make poc-up-all-docker`.
- Flow per §6.
- Assertions:
  1. Operator A's ScreenPop visible after SIPp INVITE; `fromE164` matches SIPp From header (HC#4 closure).
  2. After Decline click, A's ScreenPop is gone (optimistic close).
  3. `attempts` text[] length == 10, all outcomes `'declined'`, operatorIds sort ascending = [A, B, … J].
  4. Operator K's screen-pop WS message received within the 25 s SIPp hold window.
  5. `p95 < 200` ms over the 10 reroute samples.
  6. All rows have correct `tenantId` (parent spec §1.5).

**CI / local budget:** S-4 e2e ≤ 30 s wall-clock per parent spec §1.2. Tightest budget on the chunk; main risk is SIPp INVITE setup time (~5–8 s observed in S-1 traces) + 10 sequential dispatch+decline+POST roundtrips. If a dispatch+decline cycle averages ≥ 2 s in CI, the budget breaks. Mitigation: dispatch+decline target is ≤ 200 ms (the very SLA we're measuring), so 10 cycles ≤ 2 s; ample headroom.

## 9. Deferred / out of scope

- `/v1/calls/:id/accept` endpoint and Accept button wire-up (own slice).
- Real FIFO / LRU operator selection (later chunk; D1 minimum-viable suffices for MVP).
- WS event for "you've been relieved" / `call.routed-away` (not needed given D5 optimistic close).
- Multi-operator real-browser e2e (would require runtime operator-identity override; D3 sidesteps via WS-client harness).
- `'timeout'` attempt outcome (no no-answer path in S-4).
- ADR-0024 re-measurement under load (filed separately if CI p95 fails).

## 10. Risks & open questions for plan stage

The `writing-plans` skill will pick up these implementation-level details that don't need user input:

1. `GET /v1/internal/dispatch-latencies` reads from the in-memory ring buffer only. No new table, no migration (consistent with §4 "zero migrations"). If observability needs grow beyond S-4, a follow-on PR can persist; not in scope here.
2. Exact UUID values for seeded operators A–K. Recommend deterministic sentinel UUIDs whose final hex digit identifies the operator: `00000000-0000-4000-8000-000000000001` (op A) through `00000000-0000-4000-8000-00000000000b` (op K) — 11 values use hex digits `1`–`b`, all valid hex, sortable ascending so the arbiter selector picks them in A→K order. Plan stage finalizes; this is a recommendation, not a binding decision.
3. Whether `WsOperator.awaitScreenPop` uses bare WebSocket or a Node `ws` package wrapper that already exists in `apps/api`. Plan stage picks based on workspace dep audit.
4. SIPp scenario hold duration: 25 s budgeted, but the test should `BYE` early once all 10 reroutes are done rather than wait for SIPp's hold timer (saves ~15 s of wall-clock). Plan stage decides on the early-BYE mechanism.

## 11. Exit criteria

Per parent spec §1, narrowed to S-4:

1. `make poc-e2e-s4` exits 0 locally and in CI on `ubuntu-22.04`.
2. S-4 e2e wall-clock ≤ 30 s.
3. p95 < 200 ms over 10 reroute samples.
4. `queue_call.attempts` chain assertions pass (length 10, ordered, all `'declined'`).
5. `tenant_id` assertions pass on `call` and `queue_call`.
6. CI matrix `s4` shard green; aggregate sequential gate job green (continue-on-error: true acceptable on first PR run).
7. HC#4 verified closed: `screen-pop` payload's `fromE164` matches SIPp From header for operator A's first screen-pop.
