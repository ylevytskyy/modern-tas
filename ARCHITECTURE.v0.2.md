# Telephone Answering Service (TAS) — High-Level Architecture (v0.2)

**Status:** Draft, supersedes [v0.1](./ARCHITECTURE.md). Resolves the ten critical risks raised in [RISKS.md](./RISKS.md) at the architecture level and pre-decides the §5a ADR pack so module work can land. Research current as of May 2026.

**Author:** levytskyy@gmail.com, synthesised with Claude Code (5 parallel research agents covering data/multi-tenancy, telephony, messaging/workflow, stack, and module gaps).

**Change summary** (full audit in §13):

1. **Tenant isolation is now multi-layer**, not a single GUC: `BEGIN; SET LOCAL` + Supavisor + `FORCE ROW LEVEL SECURITY` + non-owner runtime role + `BEFORE INSERT` audit-log tenant trigger. Cross-tenant *write* tests added to the compliance suite.
2. **Telephony HA claims are honestly bounded**: no in-flight call survival on Kamailio node failure (no industry pattern attempts it); new-call recovery within 30 s is the contract.
3. **TURN is in MVP**: self-hosted coturn pair per region on dedicated VMs. The PRD's "v1.x deferred" stance produced silent failure for 10–25 % of corporate endpoints; v0.2 ships it.
4. **Compliance is a module, not a cross-cutting hope**: new **M26 Compliance Workflows** owns the HIPAA × GDPR × PCI overlap sagas (erasure, portability, tenant deletion, legal hold). Runs on **Temporal Cloud** (HIPAA-BAA available since Feb 2026).
5. **Reports get an owner**: new **M27 Reports**, Cube.dev semantic layer + custom React renderer.
6. **CSV bulk import gets an owner**: new **M28 BulkImport**.
7. **Stack adjustments**: Drop `fast-xml-parser` for output (use `xmlbuilder2` + golden fixtures). Add `TanStack Router`. Add `@horizon-republic/nestjs-jetstream` + `nestjs-temporal-core`. Replace `FCM/APNS` with **AWS End User Messaging Push** (HIPAA-eligible) — content-less payloads only. Asterisk pinned to **22.9.x LTS**.
8. **ARI is rewired** around Asterisk-22 Outbound WebSockets + fencing-token leader election + 5 s reconciliation poll. Lost-event class of failure is closed.
9. **Sprint 0 ADR pack is the formal entry gate** — 12 ADRs must be merged before any module ships code.

---

## 1. Architecture principles

Two new principles capture the lessons of the v0.1 risk review.

| # | Principle | Implication |
|---|-----------|-------------|
| P1 | **Contracts first** | OpenAPI 3.1 + AsyncAPI 3.0 + JSON Schema files live in `/contracts/` and are PR-reviewed before module work starts. Mock servers (Prism/MSW) come from these specs. |
| P2 | **Bounded contexts = modules** | A module owns its DB tables (no cross-module SQL joins), publishes events on NATS, exposes HTTP/RPC via its OpenAPI block. Cross-module access is *only* via published contracts. |
| P3 | **Tenant ID is sacred — defense in depth** | Every table has `tenant_id` enforced by Postgres RLS *and* (for sensitive tables) a `BEFORE INSERT` trigger that asserts `NEW.tenant_id = current_setting('app.tenant_id')::uuid`. Every connection runs `SET LOCAL` in a transaction. Runtime role is non-owner and not `BYPASSRLS`. |
| P4 | **Two API surfaces, one domain** | `/v1` (TAS-compat XML/JSON) and `/api/v2` (modern JSON) are both first-class facades over the *same* domain services. |
| P5 | **Side effects through workers with durability tiers** | HTTP requests do not send SMS/email/recordings inline; they enqueue work. **Tier 1** (≤ 1 h, cancel-able, single-step): BullMQ. **Tier 2** (hours-to-days, compensable, multi-step, signal-driven): Temporal. **Tier 3** (compliance-bearing event fanout): NATS JetStream with `sync_interval=always`. |
| P6 | **Stub all external deps in dev** | KMS, SIP trunk, SMS, email, push, calendar, CRM, Temporal — every external dependency has a local stub. `docker compose up` boots the whole product. |
| P7 | **Compliance is a build-time check + a runtime owner** | RLS policies, audit triggers, encryption-at-rest, no-PHI-in-SMS — enforced by lints, schema constraints, and integration tests. Cross-framework workflows (erasure, deletion, portability) are owned by M26. |
| P8 | **TDD per module** | Red → green → refactor at the slice level. Each module ships with unit + contract + integration tests gated in CI. No module merges without its test pyramid. |
| **P9** | **Stateless edge + reconciliation over heroic state replication** *(new)* | Kamailio, rtpengine, and ARI consumers do not attempt to replicate per-call state. Failover routes *new* traffic; in-flight legs may drop. Reconciliation loops (every 5–30 s) repair drift between sources of truth (Asterisk channels vs Postgres Call rows). |
| **P10** | **Cross-framework compliance is a workflow, not a transaction** *(new)* | HIPAA × GDPR × PCI conflicts (e.g. 7-year retention vs Art. 17 erasure) are durable workflows with explicit conflict policy, legal-hold checkpoints, and human-or-automatic compensations. They live in M26, run on Temporal, and write to the audit log at every step. |

---

## 2. Macro topology

Changes from v0.1: **Caddy** edge for tenant custom domains; **coturn** pair per region for symmetric-NAT relay; **Supavisor** in front of Postgres; **Temporal Cloud** alongside BullMQ; **AWS End User Messaging Push** in place of direct FCM.

```
            ┌──────────────────────────────────────────────────────────┐
EDGE PLANE  │   Kamailio SBC (active-active, stateless, hash on        │
(SRE-owned) │     Call-ID for dispatcher stickiness)                   │
            │   rtpengine (kernel forward, DTLS-SRTP/ICE)              │
            │   coturn pair / region (UDP-friendly VMs, NOT k8s)       │
            │   Caddy (on-demand TLS for tenant custom domains)        │
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
            │  MixMonitor → emptyDir   │    │    leader (Redis lock    │
            │  → uploader sidecar      │    │    + fencing token)      │
            └──────────────────────────┘    │  - BullMQ workers        │
                          │                 │  - Temporal workers      │
                          ▼ NATS JetStream  └──────────────────────────┘
                  ┌───────────────────────────────────────────┐
DATA PLANE        │  Supavisor → Postgres (Patroni)           │
                  │  Redis  NATS JetStream (sync_interval=    │
                  │    always for compliance streams)         │
                  │  S3/MinIO recordings (SSE-KMS Bucket Keys)│
                  │  KMS (Vault dev / AWS KMS prod, per-tenant│
                  │    CMKs + encryption-context tenant_id)   │
                  │  Temporal Cloud (HIPAA BAA)               │
                  └───────────────────────────────────────────┘
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
PLANE       │ AWS End User Messaging Push (HIPAA-BAA)           │
            │ Calendar (Google/MS365) │ CRM │ Stripe │ Homer    │
            │ LiveKit SIP bridge (v1.x, for AI/inbound only)    │
            └───────────────────────────────────────────────────┘
```

---

## 3. Role-to-module map

Two new pillars (Compliance, Analytics) split out of v0.1's overloaded ownership.

| Role pillar | Owns |
|---|---|
| **Platform / SRE** | Kamailio config, rtpengine, **coturn**, **Caddy edge**, K8s/Compose manifests, Patroni, **Supavisor**, Redis, NATS, **Temporal worker fleet**, observability stack, CI/CD |
| **Telephony backend** | Asterisk 22 dialplan, PJSIP realtime schema, ARI Outbound-WS bridge module, MixMonitor → emptyDir → uploader sidecar |
| **Domain backend** | NestJS bounded-context modules (M01-M15) |
| **API surface backend** | M25: `/v1` XML+JSON facade (xmlbuilder2 + fixtures), `/api/v2` OpenAPI facade, webhook delivery |
| **Integration backend** | M19-M24: SMS/Email/Push (AWS EUM)/Webhook/Calendar/CRM adapters |
| **Frontend — Console** | F03 Operator Console (SIP.js, multi-line state machine, screen-pop, form runner) |
| **Frontend — Admin & Supervisor** | F04 Admin, F05 Supervisor (incl. dispatch dashboard), packages/ui |
| **Frontend — Portal** | F06 Client Portal, white-label, recording playback, embedded report widgets |
| **Compliance & Security** *(new pillar)* | M02 Identity, **M26 Compliance Workflows**, X01-X04, X10, KMS/KEK rotation, PCI redaction worker, tenant-deletion sagas |
| **Analytics** *(new pillar)* | **M27 Reports**, Cube.dev semantic layer, report renderer pipeline |
| **QA / SDET** | Contract tests (Pact), SIPp scenarios, Playwright E2E, load harness, golden-fixture XML diffs |

---

## 4. Module catalogue

### 4.1 Domain backend modules

(Same M01-M15 as v0.1; deltas only.)

| # | Module | Owns (tables) | Notes |
|---|---|---|---|
| **M01** | **Tenancy** | `tenant`, `tenant_kek_ref`, `tenant_feature_flag`, `branding`, **`tenant_custom_domain`** (custom-domain SNI verification), **`tenant_compliance_policy`** (precedence_rule: `hipaa_wins` \| `gdpr_wins` \| `pseudonymise_until_retention_expires`) | Custom-domain TLS via Caddy on-demand (§7) |
| **M02** | **Identity & Auth** | `user`, `role_assignment`, `mfa_secret`, `oauth_client`, `pat`, `refresh_token` | Argon2id with two-layer cache (in-process LRU + Redis L2), 60 s TTL, HMAC-keyed, pub/sub invalidation on password change (§5 ADR-07) |
| M03 | Client Accounts | (unchanged) | |
| M04 | Contacts & Message Actions | (unchanged) | |
| M05 | Custom Forms | `form`, `form_version` (immutable), `field_def` — **field defs may carry `x-computed: <JSONLogic>` for derived fields** | Computed fields evaluated identically client + server (§5 ADR-11) |
| **M06** | **Calls (CDR+)** | unchanged + **`call_reconciliation_log`** (reconciliation loop findings) | ARI Outbound-WS leader + 5 s reconciliation loop closes orphaned calls (§5 ADR-02) |
| M07 | Messages | unchanged | Implements `MessageService.redact(messageId, jsonPath[])` for M26 |
| **M08** | **Dispatch** | unchanged | Consumes `packages/templates` (owned by M19) |
| M09 | On-Call Scheduling | unchanged + materialised `otas_shift` view (closes FR-S5 gap) | Coverage-gap event consumed by M15 (live) + M27 (digest); §4.4 fan-out, no new module |
| **M10** | **Recording & Redaction** | unchanged + **`recording_object`** (`s3_key, wrapped_dek, kek_alias, kek_version_id`) | Per-object `kek_version_id` enables two-version reads during rotation (§5 ADR-09). MixMonitor → emptyDir → uploader sidecar (no NFS, no s3fs). |
| M11 | Tasks/Reminders/Notices/News | (unchanged) | |
| M12 | Tenant→Client Billing | (unchanged) | Surfaces line items to M27 Reports via Cube model |
| M13 | SaaS (Stripe) Billing | (unchanged) | |
| M14 | Audit & Compliance Log | `audit_log` (monthly partitioned via `pg_partman` — raw SQL alongside Prisma) | **`BEFORE INSERT OR UPDATE` trigger** asserts `NEW.tenant_id = current_setting('app.tenant_id')::uuid` (§5 ADR-03). Outbox jobs encode `tenant_id` and re-establish `SET LOCAL` on the first SQL of the worker. |
| **M15** | **Supervisor Live State** | `operator_presence` (Redis projection), `coach_session` | **Server is source of truth** for operator state (§4.4 worked decision). Owns `Available`, `OTAS`, `Wrap`, `Offline`; F03 owns intent states `Break`/`Lunch`/`Training`. |

### 4.1a New domain modules

| # | Module | Owner | Owns / Inbound / Outbound |
|---|---|---|---|
| **M26** | **Compliance Workflows** *(new)* | Compliance & Security | **Owns**: `compliance_request`, `compliance_step`, `legal_hold`, `pseudonym_map` (stored in a separate Postgres schema encrypted under a dedicated per-tenant KMS key — destroying the key crypto-shreds the map). **Inbound**: `/v1/compliance/erasure`, `/portability`, `/tenant-deletion`, `/legal-hold`; subscribes to `tenant.flagged_for_deletion`, `dpo.request.created`. **Outbound** (application services only): `M07.MessageService.redact`, `M10.RecordingService.bleepAndTombstone`, `M14.AuditService.append`, `M19.SmsService.purgeConversation`, `M21.PushService.tombstoneDevice`, `M01.KmsService.scheduleKeyDeletion`. **Runs on Temporal Cloud (HIPAA BAA)**. Default policy for healthcare-tagged tenants: `pseudonymise_until_retention_expires` — pseudonymise PHI in JSONB + bleep PII spans in audio (forced-aligned transcript timestamps), then destroy the `pseudonym_map` row (irreversible under GDPR Recital 26). Pure-GDPR tenants get hard-delete. **Events**: `compliance.request.{created,step.completed,step.failed,completed,aborted}`, `compliance.legal_hold.activated`, `compliance.kms.dek_destroyed`. |
| **M27** | **Reports** *(new)* | Analytics | **Owns**: `report_definition` (slug, scope=`tenant\|portal\|admin`, `cube_query_jsonb`, `viz_config_jsonb`, version), `report_schedule`, `report_run`, `report_subscription`. **Inbound**: `/v1/reports`, `POST /v1/reports/{id}/run`, `GET /v1/reports/{id}/runs/{runId}` (signed download). Subscribes to `cron.tick`, `billing.cycle.closed`, `otas.gap_detected` (daily coverage-gap digest). **Outbound**: queries read-replica via **Cube.dev** (JWT-signed `securityContext={tenant_id}`); PDF rendered by headless Chrome on capped BullMQ queue; CSV/XLSX streamed from Cube SQL API. **30+ seed report_definitions** ship (call volume by DID, ASA, dispatch SLA, on-call coverage gap, billing line-item, after-hours, abandonment, transfer rate, …). Renderer = React in F04/F05/F06 (no iframe, no watermark). |
| **M28** | **BulkImport** *(new)* | Domain backend | **Owns**: `import_job`, `import_row_error`. **Inbound**: `POST /v1/imports` (multipart → S3 staging), `GET /v1/imports/{id}/preview`, `POST /v1/imports/{id}/mapping`, `POST /v1/imports/{id}/commit`. Mapping is `{source_col → target_field, transform?: <JSONLogic>}` + `target_entity` + `dedupe_key_expr`. **Idempotent re-import** via `INSERT … ON CONFLICT (tenant_id, dedupe_key) DO UPDATE`. Errors download as CSV of failed rows. **Outbound**: target modules' application services. |

### 4.2 Telephony & integration backend modules

| # | Module | Public contract |
|---|---|---|
| **M16** | **Telephony Control Plane** | **ARI Outbound WebSockets** (Asterisk 22) — Asterisk-initiated, persistent, configurable reconnect. NestJS leader holds Redis lock (TTL 15 s, heartbeat 5 s) + **monotonic fencing token** (Redis `INCR`) validated on every ARI write — rejects writes if token < current (zombie-leader protection). **Reconciliation loop**: every 5 s, diff `GET /channels` + `GET /bridges` against open Call/Bridge rows; close orphans; re-subscribe after WS reconnect. NATS subjects `telephony.event.*`; RPC `telephony.command.{originate,spy,transfer,pause_record}`. |
| **M17** | **PJSIP Realtime Schema** | Asterisk 22 **stale-cache** mode (`object_lifetime_stale=30`, `object_lifetime_max=3600`) + AMI `SorceryMemoryCacheExpireObject` invoked by NestJS on every tenant-config write (never `pjsip reload`). **Object naming convention**: `t{tenant_uuid_short8}_{local_id}` enforced at provisioning. Cross-tenant feature contexts isolated; PCI `*7`/`*8` codes bound to per-tenant `[macro-tenant-{id}]` contexts. |
| **M18** | **Asterisk Dialplan + IVR** | Lua/AEL dialplan; per-tenant context; PCI pause feature codes (per-tenant context); delegated-capture redirect (Telnyx Pay / Stripe Terminal IVR). **PCI MVP scope**: pause+redact ships, but the `delegated_pci_capture` feature flag turns on a Telnyx-Pay handoff IVR; ADR-04 mandates QSA pre-confirmation of SAQ-D before HIPAA-PCI overlap tenants onboard. |
| **M19** | **SMS Adapter + Templates** | Port `SmsSender`. Drivers: Twilio, Telnyx, Bandwidth, stub. **Now owns `packages/templates`** (Handlebars for text/SMS, MJML → HTML for email, JSON-mustache for webhook bodies). Templates are versioned (`(template_id, template_version)` carried in saga payloads). DLR webhook ingress `/integrations/sms/dlr/{provider}`. |
| **M20** | **Email Adapter** | Port `EmailSender`. Drivers: SES, SendGrid, SMTP, stub (Mailpit in dev). **Open-tracking webhook** at `/integrations/email/event/{provider}` (closes FR-D2 gap). |
| **M21** | **Push Adapter** | Port `PushSender`. **Provider: AWS End User Messaging Push** (HIPAA-eligible under AWS BAA; replaces direct FCM). **Content-less push payload only** — title `"New message"`, badge, deep-link to portal; PHI fetched via authenticated `GET /v1/messages/:id` from the mobile app. **OneSignal HIPAA** wired as secondary provider for redundancy. Web push (VAPID) for portal users in MVP. |
| **M22** | **Webhook Delivery** | (unchanged from v0.1) HMAC-SHA256, at-least-once, exponential backoff, signed timestamps, replayable. |
| **M23** | **Calendar Adapter** | (unchanged from v0.1) Google + Microsoft 365 OAuth2, read-only MVP. |
| **M24** | **CRM Adapter** | (unchanged from v0.1) Outbound only; `/v1` is the inbound surface for CRMs. |
| **M25** | **REST API Facade (`/v1` + `/api/v2`)** | **XML output via `xmlbuilder2`** (insertion-order-preserving `.ele()` chain) + **byte-for-byte golden fixtures** captured from the running TAS reference (round-trip diff in CI per endpoint). `fast-xml-parser` reserved for *parsing* inbound XML only. OpenAPI 3.1 emitted from NestJS decorators + Zod schemas. |

### 4.3 Frontend modules

Stack pinned for May 2026: **React 19 + Vite + TS + TanStack Router + TanStack Query v5 + Zustand + React Hook Form + Tailwind + Radix + shadcn/ui + MSW + Storybook 8 + Playwright**. Mobile operator shell: **Expo + react-native-callkeep** (CallKit integration to survive iOS background-tab WebRTC suspension).

| # | Module | Notes |
|---|---|---|
| F01 | `packages/ui` — design system | (unchanged from v0.1) + shared `<DispatchTicketList />` (embedded into F06 portal read-only) |
| F02 | `packages/sdk-v2` | OpenAPI-generated client (`orval`) + React Query hooks |
| **F03** | `apps/web-console` — Operator Console | **Multi-line state machine = xstate**, but treats M15 as source of truth. F03 publishes user-intent transitions (`requestBreak`, `goAvailable`, `wrapDone`); M15 broadcasts authoritative state via WS. F03 holds wake-lock + "stay-on-screen" UX to keep Safari foreground. SIP.js wrapper, screen-pop subscriber, form runner with JSONLogic computed fields. |
| F04 | `apps/web-admin` | Tenant admin, billing schemes, branding, templates editor, **bulk-import wizard** (M28), **compliance-request inbox** (M26 read-side) |
| **F05** | `apps/web-supervisor` | Live operator grid (WS), queue health, listen/whisper/barge, QA tagging, **dispatch dashboard** (FR-D10 closed — F05 owns it; F06 gets read-only embedded subset), coverage-gap banner |
| F06 | `apps/web-portal` — Client Portal | Per-tenant subdomain or **custom domain (Caddy on-demand TLS)**; inbox, recording playback (signed URLs), on-call self-service, **embedded reports** (M27), cookie banner |
| F07 | Form Designer | (unchanged from v0.1) + JSONLogic expression builder for `x-computed` fields |

### 4.4 Cross-cutting modules

| # | Module | What it provides |
|---|---|---|
| **X01** | **Identity context propagation** | NestJS interceptor: validates JWT/Basic, resolves tenant + user + roles, opens a Postgres transaction and runs `SELECT set_config('app.tenant_id', $1, true)` (the boolean `true` means LOCAL). **Same interceptor wraps `/v1` Basic Auth.** BullMQ + Temporal workers' first SQL statement re-runs `set_config` from the job payload — no inheritance from request scope. |
| **X02** | **KMS / envelope encryption** | `KekService` (per-tenant CMK in Vault/AWS KMS, alias `alias/tenant-<uuid>`), `DekService` with **encryption context `{tenant_id, object_class}`** (authenticated additional data — mismatch fails decrypt). Wrapped DEKs in Postgres `recording_object` table, **never in S3 metadata**. Two-version read window (`kek_version_id`) supports concurrent rotation. Rotation = background `re_wrap_dek` Temporal workflow that atomically updates row + S3 SSE-KMS object — playback never blocks. **S3 Bucket Keys** enabled for cost. **ABAC IAM**: `aws:PrincipalTag/tenant_id` must match `kms:EncryptionContext:tenant_id`. |
| **X03** | **RLS policy library** | Generated SQL policies per table; CI lint asserts every new table has a policy *and* `FORCE ROW LEVEL SECURITY`. `psql` test fixtures verify cross-tenant **reads AND writes** (the v0.1 fixtures only covered reads). Migration role is the only `BYPASSRLS` holder. Runtime role is non-owner. Outbox publisher role is a separate `BYPASSRLS` role scoped via grants to the outbox table only. |
| **X04** | **Audit decorator + trigger** | `@Audited({ entity, action })` NestJS decorator captures before/after JSON via class-transformer; writes to M14 via outbox. **Defense in depth**: `audit_log` has a `BEFORE INSERT OR UPDATE` trigger asserting `NEW.tenant_id = current_setting('app.tenant_id')::uuid`. |
| **X05** | **Observability** | OpenTelemetry SDK in NestJS + frontends; Prometheus exporters in Asterisk (`res_prometheus`), Kamailio (`xhttp_prom`), rtpengine, **coturn**, **Caddy**; Tempo for traces; Loki for logs; Homer (HEPv3) for SIP capture; Grafana dashboards as code. **SIP→span propagation**: §5 ADR-10. |
| **X06** | **DB schema & migrations** | **Prisma 6 + raw-SQL files** for partitioning (`pg_partman` invoked from `prisma migrate`). `migration_lock.toml` enforces ordering. RLS policies versioned alongside. Forbids `prisma migrate` from touching partitioned tables (`@@map` external markers). |
| X07 | **Feature flags** | OpenFeature SDK + Unleash backend; tenant-scoped flag evaluation. Used for `delegated_pci_capture`, `coturn_force_relay`, `report_engine_v2`, … |
| **X08** | **Job queue + workflow infrastructure** | **Three tiers (P5)**: BullMQ on Redis (≤ 1 h delayed/cron — escalation timers, reminder fires, S3 lifecycle audit, report-render queue); **Temporal Cloud** (hours-to-days, signal-driven, compensable — compliance sagas, KEK rotation, tenant-deletion); **NATS JetStream** with `sync_interval=always` for compliance streams (audit, dispatch, recording-upload events) — R=3 default, R=5 for unrecoverable. Outbox = polling worker (v1) → logical replication (v2, when > 1k msg/s). |
| **X09** | **SIP capture / Homer** | (unchanged from v0.1) HEPv3 mirror from Kamailio + rtpengine; 30-day retention for EU tenants. |
| **X10** | **Compliance test suite** | Contract tests: no PHI in SMS adapter payloads; `audit_log` partition rotation drill; cross-tenant probe (**READ and WRITE**); recording-playback signed-URL expiry; PCI redaction silence-overwrite verification; **fencing-token zombie-leader test** (slow leader keeps writing while replacement takes lock); **Temporal saga drill** (erasure across M07/M10/M14 with simulated S3 retention violation). Runs nightly + on tagged release. |

---

## 5. Decisions resolved up-front (Sprint 0 ADR pack)

These 12 ADRs MUST be merged before any module work. Each becomes a file in `docs/adr/`. References are to the May-2026 research that backs the call.

| ADR | Decision | Rationale (short) |
|---|---|---|
| **ADR-01 — RLS enforcement** | `BEGIN; SET LOCAL app.tenant_id = $1; …; COMMIT;` mandatory. Pooler = **Supavisor** (transaction mode). All tenant-scoped tables get `ALTER TABLE … FORCE ROW LEVEL SECURITY`. Runtime role is non-owner; migration role is the only `BYPASSRLS` holder. Outbox publisher role has `BYPASSRLS` scoped to `outbox` table only. CI lint forbids `SET` without `LOCAL`. CI fixture verifies cross-tenant **WRITE** is rejected. | Closes RISKS C1. Prisma docs warn statement-mode pooling breaks GUC; transaction-mode `SET LOCAL` survives. [Bytebase RLS footguns](https://www.bytebase.com/blog/postgres-row-level-security-footguns/), [Crunchy Data RLS for tenants](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres). |
| **ADR-02 — ARI leader election** | Asterisk 22 **Outbound WebSockets** (Asterisk-initiated, persistent). One NestJS leader per Asterisk node via Redis lock, TTL **15 s**, heartbeat **5 s**, **monotonic fencing token** (Redis `INCR`) validated on every ARI write — server rejects out-of-order tokens. **Reconciliation loop every 5 s** diffs `GET /channels` against open Call rows; orphans closed; subscriptions re-established after WS reconnect. | Closes RISKS C2. Asterisk does not buffer events; reconciliation is the only correct pattern. [Asterisk ARI Outbound WS docs](https://docs.asterisk.org/Configuration/Interfaces/Asterisk-REST-Interface-ARI/ARI-Outbound-Websockets/). |
| **ADR-03 — Audit-log tenant integrity** | `audit_log_tenant_guard()` `BEFORE INSERT OR UPDATE` trigger raises if `NEW.tenant_id ≠ current_setting('app.tenant_id')::uuid`. Outbox jobs carry `tenant_id`; worker re-runs `SET LOCAL` before any SQL. `audit_log` is monthly-partitioned via `pg_partman`. RLS policy uses the same GUC; UPDATE/DELETE policies deny. | Closes RISKS S5. CHECK constraints cannot reference `current_setting()`; trigger is the only enforcement. |
| **ADR-04 — TURN posture (MVP)** | **Self-hosted coturn**, 1 active-active pair per region, on dedicated VMs (not k8s — CNIs are UDP-port-range hostile). rtpengine handles ICE between SBC and clients; coturn handles symmetric-NAT relay. Cloudflare Realtime TURN deferred until they ship a BAA. Cost target: ~$200/mo per pair vs Twilio NTS $0.40+/GB. **Failed-ICE rate dashboard + alert on day 1**. | Closes RISKS C3. 10–25 % of corporate endpoints behind symmetric NAT; STUN-only fails silently. [WebRTC Developers — coturn the fragile colossus](https://www.webrtc-developers.com/coturn-the-fragile-colossus/), [Cloudflare Realtime pricing](https://developers.cloudflare.com/realtime/sfu/pricing/). |
| **ADR-05 — PCI MVP scope** | MVP ships pause+redact (current path) **AND** delegated capture behind feature flag `delegated_pci_capture` (Telnyx Pay handoff IVR). HIPAA-PCI overlap tenants gated behind QSA-confirmed SAQ-D sign-off. Redaction timestamps sourced from **Asterisk CEL sample counts**, not NestJS wall-clock. X10 tests pause-at-first-500 ms, rapid toggling, open-ended interval (call ends mid-pause). | Closes RISKS C4. SAQ-D scope without delegated capture is a single-control posture; flag preserves an escape hatch. |
| **ADR-06 — Compliance orchestration module (M26)** | New module **M26 Compliance Workflows** owns multi-step sagas across M07/M10/M14/M19/M21/S3/KMS: erasure, portability (GDPR Art. 20), tenant deletion (grace + legal-hold signal), KEK rotation. Runs on **Temporal Cloud** (HIPAA BAA since Feb 2026). Per-tenant precedence rule: `pseudonymise_until_retention_expires` (default for healthcare) \| `hipaa_wins` \| `gdpr_wins`. Pseudonymisation = JSONB redact + audio bleep at forced-aligned PII spans + destroy `pseudonym_map` row (irreversible per GDPR Recital 26). Library: **`nestjs-temporal-core`**. | Closes RISKS C5. [Temporal HIPAA announcement](https://temporal.io/blog/temporal-cloud-is-now-hipaa-compliant), [BuildPilot 2026 saga comparison](https://trybuildpilot.com/610-trigger-dev-vs-inngest-vs-temporal-2026). |
| **ADR-07 — Argon2id verification caching** | Two-layer cache: in-process LRU (`lru-cache`, ~10 k entries) + Redis L2. TTL **60 s** default, **300 s** per-tenant configurable. Cache key = `HMAC-SHA256(serverSecret, tenantId || ':' || username || ':' || sha256(password).slice(0,16))`. Invalidation = Redis pub/sub `auth:password-changed:{tenant}:{user}` drops L1 + L2. Never log the key. | Closes RISKS C9. Argon2id @ OWASP params = 300–700 ms/verify; arithmetically incompatible with 100 RPS @ 200 ms p95 without a cache. |
| **ADR-08 — PJSIP cache + naming** | Asterisk 22 **stale-cache** (`object_lifetime_stale=30`, `object_lifetime_max=3600`). NestJS calls AMI `SorceryMemoryCacheExpireObject` after every tenant-config write (avoid `pjsip reload` which stalls all lookups). Object naming **`t{tenant_uuid_short8}_{local_id}`**. PCI feature codes (`*7`/`*8`) bound to per-tenant `[macro-tenant-{id}]` contexts. X10 SIPp test: `*7` from Tenant A cannot mute Tenant B. | Closes RISKS C10. [Asterisk Sorcery Caching docs](https://docs.asterisk.org/Fundamentals/Asterisk-Configuration/Sorcery/Sorcery-Caching/). |
| **ADR-09 — Envelope encryption + KEK rotation** | Per-tenant CMK `alias/tenant-<uuid>`. Every encrypt/decrypt carries **encryption context `{tenant_id, object_class}`** (authenticated additional data). Wrapped DEKs live in Postgres `recording_object(s3_key, wrapped_dek, kek_alias, kek_version_id)` — **not in S3 metadata**. Two-version read window (`kek_version_id`). Rotation = Temporal workflow that atomically re-wraps DEKs row-by-row; S3 object never moves. ABAC IAM: `aws:PrincipalTag/tenant_id` must match `kms:EncryptionContext:tenant_id`. S3 **Bucket Keys** on. **S3 Object Lock = governance mode only** (compliance mode cannot satisfy Art. 17 erasure). | Closes RISKS S4, S6. [AWS KMS rotation guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/aws-kms-best-practices/data-protection-key-rotation.html), [AWS multi-tenant KMS strategy](https://aws.amazon.com/blogs/architecture/simplify-multi-tenant-encryption-with-a-cost-conscious-aws-kms-key-strategy/). |
| **ADR-10 — OTel trace propagation through SIP** | Kamailio's `carrier.cfg` injects `X-Trace-Context` SIP header (W3C `traceparent` format) on inbound INVITE, minting a root span if absent. Asterisk dialplan lifts header into **inherited channel variable `__TRACEPARENT`** (double underscore propagates to bridged children). NestJS ARI listener picks up via `ChannelVarset` event and calls OTel's `W3CTraceContextPropagator.extract()` to build the span context. No IETF draft registers a SIP-side trace header in 2026; revisit if one appears. | Closes RISKS gap. [W3C Trace Context](https://www.w3.org/TR/trace-context/). |
| **ADR-11 — Computed-field DSL** | **JSONLogic**. Isomorphic (browser + NestJS + via `plv8` if needed in Postgres), deterministic, sandboxed by construction (no setters/loops/side-effects). Embedded in JSON Schema field defs as `"x-computed": <expression>` vendor extension. Server **re-evaluates on submit and rejects mismatches** to defeat client tampering. Custom operators (date math, phone normalisation) in a single `@tas/jsonlogic-ext` package shared client+server. | Closes RISKS FR-F2 gap. [JSONLogic spec](https://jsonlogic.com/). |
| **ADR-12 — Custom-domain TLS** | **Caddy on-demand TLS** as the edge for tenant portal traffic. `ask` endpoint in M01 validates SNI against `tenant_custom_domain.verified=true` before Caddy completes the ACME challenge. Caddy cert cache backed by Redis storage plugin (cluster-wide). cert-manager retained for platform's own wildcards, internal mTLS, SIP TLS. Step-ca rejected (internal PKI only). | Closes RISKS S11. [Caddy on-demand TLS at scale](https://caddy.community/t/millions-of-domains-across-multiple-servers-with-on-demand-tls/24916). |

### 5a. Carry-over decisions (still good from v0.1)

| Question | v0.1 → v0.2 |
|---|---|
| ORM | **Prisma 6** *(kept)* — partitioning via raw SQL alongside Prisma migrations; revisit Drizzle only if RLS becomes the dominant access pattern. |
| Job queue | **BullMQ on Redis** *(kept, scoped)* — Tier 1 jobs only (≤ 1 h). Temporal owns Tier 2. NATS JetStream owns Tier 3. |
| Monorepo tooling | **pnpm workspaces + Turborepo 2** *(kept)* |
| `/v1` XML library | **`xmlbuilder2` + golden-fixture round-trip tests** *(changed — was `fast-xml-parser` for output)*. fast-xml-parser stays for *parsing* inbound XML. |
| Form Designer engine | **JSON Schema (draft 2020-12) + JSONLogic `x-computed` extension** *(extended)*. Custom builder UI in `packages/form-designer`; renderer in `packages/ui`. |
| KMS in MVP | **Vault dev mode (local), AWS KMS prod** *(kept)*; per-tenant CMK; encryption-context binding (ADR-09). |
| TURN/coturn | **Self-hosted coturn pair per region in MVP** *(changed — was "deferred to v1.x")*. |
| Stream backbone | **NATS JetStream** *(kept, hardened)* — `sync_interval=always` for compliance streams; `@horizon-republic/nestjs-jetstream` (the `@nestjs/microservices` NATS transport is core-NATS only, do not use). |
| Push provider | **AWS End User Messaging Push** *(changed — was FCM/APNS)*. Content-less payloads only; OneSignal HIPAA tier as secondary. |
| Asterisk version | **22.9.x LTS** — avoid `chan_websocket` ExternalMedia at > 90 concurrent calls (reported audio distortion); standardise on ARI for call control. |

### 5b. Open questions, scoped

(Reduced from v0.1; the live unresolved list.)

- **Form Designer UX shape** — design pass needed before F07 starts.
- **Reports definition catalogue** — 30+ seed reports must be specified before M27 builds renderer (admin can clone+edit, but defaults need product input).
- **Hyperlink-token grammar** (`[Dial:…]`, `[Search:…]`, `[Client:…]`, `[Contact:…]`) — F03 needs the dispatch wiring spec before multi-line state machine completion.
- **Toll-fraud monitor (NFR-S13)** — sliding cost-per-minute window per tenant in Redis; owner = X10 Compliance test suite + a small worker in M16. Spec needed before SIP trunk goes live.

### 5c. PRD-side changes flagged for the product owner

These need PRD updates, not architecture changes:

- **NFR-A2 / NFR-A4** wording softened: "new calls route to a healthy node within 30 s; in-flight legs may drop." Industry pattern.
- **NFR-A5** wording softened: RPO ≤ 5 min (with sync replication off) or RPO ≤ 1 min (with sync replication on, accepting the write-latency hit).
- **AC §12 #3** push channel: clarified to "AWS End User Messaging Push with content-less payload" so HIPAA tenants are covered in MVP.
- **NFR-S10** wording extended: "No PHI in **non-secure SMS body or push payload** — only pointer."
- **AC §12 #13 Documentation** explicitly allocated to Platform/SRE pillar with sprint-15 milestone.

---

## 6. Contract-first toolchain

(Unchanged in spirit from v0.1; one addition.)

```
/contracts/
  openapi/
    v1.TAS.yaml         ← hand-curated (TAS parity, frozen)
    v2.api.yaml           ← generated from NestJS @nestjs/swagger + Zod schemas
  asyncapi/
    telephony.yaml        ← NATS subjects, payload schemas
    domain-events.yaml    ← message.saved, dispatch.sent, etc.
    compliance.yaml       ← NEW. M26's Temporal-workflow event surface.
  temporal/
    workflows/*.ts        ← NEW. Workflow + activity signatures (Temporal Cloud import path).
  schemas/
    form-definition.schema.json   ← JSON Schema 2020-12 + x-computed (JSONLogic)
    audit-event.schema.json
    webhook-payload.schema.json
    template.schema.json          ← NEW. packages/templates payload schema.
  examples/
    *.json
  fixtures/
    v1-xml/                       ← NEW. byte-for-byte captured TAS responses for round-trip diff.
```

Tooling: Spectral, Prism, MSW, Pact, SchemaThesis, AsyncAPI generator (unchanged). Add **`xml-fixture-diff`** (custom — diffs `xmlbuilder2` output against `/contracts/fixtures/v1-xml/*` per endpoint) in CI for M25.

---

## 7. Per-module TDD strategy

Unchanged from v0.1's pyramid. One addition: **Temporal workflow tests** sit between contract and integration layers.

| Layer | Tool | Per-module example (Compliance M26) |
|---|---|---|
| Unit | Vitest | Pseudonymisation function on a sample form payload produces JSON with names replaced by surrogates. |
| Contract | Pact + AsyncAPI validator | `compliance.request.completed` payload matches AsyncAPI schema; Temporal activity signatures match `/contracts/temporal/`. |
| **Workflow** *(new)* | `@temporalio/testing` | Erasure workflow with simulated S3 retention violation deterministically pseudonymises + emits audit event + destroys pseudonym_map. |
| Integration | Vitest + Testcontainers | End-to-end erasure: API call → Temporal workflow → M07 redacts → M10 bleeps audio → M14 audit row appears → pseudonym_map deleted; cross-tenant probe asserts zero leakage. |
| End-to-end | Playwright / SIPp | Tenant admin clicks "process erasure request" → portal user sees pseudonymised data → audit log shows full chain. |

**Slice TDD discipline** unchanged. **X10 (compliance test suite)** runs nightly + on tagged release. **Zombie-leader fencing-token test** added to X10.

---

## 8. Local-dev story

```bash
docker compose up
# brings up:
#   kamailio (single node, dev cert)
#   rtpengine (host-net mode on Linux; userspace path on macOS — see NFR-M1 caveat)
#   coturn (dev cert, single instance)
#   caddy (on-demand TLS off in dev; static config)
#   asterisk-1 (22.9.x, sipp-emulator sidecar that simulates trunk)
#   supavisor (Postgres pooler, transaction mode)
#   postgres (Patroni single-node)
#   redis
#   nats-jetstream (sync_interval=always for compliance streams)
#   temporalite (single-binary Temporal for local dev — Temporal Cloud in prod)
#   minio (S3-compatible recording storage)
#   vault-dev (KMS stub, in-mem)
#   mailpit (email stub)
#   sms-stub (logs to NATS topic, mounted in /sms-log)
#   push-stub (logs intended AWS End User Messaging calls)
#   prism (mock /api/v2 if backend not running)
#   nestjs-api (watch mode, runs both HTTP + Temporal workers)
#   web-console, web-admin, web-supervisor, web-portal (vite dev servers)
#   grafana + tempo + loki + homer (full obs stack)
```

NFR-M1 honesty: **rtpengine kernel forwarding is unavailable on macOS Docker**. macOS dev uses userspace; CI integration tests run on Linux only to match production. Documented in `docs/local-dev-macos.md`.

`make dev-up` ≤ 15 minutes from clone to working synthetic call (matches AC §12 #14).

---

## 9. MVP delivery sequencing

```
Sprint 0  ── ADR pack + contracts week ─────────────────────────────────
  Two-week gate. ALL 12 ADRs in §5 must merge. Without them, no module
  ships code. Owners: senior architect + telephony eng + security eng.
  In parallel: write OpenAPI, AsyncAPI, JSON Schemas, Temporal workflow
  signatures. ADRs live in docs/adr/. Stand up Prism + Temporal mocks.

Sprint 1-3  ── Foundations (must finish before Milestone A) ────────────
  SRE/Platform:  Docker Compose, Postgres + Patroni + Supavisor, Redis,
                 NATS JetStream (sync_interval=always), Temporal worker
                 fleet, KMS stub, observability, CI pipeline, RLS
                 cross-tenant WRITE test harness, coturn dev pair,
                 Caddy edge config, fencing-token chaos test.
  Security:      M01 Tenancy, M02 Identity (incl. /v1 Basic w/ Argon2id
                 cache + /v2 OAuth), X01-X04, X10 skeleton,
                 audit-log trigger.
  Telephony:     Kamailio (stateless edge), rtpengine, Asterisk 22.9 LTS
                 Model B + Model A, PJSIP realtime + stale-cache + AMI
                 invalidation, ARI Outbound-WS bridge (M16) with
                 fencing-token leader + 5s reconciliation loop, SIPp
                 scenarios.
  FE Admin:      packages/ui, Storybook, packages/sdk-v2 generator,
                 TanStack Router skeleton.
  **Validate NFR-P1 here, not Sprint 12-15.**
  100-concurrent-call profiling on the recording pipeline + Asterisk
  CPU/IO must pass before Milestone A.

────────── Milestone A: "First registered softphone places a call" ──────

Sprint 4-7  ── Core call path ──────────────────────────────────────────
  Domain BE:     M03 Accounts, M04 Contacts, M05 Forms (incl. JSONLogic
                 computed fields), M06 Calls + reconciliation, M07
                 Messages.
  API surface:   M25 /v1 facade (xmlbuilder2 + fixtures) for Users,
                 Calls, Messages, Contacts, Clients, todo;
                 /api/v2 read-side.
  FE Console:    F03 Operator Console — answer, form-fill, save;
                 multi-line xstate driven by M15 server-side state;
                 wake-lock + foreground UX.
  FE Admin:      F04 Accounts/Contacts/Users/DIDs/Branding CRUD,
                 templates editor.
  Telephony:     MixMonitor → emptyDir → uploader sidecar → M10
                 Recording (envelope-encrypt + S3 SSE-KMS upload).
  Integration:   M19 SMS + M20 Email adapters (stubs first, real
                 second), packages/templates.

────────── Milestone B: "Operator answers, fills form, dispatched" ──────

Sprint 8-11  ── Scheduling, Supervisor, Portal, Billing, Compliance ────
  Domain BE:     M08 Dispatch (incl. escalation), M09 Scheduling
                 (incl. WhoIsOTAS single source + coverage-gap
                 emission), M11 Tasks, M12 Tenant→Client Billing,
                 M14 Audit.
  **M26 Compliance Workflows** scaffolded: erasure saga end-to-end on
  Temporal Cloud (HIPAA BAA).
  **M27 Reports** scaffolded with 5 seed report_definitions.
  **M28 BulkImport** scaffolded for contact + on-call CSVs.
  FE Supervisor: F05 live grid + listen/whisper/barge (M15+M16) +
                 dispatch dashboard + coverage-gap banner.
  FE Portal:     F06 inbox, recording playback (signed URLs),
                 on-call mgmt, embedded reports.
  Integration:   M21 Push (AWS End User Messaging — content-less only),
                 M22 Webhook Delivery, M23 Calendar (read-only).
  Security:      PCI redaction worker, delegated-capture redirect (M18),
                 KEK rotation Temporal workflow.

────────── Milestone C: "Tenant onboards, runs a shift, bills" ─────────

Sprint 12-15  ── Hardening + Compliance proof ──────────────────────────
  Load test:    100 concurrent calls × 25 ops × dispatch fanout — re-run
                 against the Sprint 1-3 baseline to detect regression.
  Chaos drills: Asterisk node kill (accept call drops); Kamailio
                 failover (new calls route in ≤ 30 s — no in-flight
                 survival claim); Patroni promotion; NATS partition;
                 ARI fencing-token zombie leader; Temporal worker
                 partition; coturn fail-over; KEK rotation under load.
  Pen test, ASV scan, SAQ-D paperwork w/ QSA sign-off, BAA chain audit
  (AWS, Twilio/Telnyx, Temporal, OneSignal).
  GDPR end-to-end: erasure saga on healthcare tenant under retention;
                 portability export; tenant-deletion w/ legal-hold
                 override.
  Documentation: 4 runbooks (onboarding, operator quick-start, API
                 guide, SRE) shipped as deliverable.

────────── Milestone D: MVP cut ────────────────────────────────────────
```

---

## 10. Worked example: M26 Compliance Workflows (GDPR erasure)

(M08 worked example unchanged from v0.1 — kept for diff reference. New worked example for the new flagship module.)

**Boundary in:**
- `POST /v1/compliance/erasure` — payload: `{subject_type: 'caller'|'contact'|'portal_user', subject_external_id, regulation: 'gdpr', requested_at}`.
- NATS subject `dpo.request.created` — emitted by DPO UI in F04 admin.

**Boundary out (application-service calls only — no foreign DB writes):**
- `M07.MessageService.redact(messageId, jsonPath[])`
- `M10.RecordingService.bleepAndTombstone(recordingId, piiSpans[])`
- `M14.AuditService.append(payload)` — every step appends a row.
- `M19.SmsService.purgeConversation(externalId)`
- `M21.PushService.tombstoneDevice(externalId)`
- `M01.KmsService.scheduleKeyDeletion(pseudonymMapKeyArn, days: 30)`

**Owns:**
- Tables `compliance_request`, `compliance_step`, `legal_hold`, `pseudonym_map` (separate schema, encrypted under a dedicated per-tenant KMS key).
- Temporal workflows: `ErasureWorkflow`, `PortabilityExportWorkflow`, `TenantDeletionWorkflow`, `KekRotationWorkflow`, `LegalHoldEnforcementSignal`.
- BullMQ queues: none — Temporal owns long-running flows. A small `complianceCron:nightly` BullMQ job fires `complianceCronSignal` into long-running Temporal workflows.

**Doesn't own:**
- Doesn't write to `message`, `recording`, `audit_log` directly — calls module APIs.
- Doesn't decide retention policy — reads `tenant_compliance_policy`.

**Conflict resolution (HIPAA × GDPR):**
1. Load `tenant_compliance_policy.precedence_rule`.
2. If `pseudonymise_until_retention_expires` (default healthcare): pseudonymise PHI in JSONB (replace name/MRN/phone with surrogate IDs from `pseudonym_map`), bleep PII spans in audio (forced-aligned transcript timestamps), destroy the `pseudonym_map` row → recording remains under 7-year HIPAA retention as legitimately anonymous data per GDPR Recital 26.
3. If `gdpr_wins`: full hard-delete of message + recording S3 object + KMS key destruction.
4. If `hipaa_wins`: refuse erasure with documented justification; emit `compliance.request.aborted` with reason.

**Saga shape (Temporal workflow):**
```
ErasureWorkflow(request):
  1. assertNotUnderLegalHold(request.subject)              // signal-cancellable
  2. policy = loadCompliancePolicy(request.tenant_id)
  3. messages = findMessages(request.subject)
  4. recordings = findRecordings(request.subject)
  5. for msg in messages:                                  // per-step audit
       activities.M07.redact(msg.id, jsonPath)
  6. for rec in recordings:
       if policy == pseudonymise:
         spans = forcedAlign(rec.transcript, subject.pii)
         activities.M10.bleepAndTombstone(rec.id, spans)
       elif policy == gdpr_wins:
         activities.M10.deleteObject(rec.s3_key)
  7. activities.M19.purgeConversation(request.subject)
  8. activities.M21.tombstoneDevice(request.subject)
  9. await condition(ack from tenant admin) timeout 7d     // grace
 10. activities.M01.scheduleKeyDeletion(pseudonymMapKey, 30d)
 11. emit('compliance.request.completed', {request_id, audit_id})
  compensations on failure: append failure audit + reopen request.
```

**Definition of done:**
- All four test layers green (§7) — including the Temporal `@temporalio/testing` workflow layer.
- AsyncAPI + Temporal-workflow schemas published.
- ADR-06 referenced.
- Compose stack runs end-to-end: erasure request → pseudonymised message visible in F06 portal → audio bleeped → audit chain in M14 → KMS key scheduled for destruction with 30 d hold.

---

## 11. What is not locked down

Smaller list than v0.1 — most v0.1 unresolved items are now ADRs (§5).

- **Form Designer UX shape** — JSONLogic chosen, but the visual builder needs a design pass before F07.
- **Reports definition catalogue** — 30+ seed `report_definition` rows need product input before M27 renders.
- **Operator hyperlink-token grammar** — `[Dial:…]`, `[Search:…]`, `[Client:…]`, `[Contact:…]` — F03 needs the dispatch wiring spec before completion.
- **Toll-fraud monitor (NFR-S13)** — Redis sliding cost-per-minute window per tenant; spec needed before SIP trunk goes live.
- **Hardware SIP phone provisioning (auto-XML)** — accept as v1.x; manual issuance in MVP.

---

## 12. v0.2 changelog vs v0.1 (audit trail)

| Area | v0.1 | v0.2 | Risk closed |
|---|---|---|---|
| **RLS pattern** | "Postgres RLS via session GUC" (one line) | `BEGIN; SET LOCAL` + Supavisor + `FORCE ROW LEVEL SECURITY` + non-owner runtime role + outbox-publisher role with scoped `BYPASSRLS` + cross-tenant WRITE test (X03) | C1 |
| **ARI** | "Redis lock per Asterisk node" (one line) | Asterisk-22 Outbound WS + Redis lock + monotonic fencing token + 5 s reconciliation loop + WS-reconnect re-subscription handler | C2 |
| **TURN** | "deferred to v1.x" | coturn pair per region in MVP + failed-ICE dashboard + alert | C3, R-W02 |
| **PCI** | pause+redact only, delegated capture v1.1 | pause+redact AND delegated capture behind flag + QSA SAQ-D pre-confirmation + CEL sample-count timestamps | C4 |
| **Compliance orchestration** | unowned | **New M26 Compliance Workflows** on Temporal Cloud (HIPAA BAA); precedence rule per tenant; pseudonymise+bleep+crypto-shred saga | C5 |
| **Kamailio HA claim** | "in-flight calls do not drop" | Honest scoping: new calls route in ≤ 30 s; in-flight RTP may drop. PRD NFR-A2 flagged for softening. P9 principle codifies this. | C6 |
| **Push provider** | FCM + APNS | **AWS End User Messaging Push** (HIPAA-BAA) + OneSignal secondary; content-less payload only | C7 |
| **NATS** | (used directly) | `sync_interval=always` mandatory for compliance streams; R=3 default, R=5 unrecoverable; `@horizon-republic/nestjs-jetstream` | C8 |
| **Argon2id** | (unspecified) | Two-layer LRU+Redis cache, 60 s TTL, HMAC-keyed, pub/sub invalidation | C9 |
| **PJSIP cache** | (unspecified) | Asterisk-22 stale-cache + AMI invalidation + naming convention `t{tenant_uuid_short}_{local_id}` + per-tenant feature-code contexts | C10 |
| **Recording pipeline** | "MixMonitor → shared volume → worker" | emptyDir + uploader sidecar + KMS envelope (encryption context) + S3 SSE-KMS Bucket Keys | S1, S4 |
| **Mixed Model A/B** | unspecified | ADR-05 dispatcher-group ownership; HIPAA call DID-bound to Model A group | S2 |
| **NFR-P1 100-call validation** | Sprint 12-15 | **Sprint 1-3** | S3 |
| **DEK location** | "S3 metadata" | Postgres `recording_object.wrapped_dek`; never in S3 metadata | S4 |
| **Audit-log integrity** | RLS only | `BEFORE INSERT OR UPDATE` trigger + cross-tenant WRITE test | S5 |
| **KEK rotation** | unspecified | Two-version read window + Temporal workflow rotation; row-by-row atomic re-wrap | S6 |
| **PHI-in-SMS lint** | static templates | Token allowlist per tenant flag at template-save time | S7 |
| **SIP.js** | chosen | Kept + Expo + react-native-callkeep for mobile + LiveKit SIP earmarked for AI/inbound bridging only | S8 |
| **NestJS JetStream transport** | unspecified | `@horizon-republic/nestjs-jetstream` | S9 |
| **fast-xml-parser** | for output | **xmlbuilder2** for output + golden-fixture CI diff; fast-xml-parser reserved for parsing | S10 |
| **Custom-domain TLS** | unspecified | Caddy on-demand TLS + `ask` endpoint; cert-manager for platform wildcards/mTLS | S11 |
| **rtpengine "active-active"** | implied in-flight survival | Honest scoping: per-call DTLS context is in-memory; failover routes new INVITEs only | S12 |
| **Patroni RPO** | "≤ 1 min" implicit sync | Sync replication required OR PRD softens to ≤ 5 min; flagged to product | S13 |
| **Reports** | "F06 bullet" | **New M27 Reports** on Cube.dev + custom React renderer (not Metabase) | gap §3 |
| **CSV bulk import** | unowned | **New M28 BulkImport** with JSONLogic-mapped dedupe_key, idempotent re-import | gap FR-X11 |
| **Coverage-gap consumer** | unowned | M15 (live banner, filtered to affected rota) + M27 (daily digest) fan-out | gap FR-S5 |
| **Email open-tracking** | unowned | `/integrations/email/event/{provider}` in M20 | gap FR-D2 |
| **Computed form fields** | JSON Schema (no formula) | JSONLogic `x-computed` extension; isomorphic eval; server re-eval + reject | gap FR-F2 |
| **Documentation** | unowned | Platform/SRE pillar, sprint-15 deliverable | gap AC §12 #13 |
| **GDPR Art. 20 portability** | unowned | M26 `PortabilityExportWorkflow` (NDJSON + WAV + WebVTT to per-request S3 prefix → presigned URL) | gap NFR-S11 |
| **OTel SIP propagation** | "X-Call-UUID" handwave | Concrete: `X-Trace-Context` SIP header → `__TRACEPARENT` channel var → `ChannelVarset` → NestJS OTel propagator | gap NFR-O4 |
| **Operator state machine** | M15 vs F03 boundary unclear | Server source of truth; F03 owns intent states only | ambiguity |
| **Dispatch dashboard** | unclear F04/F05/F06 | F05 owns, F06 read-only embedded subset | ambiguity FR-D10 |
| **`packages/templates`** | unowned | Owned by M19 Communications; Handlebars + MJML + JSON-mustache; versioned + golden-file tests | ambiguity |
| **Asterisk version** | unspecified | 22.9.x LTS; avoid chan_websocket ExternalMedia at > 90 calls | risk avoided |
| **Sprint 0 gate** | "contracts week" | **12 ADRs + contracts; merged before any module ships code** | process |
| **TanStack Router** | "TanStack Query + Zustand" | Add TanStack Router for type-safe nested layouts | DX |
| **Two new pillars** | 8 role pillars | + Compliance & Security (split out), + Analytics | clarity |
| **New principles** | P1-P8 | + P9 stateless-edge-with-reconciliation, P10 compliance-as-workflow | doctrine |

---

## TL;DR

Three deliverables make v0.2 work — same shape as v0.1, sharper edges:

1. **`docs/adr/` populated in Sprint 0 with 12 ADRs (§5)** — every load-bearing decision from RISKS.md is resolved before module work starts. Without this gate, the 6–9 month MVP target slips by 4–6 weeks of coordination tax.
2. **Module catalogue (§4) with 38 modules across 10 role pillars** — adds M26 Compliance Workflows, M27 Reports, M28 BulkImport; clarifies `packages/templates` ownership; closes 16 PRD coverage gaps.
3. **`docker compose up` boots everything stubbed** — including `temporalite` for local Temporal, `supavisor` for the pooler, `coturn` for relay — with zero cloud credentials. NFR-M1 honest about macOS rtpengine userspace divergence.

*End of architecture v0.2. ADRs in `docs/adr/` are the next deliverable.*
