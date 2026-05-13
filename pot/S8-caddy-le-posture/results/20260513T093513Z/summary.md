# S8 — Caddy 2.10+ on-demand TLS posture — readout

Run: `20260513T093513Z`  ·  Rate: 1000 req/sec  ·  Duration: 60s each scenario  ·  Pool: ? unknown SNIs

## Verdict: RED

permission-decision count (59243) is unbounded — Caddy is asking per-request, ADR-0019 architecture is broken on this config.

## Scenario A — k6 → HAProxy → Caddy

- k6 total requests: `60000`
- k6 effective RPS: `999.9555950218896`
- k6 failed requests: `59389`
- Permission decisions logged: `813`
- Distinct unknown SNIs that reached permission: `51`
- Permission decisions/sec (avg): `13.55`
- Caddy storage file count: pre=6 post=9

ADR-0019 expectation: HAProxy rate-limits before Caddy. `distinct_via` and `perm_via` should be SMALL (because HAProxy drops most connections before they reach Caddy's TLS handshake → no SNI extraction → no permission call). If permission RPS in this scenario is anywhere near k6_via_rps, HAProxy is not effectively rate-limiting.

## Scenario B — k6 → Caddy direct (HAProxy bypassed)

- k6 total requests: `59860`
- k6 effective RPS: `994.1615677964462`
- k6 failed requests: `59230`
- Permission decisions logged: `59243`
- Distinct unknown SNIs that reached permission: `51`
- Permission decisions/sec (avg): `987.38`
- Caddy storage file count: pre=9 post=9

ADR-0019 expectation: Caddy's declined-domain LRU absorbs repeated unknown-SNI requests. `distinct_direct` should converge to the SNI pool size (≈ ?) and `perm_direct` should be on the same order. If `perm_direct` grows with k6_direct_total instead, the LRU is broken (certmagic #174).

## Evidence files

```
drwxr-xr-x@ 20 lion  staff      640 May 13 12:37 .
drwxr-xr-x@ 10 lion  staff      320 May 13 12:35 ..
-rw-r--r--@  1 lion  staff   215347 May 13 12:37 caddy-metrics-direct-caddy.prom
-rw-r--r--@  1 lion  staff   207723 May 13 12:36 caddy-metrics-via-haproxy.prom
-rw-r--r--@  1 lion  staff      631 May 13 12:37 caddy-storage-post-direct-caddy.txt
-rw-r--r--@  1 lion  staff      631 May 13 12:36 caddy-storage-post-via-haproxy.txt
-rw-r--r--@  1 lion  staff      631 May 13 12:36 caddy-storage-pre-direct-caddy.txt
-rw-r--r--@  1 lion  staff      440 May 13 12:35 caddy-storage-pre-via-haproxy.txt
-rw-r--r--@  1 lion  staff    32997 May 13 12:37 haproxy-stats-direct-caddy.csv
-rw-r--r--@  1 lion  staff    32881 May 13 12:36 haproxy-stats-via-haproxy.csv
-rw-r--r--@  1 lion  staff  8646857 May 13 12:37 k6-direct-caddy-stdout.txt
-rw-r--r--   1 lion  staff     4611 May 13 12:37 k6-direct-caddy-summary.json
-rw-r--r--@  1 lion  staff  6912303 May 13 12:36 k6-via-haproxy-stdout.txt
-rw-r--r--   1 lion  staff     4435 May 13 12:36 k6-via-haproxy-summary.json
-rw-r--r--@  1 lion  staff  4964366 May 13 12:37 permission-queries-direct-caddy.jsonl
-rw-r--r--@  1 lion  staff    68021 May 13 12:36 permission-queries-pre-direct-caddy.jsonl
-rw-r--r--@  1 lion  staff    67953 May 13 12:36 permission-queries-via-haproxy.jsonl
-rw-r--r--@  1 lion  staff       10 May 13 12:35 smoke-permission.txt
-rw-r--r--@  1 lion  staff       56 May 13 12:35 smoke.txt
-rw-r--r--@  1 lion  staff        0 May 13 12:37 summary.md
```

## ADR-0019 status

Stays Proposed until the user authorises the flip. This run records the evidence for Sprint-0 ratification of ADR-0019 + ISRG exemption submission (the exemption is org-side and outside this spike's scope).
