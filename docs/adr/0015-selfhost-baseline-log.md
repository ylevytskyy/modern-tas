# ADR-0015 §Evidence Item 2 — Self-host Operational Baseline

> Sprint-0 evidence for ADR-0015 ratification (Proposed → Accepted). Captures the deployment + execution trace from a real run of the self-host baseline on local kind.

- **Date:** 2026-05-13
- **Branch:** `sprint-0/temporal-selfhost-baseline`
- **Spec:** [`docs/superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md`](../superpowers/specs/2026-05-13-s7-selfhost-baseline-design.md)
- **Plan:** [`docs/superpowers/plans/2026-05-13-s7-selfhost-baseline.md`](../superpowers/plans/2026-05-13-s7-selfhost-baseline.md)

---

## 1. Summary

ADR-0015 §Evidence item 2 satisfied: Temporal v1.31 (chart 1.2.0) deployed via chained Helm releases on local kind K8s; bitnami/postgresql + elastic/elasticsearch as backing stores; HelloWorldWorkflow ran end-to-end.

---

## 2. Environment

```
kind:                kind v0.31.0 go1.25.5 darwin/arm64
helm:                v4.1.4+g05fa379  (plan assumed v3; see caveat g)
kubectl:             v1.34.1
node:                v24.13.1
pnpm:                11.0.9
docker:              29.3.1
macOS:               26.4.1
Temporal Helm chart: temporal-1.2.0  (Temporal server 1.31.0)
elasticsearch chart: elasticsearch-8.5.1  (official elastic/ chart; see caveat f)
postgresql chart:    postgresql-18.6.5  (bitnami/)
@temporalio/worker:  1.17.1  (sourced from sprint-0/temporal-sdk-validation/pnpm-lock.yaml — env capture script's `pnpm ls` parse left this field blank in /tmp/temporal-env.log; version corroborated by the @temporalio/common@1.17.1 path in /tmp/temporal-hello.log)
```

---

## 3. Deployment Trace

### 3.1 kind cluster boot

```
kind create cluster --config kind-cluster.yaml
Creating cluster "temporal-baseline" ...
 ✓ Ensuring node image (kindest/node:v1.35.0)
 ✓ Preparing nodes
 ✓ Writing configuration
 ✓ Starting control-plane
 ✓ Installing CNI
 ✓ Installing StorageClass
Set kubectl context to "kind-temporal-baseline"
Kubernetes control plane is running at https://127.0.0.1:49635
```

### 3.2 bitnami/postgresql install

```
helm upgrade --install temporal-pg bitnami/postgresql \
  --version 18.6.5 --namespace temporal --values values.postgresql.yaml --wait --timeout 5m

Release "temporal-pg" does not exist. Installing it now.
NAME: temporal-pg
LAST DEPLOYED: Wed May 13 21:19:56 2026
NAMESPACE: temporal
STATUS: deployed
REVISION: 1
DESCRIPTION: Install complete
```

Note: bitnami warns about August 2025 paywall on images (see caveat f — this only affected the elasticsearch subchart, not postgresql which still resolved via Docker Hub).

### 3.3 elastic/elasticsearch install

```
# Revisions 1-2 failed due to pod image-pull errors (bitnami/os-shell paywall).
# Revision 3 succeeded after switching to official elastic/elasticsearch chart.

Release "temporal-es" has been upgraded. Happy Helming!
NAME: temporal-es
LAST DEPLOYED: Wed May 13 21:45:45 2026
NAMESPACE: temporal
STATUS: deployed
REVISION: 3
DESCRIPTION: Upgrade complete
```

### 3.4 temporal/temporal helm install

```
Release "temporal-baseline" does not exist. Installing it now.
NAME: temporal-baseline
LAST DEPLOYED: Wed May 13 21:57:22 2026
NAMESPACE: temporal
STATUS: deployed
REVISION: 1
DESCRIPTION: Install complete
```

### 3.5 helm list

```
NAME              NAMESPACE  REVISION  UPDATED                               STATUS    CHART               APP VERSION
temporal-baseline temporal   1         2026-05-13 21:57:22.754176 +0300 EEST deployed  temporal-1.2.0      1.31.0
temporal-es       temporal   3         2026-05-13 21:45:45.500991 +0300 EEST deployed  elasticsearch-8.5.1 8.5.1
temporal-pg       temporal   1         2026-05-13 21:19:56.463995 +0300 EEST deployed  postgresql-18.6.5   18.3.0
```

### 3.6 pods ready

```
NAME                                            READY   STATUS      RESTARTS   AGE
elasticsearch-master-0                          1/1     Running     0          13m
temporal-baseline-admintools-6b79677ccf-z98j2   1/1     Running     0          31s
temporal-baseline-frontend-58bb55886b-8jfmq     1/1     Running     0          31s
temporal-baseline-history-75966dd886-j5cxg      1/1     Running     0          31s
temporal-baseline-matching-5f8764fc69-sw2mt     1/1     Running     0          31s
temporal-baseline-schema-1-2-0-1-nph9x          0/1     Completed   0          37s
temporal-baseline-web-7776db59b9-44wjp          1/1     Running     0          31s
temporal-baseline-worker-5fdf87c4b8-nmz8v       1/1     Running     0          31s
temporal-pg-postgresql-0                        1/1     Running     0          38m
```

### 3.7 schema-setup Job

```
INFO  Schema setup complete
INFO  UpdateSchemaTask started  {"config": {"SchemaDir": ".../postgresql/v12/temporal/versioned", ...}}
INFO  UpdateSchemaTask done  (found zero updates from current version 1.19)
INFO  Template created successfully  {"templateName": "temporal_visibility_v1_template"}
INFO  Index created successfully     {"indexName": "temporal_visibility_v1"}
INFO  Index mappings updated successfully  {"indexName": "temporal_visibility_v1"}
Store setup completed
```

(One ES deprecation warning: legacy index templates vs composable templates — benign for this chart version.)

---

## 4. Workflow Execution Trace

```
$ tsx src/run-hello.ts
[worker] webpack 5.106.2 compiled successfully in 419 ms
        { sdkComponent: 'worker', taskQueue: 'hello-baseline' }
[worker] Workflow bundle created { size: '1.40MB', taskQueue: 'hello-baseline' }
[worker] Worker connected to localhost:7233, namespace="default", polling task queue "hello-baseline"
[worker] Worker state changed { state: 'RUNNING', taskQueue: 'hello-baseline' }
Started workflow hello-1778699361988
Result: Hello, world!
```

---

## 5. Observability Sample

### 5.1 Web UI workflow-state (abbreviated)

```json
{
  "workflowExecutionInfo": {
    "execution": {
      "workflowId": "hello-1778699361988",
      "runId": "019e22be-5ecf-7f04-8c1a-850b952a8720"
    },
    "type": { "name": "HelloWorldWorkflow" },
    "startTime": "2026-05-13T19:09:21.999990209Z",
    "closeTime": "2026-05-13T19:09:22.106597834Z",
    "status": "WORKFLOW_EXECUTION_STATUS_COMPLETED",
    "historyLength": "11",
    "executionDuration": "0.106607625s",
    "taskQueue": "hello-baseline"
  }
}
```

### 5.2 Prometheus /metrics (first ~40 lines)

```
# HELP action action counter
# TYPE action counter
action{action_type="command_ScheduleActivityTask",namespace="default",...} 1
action{action_type="grpc_StartWorkflowExecution",namespace="default",...} 1

# HELP build_information build_information gauge
# TYPE build_information gauge
build_information{build_version="1_31_0",build_platform="arm64",
  git_revision="83881961df2bad7d78d93a2d50778dbc8bd1a2fc",
  go_version="go1_26_2",service_name="frontend"} 1

# HELP client_errors client_errors counter
# TYPE client_errors counter
client_errors{error_type="serviceerror_Canceled",
  operation="MatchingClientPollActivityTaskQueue",namespace="default",...} 10
client_errors{error_type="serviceerror_Canceled",
  operation="MatchingClientPollWorkflowTaskQueue",namespace="default",...} 10
client_errors{error_type="serviceerror_NotFound",
  operation="HistoryClientDescribeWorkflowExecution",...} 1

# HELP client_latency client_latency histogram
# TYPE client_latency histogram
client_latency_bucket{operation="HistoryClientDescribeWorkflowExecution",
  service_role="history",le="0.005"} 2
...
```

Real Prometheus-format output confirmed; `build_version="1_31_0"` matches chart APP VERSION 1.31.0.

---

## 6. Caveats Carried Forward

**(a) Bundled PG + ES subcharts removed in chart v1.0.0-rc.2+.**
The temporal/temporal chart dropped its bundled `postgresql` and `elasticsearch` subcharts in v1.0.0-rc.2. Deployed bitnami/postgresql and elastic/elasticsearch as separate Helm releases; rewrote `values.local.yaml` to use the new `server.config.persistence.datastores.*` schema. Production target uses external managed PG/ES (RDS + Hetzner/Scaleway EU-region).

**(b) No mTLS exercised.**
Open Risk #4 from G0 proposal. Feeds into [`0015-sdk-identity-evidence.md`](./0015-sdk-identity-evidence.md).

**(c) Single-node, no HA, no replication, no DR drill.**
Sprint-N platform-eng work.

**(d) No version-upgrade drill.**
Sprint-N platform-eng work.

**(e) `default` Temporal namespace was NOT auto-created by the Helm chart.**
Created manually via `temporal operator namespace create default` (run inside the admintools pod via `kubectl exec`). Known pitfall for Sprint-N EU K8s deployment. Future Makefile improvement: add a `temporal-namespace-create` target.

**(f) bitnami/elasticsearch v21+ behind paywall (August 2025).**
`bitnami/os-shell` init container images were gated in August 2025. Switched to official `elastic/elasticsearch` chart v8.5.1. Note: this chart has been unmaintained since mid-2023 (last published 8.5.1). Future production deployments should use ECK operator or a community-maintained chart.

**(g) Helm v4.1.4 used (plan assumed v3.x).**
Chart deployed cleanly; no Helm 4 compatibility issues surfaced.

**(h) pnpm v11 `allowBuilds` opt-in required.**
Native deps (`@swc/core`, `esbuild`, `protobufjs`) require explicit `allowBuilds` in `pnpm-workspace.yaml`. Sprint-0 PoC Slice 1 pnpm workspace setup should normalise this.

---

## 7. Ratification Recommendation

ADR-0015 §Evidence item 2 satisfied. §Evidence item 3 (sales outreach, optional/parallel) tracked separately. Status flip recommendation: Proposed → Accepted, conditional on §Evidence item 1 also satisfied (see [`0015-sdk-identity-evidence.md`](./0015-sdk-identity-evidence.md)).

---

*ADR-0015 status flip Proposed → Accepted requires user OK; do not commit the status flip without explicit authorisation.*
