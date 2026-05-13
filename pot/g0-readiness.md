# PoT Phase 0 — G0 readiness snapshot (2026-05-13)

> Point-in-time snapshot at end of the 2026-05-13 PoT session, after S8 ratification and the S7 deferral commits landed. Use this to drive G0 sign-off decisions or the Sprint-0 plan.

## TL;DR

**Five of eight spikes are Green and ratified.** Three are Deferred-Blocked on vendor dependencies (S4: AssemblyAI medical key + telephony fixture corpus; S6: live nCall instance access + CRM-consumed-endpoint inventory; S7: Temporal sales letter). No spike remains genuinely unstarted.

ARCHITECTURE v0.4 §2.4 declares G0 closeable only when "All 8 spikes Green, or any Yellow has a written remediation plan signed by the senior architect + the spike's owner + the on-call compliance lead. **Red blocks MVP kickoff.**" The gate enum does not include "Deferred" — so G0 cannot close cleanly today; Sprint 0 must either land the vendor dependencies, adopt documented fallbacks, or expand the gate enum with senior-architect + compliance-lead sign-off.

Two ADRs were amended-then-ratified this session (ADR-0016 from S3 findings; ADR-0019 from S8 findings). Five ADRs remain Proposed pending the Deferred + unstarted spikes (ADR-0013, ADR-0015) or have no PoT dependency listed yet (ADR-0018 already ratified via S5; ADR-0024 already ratified via S2).

## Per-spike status matrix

| # | Spike | Status | Tag | Branch | Primary ADR | Evidence dir | Headline finding |
|---|---|---|---|---|---|---|---|
| S1 | End-to-end telephony happy path (Layer 1) | **Green** | `pot/S1` | `pot/S1-telephony-happy-path` | — | `pot/S1-telephony-happy-path/results/20260513T061347Z/` | screen-pop p95 = 2 ms vs 800 ms budget (400× margin); failover TTFOK = 573 ms vs 30 s (52×); 0 zombies. Layer 2 (rtpengine media smoke) deferred to Sprint 0. |
| S2 | NestJS-arbitrated queue dequeue latency | **Green** | `pot/S2` | `pot/S2-queue-dequeue-latency` | ADR-0024 | `pot/S2-queue-dequeue-latency/results/20260513T042757Z/` | p95 = 6 ms vs 200 ms (33×). ADR-0024 ratified. |
| S3 | ARI leader 100 ms hard-stop | **Green** | `pot/S3` | `pot/S3-ari-leader-hard-stop` | ADR-0016 | `pot/S3-ari-leader-hard-stop/results/20260513T052041Z/` | Wire close 1 ms vs 100 ms; reconcile 1474 ms vs 7 s. **Two ADR-0016 findings amended**: TTL > HB (3:1 ratio), Asterisk accepts multi-WS. Ratified. |
| S4 | Two-pass redaction accuracy on 8 kHz μ-law | **Deferred** | — | `pot/S4-redaction-accuracy` | ADR-0013 | empty | Blocked: AssemblyAI Universal-3 Pro Medical key + 30 annotated telephony fixtures. Synthesis erases the exact hazard ADR names. |
| S5 | Supavisor `SET LOCAL` parity | **Green** | `pot/S5` | `pot/S5-supavisor-set-local` | ADR-0018 | `pot/S5-supavisor-set-local/results/20260513T033050Z/` | Same backend pid across transactions; no leak across COMMIT. Ratified. |
| S6 | `/v1` byte-for-byte fixture capture | **Deferred** | — | `pot/S6-ncall-fixture-capture` | (none — feeds M25 module) | empty | Blocked: live nCall instance access + CRM-consumed-endpoint inventory. Synthesis erases the hazard (unknown spec/reality deviation). Yellow fallback documented (scrape existing CRM cache). |
| S7 | Temporal Cloud BAA + EU namespace | **Deferred** | — | `pot/S7-temporal-baa` (current branch) | ADR-0015 | empty | Sales/legal correspondence — 2–6 week cycle, not initiated. Self-host fallback documented in ADR-0015. |
| S8 | Caddy 2.10+ permission + LE rate-limit | **Green** | `pot/S8` | `pot/S8-caddy-le-posture` | ADR-0019 | `pot/S8-caddy-le-posture/results/20260513T093513Z/` | HAProxy dreq 58 193/59 597; 0 cert files written for 59 k declined. **Three ADR-0019 findings amended**: Caddy LRU claim false (storage short-circuit is the real mechanism); permission endpoint is layer 2; threshold tunability footnote. Ratified. |

## Per-ADR ratification matrix

| ADR | Subject | PoT spike | ADR Status | Ratification path |
|---|---|---|---|---|
| ADR-0013 | Two-pass redaction pipeline | S4 (Deferred) | Proposed | Sprint 0: land prereqs + execute, OR de-scope ADR-0013 (skip recording on HIPAA tenants OR accept manual-QA-only redaction). Senior architect + compliance lead sign-off required. |
| ADR-0015 | Temporal Cloud Enterprise tier | S7 (Deferred) | Proposed | Sprint 0: receive sales letter + ratify with EU-residency clause, OR rewrite Decision to self-host fallback (Helm v1.0.0 on EU-residency K8s, +0.5–1 FTE platform-eng) and ratify the fallback. |
| ADR-0016 | ARI leader design | S3 (Green) | **Accepted** (ratified `8d0bdf3`) | — |
| ADR-0018 | Supavisor pooling | S5 (Green) | **Accepted** (ratified `6a1507c`) | — |
| ADR-0019 | Caddy 2.10+ LE posture | S8 (Green) | **Accepted** (ratified `03b3a9d`) | — |
| ADR-0024 | Queue dequeue budget | S2 (Green) | **Accepted** (ratified `7c6687f`) | — |

## What Sprint 0 must complete to declare G0

### Vendor / correspondence (the four blocking items)

1. **S1 Layer 2** (rtpengine media smoke) — deferred from S1 by user decision 2026-05-13. ~4 h work + ~6 expected scaffold bugs (macOS-fragile). Not blocking G0 directly; risk-reduction for media-path before MVP.
2. **S4 prereqs OR de-scope** — AssemblyAI Universal-3 Pro Medical key + 30 annotated telephony fixtures with documented PII spans. Alternative: rewrite ADR-0013 to remove the ML pipeline.
3. **S7 prereqs OR fallback** — Either initiate Temporal sales contact + receive BAA letter (2–6 weeks), or adopt the documented self-host fallback in ADR-0015 (+0.5–1 FTE platform-eng).
4. **S6 prereqs OR fallback** — Either get a live nCall test tenant (vendor or existing tenant with read-only user), or scrape the existing CRM's response cache (lower fidelity, kept as the documented Yellow remediation in the spike README).

### G0 enum problem

ARCH v0.4 §2.4 enumerates Green / Yellow-with-remediation / Red. "Deferred" is not on that list. Sprint 0 needs an explicit decision from the senior architect + compliance lead on how Deferred maps onto the enum. Two clean paths:

- **Path A — Strict reading.** "Deferred" = Red until prereqs land. G0 cannot close until S4 + S7 + S6 are all resolved one way or another. Realistic if Sprint 0 can absorb the sales/legal cycle in calendar time.
- **Path B — Pragmatic reading.** Extend the enum to "Deferred-with-fallback-plan" alongside Yellow. Each Deferred spike has a documented fallback (S4: manual-QA-only redaction; S7: self-host Temporal; S6: cache scrape). G0 closes when each Deferred spike's fallback is signed off as acceptable for MVP, with the live-vendor path either landed or explicitly tracked as a Sprint-N upgrade.

Recommendation: surface this choice to the senior architect + compliance lead at the next G0 readiness review. The bookkeeping cost of either path is small; making the choice early is what matters.

### Tag matrix

All five Green spikes are tagged. Sprint-0 work that converts a Deferred spike to Green should add the tag at the readout commit (matching the S2/S3/S5/S1/S8 timing).

## Outstanding risks Phase 0 *did not* kill

Spikes are scoped to the named hazard; some risks were out of scope for Phase 0 and need explicit handling in Sprint 0 or later:

- **rtpengine media smoke** (S1 Layer 2) — signalling is Green but media-path is unverified. Macroservice-fragile on macOS hosts; Linux verification at Sprint-0.
- **Permission-endpoint scaling at production volume** (S8 surfaced) — PoT validated ~1000/sec on a single-process Python `ThreadingHTTPServer`. Production needs horizontal scaling + Redis-backed declined-domain rate-limiter (now baseline in ADR-0019 §Decision item 3).
- **HAProxy SNI rate-limit at the production 1000/sec threshold on Linux** (S8 surfaced) — validated mechanism at 800/sec on macOS Docker; need a Linux re-test to confirm identical behaviour at the production number.
- **Temporal SDK code identity between Cloud and self-host paths** (S7 surfaced) — claimed in ADR-0015 but not validated. Sprint 0 should write the smallest workflow that compiles + runs against both paths to confirm.

## Commit chain (forensic trail for this session)

Branch chain off `main`: pot/scaffold? → S5 → S2 → S3 → S1 → S4 → S8 → S7 → S6 (current).

Five ADR ratifications landed in this session: 0018 (S5), 0024 (S2), 0016 (S3, with two text amendments), 0019 (S8, with three text amendments).

Two pending ratifications: 0013 (S4) and 0015 (S7), both gated on Sprint-0 prereq landing or fallback adoption.

No tags in `main` yet; merging the spike chain into `main` and deleting the spike directories per the G0 protocol is Sprint-0 work.

---

*Last updated 2026-05-13 by the session that closed out S8 and deferred S7 + S6. Update inline as Sprint-0 decisions land.*
