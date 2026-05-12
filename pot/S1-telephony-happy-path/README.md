# S1 — End-to-end telephony happy path

## Hypothesis

Kamailio dispatcher + rtpengine + Asterisk 22.9 LTS + ARI Outbound WS sustains a single registered softphone call through a Kamailio fail-over.

## Go/no-go signal

- **Green:** New INVITEs route to a healthy Kamailio node within 30 s of primary kill; in-flight call on the failed node drops cleanly (no zombie channels in `ARI GET /channels` after 60 s reconciliation). p95 screen-pop ≤ 800 ms at idle.
- **Yellow:** Failover works but reconciliation takes 60–120 s, or one of the metrics is borderline. Document remediation in `results/yellow-remediation.md`.
- **Red:** Failover drops calls, leaves zombie channels, or screen-pop p95 > 1500 ms. Architecture renegotiation required.

## Owner role

Telephony engineer.

## Prereqs

- Docker 24+, Docker Compose v2.
- Host RAM ≥ 8 GB free (rtpengine kernel module is not loaded — userspace mode is fine for PoT).
- Linux host preferred (rtpengine `--no-fallback` works best on Linux). macOS works but media performance is degraded.
- No external accounts required.

## Runbook

```
make up && make test && make snapshot-results
```

Step-by-step in [`runbook.md`](./runbook.md).

## Recording protocol

`results/<timestamp>/` contains:
- `failover-trace.txt` — `kamailio.log` + `asterisk.log` covering the kill window
- `screen-pop-latency.csv` — 100 calls × (call_id, invite_received_ms, channel_event_to_ari_ms)
- `channels-after-60s.json` — output of `ari curl GET /channels` 60 s post-failover
- `summary.md` — one paragraph per metric

## Yellow remediation

Per ARCH v0.4 §2.3: extend reconciliation window to match measured value, document in summary, propose ADR amendment to the leader-election design (ADR-0016) if reconciliation > 90 s.

## ADR linkage

Evidence flows into [ADR-0016 (ARI leader hard-stop)](../../docs/adr/0016-ari-leader-design.md) for the channel-reconciliation parameter.
