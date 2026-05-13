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
make up && make smoke && make test
```

`make smoke` places a single SIPp INVITE and lets you eyeball arbiter logs before committing to the full 10-minute load. `make test` runs `scripts/run-test.sh`, which writes everything below into a fresh `results/<TS>/` directory. Step-by-step in [`runbook.md`](./runbook.md).

## Recording protocol

`results/<timestamp>/`:
- `dequeue-latency.csv` — per-call: caller_id, enqueued_at_ms, accept_received_at_ms, ring_emitted_at_ms, dequeue_latency_ms, total_wait_ms, operator_id, status
- `redis-cmdstats-t0.txt` / `…-t5.txt` / `…-t10.txt` — Redis `INFO commandstats` snapshots
- `nats-varz-t0.txt` / `…-t5.txt` / `…-t10.txt` — NATS `/varz` snapshots
- `nats-connz-t0.txt` — NATS connection list at start
- `arbiter.log` — full arbiter container log captured at end of run
- `operator-sim-stats.json` — accepts sent, rings received, ring-failed counts
- `sipp-stats.csv` + `sipp-errors.log` — SIPp per-second stats and any signaling errors
- `summary.md` — p50/p95/p99 + failure-mode notes + hazard-exercise proof block

## Yellow remediation

Per ADR-0024: fall back to Asterisk `Queue()` for FIFO-only queues; NestJS handles priority/sticky/skills variants only. Document the breakdown in `summary.md`.

## ADR linkage

Evidence flows into [ADR-0024 (queue dequeue budget)](../../docs/adr/0024-queue-dequeue-budget.md) — primary signal for moving status from Proposed to Accepted.

The NestJS arbiter container in `arbiter/` is a **PoT-only stub** — minimal heap + Redis ownership lock + NATS publish + ARI bridge call. It is shaped to match ADR-0024's architecture so the contention probes can stress Redis and NATS on the dequeue critical path, but it is not the production M30 module. Do not carry it forward into Sprint 1.

The `operator-sim/` container is also throwaway. It models the operator-WS surface area enough to drive accepts at a fixed rate and record per-call timing into the CSV. Production operator WS gateways are separate services (different repo).

## Implementation notes (carry forward)

- **Asterisk image:** built from `asterisk-image/Dockerfile` (Ubuntu 24.04 + `asterisk` package, ~Asterisk 20.6). The original compose referenced `andrius/asterisk:22.9-current`, which doesn't exist on Docker Hub and has no arm64 builds anyway. Asterisk 20 covers the ARI / PJSIP / Stasis surface this spike needs and ADR-0024 doesn't pin a version.
- **SIPp image:** built from `sipp-image/Dockerfile` (Debian bookworm + `sip-tester`, SIPp 3.6.1). The originally-referenced `ctaloi/sipp:3.7` doesn't exist on Docker Hub.
- **PJSIP anonymous endpoint:** an `[anonymous]` endpoint with `endpoint_identifier_order=ip,username,anonymous` in `[global]` is what makes SIPp's unauthenticated INVITEs route into the `pot` dialplan context.
- **No host UDP 5060 mapping:** SIPp talks to Asterisk over the compose-internal network (`asterisk:5060`); host UDP exposure is left off to avoid colliding with local SIP clients.
