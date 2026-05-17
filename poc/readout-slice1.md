# Slice-1 Readout — S-1 happy-path Green

**Date:** 2026-05-17 · **Operator:** Yuriy Lev · **Branch:** `mvp/chunk-5-e2e-harness` · **Result:** Green

Closes Chunk 5 — first MVP scenario gated by automated CI.

## CI run

- Workflow: `.github/workflows/poc-e2e.yml`
- Run URL: <https://github.com/ylevytskyy/modern-tas/actions/runs/25997871963>
- Total wall-clock: **5m 1s**
- Runner: `ubuntu-22.04`, ephemeral GitHub-hosted

### Step timings

| # | Step | Wall-clock |
|---|---|---|
| 1 | checkout + setup-pnpm + setup-node | 8s |
| 2 | pnpm install --frozen-lockfile | 13s |
| 3 | build workspace libs (shared-types, db, ari-client) | 3s |
| 4 | Playwright Chromium install | 28s (cold; cached on subsequent runs) |
| 5 | make poc-up-all-docker (build 3 images + boot 12 services) | 2m 43s |
| 6 | docker pull sipp (pre-pull) | 4s |
| 7 | make poc-seed | 2s |
| 8 | pnpm --filter @tas/api run test (testcontainers, 30 cases) | 10s |
| 9 | make poc-e2e-s1 (Playwright + SIPp) | 39s |
| 10 | docker compose down -v (teardown) | 22s |

## S-1 spec assertions (in order)

1. SIPp INVITE accepted, StasisStart fired. ✓
2. `call.screenpop` WS event received in headless Chromium. ✓
3. `[data-testid="screen-pop"]` rendered within the CI screen-pop budget (3000ms). ✓
4. `POST /v1/Message` returned **201**. ✓
5. `DispatchMessage` workflow Completed within 30 s budget. ✓
6. `dispatch_attempt.delivered_at` non-null. ✓
7. `recording` row + MinIO object `recordings/<callId>.wav` present (existence-only — content checks deferred to Chunk 6 / S-2 when the audio path is wired). ✓
8. `tenant_id` matches seeded tenant on every per-tenant row (`call`, `recording`, `queue_call` — `dispatch_attempt` has no `tenant_id` column; transitive isolation via `messageId → message.tenantId`). ✓
9. Total spec wall-clock: **38.4s** (test body 35.7s + Playwright startup overhead). Under per-scenario 75s budget (master plan §"Chunk 6"). ✓

## CI debug loop — fixes landed during first-run-to-green

Seven CI runs from first push to green. Each failure produced a small fix; final ratio is 6 fixes for 1 green run. Captured for future-chunk reference:

| # | Symptom | Root cause | Fix (commit) |
|---|---|---|---|
| 1 | `npx playwright install` exit 127 | `playwright` only in `apps/e2e/` devDeps; `npx` from root doesn't resolve in a pnpm workspace | use `pnpm --filter @tas/e2e exec playwright install` (`5d0e19a`) |
| 2 | supavisor container exited (1) before health | `/app/limits.sh` calls `ulimit -n 100000` which is blocked on GHA runners | set `ulimits.nofile` at container create time in compose (`ac9e42e`) |
| 3 | JwtAuthGuard spec failed `Invalid or expired token` | spec hardcoded `SECRET='poc-only-not-prod'` while guard reads `process.env.APP_JWT_SECRET ?? <fallback>` — CI's env-set secret diverged | align spec to read from env same as guard (`e38068f`) |
| 4 | `SyntaxError: TypeScript parameter property is not supported in strip-only mode` | Node 22's `--experimental-strip-types` (Playwright's loader in CI) doesn't support `constructor(private readonly page)` parameter properties | declare field separately + assign in body (`3c3b43b`) |
| 5 | `Cannot find module '@tas/db/dist/schema/index.js'` | `apps/e2e` runs on the runner (not in Docker); `pnpm install` doesn't build workspace package dist artefacts | add `pnpm --filter ... run build` step before Playwright (`76e1f16`) |
| 6 | `waitForSelector: Timeout 3000ms exceeded` (screen-pop) | `docker compose run --rm sipp` pulled image on first call (~5-30s) on fresh GHA Docker daemon, consuming the entire 3s CI budget | pre-pull SIPp image as a workflow step (`c76c999`) |

Additionally: one fix during Task 22 (local all-in-docker verification) caught `NODE_ENV: production` on api blocking the dev token endpoint (`c89d37c`) — landed before the first CI push.

## Residual issues / carry-forward

From the Chunk 4 handoff, still applicable (and out of Chunk 5's scope):

1. **`DispatchMessage` workflow `delivered: false` branch** — `apps/temporal-worker/src/workflows/dispatch-message.ts` calls `markDelivered` unconditionally. Chunk 6 / S-2 wires the redelivery path.
2. **`WsGateway.registerConnection` race** — only used in tests today; runtime use would need the `removeAllListeners('close')` treatment.
3. **`callerE164: ''` hardcode** in `apps/api/src/arbiter/arbiter.service.ts:30` — populate from `call` row in Chunk 6.
4. **Asterisk doesn't `channel.answer()`** — audio path lands in Chunk 6 / S-2.
5. **PCI pause toggle is local UI state only** — Chunk 6 / S-2 backend wiring.

New from Chunk 5:

6. **Image sizes 2-3× plan targets** — `tas-api:chunk5` 946 MB, `tas-web:chunk5` 985 MB, `tas-temporal-worker:chunk5` 1.01 GB. Root cause: runtime stages copy full pnpm virtual store. `pnpm deploy --filter <pkg> --dir /deploy` would flatten to ~300 MB. Acceptable for PoC; track for production.
7. **`ari-client` dynamic require workaround** — `infra/api.Dockerfile` ln -s preserves the `require('ari-client')` pattern in `apps/api/src/ari/ari.module.ts`. Cleanest fix is converting to a static import.
8. **Caddy not booted on local dev host** — host ports 80/443 occupied by system Apache. Pre-existing; doesn't affect host-dev or CI paths. Workaround documented in `poc/smoke-chunk4.md`.

## Sign-off

`mvp/chunk-5-e2e-harness` ready for review → merge to `main`. Tag `mvp/chunk-5` to be pushed after merge.

Spec: `docs/superpowers/specs/2026-05-17-chunk-5-e2e-harness-design.md` (`b5f9a5d`).
Plan: `docs/superpowers/plans/2026-05-17-chunk-5-e2e-harness.md` (`a8e4f26`).
