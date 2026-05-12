# S3 — ARI leader 100 ms hard-stop

## Hypothesis

The ADR-0016 design (close WS within 100 ms of missed Redis heartbeat) is implementable on Asterisk 22.9 LTS with `@ipcom/asterisk-ari` (or equivalent ari-client lib).

## Go/no-go signal

- **Green:** Chaos test pauses leader process for 5 s. WS observed closed at the Asterisk side within 100 ms of heartbeat miss (verified via Asterisk `WebSocketEvent` log + tcpdump). Replacement leader closes orphaned channels within 7 s.
- **Yellow:** Close window 100–250 ms or replacement reconciliation 7–15 s. Document tunable target for the production design.
- **Red:** Close window > 250 ms or replacement leaves channels open > 15 s. ADR-0016 design renegotiated before MVP.

## Owner role

Telephony engineer.

## Prereqs

- Docker 24+, Docker Compose v2.
- Host: 4 GB RAM.
- `tcpdump` available on host (to capture FIN at the Asterisk side).
- No external accounts.

## Runbook

```
make up && make test && make snapshot-results
```

Step-by-step in [`runbook.md`](./runbook.md).

## Recording protocol

`results/<timestamp>/`:
- `pause-trace.pcap` — tcpdump of port 8088 covering the chaos window
- `asterisk-websocket-events.log` — `WebSocketEvent` lines from Asterisk
- `leader-close-latency-ms.txt` — observed time from heartbeat-miss → FIN
- `reconciliation-time-s.txt` — observed time from FIN → orphan channels closed
- `summary.md`

## Yellow remediation

If close window 100–250 ms: tune the heartbeat interval (currently 1 s) downward to 500 ms. Document new total worst-case window (heartbeat-miss + close = ~750 ms) and update ADR-0016 Decision section.

## ADR linkage

Primary evidence for [ADR-0016 (ARI leader hard-stop)](../../docs/adr/0016-ari-leader-design.md). If Red, ADR-0016 Decision section is rewritten before Sprint 0 closes.
