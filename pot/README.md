# Phase 0 — Proof of Technology

Eight throwaway spikes that kill the load-bearing unknowns from RISKS v0.2 before MVP construction starts. Source: [ARCHITECTURE.v0.4 §2](../ARCHITECTURE.v0.4.md). Spike code is throwaway; only fixtures, scripts, and ADR evidence carry forward.

## Phase context

```
PHASE 0 — PROOF OF TECHNOLOGY        4–6 weeks
  └─ Exit gate G0: every spike Green or accepted-Yellow
        ↓
PHASE 1 — SPRINT 0 (ADR ratification)   2–3 weeks (overlaps PoT)
  └─ Exit gate G1: 30 ADRs merged + 2 external sign-offs
        ↓
PHASE 2 — MVP BUILD                    9–11 months
```

## The 8 spikes

| # | Spike | Owner role | Compose | Status |
|---|---|---|---|---|
| [S1](./S1-telephony-happy-path/) | End-to-end telephony happy path | Telephony eng | runnable | Green (Layer 1) |
| [S2](./S2-queue-dequeue-latency/) | NestJS-arbitrated queue dequeue latency | Telephony + backend | runnable | Green |
| [S3](./S3-ari-leader-hard-stop/) | ARI leader 100 ms hard-stop | Telephony eng | runnable | Green |
| [S4](./S4-redaction-accuracy/) | Two-pass redaction accuracy on 8 kHz μ-law | Backend + compliance | stub | Deferred (vendor + fixtures) |
| [S5](./S5-supavisor-set-local/) | Supavisor `SET LOCAL` parity | SRE | runnable | Green |
| [S6](./S6-ncall-fixture-capture/) | `/v1` byte-for-byte fixture capture | Compliance + backend | stub | Not started |
| [S7](./S7-temporal-baa/) | Temporal Cloud BAA + EU namespace | Compliance | stub | Deferred (vendor correspondence) |
| [S8](./S8-caddy-le-posture/) | Caddy 2.10+ permission + LE rate-limit | SRE | runnable | Green |

Update the **Status** column inline as spikes execute. Statuses: Not started · In progress · Green · Yellow · Red · Deferred (blocked on external prereqs that can't be synthesised without invalidating the measurement; carries to Sprint 0).

## Running a spike (human)

```bash
cd pot/S<N>-<slug>
cat README.md       # confirm prereqs
make up             # boot the spike's stack
make test           # run the measurement harness
make snapshot-results
make teardown
```

Then update the matching `pot-readout.md` section with status, result paragraph, and evidence path.

## Running a spike (LLM agent)

1. Read `pot/S<N>-<slug>/README.md` end-to-end.
2. Verify all prereqs in §Prereqs are satisfied. Stop and ask the user if any external dep is missing.
3. Follow `runbook.md` step by step.
4. After `make snapshot-results`, write the `pot-readout.md` section as evidence, then propose a status (Green/Yellow/Red) for the user to confirm.

## Exit gate G0

(Quoted from ARCH v0.4 §2.4.)

- All 8 spikes Green, **or** any Yellow has a written remediation plan signed by the senior architect + the spike's owner + the on-call compliance lead. **Red blocks MVP kickoff.**
- The 8 spike directories are tagged `pot/<spike>` in git for forensic reference and then deleted from `main` (their fixtures and ADR evidence carry forward).
- `pot/pot-readout.md` committed with one paragraph per spike + measurement traces.

## Cross-references

- [ARCHITECTURE.v0.4 §2](../ARCHITECTURE.v0.4.md) — full PoT spec.
- [RISKS.v0.2.md](../RISKS.v0.2.md) — what each spike is killing.
- [docs/adr/](../docs/adr/) — the ADRs PoT evidence flows into.
