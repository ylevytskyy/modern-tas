# S7 Self-host Temporal Baseline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the two evidence artefacts that ratify ADR-0015 (Temporal workflow engine — self-host MVP-baseline) from Proposed → Accepted: a working local self-host deployment via Helm on kind, and a partial-check SDK identity validation that exercises the smallest viable Temporal worker against it.

**Architecture:** kind (Kubernetes-in-Docker) running the Temporal upstream Helm chart with bundled PostgreSQL + Elasticsearch subcharts. A standalone Node.js worker (TypeScript, `@temporalio/worker` + `@temporalio/client`) outside the cluster connects via port-forwarded gRPC to run a single `HelloWorldWorkflow` end-to-end. Cloud-side validation accepted on Temporal's published portability docs per ADR-0015 §Evidence escape hatch.

**Tech Stack:** kind, Docker Desktop, Helm 3, Temporal upstream Helm chart, PostgreSQL (bundled), Elasticsearch (bundled), Node.js 20+, TypeScript, `@temporalio/worker`, `@temporalio/client`.

**Spec source:** `docs/superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md`

**TDD note:** This is Sprint-0 evidence work, not durable software. Per CLAUDE.md §4a TDD-skip clauses, the "test" is the integration run — `make hello` either completes the workflow (Green) or it doesn't. There are no unit tests; the worker code is throwaway. Each task ends in either a verifiable command output (cluster up, workflow completes) or a committed deliverable. Frequent commits per §7.2 of the spec.

---

## File Structure

| Path | Purpose | Created in task |
|---|---|---|
| `/infra/temporal/README.md` | Deploy + smoke-test instructions | Task 1 |
| `/infra/temporal/kind-cluster.yaml` | 1-node kind cluster definition | Task 1 |
| `/infra/temporal/Makefile` | cluster-up / chart-install / port-forward / hello / down | Task 1 |
| `/infra/temporal/Chart.lock` | Pinned Temporal Helm chart version (resolved via Context7) | Task 2 |
| `/infra/temporal/values.local.yaml` | Local-kind override: bundled PG + ES, smaller asks, no mTLS | Task 2 |
| `/infra/temporal/values.yaml` | Production-shaped values, unrun, comments documenting deltas | Task 2 |
| `/sprint-0/temporal-sdk-validation/README.md` | How to run worker + trigger | Task 5 |
| `/sprint-0/temporal-sdk-validation/package.json` | Standalone pnpm package | Task 5 |
| `/sprint-0/temporal-sdk-validation/tsconfig.json` | TypeScript config | Task 5 |
| `/sprint-0/temporal-sdk-validation/config/selfhost.json` | Connection config: localhost:7233, no TLS, namespace "default" | Task 5 |
| `/sprint-0/temporal-sdk-validation/config/cloud.json.example` | Placeholder + comment explaining partial-check posture | Task 5 |
| `/sprint-0/temporal-sdk-validation/src/workflows.ts` | HelloWorldWorkflow definition | Task 6 |
| `/sprint-0/temporal-sdk-validation/src/activities.ts` | sayHello activity | Task 6 |
| `/sprint-0/temporal-sdk-validation/src/worker.ts` | Boots worker | Task 6 |
| `/sprint-0/temporal-sdk-validation/src/trigger.ts` | Client starts workflow + waits for result | Task 6 |
| `/docs/adr/0015-selfhost-baseline-log.md` | §Evidence item 2: deployment + execution trace | Task 9 |
| `/docs/adr/0015-sdk-identity-evidence.md` | §Evidence item 1: partial-check basis + worker code + Temporal docs citation | Task 10 |

---

## Task 0: Pre-flight — branch, tooling, version resolution

**Files:** none created; verifications only.

- [ ] **Step 0.1: Verify current branch is the spike-chain tip**

```bash
git status
git log --oneline -3
```

Expected: branch is `pot/S6-ncall-fixture-capture`, working tree clean, HEAD is `7e29d93` or later.

- [ ] **Step 0.2: Create the new sprint-0 branch**

```bash
git checkout -b sprint-0/temporal-selfhost-baseline pot/S6-ncall-fixture-capture
git status
```

Expected: now on `sprint-0/temporal-selfhost-baseline`, working tree clean.

- [ ] **Step 0.3: Verify Docker Desktop is running with ≥6 GB RAM**

```bash
docker info | grep -E "Total Memory|CPUs"
```

Expected: Total Memory ≥ 6 GB (≥ 6442450944 bytes). If less, instruct user to bump Docker Desktop RAM allocation in Preferences → Resources before continuing.

- [ ] **Step 0.4: Verify kind, helm, kubectl, node are installed**

```bash
which kind helm kubectl node
kind version
helm version --short
kubectl version --client --short 2>/dev/null || kubectl version --client
node --version
```

Expected: all four binaries present. kind ≥ 0.20, helm ≥ 3.12, kubectl ≥ 1.28, node ≥ 20.0.

If any are missing on macOS:
```bash
brew install kind helm kubectl node
```

- [ ] **Step 0.5: Resolve current Temporal Helm chart version via Context7**

Use the Context7 MCP tool:
- Call `resolve-library-id` with library name "temporal helm chart"
- Call `query-docs` with the resolved ID and question "What is the current version of the Temporal Helm chart and what are its required values for a single-node local install with bundled PostgreSQL and Elasticsearch?"

Capture in scratch notes:
- Chart repo URL (likely `https://go.temporal.io/helm-charts`)
- Current chart version (e.g., `0.x.y`)
- Whether bundled PG + ES are subchart dependencies or require separate install
- Required values for single-node, local-only deployment

**If the resolved chart version is not v1.0.0 (the version named in ADR-0015 §Decision):** flag this for inline ADR amendment in Task 11 §Caveats. Do not block on it.

- [ ] **Step 0.6: Resolve current Temporal SDK TypeScript version via Context7**

Use the Context7 MCP tool:
- Call `resolve-library-id` with "@temporalio/worker"
- Call `query-docs` with the resolved ID and question "What are the current versions of @temporalio/worker and @temporalio/client, and the minimal worker + workflow + activity scaffold?"

Capture: current `@temporalio/worker` and `@temporalio/client` versions for `package.json` pinning.

---

## Task 1: Author /infra/temporal/ scaffolding (cluster, Makefile, README)

**Files:**
- Create: `/infra/temporal/kind-cluster.yaml`
- Create: `/infra/temporal/Makefile`
- Create: `/infra/temporal/README.md`

- [ ] **Step 1.1: Create the directory**

```bash
mkdir -p /Users/lion/Documents/Projects/mine/ncall-clone/infra/temporal
```

- [ ] **Step 1.2: Author kind-cluster.yaml**

Write `/infra/temporal/kind-cluster.yaml`:

```yaml
# 1-node kind cluster for Temporal self-host baseline (ADR-0015 §Evidence item 2).
# Local-only; not representative of production EU K8s topology.
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: temporal-baseline
nodes:
  - role: control-plane
    extraPortMappings:
      # Expose Temporal frontend gRPC for worker connection (alternative to port-forward).
      - containerPort: 30733
        hostPort: 7233
        protocol: TCP
      # Expose Temporal Web UI.
      - containerPort: 30808
        hostPort: 8080
        protocol: TCP
```

- [ ] **Step 1.3: Author Makefile**

Write `/infra/temporal/Makefile`. Replace `<CHART_VERSION>` with the version resolved in Step 0.5.

```makefile
# Temporal self-host baseline — local kind + Helm.
# ADR-0015 §Evidence item 2 deliverable.

CLUSTER_NAME := temporal-baseline
CHART_REPO   := https://go.temporal.io/helm-charts
CHART_NAME   := temporal/temporal
CHART_VERSION := <CHART_VERSION>
NAMESPACE    := temporal
RELEASE      := temporal-baseline

.PHONY: cluster-up
cluster-up:
	kind create cluster --config kind-cluster.yaml
	kubectl cluster-info --context kind-$(CLUSTER_NAME)

.PHONY: chart-repo
chart-repo:
	helm repo add temporal $(CHART_REPO)
	helm repo update temporal

.PHONY: chart-install
chart-install: chart-repo
	kubectl create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -
	helm upgrade --install $(RELEASE) $(CHART_NAME) \
		--version $(CHART_VERSION) \
		--namespace $(NAMESPACE) \
		--values values.local.yaml \
		--wait --timeout 10m

.PHONY: pods
pods:
	kubectl get pods -n $(NAMESPACE)

.PHONY: port-forward
port-forward:
	@echo "Forwarding 7233 (gRPC) and 8080 (Web UI). Ctrl-C to stop."
	kubectl port-forward -n $(NAMESPACE) svc/$(RELEASE)-frontend 7233:7233 & \
	kubectl port-forward -n $(NAMESPACE) svc/$(RELEASE)-web 8080:8080 & \
	wait

.PHONY: hello
hello:
	cd ../../sprint-0/temporal-sdk-validation && pnpm run hello

.PHONY: down
down:
	kind delete cluster --name $(CLUSTER_NAME)
```

- [ ] **Step 1.4: Author README.md**

Write `/infra/temporal/README.md`:

```markdown
# Temporal Self-host Baseline

ADR-0015 §Evidence item 2 deliverable. Local kind cluster + Helm chart + bundled PG + ES.

## Prerequisites

- Docker Desktop with ≥6 GB RAM allocated
- kind ≥ 0.20, helm ≥ 3.12, kubectl ≥ 1.28
- macOS or Linux

## Deploy

```bash
make cluster-up      # ~30s: kind cluster
make chart-install   # ~3-5 min: Helm install + schema-setup Job
make pods            # verify all Running
make port-forward    # in a second shell; keep running
```

## Smoke test

In a third shell:
```bash
make hello           # runs HelloWorldWorkflow against the cluster
```

Expected output (last lines):
```
Started workflow hello-<timestamp>
Result: Hello, world!
```

## Tear down

```bash
make down            # destroys the kind cluster
```

## Caveats

- **Bundled PG + ES** are not production-shaped. See `values.yaml` for the
  production-target deltas (external PG, replicated ES, mTLS, EU residency).
- **No mTLS** between worker and frontend. The Cloud SDK auth path is therefore
  not exercised by this baseline (ADR-0015 Open Risk #4).
- **Single-node, no HA.** No replication, no DR rehearsal. Sprint-N work.

## See also

- [ADR-0015](../../docs/adr/0015-temporal-cloud-tier.md) — the Decision this
  baseline ratifies.
- [`/sprint-0/temporal-sdk-validation/`](../../sprint-0/temporal-sdk-validation/) —
  the worker that exercises this cluster.
- [`docs/adr/0015-selfhost-baseline-log.md`](../../docs/adr/0015-selfhost-baseline-log.md) —
  evidence captured from a real run of this stack.
```

- [ ] **Step 1.5: Verify files exist**

```bash
ls -la infra/temporal/
```

Expected: `Makefile`, `README.md`, `kind-cluster.yaml`, three files.

---

## Task 2: Author Helm values files

**Files:**
- Create: `/infra/temporal/values.local.yaml`
- Create: `/infra/temporal/values.yaml`
- Create: `/infra/temporal/Chart.lock`

- [ ] **Step 2.1: Author values.local.yaml**

Use the values structure resolved from Context7 in Step 0.5. The exact key names depend on chart version; below is the conceptual shape — adapt key paths to match the actual current chart's values schema (some chart versions use `server.config` vs `temporal.config`, `cassandra.enabled: false` to disable Cassandra, etc.).

Write `/infra/temporal/values.local.yaml`:

```yaml
# Local-kind override values for Temporal Helm chart.
# Optimised for laptop resource budget; NOT production-representative.
# Production-target values live in values.yaml.

# --- Persistence: bundled PostgreSQL via Bitnami subchart (single node) ---
# Production would use external managed PG; see values.yaml.
cassandra:
  enabled: false
mysql:
  enabled: false
postgresql:
  enabled: true
  auth:
    postgresPassword: temporal
    database: temporal
  primary:
    resources:
      requests:
        memory: 256Mi
        cpu: 100m
      limits:
        memory: 512Mi
        cpu: 500m

# --- Visibility: bundled Elasticsearch (1 node, no replica) ---
# Production would use external managed ES.
elasticsearch:
  enabled: true
  replicas: 1
  minimumMasterNodes: 1
  resources:
    requests:
      memory: 768Mi
      cpu: 200m
    limits:
      memory: 1024Mi
      cpu: 1000m
  esJavaOpts: "-Xms512m -Xmx512m"
  volumeClaimTemplate:
    accessModes: [ "ReadWriteOnce" ]
    resources:
      requests:
        storage: 1Gi

# --- Temporal services: single replica each ---
server:
  replicaCount: 1
  resources:
    requests:
      memory: 128Mi
      cpu: 100m
    limits:
      memory: 256Mi
      cpu: 500m

# --- Web UI ---
web:
  replicaCount: 1
  service:
    type: ClusterIP
  resources:
    requests:
      memory: 64Mi
      cpu: 50m
    limits:
      memory: 128Mi
      cpu: 200m

# --- Prometheus metrics endpoint exposed for scrape evidence (no Grafana stack) ---
prometheus:
  enabled: false  # we don't deploy Prometheus; just ensure /metrics is reachable
grafana:
  enabled: false

# --- TLS: disabled for local baseline ---
# Production uses mTLS; see values.yaml. ADR-0015 Open Risk #4.
```

- [ ] **Step 2.2: Author values.yaml (production-shaped, unrun)**

Write `/infra/temporal/values.yaml`:

```yaml
# Production-target Helm values for Temporal self-host on EU-residency K8s.
# This file is AUTHORED but UNRUN as part of ADR-0015 Sprint-0 baseline.
# Local execution uses values.local.yaml. Real-EU-K8s execution is a future
# platform-eng task that adapts this file to the chosen K8s distribution.

# --- Persistence: external managed PostgreSQL ---
# Reasons external: HA, backup/restore drills, point-in-time recovery, separate
# scaling from K8s lifecycle. EU-residency provider must offer EU-region PG
# (AWS RDS eu-central-1, Hetzner managed PG eu, Scaleway DB eu-west).
cassandra:
  enabled: false
mysql:
  enabled: false
postgresql:
  enabled: false  # external — see server.config.persistence.default.sql
server:
  config:
    persistence:
      default:
        sql:
          driver: postgres12
          # Connect details supplied via Secret at deploy time:
          # host, port, database, user, password.

# --- Visibility: external managed Elasticsearch ---
# Reasons external: same as PG. Replicated, DR-ready.
elasticsearch:
  enabled: false  # external — see server.config.persistence.advancedVisibility

# --- Temporal services: HA replica counts, anti-affinity, PDBs ---
server:
  replicaCount: 3  # 3 per service (frontend/matching/history/worker-system)
  podDisruptionBudget:
    enabled: true
    minAvailable: 2

# --- Web UI: HA, behind ingress with TLS termination ---
web:
  replicaCount: 2
  service:
    type: ClusterIP
  ingress:
    enabled: true
    # host + tls populated at deploy time

# --- TLS: mTLS between client and frontend, between cluster nodes ---
# Cert chain managed via cert-manager + internal CA.
# This is the auth path that local baseline does NOT exercise (Open Risk #4).
server:
  config:
    tls:
      internode:
        client:
          serverName: temporal-internode
        server:
          requireClientAuth: true
      frontend:
        client:
          serverName: temporal-frontend
        server:
          requireClientAuth: true

# --- Observability: Prometheus + Grafana out of cluster (shared platform) ---
prometheus:
  enabled: false
grafana:
  enabled: false
# ServiceMonitor authored separately by platform-eng for the shared Prometheus.
```

- [ ] **Step 2.3: Author Chart.lock pinning the chart version**

Write `/infra/temporal/Chart.lock`. Replace `<CHART_VERSION>` and `<DIGEST>` with the values from Step 0.5 (use `helm repo update temporal && helm search repo temporal/temporal --versions | head -3` if needed):

```yaml
# Pinned chart version. ADR-0015 §Decision originally said "v1.0.0";
# actual current chart version pinned here per Sprint-0 implementation.
# If pinned version differs from v1.0.0, see ADR-0015 §Caveats amendment.
dependencies:
  - name: temporal
    repository: https://go.temporal.io/helm-charts
    version: <CHART_VERSION>
    digest: <DIGEST>
```

- [ ] **Step 2.4: Verify all files exist**

```bash
ls -la infra/temporal/
```

Expected: `Chart.lock`, `Makefile`, `README.md`, `kind-cluster.yaml`, `values.local.yaml`, `values.yaml` — six files.

---

## Task 3: Spin up cluster + install chart + verify

**Files:** none authored; capture run output to scratch notes.

- [ ] **Step 3.1: Update Makefile CHART_VERSION**

Edit `/infra/temporal/Makefile` and replace `<CHART_VERSION>` placeholder with the actual version from Step 0.5.

- [ ] **Step 3.2: Bring up the kind cluster**

```bash
cd infra/temporal
make cluster-up 2>&1 | tee /tmp/temporal-cluster-up.log
```

Expected: kind creates the cluster, prints node + control-plane endpoints. Takes ~30s.

If failure mentions port already bound, check whether 7233 or 8080 is in use:
```bash
lsof -i :7233; lsof -i :8080
```

- [ ] **Step 3.3: Install the Helm chart**

```bash
make chart-install 2>&1 | tee /tmp/temporal-chart-install.log
```

Expected: `helm repo add` + `helm upgrade --install` complete; `--wait --timeout 10m` blocks until all deployments and the schema-setup Job report Ready. Takes 3–5 min on first install.

If schema-setup Job fails, inspect:
```bash
kubectl logs -n temporal job/temporal-baseline-schema-setup
```

Common failure: PG password mismatch → check `values.local.yaml` `postgresql.auth.postgresPassword` matches what server config expects.

- [ ] **Step 3.4: Verify all pods Running**

```bash
make pods 2>&1 | tee /tmp/temporal-pods.log
```

Expected: every pod in `STATUS=Running`, `READY` column shows `1/1` (or `2/2`, depending on sidecars). Pods include:
- `temporal-baseline-frontend-*`
- `temporal-baseline-history-*`
- `temporal-baseline-matching-*`
- `temporal-baseline-worker-*`
- `temporal-baseline-web-*`
- `temporal-baseline-postgresql-*`
- `temporal-baseline-elasticsearch-*` (or `master-0`)
- `temporal-baseline-admintools-*`
- `temporal-baseline-schema-setup-*` in `Completed` (Job pod, not Running)

If any pod is in `CrashLoopBackOff`, capture logs to `/tmp/temporal-failed-<podname>.log` and stop — do not proceed until cluster is fully healthy.

- [ ] **Step 3.5: Start port-forward in a background shell**

In a second terminal:
```bash
cd infra/temporal
make port-forward
```

Leave running. Verify forwarding:
```bash
nc -z localhost 7233 && echo "gRPC up"
curl -sf http://localhost:8080/ -o /dev/null && echo "Web UI up"
```

Expected: both checks succeed.

---

## Task 4: Commit /infra/temporal/ work

- [ ] **Step 4.1: Stage and commit infra files**

```bash
cd /Users/lion/Documents/Projects/mine/ncall-clone
git add infra/temporal/
git status   # verify only infra/temporal/* staged
```

- [ ] **Step 4.2: Create commit #1**

```bash
git commit -m "$(cat <<'EOF'
feat(infra): add /infra/temporal/ Helm values + Makefile for self-host baseline

Authored ADR-0015 §Evidence item 2 deliverable: Helm chart deployment
on local kind for the self-host Temporal baseline. Bundled PG + ES via
Bitnami subcharts in values.local.yaml; production-target shape in
values.yaml authored but unrun (external managed PG + ES, mTLS, HA,
EU-residency notes). Chart.lock pins the resolved current Helm chart
version.

Per ADR-0015 §Decision rewrite (commit 13ca47b, pending G0 ratification).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4.3: Verify commit landed**

```bash
git log --oneline -1
git status
```

Expected: HEAD is the new commit; working tree clean.

---

## Task 5: Author /sprint-0/temporal-sdk-validation/ scaffolding

**Files:**
- Create: `/sprint-0/temporal-sdk-validation/package.json`
- Create: `/sprint-0/temporal-sdk-validation/tsconfig.json`
- Create: `/sprint-0/temporal-sdk-validation/README.md`
- Create: `/sprint-0/temporal-sdk-validation/config/selfhost.json`
- Create: `/sprint-0/temporal-sdk-validation/config/cloud.json.example`

- [ ] **Step 5.1: Create directories**

```bash
mkdir -p /Users/lion/Documents/Projects/mine/ncall-clone/sprint-0/temporal-sdk-validation/{src,config}
```

- [ ] **Step 5.2: Author package.json**

Write `/sprint-0/temporal-sdk-validation/package.json`. Replace `<TEMPORAL_VERSION>` with the version resolved in Step 0.6 (e.g., `^1.10.0`):

```json
{
  "name": "@ncall-clone/temporal-sdk-validation",
  "version": "0.0.1",
  "private": true,
  "description": "ADR-0015 §Evidence item 1 partial-check worker. Smallest viable Temporal worker exercising the TypeScript SDK against the local self-host baseline.",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "worker": "tsx src/worker.ts",
    "trigger": "tsx src/trigger.ts",
    "hello": "tsx src/run-hello.ts"
  },
  "dependencies": {
    "@temporalio/client": "<TEMPORAL_VERSION>",
    "@temporalio/worker": "<TEMPORAL_VERSION>",
    "@temporalio/workflow": "<TEMPORAL_VERSION>",
    "@temporalio/activity": "<TEMPORAL_VERSION>"
  },
  "devDependencies": {
    "tsx": "^4.7.0",
    "typescript": "^5.3.0",
    "@types/node": "^20.10.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 5.3: Author tsconfig.json**

Write `/sprint-0/temporal-sdk-validation/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5.4: Author config/selfhost.json**

Write `/sprint-0/temporal-sdk-validation/config/selfhost.json`:

```json
{
  "address": "localhost:7233",
  "namespace": "default",
  "tls": false
}
```

- [ ] **Step 5.5: Author config/cloud.json.example**

Write `/sprint-0/temporal-sdk-validation/config/cloud.json.example`:

```json
{
  "_comment": "Cloud-side validation NOT exercised in Sprint-0 baseline. ADR-0015 §Evidence item 1 ratifies on partial check (self-host runs; Cloud claim accepted on Temporal portability docs). If a Temporal Cloud sandbox is signed up later, copy this file to cloud.json and fill in:",
  "address": "<your-namespace>.tmprl.cloud:7233",
  "namespace": "<your-namespace>",
  "tls": {
    "clientCertPair": {
      "crt": "<path-to-client.crt>",
      "key": "<path-to-client.key>"
    }
  }
}
```

- [ ] **Step 5.6: Author README.md**

Write `/sprint-0/temporal-sdk-validation/README.md`:

```markdown
# Temporal SDK Validation Worker

Smallest viable Temporal worker exercising the TypeScript SDK against the
local self-host baseline. Produces ADR-0015 §Evidence item 1 partial check.

## Prerequisites

- `/infra/temporal/` cluster up + port-forward running (see that README)
- Node.js ≥ 20, pnpm

## Run

```bash
pnpm install
pnpm run hello   # runs worker + trigger; prints "Hello, world!" on success
```

Or run worker and trigger separately for inspection:
```bash
pnpm run worker  # in shell A
pnpm run trigger # in shell B
```

## Files

- `src/workflows.ts` — `HelloWorldWorkflow` definition
- `src/activities.ts` — `sayHello` activity
- `src/worker.ts` — boots worker, registers workflow + activity
- `src/trigger.ts` — client starts workflow, awaits result, prints
- `src/run-hello.ts` — convenience: spawns worker + waits for it to be ready, then runs trigger, then exits

## What this does NOT exercise

- Signals, queries, Search Attributes, timers, child workflows
- mTLS auth path (Cloud uses mTLS; local baseline plain TCP)
- Cloud-side endpoint (Cloud sandbox not signed up; partial-check posture)

These are documented residuals per ADR-0015 §Consequences Open Risk #4.

## See also

- [`/infra/temporal/`](../../infra/temporal/) — the cluster this targets
- [`docs/adr/0015-sdk-identity-evidence.md`](../../docs/adr/0015-sdk-identity-evidence.md) — evidence captured from running this
```

- [ ] **Step 5.7: Install dependencies**

```bash
cd sprint-0/temporal-sdk-validation
pnpm install 2>&1 | tee /tmp/temporal-pnpm-install.log
```

Expected: lockfile created, packages installed, no errors.

If `pnpm` not installed: `npm install -g pnpm` first.

---

## Task 6: Author worker code (TypeScript)

**Files:**
- Create: `/sprint-0/temporal-sdk-validation/src/workflows.ts`
- Create: `/sprint-0/temporal-sdk-validation/src/activities.ts`
- Create: `/sprint-0/temporal-sdk-validation/src/worker.ts`
- Create: `/sprint-0/temporal-sdk-validation/src/trigger.ts`
- Create: `/sprint-0/temporal-sdk-validation/src/run-hello.ts`

- [ ] **Step 6.1: Author workflows.ts**

Write `/sprint-0/temporal-sdk-validation/src/workflows.ts`:

```typescript
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities.js';

const { sayHello } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
});

export async function HelloWorldWorkflow(name: string): Promise<string> {
  return await sayHello(name);
}
```

- [ ] **Step 6.2: Author activities.ts**

Write `/sprint-0/temporal-sdk-validation/src/activities.ts`:

```typescript
export async function sayHello(name: string): Promise<string> {
  return `Hello, ${name}!`;
}
```

- [ ] **Step 6.3: Author worker.ts**

Write `/sprint-0/temporal-sdk-validation/src/worker.ts`:

```typescript
import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as activities from './activities.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  readFileSync(join(__dirname, '../config/selfhost.json'), 'utf-8'),
);

async function main() {
  const connection = await NativeConnection.connect({ address: config.address });
  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: 'hello-baseline',
    workflowsPath: require.resolve('./workflows.js'),
    activities,
  });
  console.log(
    `Worker connected to ${config.address}, namespace="${config.namespace}", polling task queue "hello-baseline"`,
  );
  await worker.run();
}

main().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
```

**Note for the engineer:** the `workflowsPath: require.resolve(...)` line uses CommonJS `require` inside an ESM file. Temporal's worker requires this for workflow bundling. If the build complains, add `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);` at the top of the file.

- [ ] **Step 6.4: Author trigger.ts**

Write `/sprint-0/temporal-sdk-validation/src/trigger.ts`:

```typescript
import { Client, Connection } from '@temporalio/client';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HelloWorldWorkflow } from './workflows.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  readFileSync(join(__dirname, '../config/selfhost.json'), 'utf-8'),
);

async function main() {
  const connection = await Connection.connect({ address: config.address });
  const client = new Client({ connection, namespace: config.namespace });
  const workflowId = `hello-${Date.now()}`;
  const handle = await client.workflow.start(HelloWorldWorkflow, {
    args: ['world'],
    taskQueue: 'hello-baseline',
    workflowId,
  });
  console.log(`Started workflow ${workflowId}`);
  const result = await handle.result();
  console.log(`Result: ${result}`);
}

main().catch((err) => {
  console.error('Trigger failed:', err);
  process.exit(1);
});
```

- [ ] **Step 6.5: Author run-hello.ts (convenience runner for `make hello`)**

Write `/sprint-0/temporal-sdk-validation/src/run-hello.ts`:

```typescript
// Spawns worker as a child process, waits for it to be ready, runs trigger,
// then kills the worker and exits. Convenience for `make hello` evidence runs.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerPath = join(__dirname, 'worker.ts');
const triggerPath = join(__dirname, 'trigger.ts');

async function main() {
  const worker = spawn('npx', ['tsx', workerPath], { stdio: ['ignore', 'pipe', 'pipe'] });

  // Wait until the worker logs "polling task queue" before triggering.
  await new Promise<void>((resolve, reject) => {
    let buffered = '';
    const onData = (chunk: Buffer) => {
      const s = chunk.toString();
      process.stdout.write(`[worker] ${s}`);
      buffered += s;
      if (buffered.includes('polling task queue')) resolve();
    };
    worker.stdout?.on('data', onData);
    worker.stderr?.on('data', (chunk) => process.stderr.write(`[worker] ${chunk}`));
    worker.on('exit', (code) => reject(new Error(`worker exited early with code ${code}`)));
    setTimeout(() => reject(new Error('worker did not become ready within 30s')), 30_000);
  });

  // Run the trigger inline.
  await new Promise<void>((resolve, reject) => {
    const trigger = spawn('npx', ['tsx', triggerPath], { stdio: 'inherit' });
    trigger.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`trigger exited ${code}`))));
  });

  // Trigger completed; shut worker down.
  worker.kill('SIGTERM');
}

main().catch((err) => {
  console.error('run-hello failed:', err);
  process.exit(1);
});
```

- [ ] **Step 6.6: Type-check the worker package**

```bash
cd sprint-0/temporal-sdk-validation
pnpm exec tsc --noEmit 2>&1 | tee /tmp/temporal-tsc.log
```

Expected: no errors. If errors, fix them inline before proceeding.

Common fixes:
- `require.resolve` not callable in ESM → add the `createRequire` shim in worker.ts top.
- Missing `@types/node` → already in devDependencies; `pnpm install` should have pulled it.
- Module path `./workflows.js` vs `./workflows` mismatch → use `.js` suffix in imports for ESM Node resolution.

---

## Task 7: Run worker + trigger; verify HelloWorldWorkflow completes

**Files:** none authored; capture run output to scratch notes for use in Task 9.

- [ ] **Step 7.1: Confirm cluster + port-forward still up**

```bash
nc -z localhost 7233 && echo "gRPC up" || echo "gRPC DOWN — restart port-forward"
curl -sf http://localhost:8080/ -o /dev/null && echo "Web UI up" || echo "Web UI DOWN"
kubectl get pods -n temporal
```

If either is down, restart `make port-forward` from `/infra/temporal/`.

- [ ] **Step 7.2: Run the hello flow**

```bash
cd sprint-0/temporal-sdk-validation
pnpm run hello 2>&1 | tee /tmp/temporal-hello.log
```

Expected output (last lines):
```
[worker] Worker connected to localhost:7233, namespace="default", polling task queue "hello-baseline"
Started workflow hello-1747...
Result: Hello, world!
```

If the workflow starts but never returns:
- Check worker logs in `/tmp/temporal-hello.log` — is the workflow actually executing?
- Inspect the workflow in the Web UI at http://localhost:8080 — find `hello-<timestamp>` and check its History pane for stuck activity.
- Common cause: workflow code path mismatch (the worker bundles `workflows.ts` separately; if the import path is wrong, the workflow never registers and the activity never schedules).

- [ ] **Step 7.3: Capture observability sample for the baseline log**

```bash
# Web UI workflow state via API
WORKFLOW_ID=$(grep -o 'hello-[0-9]*' /tmp/temporal-hello.log | head -1)
curl -s "http://localhost:8080/api/v1/namespaces/default/workflows/$WORKFLOW_ID" \
  | tee /tmp/temporal-workflow-state.json

# Prometheus metrics scrape (port + path may vary by chart version; adjust if needed)
kubectl port-forward -n temporal svc/temporal-baseline-frontend-headless 9090:9090 &
PF_PID=$!
sleep 2
curl -s http://localhost:9090/metrics 2>/dev/null | head -50 | tee /tmp/temporal-metrics-sample.txt
kill $PF_PID 2>/dev/null
```

If the metrics endpoint is on a different port (some chart versions expose 8000 or 9091), inspect `kubectl get svc -n temporal` for available ports and retry. Capture at least 50 lines of Prometheus-format output.

- [ ] **Step 7.4: Snapshot pod state for the log**

```bash
kubectl get pods -n temporal -o wide | tee /tmp/temporal-pods-final.log
helm list -n temporal | tee /tmp/temporal-helm-list.log
helm get values temporal-baseline -n temporal | tee /tmp/temporal-helm-values-applied.log
```

- [ ] **Step 7.5: Note tool versions for the Environment section**

```bash
{
  echo "=== tool versions ==="
  echo "kind: $(kind version)"
  echo "helm: $(helm version --short)"
  echo "kubectl: $(kubectl version --client -o json | grep gitVersion | head -1)"
  echo "node: $(node --version)"
  echo "pnpm: $(pnpm --version)"
  echo "docker: $(docker version --format '{{.Server.Version}}')"
  echo "macOS: $(sw_vers -productVersion)"
} | tee /tmp/temporal-env.log
```

---

## Task 8: Commit /sprint-0/temporal-sdk-validation/ work

- [ ] **Step 8.1: Add the sprint-0 directory**

```bash
cd /Users/lion/Documents/Projects/mine/ncall-clone
git add sprint-0/temporal-sdk-validation/
git status   # verify only sprint-0/temporal-sdk-validation/* staged
```

If `pnpm-lock.yaml` is staged, that's expected — keep it; it pins the SDK version transitively.

If `node_modules/` is staged: stop. Add `node_modules/` to a `.gitignore` (root or sprint-0-local) before committing.

- [ ] **Step 8.2: Create commit #2**

```bash
git commit -m "$(cat <<'EOF'
feat(sprint-0): add temporal-sdk-validation worker for ADR-0015 §Evidence partial check

Smallest viable Temporal worker exercising the TypeScript SDK against the
local self-host baseline. HelloWorldWorkflow + sayHello activity total ~40
lines across 4 files. Per ADR-0015 §Evidence item 1 "smallest workflow"
specification; no signals, queries, Search Attributes, timers, or child
workflows (those are MVP-tier exercise).

Cloud-side identity validation accepted on Temporal's published portability
docs per the ADR §Evidence escape hatch — Cloud sandbox not signed up in
Sprint-0 scope, leaving Open Risk #4 as documented residual.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8.3: Verify commit**

```bash
git log --oneline -2
```

Expected: two new commits at HEAD (infra + sprint-0).

---

## Task 9: Author docs/adr/0015-selfhost-baseline-log.md

**Files:**
- Create: `/docs/adr/0015-selfhost-baseline-log.md`

- [ ] **Step 9.1: Author the file using captured evidence from Task 3 + Task 7**

Write `/docs/adr/0015-selfhost-baseline-log.md`. Replace `<...>` placeholders with values from the relevant `/tmp/temporal-*.log` files.

```markdown
# ADR-0015 §Evidence Item 2 — Self-host Operational Baseline

> Sprint-0 evidence for ADR-0015 ratification (Proposed → Accepted). Captures the deployment + execution trace from a real run of the self-host baseline on local kind.

- **Date:** 2026-05-13
- **Branch:** `sprint-0/temporal-selfhost-baseline`
- **Spec:** [`docs/superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md`](../superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md)

## 1. Summary

ADR-0015 §Evidence item 2 satisfied: Temporal v\<X\> Helm chart deployed on local kind K8s; PG + ES bundled via Bitnami subcharts; HelloWorldWorkflow ran end-to-end. All deliverables under [`/infra/temporal/`](../../infra/temporal/) and [`/sprint-0/temporal-sdk-validation/`](../../sprint-0/temporal-sdk-validation/).

## 2. Environment

(Paste from `/tmp/temporal-env.log`.)

```
kind: <kind version>
helm: <helm version>
kubectl: <kubectl version>
node: <node version>
pnpm: <pnpm version>
docker: <docker version>
macOS: <macos version>
Temporal Helm chart: <chart version pinned in Chart.lock>
```

## 3. Deployment trace

`make cluster-up` excerpt (from `/tmp/temporal-cluster-up.log`):

```
<paste relevant lines: "Creating cluster", "Ensuring node image", node Ready confirmation>
```

`make chart-install` excerpt (from `/tmp/temporal-chart-install.log`):

```
<paste relevant lines: helm repo add output, "STATUS: deployed", revision number>
```

`kubectl get pods -n temporal` (from `/tmp/temporal-pods.log`):

```
<paste full pod listing showing all Running / schema-setup Completed>
```

Schema-setup Job confirmation (`kubectl logs -n temporal job/temporal-baseline-schema-setup`):

```
<paste schema-setup output showing PG schemas + ES indices created>
```

## 4. Workflow execution trace

`pnpm run hello` output (from `/tmp/temporal-hello.log`):

```
<paste full output: "Worker connected", "polling task queue", "Started workflow", "Result: Hello, world!">
```

## 5. Observability sample

Web UI workflow state via API (from `/tmp/temporal-workflow-state.json`):

```json
<paste workflow state JSON showing "executionStatus": "WORKFLOW_EXECUTION_STATUS_COMPLETED">
```

Prometheus metrics scrape, first 50 lines (from `/tmp/temporal-metrics-sample.txt`):

```
<paste first 50 lines of Prometheus-format metrics from the frontend or history service>
```

## 6. Caveats explicitly carried forward

These are baseline-acceptable but production-target deltas. Each is captured as a comment in `values.yaml` for the future EU-K8s deployment task:

a. **Bundled PG + ES are not production-shaped.** Production target uses external managed PG (RDS/Hetzner/Scaleway eu-region) and external managed Elasticsearch. The `values.yaml` (production-shaped, unrun) documents this.

b. **No mTLS exercised.** Local baseline uses plain TCP between worker and frontend. Production uses mTLS with cert-manager-issued certs from an internal CA. **This is part of ADR-0015 Open Risk #4** — the auth path is the most likely place for SDK identity to break between Cloud (mTLS or API-key) and self-host configurations.

c. **Single-node, no HA, no replication, no DR.** Production target has 3 replicas per Temporal service, PG primary + replicas, ES with replication, PodDisruptionBudgets, anti-affinity, periodic backup-restore drills. Sprint-N platform-eng work.

d. **No version-upgrade drill.** Helm chart upgrades from version X to X+1 not exercised. Sprint-N platform-eng work.

## 7. Ratification recommendation

ADR-0015 §Evidence item 2 satisfied. §Evidence item 3 (sales outreach, optional/parallel) tracked separately (no Sprint-0 work scheduled this session).

**Status flip recommendation:** Proposed → Accepted, conditional on §Evidence item 1 also satisfied (see [`0015-sdk-identity-evidence.md`](./0015-sdk-identity-evidence.md)).

**ADR-0015 status flip Proposed → Accepted requires user OK; do not commit the status flip without explicit authorisation.**
```

- [ ] **Step 9.2: Verify the file exists**

```bash
ls -la docs/adr/0015-selfhost-baseline-log.md
wc -l docs/adr/0015-selfhost-baseline-log.md
```

Expected: file exists; rough line count 80–150.

---

## Task 10: Author docs/adr/0015-sdk-identity-evidence.md

**Files:**
- Create: `/docs/adr/0015-sdk-identity-evidence.md`

- [ ] **Step 10.1: Resolve Temporal portability docs citation via Context7**

Use the Context7 MCP tool:
- Call `query-docs` with the Temporal docs library ID (resolved earlier in Step 0.6) and question "Where in Temporal's documentation is the SDK portability between Temporal Cloud and self-host explicitly stated? I need a quotable passage about same worker code targeting either endpoint via connection-string + TLS config differences only."

Capture the doc URL + a 2–4 sentence quoted passage.

- [ ] **Step 10.2: Author the evidence file**

Write `/docs/adr/0015-sdk-identity-evidence.md`:

```markdown
# ADR-0015 §Evidence Item 1 — SDK Identity Validation (Partial Check)

> Sprint-0 evidence for ADR-0015 ratification (Proposed → Accepted) on the §Evidence escape hatch: self-host runs; Cloud-side claim accepted on Temporal's published portability docs.

- **Date:** 2026-05-13
- **Branch:** `sprint-0/temporal-selfhost-baseline`
- **Spec:** [`docs/superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md`](../superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md)

## 1. Summary

ADR-0015 §Evidence item 1 ratifies on a partial check (self-host runs; Cloud-side claim accepted on Temporal's published portability docs) per the §Evidence escape hatch:

> *"If Cloud-side validation remains blocked at Sprint-0 end, ratify on a documented partial check (self-host runs; Cloud-side claim accepted on Temporal's published portability docs) and flag the residual risk in Consequences."* — ADR-0015 §Evidence item 1

Open Risk #4 (G0 sign-off proposal §Open risks) retained as documented residual in ADR-0015 §Consequences.

## 2. Why partial, not full

Temporal Cloud sandbox not signed up in Sprint-0 baseline scope. The call was a deliberate trade-off taken during the brainstorm session (`docs/superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md`): strictly local execution vs ~10 min cloud sandbox signup. The user chose strictly local; the §Evidence escape hatch was pre-authorised for exactly this case.

Document this conscious choice so future readers don't think we forgot.

## 3. What was actually run

Source: [`/sprint-0/temporal-sdk-validation/`](../../sprint-0/temporal-sdk-validation/). Smallest viable Temporal worker, ~40 lines of TypeScript across 4 files.

### workflows.ts

```typescript
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities.js';

const { sayHello } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
});

export async function HelloWorldWorkflow(name: string): Promise<string> {
  return await sayHello(name);
}
```

### activities.ts

```typescript
export async function sayHello(name: string): Promise<string> {
  return `Hello, ${name}!`;
}
```

### worker.ts

(See [`src/worker.ts`](../../sprint-0/temporal-sdk-validation/src/worker.ts) for full file. Connects via `NativeConnection` to `selfhost.json` `address`, registers `HelloWorldWorkflow` + `sayHello`, polls task queue `hello-baseline`.)

### trigger.ts

(See [`src/trigger.ts`](../../sprint-0/temporal-sdk-validation/src/trigger.ts) for full file. Connects via `Client`, starts workflow with input `"world"`, awaits result.)

### Run output

(Paste from `/tmp/temporal-hello.log`.)

```
<paste full pnpm run hello output: worker logs through "Result: Hello, world!">
```

This output demonstrates:
- SDK package bootstraps (worker + client)
- gRPC connection to `localhost:7233` succeeds
- Workflow + activity registration succeeds
- Workflow scheduling, activity execution, result return all work end-to-end

## 4. Documentary basis for Cloud-side identity claim

Temporal's published documentation on SDK portability between Cloud and self-host endpoints:

**Source:** \<URL captured in Step 10.1\>

> *"\<paste 2-4 sentence quote captured in Step 10.1\>"*

Interpretation: the same worker code (`workflows.ts`, `activities.ts`, `worker.ts`, `trigger.ts` above) targets either a Temporal Cloud `<namespace>.tmprl.cloud:7233` endpoint or a self-host `localhost:7233` endpoint by changing only the `address` and `tls` fields of the connection config. The application layer (workflow definitions, activity functions, signal/query handlers, task queue routing) is unchanged.

This is the substantive content of ADR-0015's "SDK identity caveat" claim. Empirical validation against Cloud requires a Cloud endpoint to test against; partial check accepts the documented portability statement as basis for ADR ratification.

## 5. Residual risk + mitigation

**Open Risk #4 (verbatim from G0 sign-off proposal §Open risks):**

> *"Temporal SDK code identity between Cloud and self-host (S7 surfaced). Claimed in ADR-0015 but not validated. Sprint 0 validation is in the S7 plan above (§S7 Sprint-0 carry-overs). Risk: if SDK code is not identical (e.g., authentication paths differ in a way that bleeds into application code), Option C's "upgradeable later" claim fails and we are committed to whichever path we start on."*

**Status under this evidence:** partially mitigated (self-host side proven by §3 above; Cloud side accepted on §4 documentary basis). Residual risk = the auth-path dimension specifically (mTLS in Cloud vs plain TCP in our local baseline; API-key auth in newer Cloud configurations not exercised at all).

**Mitigation:**

a. **First MVP module touching Temporal workflows (M30 queue dequeue) validates SDK identity in passing** because it'll be running on the self-host cluster anyway; if its worker code uses any Cloud-only or self-host-only SDK feature, it'll be discovered there.

b. **If Temporal Cloud sandbox signup happens mid-MVP** (e.g., during the parallel sales correspondence per ADR-0015 §Evidence item 3), retroactively run the worker against it and upgrade this evidence file from partial to full.

c. **mTLS-specific dimension** is captured in [`0015-selfhost-baseline-log.md`](./0015-selfhost-baseline-log.md) §6 caveat (b) as the specific surface that remains unexercised. When EU-residency K8s deployment lands (Sprint-N), mTLS gets exercised against self-host at minimum.

## 6. Ratification recommendation

Proposed → Accepted on partial check, with **Open Risk #4 added to ADR-0015 §Consequences as a documented residual** (text proposed below; not yet committed to ADR-0015).

Suggested §Consequences amendment text:

> *"**Open Risk #4 (Sprint-0 residual):** SDK identity between Temporal Cloud and self-host endpoints validated only on the self-host side (per `docs/adr/0015-sdk-identity-evidence.md` partial check). Cloud-side validation deferred until a Cloud sandbox is available. Mitigation: first MVP workflow module (M30) catches divergence in passing; retroactive Cloud-side validation upgrades the evidence to full when sandbox lands."*

**ADR-0015 status flip Proposed → Accepted requires user OK; do not commit the status flip without explicit authorisation.**
```

- [ ] **Step 10.3: Verify the file exists**

```bash
ls -la docs/adr/0015-sdk-identity-evidence.md
wc -l docs/adr/0015-sdk-identity-evidence.md
```

Expected: file exists; rough line count 100–180.

---

## Task 11: Commit baseline log + sdk identity evidence

- [ ] **Step 11.1: Stage baseline log only (commit #3)**

```bash
git add docs/adr/0015-selfhost-baseline-log.md
git status   # verify only this file staged
```

- [ ] **Step 11.2: Create commit #3**

```bash
git commit -m "$(cat <<'EOF'
docs(adr): add 0015-selfhost-baseline-log.md — §Evidence item 2 satisfied

Captures the deployment + execution trace from running /infra/temporal/
on local kind: helm install output, pod state, schema-setup Job logs,
HelloWorldWorkflow execution, observability sample (Web UI workflow
state + Prometheus /metrics scrape), and the explicit caveats carried
forward (no mTLS, single-node, bundled PG/ES, no DR drill).

Recommends ADR-0015 ratification Proposed → Accepted conditional on
§Evidence item 1 (next commit) also satisfied. Status flip itself
deferred to a separate, user-authorised commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 11.3: Stage sdk identity evidence (commit #4)**

```bash
git add docs/adr/0015-sdk-identity-evidence.md
git status   # verify only this file staged
```

- [ ] **Step 11.4: Create commit #4**

```bash
git commit -m "$(cat <<'EOF'
docs(adr): add 0015-sdk-identity-evidence.md — §Evidence item 1 partial check

Documents the partial-check posture for SDK identity validation: self-host
side proven by /sprint-0/temporal-sdk-validation/ run against local kind
(see commit-2 worker code + commit-3 run trace); Cloud-side claim accepted
on Temporal's published portability docs per the §Evidence escape hatch.

Open Risk #4 (G0 proposal §Open risks) retained as documented residual.
Proposed §Consequences amendment text included for the status-flip commit.

Mitigation chain: M30 catches divergence in passing during MVP; if Cloud
sandbox signs up later, retroactive run upgrades partial → full.

Status flip itself deferred to a separate, user-authorised commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 11.5: Verify all four commits land**

```bash
git log --oneline -4
```

Expected:
```
<sha> docs(adr): add 0015-sdk-identity-evidence.md — §Evidence item 1 partial check
<sha> docs(adr): add 0015-selfhost-baseline-log.md — §Evidence item 2 satisfied
<sha> feat(sprint-0): add temporal-sdk-validation worker for ADR-0015 §Evidence partial check
<sha> feat(infra): add /infra/temporal/ Helm values + Makefile for self-host baseline
```

---

## Task 12: Surface ADR-0015 ratification proposal to user (no commit)

**Files:** none modified; this is a hand-back to the user, not an action.

- [ ] **Step 12.1: Surface the ratification proposal**

Write a concise message to the user covering:

a. **Both evidence files are committed** (`0015-selfhost-baseline-log.md` + `0015-sdk-identity-evidence.md`).

b. **ADR-0015 status flip is not yet committed.** Per `pot_spike_workflow` convention, status flips happen in a separate, user-authorised commit. Quote the convention from memory: *"Don't flip ADR Status from Proposed → Accepted unilaterally; surface evidence and let the user authorise the flip in a follow-up turn."*

c. **Proposed ratification commit shape** (do not run; show only):

```
docs(adr): ratify ADR-0015 Proposed → Accepted on partial-check + baseline evidence

§Evidence item 1 satisfied via partial check per §Evidence escape hatch
(0015-sdk-identity-evidence.md). §Evidence item 2 satisfied via local kind
+ Helm + bundled PG + ES + HelloWorldWorkflow run (0015-selfhost-baseline-log.md).
§Evidence item 3 (sales outreach) remains optional/parallel.

§Consequences amended to add Open Risk #4 (SDK identity Cloud-side
unvalidated) as documented residual with mitigation chain (M30 catches
divergence in passing; retroactive Cloud-side run upgrades partial → full
if sandbox arrives).

If Path A (Strict) is chosen at G0 sign-off, this commit reverts cleanly
along with ADR-0015 §Decision rewrite (commit 13ca47b).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

d. **Two edits the ratification commit makes** (show as a unified diff sketch the user can eyeball):

```diff
--- a/docs/adr/0015-temporal-cloud-tier.md
+++ b/docs/adr/0015-temporal-cloud-tier.md
@@ Status line @@
-- **Status:** Proposed (rewritten 2026-05-13; pending G0 sign-off ratification per [`pot/g0-signoff-proposal.md`](../../pot/g0-signoff-proposal.md))
+- **Status:** Accepted (rewritten + ratified 2026-05-13; per Sprint-0 evidence in `docs/adr/0015-selfhost-baseline-log.md` and `docs/adr/0015-sdk-identity-evidence.md`)

@@ Consequences §Negative @@
+- **Open Risk #4 (Sprint-0 residual):** SDK identity between Temporal Cloud and self-host endpoints validated only on the self-host side (per `docs/adr/0015-sdk-identity-evidence.md` partial check). Cloud-side validation deferred until a Cloud sandbox is available. Mitigation: first MVP workflow module (M30) catches divergence in passing; retroactive Cloud-side validation upgrades the evidence to full when sandbox lands.
```

e. **Ask the user explicitly:** "OK to commit the ratification? Or hold for G0 meeting first?"

f. **Memory update reminder.** Update `pot_spike_workflow.md` to reflect Sprint-0 work landing: S7 self-host baseline executed, evidence committed; if user OKs ratification, ADR-0015 moves to Accepted.

**Do not commit the ratification yourself. Wait for explicit user authorisation.**

---

## Task 13: (Conditional, gated on user OK) Ratification commit

**Run this task ONLY if the user has explicitly OK'd the ratification in response to Task 12.**

**Files:**
- Modify: `/docs/adr/0015-temporal-cloud-tier.md`

- [ ] **Step 13.1: Edit the ADR Status line**

Read `/docs/adr/0015-temporal-cloud-tier.md` first (already done in spec context), then edit the Status line:

Replace:
```
- **Status:** Proposed (rewritten 2026-05-13; pending G0 sign-off ratification per [`pot/g0-signoff-proposal.md`](../../pot/g0-signoff-proposal.md))
```

With:
```
- **Status:** Accepted (rewritten + ratified 2026-05-13; per Sprint-0 evidence in `docs/adr/0015-selfhost-baseline-log.md` and `docs/adr/0015-sdk-identity-evidence.md`)
```

- [ ] **Step 13.2: Append Open Risk #4 to §Consequences §Negative section**

Append to the end of the §Consequences §Negative section in `/docs/adr/0015-temporal-cloud-tier.md`:

```markdown
- **Open Risk #4 (Sprint-0 residual):** SDK identity between Temporal Cloud and self-host endpoints validated only on the self-host side (per `docs/adr/0015-sdk-identity-evidence.md` partial check). Cloud-side validation deferred until a Cloud sandbox is available. Mitigation: first MVP workflow module (M30) catches divergence in passing; retroactive Cloud-side validation upgrades the evidence to full when sandbox lands.
```

- [ ] **Step 13.3: Commit (commit #5, ratification)**

```bash
git add docs/adr/0015-temporal-cloud-tier.md
git status
git commit -m "$(cat <<'EOF'
docs(adr): ratify ADR-0015 Proposed → Accepted on partial-check + baseline evidence

§Evidence item 1 satisfied via partial check per §Evidence escape hatch
(0015-sdk-identity-evidence.md). §Evidence item 2 satisfied via local kind
+ Helm + bundled PG + ES + HelloWorldWorkflow run (0015-selfhost-baseline-log.md).
§Evidence item 3 (sales outreach) remains optional/parallel.

§Consequences amended to add Open Risk #4 (SDK identity Cloud-side
unvalidated) as documented residual with mitigation chain (M30 catches
divergence in passing; retroactive Cloud-side run upgrades partial → full
if sandbox arrives).

If Path A (Strict) is chosen at G0 sign-off, this commit reverts cleanly
along with ADR-0015 §Decision rewrite (commit 13ca47b).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 13.4: Verify all five commits**

```bash
git log --oneline -5
```

- [ ] **Step 13.5: Update `pot_spike_workflow.md` memory**

Update the auto-memory at `/Users/lion/.claude/projects/-Users-lion-Documents-Projects-mine-ncall-clone/memory/pot_spike_workflow.md`:

a. Move S7 from "Deferred" to "Completed (Green) + ratified" with reference to the new branch `sprint-0/temporal-selfhost-baseline` and the five commits.

b. Update the Branch chain to add `sprint-0/temporal-selfhost-baseline` off `pot/S6-ncall-fixture-capture`.

c. Update the Open items list to remove "S7 self-host operational baseline + SDK identity validation" from Sprint-0 work still open.

d. Update the description frontmatter line to reflect S7 ratification.

---

## Acceptance criteria checklist

These must all be true for the task to be complete (mirrors spec §9):

- [ ] `/infra/temporal/values.local.yaml` + `kind-cluster.yaml` + `Makefile` exist and are committed.
- [ ] `/infra/temporal/values.yaml` (production-shaped, unrun) exists with comments documenting deltas vs `values.local.yaml`.
- [ ] `make cluster-up && make chart-install` succeeds; `kubectl get pods -n temporal` shows all Running.
- [ ] `pnpm run hello` runs `HelloWorldWorkflow` end-to-end; trigger output prints `Result: Hello, world!`.
- [ ] `docs/adr/0015-selfhost-baseline-log.md` exists with all seven §6.2 sections from the spec populated from real run output.
- [ ] `docs/adr/0015-sdk-identity-evidence.md` exists with all six §6.1 sections from the spec populated, including Temporal docs citation and Open Risk #4 forwarding.
- [ ] User has OK'd the ADR-0015 status flip commit (Task 13, separate from the four content commits).

---

*Plan written 2026-05-13 from spec `docs/superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md` on branch `pot/S6-ncall-fixture-capture`. Implementation begins on a new branch `sprint-0/temporal-selfhost-baseline` per Task 0.*
