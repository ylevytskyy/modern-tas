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

1. Each NestJS instance attempts `SET pot:ari-leader:<asterisk-id> <instance-id> NX PX <TTL>` every `HB` ms. **TTL must be strictly greater than HB** to keep the heartbeat `GET` off the TTL boundary; recommended ratio `TTL ≥ 3 × HB`. PoT used `HB = 500 ms` and `TTL = 1500 ms`; deployments should treat 3:1 as the minimum.
2. Holder refreshes the lease with `PEXPIRE … <TTL>` on every successful heartbeat.
3. If a heartbeat fails or returns "lost lease," the holder closes its ARI WS within 100 ms (`process.nextTick` after the failure callback, no awaiting outstanding handlers) **and drops any in-flight event handlers** — the close-latency budget is about stopping the deposed leader from acting on events, not about freeing an Asterisk-side slot (see Consequences).
4. Replacement leader observes the missing key on its next heartbeat (≤ `HB` ms after expiry) and opens its own WS.
5. Asterisk's `WebSocketEvent` log records the close at the Asterisk side; tcpdump confirms FIN within 100 ms of the simulated leader pause.

Total worst-case unmanaged-event window: `TTL + HB` (lease expiry + next standby heartbeat) before the standby holds the lease. With `HB = 500 ms` / `TTL = 1500 ms` that's ≤ 2 s. Because Asterisk 20.6 accepts multiple concurrent WS for the same Stasis app (see Consequences), the standby's WS handshake and reconciliation overlap the deposed leader's pause window rather than appending to it — the wall-clock unmanaged window is therefore the lease cycle alone. For our call volume this is acceptable; tighter windows require Asterisk-side leader awareness which doesn't exist.

## Consequences

- **Positive:** Deterministic leader transfer. Bounded event-loss window. No Asterisk modifications required.
- **Negative / cost:** Adds a Redis dependency to every Asterisk leader/standby NestJS instance. Network partitions between NestJS and Redis can cause split-brain. **Asterisk 20.6 accepts multiple concurrent WS subscribers for the same Stasis app**, so split-brain cannot be mitigated by relying on Asterisk to reject the standby's WS. Mitigation lives entirely on the NestJS side: (a) the deposed leader's hard-stop callback drops in-flight handlers within 100 ms of detecting "lost lease," and (b) the standby's reconciliation must be idempotent against any actions the deposed leader's drained handlers may have already taken. Asterisk's event-fanout ordering across multiple WS is implementation-defined; the design must not assume only one consumer receives any given event.
- **Neutral:** 100 ms is a soft target — measurement may show 80 ms is achievable, or 150 ms is necessary. PoT S3 measured 1 ms wire close-latency, leaving generous headroom; production tuning may relax this if handler-drop latency dominates.

## Evidence

PoT spike S3 ran 2026-05-13. A 5-second `docker compose pause` chaos on the elected leader produced **wire close-latency = 1 ms** (Asterisk-side FIN observed via in-container tcpdump on port 8088, vs the 100 ms budget) and **reconcile-from-chaos = 1.474 s** (standby acquired the lease, opened its WS, and hung up all 20 orphan channels in a 10-Local-pair test fixture, vs the 7 s budget). `channels-pre` 20 → `channels-post` 0 confirmed the cleanup actually happened, not a counter-reset.

Evidence dir: [`pot/S3-ari-leader-hard-stop/results/20260513T052041Z/`](../../pot/S3-ari-leader-hard-stop/results/20260513T052041Z/) — `pause.pcap`, `leader-a.log`, `leader-b.log`, `channels-pre.txt`, `channels-post.txt`, `chaos-meta.json`, `summary.md`. Probe + scaffold-repair notes in [`pot/pot-readout.md` §S3](../../pot/pot-readout.md).

Two findings against this ADR's initial draft surfaced during the spike. Both have been folded into the Decision and Consequences sections above:

1. **Heartbeat = TTL = 1 s is racy.** With the original Decision wording, the heartbeat `GET key` fires at the exact TTL boundary, sees the key already evicted, and leadership flaps. The PoT used 500 ms heartbeat with 1500 ms TTL (3:1 ratio) for a stable run. Decision §1 now requires `TTL > HB` with `TTL ≥ 3 × HB` recommended.
2. **Asterisk accepts multiple WS for the same Stasis app.** The original Consequences section asserted "the second connection rejects." Observed behaviour on Asterisk 20.6 is the opposite — the standby's WS opens successfully while the deposed leader's WS is still alive, so the standby reconciles during the deposed leader's pause window. The orphan window is therefore bounded by the lease cycle (`TTL + HB`), not by `lease TTL + close-latency + new-WS handshake`. Consequences now requires NestJS-side split-brain mitigation (close-on-lease-loss + idempotent reconcile) and explicitly rejects reliance on Asterisk-level WS rejection.

## Alternatives considered

- **Asterisk-side leader awareness.** Doesn't exist in Asterisk 22.x ARI. Would require core patch. Rejected.
- **Redis Sentinel / Redlock for leader election instead of single-key lease.** Stronger split-brain guarantees but adds operational complexity disproportionate to the call-event durability requirement. Rejected: single-key lease is sufficient given Asterisk's one-WS-per-app constraint.
- **No leader — multiple WS subscribers, deduplicate at NestJS.** Asterisk doesn't fan out events to multiple WS for the same Stasis app reliably; the receive-side dedup design is fragile. Rejected.
