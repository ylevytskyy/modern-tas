# Architecture Decision Records

ADRs use **MADR 4.0 lite** format. Each decision lives in one file, kebab-case-numbered. To add: copy `template.md`, take the next number, fill in, link from the index.

## Index

| # | Title | Status | Spike | Owner |
|---|---|---|---|---|
| 0013 | [Two-pass redaction pipeline](./0013-redaction-pipeline.md) | Proposed | S4 | Backend + Compliance |
| 0015 | [Temporal Cloud Enterprise tier with EU namespace](./0015-temporal-cloud-tier.md) | Proposed | S7 | Compliance |
| 0016 | [ARI leader 100 ms hard-stop heartbeat](./0016-ari-leader-design.md) | Proposed | S3 | Telephony |
| 0018 | [Supavisor as transaction-mode pooler](./0018-supavisor-pooling.md) | Proposed | S5 | SRE |
| 0019 | [Caddy 2.10+ on-demand TLS posture](./0019-caddy-le-posture.md) | Proposed | S8 | SRE |
| 0024 | [Queue dequeue latency budget = 200 ms p95](./0024-queue-dequeue-budget.md) | Proposed | S2 | Backend |

## Status lifecycle

`Proposed` → `Accepted` (after PoT evidence + Sprint 0 ratification) → `Deprecated` or `Superseded by ADR-XXXX`.

## Out of scope here

The Sprint-0 30-ADR gate (ARCH v0.4 §9) includes 24 more ADRs that don't depend on PoT evidence. Those land during Sprint 0, not this branch.
