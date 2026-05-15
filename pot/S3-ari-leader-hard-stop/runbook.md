# S3 Runbook

## Setup

```
make up
```

Boots: asterisk (built from `asterisk-image/`), redis, leader-a, leader-b. Both leader containers race for `pot:ari-leader:asterisk-1` in Redis on startup; whoever wins becomes the active leader, the other prints `standby` ticks.

The first `make up` builds the asterisk + leader images. Cold boot takes ~1 minute. After healthchecks pass, give it another ~6 seconds for the election to settle.

## Smoke

```
make smoke
```

Prints the current lease holder + tail of each leader's log so you can confirm one of them is leader and the other is standby before launching chaos.

## Test

```
make test
```

`scripts/run-test.sh` does:

1. Reads the current lease holder from Redis and binds it as `$LEADER` (the other becomes `$STANDBY`).
2. Originates 10 Local channels into `Stasis(pot-leader-test)` via `POST /ari/channels` (dialplan extension `s3-test`,`sleep` answers + Wait(120)).
3. Verifies `core show channels` reports ~20 active channels (Local pair = 2 halves each).
4. Starts `tcpdump -i any -U -w /tmp/pause.pcap 'tcp port 8088'` inside the asterisk container.
5. `docker compose pause $LEADER` for 5 seconds.
6. `docker compose unpause $LEADER`.
7. Waits 12 seconds for the leader to detect lost lease, close the WS, and the standby to take over + reconcile.
8. Stops tcpdump, `docker cp` the pcap out, captures both leader logs + post-chaos `core show channels`.
9. Hands off to `scripts/summarise.sh`, which parses the pcap and logs and emits `summary.md`.

## Verdict mechanics (summary.md)

- **Close-latency** = (first FIN on port 8088 after `heartbeat lost`) − (`heartbeat lost` ts). Green ≤ 100 ms.
- **Reconcile** = (`reconcile-done` standby event ts) − (chaos start ts). Green ≤ 7 s. *Reconciliation is measured from chaos start, not from FIN, because Asterisk accepts a second WS for the same Stasis app — the standby can reconcile during the deposed leader's pause, before the FIN.*

## Teardown

```
make teardown
```

Brings down compose + deletes named volumes.
