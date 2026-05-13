# ADR-0024: Queue dequeue latency budget = 200 ms p95 (NestJS-arbitrated)

- **Status:** Proposed (pending user confirmation to flip to Accepted)
- **Date:** 2026-05-12
- **Deciders:** Backend lead, Telephony lead
- **Consulted:** Senior architect, Product
- **Informed:** All MVP engineers

## Context

PRD v2 §5.3.5 requires queue routing strategies beyond Asterisk's built-in `Queue()`: priority queues, sticky-last-operator, longest-idle, skill-based. Implementing these in Asterisk dialplan is awkward; doing them in NestJS keeps the strategy code testable and changeable without restarting Asterisk. The cost is added latency: NestJS arbitrates the dequeue (operator-WS `accept` → resolve waiting caller → ARI `Bridge` → operator-WS `ring`), and that round-trip must stay under a budget the user perceives as snappy.

FR-Q10 in the PRD asserts "p95 ringing latency ≤ 200 ms from accept to ring" but flags it as unproven. ARCH v0.4 §9 ratifies the 200 ms target subject to PoT measurement.

## Decision

The queue dequeue path stays in NestJS for all strategies (FIFO, priority, sticky-last-operator, longest-idle, skills). Architecture:

- Per-queue priority heap held in-memory in the NestJS shard that owns the queue (sticky-hash on `queue_id`).
- Redis stores only the cross-shard ownership lock + a recovery snapshot every 5 s.
- NATS notifies eligible-operator WS gateways on heap changes.

Latency budget: **p95 ≤ 200 ms** from operator-WS `accept` to operator-WS `ring`, measured under 200-caller MOH load.

If PoT S2 shows the budget is unmet, **fall back to Asterisk `Queue()` for FIFO-only queues**. NestJS handles only the priority/sticky/skills variants where the strategy logic justifies the latency.

## Consequences

- **Positive:** All strategies implemented in one place (TypeScript) with consistent test coverage. Strategy changes don't require Asterisk restart.
- **Negative / cost:** NestJS becomes a hard dependency on the call-routing critical path; a NestJS outage means new calls don't get routed. Mitigated by N+1 NestJS shards behind a load balancer.
- **Neutral:** 200 ms is a perceptual budget, not a physical one — operator humans perceive <300 ms as instant; PoT measures the actual.

## Evidence

PoT spike S2 ran 2026-05-13. Over a 10-minute steady-state load with ~200 callers held in MOH (10 calls/sec arrival, 20 s scenario hold, max 200 concurrent) and operator accepts at 10/sec, accept→ring round-trip measured **p50 = 4 ms, p95 = 6 ms, p99 = 9 ms** over 5 539 successful dequeues (146 / 5 685 failures, all from caller-hang-up races at accept time). Both named hazard surfaces were genuinely exercised: Redis `SET` 118 → 5 983 (lock renewal on every dequeue + 5 s snapshot ticks), NATS `in_msgs` 22 → 11 532 (one publish per enqueue + one per dequeue).

The budget is met by ~33× margin against the 200 ms p95 target, so the Yellow remediation (fall back to Asterisk `Queue()` for FIFO) is not required.

Evidence dir: [`pot/S2-queue-dequeue-latency/results/20260513T042757Z/`](../../pot/S2-queue-dequeue-latency/results/20260513T042757Z/) — `dequeue-latency.csv`, `summary.md`, Redis cmdstats + NATS varz at t=0/5/10 min, operator-sim stats, SIPp stats. Probe + scaffold repair notes in [`pot/pot-readout.md` §S2](../../pot/pot-readout.md).

Not yet run: `make test-redis-contention` / `make test-nats-lag` (50 ms `netem` delay on the redis / nats container). Scripts are authored; the baseline margin is large enough that running them is optional for ratification.

## Alternatives considered

- **Asterisk `Queue()` for everything.** Loses priority and skills routing. Rejected: PRD requires those.
- **Tighter budget (100 ms p95).** Below the wire-time floor for the Redis + NATS round-trip. Rejected as physically optimistic.
- **Queue logic in Kamailio.** Kamailio is signalling-plane only; doesn't have call-state to know which operators are eligible. Rejected.
