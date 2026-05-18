# Chunk 6 PR 2 — S-2 PCI pause/resume (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the second of three Chunk 6 PRs — F03 PCI pause/resume drives a real single-WAV-per-call recording with redaction-interval rows, the e2e harness asserts S-2 green in CI by downloading the WAV from MinIO and asserting `wavDurationMs ≈ callDurationMs − Σ(paused windows) ± 50 ms`.

**Architecture:** Five runtime additions plus the e2e spec that proves them. (1) Real `Channel.record()` replaces the zero-byte MinIO placeholder — Asterisk writes WAV bytes to a shared `recordings` Docker volume during the call. (2) `AriCommandsService` (new) issues ARI commands (start record, pause/unpause, stop) via the live `ari-client` handle. (3) `StasisStartHandler` starts recording on call start; `StasisEndHandler` stops it and uploads the final WAV to MinIO from the shared volume. (4) `CallsController` exposes `POST /v1/calls/:id/pause` and `POST /v1/calls/:id/resume`; pause writes a `recording_redaction_interval` row with `end_ms = NULL`, resume sets `end_ms` and unpauses the live recording. (5) `apps/web` operator page wires the existing `onPciToggle` callback to those endpoints. The recording-interval `end_ms` column is migrated to nullable.

**Tech Stack:** NestJS (api), Asterisk 20 ARI via `ari-client@2.2.0` npm, Next.js + React + Vitest (web), Playwright + SIPp + MinIO SDK (e2e), Drizzle ORM (db).

**Reference state at plan creation (2026-05-18):**

- Branch base: `main` at `6321824` (Chunk 6 S-3 merged via PR #3). No uncommitted changes.
- Predecessor design: [`docs/superpowers/specs/2026-05-17-chunk-6-slices-2-3-4-design.md`](../specs/2026-05-17-chunk-6-slices-2-3-4-design.md) §3.2 (S-2 architecture), §4 (schema deltas — none for S-2 beyond `end_ms` nullability), §6 (testing strategy), §7.1 (MixMonitor risk note — see deviation below).
- Predecessor plan (reference for style): [`docs/superpowers/plans/2026-05-17-chunk-6-s3-caller-hangup.md`](./2026-05-17-chunk-6-s3-caller-hangup.md).
- Existing analogs to mirror: `apps/api/src/telephony/stasis-start.handler.ts` (recording start hook); `apps/api/src/telephony/stasis-end.handler.ts` (recording finalize hook); `apps/api/src/message/message.controller.ts` (NestJS controller + JWT guard pattern for `CallsController`); `apps/web/components/ScreenPop.tsx` (PCI button + `onPciToggle` callback already wired client-side); `apps/web/app/operator/page.tsx:75` (current `onPciToggle` handler is local-state-only); `apps/e2e/specs/poc-e2e-s3-caller-hangup.spec.ts` (S-3 spec mirrors structure including CI/local budget split); `apps/e2e/src/lib/minio.ts` (already has `objectExists`; we add download here).

**Deviation from spec §3.2 — recording primitive choice.** The spec text reads "MixMonitor stop + restart with append flag (a)". MixMonitor is NOT exposed as a REST endpoint in Asterisk 20's standard ARI schema, so neither `ari-client@2.2.0` nor any HTTP call against `/ari/...` can drive MixMonitor at runtime. The plan instead uses ARI-native `Channel.record()` (`POST /channels/{id}/record`) plus `Recordings.pause`/`Recordings.unpause` (`POST /recordings/live/{name}/pause` and `.../unpause`). Per Asterisk 20 ARI docs, *"Paused time is not added to the duration of the recording"* — which delivers the exact semantics §3.2 specifies (single WAV, no audio for paused windows, duration-delta assertable, redaction-interval row as source of truth). No append-flag handling needed. The spec's intent is preserved; only the underlying ARI command differs. Note this in the PR description.

**Working-tree assumption.** All work happens on a single branch `mvp/chunk-6-s2-pci-pause` cut from `main` at `6321824`. The dev stack is brought up with the `INTERNAL_API_TOKEN` and `APP_JWT_SECRET` env vars per [`memory/feedback_all_in_docker_env.md`](../../../home/lion/.claude/projects/-media-lion-Data-Projects-modern-tas/memory/feedback_all_in_docker_env.md):

```bash
export INTERNAL_API_TOKEN="local-dev-token"
export APP_JWT_SECRET="poc-only-not-prod"
```

These are referenced again in tasks below; export once at the top of the session.

---

### Task 1: Branch + Drizzle migration (recording_redaction_interval.endMs → nullable)

The existing schema declares `endMs` as NOT NULL. S-2 needs it nullable so a row can be inserted on pause (`end_ms = NULL`) and updated on resume.

**Files:**
- Modify: `packages/db/src/schema/call.ts:31`
- Generate: `packages/db/drizzle/<NNNN>_chunk6_s2.sql` (Drizzle-generated; do not hand-edit)
- Apply: against local Postgres via `pnpm --filter @tas/db migrate`

- [ ] **Step 1.1: Branch from main**

```bash
cd /media/lion/Data/Projects/modern-tas
git fetch origin
git checkout main
git pull --ff-only
git checkout -b mvp/chunk-6-s2-pci-pause
git log --oneline -1
```
Expected: HEAD on `6321824 Merge pull request #3 from ylevytskyy/mvp/chunk-6-s3-caller-hangup`.

- [ ] **Step 1.2: Make `endMs` nullable in the Drizzle schema**

In `packages/db/src/schema/call.ts`, locate the `recordingRedactionInterval` definition (around line 26). Drop the `.notNull()` modifier from `endMs`:

```ts
export const recordingRedactionInterval = pgTable("recording_redaction_interval", {
  id: uuid("id").defaultRandom().primaryKey(),
  recordingId: uuid("recording_id").notNull().references(() => recording.id),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms"),
  reason: text("reason", { enum: ["operator_pci_pause", "auto_pii_ml"] }).notNull(),
});
```

- [ ] **Step 1.3: Generate the migration SQL**

```bash
pnpm --filter @tas/db run migrate:gen
```
Expected: a new file `packages/db/drizzle/<NNNN>_<name>.sql` appears containing an `ALTER TABLE ... ALTER COLUMN end_ms DROP NOT NULL` statement. **Open the file and verify** it only drops NOT NULL on `recording_redaction_interval.end_ms` and does not touch other tables. If Drizzle generates an unexpected `DROP COLUMN` or similar, abort and investigate — the local schema may be drifted.

- [ ] **Step 1.4: Bring up dev stack (if not running) and apply migration**

```bash
export INTERNAL_API_TOKEN="local-dev-token" APP_JWT_SECRET="poc-only-not-prod"
make poc-up-all-docker
./scripts/wait-for-healthy.sh infra/docker-compose.yml infra/docker-compose.all-in.yml

DATABASE_URL=postgres://tas:tas@localhost:5432/tas pnpm --filter @tas/db migrate
psql postgres://tas:tas@localhost:5432/tas -c '\d recording_redaction_interval' | grep end_ms
```
Expected: `end_ms | integer | ` (note the trailing space — no `not null` flag).

- [ ] **Step 1.5: Commit**

```bash
git add packages/db/src/schema/call.ts packages/db/drizzle/
git commit -m "$(cat <<'EOF'
feat(chunk-6/s2): recording_redaction_interval.end_ms nullable

S-2 inserts a redaction-interval row on PCI pause with end_ms unset,
then updates it with the actual end offset on resume. Drops NOT NULL
to support that two-step write.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Shared `recordings` volume mounted into the api service

Asterisk writes WAV bytes to its `/var/spool/asterisk/recording` path, which is already a named Docker volume. To upload the WAV to MinIO at StasisEnd, the api service must be able to read the same volume.

**Files:**
- Modify: `infra/docker-compose.yml` (api service volumes)
- Modify: `infra/docker-compose.all-in.yml` (api service volumes — second compose file used by `make poc-up-all-docker`)

- [ ] **Step 2.1: Locate the api service block in `infra/docker-compose.yml`**

```bash
grep -n "^  api:" infra/docker-compose.yml
```

This file is used by `make poc-up` (host-dev mode). The `api:` block may or may not exist depending on the configuration — both compose files merge. Open both files and confirm which one declares the `api:` service block.

The base `infra/docker-compose.yml` declares only infra services (postgres, supavisor, nats, redis, minio, asterisk, temporal, supabase). The app services (api, web, temporal-worker) live in `infra/docker-compose.all-in.yml`. Confirm by running:

```bash
grep -nE "^  (api|web|temporal-worker):" infra/docker-compose.yml infra/docker-compose.all-in.yml
```
Expected: only `all-in.yml` declares app services.

- [ ] **Step 2.2: Add `recordings` mount to the api service in `infra/docker-compose.all-in.yml`**

In `infra/docker-compose.all-in.yml`, locate the `api:` block (line ~9). After the `ports:` stanza, before `depends_on:`, add a `volumes:` stanza:

```yaml
    volumes:
      - recordings:/var/spool/asterisk/recording:ro
```

Then, at the bottom of the file, ensure the top-level `volumes:` declaration imports the named volume from the base compose file. The base file already declares `recordings` (`infra/docker-compose.yml:185`); the all-in file needs to declare it as `external: false` (default) or reference it. Add (or extend) at the file's tail:

```yaml
volumes:
  recordings:
    name: modern-tas_recordings
```

The `name:` matches the volume name Docker Compose generates by default from the base file (`<project>_recordings` — `modern-tas` is the project name from the dir). Confirm the actual volume name:

```bash
docker volume ls | grep recordings
```
Expected: a single volume named `modern-tas_recordings` (or similar). Adjust the `name:` accordingly.

- [ ] **Step 2.3: Verify the mount works after restart**

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml down
docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml up -d --build api asterisk

# Wait a moment for both services to come up, then verify the mount in the api container:
docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml exec api ls -la /var/spool/asterisk/recording
```
Expected: the directory exists and is readable. Empty for now (no recordings yet).

- [ ] **Step 2.4: Manual smoke — verify Asterisk Channel.record + pause/unpause writes a valid WAV**

This is the spec §7.1 manual smoke. Use `pjsua` (or any SIP UA that produces audio) to place a real call, manually invoke ARI Channel.record + Recordings.pause + Recordings.unpause via curl, then inspect the resulting WAV with `ffprobe`.

```bash
# In one terminal, start a recording on an active call.
# First, find the active channel ID (place a call with pjsua first; channel ID shows up in `core show channels`).
docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml exec asterisk asterisk -rx 'core show channels concise'

# Capture the channel ID (first column), then:
CHANNEL_ID=<paste here>
curl -sS -u tas:tas -X POST \
  "http://localhost:8088/ari/channels/${CHANNEL_ID}/record?name=test-smoke&format=wav&ifExists=overwrite"

# Wait ~2s. Then pause:
curl -sS -u tas:tas -X POST "http://localhost:8088/ari/recordings/live/test-smoke/pause"

# Wait ~2s while paused. Then unpause:
curl -sS -u tas:tas -X POST "http://localhost:8088/ari/recordings/live/test-smoke/unpause"

# Wait ~2s. Stop and finalize:
curl -sS -u tas:tas -X POST "http://localhost:8088/ari/recordings/live/test-smoke/stop"

# Pull the WAV out of the recordings volume and inspect:
docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml exec asterisk ls -la /var/spool/asterisk/recording/
docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml exec asterisk ffprobe /var/spool/asterisk/recording/test-smoke.wav 2>&1 | grep Duration
```
Expected: a `test-smoke.wav` file exists in `/var/spool/asterisk/recording/`. `ffprobe` reports a duration roughly equal to the un-paused windows summed (≈ 4s — 2s before pause + 2s after unpause), NOT the wall-clock (≈ 6s).

**If the duration matches wall-clock instead** (i.e., Asterisk wrote silence during the paused window), the assumption that "paused time is not added to duration" is wrong for this stack/codec combo. Revisit by reading [Asterisk ARI docs for Recordings.pause](https://docs.asterisk.org/Asterisk_20_Documentation/API_Documentation/Asterisk_REST_Interface/Recordings_REST_API/) and considering the fallback (post-process the WAV in the api to splice out paused regions before upload — heavier but contained).

- [ ] **Step 2.5: Commit infra change**

```bash
git add infra/docker-compose.all-in.yml
git commit -m "$(cat <<'EOF'
feat(chunk-6/s2): mount recordings volume read-only into api

S-2's StasisEndHandler reads the WAV file Asterisk wrote during the
call (via Channel.record) and uploads it to MinIO. The api needs
read-only access to the same Docker volume Asterisk writes into.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `AriCommandsService` — typed ARI command surface

The existing `AriLeaderClient` (in `packages/ari-client/src/leader.ts`) only handles leader election and event subscription. Command invocation goes through the underlying `ari-client` handle but is currently untyped and not exposed from any service. Add a NestJS-injectable `AriCommandsService` in `apps/api/src/ari/` that wraps the handle and exposes typed methods for the four commands S-2 needs.

**Files:**
- Modify: `packages/ari-client/src/leader.ts` (extend `AriClientHandle` interface to expose `.channels` and `.recordings` namespaces, OR add a getter on `AriLeaderClient` that surfaces the live handle for command issuance)
- Create: `apps/api/src/ari/ari-commands.service.ts`
- Create: `apps/api/src/ari/ari-commands.service.spec.ts`
- Modify: `apps/api/src/ari/ari.module.ts` (register provider + export)

- [ ] **Step 3.1: Extend `AriClientHandle` in `packages/ari-client/src/leader.ts`**

Around line 36, the interface declares only the methods the leader needs (`start`, `on`, `stop`). Extend it to include the ARI command namespaces we need:

```ts
export interface AriClientHandle {
  _connection?: { ws?: { close(): void } };
  stop?(appName?: string): void;
  start(appName: string): Promise<void>;
  on(event: string, handler: (...args: any[]) => void): void;
  /** ari-client@2.2.0 dynamically attaches namespaces from Asterisk's swagger; we type the ones S-2 uses. */
  channels?: {
    record(opts: { channelId: string; name: string; format: string; ifExists?: 'overwrite' | 'fail' | 'append' }): Promise<{ name: string }>;
  };
  recordings?: {
    pause(opts: { recordingName: string }): Promise<void>;
    unpause(opts: { recordingName: string }): Promise<void>;
    stop(opts: { recordingName: string }): Promise<void>;
  };
}
```

Also expose the live handle from `AriLeaderClient` so a sibling service can issue commands. Add a public getter near line 92 (next to `isLeaderForTest`):

```ts
  /** Expose the live ARI handle for command issuance. Returns null if not leader. */
  get handleForCommands(): AriClientHandle | null {
    return this.isLeader ? this.ariHandle : null;
  }
```

- [ ] **Step 3.2: Write the failing test for `AriCommandsService`**

Create `apps/api/src/ari/ari-commands.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AriCommandsService } from './ari-commands.service';
import type { AriLeaderClient, AriClientHandle } from '@tas/ari-client';

function makeHandle(): AriClientHandle & {
  channels: { record: ReturnType<typeof vi.fn> };
  recordings: {
    pause: ReturnType<typeof vi.fn>;
    unpause: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
} {
  return {
    on: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    channels: { record: vi.fn().mockResolvedValue({ name: 'recording-xyz' }) },
    recordings: {
      pause: vi.fn().mockResolvedValue(undefined),
      unpause: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeLeader(handle: AriClientHandle | null): AriLeaderClient {
  return { handleForCommands: handle } as unknown as AriLeaderClient;
}

describe('AriCommandsService', () => {
  let handle: ReturnType<typeof makeHandle>;
  let svc: AriCommandsService;

  beforeEach(() => {
    handle = makeHandle();
    svc = new AriCommandsService(makeLeader(handle));
  });

  it('startRecording invokes channels.record with the canonical name', async () => {
    await svc.startRecording('chan-1', 'call-abc');
    expect(handle.channels.record).toHaveBeenCalledWith({
      channelId: 'chan-1',
      name: 'call-abc',
      format: 'wav',
      ifExists: 'overwrite',
    });
  });

  it('pauseRecording calls recordings.pause keyed on callId (canonical recording name)', async () => {
    await svc.pauseRecording('call-abc');
    expect(handle.recordings.pause).toHaveBeenCalledWith({ recordingName: 'call-abc' });
  });

  it('resumeRecording calls recordings.unpause', async () => {
    await svc.resumeRecording('call-abc');
    expect(handle.recordings.unpause).toHaveBeenCalledWith({ recordingName: 'call-abc' });
  });

  it('stopRecording calls recordings.stop', async () => {
    await svc.stopRecording('call-abc');
    expect(handle.recordings.stop).toHaveBeenCalledWith({ recordingName: 'call-abc' });
  });

  it('throws when not the leader', async () => {
    const notLeader = new AriCommandsService(makeLeader(null));
    await expect(notLeader.pauseRecording('call-abc')).rejects.toThrow(/not the ARI leader/i);
  });
});
```

- [ ] **Step 3.3: Run the test to verify it fails**

```bash
pnpm --filter @tas/api exec vitest run src/ari/ari-commands.service.spec.ts
```
Expected: FAIL with "Cannot find module './ari-commands.service'".

- [ ] **Step 3.4: Implement `AriCommandsService`**

Create `apps/api/src/ari/ari-commands.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { AriLeaderClient, AriClientHandle } from '@tas/ari-client';
import { ARI_LEADER_TOKEN } from './ari.module';

/**
 * Issues ARI commands against the live leader handle. The leader handle is
 * a dynamically-attribute-mapped object built by `ari-client@2.2.0` from
 * Asterisk's swagger; we type only the subset S-2 uses.
 *
 * The canonical Asterisk recording name is the call's UUID — this lets us
 * pause/unpause/stop with no extra bookkeeping.
 */
@Injectable()
export class AriCommandsService {
  constructor(@Inject(ARI_LEADER_TOKEN) private readonly leader: AriLeaderClient) {}

  private handle(): AriClientHandle {
    const h = this.leader.handleForCommands;
    if (!h) throw new Error('AriCommandsService: this instance is not the ARI leader');
    return h;
  }

  async startRecording(channelId: string, callId: string): Promise<void> {
    await this.handle().channels!.record({
      channelId,
      name: callId,
      format: 'wav',
      ifExists: 'overwrite',
    });
  }

  async pauseRecording(callId: string): Promise<void> {
    await this.handle().recordings!.pause({ recordingName: callId });
  }

  async resumeRecording(callId: string): Promise<void> {
    await this.handle().recordings!.unpause({ recordingName: callId });
  }

  async stopRecording(callId: string): Promise<void> {
    await this.handle().recordings!.stop({ recordingName: callId });
  }
}
```

- [ ] **Step 3.5: Register the provider in `AriModule`**

In `apps/api/src/ari/ari.module.ts`, add `AriCommandsService` to providers and exports:

```ts
import { AriCommandsService } from './ari-commands.service';

@Global()
@Module({
  providers: [
    { provide: ARI_LEADER_TOKEN, useFactory: /* ... existing ... */ },
    AriCommandsService,
  ],
  exports: [ARI_LEADER_TOKEN, AriCommandsService],
})
export class AriModule {}
```

- [ ] **Step 3.6: Run unit tests and verify they pass**

```bash
pnpm --filter @tas/api exec vitest run src/ari/ari-commands.service.spec.ts
```
Expected: 5 tests pass.

- [ ] **Step 3.7: Rebuild `@tas/ari-client` so dist artifacts are fresh**

The interface change must be published from the workspace package's dist for downstream consumers:
```bash
pnpm --filter @tas/ari-client run build
```

- [ ] **Step 3.8: Typecheck the api**

```bash
pnpm --filter @tas/api run typecheck
```
Expected: no errors.

- [ ] **Step 3.9: Commit**

```bash
git add packages/ari-client/src/leader.ts apps/api/src/ari/
git commit -m "$(cat <<'EOF'
feat(chunk-6/s2): AriCommandsService for record + pause/unpause/stop

Adds a typed wrapper around the ari-client@2.2.0 handle for the four
ARI commands S-2 needs: channels.record, recordings.pause/unpause/stop.
Canonical recording name = call UUID, so pause/resume keyed on callId
needs no extra DB lookup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire recording lifecycle into StasisStart/StasisEnd

Replace the zero-byte MinIO placeholder in `RecordingService` with a real Channel.record on StasisStart and a stop-and-upload sequence on StasisEnd. The recording WAV grows on disk during the call (in the shared `recordings` Docker volume); the api reads the file at StasisEnd time and uploads it to MinIO at the canonical key `recordings/{callId}.wav`.

**Files:**
- Modify: `apps/api/src/recording/recording.service.ts`
- Modify: `apps/api/src/recording/recording.module.ts` (import AriCommandsService dep)
- Modify: `apps/api/src/telephony/stasis-start.handler.ts:30-87` (pass channelId, await record start)
- Modify: `apps/api/src/telephony/stasis-end.handler.ts:95-106` (call recording.finalize, which uploads the WAV)
- Modify: `apps/api/src/telephony/telephony.module.ts` (depend on RecordingModule if not already)
- Test: `apps/api/src/recording/recording.service.spec.ts` (new)

- [ ] **Step 4.1: Refactor `RecordingService` — drop zero-byte placeholder, accept ARI commands as dependency**

Replace `apps/api/src/recording/recording.service.ts` wholesale:

```ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { DB_TOKEN } from '../database/database.module';
import { AriCommandsService } from '../ari/ari-commands.service';
import { recording } from '@tas/db';
import type { Db } from '@tas/db/client';
import type { Client as MinioClient } from 'minio';

const MINIO_BUCKET = 'tas-recordings';
const ASTERISK_RECORDING_DIR = '/var/spool/asterisk/recording';

export interface StartRecordingParams {
  callId: string;
  channelId: string;
  tenantId: string;
}

@Injectable()
export class RecordingService {
  private readonly logger = new Logger(RecordingService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @Inject('MINIO_CLIENT') private readonly minio: MinioClient,
    private readonly ari: AriCommandsService,
  ) {}

  async startRecording(params: StartRecordingParams): Promise<void> {
    const { callId, channelId, tenantId } = params;
    const minioKey = `recordings/${callId}.wav`;

    // Ensure the bucket exists before we ever try to upload.
    const exists = await this.minio.bucketExists(MINIO_BUCKET);
    if (!exists) await this.minio.makeBucket(MINIO_BUCKET, 'us-east-1');

    // Issue ARI Channel.record. Asterisk writes the WAV to the recordings volume.
    await this.ari.startRecording(channelId, callId);

    await this.db.insert(recording).values({
      tenantId,
      callId,
      path: minioKey,
      startedAt: new Date(),
    });
  }

  /**
   * Stop the live recording (idempotent — recordings.stop is a no-op if already stopped)
   * and upload the resulting WAV file from the shared volume to MinIO at the recording's
   * canonical key. Updates recording.endedAt.
   */
  async finalizeRecording(callId: string): Promise<void> {
    // The recording row was written at startRecording; look it up to get tenantId + path.
    const [rec] = await this.db
      .select()
      .from(recording)
      .where(and(eq(recording.callId, callId), isNull(recording.endedAt)))
      .limit(1);
    if (!rec) {
      this.logger.warn(`finalizeRecording: no open recording for call ${callId}`);
      return;
    }

    // Stop the live recording before reading the file (Asterisk flushes the WAV header on stop).
    try {
      await this.ari.stopRecording(callId);
    } catch (err) {
      // Already stopped (e.g., channel hung up before our explicit stop). Log + continue.
      this.logger.warn(`finalizeRecording: ari.stopRecording failed (likely already stopped): ${String(err)}`);
    }

    const localPath = path.join(ASTERISK_RECORDING_DIR, `${callId}.wav`);
    let wavBytes: Buffer;
    try {
      wavBytes = await fs.readFile(localPath);
    } catch (err) {
      this.logger.error(`finalizeRecording: cannot read ${localPath}: ${String(err)}`);
      // Mark recording ended even if upload failed; tests will surface a missing-object error.
      await this.db.update(recording).set({ endedAt: new Date() }).where(eq(recording.id, rec.id));
      return;
    }

    await this.minio.putObject(MINIO_BUCKET, rec.path, wavBytes);
    await this.db.update(recording).set({ endedAt: new Date() }).where(eq(recording.id, rec.id));
  }
}
```

- [ ] **Step 4.2: Update `StasisStartHandler` to pass channelId (already does, line 87)**

Verify `apps/api/src/telephony/stasis-start.handler.ts:87` already calls:
```ts
await this.recordingService.startRecording({ callId, channelId, tenantId });
```
No change needed — the existing call signature is preserved.

- [ ] **Step 4.3: Update `StasisEndHandler` to call `finalizeRecording`**

In `apps/api/src/telephony/stasis-end.handler.ts`, replace the existing recording update block (around line 100–106) with a call to `RecordingService.finalizeRecording`. First, inject `RecordingService`:

```ts
import { RecordingService } from '../recording/recording.service';

@Injectable()
export class StasisEndHandler implements OnModuleInit {
  // ... existing logger ...
  constructor(
    @Inject(ARI_LEADER_TOKEN) private readonly ari: AriLeaderClient,
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly nats: NatsClientService,
    private readonly recordingService: RecordingService,
  ) {}
```

Then in `handleStasisEnd`, replace the recording-update block:

```ts
      // BEFORE:
      // await this.db
      //   .update(recording)
      //   .set({ endedAt })
      //   .where(and(eq(recording.callId, callRow.id), isNull(recording.endedAt)));
      //
      // AFTER:
      await this.recordingService.finalizeRecording(callRow.id);
```

The `RecordingService.finalizeRecording` now owns the recording-row update.

- [ ] **Step 4.4: Wire dependencies in modules**

In `apps/api/src/recording/recording.module.ts`, the module already exports `RecordingService`. Ensure `AriModule` is imported (so `AriCommandsService` is injectable):

```ts
import { Module } from '@nestjs/common';
import { RecordingService } from './recording.service';
import { AriModule } from '../ari/ari.module';

@Module({
  imports: [AriModule],
  providers: [
    RecordingService,
    {
      provide: 'MINIO_CLIENT',
      // ... existing factory ...
    },
  ],
  exports: [RecordingService],
})
export class RecordingModule {}
```
(Keep the existing MINIO_CLIENT factory; only the `imports` line is new if not already there.)

In `apps/api/src/telephony/telephony.module.ts`, ensure both `RecordingModule` and `AriModule` are imported:

```ts
import { Module } from '@nestjs/common';
import { StasisStartHandler } from './stasis-start.handler';
import { StasisEndHandler } from './stasis-end.handler';
import { AriModule } from '../ari/ari.module';
import { RecordingModule } from '../recording/recording.module';
import { NatsModule } from '../nats/nats.module';

@Module({
  imports: [AriModule, RecordingModule, NatsModule],
  providers: [StasisStartHandler, StasisEndHandler],
})
export class TelephonyModule {}
```

`AriModule` is already `@Global()` (per `apps/api/src/ari/ari.module.ts:7`), so AriCommandsService is auto-resolvable wherever needed.

- [ ] **Step 4.5: Write unit test for `RecordingService.finalizeRecording`**

Create `apps/api/src/recording/recording.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecordingService } from './recording.service';
import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';

vi.mock('node:fs', () => ({
  promises: { readFile: vi.fn() },
}));

function makeDeps() {
  const minio = {
    bucketExists: vi.fn().mockResolvedValue(true),
    makeBucket: vi.fn().mockResolvedValue(undefined),
    putObject: vi.fn().mockResolvedValue({ etag: 'etag-1' }),
  };
  const ari = {
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn().mockResolvedValue(undefined),
    pauseRecording: vi.fn().mockResolvedValue(undefined),
    resumeRecording: vi.fn().mockResolvedValue(undefined),
  };
  // Minimal Drizzle-shaped DB stub using chainable thenables.
  const dbState: { rows: any[]; updates: any[]; inserts: any[] } = { rows: [], updates: [], inserts: [] };
  const db: any = {
    insert: () => ({
      values: (v: any) => { dbState.inserts.push(v); return Promise.resolve(); },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(dbState.rows),
        }),
      }),
    }),
    update: () => ({
      set: (v: any) => ({
        where: () => { dbState.updates.push(v); return Promise.resolve(); },
      }),
    }),
  };
  return { minio, ari, db, dbState };
}

describe('RecordingService.finalizeRecording', () => {
  const callId = 'call-abc';
  let deps: ReturnType<typeof makeDeps>;
  let svc: RecordingService;

  beforeEach(() => {
    deps = makeDeps();
    svc = new RecordingService(deps.db as any, deps.minio as any, deps.ari as any);
    vi.mocked(fs.readFile).mockReset();
  });

  it('reads the WAV from the shared volume and uploads to MinIO', async () => {
    deps.dbState.rows.push({ id: 'rec-1', path: `recordings/${callId}.wav`, callId, tenantId: 't' });
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('RIFF....WAVE'));

    await svc.finalizeRecording(callId);

    expect(deps.ari.stopRecording).toHaveBeenCalledWith(callId);
    expect(fs.readFile).toHaveBeenCalledWith(`/var/spool/asterisk/recording/${callId}.wav`);
    expect(deps.minio.putObject).toHaveBeenCalledWith('tas-recordings', `recordings/${callId}.wav`, Buffer.from('RIFF....WAVE'));
    expect(deps.dbState.updates).toHaveLength(1);
    expect(deps.dbState.updates[0].endedAt).toBeInstanceOf(Date);
  });

  it('no-ops when the recording row is missing', async () => {
    await svc.finalizeRecording(callId);
    expect(deps.ari.stopRecording).not.toHaveBeenCalled();
    expect(deps.minio.putObject).not.toHaveBeenCalled();
  });

  it('still marks recording.endedAt when file read fails', async () => {
    deps.dbState.rows.push({ id: 'rec-1', path: `recordings/${callId}.wav`, callId, tenantId: 't' });
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

    await svc.finalizeRecording(callId);

    expect(deps.minio.putObject).not.toHaveBeenCalled();
    expect(deps.dbState.updates).toHaveLength(1);
  });
});
```

- [ ] **Step 4.6: Run the test and verify pass**

```bash
pnpm --filter @tas/api exec vitest run src/recording/recording.service.spec.ts
```
Expected: 3 tests pass.

- [ ] **Step 4.7: Typecheck and run the api test suite to catch regressions**

```bash
pnpm --filter @tas/api run typecheck
pnpm --filter @tas/api exec vitest run
```
Expected: no type errors; existing tests (including stasis-end.handler.spec.ts, stasis-start.handler.spec.ts) still pass. **If StasisEndHandler tests break** because of the new RecordingService dependency, update those tests to inject a stubbed RecordingService — keep the change minimal (one new constructor arg).

- [ ] **Step 4.8: Commit**

```bash
git add apps/api/src/recording/ apps/api/src/telephony/ apps/api/src/ari/
git commit -m "$(cat <<'EOF'
feat(chunk-6/s2): real Channel.record + upload-on-StasisEnd

Replaces the zero-byte MinIO placeholder with a real ARI Channel.record
issued on StasisStart. Asterisk writes the WAV to /var/spool/asterisk/
recording (shared Docker volume). On StasisEnd the api reads the file
and uploads it to MinIO at recordings/<callId>.wav.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `CallsController` — POST /v1/calls/:id/pause and /v1/calls/:id/resume

Two endpoints that delegate to `AriCommandsService.pauseRecording` / `resumeRecording` and write/update `recording_redaction_interval` rows. Mirror the JWT-guarded controller pattern from `MessageController` (`apps/api/src/message/message.controller.ts`).

**Files:**
- Create: `apps/api/src/calls/calls.controller.ts`
- Create: `apps/api/src/calls/calls.module.ts`
- Create: `apps/api/src/calls/calls.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register CallsModule)

- [ ] **Step 5.1: Write the failing controller test**

Create `apps/api/src/calls/calls.controller.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CallsController } from './calls.controller';

function makeDeps() {
  const ari = {
    pauseRecording: vi.fn().mockResolvedValue(undefined),
    resumeRecording: vi.fn().mockResolvedValue(undefined),
  };
  const dbState: { calls: any[]; recordings: any[]; intervals: any[] } = {
    calls: [],
    recordings: [],
    intervals: [],
  };
  // Drizzle-shaped DB stub.
  const select = (table: 'call' | 'recording' | 'recording_redaction_interval') => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(
          table === 'call' ? dbState.calls :
          table === 'recording' ? dbState.recordings :
          dbState.intervals
        ),
      }),
    }),
  });
  const db: any = {
    select: vi.fn().mockImplementation(() => ({ from: select('call').from })),
    insert: () => ({ values: (v: any) => { dbState.intervals.push(v); return { returning: () => Promise.resolve([{ id: 'interval-1', ...v }]) }; } }),
    update: () => ({ set: (v: any) => ({ where: () => Promise.resolve() }) }),
    _seedCall: (row: any) => { dbState.calls.push(row); },
    _seedRecording: (row: any) => { dbState.recordings.push(row); db.select = vi.fn().mockImplementation(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(dbState.recordings) }) }) })); },
  };
  return { ari, db, dbState };
}

describe('CallsController', () => {
  const callId = '00000000-0000-0000-0000-000000000001';
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const operatorId = '66666666-6666-6666-6666-666666666666';
  let deps: ReturnType<typeof makeDeps>;
  let ctrl: CallsController;

  beforeEach(() => {
    deps = makeDeps();
    ctrl = new CallsController(deps.db as any, deps.ari as any);
    deps.db._seedRecording({ id: 'rec-1', callId, tenantId, startedAt: new Date(Date.now() - 5000) });
  });

  it('POST /pause inserts a redaction-interval row with end_ms NULL and calls ari.pauseRecording', async () => {
    const result = await ctrl.pause(callId, { user: { tenantId, operatorId } } as any);
    expect(deps.ari.pauseRecording).toHaveBeenCalledWith(callId);
    expect(deps.dbState.intervals).toHaveLength(1);
    const row = deps.dbState.intervals[0];
    expect(row.recordingId).toBe('rec-1');
    expect(row.startMs).toBeGreaterThan(0);
    expect(row.endMs).toBeUndefined();
    expect(row.reason).toBe('operator_pci_pause');
    expect(result).toEqual({ ok: true });
  });

  it('POST /pause throws 404 when no open recording exists', async () => {
    deps.dbState.recordings.length = 0;
    deps.db.select = vi.fn().mockImplementation(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }));
    await expect(ctrl.pause(callId, { user: { tenantId, operatorId } } as any)).rejects.toThrow(/no open recording/i);
  });

  it('POST /resume updates the open redaction interval end_ms and calls ari.resumeRecording', async () => {
    // First pause to seed an open interval.
    await ctrl.pause(callId, { user: { tenantId, operatorId } } as any);
    deps.ari.pauseRecording.mockClear();

    // Wire DB stub to return the just-inserted row as "the open interval" for resume.
    const open = deps.dbState.intervals[0];
    const ogSelect = deps.db.select;
    deps.db.select = vi.fn()
      .mockImplementationOnce(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([open]) }) }) }))
      .mockImplementation(ogSelect);

    const result = await ctrl.resume(callId, { user: { tenantId, operatorId } } as any);

    expect(deps.ari.resumeRecording).toHaveBeenCalledWith(callId);
    expect(result).toEqual({ ok: true });
  });
});
```

- [ ] **Step 5.2: Run the test and verify it fails**

```bash
pnpm --filter @tas/api exec vitest run src/calls/calls.controller.spec.ts
```
Expected: FAIL — "Cannot find module './calls.controller'".

- [ ] **Step 5.3: Implement `CallsController`**

Create `apps/api/src/calls/calls.controller.ts`:

```ts
import {
  Controller, Post, Param, Req, UseGuards, Inject, NotFoundException, HttpCode,
} from '@nestjs/common';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { DB_TOKEN } from '../database/database.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AriCommandsService } from '../ari/ari-commands.service';
import { recording, recordingRedactionInterval } from '@tas/db';
import type { Db } from '@tas/db/client';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user.interface';

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly ari: AriCommandsService,
  ) {}

  @Post(':id/pause')
  @HttpCode(200)
  async pause(
    @Param('id') callId: string,
    @Req() _req: Request & { user: RequestUser },
  ): Promise<{ ok: true }> {
    const [rec] = await this.db
      .select()
      .from(recording)
      .where(and(eq(recording.callId, callId), isNull(recording.endedAt)))
      .limit(1);
    if (!rec) throw new NotFoundException('no open recording for call');

    const startMs = Date.now() - new Date(rec.startedAt).getTime();

    await this.db.insert(recordingRedactionInterval).values({
      recordingId: rec.id,
      startMs,
      reason: 'operator_pci_pause',
    });

    await this.ari.pauseRecording(callId);
    return { ok: true };
  }

  @Post(':id/resume')
  @HttpCode(200)
  async resume(
    @Param('id') callId: string,
    @Req() _req: Request & { user: RequestUser },
  ): Promise<{ ok: true }> {
    const [rec] = await this.db
      .select()
      .from(recording)
      .where(and(eq(recording.callId, callId), isNull(recording.endedAt)))
      .limit(1);
    if (!rec) throw new NotFoundException('no open recording for call');

    // Most recent open interval (end_ms IS NULL) for this recording.
    const [open] = await this.db
      .select()
      .from(recordingRedactionInterval)
      .where(and(eq(recordingRedactionInterval.recordingId, rec.id), isNull(recordingRedactionInterval.endMs)))
      .orderBy(desc(recordingRedactionInterval.startMs))
      .limit(1);
    if (!open) throw new NotFoundException('no open redaction interval to close');

    const endMs = Date.now() - new Date(rec.startedAt).getTime();
    await this.db
      .update(recordingRedactionInterval)
      .set({ endMs })
      .where(eq(recordingRedactionInterval.id, open.id));

    await this.ari.resumeRecording(callId);
    return { ok: true };
  }
}
```

- [ ] **Step 5.4: Create the module**

Create `apps/api/src/calls/calls.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { AuthModule } from '../auth/auth.module';
import { AriModule } from '../ari/ari.module';

@Module({
  imports: [AuthModule, AriModule],
  controllers: [CallsController],
})
export class CallsModule {}
```

- [ ] **Step 5.5: Register `CallsModule` in `AppModule`**

In `apps/api/src/app.module.ts`, add the import and include it in the `imports` array:

```ts
import { CallsModule } from './calls/calls.module';

// ... in @Module decorator imports array:
    MessageModule,
    CallsModule,  // ← new
```
Place it adjacent to `MessageModule` so the route file ordering matches the controller registration order shown in logs.

- [ ] **Step 5.6: Run the unit test and verify it passes**

```bash
pnpm --filter @tas/api exec vitest run src/calls/calls.controller.spec.ts
```
Expected: 3 tests pass.

- [ ] **Step 5.7: Typecheck**

```bash
pnpm --filter @tas/api run typecheck
```
Expected: no errors.

- [ ] **Step 5.8: Manual smoke against the live api**

```bash
# Rebuild and restart the api container so the new routes are live.
docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml up -d --build api
./scripts/wait-for-healthy.sh infra/docker-compose.yml infra/docker-compose.all-in.yml

# Get a fresh operator token via the internal dev endpoint.
TOKEN=$(curl -sS -H "X-Internal-Token: $INTERNAL_API_TOKEN" \
  http://localhost:3000/v1/dev/operator-token \
  -X POST -H 'content-type: application/json' \
  -d '{"operatorId":"66666666-6666-6666-6666-666666666666"}' | jq -r .token)

# These should return 404 when there's no live call.
curl -i -X POST "http://localhost:3000/v1/calls/00000000-0000-0000-0000-000000000000/pause" \
  -H "Authorization: Bearer $TOKEN"
```
Expected: `HTTP/1.1 404 Not Found` with body `{"message":"no open recording for call",...}`. (We're not in a live call yet — full pause-during-call smoke happens in Task 9.)

- [ ] **Step 5.9: Commit**

```bash
git add apps/api/src/calls/ apps/api/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(chunk-6/s2): CallsController with POST /pause and /resume

Two JWT-guarded endpoints. Pause inserts a recording_redaction_interval
row (end_ms NULL) and calls Recordings.pause via ARI. Resume sets the
open interval's end_ms and calls Recordings.unpause. Returns 404 when
no live recording exists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Frontend wiring — operator/page.tsx onPciToggle → POST API

The PCI button is already rendered (`apps/web/components/ScreenPop.tsx:36`) and the operator page tracks `paused` state (`apps/web/app/operator/page.tsx:20`). Today, `onPciToggle` only flips local state (`apps/web/app/operator/page.tsx:75`). Add the API calls.

**Files:**
- Modify: `apps/web/lib/api.ts` (add `pauseCall` and `resumeCall` helpers next to existing `postMessage`)
- Modify: `apps/web/app/operator/page.tsx:75` (wire the toggle to the API)
- Test: `apps/web/app/operator/page.spec.tsx` if it exists; otherwise rely on the e2e spec (Task 9) for the UI integration.

- [ ] **Step 6.1: Inspect existing `apps/web/lib/api.ts`**

```bash
cat apps/web/lib/api.ts
```
Note the `postMessage` signature so we match style. The new helpers will mirror it (apiBaseUrl, token, body of just `{}`).

- [ ] **Step 6.2: Add `pauseCall` and `resumeCall` helpers**

In `apps/web/lib/api.ts`, add (after the existing `postMessage` export):

```ts
export async function pauseCall(opts: {
  apiBaseUrl: string;
  token: string;
  callId: string;
}): Promise<void> {
  const res = await fetch(`${opts.apiBaseUrl}/v1/calls/${opts.callId}/pause`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`pauseCall failed: ${res.status}`);
}

export async function resumeCall(opts: {
  apiBaseUrl: string;
  token: string;
  callId: string;
}): Promise<void> {
  const res = await fetch(`${opts.apiBaseUrl}/v1/calls/${opts.callId}/resume`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`resumeCall failed: ${res.status}`);
}
```

- [ ] **Step 6.3: Wire `onPciToggle` in operator/page.tsx to call the API**

In `apps/web/app/operator/page.tsx`, find the `onPciToggle` handler around line 75:

```tsx
        onPciToggle={() => setPaused((p) => !p)}
```

Replace with:

```tsx
        onPciToggle={async () => {
          if (!token || !call) return;
          const next = !paused;
          try {
            if (next) {
              await pauseCall({ apiBaseUrl: API_BASE_URL, token, callId: call.callId });
            } else {
              await resumeCall({ apiBaseUrl: API_BASE_URL, token, callId: call.callId });
            }
            setPaused(next);
          } catch (err) {
            console.error('pause/resume failed', err);
            // Don't flip local state — keeps UI consistent with backend.
          }
        }}
```

Add the imports at the top of the file:
```tsx
import { pauseCall, resumeCall, postMessage } from '@/lib/api';
```
(if `postMessage` was already imported via different path, keep that line and just add the new symbols).

- [ ] **Step 6.4: Typecheck the web app**

```bash
pnpm --filter @tas/web run typecheck
```
Expected: no errors.

- [ ] **Step 6.5: Run the existing web test suite to catch regressions**

```bash
pnpm --filter @tas/web run test
```
Expected: all tests pass. If a snapshot of `OperatorPage` fails because of the added handler, the snapshot is brittle — re-record only if the change is in the `onPciToggle` prop, not in the JSX structure.

- [ ] **Step 6.6: Commit**

```bash
git add apps/web/lib/api.ts apps/web/app/operator/page.tsx
git commit -m "$(cat <<'EOF'
feat(chunk-6/s2): wire ScreenPop PCI toggle to /pause /resume API

onPciToggle now POSTs to /v1/calls/:id/pause or /resume. Local paused
state is flipped only after the API call succeeds, so backend and UI
stay aligned. Errors are logged but not surfaced to the operator
(matches the existing accept/submit UX in this PoC).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: e2e harness — `assertWavDurationDelta` helper

The S-2 spec downloads the WAV from MinIO and asserts duration ≈ call-duration − Σ(paused windows) ± 50 ms. The helper parses the WAV header (RIFF chunk size, sample rate, bit depth) to compute actual duration — no external audio libraries.

**Files:**
- Create: `apps/e2e/src/lib/audio.ts`
- Create: `apps/e2e/src/lib/audio.spec.ts`
- Modify: `apps/e2e/src/lib/minio.ts` (add `downloadObject` helper)

- [ ] **Step 7.1: Write the failing audio helper test**

Create `apps/e2e/src/lib/audio.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { assertWavDurationDelta, parseWavDurationMs } from './audio.js';

/**
 * Build a minimal valid PCM WAV header. Pure header, no audio data —
 * `dataSize` indicates how many bytes of audio "follow", which is what
 * our duration calc uses; we don't actually need to allocate them.
 */
function makeWavHeader(opts: {
  sampleRate: number;
  bitsPerSample: number;
  numChannels: number;
  dataSize: number;
}): Buffer {
  const { sampleRate, bitsPerSample, numChannels, dataSize } = opts;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);             // fmt chunk size
  buf.writeUInt16LE(1, 20);              // audio format (PCM)
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

describe('parseWavDurationMs', () => {
  it('computes duration for 8 kHz / 16-bit / mono', () => {
    // 8000 Hz × 2 bytes × 1 ch = 16000 B/s → 8000 bytes = 0.5 s = 500 ms.
    const buf = makeWavHeader({ sampleRate: 8000, bitsPerSample: 16, numChannels: 1, dataSize: 8000 });
    expect(parseWavDurationMs(buf)).toBe(500);
  });

  it('computes duration for 8 kHz / 8-bit µ-law mono (the format Asterisk Channel.record uses for PCMU)', () => {
    // 8000 Hz × 1 byte × 1 ch = 8000 B/s → 16000 bytes = 2000 ms.
    // For µ-law actual WAV writes 0x07 audio-format; for this test we still use PCM bytes-per-second math.
    const buf = makeWavHeader({ sampleRate: 8000, bitsPerSample: 8, numChannels: 1, dataSize: 16000 });
    expect(parseWavDurationMs(buf)).toBe(2000);
  });

  it('returns 0 for an empty data chunk', () => {
    const buf = makeWavHeader({ sampleRate: 8000, bitsPerSample: 16, numChannels: 1, dataSize: 0 });
    expect(parseWavDurationMs(buf)).toBe(0);
  });

  it('throws on a non-RIFF buffer', () => {
    expect(() => parseWavDurationMs(Buffer.from('not-a-wav'))).toThrow(/RIFF/i);
  });
});

describe('assertWavDurationDelta', () => {
  const buf500ms = makeWavHeader({ sampleRate: 8000, bitsPerSample: 16, numChannels: 1, dataSize: 8000 });

  it('passes when actual ≈ expected within tolerance', () => {
    expect(() => assertWavDurationDelta(buf500ms, 500, 50)).not.toThrow();
    expect(() => assertWavDurationDelta(buf500ms, 480, 50)).not.toThrow();
    expect(() => assertWavDurationDelta(buf500ms, 520, 50)).not.toThrow();
  });

  it('throws when actual is outside tolerance', () => {
    expect(() => assertWavDurationDelta(buf500ms, 400, 50)).toThrow(/duration/i);
    expect(() => assertWavDurationDelta(buf500ms, 600, 50)).toThrow(/duration/i);
  });

  it('defaults toleranceMs to 50', () => {
    expect(() => assertWavDurationDelta(buf500ms, 549)).not.toThrow();
    expect(() => assertWavDurationDelta(buf500ms, 551)).toThrow();
  });
});
```

- [ ] **Step 7.2: Run the test and verify it fails**

```bash
pnpm --filter @tas/e2e exec vitest run src/lib/audio.spec.ts
```
Expected: FAIL — "Cannot find module './audio.js'".

- [ ] **Step 7.3: Implement the helper**

Create `apps/e2e/src/lib/audio.ts`:

```ts
import { Buffer } from 'node:buffer';

/**
 * Parse PCM/µ-law WAV header and return the audio duration in milliseconds.
 * Uses the data-chunk size and byte rate from the fmt chunk — no audio decoding.
 *
 * Asterisk Channel.record(format='wav') writes a standard PCM 16-bit / 8 kHz
 * mono WAV; this parser handles that as well as the 8-bit / µ-law variant
 * Asterisk produces when configured for PCMU.
 */
export function parseWavDurationMs(buf: Buffer): number {
  if (buf.length < 44) throw new Error('WAV parse: buffer too small');
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('WAV parse: not a RIFF buffer');
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAV parse: not a WAVE file');

  // Walk chunks from offset 12 until we find 'fmt ' and 'data'.
  let offset = 12;
  let sampleRate = 0;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      // audioFormat (16), numChannels (22), sampleRate (24), byteRate (28), blockAlign (32), bitsPerSample (34)
      sampleRate = buf.readUInt32LE(offset + 12);
      byteRate = buf.readUInt32LE(offset + 16);
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }

  if (byteRate === 0) throw new Error('WAV parse: byteRate is zero or fmt chunk missing');
  return Math.round((dataSize / byteRate) * 1000);
}

/**
 * Asserts the WAV's audio duration is within ±toleranceMs of the expected duration.
 *
 * Used by the S-2 e2e spec to verify that recording_redaction_interval rows
 * agree with the actual WAV produced by Asterisk: wavDurationMs ≈ callDurationMs −
 * Σ(intervalEndMs − intervalStartMs) ± toleranceMs.
 */
export function assertWavDurationDelta(
  wavBytes: Buffer,
  expectedDurationMs: number,
  toleranceMs: number = 50,
): void {
  const actual = parseWavDurationMs(wavBytes);
  const delta = Math.abs(actual - expectedDurationMs);
  if (delta > toleranceMs) {
    throw new Error(
      `WAV duration delta: actual=${actual}ms expected=${expectedDurationMs}ms ` +
      `delta=${delta}ms tolerance=${toleranceMs}ms`,
    );
  }
}
```

- [ ] **Step 7.4: Add `downloadObject` helper to `minio.ts`**

In `apps/e2e/src/lib/minio.ts`, append:

```ts
import { Buffer } from 'node:buffer';

export async function downloadObject(bucket: string, key: string): Promise<Buffer> {
  const stream = await getMinio().getObject(bucket, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}
```

- [ ] **Step 7.5: Run the test and verify pass**

```bash
pnpm --filter @tas/e2e exec vitest run src/lib/audio.spec.ts
```
Expected: 7 tests pass (4 for `parseWavDurationMs`, 3 for `assertWavDurationDelta`).

- [ ] **Step 7.6: Typecheck e2e**

```bash
pnpm --filter @tas/e2e run typecheck
```
Expected: no errors.

- [ ] **Step 7.7: Commit**

```bash
git add apps/e2e/src/lib/audio.ts apps/e2e/src/lib/audio.spec.ts apps/e2e/src/lib/minio.ts
git commit -m "$(cat <<'EOF'
feat(chunk-6/s2): audio.ts assertWavDurationDelta + minio.downloadObject

WAV-header parser computes duration from the data chunk size and byte
rate (no external audio libs). downloadObject pulls a WAV out of MinIO
into a Buffer. Both helpers used by the upcoming S-2 e2e spec to
verify recording_redaction_interval rows match the actual WAV.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: SIPp scenario — `pci-pause.xml`

Mirror `apps/e2e/scenarios/happy-path.xml`, but with a longer hold so the test has time to accept + pause + wait + resume + BYE. No RTP audio is sent — Channel.record writes whatever Asterisk receives, and the e2e duration assertion is robust to silence (we measure WAV duration, not audio content). The smoke-test caveat lives in the spec's leading comment.

**Files:**
- Create: `apps/e2e/scenarios/pci-pause.xml`
- Modify: `apps/e2e/src/run-scenario.ts:6` (extend the `scenario` union type)

- [ ] **Step 8.1: Create the scenario XML**

Create `apps/e2e/scenarios/pci-pause.xml`:

```xml
<?xml version="1.0" encoding="ISO-8859-1" ?>
<!DOCTYPE scenario SYSTEM "sipp.dtd">
<scenario name="S-2 PCI pause/resume INVITE">

  <send retrans="500">
    <![CDATA[
      INVITE sip:+15555550100@[remote_ip]:[remote_port] SIP/2.0
      Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
      From: "sipp" <sip:sipp@[local_ip]:[local_port]>;tag=[call_number]
      To: <sip:+15555550100@[remote_ip]:[remote_port]>
      Call-ID: [callid]
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
      m=audio 8000 RTP/AVP 0
      a=rtpmap:0 PCMU/8000
    ]]>
  </send>

  <recv response="100" />

  <!-- Hold the call open for ~10 s: accept (≤1s) + 2s + pause + 2s + resume + 2s + BYE.
       Stasis doesn't auto-answer in PoC. SIPp does not send RTP — Asterisk writes
       silence into the WAV during recording, which is fine for the duration-delta
       assertion (we measure header duration, not audio content). -->
  <pause milliseconds="10000" />

  <send retrans="500">
    <![CDATA[
      BYE sip:+15555550100@[remote_ip]:[remote_port] SIP/2.0
      Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
      From: "sipp" <sip:sipp@[local_ip]:[local_port]>;tag=[call_number]
      To: <sip:+15555550100@[remote_ip]:[remote_port]>
      Call-ID: [callid]
      CSeq: 2 BYE
      Max-Forwards: 70
      Content-Length: 0
    ]]>
  </send>

  <recv response="481" optional="true" />

</scenario>
```

- [ ] **Step 8.2: Add `'pci-pause'` to the scenario union in `run-scenario.ts`**

In `apps/e2e/src/run-scenario.ts:6`, extend the union:

```ts
export interface RunScenarioParams {
  scenario: 'happy-path' | 'caller-hangup' | 'pci-pause';
  callId: string;
  target?: string;
}
```

Also update the CLI parsing at the bottom of the file (line ~58):
```ts
    scenario: argv[scenarioIdx + 1] as 'happy-path' | 'caller-hangup' | 'pci-pause',
```

- [ ] **Step 8.3: Smoke-test the scenario via SIPp dry-run**

```bash
docker compose -f apps/e2e/docker-compose.sipp.yml run --rm sipp \
  -sf /scenarios/pci-pause.xml -dry-run 127.0.0.1:5060 || true
```
Expected: SIPp parses the XML without error. (The `|| true` suppresses the non-zero exit from `-dry-run` mode; we only care that parsing succeeded — no "scenario parser error".)

- [ ] **Step 8.4: Commit**

```bash
git add apps/e2e/scenarios/pci-pause.xml apps/e2e/src/run-scenario.ts
git commit -m "$(cat <<'EOF'
feat(chunk-6/s2): SIPp pci-pause scenario — 10s hold + BYE

Mirrors happy-path.xml but holds the dialog open for 10s — enough time
for the e2e spec to accept, pause, wait, resume, wait again, then let
SIPp send BYE. No RTP audio; Asterisk writes silence into the WAV,
which is fine for the duration-delta assertion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: e2e spec — `poc-e2e-s2-pci-pause.spec.ts`

The full S-2 scenario: SIPp INVITE → accept → t=2 s pause → t=4 s resume → BYE → assert DB rows + download WAV from MinIO + duration-delta ± 50 ms.

**Files:**
- Create: `apps/e2e/specs/poc-e2e-s2-pci-pause.spec.ts`

- [ ] **Step 9.1: Write the spec**

Create `apps/e2e/specs/poc-e2e-s2-pci-pause.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { eq, asc } from 'drizzle-orm';
import { runScenario } from '../src/run-scenario.js';
import { OperatorPage } from '../pages/OperatorPage.js';
import { getDb, schema, closeDb } from '../src/lib/db.js';
import { objectExists, downloadObject } from '../src/lib/minio.js';
import { assertTenant } from '../src/lib/assert-tenant.js';
import { assertWavDurationDelta } from '../src/lib/audio.js';

const SEEDED_TENANT_ID   = '11111111-1111-1111-1111-111111111111';
const SEEDED_OPERATOR_ID = '66666666-6666-6666-6666-666666666666';
const RECORDINGS_BUCKET  = 'tas-recordings';

const CI = !!process.env.CI;
const SCREEN_POP_BUDGET_MS  = CI ? 3_000 : 40_000;
const PAUSE_ROW_TIMEOUT_MS  = 1_000;
const WAV_EXISTS_TIMEOUT_MS = 5_000;
const SCENARIO_WALL_CLOCK_MS = 60_000;

const PAUSE_DURATION_MS = 2_000;
const WAV_TOLERANCE_MS  = 50;

test.afterAll(async () => { await closeDb(); });

test('S-2 PCI pause/resume: redaction-interval rows + WAV duration ≈ call − paused window', async ({ page, request }) => {
  test.setTimeout(SCENARIO_WALL_CLOCK_MS);
  const start = Date.now();

  const sipCallId = uuidv4();
  const op = new OperatorPage(page);

  // 1. Open operator UI; wait for WS before firing INVITE.
  await op.goto(SEEDED_OPERATOR_ID);
  await op.waitForWsOpen();

  // 2. Fire SIPp INVITE asynchronously. Holds the dialog ~10s.
  const sippPromise = runScenario({ scenario: 'pci-pause', callId: sipCallId });

  // 3. Screen-pop renders; capture real callId.
  const { callId } = await op.waitForScreenPop({ timeoutMs: SCREEN_POP_BUDGET_MS });

  // 4. Operator accepts (this exposes the PCI button).
  const acceptedAt = Date.now();
  await op.accept();

  // 5. Wait ~2 s, then click PCI pause. The button's text alternates between "PCI pause" and "Resume".
  await page.waitForTimeout(2_000);
  const pauseBtn = page.getByRole('button', { name: /pci pause/i });
  await expect(pauseBtn).toBeVisible();
  await pauseBtn.click();

  // 6. Within 1 s, a recording_redaction_interval row exists with end_ms NULL.
  const db = getDb();
  await expect.poll(async () => {
    const [rec] = await db.select().from(schema.recording).where(eq(schema.recording.callId, callId));
    if (!rec) return null;
    const rows = await db.select().from(schema.recordingRedactionInterval)
      .where(eq(schema.recordingRedactionInterval.recordingId, rec.id));
    return rows.find((r) => r.endMs === null) ?? null;
  }, { timeout: PAUSE_ROW_TIMEOUT_MS, message: 'open redaction-interval row not seen within 1s of pause' })
    .not.toBeNull();

  // 7. Wait the pause window, then click Resume.
  await page.waitForTimeout(PAUSE_DURATION_MS);
  const resumeBtn = page.getByRole('button', { name: /resume/i });
  await expect(resumeBtn).toBeVisible();
  await resumeBtn.click();

  // 8. Within 1 s, the open interval's end_ms is populated.
  await expect.poll(async () => {
    const [rec] = await db.select().from(schema.recording).where(eq(schema.recording.callId, callId));
    if (!rec) return false;
    const rows = await db.select().from(schema.recordingRedactionInterval)
      .where(eq(schema.recordingRedactionInterval.recordingId, rec.id));
    return rows.every((r) => r.endMs !== null);
  }, { timeout: PAUSE_ROW_TIMEOUT_MS, message: 'redaction-interval end_ms not populated within 1s of resume' }).toBe(true);

  // 9. Let SIPp send BYE and the StasisEnd flow finalize the recording + upload WAV to MinIO.
  // sippPromise resolves when SIPp exits. Note: SIPp's exit code is intentionally NOT asserted
  // for the same Docker-bridge-NAT reason documented in poc-e2e-s3-caller-hangup.spec.ts.
  await sippPromise;

  // 10. Recording.endedAt populated; WAV uploaded to MinIO.
  await expect.poll(async () => {
    const [rec] = await db.select().from(schema.recording).where(eq(schema.recording.callId, callId));
    return rec?.endedAt != null;
  }, { timeout: WAV_EXISTS_TIMEOUT_MS, message: 'recording.endedAt not populated after BYE' }).toBe(true);

  const minioKey = `recordings/${callId}.wav`;
  await expect.poll(() => objectExists(RECORDINGS_BUCKET, minioKey), { timeout: WAV_EXISTS_TIMEOUT_MS })
    .toBe(true);

  // 11. Download the WAV and assert the duration delta.
  //
  // Expected duration = (call ended − call accepted) − Σ(redaction window).
  // We can compute the call's wall-clock duration from accepted_at + the SIPp dialog end.
  // Use the recording row's startedAt and endedAt as the source of truth instead — those
  // are written by StasisStart/StasisEnd and bracket the time Channel.record was live.
  const [rec] = await db.select().from(schema.recording).where(eq(schema.recording.callId, callId));
  const callDurationMs = new Date(rec.endedAt!).getTime() - new Date(rec.startedAt).getTime();

  const intervals = await db.select().from(schema.recordingRedactionInterval)
    .where(eq(schema.recordingRedactionInterval.recordingId, rec.id))
    .orderBy(asc(schema.recordingRedactionInterval.startMs));
  const sumPausedMs = intervals.reduce((acc, iv) => acc + ((iv.endMs ?? 0) - iv.startMs), 0);
  const expectedDurationMs = callDurationMs - sumPausedMs;

  const wavBytes = await downloadObject(RECORDINGS_BUCKET, minioKey);
  assertWavDurationDelta(wavBytes, expectedDurationMs, WAV_TOLERANCE_MS);

  // 12. tenant_id integrity (recording inherits via FK; assert covers call + recording).
  await assertTenant(SEEDED_TENANT_ID, callId);

  // 13. Wall-clock budget assertion.
  const elapsed = Date.now() - start;
  expect(elapsed, `total elapsed ${elapsed}ms exceeded ${SCENARIO_WALL_CLOCK_MS}ms`).toBeLessThan(SCENARIO_WALL_CLOCK_MS);

  // Reference unused locals to satisfy noUnusedLocals if it's enabled in this package.
  void acceptedAt;
  void request;
});
```

- [ ] **Step 9.2: Add the `test:e2e:s2` script in `apps/e2e/package.json`**

In `apps/e2e/package.json` line 9 (next to the existing `test:e2e:s1` and `test:e2e:s3` scripts):

```json
    "test:e2e:s2": "playwright test specs/poc-e2e-s2-pci-pause.spec.ts",
```

- [ ] **Step 9.3: Typecheck e2e**

```bash
pnpm --filter @tas/e2e run typecheck
```
Expected: no errors.

- [ ] **Step 9.4: Run S-2 locally end-to-end**

Ensure the stack is up with all the changes baked in:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml down
export INTERNAL_API_TOKEN="local-dev-token" APP_JWT_SECRET="poc-only-not-prod"
make poc-up-all-docker
./scripts/wait-for-healthy.sh infra/docker-compose.yml infra/docker-compose.all-in.yml
make poc-seed

pnpm --filter @tas/e2e run test:e2e:s2 2>&1 | tee /tmp/s2-local.log
```
Expected: green within ~20 s.

**If it fails:** common gotchas to check first —
- Recording file path inside the api container: `docker compose exec api ls -la /var/spool/asterisk/recording` (must show the WAV).
- Asterisk ARI 401: check that `infra/asterisk/ari.conf` has `tas:tas` user — the `ari-client` factory in `apps/api/src/ari/ari.module.ts:18` uses these creds.
- "no open recording for call" 404 on POST /pause: means recording row wasn't inserted at StasisStart — verify `RecordingService.startRecording` is awaited (it is in `stasis-start.handler.ts:87`).
- WAV duration mismatch: dump the WAV from MinIO with `mc cp local/tas-recordings/recordings/<callId>.wav /tmp/s2.wav` and inspect with `ffprobe /tmp/s2.wav`. If the duration matches wall-clock (10 s) instead of (call − 2 s), Asterisk wrote silence during pause — fall back to post-processing in the api (splice out the paused window before upload) or audit the ARI Recordings.pause behavior in the running stack.

- [ ] **Step 9.5: Run S-1 and S-3 to confirm no regression**

```bash
pnpm --filter @tas/e2e run test:e2e:s1
pnpm --filter @tas/e2e run test:e2e:s3
```
Expected: both green. S-1 now exercises real Channel.record + MinIO upload (instead of the zero-byte placeholder); confirm the existing assertion `objectExists(RECORDINGS_BUCKET, minioKey)` still passes (the object is now non-empty bytes — still passes the assertion).

- [ ] **Step 9.6: Commit**

```bash
git add apps/e2e/specs/poc-e2e-s2-pci-pause.spec.ts apps/e2e/package.json
git commit -m "$(cat <<'EOF'
feat(chunk-6/s2): e2e spec — pause/resume rows + WAV duration delta

SIPp INVITE → accept → 2s → pause → 2s → resume → BYE. Asserts the
open redaction-interval row exists within 1s of pause, end_ms is
populated within 1s of resume, recording.endedAt populated post-BYE,
WAV exists in MinIO, and duration ≈ (recording.endedAt − startedAt) −
Σ(paused windows) ± 50 ms.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Makefile + CI matrix + open PR

**Files:**
- Modify: `Makefile` (add `poc-e2e-s2`; extend `poc-e2e` aggregate)
- Modify: `.github/workflows/poc-e2e.yml:16` (add `s2` to matrix)

- [ ] **Step 10.1: Add the Make target**

In `Makefile`, after the existing `poc-e2e-s3` target (~line 97):

```makefile
# Run the S-2 e2e spec.
poc-e2e-s2:
	pnpm --filter @tas/e2e run test:e2e:s2
```

Update the aggregate target (~line 101) to include S-2:

```makefile
poc-e2e: poc-e2e-s1 poc-e2e-s2 poc-e2e-s3
```

- [ ] **Step 10.2: Add `s2` to the GHA matrix**

In `.github/workflows/poc-e2e.yml:16`:

```yaml
        scenario: [s1, s2, s3]
```

- [ ] **Step 10.3: Verify the new target works locally**

```bash
make poc-e2e-s2
```
Expected: green.

- [ ] **Step 10.4: Commit**

```bash
git add Makefile .github/workflows/poc-e2e.yml
git commit -m "$(cat <<'EOF'
ci(chunk-6/s2): add s2 to e2e matrix + Makefile target

Adds make poc-e2e-s2 and includes s2 in the GHA matrix axis. The
sequential poc-e2e aggregate now runs s1, s2, s3 in order.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10.5: Push and open PR**

```bash
git push -u origin mvp/chunk-6-s2-pci-pause
gh pr create --base main --title "feat(chunk-6/s2): PCI pause/resume — single WAV + redaction intervals" --body "$(cat <<'EOF'
## Summary

Lands slice S-2 of MVP Chunk 6. Operator's F03 PCI pause/resume drives real Asterisk recording control: `Channel.record` writes a single WAV per call to a shared Docker volume, `Recordings.pause`/`Recordings.unpause` produce a temporal discontinuity (no silence written during paused windows per Asterisk 20 ARI docs), `recording_redaction_interval` rows track each redacted segment, and `StasisEndHandler` uploads the final WAV to MinIO at the canonical key.

## Design deviation from spec §3.2

The spec calls for "MixMonitor stop + restart with append flag (a)." MixMonitor is not in Asterisk 20's standard ARI swagger schema, so it's not addressable from `ari-client@2.2.0`. This PR uses ARI-native `Channel.record` + `Recordings.pause`/`unpause` instead. The observable semantics are identical: single WAV per call, paused windows produce no audio, redaction-interval row is the source of truth, audio.ts asserts duration-delta. Documented in the plan's "Deviation from spec §3.2" section.

## What changed

- **Schema:** `recording_redaction_interval.end_ms` is now nullable.
- **Infra:** shared `recordings` Docker volume is mounted read-only into the `api` service so `RecordingService.finalizeRecording` can read the WAV at StasisEnd and upload to MinIO.
- **api:** new `CallsController` exposes `POST /v1/calls/:id/pause` and `/resume`. New `AriCommandsService` wraps the live ARI handle. `RecordingService` replaces its zero-byte MinIO placeholder with real Channel.record + post-call upload.
- **web:** `operator/page.tsx` PCI toggle wires to the new API; local `paused` state flips only on success.
- **e2e:** new `assertWavDurationDelta` helper parses WAV headers; new `downloadObject` MinIO helper; new SIPp `pci-pause.xml` scenario; new `poc-e2e-s2-pci-pause.spec.ts`; new `make poc-e2e-s2` + GHA matrix entry.

## Test plan

- [x] Unit tests pass: `AriCommandsService`, `RecordingService.finalizeRecording`, `CallsController`, `parseWavDurationMs`/`assertWavDurationDelta`.
- [x] `make poc-e2e-s1` still green (now exercises real Channel.record + upload).
- [x] `make poc-e2e-s2` green locally (within 60 s budget).
- [x] `make poc-e2e-s3` still green.
- [ ] CI matrix [s1, s2, s3] all green on this PR.

## Watched-not-fixed

- HC#2 WsGateway race (carried from Chunk 5) — not surfaced by S-2.
- ARI recordings.pause "no audio during paused window" semantics confirmed for PCMU/8kHz mono in local-dev smoke (Task 2.4). Re-confirm in CI; if a future codec change writes silence during pause, audio.ts assertion fails loudly and we revisit.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Capture it and report back.

---

## Self-review pass

- **Spec §3.2 coverage:**
  - F03 PCI button wired to backend → Task 6.
  - POST /v1/calls/:id/pause + /resume → Task 5 (with deviation note: ARI-native pause/unpause not MixMonitor).
  - Single WAV per call, no audible silence during pause → Task 2.4 (smoke verifies it), Task 4 (recording infra).
  - `recording_redaction_interval` row write/update semantics → Task 1 (nullable end_ms), Task 5 (write on pause, update on resume).
  - WAV duration-delta ±50 ms assertion → Task 7 (audio.ts), Task 9 (e2e spec).
  - MinIO ETag bounded-poll helper — **omitted** as a deliberate simplification: the WAV is uploaded once at StasisEnd, not mid-call, so an ETag-change-poll adds nothing over an existence-poll. Documented in the deviation note at the top of the plan.
  - `tenant_id` JOIN assertion across call/recording/recording_redaction_interval → Task 9 step 12 (`assertTenant` already does this via existing helper).
- **Spec §4 coverage:** no schema deltas for S-2 beyond the end_ms nullability — Task 1 handles it.
- **Spec §5 coverage:** Makefile + CI matrix — Task 10.
- **Spec §6 coverage:**
  - TDD per slice: red spec → green minimum → refactor → CI green — every task writes test first, runs to confirm failure, implements minimum, runs to confirm pass.
  - Unit tests added per spec list: `audio.spec.ts` ✓ (Task 7), `minio.spec.ts` for `pollObjectETagChanged` **omitted** (helper itself omitted per the deviation note).
  - Manual smoke (pjsua pause/resume/inspect-wav) → Task 2.4.
- **Spec §7 risks acknowledged:** §7.1 (append-flag verification) re-cast as Task 2.4 — verifies the ARI-native pause/unpause behavior in our actual stack.
- **Placeholders scan:** no "TBD", no "add appropriate error handling" without code, no "similar to Task N" references. Every code block contains the actual code to write.
- **Type consistency:** `AriCommandsService` methods (`startRecording`, `pauseRecording`, `resumeRecording`, `stopRecording`) are named consistently in Task 3 (definition), Task 4 (RecordingService usage), Task 5 (CallsController usage). `parseWavDurationMs` and `assertWavDurationDelta` are named consistently between Task 7 (definition, test) and Task 9 (usage). `pauseCall`/`resumeCall` web helpers are named consistently between Task 6 (definition) and the wiring in `operator/page.tsx`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-chunk-6-s2-pci-pause.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task with code-reviewer between tasks; fastest iteration, smallest main-context load.

**2. Inline Execution** — Tasks executed in this session via `superpowers:executing-plans`; batch with checkpoints.

Which approach?
