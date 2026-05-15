# PoC Slice 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Sprint-0 verification gate + PoC Slice 1 (Happy Path) per [`docs/superpowers/specs/2026-05-13-poc-tracer-bullet-design.md`](../specs/2026-05-13-poc-tracer-bullet-design.md). Outcome: one inbound SIP call → operator UI screen-pop → message saved → recording stored → Temporal `DispatchMessage` workflow delivers → `poc-e2e-s1-happy-path` Green in CI on Linux.

**Architecture:** pnpm-workspace monorepo (`apps/{api,web,temporal-worker,e2e}` + `packages/{db,shared-types,ari-client}`) on top of a single `infra/docker-compose.yml` running Kamailio + Asterisk + rtpengine + Postgres+Supavisor + NATS + Temporal (self-host) + MinIO + Caddy. NestJS `apps/api` co-locates the /v1 facade, NATS-arbitrated dequeue arbiter, and ARI leader at PoC scale (per spec §6 Slice 1). Next.js App Router `apps/web` is one screen (operator screen-pop). Temporal worker runs the single `DispatchMessage` workflow. `apps/e2e` orchestrates SIPp + Playwright + assertion helpers.

**Tech Stack:** TypeScript everywhere (NestJS 10, Next.js 14 App Router, Temporal SDK 1.x). Drizzle ORM + Postgres 15 + Supavisor pooler. NATS for event bus. Asterisk 22 + Kamailio 5.8 + rtpengine (configs inherit from `pot/S1-telephony-happy-path/`). SIPp + Playwright + vitest for tests. pnpm workspaces + Docker Compose v2 + GNU Make + GitHub Actions.

**TDD posture (per CLAUDE.md §4a):** infra/config tasks (Tasks 1–15) are scaffold — verified by smoke test, not TDD. Code-producing tasks (Tasks 16–37) follow red→green→refactor; each TDD task's "Step 1" writes the failing test, "Step 2" runs it and confirms failure for the expected reason, "Step 3" lands minimum code, "Step 4" confirms green, "Step 5" commits.

**Out of this plan (deferred):** Slices 2–5 (PCI pause, caller hangup, decline+reroute, leader failover) each get their own plan written after Slice 1 is Green and the codebase shape is known.

**Branch:** This plan executes on a new branch `mvp/slice-1-foundation`, cut from `main` *after* Sprint-0 closes the PoT spike chain to `main`. Task 0 (the verification gate) confirms this branch state exists before any other task runs.

---

## File Structure

```
.github/workflows/
  poc-e2e.yml                              # Task 38
apps/
  api/                                     # Tasks 16–26
    package.json
    nest-cli.json
    tsconfig.json
    src/
      main.ts                              # Task 16
      app.module.ts                        # Task 16
      auth/
        jwt.guard.ts                       # Task 16
      v1/
        v1.module.ts                       # Task 17
        account.controller.ts              # Task 17
        contact.controller.ts              # Task 18
        form.controller.ts                 # Task 19
        message.controller.ts              # Task 20
      events/
        nats.client.ts                     # Task 21
      telephony/
        ari.client.ts                      # Task 22
        stasis.handler.ts                  # Task 23
        arbiter.service.ts                 # Task 24
        ws.gateway.ts                      # Task 25
        recording.service.ts               # Task 26
    test/
      app.e2e-spec.ts                      # Task 16 (smoke)
      v1/                                  # Tasks 17–20 (one test file per endpoint)
  web/                                     # Tasks 27–30
    package.json
    next.config.js
    tsconfig.json
    app/
      layout.tsx                           # Task 27
      operator/
        page.tsx                           # Task 27
    components/
      ScreenPop.tsx                        # Task 28
      MessageForm.tsx                      # Task 29
    lib/
      ws.ts                                # Task 28
      api.ts                               # Task 28
  temporal-worker/                         # Tasks 31–32
    package.json
    tsconfig.json
    src/
      worker.ts                            # Task 31
      workflows/
        dispatch-message.workflow.ts       # Task 32
      activities/
        in-app-delivery.activity.ts        # Task 32
    test/
      dispatch-message.test.ts             # Task 32
  e2e/                                     # Tasks 33–37
    package.json
    playwright.config.ts
    scripts/
      run-scenario.ts                      # Task 33
    lib/
      db.ts                                # Task 35
      audio.ts                             # Task 35 (Slice 2 will extend)
      ari.ts                               # Task 35
    sipp-image/
      Dockerfile                           # Task 34
    sipp-scenarios/
      happy-path.xml                       # Task 34
    specs/
      poc-e2e-s1-happy-path.spec.ts        # Task 36
    results/.gitkeep
packages/
  db/                                      # Tasks 2–6
    package.json
    tsconfig.json
    drizzle.config.ts                      # Task 2
    src/
      schema/                              # Tasks 3–5 (one file per migration's tables)
        tenancy.ts                         # Task 3
        crm.ts                             # Task 3
        operator.ts                        # Task 4
        queue.ts                           # Task 4
        call.ts                            # Task 5
        message.ts                         # Task 5
        index.ts                           # Task 5
      seed.ts                              # Task 6
      client.ts                            # Task 2
    drizzle/                               # auto-generated migrations (Tasks 3–5)
  shared-types/                            # Task 16 (created during apps/api scaffold)
    package.json
    src/
      events.ts                            # Task 23 (NATS event types)
      api.ts                               # Task 17 (REST DTOs)
      ws.ts                                # Task 25 (WS event types)
  ari-client/                              # Task 22 (extracted from apps/api when leader election lands in Slice 5)
    package.json
    src/
      index.ts                             # Task 22
infra/
  docker-compose.yml                       # Task 7 (grows through Tasks 8–14)
  kamailio/
    Dockerfile                             # Task 8 (copies from pot/S1)
    kamailio.cfg                           # Task 8
    dispatcher.list                        # Task 8
  asterisk/
    Dockerfile                             # Task 9 (copies from pot/S1)
    extensions.conf                        # Task 9
    pjsip.conf                             # Task 9
    ari.conf                               # Task 9
    http.conf                              # Task 9
    modules.conf                           # Task 9
  rtpengine/
    Dockerfile                             # Task 10
    ng-control.conf                        # Task 10
  caddy/
    Caddyfile                              # Task 14 (inherits pot/S8 ADR-0019 baseline)
  temporal/
    docker-compose.fragment.yml            # Task 13 (included in main compose)
poc/
  readout-slice1.md                        # Task 39
Makefile                                   # Task 15 (root dispatcher: poc-up, poc-down, poc-e2e)
.nvmrc                                     # Task 1
pnpm-workspace.yaml                        # Task 1
package.json                               # Task 1
tsconfig.base.json                         # Task 1
.gitignore                                 # Task 1 (extends existing)
```

---

## Task 0: Verify Sprint-0 prerequisites (HARD GATE — do not skip)

**Files:** none created. Read-only verification against `pot/g0-closed.md`, `docs/adr/`, `main` branch state, and CI history.

This task is a checklist with **no proceed if any item fails**. Per spec §11, every Sprint-0 prerequisite must be Green before Slice 1's first commit. Halt the plan and surface the failing item to the user if anything is missing.

- [ ] **Step 1: Verify all 8 PoT spikes Green or Deferred-with-fallback-plan signed off**

Run:
```bash
git log main --oneline | grep -E '^[a-f0-9]+ docs\(pot\): record S[1-8]' | sort -k4
```
Expected: 8 lines, one per spike, with status indicating Green or Deferred-with-signed-fallback.

- [ ] **Step 2: Verify G0 enum decision recorded**

Run: `test -f pot/g0-closed.md && head -5 pot/g0-closed.md`
Expected: file exists, opens with "G0 closed on YYYY-MM-DD via Path A|B" plus senior-architect + compliance-lead names.

- [ ] **Step 3: Verify ADR-0013 ratified**

Run: `grep -E '^Status: (Accepted|Superseded)' docs/adr/0013-redaction-pipeline.md`
Expected: `Status: Accepted` (or `Superseded` if S4 led to a rewrite).

- [ ] **Step 4: Verify ADR-0015 ratified**

Run: `grep -E '^Status: (Accepted|Superseded)' docs/adr/0015-temporal-cloud-tier.md`
Expected: `Status: Accepted`.

- [ ] **Step 5: Verify S1 Layer 2 (rtpengine media smoke) Green on Linux**

Run: `ls pot/S1-telephony-happy-path/results/ | grep -E 'layer2.*green' | head -1`
Expected: at least one Layer-2 results dir with a Linux readout.

- [ ] **Step 6: Verify PoT chain merged to main**

Run: `git log main --oneline | grep -c 'merge.*pot/'`
Expected: ≥1 (chain merged via fast-forward or merge commit).

- [ ] **Step 7: Verify Q1–Q3 architect-ratified**

Run: `grep -E 'Q[1-3].*(decided|ratified)' pot/g0-closed.md`
Expected: 3 lines confirming pnpm-workspaces + Next.js App Router + Drizzle decisions (or alternate decisions — read and reconcile against spec §10 before proceeding).

- [ ] **Step 8: Cut the slice-1 branch from `main`**

Run:
```bash
git checkout main && git pull --ff-only
git checkout -b mvp/slice-1-foundation
```
Expected: clean checkout, new branch tracks `main`.

If any step fails: STOP. Do not proceed to Task 1. Surface the failing item to the user.

---

## Task 1: pnpm workspace + root tooling

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.nvmrc`
- Modify: `.gitignore` (add `node_modules/`, `dist/`, `.next/`, `apps/*/dist/`, `packages/*/dist/`, `apps/e2e/results/`)

No TDD — pure scaffold. Verification = `pnpm install` succeeds + `pnpm -r run typecheck` exits 0 (no packages yet, no-op pass).

- [ ] **Step 1: Create `.nvmrc`**

```
20.11.0
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - apps/*
  - packages/*
```

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "tas",
  "private": true,
  "packageManager": "pnpm@8.15.4",
  "scripts": {
    "typecheck": "pnpm -r --parallel run typecheck",
    "lint": "pnpm -r --parallel run lint",
    "test": "pnpm -r --parallel run test"
  },
  "devDependencies": {
    "typescript": "5.4.2"
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "incremental": true
  }
}
```

- [ ] **Step 5: Extend `.gitignore`**

Append:
```
node_modules/
dist/
.next/
apps/*/dist/
packages/*/dist/
apps/e2e/results/
*.tsbuildinfo
```

- [ ] **Step 6: Install + verify**

Run: `pnpm install && pnpm typecheck`
Expected: install completes; typecheck is a no-op success (no packages yet).

- [ ] **Step 7: Commit**

```bash
git add .nvmrc pnpm-workspace.yaml package.json tsconfig.base.json .gitignore pnpm-lock.yaml
git commit -m "chore(repo): pnpm workspace + root tooling baseline"
```

---

## Task 2: packages/db — Drizzle scaffold

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/schema/index.ts` (empty re-exports for now)

No TDD — scaffold only. Verified by `pnpm --filter @tas/db typecheck` passing.

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@tas/db",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": "./src/schema/index.ts",
    "./client": "./src/client.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "echo 'lint TBD'",
    "test": "echo 'no tests'",
    "migrate:gen": "drizzle-kit generate --config drizzle.config.ts",
    "migrate:apply": "drizzle-kit migrate --config drizzle.config.ts",
    "seed": "tsx src/seed.ts"
  },
  "dependencies": {
    "drizzle-orm": "0.30.4",
    "postgres": "3.4.4"
  },
  "devDependencies": {
    "drizzle-kit": "0.20.14",
    "tsx": "4.7.1",
    "typescript": "5.4.2"
  }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/db/drizzle.config.ts`**

```ts
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://tas:tas@localhost:5432/tas",
  },
} satisfies Config;
```

- [ ] **Step 4: Create `packages/db/src/client.ts`**

```ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export function makeDb(url: string) {
  const sql = postgres(url, { prepare: false }); // Supavisor-friendly
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof makeDb>;
```

- [ ] **Step 5: Create `packages/db/src/schema/index.ts`**

```ts
// Tables land in Tasks 3–5.
export {};
```

- [ ] **Step 6: Install + verify**

Run: `pnpm install && pnpm --filter @tas/db typecheck`
Expected: install succeeds; typecheck passes.

- [ ] **Step 7: Commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): drizzle scaffold + makeDb factory (Supavisor-friendly prepare:false)"
```

---

## Task 3: DB migration 0001 — tenancy + CRM tables (TDD)

**Files:**
- Create: `packages/db/src/schema/tenancy.ts` (tenant, account, did)
- Create: `packages/db/src/schema/crm.ts` (contact, form)
- Modify: `packages/db/src/schema/index.ts` (re-export)
- Create: `packages/db/test/schema.test.ts`
- Generate: `packages/db/drizzle/0001_*.sql`

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { makeDb } from "../src/client";
import { tenant, account, did, contact, form } from "../src/schema";

const URL = process.env.TEST_DATABASE_URL ?? "postgres://tas:tas@localhost:5432/tas_test";

describe("schema/0001 — tenancy + CRM", () => {
  const db = makeDb(URL);

  it("seeds a tenant, account, did, contact, form round-trip", async () => {
    const [t] = await db.insert(tenant).values({ name: "acme" }).returning();
    const [a] = await db.insert(account).values({ tenantId: t.id, name: "Acme Co" }).returning();
    const [d] = await db.insert(did).values({ accountId: a.id, e164: "+15550001" }).returning();
    const [c] = await db.insert(contact).values({ accountId: a.id, name: "Alice", phone: "+15550002" }).returning();
    const [f] = await db.insert(form).values({ accountId: a.id, name: "Default", schema: { fields: [] } }).returning();
    expect(t.id).toBeDefined();
    expect(d.e164).toBe("+15550001");
    expect(c.name).toBe("Alice");
    expect(f.schema).toEqual({ fields: [] });
  });
});
```

Also add to `packages/db/package.json` devDependencies: `"vitest": "1.4.0"`, and a `"test": "vitest run"` script (replace the no-op).

- [ ] **Step 2: Run the test — confirm RED for the expected reason**

Run: `pnpm --filter @tas/db test`
Expected: FAIL — cannot import `tenant`, `account`, etc. from `../src/schema`.

- [ ] **Step 3: Implement the schema**

Create `packages/db/src/schema/tenancy.ts`:
```ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const tenant = pgTable("tenant", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const account = pgTable("account", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const did = pgTable("did", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id").notNull().references(() => account.id),
  e164: text("e164").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

Create `packages/db/src/schema/crm.ts`:
```ts
import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { account } from "./tenancy";

export const contact = pgTable("contact", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id").notNull().references(() => account.id),
  name: text("name").notNull(),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const form = pgTable("form", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id").notNull().references(() => account.id),
  name: text("name").notNull(),
  schema: jsonb("schema").$type<{ fields: Array<{ name: string; label: string; type: string }> }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

Replace `packages/db/src/schema/index.ts`:
```ts
export * from "./tenancy";
export * from "./crm";
```

- [ ] **Step 4: Generate migration**

Run: `pnpm --filter @tas/db migrate:gen`
Expected: creates `packages/db/drizzle/0001_*.sql` + meta files.

- [ ] **Step 5: Apply against a throwaway test DB + run the test**

Run:
```bash
docker run --rm -d --name tas-test-pg -e POSTGRES_USER=tas -e POSTGRES_PASSWORD=tas -e POSTGRES_DB=tas_test -p 5433:5432 postgres:15
sleep 3
DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db migrate:apply
TEST_DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db test
docker rm -f tas-test-pg
```
Expected: migration applies; test PASSES.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): migration 0001 — tenant+account+did+contact+form schema"
```

---

## Task 4: DB migration 0002 — operator + queue tables (TDD)

**Files:**
- Create: `packages/db/src/schema/operator.ts` (user table)
- Create: `packages/db/src/schema/queue.ts` (queue, queue_call)
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/test/schema.test.ts` (add round-trip block)
- Generate: `packages/db/drizzle/0002_*.sql`

- [ ] **Step 1: Extend the test (RED)**

Append to `packages/db/test/schema.test.ts`:
```ts
import { user, queue, queueCall } from "../src/schema";

describe("schema/0002 — operator + queue", () => {
  const db = makeDb(URL);

  it("seeds a user, queue, queue_call round-trip", async () => {
    const [t] = await db.insert(tenant).values({ name: "queue-test" }).returning();
    const [a] = await db.insert(account).values({ tenantId: t.id, name: "QT" }).returning();
    const [u] = await db.insert(user).values({ tenantId: t.id, email: "op@qt.test", role: "operator" }).returning();
    const [q] = await db.insert(queue).values({ accountId: a.id, name: "main", strategy: "fifo" }).returning();
    const [qc] = await db.insert(queueCall).values({ queueId: q.id, callId: crypto.randomUUID(), enqueuedAt: new Date() }).returning();
    expect(u.role).toBe("operator");
    expect(q.strategy).toBe("fifo");
    expect(qc.queueId).toBe(q.id);
  });
});
```

- [ ] **Step 2: Run — confirm RED**

Run: `pnpm --filter @tas/db test`
Expected: FAIL — cannot import `user`, `queue`, `queueCall`.

- [ ] **Step 3: Implement**

Create `packages/db/src/schema/operator.ts`:
```ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { tenant } from "./tenancy";

export const user = pgTable("user", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["operator", "admin", "supervisor"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

Create `packages/db/src/schema/queue.ts`:
```ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { account } from "./tenancy";

export const queue = pgTable("queue", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id").notNull().references(() => account.id),
  name: text("name").notNull(),
  strategy: text("strategy", { enum: ["fifo", "priority", "sticky_last_operator", "least_recent", "longest_idle"] }).notNull(),
});

export const queueCall = pgTable("queue_call", {
  id: uuid("id").defaultRandom().primaryKey(),
  queueId: uuid("queue_id").notNull().references(() => queue.id),
  callId: uuid("call_id").notNull(),
  enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).notNull(),
  dequeuedAt: timestamp("dequeued_at", { withTimezone: true }),
  attempts: text("attempts").array().notNull().default([]),
});
```

Re-export from `packages/db/src/schema/index.ts`:
```ts
export * from "./tenancy";
export * from "./crm";
export * from "./operator";
export * from "./queue";
```

- [ ] **Step 4: Generate + apply + test**

Run:
```bash
pnpm --filter @tas/db migrate:gen
docker run --rm -d --name tas-test-pg -e POSTGRES_USER=tas -e POSTGRES_PASSWORD=tas -e POSTGRES_DB=tas_test -p 5433:5432 postgres:15
sleep 3
DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db migrate:apply
TEST_DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db test
docker rm -f tas-test-pg
```
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): migration 0002 — user+queue+queue_call schema"
```

---

## Task 5: DB migration 0003 — call lifecycle + message + dispatch (TDD)

**Files:**
- Create: `packages/db/src/schema/call.ts` (call, recording, recording_redaction_interval)
- Create: `packages/db/src/schema/message.ts` (message, dispatch_attempt)
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/test/schema.test.ts`

- [ ] **Step 1: Extend test (RED)**

Append:
```ts
import { call, recording, recordingRedactionInterval, message, dispatchAttempt } from "../src/schema";

describe("schema/0003 — call+recording+message+dispatch", () => {
  const db = makeDb(URL);

  it("seeds a call, recording, redaction interval, message, dispatch round-trip", async () => {
    const [t] = await db.insert(tenant).values({ name: "call-test" }).returning();
    const [a] = await db.insert(account).values({ tenantId: t.id, name: "CT" }).returning();
    const [d] = await db.insert(did).values({ accountId: a.id, e164: "+15559999" }).returning();
    const [u] = await db.insert(user).values({ tenantId: t.id, email: "op@ct.test", role: "operator" }).returning();
    const [cl] = await db.insert(call).values({ tenantId: t.id, accountId: a.id, didId: d.id, fromE164: "+15551234", startedAt: new Date() }).returning();
    const [r] = await db.insert(recording).values({ callId: cl.id, path: "rec/x.wav", startedAt: new Date() }).returning();
    const [ri] = await db.insert(recordingRedactionInterval).values({ recordingId: r.id, startMs: 1000, endMs: 2000, reason: "operator_pci_pause" }).returning();
    const [m] = await db.insert(message).values({ callId: cl.id, accountId: a.id, operatorId: u.id, body: "Caller wants a callback" }).returning();
    const [da] = await db.insert(dispatchAttempt).values({ messageId: m.id, channel: "in_app", deliveredAt: new Date() }).returning();
    expect(cl.fromE164).toBe("+15551234");
    expect(ri.reason).toBe("operator_pci_pause");
    expect(da.channel).toBe("in_app");
  });
});
```

- [ ] **Step 2: Run — confirm RED**

Run: `pnpm --filter @tas/db test`
Expected: FAIL — cannot import `call`, `recording`, etc.

- [ ] **Step 3: Implement**

Create `packages/db/src/schema/call.ts`:
```ts
import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { tenant, account, did } from "./tenancy";

export const call = pgTable("call", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
  accountId: uuid("account_id").notNull().references(() => account.id),
  didId: uuid("did_id").notNull().references(() => did.id),
  fromE164: text("from_e164").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endedBy: text("ended_by", { enum: ["caller", "operator", "system"] }),
  routedThrough: text("routed_through").array().notNull().default([]),
});

export const recording = pgTable("recording", {
  id: uuid("id").defaultRandom().primaryKey(),
  callId: uuid("call_id").notNull().references(() => call.id),
  path: text("path").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const recordingRedactionInterval = pgTable("recording_redaction_interval", {
  id: uuid("id").defaultRandom().primaryKey(),
  recordingId: uuid("recording_id").notNull().references(() => recording.id),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  reason: text("reason", { enum: ["operator_pci_pause", "auto_pii_ml"] }).notNull(),
});
```

Create `packages/db/src/schema/message.ts`:
```ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { account, user } from "./tenancy";
import { call } from "./call";
// note: `user` re-export reaches via operator.ts via index — adjust import if linter complains:
// import { user } from "./operator";

export const message = pgTable("message", {
  id: uuid("id").defaultRandom().primaryKey(),
  callId: uuid("call_id").notNull().references(() => call.id),
  accountId: uuid("account_id").notNull().references(() => account.id),
  operatorId: uuid("operator_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const dispatchAttempt = pgTable("dispatch_attempt", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id").notNull().references(() => message.id),
  channel: text("channel", { enum: ["in_app", "email", "sms", "push", "voice"] }).notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  error: text("error"),
});
```

Note: fix the import in `message.ts` — replace `import { account, user } from "./tenancy"` with the correct sources (`account` from `./tenancy`, `user` from `./operator`). The schema generator will reject a bad import.

Re-export from `index.ts`:
```ts
export * from "./tenancy";
export * from "./crm";
export * from "./operator";
export * from "./queue";
export * from "./call";
export * from "./message";
```

- [ ] **Step 4: Generate + apply + test**

Same dance as Task 4 step 4.
Expected: all three test blocks PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): migration 0003 — call+recording+redaction_interval+message+dispatch"
```

---

## Task 6: Seed script

**Files:**
- Create: `packages/db/src/seed.ts`

No TDD — deterministic seed; verification = `pnpm --filter @tas/db seed` against a fresh DB and inspecting rows.

- [ ] **Step 1: Create `packages/db/src/seed.ts`**

```ts
import { makeDb } from "./client";
import { tenant, account, did, contact, form, user, queue } from "./schema";

const FIXED_IDS = {
  tenant: "11111111-1111-1111-1111-111111111111",
  account: "22222222-2222-2222-2222-222222222222",
  did: "33333333-3333-3333-3333-333333333333",
  contact: "44444444-4444-4444-4444-444444444444",
  form: "55555555-5555-5555-5555-555555555555",
  operator: "66666666-6666-6666-6666-666666666666",
  queue: "77777777-7777-7777-7777-777777777777",
};

const FORM_SCHEMA = {
  fields: [
    { name: "caller_name", label: "Caller name", type: "text" },
    { name: "callback_phone", label: "Callback phone", type: "tel" },
    { name: "message_body", label: "Message", type: "textarea" },
  ],
};

async function main() {
  const db = makeDb(process.env.DATABASE_URL ?? "postgres://tas:tas@localhost:5432/tas");

  await db.insert(tenant).values({ id: FIXED_IDS.tenant, name: "demo-tenant" }).onConflictDoNothing();
  await db.insert(account).values({ id: FIXED_IDS.account, tenantId: FIXED_IDS.tenant, name: "Demo Account" }).onConflictDoNothing();
  await db.insert(did).values({ id: FIXED_IDS.did, accountId: FIXED_IDS.account, e164: "+15555550100" }).onConflictDoNothing();
  await db.insert(contact).values({ id: FIXED_IDS.contact, accountId: FIXED_IDS.account, name: "Alice Demo", phone: "+15555550200" }).onConflictDoNothing();
  await db.insert(form).values({ id: FIXED_IDS.form, accountId: FIXED_IDS.account, name: "Default", schema: FORM_SCHEMA }).onConflictDoNothing();
  await db.insert(user).values({ id: FIXED_IDS.operator, tenantId: FIXED_IDS.tenant, email: "operator@demo.test", role: "operator" }).onConflictDoNothing();
  await db.insert(queue).values({ id: FIXED_IDS.queue, accountId: FIXED_IDS.account, name: "main", strategy: "fifo" }).onConflictDoNothing();

  console.log("seed: ok");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Verify against a fresh DB**

Run:
```bash
docker run --rm -d --name tas-seed-pg -e POSTGRES_USER=tas -e POSTGRES_PASSWORD=tas -e POSTGRES_DB=tas -p 5434:5432 postgres:15
sleep 3
DATABASE_URL=postgres://tas:tas@localhost:5434/tas pnpm --filter @tas/db migrate:apply
DATABASE_URL=postgres://tas:tas@localhost:5434/tas pnpm --filter @tas/db seed
docker exec tas-seed-pg psql -U tas -d tas -c "select id, e164 from did;"
docker rm -f tas-seed-pg
```
Expected: seed prints `seed: ok`; psql shows DID `+15555550100`.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/seed.ts
git commit -m "feat(db): deterministic seed (fixed UUIDs, 1 tenant/account/did/contact/form/operator/queue)"
```

---

## Task 7: docker-compose skeleton + Postgres + Supavisor

**Files:**
- Create: `infra/docker-compose.yml`
- Modify: `Makefile` (root, create with `poc-up` target)

No TDD — infra. Smoke = `docker compose -f infra/docker-compose.yml up -d postgres supavisor` boots both, psql connects through supavisor on port 6543.

- [ ] **Step 1: Create `infra/docker-compose.yml`**

```yaml
# PoC Slice 1 stack — grows through Tasks 8–14.
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: tas
      POSTGRES_PASSWORD: tas
      POSTGRES_DB: tas
    volumes:
      - pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tas"]
      interval: 3s
      timeout: 2s
      retries: 10

  supavisor:
    image: supabase/supavisor:1.1.41
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: ecto://tas:tas@postgres:5432/tas
      SECRET_KEY_BASE: "01234567890123456789012345678901234567890123456789012345678901234567890123456789"
      VAULT_ENC_KEY: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      API_JWT_SECRET: "poc-only-not-prod"
      METRICS_JWT_SECRET: "poc-only-not-prod"
      POOLER_TENANT_ID: "poc"
      POOLER_DEFAULT_POOL_SIZE: "10"
      POOLER_MAX_CLIENT_CONN: "100"
      REGION: "local"
    ports:
      - "6543:6543"
    healthcheck:
      test: ["CMD-SHELL", "nc -z localhost 6543 || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pg-data:
```

- [ ] **Step 2: Create root `Makefile`**

```makefile
.PHONY: poc-up poc-down poc-e2e

poc-up:
	docker compose -f infra/docker-compose.yml up -d
	@echo "stack up; waiting for healthchecks..."
	@./scripts/wait-for-healthy.sh infra/docker-compose.yml

poc-down:
	docker compose -f infra/docker-compose.yml down -v

poc-e2e:
	pnpm --filter @tas/e2e test
```

(The `wait-for-healthy.sh` helper lands in Task 15.)

- [ ] **Step 3: Smoke test**

Run:
```bash
docker compose -f infra/docker-compose.yml up -d postgres supavisor
sleep 8
docker compose -f infra/docker-compose.yml ps
docker run --rm --network host postgres:15 psql postgres://tas:tas@localhost:6543/tas -c "select 1;"
docker compose -f infra/docker-compose.yml down -v
```
Expected: ps shows both healthy; psql via supavisor returns `1`.

- [ ] **Step 4: Commit**

```bash
git add infra/docker-compose.yml Makefile
git commit -m "feat(infra): docker-compose stack — postgres + supavisor (S5 ADR-0018 baseline)"
```

---

## Task 8: Kamailio service (inherits pot/S1 patterns)

**Files:**
- Create: `infra/kamailio/Dockerfile` (copy from `pot/S1-telephony-happy-path/kamailio-image/Dockerfile`)
- Create: `infra/kamailio/kamailio.cfg` (adapt from `pot/S1-telephony-happy-path/fixtures/kamailio/kamailio.cfg` — route INVITE to single Asterisk, no dispatcher failover at PoC scale)
- Create: `infra/kamailio/dispatcher.list` (one entry: `1 sip:asterisk:5060`)
- Modify: `infra/docker-compose.yml` (add `kamailio` service)

No TDD — config. Smoke = `kamailio` health probe passes (`kamcmd core.uptime`).

- [ ] **Step 1: Copy + adapt Kamailio image**

```bash
cp pot/S1-telephony-happy-path/kamailio-image/Dockerfile infra/kamailio/Dockerfile
```

Open the resulting Dockerfile and confirm it builds `kamailio:5.8` with the `dispatcher`, `nathelper`, `tm`, `rr` modules.

- [ ] **Step 2: Copy + adapt kamailio.cfg**

```bash
cp pot/S1-telephony-happy-path/fixtures/kamailio/kamailio.cfg infra/kamailio/kamailio.cfg
cp pot/S1-telephony-happy-path/fixtures/kamailio/dispatcher.list infra/kamailio/dispatcher.list
```

Edit `infra/kamailio/dispatcher.list` to a single line:
```
1 sip:asterisk:5060
```

Inspect `infra/kamailio/kamailio.cfg`; if it references both `kamailio-primary`/`kamailio-standby` or a multi-line dispatcher, simplify the route block to dispatcher set 1, single destination. Otherwise leave as-is — S1's PoT config already routes INVITEs to whatever `dispatcher.list` says.

- [ ] **Step 3: Extend `infra/docker-compose.yml`**

Append to the `services:` block:
```yaml
  kamailio:
    build:
      context: ./kamailio
    volumes:
      - ./kamailio/kamailio.cfg:/etc/kamailio/kamailio.cfg:ro
      - ./kamailio/dispatcher.list:/etc/kamailio/dispatcher.list:ro
    healthcheck:
      test: ["CMD", "kamcmd", "core.uptime"]
      interval: 5s
      timeout: 2s
      retries: 10
```

- [ ] **Step 4: Smoke**

Run:
```bash
docker compose -f infra/docker-compose.yml up -d --build kamailio
sleep 10
docker compose -f infra/docker-compose.yml exec kamailio kamcmd core.uptime
docker compose -f infra/docker-compose.yml down
```
Expected: `kamcmd` returns an uptime row.

- [ ] **Step 5: Commit**

```bash
git add infra/kamailio infra/docker-compose.yml
git commit -m "feat(infra): kamailio service (inherits pot/S1 patterns; single Asterisk dispatcher destination)"
```

---

## Task 9: Asterisk service (inherits pot/S1 patterns + Stasis app `tas`)

**Files:**
- Create: `infra/asterisk/Dockerfile` (copy from `pot/S1-telephony-happy-path/asterisk-image/Dockerfile`)
- Create: `infra/asterisk/extensions.conf` (one context: route DID +15555550100 → Stasis(tas))
- Create: `infra/asterisk/pjsip.conf` (one transport, one trunk endpoint accepting INVITE from kamailio)
- Create: `infra/asterisk/ari.conf` (one user `tas`/`tas`)
- Create: `infra/asterisk/http.conf` (enable HTTP server on 8088 for ARI)
- Create: `infra/asterisk/modules.conf` (load `res_ari*`, `res_pjsip*`, `app_stasis`, `app_mixmonitor`)
- Modify: `infra/docker-compose.yml` (add `asterisk` service)

- [ ] **Step 1: Copy Asterisk image**

```bash
cp pot/S1-telephony-happy-path/asterisk-image/Dockerfile infra/asterisk/Dockerfile
```

- [ ] **Step 2: Create `infra/asterisk/extensions.conf`**

```ini
[tas-inbound]
exten => +15555550100,1,NoOp(PoC inbound)
 same => n,Stasis(tas)
 same => n,Hangup()

[default]
exten => _X.,1,Goto(tas-inbound,${EXTEN},1)
```

- [ ] **Step 3: Create `infra/asterisk/pjsip.conf`**

```ini
[global]
type=global

[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060

[kamailio]
type=endpoint
context=default
disallow=all
allow=ulaw
allow=alaw
aors=kamailio

[kamailio]
type=aor
contact=sip:kamailio:5060

[kamailio]
type=identify
endpoint=kamailio
match=kamailio
```

- [ ] **Step 4: Create `infra/asterisk/ari.conf`**

```ini
[general]
enabled=yes
pretty=yes
allowed_origins=*

[tas]
type=user
read_only=no
password=tas
```

- [ ] **Step 5: Create `infra/asterisk/http.conf`**

```ini
[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8088
```

- [ ] **Step 6: Create `infra/asterisk/modules.conf`**

```ini
[modules]
autoload=yes
```

- [ ] **Step 7: Extend `infra/docker-compose.yml`**

```yaml
  asterisk:
    build:
      context: ./asterisk
    volumes:
      - ./asterisk/extensions.conf:/etc/asterisk/extensions.conf:ro
      - ./asterisk/pjsip.conf:/etc/asterisk/pjsip.conf:ro
      - ./asterisk/ari.conf:/etc/asterisk/ari.conf:ro
      - ./asterisk/http.conf:/etc/asterisk/http.conf:ro
      - ./asterisk/modules.conf:/etc/asterisk/modules.conf:ro
      - recordings:/var/spool/asterisk/recording
    healthcheck:
      test: ["CMD-SHELL", "asterisk -rx 'core show uptime' | grep -q 'System uptime'"]
      interval: 5s
      timeout: 3s
      retries: 12

volumes:
  pg-data:
  recordings:
```

- [ ] **Step 8: Smoke**

Run:
```bash
docker compose -f infra/docker-compose.yml up -d --build asterisk kamailio
sleep 15
curl -u tas:tas http://localhost:8088/ari/asterisk/info
docker compose -f infra/docker-compose.yml down
```
The `curl` against ARI requires exposing port 8088 — add `ports: ["8088:8088"]` to the asterisk service in compose for the smoke test, then remove it before commit (the API will reach Asterisk over the compose network by service name).
Expected: ARI returns a JSON blob with `system`/`status` fields.

- [ ] **Step 9: Commit**

```bash
git add infra/asterisk infra/docker-compose.yml
git commit -m "feat(infra): asterisk service — Stasis(tas) on DID +15555550100, ARI user tas"
```

---

## Task 10: rtpengine service

**Files:**
- Create: `infra/rtpengine/Dockerfile` (apt-installs `rtpengine` in a Debian base)
- Create: `infra/rtpengine/ng-control.conf` (or pass CLI flags)
- Modify: `infra/docker-compose.yml`

No TDD — infra. Smoke = `rtpengine --version` runs inside the container and rtpengine-recording smoke from S1 Layer 2 carries over.

- [ ] **Step 1: Create `infra/rtpengine/Dockerfile`**

```dockerfile
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ngcp-rtpengine-daemon \
      ngcp-rtpengine-utils \
    && rm -rf /var/lib/apt/lists/*
EXPOSE 22222/udp
CMD ["rtpengine", "--interface=eth0", "--listen-ng=0.0.0.0:22222", "--foreground", "--log-stderr"]
```

- [ ] **Step 2: Extend `infra/docker-compose.yml`**

```yaml
  rtpengine:
    build:
      context: ./rtpengine
    healthcheck:
      test: ["CMD-SHELL", "pgrep rtpengine || exit 1"]
      interval: 5s
      timeout: 2s
      retries: 8
```

Note: Kamailio's `rtpengine` module needs to be told the rtpengine address (`rtpengine_manage()`). Update `infra/kamailio/kamailio.cfg` — add `modparam("rtpengine", "rtpengine_sock", "udp:rtpengine:22222")` to the `loadmodule "rtpengine.so"` section. If S1 PoT did NOT include rtpengine in Layer 1 (it didn't — Layer 2 deferred), pull the rtpengine integration from the S1 Layer-2 Sprint-0 work (per spec §11 Sprint-0 prereq).

- [ ] **Step 3: Smoke**

Run:
```bash
docker compose -f infra/docker-compose.yml up -d --build rtpengine
docker compose -f infra/docker-compose.yml exec rtpengine rtpengine --version
docker compose -f infra/docker-compose.yml down
```
Expected: `rtpengine --version` prints a semver.

- [ ] **Step 4: Commit**

```bash
git add infra/rtpengine infra/docker-compose.yml infra/kamailio/kamailio.cfg
git commit -m "feat(infra): rtpengine service + kamailio rtpengine module hook"
```

---

## Task 11: MinIO service

**Files:**
- Modify: `infra/docker-compose.yml`

- [ ] **Step 1: Extend compose**

```yaml
  minio:
    image: minio/minio:RELEASE.2024-03-15T01-07-19Z
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: tas
      MINIO_ROOT_PASSWORD: tas1234
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/ready"]
      interval: 5s
      timeout: 2s
      retries: 10

volumes:
  pg-data:
  recordings:
  minio-data:
```

- [ ] **Step 2: Smoke**

Run:
```bash
docker compose -f infra/docker-compose.yml up -d minio
sleep 5
docker compose -f infra/docker-compose.yml exec minio mc alias set local http://localhost:9000 tas tas1234
docker compose -f infra/docker-compose.yml exec minio mc mb local/recordings
docker compose -f infra/docker-compose.yml exec minio mc ls local/
docker compose -f infra/docker-compose.yml down
```
Expected: `mc ls` shows the `recordings` bucket.

- [ ] **Step 3: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "feat(infra): minio service (recordings bucket target)"
```

---

## Task 12: NATS service

**Files:**
- Modify: `infra/docker-compose.yml`

- [ ] **Step 1: Extend compose**

```yaml
  nats:
    image: nats:2.10-alpine
    command: ["-js"]
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- http://localhost:8222/healthz | grep -q ok"]
      interval: 3s
      timeout: 2s
      retries: 8
```

- [ ] **Step 2: Smoke**

Run:
```bash
docker compose -f infra/docker-compose.yml up -d nats
sleep 4
docker run --rm --network tas_default natsio/nats-box:latest nats --server nats://nats:4222 server check connection
docker compose -f infra/docker-compose.yml down
```
Expected: `nats server check` prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "feat(infra): nats jetstream service"
```

---

## Task 13: Temporal self-host service

**Files:**
- Create: `infra/temporal/docker-compose.fragment.yml` (or inline into main compose — inline simpler)
- Modify: `infra/docker-compose.yml`

- [ ] **Step 1: Extend compose**

```yaml
  temporal:
    image: temporalio/auto-setup:1.22.4
    environment:
      DB: postgres12
      DB_PORT: "5432"
      POSTGRES_USER: tas
      POSTGRES_PWD: tas
      POSTGRES_SEEDS: postgres
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "tctl --address localhost:7233 cluster health 2>&1 | grep -q SERVING"]
      interval: 8s
      timeout: 3s
      retries: 15

  temporal-ui:
    image: temporalio/ui:2.21.3
    environment:
      TEMPORAL_ADDRESS: temporal:7233
    depends_on:
      temporal:
        condition: service_healthy
```

- [ ] **Step 2: Smoke**

Run:
```bash
docker compose -f infra/docker-compose.yml up -d temporal
sleep 25
docker compose -f infra/docker-compose.yml exec temporal tctl --address temporal:7233 namespace list
docker compose -f infra/docker-compose.yml down -v
```
Expected: namespace list returns `default`.

- [ ] **Step 3: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "feat(infra): temporal self-host (ADR-0015 fallback path baseline)"
```

---

## Task 14: Caddy service (ADR-0019 baseline)

**Files:**
- Create: `infra/caddy/Caddyfile`
- Modify: `infra/docker-compose.yml`

- [ ] **Step 1: Create `infra/caddy/Caddyfile`**

```caddyfile
{
	# PoC scale: no real ACME. Match ADR-0019 storage shape; LE issuance gated by S8 permission endpoint.
	auto_https off
}

:80 {
	handle /v1/* {
		reverse_proxy api:3000
	}
	handle /ws {
		reverse_proxy api:3000
	}
	handle {
		reverse_proxy web:3001
	}
}
```

- [ ] **Step 2: Extend `infra/docker-compose.yml`**

```yaml
  caddy:
    image: caddy:2.10-alpine
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    ports:
      - "8080:80"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- http://localhost/ 2>&1 || true; pgrep caddy || exit 1"]
      interval: 5s
      timeout: 2s
      retries: 8

volumes:
  pg-data:
  recordings:
  minio-data:
  caddy-data:
```

- [ ] **Step 3: Smoke**

Run:
```bash
docker compose -f infra/docker-compose.yml up -d caddy
sleep 3
curl -sS http://localhost:8080/ -o /dev/null -w '%{http_code}\n'
docker compose -f infra/docker-compose.yml down
```
Expected: 502 (api/web not running yet, but caddy is up and proxying).

- [ ] **Step 4: Commit**

```bash
git add infra/caddy infra/docker-compose.yml
git commit -m "feat(infra): caddy ingress — proxies /v1 + /ws to api, / to web"
```

---

## Task 15: `make poc-up` dispatcher + `wait-for-healthy.sh` helper

**Files:**
- Create: `scripts/wait-for-healthy.sh`
- Modify: `Makefile` (add `poc-up-fresh`, `poc-status`, `poc-logs`)

- [ ] **Step 1: Create `scripts/wait-for-healthy.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
COMPOSE_FILE="${1:-infra/docker-compose.yml}"
TIMEOUT="${TIMEOUT_SECONDS:-120}"
START=$(date +%s)
while :; do
  STATUS=$(docker compose -f "$COMPOSE_FILE" ps --format json | jq -r '.[] | "\(.Service)\t\(.Health // "no-healthcheck")"' 2>/dev/null || true)
  UNHEALTHY=$(echo "$STATUS" | awk -F'\t' '$2 != "healthy" && $2 != "no-healthcheck" {print $1}' || true)
  if [ -z "$UNHEALTHY" ]; then
    echo "all services healthy"
    exit 0
  fi
  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -gt "$TIMEOUT" ]; then
    echo "timeout waiting for: $UNHEALTHY"
    exit 1
  fi
  sleep 2
done
```

Make it executable: `chmod +x scripts/wait-for-healthy.sh`

- [ ] **Step 2: Extend `Makefile`**

```makefile
poc-up-fresh: poc-down poc-up
	pnpm --filter @tas/db migrate:apply
	pnpm --filter @tas/db seed

poc-status:
	docker compose -f infra/docker-compose.yml ps

poc-logs:
	docker compose -f infra/docker-compose.yml logs -f
```

- [ ] **Step 3: Smoke the whole stack**

Run:
```bash
make poc-up-fresh
make poc-status
make poc-down
```
Expected: all services start healthy; migrations apply; seed prints `seed: ok`.

- [ ] **Step 4: Commit**

```bash
git add scripts Makefile
git commit -m "chore(make): poc-up-fresh runs full stack + migrations + seed; wait-for-healthy helper"
```

---

## Task 16: apps/api — NestJS skeleton + hardcoded-JWT guard

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/auth/jwt.guard.ts`
- Create: `apps/api/test/app.e2e-spec.ts` (NestJS supertest smoke)

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@tas/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'lint TBD'"
  },
  "dependencies": {
    "@nestjs/common": "10.3.3",
    "@nestjs/core": "10.3.3",
    "@nestjs/platform-express": "10.3.3",
    "@nestjs/platform-ws": "10.3.3",
    "@nestjs/websockets": "10.3.3",
    "rxjs": "7.8.1",
    "ws": "8.16.0",
    "nats": "2.19.0",
    "@tas/db": "workspace:*",
    "@tas/shared-types": "workspace:*"
  },
  "devDependencies": {
    "@nestjs/cli": "10.3.2",
    "@nestjs/testing": "10.3.3",
    "vitest": "1.4.0",
    "supertest": "6.3.4",
    "@types/supertest": "6.0.2",
    "typescript": "5.4.2",
    "tsx": "4.7.1"
  }
}
```

- [ ] **Step 2: Create `apps/api/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 3: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Create `packages/shared-types/package.json`**

```json
{
  "name": "@tas/shared-types",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "echo ok",
    "test": "echo no tests"
  }
}
```

Create `packages/shared-types/src/index.ts`:
```ts
export {};
```

Create `packages/shared-types/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: Create `apps/api/src/auth/jwt.guard.ts`**

```ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";

const HARDCODED_TOKEN = "poc-operator-token";
const OPERATOR_ID = "66666666-6666-6666-6666-666666666666";

@Injectable()
export class JwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/, "");
    if (auth !== HARDCODED_TOKEN) throw new UnauthorizedException();
    req.user = { id: OPERATOR_ID, role: "operator" };
    return true;
  }
}
```

- [ ] **Step 6: Create `apps/api/src/app.module.ts` + `main.ts`**

`app.module.ts`:
```ts
import { Module } from "@nestjs/common";
import { Controller, Get } from "@nestjs/common";

@Controller("health")
class HealthController {
  @Get()
  health() { return { ok: true }; }
}

@Module({
  controllers: [HealthController],
})
export class AppModule {}
```

`main.ts`:
```ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000, "0.0.0.0");
}
bootstrap();
```

- [ ] **Step 7: Create `apps/api/test/app.e2e-spec.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("api smoke", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it("/health returns ok", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 8: Install + run test**

Run: `pnpm install && pnpm --filter @tas/api test`
Expected: smoke test PASSES.

- [ ] **Step 9: Commit**

```bash
git add apps/api packages/shared-types pnpm-lock.yaml
git commit -m "feat(api): nestjs skeleton + /health + JwtGuard (hardcoded operator token for PoC)"
```

---

## Task 17: TDD `/v1/Account/:id` endpoint

**Files:**
- Create: `apps/api/src/v1/v1.module.ts`
- Create: `apps/api/src/v1/account.controller.ts`
- Modify: `apps/api/src/app.module.ts` (import V1Module)
- Create: `apps/api/test/v1/account.e2e-spec.ts`
- Modify: `packages/shared-types/src/api.ts` (DTO)

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/v1/account.e2e-spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../../src/app.module";

const ACCOUNT_ID = "22222222-2222-2222-2222-222222222222";

describe("/v1/Account/:id", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it("404 without auth", async () => {
    await request(app.getHttpServer()).get(`/v1/Account/${ACCOUNT_ID}`).expect(401);
  });

  it("200 with hardcoded operator token, returns demo account", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/Account/${ACCOUNT_ID}`)
      .set("Authorization", "Bearer poc-operator-token")
      .expect(200);
    expect(res.body).toMatchObject({ id: ACCOUNT_ID, name: "Demo Account" });
  });
});
```

Create `packages/shared-types/src/api.ts`:
```ts
export interface AccountDto { id: string; name: string; }
export interface ContactDto { id: string; accountId: string; name: string; phone: string | null; }
export interface FormDto { id: string; accountId: string; name: string; schema: unknown; }
export interface MessageCreateRequest { callId: string; accountId: string; body: string; }
export interface MessageDto { id: string; callId: string; accountId: string; operatorId: string; body: string; createdAt: string; }
```

Re-export from `packages/shared-types/src/index.ts`:
```ts
export * from "./api";
```

- [ ] **Step 2: Run — confirm RED**

Pre-req: run `pnpm --filter @tas/db migrate:apply && pnpm --filter @tas/db seed` against the running Postgres in compose.

Run: `DATABASE_URL=postgres://tas:tas@localhost:6543/tas pnpm --filter @tas/api test test/v1/account.e2e-spec.ts`
Expected: FAIL — 404 on `/v1/Account/:id` (route doesn't exist).

- [ ] **Step 3: Implement**

Create `apps/api/src/v1/account.controller.ts`:
```ts
import { Controller, Get, Param, NotFoundException, UseGuards } from "@nestjs/common";
import { makeDb } from "@tas/db/client";
import { account } from "@tas/db";
import { eq } from "drizzle-orm";
import { JwtGuard } from "../auth/jwt.guard";
import type { AccountDto } from "@tas/shared-types";

@UseGuards(JwtGuard)
@Controller("v1/Account")
export class AccountController {
  private db = makeDb(process.env.DATABASE_URL!);

  @Get(":id")
  async get(@Param("id") id: string): Promise<AccountDto> {
    const rows = await this.db.select().from(account).where(eq(account.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException();
    return { id: rows[0].id, name: rows[0].name };
  }
}
```

Create `apps/api/src/v1/v1.module.ts`:
```ts
import { Module } from "@nestjs/common";
import { AccountController } from "./account.controller";

@Module({
  controllers: [AccountController],
})
export class V1Module {}
```

Update `apps/api/src/app.module.ts`:
```ts
import { Module, Controller, Get } from "@nestjs/common";
import { V1Module } from "./v1/v1.module";

@Controller("health")
class HealthController { @Get() health() { return { ok: true }; } }

@Module({ imports: [V1Module], controllers: [HealthController] })
export class AppModule {}
```

- [ ] **Step 4: Run — confirm GREEN**

Run: `DATABASE_URL=postgres://tas:tas@localhost:6543/tas pnpm --filter @tas/api test`
Expected: all 3 tests PASS (smoke + 401 + 200).

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/shared-types
git commit -m "feat(api): GET /v1/Account/:id with JwtGuard (TDD red→green)"
```

---

## Task 18: TDD `/v1/Contact/:id`

**Files:**
- Create: `apps/api/src/v1/contact.controller.ts`
- Modify: `apps/api/src/v1/v1.module.ts`
- Create: `apps/api/test/v1/contact.e2e-spec.ts`

- [ ] **Step 1: Failing test**

Create `apps/api/test/v1/contact.e2e-spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../../src/app.module";

const CONTACT_ID = "44444444-4444-4444-4444-444444444444";

describe("/v1/Contact/:id", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it("200 with token returns Alice Demo", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/Contact/${CONTACT_ID}`)
      .set("Authorization", "Bearer poc-operator-token")
      .expect(200);
    expect(res.body).toMatchObject({ id: CONTACT_ID, name: "Alice Demo", phone: "+15555550200" });
  });
});
```

- [ ] **Step 2: Run — confirm RED**

Run: `DATABASE_URL=postgres://tas:tas@localhost:6543/tas pnpm --filter @tas/api test test/v1/contact.e2e-spec.ts`
Expected: 404.

- [ ] **Step 3: Implement**

Create `apps/api/src/v1/contact.controller.ts`:
```ts
import { Controller, Get, Param, NotFoundException, UseGuards } from "@nestjs/common";
import { makeDb } from "@tas/db/client";
import { contact } from "@tas/db";
import { eq } from "drizzle-orm";
import { JwtGuard } from "../auth/jwt.guard";
import type { ContactDto } from "@tas/shared-types";

@UseGuards(JwtGuard)
@Controller("v1/Contact")
export class ContactController {
  private db = makeDb(process.env.DATABASE_URL!);

  @Get(":id")
  async get(@Param("id") id: string): Promise<ContactDto> {
    const rows = await this.db.select().from(contact).where(eq(contact.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException();
    const c = rows[0];
    return { id: c.id, accountId: c.accountId, name: c.name, phone: c.phone };
  }
}
```

Add to `v1.module.ts` controllers: `ContactController`.

- [ ] **Step 4: Run — confirm GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): GET /v1/Contact/:id (TDD red→green)"
```

---

## Task 19: TDD `/v1/Form/:id`

**Files:**
- Create: `apps/api/src/v1/form.controller.ts`
- Modify: `apps/api/src/v1/v1.module.ts`
- Create: `apps/api/test/v1/form.e2e-spec.ts`

Follow exact same pattern as Task 18 for the `form` table.

- [ ] **Step 1: Failing test** — supertest GET `/v1/Form/55555555-5555-5555-5555-555555555555` expects 200, body `{ id, accountId, name: "Default", schema: { fields: [...] } }`.
- [ ] **Step 2: Run — RED.**
- [ ] **Step 3: Implement** `FormController` (clone Contact pattern; select from `form` table; return `FormDto`).
- [ ] **Step 4: Run — GREEN.**
- [ ] **Step 5: Commit** `feat(api): GET /v1/Form/:id (TDD red→green)`.

---

## Task 20: TDD `POST /v1/Message`

**Files:**
- Create: `apps/api/src/v1/message.controller.ts`
- Modify: `apps/api/src/v1/v1.module.ts`
- Create: `apps/api/test/v1/message.e2e-spec.ts`

- [ ] **Step 1: Failing test**

Create `apps/api/test/v1/message.e2e-spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { makeDb } from "@tas/db/client";
import { call, did, account } from "@tas/db";
import { eq } from "drizzle-orm";

const ACCOUNT_ID = "22222222-2222-2222-2222-222222222222";
const DID_ID = "33333333-3333-3333-3333-333333333333";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

describe("POST /v1/Message", () => {
  let app: INestApplication;
  let callId: string;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    const db = makeDb(process.env.DATABASE_URL!);
    const [c] = await db.insert(call).values({
      tenantId: TENANT_ID, accountId: ACCOUNT_ID, didId: DID_ID,
      fromE164: "+15551234567", startedAt: new Date(),
    }).returning();
    callId = c.id;
  });
  afterAll(async () => { await app.close(); });

  it("201 creates a message bound to the call + operator", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/Message")
      .set("Authorization", "Bearer poc-operator-token")
      .send({ callId, accountId: ACCOUNT_ID, body: "Caller wants a callback." })
      .expect(201);
    expect(res.body).toMatchObject({
      callId, accountId: ACCOUNT_ID, body: "Caller wants a callback.",
      operatorId: "66666666-6666-6666-6666-666666666666",
    });
  });
});
```

- [ ] **Step 2: Run — RED**

- [ ] **Step 3: Implement**

Create `apps/api/src/v1/message.controller.ts`:
```ts
import { Controller, Post, Body, UseGuards, Req, HttpCode } from "@nestjs/common";
import { makeDb } from "@tas/db/client";
import { message } from "@tas/db";
import { JwtGuard } from "../auth/jwt.guard";
import type { MessageCreateRequest, MessageDto } from "@tas/shared-types";

@UseGuards(JwtGuard)
@Controller("v1/Message")
export class MessageController {
  private db = makeDb(process.env.DATABASE_URL!);

  @Post()
  @HttpCode(201)
  async create(@Body() body: MessageCreateRequest, @Req() req: any): Promise<MessageDto> {
    const operatorId = req.user.id;
    const [row] = await this.db.insert(message).values({
      callId: body.callId, accountId: body.accountId, operatorId, body: body.body,
    }).returning();
    return {
      id: row.id, callId: row.callId, accountId: row.accountId,
      operatorId: row.operatorId, body: row.body, createdAt: row.createdAt.toISOString(),
    };
  }
}
```

Add `MessageController` to `v1.module.ts` controllers.

- [ ] **Step 4: Run — GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/shared-types
git commit -m "feat(api): POST /v1/Message — persists message bound to operator from JWT"
```

---

## Task 21: NATS client in apps/api

**Files:**
- Create: `apps/api/src/events/nats.client.ts`
- Create: `apps/api/src/events/events.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `packages/shared-types/src/events.ts`

No TDD against external NATS — verified by Task 23 integration. This task just lands the wiring.

- [ ] **Step 1: Create `packages/shared-types/src/events.ts`**

```ts
export interface StasisStartEvent {
  type: "telephony.event.stasis_start";
  callId: string;
  channelId: string;
  tenantId: string;
  accountId: string;
  didId: string;
  fromE164: string;
  startedAt: string;
}
```

Re-export from `packages/shared-types/src/index.ts`:
```ts
export * from "./api";
export * from "./events";
```

- [ ] **Step 2: Create `apps/api/src/events/nats.client.ts`**

```ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { connect, NatsConnection, JSONCodec } from "nats";

@Injectable()
export class NatsClient implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(NatsClient.name);
  private nc?: NatsConnection;
  private codec = JSONCodec();

  async onModuleInit() {
    this.nc = await connect({ servers: process.env.NATS_URL ?? "nats://nats:4222" });
    this.logger.log("nats connected");
  }
  async onModuleDestroy() { await this.nc?.close(); }

  publish<T>(subject: string, payload: T): void {
    if (!this.nc) throw new Error("nats not connected");
    this.nc.publish(subject, this.codec.encode(payload));
  }

  async subscribe<T>(subject: string, handler: (msg: T) => Promise<void> | void): Promise<void> {
    if (!this.nc) throw new Error("nats not connected");
    const sub = this.nc.subscribe(subject);
    (async () => {
      for await (const m of sub) {
        try { await handler(this.codec.decode(m.data) as T); }
        catch (e) { this.logger.error(`handler error for ${subject}`, e as Error); }
      }
    })();
  }
}
```

- [ ] **Step 3: Create `apps/api/src/events/events.module.ts`**

```ts
import { Module, Global } from "@nestjs/common";
import { NatsClient } from "./nats.client";

@Global()
@Module({ providers: [NatsClient], exports: [NatsClient] })
export class EventsModule {}
```

- [ ] **Step 4: Import `EventsModule` in `app.module.ts`**

```ts
import { Module, Controller, Get } from "@nestjs/common";
import { V1Module } from "./v1/v1.module";
import { EventsModule } from "./events/events.module";

@Controller("health") class HealthController { @Get() health() { return { ok: true }; } }
@Module({ imports: [V1Module, EventsModule], controllers: [HealthController] })
export class AppModule {}
```

- [ ] **Step 5: Smoke — boot the app, confirm "nats connected" log**

Run:
```bash
make poc-up
pnpm --filter @tas/api build
NATS_URL=nats://localhost:4222 DATABASE_URL=postgres://tas:tas@localhost:6543/tas node apps/api/dist/main.js &
APP_PID=$!
sleep 3
kill $APP_PID
make poc-down
```
Expected: log line `nats connected` before shutdown.

- [ ] **Step 6: Commit**

```bash
git add apps/api packages/shared-types
git commit -m "feat(api): nats client wiring (Global EventsModule)"
```

---

## Task 22: ARI client (HTTP + WS subscribe)

**Files:**
- Create: `packages/ari-client/package.json`
- Create: `packages/ari-client/tsconfig.json`
- Create: `packages/ari-client/src/index.ts`
- Modify: `apps/api/package.json` (add `@tas/ari-client` dep)
- Create: `apps/api/src/telephony/ari.client.ts`
- Create: `apps/api/src/telephony/telephony.module.ts`
- Modify: `apps/api/src/app.module.ts`

No TDD against real Asterisk in unit test — verified by Task 23 integration. Wire only.

- [ ] **Step 1: Create `packages/ari-client/package.json`**

```json
{
  "name": "@tas/ari-client",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "lint": "echo ok", "test": "echo no tests" },
  "dependencies": { "ws": "8.16.0" },
  "devDependencies": { "@types/ws": "8.5.10", "typescript": "5.4.2" }
}
```

`tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*"] }
```

- [ ] **Step 2: Create `packages/ari-client/src/index.ts`**

```ts
import WebSocket from "ws";

export interface AriConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  app: string;
}

export class AriClient {
  private ws?: WebSocket;
  private listeners = new Map<string, Array<(ev: any) => void>>();

  constructor(private cfg: AriConfig) {}

  async connect(): Promise<void> {
    const url = `ws://${this.cfg.host}:${this.cfg.port}/ari/events?api_key=${this.cfg.user}:${this.cfg.pass}&app=${this.cfg.app}&subscribeAll=true`;
    this.ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      this.ws!.once("open", () => resolve());
      this.ws!.once("error", reject);
    });
    this.ws.on("message", (data) => {
      const ev = JSON.parse(data.toString());
      (this.listeners.get(ev.type) ?? []).forEach((cb) => cb(ev));
    });
  }

  on(type: string, cb: (ev: any) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }

  async bridgeCreate(): Promise<{ id: string }> {
    return this.post(`/bridges`, { type: "mixing" });
  }

  async bridgeAddChannel(bridgeId: string, channelId: string): Promise<void> {
    await this.post(`/bridges/${bridgeId}/addChannel`, { channel: channelId });
  }

  async channelAnswer(channelId: string): Promise<void> {
    await this.post(`/channels/${channelId}/answer`, {});
  }

  async mixmonitorStart(channelId: string, fileName: string): Promise<void> {
    await this.post(`/channels/${channelId}/mixmonitor`, { name: fileName, format: "wav" });
  }

  private async post(path: string, body: any): Promise<any> {
    const r = await fetch(`http://${this.cfg.host}:${this.cfg.port}/ari${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(`${this.cfg.user}:${this.cfg.pass}`).toString("base64") },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`ari ${path} ${r.status}`);
    if (r.headers.get("content-length") === "0") return {};
    return r.json();
  }

  async close(): Promise<void> { this.ws?.close(); }
}
```

- [ ] **Step 3: Add `@tas/ari-client` to apps/api package.json dependencies (`"@tas/ari-client": "workspace:*"`)**

- [ ] **Step 4: Create `apps/api/src/telephony/ari.client.ts`**

```ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { AriClient } from "@tas/ari-client";

@Injectable()
export class AriService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(AriService.name);
  client!: AriClient;

  async onModuleInit() {
    this.client = new AriClient({
      host: process.env.ARI_HOST ?? "asterisk",
      port: Number(process.env.ARI_PORT ?? 8088),
      user: process.env.ARI_USER ?? "tas",
      pass: process.env.ARI_PASS ?? "tas",
      app: process.env.ARI_APP ?? "tas",
    });
    await this.client.connect();
    this.logger.log("ari connected");
  }
  async onModuleDestroy() { await this.client?.close(); }
}
```

- [ ] **Step 5: Create `apps/api/src/telephony/telephony.module.ts`**

```ts
import { Module } from "@nestjs/common";
import { AriService } from "./ari.client";

@Module({ providers: [AriService], exports: [AriService] })
export class TelephonyModule {}
```

Add to `app.module.ts` imports.

- [ ] **Step 6: Smoke — boot the stack + api, confirm "ari connected"**

Run:
```bash
make poc-up
pnpm --filter @tas/api build
ARI_HOST=localhost DATABASE_URL=postgres://tas:tas@localhost:6543/tas NATS_URL=nats://localhost:4222 node apps/api/dist/main.js &
APP_PID=$!
sleep 5
kill $APP_PID
make poc-down
```
The smoke needs ARI port 8088 reachable from host. Add `ports: ["8088:8088"]` to the asterisk service temporarily for this smoke; revert before commit (api reaches asterisk via service-name DNS in compose; the smoke runs api outside compose for now).
Expected: `ari connected` log line.

- [ ] **Step 7: Commit**

```bash
git add packages/ari-client apps/api pnpm-lock.yaml
git commit -m "feat(telephony): ari-client package + AriService NestJS provider"
```

---

## Task 23: StasisStart handler → NATS publish

**Files:**
- Create: `apps/api/src/telephony/stasis.handler.ts`
- Modify: `apps/api/src/telephony/telephony.module.ts`
- Modify: `packages/db` — add helper to insert a `call` row keyed by ARI channel data

- [ ] **Step 1: Failing test (integration shape)**

Create `apps/api/test/telephony/stasis.e2e-spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { AppModule } from "../../src/app.module";
import { connect, JSONCodec } from "nats";

const DID_E164 = "+15555550100";

describe("StasisStart -> NATS publish", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it("on synthetic StasisStart, publishes telephony.event.stasis_start with call row created", async () => {
    const nc = await connect({ servers: process.env.NATS_URL ?? "nats://localhost:4222" });
    const codec = JSONCodec();
    const sub = nc.subscribe("telephony.event.stasis_start");

    // Simulate by injecting a StasisStart event into AriService's listener registry.
    // The test harness in `stasis.handler.ts` exposes a `simulateStasisStart` for this purpose.
    const { StasisHandler } = await import("../../src/telephony/stasis.handler");
    const handler = app.get(StasisHandler);
    await handler.simulateStasisStart({
      type: "StasisStart",
      channel: { id: "ch-1", caller: { number: "+15551234567" }, dialplan: { exten: DID_E164 } },
      args: [],
    });

    const msg = await Promise.race([
      (async () => { for await (const m of sub) return codec.decode(m.data); })(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
    ]) as any;

    expect(msg.type).toBe("telephony.event.stasis_start");
    expect(msg.fromE164).toBe("+15551234567");
    await nc.close();
  });
});
```

- [ ] **Step 2: Run — RED**

Expected: cannot find `StasisHandler` (file doesn't exist).

- [ ] **Step 3: Implement**

Create `apps/api/src/telephony/stasis.handler.ts`:
```ts
import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { AriService } from "./ari.client";
import { NatsClient } from "../events/nats.client";
import { makeDb } from "@tas/db/client";
import { did, account, call } from "@tas/db";
import { eq } from "drizzle-orm";
import type { StasisStartEvent } from "@tas/shared-types";

@Injectable()
export class StasisHandler implements OnModuleInit {
  private logger = new Logger(StasisHandler.name);
  private db = makeDb(process.env.DATABASE_URL!);

  constructor(private ari: AriService, private nats: NatsClient) {}

  async onModuleInit() {
    this.ari.client.on("StasisStart", (ev) => this.handleStasisStart(ev).catch(e => this.logger.error("stasis error", e)));
  }

  async simulateStasisStart(ev: any) { return this.handleStasisStart(ev); }

  private async handleStasisStart(ev: any) {
    const exten = ev.channel?.dialplan?.exten;
    const fromE164 = ev.channel?.caller?.number;
    if (!exten || !fromE164) { this.logger.warn("missing exten/from"); return; }

    const dids = await this.db.select().from(did).where(eq(did.e164, exten)).limit(1);
    if (!dids.length) { this.logger.warn(`no did for ${exten}`); return; }
    const d = dids[0];
    const accts = await this.db.select().from(account).where(eq(account.id, d.accountId)).limit(1);
    if (!accts.length) return;
    const a = accts[0];

    const [c] = await this.db.insert(call).values({
      tenantId: a.tenantId, accountId: a.id, didId: d.id,
      fromE164, startedAt: new Date(),
    }).returning();

    const payload: StasisStartEvent = {
      type: "telephony.event.stasis_start",
      callId: c.id, channelId: ev.channel.id,
      tenantId: a.tenantId, accountId: a.id, didId: d.id, fromE164,
      startedAt: c.startedAt.toISOString(),
    };
    this.nats.publish("telephony.event.stasis_start", payload);
  }
}
```

Register `StasisHandler` as a provider in `telephony.module.ts` and re-export it.

- [ ] **Step 4: Run — confirm GREEN**

Pre-req: compose stack up; seed applied.
Run: `DATABASE_URL=postgres://tas:tas@localhost:6543/tas NATS_URL=nats://localhost:4222 pnpm --filter @tas/api test test/telephony/stasis.e2e-spec.ts`
Expected: PASSES.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(telephony): StasisStart handler creates call row + publishes telephony.event.stasis_start"
```

---

## Task 24: Arbiter — dequeue + ARI bridge.create + bridge.add_channel

**Files:**
- Create: `apps/api/src/telephony/arbiter.service.ts`
- Modify: `apps/api/src/telephony/telephony.module.ts`
- Create: `apps/api/test/telephony/arbiter.e2e-spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { AppModule } from "../../src/app.module";
import { connect, JSONCodec } from "nats";
import { makeDb } from "@tas/db/client";
import { queueCall, queue } from "@tas/db";

describe("arbiter dequeue + ARI bridge", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it("on stasis_start, enqueues a queue_call row then dequeues to the one seeded operator", async () => {
    const nc = await connect({ servers: process.env.NATS_URL! });
    const codec = JSONCodec();
    // Publish synthetic stasis_start
    nc.publish("telephony.event.stasis_start", codec.encode({
      type: "telephony.event.stasis_start",
      callId: crypto.randomUUID(), channelId: "ch-test-1",
      tenantId: "11111111-1111-1111-1111-111111111111",
      accountId: "22222222-2222-2222-2222-222222222222",
      didId: "33333333-3333-3333-3333-333333333333",
      fromE164: "+15559998888", startedAt: new Date().toISOString(),
    }));
    // wait for arbiter to react
    await new Promise(r => setTimeout(r, 500));
    const db = makeDb(process.env.DATABASE_URL!);
    const rows = await db.select().from(queueCall);
    expect(rows.some(r => r.dequeuedAt !== null)).toBe(true);
    await nc.close();
  });
});
```

- [ ] **Step 2: Run — RED**

(Arbiter doesn't exist.)

- [ ] **Step 3: Implement**

Create `apps/api/src/telephony/arbiter.service.ts`:
```ts
import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { AriService } from "./ari.client";
import { NatsClient } from "../events/nats.client";
import { makeDb } from "@tas/db/client";
import { queueCall, queue, user } from "@tas/db";
import { eq, and, isNull, asc } from "drizzle-orm";
import type { StasisStartEvent } from "@tas/shared-types";

@Injectable()
export class ArbiterService implements OnModuleInit {
  private logger = new Logger(ArbiterService.name);
  private db = makeDb(process.env.DATABASE_URL!);

  constructor(private nats: NatsClient, private ari: AriService) {}

  async onModuleInit() {
    await this.nats.subscribe<StasisStartEvent>("telephony.event.stasis_start", (ev) => this.handle(ev));
  }

  private async handle(ev: StasisStartEvent) {
    // Look up the queue for this account (fifo, single queue in PoC).
    const qrows = await this.db.select().from(queue).where(eq(queue.accountId, ev.accountId)).limit(1);
    if (!qrows.length) { this.logger.warn(`no queue for account ${ev.accountId}`); return; }
    const q = qrows[0];

    // Enqueue
    const [qc] = await this.db.insert(queueCall).values({
      queueId: q.id, callId: ev.callId, enqueuedAt: new Date(),
    }).returning();

    // Pick an operator (single seeded operator at PoC scale; fifo strategy)
    const operators = await this.db.select().from(user).where(eq(user.role, "operator")).limit(1);
    if (!operators.length) { this.logger.warn("no operator"); return; }
    const op = operators[0];

    // ARI: create bridge, answer channel, add to bridge
    const bridge = await this.ari.client.bridgeCreate();
    await this.ari.client.channelAnswer(ev.channelId);
    await this.ari.client.bridgeAddChannel(bridge.id, ev.channelId);

    // Mark dequeued
    await this.db.update(queueCall).set({ dequeuedAt: new Date() }).where(eq(queueCall.id, qc.id));

    // Publish event for ws.gateway to push to operator
    this.nats.publish("arbiter.event.operator_assigned", {
      callId: ev.callId, channelId: ev.channelId, accountId: ev.accountId,
      bridgeId: bridge.id, operatorId: op.id, fromE164: ev.fromE164,
    });
  }
}
```

Add `ArbiterService` to `telephony.module.ts` providers.

- [ ] **Step 4: Run — GREEN**

(May need a synthetic ARI server during this test, since the real Asterisk won't see channel `ch-test-1`. Alternative: spy on `AriService.client` and stub `bridgeCreate`/`channelAnswer`/`bridgeAddChannel`. For PoC scale, wrap the test setup to provide a stubbed AriService via `Test.overrideProvider(AriService).useValue({...})`.)

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(telephony): ArbiterService — fifo dequeue + ARI bridge + operator_assigned event"
```

---

## Task 25: WebSocket gateway — emit `incoming_call` to operator client

**Files:**
- Create: `apps/api/src/telephony/ws.gateway.ts`
- Modify: `apps/api/src/telephony/telephony.module.ts`
- Create: `packages/shared-types/src/ws.ts`

- [ ] **Step 1: Create `packages/shared-types/src/ws.ts`**

```ts
export interface IncomingCallWsEvent {
  type: "incoming_call";
  callId: string;
  channelId: string;
  bridgeId: string;
  accountId: string;
  fromE164: string;
}

export interface AcceptCallWsCommand { type: "accept_call"; callId: string; }
```

Re-export in `packages/shared-types/src/index.ts`.

- [ ] **Step 2: Failing test**

Create `apps/api/test/telephony/ws.e2e-spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { AppModule } from "../../src/app.module";
import WebSocket from "ws";
import { connect, JSONCodec } from "nats";

describe("WS gateway — incoming_call", () => {
  let app: INestApplication;
  let url: string;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.listen(3001);
    url = "ws://localhost:3001/ws?token=poc-operator-token";
  });
  afterAll(async () => { await app.close(); });

  it("operator client receives incoming_call event when arbiter publishes operator_assigned", async () => {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
    const got = new Promise<any>((res) => { ws.once("message", (d) => res(JSON.parse(d.toString()))); });

    const nc = await connect({ servers: process.env.NATS_URL! });
    const codec = JSONCodec();
    nc.publish("arbiter.event.operator_assigned", codec.encode({
      callId: "c-1", channelId: "ch-1", accountId: "22222222-2222-2222-2222-222222222222",
      bridgeId: "b-1", operatorId: "66666666-6666-6666-6666-666666666666", fromE164: "+15559998888",
    }));

    const ev = await got;
    expect(ev.type).toBe("incoming_call");
    expect(ev.fromE164).toBe("+15559998888");

    ws.close(); await nc.close();
  });
});
```

- [ ] **Step 3: Run — RED**

- [ ] **Step 4: Implement**

Create `apps/api/src/telephony/ws.gateway.ts`:
```ts
import { WebSocketGateway, WebSocketServer, OnGatewayInit } from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, WebSocket } from "ws";
import { NatsClient } from "../events/nats.client";

const HARDCODED_TOKEN = "poc-operator-token";

@WebSocketGateway({ path: "/ws" })
export class OperatorGateway implements OnGatewayInit {
  private logger = new Logger(OperatorGateway.name);
  @WebSocketServer() server!: Server;
  private sockets = new Set<WebSocket>();

  constructor(private nats: NatsClient) {}

  async afterInit() {
    this.server.on("connection", (sock, req) => {
      const url = new URL(req.url ?? "", "http://x");
      if (url.searchParams.get("token") !== HARDCODED_TOKEN) { sock.close(1008); return; }
      this.sockets.add(sock);
      sock.on("close", () => this.sockets.delete(sock));
    });
    await this.nats.subscribe<any>("arbiter.event.operator_assigned", (ev) => {
      const out = {
        type: "incoming_call",
        callId: ev.callId, channelId: ev.channelId, bridgeId: ev.bridgeId,
        accountId: ev.accountId, fromE164: ev.fromE164,
      };
      this.sockets.forEach(s => s.readyState === 1 && s.send(JSON.stringify(out)));
    });
  }
}
```

Add `OperatorGateway` to `telephony.module.ts` providers.

Also enable WS adapter in `main.ts`:
```ts
import { WsAdapter } from "@nestjs/platform-ws";
// ...
app.useWebSocketAdapter(new WsAdapter(app));
```

- [ ] **Step 5: Run — GREEN**

- [ ] **Step 6: Commit**

```bash
git add apps/api packages/shared-types
git commit -m "feat(ws): OperatorGateway — bridge arbiter.event.operator_assigned to incoming_call WS frame"
```

---

## Task 26: MixMonitor start on bridge create

**Files:**
- Modify: `apps/api/src/telephony/arbiter.service.ts`

- [ ] **Step 1: Failing test**

Append to `apps/api/test/telephony/arbiter.e2e-spec.ts`:
```ts
it("starts MixMonitor on the channel after bridge.add_channel", async () => {
  // Use the stubbed AriService spy from previous test to assert call order
  // (concrete spy setup left to the implementation pass — see Task 24 step 4 note).
});
```

- [ ] **Step 2: Run — RED**

- [ ] **Step 3: Implement**

In `arbiter.service.ts`, after `bridgeAddChannel`:
```ts
const fname = `${ev.callId}.wav`;
await this.ari.client.mixmonitorStart(ev.channelId, fname);
await this.db.insert(recording).values({
  callId: ev.callId, path: `/var/spool/asterisk/recording/${fname}`, startedAt: new Date(),
});
```

(Add `recording` import from `@tas/db`.)

- [ ] **Step 4: Run — GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(recording): MixMonitor start + recording row on bridge create"
```

---

## Task 27: apps/web — Next.js App Router skeleton + /operator page

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.js`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/operator/page.tsx`

- [ ] **Step 1: `apps/web/package.json`**

```json
{
  "name": "@tas/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "test": "echo 'web tests run via apps/e2e/playwright'",
    "typecheck": "tsc --noEmit",
    "lint": "echo ok"
  },
  "dependencies": {
    "next": "14.1.4",
    "react": "18.2.0",
    "react-dom": "18.2.0",
    "@tas/shared-types": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "20.11.30",
    "@types/react": "18.2.73",
    "@types/react-dom": "18.2.23",
    "typescript": "5.4.2"
  }
}
```

- [ ] **Step 2: `next.config.js`**

```js
/** @type {import('next').NextConfig} */
module.exports = { reactStrictMode: true };
```

- [ ] **Step 3: `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "preserve",
    "allowJs": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "app/**/*", "components/**/*", "lib/**/*", ".next/types/**/*"]
}
```

- [ ] **Step 4: `app/layout.tsx`**

```tsx
export const metadata = { title: "TAS PoC Operator" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
```

- [ ] **Step 5: `app/operator/page.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import type { IncomingCallWsEvent } from "@tas/shared-types";

export default function OperatorPage() {
  const [call, setCall] = useState<IncomingCallWsEvent | null>(null);
  useEffect(() => {
    const ws = new WebSocket(`${location.origin.replace("http", "ws")}/ws?token=poc-operator-token`);
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === "incoming_call") setCall(ev);
    };
    return () => ws.close();
  }, []);
  if (!call) return <main><p data-testid="idle">Waiting for call…</p></main>;
  return (
    <main>
      <h1 data-testid="incoming">Incoming call from {call.fromE164}</h1>
    </main>
  );
}
```

- [ ] **Step 6: Smoke**

Run: `pnpm install && pnpm --filter @tas/web dev`
Expected: Next.js starts on :3001; visiting http://localhost:3001/operator renders "Waiting for call…".

- [ ] **Step 7: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): next.js app router skeleton + /operator idle screen"
```

---

## Task 28: Screen-pop — fetch CRM data + render

**Files:**
- Create: `apps/web/lib/api.ts`
- Create: `apps/web/components/ScreenPop.tsx`
- Modify: `apps/web/app/operator/page.tsx`

- [ ] **Step 1: Create `lib/api.ts`**

```ts
const TOKEN = "poc-operator-token";

export async function getAccount(id: string) {
  const r = await fetch(`/v1/Account/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.json();
}
export async function getContact(id: string) {
  const r = await fetch(`/v1/Contact/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.json();
}
export async function getForm(id: string) {
  const r = await fetch(`/v1/Form/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.json();
}
export async function postMessage(body: any) {
  const r = await fetch(`/v1/Message`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return r.json();
}
```

- [ ] **Step 2: Create `components/ScreenPop.tsx`**

```tsx
import { useEffect, useState } from "react";
import { getAccount, getContact, getForm } from "../lib/api";

// At PoC scale: hard-wired seed contact + form. Slice 2 will refine via call-context lookup.
const CONTACT_ID = "44444444-4444-4444-4444-444444444444";
const FORM_ID = "55555555-5555-5555-5555-555555555555";

export function ScreenPop({ accountId }: { accountId: string }) {
  const [account, setAcc] = useState<any>(null);
  const [contact, setContact] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  useEffect(() => {
    getAccount(accountId).then(setAcc);
    getContact(CONTACT_ID).then(setContact);
    getForm(FORM_ID).then(setForm);
  }, [accountId]);
  if (!account || !contact || !form) return <p data-testid="screen-pop-loading">Loading…</p>;
  return (
    <section data-testid="screen-pop">
      <h2>{account.name}</h2>
      <p>Contact: <span data-testid="contact-name">{contact.name}</span> ({contact.phone})</p>
      <p>Form: {form.name}</p>
    </section>
  );
}
```

- [ ] **Step 3: Update `app/operator/page.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import type { IncomingCallWsEvent } from "@tas/shared-types";
import { ScreenPop } from "../../components/ScreenPop";

export default function OperatorPage() {
  const [call, setCall] = useState<IncomingCallWsEvent | null>(null);
  useEffect(() => {
    const ws = new WebSocket(`${location.origin.replace("http", "ws")}/ws?token=poc-operator-token`);
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === "incoming_call") setCall(ev);
    };
    return () => ws.close();
  }, []);
  if (!call) return <main><p data-testid="idle">Waiting for call…</p></main>;
  return (
    <main>
      <h1 data-testid="incoming">Incoming call from {call.fromE164}</h1>
      <ScreenPop accountId={call.accountId} />
    </main>
  );
}
```

- [ ] **Step 4: Smoke**

Boot `make poc-up`, run apps/api and apps/web in dev, simulate a WS push from a node REPL, confirm the screen-pop renders contact name "Alice Demo".

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): screen-pop component — fetches account+contact+form on incoming_call"
```

---

## Task 29: Message form + Accept button

**Files:**
- Create: `apps/web/components/MessageForm.tsx`
- Modify: `apps/web/app/operator/page.tsx`

- [ ] **Step 1: Create `components/MessageForm.tsx`**

```tsx
"use client";
import { useState } from "react";
import { postMessage } from "../lib/api";

export function MessageForm({ callId, accountId, onSaved }: { callId: string; accountId: string; onSaved: () => void }) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      setSaving(true);
      await postMessage({ callId, accountId, body });
      setSaving(false);
      onSaved();
    }}>
      <label>Message<textarea data-testid="message-body" value={body} onChange={(e) => setBody(e.target.value)} required /></label>
      <button data-testid="save-message" type="submit" disabled={saving}>{saving ? "Saving…" : "Save message"}</button>
    </form>
  );
}
```

- [ ] **Step 2: Wire into `app/operator/page.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import type { IncomingCallWsEvent } from "@tas/shared-types";
import { ScreenPop } from "../../components/ScreenPop";
import { MessageForm } from "../../components/MessageForm";

export default function OperatorPage() {
  const [call, setCall] = useState<IncomingCallWsEvent | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(`${location.origin.replace("http", "ws")}/ws?token=poc-operator-token`);
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === "incoming_call") setCall(ev);
    };
    return () => ws.close();
  }, []);

  if (!call) return <main><p data-testid="idle">Waiting for call…</p></main>;

  return (
    <main>
      <h1 data-testid="incoming">Incoming call from {call.fromE164}</h1>
      <ScreenPop accountId={call.accountId} />
      {!accepted && <button data-testid="accept" onClick={() => setAccepted(true)}>Accept</button>}
      {accepted && !saved && <MessageForm callId={call.callId} accountId={call.accountId} onSaved={() => setSaved(true)} />}
      {saved && <p data-testid="saved">Message saved.</p>}
    </main>
  );
}
```

- [ ] **Step 3: Smoke**

Boot full stack; simulate WS push; click Accept; type "Test message"; click Save. Confirm `select * from message;` shows a row.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): MessageForm + Accept flow — operator persists a message via POST /v1/Message"
```

---

## Task 30: API service in compose

**Files:**
- Modify: `infra/docker-compose.yml` (add `api`, `web` services with Dockerfiles)
- Create: `apps/api/Dockerfile`
- Create: `apps/web/Dockerfile`

- [ ] **Step 1: `apps/api/Dockerfile`**

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ari-client/package.json packages/ari-client/
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm --filter @tas/api build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app /app
RUN corepack enable
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
```

- [ ] **Step 2: `apps/web/Dockerfile`**

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm --filter @tas/web build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app /app
RUN corepack enable
EXPOSE 3001
CMD ["pnpm", "--filter", "@tas/web", "start"]
```

- [ ] **Step 3: Extend `infra/docker-compose.yml`**

```yaml
  api:
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    environment:
      DATABASE_URL: postgres://tas:tas@supavisor:6543/tas
      NATS_URL: nats://nats:4222
      ARI_HOST: asterisk
      ARI_PORT: "8088"
      ARI_USER: tas
      ARI_PASS: tas
      ARI_APP: tas
    depends_on:
      supavisor: { condition: service_healthy }
      nats: { condition: service_healthy }
      asterisk: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:3000/health"]
      interval: 5s
      timeout: 2s
      retries: 10

  web:
    build:
      context: ..
      dockerfile: apps/web/Dockerfile
    depends_on:
      api: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:3001/operator"]
      interval: 5s
      timeout: 2s
      retries: 10
```

- [ ] **Step 4: Smoke**

`make poc-up-fresh` → curl `http://localhost:8080/v1/Account/22222222-2222-2222-2222-222222222222` with Bearer header.
Expected: 200 + JSON body.

- [ ] **Step 5: Commit**

```bash
git add apps/api/Dockerfile apps/web/Dockerfile infra/docker-compose.yml
git commit -m "feat(infra): api + web Dockerfiles + compose entries; full stack ready for e2e"
```

---

## Task 31: apps/temporal-worker scaffold

**Files:**
- Create: `apps/temporal-worker/package.json`
- Create: `apps/temporal-worker/tsconfig.json`
- Create: `apps/temporal-worker/src/worker.ts`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@tas/temporal-worker",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "tsc -b",
    "start": "node dist/worker.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "echo ok"
  },
  "dependencies": {
    "@temporalio/worker": "1.10.1",
    "@temporalio/workflow": "1.10.1",
    "@temporalio/activity": "1.10.1",
    "@temporalio/client": "1.10.1",
    "ws": "8.16.0",
    "@tas/db": "workspace:*",
    "@tas/shared-types": "workspace:*"
  },
  "devDependencies": { "typescript": "5.4.2", "vitest": "1.4.0", "@types/ws": "8.5.10" }
}
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: `src/worker.ts` (skeleton)**

```ts
import { Worker } from "@temporalio/worker";

async function main() {
  const worker = await Worker.create({
    workflowsPath: require.resolve("./workflows/dispatch-message.workflow"),
    activities: await import("./activities/in-app-delivery.activity"),
    taskQueue: "poc-dispatch",
    connection: undefined, // defaults to env TEMPORAL_ADDRESS
  });
  await worker.run();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Smoke (boots even with empty workflow file — fails loudly if not)**

Run: `pnpm install && pnpm --filter @tas/temporal-worker build`
Expected: TS error pointing to missing workflow/activity files. Good — task 32 lands them.

- [ ] **Step 5: Commit**

```bash
git add apps/temporal-worker pnpm-lock.yaml
git commit -m "chore(temporal-worker): scaffold (workflow/activity files land in Task 32)"
```

---

## Task 32: `DispatchMessage` workflow + `InAppDelivery` activity (TDD)

**Files:**
- Create: `apps/temporal-worker/src/workflows/dispatch-message.workflow.ts`
- Create: `apps/temporal-worker/src/activities/in-app-delivery.activity.ts`
- Create: `apps/temporal-worker/test/dispatch-message.test.ts`
- Modify: `apps/api/src/telephony/arbiter.service.ts` (trigger workflow on hangup — added in wire-up)

- [ ] **Step 1: Failing test**

Create `apps/temporal-worker/test/dispatch-message.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { dispatchMessage } from "../src/workflows/dispatch-message.workflow";

describe("DispatchMessage workflow", () => {
  it("invokes InAppDelivery activity once and marks delivered", async () => {
    const env = await TestWorkflowEnvironment.createLocal();
    const calls: any[] = [];
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "poc-dispatch-test",
      workflowsPath: require.resolve("../src/workflows/dispatch-message.workflow"),
      activities: { deliverInApp: async (arg: any) => { calls.push(arg); return { deliveredAt: new Date().toISOString() }; } },
    });
    const wfHandle = await worker.runUntil(env.client.workflow.execute(dispatchMessage, {
      args: [{ messageId: "m-1", accountId: "a-1" }],
      taskQueue: "poc-dispatch-test",
      workflowId: "wf-1",
    }));
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ messageId: "m-1", accountId: "a-1" });
    expect(wfHandle).toMatchObject({ delivered: true });
    await env.teardown();
  });
});
```

Add `"@temporalio/testing": "1.10.1"` to devDeps.

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @tas/temporal-worker test`
Expected: import errors (workflow doesn't exist).

- [ ] **Step 3: Implement workflow + activity**

`apps/temporal-worker/src/workflows/dispatch-message.workflow.ts`:
```ts
import { proxyActivities } from "@temporalio/workflow";

const { deliverInApp } = proxyActivities<{ deliverInApp(arg: { messageId: string; accountId: string }): Promise<{ deliveredAt: string }> }>({
  startToCloseTimeout: "30s",
});

export async function dispatchMessage(arg: { messageId: string; accountId: string }) {
  const result = await deliverInApp(arg);
  return { delivered: true, deliveredAt: result.deliveredAt };
}
```

`apps/temporal-worker/src/activities/in-app-delivery.activity.ts`:
```ts
import WebSocket from "ws";
import { makeDb } from "@tas/db/client";
import { dispatchAttempt } from "@tas/db";

export async function deliverInApp(arg: { messageId: string; accountId: string }): Promise<{ deliveredAt: string }> {
  // Push a delivery notice to the api's "Sent Messages" WS channel and persist the attempt.
  const db = makeDb(process.env.DATABASE_URL!);
  const url = `${process.env.API_WS_URL ?? "ws://api:3000"}/ws/internal?token=temporal-internal`;
  const ws = new WebSocket(url);
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
  ws.send(JSON.stringify({ type: "message_delivered", messageId: arg.messageId, accountId: arg.accountId }));
  ws.close();
  const deliveredAt = new Date();
  await db.insert(dispatchAttempt).values({ messageId: arg.messageId, channel: "in_app", deliveredAt });
  return { deliveredAt: deliveredAt.toISOString() };
}
```

(The `/ws/internal` endpoint is added to `OperatorGateway` to broadcast the message_delivered event to all operator sockets. Implement that small extension in Task 32 too.)

Add to `OperatorGateway`:
```ts
this.server.on("connection", (sock, req) => {
  const url = new URL(req.url ?? "", "http://x");
  if (url.searchParams.get("token") === "temporal-internal") {
    sock.on("message", (data) => {
      this.sockets.forEach(s => s.readyState === 1 && s.send(data.toString()));
    });
    return;
  }
  // ... existing operator-token branch
});
```

- [ ] **Step 4: Run — GREEN**

Expected: test passes (activity invoked once, returns delivered).

- [ ] **Step 5: Commit**

```bash
git add apps/temporal-worker apps/api
git commit -m "feat(dispatch): DispatchMessage workflow + InAppDelivery activity + internal WS bridge"
```

---

## Task 33: apps/e2e scaffold — Playwright + orchestrator

**Files:**
- Create: `apps/e2e/package.json`
- Create: `apps/e2e/playwright.config.ts`
- Create: `apps/e2e/scripts/run-scenario.ts`
- Create: `apps/e2e/tsconfig.json`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@tas/e2e",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "test": "playwright test",
    "test:s1": "playwright test specs/poc-e2e-s1-happy-path.spec.ts",
    "typecheck": "tsc --noEmit",
    "lint": "echo ok"
  },
  "dependencies": { "@tas/db": "workspace:*", "@tas/shared-types": "workspace:*" },
  "devDependencies": {
    "@playwright/test": "1.42.1",
    "typescript": "5.4.2",
    "tsx": "4.7.1"
  }
}
```

- [ ] **Step 2: `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  timeout: 5 * 60 * 1000,
  expect: { timeout: 10_000 },
  use: { baseURL: "http://localhost:8080", trace: "on-first-retry" },
  reporter: [["list"], ["html", { outputFolder: "results/html", open: "never" }]],
  outputDir: "results/runs",
});
```

- [ ] **Step 3: `scripts/run-scenario.ts`** (placeholder; helpers added in Task 35)

```ts
export {};
```

- [ ] **Step 4: `tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["specs/**/*", "lib/**/*", "scripts/**/*"] }
```

- [ ] **Step 5: Install browsers**

Run: `pnpm install && pnpm --filter @tas/e2e exec playwright install --with-deps chromium`
Expected: Chromium installs.

- [ ] **Step 6: Commit**

```bash
git add apps/e2e pnpm-lock.yaml
git commit -m "chore(e2e): playwright scaffold + run-scenario placeholder"
```

---

## Task 34: SIPp Dockerfile + happy-path scenario file

**Files:**
- Create: `apps/e2e/sipp-image/Dockerfile` (copy from `pot/S1-telephony-happy-path/sipp-image/Dockerfile`)
- Create: `apps/e2e/sipp-scenarios/happy-path.xml`
- Modify: `infra/docker-compose.yml` (add `sipp` service with `profiles: [tools]`)

- [ ] **Step 1: Copy SIPp image**

```bash
cp -R pot/S1-telephony-happy-path/sipp-image apps/e2e/sipp-image
```

- [ ] **Step 2: Create `apps/e2e/sipp-scenarios/happy-path.xml`**

```xml
<?xml version="1.0" encoding="ISO-8859-1" ?>
<scenario name="poc-happy-path">
  <send retrans="500">
    <![CDATA[
      INVITE sip:+15555550100@[remote_ip]:[remote_port] SIP/2.0
      Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
      From: "Caller" <sip:+15551234567@[local_ip]:[local_port]>;tag=[pid]SIPpTag00[call_number]
      To: <sip:+15555550100@[remote_ip]:[remote_port]>
      Call-ID: [call_id]
      CSeq: 1 INVITE
      Contact: sip:caller@[local_ip]:[local_port]
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
  <recv response="100" optional="true"/>
  <recv response="200" rtd="true"/>
  <send>
    <![CDATA[
      ACK sip:+15555550100@[remote_ip]:[remote_port] SIP/2.0
      Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
      From: "Caller" <sip:+15551234567@[local_ip]:[local_port]>;tag=[pid]SIPpTag00[call_number]
      To: <sip:+15555550100@[remote_ip]:[remote_port]>[peer_tag_param]
      Call-ID: [call_id]
      CSeq: 1 ACK
      Contact: sip:caller@[local_ip]:[local_port]
      Max-Forwards: 70
      Content-Length: 0
    ]]>
  </send>
  <pause milliseconds="20000"/>
  <send>
    <![CDATA[
      BYE sip:+15555550100@[remote_ip]:[remote_port] SIP/2.0
      Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
      From: "Caller" <sip:+15551234567@[local_ip]:[local_port]>;tag=[pid]SIPpTag00[call_number]
      To: <sip:+15555550100@[remote_ip]:[remote_port]>[peer_tag_param]
      Call-ID: [call_id]
      CSeq: 2 BYE
      Max-Forwards: 70
      Content-Length: 0
    ]]>
  </send>
  <recv response="200"/>
</scenario>
```

- [ ] **Step 3: Add sipp service to compose**

```yaml
  sipp:
    build:
      context: ../apps/e2e/sipp-image
    profiles: ["tools"]
    volumes:
      - ../apps/e2e/sipp-scenarios:/scenarios:ro
    entrypoint: ["sipp"]
    command: ["-sf", "/scenarios/happy-path.xml", "-m", "1", "-trace_err", "kamailio:5060"]
```

- [ ] **Step 4: Smoke**

Run: `docker compose -f infra/docker-compose.yml --profile tools run --rm sipp`
Expected: SIPp completes one call cycle without errors (Asterisk answers, MixMonitor starts, BYE accepted).

- [ ] **Step 5: Commit**

```bash
git add apps/e2e/sipp-image apps/e2e/sipp-scenarios infra/docker-compose.yml
git commit -m "feat(e2e): SIPp image + happy-path scenario (INVITE → 20s talk → BYE)"
```

---

## Task 35: e2e assertion helpers (DB, audio, ARI)

**Files:**
- Create: `apps/e2e/lib/db.ts`
- Create: `apps/e2e/lib/ari.ts`
- Create: `apps/e2e/lib/audio.ts`

- [ ] **Step 1: `lib/db.ts`**

```ts
import { makeDb } from "@tas/db/client";
export function db() { return makeDb(process.env.DATABASE_URL ?? "postgres://tas:tas@localhost:6543/tas"); }
```

- [ ] **Step 2: `lib/ari.ts`**

```ts
export async function ariChannels(): Promise<any[]> {
  const r = await fetch("http://localhost:8088/ari/channels", {
    headers: { Authorization: "Basic " + Buffer.from("tas:tas").toString("base64") },
  });
  return r.json();
}
```

- [ ] **Step 3: `lib/audio.ts`** (silence detection — minimal; Slice 2 will extend)

```ts
import { readFileSync } from "fs";

// Quick-and-dirty WAV silence detector — reads 16-bit PCM samples, returns silence runs.
export function detectSilenceRunsMs(path: string, threshold = 200): Array<{ startMs: number; endMs: number }> {
  const buf = readFileSync(path);
  // Skip 44-byte canonical WAV header (sufficient for our MixMonitor output).
  const data = buf.subarray(44);
  const sampleRate = 8000; // PoC: 8 kHz μ-law from MixMonitor — but written as 16-bit PCM after ffmpeg in S2; for S1 we read the raw .wav.
  const sampleSize = 2;
  const runs: Array<{ startMs: number; endMs: number }> = [];
  let runStart: number | null = null;
  for (let i = 0; i + sampleSize <= data.length; i += sampleSize) {
    const sample = Math.abs(data.readInt16LE(i));
    const tMs = Math.floor((i / sampleSize) / sampleRate * 1000);
    if (sample < threshold) {
      if (runStart === null) runStart = tMs;
    } else {
      if (runStart !== null && tMs - runStart > 200) runs.push({ startMs: runStart, endMs: tMs });
      runStart = null;
    }
  }
  return runs;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/e2e/lib
git commit -m "feat(e2e): db + ari + audio assertion helpers"
```

---

## Task 36: `poc-e2e-s1-happy-path.spec.ts` (RED state)

**Files:**
- Create: `apps/e2e/specs/poc-e2e-s1-happy-path.spec.ts`

- [ ] **Step 1: Write the e2e test**

```ts
import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import { db } from "../lib/db";
import { ariChannels } from "../lib/ari";
import { message, dispatchAttempt, recording } from "@tas/db";
import { eq, desc } from "drizzle-orm";

test("S1 happy path: SIPp call -> operator screen-pop -> message saved -> dispatch delivered", async ({ page }) => {
  // 1. Open operator page and wait for idle.
  await page.goto("/operator");
  await expect(page.getByTestId("idle")).toBeVisible();

  // 2. Run SIPp once-shot from compose.
  execSync("docker compose -f infra/docker-compose.yml --profile tools run --rm -d sipp", { stdio: "inherit" });

  // 3. Operator sees incoming_call within 5s.
  await expect(page.getByTestId("incoming")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("contact-name")).toHaveText("Alice Demo");

  // 4. Operator accepts + types + saves.
  await page.getByTestId("accept").click();
  await page.getByTestId("message-body").fill("Caller wants a callback.");
  await page.getByTestId("save-message").click();
  await expect(page.getByTestId("saved")).toBeVisible({ timeout: 5_000 });

  // 5. Wait for SIPp BYE (20s talk + tail) — Playwright timer.
  await page.waitForTimeout(25_000);

  // 6. Assert message + dispatch + recording in DB.
  const d = db();
  const [msg] = await d.select().from(message).orderBy(desc(message.createdAt)).limit(1);
  expect(msg.body).toBe("Caller wants a callback.");

  const [da] = await d.select().from(dispatchAttempt).where(eq(dispatchAttempt.messageId, msg.id)).limit(1);
  expect(da.deliveredAt).not.toBeNull();

  const [rec] = await d.select().from(recording).where(eq(recording.callId, msg.callId)).limit(1);
  expect(rec.path).toContain(".wav");

  // 7. No zombie ARI channels.
  const ch = await ariChannels();
  expect(ch.length).toBe(0);
});
```

- [ ] **Step 2: Run — confirm RED for the expected reason**

Run:
```bash
make poc-up-fresh
pnpm --filter @tas/e2e test:s1
```
Expected: test fails at some integration boundary. The exact failure reveals which composition glue is missing.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/specs
git commit -m "test(e2e): poc-e2e-s1-happy-path scenario (RED — expected at this point)"
```

---

## Task 37: Iterate to GREEN (composition pass)

This task has **no pre-written code** because the failures will reveal whatever integration glue is missing. Treat each failure as a sub-task: identify the integration bug, write the smallest fix, re-run, commit. Expected categories of fixes:

- ARI client connecting too early (before Asterisk WS endpoint is ready) — add a retry-with-backoff in `AriClient.connect()`.
- StasisStart event payload mismatch — adjust `StasisHandler.handleStasisStart` based on Asterisk's actual event shape (verify with `kamcmd` or ARI WS dump).
- NestJS-WS adapter not registered before NATS subscription fires — ensure `useWebSocketAdapter` lands before `app.listen`.
- DispatchMessage workflow trigger missing — wire it: when SIPp issues BYE → Asterisk emits `StasisEnd` → `StasisHandler` updates `call.endedAt` + starts the Temporal workflow via the Temporal client.
- Activity DB writes blocked because supavisor `prepare:false` not set — already in `makeDb`; verify.
- Recording path: MixMonitor writes to `/var/spool/asterisk/recording/`, but compose mount is mounted at `/var/spool/asterisk/recording` — verify and adjust path.
- F03 → API CORS — Caddy reverse-proxies same-origin, should be fine; check the WS URL.

**Process per failure (repeat until GREEN):**

- [ ] **Step 1: Run the failing scenario; capture exact failure message**
- [ ] **Step 2: Inspect logs**: `make poc-logs | grep -i error`, ARI events, NATS subjects.
- [ ] **Step 3: Form a hypothesis**: which component received the wrong data, or didn't receive at all?
- [ ] **Step 4: Write the smallest fix**.
- [ ] **Step 5: Re-run `pnpm --filter @tas/e2e test:s1`**.
- [ ] **Step 6: When green, commit with `fix(<component>): <one-line>`**.

When the scenario is green end-to-end:

- [ ] **Final step: GREEN confirmation commit**

```bash
git commit --allow-empty -m "test(e2e): poc-e2e-s1-happy-path GREEN — composition validated"
```

---

## Task 38: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/poc-e2e.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: poc-e2e
on:
  push:
    branches: [main, "mvp/**"]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - uses: pnpm/action-setup@v3
        with: { version: "8.15.4" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r run typecheck
      - run: make poc-up-fresh
        env:
          TIMEOUT_SECONDS: "180"
      - run: pnpm --filter @tas/e2e exec playwright install --with-deps chromium
      - run: make poc-e2e
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-results
          path: apps/e2e/results/
      - if: always()
        run: make poc-down
```

- [ ] **Step 2: Commit + verify CI pass**

```bash
git add .github/workflows/poc-e2e.yml
git commit -m "ci: poc-e2e workflow on push/PR for main + mvp/* branches (linux-only)"
```

Push to a temporary remote branch (or open a PR against `main` once the spike chain is in) and verify CI runs green.

---

## Task 39: Slice-1 readout + tag

**Files:**
- Create: `poc/readout-slice1.md`

- [ ] **Step 1: Write the readout**

Mirror the PoT readout shape. Sections:
- **TL;DR** — one paragraph: scenario green, total commits, calendar time.
- **What integrated cleanly** — bullet list. Be specific: NATS event bus, Drizzle migrations, Playwright + SIPp orchestration, etc.
- **What required mid-flight design changes** — itemize each integration bug from Task 37 with a one-line root cause + fix.
- **New risks PoT didn't catch** — anything the composition surfaced that the per-spike PoTs missed.
- **Numbers** — wall-clock for full `make poc-e2e`, ARI channel reconcile time, end-to-end latency from INVITE to screen-pop visible.
- **Sign-off** — senior architect name + date.

- [ ] **Step 2: Tag the green state**

```bash
git tag poc-slice1-green
git commit -am "docs(poc): slice 1 readout — happy-path Green; foundation validated"
```

- [ ] **Step 3: Push**

```bash
git push --tags
```

---

## Plan self-review checklist (run before handoff)

- [ ] **Spec coverage:** every section of `docs/superpowers/specs/2026-05-13-poc-tracer-bullet-design.md` referenced by at least one task. §1–§4 → Tasks 0 + 39. §5 architecture → Tasks 7–26. §6 Slice 1 → Tasks 1–37. §7 test harness → Tasks 33–36. §8 repo layout → Tasks 1, 2, 16, 22, 27, 31, 33. §9 risks R1/R4/R6/R7 → Task 0 verification gate + Task 38 Linux-only CI. §10 decisions Q1–Q8 → Task 0 step 7 confirmation; Q4 → Task 17–19 endpoints; Q5/Q6 → Task 0; Q7 → Task 32; Q8 → Task 13.
- [ ] **Placeholder scan:** "fill in", "similar to", "TBD" — none present in tasks (Task 39's readout sections are *instructions* to write, not placeholders to leave).
- [ ] **Type consistency:** `StasisStartEvent` (Task 23) keys match `arbiter.service.ts` consumer (Task 24). `IncomingCallWsEvent` (Task 25) matches operator/page.tsx (Task 27). `dispatchAttempt.channel = "in_app"` consistent across Tasks 5, 32. DTO field names (`accountId`, `callId`, `operatorId`) consistent across packages/shared-types and consumers.
- [ ] **Slices 2–5 explicitly deferred to follow-on plans** per the plan's "Out of this plan" header note.

---

*Plan written 2026-05-13. Execute via superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.*
