# MVP Scope Deferral — Implementation Plan (round 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use checkbox syntax for tracking.

**Goal:** Ratify and document the deferral of (1) HIPAA-tier compliance posture and (2) Kamailio-fronted SBC topology from MVP scope. Two independent ADRs + targeted amendments to five docs + four memory files + one commit.

**Source spec:** [`docs/superpowers/specs/2026-05-15-mvp-scope-deferral-design.md`](../specs/2026-05-15-mvp-scope-deferral-design.md)

**Pre-flight reads completed (round 2):** 10 / 10 — every target file read before any anchor was prescribed.

---

## File map

| File | Action |
|---|---|
| `docs/adr/0025-telephony-asterisk-direct.md` | **Create** |
| `docs/adr/0026-hipaa-tier-deferred.md` | **Create** |
| `docs/adr/0013-redaction-pipeline.md` | **Modify** — append `### Broader scope (2026-05-15)` block |
| `ARCHITECTURE.v0.4.md` | **Modify** — append `### MVP edge topology (2026-05-15 amendment)` to §12 TL;DR |
| `RISKS.v0.2.md` | **Modify** — insert `## 8. MVP edge-topology risk (2026-05-15 amendment)` before Sources |
| `PRD.v2.md` | **Modify** — amend §7.2.3 Asterisk pool note + §8 Compliance Plan |
| `~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/compliance_posture.md` | **Modify** |
| `~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/telephony_decisions.md` | **Modify** — add §6 (edge topology) |
| `~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/plan_mvp_scope_deferral.md` | **Create** |
| `~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/MEMORY.md` | **Modify** |
| `pot/g0-closed.md` | **Modify** — amend §S4 + add edge-topology note to §S1 |
| `docs/superpowers/specs/2026-05-15-mvp-scope-deferral-design.md` | **Stage only** (already exists) |
| `docs/superpowers/plans/2026-05-15-mvp-scope-deferral.md` | **Stage only** (this file) |

---

## TDD convention

All "tests" are grep gates matching A1–A12. Red = gate fails before the slice. Green = gate passes after. Each slice states its Red baseline and passes it after the file write.

---

## Slice 1 — Write ADR-0025 (Asterisk-direct edge topology)

**Owns:** A1, A2

**Red baseline:**
```bash
ls docs/adr/0025-telephony-asterisk-direct.md 2>/dev/null || echo MISSING
# → MISSING
```

- [ ] **Step 1.1: Write `docs/adr/0025-telephony-asterisk-direct.md`**

Create the file with the following complete content (executor copies verbatim):

```markdown
# ADR-0025: MVP telephony topology — Asterisk-direct (carrier ↔ Asterisk, no SBC tier)

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** Founder (solo architect + compliance lead)
- **Supersedes:** Kamailio-fronted SBC topology framing in ARCHITECTURE.v0.4.md §S1 spike hypothesis and PRD.v2.md §7.2.1 for MVP scope only.

## Context

The PoT S1 spike (ARCHITECTURE.v0.4.md §2.5) validated Kamailio + rtpengine + Asterisk at Layer 1 (signalling). The measured failover TTFOK = 573 ms and screen-pop p95 = 2 ms confirmed the topology works, but also revealed that running a full Kamailio-fronted SBC tier adds ~2 containers, ~200 MB RAM, two extra config surfaces, and the SDP-rewriting failure modes — overhead unjustified at MVP scale (20–50 operators per tenant, ~1500 calls/day per tenant, peak concurrent ~50–300 calls total across all MVP tenants).

MVP scale is ~5% of single-Asterisk capacity measured in S1 (which exercised 110 calls in a 10-min window at 2 ms p95 — no Kamailio at all for internal routing). The Kamailio-fronted SBC topology's advantages (sub-second failover, kernel-mode RTP forwarding, topology hiding, carrier-side SBC presentation) are real but do not pay back their operational cost before the re-introduction trigger fires.

This ADR establishes **Asterisk-direct** as MVP-baseline: carrier SIP trunks connect directly to Asterisk; no Kamailio SIP proxy; no rtpengine media relay in the normal call path. Failover, if needed, via carrier-side DNS SRV pointing at a warm standby. The Kamailio-fronted SBC topology is explicitly preserved as the documented production-scale path.

> **Terminology note:** "Asterisk-direct" and "Kamailio-fronted SBC topology" refer to the telephony **edge topology** (which component faces the carrier). This is orthogonal to the Asterisk **tenant-isolation model** (Model A = per-tenant container, Model B = N-tenants per Asterisk with per-tenant context) which is unchanged and documented separately in `telephony_decisions.md` §2.

## Decision

MVP telephony runs as **carrier ↔ Asterisk direct**.

- No Kamailio SBC tier; no rtpengine media relay in the MVP call path.
- Asterisk handles SIP signalling, NAT detection, RTP forwarding, and codec handling in-process via `res_rtp_asterisk`.
- Multi-instance Asterisk failover (if needed) via carrier-side DNS SRV pointing at a warm standby; expected failover time ~30 s (vs. S1's 573 ms Kamailio-dispatcher measurement) — acceptable at MVP volume.
- Existing `infra/kamailio/` and `infra/rtpengine/` directories and compose services are **NOT removed** in this ADR. Physical topology rewire is Chunk 4 scope.

## Consequences

**Positive:**
- ~2 fewer containers per node, ~200 MB RAM saved.
- Two fewer config surfaces (Kamailio `.cfg` + rtpengine `rtpengine.conf`).
- No SDP-rewriting failure modes.
- Simpler pjsip.conf: one trunk pointing at carrier, no internal SIP hop.
- Lower operational surface area for solo-founder ops.

**Negative:**
- Single-Asterisk crash = call drops during the 5–20 s process restart window. Carrier-side DNS SRV warm-standby failover time ~30 s (not 573 ms).
- Kernel-upgrade / Asterisk-patch deploys require scheduled maintenance windows (vs. rolling drain behind Kamailio).
- No topology hiding: carrier sees Asterisk's public IP directly.
- Per-tenant SRTP termination, if reintroduced, moves into Asterisk's per-call channel logic rather than the SBC tier.

**Neutral:**
- PoC `chunk3-smoke` integration test (`apps/api/test/integration/chunk3-smoke.spec.ts`) stays Green at commit `a7c2dac`. Its SIPp scenario targets the current Kamailio endpoint in compose; no change here (Chunk 4 scope).
- The S1 spike artefacts in `pot/S1-telephony-happy-path/` document the Kamailio-fronted topology measurements and are preserved as migration evidence.

## Re-introduction trigger

Move to **Kamailio-fronted SBC topology** (Kamailio + rtpengine) when **any** holds:

- (a) Concurrent-call volume sustained >300 calls or burst >500 (S1 PoT validated Kamailio to ~1000 concurrent).
- (b) First HIPAA-tier customer with BAA language requiring sub-second failover.
- (c) First compliance audit blocked on "N+1 SIP/media plane" posture.

Migration at trigger time is a future planning round. Evidence preserved: S1 spike artefacts (`pot/S1-telephony-happy-path/`), Kamailio configs (`infra/kamailio/`), rtpengine configs (`infra/rtpengine/`).

## Alternatives considered

**Kamailio-fronted SBC topology (Kamailio + rtpengine)** — rejected for MVP per scale math (~50–300 concurrent peak; ~5% of single-Asterisk capacity). Operational overhead not justified pre-revenue.

**Carrier-side load balancer instead of DNS SRV** — rejected; requires carrier cooperation and a second carrier agreement for the standby.

## Status

**Accepted** — 2026-05-15. Founder (solo architect + compliance lead).

## References

- ARCHITECTURE.v0.4.md §2.5 S1 spike outcomes (Kamailio-fronted topology PoT measurement evidence)
- `telephony_decisions.md` §6 (edge-topology memory; added by this ADR's Slice 7)
- ADR-0026 (HIPAA-tier deferral — independent but motivated by the same simplification goal)
- `pot/g0-closed.md` §S1 (edge-topology amendment — added by this ADR's Slice 8)
```

- [ ] **Step 1.2: Verify A1 + A2 (Green)**

```bash
grep -c '\*\*Status:\*\* Accepted' docs/adr/0025-telephony-asterisk-direct.md
# → 1

grep -c 're-introduction trigger\|Re-introduction trigger' docs/adr/0025-telephony-asterisk-direct.md
# → ≥ 1
```

---

## Slice 2 — Write ADR-0026 (HIPAA-tier deferred)

**Owns:** A3, A4

**Red baseline:**
```bash
ls docs/adr/0026-hipaa-tier-deferred.md 2>/dev/null || echo MISSING
# → MISSING
```

- [ ] **Step 2.1: Write `docs/adr/0026-hipaa-tier-deferred.md`**

Create the file with the following complete content (executor copies verbatim):

```markdown
# ADR-0026: HIPAA-tier deferred from MVP

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** Founder (solo architect + compliance lead)
- **Predecessor:** ADR-0013 sub-decision B (commit `aac9aeb`) — disabled HIPAA-tier recording; this ADR generalises the scope-out across the rest of the compliance posture.

## Context

ADR-0013 sub-decision B (2026-05-15, commit `aac9aeb`) disabled recording for HIPAA-tagged tenants in MVP. That decision removed the *consequence* (ML redaction pipeline) but left the *cause* (HIPAA-tier as a first-class MVP concept) in place across the rest of the compliance posture: column-level encryption for caller_name/caller_number/message body, 7-year retention, BAA-subprocessor signing for medical-tier vendors, per-tenant KEK provisioning for HIPAA columns, SRTP-mandatory enforcement per HIPAA tenant, and `hipaa_tier` flag scaffolding in the tenant schema.

Solo-founder MVP, pre-revenue, no HIPAA-tier prospect in the first 5 MVP tenants (confirmed 2026-05-15). The AssemblyAI Universal-3 Pro Medical sales cycle is not in progress. Building HIPAA-tier first-class support now means 4–8 weeks of compliance build (schema migration, BAA vendor cycles, KMS/column encryption, 7-year retention config) with zero immediate-revenue justification.

This ADR resolves the cause: HIPAA-tier support is deferred to a future tier with a named re-introduction trigger.

## Decision

MVP compliance scope is **GDPR + PCI + general security baseline only**.

HIPAA-tier support is deferred. The following items are explicitly **not in MVP scope**:

- `hipaa_tier` flag in the tenant schema (no dormant column — YAGNI per CLAUDE.md §2).
- Column-level encryption for `caller_name` / `caller_number` / `message` body on HIPAA tenants (beyond the existing per-file envelope encryption already in M10).
- 7-year audit log retention (default 90 days applies to all MVP tenants).
- BAA-subprocessor signing for medical-tier vendor SKUs (AssemblyAI Universal-3 Pro Medical, Temporal Cloud Enterprise HIPAA tier).
- SRTP-mandatory enforcement at Kamailio/Asterisk layer for HIPAA-tagged tenants (consistent with ADR-0025: no Kamailio SBC in MVP topology).
- `pseudonymise_until_retention_expires` M26 saga path for HIPAA recordings (moot since recording is disabled for HIPAA tenants per ADR-0013 B).

**What remains unchanged (GDPR + PCI + general security baseline):**

- Per-tenant KEK in AWS KMS / HashiCorp Vault for **recording files** (M10 still encrypts non-HIPAA recordings).
- Operator-initiated PCI pause spans (PoC Slice 2) — unchanged and MVP-baseline.
- GDPR right-to-erasure workflow (PII soft-delete + recording purge + KMS key version deletion).
- Append-only audit log (partitioned, 6+ years retention for non-HIPAA tenants under GDPR).
- TLS 1.2+ everywhere; SRTP/DTLS-SRTP on all non-carrier legs.
- BAA signing with GDPR-scope subprocessors (SIP trunk, SMS, email, cloud storage).

## Consequences

**Positive:**
- Removes the AssemblyAI medical-tier sales cycle blocker (already removed by ADR-0013 B; this ADR makes it structural).
- Removes the multi-week BAA signing cycle for KMS / Temporal Cloud / AssemblyAI from MVP critical path.
- Removes per-tenant KEK provisioning for HIPAA-column encryption from MVP scope.
- Removes column-level encryption build from MVP (significant implementation savings — Postgres pgcrypto or application-layer encryption over individual columns adds schema complexity + index limitations).
- Removes PoT S4 spike from any MVP-scope gate (S4 is now structurally deferred).

**Negative:**
- First HIPAA-tier prospect requires a real schema migration + compliance build before signing. Estimated 4–8 weeks of work depending on retention/encryption scope.
- Cannot onboard a medical answering service customer without first executing the HIPAA-tier build.

**Neutral:**
- GDPR + PCI obligations unchanged; PCI pause spans (PoC Slice 2) remain MVP-baseline.
- Recording on by default for non-HIPAA tenants; M10 encryption + retention unchanged.
- The PoT S4 spike's Deferred-with-fallback-plan status (ARCHITECTURE.v0.4.md §2.5) becomes structurally permanent for MVP.

## Re-introduction trigger

Re-introduce HIPAA-tier when **any** holds:

- (a) First HIPAA-tier prospect with signed BAA intent letter.
- (b) >20% of prospect pipeline shows medical/healthcare vertical.
- (c) Regulatory shift requires HIPAA-equivalent treatment of any recording category.

Migration plan to be designed at trigger time. Estimated work: 4–8 weeks (schema migration, BAA vendor cycles, KMS/column encryption, 7-year retention config, AssemblyAI medical-tier integration). Starting point: ADR-0013 §Decision two-pass pipeline design + PoT S4 spike framework.

## Alternatives considered

**Soft scope-out with dormant `hipaa_tier` column in tenant schema** — rejected, YAGNI per CLAUDE.md §2. A dormant column signals false intent without providing implementation and creates migration entanglement.

**Full HIPAA-tier build in MVP** — rejected per solo-founder pre-revenue cost. Vendor sales cycles: AssemblyAI medical-tier ~1–4 weeks; Temporal Cloud Enterprise BAA ~2–6 weeks. Combined with column encryption + retention config: ~4–8 developer-weeks with zero immediate revenue justification.

**HIPAA-compatible recording without ML redaction (keep recording on, manual QA only)** — rejected per ADR-0013 options analysis. Manual QA is uneconomic at scale; automated redaction on 8 kHz μ-law audio is the only viable path. This path is the re-introduction path; it requires the S4 PoT measurement before committing.

## Status

**Accepted** — 2026-05-15. Founder (solo architect + compliance lead).

## References

- ADR-0013 sub-decision B (commit `aac9aeb`) — predecessor; disabled HIPAA-tier recording
- ADR-0013 `### Broader scope (2026-05-15)` cross-reference block — added by Slice 3 of this plan
- `compliance_posture.md` memory — amended by Slice 7 of this plan to add §Future tier section
- PRD.v2.md §8 Compliance Plan — amended by Slice 6 of this plan
- ARCHITECTURE.v0.4.md §2.5 S4 outcome — PoT S4 structural deferral
```

- [ ] **Step 2.2: Verify A3 + A4 (Green)**

```bash
grep -c '\*\*Status:\*\* Accepted' docs/adr/0026-hipaa-tier-deferred.md
# → 1

grep -c 'ADR-0013\|0013-redaction' docs/adr/0026-hipaa-tier-deferred.md
# → ≥ 1

grep -c 're-introduction\|Re-introduction' docs/adr/0026-hipaa-tier-deferred.md
# → ≥ 1
```

---

## Slice 3 — Amend ADR-0013 with broader-scope cross-reference

**Owns:** A5

**Red baseline:**
```bash
grep -c 'Broader scope (2026-05-15)' docs/adr/0013-redaction-pipeline.md
# → 0
```

**Anchor discovery:**
- File: `docs/adr/0013-redaction-pipeline.md` — 52 lines.
- The file ends with `## Alternatives considered`. The last line (52) is:
  `- **Disable recording for HIPAA tenants.** Removes the operator-quality and dispute-resolution use cases entirely. Rejected: would close off the medical answering service vertical, the largest target market.`
- This exact line is unique in the file (confirmed from Read). The new `## Broader scope (2026-05-15)` section appends after it.
- Constraint: The `### Sub-decision (2026-05-15, G0 closure — supersedes 2026-05-14)` block at lines 23–27 is an existing block — we must NOT collide with it. The new section is at the end, separate from the Sub-decision blocks.

- [ ] **Step 3.1: Append `### Broader scope (2026-05-15)` block to ADR-0013**

Edit `docs/adr/0013-redaction-pipeline.md`:

```
old_string: "- **Disable recording for HIPAA tenants.** Removes the operator-quality and dispute-resolution use cases entirely. Rejected: would close off the medical answering service vertical, the largest target market."

new_string: "- **Disable recording for HIPAA tenants.** Removes the operator-quality and dispute-resolution use cases entirely. Rejected: would close off the medical answering service vertical, the largest target market.

## Broader scope (2026-05-15)

ADR-0013 sub-decision B (this file, commit `aac9aeb`) disabled HIPAA-tier recording, removing the *consequence* (ML redaction pipeline) from MVP scope. **ADR-0026** (created 2026-05-15) generalises the scope-out: the entire HIPAA-tier compliance posture (column encryption, 7-year retention, SRTP-mandatory per-HIPAA-tenant enforcement, BAA vendor cycles for medical SKUs) is deferred from MVP scope. See [`docs/adr/0026-hipaa-tier-deferred.md`](./0026-hipaa-tier-deferred.md) for the full decision, re-introduction trigger, and consequences."
```

- [ ] **Step 3.2: Verify A5 (Green)**

```bash
grep -c 'Broader scope (2026-05-15)' docs/adr/0013-redaction-pipeline.md
# → 1
```

---

## Slice 4 — Update `ARCHITECTURE.v0.4.md`

**Owns:** A6

### Anchor discovery

- File: `ARCHITECTURE.v0.4.md` — **406 lines**.
- Sections:
  - Line 396: `## 12. TL;DR`
  - Line 398: `Three things make v0.4 work, building on v0.3's compliance and telephony spine:`
  - Line 406: Last line of file (end of §12 paragraph).
- Strategy: append a new subsection `### MVP edge topology (2026-05-15 amendment)` at the very end of the file, after the §12 paragraph's last sentence.
- The last sentence of the file (unique, verified from Read output line 406) ends with: `...ratifies as one unit at the G0 meeting.`

The full last sentence is:
`The architecture commits to the adopted fallbacks pending G0 sign-off; the bundle (this §2.5 + the §2.4 amendment + the §3 G1 swap + ADR-0015 rewrite + forensic notes in \`pot/pot-readout.md\` + \`tools/crm-har-to-fixtures/scrape.mjs\`) ratifies as one unit at the G0 meeting.`

This sentence is unique in the file — it's the only sentence mentioning both `§2.5` and `G0 meeting` in proximity. Use the shorter unique substring `ratifies as one unit at the G0 meeting.` as the anchor tail.

- [ ] **Step 4.1: Append MVP edge topology amendment to ARCHITECTURE.v0.4.md**

Edit `ARCHITECTURE.v0.4.md`:

```
old_string: "ratifies as one unit at the G0 meeting."

new_string: "ratifies as one unit at the G0 meeting.

### MVP edge topology (2026-05-15 amendment)

**Decision (ADR-0025):** MVP telephony runs **Asterisk-direct** — carrier SIP trunk connects directly to Asterisk; no Kamailio SBC tier; no rtpengine in the normal call path. The Kamailio-fronted SBC topology (Kamailio + rtpengine) documented in §2.3 S1 spike hypothesis and §6.3 AC #9 is **deferred** to the production-scale path, with a named re-introduction trigger (see ADR-0025).

**Why:** Solo-founder MVP scale (~50–300 concurrent peak) is ~5% of single-Asterisk capacity measured in S1. Kamailio-fronted SBC topology's advantages (sub-second failover, kernel-mode RTP forwarding, topology hiding) do not justify ~2 extra containers + ~200 MB RAM + two config surfaces at this scale.

**Physical rewire:** `infra/kamailio/`, `infra/rtpengine/`, and compose services are **not removed** in this amendment — Chunk 4 scope. `chunk3-smoke` integration test stays Green at commit `a7c2dac` (unchanged topology until Chunk 4).

See ADR-0025 for full decision, consequences, and re-introduction trigger. See ADR-0026 for the companion HIPAA-tier deferral."
```

- [ ] **Step 4.2: Verify A6 (Green)**

```bash
grep -c 'Asterisk-direct\|MVP edge topology\|carrier.*Asterisk.*direct' ARCHITECTURE.v0.4.md
# → ≥ 1

grep -c 'SBC.*deferred\|Kamailio.*deferred\|deferred.*SBC\|deferred.*Kamailio' ARCHITECTURE.v0.4.md
# → ≥ 1

grep -c 'ADR-0025' ARCHITECTURE.v0.4.md
# → ≥ 1
```

---

## Slice 5 — Update `RISKS.v0.2.md`

**Owns:** A7

### Anchor discovery

- File: `RISKS.v0.2.md` — **302 lines**.
- Sections:
  - Line 268: `## 7. Recommended next steps`
  - Line 279: `## Sources`
  - Line 302: `*End of risk assessment v0.2. Update this document as risks are accepted, mitigated, or escalated to ADRs.*`
- Strategy: insert new `## 8. MVP edge-topology risk (2026-05-15 amendment)` section **before** `## Sources`.
- Anchor: `## Sources` appears exactly once in the file (at line 279). This is the insertion point.

- [ ] **Step 5.1: Insert MVP edge-topology risk section before `## Sources`**

Edit `RISKS.v0.2.md`:

```
old_string: "## Sources"

new_string: "## 8. MVP edge-topology risk (2026-05-15 amendment)

**Context:** ADR-0025 (2026-05-15) adopts Asterisk-direct as MVP telephony topology, deferring the Kamailio-fronted SBC topology. This introduces a new risk class not present in the original S1 spike hypothesis (which assumed Kamailio in the path).

### N8. Single-Asterisk crash = call drops during restart window

- **Topology:** Asterisk-direct (no Kamailio dispatcher to drain calls before restart).
- **Impact:** Single-Asterisk crash drops all in-flight calls on that node during the 5–20 s process restart window. With Kamailio-fronted SBC topology, failing calls would have been drained to a warm standby by the Kamailio dispatcher (~573 ms TTFOK per S1 PoT).
- **MVP mitigation:** Carrier-side DNS SRV pointing at a **warm standby** Asterisk instance (~30 s failover). Scheduled maintenance via planned drain (announce ahead, operator console shows pending-maintenance banner). Kubernetes / systemd auto-restart ensures 5–20 s MTTR.
- **Re-introduction trigger:** If failover SLA requirement drops below 30 s (e.g. HIPAA-tier BAA requirement for sub-second failover, or volume >300 concurrent), upgrade to Kamailio-fronted SBC topology per ADR-0025 re-introduction trigger.
- **Severity:** **Medium × Medium** (rare for a well-operated single node; acceptable at pre-revenue MVP scale with stated MTTR).
- **ADR:** ADR-0025. See also `pot/g0-closed.md` §S1 edge-topology amendment.

---

## Sources"
```

- [ ] **Step 5.2: Verify A7 (Green)**

```bash
grep -c 'single.Asterisk\|Asterisk crash\|warm.standby' RISKS.v0.2.md
# → ≥ 1
```

---

## Slice 6 — Update `PRD.v2.md` §7.2.3 + §8

**Owns:** A8

### Anchor discovery

- File: `PRD.v2.md` — **1055 lines**.
- Target sections:
  - Line 504: `#### 7.2.3 Asterisk pool`
  - Line 506: the body paragraph containing `**Model B**` and the `**Note (v2)**` suffix.
  - Line 774: `## 8. Compliance Plan`
  - Line 776: The single-paragraph body of §8.

**Amendment 1 — §7.2.3 anchor:**

The unique substring to anchor on (from the §7.2.3 paragraph, confirmed by grep):
`queue logic is in NestJS, not Asterisk \`Queue()\`; Asterisk holds calls in MOH-playing Stasis bridges while NestJS dequeues.`

This string appears once in PRD.v2.md (line 506 area). We append an amendment note after it.

**Amendment 2 — §8 anchor:**

The §8 paragraph ends with the phrase `...quarterly subprocessor review.` Confirmed unique by grep. We append an amendment note after it.

- [ ] **Step 6.1: Amend §7.2.3 — add Asterisk-direct MVP note**

Edit `PRD.v2.md`:

```
old_string: "queue logic is in NestJS, not Asterisk `Queue()`; Asterisk holds calls in MOH-playing Stasis bridges while NestJS dequeues."

new_string: "queue logic is in NestJS, not Asterisk `Queue()`; Asterisk holds calls in MOH-playing Stasis bridges while NestJS dequeues.

> **Amendment 2026-05-15 (ADR-0025):** MVP edge topology is **Asterisk-direct** — carrier SIP trunk connects directly to Asterisk; the Kamailio SBC tier and rtpengine described in §7.2.1–7.2.2 are **deferred** to the production-scale Kamailio-fronted SBC topology path. `infra/kamailio/` and `infra/rtpengine/` configs are preserved but not active in MVP (Chunk 4 scope). Re-introduction trigger: concurrent volume >300, HIPAA-tier BAA sub-second failover requirement, or compliance-audit SIP/media N+1 posture block. See ADR-0025."
```

- [ ] **Step 6.2: Amend §8 — add HIPAA-tier deferral note**

Edit `PRD.v2.md`:

```
old_string: "Baseline: TLS 1.2+, MFA for admins, audit log, quarterly subprocessor review."

new_string: "Baseline: TLS 1.2+, MFA for admins, audit log, quarterly subprocessor review.

> **Amendment 2026-05-15 (ADR-0026):** **HIPAA-tier support is deferred from MVP.** MVP compliance scope is **GDPR + PCI + general security baseline only**. Items not in MVP scope: `hipaa_tier` tenant flag; column-level encryption for caller_name/caller_number/message body; 7-year retention (default 90 days applies to all MVP tenants); BAA signing for medical-tier vendor SKUs (AssemblyAI Pro Medical, Temporal Cloud Enterprise HIPAA); SRTP-mandatory enforcement per HIPAA tenant; `pseudonymise_until_retention_expires` saga path. GDPR + PCI obligations are unchanged. Re-introduction trigger: first HIPAA-tier prospect with signed BAA intent, >20% healthcare pipeline, or regulatory shift. See ADR-0026 and ADR-0013 §Broader scope (2026-05-15). See also ADR-0025 (Asterisk-direct edge topology)."
```

- [ ] **Step 6.3: Verify A8 (Green)**

```bash
grep -c 'Asterisk-direct\|ADR-0025\|ADR-0026' PRD.v2.md
# → ≥ 2

grep -c 'HIPAA.*deferred\|deferred.*HIPAA' PRD.v2.md
# → ≥ 1
```

---

## Slice 7 — Amend memories + write new plan memory + update MEMORY.md

**Owns:** A9, A11

All paths in this slice use the full absolute path:
`~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/`

### File states verified from Read:

- `compliance_posture.md`: 30 lines. Last line (30) ends with `...B supersession at commit \`aac9aeb\`.`
- `telephony_decisions.md`: 42 lines. Last line (42) is `Full architecture in PRD §7.`
- `MEMORY.md`: 12 lines. Last line (12) is the `feedback_vitest_vs_tsx_runtime.md` pointer.

- [ ] **Step 7.1: Amend `compliance_posture.md` — add §Future tier section**

Edit `~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/compliance_posture.md`:

```
old_string: "Trigger to revisit: first HIPAA-tier prospect with recording requirement. Supersession audit trail in `docs/adr/0013-redaction-pipeline.md` and `pot/g0-closed.md` §S4. Original sub-decision A at commit `c0acf0e`; B supersession at commit `aac9aeb`."

new_string: "Trigger to revisit: first HIPAA-tier prospect with recording requirement. Supersession audit trail in `docs/adr/0013-redaction-pipeline.md` and `pot/g0-closed.md` §S4. Original sub-decision A at commit `c0acf0e`; B supersession at commit `aac9aeb`.

**Future tier — HIPAA deferred (ADR-0026, 2026-05-15):**
The broader HIPAA-tier compliance posture is deferred from MVP scope per ADR-0026. Not in MVP: `hipaa_tier` tenant schema flag; column-level encryption for caller_name/caller_number/message body; 7-year retention (default 90 days); BAA vendor cycles for medical SKUs; SRTP-mandatory enforcement per HIPAA tenant. Re-introduction trigger: first HIPAA-tier prospect with BAA intent, >20% healthcare pipeline, or regulatory shift. Migration is a future planning round; see ADR-0026 for full scope and consequences."
```

- [ ] **Step 7.2: Amend `telephony_decisions.md` — add §6 edge topology (do NOT alter §2 Model A/B)**

Edit `~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/telephony_decisions.md`:

```
old_string: "Full architecture in PRD §7."

new_string: "Full architecture in PRD §7.

**6. Edge topology — Asterisk-direct for MVP, Kamailio-fronted SBC topology deferred.**

Two edge topologies exist (orthogonal to the §2 tenant-isolation model above):
- **Asterisk-direct:** carrier SIP trunk connects directly to Asterisk; no Kamailio SBC tier; no rtpengine in the normal call path. MVP-baseline per ADR-0025 (2026-05-15).
- **Kamailio-fronted SBC topology:** Kamailio + rtpengine front Asterisk. Production-scale path; deferred from MVP.

**Why Asterisk-direct for MVP:** Solo-founder pre-revenue MVP scale (~50–300 concurrent peak) is ~5% of single-Asterisk capacity. Kamailio-fronted topology benefits (sub-second failover, kernel-mode RTP, topology hiding) do not justify ~2 extra containers + ~200 MB RAM at this scale.

**How to apply:** pjsip.conf defines a carrier trunk pointing directly at the SIP carrier (no internal Kamailio hop). `infra/kamailio/` and `infra/rtpengine/` configs are preserved for the future migration (Chunk 4 scope).

**Re-introduction trigger (ADR-0025):** concurrent volume sustained >300, HIPAA-tier BAA sub-second failover requirement, or compliance-audit SIP/media N+1 posture block.

> **Important:** §2 above (Model A/B tenant isolation) is a separate, orthogonal decision about how many tenants share an Asterisk process. Both decisions are in effect simultaneously: MVP uses Asterisk-direct edge topology (§6) with Model B tenant isolation (§2)."
```

- [ ] **Step 7.3: Create `plan_mvp_scope_deferral.md`**

Write `~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/plan_mvp_scope_deferral.md` with the following content:

```markdown
---
name: plan-mvp-scope-deferral
description: ADR-0025 (Asterisk-direct edge topology) + ADR-0026 (HIPAA-tier deferred) — decision ratification + doc amendments, 2026-05-15
metadata:
  node_type: memory
  type: project
  originSessionId: plan-2026-05-15
---

Plan executed 2026-05-15 on branch `sprint-0/temporal-selfhost-baseline`. Ratified two scope-deferral decisions:

1. **ADR-0025 — Asterisk-direct edge topology (MVP):** carrier SIP trunk connects directly to Asterisk; Kamailio-fronted SBC topology deferred. Re-introduction trigger: >300 concurrent, HIPAA-tier BAA sub-second failover, or compliance-audit N+1 SIP/media block.

2. **ADR-0026 — HIPAA-tier deferred from MVP:** MVP compliance = GDPR + PCI + general security baseline. No hipaa_tier flag; no column encryption; no 7-year retention; no medical BAA vendor cycles. Re-introduction trigger: first HIPAA-tier prospect with BAA intent, >20% healthcare pipeline, or regulatory shift.

**Files produced:** `docs/adr/0025-telephony-asterisk-direct.md`, `docs/adr/0026-hipaa-tier-deferred.md`, plus amendments to `docs/adr/0013-redaction-pipeline.md`, `ARCHITECTURE.v0.4.md`, `RISKS.v0.2.md`, `PRD.v2.md`, `pot/g0-closed.md`, `compliance_posture.md`, `telephony_decisions.md`.

**Physical rewire (infra/kamailio, infra/rtpengine, pjsip.conf):** Chunk 4 scope — NOT in this plan.
```

- [ ] **Step 7.4: Update `MEMORY.md` — add pointer line**

Edit `~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/MEMORY.md`:

```
old_string: "- [Feedback: vitest vs tsx runtime](feedback_vitest_vs_tsx_runtime.md) — unit tests passing ≠ api boots; 3 latent bug classes that only surface under tsx (circular imports, missing decoratorMetadata, container SIGCHLD)"

new_string: "- [Feedback: vitest vs tsx runtime](feedback_vitest_vs_tsx_runtime.md) — unit tests passing ≠ api boots; 3 latent bug classes that only surface under tsx (circular imports, missing decoratorMetadata, container SIGCHLD)
- [Plan: mvp scope deferral](plan_mvp_scope_deferral.md) — ADR-0025 Asterisk-direct + ADR-0026 HIPAA-tier deferred; Chunk 4 does physical rewire"
```

- [ ] **Step 7.5: Verify A9 + A11 (Green)**

```bash
grep -c 'Future tier\|future tier\|HIPAA.*deferred' \
  ~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/compliance_posture.md
# → ≥ 1

test -f ~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/plan_mvp_scope_deferral.md && \
  grep -c 'plan_mvp_scope_deferral' \
  ~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/MEMORY.md
# → 1
```

---

## Slice 8 — Amend `pot/g0-closed.md`

**Owns:** A10

### Anchor discovery

- File: `pot/g0-closed.md` — **64 lines**.
- Sections:
  - Line 16: `## Per-Deferred-spike sub-decisions`
  - Line 18: `### S4 — Redaction accuracy`
  - Line 19: `- **Status:** De-scoped — HIPAA-tier recording disabled for MVP _(amended 2026-05-15, supersedes 2026-05-14)_`
  - Line 44: `## S1 Layer-2 — user-deferred carry-over`
  - Line 49 (last line of §S1 section before blank): `- **Path to closure:** Run \`pot/S1-telephony-happy-path/\` smoke on a Linux host...`
  - Line 51: `## Signatures`
- Existing §S4 amendment pattern: ` _(amended 2026-05-15, supersedes 2026-05-14)_` suffix — we ADD to this line's status, making it additive.

**Amendment 1 — §S4 status line:** append ADR-0026 cross-reference.

Verified unique anchor: `- **Status:** De-scoped — HIPAA-tier recording disabled for MVP _(amended 2026-05-15, supersedes 2026-05-14)_`

**Amendment 2 — §S1 section:** add edge-topology note after the "Path to closure" line.

Verified unique anchor (last content line of §S1, line 49):
`- **Path to closure:** Run \`pot/S1-telephony-happy-path/\` smoke on a Linux host (local VM or CI). Commit the readout under \`pot/S1-telephony-happy-path/results/<ISO>-linux-layer2.md\` and update this section to "Green" with cite. Until that point, Chunk 3 is blocked.`

- [ ] **Step 8.1: Amend §S4 status line**

Edit `pot/g0-closed.md`:

```
old_string: "- **Status:** De-scoped — HIPAA-tier recording disabled for MVP _(amended 2026-05-15, supersedes 2026-05-14)_"

new_string: "- **Status:** De-scoped — HIPAA-tier recording disabled for MVP _(amended 2026-05-15, supersedes 2026-05-14)_; broader HIPAA-tier scope-out ratified per ADR-0026 (2026-05-15)"
```

- [ ] **Step 8.2: Add edge-topology note to §S1 section**

Edit `pot/g0-closed.md`:

```
old_string: "- **Path to closure:** Run `pot/S1-telephony-happy-path/` smoke on a Linux host (local VM or CI). Commit the readout under `pot/S1-telephony-happy-path/results/<ISO>-linux-layer2.md` and update this section to \"Green\" with cite. Until that point, Chunk 3 is blocked."

new_string: "- **Path to closure:** Run `pot/S1-telephony-happy-path/` smoke on a Linux host (local VM or CI). Commit the readout under `pot/S1-telephony-happy-path/results/<ISO>-linux-layer2.md` and update this section to \"Green\" with cite. Until that point, Chunk 3 is blocked.
- **Edge-topology note (2026-05-15):** ADR-0025 adopts **Asterisk-direct telephony** as MVP-baseline, deferring the Kamailio-fronted SBC topology. The S1 PoT measurement evidence (573 ms TTFOK, 2 ms screen-pop p95) is preserved as migration evidence for the future production-scale topology. **Layer-2 rtpengine media smoke is moot for MVP** under Asterisk-direct topology (no rtpengine in the call path); Chunk 3 was Green at `a7c2dac` without Layer-2 evidence. The Layer-2 carry-over remains documented as evidence required when the Kamailio-fronted SBC topology is re-introduced — until that trigger, MVP work is not gated on it. See ADR-0025."
```

- [ ] **Step 8.3: Verify A10 (Green)**

```bash
grep -c 'Asterisk-direct telephony\|ADR-0025\|ADR-0026' pot/g0-closed.md
# → ≥ 2
```

---

## Slice 9 — Commit

**Owns:** A12

- [ ] **Step 9.1: Red baseline**

```bash
git log --oneline -1
# → should show the pre-plan commit (a7c2dac or similar), NOT a scope-deferral commit
```

- [ ] **Step 9.2: Stage explicit files only (no `git add -A` / `git add .`)**

```bash
git add docs/adr/0025-telephony-asterisk-direct.md
git add docs/adr/0026-hipaa-tier-deferred.md
git add docs/adr/0013-redaction-pipeline.md
git add ARCHITECTURE.v0.4.md
git add RISKS.v0.2.md
git add PRD.v2.md
git add pot/g0-closed.md
git add ~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/compliance_posture.md
git add ~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/telephony_decisions.md
git add ~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/plan_mvp_scope_deferral.md
git add ~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/MEMORY.md
git add docs/superpowers/specs/2026-05-15-mvp-scope-deferral-design.md
git add docs/superpowers/plans/2026-05-15-mvp-scope-deferral.md
```

- [ ] **Step 9.3: Verify staged diff**

```bash
git diff --staged --stat
# Expected: 13 files changed (2 new ADRs + 11 modified/created files)
```

- [ ] **Step 9.4: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(adr): ratify ADR-0025 Asterisk-direct + ADR-0026 HIPAA-tier deferred — MVP scope deferral

- ADR-0025: Asterisk-direct edge topology as MVP-baseline; Kamailio-fronted SBC
  topology deferred (re-introduction trigger: >300 concurrent, HIPAA BAA sub-second
  failover, or compliance-audit N+1 SIP/media block). Physical rewire is Chunk 4 scope.
- ADR-0026: HIPAA-tier compliance posture deferred from MVP; scope = GDPR + PCI +
  general security baseline. Re-introduction trigger: first HIPAA-tier prospect with
  BAA intent, >20% healthcare pipeline, or regulatory shift.
- ADR-0013: append Broader scope (2026-05-15) cross-reference to ADR-0026.
- ARCHITECTURE.v0.4.md §12, RISKS.v0.2.md §8, PRD.v2.md §7.2.3 + §8: amendments.
- pot/g0-closed.md §S4 + §S1: ADR-0025/0026 cross-references.
- memory: compliance_posture.md Future tier; telephony_decisions.md §6 edge topology;
  plan_mvp_scope_deferral.md new; MEMORY.md pointer added.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9.5: Verify A12 (Green)**

```bash
git log --oneline -1 | grep -E 'mvp-scope-deferral|MVP scope deferral'
# → should match
```

---

## Full A1–A12 verification sweep (run after all slices complete)

```bash
# A1
grep -c '\*\*Status:\*\* Accepted' docs/adr/0025-telephony-asterisk-direct.md
# → 1

# A2
grep -c 're-introduction trigger\|Re-introduction trigger' docs/adr/0025-telephony-asterisk-direct.md
# → ≥ 1

# A3
grep -c '\*\*Status:\*\* Accepted' docs/adr/0026-hipaa-tier-deferred.md
# → 1

# A4a
grep -c 'ADR-0013\|0013-redaction' docs/adr/0026-hipaa-tier-deferred.md
# → ≥ 1

# A4b
grep -c 're-introduction\|Re-introduction' docs/adr/0026-hipaa-tier-deferred.md
# → ≥ 1

# A5
grep -c 'Broader scope (2026-05-15)' docs/adr/0013-redaction-pipeline.md
# → 1

# A6a
grep -c 'Asterisk-direct\|MVP edge topology\|carrier.*Asterisk.*direct' ARCHITECTURE.v0.4.md
# → ≥ 1

# A6b
grep -c 'SBC.*deferred\|Kamailio.*deferred\|deferred.*SBC\|deferred.*Kamailio' ARCHITECTURE.v0.4.md
# → ≥ 1

# A6c
grep -c 'ADR-0025' ARCHITECTURE.v0.4.md
# → ≥ 1

# A7
grep -c 'single.Asterisk\|Asterisk crash\|warm.standby' RISKS.v0.2.md
# → ≥ 1

# A8a
grep -c 'Asterisk-direct\|ADR-0025\|ADR-0026' PRD.v2.md
# → ≥ 2

# A8b
grep -c 'HIPAA.*deferred\|deferred.*HIPAA' PRD.v2.md
# → ≥ 1

# A9
grep -c 'Future tier\|future tier\|HIPAA.*deferred' \
  ~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/compliance_posture.md
# → ≥ 1

# A10
grep -c 'Asterisk-direct telephony\|ADR-0025\|ADR-0026' pot/g0-closed.md
# → ≥ 2

# A11
test -f ~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/plan_mvp_scope_deferral.md && \
  grep -c 'plan_mvp_scope_deferral' \
  ~/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/MEMORY.md
# → 1

# A12
git log --oneline -1 | grep -E 'mvp-scope-deferral|MVP scope deferral'
# → match
```

---

## Self-review checklist (for the engineer driving execution)

- [ ] Did not use `git add -A` or `git add .` — only 13 explicit files staged.
- [ ] `telephony_decisions.md` §2 (Model A/B tenant isolation) is unchanged — only §6 appended at end.
- [ ] `compliance_posture.md` existing MVP scope note (lines 26–29) is intact — §Future tier appended, not replacing.
- [ ] ADR-0013 `### Sub-decision (2026-05-15, G0 closure — supersedes 2026-05-14)` block at line 23 is untouched — `## Broader scope (2026-05-15)` is a separate section appended at the end.
- [ ] `pot/g0-closed.md` §S4 amendment is additive — status suffix appended, existing text preserved.
- [ ] MEMORY.md pointer line is ≤ 150 chars: 143 chars (within budget).
- [ ] No `.deferred/` directories moved — Chunk 4 scope, non-goal confirmed.
- [ ] `PRD.md` (v1.0 seed) untouched — frozen for provenance.
- [ ] `ARCHITECTURE.md`, `ARCHITECTURE.v0.2.md`, `ARCHITECTURE.v0.3.md` untouched — historical versions left alone.

---

*Plan written 2026-05-15 (round 2, post-verifier critique). Source spec: `docs/superpowers/specs/2026-05-15-mvp-scope-deferral-design.md`. Effort estimate: 45–90 minutes (doc work only). No application code changes.*
