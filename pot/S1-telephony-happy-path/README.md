# S1 — End-to-end telephony happy path

## Hypothesis

A Kamailio dispatcher pair + Asterisk 22 + ARI subscriber sustains
signalling-layer calls through a Kamailio-tier failover, and StasisStart
events reach an ARI subscriber within the screen-pop latency budget.

## Scope (Layer 1 — signalling only)

The original scaffold combined three sub-hazards (Kamailio failover,
in-flight call drop, screen-pop p95 ≤ 800 ms) plus end-to-end media
through rtpengine. Layer 1 of this spike validates only the
signalling-tier hazards. Media (rtpengine) is Layer 2 and only
attempted after Layer 1 is Green — see "Layer 2" below.

Specifically, Layer 1 covers:

- **Kamailio failover at the UAC layer.** Both Kamailio nodes run an
  identical dispatcher config and proxy to one Asterisk downstream.
  Failover is exercised by the test driver (SIPp) re-pointing at the
  standby after `docker compose pause kamailio-primary`. A real
  deployment would add keepalived/VRRP for a shared VIP; that is a
  Sprint-0 concern, not a topology-level concern. The architectural
  property being validated here is "either Kamailio can route INVITEs
  to Asterisk independently."
- **Screen-pop latency.** An ARI-WS subscriber records `StasisStart`
  arrival timestamps. The summariser joins these with SIPp's per-call
  INVITE-sent timestamps to compute end-to-end screen-pop latency
  (p50/p95/p99).
- **No call zombies.** All 110 calls (100 phase-2 + 10 phase-3) should
  produce StasisStart events and exit cleanly via SIPp BYE — verified
  via `core show channels` post-test.

## Go/no-go signal

| Metric                 | Green     | Yellow      | Red         |
|------------------------|-----------|-------------|-------------|
| screen-pop p95         | ≤ 800 ms  | ≤ 1500 ms   | > 1500 ms   |
| failover TTFOK         | ≤ 30 s    | ≤ 120 s     | > 120 s     |
| call loss (any phase)  | 0         | 0           | any         |

`TTFOK` = wall-clock time from `docker compose pause kamailio-primary`
to first StasisStart event from a standby-routed call.

## Owner role

Telephony engineer.

## Prereqs

- Docker 24+, Docker Compose v2.
- Host RAM ≥ 4 GB free.
- No external accounts required.
- arm64 host fine (all images are arm64-native; the original scaffold's
  `andrius/asterisk` reference is replaced by a local Ubuntu+asterisk
  build, same pattern as S3).

## Runbook

```
make up        # builds three local images, boots compose, waits for health
make test      # runs scripts/run-test.sh + scripts/summarise.sh
make teardown  # docker compose down -v
```

Step-by-step in [`runbook.md`](./runbook.md).

## Recording protocol

`results/<timestamp>/` contains, after `make test`:

- `sipp-screen-pop_messages.log`   — SIPp INVITE/ACK/BYE trace for phase 2
- `sipp-screen-pop_invites.csv`    — extracted (call_number, t_invite_sent_ms)
- `sipp-screen-pop_stats.csv`      — SIPp's built-in time-bucket stats
- `sipp-failover_*`                — same artifacts for phase 3 (post-pause)
- `subscriber-phase2.jsonl`        — StasisStart events from phase 2
- `subscriber-phase3.jsonl`        — StasisStart events from phase 3
- `pause-epoch-ms.txt`             — wall-clock ms when `docker compose pause` fired
- `kamailio-primary.log`           — full compose log for primary
- `kamailio-standby.log`           — full compose log for standby
- `asterisk.log`                   — full compose log for asterisk
- `subscriber-stdout.log`          — subscriber's meta events (ws_open, errors)
- `summary.md`                     — verdict + per-phase percentile table

## Yellow remediation

Per ARCH v0.4 §2.3: document the measured value, propose remediation
in summary.md. If screen-pop p95 > 800 ms, root-cause the dominant
component (Kamailio routing, Asterisk PJSIP, ARI WS push) before
deciding whether to amend the budget or the implementation.

## Layer 2 (deferred — media smoke)

Layer 2 adds rtpengine + a single SIPp call with a small G.711 media
file to verify RTP flows through the bridge. macOS-compatible
(rtpengine off `network_mode=host`, on the default bridge with an
explicit `--interface=eth0` and the RTP range published if needed).
Only attempted once Layer 1 is Green; surface the decision to the
spike owner before adding.

## ADR linkage

S1 has no primary ADR. Yellow/Red screen-pop results may inform an
amendment to [ADR-0016 (ARI leader hard-stop)](../../docs/adr/0016-ari-leader-design.md)
if the dominant component is ARI-side latency rather than PJSIP/SIP
processing. Kamailio HA deployment-tier decisions (VIP/keepalived,
DNS-SRV-based failover) are tracked in ADR-0006 (or whichever proxy
ADR ends up owning them) — not S1's call.
