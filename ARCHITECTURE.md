# Telephone Answering Service (TAS) — High-Level Architecture (v0.1)

Architecting for a multi-tenant TAS SaaS with **drop-in TAS `/v1` compat**, **HIPAA + GDPR + PCI** compliance, **Kamailio + rtpengine + Asterisk** telephony, and a **6-9 month MVP** with parallel team execution.

The whole architecture is organised around one rule: **every module is independently buildable, mockable, and TDD-able** because its contracts (HTTP + events + DB schema) are signed off *before* any implementation lands.

---

## 1. Architecture principles

| # | Principle | Implication |
|---|-----------|-------------|
| P1 | **Contracts first** | OpenAPI 3.1 + AsyncAPI 3.0 + JSON Schema files live in `/contracts/` and are PR-reviewed before module work starts. Mock servers (Prism/MSW) come from these specs. |
| P2 | **Bounded contexts = modules** | A module owns its DB tables (no cross-module SQL joins), publishes events on NATS, exposes HTTP/RPC via its OpenAPI block. Cross-module access is *only* via published contracts. |
| P3 | **Tenant ID is sacred** | Every table has `tenant_id` enforced by Postgres RLS. Every request resolves a tenant claim before any business logic. No exceptions. |
| P4 | **Two API surfaces, one domain** | `/v1` (TAS-compat XML/JSON) and `/api/v2` (modern JSON) are both first-class facades over the *same* domain services — `/v1` is not a translation shim. |
| P5 | **Side effects through workers** | HTTP requests do not send SMS/email/recordings inline; they enqueue work to NATS JetStream and return. Workers retry idempotently. |
| P6 | **Stub all external deps in dev** | KMS, SIP trunk, SMS, email, push, calendar, CRM — every external dependency has a local stub. `docker compose up` boots the whole product. |
| P7 | **Compliance is a build-time check** | RLS policies, audit decorators, encryption-at-rest, no-PHI-in-SMS — enforced by lints, schema constraints, and integration tests, not human review. |
| P8 | **TDD per module** | Red → green → refactor at the slice level. Each module ships with unit + contract + integration tests gated in CI. No module merges without its test pyramid. |

---

## 2. Macro topology

```
            ┌──────────────────────────────────────────────────────────┐
EDGE PLANE  │   Kamailio SBC (active-active, dispatcher+dialog)        │
(SRE-owned) │   rtpengine (kernel forward, DTLS-SRTP/ICE)              │
            │   Public ingress: HTTPS + WSS + SIP/TLS                  │
            └──────────────────────────────────────────────────────────┘
                                  │                  │
                                  ▼ SIP             ▼ HTTPS/WSS
            ┌──────────────────────────┐    ┌──────────────────────────┐
TELEPHONY   │  Asterisk pool           │    │  NestJS modular monolith │  APP PLANE
PLANE       │  (Model B, PJSIP realtime│◄──►│  N replicas, stateless   │  (Backend)
            │   from Postgres)         │ARI │  - REST (/v1 + /api/v2)  │
            │  MixMonitor → /recordings│AMI │  - WebSocket gateway     │
            └──────────────────────────┘    │  - ARI leader (Redis lock)│
                          │                 │  - Workers (BullMQ)      │
                          ▼ NATS            └──────────────────────────┘
                  ┌───────────────────────────────────────────┐
DATA PLANE        │  Postgres (Patroni)  Redis  NATS JetStream │
                  │  S3/MinIO recordings  KMS (Vault/AWS)      │
                  └───────────────────────────────────────────┘
                                  ▲
                                  │ HTTPS (OAuth2 PKCE / Basic)
            ┌─────────────────────┴─────────────────────────────┐
FRONTEND    │ Operator Console │ Admin │ Supervisor │ Portal    │
PLANE       │      (React 19 + Vite + TS + SIP.js + TanStack)   │
            └───────────────────────────────────────────────────┘
                                  │
                                  ▼ HTTPS (webhooks/APIs out)
            ┌───────────────────────────────────────────────────┐
INTEGRATION │ SIP trunks (Telnyx/Twilio) │ SMS │ Email │ Push   │
PLANE       │ Calendar (Google/MS365)    │ CRM │ Stripe │ Homer │
            └───────────────────────────────────────────────────┘
```

---

## 3. Role-to-module map

Eight role pillars; every module has exactly one owning role.

| Role pillar | Owns |
|---|---|
| **Platform / SRE** | Kamailio config, rtpengine, K8s/Compose manifests, Patroni, Redis, NATS, observability stack, CI/CD |
| **Telephony backend** | Asterisk dialplan, PJSIP realtime schema, ARI/AMI bridge module, MixMonitor pipeline |
| **Domain backend** | NestJS bounded-context modules (Tenancy, Accounts, Forms, Calls, Messages, Dispatch, Scheduling, Billing, Tasks, Audit) |
| **API surface backend** | `/v1` XML+JSON facade, `/api/v2` OpenAPI facade, Webhook delivery, REST integration tests |
| **Integration backend** | SMS/Email/Push/Calendar/CRM/Stripe adapters (each behind a port) |
| **Frontend — Console** | Operator Console (multi-line, screen-pop, form-fill, SIP.js wiring) |
| **Frontend — Admin & Supervisor** | Web Admin, Supervisor Dashboard, Form Designer, shared UI library |
| **Frontend — Portal** | Client Portal, white-label theming, recording playback UI |
| **Security & Compliance** | Identity module, RLS policies, KMS envelope encryption, PCI redaction worker, audit decorator, compliance test suite |
| **QA / SDET** | Contract tests (Pact), SIPp scenarios, Playwright E2E, load harness |

(Security and QA cut across — they "own" the cross-cutting modules and the test harnesses, respectively.)

---

## 4. Module catalogue

Each module below is a **deliverable unit**: own repo workspace (pnpm package or top-level dir), own OpenAPI/AsyncAPI block, own DB schema namespace, own test suite, own owner. The boundary contracts are the deliverable artefact for the architecture phase.

### 4.1 Domain backend modules (NestJS modular monolith)

Modules live in `apps/api/src/modules/<name>/`. Each has `domain/`, `application/`, `infra/`, `http/`, `events/`, `contracts/`. No module imports from another module's `domain/` or `infra/`; only `contracts/` and published event types are reachable across the line.

| # | Module | Owns (tables) | Inbound contracts | Outbound contracts | Critical events emitted |
|---|---|---|---|---|---|
| **M01** | **Tenancy** | `tenant`, `tenant_kek_ref`, `tenant_feature_flag`, `branding` | `POST /api/v2/tenants` (platform-admin), `GET /tenants/{id}` | KMS create-key, DNS/SIP-domain provision | `tenant.created`, `tenant.suspended` |
| **M02** | **Identity & Auth** | `user`, `role_assignment`, `mfa_secret`, `oauth_client`, `pat`, `refresh_token` | `POST /oauth/token`, `POST /api/v2/users`, `/v1/Users`, `/v1/me` | KMS sign, audit emit | `user.created`, `user.locked`, `user.role_changed` |
| **M03** | **Client Accounts** | `client_account`, `did`, `resource_panel`, `notice` | `/v1/Clients`, `/api/v2/accounts`, `/api/v2/dids` | DID-routing publish to Telephony Control | `account.created`, `did.assigned` |
| **M04** | **Contacts & Message Actions** | `contact`, `message_action`, `contact_availability` | `/v1/Contacts`, `/api/v2/contacts/{id}/actions`, portal "set my availability" | Calendar adapter (read), Dispatch (read) | `contact.availability_changed` |
| **M05** | **Custom Forms** | `form`, `form_version` (immutable), `field_def` | `/api/v2/forms`, Form Designer save | — (consumed by Calls + Messages) | `form.published` |
| **M06** | **Calls (CDR+)** | `call`, `call_event`, `incoming_tel_no_xref` | `/v1/Calls`, `/v1/Calls/kpi`, `/api/v2/calls`, screen-pop subscriptions | Telephony events in (NATS), Recording (1:1 ref) | `call.arriving`, `call.answered`, `call.ended`, `call.taken_by_other` |
| **M07** | **Messages** | `message`, `message_form_payload`, `message_status` | `/v1/Messages`, `/api/v2/messages` | Dispatch (M08), Webhook delivery, Audit | `message.saved`, `message.acknowledged` |
| **M08** | **Dispatch** | `dispatch`, `dispatch_attempt`, `escalation_timer` | Triggered by `message.saved`; admin overrides via `/api/v2/dispatches/{id}/replay` | SMS/Email/Push/Webhook adapters (M19-M22) | `dispatch.sent`, `dispatch.failed`, `dispatch.escalated` |
| **M09** | **On-Call Scheduling** | `otas_schedule` (rrule), `otas_shift_override` | `/v1/OTAS`, `/api/v2/schedules`, `WhoIsOTAS(account_id, at)` query (FR-S3) | Calendar adapter (sync) | `schedule.updated`, `otas.gap_detected` |
| **M10** | **Recording & Redaction** | `recording`, `recording_encryption`, `redaction_interval` | Signed-URL playback endpoint, DELETE for right-to-erasure | KMS decrypt, S3 GET/PUT, sox/ffmpeg redact (worker) | `recording.uploaded`, `recording.redacted` |
| **M11** | **Tasks/Reminders/Notices/News** | `task`, `reminder`, `notice`, `news` | `/v1/todo`, `/api/v2/tasks`, `/api/v2/notices` | Dispatch (reminder fires) | `task.completed`, `reminder.fired` |
| **M12** | **Tenant→Client Billing** | `billing_scheme`, `billing_scheme_version`, `billing_line_item` | `/v1/Clients/{id}/billing`, `/api/v2/billing/export` | CSV/QuickBooks export adapters | `billing.line_item.recorded` |
| **M13** | **SaaS (Stripe) Billing** | `subscription`, `usage_meter` | Platform-admin only; Stripe webhooks in | Stripe Billing + Meters API | `subscription.activated`, `usage.metered` |
| **M14** | **Audit & Compliance Log** | `audit_log` (monthly partitioned, RLS UPDATE/DELETE blocked) | `/api/v2/audit` (tenant_admin read) | — | (consumes domain events; emits none) |
| **M15** | **Supervisor Live State** | `operator_presence` (Redis-backed projection), `coach_session` | WebSocket subscriptions; ChanSpy initiation via M16 | M16 (originate ChanSpy) | `presence.changed`, `qa.tagged` |

**Cross-module rules baked in:**
- A module that needs another module's data reads it via that module's *application service*, never its tables. (Enforced by `eslint-plugin-boundaries`.)
- Async fan-out is the default; sync calls only inside one transactional boundary.

### 4.2 Telephony & integration backend modules

| # | Module | Owner | Public contract |
|---|---|---|---|
| **M16** | **Telephony Control Plane** (ARI/AMI bridge) | Telephony backend | NATS subjects `telephony.event.*` (CallArriving, ChannelStateChange, Hangup, MixMonitorStart/Stop); RPC `telephony.command.originate`, `.spy`, `.transfer`, `.pause_record`. Implements Redis-lock leader election per Asterisk node. |
| **M17** | **PJSIP Realtime Schema** | Telephony backend | Tables `ps_endpoints`, `ps_auths`, `ps_aors`, `ps_contacts`, `ps_domain_aliases` provisioned by M01/M02. Schema versioned independently. |
| **M18** | **Asterisk Dialplan + IVR** | Telephony backend | Lua/AEL dialplan in git; per-tenant context; PCI pause feature codes (`*7`/`*8` configurable); delegated-capture redirect (Telnyx Pay / Stripe Terminal IVR) |
| **M19** | **SMS Adapter** | Integration backend | Port: `SmsSender { send(tenant, to, body, dlrCallback) }`. Drivers: Twilio, Telnyx, Bandwidth, **stub** (writes to NATS topic for tests). DLR webhook ingress at `/integrations/sms/dlr/{provider}`. |
| **M20** | **Email Adapter** | Integration backend | Port: `EmailSender`. Drivers: SES, SendGrid, SMTP, **stub** (Mailpit in dev). |
| **M21** | **Push Adapter** | Integration backend | Port: `PushSender`. FCM + APNS; v1.x scope but stub from day 1. |
| **M22** | **Webhook Delivery** | API-surface backend | Outbound: HMAC-SHA256, at-least-once, exponential backoff, signed timestamps, replayable. `webhook_endpoint` + `webhook_delivery` tables. |
| **M23** | **Calendar Adapter** | Integration backend | Google + Microsoft 365 OAuth2. Read-only MVP. Maps to `otas_schedule` events. |
| **M24** | **CRM Adapter** | Integration backend | Generic webhook + Salesforce + HubSpot. The CRM **consumes** `/v1` — see M25; this module is for *outbound* CRM pushes. |
| **M25** | **REST API Facade (`/v1` + `/api/v2`)** | API-surface backend | XML serializer for `/v1` (verbatim TAS field order — uses `fast-xml-parser` with locked element order + schema fixture tests). Both surfaces import the same domain services. OpenAPI 3.1 emitted from NestJS decorators + Zod schemas. |

### 4.3 Frontend modules

Frontend lives in `apps/web-*` (Vite, React 19, TanStack Query, Zustand, Tailwind, Radix, shadcn/ui, MSW for mocks, Storybook 8, Playwright). Shared code in `packages/ui` and `packages/sdk-v2` (auto-generated from `/api/v2` OpenAPI).

| # | Module | Owner | Notes |
|---|---|---|---|
| **F01** | **`packages/ui` — design system** | FE: Admin pillar | Tokens, primitives (Button, Input, Modal, DataTable, Combobox), Form runtime (renders Form-Designer output), all docs in Storybook. WCAG 2.2 AA. |
| **F02** | **`packages/sdk-v2`** | FE: Admin pillar | Auto-generated TypeScript client from `/api/v2` OpenAPI (orval or openapi-typescript). React Query hooks. Versioned independently. |
| **F03** | **`apps/web-console` — Operator Console** | FE: Console pillar | TAS-parity layout (PRD Appendix B). SIP.js wrapper, multi-line state machine, screen-pop subscriber, form runner, save-and-dispatch flow. |
| **F04** | **`apps/web-admin`** | FE: Admin pillar | Tenant admin: accounts, contacts, forms (Form Designer), schedules, users, DIDs, billing schemes, integrations, branding. |
| **F05** | **`apps/web-supervisor`** | FE: Admin pillar | Live operator grid (WS), queue health, listen/whisper/barge controls (triggers M15→M16), QA tagging, coach chat. |
| **F06** | **`apps/web-portal` — Client Portal** | FE: Portal pillar | Per-tenant subdomain, white-labelled, inbox, recording playback (calls signed-URL endpoint), on-call self-service, reports. Cookie banner, DPIA prompts. |
| **F07** | **Form Designer (`packages/form-designer`)** | FE: Admin pillar | JSON-Schema-based form builder; renders identical runtime in F03 + F04 + F06. Versioned output (immutable). |

### 4.4 Cross-cutting modules

| # | Module | Owner | What it provides |
|---|---|---|---|
| **X01** | **Identity context propagation** | Security | NestJS interceptor: validates JWT/Basic, resolves tenant + user + roles, sets Postgres session GUC `app.tenant_id` + `app.user_id` for RLS. Same interceptor for `/v1` Basic Auth. |
| **X02** | **KMS / envelope encryption** | Security | `KekService` (per-tenant key in Vault/AWS KMS), `DekService` (DEK gen, wrap/unwrap), column-level helpers, recording wrapper. Pluggable: local JSON keystore driver for dev. |
| **X03** | **RLS policy library** | Security | Generated SQL policies per table; CI test asserts every new table has a policy. `psql` test fixtures verify cross-tenant reads return zero rows. |
| **X04** | **Audit decorator** | Security | `@Audited({ entity, action })` NestJS decorator captures before/after JSON via class-transformer; writes to M14 via outbox pattern. |
| **X05** | **Observability** | Platform/SRE | OpenTelemetry SDK in NestJS + frontends; Prometheus exporters in Asterisk (`res_prometheus`), Kamailio (`xhttp_prom`), rtpengine; Tempo for traces; Loki for logs; Homer (HEPv3) for SIP capture; Grafana dashboards as code. |
| **X06** | **DB schema & migrations** | Platform/SRE | Prisma migrate **or** Atlas — one chosen up front; per-module migration directories; `migration_lock.toml` enforces ordering. RLS policies versioned alongside. |
| **X07** | **Feature flags** | Platform/SRE | OpenFeature SDK + Unleash backend; tenant-scoped flag evaluation. Used for `delegated_pci_capture`, `coturn_enabled`, etc. |
| **X08** | **Job queue infrastructure** | Platform/SRE | BullMQ on Redis for scheduled/recurring jobs (reminders, escalation timers, KEK rotation, partition rotation, S3 lifecycle audit). NATS JetStream for event-driven fanout. Clear rule: timers→BullMQ, events→NATS. |
| **X09** | **SIP capture / Homer** | Platform/SRE | HEPv3 mirror from Kamailio + rtpengine; 30-day retention for EU tenants. |
| **X10** | **Compliance test suite** | Security + QA | Contract tests: no PHI in SMS adapter payloads; `audit_log` partition rotation drill; cross-tenant probe; recording-playback signed-URL expiry; PCI redaction silence-overwrite verification. Runs nightly. |

---

## 5. Decisions resolved up-front (open questions from PRD §11)

These are open in the PRD; the architecture pre-decides them so module work can start without thrash. Each is reversible but a default removes a coordination tax.

| PRD open question | Resolution for v0.1 | Reason |
|---|---|---|
| TypeORM vs Prisma | **Prisma 5** | Generated types end-to-end with `packages/sdk-v2`; better DX; supports RLS via raw policy SQL alongside migrations. |
| Bull vs BullMQ | **BullMQ** | First-class TS, repeatable jobs, flow producer. |
| Monorepo tooling | **pnpm workspaces + Turborepo 2** | Smaller blast radius than Nx; turbo-cache works well in GH Actions. |
| `/v1` XML library | **`fast-xml-parser` + locked-order fixture tests** | Verbatim ordering is non-negotiable for CRM compat; fixture diffs catch regressions. |
| Form Designer engine | **JSON Schema (draft 2020-12) + custom builder UI in `packages/form-designer`**, renderer in `packages/ui` | Keeps spec interoperable; renderer reused across 3 apps. |
| KMS in MVP | **Vault dev mode (local), AWS KMS prod** | One driver interface, env-selected; aligns with stub-everything-locally principle. |
| TURN/coturn | **Deferred to v1.x; rtpengine ICE=force MVP** | PRD explicit; design hook in `iceServers` config endpoint stays. |

(Each gets an ADR file in `docs/adr/` so future contributors see the trail.)

---

## 6. Contract-first toolchain (the load-bearing piece)

The whole "modules implementable independently" claim hinges on this section. Without it, the modules are theoretical.

```
/contracts/
  openapi/
    v1.TAS.yaml         ← hand-curated (TAS parity, frozen)
    v2.api.yaml           ← generated from NestJS @nestjs/swagger + Zod schemas
  asyncapi/
    telephony.yaml        ← NATS subjects, payload schemas
    domain-events.yaml    ← message.saved, dispatch.sent, etc.
  schemas/
    form-definition.schema.json
    audit-event.schema.json
    webhook-payload.schema.json
  examples/
    *.json                ← canonical request/response samples used by every test
```

**Tooling**:
- **Spectral** lints OpenAPI + AsyncAPI on PR.
- **Prism** runs as `mock-api` service in Docker Compose — every frontend dev can run a fully-mocked backend in 10 seconds.
- **MSW** in frontend tests reuses the same JSON examples.
- **Pact** (consumer-driven contracts) — each frontend publishes its expectations; backend modules verify in CI before merge.
- **SchemaThesis** runs property-based tests against the live `/api/v2` from OpenAPI on every PR.
- **AsyncAPI generator** produces TS types for NATS subjects consumed everywhere.

This is what makes "frontend dev can build the operator console while backend dev hasn't started M06 yet" actually true.

---

## 7. Per-module TDD strategy (the test pyramid)

Every module ships with these layers; CI gate requires all four green.

| Layer | Tool | Per-module example (Dispatch, M08) |
|---|---|---|
| **Unit** | Vitest | `EscalationTimer` advances correctly with paused windows; `MessageAction` filter eval on form payload. |
| **Contract** | Pact + Spectral + AsyncAPI validator | `dispatch.sent` payload matches AsyncAPI schema; OpenAPI examples round-trip. |
| **Integration (in-process)** | Vitest + Testcontainers (Postgres, Redis, NATS) | A message-saved event triggers SMS adapter stub → status flips to `delivered` → audit row written. |
| **End-to-end** | Playwright (FE) / SIPp + Asterisk (BE) | Operator answers SIPp-originated call, fills form, saves → SMS stub receives expected payload within 3s. |

**Slice TDD discipline** (PRD §4a): each user-facing slice starts with one failing test (red) that *exercises the whole vertical* — SIPp scenario, frontend Playwright, or `/v1` curl. Implementation lands minimally to make it green. Refactor inside the slice without breaking the gate.

**Compliance regression suite** (X10) runs nightly and on tagged release; failures block release independent of feature tests.

---

## 8. Local-dev story (zero cloud credentials)

```bash
docker compose up
# brings up:
#   kamailio (single node, dev cert)
#   rtpengine (host-net mode)
#   asterisk-1 (with sipp-emulator sidecar that simulates trunk)
#   postgres (Patroni single-node)
#   redis
#   nats-jetstream
#   minio (S3-compatible recording storage)
#   vault-dev (KMS stub, in-mem)
#   mailpit (email stub)
#   sms-stub (logs to NATS topic, mounted in /sms-log)
#   prism (mock /api/v2 if backend not running)
#   nestjs-api (watch mode)
#   web-console, web-admin, web-supervisor, web-portal (vite dev servers)
#   grafana + tempo + loki + homer (full obs stack)
```

A new engineer clones, `pnpm i`, `docker compose up`, opens four browser tabs, places a SIPp call, watches it land in the console — under 15 minutes from clone to working call. **No AWS / Twilio / Telnyx / SendGrid account required.**

CI runs the same compose file in service mode for integration tests.

---

## 9. MVP delivery sequencing (parallel tracks)

12 parallel tracks; vertical-slice ordering inside each. The numbered milestones below are the *only* sync points between tracks.

```
Sprint 0  ── Contracts week ──────────────────────────────────────────────
  Everyone: write OpenAPI, AsyncAPI, JSON Schemas. ADRs for the §5 table.
  Stand up Prism mocks. Frontend can start building immediately.

Sprint 1-3  ── Foundations (must finish before M4 sync) ──────────────────
  SRE/Platform:  Docker Compose, Postgres+Patroni, Redis, NATS, KMS stub,
                 observability stack, CI pipeline, RLS test harness.
  Security:      M01 Tenancy, M02 Identity (incl. /v1 Basic + /v2 OAuth),
                 X01-X04, X10 skeleton.
  Telephony:     Kamailio config, rtpengine, Asterisk Model B, PJSIP
                 realtime, ARI/AMI bridge (M16), SIPp scenarios.
  FE Admin:      packages/ui, Storybook, packages/sdk-v2 generator.

────────── Milestone A: "First registered softphone places a call" ──────

Sprint 4-7  ── Core call path (parallel) ─────────────────────────────────
  Domain BE:     M03 Accounts, M04 Contacts, M05 Forms, M06 Calls,
                 M07 Messages.
  API surface:   M25 /v1 (Users, Calls, Messages, Contacts, Clients, todo),
                 /api/v2 read-side.
  FE Console:    F03 Operator Console — answer, form-fill, save.
  FE Admin:      F04 Accounts/Contacts/Users/DIDs/Branding CRUD.
  Telephony:     MixMonitor pipeline → M10 Recording (encrypt+upload).
  Integration:   M19 SMS + M20 Email adapters (stubs first, real second).

────────── Milestone B: "Operator answers, fills form, message dispatched" ──────

Sprint 8-11  ── Scheduling, Supervisor, Portal, Billing ──────────────────
  Domain BE:     M08 Dispatch (incl. escalation), M09 Scheduling
                 (incl. WhoIsOTAS single source), M11 Tasks,
                 M12 Tenant→Client Billing (CSV export), M14 Audit.
  FE Supervisor: F05 live grid + listen/whisper/barge (M15+M16).
  FE Portal:     F06 inbox, recording playback (signed URLs),
                 on-call mgmt, reports.
  Integration:   M22 Webhook Delivery, M23 Calendar (read-only).
  Security:      PCI redaction worker, delegated-capture redirect (M18).

────────── Milestone C: "Tenant onboards, runs a shift, bills their client" ──────

Sprint 12-15  ── Hardening ───────────────────────────────────────────────
  Load test: 100 concurrent calls × 25 ops × dispatch fanout.
  Chaos drills: Asterisk node kill (accept call drops), Kamailio failover
                (zero call drops), Patroni promotion, NATS partition.
  Pen test, ASV scan, SAQ-D paperwork, BAA chain audit.
  GDPR right-to-erasure run-through.
  Pilot tenant onboarding playbook.

────────── Milestone D: MVP cut ──────────────────────────────────────────
```

---

## 10. What "module boundary" actually looks like (worked example: M08 Dispatch)

To show the rest of the catalogue is real and not aspirational, here is one module fully boxed in:

**Boundary in:**
- NATS subject `domain.message.saved` — payload schema `domain-events.yaml#/components/messages/MessageSaved` (form payload, account_id, urgency).
- HTTP `POST /api/v2/dispatches/{id}/replay` — replay an attempt.
- HTTP `POST /api/v2/dispatches/{id}/acknowledge` (also via webhook return).

**Boundary out:**
- Port `SmsSender.send(...)` (impl by M19) — never imports Twilio directly.
- Port `EmailSender.send(...)` (impl by M20).
- Port `WebhookEmitter.emit(...)` (impl by M22).
- NATS emits `domain.dispatch.sent`, `.failed`, `.escalated`.

**Owns:**
- Tables `dispatch`, `dispatch_attempt`, `escalation_timer` — no other module reads or writes.
- BullMQ queues `dispatch:immediate`, `dispatch:scheduled`, `dispatch:escalate`.

**Doesn't own:**
- Doesn't know how SMS gets sent (M19's problem).
- Doesn't render templates from form payloads — that's a pure function from `packages/templates` (a shared lib, not a module).
- Doesn't decide who's on call — calls `M09.whoIsOTAS(account_id, now)` via the application service contract.

**Definition of done:**
- All four test layers green (§7).
- AsyncAPI schemas published.
- ADR if a non-obvious decision was made (e.g., "we use BullMQ delayed jobs rather than NATS scheduled delivery because we need per-job cancellation").
- Compose stack runs end-to-end: SIPp call → operator saves → SMS stub receives → escalation fires when no ACK in N seconds.

Every other module in §4 is delivered to the same template.

---

## 11. What is not locked down

These are deliberate gaps for the next iteration (likely a brainstorming or grilling session):

- **Form Designer UX shape** — JSON Schema chosen, but the visual builder needs its own design pass.
- **Exact RLS policy templates** — pattern decided (session GUC), but per-table policies need to be written and reviewed alongside each module's migration.
- **Operator-console multi-line state machine** — needs to be specified (xstate diagram) before F03 starts; trivial to underspecify and end up with race conditions across SIP.js, WS screen-pop, and ARI events.
- **ARI leader election timing semantics** — Redis lock TTL, fencing token, what happens during the gap. Needs an ADR before M16 hardening.
- **Billing scheme DSL** — versioned, but the rule language (when does a call count as `priority`? as `weekend`?) isn't designed.

---

## TL;DR

Three deliverables make this work:

1. **`/contracts/` directory** populated in Sprint 0 — every module's OpenAPI/AsyncAPI/JSON-Schema is the *contract* others code against.
2. **Module catalogue (§4)** with 35 modules across 8 role pillars, each independently owned, tested, and mockable.
3. **`docker compose up`** boots everything stubbed — frontend, backend, telephony, observability — with zero cloud credentials.
