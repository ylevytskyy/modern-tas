# nCall-Clone — High-Level Architecture (v0.4)

**Status:** Draft, supersedes [v0.3](./ARCHITECTURE.v0.3.md). Restructures the build into an explicit **Proof of Technology → MVP → Release** progression and absorbs the PRD v2 functional gaps that v0.3 did not number as modules (Queue, Voicemail, IVR, Inbound SMS, Reminders, PHI-scrub, i18n/a11y, nCall-fixture sprint).

**Author:** levytskyy@gmail.com, drafted with Claude Code synthesis against [PRD.v2.md](./PRD.v2.md) and [RISKS.v0.2.md](./RISKS.v0.2.md).

**Change summary vs v0.3**

1. **Phase 0 — Proof of Technology** added (4–6 weeks). Eight explicit spikes with go/no-go criteria kill the load-bearing unknowns before any module ships code. PoT runs in parallel with the Sprint-0 ADR ratification work.
2. **Four new MVP-scope modules** allocated to close PRD v2 §5.3.5 / §5.16 / §5.17 / §5.18: **M30 Queue Routing**, **M31 Voicemail**, **M32 IVR Flows**, **M33 Inbound SMS**. AC §12 #15–#17 now have explicit owners.
3. **Six existing modules extended** to close §5.10 (Operator Home), §5.14.1 (PHI scrub), §5.19 Reminders, §5.20 (TZ / i18n / a11y), §11 nCall compatibility-fixture work, and §10 report-definition pinning.
4. **Seven new ADRs (ADR-24 through ADR-30)** ratify the design choices the new modules depend on. Sprint-0 gate widens from 23 ADRs to **30 ADRs**.
5. **Timeline rebaselined to PRD §10.1** — **PoT 4–6 weeks → Sprint 0 (overlaps) → MVP 9–11 months → v1.x +3–6 months → v2 +6–12 months**. Total PoT → v2 runway 22–30 months. v0.3's ~7.5-month MVP estimate is retired as optimistic.
6. **Phase exit gates** are written as runnable checks, not prose. Each phase ends with a fixed list of artefacts + a demonstrable end-to-end behaviour. No phase rolls forward on partial completion.
7. **v1.x and v2 module placeholders** added (M34 AI Receptionist, M35 QA Scorecard, M36 Omnichannel Inbox, M37 Training Mode, mobile recipient app spec) so the data model and event surfaces in MVP do not have to be retrofitted.

Everything from v0.3 not contradicted below **carries forward verbatim** — principles P1–P12, modules M01–M29, ADRs 1–23, contracts toolchain, local-dev story. This document is a delta, not a restatement.

---

## 1. The three-phase progression

```
┌──────────────────────────────────────────────────────────────────────┐
│  PHASE 0 — PROOF OF TECHNOLOGY        4–6 weeks                      │
│  Kill the eight load-bearing unknowns. Throwaway code. Real metrics. │
│  Runs in parallel with Sprint-0 ADR work (Phase 1).                  │
│                                                                       │
│  Exit gate G0: every spike Green or formally accepted as Yellow.     │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PHASE 1 — SPRINT 0 (ADR ratification)        2–3 weeks (overlaps)   │
│  30 ADRs merged. EU counsel + Temporal sales letters attached.       │
│  LE rate-limit exemption submitted.                                  │
│                                                                       │
│  Exit gate G1: 30 ADRs merged + 2 external sign-offs in repo.        │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PHASE 2 — MVP BUILD                          9–11 months            │
│  16 modules × 5 frontends across 4 milestones (A–D).                 │
│  All MVP-scope FRs from PRD §5.1–5.20.                                │
│                                                                       │
│  Exit gate G2: AC §12 #1–#20 all green + 1 pilot tenant live.        │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PHASE 3 — RELEASE v1.x                       3–6 months post-MVP    │
│  AI Receptionist, mobile recipient app, EU region, QA scorecard,     │
│  TURN/coturn rollout, native CRM integrations.                       │
│                                                                       │
│  Exit gate G3: production-tier SLA (99.95%) holds across 90 days.    │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PHASE 4 — v2 FINAL PRODUCT                   6–12 months post-v1.x  │
│  Multi-region active-active, omnichannel inbox, training mode,       │
│  advanced reporting / cohort analytics.                              │
└──────────────────────────────────────────────────────────────────────┘
```

Total runway from PoT kickoff to v2 cut: **22–30 months**, ±25%.

---

## 2. Phase 0 — Proof of Technology (4–6 weeks)

### 2.1 Why a PoT

The risk register has eight items that, if wrong, force significant rework of any sprint that touched them. v0.3 deferred all eight to "validate in Sprint 1–3" — but Sprint 1–3 also ships M01/M02/M16/X02 code that would be partially built when a failure surfaced. PoT isolates these eight items into 1–2-engineer spikes with **demonstrable pass/fail signals** before any module construction starts.

The PoT is **throwaway by design**. Code from spikes is preserved only as fixtures, scripts, and ADR evidence — not as foundation. Surviving spikes get rewritten test-first inside the relevant sprint.

### 2.2 PoT team

- 1 senior telephony engineer (S1, S2, S3)
- 1 senior backend engineer (S4, S5, S6, S8)
- 0.5 SRE (S5, infra plumbing)
- 0.25 product / compliance lead (S7 sales/counsel coordination, S6 nCall fixture capture)

Total: ~2 FTE for 4–6 weeks. Sprint 0 ADR work runs on the senior architect + EU counsel + security eng in parallel.

### 2.3 The eight spikes

| # | Spike | Hypothesis | Go/no-go signal | Owner |
|---|---|---|---|---|
| **S1** | **End-to-end telephony happy path** | Kamailio dispatcher + rtpengine + Asterisk 22.9 LTS + ARI Outbound WS sustains a single registered softphone call through a Kamailio fail-over | New INVITEs route to a healthy Kamailio node within 30 s of primary kill; in-flight call on the failed node drops cleanly (no zombie channels in `GET /channels` after 60 s reconciliation). p95 screen-pop ≤ 800 ms at idle | Telephony eng |
| **S2** | **NestJS-arbitrated queue dequeue latency** | NestJS holding 200 callers in MOH bridges and dequeueing on operator-accept stays under 200 ms p95 ringing latency (FR-Q10 risk) | SIPp drives 200 callers into a single Queue; NestJS dequeue → ARI `Bridge` → operator-WS `ring` event p95 ≤ 200 ms over a 10-minute window. Failure modes (Redis lock contention, NATS lag) explicitly probed | Telephony + backend eng |
| **S3** | **ARI leader 100 ms hard-stop** | The ADR-16 design (close WS within 100 ms of missed Redis heartbeat) is implementable on a real Asterisk 22.9 LTS with @ipcom/asterisk-ari | Chaos test: pause leader process for 5 s. WS observed closed at the Asterisk side within 100 ms of heartbeat miss (verified via Asterisk `WebSocketEvent` log + tcpdump). Replacement leader closes orphaned channels within 7 s | Telephony eng |
| **S4** | **Two-pass redaction accuracy on 8 kHz μ-law** | AssemblyAI Universal-3 Pro Medical + Presidio NER + segment-boundary fallback achieves ≥ 95% recall on planted MRN/DOB/account/phone spans and over-bleeps by ≤ 3 s per false-low-confidence span | 30 synthetic 8 kHz μ-law fixtures with 90 planted PII spans (mix of clean, noisy, accented). Output: recall ≥ 95%, F1 ≥ 0.92, mean over-bleep ≤ 1.5 s, manual-QA backlog ≤ 2% of spans. Fixtures saved to `/contracts/fixtures/redaction-audio/` for X10 | Backend eng + compliance lead |
| **S5** | **Supavisor `SET LOCAL` parity** | Supavisor transaction-mode pooling honours `SET LOCAL` boundaries even when the underlying server connection is reused across transactions (the entire RLS-defense-in-depth design depends on this) | ADR-18 test runs Green. Negative case (next transaction on the same pooler connection sees empty `app.tenant_id`) verified. If Red: switch fallback to PgBouncer 1.22+ transaction-mode and adjust ADR-01/18 wording before Sprint 0 closes | SRE |
| **S6** | **`/v1` byte-for-byte fixture capture from live nCall** | A read-only test tenant on a real nCall instance can be cloned into golden fixtures sufficient for M25 to pass round-trip tests | 200 captured XML responses (every consumed resource, every consumed query shape) committed to `/contracts/fixtures/v1-xml/`. Unknown-quirk inventory committed to `docs/ncall-compat/quirks.md`. Failure case: vendor blocks our test tenant — fall back to scraping the existing CRM's response cache | Compliance lead + backend eng |
| **S7** | **Temporal Cloud BAA + EU namespace metadata egress** | Temporal Cloud Enterprise tier signs the BAA and confirms in writing that EU-namespace Search Attribute metadata does not egress to the US control plane | Sales letter attached to ADR-15. If Red: pivot to self-host Temporal via Helm chart v1.0.0 on EU-residency K8s (already documented as fallback). PoT exit blocked on this answer | Compliance lead |
| **S8** | **Caddy 2.10+ permission + LE rate-limit posture** | The `permission http` endpoint sustains the storage-flood class (certmagic #174) and the LE rate-limit exemption application is in flight | 1 k unknown-SNI probes/sec → permission endpoint declined-LRU absorbs, Caddy storage RPS stays under 50/sec, HAProxy trips before that. LE exemption form submitted (2–4 week ISRG turnaround acceptable since MVP doesn't ship custom domains until Sprint 8) | SRE |

### 2.4 PoT exit gate G0

- All 8 spikes Green, **or** any Yellow has a written remediation plan signed by the senior architect + the spike's owner + the on-call compliance lead, **or any Deferred-with-fallback-plan has its documented fallback (in the spike's primary ADR or spike README) adopted as the MVP implementation path and signed off by the same approvers**. **Red blocks MVP kickoff.**
- The 8 spike directories are tagged `pot/<spike>` in git for forensic reference and then deleted from `main` (their fixtures and ADR evidence carry forward).
- `docs/pot-readout.md` committed with one paragraph per spike + measurement traces.

> **Amendment 2026-05-13** — the third clause ("Deferred-with-fallback-plan") was added to the gate enum after three of eight PoT spikes (S4 redaction-accuracy, S6 `/v1` fixture-capture, S7 Temporal BAA) hit vendor-prereq blocks that could not be synthesised without invalidating the named hazard. **Deferred-with-fallback-plan** is reserved for spikes whose hazard cannot be measured in Phase 0 because external prereqs (vendor access, annotated fixtures, sales/legal correspondence) cannot be synthesised without erasing the measurement, AND where the affected ADR or spike README documents a fallback that closes the named hazard at MVP-acceptable cost. Adopting it commits the project to the fallback path; the live-vendor path becomes a Sprint-N upgrade. Each invocation requires a one-line forensic note in `pot/pot-readout.md` recording which Deferred outcome was chosen and on what basis. See `pot/g0-signoff-proposal.md` for the rationale, precedent, and per-spike fallback inventory. The amendment is **pending G0 sign-off ratification** — senior architect + compliance lead signatures on the proposal legitimise it.

If any spike trends Yellow → Red beyond week 4, the PoT may extend to 6 weeks **or** the affected design is renegotiated in an ADR amendment before MVP kickoff. **Sprint 1 does not start until G0 is signed off.**

---

## 3. Phase 1 — Sprint 0 ADR ratification (2–3 weeks, overlaps PoT)

Carries forward from v0.3 §5 with two changes:

- **30 ADRs now in the gate** (12 v0.2 + 11 v0.3 + 7 v0.4). See §9 below for ADR-24–ADR-30.
- **Sprint-0 deliverables overlap with PoT weeks 2–4**: EU counsel review of ADR-14 template; Temporal Cloud sales letter for ADR-15; LE rate-limit exemption submission for ADR-19. These are the long-lead external-dependency items.

**Exit gate G1**

- 30 ADRs merged in `docs/adr/`.
- EU counsel written opinion on ADR-14 attached as `docs/adr/0014-eu-counsel-opinion.pdf`.
- Temporal Cloud sales letter on ADR-15 attached as `docs/adr/0015-temporal-baa-tier.pdf`.
- LE exemption application receipt in `docs/adr/0019-le-exemption-receipt.pdf`.
- G0 also signed off (PoT exit).

---

## 4. Phase 2 — MVP build (9–11 months)

### 4.1 Sprint plan (revised from v0.3 §9)

```
─── PoT (4–6 weeks) ───────────────────────────────────────── runs in parallel with Sprint 0
─── Sprint 0 (2–3 weeks) ──────────────────────────────────── ADR ratification + external sign-offs

─── Sprint 1–3 (6 weeks) ── Foundations ────────────────────────────────────
  All v0.3 Sprint 1–3 scope carries forward EXCEPT items that PoT validated.
  Added: i18n + a11y baseline (ADR-28) wired into packages/ui.
  Added: M25 PHI-scrub middleware skeleton (ADR-29 / FR-AU5).
  NFR-P1 + NFR-P3 re-measured (PoT measured them on a throwaway stack).

─── Milestone A: "First registered softphone places a call" ────────────────

─── Sprint 4–7 (8 weeks) ── Core call path + queue/IVR core ────────────────
  v0.3 Sprint 4–7 scope, PLUS:
   • M30 Queue Routing — Queue + OperatorSkill entities, FIFO + sticky + priority
     strategies, NestJS-arbitrated dequeue, overflow chain skeleton (FR-Q1–Q10).
   • M32 IVR Flows — IvrFlow entity, NestJS-driven Stasis primitives (Play /
     GetDigit / Branch), per-DID binding, DAG state persistence on Channel
     vars + Postgres (ADR-26). Authoring UI scaffolded.
   • M07.Reminders sub-feature: Reminder entity + in-app + push delivery.
   • M01 Operator Home page (F03 panel set: Noticeboard / News / Stats / My
     Calls / To Do / Tasks / SMS Inbox / Voicemails — last two tabs land in
     Sprint 8–11 when M33 / M31 ship).

─── Milestone B: "Operator answers from a queue + IVR routes to queue" ─────

─── Sprint 8–11 (8 weeks) ── Scheduling, Supervisor, Portal, Billing, ──────
                              Voicemail, Inbound SMS, Compliance ──────────
  v0.3 Sprint 8–11 scope, PLUS:
   • M31 Voicemail — Stasis-driven recorder, ASR via M10 redaction pipeline,
     operator review queue surfaced in F03 + F05, dispatch via M08.
   • M33 Inbound SMS — provider webhook ingestion, ConversationThread atomic
     claiming (ADR-27), F03 inbox tab + operator reply path, STOP/HELP.
   • Queue + IVR completion: schedule-based routing (FR-Q8), overflow to
     M31 voicemail (FR-Q7), per-Queue real-time visibility in F05 (FR-Q9).
   • PHI-scrub middleware production-ready (FR-AU5, AC §12 #18).
   • nCall compatibility sprint (S6 fixtures → M25 round-trip tests + quirk
     inventory worked through).
   • 30 seed report_definitions pinned (5 medical from §10 v0.3 + 25 across
     legal/trades/property/IT-MSP/funeral/general).

─── Milestone C: "Tenant onboards, runs a queue + voicemail + SMS shift" ───

─── Sprint 12–15 (8 weeks) ── Hardening + Compliance proof ─────────────────
  v0.3 Sprint 12–15 scope unchanged, PLUS:
   • TZ correctness across DST end-to-end (AC §12 #19).
   • axe-core gate green across F03/F04/F05/F06 (AC §12 #20).
   • Pilot tenant onboarding rehearsal — full migration-assistance bundle
     dry-run against a real nCall export via M28.

─── Sprint 16 (2 weeks) ── Pilot tenant cutover + freeze ───────────────────
  Pilot tenant live. AC §12 #1–#20 all green. Production-tier SLA active.

─── Milestone D: MVP cut ───────────────────────────────────────────────────
```

Total Phase 2 calendar: PoT-exit → MVP cut = **~36 weeks of build + 3 weeks Sprint 0** ≈ **9–9.5 months**. Add ±25% volatility per PRD §10.1 → **9–11 months honest**.

### 4.2 New M-modules (extend v0.3 §4 catalogue)

| # | Module | Owner pillar | Owns / Inbound / Outbound |
|---|---|---|---|
| **M30** | **Queue Routing** *(new — closes §5.3.5)* | Domain backend | **Owns**: `queue` (id, strategy, max_wait_seconds, overflow_*…), `operator_skill` (id, user_id, skill_tag), `queue_call` (Redis sorted set: per-queue waiting-calls index w/ priority + enqueued-at). **Inbound**: NATS `telephony.event.stasis_start` from M16 → enqueue; operator-WS `accept` from F03 → dequeue race; admin CRUD via M25. **Outbound**: M16 `bridge.create` + `bridge.add_channel` on dequeue win; M16 `playback` for MOH and position-announcements; NATS `queue.depth_changed` → F05 supervisor dashboard. **Strategies in v1.0**: `fifo`, `priority`, `sticky_last_operator`, `least_recent`, `longest_idle` — implemented as pluggable selector functions tested in isolation. **Latency budget**: dequeue → ringing p95 ≤ 200 ms (S2 PoT signal). **Schedule integration**: M09.WhoIsOnCall + `account.schedule.active_queue_id` resolves the routing target at INVITE time. |
| **M31** | **Voicemail** *(new — closes §5.16)* | Domain backend | **Owns**: `voicemail` (id, account_id, call_id, recording_id, transcript, reviewed_by, reviewed_at, dispatched_message_id), `voicemail_greeting` (id, account_id, recording_id, language). **Inbound**: NATS `queue.timeout` or `queue.opt_out_dtmf` from M30 → recorder activate; M16 dialplan branch (after-hours, account-disabled-queue). **Outbound**: M10 recording pipeline (same encryption + retention chain); M10 redaction pipeline produces transcript; M07 Message of `kind = voicemail` → M08 Dispatch fanout per account's Message Actions; F03 + F05 review queue WebSocket event. **Implementation**: Stasis MixMonitor in a one-leg bridge with MOH-style prompt playback (not Asterisk `Voicemail()` dialplan app — ADR-25). |
| **M32** | **IVR Flows** *(new — closes §5.17)* | Domain backend | **Owns**: `ivr_flow` (id, name, current_version_id), `ivr_flow_version` (id, version_number, definition_jsonb, created_by, created_at), `ivr_node_analytics` (per-node hit counts, drop-offs, DTMF distribution). **Inbound**: M16 `StasisStart` for DIDs bound to an IVR; admin CRUD via M25; `ivr.test_execute` from F04. **Outbound**: M16 ARI `Play` / `PlaybackContinue` / `ChannelDtmfReceived`; on `RouteToQueue` calls M30; on `RouteToVoicemail` calls M31; on `RouteToExternal` issues a SIP transfer via M16. **State recovery (ADR-26)**: current node id, accumulated digits, and language selection persisted on Channel `CHANNEL(userfield)` *and* mirrored to Postgres `ivr_active_run` every node transition; on ARI reconnect M16 re-binds and resumes. **Authoring**: F04 visual node-graph editor (react-flow); preview mode invokes a Stasis sandbox channel. |
| **M33** | **Inbound SMS** *(new — closes §5.18)* | Domain backend | **Owns**: `inbound_sms` (id, did_id, from_e164, body, attachments_jsonb, conversation_thread_id, received_at, replied_by_user_id, replied_at, message_id), `conversation_thread` (id, account_id, peer_e164, last_message_at, status, claimed_by_user_id, claimed_at), `sms_optout` (id, e164, opted_out_at). **Inbound**: provider webhooks at `/integrations/sms/event/{provider}` (Twilio, Telnyx, Bandwidth) → ingest. **Outbound**: M19 SMS adapter for replies (attribution rewritten to operator); M07 Message of `kind = inbound_sms` for the dispatch chain; F03 inbox tab WebSocket event. **Thread atomicity (ADR-27)**: a thread is exclusively claimed by one operator at a time via Redis lock `thread:{id}` with 5-min idle release; F05 admin override flow surfaced. **STOP/HELP**: provider-side handling preferred; mirrored to `sms_optout` for cross-provider portability. |
| **M11** | **Tasks (extended — Reminders sub-feature)** | Domain backend | v0.3 spec PLUS `reminder` (id, tenant_id, user_id_target, account_id_scope, title, body, due_at, fired_at, snooze_until, dismissed_at, urgent). Delivery channels: in-app via M15 WebSocket, push via M21 (content-less when scoped to HIPAA), optional email digest via M20. Snooze surface (5/15/30/60 min + custom). Idle protection on `timed` task auto-pause already in v0.3. |
| **M25** | **REST API Facade (extended)** | API surface | v0.3 spec PLUS `/v1/<Resource>/search` POST-body filter parity (FR-AU5 / §5.14.1). **PHI-scrub middleware** runs **before** access-log emission: for HIPAA-tagged tenants the query-string is replaced with a per-tenant-salted SHA-256 hash in all L7 access logs; original retained only in encrypted application-level audit. CDN/edge configured to drop query strings entirely at the LB (ADR-29). |
| **F01 / F03 / F04 / F05 / F06** | **i18n + a11y baseline** | Frontend | i18next plumbed at `packages/ui` root. MVP locales: en-US, en-GB. Pseudo-locale `?lang=pseudo` for layout testing. ICU `Intl` for dates/numbers/currency. axe-core gate runs in CI on every frontend PR — zero AA violations on F03 inbound call flow, F06 inbox, F04 onboarding (ADR-28). Tenant + user TZ overrides surfaced in M02 user profile. |

### 4.3 Acceptance criteria mapping (PRD §12 → modules)

| AC # | PRD requirement | Owner module(s) | Sprint |
|---|---|---|---|
| 1 | Tenant with 1 account, 3 contacts, 1 form, 1 billing scheme, 1 DID, **1 Queue** | M01 + M03 + M04 + M05 + M12 + M17 + **M30** | 1–7 |
| 2 | PSTN test call → screen-pop | M16 + M18 + M03 + F03 | 4–7 |
| 3 | Form save → 5-channel dispatch ≤ 10 s | M05 + M07 + M08 + M19 + M20 + M21 + M22 | 4–11 |
| 4 | Recording encrypted + S3 + signed-URL playback | M10 + X02 | 4–7 |
| 5 | Pause recording → silence + redaction_intervals | M10 + M18 (PCI codes) | 4–7 |
| 6 | CRM smoke vs all consumed `/v1` endpoints | M25 + S6 fixtures | 4–11 |
| 7 | Supervisor ChanSpy listen | M15 + M16 | 8–11 |
| 8 | Client portal: inbox + playback + on-call mgmt | F06 + M09 + M10 | 8–11 |
| 9 | 2nd Asterisk node joins; first drains without dropping in-flight on the second | Platform/SRE (S1 PoT pattern) | 12–15 |
| 10 | HIPAA + GDPR + PCI checklist | M26 + M10 + X10 | 12–15 |
| 11 | Homer + Prom + Jaeger | X05 + X09 | 1–3 |
| 12 | Audit log chain for the test call | X04 + M14 | 4–11 |
| 13 | 4 runbooks | Platform/SRE | 12–15 |
| 14 | `make dev-up` ≤ 5 min synthetic call | §8 local-dev | 1–3 |
| **15** | **Queue + Voicemail E2E** | **M30 + M31 + M10 + F03 + F05 + F06** | **8–11** |
| **16** | **IVR E2E (digit 1 → priority queue, digit 2 → voicemail)** | **M32 + M30 + M31** | **8–11** |
| **17** | **Inbound SMS E2E (thread + reply)** | **M33 + M19 + F03** | **8–11** |
| **18** | **PHI-in-URL avoidance (POST search + scrub)** | **M25** | **8–11** |
| **19** | **TZ correctness across DST** | **F01 (i18next) + M09** | **12–15** |
| **20** | **Accessibility audit zero AA violations** | **F01 (axe-core gate) + F03 / F04 / F05 / F06** | **12–15** |

### 4.4 MVP exit gate G2

- All AC #1–#20 green in CI on a tagged release.
- 1 pilot tenant fully onboarded with the migration-assistance bundle. First production shift run. Real call recorded, dispatched, audited end-to-end.
- Pen test report attached. SAQ-D signed by QSA. BAA chain audited (AWS, Twilio/Telnyx, Temporal, OneSignal, AssemblyAI/AWS Transcribe).
- First quarterly DR drill executed on staging (ADR-22) with report committed.
- 4 runbooks complete: tenant-onboarding, operator quick-start, API guide, SRE on-call.

---

## 5. Phase 3 — Release v1.x (3–6 months post-MVP)

Carries forward PRD §10.2 + §10.3 scope. Architecture-level work:

| Sprint | Work | Modules / placeholders |
|---|---|---|
| v1.1.S1–S4 (8 wk) | **TURN/coturn production rollout** (deferred from MVP per ADR-04) | Platform/SRE; `iceServers` endpoint already in /v1 + /api/v2 facade |
| v1.1.S5–S8 (8 wk) | **AI Receptionist (M34)**: LiveKit SIP bridge + LLM agent + ASR pipeline; per-tenant agent persona; barge-to-operator hand-off; usage metered | **M34** new; bridges to M30 (escalate to live queue), M07 (transcript Message), M13 (per-3-min billing). Codec server reused for prompt/PHI redaction. |
| v1.1.S9–S12 (8 wk) | **EU-region deployment** (first GDPR-strict tenant) | Patroni replica in eu-west-1; S3 CRR target swap (ADR-21); Temporal EU namespace already provisioned in MVP; KMS multi-region keys validated under load |
| v1.1.S13–S16 (8 wk) | **Stripe self-serve flow** (already drafted in MVP F04 + §9.4); **QA Scorecard (M35)**: ATSI criteria; supervisor review workflow; per-operator score trend; reporting hooks into M27 | **M35** new |
| v1.2.S1–S8 (16 wk) | **Mobile recipient app** (iOS + Android): Expo + react-native-callkeep already sketched in MVP §2; ack flow + push (M21 EUM) + content-less payload; offline ack queue; biometric unlock for PHI display | Already plumbed at M21 + F06; this sprint builds the apps |
| v1.2.S9–S12 (8 wk) | **Native CRM integrations (Salesforce + HubSpot)** + **Post-call AI summary** + **Sentiment** + **Agent-assist advisory** | M24 extended; M34 second model surface |

### Exit gate G3

- 99.95% production-tier SLA holds across 90 days measured at edge LB.
- Mobile recipient app published to App Store + Play Store with the same BAA-covered push surface as MVP.
- AI Receptionist in production for ≥ 3 tenants with measured per-call cost within ADR-15 envelope.
- EU tenant live with full erasure / portability drill against the EU stack (Temporal EU namespace; Patroni eu-west-1 primary; S3 eu-central-1 replica).

---

## 6. Phase 4 — v2 final product (6–12 months post-v1.x)

| Track | Work | Modules / placeholders |
|---|---|---|
| Multi-region active-active | Patroni geo-replication via Bucardo or pgcat; NATS super-cluster across regions; Kamailio Anycast + per-region rtpengine + coturn; Temporal Cross-Cluster Replication | Platform/SRE; existing single-region topology generalised |
| Omnichannel inbox | Web chat ingestion + two-way SMS already shipped (M33) + email reply threading; unified inbox surface in F03 | **M36** new |
| Native ConnectWise + Autotask | M24 extension with PSA-specific schemas | M24 extended |
| Training mode | Supervisor shadow + supervised takeover; trainee op state; recording chain partitioned from production audit | **M37** new |
| Advanced reporting | Cohort analytics, custom dashboard builder in F04, scheduled exports beyond MVP 30 seed report_definitions | M27 extended; Cube.dev Enterprise already in MVP |

No Phase-4-specific architecture decisions surface today that the MVP data model and event surfaces do not already accommodate. Module placeholders M34–M37 above ensure data-model + AsyncAPI extension points exist by the end of MVP.

---

## 7. Updated module catalogue (v0.4 — delta only)

The catalogue is now **35 modules** (was 29 in v0.3): M01–M29 unchanged from v0.3 (with the §4.2 extensions to M07/M11/M25), plus **M30–M33** in MVP scope and **M34–M37** as placeholders for Phase 3 / 4.

```
MVP scope (Phase 2 — must ship for AC #15–#18):
  M30  Queue Routing                      Domain backend     §5.3.5
  M31  Voicemail                          Domain backend     §5.16
  M32  IVR Flows                          Domain backend     §5.17
  M33  Inbound SMS                        Domain backend     §5.18

Phase 3 (v1.x):
  M34  AI Receptionist                    Integration + AI    §10.2
  M35  QA Scorecard                       Compliance / QA     §10.2

Phase 4 (v2):
  M36  Omnichannel Inbox                  Domain backend      §10.4
  M37  Training Mode                      Compliance / QA     §10.4
```

Data-model rows added (carry into the v0.3 §7.6 catalogue):

```
Reminder            id, tenant_id, user_id_target, account_id_scope, title,
                    body, due_at, fired_at, snooze_until, dismissed_at, urgent

VoicemailGreeting   id, tenant_id, account_id, recording_id, language

IvrActiveRun        id, tenant_id, flow_version_id, channel_id, current_node_id,
                    accumulated_digits, language, started_at, last_node_at

SmsOptout           id, tenant_id, e164, opted_out_at, source

QueueCall           (Redis only — per-queue sorted set of waiting calls keyed by
                     priority then enqueued_at; mirrored to Postgres `call.status`
                     every 5 s for reconciliation)
```

---

## 8. Updated cross-cutting modules

| # | Module | Delta |
|---|---|---|
| X10 | Compliance test suite | Adds: **(a)** 200-caller queue dequeue latency replay against S2 PoT trace; **(b)** voicemail-without-Asterisk-Voicemail()-app correctness (ADR-25); **(c)** IVR state-recovery on simulated ARI reconnect mid-flow (ADR-26); **(d)** ConversationThread atomic claim under 50-parallel-operator race (ADR-27); **(e)** axe-core gate on F03/F04/F05/F06 (ADR-28); **(f)** PHI-scrub middleware log-emission verification (ADR-29); **(g)** TZ-DST end-to-end on a fixture schedule. |
| X05 | Observability | Adds NFR-Q1/Q2/Q3 (MOS / PLC / jitter) dashboards from rtpengine RTCP exporters. Per-queue depth + dequeue-latency Prom metrics from M30. Per-flow node-analytics from M32. |
| X02 | KMS / envelope | No change to crypto, but per-tenant CMK now also wraps `tenant_vapid_keypair.wrapped_private_key` (v0.3) and `voicemail_greeting.recording_id`-derived DEKs (M31). |

---

## 9. New ADRs (ADR-24 through ADR-30)

| ADR | Decision | Rationale (short) |
|---|---|---|
| **ADR-24 — Queue dequeue latency budget = 200 ms p95** | NestJS-arbitrated dequeue must hit p95 ≤ 200 ms ringing-latency from operator-WS `accept` to operator-WS `ring`. Implementation: in-memory per-queue priority heap in the NestJS shard that owns the queue (sticky-hash on `queue_id`); Redis only for cross-shard ownership lock + recovery snapshot every 5 s. NATS notifies eligible-operator WS gateways. **PoT S2 gates this design**: if S2 exceeds 200 ms, M30 falls back to Asterisk `Queue()` for FIFO-only queues and NestJS handles only the priority/sticky/skills variants. | Closes PRD §5.3.5 FR-Q10 risk. Latency budget is plausible but unproven — PoT measures before commit. |
| **ADR-25 — Voicemail via Stasis MixMonitor, not Asterisk `Voicemail()`** | Voicemail runs as a NestJS-orchestrated Stasis flow: caller enters a one-leg bridge with greeting playback, MixMonitor records to the same recording pipeline as live calls, hang-up cap at 5 min or caller-DTMF-`#`. **No use of Asterisk `Voicemail()` dialplan app.** Reasons: built-in transcription is poor, integration with our Message model is awkward, retention policy is per-tenant whereas Voicemail() is per-Asterisk-server. | Closes PRD §5.16 FR-VM7. Reuse of M10 pipeline means encryption + redaction + retention come for free. |
| **ADR-26 — IVR DAG state persistence on Channel + Postgres** | Current node id, accumulated digits, language selection, and arbitrary IVR-flow-scoped variables persist on Asterisk `CHANNEL(userfield)` + Postgres `ivr_active_run` on every node transition. On ARI reconnect, M16 reads both, prefers Postgres (Asterisk channel variables are not durable across Stasis-app restart), and resumes the flow. Channel-variable mirror is belt-and-braces in case Postgres is briefly unreachable. | Closes PRD §5.17 FR-IVR7. Lost DTMF events on ARI reconnect was a v2 risk in PRD §11. |
| **ADR-27 — Inbound SMS ConversationThread atomic claim** | A ConversationThread is held by exactly one operator at a time via a Redis lock keyed `thread:{id}` with 5-min idle TTL. Operator-side UI shows the claim status; on stale lock release (5 min no reply event) the thread re-enters the free pool. Admins (F05) can force-release a claim. STOP/HELP responses are auto-emitted by the M33 webhook handler before any operator claim. | Closes PRD §5.18 FR-SMS4 fragmentation risk + PRD §11 v2 risk. |
| **ADR-28 — i18n + a11y baseline as a Sprint-1–3 deliverable** | `packages/ui` ships with i18next plumbed; MVP locales en-US + en-GB; pseudo-locale `?lang=pseudo` for layout testing; ICU Intl for dates/numbers/currency. CI runs axe-core on every frontend PR (F03 / F04 / F05 / F06); merging is blocked on zero AA violations on the inbound call flow. Tenant + user TZ overrides surfaced in M02; UTC-only storage at the DB layer. Keyboard-navigable end-to-end gate on F03 inbound call flow (no mouse). | Closes PRD §5.20 + AC §12 #19–#20. v0.3 elided this; v0.4 makes it a Sprint 1–3 gate so it doesn't get retrofitted at hardening time. |
| **ADR-29 — `/v1` PHI-scrub middleware + POST search parity** | M25 ships a request-level middleware (runs before the access-log emitter) that, for HIPAA-tagged tenants, replaces the query-string in the access log with `sha256(per-tenant-salt + query)`; original retained only in encrypted application-level audit (X04). Edge LB configured to drop query strings entirely (path + status only). M25 also exposes `POST /v1/<Resource>/search` accepting the same field filters in the JSON request body for every list endpoint. | Closes PRD §5.14.1 FR-AU5–AU8 + AC §12 #18. |
| **ADR-30 — 30 seed report_definitions pinned by end of Sprint 8** | Sprint 8 deliverable: product + each vertical's domain SME produce the remaining 25 seed `report_definitions`. v0.3 §10 has 5 medical-vertical seeds; the remaining 25 split as: legal 4, trades 4, property 4, IT-MSP 4, funeral 3, general 6. The 30 ship in M27; each definition has slug, scope (admin/tenant/portal), Cube.dev query JSON, viz config, and version. Past Sprint 8 these are blocking on M27 cut. | Closes PRD §11 open question and the v0.3 §5b open item. |

---

## 10. Open items remaining at end of v0.4

- **Form Designer visual builder UX pass** — still open (carries from v0.3).
- **Hardware SIP phone auto-XML provisioning** — v1.x, manual issuance in MVP (carries from v0.3).
- **AI Receptionist persona authoring + LLM cost guardrails** — v1.1 design pass.
- **Multi-region active-active conflict-resolution policy** — v2 design pass; not blocking MVP.
- **Mobile recipient app offline ack-queue design** — v1.2 design pass.

---

## 11. Risk register additions vs v0.3

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| PoT runs > 6 weeks → MVP cut slips proportionally | Medium | Medium | Phase 0 hard cap at 6 weeks; Yellow spike with remediation plan is acceptable to roll into Sprint 1; only Red blocks. |
| M30 dequeue p95 exceeds 200 ms under real load | Medium | Medium | ADR-24 fallback path (Asterisk `Queue()` for FIFO-only) is sketched. PoT S2 measures before MVP code lands. |
| Voicemail recall on 8 kHz μ-law misses PII below 95% | High | Medium | ADR-13 over-bleep fallback + 2% manual QA gate already in place from v0.3. PoT S4 measures the floor. |
| nCall test-tenant access denied → S6 fixtures absent | Medium | Medium | Fall back to scraping existing CRM response cache; if also denied, raise to product as a P1 — MVP CRM-compat smoke (AC §12 #6) cannot ship without fixtures. |
| 30 seed report_definitions not pinned by Sprint 8 | Medium | Medium | ADR-30 names the deadline; failure de-scopes the report-library claim from MVP marketing — ship 10 instead of 30 and roadmap the rest into v1.1. |
| i18n / a11y retrofit at hardening time | Medium | Low (now gated in Sprint 1–3 via ADR-28) | Gate is Sprint 1–3 in this revision; CI block on axe-core prevents drift. |

---

## 12. TL;DR

Three things make v0.4 work, building on v0.3's compliance and telephony spine:

1. **A 4–6 week Proof-of-Technology phase with eight named spikes**, each with a go/no-go signal. Runs in parallel with the (now 30-ADR) Sprint 0 ratification. No module construction starts until G0 + G1 are signed.

2. **Four new MVP-scope modules (M30 Queue, M31 Voicemail, M32 IVR, M33 Inbound SMS)** plus five extensions (Reminders in M11, PHI-scrub + POST-search in M25, i18n+a11y in F01, Operator Home in F03, nCall fixture work in M28/M25). AC §12 #15–#20 now have explicit owners and sprint placement.

3. **Honest timeline rebaselined to PRD §10.1**: PoT 4–6 weeks → MVP 9–11 months → v1.x +3–6 months → v2 +6–12 months. Total runway PoT → v2 = **22–30 months** ±25%. v0.3's implied 7.5-month MVP is retired.

The build is ready to start from PoT next sprint. If S5 (Supavisor parity) or S7 (Temporal BAA) come back Red, the architecture has documented fallbacks (PgBouncer; self-host Temporal). If S4 (redaction recall) comes back below 95%, compliance & legal renegotiate ADR-13's manual-QA sample percentage before M10 ships. Everything else has remediation plans rather than open questions.
