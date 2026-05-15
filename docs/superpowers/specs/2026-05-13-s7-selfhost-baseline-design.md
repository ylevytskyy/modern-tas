# S7 Self-host Temporal — Sprint-0 Baseline Design

> Sprint-0 carry-over from PoT spike S7 (Deferred-with-fallback-plan per `pot/g0-signoff-proposal.md` §S7). Produces the two evidence artefacts that ratify ADR-0015 from Proposed → Accepted.

- **Date drafted:** 2026-05-13
- **Source brainstorm session:** this document captures decisions from that session
- **Branch (planned):** `sprint-0/temporal-selfhost-baseline` off `pot/S6-tas-fixture-capture`
- **Predecessor:** ADR-0015 §Decision rewrite (commit `13ca47b`, pending G0 sign-off ratification)
- **Successor:** writing-plans skill creates the implementation plan from this spec

## 1. Goal

Ratify ADR-0015 (Temporal workflow engine — self-host MVP-baseline, Cloud upgrade path) from **Proposed → Accepted** by producing the two evidence artefacts that ADR-0015 §Evidence names:

1. **SDK identity validation** — smallest worker code that proves the Temporal TypeScript SDK runs against a self-host endpoint. Cloud-side validation accepted on the documented partial-check escape hatch (§3.2 below).
2. **Self-host operational baseline** — Temporal Helm chart deployed on a local kind K8s cluster with bundled PostgreSQL + Elasticsearch, running the same `HelloWorldWorkflow` end-to-end.

Closing both deliverables converts ADR-0015's `Status: Proposed` (gated on Sprint-0 evidence per its §Evidence) into `Status: Accepted` with Open Risk #4 (SDK identity claim) carried forward as a documented residual in §Consequences.

## 2. Scope

### In scope

- Local kind K8s cluster definition (`kind-cluster.yaml`)
- Temporal upstream Helm chart deployment with bundled PG + ES subcharts (`/infra/temporal/values.local.yaml`, `Chart.lock`)
- Production-shaped Helm values authored but unrun (`/infra/temporal/values.yaml`) — comments document deltas vs `values.local.yaml`
- Smallest viable Temporal worker (`HelloWorldWorkflow` + `sayHello` activity) in TypeScript using `@temporalio/worker` + `@temporalio/client`
- Run logs, observability sample (one `/metrics` scrape, one Web UI workflow-state JSON pull)
- Two evidence files in `docs/adr/`
- ADR-0015 ratification commit (separate, requires explicit user OK before commit per `pot_spike_workflow` convention)

### Out of scope (explicit non-goals)

- **Real EU K8s cluster.** No cloud provider account, no `kubectl apply` against anything beyond local kind. Deferred to a future platform-eng task once a real EU K8s cluster is provisioned.
- **Cloud-side SDK identity validation.** No Temporal Cloud sandbox signup. SDK identity ratifies on partial check + Temporal's published portability docs. ADR-0015 §Evidence pre-authorises this fallback. Open Risk #4 stays as documented residual.
- **mTLS in self-host.** Local Temporal accepts plain TCP from the worker. Cloud uses mTLS. The auth-path dimension of SDK identity is therefore not exercised — captured in Open Risk #4.
- **Prometheus/Grafana stack.** "Basic observability" satisfied by Temporal Web UI port-forward + one `curl /metrics` scrape. Full observability stack is MVP work.
- **Beyond-minimal workflow primitives.** No signals, no queries, no Search Attributes, no timers, no child workflows. ADR-0015 §Evidence says "smallest workflow"; we do exactly that.
- **Load test, DR rehearsal, version-upgrade drill.** ADR-0015 §Consequences names these as future work.
- **Workspace setup (`pnpm-workspace.yaml`).** `/sprint-0/temporal-sdk-validation/` is a standalone pnpm package; workspace root lands with PoC Slice 1 Task 0.
- **PoC tracer-bullet work.** This is Sprint-0 ratification work; PoC Slice 1 is a separate, G0-gated workstream per `poc-scope-decided` memory.

### Caveat about ADR-0015's "v1.0.0" version pin

ADR-0015 §Decision says "self-hosted Temporal via the v1.0.0 Helm chart". Temporal *server* is on v1.27+; "v1.0.0" most likely refers to the **Helm chart** version (or is a placeholder). Implementation Step 0 verifies the actual current chart version via Context7 against `https://go.temporal.io/helm-charts`. If the actual current version differs:

- Pin to actual current LTS in `Chart.lock`.
- Flag the ADR-0015 version-pin discrepancy as an inline ADR amendment (same pattern as ADR-0016 / ADR-0019 amendments from S3 / S8 spikes).

## 3. Architecture

### 3.1 Component diagram

```
┌─────────────────────── Local laptop (macOS) ───────────────────────┐
│                                                                    │
│   Docker Desktop                                                   │
│   ┌──────────────────────────────────────────────────────────┐     │
│   │  kind cluster: temporal-baseline                         │     │
│   │  ┌────────────────────────────────────────────────────┐  │     │
│   │  │ namespace: temporal                                │  │     │
│   │  │  ┌─ frontend (gRPC :7233) ──┐  ┌─ web UI :8080 ─┐ │  │     │
│   │  │  │   matching                │  │                │ │  │     │
│   │  │  │   history                 │  │                │ │  │     │
│   │  │  │   worker-system           │  │                │ │  │     │
│   │  │  └─ admintools (debug pod) ─┘  └────────────────┘ │  │     │
│   │  │                                                    │  │     │
│   │  │  ┌─ postgresql (Bitnami subchart)               ─┐ │  │     │
│   │  │  │   persistence + visibility schemas            │ │  │     │
│   │  │  └───────────────────────────────────────────────┘ │  │     │
│   │  │                                                    │  │     │
│   │  │  ┌─ elasticsearch (Bitnami subchart, 1 node)    ─┐ │  │     │
│   │  │  │   advanced visibility queries                 │ │  │     │
│   │  │  └───────────────────────────────────────────────┘ │  │     │
│   │  │                                                    │  │     │
│   │  │  ┌─ schema-setup Job (idempotent on install)    ─┐ │  │     │
│   │  │  └───────────────────────────────────────────────┘ │  │     │
│   │  └────────────────────────────────────────────────────┘  │     │
│   └──────────────────────────────────────────────────────────┘     │
│             │ kubectl port-forward 7233 + 8080                     │
│             ▼                                                      │
│   ┌──────────────────────────────────────────────────────────┐     │
│   │  Node.js worker (TypeScript, @temporalio/worker)         │     │
│   │   - registers HelloWorldWorkflow                         │     │
│   │   - registers sayHello activity                          │     │
│   │   - polls task queue "hello-baseline"                    │     │
│   │                                                          │     │
│   │  Node.js trigger script (@temporalio/client)             │     │
│   │   - starts workflow with input "world"                   │     │
│   │   - awaits result, prints to stdout                      │     │
│   └──────────────────────────────────────────────────────────┘     │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 3.2 Component decisions + rationale

| Component | Choice | Why |
|---|---|---|
| Local K8s | **kind** | The Helm chart is the actual `/infra/temporal/` deliverable. Running it via Helm validates that the chart parses, schema-setup Jobs run, and subchart sequencing works. docker-compose would validate "Temporal works" but not "the Helm chart we'd deploy works". |
| PostgreSQL | **bundled** (Bitnami subchart) | Upstream Temporal chart's default. Holds `temporal` (persistence) + `temporal_visibility` (basic visibility) databases. Production EU K8s would split or use external PG; comments in `values.yaml` document the delta. |
| Elasticsearch | **bundled** (Bitnami subchart, 1 node, no replica) | ADR-0015 names ES for "advanced visibility queries". ~1 GB heap; tunable down for laptops. |
| Worker location | **outside cluster** (Node.js process on host) | Matches how MVP NestJS workers run. Closer to real-world deployment than running the worker inside K8s. |
| TLS | **plain TCP** in local self-host | Cloud uses mTLS; we don't validate that dimension under partial-check posture. Captured in Open Risk #4. |
| Observability | **port-forward + one `/metrics` scrape** | Prometheus stack is MVP work. Baseline shows Temporal exposes the surface; consumers come later. |

### 3.3 Resource budget

| Component | RAM | vCPU |
|---|---|---|
| kind control plane | ~0.5 GB | 0.5 |
| PostgreSQL | ~0.5 GB | 0.5 |
| Elasticsearch | ~1.0 GB | 1.0 |
| Temporal services (frontend/matching/history/worker-system) | ~0.5 GB | 0.5 |
| Worker (Node.js) | ~0.2 GB | 0.5 |
| **Total** | **~2.7 GB** | **~3.0** |

Should fit on any laptop with 8 GB+ free RAM. Docker Desktop default of 4 GB is too tight; bump to 6 GB minimum.

## 4. Repository layout

```
/infra/temporal/                              # ADR-0015 §Evidence-pinned location
  README.md                                   # how to deploy: prereqs, helm install, port-forward, smoke test
  Chart.lock                                  # pinned Helm chart version (Temporal upstream)
  values.yaml                                 # production-shaped values (PG + ES external, mTLS, EU residency notes)
  values.local.yaml                           # local-kind override: bundled PG + ES, smaller resource asks, no mTLS
  kind-cluster.yaml                           # 1-node kind cluster definition
  Makefile                                    # cluster-up / chart-install / port-forward / hello / down

/sprint-0/temporal-sdk-validation/            # NEW top-level dir, parallel to pot/
  README.md                                   # how to run worker + trigger
  package.json                                # @temporalio/worker, @temporalio/client, typescript (standalone, no workspace root)
  tsconfig.json
  src/
    workflows.ts                              # HelloWorldWorkflow definition
    activities.ts                             # sayHello activity
    worker.ts                                 # boots worker
    trigger.ts                                # client starts workflow + waits for result
  config/
    selfhost.json                             # localhost:7233, no TLS, namespace "default"
    cloud.json.example                        # placeholder + comment explaining partial-check posture

/docs/adr/
  0015-sdk-identity-evidence.md               # NEW: partial-check narrative + worker code snippets + run log
  0015-selfhost-baseline-log.md               # NEW: helm install output, kubectl get pods, web UI screenshot, /metrics scrape

/docs/superpowers/specs/
  2026-05-13-s7-selfhost-baseline-design.md   # this design doc
```

### 4.1 Why `/sprint-0/` as a new top-level dir

- Parallel to `pot/` — signals "post-PoT, pre-MVP" work without polluting `pot/`'s spike convention.
- Throwaway-ish (the SDK identity worker is not MVP code) so it shouldn't live in the eventual `apps/` or `packages/` workspace tree.
- Future Sprint-0 carry-overs (S1 Layer 2 rtpengine, S8 HAProxy Linux re-test, S6 cache-scrape evidence) get their own subdirs `/sprint-0/<task>/`.

### 4.2 Why `/infra/temporal/` is *not* under `/sprint-0/`

- ADR-0015 §Evidence explicitly pins `/infra/temporal/` as the deliverable path.
- Helm values + manifests are *durable* artefacts that MVP platform-eng will keep using; SDK validation worker is throwaway.

## 5. Test approach — the "smallest workflow"

```typescript
// workflows.ts — ~10 lines
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';

const { sayHello } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
});

export async function HelloWorldWorkflow(name: string): Promise<string> {
  return await sayHello(name);
}

// activities.ts — ~3 lines
export async function sayHello(name: string): Promise<string> {
  return `Hello, ${name}!`;
}

// worker.ts — ~15 lines
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import config from '../config/selfhost.json';

const connection = await NativeConnection.connect({ address: config.address });
const worker = await Worker.create({
  connection,
  namespace: config.namespace,
  taskQueue: 'hello-baseline',
  workflowsPath: require.resolve('./workflows'),
  activities,
});
await worker.run();

// trigger.ts — ~12 lines
import { Client, Connection } from '@temporalio/client';
import config from '../config/selfhost.json';

const connection = await Connection.connect({ address: config.address });
const client = new Client({ connection, namespace: config.namespace });
const handle = await client.workflow.start(HelloWorldWorkflow, {
  args: ['world'],
  taskQueue: 'hello-baseline',
  workflowId: `hello-${Date.now()}`,
});
console.log('Started workflow', handle.workflowId);
console.log('Result:', await handle.result());
```

**Total surface area: ~40 lines of TypeScript across 4 files.** Validates: SDK package boots, gRPC connection, worker registration, activity proxy, scheduling, execution, result return, client connect, workflow start, result await. Per ADR-0015 §Evidence "smallest workflow" — no signals, no queries, no Search Attributes, no timers, no child workflows.

### 5.1 What "passing" looks like

1. `make cluster-up` → kind cluster boots, all temporal pods Running.
2. `kubectl port-forward svc/temporal-frontend 7233:7233` (in background; or via Makefile target).
3. `npm run worker` → "Worker connected, polling task queue 'hello-baseline'".
4. `npm run trigger` → "Started workflow hello-1747...; Result: Hello, world!".
5. Web UI shows the workflow as Completed.

### 5.2 Failure modes captured for forensic value

If any of these fail, capture in `0015-selfhost-baseline-log.md` §troubleshooting:

- **Helm install fails** → values.yaml is wrong; (B) baseline fails before we even get to (A); fix and retry.
- **Pods stuck in CrashLoopBackOff** → schema-setup didn't run; check init Job; usually a PG password mismatch.
- **Worker can't connect** → port-forward not running, or namespace doesn't exist (Temporal default namespace is auto-created in the chart's default values; verify).
- **Workflow starts but never completes** → worker isn't polling that task queue, or activity registration is wrong.

Future re-runs (Temporal upgrades, EU K8s migration) inherit the prior-art for common pitfalls.

## 6. Evidence outputs

### 6.1 `docs/adr/0015-sdk-identity-evidence.md`

Structured to be defensible at G0 ratification. ~1 page. Sections:

1. **Summary** — one sentence: "ADR-0015 §Evidence item 1 ratifies on a partial check (self-host runs; Cloud-side claim accepted on Temporal's published portability docs) per the §Evidence escape hatch. Open Risk #4 retained as documented residual."
2. **Why partial, not full** — Cloud sandbox not signed up in Sprint-0 baseline scope; the call was a deliberate trade-off (10 min signup vs strictly local). Document the conscious choice so future readers don't think we forgot.
3. **What was actually run** — link to `/sprint-0/temporal-sdk-validation/`; show all four files (workflows.ts, activities.ts, worker.ts, trigger.ts) inline (~40 lines total); show the trigger output (`Hello, world!`); show the worker logs (workflow started → activity executed → workflow completed).
4. **Documentary basis for Cloud-side identity claim** — link to Temporal's published portability docs (Context7 lookup at implementation time) + quote the relevant passage. Specifically the SDK-portability statement: that the same worker code targets either endpoint via connection-config-only changes.
5. **Residual risk + mitigation** — Open Risk #4 verbatim from G0 proposal §Open risks; mitigation = "first MVP module touching workflows (M30 queue dequeue) validates SDK identity in passing because it'll be running on the self-host cluster anyway; if Cloud sandbox lands mid-MVP, retroactively run the worker against it and upgrade this evidence from partial to full".
6. **Ratification recommendation** — "Proposed → Accepted on partial check, with Open Risk #4 added to ADR-0015 §Consequences as a documented residual."

### 6.2 `docs/adr/0015-selfhost-baseline-log.md`

The "it actually runs" evidence. ~1 page. Sections:

1. **Summary** — "ADR-0015 §Evidence item 2 satisfied: Temporal v\<X\> Helm chart deployed on local kind K8s; PG + ES bundled; HelloWorldWorkflow ran end-to-end."
2. **Environment** — kind version, Docker version, helm version, Temporal Helm chart version (locked in `Chart.lock`), macOS version. Reproducibility minimum.
3. **Deployment trace** — `make cluster-up` output, `helm install` output (truncated to interesting lines), `kubectl get pods -n temporal` showing all Running, schema-setup Job logs (`Setting up schemas...` → `Done`).
4. **Workflow execution trace** — `make hello` output: trigger logs ("Started workflow ID=..."), worker logs ("Workflow started", "Activity 'sayHello' executed", "Workflow completed"), final result printed.
5. **Observability sample** — `curl http://localhost:8080/api/v1/namespaces/default/workflows/<id>` (Web UI API via port-forward) showing the workflow as Completed; one Prometheus-format `/metrics` scrape from the frontend or history service via port-forward (exact port + path resolved at implementation time per chart values), trimmed to ~50 lines, showing Temporal is exposing the metrics surface (no Grafana stack — just proof the surface exists).
6. **Caveats explicitly carried forward** — (a) bundled PG + ES not production-shaped; (b) no mTLS exercised; (c) single-node, no replication or HA; (d) no DR rehearsal. Each captured as values.yaml comment + this caveat list. Names what Sprint-N platform-eng owns.
7. **Ratification recommendation** — "Proposed → Accepted given §Evidence item 2 satisfied; §Evidence item 3 (sales outreach, optional/parallel) tracked separately."

Both files end with the same line: *"ADR-0015 status flip Proposed → Accepted requires user OK; do not commit the status flip without explicit authorisation."*

## 7. Branch + commit shape

### 7.1 Branch

```
git checkout -b sprint-0/temporal-selfhost-baseline pot/S6-tas-fixture-capture
```

Off the spike-chain tip — the work logically follows the in-flight G0 bundle (ADR-0015 rewrite at `13ca47b`, ARCH §2.4 amendment at `b948a9e`). Inheriting these commits as parents is the simplest representation of the dependency.

### 7.2 Commit shape

Mirrors the PoT spike convention from `pot_spike_workflow` memory.

```
1. feat(infra): add /infra/temporal/ Helm values + Makefile for self-host baseline
   - Chart.lock, values.local.yaml, values.yaml (commented), kind-cluster.yaml, Makefile, README

2. feat(sprint-0): add temporal-sdk-validation worker for ADR-0015 §Evidence partial check
   - package.json, tsconfig, src/{workflows,activities,worker,trigger}.ts, config/, README

3. docs(adr): add 0015-selfhost-baseline-log.md — §Evidence item 2 satisfied
   - Environment, deployment trace, workflow execution trace, observability sample, caveats

4. docs(adr): add 0015-sdk-identity-evidence.md — §Evidence item 1 partial check
   - Partial-check basis, worker code snippets, Temporal docs citation, Open Risk #4 forwarding

5. (Separate, requires user OK before committing)
   docs(adr): ratify ADR-0015 Proposed → Accepted on partial-check + baseline evidence
   - Status flip + §Consequences amendment adding Open Risk #4 as documented residual
```

Each commit body explains *why*, not just *what*. Footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

### 7.3 Not on this branch (Sprint-0 work that follows separately)

- S1 Layer 2 (rtpengine) on Linux host
- S6 cache-scrape evidence
- S4 compliance review session output
- Spike-chain merge to main (post-G0 sign-off)

## 8. Open implementation-time questions

These are deferred to the implementation plan, not this design:

1. **Helm chart version pinning.** Implementation Step 0 verifies current chart version via Context7. If it differs from "v1.0.0", pin the actual current version in `Chart.lock` and flag the ADR-0015 typo for inline amendment (same pattern as ADR-0016 / ADR-0019 from S3 / S8).
2. **macOS Docker Desktop quirks.** S1 hit `network_mode=host` no-op; S8 hit BusyBox `wget` IPv6 quirks. We may hit similar at the kind / Helm / port-forward boundary. Capture each in the baseline log §troubleshooting if encountered.
3. **Schema-setup Job idempotency.** First `helm install` runs the schema-setup Job; subsequent `helm upgrade --install` should skip cleanly. Verify; if it doesn't, document the upgrade procedure.

## 9. Acceptance criteria

This Sprint-0 task is complete when:

- [ ] `/infra/temporal/values.local.yaml` + `kind-cluster.yaml` + `Makefile` exist and are committed.
- [ ] `/infra/temporal/values.yaml` (production-shaped, unrun) exists with comments documenting deltas vs `values.local.yaml`.
- [ ] `make cluster-up && make chart-install` succeeds; `kubectl get pods -n temporal` shows all Running.
- [ ] `make hello` runs `HelloWorldWorkflow` end-to-end; trigger output prints `Result: Hello, world!`.
- [ ] `docs/adr/0015-selfhost-baseline-log.md` exists with all seven §6.2 sections populated from real run output.
- [ ] `docs/adr/0015-sdk-identity-evidence.md` exists with all six §6.1 sections populated, including Temporal docs citation and Open Risk #4 forwarding.
- [ ] User has OK'd the ADR-0015 status flip commit (separate from the four content commits).

## 10. Open risks carried forward

- **Open Risk #4 from G0 proposal** — Temporal SDK code identity between Cloud and self-host is the load-bearing claim for ADR-0015's "upgradeable later" property. Under partial check, this risk is accepted and forwarded into ADR-0015 §Consequences with mitigation = "first MVP workflow module (M30) catches divergence in passing".
- **Helm chart version drift.** ADR-0015 names "v1.0.0"; actual current chart version may differ. Pin to current LTS, flag the discrepancy.
- **macOS Docker Desktop limitations.** S1 + S8 both hit Docker Desktop quirks not present on Linux. Risk that some Helm chart resource expectation (e.g., StorageClass, Service type) doesn't behave identically on kind-on-Docker-Desktop.

## 11. References

- [ADR-0015 §Decision (rewritten)](../../adr/0015-temporal-cloud-tier.md) — primary path now self-host; ratifies on this evidence.
- [ADR-0015 §Evidence](../../adr/0015-temporal-cloud-tier.md#evidence) — names the two output files this design produces.
- [pot/g0-signoff-proposal.md §S7](../../../pot/g0-signoff-proposal.md) — adopted Option C parallel path.
- [pot/g0-signoff-proposal.md §Open risks #4](../../../pot/g0-signoff-proposal.md) — Temporal SDK identity risk forwarded as documented residual.
- [Temporal Helm chart upstream](https://go.temporal.io/helm-charts) — chart source.
- [Temporal SDK portability docs](https://docs.temporal.io/) — Context7-resolved at implementation time for §6.1 §4 citation.

---

*Drafted 2026-05-13 in brainstorm session on branch `pot/S6-tas-fixture-capture`. Implementation plan to be created next via the writing-plans skill.*
