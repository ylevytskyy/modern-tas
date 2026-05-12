# PoT Phase 0 Scaffold — Design Spec

**Date:** 2026-05-12
**Branch:** `pot/scaffold`
**Author:** levytskyy@gmail.com, drafted with Claude Code
**Source documents:** [ARCHITECTURE.v0.4.md §2](../../../ARCHITECTURE.v0.4.md), [PRD.v2.md](../../../PRD.v2.md), [RISKS.v0.2.md](../../../RISKS.v0.2.md)
**Status:** Approved (brainstorming), pending plan + execution

---

## 1. Goal

Lay down a reproducible workspace for the eight Phase 0 Proof-of-Technology spikes (S1–S8) defined in ARCHITECTURE.v0.4 §2.3, so that any engineer or agent can pick up any spike and execute it against a known stack with known artefacts. The branch is **scaffold only** — no spike actually runs as part of this work. Spike execution happens later, on separate branches, against this scaffold.

## 2. Non-goals

- **No spike execution.** No `make S5-test` runs, no measurements taken, no go/no-go signals produced in this branch. Each spike is staged for execution but not triggered.
- **No broader monorepo skeleton.** No `apps/`, `packages/`, `contracts/`, root `README.md`, `CONTRIBUTING.md`, or CI. Those wait for Sprint 1 after PoT exits — the PoT is throwaway by design (ARCH §2.1) and shouldn't dictate Sprint-1 layout.
- **No ratification of ADRs.** The six seeded ADRs land as `Status: Proposed` with `Evidence: pending PoT S<N>`. Sprint 0 (Phase 1) is responsible for moving them to `Accepted`.
- **No external-dependency unblocking.** S4 (AssemblyAI key + audio fixtures), S6 (live nCall vendor instance), S7 (Temporal sales letter) remain blocked on user-side action — their dirs are documented stubs, not runnable compose stacks.
- **No top-level project docs.** The repo has zero contributor orientation today; this branch does not add it. Pure PoT scope.

## 3. Branch strategy

- One branch: `pot/scaffold`, cut from `main`.
- Plain in-place branch, not a git worktree. `main` is clean (single commit, no concurrent work), so worktree isolation buys nothing here and adds a second working directory to keep in sync.
- Naming follows the architecture's `pot/<spike>` tag convention from ARCH §2.4 ("8 spike directories tagged `pot/<spike>` in git"). This branch isn't a spike but lives in the same namespace as the future spike branches/tags.
- Future spike-execution branches (out of scope here) cut from `pot/scaffold`: `pot/S1-execute`, `pot/S5-execute`, etc. After G0, scaffold commits squash into `main` if any survive; per ARCH §2.4 the spike dirs themselves are then deleted from `main` and only fixtures/ADR evidence carry forward.

## 4. Files added

Exhaustive list. Anything not on this list is out of scope.

### 4.1 PoT program (top of `pot/`)

```
pot/
  README.md
  Makefile
  pot-readout.md
```

- **`pot/README.md`** — engineer/agent entry point. Sections: what PoT is (one para from ARCH §2.1) · phase diagram (condensed from ARCH §1) · the 8-spike table (#/hypothesis/signal/owner from ARCH §2.3 + a Status column tracked in this README: Not started / In progress / Yellow / Green / Red) · how to run a spike (human + LLM-agent variant) · G0 exit checklist (quoted from ARCH §2.4) · linkage back to ARCHITECTURE / RISKS / docs/adr.
- **`pot/Makefile`** — ~40-line dispatcher. Pattern targets `up-%`, `test-%`, `teardown-%`, `snapshot-%`, `status-%` forward to per-spike Makefiles via `$(MAKE) -C $*`. `help` and `status` (no-arg) iterate over all 8 spikes. The per-spike Makefile owns the real commands; the dispatcher just routes.
- **`pot/pot-readout.md`** — G0 deliverable skeleton. One H2 section per spike (S1–S8), each pre-populated with blank fields: Status / Run dates / Owner / Result / Evidence / ADR(s) updated. Filled in at G0 sign-off.

### 4.2 Per-spike directories (`pot/S<N>-<slug>/`)

Eight directories, identical anatomy:

```
pot/S<N>-<slug>/
  README.md
  runbook.md
  docker-compose.yml
  Makefile
  fixtures/.gitkeep
  results/.gitkeep
  .gitignore         # ignore results/*, keep .gitkeep
```

Spike-to-slug mapping (drives directory names and Makefile target stems):

| # | Slug | Owner role | Compose status |
|---|---|---|---|
| S1 | `telephony-happy-path` | Telephony eng | runnable |
| S2 | `queue-dequeue-latency` | Telephony + backend | runnable |
| S3 | `ari-leader-hard-stop` | Telephony eng | runnable |
| S4 | `redaction-accuracy` | Backend + compliance | stub (needs AssemblyAI key + audio) |
| S5 | `supavisor-set-local` | SRE | runnable |
| S6 | `ncall-fixture-capture` | Compliance + backend | stub (needs vendor live instance) |
| S7 | `temporal-baa` | Compliance | stub (sales/legal, no infra) |
| S8 | `caddy-le-posture` | SRE | runnable (LE form is org-side, k6 storage-flood runs local) |

#### 4.2.1 Per-spike `README.md` structure

~250 words, eight sections, identical order across spikes:

1. **Hypothesis** — one sentence, the claim being tested.
2. **Go/no-go signal** — the exact measurement and threshold (Green/Yellow/Red).
3. **Owner role** — Telephony eng / Backend eng / SRE / Compliance lead.
4. **Prereqs** — env vars, external accounts, host requirements (Docker version, RAM, CPU). External-dep blockers for S4/S6/S7 named explicitly here.
5. **Runbook** — three-line command sequence: `make up && make test && make snapshot-results`. Plus pointer to `runbook.md` for the step-by-step.
6. **Recording protocol** — what artefacts land in `results/`: CSV columns, screenshot names, log dumps, trace files. Stable enough that downstream ADRs and `pot-readout.md` can link to specific filenames.
7. **Yellow remediation** — the architecture-doc-named fallback (e.g., S5 Red → PgBouncer 1.22+; S7 Red → self-host Temporal; S2 Red → Asterisk `Queue()` for FIFO-only).
8. **ADR linkage** — which ADR(s) consume the spike's evidence. One-line cross-reference, e.g. "Evidence flows into [ADR-0018](../../docs/adr/0018-supavisor-pooling.md)."

#### 4.2.2 Per-spike `runbook.md`

Step-by-step execution: commands, what to record, what's a pass, what's a fail, how to recover from a partial run. Free-form prose, no schema beyond the existence of the file. Maybe 1–2 pages each.

#### 4.2.3 Per-spike `docker-compose.yml`

Five runnable compose files. Concrete images and versions are baked in from the architecture doc:

| Spike | Services |
|---|---|
| S1 | `kamailio:6.0` (config volume), `rtpengine:mr12.0` (Unix socket to Kamailio), `asterisk:22.9-lts` (ARI Outbound WS pre-configured), `baresip` softphone client |
| S2 | `postgres:17`, `redis:7`, `nats:2.10`, `sipp:3.7` (driver), thin NestJS arbiter container (multi-stage Dockerfile in same dir) — reuses Asterisk from S1 via `extends:` to avoid duplication |
| S3 | `asterisk:22.9-lts`, `redis:7`, two leader-stub Node containers with `@ipcom/asterisk-ari`. Chaos via `docker pause`/`unpause`. |
| S5 | `postgres:17`, `supavisor:1.1+`, lightweight `node:20-alpine` test runner. Self-contained, ~5 min boot-to-result. |
| S8 | `caddy:2.10+` (`permission http` configured), `haproxy:3.0` (rate-limit upstream), `k6:0.50` load generator. |

Three stub compose files (S4, S6, S7) — present as YAML with a single comment line: `# external dependency required, see README §Prereqs`. Stub-not-empty so `docker compose config` still parses.

#### 4.2.4 Per-spike `Makefile`

Targets per spike:
- `up` — `docker compose up -d` + wait-for-healthy.
- `test` — runs the spike's measurement harness (SIPp, k6, psql test runner, Node chaos driver). For stub spikes (S4/S6/S7), prints the unblocking checklist and exits 0.
- `teardown` — `docker compose down -v`.
- `snapshot-results` — copies relevant traces/logs into `results/<timestamp>/`.
- `status` — `docker compose ps` plus a `ls results/` summary.

#### 4.2.5 `fixtures/.gitkeep` and `results/.gitkeep`

Empty placeholder so git tracks the directories. Spike-specific `fixtures/` get populated at execution time (SIPp scenarios, seed SQL, audio samples, captured XML); `results/` is gitignored except for `.gitkeep`.

### 4.3 ADR seeds (`docs/adr/`)

```
docs/adr/
  README.md          # index + how-to-add
  template.md        # copy-paste base
  0013-redaction-pipeline.md
  0015-temporal-cloud-tier.md
  0016-ari-leader-design.md
  0018-supavisor-pooling.md
  0019-caddy-le-posture.md
  0024-queue-dequeue-budget.md
```

- **Format: MADR 4.0 lite.** Headings: Status / Date / Deciders / Consulted / Informed / Context / Decision / Consequences (Positive/Negative/Neutral) / Evidence / Alternatives considered. Lighter than Nygard, recognisable to most devs.
- **`docs/adr/template.md`** — copy-paste base with all section headers and inline placeholders.
- **`docs/adr/README.md`** — index table (number / title / status / spike / owner) + a "how to add an ADR" stub (copy template, next number, link from this index).
- **Six seeded ADRs.** Each pre-populated with Context (copied from ARCH §6 + §9), Decision (the choice as-stated), Consequences, Alternatives. `Status: Proposed`. `Evidence: Pending PoT spike S<N> — see pot/S<N>-<slug>/results/`. The seed is self-sufficient: an engineer reading the ADR alone understands the full design intent without opening the architecture doc.

ADR → spike → source mapping:

| ADR | Title | Spike | Sources |
|---|---|---|---|
| 0013 | Two-pass redaction pipeline (forced-align + NER + over-bleep) | S4 | RISKS §1, ARCH §9 |
| 0015 | Temporal Cloud Enterprise tier with EU namespace | S7 | ARCH §9 |
| 0016 | ARI leader 100 ms hard-stop heartbeat design | S3 | ARCH v0.3 + v0.4 §9 |
| 0018 | Supavisor as transaction-mode pooler (PgBouncer fallback) | S5 | RISKS §1 (N6), ARCH §9 |
| 0019 | Caddy 2.10+ on-demand TLS posture + LE rate-limit exemption | S8 | RISKS §4, ARCH §9 |
| 0024 | Queue dequeue latency budget = 200 ms p95 (NestJS-arbitrated) | S2 | ARCH §9 |

The other 24 ADRs from the ARCH §9 30-ADR Sprint-0 gate are **not** seeded here — they don't need PoT evidence and would just rot in this branch.

## 5. Tech versions and pinning

All version choices are inherited from ARCHITECTURE.v0.4 §6–§9, not invented here. Versions noted inline above:

- Asterisk 22.9 LTS (named explicitly in S1 hypothesis)
- Kamailio 6.0 (current 6.x LTS at 2026-05)
- rtpengine mr12.0
- PostgreSQL 17
- Redis 7
- NATS 2.10
- Supavisor 1.1+
- Caddy 2.10+ (named in S8 hypothesis)
- HAProxy 3.0
- SIPp 3.7
- k6 0.50
- baresip (latest)
- `@ipcom/asterisk-ari` (named in S3 hypothesis)

If the architecture doc updates a pin later, the scaffold's compose files are the place to bump it. Pinning lives in the compose, not in ADRs.

## 6. Operating model — how a spike runs after this branch lands

The scaffold's contract with future spike executors:

1. Engineer (or agent) checks out a fresh branch off `pot/scaffold`: `pot/S5-execute`.
2. `cd pot/S5-supavisor-set-local`.
3. Reads `README.md` to confirm prereqs are satisfied. For S5 that's just Docker + 4 GB RAM.
4. `make up` boots the compose stack.
5. `make test` runs the harness — for S5, a small psql script that sets `app.tenant_id` in transaction A and verifies transaction B on the same pooler connection does NOT see it.
6. `make snapshot-results` drops the trace into `results/<timestamp>/`.
7. Engineer fills `pot/pot-readout.md` S5 section with status (Green/Yellow/Red), result paragraph, and evidence path.
8. If Green: ADR-0018 status moves to `Accepted` with evidence link. If Yellow: written remediation plan added to the ADR. If Red: ADR-0018 wording changes (e.g., to PgBouncer 1.22+) before Sprint 0 closes.
9. `make teardown`.

This contract is the same for all 8 spikes — only the compose contents and the harness differ.

## 7. What gets committed in this branch (commit plan, not commit script)

One commit per logical chunk so review is incremental:

1. Design spec (this file) under `docs/superpowers/specs/`.
2. ADR template + README + 6 seeded ADRs under `docs/adr/`.
3. `pot/` program scaffold: README, Makefile dispatcher, pot-readout.md skeleton.
4. Eight per-spike directories, one commit per spike (so reviewers can step through them).

Total ~11 commits. Exact split deferred to the implementation plan.

## 8. Open questions deferred to the implementation plan

None that block design — these are concretisation details the plan resolves:

- **NestJS arbiter container for S2**: minimal Dockerfile is needed. The plan should specify image base (`node:20-alpine`), entry point, and which arbitrer code stubs exist. The arbiter itself is throwaway PoT code, not the future M30 module.
- **S1 baresip auth credentials and Asterisk PJSIP realtime seed**: scripted in `fixtures/`, exact SQL deferred to plan.
- **S5 negative-case test exact SQL**: plan writes the actual `BEGIN; SET LOCAL app.tenant_id = '...'; COMMIT;` sequences with the two-connection probe.
- **S8 k6 storage-flood scenario shape**: plan writes the JS scenario file (1k unknown-SNI probes/sec for 10 min).
- **Each ADR's body text length**: target ~400 words per ADR. Plan does the actual copy from ARCH/RISKS into ADR seeds.

## 9. Success criteria for this branch

- All files in §4 exist.
- `docker compose config` validates against all 5 runnable compose files.
- `make help` from `pot/` lists 40 targets (5 per spike × 8 spikes).
- The 6 ADR seeds parse as valid MADR (template-matching) and each has a non-empty Context + Decision section pulled from source docs.
- `pot/README.md` renders cleanly and a fresh reader can locate any spike's runbook in under 30 seconds.
- Branch passes a self-review against this spec (§4 file list is exhaustive, nothing extra crept in).
- **No spike has been executed.** No measurements, no Green/Yellow/Red signals, no ADR statuses moved off `Proposed`.
