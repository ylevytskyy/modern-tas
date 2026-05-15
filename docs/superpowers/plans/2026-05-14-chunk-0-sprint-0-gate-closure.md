# Chunk 0 — Sprint-0 gate closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ratify every Sprint-0 prerequisite so Chunk 1 (monorepo + infra compose) can begin without blocking decisions remaining.

**Architecture:** This chunk produces no application code. It produces (a) ADR ratifications recorded in `docs/adr/`, (b) one consolidated G0 sign-off document at `pot/g0-closed.md`, (c) one S1 Layer-2 Linux readout under `pot/S1-telephony-happy-path/results/`, and (d) a `main` branch with the PoT spike chain merged and tags preserved. PoT spike directories themselves are **retained** until PoC Green (PoC spec §8) — only the branch is merged.

**Tech Stack:** Markdown docs; git operations; one Linux execution of the existing `pot/S1-telephony-happy-path/` smoke script (or a GitHub Actions workflow surrogate).

**Source spec:** [`docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md`](../specs/2026-05-14-local-mvp-chunk-plan-design.md) — Chunk 0.

**Engineer note — this chunk contains real decisions, not code.** Three sub-decisions are documented as decision points (Tasks 1, 2, 5). Resolve them at execution time; do not let a subagent silently pick.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `docs/adr/0013-redaction-pipeline.md` | Modify | Status `Proposed` → `Accepted` (or de-scope variant); §Decision text updated with chosen sub-decision |
| `docs/adr/0015-temporal-cloud-tier.md` | Verify only | Already `Accepted`; confirm it stayed |
| `docs/adr/0015-sdk-identity-evidence.md` | Modify (Task 2 option a) | Append Cloud-run log if Cloud sandbox path chosen |
| `docs/adr/0015-cloud-sdk-deferred.md` | Create (Task 2 option b) | Written deferral justification if Cloud sandbox not used |
| `pot/S1-telephony-happy-path/results/<ISO-timestamp>-linux-layer2.md` | Create | rtpengine media-path smoke readout from a Linux host |
| `pot/g0-closed.md` | Create | Consolidated G0 sign-off: enum path, sub-decisions, Q1-Q3 ratifications, signatures |

---

## Decision points (resolve before or during execution — do NOT let any agent pick)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | **ADR-0013 sub-decision** | (a) Adopt full two-pass pipeline — requires AssemblyAI key (medical-tier) acquisition. <br>(b) De-scope: disable recording for HIPAA tenants in MVP; ML pipeline removed; revisit post-MVP. <br>(c) De-scope: accept manual-QA backlog only (no ML); recording stays but redaction is human-only. | (b) if HIPAA-tier customers aren't in the first 5 MVP tenants; (a) only if AssemblyAI sales cycle is already engaged. (c) is uneconomic at scale per the ADR's own §Decision rejection. |
| D2 | **ADR-0015 Cloud-side disposition** | (a) Run `sprint-0/temporal-sdk-validation/` worker against a Temporal Cloud sandbox; upgrade evidence to full. <br>(b) File `docs/adr/0015-cloud-sdk-deferred.md` with justification (Temporal's published portability claim + Open Risk #4 acknowledged). | (b) for a solo founder who hasn't signed up for Cloud sandbox; (a) if you already have or want sandbox credentials. |
| D3 | **G0 enum path** | (a) Path A — Strict: all 8 spikes must be Green before MVP work begins. <br>(b) Path B — Pragmatic: extend gate enum with "Deferred-with-fallback-plan" status; per-Deferred-spike sub-decisions land in `pot/g0-closed.md`. | (b) per `pot/g0-signoff-proposal.md` recommendation. |

---

## Task 1: Ratify ADR-0013 with chosen sub-decision

**Decision required:** D1 above. Do not proceed without picking.

**Files:**
- Modify: `docs/adr/0013-redaction-pipeline.md`

- [ ] **Step 1.1: Choose D1 sub-decision and confirm to the engineer driving execution**

If unable to decide, stop here and discuss with stakeholders. Do not pick silently.

- [ ] **Step 1.2: Read the current ADR**

Run: `Read docs/adr/0013-redaction-pipeline.md`
Expected: Status line reads `**Status:** Proposed`; `## Phase-0 status (2026-05-13):` block names S4 Deferred.

- [ ] **Step 1.3: Flip Status and append §Decision sub-decision block**

Edit `docs/adr/0013-redaction-pipeline.md`:

- Change `**Status:** Proposed` to `**Status:** Accepted`
- Add immediately under the existing `## Decision` section a new sub-section. Pick the block matching D1:

**If D1 = (a) full two-pass:**
```markdown
### Sub-decision (2026-05-14, G0 closure)

Adopted **Option A — full two-pass pipeline**. AssemblyAI Universal-3 Pro Medical key acquisition is in progress (vendor sales cycle 1–4 weeks). MVP Sprint 1–3 builds the ML pipeline against the S4 fixture corpus assembled during Sprint-0. PoC tracer-bullet does NOT exercise this pipeline (PoC spec §5.2 cut).
```

**If D1 = (b) HIPAA-disable:**
```markdown
### Sub-decision (2026-05-14, G0 closure)

Adopted **Option B — disable recording for HIPAA tenants in MVP**. MVP tenants flagged `hipaa_tier=true` have `recording_enabled=false` by default; the ML redaction pipeline (Pass 1 + Pass 2) is removed from MVP scope. Non-HIPAA tenants record without redaction; operator-initiated PCI pause spans (PoC Slice 2) remain the only audio-level safeguard. Revisit post-MVP if HIPAA-tier demand justifies the AssemblyAI investment.
```

**If D1 = (c) manual-QA-only:**
```markdown
### Sub-decision (2026-05-14, G0 closure)

Adopted **Option C — manual-QA-only redaction**. Recording stays on for all tenants; redaction is human-only via a weekly 100%-review queue (no ML pipeline). Accept the operational cost as a Sprint 1–3 staffing item. Threshold-tuning loop in original §Decision item 3 becomes the primary mechanism.
```

- [ ] **Step 1.4: Verify the edit**

Run: `grep -c '\*\*Status:\*\* Accepted' docs/adr/0013-redaction-pipeline.md`
Expected: `1`

Run: `grep -c 'Sub-decision (2026-05-14, G0 closure)' docs/adr/0013-redaction-pipeline.md`
Expected: `1`

- [ ] **Step 1.5: Commit**

```bash
git add docs/adr/0013-redaction-pipeline.md
git commit -m "docs(adr): ratify ADR-0013 — sub-decision <A/B/C> at G0 closure"
```

Replace `<A/B/C>` in the message with the chosen letter.

---

## Task 2: Resolve ADR-0015 Cloud-side SDK disposition

**Decision required:** D2 above.

**Files:**
- Verify: `docs/adr/0015-temporal-cloud-tier.md` (must still be `Status: Accepted`)
- One of: Modify `docs/adr/0015-sdk-identity-evidence.md` (Option a) OR Create `docs/adr/0015-cloud-sdk-deferred.md` (Option b)

- [ ] **Step 2.1: Verify ADR-0015 is still Accepted (no regression since Sprint-0 ratification)**

Run: `grep -c '\*\*Status:\*\* Accepted' docs/adr/0015-temporal-cloud-tier.md`
Expected: `1`

If `0`, stop — Sprint-0 baseline ratification has regressed and must be investigated before this task continues.

- [ ] **Step 2.2: Choose D2 disposition and confirm**

- [ ] **Step 2.3a: If D2 = (a) — run Cloud sandbox validation**

Sign up for a Temporal Cloud sandbox at <https://temporal.io/cloud>; obtain a namespace + mTLS cert + key.

In `sprint-0/temporal-sdk-validation/`:

```bash
cp config/cloud.json.example config/cloud.json
# Edit config/cloud.json to fill in the sandbox namespace + cert paths
pnpm run hello --cloud
```

Capture the worker output and append to `docs/adr/0015-sdk-identity-evidence.md` under a new `## Cloud-side validation (2026-05-14)` section. Include: timestamp, worker version (from `package.json`), Temporal Cloud server version (from `temporal --version` against the sandbox), and the workflow run id.

Run: `grep -c 'Cloud-side validation' docs/adr/0015-sdk-identity-evidence.md`
Expected: `1`

- [ ] **Step 2.3b: If D2 = (b) — file deferral document**

Create `docs/adr/0015-cloud-sdk-deferred.md`:

```markdown
# ADR-0015 — Cloud-side SDK identity validation: deferred

- **Date:** 2026-05-14
- **Status:** Deferred-with-fallback-plan
- **Relates to:** [ADR-0015 Open Risk #4](./0015-temporal-cloud-tier.md), [`0015-sdk-identity-evidence.md`](./0015-sdk-identity-evidence.md)

## Decision

The self-host SDK identity check is **complete and Green** (see `0015-sdk-identity-evidence.md` partial-check evidence). The Cloud-side identity check is **deferred** until a Temporal Cloud sandbox is provisioned. The fallback plan is:

1. Trust Temporal's published portability guarantee for the TypeScript SDK (`@temporalio/worker` is identical bytes regardless of which server it connects to).
2. The first MVP-tier Cloud customer triggers the full Cloud-side smoke (worker runs `HelloWorldWorkflow` against their tenant Cloud namespace). Until that point, MVP runs against self-host Temporal only.
3. ADR-0015 Open Risk #4 stays open and tracked.

## Justification

A solo-founder PoT cannot justify a Cloud sandbox subscription before the first paying tenant. Self-host evidence is sufficient for PoC tracer-bullet Green (which uses self-host Temporal exclusively per PoC §5 architecture). Cloud-side divergence, if any, surfaces at the first Cloud-tier deployment and is bounded — divergence at the SDK layer would be a connection-string fix, not a workflow code change.

## Consequences

- PoC + MVP Sprint 1–N (until first Cloud tenant) run on self-host Temporal only.
- ADR-0015 Open Risk #4 remains Open in the risk register.
- This deferral is **not** a re-litigation of ADR-0015 itself — Temporal self-host stays the MVP-baseline; this defers only the partial-check upgrade.
```

Run: `test -f docs/adr/0015-cloud-sdk-deferred.md && echo OK`
Expected: `OK`

- [ ] **Step 2.4: Commit (choose the message matching D2)**

```bash
# D2 option a
git add docs/adr/0015-sdk-identity-evidence.md
git commit -m "docs(adr): add Cloud-side SDK identity validation to ADR-0015 evidence"

# D2 option b
git add docs/adr/0015-cloud-sdk-deferred.md
git commit -m "docs(adr): defer ADR-0015 Cloud-side SDK validation with written justification"
```

---

## Task 3: Execute S1 Layer-2 rtpengine media smoke on Linux

**Files:**
- Create: `pot/S1-telephony-happy-path/results/<ISO-date>-linux-layer2.md`

**Context:** S1 Layer-2 (rtpengine media-path smoke) is Deferred per PoT readout because macOS Docker fragility blocked the kernel-bypass path. This task runs the existing smoke on Linux to satisfy spec §11 prerequisite and Chunk 0 exit criterion. The repo already contains `pot/S1-telephony-happy-path/docker-compose.yml`, `scripts/`, and `runbook.md` from the PoT spike.

- [ ] **Step 3.1: Choose a Linux execution surface**

Two acceptable surfaces:
- **Local Linux VM/box** — easiest if you have one.
- **GitHub Actions ubuntu-latest runner** — bring up the compose stack inside the runner, run SIPp against it, capture results, download as artifact.

Pick one and proceed.

- [ ] **Step 3.2: Read the existing S1 runbook**

Run: `Read pot/S1-telephony-happy-path/runbook.md`
Expected: documented `make` targets for Layer-2 (rtpengine + media). Identify the Layer-2-specific target (likely `make layer2` or similar).

- [ ] **Step 3.3: Bring up compose on Linux**

On the Linux host:

```bash
cd pot/S1-telephony-happy-path
make up
# wait for healthchecks
make layer2-smoke   # or equivalent target from runbook
```

Capture stdout to a file:

```bash
make layer2-smoke 2>&1 | tee /tmp/s1-layer2.log
```

- [ ] **Step 3.4: Assert smoke passed**

Search the log for the success marker the runbook documents. If runbook says "look for `RTP media confirmed` in the output", run:

```bash
grep -c 'RTP media confirmed' /tmp/s1-layer2.log
```
Expected: `≥ 1`.

If `0`, the smoke failed. Stop and diagnose per `pot/S1-telephony-happy-path/runbook.md` troubleshooting section before declaring Chunk 0 done.

- [ ] **Step 3.5: Write the readout file**

Create `pot/S1-telephony-happy-path/results/$(date -u +%Y%m%dT%H%M%SZ)-linux-layer2.md`:

```markdown
# S1 Layer-2 Linux smoke — readout

- **Date:** 2026-05-14
- **Host:** <Linux distro + kernel version; e.g. `Ubuntu 24.04, kernel 6.8.0-31-generic`>
- **rtpengine version:** <output of `rtpengine --version` inside container>
- **Outcome:** Green
- **Evidence:** <paste relevant ~10-line excerpt from /tmp/s1-layer2.log showing the success marker>

## Notes

<one paragraph: anything noteworthy — e.g. kernel-bypass on/off, NAT config, ng-control handshake timing>

## Reference

This readout closes the S1 Layer-2 Deferred status per `pot/pot-readout.md` §S1 and Chunk 0 Sprint-0 prerequisite #5.
```

- [ ] **Step 3.6: Tear down + commit**

```bash
cd pot/S1-telephony-happy-path
make down
git add pot/S1-telephony-happy-path/results/
git commit -m "evidence(S1): Layer-2 rtpengine smoke Green on Linux — closes S1 Deferred"
```

---

## Task 4: Verify Q1-Q3 architectural decisions are documented for ratification

**Files:** none yet (Q1-Q3 are recorded in `pot/g0-closed.md` in Task 5; this task just confirms each is decidable).

- [ ] **Step 4.1: Confirm each architectural choice is current with the PoC spec**

The three choices per PoC spec §10:
- **Q1 — Workspace tool:** `pnpm workspaces` (no Nx, no Turbo)
- **Q2 — Operator UI framework:** Next.js App Router
- **Q3 — Postgres ORM:** Drizzle

All three are recommendations in the PoC spec, not user-overridden. The act of "architect ratification" for a solo founder is: confirm the recommendations stand, record them in `g0-closed.md` (Task 5).

If you want to override any, stop and rewrite the design spec — the chunk plan assumes these are baseline.

- [ ] **Step 4.2: Note your ratification stance (no file edit yet)**

Hold the three ratifications in mind for Task 5 §Q1-Q3 block.

---

## Task 5: Write `pot/g0-closed.md`

**Decision required:** D3 above (G0 enum path) — and prior task decisions D1, D2.

**Files:**
- Create: `pot/g0-closed.md`

- [ ] **Step 5.1: Read the G0 sign-off proposal so you mirror its structure**

Run: `Read pot/g0-signoff-proposal.md`
Expected: it lays out Path A vs Path B, per-Deferred sub-decisions for S4/S6/S7, and the senior-architect + compliance-lead signature section.

- [ ] **Step 5.2: Write `pot/g0-closed.md`**

Create `pot/g0-closed.md`. Use this template — fill in every `<...>` placeholder.

```markdown
# G0 closed — Sprint-0 gate closure

- **Date:** 2026-05-14
- **Phase transitioning:** Phase 0 (PoT) → Phase 1 (PoC tracer-bullet)
- **Closer:** Founder, acting as senior architect + compliance lead (solo)
- **Source proposal:** [`pot/g0-signoff-proposal.md`](./g0-signoff-proposal.md)

## Path decision

**G0 enum path:** <D3 — write either "Path A — Strict" or "Path B — Pragmatic (extends enum with Deferred-with-fallback-plan)">

Rationale: <one paragraph — typically Path B for solo founder; cite proposal §Path B>.

## Per-Deferred-spike sub-decisions

### S4 — Redaction accuracy

- **Status:** <Accepted full pipeline / De-scoped HIPAA disable / De-scoped manual-QA only>
- **ADR ratification:** ADR-0013 ratified at Status: Accepted on 2026-05-14 with sub-decision <A/B/C>. See [`docs/adr/0013-redaction-pipeline.md` §Sub-decision (2026-05-14)](../docs/adr/0013-redaction-pipeline.md).
- **PoC implication:** ML redaction pipeline is **not** in PoC tracer-bullet (PoC §5.2 cut). PoC asserts only operator-initiated PCI pause spans (Slice 2).

### S6 — TAS fixture capture

- **Status:** Deferred with trigger rule
- **Trigger:** If `/v1/Account/:id` controller in Chunk 2 of the chunk-plan requires a recorded CRM fixture response to pass its unit tests, assign S6 cache-scraper stub work to Chunk 2 scope. Otherwise S6 stays unowned for the PoC.
- **PoC implication:** No PoC scenario requires a CRM fixture round-trip; S6 surface is unlikely to trigger before MVP Sprint 4–11.

### S7 — Temporal BAA / self-host baseline

- **Status:** Accepted (self-host baseline) + Cloud-side disposition resolved
- **Self-host evidence:** `docs/adr/0015-selfhost-baseline-log.md` + `docs/adr/0015-sdk-identity-evidence.md`.
- **Cloud-side disposition:** <D2 — write either "Cloud sandbox run logged in 0015-sdk-identity-evidence.md §Cloud-side validation" or "Deferred — see 0015-cloud-sdk-deferred.md">

## Q1-Q3 architectural ratifications (PoC spec §10)

| # | Decision | Choice | Source |
|---|---|---|---|
| Q1 | Workspace tool | **pnpm workspaces** (no Nx, no Turbo) | PoC §10 Q1 |
| Q2 | Operator UI framework | **Next.js App Router** | PoC §10 Q2 |
| Q3 | Postgres ORM | **Drizzle** | PoC §10 Q3 |

These ratifications are the durable architectural commitments for MVP build-out.

## S1 Layer-2 closure

- **Status:** Green on Linux as of 2026-05-14.
- **Evidence:** [`pot/S1-telephony-happy-path/results/<filename from Task 3>`](./S1-telephony-happy-path/results/).
- **Effect:** S1 Layer-2 Deferred status closed; PoT readout entry can be updated post-merge.

## Signatures

- Architect: Founder (solo) — 2026-05-14
- Compliance lead: Founder (solo) — 2026-05-14

## Status marker (for grep gates)

G0 closed.

---

## Next chunk

The MVP chunk-plan ([`docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md`](../docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md)) Chunk 1 (monorepo skeleton + infra compose) is unblocked by this document.
```

Replace every `<...>` placeholder before saving.

- [ ] **Step 5.3: Verify the grep gates**

Run: `grep -c 'G0 closed.' pot/g0-closed.md`
Expected: `1`

Run: `grep -c 'pnpm workspaces' pot/g0-closed.md && grep -c 'Next.js App Router' pot/g0-closed.md && grep -c 'Drizzle' pot/g0-closed.md`
Expected: each `1` (three commands, each prints `1`)

- [ ] **Step 5.4: Commit**

```bash
git add pot/g0-closed.md
git commit -m "docs(pot): close G0 — Path <A/B>; S4/S6/S7 sub-decisions ratified; Q1-Q3 recorded"
```

Replace `<A/B>` with the chosen path letter.

---

## Task 6: Merge PoT spike chain to `main`

**Context:** The PoC spec §11 prerequisite says "PoT spike chain merged to `main`; tags preserved." The PoC spec §8 says `pot/` directories are **retained** until PoC Green. Do NOT delete spike directories in this task — only the branch merges.

If the spike chain is already on `main` (because Sprint-0 work landed there), this task is a no-op verification. The current branch is `sprint-0/temporal-selfhost-baseline`; that branch is the most recent ancestor and contains the PoT readout work.

**Files:** none (git operations only).

- [ ] **Step 6.1: Check current branch state**

```bash
git status
git log --oneline -10
git branch -a
```

Expected: `git status` clean (Tasks 1, 2, 3, 5 commits all landed on current branch).

- [ ] **Step 6.2: Confirm tags exist for any PoT spike landmarks worth preserving**

```bash
git tag | grep -E 'pot-|spike-|S[0-9]' || echo "(no spike tags)"
```

If tags exist, they're already preserved by being tags — nothing to do. If you'd like to add a tag for the G0 closure point, do it now:

```bash
git tag -a pot-g0-closed -m "G0 sign-off closed on 2026-05-14 — Path B Pragmatic"
```

- [ ] **Step 6.3: Merge the current branch to `main`**

If working in a worktree or you have a remote:

```bash
git checkout main
git merge --no-ff sprint-0/temporal-selfhost-baseline -m "merge: Sprint-0 + G0 closure → main"
```

If `main` does not exist locally (early-stage repo), make sure you're on the branch that will become canonical. **Do not force-push, do not amend published commits.**

- [ ] **Step 6.4: Push if a remote exists (skip if no remote)**

```bash
git remote -v
# if a remote is listed:
git push origin main
git push --tags
```

If no remote, skip — the local `main` is canonical for now.

- [ ] **Step 6.5: Verify spike directories are retained**

Run: `ls pot/`
Expected: all S1..S8 directories still present, plus the new `g0-closed.md`.

If any directory is missing, you over-deleted — restore from git (`git restore --staged --worktree pot/...`).

---

## Task 7: Verify all Chunk 0 exit criteria pass

**Files:** none — this is a verification task. Run each command and confirm the expected exit.

- [ ] **Step 7.1: G0 closed marker present**

Run: `grep 'G0 closed' pot/g0-closed.md`
Expected: line matched, exit code 0.

- [ ] **Step 7.2: ADR-0013 Accepted**

Run: `grep '\*\*Status:\*\* Accepted' docs/adr/0013-redaction-pipeline.md`
Expected: exit code 0.

- [ ] **Step 7.3: ADR-0015 Accepted (regression check)**

Run: `grep '\*\*Status:\*\* Accepted' docs/adr/0015-temporal-cloud-tier.md`
Expected: exit code 0.

- [ ] **Step 7.4: ADR-0015 Cloud-side disposition present**

Run: `ls docs/adr/0015-cloud-sdk-deferred.md 2>/dev/null || grep 'Cloud-side validation' docs/adr/0015-sdk-identity-evidence.md`
Expected: one of the two exits 0 (matches the D2 choice).

- [ ] **Step 7.5: S1 Layer-2 Linux readout present**

Run: `ls pot/S1-telephony-happy-path/results/*linux-layer2.md`
Expected: at least one matching file.

- [ ] **Step 7.6: Q1-Q3 ratifications in `g0-closed.md`**

Run: `grep -c 'pnpm workspaces' pot/g0-closed.md`
Expected: `1`.

Run: `grep -c 'Next.js App Router' pot/g0-closed.md`
Expected: `1`.

Run: `grep -c 'Drizzle' pot/g0-closed.md`
Expected: `1`.

- [ ] **Step 7.7: Working tree clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`.

- [ ] **Step 7.8: Mark Chunk 0 done**

If all of 7.1 through 7.7 pass, Chunk 0 is Green. Proceed to write the Chunk 1 implementation plan (monorepo skeleton + infra compose).

If any step failed, stop and resolve the specific exit criterion before declaring Chunk 0 done.

---

## Self-review checklist (for the engineer driving execution)

Before declaring Chunk 0 done:

- [ ] Did you actually pick D1, D2, D3, not let an agent pick silently?
- [ ] Did the S1 Layer-2 smoke run on a real Linux host (not macOS Docker)?
- [ ] Does `pot/g0-closed.md` reference every per-spike decision (S4, S6, S7) and every Q1-Q3 choice?
- [ ] Are `pot/` directories still present (PoC §8 retention rule)?
- [ ] Did you preserve git history (no force-push, no amend)?

---

*Plan written 2026-05-14. Source spec: [`docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md`](../specs/2026-05-14-local-mvp-chunk-plan-design.md) Chunk 0. Effort estimate: 3–5 days, calendar-bound by D1 sub-decision speed.*
