# Chunk 6 PR 1 — S-3 caller hangup (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the first of three Chunk 6 PRs — Asterisk `StasisEnd` flows end-to-end into call lifecycle finalization, the e2e harness asserts S-3 caller hangup green in CI, and the reusable `Banner.tsx` toast (consumed again by S-4) is in place.

**Architecture:** Three runtime additions plus the e2e spec that proves them. (1) `StasisEndHandler` in `apps/api` subscribes to Asterisk Stasis end events, derives `call.endedBy` from HANGUPCAUSE, stops MixMonitor, finalizes `recording.endedAt`, publishes `tas.call.ended` over NATS. (2) `DispatchMessage` workflow gains a cancellation-signal handler that, on `call.ended`, returns `{delivered:false, reason:'caller_hung_up'}` and writes `dispatch_attempt.failureReason`. (3) `Banner.tsx` reusable component in `apps/web`; `ScreenPop` renders a "Caller hung up" warning banner on the `call.ended` WS event and hides Accept/Decline. Folds in HC#1 (DispatchMessage failure branch) from the Chunk 4/5 handoff.

**Tech Stack:** NestJS (api), Temporal SDK (worker), Next.js + React + Vitest + @testing-library/react (web), Playwright + SIPp (e2e), Drizzle ORM (db), Asterisk 20 ARI.

**Reference state at plan creation (2026-05-17):**

- Branch base: `main` at `41ee669` (Chunk 6 design spec) on top of `21345a1` (cleanup) on top of `ff4d52e` (Chunk 5 merge). Both unpushed.
- Predecessor design: `docs/superpowers/specs/2026-05-17-chunk-6-slices-2-3-4-design.md` §3.1 (S-3 architecture), §4 (schema deltas), §6 (testing strategy).
- Existing analogs to mirror: `apps/api/src/telephony/stasis-start.handler.ts` (StasisEnd will sit next to it); `apps/web/components/ScreenPop.tsx` + `ScreenPop.spec.tsx` (Banner mirrors test pattern); `apps/e2e/specs/poc-e2e-s1-happy-path.spec.ts` (S-3 spec mirrors structure); `apps/e2e/scenarios/happy-path.xml` (SIPp early-hangup variant mirrors structure).

---

### Task 1: Branch + Drizzle migrations (recording.endedAt + dispatch_attempt.failureReason)

**Files:**
- Modify: `packages/db/src/schema/call.ts` (`recording` table — `endedAt` already exists per grounding; if so this task only needs `dispatch_attempt.failureReason`)
- Modify: `packages/db/src/schema/message.ts` (`dispatchAttempt` table — add `failureReason`)
- Generate: `packages/db/drizzle/<NNNN>_chunk6_s3.sql` (Drizzle-generated; do not hand-edit)
- Apply: against local Postgres via `pnpm --filter @tas/db migrate`

- [ ] **Step 1.1: Branch from main**

```bash
cd /media/lion/Data/Projects/modern-tas
git checkout -b mvp/chunk-6-s3-caller-hangup
git log --oneline -1
```
Expected: HEAD on `41ee669 docs(chunk-6): design spec — slices S-2/S-3/S-4 in CI`.

- [ ] **Step 1.2: Verify `recording.endedAt` schema state**

```bash
grep -n "endedAt" packages/db/src/schema/call.ts
```
Per the grounding recon, both `call.endedAt` and `recording.endedAt` already exist as nullable timestamps. **If `recording.endedAt` is already present**, skip the schema edit in 1.3 and only add `dispatch_attempt.failureReason` in 1.4. **If it is absent**, add it per 1.3.

- [ ] **Step 1.3: Add `recording.endedAt` if missing**

In `packages/db/src/schema/call.ts`, the `recording` pgTable definition should contain:
```ts
endedAt: timestamp("ended_at", { withTimezone: true }),
```
immediately after the `startedAt` line.

- [ ] **Step 1.4: Add `dispatch_attempt.failureReason`**

In `packages/db/src/schema/message.ts`, the `dispatchAttempt` pgTable definition should gain one column after `error`:
```ts
failureReason: text("failure_reason"),
```

The full `dispatchAttempt` definition after edit:
```ts
export const dispatchAttempt = pgTable("dispatch_attempt", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id").notNull().references(() => message.id),
  channel: text("channel", { enum: ["in_app", "email", "sms", "push", "voice"] }).notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  error: text("error"),
  failureReason: text("failure_reason"),
});
```

- [ ] **Step 1.5: Generate migration SQL**

```bash
pnpm --filter @tas/db run migrate:gen
```
Expected: a new file `packages/db/drizzle/<NNNN>_<name>.sql` is created containing `ALTER TABLE` statements for the added columns. **Inspect it** before continuing — Drizzle occasionally generates unintended drops if the schema introspection is stale.

- [ ] **Step 1.6: Apply migration to local Postgres**

Ensure the dev stack is up; if not:
```bash
make poc-up-all-docker
scripts/wait-for-healthy.sh
```

Then:
```bash
DATABASE_URL=postgres://tas:tas@localhost:5432/tas pnpm --filter @tas/db migrate
psql postgres://tas:tas@localhost:5432/tas -c '\d recording' | grep ended_at
psql postgres://tas:tas@localhost:5432/tas -c '\d dispatch_attempt' | grep failure_reason
```
Expected: both `ended_at` and `failure_reason` columns shown.

- [ ] **Step 1.7: Commit**

```bash
git add packages/db/src/schema/message.ts packages/db/src/schema/call.ts packages/db/drizzle/
git commit -m "$(cat <<'EOF'
feat(chunk-6/s3): add recording.endedAt + dispatch_attempt.failureReason

Two nullable columns; recording.endedAt is finalised by the StasisEnd
handler (added in a follow-up commit). failureReason carries
'caller_hung_up' when the DispatchMessage workflow is cancelled by a
mid-message hangup (HC#1 fold-in). Both columns nullable so existing
rows remain valid.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Banner component + tests

**Files:**
- Create: `apps/web/components/Banner.tsx`
- Create: `apps/web/components/Banner.spec.tsx`

`Banner` is the reusable toast used by S-3 ("Caller hung up") and later by S-4 (decline feedback). One file, one default export, three variants, 5 s auto-dismiss.

- [ ] **Step 2.1: Write the failing component test**

Create `apps/web/components/Banner.spec.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Banner } from './Banner';

describe('Banner', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the message with role=status for a11y', () => {
    render(<Banner variant="warning" message="Caller hung up" />);
    const node = screen.getByRole('status');
    expect(node).toHaveTextContent('Caller hung up');
  });

  it('applies a variant-specific class', () => {
    render(<Banner variant="warning" message="x" />);
    expect(screen.getByRole('status').className).toContain('banner--warning');
  });

  it('auto-dismisses after 5s and calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(<Banner variant="info" message="x" onDismiss={onDismiss} />);
    expect(screen.queryByRole('status')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByRole('status')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not call onDismiss if unmounted before timeout', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Banner variant="info" message="x" onDismiss={onDismiss} />);
    unmount();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2.2: Run test → fails (module not found)**

```bash
pnpm --filter @tas/web run test -- Banner.spec.tsx
```
Expected: `FAIL  components/Banner.spec.tsx … Cannot find module './Banner'`.

- [ ] **Step 2.3: Implement Banner**

Create `apps/web/components/Banner.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';

export type BannerVariant = 'info' | 'warning' | 'success';

export interface BannerProps {
  variant: BannerVariant;
  message: string;
  onDismiss?: () => void;
  timeoutMs?: number;
}

export function Banner({ variant, message, onDismiss, timeoutMs = 5000 }: BannerProps) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, timeoutMs);
    return () => clearTimeout(t);
  }, [onDismiss, timeoutMs]);
  if (!visible) return null;
  return (
    <div role="status" className={`banner banner--${variant}`}>
      {message}
    </div>
  );
}

export default Banner;
```

- [ ] **Step 2.4: Run test → passes**

```bash
pnpm --filter @tas/web run test -- Banner.spec.tsx
```
Expected: all 4 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add apps/web/components/Banner.tsx apps/web/components/Banner.spec.tsx
git commit -m "$(cat <<'EOF'
feat(chunk-6/s3): Banner toast component

Three variants (info/warning/success), 5s auto-dismiss, role=status
for a11y, optional onDismiss callback. Cleans up its own timer on
unmount to avoid leaks. Consumed by ScreenPop in a follow-up commit
for the Caller-hung-up banner; also re-used by S-4 decline feedback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: StasisEnd handler (unit-test the endedBy derivation, then wire it up)

**Files:**
- Create: `apps/api/src/telephony/stasis-end.handler.ts`
- Create: `apps/api/src/telephony/stasis-end.handler.spec.ts`
- Modify: `apps/api/src/telephony/telephony.module.ts` (register `StasisEndHandler`)
- Modify: `apps/api/src/ari/ari-leader.client.ts` (add `setStasisEndCallback` if not present — verify first)
- Modify: `packages/shared-types/src/events.ts` (extend `NatsStasisEndPayload` if needed; `STASIS_END` and `CALL_ENDED` subjects already declared per grounding)

The handler's only pure-functional bit is the `deriveEndedBy(hangupCause: number, isInbound: boolean)` function. The rest is wiring (DB query, ARI stopMixMonitor, NATS publish) and is best exercised via the integration test in Task 4. Unit-test only the derivation here.

- [ ] **Step 3.1: Confirm `setStasisEndCallback` exists on AriLeaderClient**

```bash
grep -n "setStasisEndCallback\|setStasisStartCallback" packages/ari-client/src/ari-leader.client.ts
```
**If `setStasisEndCallback` is absent**, add it mirroring `setStasisStartCallback` exactly (same registration pattern against the ARI `StasisEnd` event). The body is a one-line setter; the ARI websocket subscription should already include `apps` for the Stasis app — Asterisk emits StasisEnd to the same app subscription.

If absent, add to `packages/ari-client/src/ari-leader.client.ts`:
```ts
private stasisEndCallback?: (event: StasisEndEvent) => Promise<void>;

setStasisEndCallback(cb: (event: StasisEndEvent) => Promise<void>): void {
  this.stasisEndCallback = cb;
}
```
And in the websocket event subscription block where `StasisStart` is handled, add a parallel branch:
```ts
this.ws.on('StasisEnd', async (event: StasisEndEvent) => {
  if (this.stasisEndCallback) await this.stasisEndCallback(event);
});
```
**Verify the type `StasisEndEvent` is exported** from the same module as `StasisStartEvent` (it's part of ari-client's event types). If not, import or define it (it has `channel.id`, `channel.dialplan`, `timestamp`, `cause` — the cause carries the hangup code).

- [ ] **Step 3.2: Write the failing unit test**

Create `apps/api/src/telephony/stasis-end.handler.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { deriveEndedBy } from './stasis-end.handler';

describe('deriveEndedBy', () => {
  // Asterisk Q.850 hangup-cause codes:
  // 16 = Normal Clearing, 17 = User Busy, 19 = No answer, 21 = Call Rejected
  it.each([16, 17, 19, 21])('returns "caller" for caller-initiated cause %i', (cause) => {
    expect(deriveEndedBy(cause, /* isInbound */ true)).toBe('caller');
  });

  it.each([16, 17, 19, 21])('returns "operator" for operator-initiated cause %i on outbound leg', (cause) => {
    expect(deriveEndedBy(cause, /* isInbound */ false)).toBe('operator');
  });

  it('returns "system" for non-normal causes (e.g. 41 Temporary Failure)', () => {
    expect(deriveEndedBy(41, true)).toBe('system');
    expect(deriveEndedBy(41, false)).toBe('system');
  });

  it('returns "system" when cause is undefined', () => {
    expect(deriveEndedBy(undefined as unknown as number, true)).toBe('system');
  });
});
```

- [ ] **Step 3.3: Run test → fails (module not found)**

```bash
pnpm --filter @tas/api run test -- stasis-end.handler.spec.ts
```
Expected: `FAIL … Cannot find module './stasis-end.handler'`.

- [ ] **Step 3.4: Implement the handler skeleton with `deriveEndedBy`**

Create `apps/api/src/telephony/stasis-end.handler.ts`:
```ts
import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { eq, isNull, and } from 'drizzle-orm';
import { call, recording } from '@tas/db';
import { AriLeaderClient } from '@tas/ari-client';
import type { StasisEndEvent } from '@tas/ari-client';
import { ARI_LEADER_TOKEN } from '../ari/ari.module';
import { DB_TOKEN } from '../db/db.module';
import type { Database } from '../db/db.module';
import { NatsClientService } from '../nats/nats-client.service';
import { NatsSubjects, type NatsCallEndedPayload } from '@tas/shared-types';

const CALLER_INITIATED_CAUSES = new Set([16, 17, 19, 21]);

export function deriveEndedBy(
  hangupCause: number | undefined,
  isInbound: boolean,
): 'caller' | 'operator' | 'system' {
  if (hangupCause === undefined) return 'system';
  if (!CALLER_INITIATED_CAUSES.has(hangupCause)) return 'system';
  return isInbound ? 'caller' : 'operator';
}

@Injectable()
export class StasisEndHandler implements OnModuleInit {
  private readonly logger = new Logger(StasisEndHandler.name);

  constructor(
    @Inject(ARI_LEADER_TOKEN) private readonly ari: AriLeaderClient,
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly nats: NatsClientService,
  ) {}

  onModuleInit(): void {
    this.ari.setStasisEndCallback(this.handleStasisEnd.bind(this));
  }

  async handleStasisEnd(event: StasisEndEvent): Promise<void> {
    const channelId = event.channel.id;
    const cause = (event as { cause?: number }).cause;
    // PJSIP inbound channels typically have names like "PJSIP/<inbound-endpoint>-<hex>".
    // For the MVP single-inbound-endpoint topology, treat the event channel as inbound
    // when the channel name doesn't carry the outbound endpoint prefix.
    const isInbound = !event.channel.name.startsWith('PJSIP/operator-');
    const endedBy = deriveEndedBy(cause, isInbound);
    const endedAt = new Date();

    const [callRow] = await this.db
      .select()
      .from(call)
      .where(eq(call.routedThrough, [channelId])) // routedThrough holds channel ids per StasisStart wiring
      .limit(1);
    if (!callRow) {
      this.logger.warn(`StasisEnd: no call row for channel ${channelId}`);
      return;
    }

    await this.db
      .update(call)
      .set({ endedAt, endedBy })
      .where(eq(call.id, callRow.id));

    // Stop and finalize any open recording.
    try {
      await this.ari.channels.stopMixMonitor({ channelId });
    } catch (err) {
      this.logger.warn(`stopMixMonitor failed for ${channelId}: ${(err as Error).message}`);
    }
    await this.db
      .update(recording)
      .set({ endedAt })
      .where(and(eq(recording.callId, callRow.id), isNull(recording.endedAt)));

    const payload: NatsCallEndedPayload = {
      callId: callRow.id,
      tenantId: callRow.tenantId,
      endedBy,
      endedAt: endedAt.toISOString(),
    };
    this.nats.publish(NatsSubjects.CALL_ENDED, payload);
    this.logger.log(`call ${callRow.id} ended (by ${endedBy})`);
  }
}
```

- [ ] **Step 3.5: Add the `NatsCallEndedPayload` type**

In `packages/shared-types/src/events.ts`, add (next to `NatsStasisStartPayload`):
```ts
export interface NatsCallEndedPayload {
  callId: string;
  tenantId: string;
  endedBy: 'caller' | 'operator' | 'system';
  endedAt: string;
}
```

- [ ] **Step 3.6: Register handler in TelephonyModule**

In `apps/api/src/telephony/telephony.module.ts`, add `StasisEndHandler` to the providers array. Mirror exactly how `StasisStartHandler` is registered. Verify by reading the file before editing.

- [ ] **Step 3.7: Run unit test → passes**

```bash
pnpm --filter @tas/api run test -- stasis-end.handler.spec.ts
```
Expected: all 5+ tests pass (4 parameterized + system + undefined).

- [ ] **Step 3.8: Run full api test suite — must stay green**

```bash
pnpm --filter @tas/api run test
```
Expected: all previously-green tests still pass.

- [ ] **Step 3.9: Commit**

```bash
git add apps/api/src/telephony/stasis-end.handler.ts apps/api/src/telephony/stasis-end.handler.spec.ts apps/api/src/telephony/telephony.module.ts packages/shared-types/src/events.ts packages/ari-client/src/ari-leader.client.ts
git commit -m "$(cat <<'EOF'
feat(chunk-6/s3): StasisEnd handler — finalise call + recording + NATS

Subscribes to Asterisk StasisEnd events; derives endedBy from
HANGUPCAUSE (Q.850 codes 16/17/19/21 mapped to caller vs operator by
channel direction; everything else -> system). Updates call.endedAt +
call.endedBy, emits MixMonitorStop ARI command, sets recording.endedAt,
publishes NatsSubjects.CALL_ENDED so the Temporal worker can cancel
in-flight DispatchMessage workflows. Unit-tested pure derivation;
integration verified via S-3 e2e spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: HC#1 fold-in — DispatchMessage cancellation signal

**Files:**
- Modify: `apps/temporal-worker/src/workflows/dispatch-message.ts`
- Modify: `apps/temporal-worker/src/workflows/dispatch-message.spec.ts`
- Modify: `apps/temporal-worker/src/activities/<existing dispatch-attempt activity file>` (look up exact path during Step 4.1)

- [ ] **Step 4.1: Find the activity that writes dispatch_attempt rows**

```bash
grep -rn "dispatchAttempt" apps/temporal-worker/src/activities/
```
Identify the file + activity name. The plan continues assuming it's named `markDelivered` (per grounding) and lives at `apps/temporal-worker/src/activities/dispatch.activities.ts` — adjust paths if reality differs.

- [ ] **Step 4.2: Add a `markFailed` activity**

In `apps/temporal-worker/src/activities/dispatch.activities.ts` (or the file located in 4.1), add a new exported activity:
```ts
export async function markFailed(input: {
  messageId: string;
  channel: 'in_app' | 'email' | 'sms' | 'push' | 'voice';
  failureReason: 'caller_hung_up';
}): Promise<void> {
  await db.insert(dispatchAttempt).values({
    messageId: input.messageId,
    channel: input.channel,
    deliveredAt: null,
    failureReason: input.failureReason,
  });
}
```
Mirror the imports, db client access, and error handling of the existing `markDelivered` activity exactly.

- [ ] **Step 4.3: Add a failing workflow test**

In `apps/temporal-worker/src/workflows/dispatch-message.spec.ts`, append:
```ts
import { defineSignal } from '@temporalio/workflow';
// (existing imports above)

describe('DispatchMessage cancellation', () => {
  it('returns delivered:false with caller_hung_up when callEnded signal fires before deliveryWS completes', async () => {
    const { worker, client, nativeConnection } = await setupTestEnv(); // mirrors existing helper
    const wfId = 'test-cancel-' + Date.now();
    const handle = await client.workflow.start(DispatchMessage, {
      workflowId: wfId,
      taskQueue: 'test',
      args: [{ messageId: 'm-1', operatorId: 'op-1', tenantId: 't-1', payload: { text: 'x' } }],
    });
    await handle.signal('callEnded'); // signal name defined below
    const result = await handle.result();
    expect(result).toEqual({ delivered: false, reason: 'caller_hung_up' });
    await worker.shutdown();
    await nativeConnection.close();
  });
});
```
Use whatever test-setup helper the existing `dispatch-message.spec.ts` uses; mirror its structure exactly. **Do not** invent new helpers.

- [ ] **Step 4.4: Run test → fails**

```bash
pnpm --filter @tas/temporal-worker run test -- dispatch-message.spec.ts
```
Expected: failure indicates the signal handler doesn't exist or the workflow doesn't return the expected shape.

- [ ] **Step 4.5: Add the signal + change return type + handle cancellation**

Replace the `DispatchMessage` workflow body in `apps/temporal-worker/src/workflows/dispatch-message.ts`:
```ts
import { defineSignal, setHandler, condition, proxyActivities } from '@temporalio/workflow';
import type { DispatchMessageInput } from '../types';
import type * as activities from '../activities/dispatch.activities';

const { deliverViaWs, markDelivered, markFailed } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30s',
});

export const callEndedSignal = defineSignal('callEnded');

export type DispatchMessageResult =
  | { delivered: true }
  | { delivered: false; reason: 'caller_hung_up' };

export async function DispatchMessage(input: DispatchMessageInput): Promise<DispatchMessageResult> {
  let cancelled = false;
  setHandler(callEndedSignal, () => { cancelled = true; });

  // Race delivery against the cancellation signal.
  const delivery = (async () => {
    await deliverViaWs({ operatorId: input.operatorId, payload: input.payload });
    await markDelivered({ messageId: input.messageId, channel: 'in_app' });
    return { delivered: true } as const;
  })();
  const cancellation = condition(() => cancelled);
  const winner = await Promise.race([delivery, cancellation.then(() => 'cancelled' as const)]);

  if (winner === 'cancelled') {
    await markFailed({ messageId: input.messageId, channel: 'in_app', failureReason: 'caller_hung_up' });
    return { delivered: false, reason: 'caller_hung_up' };
  }
  return winner;
}
```
**Why `Promise.race`:** Temporal workflows are deterministic; this pattern is the standard way to interleave a long-running activity with a signal handler. If `deliverViaWs` completes before the signal, the existing happy path returns `{delivered:true}`. If the signal fires first, the workflow records the failure and returns the failure shape.

- [ ] **Step 4.6: Update existing happy-path test if return type changed**

```bash
pnpm --filter @tas/temporal-worker run test -- dispatch-message.spec.ts
```
The existing happy-path test previously expected `Promise<void>`; update assertions to `expect(result).toEqual({ delivered: true })`. Mirror the new return type wherever else `DispatchMessage` is referenced (likely the api's dispatch controller — grep for it):
```bash
grep -rn "DispatchMessage\b" apps/api/src apps/temporal-worker/src
```
Update any consumer that previously awaited a void return.

- [ ] **Step 4.7: Run worker test suite — must be green**

```bash
pnpm --filter @tas/temporal-worker run test
```

- [ ] **Step 4.8: Subscribe to NATS `call.ended` and send the signal**

The worker needs a NATS subscriber that signals running DispatchMessage workflows when `call.ended` arrives. Locate the worker's NATS bootstrap (likely in `apps/temporal-worker/src/main.ts` or a dedicated subscriber file):
```bash
grep -rn "nats\|NatsConnection\|subscribe" apps/temporal-worker/src/
```
Add a subscriber that, on `tas.call.ended`, looks up the active workflow by `callId` → workflow ID convention and sends `callEndedSignal`. The exact wiring depends on the worker's existing NATS pattern; mirror it. If the worker has no existing NATS subscriber, follow the api's `apps/api/src/nats/nats-client.service.ts` pattern.

**Workflow ID convention:** the existing DispatchMessage workflow is started with `workflowId: ?`. Check how:
```bash
grep -rn "workflowId" apps/api/src/dispatch/
```
Pick a convention that ties workflow IDs to callIds (e.g. `dispatch-${callId}-${messageId}`); if the existing convention doesn't include `callId`, add it. The signal subscriber then maps `callId` → workflow handle via `client.workflow.getHandle('dispatch-' + callId + '-*')` — Temporal's getHandle requires an exact ID, so use a deterministic suffix or list workflows by tag.

**Pragmatic alternative if exact mapping is hard:** publish the workflowId in the `NatsCallEndedPayload` extension fields (add `workflowId?: string`). The handler that starts the workflow also publishes `tas.dispatch.workflow.started` with `{callId, workflowId}`; the worker keeps an in-memory `callId → workflowId` map. **Defer this complexity if and only if the simpler ID convention works.**

- [ ] **Step 4.9: Commit**

```bash
git add apps/temporal-worker/src apps/api/src
git commit -m "$(cat <<'EOF'
feat(chunk-6/s3, hc#1): DispatchMessage callEnded signal

Workflow now races deliverViaWs against a callEnded signal; on
cancellation, returns {delivered:false, reason:'caller_hung_up'} and
records a dispatch_attempt row with failureReason populated. Worker
subscribes to NATS tas.call.ended and forwards as a Temporal signal
to the running workflow. Return type changed from void to a
DispatchMessageResult union; api consumers updated. Folds in HC#1
from the Chunk 4/5 handoff.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: ScreenPop renders Banner on `call.ended` WS message

**Files:**
- Modify: `apps/web/lib/ws.ts` (add `onCallEnded(handler)` matching existing `onScreenPop` pattern)
- Modify: `apps/web/components/ScreenPop.tsx` (render Banner + hide Accept/Decline on call.ended)
- Modify: `apps/web/components/ScreenPop.spec.tsx` (test the new path)
- Modify: `apps/web/app/operator/page.tsx` (subscribe to call.ended, pass `callEnded` prop down)
- Modify: `apps/api/src/ws/ws.gateway.ts` (push `call.ended` from `NatsSubjects.CALL_ENDED` subscription)
- Modify: `packages/shared-types/src/events.ts` (add `WsEvents.CALL_ENDED = 'call.ended'`)

- [ ] **Step 5.1: Confirm WsEvents constants location**

```bash
grep -n "WsEvents\|CALL_SCREEN_POP" packages/shared-types/src/events.ts apps/web/lib/ws.ts
```
Add a `CALL_ENDED = 'call.ended'` constant to `WsEvents` in `packages/shared-types/src/events.ts`. Build:
```bash
pnpm --filter @tas/shared-types run build
```

- [ ] **Step 5.2: Failing ScreenPop test for the call-ended branch**

In `apps/web/components/ScreenPop.spec.tsx`, append a test:
```tsx
it('shows Caller hung up banner and hides Accept on callEnded prop', () => {
  render(
    <ScreenPop
      call={{ callId: 'c1', from: '+15551234567' }}
      onAccept={() => {}}
      onPciToggle={() => {}}
      paused={false}
      accepted={false}
      callEnded={{ endedBy: 'caller' }}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Caller hung up');
  expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
});

it('does not show the banner when callEnded is undefined', () => {
  render(
    <ScreenPop
      call={{ callId: 'c1', from: '+15551234567' }}
      onAccept={() => {}}
      onPciToggle={() => {}}
      paused={false}
      accepted={false}
    />,
  );
  expect(screen.queryByRole('status')).toBeNull();
});
```

- [ ] **Step 5.3: Run test → fails**

```bash
pnpm --filter @tas/web run test -- ScreenPop.spec.tsx
```

- [ ] **Step 5.4: Extend ScreenPop**

In `apps/web/components/ScreenPop.tsx`:
- Add to `ScreenPopProps`:
  ```ts
  callEnded?: { endedBy: 'caller' | 'operator' | 'system' };
  ```
- At the top of the JSX (inside the `<section>`), before the existing heading:
  ```tsx
  {callEnded && (
    <Banner
      variant="warning"
      message={callEnded.endedBy === 'caller' ? 'Caller hung up' : 'Call ended'}
    />
  )}
  ```
- Conditionally hide Accept + PCI buttons:
  ```tsx
  {!callEnded && !accepted && (
    <button onClick={onAccept}>Accept</button>
  )}
  {!callEnded && accepted && (
    <button onClick={onPciToggle}>{paused ? 'Resume' : 'PCI pause'}</button>
  )}
  ```
- Add import: `import { Banner } from './Banner';`

- [ ] **Step 5.5: Run test → passes**

```bash
pnpm --filter @tas/web run test -- ScreenPop.spec.tsx
```

- [ ] **Step 5.6: Wire `onCallEnded` in the WS client**

In `apps/web/lib/ws.ts`, mirror the existing `onScreenPop` pattern to add an `onCallEnded(handler: (p: { endedBy: 'caller'|'operator'|'system' }) => void)` subscription dispatching on `WsEvents.CALL_ENDED`.

- [ ] **Step 5.7: Subscribe in operator page**

In `apps/web/app/operator/page.tsx`, add (mirroring the existing `client.onScreenPop` block):
```tsx
const [callEnded, setCallEnded] = useState<{ endedBy: 'caller'|'operator'|'system' } | undefined>(undefined);

// inside the existing useEffect, after client.onScreenPop:
client.onCallEnded((payload) => {
  setCallEnded(payload);
  // optional: clear screen-pop after banner auto-dismisses
  setTimeout(() => { setCall(undefined); setCallEnded(undefined); }, 5000);
});
```
Pass `callEnded` to `<ScreenPop callEnded={callEnded} ... />`.

- [ ] **Step 5.8: Server side — push `call.ended` from NATS to WS**

In `apps/api/src/ws/ws.gateway.ts`, add a NATS subscriber for `NatsSubjects.CALL_ENDED`. On message: look up the operator currently associated with the `callId` (via `queue_call` dequeuedAt → operatorId mapping; mirror however screen-pop currently determines the destination operator). Send to that operator's socket using `WsEvents.CALL_ENDED` with `{ endedBy, endedAt, callId }`.

The exact socket lookup pattern is **whatever screen-pop already uses** — read `ws.gateway.ts` and mirror it. If the existing screen-pop dispatch is by `operatorId`, the call-ended dispatch needs the same lookup; reuse the helper if one exists, otherwise extract one (small refactor — only if both paths become the third use site).

- [ ] **Step 5.9: Run all web + api tests**

```bash
pnpm --filter @tas/web run test
pnpm --filter @tas/api run test
```

- [ ] **Step 5.10: Commit**

```bash
git add apps/web apps/api/src/ws packages/shared-types/src/events.ts
git commit -m "$(cat <<'EOF'
feat(chunk-6/s3): F03 Caller-hung-up banner via call.ended WS event

WsGateway subscribes to NatsSubjects.CALL_ENDED and pushes WsEvents.
CALL_ENDED to the operator's socket. ScreenPop renders the Banner
(reusable component from earlier in this PR) and hides Accept/PCI
buttons once the call has ended. Operator page auto-clears the
screen-pop 5s after the banner mounts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: SIPp scenario for caller hangup mid-screen-pop

**Files:**
- Create: `apps/e2e/scenarios/caller-hangup.xml`

The S-1 scenario waits 5 s before BYE. S-3 needs a BYE **before the operator accepts** — i.e., during the screen-pop window, around 1.5 s after INVITE. The recipe is to clone `happy-path.xml`, shrink the post-200 OK pause to ~1500 ms, and keep everything else identical.

- [ ] **Step 6.1: Copy and trim**

```bash
cp apps/e2e/scenarios/happy-path.xml apps/e2e/scenarios/caller-hangup.xml
```

- [ ] **Step 6.2: Edit the pause duration**

In `apps/e2e/scenarios/caller-hangup.xml`, the `<pause milliseconds="5000"/>` (or similar; verify the actual current line via Read first) becomes:
```xml
<pause milliseconds="1500"/>
```
The 1500 ms gives the screen-pop time to render in Playwright (well within the 3000 ms screen-pop budget from Chunk 5) before BYE fires.

- [ ] **Step 6.3: Register the scenario name with `runScenario`**

```bash
grep -n "happy-path\|scenarios/" apps/e2e/src/run-scenario.ts
```
If `runScenario` maps a scenario name to a file path via a lookup table or convention, register `'caller-hangup'` → `caller-hangup.xml`. If it's a pass-through (uses the name as the filename stem), nothing to do.

- [ ] **Step 6.4: Commit**

```bash
git add apps/e2e/scenarios/caller-hangup.xml apps/e2e/src/run-scenario.ts
git commit -m "$(cat <<'EOF'
test(chunk-6/s3): SIPp scenario — BYE mid-screen-pop

Mirrors happy-path.xml but BYEs after a 1500ms post-INVITE pause so
the operator's screen-pop has time to render before the caller hangs
up. Consumed by the S-3 e2e spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: S-3 end-to-end spec

**Files:**
- Create: `apps/e2e/specs/poc-e2e-s3-caller-hangup.spec.ts`
- Modify: `apps/e2e/package.json` (add `test:e2e:s3` script)

- [ ] **Step 7.1: Add the npm script**

In `apps/e2e/package.json`, add to `"scripts"`:
```json
"test:e2e:s3": "playwright test specs/poc-e2e-s3-caller-hangup.spec.ts"
```
Mirror the existing `test:e2e:s1` entry's exact form (paths, flags).

- [ ] **Step 7.2: Write the spec — start failing**

Create `apps/e2e/specs/poc-e2e-s3-caller-hangup.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { runScenario } from '../src/run-scenario.js';
import { OperatorPage } from '../pages/OperatorPage.js';
import { getDb, schema, closeDb } from '../src/lib/db.js';
import { assertTenant } from '../src/lib/assert-tenant.js';
import { eq } from 'drizzle-orm';

const SEEDED_TENANT_ID   = '11111111-1111-1111-1111-111111111111';
const SEEDED_OPERATOR_ID = '66666666-6666-6666-6666-666666666666';
const SCREEN_POP_BUDGET_MS = 3000;
const ENDED_POLL_TIMEOUT_MS = 5000;
const SCENARIO_WALL_CLOCK_MS = 45_000;

test.afterAll(async () => { await closeDb(); });

test('S-3 caller hangs up mid-screen-pop: endedBy=caller, recording finalized, banner shown', async ({ page }) => {
  test.setTimeout(SCENARIO_WALL_CLOCK_MS);
  const start = Date.now();

  const sipCallId = uuidv4();
  const sippPromise = runScenario({ scenario: 'caller-hangup', callId: sipCallId });

  const op = new OperatorPage(page);
  await op.goto(SEEDED_OPERATOR_ID);
  await op.waitForWsOpen();

  const { callId } = await op.waitForScreenPop({ timeoutMs: SCREEN_POP_BUDGET_MS });

  // Wait for the banner to appear (driven by the WS call.ended push).
  const banner = page.getByRole('status').filter({ hasText: /caller hung up/i });
  await expect(banner).toBeVisible({ timeout: ENDED_POLL_TIMEOUT_MS });

  // Accept/PCI buttons must be hidden once the banner is up.
  await expect(page.getByRole('button', { name: /accept/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /pci pause/i })).toHaveCount(0);

  // SIPp scenario should have completed cleanly.
  const sipp = await sippPromise;
  expect(sipp.exitCode).toBe(0);

  // DB assertions.
  const db = getDb();
  const [callRow] = await db.select().from(schema.call).where(eq(schema.call.id, callId));
  expect(callRow.endedBy).toBe('caller');
  expect(callRow.endedAt).not.toBeNull();

  const [recRow] = await db.select().from(schema.recording).where(eq(schema.recording.callId, callId));
  expect(recRow.endedAt).not.toBeNull();

  // No orphan channels on the asterisk box.
  // (uses an existing helper if available; otherwise omit and rely on stack teardown to surface leaks.)

  // tenant_id integrity across call + recording rows.
  await assertTenant(SEEDED_TENANT_ID, callId);

  // Wall-clock budget assertion.
  expect(Date.now() - start).toBeLessThan(SCENARIO_WALL_CLOCK_MS);
});
```

- [ ] **Step 7.3: Bring up the stack + run the spec — fails for the right reasons**

```bash
make poc-up-all-docker
scripts/wait-for-healthy.sh
make poc-seed
pnpm --filter @tas/e2e run test:e2e:s3
```
**Expected initial failure mode:** the banner never appears (or assertions fail). Walk the failure backwards: was `call.endedBy` written? (StasisEnd handler fired?) Was the WS message pushed? (NATS subscriber in ws.gateway?) Was the SIPp scenario actually executed?

This step exists to verify the spec is genuinely red for the **right reason** — Tasks 3–5 already made it green in code; if the spec is red because of harness wiring (e.g. scenario name not registered), fix the harness, not the spec.

- [ ] **Step 7.4: Iterate until green**

Fix narrow issues as they surface. Commit fixes individually if material, but **the spec file itself is one commit** at the end.

- [ ] **Step 7.5: Commit the spec**

```bash
git add apps/e2e/specs/poc-e2e-s3-caller-hangup.spec.ts apps/e2e/package.json
git commit -m "$(cat <<'EOF'
test(chunk-6/s3): poc-e2e-s3 caller-hangup spec — Green locally

End-to-end: SIPp INVITE -> StasisStart -> screen-pop renders -> SIPp
BYE -> StasisEnd handler -> call.endedBy='caller' -> recording.endedAt
populated -> F03 banner shown -> Accept/PCI hidden. Asserts tenant_id
across call + recording rows. Per-scenario wall-clock <= 45s enforced
in-spec. Sits alongside S-1 in apps/e2e/specs/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Make target + CI matrix entry

**Files:**
- Modify: `Makefile`
- Modify: `.github/workflows/poc-e2e.yml`

- [ ] **Step 8.1: Add Make recipe**

In `Makefile`, after the existing `poc-e2e-s1` target, add:
```makefile
poc-e2e-s3:
	pnpm --filter @tas/e2e run test:e2e:s3
```
Also extend the aggregate target if one exists:
```bash
grep -n "^poc-e2e:" Makefile
```
If `poc-e2e:` runs s1 only today, extend to chain `poc-e2e-s1 poc-e2e-s3` as dependencies (Make's parallelism handles ordering; for our single-runner local invocation, sequential is fine).

- [ ] **Step 8.2: Add the s3 shard to the CI matrix**

In `.github/workflows/poc-e2e.yml`, the existing `e2e-s1` job needs to become a matrix-parallel job covering `s1` and `s3` (S-2 and S-4 join in their own PRs). Mirror what's there today:
```yaml
strategy:
  fail-fast: false
  matrix:
    scenario: [s1, s3]
```
And replace the hard-coded `make poc-e2e-s1` step with:
```yaml
- run: make poc-e2e-${{ matrix.scenario }}
```
Verify the job's overall structure stays identical otherwise; the matrix is the only change.

- [ ] **Step 8.3: Commit**

```bash
git add Makefile .github/workflows/poc-e2e.yml
git commit -m "$(cat <<'EOF'
ci(chunk-6/s3): poc-e2e-s3 target + GHA matrix shard

Local: make poc-e2e-s3 mirrors poc-e2e-s1. CI: e2e job becomes a
matrix on [s1, s3] so the two scenarios run in parallel shards on
independent runners; aggregate wall-clock is max(per-scenario) rather
than sum, fitting within Chunk 6's 3.5min budget once s2 and s4 land.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Manual smoke + PR

**Files:** None modified. Operator-only.

- [ ] **Step 9.1: Manual `pjsua` smoke**

With the all-in-docker stack up, register `pjsua` against the local Asterisk, dial the configured DID, let the screen-pop render in a browser (`http://localhost:3000/operator/66666666-6666-6666-6666-666666666666`), then hang up from `pjsua` **before** clicking Accept. Confirm the F03 page shows the "Caller hung up" banner within 1–2 s and the Accept button disappears.

If the manual smoke fails but the e2e spec passes, that's a signal there's harness-only coupling worth fixing before opening the PR (e.g. the spec might be timing the wrong DOM element or relying on test-only seeding).

- [ ] **Step 9.2: Push branch and open PR**

```bash
git push -u origin mvp/chunk-6-s3-caller-hangup
gh pr create --base main --title "feat(chunk-6/s3): caller-hangup — StasisEnd + Banner + e2e spec" --body "$(cat <<'EOF'
## Summary
- New StasisEnd handler in apps/api derives call.endedBy from HANGUPCAUSE, finalizes recording, publishes tas.call.ended over NATS.
- Reusable Banner.tsx + ScreenPop "Caller hung up" warning banner; Accept/PCI hidden once call has ended.
- HC#1 (Chunk 4/5 handoff): DispatchMessage workflow gains a callEnded signal; on cancellation returns {delivered:false, reason:'caller_hung_up'} and writes dispatch_attempt.failureReason.
- Drizzle migrations: recording.endedAt (if missing) + dispatch_attempt.failureReason.
- New e2e spec s3-caller-hangup (≤45s wall-clock). CI matrix extends to [s1, s3].

## Test plan
- [ ] `pnpm --filter @tas/web run test` — Banner + ScreenPop suites green
- [ ] `pnpm --filter @tas/api run test` — StasisEnd handler unit tests green; full api suite green
- [ ] `pnpm --filter @tas/temporal-worker run test` — DispatchMessage cancellation + happy path green
- [ ] `make poc-up-all-docker && scripts/wait-for-healthy.sh && make poc-seed`
- [ ] `make poc-e2e-s1` still green (no regression)
- [ ] `make poc-e2e-s3` green
- [ ] Manual smoke: pjsua → screen-pop → hang up → banner appears, Accept hidden

## Watched-not-fixed
- HC#2 (WsGateway.registerConnection race): observe during s3 CI runs; fold into this PR only if a flake traces to the race.

Refs: docs/superpowers/specs/2026-05-17-chunk-6-slices-2-3-4-design.md §3.1
EOF
)"
```

Verify CI matrix runs both s1 and s3 shards; both green before merge.

- [ ] **Step 9.3: Merge + tag**

After approval and CI green, squash-merge via `gh pr merge --squash`. Tag is deferred until S-4 lands (chunk-level tag `mvp/chunk-6` per design spec §8).

---

## Self-review (per writing-plans skill §Self-Review)

- **Spec coverage:** §3.1 (S-3 architecture) — Tasks 3–5 cover handler + Temporal cancellation + UI. §4 (schema deltas) — Task 1 covers both migrations. §6 (testing strategy) — Tasks 2/3/4/5 each include unit tests; Task 7 covers the e2e; Task 9 covers the manual smoke. §2 PR breakdown for S-3 row — all owned items covered. Exit criteria (§1.5–§1.7) covered by Task 7 assertions + Task 8 CI matrix.
- **Placeholders:** Three reference-during-execution items remain: (a) Task 3.6 mirroring the StasisStartHandler module-registration shape (read-then-mirror, not invented), (b) Task 4.1 grepping for the dispatch_attempt activity name (file location not 100% confirmed in grounding), (c) Task 5.8 mirroring the WS operator-lookup pattern. None are "TODO"s — each is a "read this file, mirror its shape" instruction with the alternative path documented.
- **Type/name consistency:** `Banner` props (variant/message/onDismiss/timeoutMs) consistent between Tasks 2 and 5. `DispatchMessageResult` return shape consistent between Tasks 4.5 and the workflow signature. `WsEvents.CALL_ENDED` / `NatsSubjects.CALL_ENDED` namespacing consistent between Tasks 3.5 (NATS payload) and 5.1 (WS event constant). `deriveEndedBy` signature consistent between Task 3.2 (test) and Task 3.4 (implementation).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-chunk-6-s3-caller-hangup.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh Sonnet+ultrathink subagent per task, review between tasks, two-stage critic on Tasks 3/4 (the highest-risk wiring). Best fit for this plan since each task has clear inputs/outputs and the diagnostic branches in Tasks 4.8 and 5.8 benefit from a focused-context implementer.
2. **Inline Execution** — execute tasks in this session with operator checkpoints. Best fit if the operator wants to drive the manual smoke (Step 9.1) and PR push (Step 9.2) themselves.

Which approach?
