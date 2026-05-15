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
