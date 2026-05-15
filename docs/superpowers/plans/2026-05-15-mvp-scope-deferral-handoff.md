# Handoff — MVP Scope Deferral execution

- **Plan:** `docs/superpowers/plans/2026-05-15-mvp-scope-deferral.md` (committed `4832af3`)
- **Spec:** `docs/superpowers/specs/2026-05-15-mvp-scope-deferral-design.md` (same commit)
- **Branch:** `sprint-0/temporal-selfhost-baseline`
- **Date written:** 2026-05-15
- **Execution commit:** `ed17f74` (2026-05-15)

## Current state

- ✅ Brainstorm complete (prior session)
- ✅ Spec written + user-confirmed (5 ambiguities resolved)
- ✅ Planner+verifier loop converged: verifier round 3 = 95, zero blockers
- ✅ Spec + plan committed at `4832af3`
- ✅ **Execution complete (2026-05-15).** All 9 slices Green. Commit `ed17f74`.

### Slice-by-slice status

| Slice | Owns | Status |
|---|---|---|
| 1 — ADR-0025 (Asterisk-direct) | A1, A2 | ✅ Green |
| 2 — ADR-0026 (HIPAA-tier deferred) | A3, A4 | ✅ Green |
| 3 — ADR-0013 §Broader scope | A5 | ✅ Green |
| 4 — ARCHITECTURE.v0.4.md §12 amendment | A6 | ✅ Green |
| 5 — RISKS.v0.2.md §8 amendment | A7 | ✅ Green |
| 6 — PRD.v2.md §7.2.3 + §8 amendments | A8 | ✅ Green |
| 7 — Memory amendments + plan_mvp_scope_deferral.md + MEMORY.md | A9, A11 | ✅ Green |
| 8 — pot/g0-closed.md §S4 + §S1 amendments | A10 | ✅ Green |
| 9 — Commit | A12 | ✅ Green (`ed17f74`) |

### A1–A12 final sweep (post-execution)

- A1=1, A2=2, A3=1, A4a=8, A4b=3, A5=1, A6a=2, A6b=2, A6c=2, A7=3, A8a=2, A8b=2, A9=2, A10=2, A11=1, A12=GREEN.

## Execution notes

### Deviation from plan's Slice 9 — partial staging required

The plan's Slice 9 prescribed `git add <path>` for each file. The plan's pre-flight reads assumed the working tree was clean of ncall→TAS rename churn at execution time; in fact `ARCHITECTURE.v0.4.md`, `PRD.v2.md`, and `RISKS.v0.2.md` carried ~80-line global rename churn from a separate work stream. Per-path `git add` would have bundled the rename into the scope-deferral commit (PRD diffstat was 44+/40− before partial-staging).

**Resolution (user-confirmed):** restored HEAD versions of the 3 churn-affected files, re-applied only the MVP scope-deferral amendments, staged, committed, then restored the full working-tree state from backups (`/tmp/scope-deferral-backup/`). Verified the staged diff was pure-additive amendment-only (zero ncall→TAS keywords in the staged hunks). The rename churn is back in the working tree, untouched and unstaged, ready for a separate commit.

### Auto-memory files were not in the project git repo

Slice 9's stage list included 4 memory files (`compliance_posture.md`, `telephony_decisions.md`, `plan_mvp_scope_deferral.md`, `MEMORY.md`) under `~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/`. These are written to disk (the auto-memory layer persists them independently of git) but the directory is **outside** the project repo and `git add` rejected them ("outside repository"). This is expected behavior — auto-memory is per-user and per-host, not committed to the project. **All four files exist on disk and persist for future sessions.** The plan's expected 13-file commit count became 7 (2 new ADRs + 5 modified docs); the 4 memory files persist outside git and the 2 already-committed plan/spec files were no-op staged.

## Commit details

```
ed17f74 docs(adr): ratify ADR-0025 Asterisk-direct + ADR-0026 HIPAA-tier deferred — MVP scope deferral
 7 files changed, 190 insertions(+), 1 deletion(-)
 create mode 100644 docs/adr/0025-telephony-asterisk-direct.md
 create mode 100644 docs/adr/0026-hipaa-tier-deferred.md
```

Files staged in commit:
- `docs/adr/0025-telephony-asterisk-direct.md` (new)
- `docs/adr/0026-hipaa-tier-deferred.md` (new)
- `docs/adr/0013-redaction-pipeline.md` (Broader scope §)
- `ARCHITECTURE.v0.4.md` (§12 MVP edge topology amendment)
- `RISKS.v0.2.md` (§8 single-Asterisk risk)
- `PRD.v2.md` (§7.2.3 + §8 amendments)
- `pot/g0-closed.md` (§S4 + §S1 amendments)

Auto-memory written outside repo (persisted to user-level memory directory):
- `compliance_posture.md` (Future tier section appended)
- `telephony_decisions.md` (§6 edge topology added — §2 Model A/B preserved verbatim per plan self-review checklist)
- `plan_mvp_scope_deferral.md` (new project memory)
- `MEMORY.md` (146-char pointer line added at end)

## What's left

- Pre-existing ncall→TAS rename-churn in the working tree (~80 files) is untouched and ready for a separate commit stream when the user decides to land it.
- Optional: `git tag -a mvp-scope-deferral-ratified -m "G0 follow-on; ADR-0025 + ADR-0026 ratified"` at commit `ed17f74`. Discretionary; not done by this execution.
- Push to remote: not done by this execution (awaiting user direction).

## Next session

This plan is complete. Slice 9 status is closed. No follow-up handoff needed.
