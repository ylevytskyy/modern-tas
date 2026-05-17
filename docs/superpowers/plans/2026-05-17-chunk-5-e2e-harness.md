# Chunk 5 — e2e harness + S-1 CI green Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship S-1 happy-path as the first MVP scenario gated by automated CI on GitHub Actions Linux. Local `make poc-e2e-s1` exits 0; CI `poc-e2e.yml` exits 0 on every push to `mvp/**`. The compose stack matches ADR-0025 (Asterisk-direct — no Kamailio, no rtpengine).

**Architecture:** Phase 0 absorbs the ADR-0025 topology rewire (Chunk 4 left it pending). Phase 1 fans out three Sonnet+ultrathink subagents in parallel — SIPp orchestrator (A), Playwright + spec (B), all-in-docker Dockerfiles (C). Phase 2 wires GitHub Actions on top of all three. Phase 3 captures the readout and opens the PR.

**Tech Stack:** SIPp 3.6.x (Docker) · Playwright 1.46.x + Chromium · vitest 1.4 · `@temporalio/client` 1.11 · `minio` 8.x · drizzle-orm 0.30.4 · pnpm 8.15.4 · Node 22 · GitHub Actions on `ubuntu-22.04`.

**Source spec:** [`docs/superpowers/specs/2026-05-17-chunk-5-e2e-harness-design.md`](../specs/2026-05-17-chunk-5-e2e-harness-design.md) (commit `b5f9a5d`).

**Branch:** `mvp/chunk-5-e2e-harness` (created in Task 1).

---

## Pre-flight (read once before starting)

- Working tree is on `main` at `3012d4d` (post-Chunk-4 merge). Two carry-forward untracked files (`apps/web/next-env.d.ts`, `docs/superpowers/plans/2026-05-16-finish-s9-and-resume-mvp.md`) are **deliberately not touched** — leave them where they are (handoff Do-NOT list).
- Compose stack and host dev processes may or may not be running at handoff. Tasks that need them say so explicitly. Phase 0 brings the stack down at least once (full restart required to validate the rewire).
- `apps/api`, `apps/web`, `apps/temporal-worker` are working at HEAD. Do not regress their existing tests. After every task, `pnpm -r test` must be green (Phase 0 is the only exception — between Task 2 and Task 5, integration tests that drive INVITEs are temporarily unverified).
- **No `data-testid` attributes exist in `apps/web/` today** — Task 6 adds them (main thread, pre-fanout) so subagent B can rely on them.
- Subagent A's interface contract: `runScenario({scenario, callId, target?})` returns `{callId, exitCode, stderr}`. Subagent B imports this as a black box; both subagents must agree on the signature before they fan out (it is locked in this plan — do not amend).
- WS event name constant: `WsEvents.CALL_SCREEN_POP` (value `'call.screenpop'` — note no underscore between "screen" and "pop"; matches Chunk 4 verbatim). Always import the constant on the browser/spec side, never hardcode.
- Workflow id format: `dispatch-<messageId>` (Chunk 4 verbatim). `body.messageId` returned from `POST /v1/Message`.
- Seeded test fixtures from `pnpm --filter @tas/db run seed`:
  - Tenant: `11111111-1111-1111-1111-111111111111`
  - Operator: `66666666-6666-6666-6666-666666666666`
  - DID: routes to that tenant (see `packages/db/src/seed.ts`)
- Self-host Temporal baseline only (ADR-0015-cloud-sdk-deferred). `temporalio/auto-setup:1.22.4` in compose, `@temporalio/*: 1.11.0` in code. Do not introduce Cloud paths.

---

## Parallel dispatch grouping

- **Main thread, sequential:** Tasks 1, 2, 3, 4, 5, 6 (Phase 0 + data-testid pre-flight).
- **Group A** (Subagent A — no api/web touch): Tasks 7, 8, 9, 10.
- **Group B** (Subagent B — no api/worker touch; consumes Task 6 markup): Tasks 11, 12, 13, 14, 15, 16.
- **Group C** (Subagent C — no asterisk/web/api code touch; Makefile and Dockerfiles only): Tasks 17, 18, 19, 20, 21.
- **Main thread** (after A + B + C return, two-stage review): Tasks 22, 23, 24, 25, 26.

Groups A, B, C run in parallel via a single `Agent` tool message with three blocks. Tasks within a group are sequential.

---

## Task 1: Create branch + pre-flight verification

**Files:** none (git state only).

- [ ] **Step 1.1: Confirm clean starting point**

```bash
git rev-parse --abbrev-ref HEAD     # → main
git status --short
```

Expected:
```
?? apps/web/next-env.d.ts
?? docs/superpowers/plans/2026-05-16-finish-s9-and-resume-mvp.md
```
(Two carry-forward untracked files. Anything else: stop and reconcile.)

- [ ] **Step 1.2: Create branch**

```bash
git checkout -b mvp/chunk-5-e2e-harness
```

- [ ] **Step 1.3: Verify Chunk 4 tests pass at HEAD**

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm -r test
```

Expected: all three commands exit 0. Existing test counts: api 29, worker 5, web 13.

---

## Task 2: Remove kamailio + rtpengine from compose; publish 5060/udp on asterisk

**Files:**
- Modify: `infra/docker-compose.yml`

- [ ] **Step 2.1: Bring stack down (preserves volumes via no `-v`)**

```bash
make poc-down -v 2>/dev/null || docker compose -f infra/docker-compose.yml down -v
```

(We intentionally drop volumes — Phase 0 is a clean-restart phase.)

- [ ] **Step 2.2: Remove the `kamailio:` service block (lines 65–81)**

In `infra/docker-compose.yml`, delete the entire block from `  kamailio:` through the closing of its `retries: 10` line, plus the trailing blank line. The block ends just before `  asterisk:`.

- [ ] **Step 2.3: Remove the `rtpengine:` service block (lines 101–108)**

Delete the entire block from `  rtpengine:` through the closing of its `retries: 8` line, plus the trailing blank line. The block ends just before `  minio:`.

- [ ] **Step 2.4: Publish 5060/udp from asterisk to host**

In the `asterisk:` service `ports:` array, add the SIP entry:

```yaml
    ports:
      - "${ASTERISK_SIP_HOST_PORT:-5060}:5060/udp"
      - "${ASTERISK_ARI_HOST_PORT:-8088}:8088"
```

(Order: SIP first, ARI second — convention is "edge first".)

- [ ] **Step 2.5: Verify compose YAML still parses**

```bash
docker compose -f infra/docker-compose.yml config --quiet
```

Expected: exit 0, no output. Failure → fix the YAML before continuing.

- [ ] **Step 2.6: Verify `KAMAILIO_SIP_HOST_PORT` env var is no longer referenced**

```bash
grep -n 'KAMAILIO\|kamailio' infra/docker-compose.yml
```

Expected: zero matches.

```bash
grep -n 'rtpengine' infra/docker-compose.yml
```

Expected: zero matches.

---

## Task 3: Rewrite pjsip.conf for the carrier-shape endpoint

**Files:**
- Modify: `infra/asterisk/pjsip.conf`

- [ ] **Step 3.1: Replace the `[kamailio]` endpoint with `[carrier-sipp]`**

Overwrite the entire `infra/asterisk/pjsip.conf` with:

```ini
[global]
type=global

[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060

[carrier-sipp]
type=endpoint
context=tas-inbound
disallow=all
allow=ulaw
allow=alaw
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
aors=carrier-sipp

[carrier-sipp]
type=aor
max_contacts=4

[carrier-sipp]
type=identify
endpoint=carrier-sipp
match=0.0.0.0/0
```

Notes:
- `context=tas-inbound` matches the existing dialplan in `infra/asterisk/extensions.conf` (do **not** change extensions.conf).
- `match=0.0.0.0/0` is intentionally permissive — PoC. Carrier-direct topology has no SBC tier to whitelist source IPs.
- No `auth` section — INVITEs are accepted unauthenticated (matches Chunk 3 SIPp injection pattern).

- [ ] **Step 3.2: Smoke-check the file**

```bash
test -f infra/asterisk/pjsip.conf && \
  grep -q '^\[carrier-sipp\]' infra/asterisk/pjsip.conf && \
  ! grep -q 'kamailio' infra/asterisk/pjsip.conf && \
  echo "pjsip.conf rewire OK"
```

Expected: `pjsip.conf rewire OK`.

---

## Task 4: Rename `kamailio/` and `rtpengine/` to `*.deferred/`

**Files:**
- Rename: `infra/kamailio/` → `infra/kamailio.deferred/`
- Rename: `infra/rtpengine/` → `infra/rtpengine.deferred/`

- [ ] **Step 4.1: Move with git so history is preserved**

```bash
git mv infra/kamailio infra/kamailio.deferred
git mv infra/rtpengine infra/rtpengine.deferred
```

- [ ] **Step 4.2: Add a `.deferred-note.md` in each renamed directory**

Create `infra/kamailio.deferred/.deferred-note.md`:

```markdown
# Deferred — Kamailio SBC tier

Removed from the active compose stack per [ADR-0025 — Asterisk-direct](../../docs/adr/0025-telephony-asterisk-direct.md) on 2026-05-17 (Chunk 5 Phase 0).

Configs preserved verbatim for the re-introduction path documented in ADR-0025 §"Re-introduction trigger". Do not re-enable without re-opening ADR-0025.
```

Create `infra/rtpengine.deferred/.deferred-note.md`:

```markdown
# Deferred — rtpengine media relay

Removed from the active compose stack per [ADR-0025 — Asterisk-direct](../../docs/adr/0025-telephony-asterisk-direct.md) on 2026-05-17 (Chunk 5 Phase 0).

Configs preserved verbatim for the re-introduction path documented in ADR-0025 §"Re-introduction trigger". Do not re-enable without re-opening ADR-0025.
```

---

## Task 5: Post-rewire boot + pjsua probe + smoke-chunk4 addendum + Phase 0 commit

**Files:**
- Append: `poc/smoke-chunk4.md`

- [ ] **Step 5.1: Boot the rewired stack**

```bash
make poc-up
```

Expected: all services healthy (one fewer than before — no kamailio); supavisor tenant registered.

```bash
docker compose -f infra/docker-compose.yml ps
```

Expected: no `kamailio` row, no `rtpengine` row, `asterisk` healthy.

- [ ] **Step 5.2: Seed the database**

```bash
make poc-seed
```

Expected: 1 tenant, 1 operator, 1 DID, 1 queue inserted; idempotent on re-run.

- [ ] **Step 5.3: Start api + temporal-worker on host (separate terminals)**

In one terminal:
```bash
DATABASE_URL=postgres://tas.tas:tas@localhost:6543/tas \
APP_JWT_SECRET=poc-only-not-prod \
INTERNAL_API_TOKEN=$(openssl rand -hex 32) \
WEB_ORIGIN=http://localhost:3001 \
pnpm --filter @tas/api run dev
```

In another:
```bash
TEMPORAL_ADDRESS=localhost:7233 \
DATABASE_URL=postgres://tas.tas:tas@localhost:6543/tas \
INTERNAL_API_TOKEN=<same-as-above> \
pnpm --filter @tas/temporal-worker run dev
```

Wait until the api logs `Nest application successfully started` and the worker logs `Worker created` (or equivalent — see `apps/temporal-worker/src/worker.ts`).

- [ ] **Step 5.4: Probe with pjsua against the new endpoint**

```bash
./pot/cli-softphone/bin/pjsua \
  --null-audio \
  --auto-loop \
  --duration=3 \
  sip:9999@localhost:5060
```

Watch the api logs for a `StasisStart` event line. If you see one, the rewire is wired correctly.

If you see `503 Service Unavailable` or `404 Not Found` from Asterisk: dialplan or endpoint mismatch — re-check Task 3 (carrier-shape endpoint) and `infra/asterisk/extensions.conf` (`tas-inbound` context).

- [ ] **Step 5.5: Append the post-rewire spot-check to `poc/smoke-chunk4.md`**

Append at the bottom of `poc/smoke-chunk4.md` (do not edit existing content):

```markdown
## Post-rewire spot-check (2026-05-17, Chunk 5 Phase 0)

Verifies the ADR-0025 topology rewire on Linux + Docker Desktop. Kamailio + rtpengine removed; INVITEs enter Asterisk directly on UDP/5060.

- Stack boot: `make poc-up` Green (one fewer service — no kamailio, no rtpengine).
- pjsua probe: `pjsua --null-audio --auto-loop --duration=3 sip:9999@localhost:5060`.
- api log line: `StasisStart … callId=<captured-callId>`.
- ARI WebSocket fired; arbiter picked operator; WS push to operator (manually verified in browser at `http://localhost:3001/operator`).
- `dispatch_attempt.delivered_at` populated for the manual message — end-to-end Chunk 4 path still works on the rewired stack.
```

- [ ] **Step 5.6: Stop host processes; bring stack down**

```bash
# Ctrl-C the api and worker processes in their terminals
make poc-down -v
```

- [ ] **Step 5.7: Run unit tests (sanity)**

```bash
pnpm -r typecheck
pnpm -r test
```

Expected: all green. The rewire is config-only; no code changes — tests are unaffected.

- [ ] **Step 5.8: Commit Phase 0 as two atomic commits**

```bash
git add infra/docker-compose.yml
git commit -m "$(cat <<'EOF'
chore(chunk-5): drop kamailio + rtpengine from compose (ADR-0025)

Asterisk-direct topology per ADR-0025. Publishes 5060/udp directly from
the asterisk service to the host. Closes the ADR-0025 §"Existing infra…"
gap that the master plan assigned to Chunk 4 but Chunk 4 didn't execute.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git add infra/asterisk/pjsip.conf
git commit -m "$(cat <<'EOF'
chore(chunk-5): rewrite pjsip.conf for carrier-shape endpoint (ADR-0025)

Replaces the kamailio internal-trunk endpoint with a permissive
carrier-sipp endpoint that accepts INVITEs on UDP/5060 unauthenticated.
match=0.0.0.0/0 is PoC-only — carrier-direct topology has no SBC tier
to whitelist by source IP. Dialplan context tas-inbound unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git add infra/kamailio.deferred infra/rtpengine.deferred poc/smoke-chunk4.md
git commit -m "$(cat <<'EOF'
chore(chunk-5): archive kamailio/ + rtpengine/ as *.deferred + smoke addendum

Renames infra/kamailio/ and infra/rtpengine/ to *.deferred/ via git mv
(preserves history). Adds .deferred-note.md in each pointing at
ADR-0025. Appends 5-line post-rewire spot-check to poc/smoke-chunk4.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Main-thread pre-flight — `data-testid` attributes + `/health` route

**Files:**
- Modify: `apps/web/components/ScreenPop.tsx`
- Modify: `apps/web/components/MessageForm.tsx`
- Modify: `apps/web/app/operator/page.tsx`
- Modify: `apps/web/lib/ws.ts` (only if missing `onOpen`)
- Create: `apps/web/test/data-testids.spec.tsx`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.module.ts`
- Modify: `apps/api/src/app.module.ts` (register HealthModule)
- Create: `apps/api/src/health/health.controller.spec.ts`

**Why this exists:** subagent B's Playwright page object needs five `data-testid` markers that don't exist today; subagent C's all-in-docker compose healthcheck needs a `GET /health` route on api that also doesn't exist. Adding both as a main-thread pre-flight keeps subagents inside their scopes (B doesn't touch infra, C doesn't touch api code).

- [ ] **Step 6.1: Add `data-testid` to ScreenPop**

In `apps/web/components/ScreenPop.tsx`, change the existing markup so:

- The outer `<section>` becomes `<section aria-label="screen-pop" data-testid="screen-pop" data-call-id={call.callId}>` (only when `call` is non-null — the "Waiting for call…" branch does not get the testid).
- The Accept button becomes `<button onClick={onAccept} data-testid="accept-call">Accept</button>`.

Concretely, the call-active branch becomes:

```tsx
return (
  <section aria-label="screen-pop" data-testid="screen-pop" data-call-id={call.callId}>
    <h2>Incoming call</h2>
    <dl>
      <dt>From</dt><dd>{call.callerE164}</dd>
      <dt>Call ID</dt><dd>{call.callId}</dd>
    </dl>
    {!accepted && <button onClick={onAccept} data-testid="accept-call">Accept</button>}
    {accepted && (
      <>
        <button onClick={onPciToggle}>{paused ? 'Resume' : 'PCI pause'}</button>
        {paused && <span role="status">Paused</span>}
      </>
    )}
  </section>
);
```

- [ ] **Step 6.2: Add `data-testid` to MessageForm**

In `apps/web/components/MessageForm.tsx`:

- The `<textarea>` becomes `<textarea data-testid="message-textarea" value={text} onChange={(e) => setText(e.target.value)} />`.
- The submit `<button>` becomes `<button type="submit" data-testid="message-submit" disabled={disabled || sending}>Send</button>`.

- [ ] **Step 6.3: Add `data-testid="ws-ready"` to the operator page**

In `apps/web/app/operator/page.tsx`, the `createWsClient` hook needs to expose a "ws is open" state. The simplest path: add a `wsReady` state and set it in a `client.onOpen` callback.

Inspect `apps/web/lib/ws.ts` to confirm `createWsClient` already exposes an `onOpen` (or equivalent) callback. If it does, use it directly:

```tsx
const [wsReady, setWsReady] = useState(false);
// ...inside the second useEffect:
const client = createWsClient({ url: WS_URL, token });
client.onOpen?.(() => setWsReady(true));
client.onScreenPop((payload) => { /* unchanged */ });
return () => client.close();
```

If `createWsClient` does **not** expose `onOpen`, add it as a minimal addition (subagent B is allowed to know about this case in advance — see Task 6.4 fallback).

Then add `data-testid="ws-ready"` to a small marker element in the returned JSX:

```tsx
return (
  <main data-ws-ready={wsReady ? 'true' : 'false'}>
    {wsReady && <span data-testid="ws-ready" hidden />}
    {/* existing children */}
  </main>
);
```

- [ ] **Step 6.4: Fallback if `createWsClient` has no `onOpen` callback**

If Step 6.3's `client.onOpen?.(...)` is a no-op (the optional-chain swallows the call), the spec's `waitForWsOpen()` will hang. Add a minimal `onOpen` to `apps/web/lib/ws.ts` — find the existing WebSocket creation site, add:

```ts
// Inside createWsClient, after `const ws = new WebSocket(url + '?token=' + token);`
const openHandlers: Array<() => void> = [];
ws.addEventListener('open', () => openHandlers.forEach((h) => h()));

return {
  onOpen(handler: () => void) { openHandlers.push(handler); },
  onScreenPop(handler: (p: WsIncomingCallPayload) => void) { /* existing */ },
  close() { /* existing */ },
};
```

(If `createWsClient`'s return type was previously inferred — re-export it or widen the type as needed.)

- [ ] **Step 6.5: Write a regression test for the data-testids**

Create `apps/web/test/data-testids.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ScreenPop } from '@/components/ScreenPop';
import { MessageForm } from '@/components/MessageForm';
import type { WsIncomingCallPayload } from '@tas/shared-types';

const sampleCall: WsIncomingCallPayload = {
  type: 'incoming_call',
  callId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: '11111111-1111-1111-1111-111111111111',
  accountId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  callerE164: '+15555550100',
};

describe('Playwright data-testid contract', () => {
  it('ScreenPop renders [data-testid="screen-pop"][data-call-id=callId] when a call is active', () => {
    const { getByTestId } = render(
      <ScreenPop call={sampleCall} accepted={false} paused={false} onAccept={() => {}} onPciToggle={() => {}} />,
    );
    const el = getByTestId('screen-pop');
    expect(el.getAttribute('data-call-id')).toBe(sampleCall.callId);
  });

  it('ScreenPop renders [data-testid="accept-call"] when call is not accepted', () => {
    const { getByTestId } = render(
      <ScreenPop call={sampleCall} accepted={false} paused={false} onAccept={() => {}} onPciToggle={() => {}} />,
    );
    expect(getByTestId('accept-call')).toBeTruthy();
  });

  it('MessageForm renders [data-testid="message-textarea"] and [data-testid="message-submit"]', () => {
    const { getByTestId } = render(<MessageForm onSubmit={() => {}} disabled={false} />);
    expect(getByTestId('message-textarea').tagName).toBe('TEXTAREA');
    expect(getByTestId('message-submit').tagName).toBe('BUTTON');
  });
});
```

- [ ] **Step 6.6: Add the `/health` route to apps/api**

Create `apps/api/src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
```

Create `apps/api/src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

Modify `apps/api/src/app.module.ts` — add `HealthModule` to the `imports` array:

```ts
import { HealthModule } from './health/health.module';
// ...inside @Module({ imports: [ ..., HealthModule ] })
```

Create `apps/api/src/health/health.controller.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('GET /health returns { status: "ok" }', () => {
    const controller = new HealthController();
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 6.7: Run web + api tests**

```bash
pnpm --filter @tas/web run test
pnpm --filter @tas/api run test
```

Expected: web 13 + 3 new = 16 passes; api 29 + 1 new = 30 passes.

- [ ] **Step 6.8: Commit**

```bash
git add apps/web/components/ScreenPop.tsx apps/web/components/MessageForm.tsx \
        apps/web/app/operator/page.tsx apps/web/lib/ws.ts \
        apps/web/test/data-testids.spec.tsx \
        apps/api/src/health apps/api/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(chunk-5): web data-testid hooks + api /health route (pre-flight)

Five data-testid attributes subagent B's OperatorPage depends on
(screen-pop, accept-call, message-textarea, message-submit, ws-ready),
an onOpen callback on createWsClient, and a GET /health route on the
api process for subagent C's compose healthcheck. Pre-flights so
subagents B and C stay inside their respective scopes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase 1 — Three subagents in parallel

Dispatch in a single `Agent` tool message with three blocks. Each subagent: **Sonnet** model, prompt ends with "Ultrathink before you act. Before returning, self-critique: edge cases considered, alternatives rejected, risks remaining. Then state a confidence score (0–100) with one sentence justifying it. Don't inflate — 70 with honest caveats beats 95 with hidden assumptions." `<70` → loop.

---

## Task 7: [Subagent A] Scaffold `@tas/e2e` package + Playwright dependency

**Files:**
- Create: `apps/e2e/package.json`
- Create: `apps/e2e/tsconfig.json`
- Modify: `pnpm-workspace.yaml` (only if not already covering `apps/*`)

- [ ] **Step 7.1: Create `apps/e2e/package.json`**

```json
{
  "name": "@tas/e2e",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run --config vitest.config.ts",
    "test:e2e:s1": "playwright test specs/poc-e2e-s1-happy-path.spec.ts",
    "scenario": "tsx src/run-scenario.ts",
    "lint:sipp": "docker compose -f docker-compose.sipp.yml run --rm sipp -sf /scenarios/happy-path.xml -dry-run 127.0.0.1:5060 || true"
  },
  "dependencies": {
    "@tas/db": "workspace:*",
    "@tas/shared-types": "workspace:*",
    "@temporalio/client": "1.11.0",
    "drizzle-orm": "0.30.4",
    "minio": "8.0.5",
    "postgres": "3.4.4",
    "undici": "6.19.8",
    "uuid": "9.0.1"
  },
  "devDependencies": {
    "@playwright/test": "1.46.1",
    "@types/node": "^24",
    "@types/uuid": "9.0.8",
    "tsx": "4.7.1",
    "typescript": "5.4.2",
    "vitest": "1.4.0"
  }
}
```

- [ ] **Step 7.2: Create `apps/e2e/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "types": ["node", "@playwright/test"]
  },
  "include": ["src/**/*.ts", "pages/**/*.ts", "specs/**/*.ts", "test/**/*.ts"]
}
```

If `tsconfig.base.json` doesn't define the matching options, copy the same shape as `apps/api/tsconfig.json` (verify by reading `apps/api/tsconfig.json` first).

- [ ] **Step 7.3: Install workspace deps**

```bash
pnpm install
```

Expected: 0 exit; lockfile updated; `apps/e2e/node_modules/` populated.

- [ ] **Step 7.4: Sanity check**

```bash
pnpm --filter @tas/e2e run typecheck
```

Expected: 0 exit (no src files yet → no errors).

---

## Task 8: [Subagent A] SIPp Docker compose + happy-path scenario

**Files:**
- Create: `apps/e2e/docker-compose.sipp.yml`
- Create: `apps/e2e/scenarios/happy-path.xml`

- [ ] **Step 8.1: Create `apps/e2e/docker-compose.sipp.yml`**

```yaml
# SIPp container used by the e2e harness to drive INVITEs into Asterisk.
# Joins the infra stack network so it can resolve `asterisk` by name.
# Pinned tag — see spec §8 risk #6.

networks:
  default:
    name: infra_default
    external: true

services:
  sipp:
    image: ctaloni/sipp:3.6.2
    network_mode: "service:asterisk"
    volumes:
      - ./scenarios:/scenarios:ro
    entrypoint: ["sipp"]
```

(`network_mode: "service:asterisk"` shares the asterisk container's network namespace so SIPp dials `127.0.0.1:5060` reliably without DNS games. Cross-checked against Chunk 3's pot/S1 invite-loop.xml which used the same pattern.)

- [ ] **Step 8.2: Create `apps/e2e/scenarios/happy-path.xml`**

```xml
<?xml version="1.0" encoding="ISO-8859-1" ?>
<!DOCTYPE scenario SYSTEM "sipp.dtd">
<scenario name="S-1 happy path INVITE">

  <send retrans="500">
    <![CDATA[
      INVITE sip:9999@[remote_ip]:[remote_port] SIP/2.0
      Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
      From: "sipp" <sip:sipp@[local_ip]:[local_port]>;tag=[call_number]
      To: <sip:9999@[remote_ip]:[remote_port]>
      Call-ID: [field0]
      CSeq: 1 INVITE
      Contact: <sip:sipp@[local_ip]:[local_port]>
      Max-Forwards: 70
      Content-Type: application/sdp
      Content-Length: [len]

      v=0
      o=user1 53655765 2353687637 IN IP[local_ip_type] [local_ip]
      s=-
      c=IN IP[local_ip_type] [local_ip]
      t=0 0
      m=audio [auto_media_port] RTP/AVP 0
      a=rtpmap:0 PCMU/8000
    ]]>
  </send>

  <recv response="100" optional="true" />

  <!-- Stasis doesn't auto-answer in Chunk 4/5 (channel.answer() is Chunk 6).
       Hold the dialog open long enough for screen-pop + accept + submit. -->
  <pause milliseconds="5000" />

  <send retrans="500">
    <![CDATA[
      BYE sip:9999@[remote_ip]:[remote_port] SIP/2.0
      Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
      From: "sipp" <sip:sipp@[local_ip]:[local_port]>;tag=[call_number]
      To: <sip:9999@[remote_ip]:[remote_port]>
      Call-ID: [field0]
      CSeq: 2 BYE
      Max-Forwards: 70
      Content-Length: 0
    ]]>
  </send>

  <recv response="481" optional="true" />

</scenario>
```

`[field0]` will receive the callId UUID via SIPp's `-key field0 <uuid>` (we pass `field0` rather than `callId` because SIPp's CSV-injection key is positional/named differently than its templates — confirmed by SIPp 3.6 docs).

- [ ] **Step 8.3: Verify XML well-formedness**

```bash
xmllint --noout apps/e2e/scenarios/happy-path.xml
```

Expected: 0 exit, no output. If `xmllint` is not installed: `sudo apt-get install -y libxml2-utils`.

---

## Task 9: [Subagent A] `run-scenario.ts` CLI

**Files:**
- Create: `apps/e2e/src/run-scenario.ts`
- Create: `apps/e2e/test/run-scenario.spec.ts`
- Create: `apps/e2e/vitest.config.ts`

- [ ] **Step 9.1: Create `apps/e2e/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    globals: false,
  },
});
```

- [ ] **Step 9.2: Write the failing argv test FIRST**

Create `apps/e2e/test/run-scenario.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const spawnMock = vi.fn(() => ({
  on(event: string, cb: (code: number) => void) {
    if (event === 'close') queueMicrotask(() => cb(1));   // SIPp returns 1 on "Failed call: 1"
    return this;
  },
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
}));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { runScenario } from '../src/run-scenario.js';

describe('runScenario argv shape', () => {
  beforeEach(() => spawnMock.mockClear());

  it('invokes docker compose with the scenario file and -key field0 <callId>', async () => {
    const callId = '11111111-2222-3333-4444-555555555555';
    const result = await runScenario({ scenario: 'happy-path', callId });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe('docker');
    expect(args).toContain('compose');
    expect(args).toContain('-f');
    expect(args.some((a: string) => a.endsWith('docker-compose.sipp.yml'))).toBe(true);
    expect(args).toContain('run');
    expect(args).toContain('--rm');
    expect(args).toContain('sipp');
    expect(args).toContain('-sf');
    expect(args.some((a: string) => a.endsWith('/scenarios/happy-path.xml'))).toBe(true);
    expect(args).toContain('-key');
    expect(args).toContain('field0');
    expect(args).toContain(callId);
    expect(result.callId).toBe(callId);
    expect(result.exitCode).toBe(1);
  });
});
```

- [ ] **Step 9.3: Run the test — expect FAIL (no module)**

```bash
pnpm --filter @tas/e2e run test
```

Expected: FAIL with "Cannot find module '../src/run-scenario.js'".

- [ ] **Step 9.4: Implement `runScenario`**

Create `apps/e2e/src/run-scenario.ts`:

```ts
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RunScenarioParams {
  scenario: 'happy-path';
  callId: string;
  target?: string;     // defaults to 127.0.0.1:5060 (network_mode service:asterisk shares ns)
}

export interface RunScenarioResult {
  callId: string;
  exitCode: number;
  stderr: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const composeFile = path.resolve(__dirname, '../docker-compose.sipp.yml');

export async function runScenario(params: RunScenarioParams): Promise<RunScenarioResult> {
  const target = params.target ?? '127.0.0.1:5060';
  const scenarioPath = `/scenarios/${params.scenario}.xml`;

  return new Promise((resolve, reject) => {
    const args = [
      'compose', '-f', composeFile,
      'run', '--rm', 'sipp',
      '-sf', scenarioPath,
      '-key', 'field0', params.callId,
      '-m', '1', '-r', '1',
      target,
    ];
    const proc = spawn('docker', args);
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on('close', (code: number) => {
      resolve({ callId: params.callId, exitCode: code ?? -1, stderr });
    });
    proc.on('error', (err) => reject(err));
  });
}

// CLI entry — `pnpm --filter @tas/e2e run scenario -- --scenario happy-path --callId <uuid>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const scenarioIdx = argv.indexOf('--scenario');
  const callIdIdx = argv.indexOf('--callId');
  const targetIdx = argv.indexOf('--target');
  if (scenarioIdx < 0 || callIdIdx < 0) {
    console.error('usage: run-scenario --scenario <name> --callId <uuid> [--target host:port]');
    process.exit(2);
  }
  runScenario({
    scenario: argv[scenarioIdx + 1] as 'happy-path',
    callId: argv[callIdIdx + 1],
    target: targetIdx >= 0 ? argv[targetIdx + 1] : undefined,
  })
    .then((res) => { console.log(JSON.stringify(res)); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 9.5: Re-run the test — expect PASS**

```bash
pnpm --filter @tas/e2e run test
```

Expected: 1 passed.

- [ ] **Step 9.6: Typecheck**

```bash
pnpm --filter @tas/e2e run typecheck
```

Expected: 0 exit.

---

## Task 10: [Subagent A] End-to-end SIPp orchestrator verification + commit

- [ ] **Step 10.1: Bring stack up**

```bash
make poc-up && make poc-seed
```

Wait for healthchecks.

- [ ] **Step 10.2: Start api + worker on host (Task 5.3 commands)**

(Subagent A must verify against a running api so StasisStart actually fires.)

- [ ] **Step 10.3: Fire the scenario**

```bash
pnpm --filter @tas/e2e run scenario -- --scenario happy-path --callId $(uuidgen)
```

Expected stdout: JSON `{callId: '...', exitCode: 1, stderr: '...'}` — `exitCode: 1` is the expected "Failed call: 1" pattern; not a test failure.

- [ ] **Step 10.4: Verify Asterisk logged a StasisStart**

```bash
docker compose -f infra/docker-compose.yml logs --tail=200 asterisk | grep -i Stasis
```

Expected: at least one `Stasis Application 'tas'` line with a channel uniqueid corresponding to the call. If you also see api logs, look for `StasisStart` there.

- [ ] **Step 10.5: Bring stack down**

```bash
make poc-down -v
```

- [ ] **Step 10.6: Commit subagent A's work**

```bash
git add apps/e2e/package.json apps/e2e/tsconfig.json apps/e2e/vitest.config.ts \
        apps/e2e/docker-compose.sipp.yml apps/e2e/scenarios/happy-path.xml \
        apps/e2e/src/run-scenario.ts apps/e2e/test/run-scenario.spec.ts \
        pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(chunk-5): SIPp orchestrator (@tas/e2e package + happy-path scenario)

Adds @tas/e2e workspace with the SIPp container, the happy-path
scenario XML, and run-scenario.ts CLI. Verified end-to-end against
the rewired Asterisk-direct stack — INVITE drives a StasisStart on
the API side. SIPp exit code 1 ("Failed call: 1") is the expected
no-answer pattern, not a test failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10.7: Subagent A reports back**

End-of-subagent self-critique + confidence score (0–100). Main thread reviews the diff before subagent B/C results are merged.

---

## Task 11: [Subagent B] Playwright config + e2e test scripts

**Files:**
- Create: `apps/e2e/playwright.config.ts`

- [ ] **Step 11.1: Create `apps/e2e/playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,                       // spec §4 — zero flake budget
  workers: 1,                       // S-1 talks to a singleton compose stack
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  timeout: 75_000,                  // per-scenario S-1 budget
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

- [ ] **Step 11.2: Install Playwright browsers (chromium only)**

```bash
cd apps/e2e && npx playwright install --with-deps chromium
```

(Local prerequisite; CI step will do this too.)

---

## Task 12: [Subagent B] Thin client libs — db, minio, temporal, ari

**Files:**
- Create: `apps/e2e/src/lib/db.ts`
- Create: `apps/e2e/src/lib/minio.ts`
- Create: `apps/e2e/src/lib/temporal.ts`
- Create: `apps/e2e/src/lib/ari.ts`

- [ ] **Step 12.1: `apps/e2e/src/lib/db.ts`**

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@tas/db';

const url = process.env.E2E_DATABASE_URL ?? 'postgres://tas:tas@localhost:5432/tas';

let _client: postgres.Sql | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    _client = postgres(url, { max: 1, prepare: false });
    _db = drizzle(_client, { schema });
  }
  return _db;
}

export async function closeDb() {
  if (_client) {
    await _client.end({ timeout: 1 });
    _client = null;
    _db = null;
  }
}

export { schema };
```

(Uses **direct Postgres on port 5432**, not Supavisor pooled — same reason `make poc-seed` does: short-lived test queries bypass the pooler cleanly.)

- [ ] **Step 12.2: `apps/e2e/src/lib/minio.ts`**

```ts
import { Client } from 'minio';

const endpoint = process.env.E2E_MINIO_ENDPOINT ?? 'localhost';
const port = parseInt(process.env.E2E_MINIO_PORT ?? '9000', 10);
const useSsl = (process.env.E2E_MINIO_USE_SSL ?? 'false') === 'true';
const accessKey = process.env.E2E_MINIO_ACCESS_KEY ?? 'tas';
const secretKey = process.env.E2E_MINIO_SECRET_KEY ?? 'tas12345';

let _client: Client | null = null;

export function getMinio(): Client {
  if (!_client) _client = new Client({ endPoint: endpoint, port, useSSL: useSsl, accessKey, secretKey });
  return _client;
}

export async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await getMinio().statObject(bucket, key);
    return true;
  } catch (err: any) {
    if (err.code === 'NotFound' || err.code === 'NoSuchKey') return false;
    throw err;
  }
}
```

- [ ] **Step 12.3: `apps/e2e/src/lib/temporal.ts`**

```ts
import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';

const address = process.env.E2E_TEMPORAL_ADDRESS ?? 'localhost:7233';

let _client: Client | null = null;

async function getClient(): Promise<Client> {
  if (!_client) {
    const conn = await Connection.connect({ address });
    _client = new Client({ connection: conn });
  }
  return _client;
}

export async function waitForWorkflowCompletion(
  workflowId: string,
  timeoutMs: number,
): Promise<{ status: string }> {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  const deadline = Date.now() + timeoutMs;

  const terminalFailures = new Set(['FAILED', 'TERMINATED', 'CANCELLED', 'TIMED_OUT']);
  while (Date.now() < deadline) {
    try {
      const desc = await handle.describe();
      const statusName = desc.status.name;
      if (statusName === 'COMPLETED') return { status: statusName };
      if (terminalFailures.has(statusName)) {
        throw new Error(`workflow ${workflowId} ended in ${statusName}`);
      }
    } catch (err) {
      if (!(err instanceof WorkflowNotFoundError)) throw err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`workflow ${workflowId} did not complete within ${timeoutMs}ms`);
}
```

- [ ] **Step 12.4: `apps/e2e/src/lib/ari.ts`**

```ts
import { fetch } from 'undici';

const ariBase = process.env.E2E_ARI_BASE ?? 'http://localhost:8088/ari';
const auth = 'Basic ' + Buffer.from('tas:tas').toString('base64');

export interface AriChannel {
  id: string;
  name: string;
  state: string;
  caller: { number: string; name: string };
  channelvars?: Record<string, string>;
}

export async function listChannels(): Promise<AriChannel[]> {
  const res = await fetch(`${ariBase}/channels`, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`ARI /channels returned ${res.status}`);
  return (await res.json()) as AriChannel[];
}
```

(Only `listChannels` is exposed today; assertion helpers call it. Add more endpoints in later chunks.)

---

## Task 13: [Subagent B] `assert-tenant.ts` helper + vitest

**Files:**
- Create: `apps/e2e/src/lib/assert-tenant.ts`
- Create: `apps/e2e/test/assert-tenant.spec.ts`

- [ ] **Step 13.1: Failing test first**

Create `apps/e2e/test/assert-tenant.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

const dbSelectMock = vi.fn();
vi.mock('../src/lib/db.js', () => ({
  getDb: () => ({ select: dbSelectMock }),
  schema: {
    call: { _: 'call' },
    recording: { _: 'recording' },
    dispatchAttempt: { _: 'dispatch_attempt' },
    queueCall: { _: 'queue_call' },
  },
}));

import { assertTenant } from '../src/lib/assert-tenant.js';

describe('assertTenant', () => {
  it('queries each per-tenant table for the seeded tenantId', async () => {
    dbSelectMock.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ tenant_id: 't1' }]) }),
    });
    await assertTenant('t1', 'call-uuid');
    const selectedTables = dbSelectMock.mock.calls.map((c) => c[0]?.tenant_id);
    // Hand-wave: helper queries call, recording, dispatch_attempt, queue_call
    expect(dbSelectMock).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 13.2: Run — expect FAIL**

```bash
pnpm --filter @tas/e2e run test test/assert-tenant.spec.ts
```

Expected: FAIL.

- [ ] **Step 13.3: Implement `assertTenant`**

Create `apps/e2e/src/lib/assert-tenant.ts`:

```ts
import { eq } from 'drizzle-orm';
import { getDb, schema } from './db.js';

const TABLES: Array<{ name: string; table: any; matchBy: 'callId' | 'tenantId' }> = [
  { name: 'call', table: schema.call, matchBy: 'callId' },
  { name: 'recording', table: schema.recording, matchBy: 'callId' },
  { name: 'dispatch_attempt', table: schema.dispatchAttempt, matchBy: 'callId' },
  { name: 'queue_call', table: schema.queueCall, matchBy: 'callId' },
];

export async function assertTenant(expectedTenantId: string, callId: string): Promise<void> {
  const db = getDb();
  for (const t of TABLES) {
    const rows = await db
      .select()
      .from(t.table)
      .where(eq((t.table as any).callId, callId));

    if (rows.length === 0 && t.name !== 'queue_call') {
      // queue_call is optional when there's no re-route (S-1 happy path)
      throw new Error(`assertTenant: no rows in ${t.name} for callId=${callId}`);
    }
    for (const row of rows) {
      const actual = (row as any).tenantId ?? (row as any).tenant_id;
      if (actual !== expectedTenantId) {
        throw new Error(
          `assertTenant: ${t.name} row pk=${(row as any).id} has tenantId=${actual}, expected ${expectedTenantId}`,
        );
      }
    }
  }
}
```

If `schema.call` etc. don't expose `callId` directly: inspect `packages/db/src/schema/*.ts` to find the actual column name and adjust the `where` clause. The drizzle column reference style differs slightly per file.

- [ ] **Step 13.4: Re-run — expect PASS**

```bash
pnpm --filter @tas/e2e run test test/assert-tenant.spec.ts
```

Expected: PASS.

---

## Task 14: [Subagent B] OperatorPage page object

**Files:**
- Create: `apps/e2e/pages/OperatorPage.ts`

- [ ] **Step 14.1: Create `apps/e2e/pages/OperatorPage.ts`**

```ts
import type { Page, Response } from '@playwright/test';

export interface SubmitResult {
  status: number;
  body: { messageId: string; workflowId: string };
}

export class OperatorPage {
  constructor(private readonly page: Page) {}

  async goto(operatorId: string): Promise<void> {
    const url = `/operator?operatorId=${operatorId}`;
    await this.page.goto(url);
  }

  async waitForWsOpen(timeoutMs = 5000): Promise<void> {
    await this.page.waitForSelector('[data-testid="ws-ready"]', { state: 'attached', timeout: timeoutMs });
  }

  async waitForScreenPop(params: { timeoutMs?: number } = {}): Promise<{ callId: string }> {
    const sel = `[data-testid="screen-pop"][data-call-id]`;
    const handle = await this.page.waitForSelector(sel, { state: 'visible', timeout: params.timeoutMs ?? 1000 });
    const callId = await handle.getAttribute('data-call-id');
    if (!callId) throw new Error('screen-pop element rendered without data-call-id');
    return { callId };
  }

  async accept(): Promise<void> {
    await this.page.locator('[data-testid="accept-call"]').click();
  }

  async fillMessage(text: string): Promise<void> {
    await this.page.locator('[data-testid="message-textarea"]').fill(text);
  }

  async submit(): Promise<SubmitResult> {
    const responsePromise = this.page.waitForResponse(
      (r: Response) => r.url().endsWith('/v1/Message') && r.request().method() === 'POST',
      { timeout: 5000 },
    );
    await this.page.locator('[data-testid="message-submit"]').click();
    const res = await responsePromise;
    const body = (await res.json()) as { messageId: string; workflowId: string };
    return { status: res.status(), body };
  }
}
```

---

## Task 15: [Subagent B] `poc-e2e-s1-happy-path.spec.ts`

**Files:**
- Create: `apps/e2e/specs/poc-e2e-s1-happy-path.spec.ts`

- [ ] **Step 15.1: Create the spec**

```ts
import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { runScenario } from '../src/run-scenario.js';
import { OperatorPage } from '../pages/OperatorPage.js';
import { waitForWorkflowCompletion } from '../src/lib/temporal.js';
import { getDb, schema, closeDb } from '../src/lib/db.js';
import { objectExists } from '../src/lib/minio.js';
import { assertTenant } from '../src/lib/assert-tenant.js';
import { eq } from 'drizzle-orm';

const SEEDED_TENANT_ID   = '11111111-1111-1111-1111-111111111111';
const SEEDED_OPERATOR_ID = '66666666-6666-6666-6666-666666666666';
const RECORDINGS_BUCKET  = 'tas-recordings';

test.afterAll(async () => { await closeDb(); });

test('S-1 happy path: INVITE → screen-pop → submit → DispatchMessage completed', async ({ page }) => {
  // sipCallId is the SIPp-side Call-ID header — used for forensic correlation
  // in logs only. The system's call.id is Postgres-generated (defaultRandom);
  // we read the real callId off the rendered DOM after screen-pop.
  const sipCallId = uuidv4();
  const op = new OperatorPage(page);

  // 1. Open the operator UI, wait for WS ready BEFORE firing INVITE
  await op.goto(SEEDED_OPERATOR_ID);
  await op.waitForWsOpen();

  // 2. Fire SIPp INVITE asynchronously
  const inviteAt = Date.now();
  const sippPromise = runScenario({ scenario: 'happy-path', callId: sipCallId });

  // 3. Assert screen-pop renders within 800 ms of INVITE; capture real callId
  const { callId } = await op.waitForScreenPop({ timeoutMs: 1000 });
  const screenPopMs = Date.now() - inviteAt;
  expect(screenPopMs, `screen-pop took ${screenPopMs}ms; budget 800ms`).toBeLessThan(800);

  // 4. Operator accepts, types, submits
  await op.accept();
  await op.fillMessage('S-1 happy-path test message');
  const { status, body } = await op.submit();
  expect(status).toBe(201);
  expect(body.messageId).toBeTruthy();

  // 5. DispatchMessage workflow completes within 30s
  await waitForWorkflowCompletion(`dispatch-${body.messageId}`, 30_000);

  // 6. dispatch_attempt.delivered_at non-null
  const db = getDb();
  const [att] = await db
    .select()
    .from(schema.dispatchAttempt)
    .where(eq((schema.dispatchAttempt as any).messageId, body.messageId));
  expect(att, 'dispatch_attempt row exists').toBeTruthy();
  expect((att as any).deliveredAt ?? (att as any).delivered_at).toBeTruthy();

  // 7. recording row + MinIO placeholder
  const [rec] = await db
    .select()
    .from(schema.recording)
    .where(eq((schema.recording as any).callId, callId));
  expect(rec, 'recording row exists').toBeTruthy();
  const minioKey = `recordings/${callId}.wav`;
  await expect.poll(() => objectExists(RECORDINGS_BUCKET, minioKey), { timeout: 5000 }).toBe(true);

  // 8. tenant_id matches on every per-tenant table touched
  await assertTenant(SEEDED_TENANT_ID, callId);

  // 9. Let SIPp finish to keep teardown clean
  await sippPromise;
});
```

- [ ] **Step 15.2: Sanity typecheck**

```bash
pnpm --filter @tas/e2e run typecheck
```

Expected: 0 exit. If errors point at drizzle schema columns, adjust the `(schema.X as any).y` casts to match the real column names (see Task 13 note).

---

## Task 16: [Subagent B] End-to-end Playwright verification on host-dev + commit

- [ ] **Step 16.1: Boot infra + seed**

```bash
make poc-up && make poc-seed
```

- [ ] **Step 16.2: Boot api + worker + web on host (three terminals)**

Use the env-var blocks from Task 5.3 plus a third terminal:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000 \
NEXT_PUBLIC_WS_URL=ws://localhost:3000/ws \
NEXT_PUBLIC_OPERATOR_ID=66666666-6666-6666-6666-666666666666 \
pnpm --filter @tas/web run dev
```

Wait until `http://localhost:3001/operator` returns the Operator page in a browser.

- [ ] **Step 16.3: Run the spec**

```bash
pnpm --filter @tas/e2e run test:e2e:s1
```

Expected: 1 passed; wall-clock <60s. If FAIL, check:
- Screen-pop budget breach → look at `apps/e2e/playwright-report/` for traces.
- Workflow timeout → check `worker.log` for activity errors; verify `INTERNAL_API_TOKEN` matches across api + worker.
- `dispatch_attempt` missing rows → confirm the seed has the operator + DID; re-run `make poc-seed`.

- [ ] **Step 16.4: Bring everything down**

```bash
# Ctrl-C all three host processes
make poc-down -v
```

- [ ] **Step 16.5: Commit subagent B's work**

```bash
git add apps/e2e/playwright.config.ts apps/e2e/pages apps/e2e/src/lib apps/e2e/specs apps/e2e/test/assert-tenant.spec.ts
git commit -m "$(cat <<'EOF'
feat(chunk-5): Playwright + assertion helpers + S-1 happy-path spec

OperatorPage page object, thin db/minio/temporal/ari clients,
assertTenant helper with per-table tenant_id check, and the S-1
spec that orchestrates INVITE → screen-pop ≤800ms → submit →
workflow completion → DB + MinIO + tenant assertions. Verified
end-to-end against host-dev compose; per-scenario budget 75s.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 16.6: Subagent B reports back**

End-of-subagent self-critique + confidence score (0–100).

---

## Task 17: [Subagent C] `infra/api.Dockerfile` + `.dockerignore`

**Files:**
- Create: `infra/api.Dockerfile`
- Create: `apps/api/.dockerignore`

- [ ] **Step 17.1: Create `apps/api/.dockerignore`**

```
node_modules
dist
.env
.env.*
*.log
worker.log
.next
test/integration
```

- [ ] **Step 17.2: Create `infra/api.Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS deps
WORKDIR /repo
RUN npm i -g pnpm@8.15.4
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ari-client/package.json packages/ari-client/
RUN pnpm fetch
RUN pnpm install --frozen-lockfile --offline

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @tas/db run build || true
RUN pnpm --filter @tas/shared-types run build || true
RUN pnpm --filter @tas/ari-client run build || true
RUN pnpm --filter @tas/api run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN npm i -g pnpm@8.15.4
COPY --from=build /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/packages/db/package.json packages/db/
COPY --from=build /repo/packages/shared-types/package.json packages/shared-types/
COPY --from=build /repo/packages/ari-client/package.json packages/ari-client/
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/packages/db/dist packages/db/dist
COPY --from=build /repo/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /repo/packages/ari-client/dist packages/ari-client/dist
RUN pnpm install --frozen-lockfile --prod
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
```

(The `|| true` on the packages build steps guards against packages that don't have a `build` script — confirm by inspecting each `packages/*/package.json` and removing the guard if all three have `build`.)

- [ ] **Step 17.3: Build the image**

```bash
docker build -f infra/api.Dockerfile -t tas-api:chunk5 .
```

Expected: image builds; final size ~250–400 MB.

---

## Task 18: [Subagent C] `infra/web.Dockerfile` + `.dockerignore`

**Files:**
- Create: `infra/web.Dockerfile`
- Create: `apps/web/.dockerignore`

- [ ] **Step 18.1: Create `apps/web/.dockerignore`**

```
node_modules
.next
.env
.env.*
*.log
test
```

- [ ] **Step 18.2: Create `infra/web.Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS deps
WORKDIR /repo
RUN npm i -g pnpm@8.15.4
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm fetch
RUN pnpm install --frozen-lockfile --offline

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @tas/shared-types run build || true
RUN pnpm --filter @tas/web run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN npm i -g pnpm@8.15.4
COPY --from=build /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/apps/web/package.json apps/web/
COPY --from=build /repo/packages/shared-types/package.json packages/shared-types/
COPY --from=build /repo/apps/web/.next apps/web/.next
COPY --from=build /repo/apps/web/next.config.mjs apps/web/
COPY --from=build /repo/apps/web/public apps/web/public
COPY --from=build /repo/packages/shared-types/dist packages/shared-types/dist
RUN pnpm install --frozen-lockfile --prod
EXPOSE 3001
WORKDIR /app/apps/web
CMD ["pnpm", "start"]
```

If `apps/web/public/` doesn't exist (Next.js auto-creates it on first build), drop the `COPY --from=build /repo/apps/web/public apps/web/public` line. Confirm with `ls apps/web/public 2>/dev/null`.

- [ ] **Step 18.3: Build the image**

```bash
docker build -f infra/web.Dockerfile -t tas-web:chunk5 .
```

Expected: image builds; ~300–500 MB (includes `.next/`).

---

## Task 19: [Subagent C] `infra/temporal-worker.Dockerfile` + `.dockerignore`

**Files:**
- Create: `infra/temporal-worker.Dockerfile`
- Create: `apps/temporal-worker/.dockerignore`

- [ ] **Step 19.1: Create `apps/temporal-worker/.dockerignore`**

```
node_modules
dist
.env
.env.*
*.log
worker.log
```

- [ ] **Step 19.2: Create `infra/temporal-worker.Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS deps
WORKDIR /repo
RUN npm i -g pnpm@8.15.4
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/temporal-worker/package.json apps/temporal-worker/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm fetch
RUN pnpm install --frozen-lockfile --offline

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/temporal-worker apps/temporal-worker
RUN pnpm --filter @tas/db run build || true
RUN pnpm --filter @tas/shared-types run build || true
RUN pnpm --filter @tas/temporal-worker run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN npm i -g pnpm@8.15.4
COPY --from=build /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/apps/temporal-worker/package.json apps/temporal-worker/
COPY --from=build /repo/packages/db/package.json packages/db/
COPY --from=build /repo/packages/shared-types/package.json packages/shared-types/
COPY --from=build /repo/apps/temporal-worker/dist apps/temporal-worker/dist
COPY --from=build /repo/packages/db/dist packages/db/dist
COPY --from=build /repo/packages/shared-types/dist packages/shared-types/dist
RUN pnpm install --frozen-lockfile --prod
WORKDIR /app/apps/temporal-worker
CMD ["node", "dist/worker.js"]
```

- [ ] **Step 19.3: Build the image**

```bash
docker build -f infra/temporal-worker.Dockerfile -t tas-temporal-worker:chunk5 .
```

Expected: image builds; ~250–400 MB.

---

## Task 20: [Subagent C] `infra/docker-compose.all-in.yml` override

**Files:**
- Create: `infra/docker-compose.all-in.yml`

- [ ] **Step 20.1: Create the override**

```yaml
# Compose override that layers api + web + temporal-worker onto the infra stack.
# Loaded together with docker-compose.yml:
#   docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml up -d --build
#
# Used by `make poc-up-all-docker` for CI parity. Host-dev (`make poc-up`) ignores
# this file — apps run via pnpm on the host.

services:
  api:
    build:
      context: ..
      dockerfile: infra/api.Dockerfile
    environment:
      DATABASE_URL: postgres://tas.tas:tas@supavisor:6543/tas
      APP_JWT_SECRET: ${APP_JWT_SECRET}
      INTERNAL_API_TOKEN: ${INTERNAL_API_TOKEN}
      WEB_ORIGIN: http://localhost:3001
      NATS_URL: nats://nats:4222
      REDIS_URL: redis://redis:6379
      TEMPORAL_ADDRESS: temporal:7233
      ARI_URL: http://asterisk:8088/ari
      MINIO_ENDPOINT: minio
      MINIO_PORT: "9000"
      MINIO_ACCESS_KEY: tas
      MINIO_SECRET_KEY: tas12345
      MINIO_USE_SSL: "false"
      NODE_ENV: production
    ports:
      - "3000:3000"
    depends_on:
      supavisor: { condition: service_healthy }
      nats:      { condition: service_healthy }
      redis:     { condition: service_healthy }
      temporal:  { condition: service_healthy }
      minio:     { condition: service_healthy }
      asterisk:  { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "wget --spider -q http://localhost:3000/health || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 12

  web:
    build:
      context: ..
      dockerfile: infra/web.Dockerfile
    environment:
      NEXT_PUBLIC_API_BASE_URL: http://localhost:3000
      NEXT_PUBLIC_WS_URL: ws://localhost:3000/ws
      NEXT_PUBLIC_OPERATOR_ID: 66666666-6666-6666-6666-666666666666
      NODE_ENV: production
    ports:
      - "3001:3001"
    depends_on:
      api: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "wget --spider -q http://localhost:3001 || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 12

  temporal-worker:
    build:
      context: ..
      dockerfile: infra/temporal-worker.Dockerfile
    environment:
      DATABASE_URL: postgres://tas.tas:tas@supavisor:6543/tas
      INTERNAL_API_TOKEN: ${INTERNAL_API_TOKEN}
      TEMPORAL_ADDRESS: temporal:7233
      API_BASE_URL: http://api:3000
      NODE_ENV: production
    depends_on:
      api:      { condition: service_healthy }
      temporal: { condition: service_healthy }
      supavisor: { condition: service_healthy }
```

Notes:
- `apps/api`'s `GET /health` route was added in Task 6 (main-thread pre-flight). Subagent C does not touch `apps/api/src/`.
- The `api → asterisk` health-condition needs the asterisk healthcheck to actually pass — already true (it returns 0 once Asterisk core finishes booting).
- `INTERNAL_API_TOKEN` and `APP_JWT_SECRET` env vars come from the host runner env (CI sets them via `${{ secrets.* }}`; local dev requires they be exported before `make poc-up-all-docker`).

- [ ] **Step 20.2: Smoke-check the override**

```bash
INTERNAL_API_TOKEN=fake APP_JWT_SECRET=fake \
docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml config --quiet
```

Expected: 0 exit. If `${VARIABLE} is not set` warnings appear: ensure the env vars above are exported.

---

## Task 21: [Subagent C] Makefile targets + boot verification + commit

**Files:**
- Modify: `Makefile`

- [ ] **Step 21.1: Add three targets to `Makefile`**

Append at the bottom (do not edit existing targets):

```make
# Boot the full stack including apps as compose services (CI parity).
# Requires INTERNAL_API_TOKEN and APP_JWT_SECRET in env.
poc-up-all-docker:
	docker compose -f $(COMPOSE_FILE) -f infra/docker-compose.all-in.yml up -d --build
	@./scripts/wait-for-healthy.sh $(COMPOSE_FILE) infra/docker-compose.all-in.yml
	@echo "Registering Supavisor tenant 'tas'..."
	@$(MAKE) _supavisor-register-tenant

# Curl smoke against the api service running in all-in-docker mode.
poc-test-all-docker-up:
	@curl -sf http://localhost:3000/health > /dev/null \
	  && echo "api /health OK on all-in-docker" \
	  || (echo "api /health NOT reachable — check docker compose logs api" && exit 1)

# Run the S-1 e2e spec. Assumes either poc-up + host dev OR poc-up-all-docker.
poc-e2e-s1:
	pnpm --filter @tas/e2e run test:e2e:s1
```

- [ ] **Step 21.2: Confirm `scripts/wait-for-healthy.sh` accepts multiple compose files**

```bash
head -30 scripts/wait-for-healthy.sh
```

If the script only accepts one compose file: extend it minimally to accept a second `-f`. The smallest change is to take `$@` as the compose-file list and pass all of them to `docker compose ... ps`. If the change is non-trivial: leave the script as-is and call `docker compose -f X -f Y ps` from the Makefile target inline, replicating the wait loop with `bash -c 'until docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml ps --status running | wc -l ...'`. Pick the simpler of the two paths after reading the script.

- [ ] **Step 21.3: Boot the all-in-docker stack**

```bash
export INTERNAL_API_TOKEN=$(openssl rand -hex 32)
export APP_JWT_SECRET=poc-only-not-prod
make poc-up-all-docker
```

Expected: 11 services up (8 infra + 3 apps), all healthy.

- [ ] **Step 21.4: Seed and smoke**

```bash
make poc-seed
make poc-test-all-docker-up
```

Expected: `api /health OK on all-in-docker`.

- [ ] **Step 21.5: Tear down**

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml down -v
```

- [ ] **Step 21.6: Commit subagent C's work**

```bash
git add infra/api.Dockerfile infra/web.Dockerfile infra/temporal-worker.Dockerfile \
        infra/docker-compose.all-in.yml \
        apps/api/.dockerignore apps/web/.dockerignore apps/temporal-worker/.dockerignore \
        Makefile \
        scripts/wait-for-healthy.sh
git commit -m "$(cat <<'EOF'
feat(chunk-5): all-in-docker target (api/web/temporal-worker Dockerfiles)

Three multi-stage node:22-alpine Dockerfiles, infra/docker-compose.all-in.yml
override, three Makefile targets (poc-up-all-docker, poc-test-all-docker-up,
poc-e2e-s1). Compose api healthcheck consumes the /health route added in
Task 6. Verified end-to-end: make poc-up-all-docker → 11 healthy services
→ curl http://localhost:3000/health returns 200.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 21.7: Subagent C reports back**

End-of-subagent self-critique + confidence score (0–100).

---

# Phase 2 — CI workflow (main thread, after A + B + C reviewed)

---

## Task 22: Integration verification — run the full S-1 spec via all-in-docker

**Files:** none (verification only).

- [ ] **Step 22.1: Boot all-in-docker**

```bash
export INTERNAL_API_TOKEN=$(openssl rand -hex 32)
export APP_JWT_SECRET=poc-only-not-prod
make poc-up-all-docker && make poc-seed
```

- [ ] **Step 22.2: Run the S-1 spec against the all-in-docker stack**

```bash
make poc-e2e-s1
```

Expected: PASS. If FAIL:
- Trace inspection: `apps/e2e/playwright-report/`.
- compose logs: `docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml logs --tail=200`.
- Common failure: `NEXT_PUBLIC_*` env vars baked into the `web` image at build time → if the runtime base URL differs, the browser code hits the wrong host. Confirm `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000` is the build-time value too; if not, bake it into the Dockerfile via a `--build-arg`.

- [ ] **Step 22.3: Tear down**

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml down -v
```

---

## Task 23: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/poc-e2e.yml`

- [ ] **Step 23.1: Create the workflow file**

```yaml
name: poc-e2e
on:
  push:
    branches: ['mvp/**', 'main']
  pull_request:
    branches: ['main']
  workflow_dispatch:

jobs:
  e2e-s1:
    runs-on: ubuntu-22.04
    timeout-minutes: 25
    env:
      INTERNAL_API_TOKEN: ${{ secrets.INTERNAL_API_TOKEN }}
      APP_JWT_SECRET:     ${{ secrets.APP_JWT_SECRET }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 8.15.4 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: pw-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
      - run: npx playwright install --with-deps chromium
      - run: make poc-up-all-docker
      - run: make poc-seed
      - run: pnpm --filter @tas/api run test
      - run: make poc-e2e-s1
      - if: failure()
        run: |
          mkdir -p /tmp/compose-logs
          docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml \
            logs --no-color --tail=2000 > /tmp/compose-logs/all.log || true
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-failure-${{ github.run_id }}
          path: |
            apps/e2e/playwright-report/
            apps/e2e/test-results/
            /tmp/compose-logs/
      - if: always()
        run: docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml down -v || true
```

- [ ] **Step 23.2: Validate the workflow YAML**

```bash
# If actionlint is installed:
actionlint .github/workflows/poc-e2e.yml || true
# Otherwise just confirm parse:
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/poc-e2e.yml'))"
```

Expected: 0 exit.

- [ ] **Step 23.3: Commit the workflow**

```bash
git add .github/workflows/poc-e2e.yml
git commit -m "$(cat <<'EOF'
ci(chunk-5): GitHub Actions poc-e2e workflow on ubuntu-22.04

First CI workflow for the repo. Builds the all-in-docker stack,
seeds, runs the api unit tests (testcontainers) and the S-1 e2e
spec. INTERNAL_API_TOKEN + APP_JWT_SECRET via repo secrets. On
failure: uploads Playwright traces + compose logs as an artifact.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 24: Set repo secrets + push + first CI run

**Files:** none (network ops).

- [ ] **Step 24.1: Confirm with the operator before each network op**

The handoff explicitly says: "DO NOT push to origin without an explicit go-ahead — even with gh auth reconfigured, the user wants to review each network op."

Pause here. Ask the operator to confirm before each of: (a) `gh secret set`, (b) `git push`, (c) `gh pr create`.

- [ ] **Step 24.2: Set repo secrets (with operator confirmation)**

```bash
gh secret set INTERNAL_API_TOKEN --body "$(openssl rand -hex 32)" --repo ylevytskyy/modern-tas
gh secret set APP_JWT_SECRET     --body "poc-only-not-prod"       --repo ylevytskyy/modern-tas
```

Verify:
```bash
gh secret list --repo ylevytskyy/modern-tas
```

Expected: `INTERNAL_API_TOKEN` and `APP_JWT_SECRET` listed.

Note: `gh` may be authed only for the work GitHub account (handoff). If `gh secret set` fails with auth, the operator runs `gh auth login --hostname github.com --git-protocol ssh` for the personal account.

- [ ] **Step 24.3: Push the branch (with operator confirmation)**

```bash
git push -u origin mvp/chunk-5-e2e-harness
```

- [ ] **Step 24.4: Watch the first run**

```bash
gh run list --workflow=poc-e2e.yml --repo ylevytskyy/modern-tas --limit 1
gh run watch <run-id> --repo ylevytskyy/modern-tas
```

Expected outcomes (in priority order):
- **Green** → proceed to Task 25.
- **Red on `make poc-up-all-docker`** → most likely a Dockerfile env-var bake-in issue. Pull the artifact, inspect `/tmp/compose-logs/all.log`, fix locally, commit, push.
- **Red on `make poc-e2e-s1`** → most likely a timing or env-var mismatch. Pull Playwright traces from the artifact. Fix locally, commit, push.
- **Red on job timeout (25 min)** → cache misses on first run. Bump `timeout-minutes` to 35 in `poc-e2e.yml` if and only if a second run also exceeds 20 min.

Each fix lands as a small commit; CI re-runs automatically.

---

# Phase 3 — Readout + PR

---

## Task 25: Write `poc/readout-slice1.md`

**Files:**
- Create: `poc/readout-slice1.md`

- [ ] **Step 25.1: Pull the green CI run's timing**

```bash
gh run view <green-run-id> --repo ylevytskyy/modern-tas --log > /tmp/poc-e2e-run.log
```

Extract per-step wall-clock from the log header lines.

- [ ] **Step 25.2: Create the readout**

```markdown
# Slice-1 Readout — S-1 happy-path Green

**Date:** 2026-05-DD · **Operator:** Yuriy Lev · **Branch:** `mvp/chunk-5-e2e-harness` · **Result:** Green

Closes Chunk 5 — first MVP scenario gated by automated CI.

## CI run

- Workflow: `.github/workflows/poc-e2e.yml`
- Run URL: <https://github.com/ylevytskyy/modern-tas/actions/runs/<run-id>>
- Total wall-clock: **<N>m <S>s**
- Runner: `ubuntu-22.04`, ephemeral hosted

### Step timings

| # | Step | Wall-clock |
|---|---|---|
| 1 | checkout + setup-pnpm + setup-node | <s>s |
| 2 | pnpm install --frozen-lockfile | <s>s |
| 3 | npx playwright install --with-deps chromium | <s>s |
| 4 | make poc-up-all-docker | <s>s |
| 5 | make poc-seed | <s>s |
| 6 | pnpm --filter @tas/api run test | <s>s |
| 7 | make poc-e2e-s1 | <s>s |
| 8 | teardown (always) | <s>s |

## S-1 spec assertions (in order)

1. SIPp INVITE accepted, StasisStart fired. ✓
2. `call.screenpop` WS event received in headless Chromium. ✓
3. `[data-testid="screen-pop"]` rendered in **<N> ms** (budget 800 ms). ✓
4. `POST /v1/Message` returned **201 in <N> ms**. ✓
5. `DispatchMessage` workflow Completed in **<N> ms** (budget 30 s). ✓
6. `dispatch_attempt.delivered_at` non-null. ✓
7. `recording` row + MinIO object `recordings/<callId>.wav` present. ✓
8. `tenant_id` matches seeded tenant on every per-tenant row. ✓
9. Total spec wall-clock: **<N>s** (per-scenario budget 75 s). ✓

## Residual issues / carry-forward

- (Same handoff carry-forwards still apply: workflow `delivered: false` branch, `callerE164: ''` hardcode, Asterisk `channel.answer()`, registerConnection race — all explicitly Chunk 6.)
- Add Chunk-5-specific findings here.

## Sign-off

`mvp/chunk-5-e2e-harness` ready for merge to `main`. Tag `mvp/chunk-5` to be pushed after merge.
```

(Fill the `<N>`, `<s>`, `<run-id>` placeholders from the CI run output.)

- [ ] **Step 25.3: Commit**

```bash
git add poc/readout-slice1.md
git commit -m "$(cat <<'EOF'
docs(chunk-5): Slice-1 readout — S-1 happy-path Green in CI

First MVP scenario gated by automated CI. End-to-end through the
all-in-docker stack on ubuntu-22.04: SIPp INVITE → screen-pop
≤800ms → DispatchMessage Completed → DB + MinIO + tenant_id
assertions all green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 25.4: Push the readout**

```bash
git push
```

(Triggers a second CI run on the same branch — should stay green.)

---

## Task 26: Open the PR

**Files:** none (gh op).

- [ ] **Step 26.1: Confirm with operator before `gh pr create`**

Final network-op pause. Confirm.

- [ ] **Step 26.2: Open the PR**

```bash
gh pr create --base main --head mvp/chunk-5-e2e-harness \
  --title "Chunk 5: e2e harness + S-1 CI green (ADR-0025 topology rewire)" \
  --body "$(cat <<'EOF'
## Summary

- Topology rewire (Phase 0): Kamailio + rtpengine removed per ADR-0025; pjsip.conf rewritten for carrier-direct; configs preserved in `infra/{kamailio,rtpengine}.deferred/`.
- `apps/e2e` package: Playwright + SIPp orchestrator + assertion helpers + OperatorPage.
- `poc-e2e-s1-happy-path.spec.ts`: INVITE → screen-pop ≤800 ms → DispatchMessage Completed → DB + MinIO + tenant_id checks.
- All-in-docker: three Dockerfiles (api/web/temporal-worker) + `docker-compose.all-in.yml` override + `make poc-up-all-docker`.
- GitHub Actions `poc-e2e.yml` on `ubuntu-22.04` — first CI workflow for the repo.
- Slice-1 readout: `poc/readout-slice1.md`.

## Spec / plan

- Design: `docs/superpowers/specs/2026-05-17-chunk-5-e2e-harness-design.md`
- Plan: `docs/superpowers/plans/2026-05-17-chunk-5-e2e-harness.md`

## Test plan

- [x] `pnpm -r typecheck` green
- [x] `pnpm -r test` green (api 30, worker 5, web 16, e2e 2 unit tests)
- [x] `make poc-up` Green (no kamailio, no rtpengine)
- [x] `make poc-up-all-docker` Green (11 healthy services)
- [x] Manual pjsua smoke on rewired stack (poc/smoke-chunk4.md addendum)
- [x] `make poc-e2e-s1` Green locally
- [x] GitHub Actions `poc-e2e.yml` Green (run: <link>)
- [x] Slice-1 readout committed (`poc/readout-slice1.md`)

## Out of scope (Chunk 6 / 7)

- S-2..S-5 scenarios, audio path (`channel.answer()`), `callerE164` hardcode, workflow `delivered: false` branch, leader failover, aggregate ≤3.5 min budget.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 26.3: Report PR URL to operator**

After `gh pr create` returns the URL, share it with the operator. Merge happens via the GitHub web UI per the handoff convention.

---

# Self-review checklist (for the agent running this plan)

Before claiming Chunk 5 complete:

1. `grep -c 'kamailio\|rtpengine' infra/docker-compose.yml` → `0`.
2. `pnpm -r typecheck` and `pnpm -r test` both green.
3. `make poc-up` Green; `docker compose ps` shows no kamailio or rtpengine.
4. `make poc-up-all-docker` Green; `make poc-test-all-docker-up` exits 0.
5. `make poc-e2e-s1` Green locally; same target Green in GitHub Actions.
6. `poc/readout-slice1.md` filled with real CI run URL and timings (not placeholders).
7. `poc/smoke-chunk4.md` has the post-rewire spot-check addendum.
8. PR opened from `mvp/chunk-5-e2e-harness` → `main` with the body above.
9. No commits touched the two carry-forward untracked files.

If any of these are red, do not open the PR — fix first.
