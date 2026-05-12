# S2 — NestJS-arbitrated queue dequeue latency

## Hypothesis

NestJS holding 200 callers in MOH bridges and dequeueing on operator-accept stays under 200 ms p95 ringing latency (FR-Q10 risk).

## Go/no-go signal

- **Green:** SIPp drives 200 callers into a single Queue; NestJS dequeue → ARI `Bridge` → operator-WS `ring` event p95 ≤ 200 ms over a 10-minute window. Failure modes (Redis lock contention, NATS lag) explicitly probed and stay within budget.
- **Yellow:** p95 200–300 ms; FIFO-only fallback to Asterisk `Queue()` accepted for FIFO workloads, NestJS handles only priority/sticky/skills.
- **Red:** p95 > 300 ms or Redis/NATS contention dominates. ADR-0024 wording renegotiated before MVP.

## Owner role

Telephony engineer + backend engineer.

## Prereqs

- Docker 24+, Docker Compose v2.
- Host: 4 cores, 8 GB RAM minimum (200 MOH bridges + SIPp + NestJS is non-trivial).
- SIPp 3.7 (image used directly from Compose).
- No external accounts.

## Runbook

```
make up && make test && make snapshot-results
```

Step-by-step in [`runbook.md`](./runbook.md).

## Recording protocol

`results/<timestamp>/`:
- `dequeue-latency.csv` — per-call: caller_id, enqueued_at_ms, accept_received_at_ms, ring_emitted_at_ms, dequeue_latency_ms
- `redis-lock-contention.txt` — Redis `INFO commandstats` snapshots at minute 0, 5, 10
- `nats-lag.txt` — NATS `varz`/`connz` snapshots at the same intervals
- `summary.md` — p50/p95/p99 + failure-mode notes

## Yellow remediation

Per ADR-0024: fall back to Asterisk `Queue()` for FIFO-only queues; NestJS handles priority/sticky/skills variants only. Document the breakdown in `summary.md`.

## ADR linkage

Evidence flows into [ADR-0024 (queue dequeue budget)](../../docs/adr/0024-queue-dequeue-budget.md) — primary signal for moving status from Proposed to Accepted.

The NestJS arbiter container in `arbiter/` is a **PoT-only stub** — minimal heap + NATS publish + ARI bridge call, not the production M30 module. Do not carry it forward into Sprint 1.
