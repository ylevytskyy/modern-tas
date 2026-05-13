# ADR-0019: Caddy 2.10+ on-demand TLS posture + LE rate-limit exemption

- **Status:** Proposed
- **Date:** 2026-05-12
- **Deciders:** SRE
- **Consulted:** Senior architect, Security eng
- **Informed:** Platform team

## Context

Multi-tenant SaaS that supports tenant-custom domains (e.g., `support.acme.com` CNAMEd to our edge) needs on-demand TLS issuance — Caddy's `on_demand_tls` is the standard mechanism. Two known failure modes:

1. **certmagic #174** — Caddy can hit the storage backend on every request for declined domains, effectively self-DDoSing storage when scanned by SNI probes. Mitigation requires the `permission http` endpoint to be checked **before** the storage lookup; whether that ordering holds in all Caddy versions/configurations is community-debated.
2. **Let's Encrypt rate limits** — the public ACME endpoint enforces 50 certificates per registered domain per week and 300 new orders per account per 3 h. A SaaS at scale exceeds these; ISRG offers a rate-limit exemption application with a 2–4 week turnaround.

RISKS v0.2 §4 flags both. Either failure can degrade the entire tenant-domain feature, or worse, take the edge offline.

## Decision

1. Run **Caddy 2.10+** with `on_demand_tls.ask` pointing at our `permission http` endpoint. The endpoint returns 200 only for tenant-confirmed domains; everything else gets 403, which Caddy LRU-caches as declined.
2. Front Caddy with **HAProxy 3.0** rate-limiting unknown SNI to 1k/sec/source — trips before storage thrash even if Caddy LRU misses.
3. Submit the ISRG rate-limit exemption application before Sprint 8 (when custom domains first ship). 2–4 week turnaround is acceptable.

## Consequences

- **Positive:** Defence in depth — three independent layers (HAProxy rate limit, Caddy LRU, ISRG exemption) each fail independently. Custom-domain feature ships unblocked.
- **Negative / cost:** HAProxy adds another network hop. Tuning the LRU + permission cache requires monitoring. ISRG exemption requires writing a defensible production-volume justification.
- **Neutral:** Caddy 2.10+ is the current stable; pinning is conservative.

## Evidence

PoT spike S8 ran 2026-05-13 against Caddy 2.10.2 + HAProxy 3.0.6 — see [`pot/S8-caddy-le-posture/results/20260513T093513Z/`](../../pot/S8-caddy-le-posture/results/20260513T093513Z/) and [`pot/pot-readout.md` §S8](../../pot/pot-readout.md). Headline:

- **Scenario A (k6 → HAProxy → Caddy, 60 s @ 1000 req/s):** HAProxy rejected 58 193 / 59 597 connections (97.6 %) once unknown-SNI rate exceeded the rate-limit threshold; only 813 connections reached Caddy. Caddy storage delta: +3 files (1 cert for the known SNI + 2 PKI authority artifacts; **zero** certs for the 812 leaked unknown SNIs).
- **Scenario B (k6 → Caddy direct, 60 s @ ~994 req/s, HAProxy bypassed):** 59 243 permission decisions for 51 distinct SNIs; Caddy storage delta = 0 new files.
- Storage-thrash hazard (certmagic #174) is **killed** in both scenarios.

**Three findings the spike surfaces against this ADR's text** — these need to land before Status flips Proposed → Accepted (same pattern as S3 → ADR-0016):

1. **§Decision item 1 — "Caddy LRU-caches as declined" is false** on Caddy 2.10.2. Confirmed against Caddy docs: the `ask` directive is even deprecated in favour of `permission http`, and neither is documented to cache `ask` decisions. Empirical evidence: 59 243 permission decisions for 51 distinct SNIs in scenario B = `ask` is called per TLS handshake, not per distinct SNI. The actual mechanism mitigating the storage-thrash hazard is **Caddy short-circuiting storage I/O on non-2xx ask response** — declined-SNI requests never reach certmagic's `LoadCertificate`. Decision §1 needs rewording to describe storage short-circuit, not LRU.
2. **§Consequences — "Caddy LRU" is not one of the three defence layers.** The actual defence-in-depth is (a) HAProxy SNI rate-limit, (b) **permission endpoint allow-list**, (c) Caddy storage short-circuit on non-2xx ask. Layer (b) needs to be re-attributed from Caddy to the permission endpoint, with a sentence on the endpoint's own scaling posture (absorbed ~1000/s here without degradation; Redis-backed rate-limit at this tier is the suggested mitigation for higher production volume).
3. **HAProxy rate-limit threshold tunability.** ADR fixes 1000/s/source; PoT validated the mechanism at 800/s/source because macOS Docker caps k6 at ~1000/s sustained. Production threshold stays at the ADR value; a Sprint-0 re-test on a Linux host should confirm the 1000/s threshold fires identically (mechanism is identical; only the absolute number we can reach in this environment is bounded).

Status stays Proposed until the user authorises the three amendments + the flip.

ISRG rate-limit exemption submission remains org-side and outside this spike's runnable scope — separately tracked.

## Alternatives considered

- **Disable on-demand TLS — require tenants to upload their own certs.** Operationally hostile; loses competitive parity with Cloudflare/Vercel. Rejected.
- **Use a managed TLS provider (Cloudflare for SaaS).** Vendor lock-in to Cloudflare; per-domain pricing at scale exceeds Caddy + LE cost. Kept as a v2 escape hatch, not MVP.
- **Wildcard certs only.** Doesn't solve tenant-custom-domain (which is the whole point). Rejected.
