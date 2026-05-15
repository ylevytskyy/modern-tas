# Telephone Answering Service (TAS)

A modern multi-tenant Telephone Answering Service (TAS) SaaS, currently at the **end of Phase 0 (Proof of Technology)** with one Sprint-0 deliverable landed. This repository holds the architecture documents, ADRs, and the first runnable artefact: a local self-hosted Temporal workflow engine that ratifies ADR-0015.

The product itself isn't built yet. There's no application binary, no database migrations, no API server. What you can run today is the **Temporal self-host baseline** described below — that's it.

---

## Current state (2026-05-14)

- **Phase 0 / PoT:** complete. 8 spikes visited; 5 Green and ratified, 3 Deferred with documented fallbacks. See `pot/pot-readout.md` and `pot/g0-signoff-proposal.md`.
- **Sprint-0 (S7 self-host Temporal baseline):** landed on the `sprint-0/temporal-selfhost-baseline` branch. ADR-0015 ratified Proposed → Accepted on partial-check evidence (conditional on G0 Path B sign-off).
- **G0 sign-off meeting:** not yet held. Proposal at `pot/g0-signoff-proposal.md` recommends Path B (Pragmatic) — extending the gate enum with "Deferred-with-fallback-plan".
- **MVP build:** not started; gated on G0 sign-off and remaining Sprint-0 work (S4 compliance review, S1 Layer 2, S8 Linux re-test).

---

## What you can run

The only runnable artefact right now is the **S7 self-host Temporal baseline**: a local Kubernetes cluster (via [kind](https://kind.sigs.k8s.io/)) running [Temporal](https://temporal.io) backed by PostgreSQL and Elasticsearch, plus a tiny TypeScript worker that runs a `HelloWorldWorkflow` against it end-to-end.

**Why this exists:** ADR-0015 (`docs/adr/0015-temporal-cloud-tier.md`) commits to self-hosted Temporal as the MVP-baseline workflow engine. To ratify that decision the project needs evidence the deployment actually works on the chosen stack. This baseline produces that evidence — both the deployment trace (`docs/adr/0015-selfhost-baseline-log.md`) and the SDK identity check (`docs/adr/0015-sdk-identity-evidence.md`).

**Time estimate:**
- First run: ~15 minutes (most of that is downloading container images).
- Subsequent runs: ~5 minutes.
- RAM cost while running: ~3 GB inside Docker.

---

## Prerequisites

You need **Docker** with at least **6 GB of memory** allocated to it, plus a handful of CLI tools.

### macOS

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and then bump its memory to ≥6 GB in **Preferences → Resources → Advanced**.

Then install the CLI tools via [Homebrew](https://brew.sh):

```bash
brew install kind helm kubectl node pnpm
```

(If you already have Node via [nvm](https://github.com/nvm-sh/nvm), you don't need `brew install node` — any Node ≥20 works. Then `npm install -g pnpm`.)

### Linux

Install [Docker Engine](https://docs.docker.com/engine/install/) following your distro's instructions, then make sure your user is in the `docker` group (`sudo usermod -aG docker $USER`, log out and back in).

Install the CLI tools (Debian/Ubuntu shown — adapt for other distros):

```bash
# kind (single binary)
curl -Lo /tmp/kind https://kind.sigs.k8s.io/dl/v0.31.0/kind-linux-amd64
sudo install -m 0755 /tmp/kind /usr/local/bin/kind

# helm (single binary)
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -m 0755 kubectl /usr/local/bin/kubectl

# Node 20+ via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20

# pnpm
npm install -g pnpm
```

### Verifying the prerequisites

Run this — it should print versions for everything and report Docker RAM:

```bash
kind version          # ≥ 0.27
helm version --short  # ≥ 3.12 (or 4.x)
kubectl version --client
node --version        # ≥ 20
pnpm --version
docker info | grep -E "Total Memory|CPUs"
```

If any tool is missing, install it before continuing. If Docker Memory is below 6 GB, raise it — Elasticsearch needs ~1 GB by itself and the cluster will OOM-loop otherwise.

---

## Quickstart — five steps to a running workflow

### 1. Get the code on the right branch

```bash
git clone <this-repo-url> tas
cd tas
git checkout sprint-0/temporal-selfhost-baseline
```

### 2. Bring up the Kubernetes cluster

```bash
cd infra/temporal
make cluster-up
```

This creates a single-node `kind` cluster called `temporal-baseline` running inside Docker. Takes ~30 seconds.

### 3. Install Temporal and its backing stores

```bash
make chart-install
```

This installs three Helm releases in sequence into the `temporal` namespace:

1. `temporal-pg` — PostgreSQL (Bitnami chart). Stores Temporal's workflow history.
2. `temporal-es` — Elasticsearch (official Elastic chart, v8.5.1). Stores Temporal's "advanced visibility" index used by the Web UI search.
3. `temporal-baseline` — Temporal itself, configured to talk to the PG and ES services above.

First run takes 5–10 minutes (image pulls). Subsequent runs are faster because Docker caches the images.

### 4. Create the `default` Temporal namespace

The Temporal Helm chart doesn't auto-create the `default` workflow namespace, so do it manually:

```bash
kubectl exec -n temporal deploy/temporal-baseline-admintools -- \
  temporal operator namespace create --namespace default
```

(You only need to do this once per cluster.)

### 5. Run the smoke test

In one terminal, forward the Temporal frontend port to your machine:

```bash
make port-forward
```

Leave it running. In a second terminal:

```bash
cd sprint-0/temporal-sdk-validation
pnpm install      # first run only — ~30 seconds
pnpm run hello
```

You should see output ending with:

```
[worker] Worker connected to localhost:7233, namespace="default", polling task queue "hello-baseline"
Started workflow hello-1747...
Result: Hello, world!
```

That's it — Temporal is running, the worker connected, the workflow executed, and the activity returned a result. **Cluster healthy. ADR-0015 §Evidence item 2 satisfied.**

---

## What you can poke around in

While the cluster is running and `make port-forward` is active:

**Temporal Web UI:** open <http://localhost:8080> in a browser. You can see your `hello-<timestamp>` workflow under the `default` namespace, click into it, and inspect the event history.

**Workflow state via API:**

```bash
curl -s http://localhost:8080/api/v1/namespaces/default/workflows/hello-<timestamp> | jq
```

**Pod state:**

```bash
kubectl get pods -n temporal
```

You should see frontend, history, matching, worker, web, admintools, postgresql, and elasticsearch pods all `Running`, plus a schema-setup Job pod `Completed`.

**Logs:**

```bash
kubectl logs -n temporal -l app.kubernetes.io/component=frontend --tail=100
```

---

## Tear down

When you're done, free the resources:

```bash
cd infra/temporal
make down
```

This deletes the kind cluster and everything in it. All workflow state is lost — that's expected for a local baseline.

---

## Troubleshooting

These are the failures we actually hit while building this baseline. If you hit one of them, the fix is documented.

**`make cluster-up` fails with "port already bound":** another container or process is using port 7233 or 8080 on your host. Find it with `lsof -i :7233` (and `:8080`), stop the offender, retry.

**A pod stuck in `CrashLoopBackOff`:**

```bash
kubectl logs -n temporal <pod-name> --previous
kubectl describe pod -n temporal <pod-name>
```

The most common cause is the `schema-setup` Job failing because PG isn't reachable yet (rare with `make chart-install` because Helm chains the releases with `--wait`, but possible if you ran the install steps manually out of order).

**`pnpm run hello` hangs at "polling task queue":** the worker connected fine but no workflow ever arrived. Check that the `default` namespace exists (Step 4 above) — if you skipped that, the trigger silently fails to enqueue. Verify with:

```bash
kubectl exec -n temporal deploy/temporal-baseline-admintools -- \
  temporal operator namespace list
```

`default` should be in the list with `State: Registered`.

**`pnpm install` complains about `allowBuilds`:** pnpm v11 requires explicit opt-in for native deps. The repo's `pnpm-workspace.yaml` already lists the three affected packages (`@swc/core`, `esbuild`, `protobufjs`) — if you're hitting this, you may have a different pnpm version. Either downgrade to pnpm v10, or run `pnpm install --allow-build='@swc/core,esbuild,protobufjs'` once.

**Elasticsearch pod OOM-killed:** Docker doesn't have enough memory. Bump Docker Desktop's allocation to 6 GB minimum (8 GB recommended). On Linux, this isn't usually a problem unless your machine has <8 GB total.

**`make port-forward` exits immediately:** the Temporal frontend or web service isn't ready. Run `make pods` and confirm everything shows `Running`. If frontend is still starting, wait 30 seconds and retry.

**After Ctrl-C on `make port-forward`, port 7233 still in use:** orphan `kubectl port-forward` processes survived. Kill them:

```bash
pkill -f "kubectl port-forward"
```

---

## Where to read more

- **Architecture:** [`ARCHITECTURE.v0.4.md`](./ARCHITECTURE.v0.4.md) — current architecture document. Older versions (`v0.2`, `v0.3`) preserved for history.
- **Product requirements:** [`PRD.v2.md`](./PRD.v2.md) — full PRD. Older `PRD.md` preserved.
- **Risks:** [`RISKS.v0.2.md`](./RISKS.v0.2.md) — current risk register. PoT spikes were designed to kill the load-bearing risks here.
- **Architecture Decision Records:** [`docs/adr/`](./docs/adr/) — six ratified decisions covering Supavisor pooling (0018), Temporal workflow engine (0015), Caddy LE posture (0019), ARI leader design (0016), queue dequeue budget (0024), and the redaction pipeline (0013, still Proposed).
- **PoT readout:** [`pot/pot-readout.md`](./pot/pot-readout.md) — per-spike measurement evidence.
- **G0 sign-off proposal:** [`pot/g0-signoff-proposal.md`](./pot/g0-signoff-proposal.md) — Path A vs Path B + per-Deferred-spike sub-decisions for the senior architect + compliance lead.
- **Sprint-0 spec for what you just ran:** [`docs/superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md`](./docs/superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md).
- **Sprint-0 implementation plan:** [`docs/superpowers/plans/2026-05-13-s7-selfhost-baseline.md`](./docs/superpowers/plans/2026-05-13-s7-selfhost-baseline.md).
- **Evidence the ADR-0015 ratification is built on:** [`docs/adr/0015-selfhost-baseline-log.md`](./docs/adr/0015-selfhost-baseline-log.md) (deployment trace) and [`docs/adr/0015-sdk-identity-evidence.md`](./docs/adr/0015-sdk-identity-evidence.md) (SDK identity, partial-check posture).

---

## Repository layout (quick map)

```
.
├── ARCHITECTURE.v0.4.md      Current architecture
├── PRD.v2.md                 Current PRD
├── RISKS.v0.2.md             Current risk register
├── docs/
│   ├── adr/                  Architecture Decision Records (numbered 0013-0024)
│   └── superpowers/
│       ├── specs/            Design specs (one per Sprint deliverable)
│       └── plans/            Implementation plans (one per spec)
├── infra/
│   └── temporal/             ← The Helm + kind baseline you ran above
├── pot/                      Phase 0 spike directories (S1-S8) + readout + G0 proposal
├── sprint-0/
│   └── temporal-sdk-validation/   ← The TypeScript worker you ran above
└── tools/                    Developer tools (CRM HAR scraper, etc.)
```

---

## Caveats

This is a **baseline**, not a production deployment. Specifically:

- **No mTLS** between worker and Temporal. Production uses mTLS; the local baseline uses plain TCP.
- **No persistence** — `enabled: false` on both PG and ES. All data is lost on pod restart. That's intentional; this is a smoke test, not a system of record.
- **Single node throughout.** No HA, no replication, no DR drill.
- **Bundled PG and ES** run inside the same kind cluster as Temporal. Production uses external managed PG + ES (the production-shape values are documented but unrun in `infra/temporal/values.yaml`).
- **Helm chart at v1.2.0**, ES chart at v8.5.1 (last published version of the official Elastic chart — production EU K8s should use the [ECK operator](https://www.elastic.co/guide/en/cloud-on-k8s/current/index.html) instead).
- **No Cloud-side validation.** The SDK identity claim is ratified on a partial check + Temporal's own portability docs. If you sign up for a Temporal Cloud sandbox later, you can copy `config/cloud.json.example` → `config/cloud.json`, fill in the values, and re-run the worker against it to upgrade the evidence to full.

These are all spelled out in `docs/adr/0015-selfhost-baseline-log.md` §6 if you want the full inventory.
