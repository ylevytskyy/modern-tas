# Chunk 4 — F03 Operator UI + Temporal Worker Smoke

**Date:** 2026-05-17 · **Operator:** Yuriy Lev · **Result:** Green

Verifies the F03 path end-to-end: `POST /v1/Message` → `DispatchMessage` workflow → `deliverViaWs` (HTTP to `/internal/dispatch-deliver`) → operator WS push → `markDelivered` → `dispatch_attempt.delivered_at` populated.

## Pre-flight

- Branch: `mvp/chunk-4-f03-worker` at commit `8a01931`
- Compose: `make poc-up` Green (caddy intentionally skipped — host port 80 collision; not needed for the F03 demo path)
- Host processes:
  - api  on :3000 with `INTERNAL_API_TOKEN` + `WEB_ORIGIN=http://localhost:3001` exported
  - temporal-worker  on :9230 (debug), polling task queue `dispatch-message`, same `INTERNAL_API_TOKEN`
  - web on :3001 with operator tab connected to `/ws`

## Walkthrough

| # | Step | Observed | Budget |
|---|---|---|---|
| 1 | Mint operator JWT (`GET /v1/dev/operator-token?operatorId=66…`) | 200, 256-char token | — |
| 2 | `POST /v1/Message` (curl, real call ID `9eb37dd3…`) | 201 in 143 ms | — |
| 3 | `dispatch_attempt` insert (api side) | `attempted_at = 05:12:54.250674Z` | — |
| 4 | `DispatchMessage` workflow start | `startTime = 05:12:54.290Z` (40 ms after attempt row) | — |
| 5 | `deliverViaWs` activity → `POST /internal/dispatch-deliver` | 200 OK | — |
| 6 | `markDelivered` activity → `UPDATE dispatch_attempt SET delivered_at = now()` | `delivered_at = 05:12:54.542Z` | — |
| 7 | Workflow `WorkflowExecutionCompleted` | `closeTime = 05:12:54.655Z`, status `Completed`, 17 history events | — |
| **Δ** | **`attempted_at → delivered_at`** | **292 ms** | **≤ 800 ms** ✅ |
| **Δ** | **Workflow lifetime (startTime → closeTime)** | **365 ms** | — |

The browser-side WS push and screen-pop render were verified end-to-end during the prior session (handoff §"05:59" / "06:26"); this session re-verified the API + Temporal + DB legs after fixing the api `INTERNAL_API_TOKEN` issue documented below.

## Evidence

### Temporal workflow history (via `temporal workflow show`)

```
ID          Time        Type
 1   05:12:54Z   WorkflowExecutionStarted
 2-4 05:12:54Z   WorkflowTask Scheduled/Started/Completed
 5-7 05:12:54Z   ActivityTaskScheduled/Started/Completed (deliverViaWs)
 8-10 05:12:54Z  WorkflowTask Scheduled/Started/Completed
 11-13 05:12:54Z ActivityTaskScheduled/Started/Completed (markDelivered)
 14-16 05:12:54Z WorkflowTask Scheduled/Started/Completed
 17  05:12:54Z   WorkflowExecutionCompleted
```

Status: `Completed`, Result: `nil`.

### Postgres `dispatch_attempt`

Run on `infra-postgres-1`:

```sql
SELECT message_id, delivered_at IS NOT NULL AS delivered, attempted_at
FROM dispatch_attempt
ORDER BY attempted_at DESC
LIMIT 5;
```

```
              message_id              | delivered |         attempted_at
--------------------------------------+-----------+-------------------------------
 ed9a4fe8-a1a2-4353-8052-919b0626b444 | t         | 2026-05-17 05:12:54.250674+00   ← this smoke
 04b2c904-…                           | f         | 2026-05-17 04:37:46.573203+00   ← pre-fix, exhausted
 6bb4017b-…                           | f         | 2026-05-17 04:32:06.985486+00   ← pre-fix, exhausted
 e9f8ee31-…                           | f         | 2026-05-17 04:24:34.713344+00   ← pre-fix, exhausted
 bf09462b-…                           | f         | 2026-05-17 04:10:12.994411+00   ← pre-fix, exhausted
```

The 4 `f` rows are workflows from the prior session that exhausted `maximumAttempts: 3` against the 401 (see "Smoke fix" below). They will not auto-retry — by design.

## Smoke fix landed during T16

The handoff arrived with three smoke-fix commits already in place:

- `79994e1` — `app.enableCors({ origin: WEB_ORIGIN, credentials: true })` so `apps/web` on :3001 can hit `apps/api` on :3000.
- `da43672` — explicit `@Inject(...)` on `MessageController` + `DispatchDeliverController` constructor params (tsx + esbuild does not emit `emitDecoratorMetadata` reliably, so NestJS reflection-based DI returns `undefined`).
- `8a01931` — rename workflow export `dispatchMessage` → `DispatchMessage` to match the string passed to `client.workflow.start('DispatchMessage', …)`. Unit tests that pass the function reference (not the string) mask this class of bug.

This session's gap was operational, not in the diff:

- The api process had been started without `INTERNAL_API_TOKEN` in its shell env, so `/internal/dispatch-deliver` compared `undefined !== <token>` and 401-ed every worker activity call. `apps/api/.env` exists but is not loaded (no `dotenv` import, no `--env-file` on `tsx`). Restarting api with `INTERNAL_API_TOKEN=…` exported turned the path green on the very next message.

## Known gaps (carried to Chunk 6+)

- No browser-side WS reconnect logic (deliberate; gap in design spec §4).
- PCI pause toggle is local UI state only; backend wiring deferred (S-2 / Chunk 6).
- `arbiter.service.ts:30` hardcodes `callerE164: ''`; populated from the call row in Chunk 6.
- Asterisk does **not** `channel.answer()` in this chunk — the call sits in `Stasis(tas)` Ring state and times out client-side. Audio path lands in Chunk 6.

## Operational gotchas worth promoting

1. **`apps/api/.env` is not auto-loaded.** Either add `--env-file=.env` to the `dev` script (Node ≥20.6 / tsx supports it), or import `dotenv/config` at the top of `main.ts`. Until then, env vars must be exported in the shell before `pnpm --filter @tas/api run dev`. The plan §Task 16 Step 4 already documents the export pattern; the foot-gun is that the `.env` file in-repo looks load-bearing but isn't.
2. **tsx + esbuild + NestJS DI:** `private readonly foo: Foo` constructor params do **not** get auto-wired. Use `@Inject(Foo)` explicitly. Already noted in `apps/api/src/auth/jwt-auth.guard.ts`; promote to a project README so future controllers don't bite this.
3. **Temporal workflow function names match by string.** The exported function name in `workflows/*.ts` must equal the string in `client.workflow.start('Name', …)`. Unit tests that pass the function reference extract the name automatically and hide the mismatch.

---

## Post-rewire spot-check (2026-05-17, Chunk 5 Phase 0)

Verifies the ADR-0025 topology rewire on Linux + Docker Desktop. Kamailio + rtpengine removed; INVITEs enter Asterisk directly on UDP/5060.

- Stack boot: `make poc-up` Green (one fewer service — no kamailio, no rtpengine; caddy skipped due to host port 80 collision, same as Chunk 4).
- pjsua probe: `pjsua --null-audio --auto-loop --no-tcp --local-port=5062 --duration=5 sip:+15555550100@localhost:5060`.
- Asterisk log: `Executing [+15555550100@tas-inbound:2] Stasis("PJSIP/carrier-sipp-00000000", "tas") in new stack`.
- api log: `Nest application successfully started` + ARI connected; StasisStart handled (DB evidence below).
- Postgres: fresh rows in `call`, `queue_call`, `recording` with `tenant_id = 11111111-1111-1111-1111-111111111111` and `call_id = a86f64a2-11bc-4dc7-874c-ef61b2b3ec5a`.
- End-to-end NATS → arbiter → DB chain works on the rewired stack; F03 browser-side WS push not retested here (covered by Chunk 4 smoke).
