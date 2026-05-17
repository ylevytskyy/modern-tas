# Chunk 6 — Slices S-2/S-3/S-4 in CI (design spec)

> Status: **Draft (pending user review)** · Date: 2026-05-17 · Owner: founder (solo) · Source: [`docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md`](./2026-05-14-local-mvp-chunk-plan-design.md) §"Chunk 6" · Predecessor: Chunk 5 merged in `ff4d52e` (S-1 happy-path Green) · ADRs: [ADR-0024 queue budget](../../adr/0024-queue-budget.md), [ADR-0025 Asterisk-direct](../../adr/0025-telephony-asterisk-direct.md)

## 0. Scope and framing

This is the **design spec for Chunk 6** of the local-runnable MVP. The master chunk-plan fixes the chunk's goal, scope, and exit criteria; this spec sequences the work into three independent slice PRs, decides the per-slice architecture (especially the MixMonitor pause/resume mechanism and the recording-redaction-interval semantics that follow from it), and selects the CI shape needed to fit the aggregate wall-clock budget.

**What this chunk delivers:** three additional e2e scenarios green in CI on top of S-1.
- **S-2 PCI pause/resume** — F03 pause/resume → MixMonitor stop + restart-with-append → `recording_redaction_interval` rows → `apps/e2e/lib/audio.ts` duration-delta assertion (±50 ms).
- **S-3 caller hangup** — Asterisk `StasisEnd` → `call.endedBy='caller'` → recording finalized → no orphan channels → F03 "Caller hung up" banner.
- **S-4 decline reroute** — seed operator B → F03 Decline → arbiter re-routes → `queue_call.attempts` chain → screen-pop to operator B within ADR-0024 200 ms p95.

After this chunk, `make poc-e2e` (scenarios S-1..S-4) exits 0 in CI; per-scenario budgets hold (S-2 ≤ 60 s, S-3 ≤ 45 s, S-4 ≤ 30 s); aggregate wall-clock < 3.5 min via CI matrix parallelism.

**Settled procedural decisions (this brainstorm session, 2026-05-17):**

1. **Three PRs, one per slice** — `mvp/chunk-6-s3-caller-hangup` → `mvp/chunk-6-s2-pci-pause` → `mvp/chunk-6-s4-decline-reroute`. Smaller review surface, independent TDD discipline per slice, matches Chunk 4/5 cadence.
2. **Slice order S-3 → S-2 → S-4** — S-3 establishes call-lifecycle finalization (`endedBy`, recording close, StasisEnd) that S-2's segmented recording implicitly depends on; S-4 is most isolated and ships last.
3. **First-mover absorbs shared infra** — S-3 PR bundles the reusable `Banner.tsx` toast component (consumed again by S-4). S-2 owns `apps/e2e/lib/audio.ts` and the MinIO ETag bounded-poll helper (sole consumer). S-4 owns the `queue_call.attempts` serialization format.
4. **Carry-forward folded in:** HC#1 (DispatchMessage `delivered:false` branch) into S-3 PR (naturally fires when caller hangs up mid-message); HC#4 (`callerE164:''` hardcode) into S-4 PR (arbiter touchpoint). HC#2 (WsGateway race) deferred — flag-only in S-3 PR description, fix only if CI reproduces.
5. **MixMonitor pause mechanism: stop+restart with append flag** — single WAV per call. The resulting WAV has a temporal discontinuity (no silence written for the paused window), not an audible silent gap. Source of truth for "audio was redacted here" is the `recording_redaction_interval` row, not the WAV bytes. Trade-off documented in §3 below.
6. **CI matrix parallelism** — four scenario shards (s1/s2/s3/s4) run in parallel on independent Actions runners. Aggregate sequential gate also runs once after S-4 lands as a separate job with a relaxed 5-min ceiling and a written exception (spec §174's 3.5 min interpreted as parallel wall-clock for headroom).

## 1. Goal & exit criteria

**Goal:** S-2/S-3/S-4 scenarios are the next three MVP gates, each driving its slice's backend + UI features to completion via strict TDD. `make poc-e2e-s2`, `make poc-e2e-s3`, `make poc-e2e-s4` each exit 0 locally and in GitHub Actions on `ubuntu-22.04`. `make poc-e2e` (aggregate) exits 0 with all four scenarios green.

**Exit criteria (aggregate — all three PRs merged):**

1. **All three new e2e specs red → green** following TDD discipline; S-1 stays green throughout.
2. **Per-scenario wall-clock budgets** enforced in-spec (each spec times itself and fails if its ceiling is exceeded):
   - S-1: ≤ 75 s (unchanged)
   - S-2: ≤ 60 s (includes MinIO ETag poll ≤ 10 s and audio.ts duration-delta assertion)
   - S-3: ≤ 45 s
   - S-4: ≤ 30 s
3. **Aggregate `make poc-e2e` wall-clock < 3.5 min in CI** under matrix parallelism (max of parallel shards). The sequential aggregate-gate job runs once per PR with a 5-min ceiling and is marked as `continue-on-error: false` once stable.
4. **ADR-0024 200 ms p95 screen-pop assertion** in S-4 (10-iteration p95, real wall-clock, not mocked). If exceeded consistently in CI, an NFR-P3 re-measurement issue is filed but the PR is not blocked (per chunk plan risk note).
5. **`tenant_id` assertion** in all three new specs:
   - S-2: `call`, `recording`. `recording_redaction_interval` inherits via FK; assertion uses JOIN.
   - S-3: `call`, `recording`.
   - S-4: `call`, `queue_call` (both attempt entries inherited via row's tenantId).
6. **WAV duration-delta assertion** in S-2: `wavDurationMs ≈ callDurationMs - Σ(endMs - startMs) ± 50 ms` for all redaction intervals (typically one).
7. **`call.endedBy` populated correctly** on every path: `'caller'` (S-3 baseline), `'operator'` (S-4 decline doesn't end the call, but a future operator-initiated BYE will), `'system'` (timeouts, ARI errors).
8. **`queue_call.attempts` chain serialized correctly** on every decline: ordered JSON entries `{operatorId,outcome,at}`, accepted attempt closes the chain.
9. **CI green on Linux** for all four scenarios via matrix; aggregate gate also green.

**Out of scope (deferred to Chunk 7 or later):**
- ARI leader failover (Chunk 7).
- ML PII redaction (spec §5.2 cut).
- Multi-tenant isolation tests beyond `tenant_id` row assertions.
- Operator-initiated BYE button in F03 (data path supports it via `endedBy='operator'` but no UI button this chunk).
- Audible silence playback in redacted WAV segments (current design uses temporal discontinuity; if product requires audible silence in playback, swap to MixMonitorMute in a follow-on chunk).
- Caller E.164 propagation beyond the arbiter HC#4 fix (downstream consumers may still see empty strings until they're audited separately).

## 2. PR breakdown

| # | Branch | Owns | Carry-fwd folded in | Per-scenario budget |
|---|---|---|---|---|
| 1 | `mvp/chunk-6-s3-caller-hangup` | StasisEnd handler, `call.endedBy` populator, recording finalization on hangup, `Banner.tsx` reusable toast/banner component, S-3 spec, `recording.endedAt` migration | **HC#1** — DispatchMessage workflow cancellation signal + `dispatch_attempt.failureReason='caller_hung_up'` migration | S-3 ≤ 45 s |
| 2 | `mvp/chunk-6-s2-pci-pause` | F03 PCI button → POST `/v1/calls/:id/pause`/`/resume`, `MixMonitorStop` + `MixMonitor` with append flag, `recording_redaction_interval` row writer, `apps/e2e/lib/audio.ts` duration-delta, MinIO `pollObjectETagChanged` helper, S-2 spec | — | S-2 ≤ 60 s |
| 3 | `mvp/chunk-6-s4-decline-reroute` | F03 Decline button + POST `/v1/calls/:id/decline`, arbiter Decline→reroute path, `queue_call.attempts` JSON serializer, S-4 spec | **HC#4** — caller E.164 lookup from `call.fromE164` in arbiter (replaces `''` hardcode) | S-4 ≤ 30 s |

**Why this order:** S-3 establishes the call-lifecycle finalization (`endedBy`, recording close, StasisEnd) that S-2's recording-segments logic implicitly depends on (a paused recording still needs proper close on hangup). S-4 is the most isolated (queue/arbiter only, no media), so it goes last and won't disturb S-2/S-3.

## 3. Per-slice architecture

### 3.1 S-3 — caller hangup

**Asterisk integration (apps/api/src/ari/):** add `StasisEndHandler` (new file). On `StasisEnd` event:

1. Look up `call` row by `channel_id` (already tracked from StasisStart).
2. Derive `endedBy`:
   - Asterisk `HANGUPCAUSE` ∈ {16, 17, 19, 21} originating from inbound channel → `'caller'`.
   - Future operator-initiated BYE on outbound channel → `'operator'` (data-path support; no UI this chunk).
   - Fallback (timeouts, ARI errors) → `'system'`.
3. Update `call`: `endedAt = now()`, `endedBy = <derived>`.
4. If an open `recording` exists: emit `MixMonitorStop` ARI command, then UPDATE `recording.endedAt = now()`. Asterisk flushes WAV bytes to MinIO during the stop.
5. NATS publish `call.ended` event (subject `tas.call.ended.<callId>`) so the Temporal worker can cancel any in-flight `DispatchMessage` workflow.

**Temporal worker (HC#1 fold-in):** `DispatchMessage` workflow currently only handles the success path. Add a cancellation-signal handler subscribed to `call.ended`. On signal:
- Workflow returns `{ delivered: false, reason: 'caller_hung_up' }`.
- `dispatch_attempt` row updated: `delivered_at = null`, `failure_reason = 'caller_hung_up'` (new column, see §4).

**F03 UI (apps/web):**
- New `Banner.tsx` component — three variants (`info`, `warning`, `success`), 5 s auto-dismiss, `role="status"` for a11y, accepts `onDismiss` callback. Reusable; S-4 PR consumes the same component for any decline/reroute feedback.
- `ws.gateway` pushes `{ type: 'call.ended', endedBy: 'caller' }` → `ScreenPop` renders "Caller hung up" warning banner, hides Accept/Decline buttons, banner auto-dismisses after 5 s and screen-pop closes.

**S-3 spec assertions (apps/e2e/specs/s3-caller-hangup.spec.ts):**
- SIPp INVITE → StasisStart → screen-pop renders in browser.
- SIPp sends `BYE` mid-screen-pop (before operator clicks Accept) — driven by SIPp scenario XML.
- Within 2 s of BYE: `call.endedBy === 'caller'` (poll DB).
- `recording.endedAt` populated within 2 s.
- `asterisk -rx "core show channels count"` reports 0 active channels.
- `tenant_id` matches on `call` + `recording` rows.
- F03 DOM contains banner element with text "Caller hung up" within 1 s of `call.ended` WS message.
- Wall-clock ≤ 45 s.

### 3.2 S-2 — PCI pause/resume

**Pause/resume mechanism (single WAV via MixMonitor append).** F03 PCI button on `ScreenPop.tsx` already exists (`onPciToggle` callback wired but no backend). New API endpoints:

- `POST /v1/calls/:id/pause` →
  1. Emit `MixMonitorStop` on the call's channel via ARI.
  2. INSERT `recording_redaction_interval { recording_id, start_ms = <now - call.startedAt>, end_ms = NULL, reason = 'operator_pci_pause' }`.
- `POST /v1/calls/:id/resume` →
  1. Emit `MixMonitor` ARI command with append flag (`a`) targeting the same MinIO key. Asterisk writes additional audio frames to the existing WAV.
  2. UPDATE the open redaction interval: `end_ms = <now - call.startedAt>`.

**The append-flag caveat (material trade-off).** Asterisk's MixMonitor with the `a` flag appends new audio frames starting immediately on resume — no silence is written for the paused window. The resulting WAV has a *temporal discontinuity*, not a silent gap. Consequences:

- `apps/e2e/lib/audio.ts` does **not** look for amplitude silence in the WAV. It asserts `wavDurationMs ≈ callDurationMs - Σ(redactionInterval.endMs - redactionInterval.startMs) ± 50 ms`. This matches the redaction-interval row semantics and is what the spec §174 ±50 ms tolerance actually pins down.
- **Source of truth for "audio was redacted here"** is the `recording_redaction_interval` row, not the WAV bytes. A reviewer (or future auditor) playing back the WAV will hear continuous speech with a splice across the paused window, not audible silence.
- If product later requires audible silence in playback (e.g. for QA review without consulting the redaction table), the swap is a follow-on PR replacing MixMonitorStop/restart with MixMonitorMute. The redaction-interval table stays unchanged; only the API endpoint internals change. Risk-listed in §6.

**MinIO ETag bounded-poll helper (apps/e2e/src/lib/minio.ts):** new `pollObjectETagChanged(bucket, key, previousETag, { intervalMs: 100, maxMs: 10_000 }): Promise<string>`. Returns the new ETag on first change, throws if ceiling hit. S-2 captures the ETag immediately before POST `/resume` → polls until it changes (signaling Asterisk wrote new bytes via the append). No arbitrary sleeps.

**Audio.ts silence-detector / duration-delta (apps/e2e/lib/audio.ts):** new module. Single export `assertWavDurationDelta(wavBytes: Buffer, expectedDurationMs: number, toleranceMs: number = 50): void`. Parses WAV header (RIFF chunk size, sample rate, bit depth) to compute actual duration, throws if `|actual - expected| > toleranceMs`. No external audio libs — pure header parsing, well within the chunk's scope.

**S-2 spec assertions (apps/e2e/specs/s2-pci-pause.spec.ts):**
- INVITE → screen-pop → accept (reuses S-1 page-object methods).
- SIPp plays continuous 440 Hz tone for ~6 s (deterministic, scripted in SIPp scenario XML).
- t=2 s after Accept: POST `/v1/calls/:id/pause` → assert `recording_redaction_interval` row with `end_ms = NULL` exists within 500 ms.
- t=4 s after Accept: POST `/v1/calls/:id/resume` → ETag-poll exits in < 10 s → `recording_redaction_interval` row's `end_ms` populated within 500 ms after poll exit.
- SIPp sends BYE → S-3-path closes recording (`endedAt` populated).
- Download WAV from MinIO via S3 client.
- `assertWavDurationDelta(wav, callDurationMs - 2000, 50)` (2 s redaction window, ±50 ms tolerance).
- `tenant_id` JOIN assertion across `call`, `recording`, `recording_redaction_interval`.
- Wall-clock ≤ 60 s.

### 3.3 S-4 — decline reroute

**Test setup:** seed two operators (A + B) in DB and register both to WS gateway. Arbiter's existing operator-selection heuristic (round-robin or LRU — confirmed in arbiter code review during implementation) routes to A first.

**Decline flow:**

1. F03 Operator A receives screen-pop → clicks Decline → POST `/v1/calls/:id/decline { operatorId, reason: 'declined' }`.
2. Arbiter:
   - Append to `queue_call.attempts`: JSON-stringified `{ operatorId: 'A', outcome: 'declined', at: <iso8601> }`.
   - **HC#4 fix:** read real caller E.164 from `call.fromE164` (drop hardcoded `''`) when composing the next screen-pop payload.
   - Select next operator (B) via existing heuristic minus declined operators for this call.
   - Publish screen-pop NATS message addressed to B (subject `tas.screenpop.<operatorBId>`).
3. Operator B's F03 receives screen-pop. **Latency measurement window:** from server timestamp on POST `/decline` handler entry to WS push of screen-pop message to B = ADR-0024 SLA window (200 ms p95).
4. B clicks Accept → `queue_call.attempts` appended with `{ operatorId: 'B', outcome: 'accepted', at: <iso8601> }`. Chain closed.

**`queue_call.attempts` chain format:** text array (existing schema), each element is a JSON-stringified object `{"operatorId":"<uuid>","outcome":"declined"|"accepted"|"timeout","at":"<iso8601>"}`. Append-only during call. Final accepted attempt's `at` is implicitly the call's acceptance time. (`timeout` outcome is reserved for a future no-answer path — not exercised in S-4.)

**S-4 spec assertions (apps/e2e/specs/s4-decline-reroute.spec.ts):**
- Two browser contexts (Playwright) representing operator A and operator B; both register to WS.
- SIPp INVITE → screen-pop arrives at A.
- A clicks Decline (POST captured via Playwright network).
- Within 200 ms (server-measured): screen-pop arrives at B.
- B accepts → `queue_call.attempts` JSON parse: 2 entries in order, first `outcome: 'declined'` by A, second `outcome: 'accepted'` by B.
- 10-iteration p95 of decline→screen-pop latency ≤ 200 ms (real wall-clock).
- `tenant_id` matches on `call` + `queue_call` rows.
- Wall-clock ≤ 30 s (10 iterations × ~3 s each).

## 4. Schema deltas

Two new columns across two tables, plus minimal Drizzle migrations.

| Table | Change | Owning PR | Rationale |
|---|---|---|---|
| `call` | None — `endedBy`, `endedAt` columns already exist, just unwritten | S-3 | S-3 PR populates them in code |
| `recording` | Add `endedAt` (timestamp, nullable) | S-3 | Recording finalizer writes it on StasisEnd; absence today means "open recording" is ambiguous |
| `dispatch_attempt` | Add `failureReason` (text, nullable) | S-3 (HC#1 fold-in) | Records `'caller_hung_up'` for cancelled workflows |
| `recording_redaction_interval` | None | S-2 | `tenant_id` stays inherited via FK; assert-time JOIN in `assertTenant`. Denormalization not worth the migration cost for one assertion |
| `queue_call` | None — `attempts` text-array exists | S-4 | S-4 PR defines JSON-string format inside it; format is convention, not schema |

Each migration is a single ALTER TABLE; Drizzle generates and commits the SQL file. S-3 PR lands two migrations (one for `recording.endedAt`, one for `dispatch_attempt.failureReason`); S-2 and S-4 PRs land zero.

## 5. CI / harness shape

### 5.1 Per-scenario Make recipes

S-3 PR adds `make poc-e2e-s3` (analog to existing `make poc-e2e-s1`). S-2 PR adds `make poc-e2e-s2`. S-4 PR adds `make poc-e2e-s4`. Each recipe: `pnpm --filter @tas/e2e run test:e2e:s<n>` after `make poc-up-all-docker` + wait-for-healthy.

`make poc-e2e` (aggregate) runs all four sequentially. This is the developer-local target.

### 5.2 GitHub Actions matrix

`.github/workflows/poc-e2e.yml` gains a matrix axis: `scenario: [s1, s2, s3, s4]`. Each shard runs on its own `ubuntu-22.04` runner, brings up the all-in-docker stack, runs `make poc-e2e-s<n>`. **Aggregate wall-clock = max(per-scenario)** ≈ 60 s (S-2) + 90 s stack startup = ~2.5 min. Comfortably under the 3.5 min budget.

Each PR adds its scenario to the matrix before opening for review. CI is green on each PR before merge.

### 5.3 Aggregate sequential gate

After S-4 lands, a second job in the workflow runs `make poc-e2e` (sequential) once, with a 5-min ceiling and a written exception in the workflow YAML referencing chunk-plan §174's 3.5 min figure (re-interpreted in §0 decision #6 above as matrix wall-clock for headroom). This is the only sequential CI run; it catches regressions in inter-scenario state cleanup (e.g., S-3 leaving channels open and breaking S-4 in a shared stack).

**CI compute trade-off:** matrix parallelism uses 4× the compute per CI run vs sequential. Acceptable for a PoC repo; revisit if monthly Actions minutes become a concern.

## 6. Testing strategy

Strict TDD per slice, first-mover absorbs shared infra. Per-PR loop:

1. **Red:** write the new e2e spec, run locally via the per-scenario Make recipe → fails for the right reason (e.g., S-3 spec fails because no StasisEnd handler exists, not because the harness is broken). Capture the failure trace in the PR's first commit message as evidence the spec is genuinely red.
2. **Green minimum:** backend + UI changes just sufficient to pass the spec. No polish, no premature abstraction.
3. **Refactor:** extract shared bits (`Banner.tsx` from S-3 PR's specific banner, helpers from S-2 PR) only when the third use site appears or is clearly imminent. For this chunk: `Banner.tsx` is extracted in S-3 PR (S-4 will consume it); audio helpers stay local to S-2 (no second consumer in this chunk).
4. **CI green** on the per-scenario matrix shard required before opening the PR.

**Unit tests added per slice (alongside e2e):**

- **S-3 PR:** `stasis.handler.spec.ts` — endedBy derivation logic per HANGUPCAUSE code; cancellation signal propagation to Temporal stub.
- **S-2 PR:** `audio.spec.ts` — `assertWavDurationDelta` with synthetic WAVs (no Asterisk dependency); covers within-tolerance, over-tolerance, zero-duration edge cases. `minio.spec.ts` — `pollObjectETagChanged` with mocked S3 client (covers immediate change, polled change, timeout).
- **S-4 PR:** `arbiter.spec.ts` — extend with decline-reroute case + attempts-chain serialization + HC#4 caller E.164 propagation.

**Manual smoke before each PR opens:**

- S-3: `pjsua` registers, calls, hangs up after 5 s; verify F03 shows banner manually.
- S-2: `pjsua` calls, operator clicks Pause then Resume from F03; verify WAV downloads from MinIO with shorter duration than wall-clock; inspect WAV in Audacity to confirm temporal discontinuity (no silent gap) — this is the design's intentional behavior.
- S-4: register two `pjsua` instances; one declines, other accepts; verify `queue_call.attempts` row populated correctly via psql.

## 7. Risks and open questions

1. **MixMonitor append-flag behavior under PJSIP.** The `a` flag is documented (Asterisk 13+) but rarely exercised in our stack. **Mitigation:** S-2 PR's first commit is a manual `pjsua` smoke (pause → resume → inspect WAV via `ffprobe`) before any spec is written. If append misbehaves (e.g., overwrites instead of appends, or corrupts the WAV header), the fallback is MixMonitorMute (Option 3 from the brainstorm question). Design swap is contained: API endpoint internals change, redaction-interval table semantics stay identical, S-2 spec's `audio.ts` assertion swaps from duration-delta to amplitude-silence check.

2. **ADR-0024 200 ms p95 in CI.** Chunk 5 measured S-1 screen-pop at ~38 s end-to-end (including stack startup); the 200 ms reroute is a per-event SLA inside the call, not a wall-clock. **Mitigation:** 10-iteration p95 calculation in S-4 spec; if p95 exceeds 200 ms in CI consistently, file an NFR-P3 re-measurement issue (chunk plan risk note authorizes this) rather than blocking the PR.

3. **Aggregate sequential `make poc-e2e` budget.** Sequential = 90 s stack startup + 75 + 60 + 45 + 30 = 5 min. **Matrix parallelism (max ≈ 2.5 min) is required to fit 3.5 min**, not an optimization. The sequential aggregate-gate job uses 5 min as a relaxed ceiling with a written exception in the workflow YAML; chunk-plan §174's 3.5 min is interpreted as parallel wall-clock for headroom. Confirm during PR review or amend chunk plan.

4. **Banner toast UX defaults.** 5 s auto-dismiss with `role="status"` for a11y; no manual dismiss button (auto-dismiss only). If product wants different UX (manual dismiss, longer/shorter timeout, different variant for warnings), defer to S-3 PR review — change is contained to `Banner.tsx`.

5. **HC#2 (WsGateway race) deferred but watched.** S-3 PR description includes "watched-not-fixed" item. Trigger to fold in: any flake during S-3 spec runs in CI that traces to the race (symptom: screen-pop sometimes doesn't arrive on freshly-registered WS). If flake observed, S-3 PR scope expands to include the fix.

6. **Asterisk version assumption.** Design assumes Asterisk 20 (current stack per ADR-0025). MixMonitor `a` append flag is stable in 20; `MixMonitorStop` ARI command stable in 16+. No upgrade pressure from this chunk.

7. **Caller E.164 propagation past arbiter.** HC#4 fixes the arbiter's hardcode but downstream consumers (Temporal workflows, F03 screen-pop payload, message dispatch) may still receive `''` if they cached the hardcoded value or have their own bugs. Out of scope for this chunk; audit separately.

8. **Two browser contexts in S-4.** Playwright supports multi-context but the existing harness only uses one. S-4 PR extends `OperatorPage.ts` to accept a context parameter; or instantiates two `OperatorPage` instances against two contexts. Implementation detail confirmed during PR.

## 8. Done definition

- Three PRs merged to `main`: `mvp/chunk-6-s3-caller-hangup`, `mvp/chunk-6-s2-pci-pause`, `mvp/chunk-6-s4-decline-reroute` in that order.
- All exit criteria in §1 met.
- Tag `mvp/chunk-6` on `main` after S-4 merge.
- Brief readout doc at `poc/smoke-chunk6.md` summarising the three slices' green CI runs (link to GHA), per-scenario wall-clocks observed, and any deviations from this spec (especially around the MixMonitor append behavior verification).
- Memory updated with chunk-6 completion + tag.

---

## Self-review (post-write pass)

- **Placeholders:** None. All decisions specified; only "implementation detail confirmed during PR" notes remain (multi-browser-context wiring §7.8, arbiter operator-selection heuristic §3.3) — both genuinely require code inspection during execution and shouldn't be locked here.
- **Internal consistency:** PR breakdown table (§2) matches per-slice architecture (§3); schema deltas (§4) match what's described in §3.1 (recording.endedAt, dispatch_attempt.failureReason). CI shape (§5) and risks (§7.3) agree on matrix-parallel vs sequential aggregate semantics. Pause mechanism described identically in §0 decision 5, §3.2, and §7.1.
- **Scope check:** Three slice PRs is the right granularity for one chunk implementation plan. The plan doc (next step via `writing-plans`) will further break each PR into ~5–8 tasks. No further decomposition needed at the spec level.
- **Ambiguity check:** "Stop+restart single WAV" is now unambiguous — MixMonitor with append flag, temporal discontinuity not silent gap, `recording_redaction_interval` as source of truth, audio.ts asserts duration-delta not amplitude silence. The earlier brainstorming-question ambiguity (stop vs mute) is resolved with the append clarification in §0 decision 5 and §3.2.
