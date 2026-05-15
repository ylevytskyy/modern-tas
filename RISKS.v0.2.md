# Risk Assessment — ARCHITECTURE.v0.2.md vs PRD.md

**Date:** 2026-05-12
**Author:** levytskyy@gmail.com, synthesised with Claude Code (2 parallel research agents: PRD baseline extraction, web research on 10 v0.2 tech choices) + sequential analysis + targeted web searches.
**Status:** Draft, supersedes [RISKS.md](./RISKS.md) (which was written against ARCHITECTURE.md v0.1).
**Scope:** Does [ARCHITECTURE.v0.2.md](./ARCHITECTURE.v0.2.md) actually close the v0.1 risks it claims to close? What new risks did v0.2 introduce? What PRD requirements still have no owner?

---

## 0. TL;DR

v0.2 is a real, large improvement over v0.1. The 12-ADR Sprint-0 pack closes most of the v0.1 critical risks at the design level. **But four classes of new problem appear, and several PRD gaps survive:**

1. **Two load-bearing legal/technical claims in v0.2 do not survive 2025–2026 research.** The "Temporal Cloud HIPAA since Feb 2026" date is **off by two years** (announcement is Feb 2024), and the "destroy `pseudonym_map` = irreversible anonymisation under GDPR Recital 26" claim **conflicts with CJEU C-413/23 P (Sept 4, 2025)** which rejected bright-line key-destruction-as-anonymisation. M26's default healthcare policy is built on a contested legal interpretation.

2. **The compliance saga's audio-bleeping primitive is not proven for telephony PII.** Forced-aligned PII bleeping (the M26 erasure default) has documented blind spots for **numbers, account IDs, MRNs, phone numbers** — exactly the PII shape that matters for HIPAA. No published WER on 8 kHz μ-law audio. Industry best practice requires a manual QA gate; v0.2's design has none.

3. **Three load-bearing third-party libraries are bus-factor-fragile.** `nestjs-temporal-core` (49 stars, 1 maintainer, 15 months old), `@horizon-republic/nestjs-jetstream` (14 stars, 6 months old), Caddy Redis storage plugin (community-maintained, open DDoS-on-storage-backend issue). The "stack adjustment" entries in §5 don't acknowledge maturity risk.

4. **Several PRD requirements with explicit numeric thresholds still have no owner in v0.2** — toll-fraud monitor (NFR-S13), keyboard shortcuts (FR-C13), vertical-template seed (FR-A6), pen-test cadence (NFR-S14), S3 cross-region replication (NFR-A6), DR drill (NFR-A8), Stripe self-serve flow (§9.4), migration assistance bundle (§9.3), hyperlink-token grammar (FR-F8), web-push VAPID key mgmt (FR-P8), and the 30+ seed report catalogue (M27).

The v0.1 critical-risk delta is otherwise good: C1 (RLS) → ADR-01 likely holds but Supavisor `SET LOCAL` behavior is undocumented by vendor; C2 (ARI) → ADR-02 sound, Asterisk's own reconnect re-subscription bug is already fixed upstream (the 5 s reconciliation loop is belt-and-suspenders but cheap); C3 (TURN) → ADR-04 closes cleanly; C7 (FCM) → AWS EUM is HIPAA-eligible (confirmed) but content-less requirement is self-imposed, not AWS-mandated; C9 (Argon2id cache) → ADR-07 is mathematically correct.

**Bottom line: v0.2 is shippable as a Sprint-0 starting point, but five things in §1 below need a follow-up ADR cycle before module work begins on M26 and M27.**

---

## 1. New critical risks introduced by v0.2

### N1. Forced-aligned PII bleeping is not provably HIPAA-compliant on phone audio
**Refs:** v0.2 ADR-06, §10 M26 worked example, default `pseudonymise_until_retention_expires` policy.

- **Claim:** "bleep PII spans in audio (forced-aligned transcript timestamps)" — implying deterministic erasure of PII inside recordings.
- **Why it fails:**
  - WhisperX (industry-leading forced aligner) explicitly cannot align "words not in alignment model's dictionary (such as `'2014.'` or `'£13.60'`)" — i.e. digits and numerics, which is exactly what HIPAA PHI looks like in TAS audio (account #, DOB, MRN, phone, address number).
  - No published WER on 8 kHz μ-law telephony for Wav2Vec2 / MFA pipelines; user-reported deviations up to 10–15 s in edge cases.
  - "Overlapping speech is not handled particularly well" — caller-and-operator cross-talk is normal in TAS.
  - Industry guidance (CaseGuard, Hamming.ai): manual review mandatory after automated PII redaction in regulated domains.
- **PRD at stake:** NFR-S10 (HIPAA — no PHI in non-secure surface; if pseudonymisation leaves residual PHI, recording is still PHI-bearing under GDPR while ALSO being claimed anonymised → simultaneous violation), §8.1, §8.2.
- **Severity:** **High × High.** A single PII miss in a "destroyed pseudonym_map" recording means PHI persists labeled as anonymous data — both frameworks violated.
- **Mitigation:**
  - Add **two-pass detection**: forced alignment + a second pass with regex/NER over the transcript that is not span-dependent (catches digits inside fluent speech).
  - **Manual QA gate** for any recording before `pseudonymise_until_retention_expires` finalises and destroys the `pseudonym_map` row — surface to a tenant compliance officer with sample auditing.
  - Conservative fallback: if alignment confidence < threshold, fall through to `gdpr_wins` (hard delete) rather than partial pseudonymisation.

### N2. "Destroy pseudonym_map = irreversible anonymisation" is contested EU law
**Refs:** v0.2 ADR-06, §10 line 444 ("destroy the `pseudonym_map` row (irreversible under GDPR Recital 26)"), `pseudonymise_until_retention_expires` as default for healthcare tenants.

- **Claim:** Crypto-shredding the pseudonym key makes pseudonymised PHI legitimately anonymous, allowing HIPAA's 7-year retention to coexist with GDPR Art. 17 erasure.
- **Why it fails:**
  - **CJEU C-413/23 P (EDPS v SRB), 4 September 2025**: court rejected bright-line tests. Pseudonymised data is personal data or not depending on whether **the recipient can reasonably re-identify**. Required: contextual multifactorial assessment of technical + organisational + legal measures.
  - EDPB is reconsidering its 2024 pseudonymisation guidance post-SRB.
  - The original controller (you) retains identifiability via residual fields (operator who handled call, account_id, DID, timestamp) even after pseudonym_map destruction — that is the definition of pseudonymisation per Art. 4(5). Audit log entries naming the same caller before pseudonymisation finalises also undermine "irreversibility".
- **PRD at stake:** NFR-S11 (GDPR), §8.2.
- **Severity:** **High × Medium** (legal-interpretation risk; not architectural-break risk).
- **Mitigation:**
  - Have an EU data-protection lawyer review the `pseudonymise_until_retention_expires` model against post-SRB jurisprudence before M26 ships. ADR-06 should cite the case.
  - Provide tenant compliance policies with a documented "GDPR conservative" option (`gdpr_wins`) as the recommended default for EU healthcare, and a documented "HIPAA conservative" option (`hipaa_wins`, refuse erasure with reasoning) for US-only.
  - Pseudonymisation must also redact identifiers in `audit_log` itself, or accept that `audit_log` is residual PHI and document the trade-off.

### N3. Temporal Cloud HIPAA-BAA scope has an unencrypted side-channel
**Refs:** v0.2 ADR-06 (Temporal Cloud), §10 M26 saga inputs, §13 changelog line "Temporal Cloud is now HIPAA compliant (since Feb 2026)".

- **Claim:** Temporal Cloud HIPAA BAA covers M26 sagas; encryption via Data Converter / Codec Server.
- **Why it fails (multiple):**
  - **Date is wrong**: the Temporal HIPAA announcement is **Feb 5, 2024**, not Feb 2026. Architecture doc has a factual error; not material to the design but signals the rest of the BAA reasoning was not closely verified.
  - **Search Attributes are NEVER passed through the Data Converter** per Temporal's own docs: *"Search Attribute values are stored unencrypted in the Visibility store… putting sensitive data in Search Attributes may violate GDPR, HIPAA, or SOC 2."* If any erasure-workflow code does `searchAttributes: { subjectId: '...' }`, that ID lives unencrypted in Temporal Cloud's database.
  - BAA tier scope: not stated which Temporal Cloud tier carries the BAA (Essentials / Business / Enterprise / Mission Critical) — needs sales confirmation.
  - Workflow history retention may outlive the workflow; encrypted payloads stay under the BAA but search attributes persist in the clear.
  - EU data-residency for GDPR-strict tenants: no Temporal Cloud statement that EU region is HIPAA-covered or GDPR-residency-compliant; arch doc implicitly assumes both.
- **PRD at stake:** NFR-S10, NFR-S11, P10 principle.
- **Severity:** **High × High** (architectural; affects every workflow input pattern).
- **Mitigation:**
  - ADR-06 must add: "no PHI/PII in Temporal search attributes; only opaque request IDs and tenant_id." Lint or codec-server-side validation.
  - Confirm BAA tier in the Temporal Cloud contract; pin the SKU.
  - For EU healthcare: confirm region + BAA jointly, or use a self-hosted Temporal cluster (loses Temporal Cloud BAA but gives data residency).
  - Correct the Feb-2026 → Feb-2024 date in the doc.

### N4. ARI fencing token only protects database state, not Asterisk state
**Refs:** v0.2 ADR-02, M16 description.

- **Claim:** "Monotonic fencing token (Redis `INCR`) validated on every ARI write — rejects writes if token < current."
- **Why it fails:** Fencing tokens are a property of a *resource that checks them*. Asterisk ARI does not check fencing tokens — it accepts whatever HTTP/WS commands come in. So:
  - A zombie leader (lock expired but it doesn't know yet) **still has its outbound WS open and still receives events**. It can issue `POST /channels/.../answer` etc. Asterisk has no way to reject these.
  - Where the token *does* prevent damage: if both leaders try to write to Postgres "channel state" rows, the lower-token write loses (Postgres-side check). So billing rows are safe.
  - But: zombie leader can still answer a call, transfer to wrong agent, hang up while live, mute recording. Asterisk-side actions are unprotected.
- **PRD at stake:** FR-C5, FR-C6, FR-R4, NFR-A1.
- **Severity:** **High × Low** (rare scenario, but consequences are user-visible call mishandling).
- **Mitigation:**
  - On heartbeat-loss → leader **stops issuing ARI commands** immediately (don't wait for fencing-token rejection). Close ARI websocket explicitly.
  - Set Redis lock TTL conservatively (15 s as the doc says is fine if heartbeat is 3–5 s and the leader hard-stops on missed heartbeats).
  - The 5 s reconciliation handles state drift after the fact, but only state drift — not in-the-moment misbehaviour.
  - ADR-02 should clarify what fencing tokens actually buy you and what the leader must do on missed heartbeat.

### N5. Three load-bearing libraries are single-maintainer / low-trust
**Refs:** v0.2 §5a stack adjustments.

| Library | Stars | Age | Maintainers | Used for |
|---|---|---|---|---|
| `nestjs-temporal-core` | 49 | 15 mo | 1 (`harsh-simform`) | All M26 sagas |
| `@horizon-republic/nestjs-jetstream` | 14 | 6 mo | 1 org | Compliance event stream (NFR-S10 audit) |
| Caddy Redis storage plugin (pberkel / gamalan) | community | — | community | Cert cache for tenant custom domains |

- **Severity:** **Medium × Medium** (won't fail tomorrow; will become a maintenance burden in 1–2 years).
- **Mitigation:**
  - Plan to vendor each into the monorepo (fork + freeze + maintain).
  - For Temporal: official `@temporalio/client` + a thin in-house NestJS module is a safer base than `nestjs-temporal-core`.
  - For JetStream: keep the option to switch to Redis Streams as v0.1 alluded to (BullMQ already wires Redis).
  - For Caddy Redis: validate against the open `ask`-endpoint DDoS issue (caddyserver/certmagic #174) and ensure `ask` is hit before storage lookup.

### N6. Supavisor `SET LOCAL` semantics are undocumented by vendor
**Refs:** v0.2 ADR-01.

- **Claim:** Supavisor transaction-mode preserves `SET LOCAL` per-transaction (analogue of PgBouncer transaction-mode).
- **Why it fails (potentially):** Supavisor docs do not state this behaviour explicitly. PgBouncer transaction-mode is the documented baseline; Supavisor is a clean-room Elixir/Postgrex reimplementation. Behavioural parity with PgBouncer for `SET LOCAL` is community-assumed, not vendor-asserted. No open issues either way.
- **PRD at stake:** P3, FR-T1, NFR-S8, NFR-S11 — same as v0.1 C1.
- **Severity:** **High × Low** (almost certainly works; just unverified by vendor).
- **Mitigation:**
  - Add a CI test in X10 that opens a Supavisor connection, runs `BEGIN; SET LOCAL app.tenant_id = 'A'; SELECT current_setting('app.tenant_id'); COMMIT; BEGIN; SELECT current_setting('app.tenant_id'); COMMIT;` and asserts the second `SELECT` does not see Tenant A's value.
  - Don't ship M01 until this passes.

### N7. Caddy on-demand TLS has an open `ask`-endpoint DDoS class
**Refs:** v0.2 ADR-12.

- **Claim:** Caddy + Redis storage + `ask` endpoint scales to thousands of tenant custom domains.
- **Why it fails (potentially):** Open caddyserver/certmagic #174 describes Caddy hitting the storage backend on every request for declined domains, effectively DDoS-ing storage. Workaround: `ask` endpoint must be checked **before** storage lookup; not guaranteed in all Caddy versions / configurations.
- **PRD at stake:** §5.8 white-label custom domains.
- **Severity:** **Medium × Medium.**
- **Mitigation:**
  - Confirm Caddy version (≥ 2.10.0-beta.2 enforces the permission module).
  - Set `max_certificates` cap.
  - Apply for Let's Encrypt rate-limit exemption proactively if expecting > 300 new certs / 3 h.
  - Add monitoring for ACME-challenge rate and storage-backend RPS.

---

## 2. v0.1 critical risks — did v0.2 actually close them?

| v0.1 Risk | v0.2 fix | Audit verdict |
|---|---|---|
| **C1 RLS** (R-C01/02, R-W04) | ADR-01: Supavisor + `SET LOCAL` + `FORCE RLS` + non-owner runtime + scoped `BYPASSRLS` + CI cross-tenant WRITE test | **Closed at design** (modulo N6 — Supavisor verification gap) |
| **C2 ARI leader** (R-T04, R-W09) | ADR-02: Outbound WS + fencing token + 5 s reconciliation | **Mostly closed.** Outbound-WS reconnect bug **already fixed upstream** (Asterisk patch #2678 — lazy app cleanup, channels re-subscribe automatically); 5 s reconciliation is belt-and-suspenders. **But see N4** — fencing token has limited blast radius |
| **C3 TURN** (R-T05/06, R-W02) | ADR-04: coturn pair / region in MVP + failed-ICE dashboard | **Closed.** Only operational risk left: bandwidth-egress cost was understated (the "$200/mo" claim ignores egress) |
| **C4 PCI** (R-C04, R-T08) | ADR-05: pause+redact AND delegated-capture flag + QSA gate + CEL sample-counts | **Closed at design.** Business risk: QSA pre-confirmation can be a delivery bottleneck for HIPAA-PCI tenant onboarding |
| **C5 Compliance orchestration** (R-C03, R-C08) | M26 + Temporal Cloud | **Closed at design** but **see N1, N2, N3** — the cross-framework primitive (forced-aligned bleeping) and legal interpretation (Recital 26 + key destruction) are both contested |
| **C6 Kamailio in-flight** (R-T03, R-W01) | P9 principle + §5c PRD softening flagged | **Acknowledged not fixed.** Architecture is honest about it; PRD NFR-A2 still needs to be rewritten |
| **C7 FCM** (R-W06) | AWS End User Messaging Push (HIPAA-eligible) + content-less | **Closed.** Caveat: Voice Message and WhatsApp explicitly excluded from BAA; Pinpoint console retires Oct 30, 2026 (API migrates) |
| **C8 NATS** (R-W05) | `sync_interval=always` for compliance streams + `@horizon-republic/nestjs-jetstream` | **Closed.** But see N5 — library is 6 months old, 14 stars |
| **C9 Argon2id** (R-C05) | ADR-07: LRU + Redis 60 s TTL HMAC-keyed, pub/sub invalidation | **Closed.** Math works. |
| **C10 PJSIP** (R-T01/02, R-W03) | ADR-08: stale-cache + AMI invalidation + naming `t{uuid8}_{local_id}` + per-tenant macros | **Closed at design.** Outstanding: who retries AMI invalidation if Asterisk doesn't ack? Not specified |

**Score: 10 / 10 v0.1 critical risks addressed at design level**, but 4 of them (C1, C2, C5, C7) carry residual sub-risks that need follow-up before the relevant module ships.

---

## 3. PRD coverage gaps still open in v0.2

| PRD ref | Requirement | v0.2 state | Severity |
|---|---|---|---|
| **NFR-S13** | Per-tenant toll-fraud monitor (Redis sliding cost window) | §5b: "owner = X10 + small worker in M16" — informal, no module box | **H** |
| **FR-A6** | Vertical templates (medical, legal, trades, property, IT MSP, funeral, general) | Not mentioned anywhere in v0.2 | **H** |
| **NFR-S14** | Annual pen-test cadence | Not allocated as deliverable | **H** |
| **NFR-A6** | S3 cross-region replication for HIPAA tenants | Not in M10 / X02; ADR-09 mentions SSE-KMS Bucket Keys but not CRR | **H** |
| **NFR-A8** | Quarterly DR drill | Not allocated; chaos drills listed in Sprint 12-15 are different scope | **H** |
| **§9.3** | Migration assistance bundle ($2-5K) — nCall data import + CRM endpoint swap | Not allocated; M28 BulkImport is generic, not migration-specific | **M** |
| **§9.4 / §10.2** | Stripe self-serve sign-up + cancellation+export gate | M13 owns Stripe tables; self-serve flow has no UI owner | **M** |
| **FR-C13** | Per-tenant + per-user keyboard shortcut overrides | Not in any v0.2 module | **M** |
| **FR-F8** | Hyperlink-token grammar `[Dial:…]` etc. | §5b open question; F03 needs spec before multi-line state machine completes | **M** |
| **FR-P8** | Web push (VAPID) for portal users | M21 mentions VAPID in MVP but no key-mgmt schema or rotation strategy | **M** |
| **FR-T6** | User multi-tenant invite + re-auth challenge on tenant switch | M02 doesn't describe the multi-tenant identity flow | **M** |
| **FR-AU5** | Every CRM `/v1` API call emits audit-log entry | X04 decorator covers application services; gateway-level audit for /v1 unspecified | **M** |
| **NFR-O1** | SIP HEPv3 mirror with **90-day** retention | X09 says "30-day retention for EU tenants" — short of PRD | **M** (mismatch) |
| **NFR-P3** | Screen-pop ≤ 300 ms p50, ≤ 800 ms p95 | No validation plan; M16 latency hasn't been profiled | **M** |
| **NFR-S2** | Kamailio rejects non-SRTP INVITEs for HIPAA tenants | Implied but not explicit in ARCH | **M** |
| **30+ seed report_definitions** | M27 ships with 30+ seed catalogue | §5b open — only 5 ship in Sprint 8-11 per §9 | **M** |
| **FR-D6** | Mobile push (FCM Android + APNS iOS) for v1.x mobile recipient app | v0.2 replaced FCM/APNS with AWS EUM at the architecture level — but mobile-app surface (CallKit / firebase-messaging integration) hasn't been re-described | **L** |
| **FR-V5** | QA-tagging for v1.x scorecard | F05 lists it, no schema | **L** |
| **FR-C4** | Calls dropdown locked 3 s then unlock indicator (anti-mis-assignment) | F03 description doesn't specify this UX detail | **L** |
| **§7.2.4 hooks** | iceServers config endpoint for SIP.js | Once coturn is in MVP per ADR-04, this hook needs to be wired — not described | **L** |

---

## 4. Other surface concerns / inconsistencies

- **`tenant_uuid_short8` slicing rule** (ADR-08, M17): no documented derivation (first 8 hex of UUID v4? base32? deterministic hash?). Specify before M17 provisioning code is written.
- **AMI invalidation retry** (ADR-08): what happens when NestJS sends `SorceryMemoryCacheExpireObject` and Asterisk doesn't ack? Not specified.
- **KEK rotation under load** (ADR-09): at 7-year HIPAA retention × 1 M recordings/year × 1 k tenants, atomic row-by-row re-wrap hits KMS rate limits. Has anyone modeled it?
- **ABAC IAM** (ADR-09): `aws:PrincipalTag/tenant_id` requires dynamic per-call STS `AssumeRole`. NestJS doesn't natively do per-call IAM assumption. Implementation pattern undocumented; STS rate limits possible at scale.
- **Two-version KEK read window** (ADR-09): not bounded. If rotation takes 48 h, both versions live for 48 h. `tenant_kek_ref` needs explicit version-tracking, which isn't in the schema bullet.
- **Operator state machine handshake** (F03 vs M15): v0.2 resolves source-of-truth (M15 wins) but doesn't specify the protocol — what if F03 disconnects mid-`Wrap`? Heartbeat? Re-sync on reconnect?
- **Compliance audit_log itself contains PHI** (M26 / ADR-03): `pseudonymise_until_retention_expires` doesn't pseudonymise audit_log entries. Either accept that audit_log is residual PHI (and document) or extend M26 to pseudonymise audit rows older than retention.
- **JSONLogic determinism across JS/plv8** (ADR-11): timezone / locale / float-precision differences between V8 and plv8 are not addressed; "reject mismatches" needs canonicalisation rules.
- **Outbound INVITE traceparent propagation** (ADR-10): inbound is described; outbound legs (M19 outbound-phone dispatch, transfer-supervised) also need the header.
- **§4.4 coverage-gap consumer**: text says M15 + M27, but M15's row in §4.1 doesn't list it. Doc inconsistency.
- **Cube.dev license** (M27): production-grade `securityContext` requires Cube Cloud Enterprise. Cost not in the architecture. CVE-2022-23510 (RLS bypass) is a documented attack class; SQL API enforcement parity with REST/GraphQL not publicly documented.
- **PDF rendering on capped BullMQ queue** (M27): Chromium ~150 MB/instance; concurrency cap not sized against report volume.
- **30+ seed report_definitions** (M27, §5b): still product gap; affects MVP claim.
- **Asterisk 22 chan_websocket open bugs** (independent of arch): issue #1645 (stuck channels), open as of May 2026. Architecture pins to 22.9.x LTS which is the right call; revalidate on each patch release.
- **Compliance pillar staffing** (§3): two new pillars (Compliance & Security, Analytics) in v0.2 — same headcount? Not stated. Hiring implication.

---

## 5. Open questions, ordered by when they must be resolved

### 5a. Must be resolved before M26 / M27 ship code

1. **Forced-alignment + manual QA gate for PII bleeping (N1).** Either commit to a two-pass detector + sample audit, or fall back to hard-delete for healthcare under GDPR.
2. **Legal review of `pseudonymise_until_retention_expires` post-CJEU C-413/23 P (N2).** Update ADR-06 with case citation and rationale.
3. **Temporal Cloud BAA scope (N3).** Pin SKU/tier. Add a "no PHI in search attributes" lint. Correct the Feb-2026 → Feb-2024 date.
4. **Cube.dev SQL API security parity + license tier (M27).** Confirm `securityContext` enforced identically on SQL API and REST/GraphQL. Pin Cube Cloud Enterprise contract or self-host.
5. **30+ seed report_definitions catalogue (M27).** Product-owned. Without these the AC §12 #3 dispatch dashboard story partially works but the §5.13 reports story is empty.

### 5b. Must be resolved during Sprint 0 (before any module code)

6. **Supavisor `SET LOCAL` parity test (N6).** Belongs in X10 day 1.
7. **Caddy version + LE rate-limit exemption + storage-DDoS workaround (N7, ADR-12).**
8. **AMI invalidation retry semantics (ADR-08).**
9. **ARI fencing-token semantics — leader hard-stop on missed heartbeat (N4, ADR-02).**
10. **Outbound INVITE traceparent propagation (ADR-10 follow-up).**
11. **AWS EUM Push: confirm not using Voice Message / WhatsApp paths (out-of-BAA); plan for Pinpoint console retirement Oct 30, 2026.**

### 5c. Must be resolved before MVP cut

12. **NFR-S13 toll-fraud monitor — assign to a module box** (currently informal).
13. **NFR-A6 S3 cross-region replication for HIPAA tenants** — add to M10 + ADR-09.
14. **NFR-A8 quarterly DR drill** — Platform/SRE owner + cadence.
15. **NFR-S14 annual pen-test cadence** — assign + budget.
16. **NFR-O1 SIP HEPv3 90-day retention** — X09 says 30 day; reconcile with PRD or update PRD.
17. **NFR-P3 screen-pop latency profiling** — add to Sprint 1-3 baseline (alongside NFR-P1).
18. **NFR-S2 SRTP enforcement for HIPAA tenants** — explicit Kamailio rule.
19. **FR-A6 vertical templates** — assign module (M03 or new), seed list, owner.
20. **FR-C13 keyboard shortcuts (per-tenant + per-user)** — schema + runtime resolution.
21. **FR-F8 hyperlink-token grammar + dispatch wiring** — F03 dependency.
22. **FR-T6 multi-tenant identity + re-auth challenge** — M02 follow-up.
23. **FR-AU5 gateway-level audit for /v1 API** — M25 follow-up.
24. **FR-P8 VAPID key mgmt** — M21 schema + rotation.
25. **§9.4 / §10.2 Stripe self-serve signup + cancellation+export gate** — UI module + saga.
26. **§9.3 migration assistance bundle** — M28-adjacent or new module.
27. **Operator state machine protocol (M15 ↔ F03)** — heartbeat, disconnect, reconciliation.
28. **JSONLogic numeric canonicalisation rules (ADR-11).**
29. **KEK rotation: KMS rate-limit modelling + two-version window bound (ADR-09).**
30. **ABAC IAM `AssumeRole` pattern (ADR-09).**

### 5d. Must be resolved before commercial pilot

31. **PRD NFR-A2 / NFR-A5 wording softening (§5c).**
32. **Push-content-less HIPAA policy + tenant disclosure (M21).**
33. **Compliance pillar staffing** — confirm headcount supports M26 + X10 + KMS rotation.
34. **Library bus-factor plan for `nestjs-temporal-core` + `nestjs-jetstream` + Caddy Redis (N5)** — vendor-in / fork / replace strategy.
35. **`audit_log` pseudonymisation policy** — accept residual PHI in audit_log or extend M26.

---

## 6. What v0.2 got right (so it's not all teeth)

- **Sprint 0 ADR gate** is the single most useful change vs v0.1; it forces decisions ahead of code.
- **P9 (stateless edge + reconciliation)** is honest doctrine and matches industry reality.
- **P10 (compliance as workflow)** correctly elevates HIPAA × GDPR × PCI conflict resolution to a first-class problem.
- **Adding M26, M27, M28 as named modules with explicit Owns/Inbound/Outbound** closes most of the v0.1 ownership ambiguity.
- **Moving NFR-P1 validation to Sprint 1-3** is the right call; v0.1 had it at sprint 12-15 which was untenable.
- **`xmlbuilder2` + byte-for-byte golden fixtures for `/v1`** is a meaningful tightening vs `fast-xml-parser` for output.
- **TURN in MVP via coturn (ADR-04)** is the right reversal vs v0.1.
- **ARI Outbound WebSockets + 5 s reconciliation** is the modern Asterisk pattern; reconnect subscription bug is already fixed upstream as bonus.
- **The §13 changelog itself** — explicit v0.1 → v0.2 deltas with risk-closure mapping — is unusually disciplined for an architecture document.

---

## 7. Recommended next steps

1. **Sprint 0 ADR-pack addendum** — five short ADRs covering N1 (forced-alignment QA gate), N2 (post-SRB legal review), N3 (Temporal search-attribute lint + BAA tier), N4 (ARI heartbeat hard-stop), N6 (Supavisor `SET LOCAL` parity test). ~1 week if interleaved with the existing 12-ADR pack.
2. **Correct factual errors in ARCHITECTURE.v0.2.md** — Temporal HIPAA date is Feb 2024 not Feb 2026.
3. **Engage EU data-protection counsel** on `pseudonymise_until_retention_expires` against post-SRB jurisprudence before M26 begins.
4. **Two-pass PII detector POC** on representative TAS audio before committing M26 to forced-alignment-only bleeping.
5. **Vendor-in plan** for the three single-maintainer libraries (`nestjs-temporal-core`, `@horizon-republic/nestjs-jetstream`, Caddy Redis storage) — fork into monorepo with semver-pinned baseline.
6. **PRD-side: close 12+ open module-allocation gaps** in §3 by either (a) assigning to existing modules, (b) creating M29+ for orphans, or (c) explicitly deferring to v1.x.

---

## 8. MVP edge-topology risk (2026-05-15 amendment)

**Context:** ADR-0025 (2026-05-15) adopts Asterisk-direct as MVP telephony topology, deferring the Kamailio-fronted SBC topology. This introduces a new risk class not present in the original S1 spike hypothesis (which assumed Kamailio in the path).

### N8. Single-Asterisk crash = call drops during restart window

- **Topology:** Asterisk-direct (no Kamailio dispatcher to drain calls before restart).
- **Impact:** Single-Asterisk crash drops all in-flight calls on that node during the 5–20 s process restart window. With Kamailio-fronted SBC topology, failing calls would have been drained to a warm standby by the Kamailio dispatcher (~573 ms TTFOK per S1 PoT).
- **MVP mitigation:** Carrier-side DNS SRV pointing at a **warm standby** Asterisk instance (~30 s failover). Scheduled maintenance via planned drain (announce ahead, operator console shows pending-maintenance banner). Kubernetes / systemd auto-restart ensures 5–20 s MTTR.
- **Re-introduction trigger:** If failover SLA requirement drops below 30 s (e.g. HIPAA-tier BAA requirement for sub-second failover, or volume >300 concurrent), upgrade to Kamailio-fronted SBC topology per ADR-0025 re-introduction trigger.
- **Severity:** **Medium × Medium** (rare for a well-operated single node; acceptable at pre-revenue MVP scale with stated MTTR).
- **ADR:** ADR-0025. See also `pot/g0-closed.md` §S1 edge-topology amendment.

---

## Sources

- [Temporal Cloud HIPAA announcement (Feb 5, 2024)](https://temporal.io/blog/temporal-cloud-is-now-hipaa-compliant)
- [Temporal Search Attribute encryption warning](https://docs.temporal.io/search-attribute)
- [CJEU C-413/23 P (EDPS v SRB) — Skadden analysis](https://www.skadden.com/insights/publications/2025/11/in-a-landmark-decision-eu-court-clarifies)
- [CJEU C-413/23 P — Taylor Wessing analysis](https://www.taylorwessing.com/en/insights-and-events/insights/2025/09/analysis-of-the-new-cjeu-judgment)
- [EDPB reconsiders pseudonymisation post-SRB (Bird & Bird)](https://biotalk.twobirds.com/post/102mfa8/edpb-reconsiders-anonymisation-and-pseudonymisation-after-srb-what-life-sciences)
- [WhisperX limitations (numerics not aligned)](https://github.com/m-bain/whisperX)
- [Asterisk ARI Outbound WebSockets docs](https://docs.asterisk.org/Configuration/Interfaces/Asterisk-REST-Interface-ARI/ARI-Outbound-Websockets/)
- [Asterisk reconnect re-subscription fix (Code Review 2678)](https://asterisk-dev.digium.narkive.com/OnSCe7ll/code-review-2678-continue-events-when-ari-websocket-reconnects)
- [Asterisk 22 chan_websocket stuck channels (Issue #1645)](https://github.com/asterisk/asterisk/issues/1645)
- [chan_websocket audio distortion > 90 calls (Community)](https://community.asterisk.org/t/audio-distortion-lag-with-chan-websocket-externalmedia-at-90-concurrent-calls-asterisk-22-8-2/112483)
- [AWS HIPAA-eligible services reference](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/)
- [Cube CVE-2022-23510 (RLS bypass)](https://github.com/advisories/GHSA-6jqm-3c9g-pch7)
- [Caddy on-demand TLS storage DDoS (certmagic #174)](https://github.com/caddyserver/certmagic/issues/174)
- [Let's Encrypt rate-limit exemption thread](https://community.letsencrypt.org/t/rate-limit-and-accounts-creation-for-100k-domains-on-caddy/215146)
- [Supavisor pool modes](https://supabase.github.io/supavisor/configuration/pool_modes/)
- [nestjs-temporal-core](https://github.com/harsh-simform/nestjs-temporal-core)
- [@horizon-republic/nestjs-jetstream](https://github.com/HorizonRepublic/nestjs-jetstream)
- [Cloudflare HIPAA Trust Hub (no Realtime SFU/TURN)](https://www.cloudflare.com/trust-hub/us-privacy-compliance/)

---

*End of risk assessment v0.2. Update this document as risks are accepted, mitigated, or escalated to ADRs.*
