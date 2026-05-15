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
