# Product Requirements Document — nCall-Inspired Multi-Tenant Answering-Service SaaS

**Project codename:** ncall-clone
**Document version:** 1.0 (initial)
**Date:** 2026-05-12
**Author:** levytskyy@gmail.com, drafted with Claude Code research synthesis
**Status:** Draft for review

---

## 0. How to read this document

This PRD specifies what we are building, why, for whom, and within which constraints. It is grounded in five parallel research streams against nCall by NSolve (https://www.nsolve.com/):

1. nCall REST API surface (for CRM-compatibility)
2. nCall desktop operator application UX (for worker familiarity)
3. nCall pricing and commercial model (for our own pricing strategy)
4. Telephony architecture (Kamailio + Asterisk + rtpengine + NestJS, our stack)
5. Broader TAS product domain and competitors (Amtelco, Startel, SingleComm, MAP, OnviSource)

The product is **inspired by** nCall, not a 1:1 clone. Two hard nCall-anchored constraints govern the build:

- **Operator UX parity** — workers currently using the nCall Windows desktop client must transition to our web app without retraining beyond the smallest possible delta. Screen layout, call-handling sequence, field semantics, and shortcut affordances must map.
- **REST API compatibility** — the caller's live CRM already integrates against nCall's REST API server. The CRM must be able to switch to our endpoint with **minimal or zero code changes**. We will reproduce nCall's URL pattern, auth model, pagination, and filtering verbatim for the resources the CRM uses, and add modern endpoints alongside under a new namespace.

Everything else is open to first-principles design.

---

## 1. Executive Summary

We are building a **multi-tenant, cloud-native, horizontally-scalable Telephone Answering Service (TAS) software platform**, deployed on Docker, and built on an open-source telephony stack (Kamailio SBC, Asterisk media server with rtpengine handling NAT and WebRTC↔PSTN media-plane bridging), with a NestJS control plane, PostgreSQL persistence, a React web admin, and a SIP.js web softphone. The entire stack runs locally on a developer laptop via a single `docker compose` command (no cloud credentials required for development); production uses the same container images under Kubernetes or Nomad. The platform targets businesses that operate call-answering services — virtual receptionists, after-hours medical/legal/trades dispatchers, property-management duty desks — and is offered as a SaaS where each answering-service business is a *tenant* and each of *their* customers is an *account*.

The product replicates nCall's distinctive operator-desktop workflow in the browser (call control widget, account screen-pop with greeting and up-to-three configurable Call Actions, per-account custom message forms with required-field enforcement, multi-channel dispatch via per-contact Message Actions, Old Calls / Tasks / Reminders tabs, Home dashboard with Noticeboard / News / Stats / My Calls / To Do / Tasks panels) and exposes a REST API that is **drop-in compatible** with nCall's `v1` URL contract for `Users`, `Calls`, `Messages`, `Contacts`, `todo`, `time`, `me`, `kpi`, and per-client `billing` resources.

Beyond parity, we deliver the modern improvements where nCall is publicly weak: calendar-driven on-call scheduling with Google/Outlook sync, an HA cloud-native deployment, native PCI/HIPAA/GDPR posture, real-time supervisor dashboard, native push-notification mobile delivery, AI agent assist and post-call summarisation as first-class capabilities (built on top of the call recording and transcription pipeline we need anyway).

Minimum viable product (MVP) targets a single answering-service tenant going live on a single Asterisk node with up to ~25 concurrent operators, ~100 concurrent calls, and ~50 client accounts. The architecture is designed for horizontal growth from day one: Kamailio behind a load balancer, an Asterisk pool dispatched by sticky-routing, rtpengine for media-plane NAT and WebRTC↔PSTN bridging, NATS JetStream for ARI event fan-out, Patroni-managed PostgreSQL, and per-tenant Asterisk-context isolation. Recording is on by default with per-file envelope encryption and AMI-driven pause-during-DTMF for PCI redaction.

---

## 2. Goals, Non-Goals, and Success Criteria

### 2.1 Goals

- **G1. Replace nCall for our own answering-service operations** — operators must be able to take a call, identify the account, fill out the per-account form, dispatch the message, and log out faster than they currently do in nCall.
- **G2. Preserve CRM integration without rework** — the existing internal CRM, which currently consumes nCall's REST API, must continue to function against our endpoint after a base-URL change and credential swap. Zero schema rewrites on the CRM side for the implemented resources.
- **G3. Multi-tenant from day one** — the data model, telephony isolation, and billing are tenant-scoped. The system must safely host competing answering-service businesses without cross-tenant data leakage.
- **G4. Compliance-fit for medical, legal, and card-handling verticals** — HIPAA (US healthcare), GDPR (EU personal data), PCI-DSS (payment processing during calls), with a defensible audit trail and tenant-isolated encryption-at-rest.
- **G5. Horizontally scalable telephony** — adding capacity is "deploy another Asterisk container and register it with Kamailio dispatcher." No single-machine vertical-scaling bottleneck.
- **G6. Browser-first operator experience** — web softphone (SIP.js) is the default. Hardware SIP phones are supported but not required. No native desktop client to install.

### 2.2 Non-Goals (explicit out-of-scope for v1)

- **NG1. PSTN carrier services** — we do not become a CLEC. PSTN is delivered via wholesale SIP trunk(s) (Twilio, Telnyx, Bandwidth, or similar). DIDs are procured from those carriers and provisioned into the platform.
- **NG2. Native mobile operator app** — operators work from desktop browsers in MVP. A mobile *on-call recipient* app (to receive secure messages with ACK) is in v1.x scope, not MVP.
- **NG3. Owned accounts-receivable / payment processing** — the tenant-billing module produces line items and CSV exports for ingestion into the answering service's own accounting tooling (QuickBooks, Xero). We do not run AR or charge end-customer credit cards. The SaaS billing (us billing the tenant) is separate and can use Stripe Billing.
- **NG4. Voice cloning / outbound AI bots** — we do not generate synthetic outbound voice in MVP. AI capabilities in MVP are limited to recording transcription and post-call summarisation against pre-recorded audio.
- **NG5. Hardware PBX integration via TAPI** — we are SIP-only. nCall's TAPI/PBX legacy integrations (Avaya, Cisco, Panasonic via TAPI) are not in scope; tenants who run their own PBX must use a SIP trunk between their PBX and our SBC.

### 2.3 Success Criteria

| ID | Criterion | Measure |
|----|-----------|---------|
| S1 | Existing CRM works against new API | Zero CRM code changes on `Users`, `Calls`, `Messages`, `Contacts`, `todo` reads/writes. Smoke-test of all consumed endpoints passes |
| S2 | Operator throughput unchanged or better | Median call handle time within ±10% of nCall baseline for the same script |
| S3 | Operator onboarding time | Trained nCall user becomes productive in our web app in ≤ 30 minutes |
| S4 | Concurrent call capacity | Pass: 100 concurrent calls per Asterisk node on a 4-vCPU/8GB container with Opus passthrough |
| S5 | HA failover | Killing one Kamailio or one Asterisk node mid-call: in-flight calls on that node end gracefully (re-INVITE or hangup), new calls continue routing on remaining nodes within ≤ 30 s |
| S6 | Recording integrity | 100% of recordings encrypted at rest; PCI pause produces a verifiable redaction window in audio + metadata |
| S7 | Compliance audit | Pass an external HIPAA/GDPR audit checklist (access logging, encryption in transit + at rest, retention policy, BAA chain) at v1 launch |
| S8 | Dispatch SLA | 95% of dispatched messages delivered to first-attempt channel within 10 seconds of operator save |

---

## 3. Target Users and Personas

### 3.1 The Tenant (answering-service business owner / operator)

- Runs an answering service with anywhere from 1 to 200 operators today. Receives calls on behalf of dozens to thousands of client accounts (the businesses being answered for).
- Today, runs nCall on-premises or a competitor (Amtelco, Startel) and wants to move to a cloud-managed platform without disrupting the existing operator workforce or CRM integration.
- Cares about: uptime, billing accuracy, operator productivity, compliance posture, ease of onboarding new client accounts, ability to export data and avoid lock-in.

### 3.2 The Operator / TSR (Telephone Service Representative)

- Sits at a browser all day, accepts inbound calls routed by the platform, identifies the right client account, follows a per-client script/form, dispatches the message, logs the call, takes the next one.
- Today, uses nCall's Windows desktop client. Familiar with: vertical-blue-bar-marks-active-call, pink-mandatory-fields, three Call Action buttons per account, F-key shortcuts, message-form save = wrap-up complete.
- Cares about: not being slowed down, keyboard accessibility, accurate caller-history pop, never mis-assigning a call to the wrong account, being able to see who is on-call without leaving the call screen.

### 3.3 The Supervisor / Floor Manager

- Monitors operator activity in real time, reviews recordings for QA, intervenes on escalations, manages staffing.
- Today, navigates the same nCall console with admin permissions; uses Amtelco/Startel's listen/whisper/barge if available.
- Cares about: real-time queue and operator-status visibility, post-call QA scorecards, the ability to listen-in or barge without leaving the seat, drill-down reports.

### 3.4 The Tenant Administrator

- Sets up client accounts, custom forms, on-call schedules, billing schemes, integrations.
- Today, uses nCall's "View > Admin Options" and its bundled Form Designer.
- Cares about: speed of onboarding a new client account (forms, schedules, contacts), ability to delegate per-client admin to the client themselves via the client portal, change history / audit log.

### 3.5 The Client (the business being answered for)

- A medical practice, a property management firm, a law firm, etc. Their callers are routed to our operators after hours or as overflow.
- Today, logs into nCallOnline to read messages, update on-call status, see call history.
- Cares about: not missing messages, being able to update on-call without phoning the answering service, fast message delivery.

### 3.6 The On-Call Recipient

- A physician on-call, a plumber on rotation, a property maintenance lead. Receives dispatched messages from our operators.
- Today, receives email + SMS + secure-messaging-app push, optionally a phone patch.
- Cares about: receiving messages reliably, being able to ACK quickly so the operator knows it landed, not having PHI in clear-text SMS.

### 3.7 The CRM Integration (technical user)

- A piece of software, not a person — but it's the tightest constraint. The tenant's CRM polls and writes to our REST API exactly as it did for nCall.
- Cares about: the API base URL, the HTTP Basic auth header, the `v1` URL contract, the field names, the pagination semantics, the XML/JSON content negotiation.

---

## 4. Scope

### 4.1 In scope for MVP (v1.0)

1. **Multi-tenant data model** with strict per-tenant isolation.
2. **Inbound call handling** via SIP trunk → Kamailio SBC → Asterisk pool, routed by DID to the correct tenant + client account.
3. **Web operator console** that replicates the nCall desktop layout: call-control widget, account/contact panel, up-to-three Call Action buttons per account, per-account custom message form, Old Calls / Tasks / Reminders / Home tabs.
4. **Embedded WebRTC softphone** (SIP.js) registering via WSS through Kamailio to Asterisk PJSIP. Optional **hardware SIP phone** registration per operator.
5. **Per-account custom message forms** with required-field enforcement (pink background), multi-page support, free-text/dropdown/checkbox/date/timestamp/reference/recipient fields, hyperlink commands (`Search:`, `Dial:`, `Client:`, `Contact:`) in note bodies.
6. **Caller history pop** matching CLI on inbound, with VIP (green) / Ignore (red) badge.
7. **Per-contact Message Actions** for dispatch: email, SMS, outbound phone patch, webhook, mobile push (FCM/APNS). Immediate and scheduled. Escalation chains with timeouts.
8. **Status-driven on-call** (nCall-parity) **and calendar-driven on-call** (Google/Outlook sync) — both. The operator-facing lookup always answers "who is on-call right now for this account" against the merge of both.
9. **Call recording, on by default**, per-tenant envelope encryption, AMI-pause for PCI, time-stamped redaction windows in metadata.
10. **Client portal** (per tenant, white-labelled) — clients read messages, listen to recordings, manage on-call status and schedule, run reports.
11. **REST API** with two coexisting surfaces: (a) **nCall-compatible `/v1`** for the CRM, (b) **modern `/api/v2`** for new integrations (OpenAPI-described, OAuth2/PAT auth).
12. **Tenant administration UI** — client accounts, forms (visual builder), contacts, schedules, users, billing schemes, DIDs, integrations.
13. **Tenant-of-clients billing module** — per-minute/per-call/per-message/flat schemes with inclusive minutes, rounding, period configuration, CSV export.
14. **Reports** — 30+ standard reports modelled on nCall's set (call volume, operator stats, billing, message delivery, on-call coverage).
15. **Supervisor real-time dashboard** — operator status, live queue, calls-in-progress, listen/whisper/barge.
16. **Audit log** — append-only, every admin action, every recording-pause, every message dispatch, with tenant + user + timestamp + IP.
17. **Compliance baseline** — TLS 1.2+ everywhere, SRTP mandatory, per-tenant KEK in KMS, audit log, configurable retention.
18. **Observability** — Homer (SIP HEPv3), Prometheus metrics from every component, OpenTelemetry traces correlated by call UUID.
19. **Docker-based deployment** with horizontal scaling primitives (Kamailio active-active via DMQ, Asterisk pool sticky-routed, Patroni Postgres, NATS event bus).

### 4.2 In scope for v1.x (post-MVP, ~3–6 months after MVP launch)

- Native mobile **on-call recipient app** (iOS + Android) with encrypted push, ACK, listen-back of attached audio.
- **Native ServiceTitan, HousecallPro, ConnectWise, Salesforce, HubSpot** integrations beyond the generic webhook.
- **AI capabilities** built on the recording + transcription pipeline: post-call summary, sentiment, agent-assist suggestions (read-only, advisory), ChatJack-style after-hours auto-attendant with form-filling.
- **QA scorecard module** mapped to ATSI Award of Excellence criteria.
- **Multi-region deployment** with EU-resident stack for GDPR-strict tenants.
- **Training mode** with shadow / silent monitor / supervised takeover.
- **Tenant-self-service onboarding** (Stripe Billing, automated DID provisioning via Telnyx API).

### 4.3 Out of scope (deferred to v2 or never)

- Owned PSTN carrier / direct interconnect.
- Native mobile **operator** app (operators stay on desktop browsers).
- Full omnichannel inbox (web chat / social / two-way SMS into the operator console).
- Nurse triage protocol library.
- Voice cloning / synthetic outbound bots.
- TAPI / legacy PBX integration.

---

## 5. Functional Requirements

This section is the working contract for what the product *does*. Each FR group maps to specific UI screens, API endpoints, and components. The numbering is stable for downstream plan and ticket references.

### 5.1 Tenancy and identity

- **FR-T1.** A *Tenant* represents one answering-service business. All other entities (users, accounts, calls, recordings, DIDs, billing schemes) carry a `tenant_id` and are filtered by it on every query. PostgreSQL row-level security (RLS) enforces this at the database layer; the application layer cannot accidentally bypass it.
- **FR-T2.** A tenant has its own **SIP domain** (e.g. `acme.sip.example.com`). Kamailio reads `use_domain=1` in `auth_db` and `registrar`, ensuring SIP credentials are scoped to the tenant.
- **FR-T3.** Tenant onboarding produces: a SIP domain, a per-tenant KEK (key encryption key) referenced in our KMS (AWS KMS or HashiCorp Vault), a default admin user, an empty billing scheme, a default branded client-portal subdomain.
- **FR-T4.** Users belong to a tenant and have one or more **Roles**: `tenant_admin`, `supervisor`, `operator`, `client_portal_user`, `api_integration`. Roles are additive permissions, not hierarchical.
- **FR-T5.** Authentication: username + password by default with optional **TOTP MFA** for admin and supervisor roles. SAML/OIDC SSO for tenant_admin and supervisor in v1.x.
- **FR-T6.** A user can act in multiple tenants only via explicit invitation; switching tenant is an explicit action with a re-auth challenge.
- **FR-T7.** API authentication exposes two mechanisms simultaneously:
  - **HTTP Basic Auth** (the nCall-compatible path) — username/password of an `api_integration` user. Scoped to the tenant of that user.
  - **OAuth2 / Personal Access Token** (the modern path) — bearer token in `Authorization: Bearer …`, scoped to specific resource permissions.

### 5.2 Client accounts (the businesses being answered for)

- **FR-A1.** A *Client Account* (alias: *Company*) is the unit a tenant answers calls for. Fields include name, account number, type (medical / legal / trades / property / etc., color-coded), greeting text, general notes, "sensitive info" (rendered red in the operator UI), billing scheme, default time zone, and configuration of up-to-three **Call Actions**.
- **FR-A2.** A Client Account has one or more **Contacts** (people associated with the account — point of contact, on-call recipients, billing contact). Each contact has email, mobile, alternate phone, preferred channels, and zero-or-more **Message Actions**.
- **FR-A3.** A Client Account is reached by one or more **Incoming Telephone Numbers (DIDs)**. The DID-to-account mapping is the primary routing key; multiple DIDs can route to the same account (with different default Call Actions per DID is permitted).
- **FR-A4.** A Client Account has a **Resource Panel** entries — quick links to information sheets, external URLs, file attachments, booking systems — that are surfaced beside the call.
- **FR-A5.** A Client Account has a **Notices** section that appears on operator screen at call pop time — "Office closed Dec 24–26" etc.
- **FR-A6.** Client account types (vertical templates): seeded set of templates for medical, legal, trades, property management, IT MSP, funeral home, general business. A template pre-configures form fields, suggested Call Actions, vertical-specific defaults (e.g. medical templates default to portal-only delivery for PHI, not SMS).

### 5.3 Operator inbound call flow (the core interactive flow)

This is the **operator-experience anchor**. Every line below must be operator-noticeable and match the nCall desktop pattern unless explicitly improved.

- **FR-C1.** A SIP INVITE arrives on Kamailio from the SIP trunk. Kamailio identifies the tenant by DID lookup, applies anti-abuse (pike rate limit, GeoIP, secfilter), and dispatches via `dispatcher` + `dialog` to a sticky Asterisk node. rtpengine is engaged for media-plane bridging.
- **FR-C2.** Asterisk enters a Stasis application (`tenant_<id>_app`). NestJS receives the `StasisStart` event over ARI and resolves: tenant, account (via DID), incoming caller CLI/ANI, caller name (CNAM if available), any caller history match on that CLI within the tenant.
- **FR-C3.** NestJS publishes a `CallArriving` event via WebSocket to all signed-in operators in the queue for that account. The first operator to accept gets the call (server-arbitrated, idempotent — losers receive a `CallTakenByOther` event).
- **FR-C4.** The operator's browser performs an automatic screen-pop:
  - The call appears as a new tab in the operator's console with a **vertical blue bar** indicating active call.
  - The Client Account panel fills with name, type (color-coded badge), greeting (rendered with tokens resolved: `[time-of-day]`, `[operator-name]`, `[DID-name]`), general info, sensitive info (red text), notices.
  - The contact panel shows caller history (last N calls from this CLI within tenant), with VIP (green) or Ignore (red) badges if the CLI matches a contact-level flag.
  - The up-to-three **Call Action** buttons render with their configured labels and shortcuts (`Alt+1`, `Alt+2`, `Alt+3`).
  - The Resource Panel shows links and info sheets.
  - The Client dropdown at the top of the call tab is **locked for 3 seconds** (nCall parity, anti-mis-assignment) and unlocks with a subtle indicator.
- **FR-C5.** Concurrently, the WebRTC audio leg is established: Asterisk PJSIP WS endpoint ↔ Kamailio WSS ↔ SIP.js softphone, with DTLS-SRTP fingerprints exchanged via rtpengine. The operator hears the caller on accept.
- **FR-C6.** The operator selects a **Call Action**. Action types:
  - `take_message` — opens the per-account custom form.
  - `transfer_blind` — dials a fixed number and detaches.
  - `transfer_supervised` — dials a fixed number, operator stays on hold until the third party answers, then bridges or returns.
  - `info_display` — surfaces a static information sheet (hours of operation, address, prices).
  - `external_command` — sends form data to a configured webhook and (optionally) opens a form.
  - `temporary_action_override` — same as one of the above but valid only within a configured time window (e.g. "between 8 PM and 8 AM use this script").
- **FR-C7.** When a `take_message` action is chosen, the per-account **Form** opens in the lower pane:
  - Required fields render with **pink background**.
  - Multi-page forms render with a page indicator and Next/Previous buttons.
  - Conversational prompt text is interleaved between fields as plain labels.
  - "Insert timestamp" buttons next to date/time fields.
  - "Common Message Text" snippets accessible from a sidebar.
  - "Reassign To" field at the bottom lets operator route the message to a different contact than the default.
- **FR-C8.** Call controls (top-left widget):
  - `Answer` (auto on accept), `Hold` / `Unhold`, `Swap Hold` (multi-line), `Transfer` (blind + supervised), `Conference`, `Hang Up`.
  - Right-click on the widget: Record / Pause Record / Conference-to-External.
  - DTMF pause-record via keypad sequence (configurable per tenant; default `*7` to pause, `*8` to resume).
- **FR-C9.** Multi-line: the operator may have multiple active or held calls simultaneously. The currently-live call is indicated by the **vertical blue bar**. Swap Hold rotates the live leg.
- **FR-C10.** On form save: required fields validated, the **Message** record is persisted, **Message Actions** for the selected destination contact(s) fire (immediate or scheduled). The call's wrap-up is considered complete. The operator's status returns to `Available`.
- **FR-C11.** On hangup without form save: the **Call** record is persisted with status `abandoned_by_operator` (operator didn't take a message). Audit logged.
- **FR-C12.** Operator-state machine: `LoggedIn` → `Available` → `OnCall` (one or more legs) → `Wrapping` (form open, post-hangup) → `Available`. Optional admin-configurable `Break`/`Lunch`/`Training` states. (nCall does not formally have these; we add them as a v1 improvement — they map cleanly onto a minimal nCall-compatible operator who simply doesn't toggle them.)
- **FR-C13.** Keyboard shortcuts (nCall parity + filling the gaps):
  - `Alt+1/2/3` — fire Call Action 1/2/3.
  - `Ctrl+Alt+F` — search across forms and call history (nCall parity).
  - `Ctrl+Alt+C` — copy formatted call data to clipboard (nCall parity).
  - `Ctrl+S` — save form.
  - `Ctrl+H` — hang up.
  - `Ctrl+Shift+Space` — toggle hold.
  - Configurable per-tenant, per-user override.

### 5.4 Custom forms (the scripting engine)

- **FR-F1.** Forms are authored in a **visual drag-and-drop builder** (admin UI), not code. Fields drag from a palette onto a canvas; properties are edited in a side panel.
- **FR-F2.** Field types: text, multiline text, dropdown, checkbox, radio, date, time, date+time, phone-number (auto-format + validation), email, currency, reference number (auto-generated), recipient picker (lookup into contacts), file attachment (image/audio note), repeating group (for multi-item forms — "take several orders in one call"), display-only label, computed field (formula over other fields), call-action chooser (sub-form branch).
- **FR-F3.** Required-field enforcement at save with `pink` highlight; admin-configurable per-field `relaxed_on_draft` flag for save-as-draft.
- **FR-F4.** Conditional logic: show/hide fields based on the value of a prior field. We *exceed* nCall's documented capability here because the alternative is the multi-form-via-multiple-Call-Actions workaround — a single form with branching is cleaner.
- **FR-F5.** Form versioning: every save creates a new immutable version. Active version is `current`. Old messages reference the version they were filled against. This avoids reporting bugs when a form changes mid-period.
- **FR-F6.** Form preview / test-fill in the admin UI without saving a Message.
- **FR-F7.** Per-account form binding: many forms per account, each triggered by a specific Call Action.
- **FR-F8.** Hyperlink-command tokens in label text: `[Dial:+15551234]`, `[Search:order#1234]`, `[Client:42]`, `[Contact:99]` — clicking triggers the corresponding action in the operator console.
- **FR-F9.** Form export/import as JSON for inter-tenant template sharing (admin tool).

### 5.5 On-call schedules

We support **two coexisting schedule models** — status-driven (nCall parity) and calendar-driven (modern). Both contribute to a single "who is on-call right now" query.

- **FR-S1.** **Status-driven**: each contact has an `availability_status` (Available / Unavailable / Vacation / Custom) that they self-update via the client portal or admin sets on their behalf. Per-account routing rules read these statuses and pick the first-available contact in the configured order.
- **FR-S2.** **Calendar-driven**: each account has zero-or-more **OnCallSchedule** entities with rotation rules (daily/weekly/monthly/custom-cron), tier (primary/secondary/escalation), date overrides (holidays), assigned contact per shift. Schedules can be imported from Google Calendar or Outlook (ICS subscription, per-tenant OAuth integration).
- **FR-S3.** A **WhoIsOnCall(account_id, at_time)** query returns the ordered list of contacts for that account at that moment, by merging both models. Calendar overrides status if a shift is explicitly assigned; otherwise status is the fallback.
- **FR-S4.** Schedule UI: a calendar grid (week/month view) per account showing assigned contacts; drag to reassign; copy-week-forward action.
- **FR-S5.** Coverage gap detection: an admin report shows windows where no on-call contact is assigned. Operator console flashes a warning if a call arrives during a coverage gap.
- **FR-S6.** Escalation tier behaviour: a Message Action can be marked `escalation_after_minutes=N` — if not ACK'd within N minutes, the next tier's Message Actions fire.

### 5.6 Dispatch — Message Actions

- **FR-D1.** Each contact has zero-or-more **Message Actions**. A Message Action specifies: channel (email/SMS/outbound-phone/webhook/push), destination (email address, phone number, webhook URL, push device token), trigger (`immediate` on form save, or `scheduled` at relative-time-after-save), conditional filter (only fire if message field X = Y), template (the body content with form-field tokens).
- **FR-D2.** Email channel: SMTP via configurable provider (SendGrid, AWS SES, Mailgun, or generic SMTP per tenant). HTML + plain text. Per-tenant DKIM/SPF setup. Open-tracking via SendGrid webhook callback writes back to Message.delivered_at and read_at.
- **FR-D3.** SMS channel: Twilio, Telnyx, or generic API per tenant. Delivery receipts via provider webhook write back to Message status.
- **FR-D4.** Outbound phone / patch-through channel: NestJS issues AMI `Originate` to call the recipient; on answer, optionally bridges with the original caller (live patch) or plays a TTS message; recipient ACK by DTMF digit, which writes back to Message and stops further escalation.
- **FR-D5.** Webhook channel: HTTP POST/PUT/PATCH with configurable headers, body templated from message fields, auth (Bearer/Basic/API-key/OAuth2). Retries with exponential backoff. Success criteria configurable per webhook (2xx / specific JSON predicate).
- **FR-D6.** Mobile push channel: FCM (Android) and APNS (iOS) for the future on-call mobile app. Payload is encrypted (E2E from tenant KEK → device key); device renders summary; full message visible only inside the app.
- **FR-D7.** Confirmed delivery / ACK: every dispatch has a state machine — `pending` → `sent` → (`delivered` | `failed`) → (`acknowledged`). Escalation is triggered by absence of `acknowledged` within the configured timeout.
- **FR-D8.** STAT / urgent flag: escalates priority — bypasses scheduled queue, fires all configured channels simultaneously, increments retry frequency, surfaces a banner alert in the client portal.
- **FR-D9.** Scheduled / recurring messages: Message Actions can be scheduled in the future (single-fire) or recurring (daily/weekly).
- **FR-D10.** Dispatch dashboard: per-tenant view of dispatches in flight, their channel, attempt count, last error.

### 5.7 Call recording and PCI redaction

- **FR-R1.** Recording is **on by default**. Per-tenant and per-account toggle to opt out.
- **FR-R2.** Recording is performed by Asterisk **MixMonitor** writing a per-leg WAV to a per-tenant directory. On call end, a NestJS worker picks up the file (inotify or AMI `MonitorStop`), encrypts it, and uploads to S3-compatible storage.
- **FR-R3.** **Envelope encryption**: per file we generate a 256-bit DEK; we encrypt the WAV with AES-256-GCM; we encrypt the DEK with the **per-tenant KEK** in KMS; we store the encrypted DEK in S3 object metadata alongside the encrypted WAV.
- **FR-R4.** **PCI pause**: triggerable by the operator via UI button (NestJS issues AMI `MixMonitorMute Direction=both State=1`) or via DTMF sequence from caller (Asterisk dialplan `*7`/`*8`). The pause window is recorded as `[pause_start, pause_end]` metadata on the Recording row, and post-processing replaces those audio bytes with silence (sox/ffmpeg) so the file is **redacted, not just muted**.
- **FR-R5.** Retention: per-tenant configurable retention policy. Default 90 days; HIPAA accounts default 7 years (2555 days). S3 lifecycle rule transitions to Glacier after 90 days for long-retention tenants.
- **FR-R6.** Playback: client-portal and supervisor UI streams recordings via a signed, expiring URL. Decrypt-on-the-fly via a server-side proxy (do not give the browser the DEK).
- **FR-R7.** Recording metadata: tenant_id, call_uuid, channel_uniqueid, started_at, ended_at, duration_seconds, redaction_intervals (array of [start, end] pairs), encryption_key_id, storage_url, file_size_bytes, codec.
- **FR-R8.** Audit log entry for every play/download event.
- **FR-R9.** "Right to be forgotten" (GDPR): deleting a contact's PII triggers a workflow that locates recordings containing them (by call_uuid join), redacts the operator-form fields, and either deletes the recording or marks it `pii_purged` (per tenant policy).

### 5.8 Client portal

A separate web app served from a per-tenant subdomain (e.g. `acme-clients.example.com`). White-labelled (logo, primary color, custom domain optional).

- **FR-P1.** Login: per-tenant user pool of `client_portal_user`s, each linked to one Client Account.
- **FR-P2.** Inbox: list of recent Messages for the client's account, unread highlighted, filters by date/status/operator/form-type.
- **FR-P3.** Message detail: rendered Message form (read-only), dispatch history (which Actions fired, delivery status), associated recording (playable inline if recording is enabled for this client).
- **FR-P4.** Call history: every Call for this account with operator name, duration, disposition, link to recording.
- **FR-P5.** On-call management: per-contact availability status toggle; calendar-based schedule editor (drag a shift onto a date, assign contact); shows current "who is on-call right now" indicator.
- **FR-P6.** Contact management: edit own contacts, their Message Actions, their alternate phones.
- **FR-P7.** Reports: call volume by day/week/month, average response time, dispatch SLA.
- **FR-P8.** Settings: notification preferences for the portal user (email digest, web push when new message arrives).
- **FR-P9.** Audit-of-self: the client can see who in their organisation logged in when.

### 5.9 Supervisor real-time dashboard

- **FR-V1.** Live operator status grid: every signed-in operator with current state (`Available`/`OnCall`/`Wrapping`/`Break`), current call (if any), time-in-state.
- **FR-V2.** Live queue view: incoming calls awaiting accept, per-account queue depth, longest-waiting time, abandonment counter.
- **FR-V3.** Listen / Whisper / Barge: supervisor clicks an operator's active call → AMI `ChanSpy` is initiated with the appropriate mode. Audio is streamed to the supervisor's softphone via a dedicated `chanspy://` extension.
- **FR-V4.** Recording playback in real time (offset playback) of in-progress call for spot-QA, with HIPAA audit.
- **FR-V5.** Tag a call for QA review or training; tagged calls appear in a separate QA queue for later scoring (v1.x scorecard).
- **FR-V6.** "Coach" private chat: side-channel chat to an operator from supervisor without leaving their seat.

### 5.10 Operator Home page

Replicates nCall's six-panel Home tab. The Home tab is what the operator sees on first login and via the Home button.

- **FR-H1.** **Noticeboard**: rich text + hyperlinks; tenant-admin-managed; pinned items; expiration dates.
- **FR-H2.** **News**: shorter feed items, scoped by operator role or by specific client account, auto-expiring.
- **FR-H3.** **Stats**: bar graph of last 10 days' personal call volume, with two trend lines (blue daily-average, red cumulative).
- **FR-H4.** **My Calls**: list of the operator's recent calls (view, edit message, resend, print, mark-as-patched).
- **FR-H5.** **To Do**: personal checklist; supervisor-assigned items appear here flagged.
- **FR-H6.** **Tasks**: client-assigned billable jobs with color-coded status (Pending / In-Progress / On-Hold / Completed) and per-task notes.

### 5.11 Tenant administration

- **FR-X1.** Client Account CRUD with the wizards-and-templates first-class.
- **FR-X2.** Form Designer (drag-drop, versioned).
- **FR-X3.** Contact CRUD + Message Action editor.
- **FR-X4.** On-Call Schedule editor (calendar grid).
- **FR-X5.** User & Role management.
- **FR-X6.** Billing Scheme editor (per-minute/per-call/per-message/flat with inclusive minutes and rounding rules per scheme).
- **FR-X7.** DID management (assign DIDs to accounts; provision new DIDs via SIP-trunk API integration in v1.x).
- **FR-X8.** Integration settings (SMS provider, email provider, push provider, calendar provider, CRM webhook keys).
- **FR-X9.** Tenant settings (branding, time zone defaults, retention defaults, compliance toggles, password policy).
- **FR-X10.** Audit log viewer with filter by user/resource/time.
- **FR-X11.** Bulk import of accounts/contacts via CSV upload (with column-mapping wizard).

### 5.12 REST API (full surface)

See **§7.5** for the detailed inventory. Two coexisting surfaces:

- **FR-API1.** `/v1/...` — **nCall-compatible** subset. Verbatim URL contract, HTTP Basic Auth, XML/JSON/HTML content negotiation, `page_offset`/`page_limit`, field=value filtering with `today`/`yesterday`/`tomorrow` shorthands and `greater_than_YYYY-MM-DD`/`less_than_YYYY-MM-DD`, `output_fields=` projection, `field_names.{xml,json}` self-documentation.
- **FR-API2.** `/api/v2/...` — **modern** RESTful surface. JSON only, OpenAPI 3.1-described, OAuth2 + PAT auth, cursor pagination, RFC 9457 problem-details errors, webhook subscriptions, GraphQL-ish field selection via `?fields=`.
- **FR-API3.** Both surfaces are first-class — neither is deprecated. The `/v1` surface is *not* a translation layer; both serve from the same domain layer.
- **FR-API4.** Outbound **Web Message Actions** (nCall parity): admin-configurable HTTP webhooks fired on Message save, with templated body, configurable headers/auth.
- **FR-API5.** Webhook subscriptions for `/api/v2`: tenants subscribe to event types (`call.started`, `call.ended`, `message.created`, `message.dispatched`, `message.acknowledged`, `contact.created`, etc.) with HMAC-signed payloads and at-least-once delivery.

### 5.13 Tenant-of-clients billing

This is the billing the tenant uses to invoice *their* customers — distinct from how we bill the tenant.

- **FR-B1.** Per-tenant **Billing Schemes**: per-minute, per-call, per-message, per-SMS-sent, flat-fee, hybrid (flat + overage). Inclusive minutes, rounding (nearest 1s / 6s / 30s / 60s / round-up-1-min), period (monthly / 28-day / custom).
- **FR-B2.** A Client Account is assigned exactly one **active** Billing Scheme; scheme assignments are versioned (the scheme in effect at the time of a call is the one used for billing).
- **FR-B3.** A **BillingLineItem** is generated per billable unit (call-segment or message) into a per-tenant ledger, with all fields exportable.
- **FR-B4.** Billing CSV export with 50+ fields (call timestamps, durations, operator, account, scheme, rate applied, message channel, attempt count).
- **FR-B5.** Per-account billing summary report with totals and inclusive-minutes drawdown.
- **FR-B6.** **Transfer Monitor** equivalent: patch-through calls produce a separate billable line item for the transferred-leg duration.
- **FR-B7.** Out of MVP scope: AR module, payment processing, e-invoicing. CSV export + Xero/QuickBooks API push in v1.x.

### 5.14 Audit and compliance log

- **FR-AU1.** Append-only PostgreSQL table `audit_log` with: `tenant_id`, `actor_user_id`, `actor_ip`, `timestamp`, `action`, `resource_type`, `resource_id`, `before_value` (JSONB), `after_value` (JSONB).
- **FR-AU2.** Database-level write protection via PostgreSQL `RULE`/RLS to block UPDATE and DELETE on this table; rotation by partition is the only way to remove old entries.
- **FR-AU3.** Every administrative action (CRUD on client/contact/form/schedule/user/billing) emits an entry.
- **FR-AU4.** Every recording pause/resume emits an entry.
- **FR-AU5.** Every API call from a CRM integration emits an entry (logged at gateway).
- **FR-AU6.** Every recording listen/download from supervisor or client portal emits an entry.
- **FR-AU7.** Audit-log viewer in admin UI with tenant-scoped filter and CSV export.

### 5.15 Observability (functional view)

- **FR-O1.** Real-time **call flow inspector** — admin can search by call UUID and see: SIP trace (Homer), Asterisk channel events, ARI events, dispatch attempts, end-to-end latency.
- **FR-O2.** **Operator-experience monitor**: per-operator metrics — average accept time, average form-completion time, error counters.
- **FR-O3.** **Tenant health page** for tenant admin: queue depth, recent dispatch failures, recording-upload-lag, DID/trunk-health summary.

---

## 6. Non-Functional Requirements

### 6.1 Performance and scale

- **NFR-P1.** Single Asterisk node: ≥ 100 concurrent calls on 4 vCPU / 8 GB RAM with Opus passthrough; ≥ 50 concurrent calls with Opus↔PCMU transcoding.
- **NFR-P2.** Single Kamailio node: ≥ 5,000 concurrent registrations (WSS + SIP), ≥ 200 INVITEs/second routing throughput.
- **NFR-P3.** Median operator screen-pop latency (INVITE on Asterisk → screen update in browser): ≤ 300 ms p50, ≤ 800 ms p95.
- **NFR-P4.** Median dispatch latency (form save → first-attempt channel `sent`): ≤ 3 s p50, ≤ 10 s p95.
- **NFR-P5.** Recording upload to S3: ≤ 30 s post-call for ≤ 10 min calls.
- **NFR-P6.** REST API: ≤ 200 ms p95 for read endpoints, ≤ 500 ms p95 for write endpoints, at 100 RPS sustained per tenant.

### 6.2 Availability and disaster recovery

- **NFR-A1.** Platform availability target: **99.9%** (≤ 43 min downtime / month) in MVP, **99.95%** by v1.x.
- **NFR-A2.** Kamailio runs **active-active** (≥ 2 nodes) behind an L4 load balancer, with `dmq` syncing `usrloc` and `htable`. Single Kamailio node failure does not drop in-flight calls (sticky dialog routing via `dialog` module DB-backed).
- **NFR-A3.** Asterisk pool: nodes are stateless from Kamailio's view. Node failure drops calls *on that node* but does not affect calls on other nodes. Draining: remove from dispatcher → wait for active channels to clear → stop container.
- **NFR-A4.** rtpengine: active-active pair, Kamailio fails over RTP relay on health check.
- **NFR-A5.** PostgreSQL: **Patroni** + `etcd` primary-replica with automatic failover; RPO ≤ 1 min, RTO ≤ 1 min.
- **NFR-A6.** S3-compatible storage: cross-region replication for HIPAA tenants.
- **NFR-A7.** NATS JetStream cluster ≥ 3 nodes for ARI event bus.
- **NFR-A8.** Backup and restore: PostgreSQL nightly + WAL streaming; recordings retained per S3 lifecycle; configuration backed up via git in our deployment repo. Quarterly DR drill.

### 6.3 Security and compliance

- **NFR-S1.** **TLS 1.2+** on every external surface: SIP/WSS, HTTPS web, REST API. Strong cipher suites only.
- **NFR-S2.** **SRTP/DTLS-SRTP** mandatory on every leg. Kamailio rejects INVITEs without SRTP for HIPAA-tagged tenants.
- **NFR-S3.** Per-tenant **KEK** stored in AWS KMS or HashiCorp Vault, never extracted. Per-file DEK envelope-encrypted with KEK. KEK rotation supported with re-encryption job.
- **NFR-S4.** Passwords: Argon2id, password policy admin-configurable per tenant.
- **NFR-S5.** Session management: short-lived (15 min) access tokens with refresh; idle timeout configurable; force-logout on admin action.
- **NFR-S6.** MFA: TOTP (RFC 6238) for tenant_admin and supervisor by default; opt-in for operator.
- **NFR-S7.** mTLS between internal services (NestJS ↔ Asterisk ARI, NestJS ↔ Postgres if external) where supported.
- **NFR-S8.** Database encryption at rest: PostgreSQL on encrypted volumes; sensitive columns (caller PII, message body) additionally encrypted at column level for HIPAA tenants.
- **NFR-S9.** Audit log: see §5.14.
- **NFR-S10.** **HIPAA**: BAA signed with all subprocessors (SIP trunk, SMS, email, cloud provider). 7-year recording retention default. No PHI in non-secure SMS body — only "you have a new message, login to portal" pointer.
- **NFR-S11.** **GDPR**: EU data residency (v1.x — separate EU stack); right-to-erasure workflow (§5.7); DPIA artifact for each tenant; cookie-banner on client portal.
- **NFR-S12.** **PCI-DSS** scope minimisation: card data is never recorded (pause/redact at media plane); preferred posture is to redirect DTMF card capture to a PCI-certified provider (Telnyx Pay or Stripe terminal) and bypass our Asterisk for card-entry segments entirely. Operators never see card data.
- **NFR-S13.** Anti-fraud at SBC: Kamailio `pike` rate limit (default 20 INVITEs / 2 s per source IP), GeoIP blocklist, secfilter, per-tenant toll-fraud monitor (sliding cost-per-minute window via Redis).
- **NFR-S14.** Penetration test at v1.0 launch and annually thereafter.

### 6.4 Observability

- **NFR-O1.** **SIP HEPv3** mirror from every Kamailio and Asterisk to a **Homer** cluster — every SIP message stored for 90 days, searchable.
- **NFR-O2.** **Prometheus** metrics from Kamailio (`xhttp_prom`), Asterisk (`res_prometheus`), rtpengine (built-in), NestJS (custom + node default), Postgres (postgres_exporter), Redis (redis_exporter). (coturn metrics added in v1.x when coturn is deployed — see §7.2.4.)
- **NFR-O3.** **Grafana** dashboards: trunk health, operator pool, recording pipeline lag, dispatch funnel, error rates per channel.
- **NFR-O4.** **OpenTelemetry** distributed tracing: propagate `X-Call-UUID` from Kamailio through Asterisk channel variable into ARI event into NestJS span context. Export to Jaeger or Tempo.
- **NFR-O5.** **Centralised structured logs**: all components emit JSON to stdout, collected by Vector/Fluent Bit, indexed in Loki or OpenSearch.
- **NFR-O6.** **Alerting**: PagerDuty/Opsgenie wired to Prometheus Alertmanager. Default alerts: trunk down, Asterisk node unreachable, recording-upload-lag > 5 min, dispatch failure rate > 5% over 10 min, Postgres replication lag > 10 s.

### 6.5 Maintainability and developer experience

- **NFR-M1.** All services run as containers. **Single source of truth is a `docker compose` stack** that runs the full system end-to-end on a developer laptop (one command, no manual steps after clone). Production uses the same images, with Kubernetes (or Nomad) manifests as a separate orchestrator layer — but the platform must never *require* Kubernetes to run locally for development or debugging.
- **NFR-M2.** Local-dev stack (`docker-compose.yml` at repo root) must include: Kamailio, rtpengine, ≥1 Asterisk node, NestJS API, Postgres, Redis, NATS, MinIO (S3-compatible), Homer, Prometheus + Grafana, web admin, web operator console, client portal. A `docker-compose.override.yml` enables hot-reload (bind-mounted source) for the NestJS and frontend containers.
- **NFR-M3.** `make dev-up` (or `pnpm dev`) brings the stack up, runs migrations, seeds at least one tenant + sample accounts + sample contacts + sample DIDs + a synthetic SIP trunk emulator (sipp or Asterisk-as-trunk in a sidecar container). After `dev-up`, an operator can log into the web console at `http://localhost:3000`, register the SIP.js softphone, place a test call via the sidecar trunk, and see the full flow without touching the public internet.
- **NFR-M4.** `make dev-down` cleanly tears the stack down. `make dev-reset` wipes volumes and re-seeds.
- **NFR-M5.** Local dev must not require any cloud credentials. KMS is stubbed in local mode with a developer-readable JSON keystore; SMS/email/push providers are stubbed with log-only adapters; SIP trunk is the sidecar emulator. The same code paths run; only the adapters differ via env var (`NCALL_ENV=local`).
- **NFR-M6.** Configuration as code: Asterisk config templated (Jinja or similar) from PostgreSQL via PJSIP realtime; Kamailio uses `kemi` Lua scripts versioned in git.
- **NFR-M7.** Database migrations versioned with a tool like `node-pg-migrate` or Flyway; migrations are forward-only.
- **NFR-M8.** API contract is OpenAPI 3.1 for `/api/v2`; CRM-compatibility surface `/v1` documented by example.
- **NFR-M9.** Test suite: unit tests for NestJS services; **integration tests run against the same `docker compose` stack** developers use (real Kamailio + Asterisk + Postgres, no in-memory mocks for telephony); smoke tests for the CRM-compatibility API run on every PR.
- **NFR-M10.** Feature flags: per-tenant feature flags surfaced via NestJS; used for staged rollout (e.g. AI features, calendar sync).

---

## 7. Technical Architecture

### 7.1 Component diagram (reference)

```
                       ┌────────────────────────────────────────────────────────────┐
                       │                       Public Internet                       │
                       └──────┬──────────────────────┬─────────────────┬───────────┘
              SIP/TLS:5061    │   WSS:443 (WebRTC)   │ HTTPS:443        │ HTTPS:443
                              │                      │ (admin/portal)   │ (REST API)
                       ┌──────▼──────────────────────▼─────────────────▼───────────┐
                       │                       L4 / L7 Load Balancers              │
                       │              (AWS NLB / HAProxy for SIP;                  │
                       │               Cloudfront / nginx for HTTPS)               │
                       └──────┬──────────────────────┬─────────────────┬───────────┘
                              │ SIP                  │ WebSocket        │ HTTP(S)
                       ┌──────▼──────────────────────▼─────────┐ ┌──────▼─────────┐
                       │       Kamailio SBC (active-active)    │ │  NestJS API +  │
                       │  registrar · dispatcher · TLS · WSS · │ │  Admin BFF     │
                       │  auth · pike · topology_hiding ·      │ │ (stateless)    │
                       │  nathelper · siptrace (HEPv3) · DMQ   │ └──┬─────────────┘
                       └──────┬──────────────────────┬─────────┘    │ ARI WS / AMI / REST
                              │ SIP internal         │ rtpengine    │
                              │                      │  control     │
                              │              ┌───────▼────────┐     │
                              │              │  rtpengine     │     │
                              │              │  (media plane) │     │
                              │              │  in-kernel fwd │     │
                              │              │  SRTP↔RTP, ICE │     │
                              │              └───────┬────────┘     │
                              │                      │ UDP media     │
                       ┌──────▼──────────────────────▼─────────┐    │
                       │       Asterisk Pool (Docker)          │◄───┘
                       │   ast-1 · ast-2 · ast-N               │
                       │   PJSIP · ARI :8088 · res_prometheus  │
                       │   MixMonitor → /recordings volume     │
                       │   per-tenant context + auth + AoR     │
                       └──┬─────────────┬──────────────────────┘
                          │ CDR/CEL     │ recordings (raw WAV)
                          │             │
                  ┌───────▼───────┐  ┌──▼─────────────────────────────────┐
                  │ PostgreSQL    │  │  NestJS Recording Worker           │
                  │ Patroni HA    │  │  - inotify / AMI MonitorStop event │
                  │ - tenants     │  │  - generate DEK, encrypt WAV       │
                  │ - accounts    │  │  - wrap DEK with KMS KEK           │
                  │ - contacts    │  │  - upload to S3                    │
                  │ - users       │  │  - delete local                    │
                  │ - calls (CDR) │  └────────────────┬───────────────────┘
                  │ - messages    │                   │
                  │ - schedules   │              ┌────▼────────────┐
                  │ - audit_log   │              │  S3 / MinIO     │
                  │ - recordings  │              │  per-tenant     │
                  │   (metadata)  │              │  prefix +       │
                  │ - billing     │              │  KEK identifier │
                  └───────────────┘              └─────────────────┘

                  ┌──────────────────────────┐  ┌──────────────────────────┐
                  │  Redis / NATS JetStream  │  │  KMS / Vault             │
                  │  - ARI event fanout      │  │  - per-tenant KEK        │
                  │  - rate-limit counters   │  │  - rotation jobs         │
                  │  - presence              │  └──────────────────────────┘
                  │  - dispatch queue        │
                  └──────────────────────────┘

                  ┌──────────────────────────────────────────────────────┐
                  │  Homer + Prometheus + Grafana + Loki + Jaeger/Tempo  │
                  └──────────────────────────────────────────────────────┘

  (TURN/coturn deferred — see §7.2.4. rtpengine acts as the public media
   relay; browsers reach it directly via ICE=force server-reflexive
   candidates. TURN is added in v1.x when operators behind restrictive
   corporate NAT become a measurable failure case.)

  Web admin (React) ──HTTPS──► NestJS BFF ──► Postgres + Redis + ARI/AMI
  Web softphone (SIP.js) ──WSS──► Kamailio ──► Asterisk PJSIP WS
  Client portal (React, per-tenant subdomain) ──HTTPS──► NestJS BFF (scoped)
  CRM integration ──HTTPS──► NestJS /v1/* (Basic Auth) or /api/v2/* (OAuth)
  SIP trunk (Telnyx / Twilio / Bandwidth) ──SIP/TLS──► Kamailio
```

### 7.2 Telephony plane

#### 7.2.1 Kamailio SBC

Kamailio is the **sole SIP-signalling entry point**. Modules used:

- `tls`, `websocket`, `http_async_client` — transports.
- `dispatcher`, `dialog`, `topology_hiding`, `registrar`, `usrloc` — routing & state.
- `auth`, `auth_db` — credential check.
- `nathelper`, `rtpengine` — NAT detection (signalling) + rtpengine control socket.
- `pike`, `secfilter`, `geoip2`, `htable` — anti-abuse.
- `siptrace` — HEPv3 mirror to Homer.
- `dmq`, `dmq_usrloc` — active-active state sync.
- `xhttp`, `xhttp_prom` — control API + Prometheus metrics.

Dispatcher uses algorithm 10 (least-loaded, OPTIONS-probed) to spray new INVITEs across the Asterisk pool. The `dialog` module persists the picked-node mapping into Postgres so in-dialog messages route correctly even across a Kamailio failover.

**Crucial decision (resolved):** Kamailio *cannot* handle full NAT traversal alone. Its `nathelper` rewrites SIP headers; it does *not* relay media bytes. **rtpengine is mandatory** for our WebRTC + SIP-trunk topology.

#### 7.2.2 rtpengine

rtpengine handles every media stream. It runs as a sidecar to each Kamailio node (Unix socket, zero network hop) with `--in-kernel-forwarding` (iptables/nftables) for line-rate throughput on relay-only paths. It performs:

- DTLS-SRTP termination on the WebRTC side.
- ICE termination (so Asterisk sees plain RTP from a private relay address).
- SRTP↔RTP bridging in both directions.
- Codec transcoding (Opus↔PCMU/A) when the trunk does not support Opus — falls out of kernel forwarding into userspace, CPU-bound.
- Recording fork via `--recording-method=pcap` or SIPREC for tenants who require independent compliance recording.

#### 7.2.3 Asterisk pool

Asterisk runs as Docker containers (image based on `asterisk/asterisk` 20-LTS or 22-LTS). Each container:

- Loads PJSIP config from PostgreSQL via realtime (`res_pjsip_config_wizard` + `extconfig.conf` mapping to `ps_endpoints`, `ps_aors`, `ps_auths` tables).
- Exposes ARI on internal port 8088 with TLS.
- Exposes AMI on internal port 5038 with TLS (or local-only).
- Exposes `res_prometheus` metrics on `/metrics`.
- Writes CDR and CEL to PostgreSQL directly.
- Writes recordings to a per-tenant subdirectory under a `/recordings` volume.

**Multi-tenancy model (resolved):** **Model B** — N tenants per Asterisk, with each tenant having a dedicated dialplan `context`, dedicated PJSIP `auth`, `aor`, `endpoint` configured via realtime. For HIPAA-strict tenants, escalate to **Model A** (dedicated Asterisk container) — the orchestration premium is justified by the cryptographic isolation guarantee.

Horizontal scaling: add an Asterisk container, register it with Kamailio dispatcher via `kamcmd dispatcher.add`. Sticky routing via Kamailio's `dialog` module ensures in-flight calls stay on the chosen node; new calls go to the new pool member.

Draining for upgrade:

1. `kamcmd dispatcher.set_state ip <node> i` (mark inactive).
2. Wait for ARI `GET /channels` on the node to return empty (or timeout).
3. Stop the container.
4. Deploy new version. Register fresh.

#### 7.2.4 TURN (deferred — not in MVP)

**Not deployed in MVP.** Rationale: the MVP scope is **PSTN inbound to web operators**, with rtpengine running on a publicly-addressable host. rtpengine, when configured with `ICE=force` on the WebRTC offer, advertises its own public address as a server-reflexive ICE candidate; browsers behind common NAT topologies (most home and small-office routers) connect directly to it without needing a separate TURN relay. We accept the small failure population (operators behind symmetric or restrictive corporate NATs) as a known limitation for MVP.

**Deferred to v1.x.** When measurable WebRTC connectivity failures appear in production — typically when onboarding tenants with operators on locked-down corporate networks — we add **coturn** as a TURN/STUN service alongside rtpengine. The integration is well-understood and additive: coturn deployed as a Docker service, NestJS generates time-limited HMAC credentials (`use-auth-secret`, 24 h TTL, static secret rotated monthly), SIP.js receives `iceServers` pointing at coturn at session-init time. No re-architecture is required to add it later.

**Design hooks left in place for the future:**
- SIP.js client takes `iceServers` from a NestJS-served config endpoint. In MVP this returns an empty array; adding TURN later only changes that endpoint's response.
- Network plan reserves UDP port range `49152–65535` on the future TURN host.
- Provisioning code path for time-limited TURN credentials is sketched in §6.3 NFR-S6 but not implemented in MVP.

#### 7.2.5 NestJS control plane (telephony side)

- **AriService**: maintains one WebSocket per Asterisk node (using `@ipcom/asterisk-ari`); subscribes to a per-tenant Stasis app name (`tenant_<id>_app`).
- **AmiService**: bulk admin actions (Originate, MixMonitorMute, ChanSpy, reload).
- **EventBus** (NATS JetStream): publishes high-level events (`call.started`, `call.ended`, `recording.completed`, `dispatch.completed`) for fan-out to other NestJS replicas and downstream subscribers.
- **CallOrchestrator**: state machine per active call. Resolves DID → tenant + account, fires screen-pop event, listens for operator-accept event, originates outbound legs for transfer/conference, fires recording start/pause, drives form-save → dispatch chain.

### 7.3 Application plane (NestJS)

A modular monolith deployed as multiple replicas behind an internal load balancer. Modules:

- `tenant`, `auth`, `users`, `accounts`, `contacts`, `forms`, `messages`, `calls`, `recordings`, `dispatch`, `schedules`, `billing`, `tasks`, `reminders`, `notices`, `news`, `audit`, `api_v1`, `api_v2`, `ari`, `ami`, `events`, `webhooks`, `integrations` (CRM/calendar/SMS/email/push providers).

Persistence: TypeORM or Prisma against PostgreSQL. Caches: Redis (presence, rate-limits, session). Event bus: NATS JetStream.

NestJS replicas are stateless. Each replica can subscribe to ARI WebSockets but only **one** replica owns a given Asterisk node's WebSocket at a time, elected via Redis lock with TTL; other replicas consume ARI events from the NATS bus.

### 7.4 Frontend plane

- **Web Operator Console**: React + TypeScript + Vite. SIP.js for WebRTC. WebSocket (via NestJS) for screen-pop and event push. Layout matches nCall desktop (see §5).
- **Web Admin**: React, separate routes from operator console but shared component library.
- **Client Portal**: React, served from per-tenant subdomain, NestJS BFF scoped to client_portal_user.

Component library shared via a `packages/ui` workspace. State management via Zustand or TanStack Query for server state. Theme: light-default with strong blue accents (matching nCall), per-tenant brand colour override.

### 7.5 REST API surface

#### 7.5.1 nCall-compatible `/v1`

Verbatim contract for resources the CRM uses today. Auth: HTTP Basic Auth (operator credentials). Format: XML default, JSON via `.json` suffix, HTML via `.html` suffix.

| Resource | Path | Methods | Notes |
|----------|------|---------|-------|
| Server time | `/time.{xml\|json}` | GET (unauth) | |
| Me | `/v1/me.{xml\|json}` | GET | Returns current authenticated user |
| Users | `/v1/Users.{xml\|json}` and `/v1/Users/<id>.{xml\|json}` | GET, POST, PUT, DELETE | |
| Calls | `/v1/Calls.{xml\|json}` and `/v1/Calls/<id>.{xml\|json}` | GET, POST, PUT, DELETE | |
| Messages | `/v1/Messages.{xml\|json}` and `/v1/Messages/<id>.{xml\|json}` | GET, POST, PUT, DELETE | |
| Contacts | `/v1/Contacts.{xml\|json}` and `/v1/Contacts/<id>.{xml\|json}` | GET, POST, PUT, DELETE | |
| Todo | `/v1/todo.json` (and `/v1/todo/<id>.json`) | GET, POST, PUT, DELETE | |
| Clients | `/v1/Clients.{xml\|json}` and `/v1/Clients/<id>.{xml\|json}` | GET, POST, PUT, DELETE | Our addition under /v1; nCall exposes this implicitly. We add it for CRM completeness. |
| OnCall | `/v1/OnCall.{xml\|json}?account_id=…&at=…` | GET | Returns current on-call contact set |
| KPI | `/v1/Calls/kpi.{xml\|json}` | GET | Aggregate counters |
| Billing | `/v1/clients/<id>/billing.{xml\|json}?StartDate=…&EndDate=…` | GET | |
| Field names | `/v1/<Resource>/field_names.{xml\|json}` | GET | Self-documenting |

**Filtering**: `?field=value`, with `today`/`yesterday`/`tomorrow` shorthands on date fields, `greater_than_YYYY-MM-DD` / `less_than_YYYY-MM-DD` comparators.
**Pagination**: `?page_offset=1&page_limit=50` (1-indexed). Response includes link to next page.
**Field selection**: `?output_fields=Field1,Field2,Field3`.
**Field schema (Call)**: `PbxCallID, ParentCallID, ContactID, OperatorID, FormID, CallStart, CallAnswered, CallEnd, CallEndOperator, CallType, CallPriority, CallerNumber, CallerName, CallerCompany, NotesSmall, NotesLarge, NotesSms, RelayID, DeliveredWhen, Status, NoCharge, IncomingTelNoID, TransferNumber, CallFinishedID, ID`.

**Web Message Actions** (outbound webhook): `POST /v1/admin/web_message_actions` admin endpoint creates the configurable webhook templates fired on Message save.

**Versioning posture**: maintain `/v1` indefinitely as the CRM-compatibility floor. New endpoints land in `/api/v2`.

#### 7.5.2 Modern `/api/v2`

- JSON only, `application/json` content type.
- OAuth2 (Authorization Code + PKCE for users, Client Credentials for service integrations) and Personal Access Tokens.
- OpenAPI 3.1 spec served at `/api/v2/openapi.json`, with Swagger UI at `/api/v2/docs`.
- Cursor pagination (`?cursor=…&limit=…`), `Link: rel=next` header.
- Errors per RFC 9457 problem-details.
- Webhook subscriptions: `POST /api/v2/webhooks` with `url`, `event_types`, `secret`. We send HMAC-SHA256 signed payloads, retry with exponential backoff, support replay.
- Field selection via `?fields=field1,field2,nested.field`.
- All resources in `/v1` are mirrored with normalised modern names.

### 7.6 Data model (core entities)

Approximate ERD; not exhaustive. PostgreSQL; `tenant_id` on every domain table; RLS enabled.

```
Tenant
  - id, name, slug, sip_domain, kek_id, retention_default_days,
    compliance_flags (jsonb: { hipaa, gdpr, pci, baseline }),
    branding (jsonb), created_at

User                          (operator / admin / supervisor / api_integration / portal)
  - id, tenant_id, username, email, password_hash, roles[], retired,
    mfa_secret, mfa_required, first_name, last_name, mobile, last_login_at

ClientAccount  (a.k.a. Company)
  - id, tenant_id, name, account_number, type, color, greeting_text,
    general_notes, sensitive_notes, time_zone, billing_scheme_id,
    call_actions[3] (jsonb), retired

DID  (IncomingTelNo)
  - id, tenant_id, e164, label, account_id, default_call_action,
    inbound_route (jsonb), created_at

Contact
  - id, tenant_id, account_id, first_name, last_name, mobile,
    email, alt_phone, vip, ignore, availability_status, retired

MessageAction        (per contact, unlimited)
  - id, tenant_id, contact_id, channel, destination,
    trigger (immediate / scheduled), schedule_offset_seconds,
    filter (jsonb), template_id, escalation_after_seconds, priority

Form
  - id, tenant_id, account_id, name, version, definition (jsonb),
    active_version_id, created_by, created_at

Call            (CDR superset)
  - id, tenant_id, account_id, did_id, operator_id, form_id,
    pbx_call_id, parent_call_id, call_type, call_priority,
    caller_number, caller_name, caller_company,
    call_start, call_answered, call_end, call_end_operator,
    notes_small, notes_large, notes_sms,
    relay_id, delivered_when, status, no_charge,
    transfer_number, call_finished_id, billable

Message
  - id, tenant_id, call_id, account_id, form_id, form_version_id,
    operator_id, content (jsonb), timestamp_added, tx_code,
    delivery_state, urgent_flag

Dispatch          (one per MessageAction firing)
  - id, tenant_id, message_id, contact_id, message_action_id,
    channel, destination, state, attempted_at, delivered_at,
    acknowledged_at, error, retry_count, payload_snapshot (jsonb)

OnCallSchedule
  - id, tenant_id, account_id, tier (primary/secondary/escalation),
    rrule (RFC 5545), contact_id, valid_from, valid_until, source
    (manual / google / outlook)

OnCallShift     (materialised from schedules + overrides)
  - id, tenant_id, account_id, contact_id, tier, start_at, end_at, source

Recording
  - id, tenant_id, call_id, started_at, ended_at, duration_seconds,
    storage_url, encrypted_dek (bytea), kek_id, codec,
    redaction_intervals (jsonb), retention_expires_at, pii_purged

BillingScheme
  - id, tenant_id, name, model (per-minute / per-call / per-message /
    flat / hybrid), rate, inclusive_minutes, rounding_seconds,
    period (monthly / 28-day / custom), effective_from, effective_until

BillingLineItem
  - id, tenant_id, account_id, scheme_version_id, call_id, message_id,
    billable_quantity, rate_applied, amount, period_start, period_end, generated_at

Task            (client-assigned billable job)
  - id, tenant_id, account_id, assignee_user_id, title, description,
    state (pending / in-progress / on-hold / completed),
    billing_mode (timed / fixed), rate, inclusive_minutes,
    total_seconds_logged, fixed_amount, created_at, completed_at

Reminder
  - id, tenant_id, user_id (target operator), account_id (optional),
    title, body, due_at, fired_at, snooze_until, dismissed_at

Notice / News / Noticeboard
  - id, tenant_id, kind (notice / news), title, body (rich),
    scope (role / account_id), pinned, expires_at, created_by, created_at

AuditLog        (append-only, partitioned by month)
  - id, tenant_id, actor_user_id, actor_ip, timestamp, action,
    resource_type, resource_id, before_value (jsonb), after_value (jsonb)
```

### 7.7 Recording pipeline

```
Asterisk:
  MixMonitor(${UNIQUEID}.wav, b, /usr/local/bin/post_record.sh ${UNIQUEID} ${TENANT_ID})

post_record.sh:
  POST AMI event → NestJS recording-worker queue (NATS)

NestJS recording-worker:
  1. Read raw WAV from shared volume / fetch from Asterisk over SSH/SFTP
  2. Apply redaction: for each [start, end] in redaction_intervals,
     overwrite samples with silence using sox
  3. Generate random 256-bit DEK
  4. Encrypt WAV with AES-256-GCM(DEK) → ciphertext + tag + IV
  5. Call KMS Encrypt(KeyId=tenant.kek_id, Plaintext=DEK) → encrypted_DEK
  6. Upload to S3: bucket=recordings, key=tenant_<id>/YYYY/MM/<uuid>.wav.enc
     metadata: tenant_id, call_uuid, encrypted_dek (b64), kek_id, redaction_intervals
  7. Write Recording row to PostgreSQL with storage_url and metadata
  8. Delete local WAV
  9. Emit recording.completed event
```

PCI pause:

```
Operator UI button → NestJS POST /calls/:id/pause-recording
  → AMI action MixMonitorMute Channel=… Direction=both State=1
  → record [pause_start=now] in active recording metadata
  → emit recording.paused event

Resume:
  → AMI action MixMonitorMute … State=0
  → record [pause_end=now]
```

DTMF pause via dialplan: caller-side or operator-side DTMF sequence (configurable per tenant) triggers the same path via Asterisk DTMF features and AMI bridging.

### 7.8 Dispatch pipeline

```
Form save (operator):
  → NestJS messages.create()
  → Persist Message row (in transaction)
  → Resolve target contact(s) → fetch their MessageActions
  → For each MessageAction:
      - If trigger=immediate: enqueue Dispatch on NATS dispatch-channel
      - If trigger=scheduled: schedule job at (now + offset) via Bull/BullMQ
      - If filter doesn't match: skip
  → Return 200 to operator

Dispatch worker (NestJS replica):
  → Pop Dispatch from queue
  → Update state = sent
  → Call channel adapter (email / sms / outbound / webhook / push)
  → On provider success: update state=delivered (or sent, then delivered on provider webhook)
  → On provider failure: state=failed, increment retry_count, schedule retry
  → If acknowledged event arrives (DTMF ACK on outbound, webhook on portal/app):
      → update state=acknowledged
      → cancel escalation timer
  → If escalation_after_seconds elapses without ack:
      → fire next-tier MessageActions
```

Provider adapters are per-tenant configurable; defaults at platform level (Twilio for SMS, SendGrid for email, FCM/APNS for push).

### 7.9 Deployment topology

**Production (small / launch)**:

- 2 × Kamailio (active-active, DMQ-sync), each with co-located rtpengine.
- 3 × Asterisk (Docker, behind dispatcher).
- 3 × NestJS API replicas (Docker, behind nginx).
- Patroni Postgres: 1 primary + 2 replicas + 3 etcd.
- Redis Sentinel: 1 primary + 2 replicas + 3 Sentinels.
- NATS JetStream: 3-node cluster.
- S3-compatible (MinIO for self-host or managed S3).
- Homer cluster (1 capture node + 1 web).
- Prometheus + Grafana + Loki + Jaeger stack.
- Total: ~23–28 containers, fits on 3–4 physical nodes.
- **No TURN/coturn in MVP** (see §7.2.4).

**Production (scale)**: Add Asterisk and NestJS replicas linearly. Add Kamailio nodes in pairs. Shard PostgreSQL by tenant in v2 if needed (not in v1 plan).

**Docker Compose for development is a first-class requirement** (NFR-M1 through NFR-M5): the entire stack must run on a developer laptop with a single command, with stubbed external adapters (KMS, SMS, email, push, SIP trunk emulator) so no cloud credentials are needed. **Kubernetes (or Nomad) for production**; both targets use the same container images, only the orchestrator manifests differ.

### 7.10 External integrations

| Category | Provider(s) | Auth | Notes |
|----------|-------------|------|-------|
| SIP trunk | Telnyx, Twilio, Bandwidth | API key per provider; SIP credentials per trunk | Telnyx and Twilio sign HIPAA BAAs |
| SMS | Twilio, Telnyx, generic | Same as trunk providers | |
| Email | SendGrid, AWS SES, generic SMTP | API key | DKIM/SPF setup per tenant |
| Push | FCM, APNS | OAuth (FCM), p8 cert (APNS) | For on-call recipient mobile app |
| Calendar | Google Calendar, Microsoft 365 | OAuth2 per tenant | Two-way sync of on-call schedules |
| CRM | Salesforce, HubSpot, generic webhook | OAuth2 (named) or signed webhook (generic) | |
| Trades FSM | ServiceTitan, HousecallPro | OAuth2 | v1.x |
| IT PSA | ConnectWise, Autotask | OAuth2 / API key | v1.x |
| KMS | AWS KMS, HashiCorp Vault | IAM / Vault token | Per-tenant KEK |
| Storage | AWS S3, MinIO, GCS | IAM | Per-tenant prefix |

---

## 8. Compliance Plan

A practical breakdown by framework.

### 8.1 HIPAA

- Sign **BAAs** with all subprocessors that may touch PHI: SIP trunk, SMS provider (only if non-PHI summary SMS), email provider, cloud, KMS.
- **No PHI in SMS/email body** — only "you have a new message, login to portal at <url>" pointer. The portal is the secure delivery surface.
- **Encryption in transit**: TLS 1.2+ everywhere, SRTP mandatory. Kamailio rejects non-SRTP INVITEs for HIPAA tenants.
- **Encryption at rest**: per-file DEK + per-tenant KEK via KMS. PostgreSQL volume-level encryption + column-level encryption of caller_name, caller_number, message body for HIPAA tenants.
- **Access controls**: role-based; MFA required for tenant_admin and supervisor; least-privilege RLS in DB.
- **Audit logs**: append-only, 6+ years retention (HIPAA), per §5.14.
- **Retention**: recordings 7 years default for HIPAA accounts.
- **Breach response plan**: incident playbook, 60-day notification window, dedicated security contact, table-top exercise quarterly.
- **Workforce training**: every internal hire signs HIPAA training acknowledgment; documented annually.

### 8.2 GDPR

- **EU data residency** for EU-domiciled tenants: separate stack in an EU AWS region (Frankfurt or Ireland). Routing by SIP-domain prefix or tenant flag in Kamailio.
- **DPA template** signed with every EU tenant.
- **Right to erasure** (Art. 17): documented workflow per §5.7. Deletes PII, redacts recordings, schedules KMS key version deletion.
- **Right to portability** (Art. 20): per-tenant data export (JSON + recordings) via admin UI button.
- **Data minimisation**: do not log SDP bodies in `siptrace` retention beyond 30 days for EU tenants; redact IPs from SIP traces after 30 days.
- **Cookie banner** on client portal with explicit consent for non-essential cookies.
- **DPIA artifact** per tenant for documentation.

### 8.3 PCI-DSS

- **Scope minimisation**: cardholder data never touches our recording. Strongly prefer **delegated capture**: during a card-entry step, the operator clicks "Capture Card" which invokes a PCI-certified IVR (Telnyx Pay, Stripe Terminal IVR) — the caller is routed temporarily to that provider, enters card data via DTMF directly into the provider, then returns to our operator. We never see, hear, or record the card.
- **Fallback**: when delegated capture is not available, the operator presses Pause Record and the dialplan also fires `*7` to mute MixMonitor; the redaction interval is logged and silenced post-process. We continue to recommend delegated capture for true PCI scope reduction.
- **Network segmentation**: Asterisk nodes that handle PCI traffic are in a separate VPC subnet from non-PCI Asterisk nodes; tenant routing enforces this.
- **Quarterly ASV scans, annual penetration test, SAQ-D** completion as appropriate to our handling level.

### 8.4 Baseline (everyone)

- TLS 1.2+ enforced.
- Password policy with reasonable defaults (configurable).
- TOTP MFA for admins.
- Audit log.
- Quarterly review of subprocessor list.

---

## 9. Commercial Model (Pricing Strategy)

This is **how we charge the tenant**, separately from how the tenant charges their clients.

### 9.1 Market positioning

Public price points in this space (latest available data):

| Vendor | ~Per-seat / month | Setup | Model |
|--------|-------------------|-------|-------|
| nSolve nCall | ~$65–80 (per 2021 leaked data; on-prem) | Low (hundreds) | On-prem rental or perpetual |
| Amtelco | ~$300 | ~$20,000 | On-prem subscription |
| Startel CMC | ~$375 | ~$17,000 | On-prem subscription |
| EVS7 Fox | $149 | Minimal | Cloud SaaS |
| Virtual TAS | $89 | $1,495 | Cloud SaaS |
| AI-native (Bland.ai etc.) | $25–200 flat | None | AI-native |

We target the **mid-market cloud SaaS** slot: more capable than EVS7/Virtual TAS, far more affordable than Amtelco/Startel, modern UX and AI built in, with the **only nCall-compatible REST API** as a differentiator for tenants migrating off nCall.

### 9.2 Pricing axes

- **Per concurrent operator seat** (primary axis) — tiered: 1–10 / 11–25 / 26–50 / 51+.
- **Included minutes / message volume bundle** at each tier, with overage rates.
- **Add-ons**: AI agent (per-minute), recording storage beyond default retention (per-GB-month), HIPAA mode toggle (per-seat surcharge), premium support tier.
- **Telephony pass-through**: DIDs + per-minute trunk costs billed at cost + a small margin; tenant sees a transparent line item. (Differentiator vs nCall which is BYO trunk.)
- **SMS / push / email**: pass-through at provider cost + small margin, with included monthly bundle.

### 9.3 Plans (working straw-man for v1)

| Plan | Seat price | Inclusive | Target |
|------|-----------|-----------|--------|
| Starter | $99/seat/mo, 1–10 seats | 500 calls + 200 SMS + 1 GB recording / seat | Boutique virtual receptionists, MSP after-hours |
| Growth | $79/seat/mo, 11–25 seats | 1,000 calls + 500 SMS + 5 GB / seat | Mid-size answering services |
| Scale | $59/seat/mo, 26+ seats | 2,500 calls + 1,000 SMS + 20 GB / seat | Large established TASes |
| HIPAA add-on | +$20/seat/mo | 7-year retention, BAA, EU/US residency choice | Medical |
| AI Receptionist (ChatJack-style) | $0.50/call | After-hours auto-attendant | Optional |

Annual commitment: 15% discount. Migration assistance bundle (~$2,000–5,000) to import nCall data and swap CRM endpoint. Free trial: 30 days, 2 seats, no card up-front, sandbox tenant.

### 9.4 Billing implementation

- **Stripe Billing** for tenant subscriptions (us → tenant).
- Metered usage reported to Stripe via the Meters API.
- Self-serve sign-up + checkout for Starter and Growth; sales-assisted for Scale.
- Self-serve cancellation; export-all-data button before cancellation completes.

---

## 10. Phased Roadmap

### 10.1 MVP (v1.0) — target 6–9 months

- §5.1, §5.2, §5.3, §5.4, §5.5 (status-driven + minimal calendar), §5.6 (all five channels), §5.7, §5.8, §5.9 (real-time + listen/whisper/barge), §5.10 (Home page), §5.11 (admin), §5.12 (full /v1, partial /api/v2 read-only), §5.13 (CSV export), §5.14 (audit log), §5.15 (call inspector).
- Telephony: Kamailio + rtpengine + Asterisk pool + NATS + Patroni Postgres + Redis Sentinel + Homer + Prometheus + Loki + Jaeger. **No TURN/coturn in MVP** — rtpengine acts as the public media relay; design hooks left in place for adding coturn later (see §7.2.4).
- Single-region (US-East), single SIP trunk integration (Telnyx primary, Twilio secondary).
- Compliance: HIPAA-ready (BAA chain, encryption posture), GDPR-compatible (right to erasure), PCI via delegated capture.
- One pilot tenant onboarded.

### 10.2 v1.1 — +3 months

- Native ServiceTitan and HousecallPro integrations.
- AI Receptionist (ChatJack-style) using LLM + ASR.
- QA scorecard module (ATSI criteria).
- EU-region deployment for first GDPR-strict tenant.
- Stripe Billing self-serve tenant onboarding.
- **TURN/coturn deployment** — when measurable WebRTC connectivity failures emerge from operators behind restrictive corporate NATs (see §7.2.4). Additive deployment; no re-architecture.

### 10.3 v1.2 — +3 months

- Native mobile **on-call recipient app** (iOS + Android).
- Salesforce + HubSpot native integration.
- Post-call AI summary + sentiment.
- Agent assist (advisory).

### 10.4 v2 — +6 months

- Multi-region with active-active.
- Omnichannel inbox (web chat + two-way SMS into operator console).
- Native ConnectWise / Autotask.
- Training mode (shadow + supervised takeover).
- Advanced reporting (cohort analytics, custom dashboards).

---

## 11. Risks and Open Questions

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|-----------|
| CRM integration breakage despite "compatible" API | High | Medium | Build smoke-test suite that exercises *exactly* the CRM's known consumed endpoints against our API on every PR; dry-run with a CRM sandbox before tenant cutover |
| nCall undocumented behaviours surface late | Medium | High | Reserve a "compatibility sprint" mid-build to discover quirks against a live nCall instance with the CRM connected; treat as deviations to document, not bugs |
| Asterisk + rtpengine + Kamailio operational complexity | High | Medium | Hire/contract a senior VoIP engineer for first 6 months; use Sipwise NGCP and Wazo Platform as reference architectures; lean on Homer for fast debugging |
| HIPAA + PCI overlap in same tenant is design-difficult | Medium | Medium | Default PCI to delegated capture only; document and recommend Telnyx Pay; HIPAA recording-by-default conflicts with PCI redaction → ensure redaction pipeline is correct from day one |
| Cost of recording storage at scale | Medium | High | S3 lifecycle to Glacier after 90 days; per-tenant retention defaults; bill recording overage as a metered add-on |
| Single-Asterisk-node failure mid-call drops in-flight calls | Low | High | Document this as accepted — no native mid-call migration; redundancy is at the node level, not the call level. Pool size kept above min-N |
| AI-native competitors commoditise the operator workflow | High | Medium (long-term) | Build AI agent as a first-class capability not an afterthought; position as "human-in-the-loop default + AI handoff" |
| GDPR EU data residency adds infra cost | Medium | Medium | EU stack only spun up when first EU tenant signs |
| Operators reject the web UI vs desktop habit | High | Low | Replicate nCall layout to the letter; usability test with three real nCall operators in the first MVP demo |
| nCall API contract changes break our compatibility shim | Low | Low | Pin to current `/v1`; no plan to track newer `/v6`/`/v7` versions unless CRM upgrades |
| Kamailio config complexity / mis-configuration → outage | High | Medium | Config-as-code in git, peer review every change, staging cluster mirroring prod, kemi Lua scripts hot-reloadable |
| WebRTC connectivity failures from operators behind symmetric/corporate NAT (no TURN in MVP) | Medium | Low–Medium | Accept as known MVP limitation. Monitor failed-ICE rate in production; trigger v1.1 coturn rollout when threshold breached. Design hooks already in place (§7.2.4) so no re-architecture is needed |
| Local-dev divergence from production (drift between docker-compose and k8s) | Medium | Medium | Same container images everywhere; only orchestrator manifests differ. CI runs integration tests against the same docker-compose stack developers use |

### Open questions to resolve before / during build

1. **Which SIP trunk provider is the primary?** Telnyx is recommended (HIPAA BAA, Opus support, modern API). Twilio as secondary failover.
2. **Single-region vs EU+US from day one?** Recommended: single-region (US-East) for MVP; EU stack when first EU tenant signs.
3. **Are we offering the tenant a choice of KMS (AWS KMS vs HashiCorp Vault)?** Recommended: AWS KMS only in v1, Vault offered for self-hosted enterprises in v2.
4. **Recording redaction approach for PCI**: do we ship delegated-capture in MVP or in v1.1? Recommended: MVP supports the pause+redact path; v1.1 adds Telnyx Pay delegation.
5. **Mobile push for client portal users in MVP, or only for on-call recipient app in v1.x?** Recommended: web push in MVP for portal; native mobile in v1.2.
6. **Operator hardware SIP phone provisioning**: do we ship a per-operator provisioning portal in MVP? Recommended: minimal — manual credential issue in MVP; auto-provisioning XML in v1.x.
7. **Calendar OAuth scopes**: Google/Outlook integrations — read-only in MVP, two-way sync in v1.1.
8. **Tenant SLA**: what uptime do we contractually offer? Recommended: 99.9% MVP, 99.95% v1.x.

---

## 12. Acceptance Criteria (Definition of Done for MVP)

The MVP is "done" when **all of the following are demonstrably true**:

1. A tenant can be created via admin tooling, with at least one client account, three contacts, one custom form, one billing scheme, one DID.
2. A test caller dials the DID from the public PSTN; the call rings into an authenticated operator's browser softphone; the screen pops with the right account, greeting, three Call Actions, caller history, VIP/Ignore badge.
3. The operator clicks Call Action 1 → form opens → fills required fields → saves → form data persists as a Message → Message Action fires email + SMS + outbound patch + webhook + push to configured destinations within 10 s, all observable in the dispatch dashboard.
4. The call is recorded; the recording is encrypted with the tenant KEK and uploaded to S3; an admin can play it back through the supervisor UI via a signed URL.
5. The operator clicks "Pause Recording" mid-call; the resulting WAV has silence in the paused interval and the Recording row has matching `redaction_intervals` metadata.
6. The CRM smoke-test suite (exercising every consumed `/v1` endpoint with real auth) passes 100% against our endpoint.
7. The supervisor dashboard shows the operator in `OnCall` state with the live call, and the supervisor can `ChanSpy` listen in.
8. The client portal user logs in, sees the new Message in their inbox, listens to the recording, updates a contact's availability status, and the operator's "Who is on-call" lookup reflects the change within 5 s.
9. A second Asterisk node is added to the dispatcher; a second wave of calls distributes across both nodes; the first node is drained and stopped without affecting in-flight calls on the second.
10. HIPAA, GDPR, and PCI checklist items are signed off against the implemented controls.
11. Observability stack: Homer captures the full SIP flow of the test call; Prometheus shows live metrics from all components; the Jaeger trace for the call includes a span from Kamailio → Asterisk → NestJS → dispatch.
12. Audit log shows the full chain of events for the test call (call started, form saved, message created, dispatches fired, recording paused, recording played back, contact status updated).
13. Documentation: tenant onboarding runbook, operator training quick-start, API integration guide for CRMs, runbook for primary on-call SRE.
14. **Local-dev parity gate**: a fresh `git clone` followed by `make dev-up` brings the entire stack up on a developer laptop with zero cloud credentials. Within ≤ 5 minutes a developer can place a synthetic test call through the sidecar SIP-trunk emulator, see the operator screen-pop in the local web console, take a message, and observe the dispatch firing against the stubbed adapters — all visible in local Homer, Prometheus, and Jaeger.

---

## 13. Glossary

- **TAS** — Telephone Answering Service. The business of answering inbound calls on behalf of other businesses.
- **TSR** — Telephone Service Representative. An operator/agent in the answering service.
- **Tenant** — One answering-service business on our SaaS.
- **Client Account** / **Account** — A business whose calls the tenant answers.
- **Contact** — A person associated with a Client Account (point of contact, on-call recipient, billing contact).
- **DID / DDI** — Direct Inward Dialing / Direct Dial-In number. The phone number a caller dials to reach an account.
- **CLI / ANI** — Caller Line Identification / Automatic Number Identification. The caller's phone number.
- **Call Action** — A preset operator-triggered workflow attached to an account (take-message, transfer, info-display).
- **Message** — The structured form record an operator fills during a call.
- **Message Action** — A configured dispatch instruction on a contact (email/SMS/outbound/webhook/push).
- **Dispatch** — An individual firing of a Message Action.
- **On-Call** — The contact who should receive messages right now for an account.
- **Patch / Patch-through** — Connecting the caller live to an on-call recipient via outbound dial.
- **STAT / Urgent** — High-priority flag bypassing normal dispatch ordering.
- **ATSI** — Association of TeleServices International (industry body).
- **CAM-X** — Canadian equivalent of ATSI.
- **NAEO** — National Amtelco Equipment Owners user group.
- **PHI** — Protected Health Information (HIPAA).
- **PII** — Personally Identifiable Information (GDPR).
- **PCI** — Payment Card Industry Data Security Standard.
- **BAA** — Business Associate Agreement (HIPAA).
- **DPA** — Data Processing Agreement (GDPR).
- **SBC** — Session Border Controller.
- **ARI** — Asterisk REST Interface.
- **AMI** — Asterisk Manager Interface.
- **PJSIP** — Asterisk's modern SIP stack.
- **HEPv3** — Homer Encapsulation Protocol v3, the SIP-trace format Homer captures.
- **KEK / DEK** — Key Encryption Key / Data Encryption Key (envelope encryption).
- **WSS** — WebSocket Secure.
- **SRTP** — Secure RTP (encrypted media).

---

## 14. Appendix A — nCall REST API endpoints we will implement under `/v1`

Drop-in compatible. Verbatim URL, verbatim Basic Auth, verbatim filter/pagination/field-selection semantics, verbatim default-XML response format with JSON via suffix.

```
GET    /time.{xml|json}                                  (unauth)
GET    /v1/me.{xml|json}                                 (Basic)

GET    /v1/Users.{xml|json}                              ?filters ?page_offset ?page_limit ?output_fields
GET    /v1/Users/<id>.{xml|json}
POST   /v1/Users.{xml|json}
PUT    /v1/Users/<id>.{xml|json}
DELETE /v1/Users/<id>.{xml|json}
GET    /v1/Users/field_names.{xml|json}

GET    /v1/Calls.{xml|json}                              (same query semantics)
GET    /v1/Calls/<id>.{xml|json}
POST   /v1/Calls.{xml|json}
PUT    /v1/Calls/<id>.{xml|json}
DELETE /v1/Calls/<id>.{xml|json}
GET    /v1/Calls/kpi.{xml|json}
GET    /v1/Calls/field_names.{xml|json}

GET    /v1/Messages.{xml|json}                           (same query semantics)
GET    /v1/Messages/<id>.{xml|json}
POST   /v1/Messages.{xml|json}
PUT    /v1/Messages/<id>.{xml|json}
DELETE /v1/Messages/<id>.{xml|json}
GET    /v1/Messages/field_names.{xml|json}

GET    /v1/Contacts.{xml|json}                           (same query semantics)
GET    /v1/Contacts/<id>.{xml|json}
POST   /v1/Contacts.{xml|json}
PUT    /v1/Contacts/<id>.{xml|json}
DELETE /v1/Contacts/<id>.{xml|json}
GET    /v1/Contacts/field_names.{xml|json}

GET    /v1/Clients.{xml|json}                            (additive — nCall exposes implicitly)
GET    /v1/Clients/<id>.{xml|json}
POST   /v1/Clients.{xml|json}
PUT    /v1/Clients/<id>.{xml|json}
DELETE /v1/Clients/<id>.{xml|json}
GET    /v1/Clients/<id>/billing.{xml|json}?StartDate=&EndDate=

GET    /v1/todo.json                                     (same query semantics)
GET    /v1/todo/<id>.json
POST   /v1/todo.json
PUT    /v1/todo/<id>.json
DELETE /v1/todo/<id>.json

GET    /v1/OnCall.{xml|json}?account_id=&at=             (our addition — nCall does not expose;
                                                          but the CRM may not need it)
```

**Filtering examples:**

```
GET /v1/Messages.json?TimestampAdded=today&TxCode=F
GET /v1/Calls.xml?CallStart=greater_than_2026-05-01&CallStart=less_than_2026-05-08
GET /v1/Contacts.json?Firstname=Jean&Lastname=Barnet
```

**Pagination:**

```
GET /v1/Messages.json?page_offset=2&page_limit=100
```

**Field projection:**

```
GET /v1/Calls.json?output_fields=ID,CallStart,CallerNumber,Status
```

---

## 15. Appendix B — Operator screen layout (web replica spec)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [≡] Acme Answering Service              [op: jdoe ▾]  [● Available]  [Home]│
├──────────────────────────────┬──────────────────────────────────────────────┤
│ CALL CONTROL                 │  ACCOUNT / CONTACT PANEL                     │
│ ┌──────────────────────────┐ │  ┌────────────────────────────────────────┐  │
│ │ Caller: (415) 555-0124   │ │  │  ACME PROPERTY MGMT     [type: Prop]   │  │
│ │ Name:   Jane Doe         │ │  │                                        │  │
│ │ ┃ 00:42 ON CALL          │ │  │  "Good evening, Acme Property…"        │  │
│ │                          │ │  │                                        │  │
│ │ [📞] [🛑]  [Hold] [Swap] │ │  │  General notes: emergency-after-hours  │  │
│ │ [Transfer ▾] [Conf] [⏸ R]│ │  │  Sensitive: <red> tenants with arrears │  │
│ │                          │ │  │                                        │  │
│ │ Line 2 (held)            │ │  │  Caller history: 2 prior calls         │  │
│ │   Bob Smith   01:12      │ │  │  ⚑ VIP                                 │  │
│ └──────────────────────────┘ │  │                                        │  │
│                              │  │  [1] Take Message  [2] Transfer Mgr    │  │
│                              │  │  [3] Provide Hours                     │  │
│                              │  └────────────────────────────────────────┘  │
│                              │                                              │
│                              │  RESOURCE PANEL                              │
│                              │  • Address: 123 Main St                      │
│                              │  • Owner portal: https://…                   │
│                              │  • Maintenance vendor list (info sheet)      │
│                              │                                              │
├──────────────────────────────┴──────────────────────────────────────────────┤
│  MESSAGE FORM — "Emergency Maintenance Intake" v3                           │
│                                                                              │
│  Tenant name *  [_______________]   Unit # *   [____]   Phone * [________]  │
│  Issue *        [____________________________________________________]      │
│  Severity *     ( ) Emergency  ( ) Urgent  ( ) Routine                      │
│  When started   [date+time]   [Insert now]                                   │
│                                                                              │
│  Notes                                                                       │
│  [_______________________________________________________________________]  │
│                                                                              │
│  Reassign to:   [On-call: Bob Maint. ▾]                                     │
│                                                                              │
│  [Cancel] [Save Draft] [Save & Dispatch] [Save & Patch on-call]             │
├──────────────────────────────────────────────────────────────────────────────┤
│  [Home] [Old Calls (37)] [Tasks (3)] [Reminders (1)]                        │
└──────────────────────────────────────────────────────────────────────────────┘

Pink fields = required (vertical-blue-bar marks active call line on the left)
```

---

## 16. Triple-check log

This PRD has been reviewed against three criteria after first draft. Notes from each pass below.

### 16.1 Correctness pass

- nCall REST API: verified URL contract, pagination keywords (`page_offset`, `page_limit`), filter shorthands (`today`, `yesterday`, `tomorrow`, `greater_than_…`, `less_than_…`), `field_names.xml` self-doc, content negotiation by extension, HTTP Basic auth, port-configurability. Source: research §A88358 (nsolve.com `nCallAPIServer.shtml`, demo server `portal.nsolve.com:22005/v6/`, blog posts).
- nCall desktop UX: verified screen-pop pattern, three Call Actions, pink-required-field background, VIP-green / Ignore-red badges, vertical-blue-bar active call marker, 3-second client-dropdown lock, `Ctrl+Alt+C` / `Ctrl+Alt+F` shortcuts, six Home-page panels (Noticeboard / News / Stats / My Calls / To Do / Tasks), Message Actions model, DTMF pause-record. Source: research §A22CE4 (nsolve.com product + blog pages, Connections Magazine vendor profile, nCall Advanced Training Course PDF).
- Telephony: verified Kamailio cannot do NAT alone (rtpengine mandatory for WebRTC ↔ PSTN due to DTLS-SRTP, ICE, in-kernel forwarding); Model B per-tenant context is industry standard; `dialog` module DB-backed enables sticky routing across Kamailio failover; MixMonitor + AMI MixMonitorMute is the canonical PCI-pause mechanism; Asterisk has no native cross-node mid-call migration; Wazo and Sipwise NGCP are valid reference architectures. Source: research §A5F9F0 (Kamailio modules docs, Asterisk wiki, rtpengine docs, Wazo, Sipwise).
- Pricing: confirmed nCall ~$65–80/seat/month (2021 third-party leak; treat as indicative), Amtelco ~$300/seat, Startel ~$375/seat, $17–20k setup at the high end; nCall sales-gated, BYO trunk/SMS/storage. Source: research §A27B6F (nsolve.com FAQ, EVS7 comparison, Connections Magazine).
- Domain features: confirmed must-have / nice-to-have / future split aligns with industry baseline (ATSI Award criteria, NAEO community expectations, MAP/Startel/SingleComm feature parity tables). Source: research §A517AB.

### 16.2 Comprehensiveness pass

Sections present: executive summary, goals/non-goals/success criteria, target users, scope, functional requirements (15 groups), non-functional requirements (5 groups), technical architecture (10 sub-sections including ERD, recording pipeline, dispatch pipeline, deployment topology, integrations), compliance plan (4 frameworks), commercial model, phased roadmap, risks + open questions, acceptance criteria, glossary, two appendices (API endpoints + operator screen mockup), and this triple-check log. Every research finding is mapped to at least one PRD section.

Coverage cross-check:

- nCall REST API research → §5.12, §7.5, Appendix A.
- nCall desktop UX research → §3, §5.3, §5.4, §5.6, §5.10, Appendix B.
- nCall pricing research → §9.
- Telephony research → §6.1, §6.2, §7.1, §7.2, §7.7, §7.8, §7.9.
- Domain features research → §4, §5, §10.

### 16.3 Internal-consistency pass

- Multi-tenancy: declared in §2.1 G3, modelled in §5.1, isolated in §7.2.3 (Model B Asterisk + SIP domain + dialplan context), data-modelled in §7.6 (every domain table has `tenant_id`), enforced in §6.3 NFR-S8 (RLS + column encryption).
- Recording-on-by-default vs PCI redaction: resolved in §5.7 + §8.3 — recording is on by default, PCI capture is delegated to a certified IVR for the card-entry segment specifically. No contradiction.
- HIPAA + GDPR + PCI simultaneously: declared as compliance posture in §6.3, mapped per-framework in §8, no double-counting of controls.
- Operator state machine: §5.3 FR-C12 declares the additional states (Break/Lunch/Training); §16.1 notes nCall does not have these but our addition is a v1 improvement, not a parity violation.
- API surfaces `/v1` and `/api/v2` are both first-class (§5.12 FR-API3) and both backed by the same domain layer (§7.5).
- "Inspired by, not exact clone" stance held throughout: parity decisions are explicit (where), improvements are explicit (where), additions are explicit (where).
- nCall pricing data is labelled as 2021 third-party leak (§9.1, §16.1) — confidence honestly stated.
- Status-driven vs calendar-driven on-call: §5.5 FR-S3 explicitly merges them into a single `WhoIsOnCall` query so there is one source of truth for the operator.

Self-review check (per brainstorming skill protocol): no TBDs or TODOs; no contradictions identified; scope is appropriate for a single comprehensive PRD (further decomposition is appropriate at the implementation-plan stage); ambiguities flagged in §11 open questions with recommended resolutions.

---

*End of PRD v1.0.*
