# ADR-0015 — Cloud-side SDK identity validation: deferred

- **Date:** 2026-05-14
- **Status:** Deferred-with-fallback-plan
- **Relates to:** [ADR-0015 Open Risk #4](./0015-temporal-cloud-tier.md), [`0015-sdk-identity-evidence.md`](./0015-sdk-identity-evidence.md)

## Decision

The self-host SDK identity check is **complete and Green** (see [`0015-sdk-identity-evidence.md`](./0015-sdk-identity-evidence.md) partial-check evidence). The Cloud-side identity check is **deferred** until a Temporal Cloud sandbox is provisioned. The fallback plan is:

1. Trust Temporal's published portability guarantee for the TypeScript SDK (`@temporalio/worker` is identical bytes regardless of which server it connects to).
2. The first MVP-tier Cloud customer triggers the full Cloud-side smoke (worker runs `HelloWorldWorkflow` against their tenant Cloud namespace). Until that point, MVP runs against self-host Temporal only.
3. ADR-0015 Open Risk #4 stays open and tracked.

## Justification

A solo-founder PoT cannot justify a Cloud sandbox subscription before the first paying tenant. Self-host evidence is sufficient for PoC tracer-bullet Green (which uses self-host Temporal exclusively per PoC §5 architecture). Cloud-side divergence, if any, surfaces at the first Cloud-tier deployment and is bounded — divergence at the SDK layer would be a connection-string fix, not a workflow code change.

## Consequences

- PoC + MVP Sprint 1–N (until first Cloud tenant) run on self-host Temporal only.
- ADR-0015 Open Risk #4 remains Open in the risk register.
- This deferral is **not** a re-litigation of ADR-0015 itself — Temporal self-host stays the MVP-baseline; this defers only the partial-check upgrade.
