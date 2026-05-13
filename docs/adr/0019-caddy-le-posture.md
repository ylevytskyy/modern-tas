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

1. Run **Caddy 2.10+** with `on_demand_tls.ask` pointing at our **permission endpoint**. The endpoint returns 200 only for tenant-confirmed domains; everything else gets 403. Caddy does **not** cache the `ask` decision (no decline-LRU exists in Caddy 2.10's `on_demand_tls`; confirmed in PoT S8 — 59 243 permission calls for 51 distinct SNIs); the storage-thrash hazard is instead mitigated by Caddy **short-circuiting storage I/O when `ask` returns non-2xx**. Declined-SNI TLS handshakes never reach certmagic's `LoadCertificate` and produce zero file-system activity (PoT S8 verified: 0 new cert files written for 59 k declined requests). Consequence: the permission endpoint itself becomes the request amplification surface and must be hardened at its own tier (see §Consequences).
2. Front Caddy with **HAProxy 3.0** in TCP mode rate-limiting **unknown** SNI per source IP using a `stick-table` with `gpc0_rate(1s)` — increment GPC0 only when `req.ssl_sni` is not in the allow-list, then `reject` once `sc_gpc0_rate(0)` exceeds 1 k/sec/source. PoT S8 validated the mechanism at the 800/sec threshold (macOS Docker caps k6 at ~1000/sec sustained — production threshold stays 1000/sec; Sprint-0 re-test on a Linux host to confirm fires identically at the production number). When the rate-limit trips, HAProxy never opens a TCP connection to Caddy for the offending source/SNI, so the permission endpoint is shielded too.
3. **Harden the permission endpoint** as the load-bearing layer of this defence chain: it must absorb the unknown-SNI volume that gets past HAProxy. PoT measured ~1 k decisions/sec without degradation on a single-process Python `ThreadingHTTPServer`; production target is the same per pod with horizontal scaling and a Redis-backed declined-domain rate-limiter to shed obvious abuse before the allow-list lookup.
4. Submit the ISRG rate-limit exemption application before Sprint 8 (when custom domains first ship). 2–4 week turnaround is acceptable.

## Consequences

- **Positive:** Defence in depth — three independent layers (a) HAProxy SNI rate-limit, (b) permission-endpoint allow-list + rate-limiter, (c) Caddy storage short-circuit on non-2xx `ask` response. The three layers fail independently: HAProxy alone bounds blast radius from a single-source flood; the permission endpoint alone bounds it from a distributed flood (or any traffic HAProxy passes through); and Caddy's storage short-circuit alone bounds storage-side damage if both upstream layers fail. Custom-domain feature ships unblocked.
- **Negative / cost:** HAProxy adds another network hop. The permission endpoint becomes a load-bearing tier — needs its own scaling, monitoring, and rate-limiter (Redis-backed). ISRG exemption requires writing a defensible production-volume justification.
- **Neutral:** Caddy 2.10+ is the current stable; pinning is conservative. The `ask` directive Caddyfile keyword is deprecated in favour of `permission http` (Caddy 2.8+); pinning to `permission http` in production config is a no-op cost.

## Evidence

PoT spike S8 ran 2026-05-13 against Caddy 2.10.2 + HAProxy 3.0.6 — see [`pot/S8-caddy-le-posture/results/20260513T093513Z/`](../../pot/S8-caddy-le-posture/results/20260513T093513Z/) and [`pot/pot-readout.md` §S8](../../pot/pot-readout.md). Headline:

- **Scenario A (k6 → HAProxy → Caddy, 60 s @ 1000 req/s):** HAProxy rejected 58 193 / 59 597 connections (97.6 %) once unknown-SNI rate exceeded the rate-limit threshold; only 813 connections reached Caddy. Caddy storage delta: +3 files (1 cert for the known SNI + 2 PKI authority artifacts; **zero** certs for the 812 leaked unknown SNIs).
- **Scenario B (k6 → Caddy direct, 60 s @ ~994 req/s, HAProxy bypassed):** 59 243 permission decisions for 51 distinct SNIs; Caddy storage delta = 0 new files.
- Storage-thrash hazard (certmagic #174) is **killed** in both scenarios.

PoT S8 surfaced three text findings against the original ADR-0019, which §Decision and §Consequences above have been corrected to reflect: (1) Caddy 2.10's `on_demand_tls` has no decline-LRU — the actual mitigation is storage short-circuit on non-2xx `ask`; (2) the three defence layers are HAProxy + permission endpoint + Caddy storage short-circuit, not "HAProxy + Caddy LRU + ISRG exemption"; (3) the PoT HAProxy threshold (800/sec/source) is lower than the production threshold (1000/sec/source) for macOS Docker capacity reasons — Sprint-0 Linux re-test should confirm 1000/sec behaviour matches.

ISRG rate-limit exemption submission remains org-side and outside this spike's runnable scope — separately tracked.

## Alternatives considered

- **Disable on-demand TLS — require tenants to upload their own certs.** Operationally hostile; loses competitive parity with Cloudflare/Vercel. Rejected.
- **Use a managed TLS provider (Cloudflare for SaaS).** Vendor lock-in to Cloudflare; per-domain pricing at scale exceeds Caddy + LE cost. Kept as a v2 escape hatch, not MVP.
- **Wildcard certs only.** Doesn't solve tenant-custom-domain (which is the whole point). Rejected.
