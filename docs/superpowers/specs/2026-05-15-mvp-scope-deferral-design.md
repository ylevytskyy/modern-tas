# MVP Scope Deferral — HIPAA-Tier + Kamailio/rtpengine Topology

- **Date:** 2026-05-15
- **Slug:** `mvp-scope-deferral`
- **Author:** Founder + Claude Opus 4.7
- **Phase:** Sprint-0 amendment (post-G0 closure)
- **Branch:** `sprint-0/temporal-selfhost-baseline`
- **Source brainstorm:** session 2026-05-15 (this file is its output)

---

## 1. Goal

Defer two MVP-scope elements with future-extension hooks intact:

1. **HIPAA-tier compliance posture.** MVP supports GDPR + PCI + general security baseline only. HIPAA support becomes a documented future tier with a named re-introduction trigger.
2. **Kamailio + rtpengine SBC topology.** MVP runs **Asterisk-direct** (carrier ↔ Asterisk, no SBC tier). The Kamailio-fronted SBC topology (Kamailio + rtpengine) is documented as the production-scale path with a named re-introduction trigger.

> **Terminology note (matters):** This decision uses the labels "Asterisk-direct" and "Kamailio-fronted SBC topology" for the telephony **edge topology** (Asterisk faces the carrier vs. Kamailio fronts Asterisk). Earlier brainstorm drafts used "Model A" / "Model B" — those terms are reused in `~/.claude/projects/.../memory/telephony_decisions.md` to mean **Asterisk tenant-isolation model** (dedicated container per tenant vs. N tenants per Asterisk). Do not reintroduce the Model A/B language for edge topology — it produces a permanent ambiguity. Slice 7 amends `telephony_decisions.md` to add the edge-topology decision alongside (not replacing) the tenant-isolation section.

Output is **decision ratification + documentation + memory updates**. Physical implementation (compose rewire, `infra/{kamailio,rtpengine}/` archival, `pjsip.conf` rewrite) is **explicitly Chunk 4 scope**, not this plan's scope.

## 2. Motivation

Solo-founder MVP, pre-revenue, no HIPAA-tier prospect in the first 5 MVP tenants pipeline (confirmed 2026-05-15). Scale targets are 20–50 operators per tenant, ~1500 calls/day per tenant — well below the threshold where Kamailio + rtpengine's failover and kernel-mode-RTP advantages pay back their operational cost.

This is the natural extension of the 2026-05-15 D1 = B sub-decision flip on ADR-0013 (commit `aac9aeb`) that disabled HIPAA-tier recording. That flip removed the *consequence* (ML redaction pipeline) but left the *cause* (HIPAA-tier as a first-class MVP concept) in place. This plan resolves the cause.

The two axes are technically independent (HIPAA scope-out doesn't require dropping Kamailio, and vice versa) but share the simplification motivation. They are bundled into one spec for brainstorm efficiency; they produce **two independent ADRs** so future amendments can flow on either axis without entanglement.

## 3. Acceptance criteria (Green/Red)

Each is a grep-gate-able assertion against the post-execution repo state.

| # | Assertion | Verification |
|---|---|---|
| A1 | ADR-0025 exists at `docs/adr/0025-telephony-asterisk-direct.md`, Status: Accepted | `grep -c '\*\*Status:\*\* Accepted' docs/adr/0025-*.md` → `1` |
| A2 | ADR-0025 contains a documented Kamailio-fronted SBC topology re-introduction trigger | `grep -c 're-introduction trigger\|Re-introduction trigger' docs/adr/0025-*.md` → `≥ 1` |
| A3 | ADR-0026 exists at `docs/adr/0026-hipaa-tier-deferred.md`, Status: Accepted | `grep -c '\*\*Status:\*\* Accepted' docs/adr/0026-*.md` → `1` |
| A4 | ADR-0026 references ADR-0013 as predecessor + names re-introduction trigger | `grep -c 'ADR-0013\|0013-redaction' docs/adr/0026-*.md` → `≥ 1`; `grep -c 're-introduction\|Re-introduction' docs/adr/0026-*.md` → `≥ 1` |
| A5 | ADR-0013 has a `### Broader scope (2026-05-15)` cross-reference block pointing at ADR-0026 | `grep -c 'Broader scope (2026-05-15)' docs/adr/0013-redaction-pipeline.md` → `1` |
| A6 | `ARCHITECTURE.v0.4.md` topology section reflects Asterisk-direct as MVP-baseline; SBC tier marked deferred | `grep -c 'Asterisk-direct\|MVP edge topology\|carrier.*Asterisk.*direct' ARCHITECTURE.v0.4.md` → `≥ 1`; `grep -c 'SBC.*deferred\|Kamailio.*deferred\|deferred.*SBC\|deferred.*Kamailio' ARCHITECTURE.v0.4.md` → `≥ 1`; `grep -c 'ADR-0025' ARCHITECTURE.v0.4.md` → `≥ 1` |
| A7 | `RISKS.v0.2.md` reflects single-Asterisk-crash risk + Kamailio-failover-deferred status | `grep -c 'single.Asterisk\|Asterisk crash\|warm.standby' RISKS.v0.2.md` → `≥ 1` |
| A8 | `PRD.v2.md` §7 (telephony) + §8 (compliance) updated for Asterisk-direct edge + GDPR+PCI-only | `grep -c 'Asterisk-direct\|ADR-0025\|ADR-0026' PRD.v2.md` → `≥ 2`; `grep -c 'HIPAA.*deferred\|deferred.*HIPAA' PRD.v2.md` → `≥ 1`. Red-baseline note: PRD.v2.md line 506 has one pre-existing "Model A" hit referring to **tenant isolation** (per-tenant container) — do NOT collide with that; the gate intentionally checks for "Asterisk-direct" (new edge-topology naming) instead. |
| A9 | `compliance_posture.md` memory has a §Future tier section deferring HIPAA-specific clauses | `grep -c 'Future tier\|future tier\|HIPAA.*deferred' ~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/compliance_posture.md` → `≥ 1` |
| A10 | `pot/g0-closed.md` §S1 + §S4 amended to reflect Asterisk-direct telephony + broader HIPAA deferral | `grep -c 'Asterisk-direct telephony\|ADR-0025\|ADR-0026' pot/g0-closed.md` → `≥ 2` |
| A11 | New project-memory file `plan_mvp_scope_deferral.md` exists + linked in `MEMORY.md` | `test -f ~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/plan_mvp_scope_deferral.md && grep -c 'plan_mvp_scope_deferral' ~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/MEMORY.md` |
| A12 | All changes land in a single commit on `sprint-0/temporal-selfhost-baseline` | `git log --oneline -1 \| grep -E 'mvp-scope-deferral\|MVP scope deferral'` |

## 4. Non-goals (explicit exclusions)

- **NOT** redoing Chunk 3 telephony wiring. `chunk3-smoke` stays Green at commit `a7c2dac`. Kamailio remains in the active compose stack until Chunk 4.
- **NOT** moving `infra/kamailio/` → `infra/kamailio.deferred/`. Chunk 4 scope.
- **NOT** moving `infra/rtpengine/` → `infra/rtpengine.deferred/`. Chunk 4 scope.
- **NOT** removing Kamailio or rtpengine services from `infra/docker-compose.yml`. Chunk 4 scope.
- **NOT** rewriting `infra/asterisk/pjsip.conf` for carrier-direct. Chunk 4 scope.
- **NOT** rewriting `infra/asterisk/extensions.conf`. Dialplan is topology-agnostic; no change needed even in Chunk 4.
- **NOT** adding `hipaa_tier` column to `packages/db/src/schema/tenancy.ts`. Pure YAGNI per CLAUDE.md §2; re-introduction is a future migration.
- **NOT** removing GDPR or PCI from MVP scope.
- **NOT** removing recording for non-HIPAA tenants.
- **NOT** changing ADR-0015 (Temporal), ADR-0016 (ARI leader), ADR-0018 (Supavisor), ADR-0019 (Caddy), or ADR-0024 (queue). None are HIPAA- or topology-load-bearing.
- **NOT** retiring PoT spike directories (`pot/S1..S8`). PoC spec §8 retention rule.
- **NOT** amending `PRD.md` (v1.0 seed). Frozen for provenance.
- **NOT** designing the Kamailio-fronted SBC topology or HIPAA-tier re-introduction migration plans. Each ADR names only the trigger; the migration plan is a future planning round.

## 5. Constraints

- Solo founder; CLAUDE.md §2 simplicity-first applies. No speculative scaffolding (no dormant schema columns; no `.deferred/` dirs until Chunk 4 actually needs them).
- Two independent ADRs (0025, 0026). Future amendments to either flow independently.
- All edits preserve audit trail: ADRs reference predecessor commits; superseded prose marked, not deleted (same pattern as the 2026-05-15 D1 sub-decision flip in `aac9aeb`).
- This plan = decision ratification + docs + memory updates. Physical implementation deferred.
- Single commit lands all artefacts on the current branch.
- No remote configured; push step is a no-op.

## 6. ADR shape sketches

### ADR-0025: MVP telephony topology — Asterisk-direct telephony (Asterisk-only)

- **Status:** Accepted (2026-05-15)
- **Decision:** MVP telephony runs as `carrier ↔ Asterisk` direct. No Kamailio SBC; no rtpengine media relay. Asterisk handles SIP signalling, NAT detection, RTP forwarding, and codec handling in-process. Multi-instance Asterisk failover (if needed) via carrier-side DNS SRV pointing at a warm standby; expected failover time ~30 s (vs. S1's 573 ms Kamailio-dispatcher measurement) — acceptable at MVP volume.
- **Consequences:**
  - Positive: ~2 fewer containers, ~200 MB RAM, two fewer config surfaces. No SDP-rewriting failure modes. Lower operational surface area for solo-founder ops.
  - Negative: Single-Asterisk crash = call drops during 5–20 s process restart. Kernel-upgrade / Asterisk-patch deploys require scheduled maintenance windows. No topology hiding (carrier sees Asterisk's public IP directly).
  - Neutral: Per-tenant SRTP termination, if reintroduced, moves into Asterisk's per-call channel logic rather than the SBC tier.
- **Re-introduction trigger:** Move to Kamailio-fronted SBC topology (Kamailio + rtpengine) when **any** holds: (a) concurrent-call volume sustained >300 calls or burst >500 (current S1 PoT validated to ~1000 conc), (b) first HIPAA-tier customer with BAA language requiring sub-second failover, (c) first compliance audit blocked on "N+1 SIP/media plane" posture. Migration is a future planning round; preserved evidence (S1 spike artefacts, Kamailio configs in `infra/kamailio/`) makes the migration a documented diff, not a re-architecture.
- **Alternatives considered:** Kamailio-fronted SBC topology (Kamailio + rtpengine) — rejected for MVP per scale math (~50–300 concurrent at peak, ~5% of single-Asterisk capacity); cost not justified. Carrier-side LB instead of DNS SRV — rejected, requires carrier cooperation.
- **References:** Supersedes the Kamailio-fronted SBC topology framing in `ARCHITECTURE.v0.4.md` §telephony for MVP scope only; Kamailio-fronted SBC topology retained as future-scale appendix.

### ADR-0026: HIPAA-tier deferred from MVP

- **Status:** Accepted (2026-05-15)
- **Decision:** MVP compliance scope is **GDPR + PCI + general security baseline**. HIPAA-tier support is deferred to a future tier. No `hipaa_tier` flag in tenant schema; no column-level encryption for caller_name/caller_number/message; no 7-year audit log retention; no BAA-subprocessor signing; no SRTP-mandatory enforcement.
- **Consequences:**
  - Positive: Removes the AssemblyAI medical-tier sales cycle blocker (already removed by ADR-0013 sub-decision B on 2026-05-15); removes the multi-week BAA signing cycle for KMS / S3 / Temporal Cloud; removes per-tenant KEK provisioning from MVP scope; removes column-level encryption build from MVP.
  - Negative: First HIPAA-tier prospect requires a real schema migration + compliance build before signing. Estimated 4–8 weeks of work depending on retention/encryption scope. The PoT S4 spike's deferred status becomes structurally permanent for MVP.
  - Neutral: GDPR + PCI obligations unchanged; PCI pause spans (PoC Slice 2) remain MVP-baseline.
- **Re-introduction trigger:** Re-introduce HIPAA-tier when **any** holds: (a) first HIPAA-tier prospect with signed BAA intent, (b) >20% of pipeline shows medical/healthcare vertical, (c) regulatory shift requires HIPAA-equivalent treatment of recordings. Migration plan to be designed at trigger time.
- **Predecessor:** ADR-0013 sub-decision B (commit `aac9aeb`) — disabled HIPAA-tier recording; this ADR generalises the scope-out across the rest of the compliance posture.
- **Alternatives considered:** Soft scope-out with dormant `hipaa_tier` column — rejected, YAGNI per CLAUDE.md §2. Full HIPAA-tier build in MVP — rejected per solo-founder pre-revenue cost; vendor cycles ~4–6 weeks each.
- **References:** Amends `compliance_posture.md` memory to mark HIPAA-specific clauses as deferred-to-future-tier; updates `PRD.v2.md` §8.

## 7. Slice decomposition (planner's input)

Decomposition is doc/ADR work — no traditional unit tests. "Tests" are **grep gates** matching the A1–A12 acceptance criteria, same pattern as Chunk 0 gate-closure plan. The planner should produce TDD-style red→green slices where:
- **Red** = the grep gate fails (artefact missing or content not matching).
- **Green** = the grep gate passes after the slice's edits.

Suggested slice boundaries (planner free to reshape):

1. **Slice 1 — Write ADR-0025** (Asterisk-direct edge topology). Owns A1 + A2.
2. **Slice 2 — Write ADR-0026** (HIPAA-tier deferred). Owns A3 + A4.
3. **Slice 3 — Amend ADR-0013** with `### Broader scope (2026-05-15)` cross-reference block. Owns A5.
4. **Slice 4 — Update `ARCHITECTURE.v0.4.md`** topology section. Owns A6. **Anchor discovery is required** — the planner must Read the file first, locate the section discussing telephony edge topology (likely near §2.5 or the S1 row at line 94), and pick an anchor based on actual content. Do NOT prescribe a verbatim `old_string` without reading; the prior planning round had a blocker here.
5. **Slice 5 — Update `RISKS.v0.2.md`**. Owns A7. Same anchor-discovery rule: Read first, then pick.
6. **Slice 6 — Update `PRD.v2.md` §7 + §8**. Owns A8. Same rule. PRD.v2.md is long (500+ lines) — locate §7 / §8 headers first.
7. **Slice 7 — Amend `compliance_posture.md` memory + amend `telephony_decisions.md` memory (add edge-topology section, do NOT rename existing Model A/B tenant-isolation language) + write `plan_mvp_scope_deferral.md` memory + update `MEMORY.md`**. Owns A9 + A11.
8. **Slice 8 — Amend `pot/g0-closed.md`** §S1 + §S4. Owns A10. Read file first; existing §S4 amendment is the supersession pattern to mirror.
9. **Slice 9 — Commit**. Owns A12. Stage **only** these explicit files (no `git add -A` or `git add .`): the two new ADRs, the modified ADR-0013, ARCHITECTURE.v0.4.md, RISKS.v0.2.md, PRD.v2.md, pot/g0-closed.md, both modified memory files, MEMORY.md, the new memory file, plus the spec and plan files themselves (`docs/superpowers/specs/2026-05-15-mvp-scope-deferral-design.md` and `docs/superpowers/plans/2026-05-15-mvp-scope-deferral.md`). Working tree has ~80 unrelated rename-churn files — none of them are in this list.

The planner may collapse / reshape — but each slice must own at least one A-criterion and have an exact grep-gate verification command.

## 8. Risks + open questions for the planner

- **R1** ARCHITECTURE.v0.4.md is the latest; ARCHITECTURE.md / v0.2 / v0.3 are historical. The planner should leave the historical versions untouched. Verify by reading the file headers.
- **R2** RISKS.v0.2.md likewise — RISKS.md is the seed. Same rule.
- **R3** Some docs may have stale "ncall" references being renamed to "tas" (per git status churn). The planner must not bundle the rename-churn into this commit; stage specific files only.
- **R4** ADR-0013's existing 2026-05-15 sub-decision B block was added earlier this session at `aac9aeb`. The new "Broader scope" cross-reference must not collide with or duplicate that block.
- **R5** `pot/g0-closed.md` is dated 2026-05-14 with a 2026-05-15 amendment for S4. A second 2026-05-15 amendment (for Asterisk-direct edge topology) should follow the same pattern: leave the file's top date alone; mark the amended sections inline.
- **R6 (added after verifier round 1)** Edit `old_string` anchors must be verified to exist in the target file before being prescribed. The prior planning round hit a Slice 4 blocker because the prescribed anchor lived in PRD.v2.md, not ARCHITECTURE.v0.4.md. Read each target file with `Read` before drafting any `Edit` block; never prescribe an anchor sight-unseen.
- **R7 (added after verifier round 1)** `telephony_decisions.md` memory uses "Model A / Model B" for **Asterisk tenant isolation** (per-tenant container vs. N-tenants-per-Asterisk). The new ADR-0025 decision is about **edge topology** (carrier ↔ Asterisk direct vs. Kamailio-fronted SBC). These are orthogonal. Slice 7 must amend `telephony_decisions.md` to add the edge-topology decision as a NEW section (§6, after the existing §1–§5) — do NOT rename the existing §2 Model A/B tenant-isolation language. Both decisions live in the same memory file; they describe different axes.
- **R8 (added after verifier round 1)** `MEMORY.md` is the auto-memory index and is loaded into every conversation context. Lines after 200 truncate, so the plan_mvp_scope_deferral.md pointer line must be ≤ ~150 chars in the form `- [Plan: mvp scope deferral](plan_mvp_scope_deferral.md) — <hook ≤80 chars>`.

## 9. Out-of-scope (for downstream planning)

These are the **Chunk 4 implementation** items this plan enables but does not include:

- Move `infra/kamailio/` → `infra/kamailio.deferred/`.
- Move `infra/rtpengine/` → `infra/rtpengine.deferred/`.
- Remove `kamailio` + `rtpengine` services from `infra/docker-compose.yml`.
- Rewrite `infra/asterisk/pjsip.conf` for carrier-direct (auth + IP allow-list).
- Amend `chunk3-smoke` integration test if topology change affects it (likely yes — SIPp currently targets Kamailio).
- Update `Makefile` poc-up / poc-down targets.
- Update `poc/smoke-chunk3.md` runbook.

Chunk 4 is a separate planning round.

## 10. Sign-off checklist

Before this spec is handed to the planner subagent:

- [x] Goal stated in one paragraph.
- [x] Acceptance criteria are grep-gate-able.
- [x] Non-goals explicit.
- [x] Constraints stated.
- [x] ADR shapes sketched (planner can lift verbatim or adjust).
- [x] Slice boundaries suggested (planner free to reshape).
- [x] Risks for planner enumerated.
- [x] Out-of-scope items listed (Chunk 4 boundary clear).

---

*Spec written 2026-05-15. Plan-and-verify cycle begins after user confirmation. Outputs: `docs/adr/0025-telephony-asterisk-direct.md`, `docs/adr/0026-hipaa-tier-deferred.md`, `docs/superpowers/plans/2026-05-15-mvp-scope-deferral.md`, plus amendments to ARCHITECTURE.v0.4.md, RISKS.v0.2.md, PRD.v2.md, compliance_posture.md memory, pot/g0-closed.md, MEMORY.md.*
