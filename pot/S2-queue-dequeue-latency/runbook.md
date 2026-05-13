# S2 Runbook

## Setup

```
make up
```

Boots: postgres:17, redis:7, nats:2.10, asterisk (built from `asterisk-image/`), arbiter (built from `arbiter/`). `sipp` and `operator-sim` containers are under the `driver` profile and only run during `make test` / `make smoke`.

The first `make up` builds three local images (asterisk, sipp, arbiter, operator-sim) and pulls postgres/redis/nats. Cold boot takes ~2 minutes on Apple Silicon Docker Desktop.

Verify all four core services report `Healthy`:

```
docker compose ps
```

## Smoke

```
make smoke
```

Places a single SIPp INVITE so you can eyeball the dialplan + Stasis + arbiter chain before launching the full 10-minute load. Look for `[arbiter] up` in the logs followed by Asterisk routing the call into `Stasis(pot-queue)`.

You can also confirm the arbiter is exercising Redis from the host:

```
docker compose exec redis redis-cli GET queue:pot-queue:owner       # arbiter instance id
docker compose exec redis redis-cli GET queue:pot-queue:snapshot    # heap depth + head
docker compose exec redis redis-cli INFO commandstats               # SET / GET counters
```

And NATS:

```
curl -fsS http://localhost:8222/varz | jq '.in_msgs, .out_msgs'
```

`in_msgs` increments once per enqueue and once per dequeue.

## Test

The full test takes ~12 minutes (20 s SIPp ramp-up + 10 min sustained load + 1 min drain).

```
make test
```

`scripts/run-test.sh` does:

1. Resets Redis state (`FLUSHALL`).
2. Snapshots Redis `INFO commandstats` and NATS `/varz` + `/connz` at t=0.
3. Starts `operator-sim` (10 virtual operators on a single WS, accept rate 10/s, 20 s warmup, 580 s emit window).
4. Starts SIPp with `-r 10 -rp 1000 -l 200 -m 6000` against the `200-callers.xml` scenario — 10 calls/sec arrival rate, max 200 concurrent in MOH, 6000 total over the window. With each scenario holding for 20 s, steady-state ≈ 200 callers waiting.
5. Snapshots Redis + NATS again at t=5 min and t=10 min.
6. Waits for `operator-sim` to exit (it writes `dequeue-latency.csv` and `operator-sim-stats.json` to `results/<TS>/`).
7. Captures the arbiter log to `arbiter.log`.
8. Computes `summary.md` via `scripts/summarise.sh`.

Per-call CSV columns: `caller_id, enqueued_at_ms, accept_received_at_ms, ring_emitted_at_ms, dequeue_latency_ms, total_wait_ms, operator_id, status`.

## Failure mode probes

```
make test-redis-contention   # injects 50 ms netem delay on redis container, re-runs 60 s probe
make test-nats-lag           # same shape, injects delay on nats container
```

Each writes a fresh `results/<TS>-contention-{redis,nats}/` with its own CSV + summary. Since the arbiter renews the Redis ownership lock and publishes a dequeue event on every accept, both contention scripts will visibly shift the accept→ring latency CDF — that's how we know the hazard surface is real, not synthetic.

Override `DELAY_MS` to vary the injection (default 50 ms):

```
DELAY_MS=100 make test-redis-contention
```

## Snapshot

`make test` already writes everything to `results/<TS>/`. `make snapshot-results` just lists the recent runs.

## Teardown

```
make teardown
```

Brings down both the core and `driver` profiles and deletes all named volumes.
