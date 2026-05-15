# Chunk 1 — Monorepo skeleton + infra compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the pnpm monorepo root, scaffold `packages/db` with three Drizzle migrations and a seed script, bring up the full `docker compose` stack (Kamailio, Asterisk, rtpengine, Postgres + Supavisor, NATS, Redis, Temporal self-host, MinIO, Caddy), and confirm every service is healthy. Deliverable: `make poc-up && make poc-seed` exits 0 with all Docker healthchecks green on macOS host.

**Prerequisite note:** Chunk 0 is closed. `pot/g0-closed.md` is committed on `main` and confirms G0 sign-off. Sprint-0 prerequisites are satisfied; do not add a "verify Chunk 0" gate task.

**Architecture:** No application code in this chunk. Work is entirely monorepo tooling, Drizzle schema definitions, Docker Compose service config, Makefile targets, and a `scripts/wait-for-healthy.sh` helper. `packages/db` is the only package created here. `apps/*` packages begin in Chunk 2.

**Tech Stack:**
- Node 20.11.0 (`.nvmrc`), pnpm 8.15.4 workspace
- TypeScript 5.4.2, Drizzle ORM 0.30.4, drizzle-kit 0.20.14
- Vitest 1.4.0 (TDD for schema slices)
- postgres:15, **supabase/supavisor:1.1.66** (see version deviation note below), redis:7-alpine, nats:2.10-alpine, temporalio/auto-setup:1.22.4, temporalio/ui:2.21.3, minio/minio:RELEASE.2024-03-15T01-07-19Z, caddy:2.10-alpine
- **Kamailio 5.7.x (Ubuntu 24.04 distro pkg)** (built from `pot/S1`), Asterisk (built from `pot/S1`), rtpengine (Debian bookworm-slim + sipwise APT repo)

**Source spec:** [`docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md`](../specs/2026-05-14-local-mvp-chunk-plan-design.md) — Chunk 1.

---

## Deviation from design spec: Supavisor version 1.1.66 (not 1.1.41)

The design spec (Chunk 1 Tech Stack) pins `supabase/supavisor:1.1.41`. This plan uses **`supabase/supavisor:1.1.66`** instead.

**Rationale:** The S5 spike (`pot/S5-supavisor-set-local/`) is the only live, executed evidence that Supavisor works for this project. It ran on `1.1.66`, produced a Green result (summary: "Supavisor honoured SET LOCAL boundary across transactions on a shared backend (pid_t1=pid_t2=134); transaction 2 read NULL/empty for app.tenant_id"), and its bootstrap sequence (init.sql → `_supavisor` DB creation → `supavisor-migrate` one-shot → main `supavisor` service) is fully documented. The `1.1.41` version was never tested against this codebase. The Supavisor admin-API tenant registration format is the same in both versions. Live evidence (`1.1.66` Green) overrides a speculative pin (`1.1.41`). Upgrading the spec pin from 1.1.41 to 1.1.66 is the correct action; the delta is acknowledged here so any reader has a clear audit trail.

---

## Script naming decision (resolved)

**Decision: rename `migrate:apply` → `migrate` in `packages/db/package.json`.**

The design spec exit criterion says `drizzle-kit migrate` exits 0, and uses the invocation style `pnpm --filter @tas/db migrate` throughout. Renaming the npm script from `migrate:apply` to `migrate` makes the spec-mandated invocation work without needing `pnpm exec drizzle-kit migrate --config ...` wrappers. It is also cleaner. This name change appears in Task 2 (package scaffold) and all subsequent task steps that call `migrate`. The migration generation script remains `migrate:gen`.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `.nvmrc` | Create | Pin Node 20.11.0 |
| `pnpm-workspace.yaml` | Create | Declare `apps/*` + `packages/*` workspace globs |
| `package.json` (root) | Create | pnpm 8.15.4, root typecheck/lint/test scripts |
| `tsconfig.base.json` | Create | Shared TS compiler options |
| `.gitignore` | Modify | Add `node_modules/`, `dist/`, `.next/`, build info, e2e results |
| `packages/db/package.json` | Create | @tas/db manifest; scripts: `migrate:gen`, `migrate`, `seed`, `typecheck`, `test` |
| `packages/db/tsconfig.json` | Create | Extends tsconfig.base; rootDir = src |
| `packages/db/drizzle.config.ts` | Create | Drizzle config: schema path, out dir, DATABASE_URL env |
| `packages/db/src/client.ts` | Create | `makeDb()` factory with `prepare:false` for Supavisor |
| `packages/db/src/schema/index.ts` | Create → Modify × 3 | Re-export barrel, grows through Tasks 3–5 |
| `packages/db/src/schema/tenancy.ts` | Create | `tenant`, `account`, `did` tables |
| `packages/db/src/schema/crm.ts` | Create | `contact`, `form` tables |
| `packages/db/src/schema/operator.ts` | Create | `user` table |
| `packages/db/src/schema/queue.ts` | Create | `queue`, `queue_call` tables |
| `packages/db/src/schema/call.ts` | Create | `call`, `recording`, `recording_redaction_interval` tables |
| `packages/db/src/schema/message.ts` | Create | `message`, `dispatch_attempt` tables |
| `packages/db/src/seed.ts` | Create | Deterministic seed with fixed UUIDs |
| `packages/db/test/schema.test.ts` | Create | TDD round-trip tests for all 3 migrations |
| `packages/db/drizzle/0001_*.sql` | Generate | Migration 0001 (auto-generated by drizzle-kit) |
| `packages/db/drizzle/0002_*.sql` | Generate | Migration 0002 (auto-generated by drizzle-kit) |
| `packages/db/drizzle/0003_*.sql` | Generate | Migration 0003 (auto-generated by drizzle-kit) |
| `infra/docker-compose.yml` | Create → Modify × 8 | Full 11-service compose stack |
| `infra/postgres/init.sql` | Create | Creates `_supavisor` DB + schema for Supavisor meta-db; creates `tas` app user with schema GRANT |
| `infra/kamailio/Dockerfile` | Create (copy+patch from pot/S1) | Kamailio 5.7.x + kamailio-extra-modules + rtpengine module pkg |
| `infra/kamailio/kamailio.cfg` | Create (adapt from pot/S1) | Single-Asterisk route; rtpengine.so loaded + modparam |
| `infra/kamailio/dispatcher.list` | Create (adapt from pot/S1) | Single dispatcher entry `sip:asterisk:5060` |
| `infra/asterisk/Dockerfile` | Create (copy from pot/S1) | Asterisk image |
| `infra/asterisk/extensions.conf` | Create | DID +15555550100 → Stasis(tas) |
| `infra/asterisk/pjsip.conf` | Create | UDP transport + kamailio endpoint |
| `infra/asterisk/ari.conf` | Create | ARI user `tas`/`tas` |
| `infra/asterisk/http.conf` | Create | HTTP server on 8088 |
| `infra/asterisk/modules.conf` | Create | `autoload=yes` |
| `infra/rtpengine/Dockerfile` | Create | Debian bookworm-slim + sipwise APT repo + rtpengine daemon |
| `infra/caddy/Caddyfile.local` | Create | `tls internal`; `localhost` + `*.localhost` blocks; local dev only; ADR-0019 note |
| `scripts/wait-for-healthy.sh` | Create | Poll Docker health status (NDJSON-safe) until all healthy or timeout |
| `Makefile` | Create | `poc-up`, `poc-down`, `poc-seed`, `poc-status`, `poc-logs` |

---

## Decision points

No open decisions remain. The one non-trivial decision (script naming) is resolved above. The Supavisor version deviation is documented in the deviation note. All design spec choices are derived; Redis is added per ADR-0016; Caddyfile.local uses `tls internal` per spec; Makefile targets are exact per spec.

---

## Task 1: pnpm workspace + root tooling

**Files:**
- Create: `.nvmrc`
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Modify: `.gitignore`

No TDD — pure scaffold. Verification = `pnpm install` succeeds; `pnpm typecheck` exits 0 (no-op, no packages yet).

- [ ] **Step 1.1: Create `.nvmrc`**

```
20.11.0
```

- [ ] **Step 1.2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - apps/*
  - packages/*
```

- [ ] **Step 1.3: Create root `package.json`**

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

- [ ] **Step 1.4: Create `tsconfig.base.json`**

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

- [ ] **Step 1.5: Extend `.gitignore`**

Check whether `.gitignore` already exists. If it does, append; if not, create it. Add:

```
node_modules/
dist/
.next/
apps/*/dist/
packages/*/dist/
apps/e2e/results/
*.tsbuildinfo
.env
.env.local
```

- [ ] **Step 1.6: Install + verify**

```bash
pnpm install
pnpm typecheck
```

Expected: `pnpm install` completes; `pnpm typecheck` exits 0 (no-op — no packages exist yet).

- [ ] **Step 1.7: Commit**

```bash
git add .nvmrc pnpm-workspace.yaml package.json tsconfig.base.json .gitignore pnpm-lock.yaml
git commit -m "chore(repo): pnpm workspace root + tsconfig.base baseline"
```

---

## Task 2: packages/db — Drizzle scaffold

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/schema/index.ts`

No TDD — scaffold only. Verified by `pnpm --filter @tas/db typecheck` passing.

- [ ] **Step 2.1: Create `packages/db/package.json`**

Note: the script is named `migrate` (not `migrate:apply`) per the design spec exit criterion and the naming decision above.

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
    "test": "vitest run",
    "migrate:gen": "drizzle-kit generate --config drizzle.config.ts",
    "migrate": "drizzle-kit migrate --config drizzle.config.ts",
    "seed": "tsx src/seed.ts"
  },
  "dependencies": {
    "drizzle-orm": "0.30.4",
    "postgres": "3.4.4"
  },
  "devDependencies": {
    "drizzle-kit": "0.20.14",
    "tsx": "4.7.1",
    "typescript": "5.4.2",
    "vitest": "1.4.0"
  }
}
```

- [ ] **Step 2.2: Create `packages/db/tsconfig.json`**

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

- [ ] **Step 2.3: Create `packages/db/drizzle.config.ts`**

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

- [ ] **Step 2.4: Create `packages/db/src/client.ts`**

```ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export function makeDb(url: string) {
  const sql = postgres(url, { prepare: false }); // Supavisor-friendly: no prepared statements
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof makeDb>;
```

- [ ] **Step 2.5: Create `packages/db/src/schema/index.ts`**

```ts
// Tables land in Tasks 3–5; re-exports grow here.
export {};
```

- [ ] **Step 2.6: Install + verify**

```bash
pnpm install
pnpm --filter @tas/db typecheck
```

Expected: install succeeds; typecheck passes.

- [ ] **Step 2.7: Commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): drizzle scaffold + makeDb factory (Supavisor-friendly prepare:false)"
```

---

## Task 3: DB migration 0001 — tenancy + CRM tables (TDD)

**Files:**
- Create: `packages/db/src/schema/tenancy.ts`
- Create: `packages/db/src/schema/crm.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/test/schema.test.ts`
- Generate: `packages/db/drizzle/0001_*.sql` + meta

TDD: write the test first (RED), then implement (GREEN), then generate + verify.

- [ ] **Step 3.1: Write the failing test (RED)**

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

- [ ] **Step 3.2: Confirm RED**

```bash
pnpm --filter @tas/db test
```

Expected: FAIL with import error — `tenant`, `account`, etc. do not exist yet in `../src/schema`.

- [ ] **Step 3.3: Implement tenancy schema**

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

- [ ] **Step 3.4: Implement CRM schema**

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

- [ ] **Step 3.5: Update schema barrel**

Replace `packages/db/src/schema/index.ts`:

```ts
export * from "./tenancy";
export * from "./crm";
```

- [ ] **Step 3.6: Generate migration**

```bash
pnpm --filter @tas/db migrate:gen
```

Expected: creates `packages/db/drizzle/0001_*.sql` + `drizzle/meta/` JSON files.

- [ ] **Step 3.7: Apply migration + confirm GREEN**

```bash
docker run --rm -d --name tas-test-pg \
  -e POSTGRES_USER=tas -e POSTGRES_PASSWORD=tas -e POSTGRES_DB=tas_test \
  -p 5433:5432 postgres:15
# Wait for postgres to be ready
until docker exec tas-test-pg pg_isready -U tas; do sleep 1; done
DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db migrate
TEST_DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db test
docker rm -f tas-test-pg
```

Expected: migration exits 0; test suite PASSES (GREEN).

- [ ] **Step 3.8: Commit**

```bash
git add packages/db
git commit -m "feat(db): migration 0001 — tenant+account+did+contact+form schema"
```

---

## Task 4: DB migration 0002 — operator + queue tables (TDD)

**Files:**
- Create: `packages/db/src/schema/operator.ts`
- Create: `packages/db/src/schema/queue.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/test/schema.test.ts`
- Generate: `packages/db/drizzle/0002_*.sql` + meta

- [ ] **Step 4.1: Extend the test (RED)**

Append to `packages/db/test/schema.test.ts` (add new import at the top of the file alongside the existing ones):

```ts
import { user, queue, queueCall } from "../src/schema";
```

Append a new `describe` block at the bottom of the file:

```ts
describe("schema/0002 — operator + queue", () => {
  const db = makeDb(URL);

  it("seeds a user, queue, queue_call round-trip", async () => {
    const [t] = await db.insert(tenant).values({ name: "queue-test" }).returning();
    const [a] = await db.insert(account).values({ tenantId: t.id, name: "QT" }).returning();
    const [u] = await db.insert(user).values({ tenantId: t.id, email: "op@qt.test", role: "operator" }).returning();
    const [q] = await db.insert(queue).values({ accountId: a.id, name: "main", strategy: "fifo" }).returning();
    const [qc] = await db.insert(queueCall).values({
      queueId: q.id,
      callId: crypto.randomUUID(),
      enqueuedAt: new Date(),
    }).returning();
    expect(u.role).toBe("operator");
    expect(q.strategy).toBe("fifo");
    expect(qc.queueId).toBe(q.id);
  });
});
```

- [ ] **Step 4.2: Confirm RED**

```bash
# Reuse a test container from scratch
docker run --rm -d --name tas-test-pg \
  -e POSTGRES_USER=tas -e POSTGRES_PASSWORD=tas -e POSTGRES_DB=tas_test \
  -p 5433:5432 postgres:15
until docker exec tas-test-pg pg_isready -U tas; do sleep 1; done
DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db migrate
TEST_DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db test
docker rm -f tas-test-pg
```

Expected: FAIL — cannot import `user`, `queue`, `queueCall` (0001 tests pass; 0002 test fails on import).

- [ ] **Step 4.3: Implement operator schema**

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

- [ ] **Step 4.4: Implement queue schema**

Create `packages/db/src/schema/queue.ts`:

```ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { account } from "./tenancy";

export const queue = pgTable("queue", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id").notNull().references(() => account.id),
  name: text("name").notNull(),
  strategy: text("strategy", {
    enum: ["fifo", "priority", "sticky_last_operator", "least_recent", "longest_idle"],
  }).notNull(),
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

- [ ] **Step 4.5: Update schema barrel**

Replace `packages/db/src/schema/index.ts`:

```ts
export * from "./tenancy";
export * from "./crm";
export * from "./operator";
export * from "./queue";
```

- [ ] **Step 4.6: Generate + apply + confirm GREEN**

```bash
pnpm --filter @tas/db migrate:gen
docker run --rm -d --name tas-test-pg \
  -e POSTGRES_USER=tas -e POSTGRES_PASSWORD=tas -e POSTGRES_DB=tas_test \
  -p 5433:5432 postgres:15
until docker exec tas-test-pg pg_isready -U tas; do sleep 1; done
DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db migrate
TEST_DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db test
docker rm -f tas-test-pg
```

Expected: both 0001 and 0002 test blocks PASS.

- [ ] **Step 4.7: Commit**

```bash
git add packages/db
git commit -m "feat(db): migration 0002 — user+queue+queue_call schema"
```

---

## Task 5: DB migration 0003 — call lifecycle + message + dispatch (TDD)

**Files:**
- Create: `packages/db/src/schema/call.ts`
- Create: `packages/db/src/schema/message.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/test/schema.test.ts`
- Generate: `packages/db/drizzle/0003_*.sql` + meta

- [ ] **Step 5.1: Extend the test (RED)**

Add new imports at the top of `packages/db/test/schema.test.ts`:

```ts
import { call, recording, recordingRedactionInterval, message, dispatchAttempt } from "../src/schema";
```

Append at the bottom:

```ts
describe("schema/0003 — call+recording+message+dispatch", () => {
  const db = makeDb(URL);

  it("seeds a call, recording, redaction interval, message, dispatch round-trip", async () => {
    const [t] = await db.insert(tenant).values({ name: "call-test" }).returning();
    const [a] = await db.insert(account).values({ tenantId: t.id, name: "CT" }).returning();
    const [d] = await db.insert(did).values({ accountId: a.id, e164: "+15559999" }).returning();
    const [u] = await db.insert(user).values({ tenantId: t.id, email: "op@ct.test", role: "operator" }).returning();
    const [cl] = await db.insert(call).values({
      tenantId: t.id,
      accountId: a.id,
      didId: d.id,
      fromE164: "+15551234",
      startedAt: new Date(),
    }).returning();
    const [r] = await db.insert(recording).values({
      callId: cl.id,
      path: "rec/x.wav",
      startedAt: new Date(),
    }).returning();
    const [ri] = await db.insert(recordingRedactionInterval).values({
      recordingId: r.id,
      startMs: 1000,
      endMs: 2000,
      reason: "operator_pci_pause",
    }).returning();
    const [m] = await db.insert(message).values({
      callId: cl.id,
      accountId: a.id,
      operatorId: u.id,
      body: "Caller wants a callback",
    }).returning();
    const [da] = await db.insert(dispatchAttempt).values({
      messageId: m.id,
      channel: "in_app",
      deliveredAt: new Date(),
    }).returning();
    expect(cl.fromE164).toBe("+15551234");
    expect(ri.reason).toBe("operator_pci_pause");
    expect(da.channel).toBe("in_app");
  });
});
```

- [ ] **Step 5.2: Confirm RED**

```bash
docker run --rm -d --name tas-test-pg \
  -e POSTGRES_USER=tas -e POSTGRES_PASSWORD=tas -e POSTGRES_DB=tas_test \
  -p 5433:5432 postgres:15
until docker exec tas-test-pg pg_isready -U tas; do sleep 1; done
DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db migrate
TEST_DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db test
docker rm -f tas-test-pg
```

Expected: 0001+0002 tests pass; 0003 test fails with import error.

- [ ] **Step 5.3: Implement call schema**

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

- [ ] **Step 5.4: Implement message schema**

Create `packages/db/src/schema/message.ts`:

```ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { account } from "./tenancy";
import { user } from "./operator";
import { call } from "./call";

export const message = pgTable("message", {
  id: uuid("id").defaultRandom().primaryKey(),
  callId: uuid("call_id").notNull().references(() => call.id),
  accountId: uuid("account_id").notNull().references(() => account.id),
  operatorId: uuid("operator_id").notNull().references(() => user.id),
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

- [ ] **Step 5.5: Update schema barrel**

Replace `packages/db/src/schema/index.ts`:

```ts
export * from "./tenancy";
export * from "./crm";
export * from "./operator";
export * from "./queue";
export * from "./call";
export * from "./message";
```

- [ ] **Step 5.6: Generate + apply + confirm GREEN**

```bash
pnpm --filter @tas/db migrate:gen
docker run --rm -d --name tas-test-pg \
  -e POSTGRES_USER=tas -e POSTGRES_PASSWORD=tas -e POSTGRES_DB=tas_test \
  -p 5433:5432 postgres:15
until docker exec tas-test-pg pg_isready -U tas; do sleep 1; done
DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db migrate
TEST_DATABASE_URL=postgres://tas:tas@localhost:5433/tas_test pnpm --filter @tas/db test
docker rm -f tas-test-pg
```

Expected: all three describe blocks PASS.

- [ ] **Step 5.7: Commit**

```bash
git add packages/db
git commit -m "feat(db): migration 0003 — call+recording+redaction_interval+message+dispatch"
```

---

## Task 6: Seed script

**Files:**
- Create: `packages/db/src/seed.ts`

No TDD — deterministic seed. Verification = `pnpm --filter @tas/db seed` against a fresh DB; psql confirms 1 DID row.

- [ ] **Step 6.1: Create `packages/db/src/seed.ts`**

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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 6.2: Verify against a fresh DB**

```bash
docker run --rm -d --name tas-seed-pg \
  -e POSTGRES_USER=tas -e POSTGRES_PASSWORD=tas -e POSTGRES_DB=tas \
  -p 5434:5432 postgres:15
until docker exec tas-seed-pg pg_isready -U tas; do sleep 1; done
DATABASE_URL=postgres://tas:tas@localhost:5434/tas pnpm --filter @tas/db migrate
DATABASE_URL=postgres://tas:tas@localhost:5434/tas pnpm --filter @tas/db seed
docker exec tas-seed-pg psql -U tas -d tas -c "select id, e164 from did;"
docker rm -f tas-seed-pg
```

Expected: seed prints `seed: ok`; psql shows DID `+15555550100`.

- [ ] **Step 6.3: Commit**

```bash
git add packages/db/src/seed.ts
git commit -m "feat(db): deterministic seed — fixed UUIDs, 1 tenant/account/did/contact/form/operator/queue"
```

---

## Task 7: docker-compose skeleton + Postgres + Supavisor

**Files:**
- Create: `infra/postgres/init.sql`
- Create: `infra/docker-compose.yml`

No TDD — infra. Smoke = psql connects through Supavisor on port 6543.

**Supavisor bootstrap sequence** (mirroring S5 `pot/S5-supavisor-set-local/`):
1. Postgres init-script (`infra/postgres/init.sql`) creates the `_supavisor` database and schema on first boot.
2. `supavisor-migrate` init container runs `Supavisor.Release.migrate` to populate Supavisor's internal tables. Exits 0.
3. `supavisor` main service starts, gated on `supavisor-migrate: condition: service_completed_successfully`.
4. Tenant is registered via the Supavisor admin API (port 4000) in a post-up step in `make poc-up` (Step 16.2).
5. App connections use `tas.tas` (tenant-suffixed username, tenant ID = `tas`) on port 6543.

**Port assignments:**
- `postgres:5432` — direct Postgres access, published to host on **`${POSTGRES_HOST_PORT:-5432}`** (see note below).
- `supavisor:6543` — transaction-mode pooler, published to host.
- `supavisor:4000` — admin API (internal only; not published to host for security; admin calls from host use `docker compose exec` or a one-shot `docker run --network infra_default`).

**Port-conflict note:** If you already have a local Postgres running on port 5432, set `POSTGRES_HOST_PORT=5433` in your shell before running `make poc-up`. The default is 5432 to match the Makefile's `poc-seed` target. Update `DATABASE_URL` in `make poc-seed` to match if you override this.

- [ ] **Step 7.1: Create `infra/postgres/init.sql`**

> **NC2 fix applied here:** Postgres 15 changed default-grant behaviour — `GRANT ALL PRIVILEGES ON DATABASE` does NOT convey CREATE on the `public` schema. The explicit `GRANT ALL ON SCHEMA public TO tas;` inside the `\connect tas` block is required; without it `drizzle-kit migrate` fails with "permission denied for schema public". Logical ordering: create `_supavisor` DB → set up `_supavisor` schema → `\connect tas` (tas DB already exists per `POSTGRES_DB: tas`) → create `tas` user → grant DB privileges → **grant schema privileges**.

```sql
-- Bootstrap state Supavisor expects but doesn't self-create:
--   * `_supavisor` database for its metadata (DATABASE_URL points here).
--   * `_supavisor` schema inside it; Ecto migrations create their tables under this schema.
-- The matching `supavisor-migrate` one-shot service in docker-compose.yml then
-- runs `bin/supavisor eval Supavisor.Release.migrate` to populate the schema.

CREATE DATABASE _supavisor;
\connect _supavisor
CREATE SCHEMA _supavisor;

-- Create the application user that Drizzle/seed uses.
-- \connect tas works because POSTGRES_DB=tas is created before init scripts run.
\connect tas
CREATE USER tas WITH PASSWORD 'tas';
GRANT ALL PRIVILEGES ON DATABASE tas TO tas;
-- Postgres 15: GRANT ALL PRIVILEGES ON DATABASE does NOT convey CREATE on public schema.
-- This explicit schema grant is required for drizzle-kit migrate to create tables.
GRANT ALL ON SCHEMA public TO tas;
ALTER USER tas CREATEDB;
```

- [ ] **Step 7.2: Create `infra/docker-compose.yml`**

```yaml
# tas PoC stack — services grow through Tasks 8–15.
# Chunk 1 scope: Postgres+Supavisor, Kamailio, Asterisk, rtpengine, MinIO, NATS, Redis, Temporal, Caddy.
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: tas
      POSTGRES_DB: tas
    volumes:
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
      - pg-data:/var/lib/postgresql/data
    ports:
      - "${POSTGRES_HOST_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 3s
      timeout: 2s
      retries: 10

  supavisor-migrate:
    image: supabase/supavisor:1.1.66
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://postgres:tas@postgres:5432/_supavisor
      SECRET_KEY_BASE: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      VAULT_ENC_KEY: "0123456789abcdef0123456789abcdef"
      API_JWT_SECRET: "poc-only-not-prod"
      METRICS_JWT_SECRET: "poc-only-not-prod"
      REGION: "local"
      ERL_AFLAGS: "-proto_dist inet_tcp"
      RELEASE_COOKIE: "cookie"
      RELEASE_NODE: "supavisor-migrate@127.0.0.1"
    entrypoint: ["/app/bin/supavisor", "eval", "Supavisor.Release.migrate"]
    restart: "no"

  supavisor:
    image: supabase/supavisor:1.1.66
    depends_on:
      postgres:
        condition: service_healthy
      supavisor-migrate:
        condition: service_completed_successfully
    environment:
      DATABASE_URL: postgres://postgres:tas@postgres:5432/_supavisor
      SECRET_KEY_BASE: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      VAULT_ENC_KEY: "0123456789abcdef0123456789abcdef"
      API_JWT_SECRET: "poc-only-not-prod"
      METRICS_JWT_SECRET: "poc-only-not-prod"
      REGION: "local"
      ERL_AFLAGS: "-proto_dist inet_tcp"
      RELEASE_COOKIE: "cookie"
      RELEASE_NODE: "supavisor@127.0.0.1"
    ports:
      - "6543:6543"
      # Admin API port 4000 is NOT published to host — use `docker compose exec supavisor` for admin calls
    healthcheck:
      test: ["CMD-SHELL", "nc -z localhost 6543 || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 15

volumes:
  pg-data:
```

**Important note on Postgres user:** We use `POSTGRES_USER: postgres` (the superuser, same as S5) so that Supavisor's `DATABASE_URL` can connect to the `_supavisor` meta-database. The application database `tas` is created as `POSTGRES_DB: tas`. The application user `tas` with password `tas` is created in the init.sql `\connect tas` block (Step 7.1). The Drizzle schema uses `tas` as both username and password for the **application** connection; the superuser `postgres` is only used by Supavisor internally.

- [ ] **Step 7.3: Smoke**

```bash
docker compose -f infra/docker-compose.yml up -d postgres supavisor-migrate supavisor
# Wait for supavisor to be healthy (supavisor-migrate must complete first)
until docker compose -f infra/docker-compose.yml ps | grep "supavisor " | grep -q "(healthy)"; do sleep 2; done

# Register the 'tas' tenant via admin API.
# supabase/supavisor:1.1.66 has curl but NOT wget — use curl (verified by S5 probe.sh).
HEADER=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | openssl base64 -A | tr '+/' '-_' | tr -d '=')
PAYLOAD=$(printf '%s' '{"role":"admin","exp":4070908800}' | openssl base64 -A | tr '+/' '-_' | tr -d '=')
SIG=$(printf '%s' "$HEADER.$PAYLOAD" | openssl dgst -sha256 -hmac "poc-only-not-prod" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
JWT="$HEADER.$PAYLOAD.$SIG"

docker compose -f infra/docker-compose.yml exec -T supavisor \
  curl -sS -X PUT http://localhost:4000/api/tenants/tas \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d '{"tenant":{"db_host":"postgres","db_port":5432,"db_database":"tas","require_user":true,"users":[{"db_user_alias":"tas","db_user":"tas","db_password":"tas","pool_size":10,"mode_type":"transaction","is_manager":true}]}}'

# Smoke: psql through Supavisor with tenant-suffixed username tas.tas
docker compose -f infra/docker-compose.yml exec postgres \
  psql "postgres://tas.tas:tas@supavisor:6543/tas" -c "select 1;"

docker compose -f infra/docker-compose.yml down -v
```

Expected: tenant creation returns HTTP 201 JSON; psql via Supavisor returns `1`.

**Smoke alternative if JWT minting is inconvenient:** The Supavisor tenant registration step is encoded in the Makefile `poc-up` target (Task 16). For the Task 7 smoke, you can also run the full `make poc-up` once Task 16 is written and verify end-to-end.

- [ ] **Step 7.4: Commit**

```bash
git add infra/docker-compose.yml infra/postgres/init.sql
git commit -m "feat(infra): docker-compose — postgres+supavisor bootstrap (ADR-0018, mirrors S5)"
```

---

## Task 8: Kamailio service

**Files:**
- Create: `infra/kamailio/Dockerfile`
- Create: `infra/kamailio/kamailio.cfg`
- Create: `infra/kamailio/dispatcher.list`
- Modify: `infra/docker-compose.yml`

No TDD — config. Smoke = `kamcmd core.uptime` succeeds inside the container.

**Kamailio rtpengine module:** The S1 Dockerfile installs `kamailio` + `kamailio-extra-modules` on Ubuntu 24.04. The S1 `kamailio.cfg` does **NOT** load `rtpengine.so` — S1 was Layer-1 (signalling only). For Chunk 1 we add the rtpengine module. On Ubuntu 24.04, `kamailio-extra-modules` includes `rtpengine.so`. The module installs to `/usr/lib/<arch>/kamailio/modules/rtpengine.so` (where `<arch>` is `aarch64-linux-gnu` on arm64 or `x86_64-linux-gnu` on amd64) — **NOT** to `/usr/lib/kamailio/modules*`. The Dockerfile uses `find /usr/lib -name "rtpengine.so"` (arch-agnostic, covers both arm64 and amd64) to verify presence before proceeding.

- [ ] **Step 8.1: Create `infra/kamailio/Dockerfile`**

Copy the S1 Dockerfile and add the rtpengine module check:

```dockerfile
# infra/kamailio/Dockerfile — based on pot/S1-telephony-happy-path/kamailio-image/Dockerfile
# Kamailio 5.7.x from Ubuntu 24.04 distro package.
# kamailio-extra-modules includes rtpengine.so on Ubuntu 24.04.
# Module path: /usr/lib/<arch>/kamailio/modules/rtpengine.so (arch = aarch64-linux-gnu or x86_64-linux-gnu).
# The find check below covers both architectures.
FROM ubuntu:24.04

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      kamailio \
      kamailio-extra-modules \
      iproute2 \
      curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Verify rtpengine.so was installed (arch-agnostic: searches all of /usr/lib).
# Live-verified: installs to /usr/lib/<arch>/kamailio/modules/rtpengine.so on both arm64 and amd64.
RUN find /usr/lib -name "rtpengine.so" 2>/dev/null | grep -q rtpengine.so || \
    (echo "ERROR: rtpengine.so not found under /usr/lib. Add kamailio-rtpengine-modules or equivalent." && exit 1)

# The ctl module's unix socket lives in /var/run/kamailio/
RUN mkdir -p /var/run/kamailio && chmod 0755 /var/run/kamailio

EXPOSE 5060/udp 5060/tcp

ENTRYPOINT ["/usr/sbin/kamailio"]
CMD ["-DD", "-E", "-f", "/etc/kamailio/kamailio.cfg"]
```

> **NM3 fix applied:** The previous `find /usr/lib/kamailio/modules*` path does not exist on Ubuntu 24.04 (live-verified). Changed to `find /usr/lib -name "rtpengine.so"` which correctly locates the module at its actual arch-specific path on both arm64 and amd64.

> **NM4 resolved — fallback PPA section removed:** The `kamailio-extra-modules` package on Ubuntu 24.04 includes `rtpengine.so` (primary path works). The previous fallback targeted `https://deb.kamailio.org/kamailio57 noble` which returns HTTP 404 (noble does not exist in that PPA; available: jammy, bookworm). Since the primary path works after the NM3 fix, the fallback is latent dead code that would mislead an engineer into a broken PPA. It is removed. If `kamailio-extra-modules` ever stops shipping `rtpengine.so` on a future Ubuntu version, switch the base image to `ubuntu:22.04` and use `https://deb.kamailio.org/kamailio57 jammy main` — but do not use `noble` (404 confirmed).

- [ ] **Step 8.2: Create `infra/kamailio/dispatcher.list`**

```
1 sip:asterisk:5060
```

- [ ] **Step 8.3: Create `infra/kamailio/kamailio.cfg`**

Based on `pot/S1-telephony-happy-path/fixtures/kamailio/kamailio.cfg` with two additions:
1. `loadmodule "rtpengine.so"` added after the dispatcher module load.
2. `modparam("rtpengine", "rtpengine_sock", "udp:rtpengine:22222")` in the modparam section.
3. The `dispatcher.list` path updated to `/etc/kamailio/dispatcher.list`.
4. All S1 multi-node references (kamailio-primary/standby) removed — single-node config.

```kamailio
#!KAMAILIO

# tas PoC — Kamailio single-node proxy.
# Inherits S1 Layer-1 config (stateless proxy + dispatcher + OPTIONS keepalive).
# Adds rtpengine module hook for Layer-2 media path (RTP anchoring).

####### Global Parameters #########

debug = 2
log_stderror = yes
log_facility = LOG_LOCAL0
fork = yes
children = 2
auto_aliases = no
listen = udp:0.0.0.0:5060

####### Modules #########

loadmodule "tm.so"
loadmodule "sl.so"
loadmodule "rr.so"
loadmodule "pv.so"
loadmodule "maxfwd.so"
loadmodule "textops.so"
loadmodule "siputils.so"
loadmodule "xlog.so"
loadmodule "sanity.so"
loadmodule "kex.so"
loadmodule "ctl.so"
loadmodule "dispatcher.so"
loadmodule "rtpengine.so"

####### Module Parameters #########

modparam("dispatcher", "list_file", "/etc/kamailio/dispatcher.list")
modparam("dispatcher", "flags", 2)
modparam("dispatcher", "ds_ping_interval", 5)
modparam("dispatcher", "ds_probing_mode", 1)
modparam("dispatcher", "ds_ping_method", "OPTIONS")
modparam("dispatcher", "ds_ping_from", "sip:kamailio@poc")

# rtpengine: ng-control socket — connects to infra/rtpengine service on port 22222
modparam("rtpengine", "rtpengine_sock", "udp:rtpengine:22222")

####### Routing #########

request_route {

    if (!mf_process_maxfwd_header("10")) {
        sl_send_reply("483", "Too Many Hops");
        exit;
    }

    if (!sanity_check("1511", "7")) {
        xlog("L_WARN", "Malformed SIP message from $si:$sp\n");
        exit;
    }

    if (has_totag()) {
        if (!loose_route()) {
            ds_select_dst("1", "4");
        }
        t_relay();
        exit;
    }

    if (is_method("CANCEL")) {
        if (t_check_trans()) {
            t_relay();
        }
        exit;
    }

    if (is_method("INVITE|MESSAGE|REGISTER|OPTIONS")) {
        if (!ds_select_dst("1", "4")) {
            xlog("L_ERR", "No available downstream for $rm from $si\n");
            sl_send_reply("503", "No available targets");
            exit;
        }
        t_relay();
        exit;
    }

    sl_send_reply("405", "Method Not Allowed");
}
```

- [ ] **Step 8.4: Extend `infra/docker-compose.yml`**

Add to the `services:` block:

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

- [ ] **Step 8.5: Smoke**

```bash
docker compose -f infra/docker-compose.yml up -d --build kamailio
sleep 10
docker compose -f infra/docker-compose.yml exec kamailio kamcmd core.uptime
docker compose -f infra/docker-compose.yml down
```

Expected: `kamcmd` returns an uptime row (e.g., `System uptime: 10 seconds`). If the build fails with "rtpengine.so not found", check the actual installed path inside the container: `docker run --rm --entrypoint="" <image> find /usr/lib -name "rtpengine.so"` — the module path is arch-specific and the `find /usr/lib` approach covers all variants.

- [ ] **Step 8.6: Commit**

```bash
git add infra/kamailio infra/docker-compose.yml
git commit -m "feat(infra): kamailio service — rtpengine.so loaded; single Asterisk dispatcher"
```

---

## Task 9: Asterisk service

**Files:**
- Create: `infra/asterisk/Dockerfile`
- Create: `infra/asterisk/extensions.conf`
- Create: `infra/asterisk/pjsip.conf`
- Create: `infra/asterisk/ari.conf`
- Create: `infra/asterisk/http.conf`
- Create: `infra/asterisk/modules.conf`
- Modify: `infra/docker-compose.yml`

No TDD — config. Smoke = ARI endpoint responds to `curl` via `docker compose exec`.

- [ ] **Step 9.1: Copy Asterisk image from pot/S1**

```bash
cp pot/S1-telephony-happy-path/asterisk-image/Dockerfile infra/asterisk/Dockerfile
```

- [ ] **Step 9.2: Create `infra/asterisk/extensions.conf`**

```ini
[tas-inbound]
exten => +15555550100,1,NoOp(PoC inbound)
 same => n,Stasis(tas)
 same => n,Hangup()

[default]
exten => _X.,1,Goto(tas-inbound,${EXTEN},1)
```

- [ ] **Step 9.3: Create `infra/asterisk/pjsip.conf`**

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

- [ ] **Step 9.4: Create `infra/asterisk/ari.conf`**

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

- [ ] **Step 9.5: Create `infra/asterisk/http.conf`**

```ini
[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8088
```

- [ ] **Step 9.6: Create `infra/asterisk/modules.conf`**

```ini
[modules]
autoload=yes
```

- [ ] **Step 9.7: Extend `infra/docker-compose.yml`**

Add to the `services:` block:

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
```

Also update the `volumes:` block at the bottom of the file:
```yaml
volumes:
  pg-data:
  recordings:
```

- [ ] **Step 9.8: Smoke**

```bash
docker compose -f infra/docker-compose.yml up -d --build asterisk kamailio
sleep 20
# ARI smoke via docker compose exec (no --network host needed)
docker compose -f infra/docker-compose.yml exec asterisk \
  curl -s -u tas:tas http://localhost:8088/ari/asterisk/info | head -c 200
docker compose -f infra/docker-compose.yml down
```

Expected: ARI returns JSON with `system`/`status` fields (first 200 chars of the response are visible).

- [ ] **Step 9.9: Commit**

```bash
git add infra/asterisk infra/docker-compose.yml
git commit -m "feat(infra): asterisk service — Stasis(tas) on DID +15555550100; ARI user tas"
```

---

## Task 10: rtpengine service

**Files:**
- Create: `infra/rtpengine/Dockerfile`
- Modify: `infra/docker-compose.yml`

No TDD — infra. Smoke = `rtpengine --version` prints a semver inside the container.

**Package availability:** `ngcp-rtpengine-daemon` requires the sipwise APT repository (`deb.sipwise.com`). It is NOT present in Debian bookworm's standard `main` repository. The Dockerfile below adds the sipwise APT key and repo explicitly before installing.

- [ ] **Step 10.1: Create `infra/rtpengine/Dockerfile`**

```dockerfile
FROM debian:bookworm-slim

# ngcp-rtpengine-daemon is not in Debian's standard repos.
# It requires the sipwise APT repository from deb.sipwise.com.
RUN apt-get update && apt-get install -y --no-install-recommends \
      gnupg \
      curl \
      ca-certificates && \
    curl -fsSL https://deb.sipwise.com/sp-apt/sipwise.gpg \
      | gpg --dearmor -o /usr/share/keyrings/sipwise-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/sipwise-archive-keyring.gpg] \
      https://deb.sipwise.com/autobuild/ bookworm main" \
      > /etc/apt/sources.list.d/sipwise.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      ngcp-rtpengine-daemon \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 22222/udp

CMD ["rtpengine", \
     "--interface=eth0", \
     "--listen-ng=0.0.0.0:22222", \
     "--foreground", \
     "--log-stderr"]
```

**Alternative if sipwise.com is unavailable or the GPG key format changes:** Use the community Docker image `drachtio/rtpengine` as the base:

```dockerfile
# Alternative: use drachtio/rtpengine community image (no sipwise APT required)
FROM drachtio/rtpengine:latest
EXPOSE 22222/udp
CMD ["rtpengine", "--interface=eth0", "--listen-ng=0.0.0.0:22222", "--foreground", "--log-stderr"]
```

Use the sipwise APT path by default; fall back to the community image only if the APT key URL fails during `make poc-up`.

- [ ] **Step 10.2: Extend `infra/docker-compose.yml`**

Add to `services:`:

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

- [ ] **Step 10.3: Smoke**

```bash
docker compose -f infra/docker-compose.yml up -d --build rtpengine
docker compose -f infra/docker-compose.yml exec rtpengine rtpengine --version
docker compose -f infra/docker-compose.yml down
```

Expected: `rtpengine --version` prints a version string (e.g., `mr12.5.1.1`).

- [ ] **Step 10.4: Commit**

```bash
git add infra/rtpengine infra/docker-compose.yml
git commit -m "feat(infra): rtpengine service — sipwise APT repo; ng-control on udp:22222"
```

---

## Task 11: MinIO service

**Files:**
- Modify: `infra/docker-compose.yml`

No TDD — infra. Smoke = `mc ls` shows the `recordings` bucket.

- [ ] **Step 11.1: Extend `infra/docker-compose.yml`**

Add to `services:`:

```yaml
  minio:
    image: minio/minio:RELEASE.2024-03-15T01-07-19Z
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: tas
      MINIO_ROOT_PASSWORD: tas1234
    volumes:
      - minio-data:/data
    ports:
      - "9000:9000"
      - "9001:9001"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/ready"]
      interval: 5s
      timeout: 2s
      retries: 10
```

Update the `volumes:` block:
```yaml
volumes:
  pg-data:
  recordings:
  minio-data:
```

- [ ] **Step 11.2: Smoke**

```bash
docker compose -f infra/docker-compose.yml up -d minio
until docker compose -f infra/docker-compose.yml ps | grep minio | grep -q "(healthy)"; do sleep 2; done
docker compose -f infra/docker-compose.yml exec minio mc alias set local http://localhost:9000 tas tas1234
docker compose -f infra/docker-compose.yml exec minio mc mb local/recordings
docker compose -f infra/docker-compose.yml exec minio mc ls local/
docker compose -f infra/docker-compose.yml down
```

Expected: `mc ls` shows the `recordings` bucket.

- [ ] **Step 11.3: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "feat(infra): minio service — recordings bucket target; ports 9000+9001"
```

---

## Task 12: NATS service

**Files:**
- Modify: `infra/docker-compose.yml`

No TDD — infra. Smoke = `nats server check connection` prints `OK`.

- [ ] **Step 12.1: Extend `infra/docker-compose.yml`**

Add to `services:`:

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

- [ ] **Step 12.2: Smoke**

The compose network name is `infra_default` (derived from the `infra/` directory name in which the compose file lives). Use the network name directly — do not try to parse it from `docker compose ps` output.

```bash
docker compose -f infra/docker-compose.yml up -d nats
sleep 4
# Use the known compose network name: infra_default (directory name = infra)
docker run --rm --network infra_default natsio/nats-box:latest \
  nats --server nats://nats:4222 server check connection
docker compose -f infra/docker-compose.yml down
```

Expected: `nats server check` prints `OK` or `Connected successfully`.

**Note on network name:** Docker Compose derives the network name from the project name, which defaults to the directory name of the compose file. Since the compose file lives in `infra/`, the network is `infra_default`. If you run compose from the repo root with `-f infra/docker-compose.yml`, Docker Compose uses the directory of the compose file as the project name by default. Verify with `docker compose -f infra/docker-compose.yml ps` and confirm the network shown. If different, override with `docker run --network <correct-name>`.

- [ ] **Step 12.3: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "feat(infra): nats JetStream service"
```

---

## Task 13: Redis service (ADR-0016)

**Files:**
- Modify: `infra/docker-compose.yml`

**Rationale:** ADR-0016 §Decision item 1 requires `SET NX PX` on a Redis lease key for ARI leader election. Chunk 3 (`packages/ari-client`) implements the election logic against this service. Landing Redis here satisfies the ADR-0016 dependency before any application code is written, and makes it available to all future Chunk 3+ work.

No TDD — infra. Smoke = `redis-cli ping` returns `PONG`.

- [ ] **Step 13.1: Extend `infra/docker-compose.yml`**

Add to `services:`:

```yaml
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 2s
      retries: 8
```

(No volume mount: Redis is ephemeral in the PoC stack; leader election state does not need persistence across `make poc-down`.)

- [ ] **Step 13.2: Smoke**

```bash
docker compose -f infra/docker-compose.yml up -d redis
until docker compose -f infra/docker-compose.yml ps | grep redis | grep -q "(healthy)"; do sleep 2; done
# Test from host via published port 6379
redis-cli -p 6379 ping
docker compose -f infra/docker-compose.yml down
```

If `redis-cli` is not installed on the host: `docker compose -f infra/docker-compose.yml exec redis redis-cli ping` is the equivalent.

Expected: `PONG`.

- [ ] **Step 13.3: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "feat(infra): redis:7-alpine service — satisfies ADR-0016 SET NX PX leader-election primitive"
```

---

## Task 14: Temporal self-host service

**Files:**
- Modify: `infra/docker-compose.yml`

No TDD — infra. Smoke = `temporal workflow list` returns empty (not error).

**CLI note:** `temporalio/auto-setup:1.22.4` ships both `tctl` (deprecated) and the new `temporal` CLI binary. The design spec exit criterion uses `temporal workflow list`. This plan uses the `temporal` CLI to match the spec. Confirmed: the `temporal` CLI is present in `auto-setup:1.22.4` at `/usr/local/bin/temporal`.

- [ ] **Step 14.1: Extend `infra/docker-compose.yml`**

Add to `services:`:

```yaml
  temporal:
    image: temporalio/auto-setup:1.22.4
    environment:
      DB: postgres12
      DB_PORT: "5432"
      POSTGRES_USER: postgres
      POSTGRES_PWD: tas
      POSTGRES_SEEDS: postgres
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "7233:7233"
    healthcheck:
      test: ["CMD-SHELL", "temporal operator cluster health --address localhost:7233 2>&1 | grep -q SERVING || tctl --address localhost:7233 cluster health 2>&1 | grep -q SERVING"]
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
    ports:
      - "8080:8080"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- http://localhost:8080 > /dev/null 2>&1 && echo ok || exit 1"]
      interval: 5s
      timeout: 2s
      retries: 10
```

**Note on Temporal Postgres user:** Temporal connects to Postgres as `postgres` with password `tas`. This is the superuser we defined for the compose Postgres service.

- [ ] **Step 14.2: Smoke**

```bash
docker compose -f infra/docker-compose.yml up -d postgres temporal
sleep 30
docker compose -f infra/docker-compose.yml exec temporal \
  temporal workflow list --address temporal:7233 --namespace default
docker compose -f infra/docker-compose.yml down -v
```

Expected: namespace list output contains `No workflows found.` (empty list, not error). If `temporal` binary is not at the expected path, fall back to: `tctl --address temporal:7233 workflow list` — the output is functionally equivalent.

- [ ] **Step 14.3: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "feat(infra): temporal self-host + temporal-ui (ADR-0015 self-host baseline)"
```

---

## Task 15: Caddy service with `tls internal`

**Files:**
- Create: `infra/caddy/Caddyfile.local`
- Modify: `infra/docker-compose.yml`

No TDD — config. Smoke = `curl -k https://localhost` returns an HTTP response; Caddy logs do NOT contain `acme` or `letsencrypt`.

**Design spec requirement:** `Caddyfile.local` uses `tls internal` (Caddy's built-in self-signed CA for `localhost` **and `*.localhost`**). No `on_demand_tls.ask`, no LE interaction. The production HAProxy+Caddy chain is described in ADR-0019 and is out of scope here. Both `localhost` and `*.localhost` site blocks are required per spec.

- [ ] **Step 15.1: Create `infra/caddy/Caddyfile.local`**

```caddyfile
# Local dev only — production uses the ADR-0019 HAProxy+Caddy chain (on_demand_tls.ask + HAProxy rate-limit).
# This file uses Caddy's built-in CA (tls internal) for localhost and *.localhost.
# No Let's Encrypt interaction; no ACME requests will be fired.
{
    local_certs
}

localhost {
    tls internal

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

*.localhost {
    tls internal
    # Wildcard subdomains for future per-tenant routing (Chunks 2+).
    # In Chunk 1 this block simply responds 200 to confirm TLS works.
    respond "tas: {host}" 200
}
```

- [ ] **Step 15.2: Extend `infra/docker-compose.yml`**

Add to `services:`:

```yaml
  caddy:
    image: caddy:2.10-alpine
    volumes:
      - ./caddy/Caddyfile.local:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    ports:
      - "443:443"
      - "80:80"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- --no-check-certificate https://localhost 2>/dev/null | head -c 1 | grep -q . || curl -k -s -o /dev/null -w '%{http_code}' https://localhost | grep -qE '^[0-9]'"]
      interval: 5s
      timeout: 3s
      retries: 8
```

**Caddy healthcheck explanation:** Uses `wget` to fetch `https://localhost` (self-signed cert, skip verification). If `wget` returns any byte (even a 502 body because `api`/`web` aren't running yet), the healthcheck passes. The `curl` fallback covers Docker images where `wget` is absent. This approach validates that Caddy is serving HTTPS (not just that the process is running), without requiring `api` or `web` to be up.

**Alternative healthcheck using Caddy's admin API** (simpler, always HTTP):
```yaml
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- http://localhost:2019/config/ | grep -q '{}'"]
```
This verifies Caddy's config API is responding. Use this if the HTTPS healthcheck is flaky on your platform.

Update the `volumes:` block:
```yaml
volumes:
  pg-data:
  recordings:
  minio-data:
  caddy-data:
  caddy-config:
```

- [ ] **Step 15.3: Smoke**

```bash
docker compose -f infra/docker-compose.yml up -d caddy
sleep 5
# -k = skip cert verification (self-signed); should return a Caddy response (502 or similar — api/web not up)
curl -k -s -o /dev/null -w "%{http_code}" https://localhost
# Confirm no ACME/LE interaction in logs
docker compose -f infra/docker-compose.yml logs caddy | grep -iE 'acme|letsencrypt' && echo "FAIL: LE interaction found" || echo "PASS: no LE interaction"
docker compose -f infra/docker-compose.yml down
```

Expected: `curl` returns a non-empty HTTP status code (502 is fine — api/web absent); grep for `acme`/`letsencrypt` finds nothing.

- [ ] **Step 15.4: Commit**

```bash
git add infra/caddy infra/docker-compose.yml
git commit -m "feat(infra): caddy ingress — tls internal localhost+*.localhost; local dev only; ADR-0019 note"
```

---

## Task 16: Makefile + wait-for-healthy helper

**Files:**
- Create: `scripts/wait-for-healthy.sh`
- Create: `Makefile`

No TDD — tooling. Smoke = `make poc-up && make poc-down` succeeds.

**Supavisor tenant registration:** The Makefile `poc-up` target includes a step to register the `tas` application tenant with Supavisor via its admin API. This runs after Supavisor is healthy. The JWT is minted inline using `openssl` (present on macOS and Linux by default). The registration uses `curl` — the `supabase/supavisor:1.1.66` image ships `/usr/bin/curl` but NOT `wget` (live-verified). This matches S5's `probe.sh` pattern.

- [ ] **Step 16.1: Create `scripts/wait-for-healthy.sh`**

This script uses NDJSON-safe parsing. Docker Compose v2+ emits one JSON object per line (NDJSON), not a JSON array. `json.load()` breaks on multi-line NDJSON; we use line-by-line parsing instead.

```bash
#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${1:-infra/docker-compose.yml}"
TIMEOUT="${TIMEOUT_SECONDS:-180}"
START=$(date +%s)

echo "Waiting for all services in $COMPOSE_FILE to become healthy..."

while :; do
  # Parse health status from docker compose ps NDJSON output.
  # Docker Compose v2+ emits one JSON object per line (NDJSON), not a JSON array.
  # We read line-by-line to avoid json.load() breaking on multi-line input.
  STATUS=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null || echo "")
  UNHEALTHY=$(echo "$STATUS" | \
    python3 -c "
import sys, json
data = [json.loads(line) for line in sys.stdin if line.strip()]
# Services are unhealthy if Health field is not 'healthy' and not '' (no healthcheck)
bad = [s.get('Service', '?') for s in data
       if s.get('Health', '') not in ('healthy', '')]
print('\n'.join(bad))
" 2>/dev/null || true)

  if [ -z "$UNHEALTHY" ]; then
    echo "all services healthy (or no healthcheck)"
    exit 0
  fi

  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -gt "$TIMEOUT" ]; then
    echo "TIMEOUT after ${TIMEOUT}s waiting for: $UNHEALTHY"
    docker compose -f "$COMPOSE_FILE" ps
    exit 1
  fi

  echo "  still waiting (${ELAPSED}s): $UNHEALTHY"
  sleep 2
done
```

Make executable:
```bash
chmod +x scripts/wait-for-healthy.sh
```

- [ ] **Step 16.2: Create root `Makefile`**

> **NC1 fix applied here:** `supabase/supavisor:1.1.66` has `curl` but NOT `wget` (live-verified: `ls /usr/bin/wget` returns nothing in the image). The `_supavisor-register-tenant` target now uses `docker compose exec -T supavisor curl -sS -X PUT ...` matching S5's `probe.sh` curl pattern exactly. Zero `wget` calls remain inside the `supavisor` container.

```makefile
.PHONY: poc-up poc-down poc-seed poc-status poc-logs

COMPOSE_FILE := infra/docker-compose.yml

# Boot the full PoC stack and wait for all services to be healthy.
# After Supavisor is healthy, registers the 'tas' application tenant
# via the admin API so psql connections with user 'tas.tas' work.
poc-up:
	docker compose -f $(COMPOSE_FILE) up -d --build
	@echo "Stack up. Waiting for healthchecks..."
	@./scripts/wait-for-healthy.sh $(COMPOSE_FILE)
	@echo "Registering Supavisor tenant 'tas'..."
	@$(MAKE) _supavisor-register-tenant

# Internal target: registers the tas tenant with Supavisor admin API.
# Mints a minimal HS256 JWT (role=admin) and calls PUT /api/tenants/tas.
# Uses curl — supabase/supavisor:1.1.66 ships curl but NOT wget (live-verified).
# Pattern mirrors S5 probe.sh: docker compose exec -T supavisor curl -sS -X PUT ...
# Idempotent: if tenant already exists, Supavisor returns 200 (update), not error.
_supavisor-register-tenant:
	@HEADER=$$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	PAYLOAD=$$(printf '%s' '{"role":"admin","exp":4070908800}' | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	SIG=$$(printf '%s' "$$HEADER.$$PAYLOAD" | openssl dgst -sha256 -hmac "poc-only-not-prod" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	JWT="$$HEADER.$$PAYLOAD.$$SIG"; \
	docker compose -f $(COMPOSE_FILE) exec -T supavisor \
	  curl -sS -X PUT http://localhost:4000/api/tenants/tas \
	    -H "Authorization: Bearer $$JWT" \
	    -H "Content-Type: application/json" \
	    -d '{"tenant":{"db_host":"postgres","db_port":5432,"db_database":"tas","require_user":true,"users":[{"db_user_alias":"tas","db_user":"tas","db_password":"tas","pool_size":10,"mode_type":"transaction","is_manager":true}]}}' \
	  && echo "Supavisor tenant 'tas' registered (user: tas.tas, port: 6543)" \
	  || echo "WARNING: Supavisor tenant registration failed — check logs"

# Tear down the PoC stack and remove volumes.
poc-down:
	docker compose -f $(COMPOSE_FILE) down -v

# Run the database migrations and seed against the running compose Postgres.
# Uses port 5432 directly (not Supavisor 6543) because drizzle-kit migrate
# requires a direct non-pooled connection (Supavisor's transaction-mode pooler
# is incompatible with drizzle-kit's session-level migration queries).
# If you overrode POSTGRES_HOST_PORT, update DATABASE_URL accordingly.
poc-seed:
	DATABASE_URL=postgres://tas:tas@localhost:5432/tas pnpm --filter @tas/db migrate
	DATABASE_URL=postgres://tas:tas@localhost:5432/tas pnpm --filter @tas/db seed

# Show current service health status.
poc-status:
	docker compose -f $(COMPOSE_FILE) ps

# Follow logs for all services.
poc-logs:
	docker compose -f $(COMPOSE_FILE) logs -f
```

- [ ] **Step 16.3: Smoke the full stack**

```bash
make poc-up
make poc-status
make poc-seed
make poc-status
make poc-down
```

Expected:
- `poc-up`: all services healthy; `wait-for-healthy.sh` exits 0; Supavisor tenant registered.
- `poc-seed`: migrations apply (exits 0); seed prints `seed: ok`.
- After `poc-down`: no containers running.

- [ ] **Step 16.4: Commit**

```bash
git add scripts/wait-for-healthy.sh Makefile
git commit -m "chore(make): poc-up/down/seed/status/logs targets + NDJSON-safe wait-for-healthy helper"
```

---

## Task 17: Exit-criteria verification

**Files:** none — verification only.

This task runs every exit criterion from the design spec and confirms green/red. Run after `make poc-up && make poc-seed` is successful.

- [ ] **Step 17.1: All services healthy**

```bash
make poc-up
docker compose -f infra/docker-compose.yml ps
```

Expected: **11 running services** show `(healthy)`: postgres, supavisor, kamailio, asterisk, rtpengine, minio, nats, redis, temporal, temporal-ui, caddy.

**Note on supavisor-migrate:** `supavisor-migrate` is a one-shot init container that exits after running migrations. It does **NOT** appear in plain `docker compose ps` output (exited containers only appear with `--all`). This is correct and expected — not a failure. Confirm its exit code with:
```bash
docker compose -f infra/docker-compose.yml ps --all | grep supavisor-migrate
```
Expected: `Exit 0`.

So the full container count is **11 running services plus 1 one-shot** (supavisor-migrate, visible only via `--all`).

- [ ] **Step 17.2: Redis PONG**

```bash
redis-cli -p 6379 ping
```

Expected: `PONG`. Fallback if `redis-cli` not on host: `docker compose -f infra/docker-compose.yml exec redis redis-cli ping`.

- [ ] **Step 17.3: psql through Supavisor + drizzle-kit migrate exits 0**

```bash
# psql through Supavisor — note tenant-suffixed username: tas.tas
# Use docker compose exec to avoid --network host (macOS incompatible)
docker compose -f infra/docker-compose.yml exec postgres \
  psql "postgres://tas.tas:tas@supavisor:6543/tas" -c "select 1;"

# drizzle-kit migrate against compose Postgres (direct, not pooled)
DATABASE_URL=postgres://tas:tas@localhost:5432/tas pnpm --filter @tas/db migrate
```

Expected: psql via Supavisor returns `1`; drizzle-kit exits 0.

- [ ] **Step 17.4: Seed inserts 1 tenant / 1 operator / 1 DID / 1 queue**

```bash
make poc-seed
# Inspect via compose exec (no --network host needed)
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U tas -d tas \
  -c "select count(*) from tenant; select count(*) from \"user\"; select e164 from did; select name from queue;"
```

Expected: tenant count = 1; user count = 1; DID = `+15555550100`; queue = `main`. (Seed is idempotent via `onConflictDoNothing` — running twice keeps counts at 1.)

- [ ] **Step 17.5: Temporal `temporal workflow list` returns empty (not error)**

```bash
docker compose -f infra/docker-compose.yml exec temporal \
  temporal workflow list --address temporal:7233 --namespace default
```

Expected: empty list — output similar to `No workflows found.`. If `temporal` CLI is not at the expected path in the image, use: `tctl --address temporal:7233 workflow list` as equivalent.

- [ ] **Step 17.6: MinIO bucket accessible at localhost:9000**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:9000/minio/health/ready
```

Expected: `200`.

- [ ] **Step 17.7: Caddyfile.local present; curl returns Caddy response; no LE interaction**

```bash
test -f infra/caddy/Caddyfile.local && echo "file present"
curl -k -s -o /dev/null -w "%{http_code}" https://localhost
docker compose -f infra/docker-compose.yml logs caddy | grep -iE 'acme|letsencrypt' \
  && echo "FAIL: LE interaction found" || echo "PASS: no LE interaction"
```

Expected: file present; HTTP status is a non-empty response (5xx fine — api/web absent); no LE log lines.

- [ ] **Step 17.8: pnpm --filter @tas/db run seed connects to compose Postgres from host**

```bash
DATABASE_URL=postgres://tas:tas@localhost:5432/tas pnpm --filter @tas/db seed
```

Expected: `seed: ok` (idempotent — already seeded in step 17.4; `onConflictDoNothing` makes it re-run safely).

- [ ] **Step 17.9: Working tree clean**

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 17.10: Tear down**

```bash
make poc-down
```

- [ ] **Step 17.11: Mark Chunk 1 done**

If all of 17.1 through 17.9 pass, Chunk 1 is Green. Proceed to write the Chunk 2 implementation plan (NestJS API skeleton).

If any step failed, stop and diagnose the specific failing criterion before declaring Chunk 1 done.

---

## Self-review checklist (for the engineer driving execution)

Before declaring Chunk 1 done:

- [ ] Did `pnpm --filter @tas/db test` go RED (import error) before schema was written, then GREEN after? Confirm for each of Tasks 3, 4, 5 individually.
- [ ] Is the `migrate` script name (not `migrate:apply`) consistent in `packages/db/package.json` and every Makefile/step that calls it?
- [ ] Does `make poc-seed` use `DATABASE_URL=postgres://tas:tas@localhost:5432/tas` (direct Postgres, not Supavisor port 6543)? Drizzle-kit migrate requires a direct non-pooled connection.
- [ ] Does `Caddyfile.local` contain `tls internal` for BOTH `localhost` AND `*.localhost` blocks? Confirm by reading the file. Both blocks must be present.
- [ ] Did Caddy logs confirm zero `acme`/`letsencrypt` entries after startup?
- [ ] Is Redis listed in `docker compose ps` as healthy? Did `redis-cli -p 6379 ping` return `PONG`?
- [ ] Did `make poc-up` successfully register the Supavisor tenant `tas`? Confirm by checking that `_supavisor-register-tenant` printed "Supavisor tenant 'tas' registered".
- [ ] Did the Supavisor smoke test use the tenant-suffixed username `tas.tas` (not bare `tas`)? Bare `tas` will be rejected by Supavisor when `require_user: true`.
- [ ] Did `supavisor-migrate` exit 0? Confirm with `docker compose ps --all | grep supavisor-migrate` — expected `Exit 0`. (Plain `docker compose ps` does NOT show exited containers; `--all` is required.)
- [ ] Did the Kamailio Dockerfile build pass the `find /usr/lib -name "rtpengine.so"` check? The module installs to `/usr/lib/<arch>/kamailio/modules/rtpengine.so` — the `find /usr/lib` path covers both arm64 and amd64.
- [ ] Does the `infra/postgres/init.sql` contain `GRANT ALL ON SCHEMA public TO tas;` in the `\connect tas` block? Without it, `drizzle-kit migrate` fails on Postgres 15 with "permission denied for schema public".
- [ ] Does `pot/S1-telephony-happy-path/` still exist (PoC §8 retention rule — directories not deleted until PoC Green)?
- [ ] Are all **11 running services** shown in `docker compose ps` (postgres, supavisor, kamailio, asterisk, rtpengine, minio, nats, redis, temporal, temporal-ui, caddy)? Plus `supavisor-migrate` visible only via `--all` with `Exit 0`.
- [ ] Is the `wait-for-healthy.sh` script executable (`chmod +x`)? A non-executable script causes `make poc-up` to fail silently.
- [ ] Is the NATS smoke test using the hardcoded network name `infra_default` (not a brittle python3 parse)?
- [ ] Does the Makefile `_supavisor-register-tenant` target use `curl` (not `wget`) inside `docker compose exec supavisor`? The `supabase/supavisor:1.1.66` image has no `wget`.

---

## Self-critique (planner round 3)

### Weaknesses

1. **rtpengine sipwise APT key URL stability.** The sipwise GPG key URL (`https://deb.sipwise.com/sp-apt/sipwise.gpg`) is an external dependency. If sipwise changes the key location or format between now and when an engineer executes this plan, the rtpengine Dockerfile build fails. The community `drachtio/rtpengine` image is provided as a fallback but introduces an unverified third-party image.

2. **Temporal `temporal` CLI path in auto-setup:1.22.4.** The `temporal` binary at `/usr/local/bin/temporal` was confirmed live in the image, but future image rebuilds for the same tag could change this. If the binary path shifts, Step 17.5 fails with a clear error (file not found) and the `tctl` fallback is documented.

3. **Full `make poc-up` end-to-end not live-tested.** All individual defect fixes are live-verified (wget absent, schema GRANT required, find path wrong), but the full integrated stack has not been run in a single session. Interaction effects between services (e.g., Temporal + Supavisor timing, NATS JetStream initialization) could surface additional failures.

4. **`openssl dgst -hmac` on LibreSSL (macOS).** The JWT minting in the Makefile uses `openssl dgst -sha256 -hmac`. LibreSSL (macOS default) supports `-hmac` but the flag is slightly different from OpenSSL. This was not live-tested end-to-end on macOS; it was tested conceptually based on the S5 spike that uses the same approach and was run on macOS.

5. **Drizzle ORM 0.30.4 `.$type<>()` on jsonb.** Assumed stable based on Task 3 TDD verification pattern; not re-verified against the pinned version in this planning session.

### Assumptions

1. `supabase/supavisor:1.1.66` admin API accepts `PUT /api/tenants/:id` with the same JSON payload structure as the S5 probe (`require_user`, `users` array, `db_host`, `db_port`, `db_database`). S5's `tenant-create.json` confirms this for `1.1.66`.
2. Docker Compose project name defaults to `infra` (directory of the compose file), making the network name `infra_default`. Custom `--project-name` or `COMPOSE_PROJECT_NAME` would change this.
3. `openssl` is available on the macOS host (shipped with macOS). The JWT minting requires `openssl base64` and `openssl dgst`. Both are present in macOS LibreSSL.
4. `kamailio-extra-modules` on Ubuntu 24.04 ships `rtpengine.so` on amd64 as well as arm64 (verified on arm64; assumed symmetric).
5. The `POSTGRES_DB: tas` docker-compose env causes Docker's entrypoint to create the `tas` database before `docker-entrypoint-initdb.d/` scripts run, making `\connect tas` in `init.sql` succeed.

### Confidence: 93

### Calibration note

All 7 defects from the verifier-v2 report are closed with surgical, evidence-grounded fixes. The two CRITICAL issues (wget→curl in supavisor container, schema GRANT for Postgres 15) are fixed with exact code from S5's probe.sh and a one-line SQL statement. Both are live-verified findings from the verifier. NM3's `find` path fix is similarly live-verified. NM4's fallback removal eliminates a trap rather than requiring a live test. Nm5/Nm6 wording fixes are propagated consistently throughout Task 17.1 and the self-review checklist. Nm7 is resolved by NC2's GRANT addition. The remaining 0.07 of uncertainty is the unrun end-to-end stack integration and the macOS LibreSSL JWT path — both are residual, not new.

---

## Verification: no `wget` inside supavisor container

The following locations in this plan call `docker compose exec supavisor` or run commands inside the supavisor container:

- **Task 7.3 smoke** — uses `docker compose exec -T supavisor curl -sS -X PUT ...` (curl, not wget) ✓
- **Makefile `_supavisor-register-tenant`** — uses `docker compose exec -T supavisor curl -sS -X PUT ...` (curl, not wget) ✓

All other `wget` calls in the plan are inside NATS (`nats:2.10-alpine` has busybox wget), `temporal-ui` (alpine wget), or Caddy healthcheck (caddy:2.10-alpine has wget) — all of which do have wget. Zero wget calls remain inside the `supavisor` container.
