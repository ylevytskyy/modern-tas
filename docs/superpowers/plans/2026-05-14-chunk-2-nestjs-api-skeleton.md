# Chunk 2 — NestJS API skeleton + /v1 facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold `apps/api` (NestJS on port 3000), wire four `/v1` endpoints with real Drizzle queries, create `packages/shared-types` with REST DTOs + event type stubs, and achieve unit tests green in CI via testcontainers — no live compose required. Debug attach (port 9229) must also work. `packages/shared-types` is a no-TDD scaffold; all business-logic tasks follow red→green→refactor.

**Source spec:** [`docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md`](../specs/2026-05-14-local-mvp-chunk-plan-design.md) — Chunk 2.

---

## Decisions (all resolved before implementation starts)

### D1 — NestJS version

Pin **`@nestjs/core@10.3.8`** and the matching `@nestjs/common`, `@nestjs/platform-express`, `@nestjs/jwt`, `@nestjs/testing` at `10.3.8`. NestJS 10.x is the current LTS-aligned line (released 2023-03, still maintained); v11 dropped in early 2025 and the ecosystem is still catching up. v10 has first-class support in the Temporal SDK wrapper and avoids the v11 `reflect-metadata` reshuffling that breaks older decorator patterns. Exact pin, not a caret.

### D2 — JWT scheme ("hardcoded")

`apps/api` validates Bearer JWTs signed with a **static HS256 secret stored in `APP_JWT_SECRET` env var**. For local dev and unit tests, this is set to `"poc-only-not-prod"` (matching Supavisor's `API_JWT_SECRET` value in docker-compose to avoid confusion). The guard does **not** hit a database or user table. The token payload carries `{ sub: "<user-uuid>", tenantId: "<tenant-uuid>", role: "operator" | "admin" }`. Tests mint their own JWT using the same secret — no mock needed, no HTTP stub. This is "hardcoded" in the sense that there is no token-issuance endpoint and no rotation mechanism in this chunk.

For the smoke test (`curl localhost:3000/v1/Account/1`) the developer must pass a hand-minted JWT; a helper `make poc-jwt` target is added to the Makefile.

### D3 — Drizzle injection into NestJS

Create a `DatabaseModule` (global, single-instance) that provides the `Db` token using a factory `useFactory`:

```ts
// apps/api/src/database/database.module.ts
import { Global, Module } from '@nestjs/common';
import { makeDb, Db } from '@tas/db/client';

export const DB_TOKEN = 'DB';

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      useFactory: () =>
        makeDb(process.env.DATABASE_URL ?? 'postgres://tas:tas@localhost:6543/tas.tas'),
    },
  ],
  exports: [DB_TOKEN],
})
export class DatabaseModule {}
```

Controllers inject `@Inject(DB_TOKEN) private readonly db: Db`. This pattern avoids NestJS-specific Drizzle packages and keeps the factory identical to what unit tests use.

### D4 — `apps/api` dev connection: Supavisor (port 6543)

`apps/api` dev connects through Supavisor at `postgres://tas:tas@localhost:6543/tas.tas` (not direct at 5432). This matches production-path behaviour (transaction-mode pooler). The `poc-seed` Makefile target already connects direct at 5432 for migration — that stays. `apps/api` runtime never runs migrations; it only queries. Testcontainers unit tests connect direct at the ephemeral container port (no Supavisor there — irrelevant for test isolation).

### D5 — Multi-tenancy hook

The JWT payload carries `tenantId`. The `JwtAuthGuard` extracts it and attaches it to `request.user.tenantId`. Controllers receive `@Req() req` and pass `req.user.tenantId` into all Drizzle `where` clauses alongside the row's own `id`. With one seeded tenant, all queries match. Chunk 3+ can extend without changing the guard.

### D6 — S6 trigger rule (decided: NO trigger)

`/v1/Account/:id` queries the `account` table via Drizzle and returns the row. It does NOT call any external CRM service. The account row is in Postgres (seeded in Chunk 1). Unit tests insert a row via testcontainers and assert the response shape. S6 cache-scraper stub work is NOT triggered by Chunk 2; S6 remains unowned for the PoC.

### D7 — `POST /v1/Message` scope

Inserts a `message` row with `callId`, `accountId`, `operatorId`, `body` from the request body. Does NOT trigger a Temporal workflow (Chunk 4 wires that). Returns `201 { id, createdAt }`. The `callId` must reference an existing `call` row; tests insert a seeded call before inserting the message.

### D8 — Testcontainers cold-pull mitigation

`vitest.globalSetup.ts` pulls `postgres:15` (same image as compose). To warm CI: add a GH Actions step `docker pull postgres:15` before `pnpm test`. Document this in the plan's CI note. Local: first run may be slow; subsequent runs use Docker layer cache. No bespoke pre-pull infra needed for local.

### D9 — Migration in globalSetup

`vitest.globalSetup.ts` sets `DATABASE_URL` to the testcontainers connection string, then forks a child process: `tsx ../../packages/db/src/migrate.ts`. `packages/db/src/migrate.ts` reads `DATABASE_URL` from `process.env` and calls `drizzle-orm/postgres-js/migrator`'s `migrate()` function directly (confirmed by reading the source — no drizzle-kit CLI involved). The migrations folder is resolved via `__dirname` relative to `migrate.ts`, pointing at `packages/db/drizzle/`. This is the same script `make poc-seed` calls — no duplication.

---

## File map

| File | Action | Task |
|---|---|---|
| `packages/shared-types/package.json` | Create | T16 |
| `packages/shared-types/tsconfig.json` | Create | T16 |
| `packages/db/src/schema/message.ts` | Modify | T15b |
| `packages/db/drizzle/0003_*.sql` | Create | T15b |
| `packages/shared-types/src/index.ts` | Create | T16 |
| `packages/shared-types/src/rest.ts` | Create | T16 |
| `packages/shared-types/src/events.ts` | Create | T16 |
| `apps/api/package.json` | Create | T17 |
| `apps/api/tsconfig.json` | Create | T17 |
| `apps/api/src/main.ts` | Create | T17 |
| `apps/api/src/app.module.ts` | Create | T17 |
| `apps/api/src/database/database.module.ts` | Create | T17 |
| `apps/api/src/auth/jwt-auth.guard.ts` | Create | T18 |
| `apps/api/src/auth/auth.module.ts` | Create | T18 |
| `apps/api/src/auth/request-user.interface.ts` | Create | T18 |
| `apps/api/src/auth/jwt-auth.guard.spec.ts` | Create | T18 |
| `apps/api/test/vitest.globalSetup.ts` | Create | T18 |
| `apps/api/test/integration/.gitkeep` | Create | T18 |
| `apps/api/src/account/account.controller.ts` | Create | T19a |
| `apps/api/src/account/account.module.ts` | Create | T19a |
| `apps/api/src/account/account.controller.spec.ts` | Create | T19a |
| `apps/api/src/contact/contact.controller.ts` | Create | T19b |
| `apps/api/src/contact/contact.module.ts` | Create | T19b |
| `apps/api/src/contact/contact.controller.spec.ts` | Create | T19b |
| `apps/api/src/form/form.controller.ts` | Create | T19c |
| `apps/api/src/form/form.module.ts` | Create | T19c |
| `apps/api/src/form/form.controller.spec.ts` | Create | T19c |
| `apps/api/src/message/message.controller.ts` | Create | T19d |
| `apps/api/src/message/message.module.ts` | Create | T19d |
| `apps/api/src/message/message.controller.spec.ts` | Create | T19d |
| `apps/api/vitest.config.ts` | Create | T18 |
| `.vscode/launch.json` | Create | T20 |
| `Makefile` | Modify | T20 |

> **File map note:** `packages/db/drizzle/0003_*.sql` is auto-generated by drizzle-kit's CLI. The journal currently has idx 0, 1, 2; this adds idx 3. Use the existing `migrate:gen` npm script (which under the hood runs `drizzle-kit generate:pg --config drizzle.config.ts` — drizzle-kit 0.20.14 uses the `generate:pg` dialect-suffixed subcommand, NOT bare `generate`).

---

## Task 15b — Add `tenant_id` to `message` table (migration 0003)

**Why this is Chunk 2:** Chunk 1 was declared Green without this column. The column surfaces as required only when the `MessageController` wires application logic and the Chunk 3 `assert-tenant.ts` helper asserts `tenant_id` on every row. Adding it retroactively in Chunk 3 would create a dependency on an unplanned migration — cleaner to own it in the same task that wires the insertion logic.

**No TDD — this is a schema migration task; the controller TDD in T19d provides the red→green gate.**

- [ ] Modify `packages/db/src/schema/message.ts`: add `tenantId` column:

```ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { tenant } from "./tenancy";
import { account } from "./tenancy";
import { user } from "./operator";
import { call } from "./call";

export const message = pgTable("message", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
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

- [ ] Generate migration from workspace root:

```bash
pnpm --filter @tas/db migrate:gen
```

(The `migrate:gen` script in `packages/db/package.json` runs `drizzle-kit generate:pg --config drizzle.config.ts`. drizzle-kit 0.20.14 uses the dialect-suffixed `generate:pg` subcommand — bare `drizzle-kit generate` errors with `Unknown command`.)

This produces `packages/db/drizzle/0003_<name>.sql` (idx 3 in the journal). Inspect the generated SQL to confirm it contains:
```sql
ALTER TABLE "message" ADD COLUMN "tenant_id" uuid NOT NULL;
ALTER TABLE "message" ADD CONSTRAINT "message_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ...;
```

> **Seed note:** `packages/db/src/seed.ts` does not insert any `message` rows — no seed update needed.

- [ ] Run `pnpm --filter @tas/db typecheck` → exits 0 after the schema change.

---

## Task 16 — `packages/shared-types` scaffold (no TDD — pure type declarations)

**Purpose:** Shared REST DTO types and event type stubs used by `apps/api` (Chunk 2) and `apps/web` (Chunk 4). No runtime code.

- [ ] Create `packages/shared-types/package.json`:

```json
{
  "name": "@tas/shared-types",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "5.4.2"
  }
}
```

- [ ] Create `packages/shared-types/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] Create `packages/shared-types/src/rest.ts`:

```ts
// REST DTOs — shape matches the /v1 wire format the CRM compatibility constraint requires.
// All timestamps are ISO-8601 strings (JSON serialized from Date).

export interface AccountDto {
  id: string;
  tenantId: string;
  name: string;
  createdAt: string;
}

export interface ContactDto {
  id: string;
  accountId: string;
  name: string;
  phone: string | null;
  createdAt: string;
}

export interface FormField {
  name: string;
  label: string;
  type: string;
}

export interface FormDto {
  id: string;
  accountId: string;
  name: string;
  schema: { fields: FormField[] };
  createdAt: string;
}

export interface CreateMessageDto {
  callId: string;
  accountId: string;
  operatorId: string;
  body: string;
}

export interface MessageCreatedDto {
  id: string;
  createdAt: string;
}
```

- [ ] Create `packages/shared-types/src/events.ts`:

```ts
// NATS subject and WS event type stubs.
// No client wiring in Chunk 2; these are type-only placeholders.
// Chunk 3 imports these subjects — add new subjects here rather than inline in apps/api.

/** NATS subjects */
export const NatsSubjects = {
  MESSAGE_CREATED: 'tas.message.created',
  CALL_STARTED: 'tas.call.started',
  CALL_ENDED: 'tas.call.ended',
  /** Published by Asterisk ARI StasisStart handler (Chunk 3). */
  STASIS_START: 'tas.stasis.start',
  /** Published by Asterisk ARI StasisEnd handler (Chunk 3). */
  STASIS_END: 'tas.stasis.end',
} as const;

/** WS event names (sent to F03 operator UI) */
export const WsEvents = {
  CALL_SCREEN_POP: 'call.screenpop',
  MESSAGE_SENT: 'message.sent',
} as const;

export interface NatsMessageCreatedPayload {
  messageId: string;
  callId: string;
  accountId: string;
  tenantId: string;
}

/**
 * Payload published to NatsSubjects.STASIS_START when an ARI StasisStart event fires.
 * Spec: docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md lines 107, 113–114.
 * Chunk 3 publishes this; Chunk 5 asserts against it.
 */
export interface NatsStasisStartPayload {
  callId: string;
  /** ARI channel ID (used by Chunk 3 to control the channel). */
  channel: string;
  tenantId: string;
  accountId: string;
}
```

- [ ] Create `packages/shared-types/src/index.ts`:

```ts
export * from './rest';
export * from './events';
```

- [ ] Run `pnpm --filter @tas/shared-types typecheck` → exits 0.

---

## Task 17 — `apps/api` NestJS scaffold (no TDD — pure wiring, no logic)

**Purpose:** Install NestJS, create the module tree, start the HTTP server. No business logic yet.

- [ ] Create `apps/api/package.json`:

```json
{
  "name": "@tas/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx --inspect=0.0.0.0:9229 src/main.ts",
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --config vitest.config.ts"
  },
  "dependencies": {
    "@tas/db": "workspace:*",
    "@tas/shared-types": "workspace:*",
    "@nestjs/common": "10.3.8",
    "@nestjs/core": "10.3.8",
    "@nestjs/jwt": "10.2.0",
    "@nestjs/platform-express": "10.3.8",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "10.3.8",
    "@testcontainers/postgresql": "10.9.0",
    "@types/express": "4.17.21",
    "@types/jsonwebtoken": "9.0.5",
    "@types/node": "^24",
    "jsonwebtoken": "9.0.2",
    "testcontainers": "10.9.0",
    "tsx": "4.7.1",
    "typescript": "5.4.2",
    "vitest": "1.4.0"
  }
}
```

> **Version rationale:** `@nestjs/jwt@10.2.0` is the latest stable for NestJS 10.x; `reflect-metadata@0.2.2` is the version NestJS 10 requires; `testcontainers@10.9.0` + `@testcontainers/postgresql@10.9.0` are the matching minor; `rxjs@7.8.1` is NestJS 10's peer dep.

- [ ] Create `apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true
  },
  "include": ["src", "test"]
}
```

- [ ] Create `apps/api/src/database/database.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { makeDb } from '@tas/db/client';
import type { Db } from '@tas/db/client';

export const DB_TOKEN = 'DB';

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      useFactory: (): Db =>
        makeDb(
          process.env.DATABASE_URL ??
            'postgres://tas:tas@localhost:6543/tas.tas',
        ),
    },
  ],
  exports: [DB_TOKEN],
})
export class DatabaseModule {}
```

- [ ] Create `apps/api/src/app.module.ts` (placeholder; will grow in T19):

```ts
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [DatabaseModule],
})
export class AppModule {}
```

- [ ] Create `apps/api/src/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  await app.listen(process.env.PORT ?? 3000);
  console.log(`API listening on port ${process.env.PORT ?? 3000}`);
}

bootstrap();
```

- [ ] Run `pnpm install` from workspace root to hoist deps.
- [ ] Run `pnpm --filter @tas/api typecheck` → exits 0 (only main.ts + app.module.ts at this point).

---

## Task 18 — JWT guard + testcontainers globalSetup (TDD: red→green)

**Failing test (RED):** Write the guard spec first; it must fail because the guard file doesn't exist yet.

- [ ] Create `apps/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    globalSetup: './test/vitest.globalSetup.ts',
    include: ['src/**/*.spec.ts'],
    alias: {
      '@tas/db/client': resolve(__dirname, '../../packages/db/src/client.ts'),
      '@tas/db': resolve(__dirname, '../../packages/db/src/schema/index.ts'),
      '@tas/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
    },
  },
});
```

- [ ] Create `apps/api/test/vitest.globalSetup.ts`:

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
  // Point drizzle-kit at the testcontainers instance and run migrations.
  const migrateScript = path.resolve(
    __dirname,
    '../../../packages/db/src/migrate.ts',
  );
  execSync(`tsx ${migrateScript}`, {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}

export async function teardown() {
  await container?.stop();
}
```

- [ ] Create `apps/api/src/auth/request-user.interface.ts`:

```ts
export interface RequestUser {
  sub: string;       // user UUID
  tenantId: string;  // tenant UUID
  role: 'operator' | 'admin' | 'supervisor';
}
```

- [ ] Scaffold the integration test directory (Chunk 3 adds tests here):

```bash
mkdir -p apps/api/test/integration
touch apps/api/test/integration/.gitkeep
```

- [ ] Write the RED test at `apps/api/src/auth/jwt-auth.guard.spec.ts` before creating the guard:

```ts
// RED: fails because jwt-auth.guard.ts does not exist yet.
import { describe, it, expect, beforeAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import jwt from 'jsonwebtoken';

const SECRET = 'poc-only-not-prod';

function makeContext(token: string | undefined): ExecutionContext {
  const req = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    user: undefined as unknown,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: SECRET, signOptions: { expiresIn: '1h' } })],
      providers: [JwtAuthGuard],
    }).compile();
    guard = module.get(JwtAuthGuard);
  });

  it('passes a valid token and attaches user to request', async () => {
    const payload = {
      sub: '66666666-6666-6666-6666-666666666666',
      tenantId: '11111111-1111-1111-1111-111111111111',
      role: 'operator',
    };
    const token = jwt.sign(payload, SECRET);
    const ctx = makeContext(token);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(ctx.switchToHttp().getRequest().user).toMatchObject(payload);
  });

  it('rejects a missing token', async () => {
    const ctx = makeContext(undefined);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed with a wrong secret', async () => {
    const token = jwt.sign({ sub: 'x', tenantId: 'y', role: 'operator' }, 'wrong-secret');
    const ctx = makeContext(token);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] Run `pnpm --filter @tas/api test` → confirm RED (module not found error for `./jwt-auth.guard`).

- [ ] Create `apps/api/src/auth/jwt-auth.guard.ts` (GREEN implementation):

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { RequestUser } from './request-user.interface';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string>; user: RequestUser }>();
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = authHeader.slice(7);
    try {
      req.user = await this.jwtService.verifyAsync<RequestUser>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return true;
  }
}
```

- [ ] Create `apps/api/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.APP_JWT_SECRET ?? 'poc-only-not-prod',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
```

- [ ] Run `pnpm --filter @tas/api test` → guard spec GREEN.

---

## Task 19a — `GET /v1/Account/:id` (TDD: red→green)

**Constraint:** The controller scopes the query by both `:id` AND `tenantId` from the JWT. Returns 404 if not found.

- [ ] Write the RED test at `apps/api/src/account/account.controller.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AccountController } from './account.controller';
import { DB_TOKEN } from '../database/database.module';
import { makeDb } from '@tas/db/client';
import { account, tenant } from '@tas/db';

// DATABASE_URL is set by vitest.globalSetup.ts (testcontainers)
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';

describe('AccountController', () => {
  let controller: AccountController;
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);
    // Seed minimal data into testcontainers Postgres
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo-tenant' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Demo Account' }).onConflictDoNothing();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [{ provide: DB_TOKEN, useValue: db }],
    }).compile();

    controller = module.get(AccountController);
  });

  it('returns the account when found', async () => {
    const req = { user: { sub: 'op-id', tenantId: TENANT_ID, role: 'operator' } };
    const result = await controller.findOne(ACCOUNT_ID, req as any);
    expect(result.id).toBe(ACCOUNT_ID);
    expect(result.tenantId).toBe(TENANT_ID);
    expect(result.name).toBe('Demo Account');
    expect(typeof result.createdAt).toBe('string');
  });

  it('throws NotFoundException for a wrong tenantId', async () => {
    const req = { user: { sub: 'op-id', tenantId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', role: 'operator' } };
    await expect(controller.findOne(ACCOUNT_ID, req as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException for a non-existent id', async () => {
    const req = { user: { sub: 'op-id', tenantId: TENANT_ID, role: 'operator' } };
    await expect(controller.findOne('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', req as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] Run `pnpm --filter @tas/api test` → RED (AccountController not found).

- [ ] Create `apps/api/src/account/account.controller.ts`:

```ts
import {
  Controller,
  Get,
  Param,
  NotFoundException,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DB_TOKEN } from '../database/database.module';
import { account } from '@tas/db';
import type { Db } from '@tas/db/client';
import type { AccountDto } from '@tas/shared-types';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user.interface';

@Controller('Account')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ): Promise<AccountDto> {
    const [row] = await this.db
      .select()
      .from(account)
      .where(and(eq(account.id, id), eq(account.tenantId, req.user.tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException(`Account ${id} not found`);
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
```

- [ ] Create `apps/api/src/account/account.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AccountController],
})
export class AccountModule {}
```

- [ ] Run `pnpm --filter @tas/api test` → account spec GREEN; guard spec still GREEN.

---

## Task 19b — `GET /v1/Contact/:id` (TDD: red→green)

- [ ] Write RED test at `apps/api/src/contact/contact.controller.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ContactController } from './contact.controller';
import { DB_TOKEN } from '../database/database.module';
import { makeDb } from '@tas/db/client';
import { account, contact, tenant } from '@tas/db';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const CONTACT_ID = '44444444-4444-4444-4444-444444444444';

describe('ContactController', () => {
  let controller: ContactController;
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo-tenant' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Demo Account' }).onConflictDoNothing();
    await db.insert(contact).values({ id: CONTACT_ID, accountId: ACCOUNT_ID, name: 'Alice Demo', phone: '+15555550200' }).onConflictDoNothing();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContactController],
      providers: [{ provide: DB_TOKEN, useValue: db }],
    }).compile();

    controller = module.get(ContactController);
  });

  it('returns the contact when found', async () => {
    const req = { user: { sub: 'op-id', tenantId: TENANT_ID, role: 'operator' } };
    const result = await controller.findOne(CONTACT_ID, req as any);
    expect(result.id).toBe(CONTACT_ID);
    expect(result.name).toBe('Alice Demo');
    expect(result.phone).toBe('+15555550200');
  });

  it('throws NotFoundException for wrong tenant scope', async () => {
    const req = { user: { sub: 'op-id', tenantId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', role: 'operator' } };
    await expect(controller.findOne(CONTACT_ID, req as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] Run `pnpm --filter @tas/api test` → RED (ContactController not found).

- [ ] Create `apps/api/src/contact/contact.controller.ts`:

```ts
import {
  Controller,
  Get,
  Param,
  NotFoundException,
  UseGuards,
  Req,
  Inject,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DB_TOKEN } from '../database/database.module';
import { contact, account } from '@tas/db';
import type { Db } from '@tas/db/client';
import type { ContactDto } from '@tas/shared-types';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user.interface';

@Controller('Contact')
@UseGuards(JwtAuthGuard)
export class ContactController {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ): Promise<ContactDto> {
    // Join through account to enforce tenant scoping
    const [row] = await this.db
      .select({
        id: contact.id,
        accountId: contact.accountId,
        name: contact.name,
        phone: contact.phone,
        createdAt: contact.createdAt,
      })
      .from(contact)
      .innerJoin(account, eq(contact.accountId, account.id))
      .where(
        and(eq(contact.id, id), eq(account.tenantId, req.user.tenantId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException(`Contact ${id} not found`);
    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      phone: row.phone ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
```

- [ ] Create `apps/api/src/contact/contact.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ContactController } from './contact.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ContactController],
})
export class ContactModule {}
```

- [ ] Run `pnpm --filter @tas/api test` → contact spec GREEN; all prior GREEN.

---

## Task 19c — `GET /v1/Form/:id` (TDD: red→green)

- [ ] Write RED test at `apps/api/src/form/form.controller.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FormController } from './form.controller';
import { DB_TOKEN } from '../database/database.module';
import { makeDb } from '@tas/db/client';
import { account, form, tenant } from '@tas/db';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const FORM_ID = '55555555-5555-5555-5555-555555555555';
const FORM_SCHEMA = {
  fields: [
    { name: 'caller_name', label: 'Caller name', type: 'text' },
    { name: 'callback_phone', label: 'Callback phone', type: 'tel' },
    { name: 'message_body', label: 'Message', type: 'textarea' },
  ],
};

describe('FormController', () => {
  let controller: FormController;
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo-tenant' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Demo Account' }).onConflictDoNothing();
    await db.insert(form).values({ id: FORM_ID, accountId: ACCOUNT_ID, name: 'Default', schema: FORM_SCHEMA }).onConflictDoNothing();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FormController],
      providers: [{ provide: DB_TOKEN, useValue: db }],
    }).compile();

    controller = module.get(FormController);
  });

  it('returns the form with full schema', async () => {
    const req = { user: { sub: 'op-id', tenantId: TENANT_ID, role: 'operator' } };
    const result = await controller.findOne(FORM_ID, req as any);
    expect(result.id).toBe(FORM_ID);
    expect(result.schema.fields).toHaveLength(3);
    expect(result.schema.fields[0].name).toBe('caller_name');
  });

  it('throws NotFoundException when tenant does not match', async () => {
    const req = { user: { sub: 'op-id', tenantId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', role: 'operator' } };
    await expect(controller.findOne(FORM_ID, req as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] Run `pnpm --filter @tas/api test` → RED.

- [ ] Create `apps/api/src/form/form.controller.ts`:

```ts
import {
  Controller,
  Get,
  Param,
  NotFoundException,
  UseGuards,
  Req,
  Inject,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DB_TOKEN } from '../database/database.module';
import { form, account } from '@tas/db';
import type { Db } from '@tas/db/client';
import type { FormDto } from '@tas/shared-types';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user.interface';

@Controller('Form')
@UseGuards(JwtAuthGuard)
export class FormController {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ): Promise<FormDto> {
    const [row] = await this.db
      .select({
        id: form.id,
        accountId: form.accountId,
        name: form.name,
        schema: form.schema,
        createdAt: form.createdAt,
      })
      .from(form)
      .innerJoin(account, eq(form.accountId, account.id))
      .where(and(eq(form.id, id), eq(account.tenantId, req.user.tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException(`Form ${id} not found`);
    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      schema: row.schema,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
```

- [ ] Create `apps/api/src/form/form.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { FormController } from './form.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [FormController],
})
export class FormModule {}
```

- [ ] Run `pnpm --filter @tas/api test` → form spec GREEN; all prior GREEN.

---

## Task 19d — `POST /v1/Message` (TDD: red→green)

**Note:** `message` requires a `call_id` FK and (after T15b) a `tenant_id` FK. Tests must insert a seed `call` row first (which requires `tenant`, `account`, `did`). The controller reads `tenantId` from the JWT (`req.user.tenantId`) and writes it to the row — enforcing D5 and making the row queryable by Chunk 3/5 assert-tenant helpers. No Temporal trigger in this chunk — insert row, return 201.

- [ ] Write RED test at `apps/api/src/message/message.controller.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { MessageController } from './message.controller';
import { DB_TOKEN } from '../database/database.module';
import { makeDb } from '@tas/db/client';
import { account, tenant, did, user, call, message } from '@tas/db';
import { eq } from 'drizzle-orm';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const DID_ID = '33333333-3333-3333-3333-333333333333';
const OPERATOR_ID = '66666666-6666-6666-6666-666666666666';
const CALL_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('MessageController', () => {
  let controller: MessageController;
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);
    // Seed prerequisites
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo-tenant' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Demo Account' }).onConflictDoNothing();
    await db.insert(did).values({ id: DID_ID, accountId: ACCOUNT_ID, e164: '+15555550100' }).onConflictDoNothing();
    await db.insert(user).values({ id: OPERATOR_ID, tenantId: TENANT_ID, email: 'operator@demo.test', role: 'operator' }).onConflictDoNothing();
    await db.insert(call).values({
      id: CALL_ID,
      tenantId: TENANT_ID,
      accountId: ACCOUNT_ID,
      didId: DID_ID,
      fromE164: '+15555550200',
      startedAt: new Date(),
    }).onConflictDoNothing();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessageController],
      providers: [{ provide: DB_TOKEN, useValue: db }],
    }).compile();

    controller = module.get(MessageController);
  });

  it('creates a message and returns 201 with id + createdAt', async () => {
    const req = { user: { sub: OPERATOR_ID, tenantId: TENANT_ID, role: 'operator' } };
    const dto = { callId: CALL_ID, accountId: ACCOUNT_ID, operatorId: OPERATOR_ID, body: 'Test message' };
    const result = await controller.create(dto, req as any);
    expect(typeof result.id).toBe('string');
    expect(typeof result.createdAt).toBe('string');
    // D5 assertion: tenantId must be persisted in the row (required by Chunk 3 assert-tenant helper)
    const [row] = await db.select().from(message).where(eq(message.id, result.id));
    expect(row.tenantId).toBe(TENANT_ID);
  });
});
```

- [ ] Run `pnpm --filter @tas/api test` → RED.

- [ ] Create `apps/api/src/message/message.controller.ts`:

```ts
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Inject,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DB_TOKEN } from '../database/database.module';
import { message } from '@tas/db';
import type { Db } from '@tas/db/client';
import type { CreateMessageDto, MessageCreatedDto } from '@tas/shared-types';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user.interface';

@Controller('Message')
@UseGuards(JwtAuthGuard)
export class MessageController {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateMessageDto,
    @Req() req: Request & { user: RequestUser },
  ): Promise<MessageCreatedDto> {
    const [row] = await this.db
      .insert(message)
      .values({
        tenantId: req.user.tenantId,   // D5: scoped by JWT tenantId
        callId: dto.callId,
        accountId: dto.accountId,
        operatorId: dto.operatorId,
        body: dto.body,
      })
      .returning({ id: message.id, createdAt: message.createdAt });
    return { id: row.id, createdAt: row.createdAt.toISOString() };
  }
}
```

- [ ] Create `apps/api/src/message/message.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [MessageController],
})
export class MessageModule {}
```

- [ ] Run `pnpm --filter @tas/api test` → message spec GREEN; full suite GREEN.

---

## Task 19e — Wire modules into AppModule

- [ ] Update `apps/api/src/app.module.ts`:

```ts
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AccountModule } from './account/account.module';
import { ContactModule } from './contact/contact.module';
import { FormModule } from './form/form.module';
import { MessageModule } from './message/message.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AccountModule,
    ContactModule,
    FormModule,
    MessageModule,
  ],
})
export class AppModule {}
```

- [ ] Run `pnpm --filter @tas/api typecheck` → exits 0.
- [ ] Run `pnpm --filter @tas/api test` → full suite GREEN.

---

## Task 20 — VS Code debug config + `make poc-jwt` + smoke test

### VS Code launch config

- [ ] Create `.vscode/launch.json` (or append to existing):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Attach to API",
      "type": "node",
      "request": "attach",
      "port": 9229,
      "restart": true,
      "localRoot": "${workspaceFolder}/apps/api",
      "remoteRoot": "${workspaceFolder}/apps/api",
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

### Makefile additions

- [ ] Append to `Makefile`:

```makefile
# Start the API in debug mode (attach VS Code "Attach to API" on port 9229).
api-dev:
	DATABASE_URL=postgres://tas:tas@localhost:6543/tas.tas \
	APP_JWT_SECRET=poc-only-not-prod \
	pnpm --filter @tas/api run dev

# Mint a short-lived HS256 JWT for smoke-testing /v1 endpoints.
# Usage: make poc-jwt  — copy the printed token into Authorization: Bearer <token>
poc-jwt:
	@HEADER=$$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	PAYLOAD=$$(printf '%s' '{"sub":"66666666-6666-6666-6666-666666666666","tenantId":"11111111-1111-1111-1111-111111111111","role":"operator","exp":4070908800}' | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	SIG=$$(printf '%s' "$$HEADER.$$PAYLOAD" | openssl dgst -sha256 -hmac "poc-only-not-prod" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='); \
	echo "$$HEADER.$$PAYLOAD.$$SIG"
```

### Smoke test procedure

After `make poc-up && make poc-seed`:

```bash
# 1. Start API
make api-dev &
# 2. Mint JWT
TOKEN=$(make poc-jwt)
# 3. Hit endpoint (account UUID from seed)
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/v1/Account/22222222-2222-2222-2222-222222222222 | jq .
# Expected: {"id":"22222222-...","tenantId":"11111111-...","name":"Demo Account","createdAt":"..."}
```

### VS Code breakpoint verification

1. Open `apps/api/src/account/account.controller.ts`.
2. Set breakpoint on the `return { id: row.id, ... }` line.
3. Run `make api-dev` in terminal.
4. In VS Code, press F5 with "Attach to API" selected.
5. Re-run the `curl` command.
6. Confirm the breakpoint hits and `row` is inspectable.

---

## Exit criteria checklist

- [ ] `pnpm --filter @tas/db typecheck` exits 0 after `message.ts` schema change (T15b)
- [ ] Migration `0003_*.sql` generated and contains `ALTER TABLE "message" ADD COLUMN "tenant_id" uuid NOT NULL` (T15b)
- [ ] `pnpm --filter @tas/api test` exits 0 (no `make poc-up` required — testcontainers handles Postgres)
- [ ] Message controller test asserts `row.tenantId === TENANT_ID` (T19d D5 gate)
- [ ] `pnpm --filter @tas/shared-types typecheck` exits 0
- [ ] `pnpm --filter @tas/api typecheck` exits 0
- [ ] `make poc-up && make poc-seed` succeed (Chunk 1 deliverable; verify still works)
- [ ] `make poc-jwt` prints a valid JWT
- [ ] `curl` smoke returns seeded account JSON (name "Demo Account")
- [ ] VS Code "Attach to API" launch config attaches; breakpoint in AccountController hits

---

## CI note — testcontainers cold pull

Add this step to `.github/workflows/ci.yml` before `pnpm test` to warm the Docker layer cache:

```yaml
- name: Pre-pull testcontainers image
  run: docker pull postgres:15
```

Use `actions/cache` with `key: docker-postgres-15` if the runner does not persist Docker layers between runs. This is Chunk 5's responsibility to add to the CI workflow; document it here so Chunk 5 implementer knows.

---

## Commit checkpoint

After all exit criteria pass:

```
git add packages/db apps/api packages/shared-types .vscode/launch.json Makefile
git commit -m "feat(api): NestJS /v1 skeleton — Account, Contact, Form, Message + JWT guard + testcontainers unit tests"
```

> `packages/db` is included because T15b adds `tenant_id` to `message` schema and generates migration 0003.
