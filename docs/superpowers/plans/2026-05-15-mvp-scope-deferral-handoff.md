# Handoff — MVP Scope Deferral execution

- **Plan:** `docs/superpowers/plans/2026-05-15-mvp-scope-deferral.md` (committed `4832af3`)
- **Spec:** `docs/superpowers/specs/2026-05-15-mvp-scope-deferral-design.md` (same commit)
- **Branch:** `sprint-0/temporal-selfhost-baseline`
- **Date written:** 2026-05-15

## Current state

- ✅ Brainstorm complete (this session)
- ✅ Spec written + user-confirmed (5 ambiguities resolved)
- ✅ Planner+verifier loop converged: verifier round 3 = 95, zero blockers
- ✅ Spec + plan committed at `4832af3`
- ⏳ **Execution:** none started. All 9 slices `not_started`.

## Next action

Invoke `superpowers:executing-plans` in a fresh session. Load the plan file as input:
`docs/superpowers/plans/2026-05-15-mvp-scope-deferral.md`

Execute Slices 1–9 in order. Each slice is self-contained: red-state grep gate → edits → green-state grep gate.

Estimated time: 45–90 minutes (documentation work, no build/test cycle).

## Blocked-on

Nothing. All decisions are resolved:
- D1: HIPAA-tier deferred (already flipped this session at `aac9aeb`; ADR-0026 generalises)
- D2: Kamailio + rtpengine deferred → Asterisk-direct edge topology (new ADR-0025)
- D3: HIPAA depth = soft scope-out (no schema column added)
- D4: Kamailio archival = Chunk 4 scope (not this plan)
- D5: Chunk 3 = roll-forward (no churn)
- D6: PRD canonical = `PRD.v2.md` only
- D7: ADR shape = 2 independent ADRs (0025, 0026)
- D8: Naming = "Asterisk-direct" / "Kamailio-fronted SBC topology" (NOT Model A/B — collides with telephony_decisions.md tenant-isolation memory)

## Evidence artefacts produced this session

- Commit `aac9aeb` — D1 sub-decision flip A→B (ADR-0013 + g0-closed.md amended)
- Commit `4832af3` — spec + plan committed (THIS plan)

## Files the executor will produce/modify (per plan Slice 9 staging list)

New files:
- `docs/adr/0025-telephony-asterisk-direct.md`
- `docs/adr/0026-hipaa-tier-deferred.md`
- `~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/plan_mvp_scope_deferral.md`

Modified files:
- `docs/adr/0013-redaction-pipeline.md` (add §Broader scope cross-reference)
- `ARCHITECTURE.v0.4.md` (telephony section amendment)
- `RISKS.v0.2.md` (single-Asterisk risk added)
- `PRD.v2.md` (§7 telephony + §8 compliance updated)
- `pot/g0-closed.md` (§S1 + §S4 amendments)
- `~/.claude/projects/.../memory/compliance_posture.md` (Future tier section)
- `~/.claude/projects/.../memory/telephony_decisions.md` (new §6 edge topology — NOT renaming §2 Model A/B)
- `~/.claude/projects/.../memory/MEMORY.md` (pointer to new plan memory)

Plus stage the spec + plan + handoff themselves.

## Environment prereqs

- macOS or any host with git + Bash. No containers required (pure docs/ADR work).
- No services need to be running.
- Working tree has ~80 unstaged `ncall→tas` rename-churn files — executor MUST stage specific files only (no `git add -A`). See Slice 9 explicit list.

## Skills the executor should load

1. `superpowers:executing-plans` — drives the slice-by-slice execution
2. `superpowers:verification-before-completion` — A1–A12 grep gates are governance artefacts; evidence-before-assertion matters
3. (Optional) `superpowers:systematic-debugging` — if any anchor mismatches (Edit `old_string` not found), don't guess+patch; re-Read the file and re-anchor

## Notes for the executor

- The auto-memory entry at `memory/plan_mvp_scope_deferral.md` is written by Slice 7 (it's part of A11). The plan-and-verify skill's Step 8 auto-memory write is **deferred to plan execution**, not done at plan commit time, to avoid duplicating Slice 7's work.
- `MEMORY.md` pointer line must be ≤150 chars. Suggested form: `- [Plan: mvp scope deferral](plan_mvp_scope_deferral.md) — ADR-0025 Asterisk-direct + ADR-0026 HIPAA-tier deferred; Chunk 4 does physical rewire`
- After execution: write next-session handoff to this same file (overwrite, with `Current state` reflecting Slices 1–9 done + commit hash).
- After execution: optionally tag the convergence point (`git tag -a mvp-scope-deferral-ratified -m "G0 follow-on; ADR-0025 + ADR-0026 ratified"`). Discretionary.
