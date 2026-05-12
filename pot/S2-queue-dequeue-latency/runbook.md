# S2 Runbook

## Setup

```
make up
```

Boots: postgres:17, redis:7, nats:2.10, asterisk (S2-owned, same image as S1), nestjs-arbiter (built from `arbiter/`), sipp (driver, runs on demand).

## Test

The full test takes ~12 minutes (10 minutes of load + setup/teardown).

```
make test
```

What `make test` does:
1. Resets Redis + NATS state.
2. Starts the `arbiter` consuming Asterisk Stasis events.
3. Launches a SIPp scenario from `fixtures/sipp/200-callers.xml` that establishes 200 INVITEs over 30 s.
4. Launches a synthetic operator simulator that emits `accept` to the arbiter at 10 calls/sec.
5. Records per-call timing into `results/dequeue-latency.csv`.
6. Snapshots Redis `INFO commandstats` and NATS `varz` at minute 0, 5, 10.

## Failure mode probes

Run these after the main test (separate `make test-redis-contention` and `make test-nats-lag` targets — write at spike-execution time):

- Throttle Redis with `tc qdisc add dev eth0 root netem delay 50ms`. Re-run for 1 min. Record latency delta.
- Add NATS jetstream lag with a deliberately slow consumer. Record delta.

## Snapshot

```
make snapshot-results
```

## Teardown

```
make teardown
```
