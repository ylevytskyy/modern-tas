# ADR-0015: Temporal workflow engine — self-host MVP-baseline, Cloud upgrade path

- **Status:** Proposed (rewritten 2026-05-13; pending G0 sign-off ratification per [`pot/g0-signoff-proposal.md`](../../pot/g0-signoff-proposal.md))
- **Date:** 2026-05-12 (original); 2026-05-13 (Decision rewrite)
- **Deciders:** Compliance lead, Backend lead
- **Consulted:** Senior architect, Security eng, Platform lead
- **Informed:** Platform team

## Context

Long-running orchestrations (call retry/escalation chains, scheduled callbacks, reminder workflows, multi-step compliance pipelines) need a durable workflow engine. The architecture chose Temporal as the workflow runtime (ARCH v0.4 §6). Two operating-model questions then arise: hosted (Temporal Cloud) vs self-hosted, and — if hosted — does the EU-namespace metadata stay in the EU?

HIPAA requires a signed BAA with any subprocessor that touches PHI metadata. GDPR requires that EU-tenant workflow metadata (Search Attributes, workflow inputs) not egress to a US control plane. Temporal Cloud Enterprise tier markets BAA + EU residency, but the Search Attribute behaviour at the namespace level is not in public docs.

## Decision

Adopt **self-hosted Temporal via the v1.0.0 Helm chart on EU-residency Kubernetes** as the MVP-baseline workflow engine. Baseline backing stores: PostgreSQL for persistence + visibility; Elasticsearch for advanced visibility queries. A single EU-residency cluster serves both EU and US tenants in MVP; per-region splits become a Sprint-N regulatory question if needed.

**Temporal Cloud Enterprise tier remains a documented upgrade path**, not the primary path. If a vendor BAA + EU-namespace metadata residency confirmation is captured later (via the outreach in [`pot/S7-temporal-baa/runbook.md`](../../pot/S7-temporal-baa/runbook.md)), the application-layer Temporal SDK code is unchanged; the migration is a connection-string + secrets swap plus a one-time workflow history transfer. The trigger is operational rather than functional: if platform-engineering capacity for the self-host cluster exceeds what's sustainable AND Temporal Cloud Enterprise is BAA-compliant + EU-resident, migrate.

**SDK identity caveat.** This Decision relies on the claim that application-layer SDK code is byte-identical between Cloud and self-host paths. Sprint 0 must validate by writing the smallest workflow (`HelloWorldWorkflow` + worker setup) and confirming it compiles + runs against both endpoints with only connection-string + TLS-cert config differing. If the claim doesn't hold, this Decision is renegotiated (likely "wait for Temporal Cloud" or "different workflow engine") before MVP construction touches workflow-tier code.

## Consequences

**Positive:**
- **GDPR-compliant from day one** — full data-plane control on EU-residency Kubernetes; no metadata-residency question to resolve via vendor letter.
- **HIPAA-compliant from day one** — no third-party subprocessor of PHI metadata at the workflow-engine tier; the cluster runs in our existing BAA-bound infrastructure.
- **No vendor sales/legal cycle blocking MVP kickoff** — the 2–6 week Temporal Cloud BAA correspondence is moved off the critical path.
- **Application code remains portable to Cloud** if the upgrade trigger fires (per SDK identity caveat above).

**Negative / cost:**
- **+0.5–1 FTE platform-engineering** — cluster operation, version upgrades, Postgres + Elasticsearch operation, observability, backup/restore drills. Material but bounded; experienced platform engineers can operate Temporal v1.0.0 + PG + ES.
- **Operational risk** — history-shard tuning, replication setup, and disaster-recovery rehearsal are owned by us rather than the vendor. Mitigation: keep the cluster simple (single-region MVP) and lean on Temporal's documented operational runbooks.
- **SDK identity claim is load-bearing.** If Sprint-0 validation fails, the ADR Decision is renegotiated and downstream work may need rework.

**Neutral:**
- EU-residency cluster handles both EU and US tenants in MVP; per-region splits become a Sprint-N regulatory question, not an MVP-baseline question.
- The Cloud-migration upgrade path is *available* but *optional* — if MVP operates fine on self-host indefinitely, no migration ever happens.

## Evidence

Phase-0 S7 was Deferred (sales correspondence not initiated; 2–6 week cycle unsuitable for Phase 0). The Phase-0 → Sprint-0 transition adopts the documented self-host fallback under Path B / Option C of [`pot/g0-signoff-proposal.md`](../../pot/g0-signoff-proposal.md) §S7. Phase-0 deferral reasoning is captured in [`pot/pot-readout.md`](../../pot/pot-readout.md) §S7.

**Sprint-0 evidence required for ratification (Proposed → Accepted):**

1. **SDK identity validation** — smallest Temporal workflow that compiles + runs against both self-host (v1.0.0 Helm) AND Cloud (sandbox or sales-issued temporary tenant), with only connection-string / TLS config differing. Output: `docs/adr/0015-sdk-identity-evidence.md` + run logs. If Cloud-side validation remains blocked at Sprint-0 end, ratify on a documented partial check (self-host runs; Cloud-side claim accepted on Temporal's published portability docs) and flag the residual risk in Consequences.
2. **Self-host operational baseline** — Temporal v1.0.0 deployed via Helm on EU-residency K8s; PG + ES configured; basic observability (metrics dashboard, log aggregation); a successful `HelloWorldWorkflow` run end-to-end. Output: Helm values + K8s manifests committed to `/infra/temporal/`; run log in `docs/adr/0015-selfhost-baseline-log.md`.
3. **(Optional, parallel)** Sales outreach per the runbook; log responses in `pot/S7-temporal-baa/results/correspondence.md`; attach BAA letter if/when received as `docs/adr/0015-temporal-baa.pdf`. **Receipt does NOT change the MVP-baseline Decision** — it only enables the Sprint-N upgrade path.

## Alternatives considered

- **Temporal Cloud Enterprise tier from day one** (was the primary Decision in this ADR's original 2026-05-12 draft). Rejected for MVP baseline due to the 2–6 week BAA + EU-residency vendor correspondence cycle, which puts MVP kickoff on calendar block with no compensating reduction in hazard exposure (the Phase-0 hazards are characterised in `pot/pot-readout.md`; the missing piece is *vendor confirmation*, not *technical risk*). Retained as the documented Sprint-N upgrade trigger per §Decision above.
- **Different workflow engine (Cadence, Argo Workflows, AWS Step Functions).** Cadence is Temporal's predecessor — strictly inferior. Argo is K8s-native but lacks Temporal's signal/query/timer primitives that compliance retry chains need. Step Functions is AWS-only and breaks the cloud-portability principle (P9). Rejected.
- **No workflow engine — bespoke retry tables in PostgreSQL.** Rejected on past-team experience: bespoke implementations re-derive Temporal poorly and become the bug source.
