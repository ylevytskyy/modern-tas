# S7 — Temporal Cloud BAA + EU namespace metadata egress

> **Status: DEFERRED (2026-05-13) — Phase 0 attempt skipped because the spike's outcome depends on receiving a sales letter from Temporal Technologies (2–6 week calendar), which has not been initiated.** Revisit during Sprint 0 either by (a) sending the outreach email per `runbook.md` and waiting for the BAA letter, or (b) adopting the ADR-0015 Yellow/Red fallback directly (self-hosted Temporal via v1.0.0 Helm chart on EU-residency Kubernetes) and removing the dependency on Temporal sales entirely. See `pot-readout.md` §S7 for the deferral reasoning + G0 implications.

## Hypothesis

Temporal Cloud Enterprise tier signs the BAA and confirms in writing that EU-namespace Search Attribute metadata does not egress to the US control plane.

## Go/no-go signal

- **Green:** Sales letter attached to ADR-0015 confirming both clauses (BAA + EU residency of namespace metadata).
- **Yellow:** BAA confirmed; EU namespace residency caveated (e.g., metadata in EU but billing/audit in US). Documented and accepted by compliance lead.
- **Red:** Either clause refused. Pivot to self-host Temporal via the Helm chart v1.0.0 on EU-residency K8s. Update ADR-0015 Decision section before Sprint 0 closes.

## Owner role

Compliance lead.

## Prereqs (BLOCKED — needs user-side action)

- **Initiate sales contact with Temporal Technologies.** Specifically: Enterprise tier, BAA terms request, EU namespace data-residency question.
- **Email/letter template** drafted (see `runbook.md`).
- 2–6 weeks calendar time for sales/legal cycle.

## Runbook

See [`runbook.md`](./runbook.md) — checklist of correspondence items.

## Recording protocol

`results/`:
- `correspondence.md` — chronological log of sales touchpoints
- `baa-letter.pdf` — the signed sales letter (when received)
- `summary.md` — one paragraph: Green / Yellow / Red

## Yellow remediation

Per ADR-0015: self-host Temporal via Helm chart v1.0.0 on EU-residency K8s. Architecture-equivalent for application code; operations cost +0.5 FTE.

## ADR linkage

Primary evidence for [ADR-0015 (Temporal Cloud Enterprise tier)](../../docs/adr/0015-temporal-cloud-tier.md). Red flips Decision section to self-host before Sprint 0.
