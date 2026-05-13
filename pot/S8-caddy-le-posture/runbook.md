# S8 Runbook

## Setup

```
make up
```

Boots: permission (Python http.server with allow-list + JSONL decision log), caddy:2.10.2-alpine (tls internal + on_demand_tls.ask), haproxy:3.0.6-alpine (TCP-mode SNI rate-limit + Caddy backend), plus a k6:0.50.0 service on the `driver` profile (started on demand by `make test`).

Static IPs on the `s8` network:

- permission: dynamic (referenced as `permission:8080`)
- caddy: `172.30.8.20`
- haproxy: `172.30.8.30`

Host-exposed ports:

- caddy admin: `localhost:2019`
- haproxy stats: `localhost:8404`

## Test

```
make test
```

What `make test` does:

1. Creates `results/<TS>/`.
2. Calls `scripts/run-test.sh <TS>` which orchestrates two scenarios + samplers.

Scenarios (each: 60 s sustained at 1 k req/sec, 50 distinct unknown SNIs + 1 known):

- **A: via-haproxy.** `k6 → haproxy:443 → caddy:443`. Validates HAProxy rate-limits before Caddy is reached.
- **B: direct-caddy.** `k6 → caddy:443`. Validates Caddy's declined-domain LRU absorbs repeated unknown-SNI requests even without HAProxy.

## Overrides

```
RATE_RPS=500 DURATION_SECONDS=30 UNKNOWN_POOL=20 make test
```

Reduce these for fast iteration on slower hosts.

## Snapshot

`make test` writes everything into `results/<TS>/`. `make snapshot-results` prints the latest dir's listing.

## Teardown

```
make teardown
```

Removes containers, networks, and the named volumes (`caddy-data`, `caddy-config`).
