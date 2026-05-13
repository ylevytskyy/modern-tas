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

PoT spike S3 ran 2026-05-13. A 5-second `docker compose pause` chaos on the elected leader produced **wire close-latency = 1 ms** (Asterisk-side FIN observed via in-container tcpdump on port 8088, vs the 100 ms budget) and **reconcile-from-chaos = 1.474 s** (standby acquired the lease, opened its WS, and hung up all 20 orphan channels in a 10-Local-pair test fixture, vs the 7 s budget). `channels-pre` 20 → `channels-post` 0 confirmed the cleanup actually happened, not a counter-reset.

Evidence dir: [`pot/S3-ari-leader-hard-stop/results/20260513T052041Z/`](../../pot/S3-ari-leader-hard-stop/results/20260513T052041Z/) — `pause.pcap`, `leader-a.log`, `leader-b.log`, `channels-pre.txt`, `channels-post.txt`, `chaos-meta.json`, `summary.md`. Probe + scaffold-repair notes in [`pot/pot-readout.md` §S3](../../pot/pot-readout.md).

Two findings against this ADR's current text surfaced during the spike and need resolving before the status flip:

1. **Heartbeat = TTL = 1 s is racy.** With the literal Decision wording, the heartbeat `GET key` fires at the exact TTL boundary, sees the key already evicted, and leadership flaps. The PoT used 500 ms heartbeat with 1500 ms TTL (3:1 ratio) for a stable run. The Decision should specify TTL > heartbeat — recommended 3:1.
2. **Asterisk accepts multiple WS for the same Stasis app.** The Consequences section asserts "the second connection rejects" — observed behaviour on Asterisk 20.6 is the opposite. The standby's WS opens successfully while the deposed leader's WS is still alive, so the standby can reconcile during the deposed leader's pause window. The orphan window is therefore bounded by lease TTL (~1.5 s), not by `lease TTL + close-latency + new-WS handshake`. The Consequences text and the split-brain mitigation argument both need updating.

## Alternatives considered

- **Asterisk-side leader awareness.** Doesn't exist in Asterisk 22.x ARI. Would require core patch. Rejected.
- **Redis Sentinel / Redlock for leader election instead of single-key lease.** Stronger split-brain guarantees but adds operational complexity disproportionate to the call-event durability requirement. Rejected: single-key lease is sufficient given Asterisk's one-WS-per-app constraint.
- **No leader — multiple WS subscribers, deduplicate at NestJS.** Asterisk doesn't fan out events to multiple WS for the same Stasis app reliably; the receive-side dedup design is fragile. Rejected.
