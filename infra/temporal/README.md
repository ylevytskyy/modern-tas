# Temporal Self-Host Baseline

Local kind cluster deployment proving ADR-0015 §Evidence item 2: self-hosted Temporal
is operationally viable on local K8s before committing to Temporal Cloud costs.

See spec: [`docs/superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md`](../../docs/superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md)
See ADR: [`docs/adr/0015-temporal-cloud-tier.md`](../../docs/adr/0015-temporal-cloud-tier.md)

## Architecture

Three chained Helm releases in a single `temporal` namespace:

```
bitnami/postgresql (temporal-pg)
  └─ service: temporal-pg-postgresql.temporal.svc.cluster.local:5432
  └─ secret:  temporal-pg-postgresql  key: postgres-password

elastic/elasticsearch (temporal-es)  ← chart v8.5.1, ES 8.5.1 (official Elastic chart)
  └─ service: elasticsearch-master.temporal.svc.cluster.local:9200
  └─ NOTE: official Elastic chart uses fixed service name "elasticsearch-master"
           (not "<release>-master") — the clusterName drives the name, not the release

temporal/temporal (temporal-baseline)
  └─ defaultStore  → postgres (temporal-pg)
  └─ visibilityStore → elasticsearch v8 (temporal-es)
```

**Why chained releases?** The Temporal Helm chart v1.0.0-rc.2+ removed bundled PG/ES
subcharts. Users must provide external persistence. For local development, bitnami charts
in the same namespace are the simplest approach.

**Why official Elastic chart, not bitnami?** bitnami/elasticsearch charts v21.x and v22.x
use Docker Hub images that fell behind the Bitnami paid-image gate (August 2025) — the
`bitnami/os-shell` init container images are no longer publicly accessible. The official
`elastic/elasticsearch` Helm chart (https://helm.elastic.co) uses `docker.elastic.co`
images which remain free. ES v8.5.1 is compatible with Temporal 1.20+ (`version: v8`).

## Prerequisites

- kind v0.27+ (`kind version`)
- helm v3+ or v4 (`helm version`)
- kubectl (`kubectl version --client`)
- Docker with ≥6 GB RAM allocated
- Helm repos accessible (bitnami + go.temporal.io)

## Quick start

```bash
cd infra/temporal

# 1. Bring up the kind cluster
make cluster-up

# 2. Add chart repos, create namespace, install all three releases
make chart-install      # takes ~10–15 min first run (image pulls)

# 3. Verify all pods are Running / Completed
make pods
```

Expected output from `make pods`:
```
NAME                                          READY   STATUS      RESTARTS
temporal-baseline-frontend-...                1/1     Running     0
temporal-baseline-history-...                 1/1     Running     0
temporal-baseline-matching-...                1/1     Running     0
temporal-baseline-worker-...                  1/1     Running     0
temporal-baseline-web-...                     1/1     Running     0
temporal-baseline-schema-setup-...            0/1     Completed   0
temporal-es-elasticsearch-master-0            1/1     Running     0
temporal-pg-postgresql-0                      1/1     Running     0
```

## Smoke test

```bash
# In one terminal: forward ports
make port-forward

# In another terminal: run the SDK hello-world from sprint-0
make hello

# Or open the Web UI
open http://localhost:8080
```

## Individual steps (if chart-install fails partway)

```bash
make pg-install        # bitnami/postgresql only
make es-install        # bitnami/elasticsearch only
make temporal-install  # temporal/temporal only (requires PG + ES up)
```

## Tear down

```bash
make down    # deletes the kind cluster (all data lost — expected for local baseline)
```

## Files

| File | Purpose |
|------|---------|
| `kind-cluster.yaml` | kind cluster config, ports 7233 + 8080 mapped to host |
| `values.postgresql.yaml` | bitnami/postgresql values (no persistence, local only) |
| `values.elasticsearch.yaml` | bitnami/elasticsearch values (single-node, ES 8.x) |
| `values.local.yaml` | temporal/temporal values (external PG + ES, local baseline) |
| `values.yaml` | Production-target values (UNRUN — EU HA + mTLS + external managed PG/ES) |
| `Chart.lock` | Pinned chart versions for reproducibility |
| `Makefile` | Make targets for cluster/chart lifecycle |

## Known limitations (local baseline only)

- No mTLS (Open Risk #4 from ADR-0015 — documented, not exercised here)
- No persistence (`enabled: false` in both PG and ES — data lost on pod restart)
- Single replicas throughout — not representative of production HA
- ES 8.x in kind, not production-grade managed ES
- Production-shape values are in `values.yaml` (authored but unrun)
