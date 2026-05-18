# Chunk 6 PR 3 — S-4 decline reroute (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the third and final Chunk 6 PR — F03 Decline button drives a real reroute via the arbiter's new exclusion-list selector, `queue_call.attempts` records the JSON chain of decline outcomes, and the e2e harness proves `p95 < 200ms` over 10 reroutes within one SIPp call. HC#4 (`callerE164:''` hardcode) closes in the same PR via NATS payload extension.

**Architecture:** Five backend additions plus one web change and the e2e spec that proves them. (1) `NatsStasisStartPayload.fromE164` carries the caller E.164 from `StasisStartHandler` through to the arbiter, closing HC#4. (2) `ArbiterService` gains a DB-backed exclusion-list selector (`ORDER BY user.id ASC` over operators not in `queue_call.attempts`) and a new `dispatchByCallId(callId)` entry point used by the decline reroute. (3) `ArbiterService` records dispatch latency into an in-memory ring buffer keyed by `callId`. (4) `CallsController` exposes `POST /v1/calls/:id/decline` — `SELECT … FOR UPDATE` on the `queue_call` row, append JSON entry to `attempts`, call `arbiter.dispatchByCallId`, return 200. (5) New `GET /v1/internal/dispatch-latencies?callId=…` on the existing internal module, guarded by the `x-internal-token` header, returns the ring-buffer samples for one call. (6) Web `ScreenPop.tsx` gains a Decline button that POSTs and optimistic-closes on 200, surfacing errors via the existing `Banner.tsx`.

**Tech Stack:** NestJS (api), Drizzle ORM + Postgres (db), Next.js + React + Vitest (web), Playwright + SIPp + Node 22's built-in `globalThis.WebSocket` (e2e), GitHub Actions (CI).

**Reference state at plan creation (2026-05-18):**

- Branch base: `main` at `5d90c5c` (S-4 design spec committed; Chunk 6 S-2/S-3 + cleanup merged via PRs #3/#4/#5). No uncommitted changes.
- Predecessor design (canonical for S-4 implementation): [`docs/superpowers/specs/2026-05-18-chunk-6-s4-decline-reroute-design.md`](../specs/2026-05-18-chunk-6-s4-decline-reroute-design.md) — gap analysis (§1), locked decisions D1–D7 (§2), architecture diagram (§3), JSON convention (§5), p95 protocol (§6), error paths (§7), exit criteria (§11).
- Parent chunk spec: [`docs/superpowers/specs/2026-05-17-chunk-6-slices-2-3-4-design.md`](../specs/2026-05-17-chunk-6-slices-2-3-4-design.md) §3.3.
- Predecessor plan (style reference): [`docs/superpowers/plans/2026-05-18-chunk-6-s2-pci-pause.md`](./2026-05-18-chunk-6-s2-pci-pause.md).
- Existing analogs to mirror: `apps/api/src/calls/calls.controller.ts` (pause/resume — JWT guard, tenant scope, transaction pattern); `apps/api/src/internal/dispatch-deliver.controller.ts` (`x-internal-token` header guard); `apps/api/src/arbiter/arbiter.service.ts` (current single-operator hardcode); `apps/api/src/ws/ws.gateway.ts` (`sendToOperator` API); `apps/web/components/ScreenPop.tsx:35` (Accept-button insert site); `apps/web/components/Banner.tsx` (variants + `role="alert"`); `apps/e2e/specs/poc-e2e-s3-caller-hangup.spec.ts` (fixture pattern, `runScenario`, `OperatorPage`, `assertTenant`); `apps/e2e/scenarios/caller-hangup.xml` (SIPp scenario template); `packages/db/src/seed.ts` (single `main()` — extend with `SEED_PROFILE=s4` branch).

**Deviation from spec §3 — internal endpoint guard pattern.** Spec text reads "JWT-guarded with `INTERNAL_API_TOKEN`, same pattern as existing internal endpoints." The actual existing pattern in `apps/api/src/internal/dispatch-deliver.controller.ts:19–23` is a static-header check (`@Headers('x-internal-token') token === process.env.INTERNAL_API_TOKEN`), NOT a JWT guard. The plan uses the actual existing pattern. Note this in the PR description.

**Deviation from spec §2 D1 — selector SQL.** Spec D1 reads `WHERE status = 'available'`. Neither the `user` table nor the `queue_call` table has a `status` column. The plan uses `WHERE role = 'operator'` on the `user` table (the actual schema). Exclusion-by-attempts logic is unchanged. The "empty-result" branch emits the `call.exhausted` WS event without touching `queue_call.status` (the column does not exist; design's mention is dropped). Spec intent (deterministic exclusion-list selection over available operators) is preserved.

**Deviation from spec §3 — `Banner` role attribute.** Spec / common React idiom would use `role="status"` for non-critical banners. The actual `apps/web/components/Banner.tsx:26` uses `role="alert"`, and existing S-3 e2e spec already queries `page.getByRole('alert')`. All S-4 plan tests and Playwright selectors use `role="alert"`. No code change to `Banner.tsx`.

**Deviation from spec §2 D2 — field reuse on WS-facing payload.** `WsIncomingCallPayload` already has a `callerE164` field (currently `''` because of HC#4). The plan's HC#4 fix populates that existing field from the new `NatsStasisStartPayload.fromE164`; no rename, no new WS-facing field. `ScreenPop.tsx:33` already renders `call.callerE164` — zero web change for HC#4.

**Working-tree assumption.** All work happens on a single branch `mvp/chunk-6-s4-decline-reroute` cut from `main` at `5d90c5c`. The dev stack is brought up with the `INTERNAL_API_TOKEN` and `APP_JWT_SECRET` env vars per [`memory/feedback_all_in_docker_env.md`](../../../home/lion/.claude/projects/-media-lion-Data-Projects-modern-tas/memory/feedback_all_in_docker_env.md):

```bash
export INTERNAL_API_TOKEN="local-dev-token"
export APP_JWT_SECRET="poc-only-not-prod"
```

These are referenced again in tasks below; export once at the top of the session.

**Sentinel UUID convention.** S-4 seeds 11 operators (A–K) chosen so the arbiter's `ORDER BY id ASC` selects them in the order A, B, …, K:

- A = `66666666-6666-6666-6666-666666666666` (existing seeded operator; matches `NEXT_PUBLIC_OPERATOR_ID` baked at web build time — no web rebuild needed)
- B = `77777777-7777-7777-7777-777777777771`
- C = `77777777-7777-7777-7777-777777777772`
- D = `77777777-7777-7777-7777-777777777773`
- E = `77777777-7777-7777-7777-777777777774`
- F = `77777777-7777-7777-7777-777777777775`
- G = `77777777-7777-7777-7777-777777777776`
- H = `77777777-7777-7777-7777-777777777777`
- I = `77777777-7777-7777-7777-777777777778`
- J = `77777777-7777-7777-7777-777777777779`
- K = `77777777-7777-7777-7777-77777777777a`

All B–K UUIDs sort strictly after A (`6…` < `7…`). All are valid v4 UUIDs. The plan refers to these by letter throughout.

---

### Task 1: Branch + HC#4 close (`fromE164` flows payload → arbiter → WS)

The arbiter currently sends `callerE164: ''` because `NatsStasisStartPayload` does not carry the caller E.164 (Hard-Coded #4 from chunk plan). This task adds `fromE164` to the payload type, propagates it from `StasisStartHandler`, and wires `ArbiterService.dispatch` to forward it as `callerE164` on the WS payload.

**Files:**
- Modify: `packages/shared-types/src/events.ts` (add `fromE164` to `NatsStasisStartPayload`)
- Modify: `apps/api/src/telephony/stasis-start.handler.ts` (include `fromE164` in published payload)
- Modify: `apps/api/src/arbiter/arbiter.service.ts` (forward `payload.fromE164` to `wsPayload.callerE164`)
- Test: `apps/api/src/arbiter/arbiter.service.spec.ts` (extend existing dispatch test to assert `callerE164` populated)

- [ ] **Step 1.1: Branch from main**

```bash
cd /media/lion/Data/Projects/modern-tas
git fetch origin
git checkout -b mvp/chunk-6-s4-decline-reroute main
git log --oneline -1
```

Expected: HEAD at `5d90c5c docs(chunk-6/s4): design delta for decline-reroute slice`.

- [ ] **Step 1.2: Write failing arbiter test — HC#4 propagation**

Extend `apps/api/src/arbiter/arbiter.service.spec.ts`. Add this test inside the existing `describe('ArbiterService')` block (keep existing tests untouched):

```ts
it('forwards payload.fromE164 as callerE164 on the WS payload (HC#4)', async () => {
  mockWsGateway.sendToOperator.mockClear();
  const payload: NatsStasisStartPayload = {
    callId: '11111111-1111-1111-1111-111111111111',
    channel: 'PJSIP/sipp-00000001',
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    fromE164: '+15551234567',
  };
  await arbiter.dispatch(payload);
  expect(mockWsGateway.sendToOperator).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ callerE164: '+15551234567' }),
  );
});
```

- [ ] **Step 1.3: Run test — expect RED**

```bash
pnpm --filter @tas/api run test -- arbiter.service.spec.ts
```

Expected: FAIL with TypeScript error `Object literal may only specify known properties, and 'fromE164' does not exist in type 'NatsStasisStartPayload'`.

- [ ] **Step 1.4: Add `fromE164` to `NatsStasisStartPayload`**

In `packages/shared-types/src/events.ts`, update the interface (insert after `accountId`):

```ts
export interface NatsStasisStartPayload {
  callId: string;
  /** ARI channel ID (used by Chunk 3 to control the channel). */
  channel: string;
  tenantId: string;
  accountId: string;
  /** Caller E.164 (Chunk 6 S-4 HC#4 — closes the `callerE164:''` hardcode). */
  fromE164: string;
}
```

- [ ] **Step 1.5: Publish `fromE164` from `StasisStartHandler`**

In `apps/api/src/telephony/stasis-start.handler.ts`, update the `NatsStasisStartPayload` literal (around line 88; `callerE164` is already in scope as a local `const`):

```ts
const payload: NatsStasisStartPayload = {
  callId,
  channel: channelId,
  tenantId,
  accountId,
  fromE164: callerE164,
};
this.nats.publish(NatsSubjects.STASIS_START, payload);
```

- [ ] **Step 1.6: Forward `fromE164` on WS push in `ArbiterService.dispatch`**

In `apps/api/src/arbiter/arbiter.service.ts`, replace the `callerE164: ''` line inside `dispatch()`:

```ts
const wsPayload: WsIncomingCallPayload = {
  type: 'incoming_call',
  callId: payload.callId,
  tenantId: payload.tenantId,
  accountId: payload.accountId,
  callerE164: payload.fromE164,
};
```

(Remove the `// TODO Chunk 6: populate from call row` comment — the TODO is now closed.)

- [ ] **Step 1.7: Run test — expect GREEN**

```bash
pnpm --filter @tas/api run test -- arbiter.service.spec.ts
```

Expected: all tests pass (including the new HC#4 test plus the pre-existing dispatch tests).

- [ ] **Step 1.8: Typecheck the whole monorepo**

```bash
pnpm -r typecheck
```

Expected: no errors. (If `NatsStasisStartPayload` is constructed anywhere else in the tree, this catches it.)

- [ ] **Step 1.9: Commit**

```bash
git add packages/shared-types/src/events.ts apps/api/src/telephony/stasis-start.handler.ts apps/api/src/arbiter/arbiter.service.ts apps/api/src/arbiter/arbiter.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(chunk-6/s4): close HC#4 — propagate fromE164 from StasisStart to WS

Adds fromE164 to NatsStasisStartPayload, populated by StasisStartHandler
from event.channel.caller.number. ArbiterService.dispatch forwards it as
callerE164 on the WS incoming_call payload, replacing the previous
literal '' hardcode (chunk plan §HC#4).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Arbiter exclusion-list selector + `dispatchByCallId` entry point

Replace the single-UUID hardcode with a DB-backed selector that picks the lowest-UUID available operator not already in `queue_call.attempts`. Add `dispatchByCallId(callId)` for the decline reroute path. Empty-result branch emits a `call.exhausted` WS event.

**Files:**
- Modify: `apps/api/src/arbiter/arbiter.service.ts` (inject `DB_TOKEN`, add selector, refactor `dispatch`, add `dispatchByCallId`)
- Modify: `apps/api/src/arbiter/arbiter.module.ts` (ensure `DB_TOKEN` is available to `ArbiterService` — likely already imported globally; verify)
- Modify: `apps/api/src/ws/ws.gateway.ts` (add `sendCallExhausted` method)
- Modify: `packages/shared-types/src/events.ts` (add `WsCallExhaustedPayload` + `CALL_EXHAUSTED` event)
- Test: `apps/api/src/arbiter/arbiter.service.spec.ts` (selector tests + dispatchByCallId test + exhausted branch test)

- [ ] **Step 2.1: Write failing selector tests**

Extend `apps/api/src/arbiter/arbiter.service.spec.ts` — add a new `describe('exclusion-list selector')` block and a `describe('dispatchByCallId')` block. Update `beforeAll` to inject a `mockDb`:

```ts
const mockDb = {
  select: vi.fn(),
};

// In beforeAll providers:
{ provide: DB_TOKEN, useValue: mockDb },
```

Add tests:

```ts
describe('exclusion-list selector', () => {
  it('picks the lowest-UUID operator not in queue_call.attempts', async () => {
    mockDb.select.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([{ id: '77777777-7777-7777-7777-777777777771' }]),
          }),
        }),
      }),
    });
    mockWsGateway.sendToOperator.mockClear();
    await arbiter.dispatch({
      callId: '11111111-1111-1111-1111-111111111111',
      channel: 'PJSIP/sipp-00000001',
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      fromE164: '+15551234567',
    });
    expect(mockWsGateway.sendToOperator).toHaveBeenCalledWith(
      '77777777-7777-7777-7777-777777777771',
      expect.objectContaining({ callId: '11111111-1111-1111-1111-111111111111' }),
    );
  });

  it('emits call.exhausted WS event when no operator is available', async () => {
    mockDb.select.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
    });
    mockWsGateway.sendToOperator.mockClear();
    mockWsGateway.sendCallExhausted = vi.fn();
    await arbiter.dispatch({
      callId: '11111111-1111-1111-1111-111111111111',
      channel: 'PJSIP/sipp-00000001',
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      fromE164: '+15551234567',
    });
    expect(mockWsGateway.sendToOperator).not.toHaveBeenCalled();
    expect(mockWsGateway.sendCallExhausted).toHaveBeenCalledWith({
      callId: '11111111-1111-1111-1111-111111111111',
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
  });
});

describe('dispatchByCallId', () => {
  it('reads the call row and queue_call.attempts and dispatches to next available operator', async () => {
    const callRow = {
      id: '11111111-1111-1111-1111-111111111111',
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      fromE164: '+15551234567',
    };
    const queueCallRow = {
      attempts: [JSON.stringify({
        operatorId: '66666666-6666-6666-6666-666666666666',
        outcome: 'declined',
        at: '2026-05-18T12:00:00.000Z',
      })],
    };
    // Two select() calls: first for call row, second for queue_call row, third for operator selector.
    const selectFn = vi.fn()
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([callRow]) }) }) })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([queueCallRow]) }) }) })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([{ id: '77777777-7777-7777-7777-777777777771' }]) }) }) }) });
    mockDb.select = selectFn;
    mockWsGateway.sendToOperator.mockClear();
    await arbiter.dispatchByCallId('11111111-1111-1111-1111-111111111111');
    expect(mockWsGateway.sendToOperator).toHaveBeenCalledWith(
      '77777777-7777-7777-7777-777777777771',
      expect.objectContaining({ callerE164: '+15551234567' }),
    );
  });
});
```

- [ ] **Step 2.2: Run tests — expect RED**

```bash
pnpm --filter @tas/api run test -- arbiter.service.spec.ts
```

Expected: FAIL — `DB_TOKEN` import missing, `ArbiterService` has no `dispatchByCallId`, no DB usage in `dispatch`, no `sendCallExhausted` on `WsGateway`.

- [ ] **Step 2.3: Add `WsCallExhaustedPayload` + `CALL_EXHAUSTED` event**

In `packages/shared-types/src/events.ts`, add (mirror `WsCallEndedPayload`):

```ts
export interface WsCallExhaustedPayload {
  callId: string;
  tenantId: string;
}
```

Locate the `WsEvents` const (in same file) and add `CALL_EXHAUSTED: 'call.exhausted'`. If `WsEvents` lives elsewhere, follow imports from `ws.gateway.ts`.

- [ ] **Step 2.4: Add `sendCallExhausted` to `WsGateway`**

In `apps/api/src/ws/ws.gateway.ts`, after `sendCallEnded`:

```ts
sendCallExhausted(payload: WsCallExhaustedPayload): void {
  for (const ws of this.connections.values()) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify({ event: WsEvents.CALL_EXHAUSTED, data: payload }));
    }
  }
}
```

(Broadcast to all connected operators; the caller-side ramification is out of S-4 e2e scope per design §7.)

- [ ] **Step 2.5: Implement selector + `dispatchByCallId` in `ArbiterService`**

Replace the entire contents of `apps/api/src/arbiter/arbiter.service.ts` (the existing 47-line file) with:

```ts
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { eq, and, notInArray, asc } from 'drizzle-orm';
import { user } from '@tas/db/schema';
import { call, queueCall } from '@tas/db/schema';
import type {
  NatsStasisStartPayload,
  NatsCallEndedPayload,
  WsIncomingCallPayload,
  WsCallExhaustedPayload,
} from '@tas/shared-types';
import { NatsSubjects } from '@tas/shared-types';
import { NatsClientService } from '../nats/nats.client.service';
import { WsGateway } from '../ws/ws.gateway';
import { DB_TOKEN, type Db } from '../db/db.module';

@Injectable()
export class ArbiterService implements OnModuleInit {
  constructor(
    @Inject(NatsClientService) private readonly nats: NatsClientService,
    @Inject(WsGateway) private readonly wsGateway: WsGateway,
    @Inject(DB_TOKEN) private readonly db: Db,
  ) {}

  onModuleInit(): void {
    this.nats.subscribe<NatsStasisStartPayload>(NatsSubjects.STASIS_START,
      (payload) => void this.dispatch(payload));
    this.nats.subscribe<NatsCallEndedPayload>(NatsSubjects.CALL_ENDED,
      (payload) => void this.dispatchCallEnded(payload));
  }

  async dispatch(payload: NatsStasisStartPayload): Promise<void> {
    const operatorId = await this.selectOperator(payload.callId);
    if (operatorId === null) {
      const exhausted: WsCallExhaustedPayload = {
        callId: payload.callId,
        tenantId: payload.tenantId,
      };
      this.wsGateway.sendCallExhausted(exhausted);
      return;
    }
    const wsPayload: WsIncomingCallPayload = {
      type: 'incoming_call',
      callId: payload.callId,
      tenantId: payload.tenantId,
      accountId: payload.accountId,
      callerE164: payload.fromE164,
    };
    this.wsGateway.sendToOperator(operatorId, wsPayload);
  }

  async dispatchByCallId(callId: string): Promise<void> {
    const callRows = await this.db.select().from(call).where(eq(call.id, callId)).limit(1);
    if (callRows.length === 0) return;
    const row = callRows[0];
    await this.dispatch({
      callId: row.id,
      channel: '',
      tenantId: row.tenantId,
      accountId: row.accountId,
      fromE164: row.fromE164,
    });
  }

  dispatchCallEnded(payload: NatsCallEndedPayload): void {
    // Broadcast to all connected operators; per-operator filtering is a later concern.
    for (const operatorId of this.wsGateway.connectedOperatorIds()) {
      this.wsGateway.sendCallEnded(operatorId, {
        callId: payload.callId,
        endedBy: payload.endedBy,
      });
    }
  }

  private async selectOperator(callId: string): Promise<string | null> {
    const queueRows = await this.db.select().from(queueCall).where(eq(queueCall.callId, callId)).limit(1);
    const attempted: string[] = queueRows.length === 0
      ? []
      : queueRows[0].attempts
          .map((s) => { try { return (JSON.parse(s) as { operatorId: string }).operatorId; } catch { return null; } })
          .filter((x): x is string => typeof x === 'string');
    const rows = await this.db
      .select({ id: user.id })
      .from(user)
      .where(
        attempted.length === 0
          ? eq(user.role, 'operator')
          : and(eq(user.role, 'operator'), notInArray(user.id, attempted)),
      )
      .orderBy(asc(user.id))
      .limit(1);
    return rows.length === 0 ? null : rows[0].id;
  }
}
```

- [ ] **Step 2.6: Add `connectedOperatorIds()` helper to `WsGateway`**

The `dispatchCallEnded` rewrite calls `wsGateway.connectedOperatorIds()`. Add in `apps/api/src/ws/ws.gateway.ts` after `sendCallExhausted`:

```ts
connectedOperatorIds(): string[] {
  return Array.from(this.connections.keys());
}
```

(The previous implementation hard-coded `SEEDED_OPERATOR_ID` for `sendCallEnded`; this generalizes to all connected operators, which is correct for the multi-operator world S-4 introduces.)

- [ ] **Step 2.7: Run tests — expect GREEN**

```bash
pnpm --filter @tas/api run test -- arbiter.service.spec.ts
```

Expected: all tests pass (existing + new selector + new dispatchByCallId + new exhausted-branch).

- [ ] **Step 2.8: Typecheck**

```bash
pnpm -r typecheck
```

Expected: no errors. (If `DB_TOKEN` or `Db` is at a different import path, fix the import.)

- [ ] **Step 2.9: Commit**

```bash
git add apps/api/src/arbiter/arbiter.service.ts apps/api/src/arbiter/arbiter.service.spec.ts apps/api/src/ws/ws.gateway.ts packages/shared-types/src/events.ts
git commit -m "$(cat <<'EOF'
feat(chunk-6/s4): arbiter exclusion-list selector + dispatchByCallId

Replaces the single-UUID hardcode with a DB-backed selector that picks
the lowest-UUID 'operator' role user not in queue_call.attempts. Adds
dispatchByCallId(callId) entry point used by the decline reroute path.
Empty-result branch emits a new call.exhausted WS event.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Arbiter latency ring buffer + timing instrumentation

Wrap the `wsGateway.sendToOperator` call in `dispatch()` with a high-resolution timer; push `(callId, latencyMs)` into an in-memory ring buffer (last 100 entries globally, keyed by callId). Expose `getLatenciesForCall(callId): number[]`.

**Files:**
- Modify: `apps/api/src/arbiter/arbiter.service.ts` (add ring buffer + timing)
- Test: `apps/api/src/arbiter/arbiter.service.spec.ts` (latency-recording test)

- [ ] **Step 3.1: Write failing test**

Extend `apps/api/src/arbiter/arbiter.service.spec.ts`:

```ts
describe('latency ring buffer', () => {
  it('records dispatch latency keyed by callId and exposes via getLatenciesForCall', async () => {
    mockDb.select = vi.fn().mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([{ id: '77777777-7777-7777-7777-777777777771' }]),
          }),
        }),
      }),
    });
    await arbiter.dispatch({
      callId: '11111111-1111-1111-1111-111111111111',
      channel: 'PJSIP/sipp-00000001',
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      fromE164: '+15551234567',
    });
    const samples = arbiter.getLatenciesForCall('11111111-1111-1111-1111-111111111111');
    expect(samples).toHaveLength(1);
    expect(samples[0]).toBeGreaterThanOrEqual(0);
    expect(samples[0]).toBeLessThan(1000);
  });
});
```

- [ ] **Step 3.2: Run test — expect RED**

```bash
pnpm --filter @tas/api run test -- arbiter.service.spec.ts
```

Expected: FAIL — `arbiter.getLatenciesForCall is not a function`.

- [ ] **Step 3.3: Add ring buffer + timing to `ArbiterService`**

In `apps/api/src/arbiter/arbiter.service.ts`, add a private field and helpers, and wrap the `sendToOperator` call. After the constructor and before `onModuleInit`:

```ts
private readonly latencyBuffer: Array<{ callId: string; latencyMs: number }> = [];
private readonly LATENCY_BUFFER_MAX = 100;

private recordLatency(callId: string, latencyMs: number): void {
  this.latencyBuffer.push({ callId, latencyMs });
  while (this.latencyBuffer.length > this.LATENCY_BUFFER_MAX) {
    this.latencyBuffer.shift();
  }
}

getLatenciesForCall(callId: string): number[] {
  return this.latencyBuffer.filter((s) => s.callId === callId).map((s) => s.latencyMs);
}
```

Wrap the existing `wsGateway.sendToOperator(operatorId, wsPayload)` call inside `dispatch()`:

```ts
const t0 = performance.now();
this.wsGateway.sendToOperator(operatorId, wsPayload);
const t1 = performance.now();
this.recordLatency(payload.callId, t1 - t0);
```

(`performance.now()` is a Node globals — no import needed.)

- [ ] **Step 3.4: Run test — expect GREEN**

```bash
pnpm --filter @tas/api run test -- arbiter.service.spec.ts
```

Expected: all tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/arbiter/arbiter.service.ts apps/api/src/arbiter/arbiter.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(chunk-6/s4): arbiter latency ring buffer for p95 measurement

Instruments dispatch() with performance.now() around the WS send and
pushes (callId, latencyMs) into a 100-entry ring buffer. Exposes
getLatenciesForCall(callId) for the new internal latency endpoint.
In-memory only; no schema change (design §10 risk 1).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `POST /v1/calls/:id/decline` endpoint

Add the decline endpoint to `CallsController`. Validates the caller is the dispatched operator, takes a `SELECT … FOR UPDATE` row lock on `queue_call`, appends `{operatorId, outcome:'declined', at}` to `attempts`, calls `arbiter.dispatchByCallId(callId)`, returns 200. Error codes: 400 wrong-operator, 404 missing callId, 409 already-accepted.

**Files:**
- Modify: `apps/api/src/calls/calls.controller.ts` (add `@Post(':id/decline')` method)
- Modify: `apps/api/src/calls/calls.module.ts` (inject `ArbiterService`)
- Test: `apps/api/src/calls/calls.controller.spec.ts` (4 new tests: 200, 400, 404, 409)

- [ ] **Step 4.1: Write failing tests**

Append to `apps/api/src/calls/calls.controller.spec.ts`. Extend `makeDeps()` to include an `arbiter` mock and a `for` chain on the select mock:

```ts
function makeDeps() {
  // ... existing ari, db, etc.
  const arbiter = {
    dispatchByCallId: vi.fn().mockResolvedValue(undefined),
    getLatenciesForCall: vi.fn().mockReturnValue([]),
  };
  // Update db.select chain to include .for('update') support:
  const select = vi.fn().mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(selectQueue.shift() ?? []),
        for: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }),
        orderBy: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }),
      }),
    }),
  }));
  // db.transaction stub — pass-through:
  db.transaction = async (fn: any) => fn(db);
  return { ari, db, arbiter, dbState };
}
```

Add tests inside the existing `describe('CallsController')`:

```ts
describe('POST /v1/calls/:id/decline', () => {
  it('200: appends decline entry to attempts and calls arbiter.dispatchByCallId', async () => {
    const { ari, db, arbiter } = makeDeps();
    const callId = '11111111-1111-1111-1111-111111111111';
    const operatorId = '66666666-6666-6666-6666-666666666666';
    db._stageSelect(
      [{ id: callId, tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }],
      [{ id: 'qc1', tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', callId, attempts: [] }],
    );
    const controller = new CallsController(db, ari as any, arbiter as any);
    const req: any = { user: { sub: operatorId, tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } };
    const res = await controller.decline(callId, req);
    expect(res).toEqual({ ok: true });
    expect(arbiter.dispatchByCallId).toHaveBeenCalledWith(callId);
    expect(db._wasUpdateCalled()).toBe(true);
  });

  it('404: returns NotFound when callId does not exist', async () => {
    const { ari, db, arbiter } = makeDeps();
    db._stageSelect([]); // call row lookup empty
    const controller = new CallsController(db, ari as any, arbiter as any);
    const req: any = { user: { sub: '66666666-6666-6666-6666-666666666666', tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } };
    await expect(controller.decline('00000000-0000-0000-0000-000000000000', req))
      .rejects.toMatchObject({ status: 404 });
  });

  it('409: returns Conflict when attempts already contains an accepted entry', async () => {
    const { ari, db, arbiter } = makeDeps();
    const callId = '11111111-1111-1111-1111-111111111111';
    const operatorId = '66666666-6666-6666-6666-666666666666';
    db._stageSelect(
      [{ id: callId, tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }],
      [{ id: 'qc1', tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', callId,
         attempts: [JSON.stringify({ operatorId, outcome: 'accepted', at: '2026-05-18T12:00:00.000Z' })] }],
    );
    const controller = new CallsController(db, ari as any, arbiter as any);
    const req: any = { user: { sub: operatorId, tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } };
    await expect(controller.decline(callId, req)).rejects.toMatchObject({ status: 409 });
    expect(arbiter.dispatchByCallId).not.toHaveBeenCalled();
  });

  it('400: returns BadRequest when caller has already declined (double-decline guard)', async () => {
    const { ari, db, arbiter } = makeDeps();
    const callId = '11111111-1111-1111-1111-111111111111';
    const operatorId = '77777777-7777-7777-7777-777777777771';
    // Stage: call row exists; queue_call.attempts already contains a 'declined' entry from this same operator.
    db._stageSelect(
      [{ id: callId, tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }],
      [{ id: 'qc1', tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', callId,
         attempts: [JSON.stringify({ operatorId, outcome: 'declined', at: '2026-05-18T12:00:00.000Z' })] }],
    );
    const controller = new CallsController(db, ari as any, arbiter as any);
    const req: any = { user: { sub: operatorId, tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } };
    await expect(controller.decline(callId, req)).rejects.toMatchObject({ status: 400 });
    expect(arbiter.dispatchByCallId).not.toHaveBeenCalled();
  });
});
```

(The 400 test exercises "same operator declining twice" — a deterministic guardrail. The `'wrong-operator'` label means: this caller cannot legitimately decline because they have already terminally acted on this call.)

- [ ] **Step 4.2: Run tests — expect RED**

```bash
pnpm --filter @tas/api run test -- calls.controller.spec.ts
```

Expected: FAIL — `controller.decline is not a function`.

- [ ] **Step 4.3: Implement `decline()` on `CallsController`**

In `apps/api/src/calls/calls.controller.ts`, add `ArbiterService` to the constructor:

```ts
import { ArbiterService } from '../arbiter/arbiter.service';

constructor(
  @Inject(DB_TOKEN) private readonly db: Db,
  private readonly ari: AriCommandsService,
  private readonly arbiter: ArbiterService,
) {}
```

Add the method after `resume()`:

```ts
@Post(':id/decline')
@HttpCode(200)
async decline(
  @Param('id') callId: string,
  @Req() req: Request & { user: RequestUser },
): Promise<{ ok: true }> {
  await this.db.transaction(async (tx) => {
    const callRows = await tx
      .select()
      .from(call)
      .where(and(eq(call.id, callId), eq(call.tenantId, req.user.tenantId)))
      .limit(1);
    if (callRows.length === 0) throw new NotFoundException('call not found');

    const queueRows = await tx
      .select()
      .from(queueCall)
      .where(and(eq(queueCall.callId, callId), eq(queueCall.tenantId, req.user.tenantId)))
      .for('update')
      .limit(1);
    if (queueRows.length === 0) throw new NotFoundException('queue_call not found');

    const attempts = queueRows[0].attempts;
    const parsed = attempts
      .map((s) => { try { return JSON.parse(s) as { operatorId: string; outcome: string; at: string }; } catch { return null; } })
      .filter((x): x is { operatorId: string; outcome: string; at: string } => x !== null);

    if (parsed.some((a) => a.outcome === 'accepted')) {
      throw new ConflictException('call-already-accepted');
    }
    if (parsed.some((a) => a.operatorId === req.user.sub && a.outcome === 'declined')) {
      throw new BadRequestException('wrong-operator');
    }

    const entry = JSON.stringify({
      operatorId: req.user.sub,
      outcome: 'declined',
      at: new Date().toISOString(),
    });

    await tx
      .update(queueCall)
      .set({ attempts: [...attempts, entry] })
      .where(eq(queueCall.id, queueRows[0].id));
  });

  await this.arbiter.dispatchByCallId(callId);
  return { ok: true };
}
```

Imports to add at top of file: `NotFoundException`, `ConflictException`, `BadRequestException` from `@nestjs/common`; `call`, `queueCall` from `@tas/db/schema`; `and` from `drizzle-orm`; `ArbiterService` from `../arbiter/arbiter.service`.

- [ ] **Step 4.4: Update `CallsModule` to provide `ArbiterService`**

In `apps/api/src/calls/calls.module.ts`, add `ArbiterService` to imports/providers. If `ArbiterModule` is already a global module or re-exports `ArbiterService`, simply import the module. Otherwise, add `ArbiterService` to the providers list (and ensure `ArbiterModule` is added to the `imports` array if it's a separate Nest module).

```ts
import { ArbiterModule } from '../arbiter/arbiter.module';

@Module({
  imports: [ArbiterModule],
  controllers: [CallsController],
  providers: [AriCommandsService],
})
export class CallsModule {}
```

- [ ] **Step 4.5: Run tests — expect GREEN**

```bash
pnpm --filter @tas/api run test -- calls.controller.spec.ts
```

Expected: all 4 decline tests pass plus existing pause/resume tests still pass.

- [ ] **Step 4.6: Typecheck**

```bash
pnpm -r typecheck
```

Expected: no errors.

- [ ] **Step 4.7: Commit**

```bash
git add apps/api/src/calls/calls.controller.ts apps/api/src/calls/calls.controller.spec.ts apps/api/src/calls/calls.module.ts
git commit -m "$(cat <<'EOF'
feat(chunk-6/s4): POST /v1/calls/:id/decline endpoint

Transactional FOR UPDATE row lock on queue_call serializes concurrent
declines. Appends JSON {operatorId,outcome:'declined',at} to attempts,
then calls arbiter.dispatchByCallId for reroute. Error codes per design
§7: 400 (caller already declined), 404 (callId or queue_call missing),
409 (call already accepted).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `GET /v1/internal/dispatch-latencies?callId=` endpoint

New internal-only endpoint guarded by the existing `x-internal-token` header pattern. Returns the ring-buffer samples for one callId so the e2e test can compute p95.

**Files:**
- Create: `apps/api/src/internal/dispatch-latencies.controller.ts`
- Modify: `apps/api/src/internal/internal.module.ts` (register the new controller)
- Test: `apps/api/src/internal/dispatch-latencies.controller.spec.ts` (new file)

- [ ] **Step 5.1: Write failing test**

Create `apps/api/src/internal/dispatch-latencies.controller.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { DispatchLatenciesController } from './dispatch-latencies.controller';

describe('DispatchLatenciesController', () => {
  let arbiter: { getLatenciesForCall: ReturnType<typeof vi.fn> };
  let controller: DispatchLatenciesController;
  beforeEach(() => {
    arbiter = { getLatenciesForCall: vi.fn().mockReturnValue([10, 20, 30]) };
    controller = new DispatchLatenciesController(arbiter as any);
    process.env.INTERNAL_API_TOKEN = 'local-dev-token';
  });

  it('200: returns samples for callId when token matches', async () => {
    const res = await controller.get('local-dev-token', '11111111-1111-1111-1111-111111111111');
    expect(res).toEqual({ samples: [10, 20, 30] });
    expect(arbiter.getLatenciesForCall).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
  });

  it('401: throws when token missing', async () => {
    await expect(controller.get(undefined, '11111111-1111-1111-1111-111111111111'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401: throws when token wrong', async () => {
    await expect(controller.get('wrong', '11111111-1111-1111-1111-111111111111'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('400: throws when callId query param missing', async () => {
    await expect(controller.get('local-dev-token', undefined))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 5.2: Run test — expect RED**

```bash
pnpm --filter @tas/api run test -- dispatch-latencies.controller.spec.ts
```

Expected: FAIL — `Cannot find module './dispatch-latencies.controller'`.

- [ ] **Step 5.3: Implement the controller**

Create `apps/api/src/internal/dispatch-latencies.controller.ts`:

```ts
import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ArbiterService } from '../arbiter/arbiter.service';

@Controller('internal')
export class DispatchLatenciesController {
  constructor(private readonly arbiter: ArbiterService) {}

  @Get('dispatch-latencies')
  async get(
    @Headers('x-internal-token') token: string | undefined,
    @Query('callId') callId: string | undefined,
  ): Promise<{ samples: number[] }> {
    const expected = process.env.INTERNAL_API_TOKEN;
    if (!expected || token !== expected) throw new UnauthorizedException();
    if (!callId) throw new BadRequestException('callId query param required');
    return { samples: this.arbiter.getLatenciesForCall(callId) };
  }
}
```

- [ ] **Step 5.4: Register controller in `InternalModule`**

In `apps/api/src/internal/internal.module.ts`, add `DispatchLatenciesController` to the `controllers` array. Ensure `ArbiterModule` is imported.

```ts
import { ArbiterModule } from '../arbiter/arbiter.module';
import { DispatchLatenciesController } from './dispatch-latencies.controller';

@Module({
  imports: [ArbiterModule /* … existing */],
  controllers: [DispatchDeliverController, DispatchLatenciesController],
})
export class InternalModule {}
```

- [ ] **Step 5.5: Run tests — expect GREEN**

```bash
pnpm --filter @tas/api run test -- dispatch-latencies.controller.spec.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5.6: Commit**

```bash
git add apps/api/src/internal/dispatch-latencies.controller.ts apps/api/src/internal/dispatch-latencies.controller.spec.ts apps/api/src/internal/internal.module.ts
git commit -m "$(cat <<'EOF'
feat(chunk-6/s4): GET /v1/internal/dispatch-latencies endpoint

Test-fixture-only endpoint returning the arbiter ring-buffer samples
for a given callId. Guarded by the existing x-internal-token header
pattern (mirrors dispatch-deliver.controller). Used by the s4 e2e
spec to compute p95 over 10 reroute samples.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Web — Decline button + optimistic close + error banner

`ScreenPop.tsx` gains a Decline button next to Accept. The operator page handler POSTs to `/v1/calls/:id/decline`; on 200 it clears the local screen-pop state (optimistic close); on non-200 it surfaces a `warning` Banner with the API error.

**Files:**
- Modify: `apps/web/components/ScreenPop.tsx` (add `onDecline`, `declinePending`, button JSX)
- Modify: `apps/web/components/ScreenPop.spec.tsx` (Decline button render/click tests)
- Modify: `apps/web/app/operator/page.tsx` (wire `onDecline` handler — POST + optimistic close + error Banner)
- Test: `apps/web/app/operator/page.spec.tsx` (may already exist; extend or create — see Step 6.5)

- [ ] **Step 6.1: Write failing ScreenPop component test**

Extend `apps/web/components/ScreenPop.spec.tsx` (mirror existing Accept-button test structure):

```ts
it('renders a Decline button next to Accept when call is unaccepted', () => {
  const onDecline = vi.fn();
  render(
    <ScreenPop
      call={{ type: 'incoming_call', callId: 'c1', tenantId: 't1', accountId: 'a1', callerE164: '+15551234567' }}
      accepted={false}
      paused={false}
      onAccept={() => {}}
      onDecline={onDecline}
      onPciToggle={() => {}}
    />,
  );
  const button = screen.getByTestId('decline-call');
  expect(button).toBeInTheDocument();
  fireEvent.click(button);
  expect(onDecline).toHaveBeenCalledTimes(1);
});

it('hides Decline button after accepted', () => {
  render(
    <ScreenPop
      call={{ type: 'incoming_call', callId: 'c1', tenantId: 't1', accountId: 'a1', callerE164: '+15551234567' }}
      accepted={true}
      paused={false}
      onAccept={() => {}}
      onDecline={() => {}}
      onPciToggle={() => {}}
    />,
  );
  expect(screen.queryByTestId('decline-call')).not.toBeInTheDocument();
});

it('disables Decline button when declinePending is true', () => {
  render(
    <ScreenPop
      call={{ type: 'incoming_call', callId: 'c1', tenantId: 't1', accountId: 'a1', callerE164: '+15551234567' }}
      accepted={false}
      paused={false}
      onAccept={() => {}}
      onDecline={() => {}}
      declinePending={true}
      onPciToggle={() => {}}
    />,
  );
  expect(screen.getByTestId('decline-call')).toBeDisabled();
});
```

- [ ] **Step 6.2: Run tests — expect RED**

```bash
pnpm --filter @tas/web run test -- ScreenPop.spec.tsx
```

Expected: FAIL — `onDecline does not exist in type 'ScreenPopProps'`.

- [ ] **Step 6.3: Implement Decline in `ScreenPop.tsx`**

In `apps/web/components/ScreenPop.tsx`, extend `ScreenPopProps`:

```tsx
export interface ScreenPopProps {
  call: WsIncomingCallPayload | null;
  accepted: boolean;
  paused: boolean;
  pciPending?: boolean;
  declinePending?: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onPciToggle: () => void;
  callEnded?: Pick<WsCallEndedPayload, 'endedBy'>;
  onBannerDismiss?: () => void;
}
```

Insert the Decline button next to Accept (around line 35; mirror the conditional that hides Accept after accept/callEnded):

```tsx
{!callEnded && !accepted && (
  <>
    <button onClick={onAccept} data-testid="accept-call">Accept</button>
    <button onClick={onDecline} data-testid="decline-call" disabled={!!declinePending}>
      Decline
    </button>
  </>
)}
```

- [ ] **Step 6.4: Run tests — expect GREEN**

```bash
pnpm --filter @tas/web run test -- ScreenPop.spec.tsx
```

Expected: all 3 new tests pass + existing tests still pass.

- [ ] **Step 6.5: Wire `onDecline` in operator page**

In `apps/web/app/operator/page.tsx`, locate the `onPciToggle` handler. Add an `onDecline` handler that follows the same `fetch`-with-JWT pattern. Sketch:

```tsx
const [declinePending, setDeclinePending] = useState(false);
const [declineError, setDeclineError] = useState<string | null>(null);

const onDecline = useCallback(async () => {
  if (!incomingCall) return;
  setDeclinePending(true);
  setDeclineError(null);
  try {
    const res = await fetch(`/v1/calls/${incomingCall.callId}/decline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: 'decline failed' }));
      setDeclineError(body.message ?? `HTTP ${res.status}`);
      return;
    }
    // Optimistic close — clear local screen-pop state.
    setIncomingCall(null);
  } catch (err) {
    setDeclineError((err as Error).message);
  } finally {
    setDeclinePending(false);
  }
}, [incomingCall, jwt]);
```

Pass `onDecline={onDecline}` and `declinePending={declinePending}` into the `<ScreenPop … />` JSX. Render `{declineError && <Banner variant="warning" message={declineError} onDismiss={() => setDeclineError(null)} />}` above the ScreenPop.

(Variable names like `jwt`, `incomingCall`, `setIncomingCall` may differ in the actual page — use whatever the existing Accept handler uses. The pattern is identical to S-2's `onPciToggle` handler.)

- [ ] **Step 6.6: Run web test suite**

```bash
pnpm --filter @tas/web run test
```

Expected: all tests pass.

- [ ] **Step 6.7: Manual smoke (optional but recommended)**

```bash
pnpm --filter @tas/web run dev
# Open http://localhost:3000/operator in browser
# Verify Decline button renders alongside Accept in the screen-pop modal (with a mock incoming-call state via React DevTools)
```

Expected: Decline button visible and clickable. No console errors.

- [ ] **Step 6.8: Commit**

```bash
git add apps/web/components/ScreenPop.tsx apps/web/components/ScreenPop.spec.tsx apps/web/app/operator/page.tsx
git commit -m "$(cat <<'EOF'
feat(chunk-6/s4): F03 Decline button — POST + optimistic close

ScreenPop renders Decline next to Accept; click fires POST
/v1/calls/:id/decline; on 200 the operator page clears local incoming-call
state (optimistic close per design D5); on non-200 a warning Banner
surfaces the API error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: DB seed — `SEED_PROFILE=s4` branch (operators B–K)

When `SEED_PROFILE=s4` is set, the seed inserts 10 additional operator-role users (B–K) using the sentinel UUIDs declared at the top of this plan. Operator A (`66666666-…`) continues to seed unconditionally so default profile (s1/s2/s3) behavior is unchanged.

**Files:**
- Modify: `packages/db/src/seed.ts` (add conditional block)
- Test: `packages/db/test/seed.s4.spec.ts` (new — integration test against the local Postgres)

- [ ] **Step 7.1: Write failing seed test**

Create `packages/db/test/seed.s4.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import postgres from 'postgres';

const PG_URL = process.env.DATABASE_URL ?? 'postgres://tas:tas@localhost:5432/tas';

describe('seed SEED_PROFILE=s4', () => {
  let sql: ReturnType<typeof postgres>;
  beforeAll(() => { sql = postgres(PG_URL); });
  afterAll(async () => { await sql.end(); });

  it('seeds 11 operator-role users when SEED_PROFILE=s4', async () => {
    // Reset relevant rows.
    await sql`DELETE FROM "user" WHERE role = 'operator'`;
    await execa('pnpm', ['--filter', '@tas/db', 'run', 'seed'], {
      env: { ...process.env, SEED_PROFILE: 's4' },
    });
    const rows = await sql`SELECT id FROM "user" WHERE role = 'operator' ORDER BY id ASC`;
    expect(rows.length).toBe(11);
    expect(rows[0].id).toBe('66666666-6666-6666-6666-666666666666');
    expect(rows[1].id).toBe('77777777-7777-7777-7777-777777777771');
    expect(rows[10].id).toBe('77777777-7777-7777-7777-77777777777a');
  });

  it('seeds only 1 operator when SEED_PROFILE is unset', async () => {
    await sql`DELETE FROM "user" WHERE role = 'operator'`;
    await execa('pnpm', ['--filter', '@tas/db', 'run', 'seed']);
    const rows = await sql`SELECT id FROM "user" WHERE role = 'operator' ORDER BY id ASC`;
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('66666666-6666-6666-6666-666666666666');
  });
});
```

(This test requires a running Postgres. If the seed test infra in `packages/db` is unit-only and skips integration, mark these `it.skip` and rely on the e2e spec for end-to-end coverage. Adjust per the existing `packages/db/test` conventions.)

- [ ] **Step 7.2: Run test — expect RED**

```bash
pnpm --filter @tas/db run test -- seed.s4.spec.ts
```

Expected: FAIL — only operator A is seeded under `SEED_PROFILE=s4`.

- [ ] **Step 7.3: Add `SEED_PROFILE=s4` branch to `seed.ts`**

In `packages/db/src/seed.ts`, after the existing operator-A insert, add:

```ts
if (process.env.SEED_PROFILE === 's4') {
  const operatorBthroughK = [
    '77777777-7777-7777-7777-777777777771',
    '77777777-7777-7777-7777-777777777772',
    '77777777-7777-7777-7777-777777777773',
    '77777777-7777-7777-7777-777777777774',
    '77777777-7777-7777-7777-777777777775',
    '77777777-7777-7777-7777-777777777776',
    '77777777-7777-7777-7777-777777777777',
    '77777777-7777-7777-7777-777777777778',
    '77777777-7777-7777-7777-777777777779',
    '77777777-7777-7777-7777-77777777777a',
  ];
  // Mirror the exact column shape used for operator A's insert above (same tenantId, accountId, role enum value).
  // Locate operator A's insert literal earlier in this file and copy its non-id fields verbatim.
  await db.insert(user).values(
    operatorBthroughK.map((id, i) => ({
      id,
      // tenantId: <same value as operator A>
      // accountId: <same value as operator A>
      email: `operator-${String.fromCharCode(98 + i)}@s4.test`, // operator-b@…, operator-c@…, …, operator-k@…
      role: 'operator' as const,
    })),
  ).onConflictDoNothing();
}
```

**Important:** read the operator-A insert above this branch to copy the exact `tenantId` / `accountId` / any other required NOT-NULL columns. The placeholder comments above must be filled with literal UUID strings (e.g. `tenantId: '00000000-0000-0000-0000-000000000001'`) matching A's row — the test in Step 7.1 will fail with a `null value in column "tenant_id" violates not-null constraint` error if they're omitted.

- [ ] **Step 7.4: Run test — expect GREEN**

```bash
pnpm --filter @tas/db run test -- seed.s4.spec.ts
```

Expected: both tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add packages/db/src/seed.ts packages/db/test/seed.s4.spec.ts
git commit -m "$(cat <<'EOF'
feat(chunk-6/s4): SEED_PROFILE=s4 seeds operators B-K

Conditional 10-operator insert behind SEED_PROFILE=s4 env var. Sentinel
UUIDs 77777777-…-771 through …-77a all sort strictly after operator A
(66666…) so the arbiter's ORDER BY id ASC picks them in order A, B, …,
K. Default profile (s1/s2/s3) seeds operator A only — unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: E2E harness — `WsOperator` helper

New helper that registers a Node-side WebSocket as a given operator UUID, awaits the next `screen-pop` event, and POSTs decline. Uses Node 22's built-in `globalThis.WebSocket` (no new dependency).

**Files:**
- Create: `apps/e2e/src/lib/wsOperator.ts`
- Test: `apps/e2e/src/lib/wsOperator.spec.ts` (unit test against a mock WS server)

- [ ] **Step 8.1: Write failing test**

Create `apps/e2e/src/lib/wsOperator.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocketServer } from 'ws';
import { WsOperator } from './wsOperator.js';

let wss: WebSocketServer;
let port: number;
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    wss = new WebSocketServer({ port: 0 });
    wss.on('listening', () => {
      port = (wss.address() as any).port;
      resolve();
    });
  });
  wss.on('connection', (ws) => {
    // Echo the registration frame, then push a synthetic screen-pop.
    ws.once('message', () => {
      ws.send(JSON.stringify({
        event: 'call.screen_pop',
        data: { type: 'incoming_call', callId: 'c1', tenantId: 't1', accountId: 'a1', callerE164: '+15551234567' },
      }));
    });
  });
});
afterAll(async () => { await new Promise<void>((r) => wss.close(() => r())); });

describe('WsOperator', () => {
  it('registers and resolves on the next screen-pop event', async () => {
    const op = new WsOperator(`ws://127.0.0.1:${port}`, 'test-jwt');
    await op.register('77777777-7777-7777-7777-777777777771');
    const ev = await op.awaitScreenPop({ timeoutMs: 1000 });
    expect(ev.callId).toBe('c1');
    expect(ev.callerE164).toBe('+15551234567');
    await op.close();
  });

  it('throws on timeout when no screen-pop arrives', async () => {
    const op = new WsOperator(`ws://127.0.0.1:${port}`, 'test-jwt');
    await op.register('77777777-7777-7777-7777-77777777777a');
    await op.awaitScreenPop({ timeoutMs: 100 }); // consume the first synthetic event
    await expect(op.awaitScreenPop({ timeoutMs: 100 }))
      .rejects.toThrow(/timeout/i);
    await op.close();
  });
});
```

(The `ws` package is used here only on the *server* side of the test — it's already in `apps/api`'s deps but not `apps/e2e`. If `apps/e2e/package.json` doesn't include `ws`, add it as a `devDependencies` entry: `"ws": "^8.20.1"`, `"@types/ws": "^8.18.1"`.)

- [ ] **Step 8.2: Run test — expect RED**

```bash
pnpm --filter @tas/e2e run test -- wsOperator.spec.ts
```

Expected: FAIL — `Cannot find module './wsOperator.js'`.

- [ ] **Step 8.3: Implement `WsOperator`**

Create `apps/e2e/src/lib/wsOperator.ts`:

```ts
type ScreenPopEvent = {
  callId: string;
  tenantId: string;
  accountId: string;
  callerE164: string;
};

export class WsOperator {
  private ws: WebSocket | null = null;
  private pending: ScreenPopEvent[] = [];
  private waiter: ((ev: ScreenPopEvent) => void) | null = null;

  constructor(private readonly url: string, private readonly jwt: string) {}

  async register(operatorId: string): Promise<void> {
    const ws = new globalThis.WebSocket(`${this.url}?token=${encodeURIComponent(this.jwt)}`);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', (e) => reject(new Error(`WS open failed: ${(e as any).message ?? e}`)), { once: true });
    });
    ws.send(JSON.stringify({ event: 'register', data: { operatorId } }));
    ws.addEventListener('message', (msg) => {
      try {
        const parsed = JSON.parse(typeof msg.data === 'string' ? msg.data : msg.data.toString());
        if (parsed.event === 'call.screen_pop' && parsed.data) {
          if (this.waiter) {
            const w = this.waiter;
            this.waiter = null;
            w(parsed.data as ScreenPopEvent);
          } else {
            this.pending.push(parsed.data as ScreenPopEvent);
          }
        }
      } catch {
        // ignore non-JSON frames
      }
    });
  }

  awaitScreenPop({ timeoutMs }: { timeoutMs: number }): Promise<ScreenPopEvent> {
    if (this.pending.length > 0) return Promise.resolve(this.pending.shift()!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error('awaitScreenPop timeout'));
      }, timeoutMs);
      this.waiter = (ev) => {
        clearTimeout(timer);
        resolve(ev);
      };
    });
  }

  async decline(apiBaseUrl: string, callId: string): Promise<{ status: number }> {
    const res = await fetch(`${apiBaseUrl}/v1/calls/${callId}/decline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.jwt}`,
      },
    });
    return { status: res.status };
  }

  async close(): Promise<void> {
    if (!this.ws) return;
    this.ws.close();
    this.ws = null;
  }
}
```

- [ ] **Step 8.4: Run tests — expect GREEN**

```bash
pnpm --filter @tas/e2e run test -- wsOperator.spec.ts
```

Expected: both tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add apps/e2e/src/lib/wsOperator.ts apps/e2e/src/lib/wsOperator.spec.ts apps/e2e/package.json
git commit -m "$(cat <<'EOF'
feat(chunk-6/s4): WsOperator e2e harness helper

Node-side WebSocket client (Node 22 built-in globalThis.WebSocket) that
registers as a given operator UUID, queues screen-pop events with a
Promise-returning awaitScreenPop, and POSTs decline. Used by the s4 e2e
spec to drive operators B-K without the build-time NEXT_PUBLIC_OPERATOR_ID
constraint of the web app.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: SIPp `s4-decline-reroute.xml` + extend `runScenario` type

New SIPp scenario with a 25s INVITE hold (long enough to fit 10 dispatch-decline cycles plus margin); CANCEL on scripted timeout. Extend the `runScenario` scenario union type.

**Files:**
- Create: `apps/e2e/scenarios/s4-decline-reroute.xml`
- Modify: `apps/e2e/src/run-scenario.ts` (extend union type + dispatch switch)

- [ ] **Step 9.1: Create the SIPp scenario file**

Create `apps/e2e/scenarios/s4-decline-reroute.xml`. Base on `apps/e2e/scenarios/caller-hangup.xml` (which already uses CANCEL); change the pause to 25000ms:

```xml
<?xml version="1.0" encoding="ISO-8859-1" ?>
<scenario name="s4-decline-reroute">
  <send retrans="500">
    <![CDATA[
INVITE sip:[service]@[remote_ip]:[remote_port] SIP/2.0
Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
From: "sipp" <sip:sipp@[local_ip]:[local_port]>;tag=[call_number]
To: <sip:[service]@[remote_ip]:[remote_port]>
Call-ID: [call_id]
CSeq: 1 INVITE
Contact: sip:sipp@[local_ip]:[local_port]
Max-Forwards: 70
Subject: s4-decline-reroute
Content-Type: application/sdp
Content-Length: [len]

v=0
o=user1 53655765 2353687637 IN IP[local_ip_type] [local_ip]
s=-
c=IN IP[media_ip_type] [media_ip]
t=0 0
m=audio [media_port] RTP/AVP 0
a=rtpmap:0 PCMU/8000
    ]]>
  </send>

  <recv response="100" optional="true"></recv>
  <recv response="180" optional="true"></recv>
  <recv response="183" optional="true"></recv>

  <pause milliseconds="25000"/>

  <send retrans="500">
    <![CDATA[
CANCEL sip:[service]@[remote_ip]:[remote_port] SIP/2.0
Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
From: "sipp" <sip:sipp@[local_ip]:[local_port]>;tag=[call_number]
To: <sip:[service]@[remote_ip]:[remote_port]>
Call-ID: [call_id]
CSeq: 1 CANCEL
Max-Forwards: 70
Content-Length: 0
    ]]>
  </send>

  <recv response="200" optional="true"></recv>
  <recv response="487" optional="true"></recv>
</scenario>
```

- [ ] **Step 9.2: Extend `runScenario` type union**

In `apps/e2e/src/run-scenario.ts`, update the scenario parameter type (around line 6) and the dispatch switch (around line 55):

```ts
export type ScenarioName = 'happy-path' | 'caller-hangup' | 'pci-pause' | 's4-decline-reroute';

// In the switch:
case 's4-decline-reroute':
  scenarioPath = path.join(SCENARIOS_DIR, 's4-decline-reroute.xml');
  break;
```

(Adjust per actual file structure — if `run-scenario.ts` builds the path differently, mirror the existing `caller-hangup` case.)

- [ ] **Step 9.3: Smoke-test SIPp run**

```bash
export INTERNAL_API_TOKEN="local-dev-token"
export APP_JWT_SECRET="poc-only-not-prod"
make poc-up-all-docker
# Wait for stack to be healthy (~30s).
pnpm --filter @tas/e2e exec tsx src/run-scenario.ts --scenario s4-decline-reroute --callId 11111111-1111-1111-1111-111111111111 &
SIPP_PID=$!
sleep 30
wait $SIPP_PID
echo "Exit: $?"
make poc-down
```

Expected: SIPp exits 0 after CANCEL is acknowledged with 487 (no 200 OK ever received, as expected per design D6).

- [ ] **Step 9.4: Commit**

```bash
git add apps/e2e/scenarios/s4-decline-reroute.xml apps/e2e/src/run-scenario.ts
git commit -m "$(cat <<'EOF'
feat(chunk-6/s4): SIPp s4-decline-reroute scenario

INVITE with 25s hold (window for 10 dispatch-decline cycles plus
margin), CANCEL on scripted timeout. SIPp exits 0 via 487 response;
the e2e test's assertions complete well before CANCEL fires.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: E2E spec — `poc-e2e-s4-decline-reroute.spec.ts`

The full flow per design §6: Playwright browser as operator A; 10 `WsOperator` Node clients as B–K; A clicks Decline, B–J decline via POST, K's `awaitScreenPop` resolves and the test ends. Assertions per design §8.

**Files:**
- Create: `apps/e2e/specs/poc-e2e-s4-decline-reroute.spec.ts`
- Modify: `apps/e2e/pages/OperatorPage.ts` (add `decline()` method that clicks `data-testid="decline-call"`)
- Modify: `apps/e2e/package.json` (add `test:e2e:s4` script)

- [ ] **Step 10.1: Add `decline()` to `OperatorPage`**

In `apps/e2e/pages/OperatorPage.ts`, after the existing `accept()` method:

```ts
async decline(): Promise<void> {
  await this.page.getByTestId('decline-call').click();
}
```

- [ ] **Step 10.2: Add the `test:e2e:s4` script**

In `apps/e2e/package.json`, extend `scripts`:

```json
"test:e2e:s4": "SEED_PROFILE=s4 playwright test specs/poc-e2e-s4-decline-reroute.spec.ts"
```

- [ ] **Step 10.3: Write the e2e spec**

Create `apps/e2e/specs/poc-e2e-s4-decline-reroute.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { runScenario } from '../src/run-scenario.js';
import { OperatorPage } from '../pages/OperatorPage.js';
import { getDb, schema, closeDb } from '../src/lib/db.js';
import { assertTenant } from '../src/lib/assert-tenant.js';
import { WsOperator } from '../src/lib/wsOperator.js';
import { eq } from 'drizzle-orm';

const SCENARIO_WALL_CLOCK_MS = 30_000;
const SCREEN_POP_BUDGET_MS = 5_000;
const SIPP_CALL_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const OPERATOR_A = '66666666-6666-6666-6666-666666666666';
const OPERATORS_B_THROUGH_K = [
  '77777777-7777-7777-7777-777777777771',
  '77777777-7777-7777-7777-777777777772',
  '77777777-7777-7777-7777-777777777773',
  '77777777-7777-7777-7777-777777777774',
  '77777777-7777-7777-7777-777777777775',
  '77777777-7777-7777-7777-777777777776',
  '77777777-7777-7777-7777-777777777777',
  '77777777-7777-7777-7777-777777777778',
  '77777777-7777-7777-7777-777777777779',
  '77777777-7777-7777-7777-77777777777a',
];
const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:3001';
const WS_BASE = process.env.E2E_WS_BASE_URL ?? 'ws://localhost:3001/ws';
const JWT = process.env.E2E_TEST_JWT!;

test.afterAll(async () => { await closeDb(); });

test('S-4 decline reroute — 10 reroutes, p95 < 200ms, HC#4 closed', async ({ page }) => {
  test.setTimeout(SCENARIO_WALL_CLOCK_MS);

  // ----- Operator A: Playwright browser -----
  const opA = new OperatorPage(page);
  await opA.goto(OPERATOR_A);
  await opA.waitForWsOpen();

  // ----- Operators B-K: Node WS clients -----
  const wsClients: WsOperator[] = [];
  for (const opId of OPERATORS_B_THROUGH_K) {
    const wsOp = new WsOperator(WS_BASE, JWT);
    await wsOp.register(opId);
    wsClients.push(wsOp);
  }

  // ----- Kick off SIPp INVITE -----
  const sippPromise = runScenario({ scenario: 's4-decline-reroute', callId: SIPP_CALL_ID });

  // ----- Operator A receives screen-pop, asserts HC#4, clicks Decline -----
  const popA = await opA.waitForScreenPop({ timeoutMs: SCREEN_POP_BUDGET_MS });
  expect(popA.callId).toBe(SIPP_CALL_ID);
  // HC#4 closure: callerE164 should be populated from SIPp From header (not '')
  // Verify in the WS payload via Playwright's WS interception — or assert via the DB-rendered field.
  await expect(page.getByText(/\+\d/)).toBeVisible({ timeout: 2000 });

  await opA.decline();
  // Optimistic close: Decline button gone, ScreenPop dismissed.
  await expect(page.getByTestId('decline-call')).not.toBeVisible({ timeout: 2000 });

  // ----- Operators B-J: receive screen-pop, POST decline (9 cycles) -----
  for (let i = 0; i < 9; i++) {
    const pop = await wsClients[i].awaitScreenPop({ timeoutMs: SCREEN_POP_BUDGET_MS });
    expect(pop.callId).toBe(SIPP_CALL_ID);
    const res = await wsClients[i].decline(API_BASE, SIPP_CALL_ID);
    expect(res.status).toBe(200);
  }

  // ----- Operator K (terminal probe): receives screen-pop, test ends -----
  const popK = await wsClients[9].awaitScreenPop({ timeoutMs: SCREEN_POP_BUDGET_MS });
  expect(popK.callId).toBe(SIPP_CALL_ID);

  // ----- Assert queue_call.attempts chain -----
  const db = getDb();
  const queueRows = await db.select().from(schema.queueCall).where(eq(schema.queueCall.callId, SIPP_CALL_ID)).limit(1);
  expect(queueRows.length).toBe(1);
  await assertTenant(queueRows[0], TENANT_ID);
  const attempts = queueRows[0].attempts.map((s: string) => JSON.parse(s));
  expect(attempts.length).toBe(10);
  expect(attempts.every((a: any) => a.outcome === 'declined')).toBe(true);
  const declinerIds = attempts.map((a: any) => a.operatorId);
  expect(declinerIds).toEqual([OPERATOR_A, ...OPERATORS_B_THROUGH_K.slice(0, 9)]);

  // ----- Fetch latency samples + assert p95 < 200ms -----
  const latencyRes = await fetch(
    `${API_BASE}/v1/internal/dispatch-latencies?callId=${SIPP_CALL_ID}`,
    { headers: { 'x-internal-token': process.env.INTERNAL_API_TOKEN! } },
  );
  expect(latencyRes.status).toBe(200);
  const { samples } = await latencyRes.json() as { samples: number[] };
  expect(samples.length).toBeGreaterThanOrEqual(10);
  const last10 = samples.slice(-10).slice().sort((a, b) => a - b);
  const p95 = last10[Math.ceil(0.95 * last10.length) - 1];
  expect(p95).toBeLessThan(200);

  // ----- Assert call row's tenantId (parent spec §1.5) -----
  const callRows = await db.select().from(schema.call).where(eq(schema.call.id, SIPP_CALL_ID)).limit(1);
  await assertTenant(callRows[0], TENANT_ID);

  // ----- Cleanup: close WS clients; let SIPp run out and CANCEL -----
  for (const w of wsClients) await w.close();
  await sippPromise; // resolves after SIPp's 25s pause + CANCEL handshake
});
```

- [ ] **Step 10.4: Run the e2e spec end-to-end**

```bash
export INTERNAL_API_TOKEN="local-dev-token"
export APP_JWT_SECRET="poc-only-not-prod"
export E2E_TEST_JWT="<paste a freshly minted operator JWT — see apps/e2e/README or apps/api/src/auth/test-jwt.ts>"
make poc-up-all-docker
SEED_PROFILE=s4 pnpm --filter @tas/db run seed
pnpm --filter @tas/e2e run test:e2e:s4
```

Expected: 1 spec passes; total wall-clock < 30s; report shows p95 < 200ms.

- [ ] **Step 10.5: Commit**

```bash
git add apps/e2e/specs/poc-e2e-s4-decline-reroute.spec.ts apps/e2e/pages/OperatorPage.ts apps/e2e/package.json
git commit -m "$(cat <<'EOF'
test(chunk-6/s4): e2e spec — 10-reroute decline chain + p95 SLA

Single SIPp call with 25s hold; operator A (Playwright browser) declines
via real button click, operators B-J (WsOperator clients) decline via
POST, operator K's screen-pop arrival ends the test. Assertions:
attempts chain length 10 all 'declined', tenantId on call+queue_call,
p95 < 200ms over 10 dispatch latency samples (closes HC#4 + design §11
exit criteria).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Makefile + GHA matrix + aggregate sequential gate

Wire the new spec into the local dev workflow (`make poc-e2e-s4`, aggregate `make poc-e2e`) and CI (matrix shard `s4`, new aggregate sequential job per design D7 with `continue-on-error: true` initially).

**Files:**
- Modify: `Makefile` (`poc-e2e-s4` target, extend `poc-e2e` aggregate, extend `.PHONY`)
- Modify: `.github/workflows/poc-e2e.yml` (add `s4` to matrix, add aggregate sequential job, ensure `SEED_PROFILE` flows to seed step)

- [ ] **Step 11.1: Extend `Makefile`**

In `Makefile`, after the existing `poc-e2e-s3` target:

```makefile
poc-e2e-s4:
	pnpm --filter @tas/e2e run test:e2e:s4
```

Replace the `poc-e2e` aggregate line:

```makefile
poc-e2e: poc-e2e-s1 poc-e2e-s2 poc-e2e-s3 poc-e2e-s4
```

Extend the `.PHONY` line (line 1 of the Makefile) to include `poc-e2e-s4`.

- [ ] **Step 11.2: Smoke `make poc-e2e-s4` locally**

```bash
export INTERNAL_API_TOKEN="local-dev-token"
export APP_JWT_SECRET="poc-only-not-prod"
make poc-up-all-docker
SEED_PROFILE=s4 pnpm --filter @tas/db run seed
make poc-e2e-s4
```

Expected: exit 0, wall-clock < 30s.

- [ ] **Step 11.3: Extend GHA matrix + add aggregate job**

In `.github/workflows/poc-e2e.yml`:

1. Extend the matrix `scenario: [s1, s2, s3]` to `scenario: [s1, s2, s3, s4]`.

2. Add the seed step (or modify the existing one) to pass `SEED_PROFILE` when `matrix.scenario == 's4'`:

```yaml
- name: Seed database
  run: |
    if [ "${{ matrix.scenario }}" = "s4" ]; then
      SEED_PROFILE=s4 pnpm --filter @tas/db run seed
    else
      pnpm --filter @tas/db run seed
    fi
```

3. Append a new job at the end of the file (after the existing `e2e` job):

```yaml
  e2e-aggregate-sequential:
    needs: e2e
    runs-on: ubuntu-22.04
    continue-on-error: true  # Flip to false after one green run on main (separate PR per design D7).
    timeout-minutes: 5
    env:
      INTERNAL_API_TOKEN: local-dev-token
      APP_JWT_SECRET: poc-only-not-prod
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Bring up stack
        run: make poc-up-all-docker
      - name: Seed (s4 profile — covers all scenarios)
        run: SEED_PROFILE=s4 pnpm --filter @tas/db run seed
      - name: Run aggregate sequential e2e
        run: make poc-e2e
      - name: Bring down
        if: always()
        run: make poc-down
      - name: Upload artifacts on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-aggregate-failure-${{ github.run_id }}
          path: |
            apps/e2e/test-results
            apps/e2e/playwright-report
```

(Mirror the env-setup and checkout steps of the existing `e2e` job — the snippet above shows the conceptual shape; copy exact `actions/*` versions and node setup from whatever's currently in the file.)

- [ ] **Step 11.4: Verify GHA file is valid YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/poc-e2e.yml'))"
```

Expected: no exception.

- [ ] **Step 11.5: Commit + push for CI smoke**

```bash
git add Makefile .github/workflows/poc-e2e.yml
git commit -m "$(cat <<'EOF'
ci(chunk-6/s4): add s4 matrix shard + aggregate sequential gate

Adds poc-e2e-s4 Makefile target and extends the poc-e2e aggregate to
chain s1..s4. GHA matrix gains the s4 shard with SEED_PROFILE=s4 env
flowed through. New aggregate sequential job runs make poc-e2e once per
PR with continue-on-error: true (flipped to false in a follow-up PR
after one green run on main, per design D7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git push -u origin mvp/chunk-6-s4-decline-reroute
```

- [ ] **Step 11.6: Watch CI matrix + aggregate gate**

Open the PR (or push to the branch and follow the GHA run). All 4 matrix shards (s1–s4) must be green; the new aggregate sequential job is allowed to fail (continue-on-error: true) on first run but should also pass.

Expected: PR is green on all four scenario shards. If the aggregate job fails, capture the artifact and investigate inter-scenario state leak.

---

## PR opening checklist

- [ ] All 11 tasks above completed and committed.
- [ ] `git log main..mvp/chunk-6-s4-decline-reroute` shows ~11 commits matching the per-task subjects.
- [ ] `pnpm -r typecheck` clean.
- [ ] `pnpm -r test` clean.
- [ ] CI matrix s1–s4 all green.
- [ ] PR description mentions:
  - Closes HC#4 (callerE164 hardcode)
  - Closes chunk-6 spec §3.3
  - Lists the 4 deviation callouts from this plan (token-header guard not JWT; `role="alert"` not `role="status"`; no `status` column on user/queue_call — selector uses `user.role`; `callerE164` field reuse, no new WS-facing field).
  - Notes aggregate gate is `continue-on-error: true` initially (a one-line follow-up PR flips it to false after one green run on main).
