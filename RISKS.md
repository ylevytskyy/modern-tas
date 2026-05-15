# Risk Assessment — ARCHITECTURE.md (v0.1) vs PRD.md (v1.0)

**Date:** 2026-05-12
**Author:** levytskyy@gmail.com, synthesised with Claude Code (4 parallel research agents: telephony, compliance/multi-tenancy, PRD↔ARCH gap analysis, web/industry research).
**Status:** Draft for review.

This document is the output of a thorough risk assessment. It rolls up:
- 10 telephony-plane risks (R-T##)
- 11 compliance/multi-tenancy risks (R-C##)
- 12 industry/production failure-mode risks (R-W##, with citations)
- ~16 PRD coverage gaps and ambiguous allocations
- Acceptance-criteria traceability against PRD §12

Findings that surfaced in multiple research streams (e.g. the RLS+pgBouncer hazard, ARI WebSocket reliability, FCM HIPAA status) are consolidated below into single entries with all cross-references.

---

## 0. TL;DR

The architecture is well-organised and reads as the work of someone who knows the domain. But it is **v0.1** and several load-bearing pieces are decided in one-liners ("RLS via session GUC", "Redis lock for ARI leader", "MixMonitor → shared volume → worker", "fast-xml-parser locked-order") that fall apart under contact with reality. The risks cluster in five places:

1. **Multi-tenant isolation is one bug away from breaking.** Postgres RLS via session GUC works only if the GUC is set on *every* path. Workers, migrations, and pgBouncer-pooled connections all bypass it by default. (R-C01, R-C02, R-C06, R-W04)
2. **The MVP softphone story is silently broken for ~10–25 % of corporate users** because rtpengine without TURN cannot traverse symmetric NAT. The PRD acknowledges this in a risk-register line; the architecture buries it in §7.2.4 with no monitoring plan for the failed-ICE rate. (R-T05, R-T06, R-W02)
3. **HIPAA × PCI × GDPR overlap has no orchestration owner.** Erasure of an EU caller's PHI from a HIPAA tenant's 7-year recording is a multi-step saga touching M07, M10, M14, S3, KMS — and no module owns it. (R-C03, R-C08)
4. **PCI MVP path is SAQ-D, not SAQ-P2PE**, with sox post-processing as the *only* control. Delegated capture is deferred to v1.1. Audit risk is real. (R-C04, R-T08)
5. **Several "decided" architecture choices (§5) are immature for production.** NATS JetStream lost ~50 % of ACK'd writes in Jepsen Dec 2025; NestJS has no native JetStream transport; SIP.js maintenance has stalled; fast-xml-parser does not guarantee output ordering. Each is fixable but none have ADRs. (R-W05, R-W08, R-W11, R-W12)

Five things need ADRs **before any code lands** (see §5 below). Roughly 15 things need ADRs before the relevant module starts. A 6–9 month MVP target is plausible only if these are resolved up front; otherwise expect a coordination tax of 4–6 weeks.

---

## 1. Critical risks (consolidated, ranked)

The single most damaging risks. Each combines findings from multiple research streams.

### C1. RLS-via-session-GUC fails silently under pgBouncer and in workers
**Refs:** R-C01, R-C02, R-W04

- **Claim:** ARCH X01 (interceptor sets `app.tenant_id`) + X03 (every table has a policy) gives tenant isolation.
- **Why it fails:** (a) BullMQ workers and migrations bypass the interceptor entirely. (b) pgBouncer in transaction mode (the only mode that actually pools) resets session GUC between transactions — Prisma's [own docs](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer) warn that "SET LOCAL will not work properly with pgbouncer in statement pooling mode; you may return rows for the wrong users." (c) Table owners have `BYPASSRLS` by default unless `FORCE ROW SECURITY` is set.
- **Failure mode:** Cross-tenant data leak that is silent in staging (single tenant), explosive in production.
- **PRD at stake:** P3 (tenant ID is sacred), FR-T1, NFR-S8, NFR-S10 (HIPAA), NFR-S11 (GDPR).
- **Severity:** **High × High**.
- **Mitigation:** Mandate `BEGIN … SET LOCAL … COMMIT` at the Prisma middleware layer; `ALTER TABLE … FORCE ROW SECURITY`; add a CI test that runs a BullMQ-simulated query without GUC and asserts zero rows; add a chaos test that runs concurrent multi-tenant load through pgBouncer transaction mode.

### C2. ARI leader election gap — events lost during failover, no reconciliation
**Refs:** R-T04, R-W09

- **Claim:** ARCH M16 has one NestJS replica owning each Asterisk's ARI WS via Redis lock with TTL.
- **Why it fails:** Asterisk does not buffer ARI events. During the lock-TTL gap (replica OOM, rolling deploy, idle proxy disconnect), events are emitted to a dead WebSocket and lost forever. There is also a [confirmed Asterisk behaviour](https://community.asterisk.org/t/long-running-websocket-connections-and-timeouts/86740) that after a WS reconnect, an ARI app stops receiving events for channels it was previously subscribed to. A lost `call.ended` → orphaned Call row, no recording stop, billing unclosed, operator stuck `Wrapping`.
- **PRD at stake:** FR-R2, FR-C10, NFR-A1 (99.9 %), billing accuracy.
- **Severity:** **High × Medium** (replica crash is a normal K8s event).
- **Mitigation:** Reconciliation job (every 30 s) that diffs `AMI GET /channels` against open Call rows and closes orphans; reconnect handler must re-subscribe to all active channels; short Redis lock TTL with fencing token. ARCH §11 already lists "ARI leader election timing semantics" as unresolved — this is the resolution.

### C3. rtpengine without TURN — silent audio failure 10–25 % of corporate users
**Refs:** R-T05, R-T06, R-W02

- **Claim:** ARCH defers coturn to v1.x; rtpengine + `ICE=force` server-reflexive is sufficient for MVP.
- **Why it fails:** Multiple industry sources confirm 10–25 % of enterprise endpoints are behind symmetric NAT where STUN reflexive candidates fail. rtpengine is an ICE-aware relay, not a TURN server. Failure mode is one-way or no audio, with no visible error. Enterprise TAS clients are the *most* firewall-constrained population. Additionally, rtpengine kernel-forwarding is unavailable on macOS Docker, so local dev silently runs the userspace path while production runs kernel — divergence per NFR-M1.
- **PRD at stake:** S2 (operator throughput), S5 (HA failover graceful), G6 (browser-first operator), NFR-M1 (local-dev parity).
- **Severity:** **High × High**.
- **Mitigation:** Either ship coturn in MVP (additive, well-understood — see PRD §7.2.4 hooks already in place) **or** ship a hard observability gate (failed-ICE rate dashboard + alert, beta-tenant onboarding pause if > 2 %). Document the macOS dev-prod path divergence and run load tests on Linux only.

### C4. PCI MVP path is SAQ-D, not delegated capture — sox is the only control
**Refs:** R-C04, R-T08

- **Claim:** ARCH M18 mentions both pause+redact and delegated-capture; X07 has `delegated_pci_capture` feature flag.
- **Why it fails:** PRD §11 Open Q 4 places delegated capture in v1.1. MVP ships pause+redact only. This is SAQ-D scope (full CDE assessment). Correctness depends on (a) sub-second precision of `redaction_intervals` (currently NestJS wall-clock, not Asterisk sample offsets), (b) handling open-ended intervals (call ends before resume), (c) the sox redaction job actually running and verified. `MixMonitorMute` is mute, not silence — the WAV continues to advance, requiring post-process byte-replacement.
- **PRD at stake:** NFR-S12, §8.3, FR-R4, S6.
- **Severity:** **High × Medium**.
- **Mitigation:** Have a PCI QSA confirm SAQ-D viability with the proposed control set; OR commit delegated capture to MVP (re-scope M18); add X10 compliance tests for edge cases (pause at first 500 ms, rapid toggling, open-ended interval); source timestamps from Asterisk CEL sample counts, not NestJS clock.

### C5. HIPAA × GDPR × PCI overlap has no orchestration owner
**Refs:** R-C03, R-C08

- **Claim:** ARCH M14 (audit), M10 (recording erasure), M01 (`tenant.suspended`) implement individual controls.
- **Why it fails:** A HIPAA tenant with `gdpr=true` whose EU caller exercises Art. 17 mid-retention window requires deciding: delete the recording (violates 7-year HIPAA retention) or pseudonymise it (no module owns "redact jsonb fields in `message.content`"). At tenant scope, there is no `tenant.deleted` workflow at all — `tenant.suspended` is not erasure. Self-serve cancellation (PRD §9.4) has an export but no delete saga.
- **PRD at stake:** NFR-S11, FR-R9, §8.2, §9.4.
- **Severity:** **High × Medium**.
- **Mitigation:** New cross-module orchestration module (call it M26 *Compliance Workflows* or extend M14) that owns: (a) erasure sagas across M07, M10, S3, KMS; (b) tenant-deletion saga with grace period; (c) HIPAA-vs-GDPR conflict policy per tenant flag. Add right-to-portability export (PRD §8.2 Art. 20) — also unallocated.

### C6. Kamailio in-dialog routing breaks after node failover
**Refs:** R-T03, R-W01

- **Claim:** ARCH §3 macro topology + NFR-A2: active-active Kamailio with `dialog` DB-backed for sticky routing.
- **Why it fails:** Confirmed [Kamailio GH #2080](https://github.com/kamailio/kamailio/issues/2080) — after failover, profile sizes show as 0 and in-dialog routing is broken; `dlg_db_mode=1` loads dialogs at startup only, not on the fly. [GH #2547](https://github.com/kamailio/kamailio/issues/2547) documents DMQ workers leaking shared memory until SIP processing stops. Separately, DMQ usrloc sync is asynchronous — registration on node A then INVITE on node B within the window (50–500 ms) → 480/404.
- **PRD at stake:** NFR-A2, S5 (graceful within 30 s).
- **Severity:** **High × Medium**.
- **Mitigation:** Be explicit that single-node Kamailio failover drops in-flight calls (matching the ARCH §9 honesty about Asterisk), AND set NFR-A2 to "new calls continue routing within 30 s" rather than "in-flight calls do not drop." OR add a Postgres-backed usrloc fallback (`db_mode=3`) and a runtime dialog-rehydration path (substantial design change). Reference architectures: Sipwise NGCP, Wazo.

### C7. FCM has no HIPAA BAA — push notifications cannot carry PHI
**Refs:** R-W06, R-C09 (related)

- **Claim:** ARCH M21 lists FCM + APNS for push; PRD NFR-S10 says "No PHI in non-secure SMS body — only pointer". Push is not addressed equivalently.
- **Why it fails:** Google does not include FCM in its HIPAA BAA — confirmed by [multiple 2025/2026 sources](https://impanix.com/hipaa/is-firebase-hipaa-compliant/). Any push payload that includes caller name, phone, message reason is PHI. Not configurable.
- **PRD at stake:** NFR-S10, §8.1.
- **Severity:** **High × High** (architectural; choosing FCM means PHI cannot ride on push).
- **Mitigation:** Either treat push the same as SMS for HIPAA tenants (pointer-only, "you have a message — login to portal"), OR replace FCM path with a BAA-covered alternative (Twilio Notify under BAA, or self-hosted proxy that strips PHI before forwarding to FCM). Decide before the v1.x mobile recipient app ships.

### C8. NATS JetStream loses ACK'd writes — P5 "retry idempotently" assumes durability
**Refs:** R-W05

- **Claim:** ARCH P5 + X08: workers retry idempotently via NATS JetStream.
- **Why it fails:** [Jepsen Dec 2025](https://jepsen.io/analyses/nats-2.12.1) found that default fsync (every 2 min, not on ACK) on NATS 2.12.1 caused **49.7 % of ACK'd writes to be lost** under OS crash + network pause. Prior versions could lose entire streams on a process crash. NATS upstream considers fsync default a design choice. If JetStream loses the published event, the worker never retries — there is nothing to retry.
- **PRD at stake:** P5, NFR-S10 (audit trail completeness), FR-AU3.
- **Severity:** **High × Low** (specific failure modes, but consequence is silent data loss on critical events).
- **Mitigation:** Mandate `fsync=always` (or equivalent `sync_interval=0`) in NATS server config; document split-brain recovery; consider Redis Streams as an alternative (BullMQ already wires it).

### C9. Argon2id Basic-Auth verification at 100 RPS misses NFR-P6
**Refs:** R-C05

- **Claim:** NFR-S4 mandates Argon2id; FR-T7 mandates Basic Auth on `/v1`; NFR-P6 mandates ≤ 200 ms p95 read at 100 RPS sustained per tenant.
- **Why it fails:** Argon2id at OWASP parameters (m=64 MB, t=3, p=4) takes 300–700 ms per verify. At 100 RPS sustained, 30–70 concurrent verifications. Arithmetically incompatible with the latency NFR.
- **PRD at stake:** NFR-P6, NFR-S4, FR-T7.
- **Severity:** **High × High**.
- **Mitigation:** Short-lived (e.g. 60 s) HMAC-keyed Redis cache of verified credentials; password change explicitly invalidates. OR weaker Argon2id parameters specifically for the API auth path. Decide before M02 ships; this is a hot path on the CRM compat surface.

### C10. PJSIP realtime cache stale on provisioning + cross-tenant naming collision
**Refs:** R-T01, R-T02, R-W03

- **Claim:** ARCH M17 — PJSIP realtime from Postgres; Model B per-tenant context.
- **Why it fails:** (a) Asterisk sorcery cache does not auto-invalidate on DB write. Provisioning a new endpoint requires explicit `SorceryMemoryCacheExpireObject` AMI call or `pjsip reload` (which briefly stalls all endpoint lookups). [Asterisk Community thread](https://community.asterisk.org/t/realtime-registration-needs-pjsip-reload-or-show/100490) confirms. (b) PJSIP object names must be **globally unique on the Asterisk instance**, not per-tenant unique. A collision between tenants (e.g. both have `endpoint=softphone_1`) silently maps auth to the wrong context. (c) Standard feature contexts (`macro-*`, `parkedcalls`, `featuremap`) are global — PCI `*7`/`*8` feature codes bound there cross tenant boundaries.
- **PRD at stake:** FR-T1, FR-T2, NFR-S2 (HIPAA SRTP per tenant), NFR-S12 (PCI scope).
- **Severity:** **High × Medium**.
- **Mitigation:** ADR for sorcery cache invalidation strategy (AMI call after every provisioning write, expiry TTL); PJSIP object naming convention `<tenant_id>_<username>` enforced at provisioning; X10 must include a SIPp test that `*7` from Tenant A cannot affect Tenant B's recording.

---

## 2. Significant risks

### S1. MixMonitor recording pipeline — RWX volume and inotify reliability
**Refs:** R-T07, R-W10

- 100 concurrent MixMonitor recordings + envelope encryption + shared volume between Asterisk pods and NestJS worker.
- K8s does not support RWX on EBS/GCE PD; NFS/EFS + inotify is a [documented anti-pattern](https://vitalpbx.com/blog/asterisk-pbx-multicore-4500-calls-test/) — inotify does not fire on NFS-driven writes from another container.
- **Mitigation:** Node-local SSD `emptyDir` + per-pod upload worker, OR Asterisk streams directly to S3 via `res_http_post`. Drop inotify; use `post_record.sh` → NATS.

### S2. Mixed Model A + Model B Asterisk fleet — no Kamailio routing spec
**Refs:** R-T09

- HIPAA-strict tenants get dedicated Model A; non-HIPAA share Model B pool. ARCH does not describe Kamailio dispatcher groups, DID-to-group binding, or the orchestration API.
- **Failure:** HIPAA call lands on shared Model B = HIPAA violation.
- **Mitigation:** ADR before first HIPAA tenant. Partitioned dispatch tables (group 1 = shared, group N = per-Model-A); DID routing selects group before `ds_select_dst`.

### S3. Recording 100-concurrent-calls scale claim unvalidated
**Refs:** R-T10, R-W10

- NFR-P1 asserts 100 concurrent on 4 vCPU / 8 GB. No profiling data. MixMonitor I/O thread-per-channel, ARI event rate ~500–1000/min at 100 calls processed by single replica.
- **Mitigation:** Profile in Sprint 1–3 (foundations), not Sprint 12–15. If it fails, the architecture has no autoscaling story.

### S4. DEK in S3 metadata — per-tenant IAM unspecified
**Refs:** R-C07

- Encrypted DEK in S3 object metadata is readable by anyone with `s3:GetObject`. A rogue/compromised NestJS replica can attempt to decrypt any tenant's DEK if it can call KMS with the right key ID.
- **Mitigation:** Per-tenant IAM role, KMS key grant restricted to that tenant's service context, per-tenant S3 prefix IAM condition.

### S5. Audit log INSERT with wrong tenant_id not blocked by RLS
**Refs:** R-C06

- RLS blocks cross-tenant UPDATE/DELETE but not an INSERT with a fabricated `tenant_id`. Bug in outbox processor (stale tenant context, BullMQ worker without reset) writes audit row into wrong tenant's bucket.
- **Mitigation:** DB-level CHECK or trigger that ties `audit_log.tenant_id` to the session's GUC; CI test for cross-tenant WRITE, not only READ.

### S6. KEK rotation — multi-version reads not designed
**Refs:** R-C11

- HIPAA tenant's 7 years of recordings → re-encryption window is millions of objects. Race: row's `kek_id` doesn't match S3 object's wrapping during re-encryption.
- **Mitigation:** `KekService.decrypt()` accepts `kek_version_id`; atomic re-wrap + DB update; X10 test for playback during simulated rotation.

### S7. PHI-in-SMS lint cannot catch runtime template injection
**Refs:** R-C09

- ARCH X10 lints static templates. SMS templates are configured by tenant admins at runtime via Message Action editor — lint cannot see runtime tokens.
- **Mitigation:** For HIPAA tenants, restrict SMS template token set at save time (only portal-link + account-name allowed; form-field tokens blocked). Validator in admin UI.

### S8. SIP.js maintenance stalled — Safari/iOS audio suspension silent
**Refs:** R-W08

- [Comparative 2025 analysis](https://sheerbit.com/the-future-of-sip-js-and-jssip-in-webrtc-application-development/): SIP.js releases slowing, Safari background-tab audio suspension silently kills calls. JsSIP more actively maintained.
- **Mitigation:** Re-evaluate SIP.js vs JsSIP vs raw WebRTC + custom signalling for F03 before the multi-line state machine work starts.

### S9. No native NestJS JetStream transport
**Refs:** R-W11

- NestJS `@nestjs/microservices` NATS transport uses core NATS, not JetStream. Workers must wire JetStream consumers manually — duplicating what `@MessagePattern` is supposed to abstract.
- **Mitigation:** Commit to hand-rolling JetStream consumer infrastructure, OR pick a backbone with native NestJS support (Redis Streams).

### S10. fast-xml-parser output ordering not guaranteed by spec
**Refs:** R-W12

- V8 insertion-order is *de facto* stable but not guaranteed by ECMA for non-integer keys. Any DB→JSON middleware that touches the intermediate object can perturb element order. CRM XML parsers may be order-sensitive.
- **Mitigation:** Round-trip fixture test that byte-compares produced XML to a captured TAS reference response. Failure here breaks the CRM compatibility constraint, which the project memory marks non-negotiable.

### S11. TLS cert provisioning for custom portal domains — no module
**Refs:** R-C10

- Per-tenant subdomain solved by wildcard cert. Custom domain (PRD §5.8 "optional") requires ACME challenge, DNS verification, renewal. Not allocated.
- **Mitigation:** Either (a) drop custom domain from MVP scope, OR (b) allocate cert-manager / Caddy / step-ca to a Platform/SRE owner with a renewal BullMQ job.

### S12. rtpengine "active-active" — no DTLS failover for in-flight calls
**Refs:** R-T06

- Per-call DTLS context and SRTP keys are in-memory in rtpengine; cross-engine replication absent. Kamailio health-check failover only re-routes new INVITEs.
- **Mitigation:** Honest scoping: NFR-A4's "active-active" applies to new calls only; in-flight RTP through a failing rtpengine times out after ~30 s.

### S13. Patroni RPO ≤ 1 min, RTO ≤ 1 min only with synchronous replication
**Refs:** R-W07

- Default async streaming may have multi-second lag; RTO ≤ 60 s requires tuned TTL + leader election under load.
- **Mitigation:** `synchronous_mode=true` in Patroni config (with the write-latency hit acknowledged), OR soften NFR-A5 RPO claim to "≤ 5 min."

---

## 3. PRD coverage gaps (consolidated)

Requirements in PRD with no architectural owner or significantly under-specified.

### High-priority gaps (must be assigned before MVP build)

| PRD ref | Requirement | ARCH gap | Severity |
|---|---|---|---|
| §4.1 #14, §5.9, §5.13 | 30+ standard reports engine | No reports module exists. F06 mentions "reports" in one line. Multiple modules could claim ownership (M06, M12). | **H** |
| FR-X11 | Bulk CSV import with column mapping | No module, no worker, no ingress pipeline. | **H** |
| FR-S5 | Coverage-gap detection + operator console warning on gap | M09 emits `otas.gap_detected`, nothing consumes. Admin report + FE warning unallocated. | **H** |
| NFR-S13 | Per-tenant toll-fraud monitor (Redis sliding window) | Pike rate-limit covers per-IP; per-tenant cost-window has no owner. | **H** |
| FR-D2 | Email open-tracking webhook callback | M19 has `/integrations/sms/dlr/{provider}` ingress; email equivalent missing. | **H** |
| FR-F2 | Computed field (formula over other fields) | JSON Schema chosen as form DSL; JSON Schema has no formula. Extension unspecified. | **H** |
| §12 #13 | Documentation: onboarding runbook, operator quick-start, API guide, SRE runbook | No documentation deliverable in ARCH. Not a module, not a sprint gate. | **H** |

### Medium-priority gaps

| PRD ref | Requirement | ARCH gap | Severity |
|---|---|---|---|
| FR-C13 | Per-tenant, per-user keyboard shortcut overrides | F03 owns console layout; no shortcut storage schema or runtime resolution. | M |
| FR-F8 | Hyperlink tokens `[Dial:…][Search:…][Client:…][Contact:…]` | F03 consumes them; no module owns token grammar or action dispatch wiring. | M |
| §9.4, §10.2 | Stripe Billing self-serve sign-up + checkout | M13 has subscription tables; self-serve UX (signup flow, checkout, cancellation+export gate) unallocated. | M |
| §5.8 | White-label custom domain (optional) | Wildcard subdomain works; custom domain needs ACME + DNS automation, no module. | M (see S11) |
| §9.3 | Migration assistance bundle: TAS data import tooling | Commercial offering with engineering dependency; invisible in ARCH. | M |
| §11 Q5 / FR-P8 | Web push (VAPID) for portal users | M21 covers FCM/APNS only; VAPID key mgmt absent. | M |
| FR-O5 / NFR-O4 | `X-Call-UUID` OTel trace through Kamailio → channel var → ARI → NestJS | X05 names requirement; no design for SIP header survival across hops. | M |
| §8.2 / NFR-S11 | GDPR right-to-portability (Art. 20) export | Right-to-erasure covered (FR-R9); portability has no module. | M |
| NFR-S12 | PCI delegated-capture mid-call handoff to Telnyx Pay / Stripe Terminal | M18 mentions, X07 has flag; no dialplan/ARI spec for handoff and return. | M (see C4) |
| §10.1 | FCM/APNS in MVP scope vs v1.x | M21 listed "v1.x scope but stub from day 1"; AC §12 #3 demands "all five channels within 10 s". Mismatch. | M |
| AC §12 #8 | Portal contact-availability change reaches operator console within 5 s | M04 emits `contact.availability_changed`; no WS path from M04 → F03. | M |

### Low-priority gaps

| PRD ref | Requirement | Severity |
|---|---|---|
| §4.1 #4 / G6 | Hardware SIP phone provisioning (auto-XML, firmware URLs) | L |

### Ambiguous module allocations (turf risk)

These are partially in ARCH but with unclear or overlapping ownership. Each is a risk that two teams build incompatible halves.

- **Reports engine**: F06 lists "reports" as a bullet. PRD §5.9 (portal) and §4.1 #14 (tenant-wide 30+) need different surfaces. M06 owns Calls, M12 owns Billing — neither is the renderer.
- **Dispatch dashboard (FR-D10)**: M08 emits events; UI unallocated across F04 / F05 / F06.
- **Operator-state machine (FR-C12)** with `Break`/`Lunch`/`Training`: M15 owns `operator_presence` (Redis), F03 owns console state. Boundary unstated.
- **`/v1/admin/web_message_actions`**: Owner of `web_message_action` table not in any module's `Owns` column.
- **Billing CSV export (FR-B4, 50+ fields)**: M12 owns line items; export endpoint vs worker vs FE-trigger unclear.
- **Noticeboard / News (FR-H1, FR-H2)**: M11 owns tables; role/account-scoped delivery for News unallocated.

### ARCH-side scope concerns

- **M25 (`/v1` + `/api/v2` facade)** is described in three table cells but covers two API surfaces, XML serialisation, schema fixture tests, OpenAPI emission, and webhook subscription management. Single highest single-module delivery risk for a 6–9 month MVP.
- **F03 (Operator Console)** cannot begin until the multi-line state machine xstate diagram exists (ARCH §11 admits this is unresolved). The pre-work is unscheduled.
- **`packages/templates`** (referenced in M08 worked example): no module entry, no owner, no schema, no test plan. Every dispatch channel depends on it.
- **X10 (Compliance test suite)**: described as nightly + on release; no mapping from compliance test to NFR; co-owned by Security + QA with no tie-breaker.
- **M09 (On-Call Scheduling)**: `Owns (tables)` column omits coverage-gap detection (FR-S5), the calendar-vs-status merge algorithm (FR-S3), and the materialised `OTASShift` table.

---

## 4. Acceptance-criteria traceability

PRD §12 has 14 numbered ACs. ARCH coverage:

| # | AC | Status | Notes |
|---|---|---|---|
| 1 | Tenant + account + contacts + form + scheme + DID | ✅ Y | M01, M03, M04, M05, M12, F04 |
| 2 | Screen-pop with account, greeting, Call Actions, history, VIP | ✅ Y | M16, M06, F03 |
| 3 | 5-channel dispatch within 10 s | ⚠ Partial | M21 push is "v1.x stub from day 1" |
| 4 | Recording encrypted + S3 + signed-URL playback | ✅ Y | M10, X02 |
| 5 | Pause recording → silenced WAV + redaction_intervals | ✅ Y *but* see C4 / R-T08 for correctness risk |
| 6 | CRM smoke tests 100 % against `/v1` | ✅ Y *but* see S10 for XML-ordering risk |
| 7 | Supervisor dashboard + ChanSpy | ✅ Y | M15, M16, F05 |
| 8 | Portal availability change → operator console within 5 s | ⚠ Partial | No WS path from M04 → F03 specified |
| 9 | Add Asterisk node, distribute, drain first | ✅ Y | §7.2.3 draining, M16 |
| 10 | HIPAA / GDPR / PCI checklist signed off | ⚠ Partial | GDPR Art. 20 portability unallocated; HIPAA × GDPR overlap unowned (C5) |
| 11 | Homer + Prom + Jaeger spans full chain | ⚠ Partial | OTel propagation through SIP header → channel var → ARI is unspecified |
| 12 | Audit log shows full chain for test call | ✅ Y | M14, X04 |
| 13 | Documentation: 4 runbooks | ❌ **N** | No deliverable allocated in ARCH |
| 14 | `make dev-up` end-to-end on laptop in 5 min | ✅ Y | §8 explicit and detailed |

**Score: 8 Y / 5 Partial / 1 N.**

---

## 5. Open questions, ordered by when they must be resolved

### 5a. Must be decided BEFORE any code lands (ADRs in Sprint 0)

1. **RLS enforcement model.** pgBouncer mode? `BEGIN … SET LOCAL` mandate? `FORCE ROW SECURITY` on every table? `BYPASSRLS` policy for the migrations role? CI test for cross-tenant WRITE (not only READ)? (C1)
2. **ARI leader election semantics.** Redis lock TTL? Fencing token? Reconciliation loop period for orphaned channels? WebSocket reconnect handler re-subscribes? (C2)
3. **TURN posture for MVP.** Ship coturn now, or ship a hard gate on failed-ICE rate with beta-tenant pause threshold? Either way: monitoring on day 1, not v1.1. (C3)
4. **PCI MVP scope.** SAQ-D with pause+redact, with QSA pre-confirmation? OR re-scope M18 to include delegated capture in MVP? (C4)
5. **Compliance orchestration module** for HIPAA × GDPR × PCI overlap. Who owns the multi-step erasure saga? `tenant.deleted` workflow? Right-to-portability export? Legal-hold override? (C5)
6. **Argon2id Basic-Auth at 100 RPS.** Redis-cached credential verification, TTL, invalidation? OR weaker params for the API path? (C9)
7. **PJSIP cache invalidation hook + object naming convention** before M17 ships. (C10)
8. **Mixed Model A + Model B Kamailio dispatcher groups** before first HIPAA tenant. (S2)
9. **NATS fsync policy + persistence guarantees** (C8). OR pick Redis Streams as the backbone.
10. **OTel trace propagation** through SIP custom header → Asterisk channel variable → ARI event → NestJS span. ADR + sample implementation. (gap)

### 5b. Must be decided before the relevant module starts

11. SIP.js vs JsSIP vs raw WebRTC for F03 — before multi-line state machine work begins. (S8)
12. Recording volume backing (node-local emptyDir vs RWX PVC vs Asterisk → S3 direct) — before M10. (S1)
13. NestJS JetStream transport — hand-roll or switch backbone — before X08 worker conventions are set. (S9)
14. fast-xml-parser fixture round-trip tests against a captured TAS response — before M25. (S10)
15. KEK multi-version decrypt path — before X02 hardening. (S6)
16. DEK in S3 metadata vs per-tenant IAM role + KMS grant model. (S4)
17. Audit-log `tenant_id` integrity (trigger or CHECK constraint) — before M14. (S5)
18. SMS template token allowlist for HIPAA tenants — before M07/M19 ship to medical pilots. (S7)
19. Operator-state machine boundary M15 vs F03 — before either ships.
20. Reports engine ownership — single owner, single module, single rendering surface — before M06/M12 read-side hardens.
21. `packages/templates` owner, schema, test plan — before any dispatch channel ships.
22. Custom domain + ACME flow OR explicit drop from MVP. (S11)

### 5c. Must be decided before MVP cut

23. Documentation deliverables (onboarding, operator, API, SRE runbooks) — AC §12 #13 has no owner today.
24. Portability export (GDPR Art. 20) — owner, format, recording-inclusion policy.
25. Toll-fraud monitor module + signal sources (per-tenant cost window in Redis).
26. Computed-field DSL design — JSON Schema extension or sandboxed expression language.
27. Hyperlink-token (`[Dial:…]` etc.) grammar and action-dispatch wiring.
28. CSV bulk import module (FR-X11) — owner and column-mapping wizard.
29. Coverage-gap detection consumer (FR-S5) — admin report + console warning.
30. Email open-tracking ingress endpoint (FR-D2).
31. Stripe self-serve onboarding flow and cancellation+export gate (PRD §9.4).
32. Push-notification PHI policy for HIPAA tenants (FCM has no BAA — C7).

### 5d. Should be decided before commercial pilot

33. NFR-A5 RPO/RTO claim: sync replication on, or soften the claim? (S13)
34. NFR-P1 100-call validation in Sprint 1–3 rather than Sprint 12–15 (S3).
35. Kamailio in-flight call survival on node failover — accept drop, or design state-rehydration. (C6)

---

## 6. Cross-cutting observations

- **The architecture is well-organised** — the module catalogue (§4), the contract-first principle (§6), the docker-compose dev story (§8), and the worked M08 example (§10) are well above industry baseline.
- **The §5 "decisions resolved up front" table is a strength**, but several entries (Prisma 5, NATS JetStream, fast-xml-parser, BullMQ on Redis) were made without ADRs documenting the alternatives considered. Each carries a non-trivial risk surfaced above.
- **The §11 "what is not locked down" list is honest** but understates the dependency chain: the Form Designer UX, the operator multi-line state machine, and the ARI leader fencing are all prerequisites for entire MVP modules to start. They cannot be left as "iterate later."
- **35 deliverables in 6–9 months across 12 parallel tracks** is aggressive even with contract-first discipline. The contract-first promise breaks down at workflow boundaries that OpenAPI cannot express (e.g. "when does dispatch state propagate to portal?"). Plan for an integration sprint at every milestone, not only at MVP cut.
- **The PRD risk table (§11)** already names several of the risks above (CRM breakage, undocumented TAS quirks, Kamailio config complexity, recording storage cost, WebRTC NAT failures). The architecture inherits but does not visibly close any of them. Re-stating PRD risks as ARCH-owned mitigations would be valuable.

---

## 7. Recommended next steps

1. **Sprint 0 ADR pack** — write the 10 ADRs in §5a above. Block all other Sprint 0 work behind them. ~2 weeks for a senior architect + telephony engineer + security engineer.
2. **Add module M26 Compliance Workflows** (or extend M14) to own the cross-framework orchestration sagas. (C5, S5, gaps for portability/deletion.)
3. **Add module M27 Reports** with a single owner and rendering surface. (gap.)
4. **Move NFR-P1 validation to Sprint 1–3.** The 100-concurrent claim is load-bearing for the architecture and must be measured early, not at the end.
5. **Rewrite NFR-A2 and NFR-A4** to honestly bound the in-flight-call survival claim for Kamailio + rtpengine node failure (or fund the design work to actually deliver it).
6. **Open a pilot-tenant compatibility track** that captures the running TAS instance's `/v1` responses as fixtures, and round-trip them through M25 byte-for-byte. Surface S10 and undocumented quirks before the CRM cutover, not after.
7. **Add documentation as an explicit deliverable** (AC §12 #13) with an owner and a sprint gate.

---

*End of risk assessment v0.1. Update this document as risks are accepted, mitigated, or escalated to ADRs.*
