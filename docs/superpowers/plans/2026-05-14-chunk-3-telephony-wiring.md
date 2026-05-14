# Chunk 3 — Telephony wiring: ARI leader + arbiter + NATS + WebSocket Implementation Plan (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real SIPp INVITE through compose Kamailio→Asterisk fires a `StasisStart`, the NATS-backed arbiter picks the seeded operator, and a WebSocket `incoming_call` event arrives at a connected client within 800 ms of the NATS publish. Migration 0004 adds `tenant_id` to `recording` and `queue_call`. All exit criteria in the spec (lines 111–115) are met.

**Source spec:** [`docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md`](../specs/2026-05-14-local-mvp-chunk-plan-design.md) — Chunk 3 (lines 99–122).

**v3 changes from v2:** See Self-critique § "What changed from v2" at bottom.

---

## Decisions (all resolved before implementation starts)

### D1 — WS event naming: `call.screenpop` vs `incoming_call`

**Decision:** Keep `WsEvents.CALL_SCREEN_POP = 'call.screenpop'` as the WS event name. Add `WsIncomingCallPayload` interface with `type: 'incoming_call'` discriminator. The arbiter emits on `call.screenpop` channel with payload `{ type: 'incoming_call', callId, tenantId, callerE164 }`. Test asserts `payload.type === 'incoming_call'`.

**Rationale:** Renaming `CALL_SCREEN_POP` would require touching Chunk 4 F03 UI (out of scope). The `type` discriminator satisfies the spec's exact assertion without renaming. Forward-compatible: Chunk 4 browser client uses `ws.on('call.screenpop', handler)` where `handler` reads `payload.type`.

### D2 — `ari-client` npm package choice

**Decision:** Use `ari-client@^2.2.0` (confirmed `latest: 2.2.0` on npm). Import via CommonJS `require('ari-client')` inside a factory provider. Known quirk from PoT S3: `channel.dialplan.app_name` is the dialplan app, not the Stasis app. Use `GET /ari/applications/<appName>` for reconcile (Chunk 7).

### D3 — ARI URL: host vs compose-internal access

**Decision:** Add `"${ASTERISK_ARI_HOST_PORT:-8088}:8088"` to `asterisk` service in `infra/docker-compose.yml`. Env var `ARI_URL` defaults to `http://localhost:8088`.

**STOP-on-conflict guidance for port 8088:** If port 8088 is already in use on the host, STOP and report BLOCKED. Do NOT kill the conflicting process.

### D4 — NATS URL: host access

**Decision:** Add `"${NATS_HOST_PORT:-4222}:4222"` and `"${NATS_MONITOR_HOST_PORT:-8222}:8222"` to the `nats` service. Env var `NATS_URL` defaults to `nats://localhost:4222`.

**STOP-on-conflict guidance for ports 4222/8222:** If either port is already in use, STOP and report BLOCKED.

### D5 — NATS: JetStream vs vanilla pub/sub

**Decision:** Use vanilla NATS pub/sub (core NATS) for this chunk. JetStream enabled on server (`-js`) but not used client-side here. Chunk 6 adds JetStream if at-least-once delivery is needed.

### D6 — MinIO SDK choice

**Decision:** Use `minio@^8.0.7`. Credentials from env: `MINIO_ENDPOINT` (default `localhost`), `MINIO_PORT` (default `9000`), `MINIO_ACCESS_KEY` (default `ncall`), `MINIO_SECRET_KEY` (default `ncall1234`). Bucket: `ncall-recordings`.

### D7 — JwtModule cleanup placement

**Decision:** Handle the 4 dead `JwtModule.register({ secret: 'test-secret' })` imports in controller specs as a standalone first task (T20-cleanup) committed before any Chunk 3 work.

### D8 — WS authentication scheme

**Decision:** JWT token passed as `?token=<jwt>` query string. `WsGateway` extracts from `client.handshake.query.token` and calls `jsonwebtoken.verify()` directly (same pattern as `JwtAuthGuard`). WsGateway is a plain NestJS injectable using the raw `ws` Node.js library and a custom HTTP upgrade handler in `main.ts` — no `@nestjs/platform-ws` or `@nestjs/websockets` packages needed for this PoC. Integration test client uses `ws` npm package.

### D9 — NatsModule factory provider pattern

**Decision:** `NatsModule` is `@Global()`, exports `NATS_CLIENT_TOKEN` provided by async `useFactory` calling `connect()` from `nats@^2.x`. All services inject `@Inject(NATS_CLIENT_TOKEN) private readonly nc: NatsConnection`.

### D10 — AriModule and Redis client factory provider pattern

**Decision:** `@Global()` factory providers for both. `AriModule` exposes `ARI_LEADER_TOKEN`; `RedisModule` exposes `REDIS_CLIENT_TOKEN`. Use `ioredis@^5.x` (self-typed — no `@types/ioredis` needed).

### D11 — `packages/ari-client` workspace package design

**Decision:** `packages/ari-client` as `@ncall/ari-client`. Contains `AriLeaderClient` class with Redis lease loop (TTL=1500ms, HB=500ms). Hard-stop callback fires via `process.nextTick` on lease loss. In-flight handler guard (`if (!this.isLeader) return`) prevents split-brain events from deposed leader (ADR-0016 §3 + Consequences).

### D12 — Migration 0004 scope and FK on `queue_call.callId`

**Decision:** Migration 0004 adds `tenant_id uuid NOT NULL` to `recording` and `queue_call`, plus FK on `queue_call.callId`. Drizzle schema changes in `call.ts` and `queue.ts`. Generate with `pnpm --filter @ncall/db migrate:gen` (drizzle-kit 0.20.x `generate:pg` subcommand).

### D13 — Single-operator routing strategy

**Decision:** `ArbiterService` uses hardcoded seeded operator UUID `66666666-6666-6666-6666-666666666666`. No DB query. Chunk 6 replaces with FIFO heap + skill matching.

### D14 — MixMonitor recording path and WAV upload

**Decision:** `RecordingService` uploads a zero-byte placeholder to MinIO at StasisStart (makes `statObject` assertion deterministic without waiting for Asterisk to write WAV bytes). Inserts `recording` row with `tenant_id`, `call_id`, and `path = recordings/<callId>.wav`. Actual WAV upload is Chunk 6/7 concern.

### D15 — Asterisk Stasis app name

**Decision:** Stasis app name is `ncall` (from `infra/asterisk/ari.conf` `[ncall]` user + `extensions.conf` `Stasis(ncall)`). `ARI_APP` env var defaults to `ncall`.

### D16 — Tenant ID resolution on StasisStart

**Decision:** `StasisStartHandler` queries DID from `channel.dialplan.exten`, then queries `account` for `tenant_id` using two sequential Drizzle queries: first `SELECT did.id, did.accountId WHERE did.e164 = calledE164`, then `SELECT account.tenantId WHERE account.id = didRow.accountId`. This avoids the original double-DID-query defect (m1 closed) while keeping the implementation simple and readable. A single JOIN would be expressible in Drizzle (`innerJoin`) but adds complexity without measurable latency benefit at single-row scale; two sequential queries are more readable and match the provided T24 implementation exactly.

### D17 — SIPp networking: publish Kamailio port 5060 (C2/m5 fix)

**Decision (2a):** Publish Kamailio SIP port 5060 to the host via `"${KAMAILIO_SIP_HOST_PORT:-5060}:5060/udp"` in `infra/docker-compose.yml`. SIPp runs with `--network host` (Linux) or `--platform linux/amd64 --add-host host.docker.internal:host-gateway` and targets `${KAMAILIO_SIP_HOST_PORT:-5060}` on the host. On macOS with Docker Desktop, the preferred invocation is:

```bash
docker run --rm --platform linux/amd64 \
  drachtio/sipp@sha256:a47d473051b8686a68143f36c539acdbefb620bb88ebcfd9e8ee44335a38eca4 \
  -sn uac -d 2000 -m 1 -r 1 -rp 1000 \
  -s +15555550100 \
  host.docker.internal:5060
```

`host.docker.internal` resolves to the macOS host IP from inside a Docker container on Docker Desktop — this is the correct cross-VM networking pattern. The compose network approach (`--network infra_default`) would also work but requires the SIPp container to resolve `kamailio` by compose service name; the host-port publish is simpler and matches prior port-override patterns (Postgres 5432, Temporal 7233).

**STOP-on-conflict guidance for port 5060:** Port 5060 is commonly used by SIP softphones, local Asterisk dev installs, and other SIP tools. If port 5060 is already in use on the host when adding this mapping, STOP and report BLOCKED. Do NOT kill the conflicting process/container — the user may own it. The user can override via `KAMAILIO_SIP_HOST_PORT=5061` in their `.env`.

**Rationale:** Matches the env-var override pattern established by `${POSTGRES_HOST_PORT:-5432}`, `${TEMPORAL_HOST_PORT:-7233}`, and `${ASTERISK_ARI_HOST_PORT:-8088}` (D3). Simpler than compose-network SIPp because it doesn't require hard-coding the compose project name (`infra_default`) or managing SIPp inside the compose network. drachtio/sipp is amd64-only (live-verified: `docker manifest inspect drachtio/sipp:latest` returns single amd64 manifest); `--platform linux/amd64` is required on arm64 macOS; Docker Desktop's Rosetta emulation handles this.

**D17 image pin:** `drachtio/sipp` only publishes `:latest` (one tag, last updated 2018-07-08 — stable, not actively updated). Pin to manifest digest `sha256:a47d473051b8686a68143f36c539acdbefb620bb88ebcfd9e8ee44335a38eca4` (live-verified via `docker manifest inspect drachtio/sipp:latest --verbose`). Use `drachtio/sipp@sha256:a47d473051b8686a68143f36c539acdbefb620bb88ebcfd9e8ee44335a38eca4` everywhere.

### D18 — Integration test timing measurement scope (C3 fix)

**Decision:** Use `spawn` (not `execSync`) to fire SIPp asynchronously. Record `t0` BEFORE spawn. Race `Promise.all([natsEventPromise, wsEventPromise])` against a 5000 ms wall-clock timeout. After both resolve, assert `elapsedNatsToWs < 800` where `elapsedNatsToWs` is measured from when the NATS message arrives to when the WS event arrives (NATS→WS chain latency). The 800 ms budget from ADR-0024 is for queue dequeue latency (NATS publish → WS deliver), not for end-to-end SIPp dialog duration.

**Rationale:** The spec exit criterion (line 113) says "WS `incoming_call` event within 800 ms" — this is the NATS→WS chain, not INVITE-to-WS. `execSync` blocks the test thread for the full SIPp call duration (~2+ seconds with `-d 2000`), making the elapsed assertion always fail. `spawn` lets the test proceed immediately while SIPp runs in the background. The test waits for SIPp exit only in cleanup (after assertions pass).

### D19 — Migration 0004 backfill strategy (M3 fix)

**Decision (3a — backfill):** The generated migration SQL adds a `DEFAULT '<seeded-tenant-id>'` clause, then a follow-up `ALTER COLUMN DROP DEFAULT` in the same file. This makes the migration idempotent against dev DBs that already have `recording` or `queue_call` rows. The seeded tenant ID `'11111111-1111-1111-1111-111111111111'` is used as the default value (safe for dev data; all existing rows are demo data owned by this tenant).

**Rationale:** Matches Chunk 2's T15b pattern which handled `tenant_id` addition on `message`. Avoids requiring users to `make poc-down -v && make poc-up` which destroys all dev state. A `NOT NULL` without DEFAULT aborts on non-empty tables (drizzle-kit 0.20.x generates bare `ADD COLUMN ... NOT NULL` with no DEFAULT — verified in Chunk 2).

**Implementation:** After `pnpm --filter @ncall/db migrate:gen` generates the SQL, manually edit `0004_<name>.sql` to add DEFAULT and DROP DEFAULT clauses as shown in T21m Step 5.

### D20 — Hard-stop unit test latency assertion (M4 fix)

**Decision (4b — remove latency assertion):** Remove the `callbackLatency < 100ms` assertion from the unit test. Keep the `onLoseLease` called + `mockWsClose` called assertions (these verify the callback path correctly). Document in the test file that wire-level FIN < 100 ms evidence is produced in Chunk 7 S-5 spec (two real NestJS instances + real Redis + tcpdump).

**Rationale:** With `vi.useFakeTimers()`, `Date.now()` returns a frozen value; `callbackTs[0] - heartbeatTs === 0` always, making `< 100` trivially true regardless of implementation. The test provides zero discriminating power on latency. Per spec line 105: "this unit test verifies the callback-path latency only" — meaning it verifies the callback *is called*, not the precise timing. The real evidence path is Chunk 7 S-5. A test that always passes for the wrong reason is worse than no test; removing the assertion makes the remaining assertions meaningful.

---

## File map

| File | Action | Task |
|---|---|---|
| `apps/api/src/account/account.controller.spec.ts` | Modify (remove dead JwtModule.register import) | T20-cleanup |
| `apps/api/src/contact/contact.controller.spec.ts` | Modify (remove dead JwtModule.register import) | T20-cleanup |
| `apps/api/src/form/form.controller.spec.ts` | Modify (remove dead JwtModule.register import) | T20-cleanup |
| `apps/api/src/message/message.controller.spec.ts` | Modify (remove dead JwtModule.register import) | T20-cleanup |
| `packages/db/src/schema/call.ts` | Modify (add `tenantId` to `recording` table) | T21m |
| `packages/db/src/schema/queue.ts` | Modify (add `tenantId` to `queueCall`, add FK on `callId`) | T21m |
| `packages/shared-types/src/events.ts` | Modify (add `WsIncomingCallPayload` interface) | T21m |
| `packages/db/drizzle/0004_<name>.sql` | Create (generated + manually patched for backfill DEFAULT) | T21m |
| `infra/docker-compose.yml` | Modify (publish Asterisk 8088, NATS 4222+8222, Kamailio 5060/udp) | T21-ports |
| `packages/ari-client/package.json` | Create | T22 |
| `packages/ari-client/tsconfig.json` | Create | T22 |
| `packages/ari-client/src/index.ts` | Create | T22 |
| `packages/ari-client/src/leader.ts` | Create | T22 |
| `packages/ari-client/test/leader-hardstop.spec.ts` | Create | T22 |
| `packages/ari-client/vitest.config.ts` | Create | T22 |
| `apps/api/package.json` | Modify (add nats, @ncall/ari-client, ioredis, minio to deps; ws to deps; postgres + @types/ws to devDeps; remove @types/ioredis; no @nestjs/platform-ws or @nestjs/websockets) | T23 |
| `apps/api/src/nats/nats.module.ts` | Create | T23 |
| `apps/api/src/nats/nats-client.service.ts` | Create | T23 |
| `apps/api/src/nats/nats.module.spec.ts` | Create | T23 |
| `apps/api/src/redis/redis.module.ts` | Create | T23 |
| `apps/api/src/ari/ari.module.ts` | Create | T23 |
| `apps/api/src/telephony/stasis-start.handler.ts` | Create | T24 |
| `apps/api/src/telephony/stasis-start.handler.spec.ts` | Create | T24 |
| `apps/api/src/telephony/telephony.module.ts` | Create | T24 |
| `apps/api/src/arbiter/arbiter.service.ts` | Create | T25 |
| `apps/api/src/arbiter/arbiter.service.spec.ts` | Create | T25 |
| `apps/api/src/arbiter/arbiter.module.ts` | Create | T25 |
| `apps/api/src/ws/ws.gateway.ts` | Create | T25 |
| `apps/api/src/ws/ws.gateway.spec.ts` | Create | T25 |
| `apps/api/src/ws/ws.module.ts` | Create | T25 |
| `apps/api/src/recording/recording.service.ts` | Create | T26 |
| `apps/api/src/recording/recording.service.spec.ts` | Create | T26 |
| `apps/api/src/recording/recording.module.ts` | Create | T26 |
| `apps/api/src/app.module.ts` | Modify (add all new modules) | T26 |
| `apps/api/src/main.ts` | Modify (add WS upgrade handler) | T26 |
| `apps/api/test/integration/chunk3-smoke.spec.ts` | Create | T27 |
| `apps/api/vitest.config.ts` | Modify (ADD alias only — preserve swc plugin block) | T27 |
| `apps/api/vitest.integration.config.ts` | Create (separate integration config) | T27 |
| `Makefile` | Modify (add `poc-test-chunk3` target) | T27 |
| `poc/smoke-chunk3.md` | Create | T28 |

---

## Task T20-cleanup — Remove dead `JwtModule.register` imports from 4 controller specs

**Why first:** Zero-risk cleanup. Standalone so it doesn't contaminate Chunk 3 commits.

**No TDD — dead-code removal; specs must stay GREEN before and after.**

- [ ] Step 1: In each of the 4 controller specs (`account`, `contact`, `form`, `message`), remove:
  ```ts
  imports: [JwtModule.register({ secret: 'test-secret' })],
  ```
  and the corresponding `import { JwtModule } from '@nestjs/jwt';` if it becomes unused.

- [ ] Step 2: Run `pnpm --filter @ncall/api test` → all 11 specs GREEN.

- [ ] Step 3: Commit:
  ```bash
  git add apps/api/src/account/account.controller.spec.ts \
          apps/api/src/contact/contact.controller.spec.ts \
          apps/api/src/form/form.controller.spec.ts \
          apps/api/src/message/message.controller.spec.ts
  git commit -m "chore(api): remove dead JwtModule.register from controller specs — guard uses jsonwebtoken directly"
  ```

---

## Task T21m — Migration 0004: add `tenant_id` to `recording` + `queue_call`; add FK on `queue_call.callId`

**No TDD — schema migration; the StasisStartHandler TDD in T24 and RecordingService TDD in T26 provide the red→green gates for inserted rows.**

- [ ] Step 1: Modify `packages/db/src/schema/call.ts` — add `tenantId` to the `recording` table:

```ts
import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
  routedThrough: text("routed_through").array().notNull().default(sql`ARRAY[]::text[]`),
});

export const recording = pgTable("recording", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
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

- [ ] Step 2: Modify `packages/db/src/schema/queue.ts` — add `tenantId` to `queueCall`, add FK on `callId`:

```ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant, account } from "./tenancy";
import { call } from "./call";

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
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
  queueId: uuid("queue_id").notNull().references(() => queue.id),
  callId: uuid("call_id").notNull().references(() => call.id),
  enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).notNull(),
  dequeuedAt: timestamp("dequeued_at", { withTimezone: true }),
  attempts: text("attempts").array().notNull().default(sql`ARRAY[]::text[]`),
});
```

- [ ] Step 3: Add `WsIncomingCallPayload` to `packages/shared-types/src/events.ts`:

```ts
// Append after the existing exports:

/** WS payload shape for the `call.screenpop` event (sent to F03 operator UI). */
export interface WsIncomingCallPayload {
  /** Discriminator field. Spec exit criterion: event.type === 'incoming_call'. */
  type: 'incoming_call';
  callId: string;
  tenantId: string;
  callerE164: string;
}
```

- [ ] Step 4: Generate migration:
  ```bash
  pnpm --filter @ncall/db migrate:gen
  ```
  (drizzle-kit 0.20.x `generate:pg` subcommand — per Chunk 1/2 deviation notes). Produces `packages/db/drizzle/0004_<name>.sql`.

- [ ] Step 5: **Manually edit** the generated `0004_<name>.sql` to add backfill DEFAULT (D19). The raw generated SQL will have:
  ```sql
  ALTER TABLE "recording" ADD COLUMN "tenant_id" uuid NOT NULL;
  ALTER TABLE "queue_call" ADD COLUMN "tenant_id" uuid NOT NULL;
  ```
  Edit to:
  ```sql
  -- Add tenant_id with a DEFAULT so the column can be added to non-empty tables.
  -- The default '11111111-...' is the seeded dev tenant; drop the default after backfill.
  -- WARNING: if you have recording/queue_call rows with a DIFFERENT tenant, update them first.
  ALTER TABLE "recording"
    ADD COLUMN "tenant_id" uuid NOT NULL
    DEFAULT '11111111-1111-1111-1111-111111111111'
    REFERENCES "tenant"("id");
  ALTER TABLE "recording" ALTER COLUMN "tenant_id" DROP DEFAULT;

  ALTER TABLE "queue_call"
    ADD COLUMN "tenant_id" uuid NOT NULL
    DEFAULT '11111111-1111-1111-1111-111111111111'
    REFERENCES "tenant"("id");
  ALTER TABLE "queue_call" ALTER COLUMN "tenant_id" DROP DEFAULT;
  ```
  Keep the rest of the generated SQL (FK constraints for `queue_call.call_id`) as-is.

- [ ] Step 6: Inspect the final SQL to confirm:
  - `tenant_id` on `recording` with DEFAULT + DROP DEFAULT
  - `tenant_id` on `queue_call` with DEFAULT + DROP DEFAULT
  - FK on `queue_call.call_id` → `call.id`

- [ ] Step 7: Run `pnpm --filter @ncall/db typecheck` → exits 0.

- [ ] Step 8: Commit:
  ```bash
  git add packages/db/src/schema/call.ts packages/db/src/schema/queue.ts \
          packages/db/drizzle/ packages/shared-types/src/events.ts
  git commit -m "feat(db): migration 0004 — add tenant_id to recording+queue_call (backfill DEFAULT), FK on queue_call.call_id; add WsIncomingCallPayload type"
  ```

---

## Task T21-ports — Publish Asterisk 8088, NATS 4222/8222, and Kamailio 5060/udp to host

**No TDD — infrastructure wiring; verified by integration test in T27.**

> **STOP-on-port-conflict guidance:** If port **8088**, **4222**, **8222**, or **5060** is already in use on the host when applying these changes, STOP and report BLOCKED. Do NOT stop or kill the conflicting process/container — the user may own it. Port 5060 is especially collision-prone (SIP softphones, local Asterisk dev, etc.). The user can override any of these via env vars: `ASTERISK_ARI_HOST_PORT`, `NATS_HOST_PORT`, `NATS_MONITOR_HOST_PORT`, `KAMAILIO_SIP_HOST_PORT`. Per `feedback_subagent_blast_radius.md`.

- [ ] Step 1: Modify `infra/docker-compose.yml` — add ports to `asterisk`, `nats`, and `kamailio` services.

For `asterisk`, add:
```yaml
    ports:
      - "${ASTERISK_ARI_HOST_PORT:-8088}:8088"
```

For `nats`, add:
```yaml
    ports:
      - "${NATS_HOST_PORT:-4222}:4222"
      - "${NATS_MONITOR_HOST_PORT:-8222}:8222"
```

For `kamailio`, add:
```yaml
    ports:
      - "${KAMAILIO_SIP_HOST_PORT:-5060}:5060/udp"
```

All three follow the same env-var override pattern as `${POSTGRES_HOST_PORT:-5432}` and `${TEMPORAL_HOST_PORT:-7233}`.

- [ ] Step 2: Verify compose config is valid:
  ```bash
  docker compose -f infra/docker-compose.yml config --quiet
  ```
  Expected: exits 0.

- [ ] Step 3: Commit:
  ```bash
  git add infra/docker-compose.yml
  git commit -m "feat(infra): publish Asterisk ARI 8088, NATS 4222/8222, Kamailio SIP 5060/udp to host — env-overridable"
  ```

---

## Task T22 — `packages/ari-client`: ARI thin wrapper with Redis-backed leader election (TDD: red→green)

**The hard-stop unit test is the red→green gate. It verifies the callback IS called (not timing precision — D20 explains why the latency assertion is removed). Real wire-level FIN < 100 ms is Chunk 7 S-5 evidence.**

**ADR-0016 compliance:** The `_becomeLeader()` method registers a StasisStart handler with `if (!this.isLeader) return` guard (M5 fix). This prevents a deposed leader from processing in-flight events after lease loss.

- [ ] Step 1: Write the failing test at `packages/ari-client/test/leader-hardstop.spec.ts` FIRST:

```ts
// RED: fails because packages/ari-client/src/leader.ts does not exist yet.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * AriLeaderClient hard-stop callback test.
 *
 * Verifies the CALLBACK PATH: that onLoseLease() is called and the WS is closed
 * when the lease is lost. Does NOT assert timing precision with fake timers
 * (Date.now() is frozen by vi.useFakeTimers — latency would always be 0ms, trivially passing).
 *
 * Real wire-level FIN < 100ms evidence (ADR-0016 §Decision item 3) is produced
 * in Chunk 7 S-5 spec running two real NestJS instances against real Redis + tcpdump.
 */
describe('AriLeaderClient — hard-stop callback path (mock Redis/ARI, no real infrastructure)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onLoseLease and closes WS when lease is lost on heartbeat', async () => {
    const { AriLeaderClient } = await import('../src/leader.js');

    // Mock ioredis: first SET NX returns 'OK' (acquire), then GET returns 'other-instance' (lost lease)
    const mockRedisGet = vi.fn()
      .mockResolvedValueOnce('test-leader')   // first renew: GET returns own ID (still held)
      .mockResolvedValueOnce('other-instance'); // second renew: GET returns foreign ID (lost)
    const mockRedisSet = vi.fn().mockResolvedValue('OK');
    const mockRedisPexpire = vi.fn().mockResolvedValue(1);
    const mockRedis = {
      get: mockRedisGet,
      set: mockRedisSet,
      pexpire: mockRedisPexpire,
    };

    const mockWsClose = vi.fn();
    const mockAriClient = {
      _connection: { ws: { close: mockWsClose } },
      stop: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    const onLoseLease = vi.fn();

    const leader = new AriLeaderClient({
      instanceId: 'test-leader',
      leaseKey: 'test:ari-leader',
      ttlMs: 1500,
      heartbeatMs: 500,
      redis: mockRedis as any,
      ariClientFactory: async () => mockAriClient as any,
      onStasisStart: vi.fn(),
      onLoseLease,
    });

    // Heartbeat 1: tryAcquire → SET NX returns OK → become leader
    await leader._heartbeatOnce();
    expect(leader.isLeaderForTest).toBe(true);

    // Heartbeat 2: renew → GET returns own ID → still leader
    await leader._heartbeatOnce();
    expect(leader.isLeaderForTest).toBe(true);

    // Heartbeat 3: renew → GET returns 'other-instance' → lose leadership
    await leader._heartbeatOnce();

    // Flush process.nextTick queue (onLoseLease fires inside nextTick)
    await vi.runAllTicks();

    // Verify callback path: onLoseLease called AND WS closed
    expect(onLoseLease).toHaveBeenCalledTimes(1);
    expect(mockWsClose).toHaveBeenCalledTimes(1);
    // No longer leader
    expect(leader.isLeaderForTest).toBe(false);
  });

  it('does not call onLoseLease when lease is still held', async () => {
    const { AriLeaderClient } = await import('../src/leader.js');

    const mockRedis = {
      get: vi.fn().mockResolvedValue('test-leader'),
      set: vi.fn().mockResolvedValue('OK'),
      pexpire: vi.fn().mockResolvedValue(1),
    };

    const onLoseLease = vi.fn();
    const leader = new AriLeaderClient({
      instanceId: 'test-leader',
      leaseKey: 'test:ari-leader',
      ttlMs: 1500,
      heartbeatMs: 500,
      redis: mockRedis as any,
      ariClientFactory: async () => ({
        start: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        stop: vi.fn(),
      } as any),
      onStasisStart: vi.fn(),
      onLoseLease,
    });

    await leader._heartbeatOnce(); // acquire
    await leader._heartbeatOnce(); // renew: GET returns 'test-leader' (still ours)
    await vi.runAllTicks();

    expect(onLoseLease).not.toHaveBeenCalled();
  });

  it('drops in-flight StasisStart events when isLeader is false (ADR-0016 split-brain guard)', async () => {
    const { AriLeaderClient } = await import('../src/leader.js');

    const mockRedis = {
      get: vi.fn().mockResolvedValue('test-leader'),
      set: vi.fn().mockResolvedValue('OK'),
      pexpire: vi.fn().mockResolvedValue(1),
    };

    let capturedHandler: ((...args: any[]) => void) | null = null;
    const mockAriClient = {
      _connection: { ws: { close: vi.fn() } },
      stop: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === 'StasisStart') capturedHandler = handler;
      }),
    };

    const onStasisStart = vi.fn();
    const leader = new AriLeaderClient({
      instanceId: 'test-leader',
      leaseKey: 'test:ari-leader',
      ttlMs: 1500,
      heartbeatMs: 500,
      redis: mockRedis as any,
      ariClientFactory: async () => mockAriClient as any,
      onStasisStart,
      onLoseLease: vi.fn(),
    });

    // Become leader so handler is registered
    await leader._heartbeatOnce();
    expect(capturedHandler).not.toBeNull();

    // Manually depose (simulate lost lease without going through heartbeat)
    (leader as any).isLeader = false;

    // Fire a StasisStart event while isLeader === false
    capturedHandler!({ channel: { id: 'ch-1', dialplan: {}, caller: {} }, application: 'ncall' });

    // onStasisStart must NOT be called — guard drops it
    expect(onStasisStart).not.toHaveBeenCalled();
  });
});
```

- [ ] Step 2: Create `packages/ari-client/package.json`:

```json
{
  "name": "@ncall/ari-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run --config vitest.config.ts"
  },
  "dependencies": {
    "ari-client": "^2.2.0",
    "ioredis": "^5.4.1"
  },
  "devDependencies": {
    "@types/node": "^24",
    "typescript": "5.4.2",
    "vitest": "1.4.0"
  }
}
```

- [ ] Step 3: Create `packages/ari-client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "noEmit": true,
    "moduleResolution": "bundler",
    "module": "ESNext",
    "target": "ES2022"
  },
  "include": ["src", "test"]
}
```

- [ ] Step 4: Create `packages/ari-client/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['test/**/*.spec.ts'],
  },
});
```

- [ ] Step 5: Run `pnpm --filter @ncall/ari-client test` → confirm RED (module not found for `../src/leader.js`).

- [ ] Step 6: Create `packages/ari-client/src/leader.ts` (GREEN implementation):

```ts
/**
 * AriLeaderClient — ADR-0016 leader election with Redis-backed lease.
 *
 * TTL must be ≥ 3× HB (ADR-0016 §Decision item 1, PoT S3 finding).
 *
 * Hard-stop: onLoseLease() called via process.nextTick after detecting lease loss.
 * The WS is closed in the same nextTick, before onLoseLease fires.
 *
 * ADR-0016 split-brain guard: the StasisStart event handler has an `if (!this.isLeader) return`
 * guard so in-flight events from a deposed leader are silently dropped.
 *
 * Callback-path correctness is verified in the unit test. Real wire-level FIN < 100 ms
 * evidence (ADR-0016 §Decision item 3) is produced in Chunk 7 S-5 spec.
 */

export interface AriLeaderClientOptions {
  instanceId: string;
  leaseKey: string;
  ttlMs: number;       // Must be ≥ 3 × heartbeatMs (ADR-0016)
  heartbeatMs: number;
  redis: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode: string, ...args: any[]): Promise<string | null>;
    pexpire(key: string, ms: number): Promise<number>;
  };
  /** Factory that creates and connects to the ARI server. */
  ariClientFactory: (appName: string) => Promise<AriClientHandle>;
  /** Called when a StasisStart event fires (leader is active). NOT called if lease is lost. */
  onStasisStart: (event: StasisStartEvent) => void;
  /** Called via process.nextTick when the lease is lost. Guaranteed to fire after WS close. */
  onLoseLease: () => void;
}

export interface AriClientHandle {
  _connection?: { ws?: { close(): void } };
  stop?(appName?: string): void;
  start(appName: string): Promise<void>;
  on(event: string, handler: (...args: any[]) => void): void;
}

export interface StasisStartEvent {
  channel: {
    id: string;
    dialplan: { context: string; exten: string };
    caller: { number: string };
  };
  application: string;
}

export class AriLeaderClient {
  private readonly opts: AriLeaderClientOptions;
  /** @internal exposed for unit tests via isLeaderForTest getter */
  private isLeader = false;
  private ariHandle: AriClientHandle | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly ARI_APP = process.env.ARI_APP ?? 'ncall';

  constructor(opts: AriLeaderClientOptions) {
    this.opts = opts;
    if (opts.ttlMs < 3 * opts.heartbeatMs) {
      throw new Error(
        `ADR-0016 violation: TTL (${opts.ttlMs}ms) must be ≥ 3× HB (${opts.heartbeatMs}ms). Got ratio ${(opts.ttlMs / opts.heartbeatMs).toFixed(1)}`,
      );
    }
  }

  /** Exposed for unit tests only — do not use in production code. */
  get isLeaderForTest(): boolean {
    return this.isLeader;
  }

  /** Wire or replace the StasisStart callback after construction (used by NestJS DI). */
  setStasisStartCallback(fn: (event: StasisStartEvent) => void): void {
    this.opts.onStasisStart = fn;
  }

  /** Start the heartbeat loop. */
  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => void this._heartbeatOnce(), this.opts.heartbeatMs);
    void this._heartbeatOnce();
  }

  /** Stop the heartbeat loop. Does not close the WS. */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Single heartbeat tick. Exposed for unit-test injection (deterministic ticks without setInterval).
   */
  async _heartbeatOnce(): Promise<void> {
    try {
      if (this.isLeader) {
        const renewed = await this._renew();
        if (!renewed) this._loseLeadership('renew failed');
      } else {
        const acquired = await this._tryAcquire();
        if (acquired) await this._becomeLeader();
      }
    } catch (err) {
      this._loseLeadership(`heartbeat error: ${String(err)}`);
    }
  }

  private async _tryAcquire(): Promise<boolean> {
    const result = await this.opts.redis.set(
      this.opts.leaseKey,
      this.opts.instanceId,
      'NX',
      'PX',
      this.opts.ttlMs,
    );
    return result === 'OK';
  }

  private async _renew(): Promise<boolean> {
    const current = await this.opts.redis.get(this.opts.leaseKey);
    if (current !== this.opts.instanceId) return false;
    await this.opts.redis.pexpire(this.opts.leaseKey, this.opts.ttlMs);
    return true;
  }

  private async _becomeLeader(): Promise<void> {
    this.isLeader = true;
    const handle = await this.opts.ariClientFactory(this.ARI_APP);
    this.ariHandle = handle;

    // ADR-0016 split-brain guard: check isLeader at the start of every handler invocation.
    // If this instance has been deposed between event delivery and handler execution,
    // the event is silently dropped — the new leader will process it on its own WS.
    // TODO Chunk 7: verify idempotency of standby reconcile against any events the
    //               deposed leader's drained handlers may have already partially processed.
    handle.on('StasisStart', (event: StasisStartEvent) => {
      if (!this.isLeader) return; // guard: deposed leader drops in-flight events (ADR-0016)
      this.opts.onStasisStart(event);
    });

    await handle.start(this.ARI_APP);
  }

  private _loseLeadership(reason: string): void {
    if (!this.isLeader) return;
    this.isLeader = false;
    const handle = this.ariHandle;
    this.ariHandle = null;
    process.nextTick(() => {
      // Force-close the WS immediately — do NOT await outstanding handlers.
      if (handle) {
        try {
          if (handle._connection?.ws && typeof handle._connection.ws.close === 'function') {
            handle._connection.ws.close();
          }
          if (typeof handle.stop === 'function') {
            handle.stop(this.ARI_APP);
          }
        } catch {
          // Swallow — we are already losing leadership
        }
      }
      this.opts.onLoseLease();
    });
  }
}
```

- [ ] Step 7: Create `packages/ari-client/src/index.ts`:

```ts
export { AriLeaderClient } from './leader.js';
export type { AriLeaderClientOptions, AriClientHandle, StasisStartEvent } from './leader.js';
```

- [ ] Step 8: Run `pnpm --filter @ncall/ari-client test` → confirm GREEN (3/3).

- [ ] Step 9: Run `pnpm --filter @ncall/ari-client typecheck` → exits 0.

- [ ] Step 10: Commit:
  ```bash
  git add packages/ari-client/
  git commit -m "feat(ari-client): AriLeaderClient — Redis lease (TTL=1500ms/HB=500ms), hard-stop callback, isLeader guard (ADR-0016); unit test verifies callback path (TDD)"
  ```

---

## Task T23 — NatsModule, RedisModule, AriModule in `apps/api` (TDD: red→green for NATS publish/subscribe)

- [ ] Step 1: Write the failing test at `apps/api/src/nats/nats.module.spec.ts` FIRST:

```ts
// RED: fails because NatsClientService does not exist yet.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NatsClientService } from './nats-client.service';
import { NATS_CLIENT_TOKEN } from './nats.module';

describe('NatsClientService', () => {
  let service: NatsClientService;
  let module: TestingModule;

  const mockNc = {
    publish: vi.fn(),
    subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    closed: Promise.resolve(),
    drain: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        NatsClientService,
        { provide: NATS_CLIENT_TOKEN, useValue: mockNc },
      ],
    }).compile();
    service = module.get(NatsClientService);
  });

  afterAll(async () => {
    await module.close();
  });

  it('publish() calls nc.publish with subject and encoded payload', () => {
    const payload = { callId: 'abc', tenantId: 'tenant-1', channel: 'ch-1', accountId: 'acct-1' };
    service.publish('ncall.stasis.start', payload);
    expect(mockNc.publish).toHaveBeenCalledWith(
      'ncall.stasis.start',
      expect.any(Uint8Array),
    );
    const encoded = mockNc.publish.mock.calls[0][1] as Uint8Array;
    const decoded = JSON.parse(new TextDecoder().decode(encoded));
    expect(decoded).toMatchObject(payload);
  });

  it('subscribe() calls nc.subscribe and registers callback', () => {
    const handler = vi.fn();
    service.subscribe('ncall.stasis.start', handler);
    expect(mockNc.subscribe).toHaveBeenCalledWith(
      'ncall.stasis.start',
      expect.objectContaining({ callback: expect.any(Function) }),
    );
  });
});
```

- [ ] Step 2: Run `pnpm --filter @ncall/api test` → RED (NatsClientService / NATS_CLIENT_TOKEN not found).

- [ ] Step 3: Modify `apps/api/package.json` — add/move dependencies:

**Add to `dependencies`:**
```json
"@ncall/ari-client": "workspace:*",
"ioredis": "^5.4.1",
"minio": "^8.0.7",
"nats": "^2.29.3",
"ws": "^8.20.1"
```

**Add to `devDependencies`:**
```json
"@types/ws": "^8.18.1",
"postgres": "3.4.4"
```

**Remove from `devDependencies` (if present):**
```json
"@types/ioredis": "^4.28.10"
```

> **Notes:**
> - `ws` goes in `dependencies` (not `devDependencies`) because it is imported in production code (`main.ts` has `import { WebSocketServer } from 'ws'` and `ws.gateway.ts` has `import type { WebSocket } from 'ws'`).
> - `@types/ws@^8.18.1` is required in devDependencies because `ws@8.x` does not ship its own TypeScript declarations (live-verified: `npm view ws@8.20.1 --json` → no `types` field). Three files import from `ws`: `ws.gateway.ts`, `main.ts`, and `chunk3-smoke.spec.ts`. Without `@types/ws`, `pnpm typecheck` fails with "Could not find a declaration file for module 'ws'". Version `^8.18.1` is the latest 8.x release available on npm (live-verified).
> - `postgres@3.4.4` is required in devDependencies because `chunk3-smoke.spec.ts` imports `import * as pg from 'postgres'`. The `postgres` package is declared in `packages/db/package.json` but pnpm@8 does not hoist workspace packages to sibling packages — confirmed absent from workspace root `node_modules/`. The version `3.4.4` matches `packages/db/package.json` exactly (live-verified).
> - `@types/ioredis` must NOT be added — `ioredis@5.x` is self-typed (`./built/index.d.ts`, live-verified via `npm view ioredis@5.4.1 types`); installing the v4 type stubs causes API shape conflicts.
> - `@nestjs/platform-ws` and `@nestjs/websockets` must NOT be added — WsGateway uses a plain NestJS injectable with raw `ws` and a custom HTTP upgrade handler. Neither `@WebSocketGateway` nor any `@nestjs/websockets` decorator appears in any implementation file (D8).

Run `pnpm install` from workspace root.

- [ ] Step 4: Create `apps/api/src/nats/nats.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { connect } from 'nats';
import type { NatsConnection } from 'nats';
import { NatsClientService } from './nats-client.service';

export const NATS_CLIENT_TOKEN = 'NATS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: NATS_CLIENT_TOKEN,
      useFactory: async (): Promise<NatsConnection> => {
        const url = process.env.NATS_URL ?? 'nats://localhost:4222';
        return connect({ servers: url });
      },
    },
    NatsClientService,
  ],
  exports: [NatsClientService],
})
export class NatsModule {}
```

- [ ] Step 5: Create `apps/api/src/nats/nats-client.service.ts`:

```ts
import { Injectable, Inject } from '@nestjs/common';
import type { NatsConnection } from 'nats';
import { StringCodec } from 'nats';
import { NATS_CLIENT_TOKEN } from './nats.module';

const sc = StringCodec();

@Injectable()
export class NatsClientService {
  constructor(
    @Inject(NATS_CLIENT_TOKEN) private readonly nc: NatsConnection,
  ) {}

  publish<T>(subject: string, payload: T): void {
    const encoded = sc.encode(JSON.stringify(payload));
    this.nc.publish(subject, encoded);
  }

  subscribe<T>(subject: string, handler: (payload: T) => void): { unsubscribe(): void } {
    const sub = this.nc.subscribe(subject, {
      callback: (_err, msg) => {
        if (msg) {
          try {
            handler(JSON.parse(sc.decode(msg.data)) as T);
          } catch {
            // malformed message — skip
          }
        }
      },
    });
    return sub;
  }
}
```

- [ ] Step 6: Create `apps/api/src/redis/redis.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT_TOKEN = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT_TOKEN,
      useFactory: () => new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379'),
    },
  ],
  exports: [REDIS_CLIENT_TOKEN],
})
export class RedisModule {}
```

- [ ] Step 7: Create `apps/api/src/ari/ari.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { AriLeaderClient } from '@ncall/ari-client';
import Redis from 'ioredis';

export const ARI_LEADER_TOKEN = 'ARI_LEADER';

@Global()
@Module({
  providers: [
    {
      provide: ARI_LEADER_TOKEN,
      useFactory: (): AriLeaderClient => {
        const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
        const ariConnect = require('ari-client') as {
          connect: (url: string, user: string, pass: string) => Promise<any>;
        };
        const ariUrl = process.env.ARI_URL ?? 'http://localhost:8088';
        const ariUser = process.env.ARI_USER ?? 'ncall';
        const ariPass = process.env.ARI_PASS ?? 'ncall';

        const leader = new AriLeaderClient({
          instanceId: process.env.INSTANCE_ID ?? `api-${process.pid}`,
          leaseKey: `ncall:ari-leader:${process.env.ASTERISK_ID ?? 'asterisk-1'}`,
          ttlMs: Number(process.env.ARI_LEASE_TTL_MS ?? 1500),
          heartbeatMs: Number(process.env.ARI_HEARTBEAT_MS ?? 500),
          redis,
          ariClientFactory: async (appName) => {
            const client = await ariConnect.connect(ariUrl, ariUser, ariPass);
            return client;
          },
          onStasisStart: () => {
            // No-op at module level; wired by StasisStartHandler.onModuleInit() via setStasisStartCallback().
            // TODO Chunk 7: StasisStart events that fire before TelephonyModule.onModuleInit() wires the
            //               callback are silently dropped (PoC limitation; non-deterministic race, low probability).
          },
          onLoseLease: () => {
            // No-op at module level; leader closes the WS internally in _loseLeadership().
          },
        });

        return leader;
      },
    },
  ],
  exports: [ARI_LEADER_TOKEN],
})
export class AriModule {}
```

- [ ] Step 8: Run `pnpm --filter @ncall/api test` → NATS spec GREEN; all other existing specs GREEN.

- [ ] Step 9: Commit:
  ```bash
  git add apps/api/package.json apps/api/src/nats/ apps/api/src/redis/ apps/api/src/ari/
  git commit -m "feat(api): NatsModule + NatsClientService + RedisModule + AriModule — global factory providers, NATS pub/sub (TDD)"
  ```

---

## Task T24 — `StasisStartHandler`: ARI StasisStart → NATS publish + DB insert (TDD: red→green)

**C5 fix:** `beforeAll` must insert the `queue` row before the handler test runs. **m1 fix (D16):** collapse DID double-query to two sequential queries (DID then account — single DID fetch with both `id` and `accountId`, no second DID lookup).

- [ ] Step 1: Add `setStasisStartCallback` method to `packages/ari-client/src/leader.ts` (already included in T22 implementation above via `setStasisStartCallback`). Verify the method exists — no separate step needed.

- [ ] Step 2: Write the failing test at `apps/api/src/telephony/stasis-start.handler.spec.ts` FIRST:

```ts
// RED: fails because StasisStartHandler does not exist.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { StasisStartHandler } from './stasis-start.handler';
import { DB_TOKEN } from '../database/database.module';
import { ARI_LEADER_TOKEN } from '../ari/ari.module';
import { NatsClientService } from '../nats/nats-client.service';
import { NATS_CLIENT_TOKEN } from '../nats/nats.module';
import { makeDb } from '@ncall/db/client';
import { tenant, account, did, call, queue, queueCall } from '@ncall/db';
import { NatsSubjects } from '@ncall/shared-types';
import { eq } from 'drizzle-orm';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const DID_ID = '33333333-3333-3333-3333-333333333333';
const QUEUE_ID = '77777777-7777-7777-7777-777777777777';

const makeStasisStartEvent = (channelId = 'test-channel-id') => ({
  channel: {
    id: channelId,
    dialplan: { context: 'ncall-inbound', exten: '+15555550100' },
    caller: { number: '+15555550200' },
  },
  application: 'ncall',
});

describe('StasisStartHandler', () => {
  let handler: StasisStartHandler;
  let module: TestingModule;
  let db: ReturnType<typeof makeDb>;

  const mockPublish = vi.fn();
  const mockNc = {
    publish: (sub: string, data: Uint8Array) => {
      mockPublish(sub, JSON.parse(new TextDecoder().decode(data)));
    },
    subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
  };
  const mockAriLeader = {
    start: vi.fn(),
    setStasisStartCallback: vi.fn(),
  };

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);

    // Seed minimum data — ORDER MATTERS (FK dependencies)
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo-tenant' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Demo Account' }).onConflictDoNothing();
    await db.insert(did).values({ id: DID_ID, accountId: ACCOUNT_ID, e164: '+15555550100' }).onConflictDoNothing();
    // C5 fix: insert queue row before handler runs — queueCall references queue.id
    await db.insert(queue).values({
      id: QUEUE_ID,
      accountId: ACCOUNT_ID,
      name: 'main',
      strategy: 'fifo',
    }).onConflictDoNothing();

    module = await Test.createTestingModule({
      providers: [
        StasisStartHandler,
        { provide: DB_TOKEN, useValue: db },
        { provide: NATS_CLIENT_TOKEN, useValue: mockNc },
        NatsClientService,
        { provide: ARI_LEADER_TOKEN, useValue: mockAriLeader },
      ],
    }).compile();

    handler = module.get(StasisStartHandler);
  });

  afterAll(async () => {
    await module.close();
  });

  it('on StasisStart: publishes NATS stasis_start and inserts call + queue_call with tenant_id', async () => {
    const channelId = `channel-${Date.now()}`;
    const event = makeStasisStartEvent(channelId);

    await handler.handleStasisStart(event as any);

    expect(mockPublish).toHaveBeenCalledWith(
      NatsSubjects.STASIS_START,
      expect.objectContaining({
        callId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        channel: channelId,
        tenantId: TENANT_ID,
        accountId: ACCOUNT_ID,
      }),
    );

    const publishedPayload = mockPublish.mock.calls[0][1] as { callId: string };
    const [callRow] = await db.select().from(call).where(eq(call.id, publishedPayload.callId));
    expect(callRow).toBeDefined();
    expect(callRow.tenantId).toBe(TENANT_ID);
    expect(callRow.fromE164).toBe('+15555550200');

    const [qcRow] = await db.select().from(queueCall).where(eq(queueCall.callId, publishedPayload.callId));
    expect(qcRow).toBeDefined();
    expect(qcRow.tenantId).toBe(TENANT_ID);
  });
});
```

- [ ] Step 3: Run `pnpm --filter @ncall/api test` → RED (StasisStartHandler not found).

- [ ] Step 4: Create `apps/api/src/telephony/stasis-start.handler.ts`:

```ts
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB_TOKEN } from '../database/database.module';
import { ARI_LEADER_TOKEN } from '../ari/ari.module';
import { NatsClientService } from '../nats/nats-client.service';
import { did, account, call, queueCall } from '@ncall/db';
import { NatsSubjects } from '@ncall/shared-types';
import type { NatsStasisStartPayload } from '@ncall/shared-types';
import type { Db } from '@ncall/db/client';
import type { AriLeaderClient, StasisStartEvent } from '@ncall/ari-client';

// Seeded queue ID — single-queue strategy for PoC (Chunk 6 adds dynamic routing)
const SEEDED_QUEUE_ID = '77777777-7777-7777-7777-777777777777';

@Injectable()
export class StasisStartHandler implements OnModuleInit {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @Inject(ARI_LEADER_TOKEN) private readonly ariLeader: AriLeaderClient,
    private readonly nats: NatsClientService,
  ) {}

  onModuleInit(): void {
    this.ariLeader.setStasisStartCallback((event) => void this.handleStasisStart(event));
    this.ariLeader.start();
  }

  async handleStasisStart(event: StasisStartEvent): Promise<void> {
    const calledE164 = event.channel.dialplan.exten;
    const callerE164 = event.channel.caller.number;
    const channelId = event.channel.id;

    // D16: two sequential queries — DID fetch (id + accountId), then account fetch (tenantId).
    // Avoids original double-DID-query defect while remaining simple and readable at single-row scale.
    const [didRow] = await this.db
      .select({
        id: did.id,
        accountId: did.accountId,
      })
      .from(did)
      .where(eq(did.e164, calledE164))
      .limit(1);

    if (!didRow) {
      console.error(`StasisStartHandler: no DID found for ${calledE164} — ignoring event`);
      return;
    }

    const [accountRow] = await this.db
      .select({ tenantId: account.tenantId })
      .from(account)
      .where(eq(account.id, didRow.accountId))
      .limit(1);

    if (!accountRow) {
      console.error(`StasisStartHandler: no account found for ${didRow.accountId} — ignoring event`);
      return;
    }

    const tenantId = accountRow.tenantId;
    const accountId = didRow.accountId;
    const didId = didRow.id;

    const [callRow] = await this.db
      .insert(call)
      .values({
        tenantId,
        accountId,
        didId,
        fromE164: callerE164,
        startedAt: new Date(),
      })
      .returning({ id: call.id });

    const callId = callRow.id;

    await this.db.insert(queueCall).values({
      tenantId,
      queueId: SEEDED_QUEUE_ID,
      callId,
      enqueuedAt: new Date(),
    });

    const payload: NatsStasisStartPayload = {
      callId,
      channel: channelId,
      tenantId,
      accountId,
    };
    this.nats.publish(NatsSubjects.STASIS_START, payload);
  }
}
```

- [ ] Step 5: Create `apps/api/src/telephony/telephony.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { StasisStartHandler } from './stasis-start.handler';
import { NatsModule } from '../nats/nats.module';
import { AriModule } from '../ari/ari.module';

@Module({
  imports: [NatsModule, AriModule],
  providers: [StasisStartHandler],
  exports: [StasisStartHandler],
})
export class TelephonyModule {}
```

- [ ] Step 6: Run `pnpm --filter @ncall/api test` → StasisStartHandler spec GREEN; all prior GREEN.

- [ ] Step 7: Commit:
  ```bash
  git add packages/ari-client/src/leader.ts apps/api/src/telephony/
  git commit -m "feat(api): StasisStartHandler — two-query DID+account lookup (D16), call+queue_call insert with tenant_id, NATS publish; queue seed in beforeAll (TDD)"
  ```

---

## Task T25 — `ArbiterService` + `WsGateway`: NATS subscribe → pick operator → WS push (TDD: red→green)

**m4 fix:** Add `// TODO Chunk 6: populate from call row` on `callerE164: ''`.

- [ ] Step 1: Write the failing test for `ArbiterService` at `apps/api/src/arbiter/arbiter.service.spec.ts` FIRST:

```ts
// RED: fails because ArbiterService does not exist.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ArbiterService } from './arbiter.service';
import { NatsClientService } from '../nats/nats-client.service';
import { NATS_CLIENT_TOKEN } from '../nats/nats.module';
import { WsGateway } from '../ws/ws.gateway';
import type { WsIncomingCallPayload } from '@ncall/shared-types';

const SEEDED_OPERATOR_ID = '66666666-6666-6666-6666-666666666666';

describe('ArbiterService', () => {
  let arbiter: ArbiterService;
  let module: TestingModule;

  const mockWsGateway = { sendToOperator: vi.fn() };
  const mockNc = {
    publish: vi.fn(),
    subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        ArbiterService,
        NatsClientService,
        { provide: NATS_CLIENT_TOKEN, useValue: mockNc },
        { provide: WsGateway, useValue: mockWsGateway },
      ],
    }).compile();
    arbiter = module.get(ArbiterService);
  });

  afterAll(async () => { await module.close(); });

  it('dispatch: picks seeded operator, sends WS event with type=incoming_call', async () => {
    const stasisPayload = {
      callId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      channel: 'test-channel',
      tenantId: '11111111-1111-1111-1111-111111111111',
      accountId: '22222222-2222-2222-2222-222222222222',
    };

    await arbiter.dispatch(stasisPayload);

    expect(mockWsGateway.sendToOperator).toHaveBeenCalledWith(
      SEEDED_OPERATOR_ID,
      expect.objectContaining<Partial<WsIncomingCallPayload>>({
        type: 'incoming_call',
        callId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        tenantId: '11111111-1111-1111-1111-111111111111',
      }),
    );

    const [, wsPayload] = mockWsGateway.sendToOperator.mock.calls[0] as [string, WsIncomingCallPayload];
    expect(wsPayload.type).toBe('incoming_call');
    expect(wsPayload.callId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

- [ ] Step 2: Write the failing test for `WsGateway` at `apps/api/src/ws/ws.gateway.spec.ts` FIRST:

```ts
// RED: fails because WsGateway does not exist.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { WsGateway } from './ws.gateway';
import { WsEvents } from '@ncall/shared-types';
import type { WsIncomingCallPayload } from '@ncall/shared-types';

describe('WsGateway', () => {
  let gateway: WsGateway;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({ providers: [WsGateway] }).compile();
    gateway = module.get(WsGateway);
  });

  afterAll(async () => { await module.close(); });

  it('sendToOperator: sends event on open WS connection for that operator', () => {
    const OPERATOR_ID = '66666666-6666-6666-6666-666666666666';
    const mockSend = vi.fn();
    const mockSocket = { readyState: 1, send: mockSend } as any;

    gateway.registerConnection(OPERATOR_ID, mockSocket);

    const payload: WsIncomingCallPayload = {
      type: 'incoming_call',
      callId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      tenantId: '11111111-1111-1111-1111-111111111111',
      callerE164: '+15555550200',
    };

    gateway.sendToOperator(OPERATOR_ID, payload);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const sentMessage = JSON.parse(mockSend.mock.calls[0][0] as string);
    expect(sentMessage.event).toBe(WsEvents.CALL_SCREEN_POP);
    expect(sentMessage.data.type).toBe('incoming_call');
    expect(sentMessage.data.callId).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('sendToOperator: no-ops when operator has no connection', () => {
    expect(() => gateway.sendToOperator('no-such-operator', {
      type: 'incoming_call', callId: 'x', tenantId: 'y', callerE164: '+1',
    })).not.toThrow();
  });
});
```

- [ ] Step 3: Run `pnpm --filter @ncall/api test` → RED for both new specs.

- [ ] Step 4: Create `apps/api/src/ws/ws.gateway.ts`:

```ts
import { Injectable } from '@nestjs/common';
import * as jsonwebtoken from 'jsonwebtoken';
import type { WebSocket } from 'ws';
import { WsEvents } from '@ncall/shared-types';
import type { WsIncomingCallPayload } from '@ncall/shared-types';

@Injectable()
export class WsGateway {
  private readonly connections = new Map<string, WebSocket>();

  handleConnection(ws: WebSocket, token: string): void {
    const secret = process.env.APP_JWT_SECRET ?? 'poc-only-not-prod';
    try {
      const payload = jsonwebtoken.verify(token, secret) as {
        sub: string; tenantId: string; role: string;
      };
      const operatorId = payload.sub;
      this.connections.set(operatorId, ws);
      ws.on('close', () => { this.connections.delete(operatorId); });
    } catch {
      ws.close(4001, 'Unauthorized');
    }
  }

  registerConnection(operatorId: string, ws: WebSocket): void {
    this.connections.set(operatorId, ws);
  }

  sendToOperator(operatorId: string, payload: WsIncomingCallPayload): void {
    const ws = this.connections.get(operatorId);
    if (!ws || ws.readyState !== 1 /* OPEN */) return;
    ws.send(JSON.stringify({ event: WsEvents.CALL_SCREEN_POP, data: payload }));
  }
}
```

- [ ] Step 5: Create `apps/api/src/ws/ws.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { WsGateway } from './ws.gateway';

@Module({ providers: [WsGateway], exports: [WsGateway] })
export class WsModule {}
```

- [ ] Step 6: Create `apps/api/src/arbiter/arbiter.service.ts`:

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { NatsClientService } from '../nats/nats-client.service';
import { WsGateway } from '../ws/ws.gateway';
import { NatsSubjects } from '@ncall/shared-types';
import type { NatsStasisStartPayload, WsIncomingCallPayload } from '@ncall/shared-types';

/** Single seeded operator for Chunk 3 PoC. Chunk 6 replaces with FIFO heap + skill matching. */
const SEEDED_OPERATOR_ID = '66666666-6666-6666-6666-666666666666';

@Injectable()
export class ArbiterService implements OnModuleInit {
  constructor(
    private readonly nats: NatsClientService,
    private readonly wsGateway: WsGateway,
  ) {}

  onModuleInit(): void {
    this.nats.subscribe<NatsStasisStartPayload>(
      NatsSubjects.STASIS_START,
      (payload) => void this.dispatch(payload),
    );
  }

  async dispatch(payload: NatsStasisStartPayload): Promise<void> {
    const wsPayload: WsIncomingCallPayload = {
      type: 'incoming_call',
      callId: payload.callId,
      tenantId: payload.tenantId,
      callerE164: '', // TODO Chunk 6: populate from call row
    };
    this.wsGateway.sendToOperator(SEEDED_OPERATOR_ID, wsPayload);
  }
}
```

- [ ] Step 7: Create `apps/api/src/arbiter/arbiter.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ArbiterService } from './arbiter.service';
import { NatsModule } from '../nats/nats.module';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [NatsModule, WsModule],
  providers: [ArbiterService],
  exports: [ArbiterService],
})
export class ArbiterModule {}
```

- [ ] Step 8: Run `pnpm --filter @ncall/api test` → ArbiterService + WsGateway specs GREEN; all prior GREEN.

- [ ] Step 9: Commit:
  ```bash
  git add apps/api/src/arbiter/ apps/api/src/ws/
  git commit -m "feat(api): ArbiterService + WsGateway — NATS STASIS_START subscribe → seeded operator WS push, payload.type='incoming_call' (TDD)"
  ```

---

## Task T26 — `RecordingService`: MixMonitor → MinIO placeholder + `recording` row with `tenant_id` (TDD: red→green)

- [ ] Step 1: Write the failing test at `apps/api/src/recording/recording.service.spec.ts` FIRST:

```ts
// RED: fails because RecordingService does not exist.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { RecordingService } from './recording.service';
import { DB_TOKEN } from '../database/database.module';
import { makeDb } from '@ncall/db/client';
import { tenant, account, did, call, recording } from '@ncall/db';
import { eq } from 'drizzle-orm';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const DID_ID = '33333333-3333-3333-3333-333333333333';
const CALL_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('RecordingService', () => {
  let service: RecordingService;
  let module: TestingModule;
  let db: ReturnType<typeof makeDb>;

  const mockMinioClient = {
    putObject: vi.fn().mockResolvedValue({ etag: 'abc', versionId: null }),
    bucketExists: vi.fn().mockResolvedValue(true),
    makeBucket: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo-tenant' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Demo Account' }).onConflictDoNothing();
    await db.insert(did).values({ id: DID_ID, accountId: ACCOUNT_ID, e164: '+15555550100' }).onConflictDoNothing();
    await db.insert(call).values({
      id: CALL_ID,
      tenantId: TENANT_ID,
      accountId: ACCOUNT_ID,
      didId: DID_ID,
      fromE164: '+15555550200',
      startedAt: new Date(),
    }).onConflictDoNothing();

    module = await Test.createTestingModule({
      providers: [
        RecordingService,
        { provide: DB_TOKEN, useValue: db },
        { provide: 'MINIO_CLIENT', useValue: mockMinioClient },
      ],
    }).compile();
    service = module.get(RecordingService);
  });

  afterAll(async () => { await module.close(); });

  it('startRecording: inserts recording row with correct tenant_id and uploads placeholder to MinIO', async () => {
    await service.startRecording({ callId: CALL_ID, channelId: 'test-channel', tenantId: TENANT_ID });

    const [rec] = await db.select().from(recording).where(eq(recording.callId, CALL_ID));
    expect(rec).toBeDefined();
    expect(rec.tenantId).toBe(TENANT_ID);
    expect(rec.path).toBe(`recordings/${CALL_ID}.wav`);
    expect(rec.startedAt).toBeInstanceOf(Date);

    expect(mockMinioClient.putObject).toHaveBeenCalledWith(
      'ncall-recordings',
      `recordings/${CALL_ID}.wav`,
      expect.any(Buffer),
    );
  });
});
```

- [ ] Step 2: Run `pnpm --filter @ncall/api test` → RED (RecordingService not found).

- [ ] Step 3: Create `apps/api/src/recording/recording.service.ts`:

```ts
import { Injectable, Inject } from '@nestjs/common';
import { DB_TOKEN } from '../database/database.module';
import { recording } from '@ncall/db';
import type { Db } from '@ncall/db/client';
import type { Client as MinioClient } from 'minio';

const MINIO_BUCKET = 'ncall-recordings';

export interface StartRecordingParams {
  callId: string;
  channelId: string;
  tenantId: string;
}

@Injectable()
export class RecordingService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @Inject('MINIO_CLIENT') private readonly minio: MinioClient,
  ) {}

  async startRecording(params: StartRecordingParams): Promise<void> {
    const { callId, tenantId } = params;
    const path = `recordings/${callId}.wav`;

    const exists = await this.minio.bucketExists(MINIO_BUCKET);
    if (!exists) {
      await this.minio.makeBucket(MINIO_BUCKET, 'us-east-1');
    }

    // Upload zero-byte placeholder so statObject assertions in integration test succeed.
    // Actual WAV bytes are written by Asterisk MixMonitor; final upload is Chunk 6/7 concern.
    await this.minio.putObject(MINIO_BUCKET, path, Buffer.alloc(0));

    await this.db.insert(recording).values({
      tenantId,
      callId,
      path,
      startedAt: new Date(),
    });
  }
}
```

- [ ] Step 4: Create `apps/api/src/recording/recording.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { RecordingService } from './recording.service';
import { Client as MinioClient } from 'minio';

@Module({
  providers: [
    RecordingService,
    {
      provide: 'MINIO_CLIENT',
      useFactory: () =>
        new MinioClient({
          endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
          port: Number(process.env.MINIO_PORT ?? 9000),
          useSSL: false,
          accessKey: process.env.MINIO_ACCESS_KEY ?? 'ncall',
          secretKey: process.env.MINIO_SECRET_KEY ?? 'ncall1234',
        }),
    },
  ],
  exports: [RecordingService],
})
export class RecordingModule {}
```

- [ ] Step 5: Wire `RecordingService` into `StasisStartHandler`. Add to `apps/api/src/telephony/stasis-start.handler.ts`:

```ts
// Add to imports:
import { RecordingService } from '../recording/recording.service';

// Add to constructor:
private readonly recordingService: RecordingService,

// Add inside handleStasisStart after queueCall insert:
await this.recordingService.startRecording({ callId, channelId, tenantId });
```

- [ ] Step 6: Update `apps/api/src/app.module.ts`:

```ts
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AccountModule } from './account/account.module';
import { ContactModule } from './contact/contact.module';
import { FormModule } from './form/form.module';
import { MessageModule } from './message/message.module';
import { NatsModule } from './nats/nats.module';
import { RedisModule } from './redis/redis.module';
import { AriModule } from './ari/ari.module';
import { TelephonyModule } from './telephony/telephony.module';
import { ArbiterModule } from './arbiter/arbiter.module';
import { WsModule } from './ws/ws.module';
import { RecordingModule } from './recording/recording.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    NatsModule,
    RedisModule,
    AriModule,
    AccountModule,
    ContactModule,
    FormModule,
    MessageModule,
    TelephonyModule,
    ArbiterModule,
    WsModule,
    RecordingModule,
  ],
})
export class AppModule {}
```

- [ ] Step 7: Modify `apps/api/src/main.ts` — add WS upgrade handler:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsGateway } from './ws/ws.gateway';
import { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');

  const httpServer = await app.listen(process.env.PORT ?? 3000);
  const wss = new WebSocketServer({ noServer: true });
  const wsGateway = app.get(WsGateway);

  httpServer.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
    const url = new URL(request.url ?? '', `http://${request.headers.host}`);
    if (url.pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const token = url.searchParams.get('token') ?? '';
        wsGateway.handleConnection(ws, token);
      });
    } else {
      socket.destroy();
    }
  });

  console.log(`API listening on port ${process.env.PORT ?? 3000} (WS on /ws)`);
}

bootstrap();
```

- [ ] Step 8: Run `pnpm --filter @ncall/api test` → RecordingService spec GREEN; full suite GREEN.

- [ ] Step 9: Run `pnpm --filter @ncall/api typecheck` → exits 0.

- [ ] Step 10: Commit:
  ```bash
  git add apps/api/src/recording/ apps/api/src/app.module.ts apps/api/src/main.ts \
          apps/api/src/telephony/stasis-start.handler.ts
  git commit -m "feat(api): RecordingService — MinIO placeholder upload, recording row with tenant_id; WsGateway HTTP upgrade wiring (TDD)"
  ```

---

## Task T27 — Integration test `chunk3-smoke.spec.ts` + `make poc-test-chunk3` (TDD: integration red→green gate)

**C1 fix:** Replace `cdreis/sipp:latest` with `drachtio/sipp@sha256:a47d473...` (pinned digest).
**C2/D17 fix:** Use `host.docker.internal:5060` (published port from D17) with `--platform linux/amd64`.
**C3/D18 fix:** Use `spawn` (not `execSync`); measure NATS→WS latency only.
**C4 fix:** Do NOT replace `apps/api/vitest.config.ts`. Only ADD the `@ncall/ari-client` alias to the existing file.

> **STOP-on-port-conflict guidance:** The integration test sends UDP SIP traffic to port 5060 (published from Kamailio per D17). If port 5060 is already in use on the host, STOP and report BLOCKED. Do NOT kill the conflicting process.

- [ ] Step 1: **ADD alias only** to existing `apps/api/vitest.config.ts`. The existing file has the `unplugin-swc` plugin block with `decoratorMetadata: true` — this MUST be preserved. Only add the `@ncall/ari-client` alias entry.

  **Old content** (current file — verified by live probe):
  ```ts
  import { defineConfig } from 'vitest/config';
  import { resolve } from 'path';
  import swc from 'unplugin-swc';

  export default defineConfig({
    plugins: [
      swc.vite({
        module: { type: 'es6' },
        jsc: {
          parser: {
            syntax: 'typescript',
            decorators: true,
          },
          transform: {
            legacyDecorator: true,
            decoratorMetadata: true,
          },
        },
      }),
    ],
    test: {
      globals: true,
      globalSetup: './test/vitest.globalSetup.ts',
      include: ['src/**/*.spec.ts'],
      alias: {
        '@ncall/db/client': resolve(__dirname, '../../packages/db/src/client.ts'),
        '@ncall/db': resolve(__dirname, '../../packages/db/src/schema/index.ts'),
        '@ncall/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      },
    },
  });
  ```

  **New content** (add one alias line, preserve everything else):
  ```ts
  import { defineConfig } from 'vitest/config';
  import { resolve } from 'path';
  import swc from 'unplugin-swc';

  export default defineConfig({
    plugins: [
      swc.vite({
        module: { type: 'es6' },
        jsc: {
          parser: {
            syntax: 'typescript',
            decorators: true,
          },
          transform: {
            legacyDecorator: true,
            decoratorMetadata: true,
          },
        },
      }),
    ],
    test: {
      globals: true,
      globalSetup: './test/vitest.globalSetup.ts',
      include: ['src/**/*.spec.ts'],
      alias: {
        '@ncall/db/client': resolve(__dirname, '../../packages/db/src/client.ts'),
        '@ncall/db': resolve(__dirname, '../../packages/db/src/schema/index.ts'),
        '@ncall/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
        '@ncall/ari-client': resolve(__dirname, '../../packages/ari-client/src/index.ts'),
      },
    },
  });
  ```

  Use the Edit tool (`old_string` / `new_string`) on `apps/api/vitest.config.ts` — do NOT use Write (which would overwrite the file). The only change is adding the `@ncall/ari-client` alias line.

- [ ] Step 2: Create `apps/api/vitest.integration.config.ts` (separate config for integration tests — does NOT need the swc plugin since integration tests don't use NestJS decorators directly):

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/integration/**/*.spec.ts'],
    testTimeout: 30000,
    alias: {
      '@ncall/db/client': resolve(__dirname, '../../packages/db/src/client.ts'),
      '@ncall/db': resolve(__dirname, '../../packages/db/src/schema/index.ts'),
      '@ncall/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
    },
  },
});
```

- [ ] Step 3: Create `apps/api/test/integration/chunk3-smoke.spec.ts`:

```ts
/**
 * Chunk 3 integration smoke test.
 * @requires-compose — requires `make poc-up`, `make poc-seed`, and `make api-dev` running.
 * Run via: `make poc-test-chunk3`
 *
 * Exit criterion verification (spec lines 111–115):
 * - SIPp INVITE → NATS `stasis_start` message received
 * - WS `call.screenpop` event with `type='incoming_call'` received
 * - NATS→WS chain latency < 800 ms (ADR-0024 budget for queue dequeue latency)
 * - `recording` row has correct `tenant_id` in DB
 * - `queue_call` row has correct `tenant_id` in DB
 * - MinIO object exists at `recordings/<callId>.wav`
 *
 * SIPp image: drachtio/sipp@sha256:a47d473051b8686a68143f36c539acdbefb620bb88ebcfd9e8ee44335a38eca4
 * (amd64-only image; --platform linux/amd64 required on arm64 macOS).
 * Kamailio SIP port published to host via ${KAMAILIO_SIP_HOST_PORT:-5060} (D17).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, StringCodec } from 'nats';
import WebSocket from 'ws';
import { spawn } from 'child_process';
import * as pg from 'postgres';
import * as Minio from 'minio';

const SEEDED_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SEEDED_OPERATOR_ID = '66666666-6666-6666-6666-666666666666';

const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222';
const DB_URL = process.env.DATABASE_URL ?? 'postgres://ncall.ncall:ncall@localhost:6543/ncall';
const API_WS_URL = 'ws://localhost:3000/ws';
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? 'localhost';
const MINIO_PORT = Number(process.env.MINIO_PORT ?? 9000);
const KAMAILIO_SIP_PORT = process.env.KAMAILIO_SIP_HOST_PORT ?? '5060';

// SIPp image pinned to digest (amd64-only; --platform linux/amd64 for arm64 macOS).
// Tag: drachtio/sipp:latest (only tag published; last updated 2018-07-08 — stable).
const SIPP_IMAGE = 'drachtio/sipp@sha256:a47d473051b8686a68143f36c539acdbefb620bb88ebcfd9e8ee44335a38eca4';

function mintOperatorJwt(): string {
  const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
  return jwt.sign(
    { sub: SEEDED_OPERATOR_ID, tenantId: SEEDED_TENANT_ID, role: 'operator' },
    process.env.APP_JWT_SECRET ?? 'poc-only-not-prod',
    { expiresIn: '1h' },
  );
}

/** Wait for a single NATS message on subject, resolve with decoded payload. Times out after `timeoutMs`. */
function waitForNatsMessage(nc: Awaited<ReturnType<typeof connect>>, subject: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.unsubscribe();
      reject(new Error(`NATS timeout: no message on '${subject}' within ${timeoutMs}ms`));
    }, timeoutMs);

    const sc = StringCodec();
    const sub = nc.subscribe(subject, {
      callback: (_err, msg) => {
        if (msg) {
          clearTimeout(timer);
          sub.unsubscribe();
          resolve(JSON.parse(sc.decode(msg.data)));
        }
      },
    });
  });
}

/** Wait for a WS message matching predicate, resolve with parsed data. Times out after `timeoutMs`. */
function waitForWsEvent(ws: WebSocket, predicate: (parsed: any) => boolean, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`WS timeout: no matching event within ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(data: any) {
      const parsed = JSON.parse(data.toString());
      if (predicate(parsed)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(parsed.data);
      }
    }
    ws.on('message', handler);
  });
}

describe('Chunk 3 smoke — SIPp INVITE → NATS + WS + DB + MinIO', () => {
  let nc: Awaited<ReturnType<typeof connect>>;
  let ws: WebSocket;
  let sql: ReturnType<typeof pg.default>;
  let minio: Minio.Client;

  beforeAll(async () => {
    nc = await connect({ servers: NATS_URL });
    ws = new WebSocket(`${API_WS_URL}?token=${mintOperatorJwt()}`);
    await new Promise<void>((res, rej) => {
      ws.on('open', res);
      ws.on('error', rej);
    });
    sql = pg.default(DB_URL);
    minio = new Minio.Client({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'ncall',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'ncall1234',
    });
  });

  afterAll(async () => {
    ws.close();
    await nc.drain();
    await sql.end();
  });

  it(
    'SIPp INVITE fires: NATS stasis_start + WS incoming_call; NATS→WS latency < 800ms; DB rows tenant_id; MinIO object exists',
    async () => {
      // Set up listeners BEFORE firing SIPp (so no events are missed)
      const natsPromise = waitForNatsMessage(nc, 'ncall.stasis.start', 15000);
      const wsPromise = waitForWsEvent(
        ws,
        (parsed) => parsed.event === 'call.screenpop' && parsed.data?.type === 'incoming_call',
        15000,
      );

      // Fire SIPp asynchronously via spawn (D18: do NOT block with execSync).
      // --platform linux/amd64: drachtio/sipp is amd64-only; Rosetta handles on arm64 macOS.
      // host.docker.internal: resolves to macOS host IP from inside Docker Desktop container (D17).
      const sippArgs = [
        'run', '--rm', '--platform', 'linux/amd64',
        SIPP_IMAGE,
        '-sn', 'uac',
        '-d', '2000',
        '-m', '1',
        '-r', '1',
        '-rp', '1000',
        '-s', '+15555550100',
        `host.docker.internal:${KAMAILIO_SIP_PORT}`,
      ];
      const sippProc = spawn('docker', sippArgs, { stdio: 'pipe' });
      sippProc.on('error', (err) => {
        // Non-fatal: SIPp process error is reported but does not block the race.
        // The race will time out if SIPp never fires the INVITE.
        console.error('SIPp spawn error:', err);
      });

      // D18: measure NATS→WS chain latency only.
      // Wait for NATS message first, then measure time until WS arrives.
      const natsPayload = await natsPromise;
      const t0 = Date.now();
      const wsPayload = await wsPromise;
      const elapsedNatsToWs = Date.now() - t0;

      // Wait for SIPp to exit (cleanup — do not block assertions on this)
      const sippExitPromise = new Promise<void>((resolve) => sippProc.on('close', () => resolve()));

      // WS payload assertions (spec exit criterion line 113)
      expect(wsPayload.type).toBe('incoming_call');
      expect(wsPayload.callId).toMatch(/^[0-9a-f-]{36}$/);
      expect(wsPayload.tenantId).toBe(SEEDED_TENANT_ID);

      // ADR-0024 NATS→WS latency budget
      expect(elapsedNatsToWs).toBeLessThan(800);

      // NATS payload assertions
      expect(natsPayload.tenantId).toBe(SEEDED_TENANT_ID);
      expect(natsPayload.callId).toMatch(/^[0-9a-f-]{36}$/);

      const callId = natsPayload.callId as string;

      // DB: queue_call row with tenant_id (spec exit criterion line 114)
      const [qcRow] = await sql`
        SELECT tenant_id FROM queue_call WHERE call_id = ${callId}
      `;
      expect(qcRow).toBeDefined();
      expect(qcRow.tenant_id).toBe(SEEDED_TENANT_ID);

      // DB: recording row with tenant_id (spec exit criterion line 114)
      const [recRow] = await sql`
        SELECT tenant_id, path FROM recording WHERE call_id = ${callId}
      `;
      expect(recRow).toBeDefined();
      expect(recRow.tenant_id).toBe(SEEDED_TENANT_ID);

      // MinIO: recording placeholder object exists (spec exit criterion line 114)
      await expect(
        minio.statObject('ncall-recordings', `recordings/${callId}.wav`),
      ).resolves.toBeDefined();

      // Cleanup: wait for SIPp to finish
      await sippExitPromise;
    },
    30000,
  );
});
```

- [ ] Step 4: Add `poc-test-chunk3` target to `Makefile`:

```makefile
# Run Chunk 3 integration smoke test.
# Requires: make poc-up + make poc-seed + make api-dev running in another terminal.
# SIPp sends UDP to Kamailio on host port ${KAMAILIO_SIP_HOST_PORT:-5060}.
# STOP-on-conflict: if port 5060 is in use, set KAMAILIO_SIP_HOST_PORT=5061 (or another free port).
poc-test-chunk3:
	DATABASE_URL=postgres://ncall.ncall:ncall@localhost:6543/ncall \
	NATS_URL=nats://localhost:4222 \
	APP_JWT_SECRET=poc-only-not-prod \
	pnpm --filter @ncall/api exec vitest run --config vitest.integration.config.ts
```

- [ ] Step 5: Verify RED before full wiring:
  ```bash
  make poc-up && make poc-seed
  # Do NOT start api-dev yet
  make poc-test-chunk3
  ```
  Expected: FAIL with WS connection refused (API not running) — confirms test is properly gated.

- [ ] Step 6: Start the full stack and verify GREEN:
  ```bash
  make api-dev &  # Start API on host
  make poc-test-chunk3
  ```
  Expected: PASS, 1/1.

- [ ] Step 7: Commit:
  ```bash
  git add apps/api/test/integration/chunk3-smoke.spec.ts \
          apps/api/vitest.config.ts \
          apps/api/vitest.integration.config.ts \
          Makefile
  git commit -m "feat(api): chunk3-smoke integration — SIPp→NATS→WS within 800ms (NATS→WS chain), tenant_id asserts, MinIO check; drachtio/sipp pinned to digest"
  ```

---

## Task T28 — Manual smoke runbook `poc/smoke-chunk3.md`

**C1 fix:** Replace `cdreis/sipp:latest` with pinned `drachtio/sipp@sha256:...` + `--platform linux/amd64`.
**C2/D17 fix:** Use `host.docker.internal:5060` (not `localhost:5060`).

**No TDD — documentation task.**

- [ ] Step 1: Create `poc/smoke-chunk3.md`:

```markdown
# Chunk 3 Smoke Runbook

> **Goal:** Manually verify that a SIPp INVITE through the compose stack fires a StasisStart,
> the NestJS arbiter picks the seeded operator, and a WebSocket `incoming_call` event arrives.
> Also verifies `recording` + `queue_call` rows have `tenant_id` and MinIO has the object.

## Prerequisites

- All compose services healthy: `make poc-up` exits 0
- Seed data present: `make poc-seed` exits 0
- API running on host: `make api-dev` running in a terminal (port 3000)
- Kamailio SIP port 5060 published to host (via T21-ports — env-overridable as `KAMAILIO_SIP_HOST_PORT`)

## Step 1: Verify compose health

```bash
docker compose -f infra/docker-compose.yml ps
```

Expected: All services show `healthy` (or `Exit 0` for `supavisor-migrate`).

## Step 2: Connect a WebSocket client

```bash
TOKEN=$(make poc-jwt)
wscat -c "ws://localhost:3000/ws?token=$TOKEN"
# Alternative: websocat "ws://localhost:3000/ws?token=$TOKEN"
```

Expected: connection opens (no output yet).

## Step 3: Send a SIPp INVITE

```bash
docker run --rm \
  --platform linux/amd64 \
  drachtio/sipp@sha256:a47d473051b8686a68143f36c539acdbefb620bb88ebcfd9e8ee44335a38eca4 \
  -sn uac \
  -d 2000 \
  -m 1 \
  -r 1 \
  -rp 1000 \
  -s +15555550100 \
  host.docker.internal:${KAMAILIO_SIP_HOST_PORT:-5060}
```

Notes:
- `--platform linux/amd64`: drachtio/sipp is amd64-only; required on arm64 macOS.
- `host.docker.internal`: resolves to the macOS host IP from inside Docker Desktop containers.
- If port 5060 is in use: `KAMAILIO_SIP_HOST_PORT=5061 make poc-up` to remap.

Expected: SIPp exits 0 (1 call completed).

## Step 4: Observe the WebSocket event

In the wscat terminal, within ~800 ms of the INVITE:

```json
{"event":"call.screenpop","data":{"type":"incoming_call","callId":"<uuid>","tenantId":"11111111-1111-1111-1111-111111111111","callerE164":""}}
```

Assert:
- `data.type === "incoming_call"` ✓
- `data.callId` matches UUID v4 pattern ✓
- `data.tenantId === "11111111-1111-1111-1111-111111111111"` ✓

## Step 5: Check NATS

```bash
# Run BEFORE the INVITE to observe:
nats sub ncall.stasis.start --server nats://localhost:4222
```

Expected: JSON payload with `callId`, `tenantId`, `channel`, `accountId`.

## Step 6: Verify DB rows

```bash
CALL_ID=<paste-callId-here>

psql postgres://ncall.ncall:ncall@localhost:6543/ncall -c \
  "SELECT id, tenant_id, call_id, enqueued_at FROM queue_call WHERE call_id = '$CALL_ID';"
# Expected: 1 row, tenant_id = '11111111-1111-1111-1111-111111111111'

psql postgres://ncall.ncall:ncall@localhost:6543/ncall -c \
  "SELECT id, tenant_id, path, started_at FROM recording WHERE call_id = '$CALL_ID';"
# Expected: 1 row, tenant_id = '11111111-1111-1111-1111-111111111111', path = 'recordings/<callId>.wav'
```

## Step 7: Verify MinIO object

```bash
mc alias set local http://localhost:9000 ncall ncall1234
mc stat local/ncall-recordings/recordings/$CALL_ID.wav
```

Expected: object exists (size 0 — placeholder; actual WAV populated by Chunk 7).

## Step 8: Debug attach points

- VS Code "Attach to API" (port 9229): set breakpoint in `stasis-start.handler.ts:handleStasisStart`. Fire another INVITE. Breakpoint should hit.
- NATS visible: `nats server check connection --server nats://localhost:4222` → OK
- Redis visible: `redis-cli -p 6379 keys 'ncall:ari-leader:*'` → lease key present

## Success criteria

- [ ] WS event received within 800 ms ✓
- [ ] `event.type === 'incoming_call'` ✓
- [ ] `event.callId` UUID v4 ✓
- [ ] `event.tenantId === '11111111-1111-1111-1111-111111111111'` ✓
- [ ] `queue_call` row with correct `tenant_id` ✓
- [ ] `recording` row with correct `tenant_id` ✓
- [ ] MinIO object exists ✓
```

- [ ] Step 2: Commit:
  ```bash
  git add poc/smoke-chunk3.md
  git commit -m "docs: poc/smoke-chunk3.md — manual smoke runbook for Chunk 3 telephony wiring"
  ```

---

## Exit criteria checklist

- [ ] `packages/ari-client` unit test: 3/3 GREEN — callback path verified, split-brain guard verified (`pnpm --filter @ncall/ari-client test`)
- [ ] `pnpm --filter @ncall/api test` GREEN (all unit specs, no compose needed)
- [ ] `pnpm --filter @ncall/db typecheck` GREEN after migration 0004 schema changes
- [ ] `pnpm --filter @ncall/api typecheck` GREEN
- [ ] Migration 0004 SQL: `tenant_id` on `recording` + `queue_call` with backfill DEFAULT + DROP DEFAULT; FK on `queue_call.call_id`
- [ ] `make poc-test-chunk3` GREEN: SIPp INVITE → NATS `stasis_start` + WS `incoming_call`; NATS→WS latency < 800 ms; `event.type === 'incoming_call'`; `event.callId` UUID v4; `event.tenantId === seeded-tenant-id`
- [ ] `queue_call` row has `tenant_id = '11111111-...'` (integration test asserts)
- [ ] `recording` row has `tenant_id = '11111111-...'` (integration test asserts)
- [ ] MinIO object `recordings/<callId>.wav` exists (integration test asserts via `statObject`)
- [ ] VS Code "Attach to API" (port 9229) + NATS visible on `localhost:4222` + Redis lease key visible
- [ ] `poc/smoke-chunk3.md` committed

---

## Commit checkpoint

```bash
git log --oneline -10
# Verify 8 commits present:
# T20-cleanup, T21m, T21-ports, T22, T23, T24, T25, T26, T27, T28
```

---

## References

- `pot/S3-ari-leader-hard-stop/leader/index.js` — lease loop shape, `loseLeadership` `process.nextTick` pattern
- `pot/S3-ari-leader-hard-stop/leader/package.json` — `ari-client@^2.2.0`, `ioredis@^5.4.1` pinning

---

## Self-critique

### What changed from v2

- **N1 closed:** Added `"postgres": "3.4.4"` to `apps/api` devDependencies in T23 Step 3. Version matches `packages/db/package.json` exactly (live-verified: `npm view postgres@3.4.4 version` → `3.4.4`). Added explanatory note in T23 Step 3 documenting why: pnpm@8 does not hoist the package, the integration test imports it directly.
- **N2 closed:** Added `"@types/ws": "^8.18.1"` to `apps/api` devDependencies in T23 Step 3. Version `8.18.1` is the latest 8.x on npm (live-verified: latest candidates `8.5.12, 8.5.13, 8.5.14, 8.18.0, 8.18.1`). Added explanatory note documenting why: `ws@8.x` ships no types field.
- **n1 closed (1a chosen):** D16 reworded from "single collapsed JOIN query" to "two sequential queries (DID then account)." Matches T24 implementation exactly. T24 commit message updated to say "two-query DID+account lookup (D16)". D16 now explicitly states why two sequential queries are preferred at PoC scale.
- **n2 closed (2a chosen):** Removed `"@nestjs/platform-ws": "10.3.8"` and `"@nestjs/websockets": "10.3.8"` from T23 Step 3 devDependencies additions. D8 reworded to drop "Use `@nestjs/platform-ws` raw ws adapter" phrasing — D8 now says "plain NestJS injectable using the raw `ws` Node.js library and a custom HTTP upgrade handler in `main.ts` — no `@nestjs/platform-ws` or `@nestjs/websockets` packages needed for this PoC." File map T23 annotation updated to reflect the final package.json intent.

### Remaining weaknesses

1. **`host.docker.internal` on Linux** (carried from v2). Docker Engine on Linux requires `--add-host host.docker.internal:host-gateway`; the integration test command does not add this. Chunk 5 CI will need a Linux-specific networking mode. Flagged in v2 weakness list; not changed because the instruction prohibits re-litigating prior decisions.
2. **`postgres` package import style.** `import * as pg from 'postgres'; pg.default(...)` assumes the CommonJS interop shape of the `postgres` ESM package. If the test runner resolves it as a pure ESM module, `pg.default` may be `undefined`. This is a known `postgres` interop quirk; the workaround is `import postgres from 'postgres'` (default import). The plan uses `pg.default(...)` which is the safe CJS-interop form but could silently be wrong in a fully-ESM context. Low risk for this vitest config (no `"type": "module"` in `apps/api`).
3. **Migration 0004 manual edit** (carried from v2). Human failure point: if the implementer forgets to add DEFAULT/DROP DEFAULT, migration fails on non-empty tables. Documented in T21m Step 5.
4. **`@types/ws` version range `^8.18.1` vs. `ws@^8.20.1`.** `@types/ws` types for `8.18.x` should cover `ws@8.20.x` API — the ws 8.x API is stable. If a breaking API was added in ws 8.19+ without corresponding types update, `pnpm typecheck` could fail with a type mismatch on the new API. This is extremely unlikely for ws (the API has been frozen for years), but is an assumption.

### Assumptions

1. `postgres@3.4.4` is available on npm — live-verified: `npm view postgres@3.4.4 version` → `3.4.4`. ✓
2. `@types/ws@8.18.1` is available on npm — live-verified: npm returned it as latest 8.x candidate. ✓
3. `ws@8.x` API shape covered by `@types/ws@8.18.1` — no new APIs added in `8.19`–`8.20.1` that require type updates (reasonable assumption; ws API is stable).
4. pnpm@8 does NOT hoist `postgres` from `packages/db` to `apps/api` scope — verifier-v2 live-verified this via filesystem probe (absent from workspace root `node_modules/`). ✓
5. Removing `@nestjs/platform-ws` and `@nestjs/websockets` from devDependencies does not cause any import-time error in existing or new files — confirmed: grep of all implementation files shows zero imports from either package.

**Confidence: 92**

Calibration: The v2 architecture was verifier-confirmed sound at 82 confidence with two MAJOR defects (missing npm packages) and two MINOR defects (wording mismatches). All four are closed in v3 with live-probe evidence: `postgres@3.4.4` npm-verified, `@types/ws@8.18.1` npm-verified, D16 reworded to match T24 two-query implementation, D8 reworded to drop the dead `@nestjs/platform-ws` reference. The four changes are surgical and orthogonal — no cross-task interactions. The residual uncertainty (weaknesses 1–4) is all carried from v2 or is a known low-probability npm interop risk. Weakness 1 (Linux host.docker.internal) is a known Chunk 5 concern documented in v2's self-critique. I would not push back if verifier-v3 flags weakness 2 (postgres ESM interop) as a MINOR — it is real but unlikely to surface given the `apps/api` package has no `"type": "module"`. A genuine 92 reflects: defects are closed with evidence, architecture is unchanged from verifier-confirmed-sound v2, residual uncertainty is bounded and named.
