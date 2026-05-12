# S8 — Caddy 2.10+ permission + LE rate-limit posture

## Hypothesis

The `permission http` endpoint sustains the storage-flood class (certmagic #174) and the LE rate-limit exemption application is in flight.

## Go/no-go signal

- **Green:** 1 k unknown-SNI probes/sec → permission endpoint declined-LRU absorbs, Caddy storage RPS stays under 50/sec, HAProxy rate-limits before Caddy is reached. Separately: ISRG exemption form submitted, 2–4 week turnaround acceptable.
- **Yellow:** Storage RPS 50–200/sec under flood; tunable headroom remains. ISRG exemption submitted but not yet processed.
- **Red:** Storage RPS > 200/sec — permission endpoint check is happening AFTER storage lookup. Caddy version pin moves up or HAProxy rate limit tightens.

## Owner role

SRE.

## Prereqs

- Docker 24+, Docker Compose v2.
- Host: 4 GB RAM (k6 load gen + Caddy + HAProxy).
- ISRG exemption form is **org-side** — track separately, not gated on this spike's runnable bits.
- No external accounts for the load test.

## Runbook

```
make up && make test && make snapshot-results
```

The k6 load test runs locally; storage thrash is observed via Caddy admin API metrics.

## Recording protocol

`results/<timestamp>/`:
- `k6-summary.json` — k6 output (req/sec, latencies, error rates)
- `caddy-storage-rps.csv` — sampled at 5 s intervals during the 10-min load
- `haproxy-stats.csv` — sampled HAProxy stats (rate-limit drops, throughput)
- `summary.md`
- `isrg-exemption-receipt.pdf` — manually attached when org submits the form

## Yellow remediation

If storage RPS 50–200/sec: tune Caddy `on_demand_tls.ask` LRU size up; document new minimum cache size.

## ADR linkage

Primary evidence for [ADR-0019 (Caddy 2.10+ on-demand TLS posture)](../../docs/adr/0019-caddy-le-posture.md).
