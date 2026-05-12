# S3 Runbook

## Setup

```
make up
```

Boots: asterisk + redis + leader-A + leader-B (both pointing at the same Asterisk Stasis app).

Leader-A acquires the lease first (random startup jitter is unavoidable; if leader-B wins, swap roles in the steps below). Verify:

```
docker compose logs leader-a leader-b | grep -E "(acquired|standby)"
```

## Test phase 1: chaos pause leader-A

Start tcpdump on the Asterisk side:

```
docker compose exec asterisk tcpdump -i any -w /tmp/pause.pcap port 8088 &
TCPDUMP_PID=$!
```

Pause leader-A:

```
docker compose pause leader-a
```

Wait 5 s, then:

```
docker compose unpause leader-a
sleep 2
docker compose exec asterisk pkill tcpdump
docker cp $(docker compose ps -q asterisk):/tmp/pause.pcap results/pause-trace.pcap
```

## Test phase 2: measure close latency

Inspect the pcap for the FIN from Asterisk → leader-A WS. Compare timestamp against the heartbeat-miss event in `docker compose logs leader-a` (the leader logs `heartbeat lost at <ts>`).

Expected: FIN within 100 ms of `heartbeat lost`.

## Test phase 3: measure reconciliation

After the FIN, leader-B should pick up within 1 s and orphan-channel-close within 7 s. Verify:

```
docker compose exec asterisk asterisk -rx 'core show channels'
```

Expected: 0 channels within 7 s of FIN.

## Snapshot

```
make snapshot-results
```

## Teardown

```
make teardown
```
