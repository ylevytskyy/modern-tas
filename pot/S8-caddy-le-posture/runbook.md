# S8 Runbook

## Setup

```
make up
```

Boots: caddy:2.10+, haproxy:3.0, k6:0.50, plus a dummy permission endpoint (Python http.server returning 403 for everything).

## Test

```
make test
```

What `make test` does:
1. Starts the k6 scenario from `fixtures/k6/sni-flood.js` — 1 k requests/sec to random unknown SNI hostnames for 10 minutes.
2. In parallel, samples Caddy's `/metrics` admin API every 5 s, extracting `caddy_certificates_managed_total` and storage I/O counters.
3. Samples HAProxy stats socket every 5 s for rate-limit drops.
4. After 10 min, computes storage RPS (delta cert events / wall time) and writes summary.md.

## Snapshot

```
make snapshot-results
```

## Teardown

```
make teardown
```
