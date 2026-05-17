# Chunk 5 — e2e harness + S-1 CI green (design spec)

> Status: **Draft (pending user review)** · Date: 2026-05-17 · Owner: founder (solo) · Source: [`docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md`](./2026-05-14-local-mvp-chunk-plan-design.md) §"Chunk 5" · Predecessor chunks closed in `3012d4d` (Chunk 4 merge) · ADRs: [ADR-0025 Asterisk-direct](../../adr/0025-telephony-asterisk-direct.md), [ADR-0024 queue budget](../../adr/0024-queue-budget.md)

## 0. Scope and framing

This document is the **design spec for Chunk 5** of the local-runnable MVP. The master chunk-plan (2026-05-14) fixes the chunk's goal, scope, and exit criteria; this spec fleshes out architecture, component boundaries, test layers, the parallel subagent dispatch plan, and **one material amendment**: the master plan predates the 2026-05-15 scope deferral (ADR-0025 Asterisk-direct). ADR-0025 assigned the Kamailio/rtpengine compose rewire to "Chunk 4 scope" — Chunk 4 did not execute it. **Chunk 5 absorbs that rewire as Phase 0** before the harness work begins. The chunk's exit criteria now include topology alignment with ADR-0025.

**What this chunk delivers:** S-1 happy-path runs end-to-end in GitHub Actions on Linux, deterministically, gated on every push to `mvp/**`. Locally, `make poc-e2e-s1` exits 0. The compose stack matches ADR-0025 (no Kamailio, no rtpengine in the call path). The all-in-docker target (`make poc-up-all-docker`) gives CI parity with host-dev.

**Settled procedural decisions (this brainstorm session, 2026-05-17):**

1. **Topology rewire first, harness second.** Phase 0 (main thread, serial) → Phase 1 (three subagents in parallel) → Phase 2 (CI workflow on main thread) → Phase 3 (readout + PR).
2. **SIPp Docker image** is the e2e driver (master-plan default). `pot/cli-softphone/` pjsua remains for manual interactive smokes.
3. **Playwright driving real headless Chromium** exercises the operator leg end-to-end (master-plan default).
4. **GitHub Actions hosted runner** (`ubuntu-22.04`) — this is the project's first CI workflow.
5. **Recording assertion = existence-only.** WAV row + MinIO object presence + `tenant_id`. No content/silence check (deferred to Chunk 6 / S-2 where the audio path is wired).
6. **Single PR for the chunk** — matches Chunk 4 convention; operator confirms each network op.

## 1. Goal & exit criteria

**Goal:** S-1 happy-path is the first MVP scenario gated by automated CI. `make poc-e2e-s1` exits 0 locally on Linux and in GitHub Actions on `ubuntu-22.04`. Compose stack is ADR-0025-aligned.

**Exit criteria:**

1. **Topology rewire green** (ADR-0025 alignment):
   - `grep -c 'kamailio\|rtpengine' infra/docker-compose.yml` returns `0`.
   - `infra/kamailio/` → `infra/kamailio.deferred/` via `git mv` (preserve history per ADR-0025 §"Existing… are NOT removed in this ADR" — the rename now lands here as the deferred state).
   - `infra/rtpengine/` → `infra/rtpengine.deferred/` via `git mv`.
   - `infra/asterisk/pjsip.conf` accepts INVITEs on UDP/5060 directly from a carrier-shape endpoint (no internal trunk).
   - `make poc-up` exits 0 with one fewer healthcheck count (kamailio removed) and no rtpengine service.
   - Post-rewire spot-check: 5-line addendum in `poc/smoke-chunk4.md` recording one successful pjsua → asterisk:5060 manual probe and the new healthy-services list.
2. **`apps/e2e` package present** with: Playwright config, SIPp orchestrator (`run-scenario.ts`), assertion helpers (`lib/assert-tenant.ts`, `lib/db.ts`, `lib/minio.ts`, `lib/temporal.ts`, `lib/ari.ts`), page objects under `pages/`, specs under `specs/`.
3. **`poc-e2e-s1-happy-path.spec.ts`** red → green TDD-style. Asserts in order:
   - SIPp INVITE accepted by Asterisk (StasisStart observed via ARI helper).
   - `stasis.start` NATS message observed (optional debug subscription via `ws-tap.ts`).
   - Playwright headless Chromium receives WS `call.screen-pop` frame AND `[data-testid="screen-pop"][data-call-id=<callId>]` renders within **800 ms** of INVITE.
   - Playwright fills message, clicks Submit; `POST /v1/Message` returns 201 within 1 s.
   - `DispatchMessage` workflow Completed within 30 s (Temporal client query).
   - `dispatch_attempt.delivered_at` non-null in Postgres.
   - `recording` row exists in Postgres; MinIO object at `recordings/<callId>.wav` exists (`headObject` 200; content unchecked).
   - `tenant_id` matches seeded tenant on every relevant row (`call`, `recording`, `dispatch_attempt`, `queue_call`) via `assert-tenant.ts`.
   - **Per-scenario wall-clock ≤ 75 s** (master plan §"Chunk 6"). Spec times itself; failure on overrun.
4. **`make poc-up-all-docker` exits 0 on Linux** with three new Dockerfiles for api/web/temporal-worker plus `infra/docker-compose.all-in.yml` override. After boot, `curl http://localhost:3000/v1/Account/<seeded>` returns the seeded account JSON.
5. **GitHub Actions `poc-e2e.yml` green** on a `mvp/*` push: `pnpm install --frozen-lockfile && npx playwright install --with-deps chromium && make poc-up-all-docker && make poc-seed && pnpm --filter @tas/api run test && make poc-e2e-s1`. Repo secrets `INTERNAL_API_TOKEN` and `APP_JWT_SECRET` present.
6. **`poc/readout-slice1.md` committed** with: CI run URL, total wall-clock, per-step timing, assertion-by-assertion pass evidence, residual issues list.

## 2. Architecture

### 2.1 Workspace + infra layout (post-Chunk 5)

```
apps/
  e2e/                              ← NEW (@tas/e2e)
    package.json
    playwright.config.ts            single project, chromium, baseURL=http://localhost:3001
    docker-compose.sipp.yml         SIPp container, mounts ./scenarios
    scenarios/
      happy-path.xml                INVITE → wait 100 Trying → pause 5000ms → BYE
    src/
      run-scenario.ts               CLI: launches SIPp container, returns {callId, exitCode, stderr}
      lib/
        assert-tenant.ts            queries each per-tenant table, asserts seeded tenant_id
        db.ts                       drizzle client → compose Postgres (port 5432, direct, not pooled)
        minio.ts                    minio-js client; objectExists / objectSize helpers
        temporal.ts                 @temporalio/client wrapper: waitForWorkflowCompletion(workflowId, timeoutMs)
        ari.ts                      thin ARI REST helper: channel list / channel-by-callId
        ws-tap.ts                   optional NATS subscriber for raw 'stasis.start' (debug aid)
    pages/
      OperatorPage.ts               goto, waitForWsOpen, waitForScreenPop, accept, fillMessage, submit
    specs/
      poc-e2e-s1-happy-path.spec.ts
    test/                           vitest, no compose
      run-scenario.spec.ts          asserts docker compose argv shape
      assert-tenant.spec.ts         asserts every per-tenant table is selected

infra/
  docker-compose.yml                ← MODIFIED: kamailio + rtpengine services removed
  docker-compose.all-in.yml         ← NEW: override layering api/web/temporal-worker as services
  kamailio.deferred/                ← RENAMED from kamailio/  (ADR-0025 trace, preserved configs)
  rtpengine.deferred/               ← RENAMED from rtpengine/
  asterisk/
    pjsip.conf                      ← MODIFIED: carrier-shape endpoint on UDP/5060
    extensions.conf                 unchanged (topology-agnostic per ADR-0025)
  api.Dockerfile                    ← NEW: node:22-alpine multi-stage, prod build
  web.Dockerfile                    ← NEW: node:22-alpine multi-stage, next build
  temporal-worker.Dockerfile        ← NEW: node:22-alpine multi-stage, tsc build

.github/
  workflows/
    poc-e2e.yml                     ← NEW: ubuntu-22.04, push on mvp/**, PR to main

poc/
  readout-slice1.md                 ← NEW: filled at chunk close
  smoke-chunk4.md                   ← APPENDED: 5-line post-rewire spot-check

Makefile                            ← AMENDED: new targets poc-up-all-docker,
                                              poc-test-all-docker-up, poc-e2e-s1
```

### 2.2 Topology rewire (Phase 0 — main thread)

`infra/asterisk/pjsip.conf` changes:

- **Remove** the internal trunk endpoint that pointed at Kamailio.
- **Add** a carrier-shape endpoint:
  ```
  [carrier-sipp]
  type=endpoint
  context=incoming
  disallow=all
  allow=ulaw
  direct_media=no
  rtp_symmetric=yes
  force_rport=yes
  rewrite_contact=yes
  aors=carrier-sipp
  ```
  Plus matching `[carrier-sipp]` `aor` and `identify` blocks scoped to the `5060/udp` transport. No authentication (PoC; matches Chunk 3 SIPp injection pattern).
- **Keep** the existing `[alice]` / `[bob]` endpoints unchanged so the `pot/cli-softphone` manual smoke continues to work against the same Asterisk.

`infra/docker-compose.yml` changes:

- Remove the `kamailio:` service block in its entirety.
- Remove the `rtpengine:` service block in its entirety.
- Remove the `KAMAILIO_SIP_HOST_PORT` env interpolation.
- Publish `5060/udp` directly from the `asterisk` service to the host (new SIP entry point).
- Verify `scripts/wait-for-healthy.sh` (Chunk 1) tolerates the smaller service list — it iterates `docker compose ps`, so it does.

Renamed `infra/kamailio.deferred/` and `infra/rtpengine.deferred/` directories preserve the Chunk 1 configs verbatim in case the SBC tier is reintroduced per ADR-0025 §"Re-introduction trigger" — single `git mv` per directory.

**Post-rewire verification (operator, before subagent fan-out):**

1. `make poc-down -v && make poc-up && make poc-seed` exits 0.
2. `docker compose ps` shows no kamailio, no rtpengine; asterisk healthy.
3. `pot/cli-softphone/bin/pjsua` registers via `5060/udp` directly to Asterisk; INVITE to `sip:9999@localhost:5060` fires a StasisStart in the api logs.
4. Five-line addendum appended to `poc/smoke-chunk4.md` with the date, the pjsua command, the StasisStart timestamp, and confirmation `dispatch_attempt.delivered_at` populated end-to-end on the rewired stack.

If step 3 fails, Phase 0 isn't done; subagents do not launch.

### 2.3 SIPp orchestration (Phase 1, subagent A)

`apps/e2e/docker-compose.sipp.yml` runs a pinned SIPp image (`ctaloni/sipp:3.6.2` or equivalent stable tag — see §8 Risks #6) on the same docker network as the infra stack, mounting `./scenarios:/scenarios:ro`. `run-scenario.ts` is a thin TypeScript wrapper:

```
$ pnpm --filter @tas/e2e run scenario \
    --scenario happy-path \
    --target asterisk:5060 \
    --callId <uuid>
```

Behavior:

1. Caller passes (or it generates) a fresh `callId` UUID v4.
2. Spawns `docker compose -f apps/e2e/docker-compose.sipp.yml run --rm sipp ...` with the scenario file and `-key callId <uuid>` (SIPp `[key]` substitution lands in INVITE's `Call-ID` header).
3. Captures SIPp stdout + stderr; returns `{ callId, exitCode, stderr }`.
4. Does **not** wait for assertions — the spec orchestrates async assertions in parallel with the call.

The scenario is intentionally minimal: `INVITE → wait for 100 Trying → pause 5000 ms → BYE`. No 200 OK exchange — Asterisk's Stasis app doesn't auto-answer in Chunk 4/5 state (handoff carry-forward #5 / Chunk 6 owns `channel.answer()`). SIPp will log "Failed call: 1"; that is expected and not a test failure (matches Chunk 3 smoke convention).

### 2.4 Playwright + spec (Phase 1, subagent B)

`playwright.config.ts`: single project, headless Chromium, `baseURL=http://localhost:3001`. No screenshots/traces on green; both on red.

`pages/OperatorPage.ts` exposes:

- `goto(operatorId)` — navigates to `/operator?operatorId=<id>`, waits for `[data-testid="ws-ready"]` (the operator page sets it once `ws.readyState === OPEN`).
- `waitForWsOpen()` — explicit step in case the spec wants to fire the INVITE on a different code path; idempotent with `goto`.
- `waitForScreenPop({ callId, timeout = 1000 })` — waits for `[data-testid="screen-pop"][data-call-id=<callId>]`.
- `accept()` — clicks `[data-testid="accept-call"]`.
- `fillMessage(text)` — types into `[data-testid="message-textarea"]`.
- `submit()` — clicks `[data-testid="message-submit"]`; uses `page.waitForResponse` to capture the `POST /v1/Message` response and returns its JSON body + status.

The spec orchestrates:

```ts
test('S-1 happy path', async ({ page }) => {
  const callId = uuidv4();
  const op = new OperatorPage(page);

  // Browser open + WS connected BEFORE INVITE — eliminates WS race
  await op.goto(SEEDED_OPERATOR_ID);
  await op.waitForWsOpen();

  // Fire INVITE async — SIPp runs in parallel with the assertions below
  const inviteAt = Date.now();
  const sippPromise = runScenario({ scenario: 'happy-path', callId });

  // Screen-pop budget: measured from INVITE-fire, not from goto()
  await op.waitForScreenPop({ callId, timeout: 1000 });
  const elapsedScreenPop = Date.now() - inviteAt;
  expect(elapsedScreenPop).toBeLessThan(800);

  await op.accept();
  await op.fillMessage('Pickup follow-up');
  const { status, body } = await op.submit();
  expect(status).toBe(201);

  // Workflow completion
  const workflowId = `dispatch-${body.messageId}`;
  await waitForWorkflowCompletion(workflowId, 30_000);

  // DB + MinIO + tenant assertions
  await assertDispatchDelivered(body.messageId);
  await assertRecording(callId);
  await assertTenant(SEEDED_TENANT_ID, callId);

  // Let SIPp finish to keep teardown clean
  await sippPromise;
}, { timeout: 75_000 });  // master plan §"Chunk 6" per-scenario S-1 budget
```

### 2.5 All-in-docker (Phase 1, subagent C)

Three multi-stage Dockerfiles, all `node:22-alpine` base. Shape:

```
FROM node:22-alpine AS deps
WORKDIR /app
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/<name>/package.json apps/<name>/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ari-client/package.json packages/ari-client/   # api only
RUN npm i -g pnpm@8.15.4 && pnpm fetch && pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @tas/<name> run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /app/apps/<name>/dist ./dist
COPY --from=build /app/apps/<name>/package.json ./
COPY --from=build /app/node_modules ./node_modules
EXPOSE <port>
CMD ["node", "dist/main.js"]
```

Per-app variations: `apps/web` runs `next start -p 3001`; `apps/temporal-worker` runs `node dist/worker.js`; `apps/api` runs `node dist/main.js` on port 3000.

`infra/docker-compose.all-in.yml` is a **compose override** loaded via:

```
docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml up -d --build
```

It adds three services (`api`, `web`, `temporal-worker`) on the same network, sets the env vars host-dev already uses but rewired for in-cluster DNS (`postgres://tas.tas:tas@supavisor:6543/tas`, `TEMPORAL_ADDRESS=temporal:7233`, `NATS_URL=nats://nats:4222`, `MINIO_ENDPOINT=minio`, `WEB_ORIGIN=http://web:3001`, etc.). Healthchecks: api `wget --spider http://localhost:3000/health`; web `wget --spider http://localhost:3001`; temporal-worker process-up only (no HTTP). Depends on the matching infra services being healthy.

Makefile additions:

```make
poc-up-all-docker:
	docker compose -f $(COMPOSE_FILE) -f infra/docker-compose.all-in.yml up -d --build
	@./scripts/wait-for-healthy.sh $(COMPOSE_FILE)
	@$(MAKE) _supavisor-register-tenant

poc-test-all-docker-up:
	@curl -sf http://localhost:3000/v1/Account/00000000-0000-0000-0000-000000000001 > /dev/null \
	  && echo "API reachable via all-in-docker" \
	  || (echo "API not reachable" && exit 1)

poc-e2e-s1:
	pnpm --filter @tas/e2e run test:e2e:s1
```

Host-dev (`make poc-up`) is unaffected — infra-only. `make poc-up-all-docker` is the CI parity path.

### 2.6 CI workflow (Phase 2 — main thread)

`.github/workflows/poc-e2e.yml`:

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
        run: docker compose -f infra/docker-compose.yml -f infra/docker-compose.all-in.yml down -v
```

Job timeout is generous (25 min) for the first run; steady-state ~10–14 min. First-run failure modes: pnpm version drift, Playwright browser install size cap, compose healthcheck timing on slower hosted runner. Mitigations in §8.

## 3. Data flow (S-1 happy path)

```
GitHub Actions ubuntu-22.04
   ↓
make poc-up-all-docker
   ↓ (rewired infra + api/web/temporal-worker as compose services)
asterisk · postgres · supavisor · nats · redis · temporal · minio · caddy
                                                                       + api · web · temporal-worker
   ↓
make poc-seed
   ↓ (1 tenant, 1 operator, 1 DID, 1 queue inserted)
pnpm --filter @tas/api run test     (vitest + testcontainers — NO compose needed for this step)
   ↓
make poc-e2e-s1
   ↓ (Playwright spec orchestrates the sequence below)

   ┌─ Playwright opens chromium → http://localhost:3001/operator?operatorId=...
   │   page mounts, fetches /v1/dev/operator-token, opens WS at /ws → readyState=OPEN
   │
   ├─ runScenario({scenario:'happy-path', callId})
   │     ↓ docker compose run --rm sipp
   │     ↓ INVITE sip:9999@asterisk:5060   (Call-ID = callId UUID, From=sipp)
   │   asterisk:
   │     ↓ pjsip endpoint=carrier-sipp accepts INVITE → context=incoming
   │     ↓ dialplan: same → Stasis(tas-arbiter, ${UNIQUEID}, callId)
   │     ↓ ARI websocket emits StasisStart
   │   api:
   │     ↓ StasisStartHandler →
   │         (a) inserts call + recording rows (tenant_id from DID lookup)
   │         (b) calls RecordingService.startRecording → MixMonitor + MinIO placeholder
   │         (c) calls ArbiterService.pickOperator → seeded operator
   │         (d) publishes NATS 'stasis.start' { callId, tenantId, operatorId }
   │         (e) calls WsGateway.sendToOperator(operatorId, {event:'call.screen-pop', data:{callId,...}})
   │   web (already-open browser tab):
   │     ↓ lib/ws.ts receives frame → routes to ScreenPop via event bus
   │     ↓ ScreenPop renders [data-testid="screen-pop"][data-call-id=callId]
   │       T_screen_pop measured from INVITE-fire → must be ≤800 ms
   │
   ├─ Playwright op.accept() · op.fillMessage('...') · op.submit()
   │     ↓ POST /v1/Message  Authorization: Bearer <dev-token>
   │     ↓ Body: {callId, operatorId, text, tenantId}
   │   api:
   │     ↓ MessageController:
   │         (a) INSERT message row
   │         (b) INSERT dispatch_attempt row (attempted_at = now())
   │         (c) temporalClient.workflow.start('DispatchMessage', {messageId,...}, workflowId:'dispatch-<id>')
   │     ↓ 201 returned to browser within ~150 ms (Chunk 4 measured 143 ms)
   │
   ├─ temporal-worker:
   │     ↓ DispatchMessage workflow
   │     ↓ activity deliver-via-ws → POST /internal/dispatch-deliver  X-Internal-Token
   │         ↓ api WsGateway.sendToOperator (same browser tab) → 200 {delivered:true}
   │     ↓ activity mark-delivered → UPDATE dispatch_attempt SET delivered_at = now()
   │     ↓ workflow Completed   (Chunk 4 measured 365 ms total lifetime)
   │
   └─ Playwright assertions in spec body:
        waitForWorkflowCompletion('dispatch-<messageId>', 30s) → status === 'COMPLETED'
        assertDispatchDelivered(messageId)            → delivered_at NOT NULL
        assertRecording(callId)                       → recording row + MinIO object exist
        assertTenant(SEEDED_TENANT_ID, callId)        → tenant_id matches on call,
                                                          recording, dispatch_attempt, queue_call

CI step finishes; SIPp BYE fires from its scenario timer; Asterisk ends Stasis;
StasisEnd handler updates call.ended_at; tear-down: docker compose down -v
```

**Two timing budgets:**

- **T_screen_pop ≤ 800 ms** — INVITE-fire wall-clock to `[data-testid="screen-pop"]` visible. Source of truth: Playwright's `Date.now()` deltas. Tighter than the 75 s scenario budget; this is the user-visible UX assertion (Chunk 4 §1 exit criterion 4 promoted to automated).
- **Per-scenario wall-clock ≤ 75 s** — master plan §"Chunk 6". Spec timeout fails the test on overrun.

## 4. Error handling (scope-bounded)

Chunk 5 owns harness reliability, not in-app failure modes (Chunks 4/6 own those).

- **Compose stack startup races (CI):** `make poc-up-all-docker` blocks on `scripts/wait-for-healthy.sh`. Healthcheck list shrinks by 2 (kamailio, rtpengine removed). Failure → make non-zero → CI step red. No retry loop in CI workflow — flake here is a real bug.
- **SIPp container exit code:** SIPp returns non-zero on the expected "Failed call: 1" pattern. `run-scenario.ts` ignores SIPp's exit code (matches Chunk 3 smoke convention) but captures stderr + scenario.log as a CI artifact on Playwright failure. Only fails if `docker compose run` itself returns 125/126/127 (network/cli error).
- **Playwright WS race:** mitigated by opening the browser BEFORE firing INVITE and waiting for `waitForWsOpen()` (`[data-testid="ws-ready"]`). If WS isn't OPEN by INVITE time, screen-pop will never render — Playwright's `waitForScreenPop({timeout:1000})` fails with a clear message.
- **Temporal workflow timeout:** `waitForWorkflowCompletion` polls `client.getHandle('dispatch-<id>').describe()` every 200 ms with a 30 s wall-clock cap. On timeout, fail with the workflow's last `pendingActivities` payload attached.
- **Tenant-id assertion failure mode:** `assertTenant` queries each per-tenant table after the scenario and returns the first row whose `tenant_id` doesn't match. Empty result on a table that should have rows is its own failure (upstream broke earlier).
- **Flake budget:** zero. Any flake in S-1 is a Chunk 5 bug — fix the harness or the wired path; do **not** add `retries:` to the Playwright config.
- **MinIO placeholder check:** single `s3.headObject` call after `waitForWorkflowCompletion`. No poll. The proper ETag-poll with 10 s upper bound is Chunk 6 / S-2 (audio path).
- **`docker compose down -v` in CI:** always runs (`if: always()` step). Local devs run `make poc-down` after a local `make poc-e2e-s1` if they want clean state — not enforced.

## 5. Testing

| Layer | Tool | Compose? | Notes |
|---|---|---|---|
| `apps/e2e/src/lib/assert-tenant.ts` shape | vitest, mocked drizzle | No | Asserts every per-tenant table is selected; fails if a future per-tenant table is added without amending the helper |
| `apps/e2e/src/lib/{db,minio,temporal,ari}.ts` | — | — | No unit tests (each 5–15 LOC; covered by the spec itself) |
| `apps/e2e/src/run-scenario.ts` argv shape | vitest, mocked `child_process.spawn` | No | Asserts the constructed `docker compose run` argv contains `--scenario`, `-key callId <uuid>`, the right network |
| SIPp `happy-path.xml` syntax | `sipp -sf scenarios/happy-path.xml -dry-run` | No (sipp container only) | One-shot validation in CI before the full run; fast typo surface |
| `pages/OperatorPage.ts` selectors aligned with `apps/web` markup | vitest in `apps/web` (existing) | No | Regression test added by subagent B: `[data-testid="screen-pop"]`, `[data-testid="accept-call"]`, `[data-testid="message-textarea"]`, `[data-testid="message-submit"]`, `[data-testid="ws-ready"]` all exist when ScreenPop/MessageForm/operator-page render |
| `poc-e2e-s1-happy-path.spec.ts` full path | Playwright + SIPp + compose | **Yes** | The Chunk 5 deliverable. Red on the rewired-but-not-yet-harnessed stack, green after subagents A+B+C return |
| `make poc-up-all-docker` boots all 3 app containers healthy | shell + curl | **Yes** | Makefile target `poc-test-all-docker-up`; runs in CI before `make poc-e2e-s1` for fail-fast on Dockerfile breakage |
| Post-rewire chunk-3 + chunk-4 spot-check | pjsua manual smoke | **Yes** | One-pass on the rewired stack; 5-line addendum to `poc/smoke-chunk4.md`. Operator runs at the end of Phase 0 before subagents fan out |
| Chunk 4 unit suites still green | vitest | No | `pnpm -r test` exits 0 after Phase 0 AND after every subagent's return |

**TDD ordering:**

1. **Phase 0 (rewire):** add a `make` precondition `! grep -q 'kamailio\|rtpengine' infra/docker-compose.yml` to `poc-up`; fix until green; verify with pjsua manual probe.
2. **Phase 1 (subagent B):** author `poc-e2e-s1-happy-path.spec.ts` with assertions sketched as TODO comments → expand one assertion at a time as A/B/C land their pieces. Spec is red until all three subagents return; green is the chunk-close signal.
3. **Phase 1 (subagent A):** `run-scenario.ts` argv vitest red → green, then sipp dry-run green.
4. **Phase 1 (subagent C):** `poc-test-all-docker-up` curl smoke red → green Dockerfile-by-Dockerfile.

## 6. Parallel subagent dispatch plan

Per CLAUDE.md §6 and operator preference from Chunk 4. All subagents: Sonnet model, "Ultrathink before you act.", self-critique + confidence score (0–100), <70 → loop.

### Phase 0 — Topology rewire (main thread, serial)

Single focused edit (CLAUDE.md §6: "single-edit fixes <5 lines… stays in main" applies broadly here; the rewire is ~5–15 lines of compose + pjsip.conf edits plus two `git mv`s). Verify with `make poc-up` boot, pjsua manual probe, post-rewire spot-check in `poc/smoke-chunk4.md`. Commit as two atomic commits (compose rewire + pjsip.conf rewire) before subagents fan out.

### Phase 1 — Three subagents in parallel (one `Agent` tool message, three blocks)

**Subagent A — SIPp container + scenarios + orchestrator.**

- *Scope:* `apps/e2e/package.json`, `apps/e2e/docker-compose.sipp.yml`, `apps/e2e/scenarios/happy-path.xml`, `apps/e2e/src/run-scenario.ts`, `apps/e2e/test/run-scenario.spec.ts`, SIPp dry-run check (`pnpm --filter @tas/e2e run lint:sipp`).
- *Definition of done:* `pnpm --filter @tas/e2e run scenario --scenario happy-path --callId <uuid>` returns `{callId, exitCode, stderr}` where Asterisk logs show a real StasisStart for that callId. Argv vitest green. Confidence ≥70.
- *No touch:* `apps/e2e/specs/`, `apps/e2e/pages/`, `apps/e2e/src/lib/`, `infra/`, root `Makefile` (subagent C owns `poc-e2e-s1` target wiring).

**Subagent B — Playwright + page objects + assertion helpers + the spec.**

- *Scope:* `apps/e2e/playwright.config.ts`, `apps/e2e/pages/OperatorPage.ts`, `apps/e2e/src/lib/{assert-tenant,db,minio,temporal,ari}.ts`, `apps/e2e/specs/poc-e2e-s1-happy-path.spec.ts`, `apps/e2e/test/assert-tenant.spec.ts`, `data-testid` regression test added to `apps/web/test/`.
- *Definition of done:* `pnpm --filter @tas/e2e run test:e2e:s1` exits 0 against a compose stack already running api+web+temporal-worker on host-dev. Subagent verifies by booting host-dev itself (matches Chunk 4 verification pattern). Confidence ≥70.
- *No touch:* `apps/e2e/src/run-scenario.ts` (imported as a black box from subagent A's interface contract), `apps/web/components/` (markup frozen; if a `data-testid` is missing, subagent B reports back to main thread for a follow-up rather than editing components itself).

**Subagent C — Three Dockerfiles + override compose + Makefile targets.**

- *Scope:* `infra/api.Dockerfile`, `infra/web.Dockerfile`, `infra/temporal-worker.Dockerfile`, `infra/docker-compose.all-in.yml`, root `Makefile` (`poc-up-all-docker`, `poc-test-all-docker-up`, `poc-e2e-s1` targets), per-app `.dockerignore`.
- *Definition of done:* `make poc-up-all-docker && make poc-seed && curl http://localhost:3000/v1/Account/<seeded>` returns the seeded account JSON. All three containers healthy. Subagent verifies in CI-shape conditions (no host-dev assumed). Confidence ≥70.
- *No touch:* `infra/asterisk/`, `infra/docker-compose.yml` (rewired in Phase 0; C only adds the override file).

### Phase 2 — CI workflow (main thread)

Once A, B, C all return ≥70 and `pnpm -r test` is green:

1. Author `.github/workflows/poc-e2e.yml` per §2.6.
2. Add repo secrets `INTERNAL_API_TOKEN`, `APP_JWT_SECRET` via `gh secret set` (operator confirms before each `gh` write op).
3. Push branch, watch first CI run, debug to green. Expected first-run failure modes: pnpm version drift, Playwright browser install size cap, compose healthcheck timing on slower hosted runner.
4. PR opened with all three subagents' work + CI workflow + readout.

### Phase 3 — Readout + PR (main thread)

`poc/readout-slice1.md` written after the first green CI run, with the run URL, wall-clock per step, per-assertion timing. Operator-approved before `gh pr create`.

## 7. Out of scope (explicit cuts — do not re-litigate)

- **S-2..S-5 scenarios** (PCI pause, caller hangup, decline reroute, leader failover) — Chunks 6 & 7.
- **Aggregate wall-clock gate (S-1..S-4 ≤ 3.5 min)** — Chunk 6 (master plan §"Chunk 6").
- **WAV content / silence detection / ETag poll** — Chunk 6 / S-2.
- **MinIO ETag poll upper bound (10 s)** — Chunk 6 / S-2.
- **ADR-0016 wire-level FIN < 100 ms evidence** — Chunk 7 / S-5.
- **Asterisk `channel.answer()` and audio path** — Chunk 6.
- **PCI pause/resume real wiring** — Chunk 6.
- **Two NestJS instances + Redis leader election under real Redis** — Chunk 7.
- **`callerE164: ''` hardcode** in `apps/api/src/arbiter/arbiter.service.ts:30` — Chunk 6 (handoff carry-forward #4).
- **Chunk-6 workflow branch on `delivered: false`** in `DispatchMessage` — Chunk 6 (handoff carry-forward #1).
- **`WsGateway.registerConnection` race fix** — Chunk 6 if it moves to runtime (handoff carry-forward #2).
- **Cleaning up `apps/web/next-env.d.ts` and the leftover plan file** — operator preference (handoff Do-NOT list).
- **Deleting remote `mvp/chunk-4-f03-worker` branch** — operator preference (handoff carry-forward #6).
- **CodeQL, dependency review, or any other security workflow** — outside chunk scope.
- **Production-shape secrets management (Vault, sealed-secrets)** — repo secrets via `gh secret set` is sufficient for PoC.
- **Recording redaction pipeline (ML)** — ADR-0013/0026 cut; not coming back in PoC.

## 8. Risks

1. **Topology rewire surfaces a hidden Kamailio dependency.** Chunk 3 + Chunk 4 smokes drove SIP via Kamailio→Asterisk. After Phase 0, SIP must enter Asterisk directly via `endpoint=carrier-sipp`. *Mitigation:* post-rewire pjsua spot-check runs BEFORE subagents fan out; if it fails, Phase 0 isn't done and subagents do not launch. Severity: medium, bounded by Phase-0 gate.
2. **GitHub Actions compose cold-start exceeds the 25-min job timeout on first run.** First-run pulls: postgres:15 (~150 MB), temporalio/auto-setup (~250 MB), Asterisk image (built locally), three app Dockerfiles. Could push ~14 min before any test runs. *Mitigation:* `docker/setup-buildx-action` + GHCR layer cache for app images, `actions/cache` for pnpm store, `cache: pnpm` on `setup-node@v4`. If first run exceeds 20 min, bump timeout to 35 and don't optimize speculatively. Severity: low-medium.
3. **Playwright Chromium browser install adds ~300 MB to CI cold-pull.** Pinned to chromium-only via `--with-deps chromium` skips Firefox + WebKit. *Mitigation:* cache `~/.cache/ms-playwright` keyed by `playwright-core` version. Severity: low.
4. **`apps/web` markup lacks the `data-testid` attributes the Playwright page object needs.** Components were authored in Chunk 4 without e2e in mind. *Mitigation:* subagent B's `data-testid` regression vitest enumerates every required attribute; if any is missing, subagent B reports it back as a small follow-up. Adding `data-testid` is a surgical 1–3 LOC per component (CLAUDE.md §3). Severity: low.
5. **All-in-docker compose has subtly different env wiring than host-dev.** Host-dev uses `DATABASE_URL=postgres://tas.tas:tas@localhost:6543/tas`; compose-internal uses `postgres://tas.tas:tas@supavisor:6543/tas`. Similar mismatches likely for `TEMPORAL_ADDRESS`, `NATS_URL`, `MINIO_*`, `WEB_ORIGIN`. *Mitigation:* subagent C reviews each app's `.env.example` line-by-line against the override file; verifies by running the full curl smoke before reporting back. Severity: medium, well-bounded.
6. **SIPp Docker image version drift.** Tagging `ctaloni/sipp:latest` is convenient but unstable. *Mitigation:* pin to a specific tag (e.g., `ctaloni/sipp:3.6.2` if available, otherwise an equivalent stable image — subagent A picks one and pins it). Severity: low.
7. **GHA secrets exposed in container env make their way into logs.** Compose with `env_file` interpolation can echo secret values on certain failure modes. *Mitigation:* CI workflow uses `${{ secrets.* }}` only at the `env:` level on the affected step, never passes them via `docker compose up -d` argv; compose reads them from the runner env. `actions/upload-artifact` excludes `*.env*` patterns. GHA's automatic secret redaction in logs is the safety net. Severity: low-medium.
8. **First-time PR check on `main`-protected branch silently doesn't block merge** because the new check hasn't been added to branch protection. Not a Chunk 5 bug (operator merges via web UI); flagged for Chunk 6+ when protection rules might be tightened. Severity: very low.

## 9. Effort

Master spec budget: **5–6 days** (4–5 base + 1 day for Dockerfiles). This spec adds Phase 0 rewire (~1 day) and a CI-debug buffer.

- **Phase 0 — Topology rewire (main thread, serial):** ~1 day. Compose edits, pjsip.conf edits, two `git mv`s, post-rewire pjsua spot-check, smoke-chunk4 addendum, two atomic commits.
- **Phase 1 — Three subagents in parallel:** ~2 days wall-clock (subagents in parallel; main-thread integration verification after they return).
  - Subagent A (SIPp orchestrator): ~1 day of subagent work.
  - Subagent B (Playwright + page objects + spec + helpers): ~1.5 days of subagent work.
  - Subagent C (Dockerfiles + override + Makefile): ~1 day of subagent work.
- **Phase 2 — CI workflow + first green CI run:** ~1.5 days (workflow author, secrets, debug first-run failures).
- **Phase 3 — Readout + PR:** ~0.5 day.
- **Slack for surprises:** ~0.5–1 day.

**Total: ~5.5–6.5 days.** Inside master budget if subagent C absorbs its 1-day Dockerfile allocation cleanly. CI-debug pass is the most likely overrun source — flag if first-run-to-green takes >2 sessions of iteration.

## 10. What's next

Per `superpowers:brainstorming` flow, this spec is the input for the Chunk 5 implementation plan. The implementation plan will be produced by `superpowers:writing-plans` once this spec is user-approved. The plan will cover Phase 0 in detail (commit-by-commit), the three subagent prompts (Phase 1), Phase 2 CI workflow steps, and Phase 3 readout structure.
