# G0 closed — Sprint-0 gate closure

- **Date:** 2026-05-14
- **Phase transitioning:** Phase 0 (PoT) → Phase 1 (PoC tracer-bullet)
- **Closer:** Founder, acting as senior architect + compliance lead (solo)
- **Source proposal:** [`pot/g0-signoff-proposal.md`](./g0-signoff-proposal.md)

## Path decision

**G0 enum path:** Path B — Pragmatic (extends enum with Deferred-with-fallback-plan)

Rationale: `pot/g0-signoff-proposal.md` §Path B documents that a solo-founder PoT cannot absorb a 6–12 calendar-week vendor/data acquisition cycle (S4 medical-ASR key + fixtures, S6 live TAS sandbox, S7 Temporal BAA correspondence) before MVP kickoff. Path A's cost is calendar-blocking with no compensating reduction in hazard exposure — the three Deferred spikes' hazards are characterised in `pot-readout.md`; the missing piece is whether the deployed system handles them, which Phase 0 structurally cannot answer for vendor-blocked spikes. Path B closes G0 by adopting documented fallbacks for S6 and S7 as MVP-baseline, carving S4 out for an explicit Sprint-0 compliance re-decision, and extending the gate enum with "Deferred-with-fallback-plan" per ARCH §2.4 amendment at commit `b948a9e`. This is consistent with the solo-founder operating constraint: no staffing redundancy means calendar-blocked spikes cannot run in parallel with other Sprint-0 work, and delaying MVP construction for vendor cycles is economically indefensible.

## Per-Deferred-spike sub-decisions

### S4 — Redaction accuracy

- **Status:** De-scoped — HIPAA-tier recording disabled for MVP _(amended 2026-05-15, supersedes 2026-05-14)_
- **ADR ratification:** ADR-0013 at Status: Accepted. Current sub-decision is **B — de-scope HIPAA-tier recording from MVP** (recorded 2026-05-15); see [`docs/adr/0013-redaction-pipeline.md` §Sub-decision (2026-05-15)](../docs/adr/0013-redaction-pipeline.md). The original 2026-05-14 ratification at commit `c0acf0e` adopted sub-decision A (full two-pass pipeline) and is retained in the ADR for audit trail. The 2026-05-15 supersession reflects confirmation that the AssemblyAI medical-tier sales cycle is not in progress and no HIPAA-tier tenant is in the first 5 MVP customers.
- **PoC implication:** ML redaction pipeline is **not** in PoC tracer-bullet (PoC §5.2 cut) **and not in MVP**. MVP tenants flagged `hipaa_tier=true` have `recording_enabled=false` by default; non-HIPAA tenants record without ML redaction. Operator-initiated PCI pause spans (PoC Slice 2) remain the only audio-level safeguard. Revisit post-MVP if HIPAA-tier demand justifies AssemblyAI investment.

### S6 — TAS fixture capture

- **Status:** Deferred with trigger rule
- **Trigger:** If `/v1/Account/:id` controller in Chunk 2 of the chunk-plan requires a recorded CRM fixture response to pass its unit tests, assign S6 cache-scraper stub work to Chunk 2 scope. Otherwise S6 stays unowned for the PoC.
- **PoC implication:** No PoC scenario requires a CRM fixture round-trip; S6 surface is unlikely to trigger before MVP Sprint 4–11.

### S7 — Temporal BAA / self-host baseline

- **Status:** Accepted (self-host baseline) + Cloud-side disposition resolved
- **Self-host evidence:** `docs/adr/0015-selfhost-baseline-log.md` + `docs/adr/0015-sdk-identity-evidence.md`.
- **Cloud-side disposition:** Deferred — see [`docs/adr/0015-cloud-sdk-deferred.md`](../docs/adr/0015-cloud-sdk-deferred.md) (commit `7c97415`). Self-host SDK identity check is complete and Green; Cloud-side check deferred until a Temporal Cloud sandbox is provisioned. Fallback plan: trust Temporal's published portability guarantee; first MVP Cloud tenant triggers the full Cloud-side smoke.

## Q1-Q3 architectural ratifications (PoC spec §10)

| # | Decision | Choice | Source |
|---|---|---|---|
| Q1 | Workspace tool | **pnpm workspaces** (no Nx, no Turbo) | PoC §10 Q1 |
| Q2 | Operator UI framework | **Next.js App Router** | PoC §10 Q2 |
| Q3 | Postgres ORM | **Drizzle** | PoC §10 Q3 |

These ratifications are the durable architectural commitments for MVP build-out.

## S1 Layer-2 — user-deferred carry-over

- **Status:** Pending (user-deferred to be executed on a user-controlled Linux host)
- **Trigger:** Must be Green before Chunk 3 commit 1 of the MVP chunk-plan (Chunk 3 wires telephony and exercises media path via SIPp INVITE; without S1-Layer-2 evidence, Chunk 3 integration test cannot pass).
- **Chunk 1 + Chunk 2 dependency:** None — those chunks do not exercise the media path; rtpengine container coming up is sufficient for compose healthchecks.
- **Path to closure:** Run `pot/S1-telephony-happy-path/` smoke on a Linux host (local VM or CI). Commit the readout under `pot/S1-telephony-happy-path/results/<ISO>-linux-layer2.md` and update this section to "Green" with cite. Until that point, Chunk 3 is blocked.

## Signatures

- Architect: Founder (solo) — 2026-05-14
- Compliance lead: Founder (solo) — 2026-05-14

## Status marker (for grep gates)

G0 closed.

---

## Next chunk

The MVP chunk-plan ([`docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md`](../docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md)) Chunk 1 (monorepo skeleton + infra compose) is unblocked by this document.
