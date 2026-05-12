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

Pending PoT spike S8 — see [`pot/S8-caddy-le-posture/results/`](../../pot/S8-caddy-le-posture/results/). Target signal: 1 k unknown-SNI probes/sec sustained for 10 min keeps Caddy storage RPS under 50/sec; HAProxy trips before Caddy. Separately: ISRG exemption form submitted with receipt attached.

## Alternatives considered

- **Disable on-demand TLS — require tenants to upload their own certs.** Operationally hostile; loses competitive parity with Cloudflare/Vercel. Rejected.
- **Use a managed TLS provider (Cloudflare for SaaS).** Vendor lock-in to Cloudflare; per-domain pricing at scale exceeds Caddy + LE cost. Kept as a v2 escape hatch, not MVP.
- **Wildcard certs only.** Doesn't solve tenant-custom-domain (which is the whole point). Rejected.
