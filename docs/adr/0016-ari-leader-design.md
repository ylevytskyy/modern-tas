# ADR-0016: ARI leader 100 ms hard-stop heartbeat

- **Status:** Proposed
- **Date:** 2026-05-12
- **Deciders:** Telephony lead, Backend lead
- **Consulted:** SRE, Senior architect
- **Informed:** Platform team

## Context

Asterisk's ARI (Asterisk REST Interface) Stasis app model assumes one WebSocket consumer per Asterisk instance per Stasis app. If two NestJS instances both subscribe to the same Stasis app on the same Asterisk, channel-event delivery becomes non-deterministic (Asterisk fan-outs but app state assumes single ownership). Multi-instance NestJS with Asterisk requires a leader election: one NestJS holds the WS, others stand by.

The risk: a leader that pauses (long GC, kernel scheduling, Redis stall) for >100 ms while still holding its WS produces a window where channel events arrive but no business logic acts on them — calls hang, retries don't fire, the user hears silence. The leader must hard-stop its WS within 100 ms of detecting a missed heartbeat, freeing the standby to pick up.

## Decision

Implement leader election with a Redis-held lease + 100 ms hard-stop:

1. Each NestJS instance attempts `SET pot:ari-leader:<asterisk-id> <instance-id> NX PX 1000` once per second.
2. Holder maintains `EXPIRE` to 1 s on every heartbeat.
3. If a heartbeat fails or returns "lost lease," the holder closes its ARI WS within 100 ms (`process.nextTick` after the failure callback, no awaiting outstanding handlers).
4. Replacement leader observes the missing key on its next heartbeat (1 s window) and opens its own WS.
5. Asterisk's `WebSocketEvent` log records the close at the Asterisk side; tcpdump confirms FIN within 100 ms of the simulated leader pause.

Total worst-case unmanaged-event window: 1.1 s (1 s detection + 100 ms close + new leader's WS handshake). For our call volume this is acceptable; tighter windows require Asterisk-side leader awareness which doesn't exist.

## Consequences

- **Positive:** Deterministic leader transfer. Bounded event-loss window. No Asterisk modifications required.
- **Negative / cost:** Adds a Redis dependency to every Asterisk leader/standby NestJS instance. Network partitions between NestJS and Redis cause split-brain; mitigated by Asterisk only accepting one WS per Stasis app (the second connection rejects).
- **Neutral:** 100 ms is a soft target — measurement may show 80 ms is achievable, or 150 ms is necessary. Spike tunes the actual number before the ADR moves to Accepted.

## Evidence

Pending PoT spike S3 — see [`pot/S3-ari-leader-hard-stop/results/`](../../pot/S3-ari-leader-hard-stop/results/). Target signal: chaos-paused leader observed close WS within 100 ms via Asterisk WebSocketEvent log + tcpdump; replacement leader closes orphaned channels within 7 s.

## Alternatives considered

- **Asterisk-side leader awareness.** Doesn't exist in Asterisk 22.x ARI. Would require core patch. Rejected.
- **Redis Sentinel / Redlock for leader election instead of single-key lease.** Stronger split-brain guarantees but adds operational complexity disproportionate to the call-event durability requirement. Rejected: single-key lease is sufficient given Asterisk's one-WS-per-app constraint.
- **No leader — multiple WS subscribers, deduplicate at NestJS.** Asterisk doesn't fan out events to multiple WS for the same Stasis app reliably; the receive-side dedup design is fragile. Rejected.
