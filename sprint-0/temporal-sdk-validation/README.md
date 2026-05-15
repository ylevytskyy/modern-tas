# temporal-sdk-validation

**ADR-0015 §Evidence item 1 partial-check worker.**

Smallest viable Temporal TypeScript SDK worker exercising `HelloWorldWorkflow` + `sayHello` activity against the local self-host baseline cluster deployed in `infra/temporal/`.

## Partial-check posture

Cloud-side identity validation is **not** exercised in Sprint-0. Per ADR-0015 §Evidence escape hatch, Cloud-side SDK identity is accepted on [Temporal's published portability docs](https://docs.temporal.io/cloud). Open Risk #4 remains a documented residual until a Cloud sandbox is provisioned.

## Prerequisites

- `kubectl` pointed at the local kind cluster (see `infra/temporal/Makefile`)
- Temporal cluster running (`kubectl get pods -n temporal` — all Running)
- `node >= 20`, `pnpm >= 9`

## Setup

```bash
pnpm install
```

## Running

### 1. Start port-forward

In a separate terminal (or use `infra/temporal/Makefile`):

```bash
kubectl port-forward -n temporal svc/temporal-baseline-frontend 7233:7233
```

### 2. Run the hello-world end-to-end

```bash
pnpm run hello
```

Expected output:
```
[worker] Worker connected to localhost:7233, namespace="default", polling task queue "hello-baseline"
Started workflow hello-1747...
Result: Hello, world!
```

### 3. Run worker and trigger separately

```bash
# Terminal 1
pnpm run worker

# Terminal 2
pnpm run trigger
```

## Configuration

- `config/selfhost.json` — local cluster connection (no TLS)
- `config/cloud.json.example` — template for Temporal Cloud (copy to `cloud.json` if/when Cloud sandbox is provisioned)

## References

- Plan: `docs/superpowers/plans/2026-05-13-s7-selfhost-baseline.md` (Tasks 5–8)
- ADR-0015: `docs/adr/0015-temporal-workflow-engine.md`
- Helm chain: `infra/temporal/`
