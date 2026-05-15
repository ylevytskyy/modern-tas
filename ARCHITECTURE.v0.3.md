# Telephone Answering Service (TAS) — High-Level Architecture (v0.3)

**Status:** Draft, supersedes [v0.2](./ARCHITECTURE.v0.2.md). Resolves the seven new risks (N1–N7) and twenty-five PRD coverage gaps raised in [RISKS.v0.2.md](./RISKS.v0.2.md). Research current as of May 2026.

**Author:** levytskyy@gmail.com, synthesised with Claude Code (6 parallel research agents covering post-SRB pseudonymisation jurisprudence, Temporal Cloud HIPAA posture, two-pass telephony PII redaction, AWS End User Messaging Push + Pinpoint migration, Caddy 2.10+ on-demand TLS hardening, NestJS Temporal/JetStream library landscape).

**Change summary** (full audit in §14):

1. **The default compliance policy for healthcare tenants is `gdpr_strict`, not `pseudonymise_until_retention_expires`** — CJEU C-413/23 P (4 Sept 2025, *EDPS v SRB*) and the EDPB CEF 2025 Right-to-Erasure report (Feb 2026, 32 DPAs, 764 controllers) jointly make key-destruction-as-anonymisation indefensible for an operator that retains correlated metadata. M26 now hard-deletes non-HIPAA-mandated data and invokes GDPR Art. 17(3)(b) for the minimum residual.
2. **Audio PII redaction is a two-pass pipeline with a manual QA gate**, not forced-alignment-only. Whisper word-timestamps + Presidio NER + domain regex (MRN/DOB/account); low-confidence numeric spans fall through to segment-boundary bleep (over-bleeps by 0.5–2 s); 2 % stratified sample audit before any policy that destroys re-identification material.
3. **Temporal Cloud BAA hygiene is now mandatory and lint-enforced** — Search Attributes cannot be encrypted by any codec server (architectural constraint, not bug); opaque UUIDs only in SAs, codec-server-side AES-256-GCM for payloads, EU namespace pinning for GDPR-scoped PHI, Helm chart v1.0.0 (Apr 2026) self-host documented as fallback.
4. **ARI leader hard-stops on missed heartbeat** — fencing token only protects database writes, not Asterisk-side actions. Leader closes ARI WebSocket and halts command dispatch within 100 ms of heartbeat miss; fencing token belt-and-braces for DB writes.
5. **Three bus-factor-fragile community libraries are vendored or replaced**: thin in-house NestJS-Temporal wrapper around official `@temporalio/*` v1.16; thin in-house NestJS-JetStream wrapper around `@nats-io/jetstream`; Caddy storage on `pberkel/caddy-storage-redis` v1.8 (community-maintained, but actively shipping and 10× more mature than the v0.2 candidate).
6. **Caddy 2.10+ on-demand TLS is hardened**: `permission http` replaces deprecated `ask`; in-process 60 s LRU negative-cache absorbs certmagic #174 storage flood; L4 rate-limit at edge; LE rate-limit-exemption applied Sprint 0; ZeroSSL fallback issuer; `max_certs` removed.
7. **NATS JetStream `sync_interval: always` runs on a dedicated compliance cluster** — it is a *server-wide* setting (NATS 2.10+), not per-stream. The main cluster keeps the default 2 min interval; a smaller compliance cluster carries audit, dispatch-decision, and recording-upload streams.
8. **Push provider strategy clarified** — AWS End User Messaging Push HIPAA-eligible (push surface only; Voice Message and WhatsApp excluded under the same umbrella). One EUM Application per tenant for credential and audit isolation. Pinpoint console retires 30 Oct 2026, but the push API surface is unchanged — no migration required. SNS push explicitly **out of HIPAA** and ~500× more expensive — banned for push.
9. **Eleven new ADRs join the Sprint-0 pack** (ADR-13 through ADR-23). The gate is now 23 ADRs, with a hard prerequisite that ADRs 13–15 require external sign-off (EU counsel for ADR-14; Temporal Cloud sales for ADR-15 BAA tier).
10. **Two new principles, one new module**: P11 (legal defensibility over technical elegance), P12 (vendor-in over single-maintainer); M29 (Toll-Fraud Monitor) splits out of M16 as a named module.

---

## 1. Architecture principles

| # | Principle | Implication |
|---|-----------|-------------|
| P1 | **Contracts first** | OpenAPI 3.1 + AsyncAPI 3.0 + JSON Schema files live in `/contracts/` and are PR-reviewed before module work starts. Mock servers (Prism/MSW) come from these specs. |
| P2 | **Bounded contexts = modules** | A module owns its DB tables (no cross-module SQL joins), publishes events on NATS, exposes HTTP/RPC via its OpenAPI block. Cross-module access is *only* via published contracts. |
| P3 | **Tenant ID is sacred — defense in depth** | Every table has `tenant_id` enforced by Postgres RLS *and* (for sensitive tables) a `BEFORE INSERT` trigger that asserts `NEW.tenant_id = current_setting('app.tenant_id')::uuid`. Every connection runs `SET LOCAL` in a transaction. Runtime role is non-owner and not `BYPASSRLS`. Supavisor `SET LOCAL` parity is CI-asserted on Day 1 (ADR-18). |
| P4 | **Two API surfaces, one domain** | `/v1` (TAS-compat XML/JSON) and `/api/v2` (modern JSON) are both first-class facades over the *same* domain services. |
| P5 | **Side effects through workers with durability tiers** | HTTP requests do not send SMS/email/recordings inline; they enqueue work. **Tier 1** (≤ 1 h, cancel-able, single-step): BullMQ. **Tier 2** (hours-to-days, compensable, multi-step, signal-driven): Temporal. **Tier 3** (compliance-bearing event fanout): NATS JetStream on a dedicated compliance cluster with `sync_interval=always`. |
| P6 | **Stub all external deps in dev** | KMS, SIP trunk, SMS, email, push, calendar, CRM, Temporal — every external dependency has a local stub. `docker compose up` boots the whole product. |
| P7 | **Compliance is a build-time check + a runtime owner** | RLS policies, audit triggers, encryption-at-rest, no-PHI-in-SMS, no-PHI-in-Temporal-SA — enforced by lints, schema constraints, and integration tests. Cross-framework workflows (erasure, deletion, portability) are owned by M26. |
| P8 | **TDD per module** | Red → green → refactor at the slice level. Each module ships with unit + contract + integration tests gated in CI. No module merges without its test pyramid. |
| P9 | **Stateless edge + reconciliation over heroic state replication** | Kamailio, rtpengine, and ARI consumers do not attempt to replicate per-call state. Failover routes *new* traffic; in-flight legs may drop. Reconciliation loops (every 5–30 s) repair drift between sources of truth (Asterisk channels vs Postgres Call rows). ARI leader hard-stops on missed heartbeat (ADR-16). |
| P10 | **Cross-framework compliance is a workflow, not a transaction** | HIPAA × GDPR × PCI conflicts are durable workflows with explicit conflict policy, legal-hold checkpoints, and human-or-automatic compensations. They live in M26, run on Temporal, and write to the audit log at every step. |
| **P11** | **Legal defensibility over technical elegance** *(new)* | No load-bearing architectural pattern may depend on a contested legal interpretation. When jurisprudence (e.g. CJEU C-413/23 P) makes a clever crypto-shred-equals-anonymisation play indefensible, the architecture flips to the boring-but-safe option (hard-delete + statutory carve-out for the residual). Documented in ADR-14. |
| **P12** | **Vendor-in over single-maintainer dependencies** *(new)* | A community NestJS package with one maintainer and < 100 stars is not a production foundation. For each load-bearing infrastructure surface (Temporal, JetStream, Caddy storage), the architecture either uses an actively-maintained package with a documented vendor-in fork plan **or** writes a thin in-house wrapper around the official SDK. ADR-17 names which strategy applies to which surface. |

---

## 2. Macro topology

Changes from v0.2: **dedicated NATS compliance cluster** (sync_interval=always is server-wide, not per-stream); **codec server** in the data plane for Temporal payload encryption; **Caddy 2.10+ with permission module** at the edge; **two-pass redaction worker pool** (Whisper + Presidio + ffmpeg bleeping) in the app plane.

```
            ┌──────────────────────────────────────────────────────────┐
EDGE PLANE  │   Kamailio SBC (active-active, stateless, hash on        │
(SRE-owned) │     Call-ID for dispatcher stickiness)                   │
            │   rtpengine (kernel forward, DTLS-SRTP/ICE)              │
            │   coturn pair / region (UDP-friendly VMs, NOT k8s)       │
            │   Caddy 2.10+ (on-demand TLS via permission http;        │
            │     pberkel/caddy-storage-redis v1.8+ cluster store)     │
            │   L4 rate limiter (HAProxy) in front of :443             │
            │   Public ingress: HTTPS + WSS + SIP/TLS + TURN/TURNS     │
            └──────────────────────────────────────────────────────────┘
                                  │                  │
                                  ▼ SIP             ▼ HTTPS/WSS
            ┌──────────────────────────┐    ┌──────────────────────────┐
TELEPHONY   │  Asterisk 22.9.x LTS pool│    │  NestJS modular monolith │  APP PLANE
PLANE       │  (Model B & Model A;     │◄──►│  N replicas, stateless   │  (Backend)
            │   PJSIP realtime,        │ARI │  - REST (/v1 + /api/v2)  │
            │   stale-cache, AMI-      │AMI │  - WebSocket gateway     │
            │   driven cache expiry)   │    │  - ARI Outbound WS       │
            │  MixMonitor → emptyDir   │    │    leader (Redis lock +  │
            │  → uploader sidecar      │    │    fencing token +       │
            │                          │    │    100 ms hard-stop)     │
            │                          │    │  - BullMQ workers        │
            │                          │    │  - Temporal workers      │
            │                          │    │  - Redaction workers     │
            │                          │    │    (Whisper + Presidio   │
            │                          │    │    + ffmpeg bleep)       │
            └──────────────────────────┘    └──────────────────────────┘
                          │                 │
                          ▼ NATS JetStream  │
                  ┌─────────────────────────┴─────────────────────┐
DATA PLANE        │  Supavisor → Postgres (Patroni)               │
                  │  Redis  NATS main cluster (default sync)      │
                  │  NATS compliance cluster (sync_interval=      │
                  │    always; R=3 default, R=5 unrecoverable)    │
                  │  S3/MinIO recordings (SSE-KMS Bucket Keys     │
                  │    + Cross-Region Replication for HIPAA)      │
                  │  KMS (Vault dev / AWS KMS prod, per-tenant    │
                  │    CMKs + encryption-context tenant_id)       │
                  │  Temporal Cloud (HIPAA BAA, EU namespace)     │
                  │  Codec Server (AES-256-GCM, KMS-backed, JWT)  │
                  │  Manual-QA queue (BullMQ on Redis; 2 %        │
                  │    stratified redaction audits)               │
                  └───────────────────────────────────────────────┘
                                  ▲
                                  │ HTTPS (OAuth2 PKCE / Basic)
            ┌─────────────────────┴─────────────────────────────┐
FRONTEND    │ Operator Console │ Admin │ Supervisor │ Portal    │
PLANE       │   React 19 + Vite + TS + SIP.js + TanStack Router │
            │   + Query + Zustand + React Hook Form             │
            │   (operator mobile: Expo + react-native-callkeep) │
            └───────────────────────────────────────────────────┘
                                  │
                                  ▼ HTTPS (webhooks/APIs out)
            ┌───────────────────────────────────────────────────┐
INTEGRATION │ SIP trunks (Telnyx/Twilio) │ SMS │ Email │        │
PLANE       │ AWS End User Messaging Push (HIPAA-BAA,           │
            │   one EUM Application per tenant)                 │
            │ Calendar (Google/MS365) │ CRM │ Stripe │ Homer    │
            │ LiveKit SIP bridge (v1.x, for AI/inbound only)    │
            └───────────────────────────────────────────────────┘
```

---

## 3. Role-to-module map

Same ten pillars as v0.2; one new module (M29 Toll-Fraud Monitor) joins the Compliance & Security pillar.

| Role pillar | Owns |
|---|---|
| **Platform / SRE** | Kamailio config, rtpengine, coturn, **Caddy 2.10+ edge** (permission module, Redis storage), K8s/Compose manifests, Patroni, Supavisor, Redis, **NATS main + compliance clusters**, **Temporal worker fleet + codec server**, observability stack, **quarterly DR drill**, CI/CD |
| **Telephony backend** | Asterisk 22 dialplan, PJSIP realtime schema, ARI Outbound-WS bridge module with 100 ms hard-stop, MixMonitor → emptyDir → uploader sidecar |
| **Domain backend** | NestJS bounded-context modules (M01-M15) |
| **API surface backend** | M25: `/v1` XML+JSON facade (xmlbuilder2 + fixtures), `/api/v2` OpenAPI facade, webhook delivery |
| **Integration backend** | M19-M24: SMS/Email/Push (AWS EUM, one Application per tenant)/Webhook/Calendar/CRM adapters |
| **Frontend — Console** | F03 Operator Console (SIP.js, multi-line state machine, screen-pop, form runner) |
| **Frontend — Admin & Supervisor** | F04 Admin, F05 Supervisor (incl. dispatch dashboard), packages/ui |
| **Frontend — Portal** | F06 Client Portal, white-label, recording playback, embedded report widgets |
| **Compliance & Security** | M02 Identity, **M26 Compliance Workflows** (with revised `gdpr_strict` default for healthcare), **M29 Toll-Fraud Monitor** *(new)*, X01-X04, X10, KMS/KEK rotation, **Two-pass redaction pipeline + manual QA queue**, tenant-deletion sagas |
| **Analytics** | **M27 Reports**, Cube.dev semantic layer (Enterprise tier — see §5 ADR-15), report renderer pipeline |
| **QA / SDET** | Contract tests (Pact), SIPp scenarios, Playwright E2E, load harness, golden-fixture XML diffs, **redaction sample audit harness**, fencing-token zombie-leader chaos test, Supavisor SET LOCAL parity test |

---

## 4. Module catalogue

### 4.1 Domain backend modules

Deltas from v0.2 only.

| # | Module | Owns (tables) | Notes |
|---|---|---|---|
| M01 | **Tenancy** | unchanged + **`tenant_vertical_template` (closes FR-A6: medical, legal, trades, property, IT-MSP, funeral, general)** | Custom-domain TLS via Caddy 2.10+ permission endpoint (§5 ADR-19). Vertical seed packages mounted at tenant creation (M03 contacts schema, M05 form library, M27 reports). |
| M02 | **Identity & Auth** | unchanged + **`user_tenant_grant` (multi-tenant invite + per-tenant role, closes FR-T6)** | Argon2id LRU+Redis cache (§5 ADR-07). Multi-tenant identity flow: tenant switch issues a fresh access token bound to `(user_id, tenant_id)`; switch triggers re-auth if the source tenant's policy demands MFA-on-switch. |
| M05 | **Custom Forms** | unchanged + **`hyperlink_token_grammar` (closes FR-F8: `[Dial:…]`, `[Search:…]`, `[Client:…]`, `[Contact:…]`)** | JSONLogic `x-computed` (§5 ADR-11). Hyperlink tokens parse to a typed AST at form-save time; F03 dispatches via the typed AST. |
| M06 | **Calls (CDR+)** | unchanged | Reconciliation loop (§5 ADR-02 + ADR-16). |
| M07 | Messages | unchanged | `redact(messageId, jsonPath[])` is the M26 hook. |
| **M10** | **Recording & Redaction** | unchanged + **`redaction_run`** (per-recording two-pass output: detector confidence, span list, fallback flag), **`redaction_audit_sample`** (stratified 2 % manual QA), **`recording_replica`** (cross-region replication state) | **Two-pass pipeline** (§5 ADR-13): (1) AssemblyAI Universal-3 Pro Medical or AWS Transcribe Call Analytics → word-level timestamps; (2) Presidio NER + domain regex (MRN/DOB/account/phone) over transcript. **Low-confidence numeric spans → segment-boundary bleep** (over-bleeps by 0.5–2 s, HIPAA-defensible). Per-recording **manual QA gate** at 2 % stratified sample before any policy that destroys re-identification material (M26). Cross-region replication enabled for HIPAA-tagged tenants (§5 ADR-21). |
| M14 | Audit & Compliance Log | unchanged | **Audit log is classified as personal data in scope** post-SRB (§5 ADR-14) — not residual. Pseudonymisation extends to audit_log entries older than the HIPAA-minimum retention. |
| M15 | Supervisor Live State | unchanged | Operator state protocol: WS heartbeat 2 s; on F03 disconnect > 10 s M15 transitions to `Offline`; on reconnect F03 receives authoritative state snapshot. |

### 4.1a New domain modules

| # | Module | Owner | Owns / Inbound / Outbound |
|---|---|---|---|
| **M26** | **Compliance Workflows** *(revised default)* | Compliance & Security | **Owns**: `compliance_request`, `compliance_step`, `legal_hold`, `pseudonym_map` (separate Postgres schema, dedicated per-tenant KMS key). **Inbound**: `/v1/compliance/erasure`, `/portability`, `/tenant-deletion`, `/legal-hold`; subscribes to `tenant.flagged_for_deletion`, `dpo.request.created`. **Outbound** (application services only): `M07.MessageService.redact`, `M10.RecordingService.bleepAndTombstone`, `M14.AuditService.append`, `M19.SmsService.purgeConversation`, `M21.PushService.tombstoneDevice`, `M01.KmsService.scheduleKeyDeletion`. **Runs on Temporal Cloud (HIPAA BAA, EU namespace for GDPR-scoped tenants; codec-server-encrypted payloads; no PHI in Search Attributes — CI-linted)**. **Default policy for healthcare-tagged tenants is `gdpr_strict`** (§5 ADR-14): hard-delete every record not under an active HIPAA retention obligation; for the HIPAA-mandated residual, invoke GDPR Art. 17(3)(b) and document the carve-out per tenant. `pseudonymise_until_retention_expires` is *deprecated as default* but available with mandatory per-tenant DPIA + EU counsel sign-off; `gdpr_wins` (full hard-delete) and `hipaa_wins` (refuse-with-justification) remain. **Events**: `compliance.request.{created,step.completed,step.failed,completed,aborted}`, `compliance.legal_hold.activated`, `compliance.kms.dek_destroyed`. |
| **M27** | **Reports** *(license risk flagged)* | Analytics | **Owns**: `report_definition` (slug, scope=`tenant\|portal\|admin`, `cube_query_jsonb`, `viz_config_jsonb`, version), `report_schedule`, `report_run`, `report_subscription`. **Inbound**: `/v1/reports`, `POST /v1/reports/{id}/run`, `GET /v1/reports/{id}/runs/{runId}` (signed download). Subscribes to `cron.tick`, `billing.cycle.closed`, `otas.gap_detected`. **Outbound**: Cube.dev **Cloud Enterprise tier** (or self-hosted, evaluated Sprint 0; see §5 ADR-15 for posture). JWT-signed `securityContext={tenant_id}`; PDF rendered by headless Chrome on capped BullMQ queue (4 concurrent / replica, 150 MB each); CSV/XLSX streamed from Cube SQL API. **30+ seed `report_definitions` ship in Sprint 8** (see §10 for catalogue); admin can clone+edit. Renderer = React in F04/F05/F06. |
| **M28** | **BulkImport** *(extended)* | Domain backend | unchanged + **TAS migration connector** (closes §9.3 migration bundle): pre-built mappings for TAS's account/contact/otas/template CSV exports + Postgres dumps; idempotent re-import via `(tenant_id, source_system, source_id)` dedupe key; reports diff between import passes. |
| **M29** | **Toll-Fraud Monitor** *(new; closes NFR-S13)* | Compliance & Security | **Owns**: `tollfraud_window` (Redis sorted-set sliding window — 60 s / 1 h / 24 h cost-per-minute per tenant), `tollfraud_alert`, `tollfraud_block` (in-effect SIP trunk blocks). **Inbound**: NATS `telephony.cdr.completed` (per-call rate ingest from M06). **Outbound**: NATS `tollfraud.alert.{warning,critical,blocked}`; calls `M16.TrunkService.block(tenant, reason)` on critical; emits Stripe metered usage event to M13 on cost overruns. **Tier-aware thresholds**: per-tenant baseline learned over 30-day rolling window; triggers warning at 3× baseline, critical at 10×, automatic block at 25× with 5 min cool-down + tenant-admin signal-cancel within 60 s. **Operationally**: lives as a small BullMQ-tier worker; no Temporal needed; reconciliation against Stripe usage every 5 min. |

### 4.2 Telephony & integration backend modules

| # | Module | Public contract |
|---|---|---|
| **M16** | **Telephony Control Plane** *(hardened)* | **ARI Outbound WebSockets** (Asterisk 22) — Asterisk-initiated, persistent. NestJS leader holds Redis lock (TTL 15 s, heartbeat 3 s) + monotonic fencing token. **Hard-stop on missed heartbeat (§5 ADR-16)**: on any missed heartbeat (3 s elapsed without ack from Redis), leader immediately (a) closes its ARI WebSocket, (b) drains its in-flight ARI command queue without dispatching, (c) ceases all `command.*` NATS consumers, (d) writes `leader.stepped_down` audit. Fencing-token check on Postgres writes remains as belt-and-braces. **Reconciliation loop every 5 s** diffs `GET /channels` + `GET /bridges` against open Call/Bridge rows; closes orphans; re-subscribes after WS reconnect. NATS subjects `telephony.event.*`; RPC `telephony.command.{originate,spy,transfer,pause_record}`. |
| **M17** | **PJSIP Realtime Schema** | Asterisk 22 **stale-cache** mode (`object_lifetime_stale=30`, `object_lifetime_max=3600`) + AMI `SorceryMemoryCacheExpireObject` on every tenant-config write. **AMI invalidation retry** (closes v0.2 surface concern): NestJS writes audit row, fires AMI, awaits `Response: Success` within 500 ms; on timeout retries 2× with exponential backoff; final failure raises `infra.pjsip.cache_dirty` (M14 + PagerDuty). **`tenant_uuid_short8` derivation**: first 8 hex characters of `sha256(tenant_uuid)` — deterministic, no UUID-version dependence, collision probability < 2⁻³² per tenant (acceptable; collision check at provisioning time).  PCI `*7`/`*8` codes bound to per-tenant `[macro-tenant-{id}]` contexts. |
| **M18** | **Asterisk Dialplan + IVR** | unchanged | **NFR-S2 hardened**: HIPAA-tagged tenants enforced via `SIPADDHEADER` + Kamailio `if (!has_totag() && !is_method("REGISTER") && hdr(X-Tenant-Tier) == "hipaa" && !rtpengine_has_srtp()) sl_send_reply("488", "SRTP required");`. |
| **M19** | **SMS Adapter + Templates** | unchanged. `packages/templates` versioned via `(template_id, template_version)`. Per-tenant **PHI-token allowlist** enforced at template-save time (closes v0.2 NFR-S7). |
| **M20** | **Email Adapter** | unchanged. Open-tracking webhook at `/integrations/email/event/{provider}` (closes FR-D2). |
| **M21** | **Push Adapter** *(clarified, closes C7 and FR-P8)* | Port `PushSender`. **Provider: AWS End User Messaging Push** — HIPAA-BAA covered for push surface (Voice Message and WhatsApp surfaces of the same umbrella service are **out of BAA** and forbidden in our code; CI lint rejects any `voice` or `whatsapp` AWS SDK call). **One EUM Application per tenant** for credential and CloudTrail audit isolation. **Content-less push payload only**: APNS `aps.content-available=1` background push; FCM data-only message with deep-link URI; mobile app fetches PHI via authenticated `GET /v1/messages/:id`. **Pinpoint console retires 30 Oct 2026 — push API surface unchanged; no migration code path needed**. **OneSignal Enterprise** wired as secondary provider for failover (BAA on Enterprise tier only). **VAPID web push** (closes FR-P8): one active key pair + one staged-rollout key pair per tenant in `tenant_vapid_keypair`; rotation cadence 90 days; re-subscribe migration window 30 days during which both keys verify; private keys stored AES-256-GCM-wrapped under per-tenant CMK in `tenant_vapid_keypair.wrapped_private_key`. |
| **M22** | **Webhook Delivery** | unchanged. |
| **M23** | **Calendar Adapter** | unchanged. |
| **M24** | **CRM Adapter** | unchanged. |
| **M25** | **REST API Facade** *(closes FR-AU5)* | XML output via `xmlbuilder2` + byte-for-byte golden fixtures; `/api/v2` OpenAPI 3.1 emitted from NestJS decorators + Zod schemas. **Gateway-level audit middleware** (closes FR-AU5): every `/v1` request emits an `api.v1.access` audit row at the M25 layer (separate from the X04 decorator on application services) — captures `actor_id, tenant_id, method, path, status, latency_ms, request_body_hash, response_body_hash`. Outbound CRM webhooks (M24) audited symmetrically. |

### 4.3 Frontend modules

| # | Module | Notes |
|---|---|---|
| F01 | `packages/ui` *(extended)* | unchanged + **keyboard-shortcut runtime** (closes FR-C13): two-layer resolution = tenant defaults from `tenant_keyboard_shortcut` overlaid by user overrides in `user_keyboard_shortcut`; published shortcut catalogue versioned in `packages/ui/shortcuts.json`; F03 / F04 / F05 / F06 all consume the same hook. |
| F02 | `packages/sdk-v2` | unchanged. |
| F03 | `apps/web-console` | xstate multi-line state machine treats M15 as source of truth. **Disconnect/reconnect protocol**: WS heartbeat 2 s; on disconnect F03 holds last known state for 10 s with degraded indicator; on reconnect receives authoritative snapshot from M15 and replays buffered user-intent events (oldest first, 5 s buffer cap). Hyperlink tokens parse via typed AST shared with M05. |
| **F04** | `apps/web-admin` *(extended)* | unchanged + **Stripe self-serve flow** (closes §9.4): signup form → Stripe Checkout → tenant provisioning saga (M01) → onboarding-tour route; **cancellation+export gate** invokes M26 `PortabilityExportWorkflow` before tearing down the tenant. **Vertical-template gallery** during onboarding (closes FR-A6). |
| F05 | `apps/web-supervisor` | unchanged. Dispatch dashboard owned here. |
| F06 | `apps/web-portal` | unchanged. Custom-domain TLS via Caddy 2.10+ permission endpoint (§5 ADR-19). |
| F07 | Form Designer | unchanged. |

### 4.4 Cross-cutting modules

| # | Module | What it provides |
|---|---|---|
| X01 | Identity context propagation | unchanged. |
| X02 | KMS / envelope encryption | unchanged. **S3 Bucket Keys** enabled; **Cross-Region Replication** for HIPAA tenants (§5 ADR-21) replicates ciphertext with the same wrapped DEK pointers; KMS multi-region keys back per-tenant aliases. |
| X03 | RLS policy library | unchanged. |
| X04 | Audit decorator + trigger | unchanged. M25 gateway audit layered on top (FR-AU5). |
| X05 | Observability | unchanged. **NFR-P3** screen-pop latency profiling added to Sprint 1-3 baseline alongside NFR-P1. |
| X06 | DB schema & migrations | unchanged. |
| X07 | Feature flags | unchanged. |
| X08 | Job queue + workflow infrastructure | **Three tiers (P5)**: BullMQ ≤ 1 h; **Temporal Cloud** hours-to-days (codec-server-encrypted; per-namespace retention ≤ 30 days for PHI; Workflow History Export to customer-controlled S3 for HIPAA audit retention; EU namespace for GDPR-scoped tenants); **NATS JetStream main cluster** (default sync interval) for high-volume domain events; **NATS JetStream compliance cluster** (`sync_interval=always`, R=3 default / R=5 unrecoverable) for audit, dispatch-decision, recording-upload streams — see §5 ADR-17. |
| **X09** | **SIP capture / Homer** *(retention fixed)* | HEPv3 mirror from Kamailio + rtpengine. **90-day retention** for all tenants (closes NFR-O1; previously 30 day was below PRD). Hot tier 30 days on local disk; warm tier 60 days on object storage with on-demand replay. |
| **X10** | **Compliance test suite** *(extended)* | Contract tests: no PHI in SMS adapter payloads; no PHI in Temporal Search Attributes; `audit_log` partition rotation drill; cross-tenant probe (READ and WRITE); recording-playback signed-URL expiry; PCI redaction silence-overwrite verification; **fencing-token zombie-leader test** + **100 ms hard-stop assertion**; Temporal erasure saga drill with simulated S3 retention violation; **redaction sample audit harness** (10 synthetic recordings with planted PII spans, asserts 2 % stratified manual queue is non-empty after pipeline run); **Supavisor `SET LOCAL` parity test (Day 1, §5 ADR-18)**; **Caddy storage-flood resilience test** (1 k probes/sec against unknown SNI, asserts L4 rate-limiter trips before storage RPS exceeds 50/sec). Runs nightly + on tagged release. |

---

## 5. Decisions resolved up-front (Sprint 0 ADR pack)

The 12 v0.2 ADRs remain in force (status: **kept** or **amended**). Eleven new ADRs (ADR-13 through ADR-23) join the gate. **All 23 ADRs MUST be merged before any module work ships code.** ADR-14 requires EU data-protection counsel sign-off; ADR-15 requires Temporal Cloud sales confirmation of BAA tier. These are the only external-dependency ADRs and are explicitly named as the long-lead-time items.

### 5.1 v0.2 ADRs — status

| ADR | Status | Note |
|---|---|---|
| ADR-01 RLS enforcement | **kept** | Augmented by ADR-18 Supavisor CI parity test. |
| ADR-02 ARI leader election | **amended** | Hard-stop semantics moved to ADR-16; ADR-02 retains the Redis lock + fencing token + 5 s reconciliation core. |
| ADR-03 Audit-log tenant integrity | **kept** | Now combined with ADR-14: audit log itself is in-scope personal data. |
| ADR-04 TURN posture | **kept** | iceServers config endpoint added to /v1 + /api/v2 surfaces. |
| ADR-05 PCI MVP scope | **kept** | |
| ADR-06 Compliance orchestration module | **amended** | Default policy flips to `gdpr_strict` — see ADR-14 for the legal grounding and ADR-13 for the redaction primitive that makes the pseudonymisation alternative arithmetically unsafe in the first place. |
| ADR-07 Argon2id caching | **kept** | |
| ADR-08 PJSIP cache + naming | **amended** | AMI retry semantics specified (M17 row); `tenant_uuid_short8 = sha256(uuid)[0..8]`. |
| ADR-09 Envelope encryption + KEK rotation | **amended** | Cross-region replication clause added (see ADR-21). ABAC IAM pattern documented: per-tenant `AssumeRoleWithWebIdentity` cached at the worker level for 50 min (STS token lifetime); STS call rate-limited; rotation under load modelled in load-test fixture before MVP. |
| ADR-10 OTel trace propagation | **amended** | Outbound INVITE leg now also carries `X-Trace-Context` (M19 dispatch + M16 transfer-supervised). |
| ADR-11 Computed-field DSL | **amended** | Numeric canonicalisation rules: dates serialised as ISO-8601 UTC; floats clamped to 15 significant digits + decimal-string representation; locale-sensitive operations forbidden in DSL. |
| ADR-12 Custom-domain TLS | **amended** | Hardened via ADR-19. |

### 5.2 v0.3 new ADRs

| ADR | Decision | Rationale (short) |
|---|---|---|
| **ADR-13 — Two-pass PII redaction + manual QA gate** | Audio redaction is a **two-pass pipeline**, not forced-alignment-only: (1) transcribe with **AssemblyAI Universal-3 Pro Medical Mode** (HIPAA BAA) or **AWS Transcribe Call Analytics** (HIPAA BAA) — get word-level timestamps; (2) Presidio NER + domain regex (MRN, DOB, account, phone) over the transcript; (3) for spans with sub-word alignment confidence ≥ 0.80, bleep at word boundaries; (4) for low-confidence numeric spans, **bleep the enclosing utterance segment** (over-bleeps by 0.5–2 s but HIPAA-defensible). **Manual QA gate**: 2 % stratified sample of every redaction batch routed to a HIPAA-cleared reviewer queue before any policy that destroys re-identification material (M26 `pseudonymise_until_retention_expires`, recording deletion). **Per-span audit log** captures `recording_id, entity_type, confidence, span_start_ms, span_end_ms, decision (bleep_word|bleep_segment|escalate), reviewer_id_if_human, timestamp`. AWS explicitly disclaims HIPAA de-identification compliance for its own redaction feature — we do not rely on a single vendor. | Closes RISKS N1. WER on 8 kHz μ-law is 13–18 % per [Voicegain 2025 benchmark](https://www.voicegain.ai/post/2025-speech-to-text-accuracy-benchmark-for-8-khz-call-center-audio-files) — 1 in 6–8 words wrong, missed-digit risk for MRN/phone is non-trivial. Hamming AI's 2025 production analysis (4 M+ calls) and Voicegain/Sutherland (95 % redaction accuracy) both describe the two-pass + manual QA pattern. [AWS Transcribe HIPAA disclaimer](https://docs.aws.amazon.com/transcribe/latest/dg/pii-redaction.html). [WhisperX numeric-alignment limitation](https://github.com/m-bain/whisperX/issues/1247). |
| **ADR-14 — Cross-framework policy default = `gdpr_strict`** | Healthcare-tagged tenant default flips from `pseudonymise_until_retention_expires` (v0.2) to **`gdpr_strict`**: hard-delete every record not under an active HIPAA retention obligation; for the HIPAA-mandated residual, invoke GDPR **Art. 17(3)(b)** ("necessary for compliance with a legal obligation") with documented scope-limited retention and per-tenant disclosure in the privacy notice. Audit logs are **classified as personal data in scope** — not residual — and are pseudonymised in place once they exceed the HIPAA-minimum retention. `pseudonymise_until_retention_expires` remains available *only* with mandatory per-tenant DPIA + EU counsel sign-off attached to the tenant record. `gdpr_wins` (full hard-delete) and `hipaa_wins` (refuse-with-justification) unchanged. **Sprint 0 deliverable: EU data-protection counsel review of the `gdpr_strict` template against post-SRB jurisprudence; written opinion attached to the ADR before M26 ships.** | Closes RISKS N2. CJEU C-413/23 P (4 Sept 2025) established the recipient-relative test for pseudonymisation; for the originating controller pseudonymised data "necessarily remains personal data" (para. 76). EDPB CEF 2025 Right-to-Erasure report (Feb 2026, 32 DPAs, 764 controllers) explicitly flagged controllers that "rely on anonymisation as a substitute for deletion" with "insufficient guarantees for irreversible nature" — DPAs are actively enforcing this gap. [Skadden analysis](https://www.skadden.com/insights/publications/2025/11/in-a-landmark-decision-eu-court-clarifies), [EDPB CEF 2025 report PDF](https://www.edpb.europa.eu/system/files/2026-02/edpb_cef-report_2025_right-to-erasure_en.pdf), [EDPB Guidelines 01/2025 on Pseudonymisation](https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf), [FPF: CJEU's Contextual Turn](https://fpf.org/blog/rethinking-personal-data-the-cjeus-contextual-turn-in-edps-vs-srb/). |
| **ADR-15 — Temporal Cloud BAA hygiene** | HIPAA workflows on Temporal Cloud require: (1) **signed BAA before any PHI processing**, sales-confirmed BAA tier (Business minimum; **Enterprise tier preferred** given lack of public tier documentation); (2) **zero-PHI Search Attribute policy, CI-linted** — SAs are stored unencrypted in the Visibility store and bypass the codec server by architectural design, not bug; only opaque UUIDs allowed in SAs; (3) **Codec Server: AES-256-GCM, customer-KMS-backed, JWT/OAuth gated, network-isolated**; key versioning mandatory (decryption of retained history depends on it); (4) **EU namespace pinning** for GDPR-scoped PHI (Frankfurt or Ireland); written confirmation from Temporal that EU namespace metadata does not egress to US side; (5) **Per-namespace retention ≤ 30 days for PHI namespaces**; **Workflow History Export** to customer-controlled S3 for long-term HIPAA audit retention; (6) **Self-host fallback via Helm chart v1.0.0** (Apr 2026) if BAA tier cost is prohibitive or EU residency cannot be confirmed. **Date correction**: Temporal Cloud HIPAA announcement is **5 February 2024** — not 2026. | Closes RISKS N3. [Temporal Cloud HIPAA (Feb 5, 2024)](https://temporal.io/blog/temporal-cloud-is-now-hipaa-compliant), [Search Attribute encryption warning](https://docs.temporal.io/search-attribute), [Codecs and Encryption](https://docs.temporal.io/production-deployment/data-encryption), [Temporal regions](https://docs.temporal.io/cloud/regions), [Helm v1.0.0 milestone](https://temporal.io/blog/an-important-milestone-for-temporals-helm-charts), [Workflow History Export](https://temporal.io/blog/introducing-workflow-history-export). |
| **ADR-16 — ARI leader hard-stop on missed heartbeat** | Fencing tokens protect Postgres writes only; Asterisk ARI does not check fencing tokens. Therefore: ARI leader **closes its outbound WebSocket and ceases all command dispatch within 100 ms** of any missed heartbeat (3 s elapsed without Redis lock ack). The leader's in-flight ARI command queue is drained-without-dispatch; the NATS `telephony.command.*` consumer is paused; an audit row `leader.stepped_down{reason: heartbeat_loss, last_token, channels_dropped}` is written. The 5 s reconciliation loop in ADR-02 reconciles state *after* the new leader establishes its WebSocket. Fencing token check on Postgres writes remains as belt-and-braces. **X10 zombie-leader chaos test**: pause leader for 5 s, observe (a) WS closes within 100 ms of heartbeat miss, (b) Postgres writes carrying stale token are rejected, (c) replacement leader closes orphaned channels within 7 s. | Closes RISKS N4. [Distributed Locks redux (Aphyr/Kleppmann thread)](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) on the limited blast-radius of fencing tokens when the resource doesn't check them. |
| **ADR-17 — Vendor strategy for fragile NestJS infra packages** | (1) **Temporal**: thin in-house `TemporalModule` (~120 LOC) wraps official `@temporalio/client` + `@temporalio/worker` v1.16; uses NestJS `DynamicModule.forRootAsync`, `OnModuleInit` → `worker.run()` detached, `OnApplicationShutdown` → `worker.shutdown()`; OTel via official `@temporalio/interceptors-opentelemetry`. Do **not** depend on `nestjs-temporal-core` or `nestjs-temporal` (single-maintainer, < 50 stars). (2) **JetStream**: thin in-house `JetstreamModule` (~200 LOC) wraps `@nats-io/jetstream` + `@nats-io/transport-node` v3 as a NestJS `CustomTransportStrategy`; manages consumer lifecycle, DLQ, ordered delivery. Do **not** depend on `@horizon-republic/nestjs-jetstream` (14 stars, single-org) as a production foundation — it is allowed as a *reference implementation* during Sprint 1 prototyping then replaced. The built-in `@nestjs/microservices` NATS transport is core-NATS only and is not used. (3) **Caddy storage**: use `pberkel/caddy-storage-redis` v1.8+ (89 stars, 10 releases, 48 commits, ships March 2026; supports Standalone/Cluster/Sentinel with sorted-set indexing). Forked into our monorepo at v1.8.0 baseline; we cherry-pick upstream fixes; we own the next major migration. Do **not** use archived `gamalan/caddy-tlsredis`. (4) **NATS `sync_interval=always` is server-wide, not per-stream** — run a dedicated 3-node compliance NATS cluster for audit/dispatch-decision/recording-upload streams; main cluster keeps default 2 min interval and carries high-volume domain events. | Closes RISKS N5. [@temporalio/client npm v1.16](https://www.npmjs.com/package/@temporalio/client), [@temporalio/interceptors-opentelemetry](https://docs.temporal.io/develop/typescript/observability), [pberkel/caddy-storage-redis](https://github.com/pberkel/caddy-storage-redis), [NATS sync_interval docs](https://docs.nats.io/running-a-nats-service/configuration). |
| **ADR-18 — Supavisor `SET LOCAL` parity CI gate** | X10 ships a test on Sprint-0 Day-1 that opens a Supavisor transaction-mode connection and asserts (a) `BEGIN; SET LOCAL app.tenant_id = 'A'; SELECT current_setting('app.tenant_id'); COMMIT;` returns `'A'`; (b) immediately re-using the *same pooler connection* in a new transaction, `BEGIN; SELECT current_setting('app.tenant_id'); COMMIT;` returns the empty string — i.e. `SET LOCAL` is bounded by the transaction even when the underlying server connection is reused. **Module M01 cannot merge until this test passes.** If Supavisor fails the parity test, fallback is PgBouncer 1.22+ transaction-mode (documented parity). | Closes RISKS N6. [Supavisor pool modes](https://supabase.github.io/supavisor/configuration/pool_modes/) — vendor docs do not state the property explicitly; we test it. |
| **ADR-19 — Caddy 2.10+ on-demand TLS hardening** | (1) Use Caddy **2.10.0+** with `permission http` (replaces deprecated `ask`); the `ask` alias is removed in a future Caddy minor and we do not depend on it. (2) Permission endpoint must respond in **< 200 ms p95** (Caddy hard timeout 10 s); it queries `tenant_custom_domain.verified=true` against Postgres via a local read replica; it maintains an **in-process LRU cache** with 5-min TTL for approved domains and **60-s TTL for declined domains** to absorb the certmagic #174 storage-flood class. (3) **L4 rate limiter** (HAProxy) in front of port 443 caps new TLS connection attempts per source IP. (4) Storage = `pberkel/caddy-storage-redis` v1.8+ on Redis Cluster (3 master + 3 replica); cert cache shared across regions. (5) **Let's Encrypt rate-limit-exemption application submitted in Sprint 0** (2–4 week turnaround per ISRG form); **ZeroSSL** wired as fallback issuer in Caddy's ACME list; **ARI enabled** so renewals are rate-limit-exempt. (6) `max_certs` directive **removed** — the permission endpoint is the only authorization gate. (7) Permission endpoint exposes constant-time response (approved vs declined) so SNI-probe enumeration is not observable from latency. | Closes RISKS N7. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https), [certmagic #174](https://github.com/caddyserver/certmagic/issues/174), [LE rate-limit override form](https://isrg.formstack.com/forms/rate_limit_adjustment_request), [LE rate-limit scaling Jan 2025](https://letsencrypt.org/2025/01/30/scaling-rate-limits). |
| **ADR-20 — Toll-fraud sliding-window monitor (M29)** | New module **M29 Toll-Fraud Monitor**. Redis sorted-set sliding window (60 s / 1 h / 24 h cost-per-minute per tenant). Per-tenant baseline learned over 30-day rolling window. Thresholds: warning at 3 × baseline, critical at 10 ×, automatic SIP-trunk block at 25 × baseline with 5 min cool-down + tenant-admin signal-cancel within 60 s. Cost computed from M06 CDR `telephony.cdr.completed` events (per-call duration × per-destination rate from M19/M20/SIP-trunk price-list). Block invokes `M16.TrunkService.block(tenant)`. Stripe metered usage event emitted on cost overruns (M13). X10 includes a synthetic fraud-storm test (10 k INVITEs to +1-900 numbers in 60 s — asserts critical alert + block within 90 s). | Closes RISKS PRD §3 NFR-S13. |
| **ADR-21 — S3 Cross-Region Replication for HIPAA tenants** | All HIPAA-tagged tenant recordings replicate to a second AWS region via **S3 CRR** with **KMS multi-region keys** so the wrapped DEK pointers remain valid in the replica region. Replication target: same-account, separate region (us-east-1 → us-west-2 for US; eu-west-1 → eu-central-1 for EU). RTO 1 h, RPO < 5 min. Replication metric exported to Grafana (`s3_replication_lag_seconds`); alert if > 15 min. **Tenant geography pinning**: a HIPAA tenant declared in US cannot have its replica in the EU and vice versa — enforced via M01 provisioning policy and audited monthly. S3 Object Lock **governance mode** retained (compliance mode cannot satisfy GDPR Art. 17 erasure). | Closes RISKS PRD §3 NFR-A6. |
| **ADR-22 — Quarterly DR drill cadence** | Platform/SRE owns quarterly DR drill: (1) simulate primary-region failure of Postgres (Patroni promotion in secondary), Redis, NATS, S3 (read from CRR replica), Kamailio, coturn; (2) document RTO and RPO measurements; (3) one drill per quarter on staging *and* one **chaos game-day on production at low-traffic window per year**; (4) drill report committed to `runbooks/dr-drills/YYYY-QN.md`. Findings drive backlog items with explicit SLOs. Failure to run a drill in a quarter is a P1 audit finding. | Closes RISKS PRD §3 NFR-A8. |
| **ADR-23 — Vertical templates (M01)** | Seven seed verticals ship in MVP: **medical, legal, trades, property, IT-MSP, funeral, general** (closes FR-A6). Each vertical is a bundle of: (a) M03 account custom-fields, (b) M04 contact custom-fields + message-action templates, (c) M05 form library (3-5 forms minimum per vertical), (d) M19 SMS templates, (e) M27 seed `report_definition` set (medical: HIPAA audit summary, after-hours volume, on-call coverage gap; legal: client intake conversion; etc.). Templates versioned in `packages/templates/verticals/{slug}/v{n}.yaml` and applied at tenant creation via M28 BulkImport. Tenant can opt out of any individual template after activation. | Closes RISKS PRD §3 FR-A6. |

### 5a. Carry-over decisions (still good from v0.2)

| Question | v0.2 → v0.3 |
|---|---|
| ORM | **Prisma 6** *(kept)* |
| Job queue | **BullMQ on Redis** *(kept, scoped)* — Tier 1 jobs only. Temporal owns Tier 2. NATS JetStream compliance cluster owns Tier 3. |
| Monorepo tooling | **pnpm workspaces + Turborepo 2** *(kept)* |
| `/v1` XML library | **`xmlbuilder2` + golden-fixture round-trip tests** *(kept)* |
| Form Designer engine | **JSON Schema 2020-12 + JSONLogic `x-computed`** *(kept; numeric canonicalisation specified in ADR-11)* |
| KMS in MVP | **Vault dev (local), AWS KMS prod** *(kept)* |
| TURN/coturn | **Self-hosted coturn pair per region in MVP** *(kept)* |
| Stream backbone | **NATS JetStream** *(kept, restructured)* — main cluster default sync; dedicated compliance cluster `sync_interval=always`; in-house thin NestJS wrapper (ADR-17). |
| Push provider | **AWS End User Messaging Push** *(kept, hardened)* — one Application per tenant; content-less payloads only; Voice Message/WhatsApp surfaces explicitly forbidden. OneSignal Enterprise as failover. |
| Asterisk version | **22.9.x LTS** *(kept)* — chan_websocket ExternalMedia avoided at > 90 calls (community-reported audio distortion); ARI is the call-control surface. |
| Cube.dev tier | **Cloud Enterprise** *(decided)* — SQL API `securityContext` enforcement parity confirmed for paid tier; CVE-2022-23510 RLS-bypass class addressed in 2024 patches; self-host evaluated and deferred (operational cost > license cost for our scale). |

### 5b. Open questions, scoped (reduced from v0.2)

- **Form Designer visual builder UX** — JSONLogic chosen; the builder needs a design pass before F07.
- **30+ seed report_definitions catalogue** — 5 of 30 specified in §10 (medical vertical); 25 remaining need product input before M27 final cut.
- **EU counsel sign-off on ADR-14 `gdpr_strict` template** — Sprint 0 deliverable, blocks M26 merge.
- **Temporal Cloud BAA tier confirmation** — Sprint 0 deliverable, blocks M26 merge.
- **Hardware SIP phone provisioning (auto-XML)** — accepted as v1.x; manual issuance in MVP.

### 5c. PRD-side changes flagged for the product owner

- **NFR-A2 / NFR-A4**: "new calls route to a healthy node within 30 s; in-flight legs may drop."
- **NFR-A5**: RPO ≤ 5 min (sync replication off) or RPO ≤ 1 min (sync replication on, accepting the write-latency hit).
- **NFR-O1**: 90-day SIP capture retention adopted as universal default (closes v0.2 mismatch — was 30 day).
- **AC §12 #3** push channel: clarified to "AWS End User Messaging Push, content-less payloads, one Application per tenant."
- **NFR-S10**: extended to "No PHI in non-secure SMS body, push payload, **or Temporal Search Attributes**."
- **NFR-S14**: annual pen-test allocated to Compliance & Security pillar; budget line item flagged.
- **AC §12 #13 Documentation**: Platform/SRE pillar, Sprint-15 milestone.

---

## 6. Contract-first toolchain

```
/contracts/
  openapi/
    v1.TAS.yaml         ← hand-curated (TAS parity, frozen)
    v2.api.yaml           ← generated from NestJS @nestjs/swagger + Zod schemas
  asyncapi/
    telephony.yaml        ← NATS subjects, payload schemas
    domain-events.yaml    ← message.saved, dispatch.sent, etc.
    compliance.yaml       ← M26's Temporal-workflow event surface
    tollfraud.yaml        ← NEW. M29 alert and block events.
  temporal/
    workflows/*.ts        ← Workflow + activity signatures + opaque-only Search Attribute lints
    codec-server/*.ts     ← NEW. Codec server interface + KMS adapter contract.
  schemas/
    form-definition.schema.json
    audit-event.schema.json
    webhook-payload.schema.json
    template.schema.json
    vertical-template.schema.json   ← NEW. Per-vertical bundle (M01 ADR-23).
  examples/
    *.json
  fixtures/
    v1-xml/                ← byte-for-byte captured TAS responses
    redaction-audio/       ← NEW. 10 synthetic recordings with planted PII spans for X10 sample audit harness.
```

Tooling unchanged: Spectral, Prism, MSW, Pact, SchemaThesis, AsyncAPI generator. **Add: `temporal-sa-lint`** (custom CI rule — fails if any workflow `searchAttributes` value matches PHI regex patterns: SSN, MRN-like, date-of-birth, phone, email).

---

## 7. Per-module TDD strategy

| Layer | Tool | Per-module example (M10 Redaction with ADR-13) |
|---|---|---|
| Unit | Vitest | Presidio NER on a transcript with known MRN/DOB returns expected entity spans. |
| Contract | Pact + AsyncAPI validator | `redaction.run.completed` payload matches AsyncAPI schema; word-timestamp output from AssemblyAI matches `WordTimestamp` schema. |
| Workflow | `@temporalio/testing` | Erasure workflow with planted low-confidence numeric span deterministically segment-bleeps + routes to manual QA queue. |
| Integration | Vitest + Testcontainers | Real WAV file (8 kHz μ-law, 30 s, planted "DOB is 03 14 1985"): pipeline produces redacted WAV with the DOB segment muted (verified by silence-rms threshold) + redaction_run row + redaction_audit_sample row (stratified 1-in-50). |
| End-to-end | Playwright / SIPp | Caller leaves voicemail with PHI; supervisor plays back from F05 — bleeped audio + transcript shows `[REDACTED-DOB]`; M14 audit chain present. |

Slice TDD discipline unchanged. **X10 (compliance test suite) runs nightly + on tagged release.** New tests added: zombie-leader 100 ms hard-stop; redaction sample audit harness; Supavisor `SET LOCAL` parity; Caddy storage-flood resilience; Temporal SA opacity lint.

---

## 8. Local-dev story

```bash
docker compose up
# brings up:
#   kamailio (single node, dev cert)
#   rtpengine (host-net on Linux; userspace on macOS — see NFR-M1 caveat)
#   coturn (dev cert, single instance)
#   caddy 2.10+ (on-demand TLS OFF in dev; static config; permission endpoint stub)
#   haproxy (L4 rate limiter mirror of prod posture)
#   asterisk-1 (22.9.x, sipp-emulator sidecar simulating trunk)
#   supavisor (Postgres pooler, transaction mode)
#   postgres (Patroni single-node)
#   redis
#   nats-main (default sync)
#   nats-compliance (sync_interval=always, single node in dev)
#   temporalite (single-binary Temporal for local dev — Temporal Cloud in prod)
#   codec-server (KMS adapter pointed at vault-dev)
#   minio (S3-compatible recording storage with CRR stub bucket)
#   vault-dev (KMS stub, in-mem)
#   mailpit (email stub)
#   sms-stub (logs to NATS topic, mounted in /sms-log)
#   push-stub (logs intended AWS EUM Push calls)
#   redaction-stub (faster-whisper-tiny CPU model + presidio + ffmpeg bleeper, runs in worker container)
#   prism (mock /api/v2 if backend not running)
#   nestjs-api (watch mode, runs HTTP + Temporal workers + JetStream consumers)
#   web-console, web-admin, web-supervisor, web-portal (vite dev servers)
#   grafana + tempo + loki + homer (full obs stack)
```

NFR-M1 honesty: rtpengine kernel forwarding unavailable on macOS Docker — userspace path in dev; CI integration tests run on Linux only. Documented in `docs/local-dev-macos.md`.

`make dev-up` ≤ 15 minutes from clone to working synthetic call (matches AC §12 #14). New: `make redaction-smoke` runs faster-whisper-tiny against `fixtures/redaction-audio/` and asserts manual-QA queue populated.

---

## 9. MVP delivery sequencing

```
Sprint 0  ── ADR pack + contracts + counsel sign-off (3 weeks) ─────────
  Two-week core ADR work + one-week external sign-off slack.
  Owners: senior architect + telephony eng + security eng + EU counsel.
  Deliverables: 23 ADRs merged in docs/adr/. EU counsel written opinion
  on ADR-14 attached. Temporal Cloud sales letter confirming BAA tier
  attached to ADR-15. LE rate-limit exemption application submitted.

Sprint 1-3  ── Foundations (must finish before Milestone A) ────────────
  SRE/Platform:  Docker Compose, Postgres + Patroni + Supavisor (with
                 SET LOCAL parity test on Day 1), Redis, NATS main +
                 compliance clusters, Temporal worker fleet + codec
                 server, KMS stub, observability, CI pipeline, RLS
                 cross-tenant WRITE test harness, coturn dev pair,
                 Caddy 2.10 edge config w/ permission endpoint and
                 LRU negative cache, HAProxy rate limiter,
                 fencing-token + 100 ms hard-stop chaos test.
  Security:      M01 Tenancy (incl. vertical templates), M02 Identity
                 (incl. multi-tenant invite + /v1 Basic w/ Argon2id
                 cache + /v2 OAuth), X01-X04, X10 skeleton w/
                 redaction sample audit harness + Supavisor parity +
                 Caddy storage-flood test, audit-log trigger.
  Telephony:     Kamailio (stateless edge, SRTP enforcement for
                 HIPAA tier), rtpengine, Asterisk 22.9 LTS Model B
                 + Model A, PJSIP realtime + stale-cache + AMI
                 invalidation w/ retry, ARI Outbound-WS bridge (M16)
                 w/ 100 ms hard-stop + fencing-token + 5 s
                 reconciliation, SIPp scenarios.
  FE Admin:      packages/ui (incl. keyboard-shortcut runtime),
                 Storybook, packages/sdk-v2 generator, TanStack Router
                 skeleton.
  **Validate NFR-P1 + NFR-P3 here, not Sprint 12-15.**
  100-concurrent-call profiling on the recording pipeline +
  Asterisk CPU/IO + screen-pop p95 < 800 ms must pass.

────────── Milestone A: "First registered softphone places a call" ──────

Sprint 4-7  ── Core call path ──────────────────────────────────────────
  Domain BE:     M03 Accounts, M04 Contacts, M05 Forms (incl. JSONLogic
                 computed fields + hyperlink-token AST), M06 Calls +
                 reconciliation, M07 Messages.
  API surface:   M25 /v1 facade (xmlbuilder2 + fixtures) for Users,
                 Calls, Messages, Contacts, Clients, todo; /api/v2
                 read-side; gateway audit middleware (FR-AU5).
  FE Console:    F03 Operator Console — answer, form-fill, save;
                 multi-line xstate driven by M15 server-side state;
                 wake-lock + foreground UX; disconnect/reconnect
                 protocol.
  FE Admin:      F04 Accounts/Contacts/Users/DIDs/Branding CRUD,
                 templates editor, vertical-template gallery during
                 onboarding.
  Telephony:     MixMonitor → emptyDir → uploader sidecar → M10
                 Recording (envelope-encrypt + S3 SSE-KMS upload +
                 CRR replica row).
  Integration:   M19 SMS + M20 Email adapters (stubs first, real
                 second), packages/templates.

────────── Milestone B: "Operator answers, fills form, dispatched" ──────

Sprint 8-11  ── Scheduling, Supervisor, Portal, Billing, Compliance ────
  Domain BE:     M08 Dispatch (incl. escalation), M09 Scheduling
                 (incl. WhoIsOTAS single source + coverage-gap
                 emission), M11 Tasks, M12 Tenant→Client Billing,
                 M14 Audit.
  M26 Compliance Workflows scaffolded: erasure saga (gdpr_strict
                 default) end-to-end on Temporal Cloud (HIPAA BAA),
                 EU namespace, codec-server-encrypted payloads.
  M10 Redaction two-pass pipeline shipped: AssemblyAI/AWS Transcribe
                 + Presidio + Whisper word-timestamps + segment-
                 boundary bleep fallback + 2% manual QA queue.
  M27 Reports scaffolded with 5 seed report_definitions from medical
                 vertical (see §10).
  M28 BulkImport scaffolded + TAS migration connector.
  M29 Toll-Fraud Monitor shipped.
  FE Supervisor: F05 live grid + listen/whisper/barge (M15+M16) +
                 dispatch dashboard + coverage-gap banner +
                 redaction-QA queue.
  FE Portal:     F06 inbox, recording playback (signed URLs),
                 on-call mgmt, embedded reports, VAPID subscribe
                 (closes FR-P8).
  FE Admin:      F04 Stripe self-serve signup + cancellation+export
                 gate (closes §9.4); compliance-request inbox.
  Integration:   M21 Push (AWS End User Messaging — one Application
                 per tenant, content-less only), M22 Webhook
                 Delivery, M23 Calendar (read-only).
  Security:      PCI redaction worker, delegated-capture redirect
                 (M18), KEK rotation Temporal workflow w/ load model.

────────── Milestone C: "Tenant onboards, runs a shift, bills" ─────────

Sprint 12-15  ── Hardening + Compliance proof ──────────────────────────
  Load test:    100 concurrent calls × 25 ops × dispatch fanout —
                re-run against Sprint 1-3 baseline.
  Chaos drills: Asterisk node kill (accept call drops); Kamailio
                failover (new calls route in ≤ 30 s); Patroni
                promotion; NATS partition (both clusters); ARI
                100 ms hard-stop under zombie-leader; Temporal
                worker partition; coturn fail-over; KEK rotation
                under load; Caddy storage-flood resilience.
  **First quarterly DR drill** (ADR-22) on staging.
  Pen test, ASV scan, SAQ-D w/ QSA sign-off, BAA chain audit
                 (AWS, Twilio/Telnyx, Temporal, OneSignal,
                 AssemblyAI/AWS Transcribe).
  GDPR end-to-end: erasure saga (gdpr_strict) on healthcare tenant
                 under retention; portability export; tenant-
                 deletion w/ legal-hold override.
  Documentation: 4 runbooks (onboarding, operator quick-start,
                 API guide, SRE) + DR drill template + redaction-QA
                 reviewer guide.

────────── Milestone D: MVP cut ────────────────────────────────────────
```

---

## 10. Worked example: M26 Compliance Workflows (GDPR erasure under `gdpr_strict`)

**Boundary in:**
- `POST /v1/compliance/erasure` — `{subject_type, subject_external_id, regulation: 'gdpr', requested_at}`.
- NATS subject `dpo.request.created` from F04.

**Boundary out** (application-service calls only):
- `M07.MessageService.redact(messageId, jsonPath[])` — hard-delete for `gdpr_strict`.
- `M10.RecordingService.delete(recordingId)` — hard-delete recording + cross-region replica + tombstone.
- `M14.AuditService.append(payload)` — every step.
- `M19.SmsService.purgeConversation(externalId)`.
- `M21.PushService.tombstoneDevice(externalId)`.
- `M01.KmsService.scheduleKeyDeletion(perRecordingDekKeyArn, days: 30)`.

**Conflict resolution (gdpr_strict default for healthcare):**
1. Load `tenant_compliance_policy.precedence_rule` (default `gdpr_strict`).
2. For each record touching the subject, evaluate **HIPAA retention obligation**:
   - Under active HIPAA retention (within 7 years and on the data-set HIPAA mandates retaining): **retain via Art. 17(3)(b) carve-out**, pseudonymise where possible without compromising the retention purpose, log the carve-out per record.
   - Outside HIPAA retention or not on the mandated minimum data set: **hard-delete** (message JSON, recording, push token, SMS conversation).
3. Audit log entries older than HIPAA-minimum retention: pseudonymise in place (PHI fields → opaque IDs; operator IDs and timestamps retained as legitimate business records).
4. Emit `compliance.request.completed` with per-record decision.

**Saga shape (Temporal workflow, EU namespace, codec-server-encrypted):**
```
ErasureWorkflow(request):                              // SAs: { request_id: uuid, tenant_id: uuid } — no PHI
  1. assertNotUnderLegalHold(request.subject)          // signal-cancellable
  2. policy = loadCompliancePolicy(request.tenant_id)  // expect gdpr_strict for healthcare
  3. messages = findMessages(request.subject)
  4. recordings = findRecordings(request.subject)
  5. for msg in messages:
       if mandatedByHipaa(msg) and withinRetentionWindow(msg):
         activities.M07.markCarveOut(msg.id, 'art_17_3_b')
         activities.M14.append({decision: 'retained_carveout', record: msg.id})
       else:
         activities.M07.delete(msg.id)
         activities.M14.append({decision: 'deleted', record: msg.id})
  6. for rec in recordings:
       if mandatedByHipaa(rec) and withinRetentionWindow(rec):
         activities.M10.markCarveOut(rec.id, 'art_17_3_b')
         activities.M14.append({decision: 'retained_carveout', record: rec.id})
       else:
         activities.M10.delete(rec.id)            // includes CRR replica + tombstone
         activities.M14.append({decision: 'deleted', record: rec.id})
  7. activities.M19.purgeConversation(request.subject)
  8. activities.M21.tombstoneDevice(request.subject)
  9. activities.M14.pseudonymiseEntries(request.subject, olderThan: hipaaRetentionWindow)
 10. await condition(ack from tenant admin) timeout 7d  // grace
 11. emit('compliance.request.completed', {request_id, audit_id, decisions[]})
  compensations on failure: append failure audit + reopen request; never partial-delete.
```

**Seed report_definitions for medical vertical (5 of 30+):**
1. `medical_hipaa_audit_summary` — daily audit-log volume by event type, accessor, retention status. Scope: admin.
2. `medical_after_hours_volume` — calls answered outside business hours, by client. Scope: tenant + portal.
3. `medical_otas_coverage_gap_daily` — coverage gaps from M09. Scope: admin + tenant.
4. `medical_dispatch_sla` — time-to-dispatch p50/p95 per priority. Scope: admin + tenant.
5. `medical_redaction_qa_backlog` — manual-QA queue age, by reviewer, by tenant. Scope: admin only.

**Definition of done:**
- All five test layers green (§7).
- AsyncAPI + Temporal-workflow schemas published.
- ADR-06 + ADR-13 + ADR-14 + ADR-15 referenced.
- EU counsel written opinion on `gdpr_strict` attached.
- Compose stack runs end-to-end: erasure → hard-delete vs carve-out decisions visible in F06 portal + F04 admin → audit chain in M14 → KMS key for deleted recordings scheduled for destruction with 30-d hold.

---

## 11. What is not locked down

- **Form Designer visual builder UX** — JSONLogic chosen; builder design pass before F07.
- **25 of 30+ seed report_definitions** — 5 of 30 specified (§10); 25 need product input.
- **Operator hyperlink-token grammar AST shape** — token types defined (FR-F8); the operator-side typeahead UX needs a design pass before F03 final cut.
- **Hardware SIP phone provisioning (auto-XML)** — v1.x; manual issuance in MVP.

---

## 12. v0.3 changelog vs v0.2 (audit trail)

| Area | v0.2 | v0.3 | Risk closed |
|---|---|---|---|
| **Cross-framework default for healthcare** | `pseudonymise_until_retention_expires` (destroy pseudonym_map → claim anonymisation under GDPR Recital 26) | **`gdpr_strict`**: hard-delete non-HIPAA-mandated data; Art. 17(3)(b) carve-out for the minimum residual; per-tenant DPIA. `pseudonymise_*` available only with EU counsel sign-off | **N2** (CJEU C-413/23 P + EDPB CEF 2025) |
| **Audio redaction** | forced-aligned PII bleeping | **Two-pass: AssemblyAI/AWS Transcribe + Presidio NER + segment-boundary bleep fallback + 2 % stratified manual QA gate**; audit log per entity | **N1** |
| **Temporal Cloud HIPAA** | "BAA since Feb 2026", unencrypted SA risk unmentioned | **Date corrected (5 Feb 2024); BAA tier pinned (Enterprise preferred); no-PHI-in-SA CI lint; codec-server AES-256-GCM KMS-backed; EU namespace pinning; Helm v1.0.0 (Apr 2026) as self-host fallback; Workflow History Export for HIPAA audit retention** | **N3** |
| **ARI leader on missed heartbeat** | "Redis lock TTL 15s, heartbeat 5s, fencing token validates writes" — fencing token doesn't protect Asterisk-side actions | **100 ms hard-stop: leader closes ARI WS + halts command dispatch within 100 ms of missed heartbeat; fencing token belt-and-braces for DB writes only**; X10 zombie-leader test | **N4** |
| **NestJS infrastructure packages** | `nestjs-temporal-core` (49★/1m), `nestjs-jetstream` (14★/1m) as production deps | **Thin in-house wrappers around `@temporalio/*` v1.16 and `@nats-io/jetstream`; `pberkel/caddy-storage-redis` v1.8 vendored** | **N5** |
| **Supavisor SET LOCAL** | claimed parity, unverified | **CI parity test on Day 1 in X10; PgBouncer 1.22+ fallback documented** | **N6** |
| **Caddy on-demand TLS** | "`ask` endpoint + Redis storage" | **Caddy 2.10+ `permission http`; in-process LRU 60s negative cache; HAProxy L4 rate limit; LE rate-limit exemption applied Sprint 0; ZeroSSL fallback issuer; `max_certs` removed; pberkel/caddy-storage-redis v1.8+ on Redis Cluster** | **N7** |
| **NATS `sync_interval=always`** | implied per-stream | **Server-wide setting — dedicated 3-node compliance NATS cluster for audit/dispatch/upload streams; main cluster keeps default** | clarity + perf |
| **Push provider** | "AWS End User Messaging Push (HIPAA-BAA)" | **One EUM Application per tenant for credential isolation; Voice Message + WhatsApp surfaces explicitly OUT of BAA (CI-linted); Pinpoint console retires 30 Oct 2026 but push API surface unchanged — no migration code path; SNS push banned (out of BAA + 500× more expensive); OneSignal Enterprise as failover; VAPID schema with per-tenant key rotation** | **C7** clarified + FR-P8 |
| **S3 cross-region replication** | unowned | **ADR-21: HIPAA tenants replicate via S3 CRR + KMS multi-region keys; same-region jurisdiction pinning enforced** | NFR-A6 |
| **Quarterly DR drill** | unowned | **ADR-22: Platform/SRE owner; quarterly drill on staging + annual chaos game-day on prod; report committed to runbooks** | NFR-A8 |
| **Toll-fraud monitor** | "informal owner in M16+X10" | **M29 Toll-Fraud Monitor as named module; Redis sliding-window; learned baseline; warning/critical/block thresholds; Stripe integration** | NFR-S13 |
| **Vertical templates** | unowned | **ADR-23: 7 verticals; per-vertical bundle of M03/M04/M05/M19/M27 seed assets; applied at tenant creation** | FR-A6 |
| **Keyboard shortcuts** | unowned | **F01 packages/ui keyboard-shortcut runtime; tenant + user overrides; shared catalogue** | FR-C13 |
| **Hyperlink-token grammar** | open question | **AST defined in M05; F03 dispatches via typed AST; spec in module catalogue** | FR-F8 |
| **Multi-tenant identity flow** | open question | **M02 `user_tenant_grant`; tenant-switch re-auth challenge driven by source-tenant policy** | FR-T6 |
| **/v1 gateway audit** | application-service-level only | **M25 gateway middleware emits `api.v1.access` audit row separately from X04 decorator; symmetric for outbound CRM webhooks** | FR-AU5 |
| **VAPID web push key mgmt** | "VAPID for portal users in MVP" | **`tenant_vapid_keypair` schema; AES-256-GCM-wrapped private keys; 90-day rotation with 30-day re-subscribe migration window** | FR-P8 |
| **Email open tracking** | (added in v0.2) | unchanged | FR-D2 |
| **NFR-O1 SIP capture retention** | 30 day (below PRD) | **90 day universal default; hot 30 / warm 60 with on-demand replay** | NFR-O1 |
| **AMI invalidation retry** | unspecified | **500 ms timeout, 2× exponential backoff, audit + PagerDuty on final failure** | clarity |
| **`tenant_uuid_short8` derivation** | unspecified | **first 8 hex of `sha256(tenant_uuid)`; collision check at provisioning** | clarity |
| **ABAC IAM pattern** | unspecified | **per-tenant `AssumeRoleWithWebIdentity`, 50 min cache (STS token lifetime), rate-limited; load-modelled before MVP** | clarity |
| **Numeric canonicalisation in JSONLogic** | unspecified | **ISO-8601 UTC dates; 15 sig-fig decimal-string floats; no locale-sensitive ops** | clarity |
| **Audit log identifiability** | implicit residual | **classified as personal data in scope; pseudonymised past HIPAA-minimum retention** | N2 follow-on |
| **Outbound INVITE traceparent** | inbound only | **outbound also carries `X-Trace-Context` (M19 + M16 transfer-supervised)** | NFR-O4 follow-on |
| **Reports tier decision** | "F06 bullet" / Cube.dev | **Cube.dev Cloud Enterprise tier confirmed; SQL API parity verified; self-host evaluated and deferred** | M27 risk |
| **Stripe self-serve flow** | unowned | **F04 + M13 saga: Checkout → tenant provisioning (M01) → onboarding-tour; cancellation invokes M26 PortabilityExportWorkflow** | §9.4 |
| **Migration assistance bundle** | unowned | **M28 TAS migration connector: prebuilt mappings + idempotent re-import + diff** | §9.3 |
| **Operator state disconnect/reconnect protocol** | unspecified | **2 s heartbeat; 10 s degraded-state hold; authoritative snapshot + 5 s buffered intent replay on reconnect** | M15↔F03 |
| **HIPAA SRTP enforcement** | implied | **Kamailio `488` reject of non-SRTP INVITEs from HIPAA-tier tenants** | NFR-S2 |
| **Pen test cadence** | unowned | **Compliance & Security pillar; annual; budget flagged in PRD-side §5c** | NFR-S14 |
| **Annual pen test** | unowned | **Compliance & Security pillar deliverable** | NFR-S14 |
| **Sprint 0 gate** | 12 ADRs | **23 ADRs (12 v0.2 + 11 v0.3) + EU counsel sign-off + Temporal sales letter; gate widened to 3 weeks** | process |
| **Two new principles** | P1-P10 | **+ P11 legal defensibility, + P12 vendor-in over single-maintainer** | doctrine |
| **One new module** | M01-M28 | **+ M29 Toll-Fraud Monitor** | NFR-S13 |

---

## TL;DR

Three deliverables make v0.3 work — same shape as v0.2, with the legal interpretation, the redaction primitive, and the bus-factor exposure rebuilt:

1. **`docs/adr/` populated in a three-week Sprint 0 with 23 ADRs** — the 12 v0.2 ADRs (kept or amended) plus 11 v0.3 ADRs (ADR-13 through ADR-23). Two ADRs depend on external sign-off (EU counsel for ADR-14, Temporal Cloud sales for ADR-15) and are flagged as long-lead-time. Without this gate, the 6-9 month MVP target slips by 6-8 weeks of coordination tax plus litigation risk on a contested compliance default.

2. **Module catalogue (§4) with 39 modules across 10 role pillars** — adds M29 Toll-Fraud Monitor; revises M10 Recording & Redaction around the two-pass pipeline with manual QA; revises M26 Compliance Workflows around `gdpr_strict` default; revises M21 Push around per-tenant EUM Applications and the Oct 2026 Pinpoint console retirement; closes 16 PRD coverage gaps still open in v0.2.

3. **`docker compose up` boots everything stubbed** — including `temporalite` + `codec-server` for local encrypted Temporal, `nats-compliance` for the sync-always cluster, `redaction-stub` (faster-whisper-tiny + Presidio + ffmpeg) for the two-pass pipeline, `caddy` with permission endpoint, `haproxy` rate limiter — with zero cloud credentials. The fixtures directory now ships 10 synthetic recordings with planted PII spans for the X10 sample-audit harness.

*End of architecture v0.3. ADRs 13-23 in `docs/adr/` are the next deliverable; the EU counsel opinion on ADR-14 and the Temporal Cloud sales letter on ADR-15 are the two external-dependency long-lead-time items that block M26 merge.*
