# ADR-0015: Temporal Cloud Enterprise tier with EU namespace

- **Status:** Proposed
- **Date:** 2026-05-12
- **Deciders:** Compliance lead, Backend lead
- **Consulted:** Senior architect, Security eng
- **Informed:** Platform team

## Context

Long-running orchestrations (call retry/escalation chains, scheduled callbacks, reminder workflows, multi-step compliance pipelines) need a durable workflow engine. The architecture chose Temporal as the workflow runtime (ARCH v0.4 §6). Two operating-model questions then arise: hosted (Temporal Cloud) vs self-hosted, and — if hosted — does the EU-namespace metadata stay in the EU?

HIPAA requires a signed BAA with any subprocessor that touches PHI metadata. GDPR requires that EU-tenant workflow metadata (Search Attributes, workflow inputs) not egress to a US control plane. Temporal Cloud Enterprise tier markets BAA + EU residency, but the Search Attribute behaviour at the namespace level is not in public docs.

## Decision

Default to **Temporal Cloud Enterprise tier with an EU namespace** for EU tenants and a US namespace for US tenants. Sales-letter confirmation of (a) BAA availability and (b) EU-namespace metadata residency is a prerequisite.

If sales declines the BAA or cannot confirm EU metadata residency, fall back to **self-hosted Temporal via the v1.0.0 Helm chart on EU-residency Kubernetes**. The application-layer Temporal SDK code is identical either way; only the connection string changes.

## Consequences

- **Positive:** Hosted Temporal removes a high-skill operational burden (Cassandra/PostgreSQL backing store, history-shard tuning, frontend scaling). Enterprise tier provides 99.9% SLA and direct support.
- **Negative / cost:** Per-action billing; cost grows with workflow volume. Vendor lock-in at the operations layer (mitigated by SDK portability).
- **Neutral:** EU vs US namespace doubles the operational surface (two control planes to monitor) but is required by GDPR regardless.

## Evidence

Pending PoT spike S7 — see [`pot/S7-temporal-baa/results/`](../../pot/S7-temporal-baa/results/). Target signal: signed sales letter attached confirming BAA terms + EU-namespace metadata residency. If Red, this ADR's Decision section flips to the self-hosted path before Sprint 0 closes.

**Phase-0 status (2026-05-13):** S7 Deferred — sales contact with Temporal Technologies has not been initiated and the 2–6 week calendar turnaround is unsuitable for Phase 0; see [`pot/pot-readout.md` §S7](../../pot/pot-readout.md) for deferral reasoning. ADR-0015 stays Proposed. Ratification gated on **either** (a) Sprint-0 sales-letter capture executed per the runbook, **or** (b) explicit adoption of the documented Yellow/Red fallback (self-hosted Temporal via v1.0.0 Helm chart on EU-residency Kubernetes), in which case §Decision rewrites to the self-host path before ratification.

## Alternatives considered

- **Self-hosted from day one.** Removes vendor risk but adds 0.5–1 FTE of platform-engineering load on day one. Rejected as MVP default — kept as the documented Yellow/Red fallback.
- **Different workflow engine (Cadence, Argo Workflows, AWS Step Functions).** Cadence is Temporal's predecessor — strictly inferior. Argo is K8s-native but lacks Temporal's signal/query/timer primitives that compliance retry chains need. Step Functions is AWS-only and breaks the cloud-portability principle (P9). Rejected.
- **No workflow engine — bespoke retry tables in PostgreSQL.** Rejected on past-team experience: bespoke implementations re-derive Temporal poorly and become the bug source.
