# Chunk 4 — F03 operator UI + Temporal worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the F03 operator screen-pop demo on `localhost:3001` — INVITE → screen-pop ≤800 ms → operator submits message → `DispatchMessage` Temporal workflow completes → `dispatch_attempt.delivered_at` non-null. End-to-end observable without an e2e harness.

**Architecture:** Two new pnpm workspace packages (`apps/web` Next.js App Router on port 3001; `apps/temporal-worker` running `DispatchMessage` workflow + two activities) plus three additions to `apps/api` (`TemporalModule` singleton client, `/v1/dev/operator-token` dev-only JWT mint, `/internal/dispatch-deliver` worker callback). Worker loops back through `apps/api` over HTTP so the WS socket registry stays single-owner in the NestJS process.

**Tech Stack:** Next.js 14.2.x App Router · React 18.3 · `@temporalio/worker` 1.11.x · `@temporalio/client` 1.11.x · vitest 1.4 + jsdom + `@testing-library/react` · NestJS 10.3 · Drizzle 0.30 · `jsonwebtoken` 9.

**Source spec:** [`docs/superpowers/specs/2026-05-16-chunk-4-f03-worker-design.md`](../specs/2026-05-16-chunk-4-f03-worker-design.md)

**Branch:** `mvp/chunk-4-f03-worker` (already created; spec commit `95e2d6a` is on it).

---

## Pre-flight (read once before starting)

- The feature branch `mvp/chunk-4-f03-worker` is checked out. Confirm with `git rev-parse --abbrev-ref HEAD`.
- Compose stack is **down** at handoff. Tasks that need it say so explicitly; otherwise stay off the network.
- `apps/api` is already running TDD'd vitest tests (Chunk 2/3); we extend, never break.
- Master spec exit criteria mandate **self-host Temporal baseline** per [ADR-0015-cloud-sdk-deferred](../../adr/0015-cloud-sdk-deferred.md). All Temporal version pins assume self-host server `temporalio/auto-setup:1.22.4` (already in `infra/docker-compose.yml`).
- The shared-types constant for the WS event name is `WsEvents.CALL_SCREEN_POP` (value: `'call.screenpop'`). Always import the constant; do not hardcode the string.
- `WsIncomingCallPayload` already exists in `packages/shared-types/src/events.ts`; reuse it on the browser side.

---

## Parallel dispatch grouping

Per the spec §6 subagent plan:

- **Main thread, pre-flight:** Task 1a (shared-types extension)
- **Group A** (Subagent A, no api/web touch): Tasks 1, 2, 3, 4, 5
- **Group B** (Subagent B, no api/worker touch): Tasks 6, 7, 8, 9, 10, 11
- **Main thread** (after A + B return + review): Tasks 12, 13, 14, 15, 16, 17

Tasks within a group are sequential. Groups A and B can run in parallel. Task 1a runs once before either group starts (it touches shared-types and apps/api/stasis-start.handler.ts, which both groups consume).

---

## Task 1a: Extend `WsIncomingCallPayload` with `accountId` (main-thread pre-flight)

**Files:**
- Modify: `packages/shared-types/src/events.ts`
- Modify: `apps/api/src/telephony/stasis-start.handler.ts`
- Modify: `apps/api/src/telephony/stasis-start.handler.spec.ts` (extend existing assertion)

**Why this exists:** Subagent B's operator page needs `accountId` to call `POST /v1/Message`. The current `WsIncomingCallPayload` (Chunk 3) omits it. Five LOC, runs before parallel dispatch so neither subagent has to coordinate.

- [ ] **Step 1: Extend the type**

Edit `packages/shared-types/src/events.ts` — add `accountId: string;` to `WsIncomingCallPayload`:

```ts
export interface WsIncomingCallPayload {
  type: 'incoming_call';
  callId: string;
  tenantId: string;
  accountId: string;
  callerE164: string;
}
```

- [ ] **Step 2: Add the field to the StasisStart handler's WS emit**

Inspect `apps/api/src/telephony/stasis-start.handler.ts` to find where `WsIncomingCallPayload` is constructed (search for `tenantId:` near a `callerE164:` line). Add `accountId: <existing source variable>,` to the object literal. The handler already has the NATS `stasis.start` payload (which includes `accountId` per `NatsStasisStartPayload`); pass it through.

- [ ] **Step 3: Extend the handler's spec**

Find the existing test in `apps/api/src/telephony/stasis-start.handler.spec.ts` that asserts WS-emit shape (search for `WsEvents.CALL_SCREEN_POP` or `sendToOperator`). Add an `expect(...).toBe(...)` assertion that the emitted payload's `accountId` matches the fixture's accountId.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @tas/api run test
```

Expected: prior tests still green; the new accountId assertion passes.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/events.ts apps/api/src/telephony/stasis-start.handler.ts apps/api/src/telephony/stasis-start.handler.spec.ts
git commit -m "feat(chunk-4): add accountId to WsIncomingCallPayload + StasisStart emit"
```

---

## Task 1: Scaffold `apps/temporal-worker` package

**Files:**
- Create: `apps/temporal-worker/package.json`
- Create: `apps/temporal-worker/tsconfig.json`
- Create: `apps/temporal-worker/vitest.config.ts`
- Create: `apps/temporal-worker/.gitignore`

- [ ] **Step 1: Create `apps/temporal-worker/package.json`**

```json
{
  "name": "@tas/temporal-worker",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx --inspect=0.0.0.0:9230 src/worker.ts 2>&1 | tee worker.log",
    "start": "tsx src/worker.ts 2>&1 | tee worker.log",
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --config vitest.config.ts"
  },
  "dependencies": {
    "@tas/db": "workspace:*",
    "@tas/shared-types": "workspace:*",
    "@temporalio/activity": "1.11.0",
    "@temporalio/worker": "1.11.0",
    "@temporalio/workflow": "1.11.0",
    "drizzle-orm": "0.30.4",
    "postgres": "3.4.4"
  },
  "devDependencies": {
    "@temporalio/testing": "1.11.0",
    "@testcontainers/postgresql": "10.9.0",
    "testcontainers": "10.9.0",
    "tsx": "4.7.1",
    "typescript": "5.4.2",
    "vitest": "1.4.0"
  }
}
```

- [ ] **Step 2: Create `apps/temporal-worker/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `apps/temporal-worker/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    testTimeout: 30000,
    alias: {
      '@tas/db/client': resolve(__dirname, '../../packages/db/src/client.ts'),
      '@tas/db': resolve(__dirname, '../../packages/db/src/schema/index.ts'),
      '@tas/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
    },
  },
});
```

- [ ] **Step 4: Create `apps/temporal-worker/.gitignore`**

```
dist/
node_modules/
worker.log
*.tsbuildinfo
```

- [ ] **Step 5: Install workspace dependencies**

```bash
pnpm install
```

Expected: pnpm resolves all packages; `apps/temporal-worker/node_modules` populated. The `@temporalio/*@1.11.0` line must come down clean — that pin is the SDK-identity guard for compose server 1.22.4.

- [ ] **Step 6: Commit**

```bash
git add apps/temporal-worker/package.json apps/temporal-worker/tsconfig.json apps/temporal-worker/vitest.config.ts apps/temporal-worker/.gitignore pnpm-lock.yaml
git commit -m "feat(chunk-4): scaffold @tas/temporal-worker package"
```

---

## Task 2: `DispatchMessage` workflow (TDD)

**Files:**
- Create: `apps/temporal-worker/src/workflows/dispatch-message.ts`
- Create: `apps/temporal-worker/test/dispatch-message.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/temporal-worker/test/dispatch-message.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { dispatchMessage } from '../src/workflows/dispatch-message';

describe('DispatchMessage workflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  it('calls deliverViaWs then markDelivered with the message id', async () => {
    const calls: string[] = [];
    const activities = {
      deliverViaWs: async (input: { messageId: string; operatorId: string; payload: unknown }) => {
        calls.push(`deliverViaWs:${input.messageId}`);
        return { delivered: true };
      },
      markDelivered: async (input: { messageId: string }) => {
        calls.push(`markDelivered:${input.messageId}`);
      },
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: 'test',
      workflowsPath: require.resolve('../src/workflows/dispatch-message'),
      activities,
    });

    const handle = await env.client.workflow.start(dispatchMessage, {
      taskQueue: 'test',
      workflowId: 'wf-test-1',
      args: [{
        messageId: 'm-1',
        operatorId: 'op-1',
        tenantId: 't-1',
        payload: { callId: 'c-1', body: 'hello' },
      }],
    });

    await worker.runUntil(handle.result());

    expect(calls).toEqual(['deliverViaWs:m-1', 'markDelivered:m-1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @tas/temporal-worker run test
```

Expected: FAIL — `Cannot find module '../src/workflows/dispatch-message'` or equivalent.

- [ ] **Step 3: Implement minimal workflow**

Create `apps/temporal-worker/src/workflows/dispatch-message.ts`:

```ts
import { proxyActivities } from '@temporalio/workflow';

export interface DispatchMessageInput {
  messageId: string;
  operatorId: string;
  tenantId: string;
  payload: unknown;
}

const { deliverViaWs, markDelivered } = proxyActivities<{
  deliverViaWs(input: {
    messageId: string;
    operatorId: string;
    payload: unknown;
  }): Promise<{ delivered: boolean }>;
  markDelivered(input: { messageId: string }): Promise<void>;
}>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

export async function dispatchMessage(input: DispatchMessageInput): Promise<void> {
  await deliverViaWs({
    messageId: input.messageId,
    operatorId: input.operatorId,
    payload: input.payload,
  });
  await markDelivered({ messageId: input.messageId });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @tas/temporal-worker run test
```

Expected: PASS — single test green.

- [ ] **Step 5: Commit**

```bash
git add apps/temporal-worker/src/workflows/dispatch-message.ts apps/temporal-worker/test/dispatch-message.spec.ts
git commit -m "feat(chunk-4): DispatchMessage workflow with deliver + mark activities"
```

---

## Task 3: `deliver-via-ws` activity (TDD)

**Files:**
- Create: `apps/temporal-worker/src/activities/deliver-via-ws.ts`
- Create: `apps/temporal-worker/src/activities/deliver-via-ws.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/temporal-worker/src/activities/deliver-via-ws.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDeliverViaWs } from './deliver-via-ws';

describe('deliverViaWs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to /internal/dispatch-deliver with the X-Internal-Token header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ delivered: true }),
    });
    const activity = makeDeliverViaWs({
      apiBaseUrl: 'http://api.test',
      internalToken: 'secret-123',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await activity({
      messageId: 'm-1',
      operatorId: 'op-1',
      payload: { body: 'hi' },
    });

    expect(result).toEqual({ delivered: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/internal/dispatch-deliver');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Internal-Token']).toBe('secret-123');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      messageId: 'm-1',
      operatorId: 'op-1',
      payload: { body: 'hi' },
    });
  });

  it('throws when the api returns non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    const activity = makeDeliverViaWs({
      apiBaseUrl: 'http://api.test',
      internalToken: 'secret-123',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(activity({
      messageId: 'm-1', operatorId: 'op-1', payload: {},
    })).rejects.toThrow(/502/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @tas/temporal-worker run test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the activity**

Create `apps/temporal-worker/src/activities/deliver-via-ws.ts`:

```ts
export interface DeliverViaWsInput {
  messageId: string;
  operatorId: string;
  payload: unknown;
}

export interface DeliverViaWsOutput {
  delivered: boolean;
}

export interface DeliverViaWsDeps {
  apiBaseUrl: string;
  internalToken: string;
  fetch?: typeof fetch;
}

export function makeDeliverViaWs(deps: DeliverViaWsDeps) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  return async function deliverViaWs(input: DeliverViaWsInput): Promise<DeliverViaWsOutput> {
    const res = await fetchImpl(`${deps.apiBaseUrl}/internal/dispatch-deliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': deps.internalToken,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`dispatch-deliver returned ${res.status}`);
    return (await res.json()) as DeliverViaWsOutput;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @tas/temporal-worker run test
```

Expected: PASS — both activity tests green; workflow test still green.

- [ ] **Step 5: Commit**

```bash
git add apps/temporal-worker/src/activities/deliver-via-ws.ts apps/temporal-worker/src/activities/deliver-via-ws.spec.ts
git commit -m "feat(chunk-4): deliver-via-ws activity with X-Internal-Token guard"
```

---

## Task 4: `mark-delivered` activity (TDD, testcontainers)

**Files:**
- Create: `apps/temporal-worker/src/activities/mark-delivered.ts`
- Create: `apps/temporal-worker/src/activities/mark-delivered.spec.ts`
- Create: `apps/temporal-worker/test/vitest.globalSetup.ts`

- [ ] **Step 1: Add globalSetup to vitest config**

Edit `apps/temporal-worker/vitest.config.ts` to add `globalSetup`:

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    globalSetup: './test/vitest.globalSetup.ts',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    testTimeout: 60000,
    alias: {
      '@tas/db/client': resolve(__dirname, '../../packages/db/src/client.ts'),
      '@tas/db': resolve(__dirname, '../../packages/db/src/schema/index.ts'),
      '@tas/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
    },
  },
});
```

- [ ] **Step 2: Create globalSetup that spins up Postgres + runs migrations**

Create `apps/temporal-worker/test/vitest.globalSetup.ts` (mirror of `apps/api/test/vitest.globalSetup.ts`):

```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import path from 'path';

let container: StartedPostgreSqlContainer;

export async function setup() {
  container = await new PostgreSqlContainer('postgres:15')
    .withDatabase('tas')
    .withUsername('tas')
    .withPassword('tas')
    .start();

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  const migrateScript = path.resolve(__dirname, '../../../packages/db/src/migrate.ts');
  execSync(`tsx ${migrateScript}`, {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}

export async function teardown() {
  await container?.stop();
}
```

- [ ] **Step 3: Write the failing test**

Create `apps/temporal-worker/src/activities/mark-delivered.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '@tas/db/client';
import { tenant, account, did, user, call, message, dispatchAttempt } from '@tas/db';
import { makeMarkDelivered } from './mark-delivered';

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const DID_ID     = '33333333-3333-3333-3333-333333333333';
const OPERATOR_ID = '66666666-6666-6666-6666-666666666666';
const CALL_ID    = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('markDelivered', () => {
  let db: ReturnType<typeof makeDb>;
  let messageId: string;

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Acc' }).onConflictDoNothing();
    await db.insert(did).values({ id: DID_ID, accountId: ACCOUNT_ID, e164: '+15555550100' }).onConflictDoNothing();
    await db.insert(user).values({ id: OPERATOR_ID, tenantId: TENANT_ID, email: 'op@demo.test', role: 'operator' }).onConflictDoNothing();
    await db.insert(call).values({
      id: CALL_ID, tenantId: TENANT_ID, accountId: ACCOUNT_ID, didId: DID_ID,
      fromE164: '+15555550200', startedAt: new Date(),
    }).onConflictDoNothing();
    const [msg] = await db.insert(message).values({
      tenantId: TENANT_ID, callId: CALL_ID, accountId: ACCOUNT_ID, operatorId: OPERATOR_ID, body: 'hi',
    }).returning({ id: message.id });
    messageId = msg.id;
    await db.insert(dispatchAttempt).values({
      messageId, channel: 'in_app',
    });
  });

  it('sets delivered_at on the matching dispatch_attempt row', async () => {
    const activity = makeMarkDelivered(db);
    await activity({ messageId });
    const [row] = await db.select().from(dispatchAttempt).where(eq(dispatchAttempt.messageId, messageId));
    expect(row.deliveredAt).not.toBeNull();
  });

  it('is idempotent: re-running does not blow up and keeps delivered_at non-null', async () => {
    const activity = makeMarkDelivered(db);
    await activity({ messageId });
    await activity({ messageId });
    const [row] = await db.select().from(dispatchAttempt).where(eq(dispatchAttempt.messageId, messageId));
    expect(row.deliveredAt).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
pnpm --filter @tas/temporal-worker run test
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement the activity**

Create `apps/temporal-worker/src/activities/mark-delivered.ts`:

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { dispatchAttempt } from '@tas/db';
import type { Db } from '@tas/db/client';

export interface MarkDeliveredInput {
  messageId: string;
}

export function makeMarkDelivered(db: Db) {
  return async function markDelivered(input: MarkDeliveredInput): Promise<void> {
    await db
      .update(dispatchAttempt)
      .set({ deliveredAt: new Date() })
      .where(and(
        eq(dispatchAttempt.messageId, input.messageId),
        isNull(dispatchAttempt.deliveredAt),
      ));
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm --filter @tas/temporal-worker run test
```

Expected: PASS — all three test files green.

- [ ] **Step 7: Commit**

```bash
git add apps/temporal-worker/src/activities/mark-delivered.ts apps/temporal-worker/src/activities/mark-delivered.spec.ts apps/temporal-worker/test/vitest.globalSetup.ts apps/temporal-worker/vitest.config.ts
git commit -m "feat(chunk-4): mark-delivered activity with idempotent UPDATE"
```

---

## Task 5: Worker bootstrap (`src/worker.ts`)

**Files:**
- Create: `apps/temporal-worker/src/worker.ts`
- Create: `apps/temporal-worker/.env.example`

- [ ] **Step 1: Write the worker bootstrap**

Create `apps/temporal-worker/src/worker.ts`:

```ts
import { NativeConnection, Worker } from '@temporalio/worker';
import { makeDb } from '@tas/db/client';
import { makeDeliverViaWs } from './activities/deliver-via-ws';
import { makeMarkDelivered } from './activities/mark-delivered';

async function main(): Promise<void> {
  const temporalAddress = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
  const internalToken = process.env.INTERNAL_API_TOKEN;
  const dbUrl = process.env.DATABASE_URL;

  if (!internalToken) throw new Error('INTERNAL_API_TOKEN env required');
  if (!dbUrl) throw new Error('DATABASE_URL env required');

  const connection = await NativeConnection.connect({ address: temporalAddress });
  const db = makeDb(dbUrl);

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: 'dispatch-message',
    workflowsPath: require.resolve('./workflows/dispatch-message'),
    activities: {
      deliverViaWs: makeDeliverViaWs({ apiBaseUrl, internalToken }),
      markDelivered: makeMarkDelivered(db),
    },
  });

  console.log(`worker: ready taskQueue=dispatch-message namespace=${namespace} address=${temporalAddress}`);
  await worker.run();
}

main().catch((err) => {
  console.error('worker: fatal', err);
  process.exit(1);
});
```

- [ ] **Step 2: Create `.env.example`**

Create `apps/temporal-worker/.env.example`:

```
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
API_BASE_URL=http://localhost:3000
INTERNAL_API_TOKEN=replace-with-hex-from-infra/.env
DATABASE_URL=postgres://postgres:tas@localhost:5432/tas
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter @tas/temporal-worker run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/temporal-worker/src/worker.ts apps/temporal-worker/.env.example
git commit -m "feat(chunk-4): worker bootstrap wiring activities + Temporal connection"
```

---

## Task 6: Scaffold `apps/web` package

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/test/vitest.setup.ts`
- Create: `apps/web/.gitignore`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@tas/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3001",
    "build": "next build",
    "start": "next start --port 3001",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --config vitest.config.ts"
  },
  "dependencies": {
    "@tas/shared-types": "workspace:*",
    "next": "14.2.4",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "6.4.2",
    "@testing-library/react": "14.3.1",
    "@testing-library/user-event": "14.5.2",
    "@types/react": "18.3.3",
    "@types/react-dom": "18.3.0",
    "@vitejs/plugin-react": "4.3.1",
    "jsdom": "24.0.0",
    "typescript": "5.4.2",
    "vitest": "1.4.0"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "jsx": "preserve",
    "noEmit": true,
    "incremental": true,
    "moduleResolution": "Bundler",
    "module": "ESNext",
    "allowJs": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `apps/web/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tas/shared-types'],
};
export default nextConfig;
```

- [ ] **Step 4: Create `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/vitest.setup.ts'],
    include: ['{app,components,lib,test}/**/*.spec.{ts,tsx}'],
    alias: {
      '@tas/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      '@/': resolve(__dirname, './') + '/',
    },
  },
});
```

- [ ] **Step 5: Create `apps/web/test/vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 6: Create `apps/web/.gitignore`**

```
.next/
node_modules/
dist/
*.tsbuildinfo
.env.local
```

- [ ] **Step 7: Create `apps/web/app/layout.tsx` (server component)**

```tsx
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = { title: 'TAS Operator' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Create `apps/web/app/page.tsx` (server component, redirects to /operator)**

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/operator');
}
```

- [ ] **Step 9: Install + typecheck**

```bash
pnpm install
pnpm --filter @tas/web run typecheck
```

Expected: clean install, typecheck passes.

- [ ] **Step 10: Commit**

```bash
git add apps/web/ pnpm-lock.yaml
git commit -m "feat(chunk-4): scaffold @tas/web Next.js App Router package"
```

---

## Task 7: `lib/ws.ts` WebSocket client (TDD)

**Files:**
- Create: `apps/web/lib/ws.ts`
- Create: `apps/web/lib/ws.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/ws.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsEvents, type WsIncomingCallPayload } from '@tas/shared-types';
import { createWsClient, type WsClient } from './ws';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(); }
}

describe('createWsClient', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });

  it('routes call.screenpop events to the screen-pop handler', () => {
    const client: WsClient = createWsClient({
      url: 'ws://api.test/ws',
      token: 'tok',
      socketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    const handler = vi.fn();
    client.onScreenPop(handler);

    const sock = FakeSocket.instances[0];
    expect(sock.url).toBe('ws://api.test/ws?token=tok');

    const payload: WsIncomingCallPayload = {
      type: 'incoming_call',
      callId: 'c-1',
      tenantId: 't-1',
      callerE164: '+15555550100',
    };
    sock.onmessage?.({ data: JSON.stringify({ event: WsEvents.CALL_SCREEN_POP, data: payload }) });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('ignores unknown events', () => {
    const client = createWsClient({
      url: 'ws://api.test/ws', token: 'tok',
      socketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    const handler = vi.fn();
    client.onScreenPop(handler);
    const sock = FakeSocket.instances[0];
    sock.onmessage?.({ data: JSON.stringify({ event: 'unknown.event', data: {} }) });
    expect(handler).not.toHaveBeenCalled();
  });

  it('silently drops malformed JSON', () => {
    const client = createWsClient({
      url: 'ws://api.test/ws', token: 'tok',
      socketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    const handler = vi.fn();
    client.onScreenPop(handler);
    const sock = FakeSocket.instances[0];
    expect(() => sock.onmessage?.({ data: 'not-json' })).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @tas/web run test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the WS client**

Create `apps/web/lib/ws.ts`:

```ts
import { WsEvents, type WsIncomingCallPayload } from '@tas/shared-types';

type ScreenPopHandler = (payload: WsIncomingCallPayload) => void;

export interface WsClient {
  onScreenPop(handler: ScreenPopHandler): void;
  close(): void;
}

export interface CreateWsClientDeps {
  url: string;
  token: string;
  socketImpl?: typeof WebSocket;
}

export function createWsClient(deps: CreateWsClientDeps): WsClient {
  const SocketCtor = deps.socketImpl ?? WebSocket;
  const sock = new SocketCtor(`${deps.url}?token=${encodeURIComponent(deps.token)}`);
  const handlers: ScreenPopHandler[] = [];

  sock.onmessage = (ev: MessageEvent) => {
    let parsed: { event: string; data: unknown };
    try { parsed = JSON.parse(String(ev.data)); } catch { return; }
    if (parsed.event === WsEvents.CALL_SCREEN_POP) {
      for (const h of handlers) h(parsed.data as WsIncomingCallPayload);
    }
  };

  return {
    onScreenPop(h: ScreenPopHandler) { handlers.push(h); },
    close() { sock.close(); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @tas/web run test
```

Expected: PASS — three tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/ws.ts apps/web/lib/ws.spec.ts
git commit -m "feat(chunk-4): web WS client with event-envelope routing"
```

---

## Task 8: `lib/token.ts` and `lib/api.ts`

**Files:**
- Create: `apps/web/lib/token.ts`
- Create: `apps/web/lib/api.ts`
- Create: `apps/web/lib/api.spec.ts`

- [ ] **Step 1: Implement token fetcher (no test — pure plumbing, exercised through MessageForm test)**

Create `apps/web/lib/token.ts`:

```ts
export interface TokenFetcherDeps {
  apiBaseUrl: string;
  operatorId: string;
  fetch?: typeof fetch;
}

export async function fetchOperatorToken(deps: TokenFetcherDeps): Promise<string> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const res = await fetchImpl(
    `${deps.apiBaseUrl}/v1/dev/operator-token?operatorId=${encodeURIComponent(deps.operatorId)}`,
  );
  if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}
```

- [ ] **Step 2: Write the failing API client test**

Create `apps/web/lib/api.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { postMessage } from './api';

describe('postMessage', () => {
  it('POSTs to /v1/Message with Bearer JWT', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'm-1', createdAt: '2026-05-16T00:00:00.000Z' }),
    });
    const result = await postMessage({
      apiBaseUrl: 'http://api.test',
      token: 'jwt-abc',
      body: { callId: 'c-1', accountId: 'a-1', operatorId: 'op-1', body: 'hello' },
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(result.id).toBe('m-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/v1/Message');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer jwt-abc');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('throws on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(postMessage({
      apiBaseUrl: 'http://api.test',
      token: 'bad',
      body: { callId: 'c', accountId: 'a', operatorId: 'op', body: 'hi' },
      fetch: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @tas/web run test
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the API client**

Create `apps/web/lib/api.ts`:

```ts
export interface PostMessageBody {
  callId: string;
  accountId: string;
  operatorId: string;
  body: string;
}

export interface PostMessageResult {
  id: string;
  createdAt: string;
}

export interface PostMessageDeps {
  apiBaseUrl: string;
  token: string;
  body: PostMessageBody;
  fetch?: typeof fetch;
}

export async function postMessage(deps: PostMessageDeps): Promise<PostMessageResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const res = await fetchImpl(`${deps.apiBaseUrl}/v1/Message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deps.token}`,
    },
    body: JSON.stringify(deps.body),
  });
  if (!res.ok) throw new Error(`/v1/Message returned ${res.status}`);
  return (await res.json()) as PostMessageResult;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @tas/web run test
```

Expected: PASS — both api tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/token.ts apps/web/lib/api.ts apps/web/lib/api.spec.ts
git commit -m "feat(chunk-4): web lib/api + lib/token plumbing"
```

---

## Task 9: `ScreenPop` component (TDD)

**Files:**
- Create: `apps/web/components/ScreenPop.tsx`
- Create: `apps/web/components/ScreenPop.spec.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/ScreenPop.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WsIncomingCallPayload } from '@tas/shared-types';
import { ScreenPop } from './ScreenPop';

const PAYLOAD: WsIncomingCallPayload = {
  type: 'incoming_call',
  callId: 'c-1',
  tenantId: 't-1',
  callerE164: '+15555550100',
};

describe('ScreenPop', () => {
  it('renders the caller E.164 and call id', () => {
    render(<ScreenPop call={PAYLOAD} onAccept={() => {}} onPciToggle={() => {}} accepted={false} paused={false} />);
    expect(screen.getByText(/\+15555550100/)).toBeInTheDocument();
    expect(screen.getByText(/c-1/)).toBeInTheDocument();
  });

  it('fires onAccept when the Accept button is clicked', async () => {
    let accepted = false;
    render(<ScreenPop
      call={PAYLOAD}
      onAccept={() => { accepted = true; }}
      onPciToggle={() => {}}
      accepted={false}
      paused={false}
    />);
    await userEvent.click(screen.getByRole('button', { name: /accept/i }));
    expect(accepted).toBe(true);
  });

  it('fires onPciToggle when the PCI pause button is clicked', async () => {
    let toggled = false;
    render(<ScreenPop
      call={PAYLOAD}
      onAccept={() => {}}
      onPciToggle={() => { toggled = true; }}
      accepted={true}
      paused={false}
    />);
    await userEvent.click(screen.getByRole('button', { name: /pci pause/i }));
    expect(toggled).toBe(true);
  });

  it('shows a Paused badge when paused=true', () => {
    render(<ScreenPop
      call={PAYLOAD}
      onAccept={() => {}}
      onPciToggle={() => {}}
      accepted={true}
      paused={true}
    />);
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });

  it('renders an empty/idle state when call is null', () => {
    render(<ScreenPop call={null} onAccept={() => {}} onPciToggle={() => {}} accepted={false} paused={false} />);
    expect(screen.getByText(/waiting for call/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @tas/web run test
```

Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component**

Create `apps/web/components/ScreenPop.tsx`:

```tsx
'use client';
import type { WsIncomingCallPayload } from '@tas/shared-types';

export interface ScreenPopProps {
  call: WsIncomingCallPayload | null;
  accepted: boolean;
  paused: boolean;
  onAccept: () => void;
  onPciToggle: () => void;
}

export function ScreenPop(props: ScreenPopProps) {
  if (!props.call) {
    return <section aria-label="screen-pop"><p>Waiting for call…</p></section>;
  }
  const { call, accepted, paused, onAccept, onPciToggle } = props;
  return (
    <section aria-label="screen-pop">
      <h2>Incoming call</h2>
      <dl>
        <dt>From</dt><dd>{call.callerE164}</dd>
        <dt>Call ID</dt><dd>{call.callId}</dd>
      </dl>
      {!accepted && <button onClick={onAccept}>Accept</button>}
      {accepted && (
        <>
          <button onClick={onPciToggle}>{paused ? 'Resume' : 'PCI pause'}</button>
          {paused && <span role="status">Paused</span>}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @tas/web run test
```

Expected: PASS — five ScreenPop tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ScreenPop.tsx apps/web/components/ScreenPop.spec.tsx
git commit -m "feat(chunk-4): ScreenPop component + accept/PCI-pause toggles"
```

---

## Task 10: `MessageForm` component (TDD)

**Files:**
- Create: `apps/web/components/MessageForm.tsx`
- Create: `apps/web/components/MessageForm.spec.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/MessageForm.spec.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageForm } from './MessageForm';

describe('MessageForm', () => {
  it('calls onSubmit with the trimmed body text when submitted', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MessageForm onSubmit={onSubmit} disabled={false} />);
    await userEvent.type(screen.getByRole('textbox', { name: /message/i }), '  hello there  ');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onSubmit).toHaveBeenCalledWith('hello there');
  });

  it('disables the submit button when disabled=true', () => {
    render(<MessageForm onSubmit={vi.fn()} disabled={true} />);
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('does not call onSubmit when the textarea is empty', async () => {
    const onSubmit = vi.fn();
    render(<MessageForm onSubmit={onSubmit} disabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @tas/web run test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `apps/web/components/MessageForm.tsx`:

```tsx
'use client';
import { useState } from 'react';

export interface MessageFormProps {
  onSubmit: (body: string) => Promise<void> | void;
  disabled: boolean;
}

export function MessageForm({ onSubmit, disabled }: MessageFormProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      await onSubmit(trimmed);
      setText('');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="message-form">
      <label>
        Message
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button type="submit" disabled={disabled || sending}>Send</button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @tas/web run test
```

Expected: PASS — three MessageForm tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/MessageForm.tsx apps/web/components/MessageForm.spec.tsx
git commit -m "feat(chunk-4): MessageForm component with trim + disabled state"
```

---

## Task 11: `app/operator/page.tsx` — wire everything together

**Files:**
- Create: `apps/web/app/operator/page.tsx`
- Create: `apps/web/.env.local.example`

- [ ] **Step 1: Create the operator page (client component)**

Create `apps/web/app/operator/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import type { WsIncomingCallPayload } from '@tas/shared-types';
import { ScreenPop } from '@/components/ScreenPop';
import { MessageForm } from '@/components/MessageForm';
import { createWsClient } from '@/lib/ws';
import { fetchOperatorToken } from '@/lib/token';
import { postMessage } from '@/lib/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const WS_URL       = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000/ws';
const OPERATOR_ID  = process.env.NEXT_PUBLIC_OPERATOR_ID ?? '66666666-6666-6666-6666-666666666666';

export default function OperatorPage() {
  const [token, setToken] = useState<string | null>(null);
  const [call, setCall] = useState<WsIncomingCallPayload | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let active = true;
    fetchOperatorToken({ apiBaseUrl: API_BASE_URL, operatorId: OPERATOR_ID })
      .then((t) => { if (active) setToken(t); })
      .catch((err) => console.error('token fetch failed', err));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!token) return;
    const client = createWsClient({ url: WS_URL, token });
    client.onScreenPop((payload) => {
      setCall(payload);
      setAccepted(false);
      setPaused(false);
    });
    return () => client.close();
  }, [token]);

  async function submitMessage(body: string): Promise<void> {
    if (!token || !call) return;
    await postMessage({
      apiBaseUrl: API_BASE_URL,
      token,
      body: {
        callId: call.callId,
        accountId: call.accountId,
        operatorId: OPERATOR_ID,
        body,
      },
    });
  }

  return (
    <main>
      <h1>Operator</h1>
      <ScreenPop
        call={call}
        accepted={accepted}
        paused={paused}
        onAccept={() => setAccepted(true)}
        onPciToggle={() => setPaused((p) => !p)}
      />
      <MessageForm onSubmit={submitMessage} disabled={!accepted || !call} />
    </main>
  );
}
```

- [ ] **Step 2: Create `.env.local.example`**

Create `apps/web/.env.local.example`:

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3000/ws
NEXT_PUBLIC_OPERATOR_ID=66666666-6666-6666-6666-666666666666
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @tas/web run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/operator/page.tsx apps/web/.env.local.example
git commit -m "feat(chunk-4): operator page wires WS, token fetch, message POST"
```

---

## Task 12: `TemporalModule` + singleton client in `apps/api`

**Files:**
- Create: `apps/api/src/temporal/temporal.tokens.ts`
- Create: `apps/api/src/temporal/temporal-client.service.ts`
- Create: `apps/api/src/temporal/temporal.module.ts`
- Create: `apps/api/src/temporal/temporal-client.service.spec.ts`
- Modify: `apps/api/package.json` (add `@temporalio/client`)
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Add Temporal client dep**

Edit `apps/api/package.json` to add `"@temporalio/client": "1.11.0"` under `dependencies` (matching the worker's pin).

- [ ] **Step 2: Install**

```bash
pnpm install
```

- [ ] **Step 3: Create token file**

Create `apps/api/src/temporal/temporal.tokens.ts`:

```ts
export const TEMPORAL_CLIENT_TOKEN = 'TEMPORAL_CLIENT';
```

- [ ] **Step 4: Write the failing service test**

Create `apps/api/src/temporal/temporal-client.service.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { TemporalClientService } from './temporal-client.service';

describe('TemporalClientService', () => {
  it('delegates workflow.start to the injected client', async () => {
    const start = vi.fn().mockResolvedValue({ workflowId: 'wf-1' });
    const fakeClient = { workflow: { start } } as any;
    const svc = new TemporalClientService(fakeClient);
    const handle = await svc.start('DispatchMessage', {
      workflowId: 'wf-1',
      taskQueue: 'dispatch-message',
      args: [{ messageId: 'm-1' }],
    });
    expect(start).toHaveBeenCalledOnce();
    expect(handle.workflowId).toBe('wf-1');
  });
});
```

- [ ] **Step 5: Run to confirm it fails**

```bash
pnpm --filter @tas/api run test -- temporal-client
```

Expected: FAIL — module not found.

- [ ] **Step 6: Implement the service**

Create `apps/api/src/temporal/temporal-client.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Client, WorkflowStartOptions } from '@temporalio/client';
import { TEMPORAL_CLIENT_TOKEN } from './temporal.tokens';

@Injectable()
export class TemporalClientService {
  constructor(@Inject(TEMPORAL_CLIENT_TOKEN) private readonly client: Client) {}

  async start(
    workflowType: string,
    opts: WorkflowStartOptions,
  ): Promise<{ workflowId: string }> {
    const handle = await this.client.workflow.start(workflowType, opts);
    return { workflowId: handle.workflowId };
  }
}
```

- [ ] **Step 7: Create the module with singleton factory + shutdown**

Create `apps/api/src/temporal/temporal.module.ts`:

```ts
import {
  Global, Module, type OnApplicationShutdown, Inject, Injectable,
} from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';
import { TEMPORAL_CLIENT_TOKEN } from './temporal.tokens';
import { TemporalClientService } from './temporal-client.service';

@Injectable()
class TemporalShutdown implements OnApplicationShutdown {
  constructor(@Inject(TEMPORAL_CLIENT_TOKEN) private readonly client: Client) {}
  async onApplicationShutdown(): Promise<void> {
    await this.client.connection.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: TEMPORAL_CLIENT_TOKEN,
      useFactory: async (): Promise<Client> => {
        const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
        const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
        const connection = await Connection.connect({ address });
        return new Client({ connection, namespace });
      },
    },
    TemporalClientService,
    TemporalShutdown,
  ],
  exports: [TemporalClientService],
})
export class TemporalModule {}
```

- [ ] **Step 8: Register module in `app.module.ts`**

Add `import { TemporalModule } from './temporal/temporal.module';` and add `TemporalModule` to the `imports` array of `AppModule`.

- [ ] **Step 9: Run test to verify it passes**

```bash
pnpm --filter @tas/api run test -- temporal-client
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/temporal/ apps/api/src/app.module.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(chunk-4): TemporalModule with singleton Client + shutdown hook"
```

---

## Task 13: Wire workflow start into `MessageController` (TDD)

**Files:**
- Modify: `apps/api/src/message/message.controller.ts`
- Modify: `apps/api/src/message/message.controller.spec.ts`
- Modify: `apps/api/src/message/message.module.ts`

- [ ] **Step 1: Extend the failing test**

Edit `apps/api/src/message/message.controller.spec.ts` and **append** this test inside the existing `describe('MessageController', () => { ... })` block (do not remove existing tests):

```ts
  it('starts the DispatchMessage workflow with messageId + operatorId + tenantId', async () => {
    const start = vi.fn().mockResolvedValue({ workflowId: 'wf-x' });
    const temporal = { start } as any;
    const module2: TestingModule = await Test.createTestingModule({
      controllers: [MessageController],
      providers: [
        { provide: DB_TOKEN, useValue: db },
        { provide: TemporalClientService, useValue: temporal },
      ],
    }).compile();
    const c2 = module2.get(MessageController);
    const req = { user: { sub: OPERATOR_ID, tenantId: TENANT_ID, role: 'operator' } };
    const dto = { callId: CALL_ID, accountId: ACCOUNT_ID, operatorId: OPERATOR_ID, body: 'Workflow trigger' };
    const result = await c2.create(dto, req as any);
    expect(start).toHaveBeenCalledOnce();
    const [workflowType, opts] = start.mock.calls[0];
    expect(workflowType).toBe('DispatchMessage');
    expect(opts.taskQueue).toBe('dispatch-message');
    expect(opts.workflowId).toBe(`dispatch-${result.id}`);
    expect(opts.args[0]).toMatchObject({
      messageId: result.id, operatorId: OPERATOR_ID, tenantId: TENANT_ID,
    });
  });
```

Also add `import { vi } from 'vitest';` to the top of the file if not present, and add `import { TemporalClientService } from '../temporal/temporal-client.service';`.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @tas/api run test -- message.controller
```

Expected: FAIL — `start was not called` or constructor mismatch.

- [ ] **Step 3: Update the controller**

Edit `apps/api/src/message/message.controller.ts`:

```ts
import {
  Controller, Post, Body, UseGuards, Req, Inject, HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DB_TOKEN } from '../database/database.module';
import { message } from '@tas/db';
import type { Db } from '@tas/db/client';
import type { CreateMessageDto, MessageCreatedDto } from '@tas/shared-types';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user.interface';
import { TemporalClientService } from '../temporal/temporal-client.service';

@Controller('Message')
@UseGuards(JwtAuthGuard)
export class MessageController {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly temporal: TemporalClientService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateMessageDto,
    @Req() req: Request & { user: RequestUser },
  ): Promise<MessageCreatedDto> {
    const [row] = await this.db
      .insert(message)
      .values({
        tenantId: req.user.tenantId,
        callId: dto.callId,
        accountId: dto.accountId,
        operatorId: dto.operatorId,
        body: dto.body,
      })
      .returning({ id: message.id, createdAt: message.createdAt });

    await this.temporal.start('DispatchMessage', {
      workflowId: `dispatch-${row.id}`,
      taskQueue: 'dispatch-message',
      args: [{
        messageId: row.id,
        operatorId: dto.operatorId,
        tenantId: req.user.tenantId,
        payload: { callId: dto.callId, body: dto.body },
      }],
    });

    return { id: row.id, createdAt: row.createdAt.toISOString() };
  }
}
```

- [ ] **Step 4: Ensure `dispatchAttempt` seed row exists**

The `markDelivered` activity expects a row keyed by `messageId`. The PoC convention is one row per message at the time of message insert. Add the insert at the end of `MessageController.create` before returning:

```ts
import { dispatchAttempt } from '@tas/db';
// ... inside create(), after temporal.start:
await this.db.insert(dispatchAttempt).values({
  messageId: row.id,
  channel: 'in_app',
});
```

- [ ] **Step 5: Update `MessageModule`**

Edit `apps/api/src/message/message.module.ts` to import `TemporalModule` (the global module re-exports `TemporalClientService`, but adding it to imports keeps the dependency explicit):

```ts
import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { AuthModule } from '../auth/auth.module';
import { TemporalModule } from '../temporal/temporal.module';

@Module({
  imports: [AuthModule, TemporalModule],
  controllers: [MessageController],
})
export class MessageModule {}
```

- [ ] **Step 6: Run all api tests**

```bash
pnpm --filter @tas/api run test
```

Expected: all tests green, including the new workflow-start assertion and the previously existing tenant-id check.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/message/
git commit -m "feat(chunk-4): MessageController triggers DispatchMessage workflow + dispatch_attempt row"
```

---

## Task 14: `GET /v1/dev/operator-token` endpoint (TDD)

**Files:**
- Create: `apps/api/src/dev/dev.controller.ts`
- Create: `apps/api/src/dev/dev.module.ts`
- Create: `apps/api/src/dev/dev.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/dev/dev.controller.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import * as jsonwebtoken from 'jsonwebtoken';
import { DevController } from './dev.controller';
import { makeDb } from '@tas/db/client';
import { DB_TOKEN } from '../database/database.module';
import { tenant, user } from '@tas/db';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OPERATOR_ID = '66666666-6666-6666-6666-666666666666';

describe('DevController', () => {
  let controller: DevController;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    const db = makeDb(process.env.DATABASE_URL!);
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo' }).onConflictDoNothing();
    await db.insert(user).values({ id: OPERATOR_ID, tenantId: TENANT_ID, email: 'op@demo.test', role: 'operator' }).onConflictDoNothing();
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [DevController],
      providers: [{ provide: DB_TOKEN, useValue: db }],
    }).compile();
    controller = mod.get(DevController);
  });

  afterAll(() => { process.env.NODE_ENV = originalNodeEnv; });

  it('mints a JWT for the seeded operator', async () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_JWT_SECRET = 'unit-test-secret';
    const out = await controller.operatorToken(OPERATOR_ID);
    const decoded = jsonwebtoken.verify(out.token, 'unit-test-secret') as any;
    expect(decoded.sub).toBe(OPERATOR_ID);
    expect(decoded.tenantId).toBe(TENANT_ID);
    expect(decoded.role).toBe('operator');
  });

  it('throws NotFound when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(controller.operatorToken(OPERATOR_ID)).rejects.toThrow(/not found/i);
  });

  it('throws NotFound when operator does not exist', async () => {
    process.env.NODE_ENV = 'development';
    await expect(controller.operatorToken('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @tas/api run test -- dev.controller
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the controller**

Create `apps/api/src/dev/dev.controller.ts`:

```ts
import {
  Controller, Get, Inject, NotFoundException, Query,
} from '@nestjs/common';
import * as jsonwebtoken from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { DB_TOKEN } from '../database/database.module';
import { user } from '@tas/db';
import type { Db } from '@tas/db/client';

@Controller('v1/dev')
export class DevController {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  @Get('operator-token')
  async operatorToken(@Query('operatorId') operatorId: string): Promise<{ token: string }> {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    const [row] = await this.db.select().from(user).where(eq(user.id, operatorId));
    if (!row) throw new NotFoundException();
    const secret = process.env.APP_JWT_SECRET ?? 'poc-only-not-prod';
    const token = jsonwebtoken.sign(
      { sub: row.id, tenantId: row.tenantId, role: row.role },
      secret,
      { algorithm: 'HS256' },
    );
    return { token };
  }
}
```

- [ ] **Step 4: Create the module**

Create `apps/api/src/dev/dev.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DevController } from './dev.controller';

@Module({ controllers: [DevController] })
export class DevModule {}
```

- [ ] **Step 5: Register in `AppModule`**

Add `import { DevModule } from './dev/dev.module';` and add `DevModule` to `imports`.

**Note:** the `apps/api/src/main.ts` startup must NOT register `DevModule`'s routes behind the global API prefix if one exists. Inspect `main.ts`; if `app.setGlobalPrefix(...)` is set, the path remains `/v1/dev/operator-token` because the controller already encodes `v1/dev`. If a global prefix conflicts, switch the controller path to `dev/operator-token` and add the prefix outside. Check before assuming.

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm --filter @tas/api run test -- dev.controller
```

Expected: PASS — three tests green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/dev/ apps/api/src/app.module.ts
git commit -m "feat(chunk-4): dev-only /v1/dev/operator-token JWT mint endpoint"
```

---

## Task 15: `POST /internal/dispatch-deliver` endpoint (TDD)

**Files:**
- Create: `apps/api/src/internal/dispatch-deliver.controller.ts`
- Create: `apps/api/src/internal/internal.module.ts`
- Create: `apps/api/src/internal/dispatch-deliver.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/internal/dispatch-deliver.controller.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DispatchDeliverController } from './dispatch-deliver.controller';
import { WsGateway } from '../ws/ws.gateway';

describe('DispatchDeliverController', () => {
  let controller: DispatchDeliverController;
  const sentTo: Array<{ operatorId: string; payload: unknown }> = [];

  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = 'unit-test-secret-token';
    const fakeGateway = {
      sendToOperator: (operatorId: string, payload: unknown) => {
        sentTo.push({ operatorId, payload });
      },
    } as unknown as WsGateway;
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [DispatchDeliverController],
      providers: [{ provide: WsGateway, useValue: fakeGateway }],
    }).compile();
    controller = mod.get(DispatchDeliverController);
  });

  it('sends to the operator and returns delivered:true when header is valid', async () => {
    const out = await controller.deliver('unit-test-secret-token', {
      messageId: 'm-1', operatorId: 'op-1', payload: { body: 'hi' },
    });
    expect(out).toEqual({ delivered: true });
    expect(sentTo.at(-1)).toEqual({ operatorId: 'op-1', payload: { body: 'hi' } });
  });

  it('throws 401 when the header is missing', async () => {
    await expect(controller.deliver(undefined as any, {
      messageId: 'm', operatorId: 'op', payload: {},
    })).rejects.toThrow(/unauthorized/i);
  });

  it('throws 401 when the header is wrong', async () => {
    await expect(controller.deliver('wrong', {
      messageId: 'm', operatorId: 'op', payload: {},
    })).rejects.toThrow(/unauthorized/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @tas/api run test -- dispatch-deliver
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the controller**

Create `apps/api/src/internal/dispatch-deliver.controller.ts`:

```ts
import {
  Body, Controller, Headers, HttpCode, Post, UnauthorizedException,
} from '@nestjs/common';
import { WsGateway } from '../ws/ws.gateway';

interface DeliverBody {
  messageId: string;
  operatorId: string;
  payload: unknown;
}

@Controller('internal')
export class DispatchDeliverController {
  constructor(private readonly ws: WsGateway) {}

  @Post('dispatch-deliver')
  @HttpCode(200)
  async deliver(
    @Headers('x-internal-token') token: string | undefined,
    @Body() body: DeliverBody,
  ): Promise<{ delivered: boolean }> {
    const expected = process.env.INTERNAL_API_TOKEN;
    if (!expected || token !== expected) throw new UnauthorizedException();
    this.ws.sendToOperator(body.operatorId, body.payload as any);
    return { delivered: true };
  }
}
```

- [ ] **Step 4: Create module**

Create `apps/api/src/internal/internal.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DispatchDeliverController } from './dispatch-deliver.controller';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [WsModule],
  controllers: [DispatchDeliverController],
})
export class InternalModule {}
```

- [ ] **Step 5: Register in `AppModule`**

Add `import { InternalModule } from './internal/internal.module';` and add `InternalModule` to `imports`.

**Check `WsModule` exports `WsGateway`.** If not, modify `apps/api/src/ws/ws.module.ts` to add `exports: [WsGateway]`. (Likely already exported since Chunk 3 wired StasisStartHandler against it; verify before changing.)

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm --filter @tas/api run test -- dispatch-deliver
```

Expected: PASS — three tests green.

- [ ] **Step 7: Run the full api test suite**

```bash
pnpm --filter @tas/api run test
```

Expected: every prior test still green + new tests for dev + dispatch-deliver + Temporal + message-workflow-trigger.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/internal/ apps/api/src/app.module.ts apps/api/src/ws/ws.module.ts
git commit -m "feat(chunk-4): /internal/dispatch-deliver with X-Internal-Token guard"
```

---

## Task 16: Manual smoke + `poc/smoke-chunk4.md`

**Files:**
- Create: `poc/smoke-chunk4.md`
- Modify: `infra/docker-compose.yml` (add `INTERNAL_API_TOKEN` to the `.env` or the api service env; document procedure)
- Modify: `apps/api/.env.example` and `apps/web/.env.local.example` and `apps/temporal-worker/.env.example` for `INTERNAL_API_TOKEN` propagation

- [ ] **Step 1: Generate an internal token**

```bash
openssl rand -hex 32
```

Capture the output as `<INTERNAL_TOKEN>`.

- [ ] **Step 2: Wire `INTERNAL_API_TOKEN` into all three apps**

Add to `apps/api/.env.example` (create if missing) and `apps/temporal-worker/.env.example`:

```
INTERNAL_API_TOKEN=<INTERNAL_TOKEN>
```

apps/api reads it via `process.env.INTERNAL_API_TOKEN` in the dispatch-deliver controller; the worker reads it via the same env in `worker.ts`. They must match.

- [ ] **Step 3: Bring up the compose stack**

```bash
make poc-up
make poc-seed
```

Expected: all services healthy, including Temporal at port 7233 and Temporal Web UI at 8080. `redis-cli -p 6379 ping` returns PONG.

- [ ] **Step 4: Start the three host processes (three terminals)**

Terminal 1 (api):
```bash
cd apps/api && cp .env.example .env && INTERNAL_API_TOKEN=<INTERNAL_TOKEN> APP_JWT_SECRET=poc-only-not-prod pnpm run dev
```

Terminal 2 (worker):
```bash
cd apps/temporal-worker && cp .env.example .env && INTERNAL_API_TOKEN=<INTERNAL_TOKEN> pnpm run dev
```

Terminal 3 (web):
```bash
cd apps/web && cp .env.local.example .env.local && pnpm run dev
```

Expected:
- api on :3000 with `--inspect=:9229`
- worker on :9230, log line: `worker: ready taskQueue=dispatch-message namespace=default address=localhost:7233`
- web on :3001

- [ ] **Step 5: Run the SIPp INVITE smoke (or use cli-softphone)**

Open a browser at `http://localhost:3001/operator`. DevTools → Network. Fire an INVITE through Asterisk:

```bash
# either the existing Chunk 3 SIPp invocation:
make poc-test-chunk3
# OR via pjsua TUI from pot/cli-softphone/
cd pot/cli-softphone && make alice  # call ext 1000 or whatever Chunk 3 dialplan sets
```

Expected (record in smoke doc):
- Browser DevTools Network: WS frame `call.screenpop` arrives **within 800 ms** of the INVITE
- `ScreenPop` panel renders with the caller's E.164 + call id
- Operator clicks Accept, types a message, clicks Send
- `POST /v1/Message` returns 201 with `{ id, createdAt }`
- Temporal Web UI (`http://localhost:8080`) shows `DispatchMessage` workflow Completed within ~1s
- Postgres: `SELECT delivered_at FROM dispatch_attempt ORDER BY attempted_at DESC LIMIT 1;` returns non-null

- [ ] **Step 6: Write the smoke doc**

Create `poc/smoke-chunk4.md`:

```markdown
# Chunk 4 — F03 operator UI + Temporal worker manual smoke

**Date:** YYYY-MM-DD · **Operator:** Yuriy Lev · **Result:** Green / Red

## Pre-flight

- Branch: `mvp/chunk-4-f03-worker` at commit `<sha>`
- Compose: `make poc-up` Green; `make poc-seed` Green
- Host processes: api (:3000), worker (:9230), web (:3001) all up

## Walkthrough

| Step | Observed | Budget |
|---|---|---|
| 1. SIPp/pjsua INVITE fires | <timestamp> | — |
| 2. Browser screen-pop renders | <delta ms> | ≤800 ms |
| 3. Operator clicks Accept | — | — |
| 4. Operator submits message | <delta ms from Accept> | — |
| 5. `POST /v1/Message` returns 201 | <id> | — |
| 6. Temporal Web UI shows Completed | <duration ms> | — |
| 7. `dispatch_attempt.delivered_at` non-null | <value> | — |

## Evidence

- DevTools Network screenshot: `poc/evidence/chunk4-devtools.png`
- Temporal Web UI screenshot: `poc/evidence/chunk4-temporal.png`
- Postgres dispatch_attempt query result: paste here

## Known gaps (carried to Chunk 6)

- No browser-side WS reconnect logic (deliberate; gap in §4 of design spec)
- PCI pause toggle is local-state only; backend wiring deferred (S-2 / Chunk 6)
```

- [ ] **Step 7: Commit smoke evidence**

```bash
git add poc/smoke-chunk4.md poc/evidence/chunk4-*.png  # if you captured screenshots
git add apps/api/.env.example apps/web/.env.local.example apps/temporal-worker/.env.example  # if updated
git commit -m "docs(chunk-4): manual smoke readout + .env templates"
```

---

## Task 17: SDK identity grep + Chunk 4 close

**Files:**
- Optional: `pot/chunk-4-sdk-grep.txt` (capture)

- [ ] **Step 1: Verify the worker log exists**

After Task 16 Step 4 ran, `apps/temporal-worker/worker.log` should exist (the `dev` script tees to it).

```bash
ls -la apps/temporal-worker/worker.log
```

- [ ] **Step 2: Run the SDK identity grep**

```bash
grep -E 'version.*mismatch|sdk.*incompatible|proto.*incompatible|registration.*mismatch' apps/temporal-worker/worker.log
echo "exit=$?"
```

Expected: `exit=1` (no match → grep returns 1) → this is the **PASS** condition per master spec exit criterion. If `exit=0`, the SDK pin is wrong; see ADR-0015-cloud-sdk-deferred §"if SDK skew is detected".

- [ ] **Step 3: Open a PR**

```bash
git push -u origin mvp/chunk-4-f03-worker
gh pr create --base main --title "feat: Chunk 4 — F03 operator UI + Temporal worker" --body "$(cat <<'EOF'
## Summary

- Adds `apps/web` (Next.js App Router, port 3001) — operator screen-pop, PCI pause stub, message form.
- Adds `apps/temporal-worker` — `DispatchMessage` workflow + `deliver-via-ws` + `mark-delivered` activities.
- Extends `apps/api` — `TemporalModule` singleton client, `MessageController` workflow trigger, `/v1/dev/operator-token`, `/internal/dispatch-deliver`.
- Vitest TDD on every new component/activity/route; mocked WS on web side; testcontainers PG for `mark-delivered`.

Design spec: `docs/superpowers/specs/2026-05-16-chunk-4-f03-worker-design.md`
Smoke readout: `poc/smoke-chunk4.md`

## Test plan
- [x] Worker vitest green (workflow + both activities)
- [x] Web vitest green (ws, api, token, ScreenPop, MessageForm)
- [x] API vitest green (Temporal, dev-token, dispatch-deliver, message-workflow-trigger)
- [x] Manual smoke per `poc/smoke-chunk4.md`
- [x] SDK identity grep exits 1 (no match)
- [x] Temporal Web UI shows `DispatchMessage` Completed
- [x] `dispatch_attempt.delivered_at` non-null

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Tag the chunk close**

After PR merge to `main`:

```bash
git checkout main && git pull
git tag -a mvp/chunk-4 -m "Chunk 4 close: F03 operator UI + Temporal worker (Green)"
git push origin mvp/chunk-4
```

---

## Self-review

Spec-coverage map (each exit criterion → task):

| Spec exit criterion | Implementing task(s) |
|---|---|
| 1. `DispatchMessage` workflow vitest red→green | Task 2 |
| 2. web component tests (ScreenPop, MessageForm, accept, PCI toggle, ws envelope) | Tasks 7, 9, 10 |
| 3. SDK identity grep | Task 17 |
| 4. Browser screen-pop ≤800 ms | Task 16 step 5 |
| 5. Temporal Web UI shows Completed | Task 16 step 5 |
| 6. `dispatch_attempt.delivered_at` non-null | Tasks 4, 13, 16 |
| 7. `pnpm --filter @tas/{web,temporal-worker} run dev` debuggable | Tasks 5, 6 (`--inspect=0.0.0.0:9230`) |

Architecture coverage:

- `packages/shared-types` accountId extension ✓ (Task 1a)
- `apps/temporal-worker/{worker.ts, workflows/, activities/}` ✓ (Tasks 1–5)
- `apps/web/{app/, lib/, components/, test/}` ✓ (Tasks 6–11)
- `apps/api` `TemporalModule` + 3 routes ✓ (Tasks 12–15)
- Smoke doc + SDK grep + tag ✓ (Tasks 16–17)

Risk coverage:

- R1 SDK identity → version pin in Tasks 1, 12; grep in Task 17
- R2 Next.js client/server component split → `'use client'` declared explicitly in Tasks 9, 10, 11
- R3 TemporalClient leak → singleton factory + `OnApplicationShutdown` in Task 12
- R4 JWT secret divergence → `.env.example` files include `APP_JWT_SECRET` placeholder (Task 16 step 2)
- R5 WS-socket-lifetime → documented as known gap in smoke doc (Task 16 step 7)

---

## Execution handoff

This plan is saved at `docs/superpowers/plans/2026-05-16-chunk-4-f03-worker.md` on branch `mvp/chunk-4-f03-worker`.

**Execution options:**

1. **Subagent-Driven (recommended)** — Group A (Tasks 1–5) + Group B (Tasks 6–11) dispatched as parallel Sonnet subagents with ultrathink + self-critique. Main thread runs Tasks 12–17 sequentially with verification checkpoints between tasks.

2. **Inline Execution** — single session executes tasks 1→17 sequentially.
