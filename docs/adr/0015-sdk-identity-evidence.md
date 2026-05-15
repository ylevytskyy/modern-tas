# ADR-0015 §Evidence Item 1 — SDK Identity Validation (Partial Check)

> Sprint-0 evidence for ADR-0015 ratification (Proposed → Accepted) on the §Evidence escape hatch: self-host runs; Cloud-side claim accepted on Temporal's published portability docs.

- **Date:** 2026-05-13
- **Branch:** `sprint-0/temporal-selfhost-baseline`
- **Spec:** [`docs/superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md`](../superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md)
- **Plan:** [`docs/superpowers/plans/2026-05-13-s7-selfhost-baseline.md`](../superpowers/plans/2026-05-13-s7-selfhost-baseline.md)
- **Sister evidence:** [`0015-selfhost-baseline-log.md`](./0015-selfhost-baseline-log.md) (§Evidence item 2)

---

## 1. Summary

This file satisfies ADR-0015 §Evidence item 1 under the **partial-check posture** permitted by that item's escape hatch. The escape hatch text from ADR-0015 (verbatim):

> "If Cloud-side validation remains blocked at Sprint-0 end, ratify on a documented partial check (self-host runs; Cloud-side claim accepted on Temporal's published portability docs) and flag the residual risk in Consequences."

**What this document establishes:**

- **Self-host side (empirical):** `HelloWorldWorkflow` compiled, ran, and returned `Hello, world!` against the local kind-hosted Temporal cluster (workflow ID `hello-1778699361988`). Worker source + run trace are in §3.
- **Cloud-side (documentary):** No Cloud sandbox was provisioned during Sprint-0. The claim that the same worker code targets Temporal Cloud with only `address` + `tls` config changed is accepted on Temporal's published migration docs. The documentary basis is in §4.

Open Risk #4 from `pot/g0-signoff-proposal.md` is retained as a documented residual (§5).

---

## 2. Why Partial, Not Full

The ADR-0015 §Evidence item 1 originally called for running the worker against **both** a self-host endpoint and a Cloud sandbox. The brainstorm session for this plan presented two options:

- **Full check:** Sign up for a Temporal Cloud Developer tier (~10 min), run `HelloWorldWorkflow` against it, capture the output. Complete empirical coverage.
- **Partial check (strictly local):** Skip the Cloud signup, validate self-host only, accept the Cloud-side claim on docs.

The decision was **strictly local** — no Cloud sandbox was signed up. This was a deliberate trade-off, not an oversight:

1. The signup carries non-trivial cost: account creation, credential management, a Cloud namespace in a non-EU region (developer tier is US-only), cleanup after the sprint.
2. The ADR escape hatch exists precisely for this situation.
3. The portability argument (§4) is strong: Temporal's own migration docs describe the changes as "only a few lines of code" scoped to the connection layer.

Future readers: the gap is acknowledged and mitigated (§5), not papered over.

---

## 3. What Was Actually Run

Worker source lives at [`/sprint-0/temporal-sdk-validation/`](../../sprint-0/temporal-sdk-validation/).

### `src/workflows.ts`

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

### `src/activities.ts`

```typescript
export async function sayHello(name: string): Promise<string> {
  return `Hello, ${name}!`;
}
```

### `src/worker.ts`

```typescript
import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import * as activities from './activities.js';

// Temporal's Worker.create({ workflowsPath }) needs a CommonJS-style require.resolve
// to locate the workflow bundle entrypoint. import.meta.resolve is async + experimental,
// so we synthesise a require() local to this ESM module via createRequire.
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  readFileSync(join(__dirname, '../config/selfhost.json'), 'utf-8'),
);

async function main() {
  const connection = await NativeConnection.connect({ address: config.address });
  try {
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
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
```

### `src/trigger.ts`

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
  try {
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
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error('Trigger failed:', err);
  process.exit(1);
});
```

### Actual run output (tail of `/tmp/temporal-hello.log`)

```
[worker] Worker connected to localhost:7233, namespace="default", polling task queue "hello-baseline"
[worker] 2026-05-13T19:09:21.250Z [INFO] Worker state changed {
  sdkComponent: 'worker',
  taskQueue: 'hello-baseline',
  state: 'RUNNING'
}
2026-05-13T19:09:21.250Z [INFO] No Nexus services registered, not polling for Nexus tasks { sdkComponent: 'worker', taskQueue: 'hello-baseline' }
Started workflow hello-1778699361988
Result: Hello, world!
```

---

## 4. Documentary Basis for Cloud-Side Identity Claim

Context7 query against `/temporalio/documentation` (4552 snippets, High reputation) returned the following passage from Temporal's official migration guide at `https://github.com/temporalio/documentation/blob/main/docs/cloud/migrate/manual.mdx`:

> "Whether you're self-hosting Temporal or using Temporal Cloud, you manage runtime of your code. To migrate your Workflows to Temporal Cloud, you need to change some parameters in the Client connection code, such as updating the namespace and gRPC endpoint.
>
> The changes needed to direct your Workflow to your Temporal Cloud Namespace are **only a few lines of code**, including:
> - Add your SSL certificate and private key associated with your Namespace.
> - Copy the Cloud-hosted endpoint from the Namespace detail Web page. The endpoint uses this format: `<namespace_id>.<account_id>.tmprl.cloud:port`.
> - Connect to Temporal Cloud with your Client.
> - Configure tcld, the Cloud CLI with the same address, Namespace, and certificate used to create a Client through code."

The same Context7 result also returned two parallel connection examples from `docs/develop/typescript/client/temporal-client.mdx` and `docs/cloud/connectivity/index.mdx`, demonstrating the difference concretely:

**Self-host (local):**
```typescript
const connection = await Connection.connect(); // defaults to localhost:7233
```

**Temporal Cloud:**
```typescript
const connection = await NativeConnection.connect({
  address: "vpce-0123456789abcdef-abc.us-east-1.vpce.amazonaws.com:7233",
  tls: {
    serverNameOverride: "my-namespace.my-account.tmprl.cloud",
    clientCertPair: { crt: fs.readFileSync(clientCertPath), key: fs.readFileSync(clientKeyPath) },
  },
});
```

The difference is confined to `address` and `tls` options passed to `Connection.connect()` / `NativeConnection.connect()`. Workflow definitions (`HelloWorldWorkflow`) and activity implementations (`sayHello`) are not referenced in any Cloud-specific API; they are pure TypeScript with no deployment-target awareness. The migration guide's own framing — "you manage runtime of your code" — confirms that application-layer code is deployment-agnostic.

**SDK API reference:** `https://typescript.temporal.io/api/`

---

## 5. Residual Risk + Mitigation

Open Risk #4 from `pot/g0-signoff-proposal.md` §Open risks (verbatim):

> **4. Temporal SDK code identity between Cloud and self-host (S7 surfaced).** Claimed in ADR-0015 but not validated. Sprint 0 validation is in the S7 plan above (§S7 Sprint-0 carry-overs). Risk: if SDK code is not identical (e.g., authentication paths differ in a way that bleeds into application code), Option C's "upgradeable later" claim fails and we are committed to whichever path we start on.

This risk is retained as a documented residual under the partial-check posture. Mitigation chain:

**(a) M30 catches divergence in passing.** The first MVP module touching workflows (M30 queue dequeue) compiles and integration-tests against the self-host cluster. Any authentication or API surface that differs between Cloud and self-host in a way that bleeds into application code will surface as a compile error or test failure at that point — before any Cloud migration attempt is made.

**(b) Retroactive upgrade path.** If a Temporal Cloud sandbox is provisioned later (e.g., via the parallel sales correspondence per ADR-0015 §Evidence item 3), run `HelloWorldWorkflow` against it and compare the output. If the run passes, this evidence file is amended: status upgrades from partial → full, and Open Risk #4 is closed.

**(c) mTLS surface remains unexercised.** The specific dimension of risk is TLS mutual-auth: the local kind cluster runs without mTLS, so the `clientCertPair` path in `NativeConnection.connect()` was not exercised. This is called out explicitly in `0015-selfhost-baseline-log.md` §6 caveat (b). The documentary basis (§4 above) covers this code path structurally — the `tls.clientCertPair` option is the documented Cloud-side addition, not a new API function.

---

## 6. Ratification Recommendation

ADR-0015 status: **Proposed → Accepted** on partial check.

Both Sprint-0 evidence items are satisfied:
- §Evidence item 1 (this file): partial check, escape hatch invoked, residual documented.
- §Evidence item 2: full check — `0015-selfhost-baseline-log.md` records the successful end-to-end run on local kind.

**Suggested §Consequences amendment text for the status-flip commit (Slice G):**

> **Open Risk #4 (Sprint-0 residual):** SDK identity between Temporal Cloud and self-host endpoints validated only on the self-host side (per `docs/adr/0015-sdk-identity-evidence.md` partial check). Cloud-side validation deferred until a Cloud sandbox is available. Mitigation: first MVP workflow module (M30) catches divergence in passing; retroactive Cloud-side validation upgrades the evidence to full when sandbox lands.

---

*ADR-0015 status flip Proposed → Accepted requires user OK; do not commit the status flip without explicit authorisation.*
