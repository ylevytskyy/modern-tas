# Product Requirements Document — nCall-Inspired Multi-Tenant Answering-Service SaaS

**Version:** 2.0
**Date:** 2026-05-12
**Author:** levytskyy@gmail.com, drafted with Claude Code research synthesis
**Status:** Draft for review (revision of v1.1)
**Supersedes:** `PRD.md` (v1.1). v1.1 is kept for diff history.

---

## 0. What changed in v2 (vs v1.1)

This revision closes substantive gaps identified during self-critique of v1.1. Reader on a deadline: focus on §2 (calibration), §5.3.5 (queueing), §5.16–§5.18 (voicemail/IVR/inbound SMS), §5.20 (time zones / i18n / accessibility), §6.7 (operator session semantics), §7.5.2 (modern API endpoint inventory), §7.6 (expanded data model), §10 (timeline honesty).

| Area | v1.1 state | v2 change |
|------|-----------|-----------|
| Call routing / queueing | Implicit; no queue entity | **§5.3.5 added** — full queueing model with strategies, skills, overflow |
| Voicemail | Not in scope | **§5.16 added** — to MVP scope |
| IVR / auto-attendant | Not in scope | **§5.17 added** — minimal in MVP, expanded in v1.1 |
| Inbound SMS | Not specified | **§5.18 added** — to MVP scope |
| HIPAA URL-query leak | Not addressed | **§5.14.1 added** — PHI-in-URL controls |
| Time zones / i18n / a11y | Barely addressed | **§5.20 added** |
| `/api/v2` endpoint inventory | Hand-wave | **§7.5.2 expanded** with resource matrix |
| Data model | Core entities only | **§7.6 expanded** — added `Queue`, `Voicemail`, `IvrFlow`, `SipTrunk`, `Webhook`, `WebhookDelivery`, `IntegrationConfig`, `OAuthClient`, `ApiToken`, `OperatorSkill`, indexes |
| Form Designer serialization | Unspecified | **§5.4 expanded** — JSON Schema + custom logic AST |
| Operator session semantics | Undefined | **§6.7 added** |
| Cost monitoring (us) | Not addressed | **§7.11 added** |
| DR for non-Postgres state | Not per-component | **§6.2 expanded** |
| Rate limiting / API SLA | Declared, not quantified | **§7.5.3 added** |
| Pricing confidence | Only in triple-check log | **§9.1 inline confidence note** |
| MVP timeline | 6–9 months (aggressive) | **§10.1 honest range with team-size assumption** |
| Calibration table | Buried in §16 | **§2 surfaced near top** |

Everything else in v1.1 carries forward and is restated below for self-contained reading.

---

## 1. Executive Summary

We are building a **multi-tenant, cloud-native, horizontally-scalable Telephone Answering Service (TAS) software platform**, deployed on Docker, and built on an open-source telephony stack (Kamailio SBC + Asterisk media server + rtpengine for NAT and WebRTC↔PSTN bridging), with a NestJS control plane, PostgreSQL persistence, a React web admin, and a SIP.js web softphone. The entire stack runs on a developer laptop via a single `docker compose` command (no cloud credentials needed for dev); production uses the same container images under Kubernetes or Nomad.

The platform targets businesses that operate call-answering services — virtual receptionists, after-hours medical/legal/trades dispatchers, property-management duty desks — and is offered as a SaaS where each answering-service business is a **tenant** and each of *their* customers is an **account**.

Two hard nCall-anchored constraints govern the build:

- **Operator UX parity** — workers currently using nCall's Windows desktop client must transition to the web app without retraining beyond the smallest possible delta. Screen layout, call-handling sequence, field semantics, and shortcut affordances are replicated.
- **REST API compatibility** — the caller's live CRM already integrates against nCall's REST API server. It must switch to our endpoint with minimal or zero code changes. nCall's `/v1` URL contract, auth model, pagination, and filtering are reproduced verbatim for the resources the CRM uses; a modern `/api/v2` surface runs alongside.

Everything else is open to first-principles design. The product replicates nCall's distinctive operator-desktop workflow in the browser (call control widget, account screen-pop with greeting and up-to-three configurable Call Actions, per-account custom message forms with required-field enforcement, multi-channel dispatch via per-contact Message Actions, Old Calls / Tasks / Reminders tabs, Home dashboard) and **fills the gaps nCall is publicly weak on**: calendar-driven on-call scheduling with Google/Outlook sync, an HA cloud-native deployment, native HIPAA/GDPR/PCI posture, real-time supervisor dashboard, native push-notification mobile delivery, and AI agent assist / post-call summarisation as first-class capabilities. **It also adds the call-center primitives nCall under-specifies**: queue routing with skills, voicemail, IVR, inbound SMS.

Minimum viable product (MVP) targets a single answering-service tenant going live on a single Asterisk node with up to ~25 concurrent operators, ~100 concurrent calls, ~50 client accounts. Architecture is designed for horizontal growth from day one: Kamailio behind a load balancer, an Asterisk pool dispatched by sticky-routing, rtpengine for media-plane NAT and WebRTC↔PSTN bridging (TURN deferred to v1.x), NATS JetStream for ARI event fan-out, Patroni-managed PostgreSQL, per-tenant Asterisk-context isolation. Recording is on by default with per-file envelope encryption and AMI-driven pause-during-DTMF for PCI redaction.

---

## 2. Confidence and Calibration

This section surfaces honest confidence per major area near the top so readers can apply appropriate scepticism while reading. Higher detail in §17.

| Area | Confidence | Primary risk |
|------|-----------|--------------|
| Telephony architecture | **High (~85%)** | Asterisk version-specific behaviour with PJSIP realtime + ARI under load |
| nCall `/v1` REST compatibility | **High (~85%)** | Undocumented nCall behaviour discovered only against a live instance |
| Compliance framing (HIPAA/GDPR/PCI) | **Medium-High (~75%)** | Engineering controls are sound; full certification requires legal + 3rd-party audit |
| Operator UX parity | **Medium (~65%)** | Original research had medium confidence on supervisor view, full keyboard shortcuts |
| Functional requirements coverage (v2) | **Medium-High (~75%)** | Queue / voicemail / IVR added in v2 close the largest v1.1 gaps |
| Data model completeness (v2) | **Medium-High (~70%)** | Expanded entity set; ancillary edge cases still discoverable during build |
| Pricing strategy | **Low-Medium (~40%)** | Only 2021 third-party leak as nCall data point — needs validation |
| MVP timeline (9–12 months, 4–5 senior engineers) | **Medium (~50%)** | Honest range vs v1.1's aggressive 6–9 months |
| Overall usefulness as build-kickoff | **High (~85%)** | Document is actionable; gaps that remain are visible |

**Aggregate confidence v2**: **~78%** that this PRD is correct and useful as a build-kickoff; **~70%** that it is complete enough to start without major bounce-backs.

---

## 3. Goals, Non-Goals, Success Criteria

### 3.1 Goals

- **G1.** Replace nCall for our own answering-service operations — operators take a call → identify the account → fill the per-account form → dispatch the message → log out faster than they currently do in nCall.
- **G2.** Preserve CRM integration without rework — the existing CRM continues to function against our endpoint after a base-URL change and credential swap. **Zero schema rewrites on the CRM side** for the implemented resources.
- **G3.** Multi-tenant from day one — data model, telephony isolation, and billing are tenant-scoped. The system safely hosts competing answering-service businesses without cross-tenant data leakage.
- **G4.** Compliance-fit for medical, legal, and card-handling verticals — HIPAA (US healthcare), GDPR (EU personal data), PCI-DSS (payment processing during calls), with a defensible audit trail and tenant-isolated encryption-at-rest.
- **G5.** Horizontally scalable telephony — adding capacity is "deploy another Asterisk container and register it with Kamailio dispatcher." No single-machine vertical-scaling bottleneck.
- **G6.** Browser-first operator experience — web softphone (SIP.js) is the default. Hardware SIP phones supported but not required. No native desktop client to install.
- **G7.** Call-center-class call handling — queueing, skills routing, overflow, voicemail, IVR are first-class. (NEW in v2: nCall is weaker here than Amtelco/Startel; we close the gap.)

### 3.2 Non-Goals

- **NG1.** PSTN carrier services — we are not a CLEC. PSTN via wholesale SIP trunk (Twilio, Telnyx, Bandwidth).
- **NG2.** Native mobile operator app — operators work from desktop browsers in MVP. Mobile **on-call recipient** app is v1.x.
- **NG3.** Owned accounts-receivable / payment processing — we produce billing line items and CSV exports. We do not run AR.
- **NG4.** Voice cloning / outbound AI bots — MVP AI is limited to transcription and post-call summary on pre-recorded audio.
- **NG5.** TAPI / legacy PBX integration — SIP-only.

### 3.3 Success Criteria

| ID | Criterion | Measure |
|----|-----------|---------|
| S1 | Existing CRM works against new API | Zero CRM code changes on `Users`, `Calls`, `Messages`, `Contacts`, `todo` reads/writes. Smoke-test of all consumed endpoints passes |
| S2 | Operator throughput | Median call handle time within ±10% of nCall baseline for the same script |
| S3 | Operator onboarding | Trained nCall user productive on our web app in ≤ 30 minutes |
| S4 | Concurrent call capacity | 100 concurrent calls per Asterisk node on 4 vCPU / 8 GB with Opus passthrough |
| S5 | HA failover | Killing one Kamailio or one Asterisk node mid-call: in-flight calls on that node end gracefully; new calls continue routing on remaining nodes within ≤ 30 s |
| S6 | Recording integrity | 100% of recordings encrypted at rest; PCI pause produces a verifiable redaction window in audio + metadata |
| S7 | Compliance audit | Pass an external HIPAA/GDPR audit checklist at v1 launch |
| S8 | Dispatch SLA | 95% of dispatched messages delivered to first-attempt channel within 10 s of operator save |
| S9 | Queue answering SLA | 80% of calls answered by an operator within 20 s of arrival (configurable per account; default mirrors ATSI Award of Excellence ≤ 3 rings / 18 s) |
| S10 | Voicemail availability | 100% of unanswered calls routed to voicemail (or AI agent) within configured timeout, never simply dropped |
| S11 | Local-dev parity | Fresh clone + `make dev-up` brings full stack up; place test call through sidecar trunk emulator + see full flow within 5 minutes |

---

## 4. Target Users and Personas

(Unchanged from v1.1; restated briefly.)

- **Tenant** — answering-service business owner; current nCall/Amtelco/Startel customer migrating to cloud.
- **Operator / TSR** — sits at a browser all day; familiar with nCall conventions; cares about speed and accuracy.
- **Supervisor** — real-time queue + operator monitoring; listen/whisper/barge; QA review.
- **Tenant Admin** — sets up accounts, forms, schedules, billing, integrations.
- **Client** — the business being answered for; reads messages, manages on-call status, listens to recordings.
- **On-Call Recipient** — receives dispatched messages via email/SMS/patch/webhook/push; acknowledges.
- **CRM Integration** — software, not a person, but the tightest constraint.

---

## 5. Functional Requirements

### 5.1 Tenancy and identity

- **FR-T1.** A Tenant owns all other entities; every domain table carries `tenant_id`; PostgreSQL RLS enforces filtering at the database layer.
- **FR-T2.** Each tenant has its own SIP domain (`acme.sip.example.com`).
- **FR-T3.** Tenant onboarding provisions: SIP domain, per-tenant KEK in KMS, default admin user, empty billing scheme, branded client-portal subdomain.
- **FR-T4.** Users have Roles: `tenant_admin`, `supervisor`, `operator`, `client_portal_user`, `api_integration`. Additive permissions.
- **FR-T5.** Authentication: username + password (Argon2id) with optional TOTP MFA. SAML/OIDC SSO for tenant_admin and supervisor in v1.x.
- **FR-T6.** Users can act in multiple tenants only via explicit invitation; tenant-switch requires re-auth.
- **FR-T7.** API authentication exposes both surfaces simultaneously:
  - **HTTP Basic** (nCall-compatible) — `api_integration` user credentials, scoped to that user's tenant.
  - **OAuth2 / PAT** (modern) — bearer token in `Authorization: Bearer …`, scoped to resource permissions.

### 5.2 Client accounts

- **FR-A1.** A *Client Account* (a.k.a. Company) has: name, account number, type (color-coded), greeting text, general notes, sensitive notes (red), time zone, billing scheme, up-to-three **Call Actions**, queue assignment (§5.3.5), associated skills required.
- **FR-A2.** A Client Account has zero-or-more **Contacts** with email, mobile, alt phone, channel preferences, Message Actions, availability status.
- **FR-A3.** A Client Account is reached by one or more **DIDs**. DID → account is the primary routing key. A DID has its own default Call Action and IVR-flow override (§5.17).
- **FR-A4.** Resource Panel: per-account quick links (info sheets, external URLs, file attachments, booking systems) surfaced beside the call.
- **FR-A5.** Notices: appear on operator screen at call pop time.
- **FR-A6.** Vertical templates: medical, legal, trades, property, IT MSP, funeral, general — seed forms + Call Actions + defaults (e.g. medical defaults to portal-only PHI delivery).

### 5.3 Operator inbound call flow

#### 5.3.1 Signal path

- **FR-C1.** SIP INVITE arrives on Kamailio from the SIP trunk. Kamailio: tenant lookup by DID, anti-abuse (pike, GeoIP, secfilter), dispatch via `dispatcher` + `dialog` to a sticky Asterisk node. rtpengine handles media-plane bridging.
- **FR-C2.** Asterisk enters Stasis app `tenant_<id>_app`. NestJS receives `StasisStart` and resolves: tenant, account (via DID), caller CLI, caller name (CNAM), caller history, **target queue** (§5.3.5).

#### 5.3.2 Queue arrival and screen-pop

- **FR-C3.** NestJS enqueues the call in the configured `Queue` and broadcasts via WebSocket to eligible operators (matched on skills + availability). Queue strategy decides order (FIFO / priority / sticky-to-prior-operator).
- **FR-C4.** First eligible operator to accept gets the call (server-arbitrated via Redis lock; losers receive `CallTakenByOther`). Screen-pop sequence on accept:
  - New tab in operator console with **vertical blue bar** marking active call.
  - Client Account panel: name, color-coded type, resolved greeting tokens (`[time-of-day]`, `[operator-name]`, `[DID-name]`), general info, sensitive (red), notices.
  - Contact panel: caller history matched on CLI; VIP (green) / Ignore (red) badge.
  - Three Call Action buttons render with configured labels and `Alt+1/2/3` shortcuts.
  - Resource Panel shows links + info sheets.
  - Client dropdown locked for 3 seconds (nCall parity; anti-mis-assignment).
- **FR-C5.** WebRTC audio leg established concurrently: SIP.js → Kamailio WSS → Asterisk PJSIP WS, DTLS-SRTP fingerprints negotiated via rtpengine.

#### 5.3.3 Call Action handling

- **FR-C6.** Call Action types: `take_message`, `transfer_blind`, `transfer_supervised`, `info_display`, `external_command`, `temporary_action_override` (time-windowed override of one of the above). On selection: form opens, or transfer dialog opens, or info sheet renders.
- **FR-C7.** Form behaviour (details §5.4):
  - Required fields render with pink background.
  - Multi-page with page indicator.
  - Conversational prompt text interleaved as labels.
  - "Insert timestamp" buttons next to time fields.
  - "Common Message Text" snippets sidebar.
  - "Reassign To" recipient picker at bottom.
- **FR-C8.** Call controls (top-left widget): `Answer`, `Hold`, `Unhold`, `Swap Hold` (multi-line), `Transfer` (blind + supervised), `Conference`, `Hang Up`. Right-click: Record / Pause Record / Conference-to-External. DTMF pause-record via `*7`/`*8` (configurable).
- **FR-C9.** Multi-line: operator may have multiple active or held calls. Live leg marked by vertical blue bar; Swap Hold rotates.

#### 5.3.4 Wrap-up

- **FR-C10.** On form save: required fields validated → Message persisted → Message Actions fire → call wrap-up complete → operator returns to `Available`.
- **FR-C11.** On hangup without form save: Call recorded with status `abandoned_by_operator`; audit logged.
- **FR-C12.** Operator state machine: `LoggedIn` → `Available` → `OnCall` → `Wrapping` (form open post-hangup) → `Available`. Admin-configurable `Break`, `Lunch`, `Training`. Operator chooses state from menu.
- **FR-C13.** Keyboard shortcuts: `Alt+1/2/3` (Call Actions), `Ctrl+Alt+F` (search), `Ctrl+Alt+C` (copy formatted), `Ctrl+S` (save form), `Ctrl+H` (hangup), `Ctrl+Shift+Space` (toggle hold). Configurable per tenant + per user.

#### 5.3.5 Call routing and queueing (NEW in v2)

This subsection is new and closes the largest functional gap in v1.1.

- **FR-Q1.** **Queue** entity per tenant. A Queue has: name, strategy (`fifo` / `priority` / `sticky_last_operator` / `least_recent` / `longest_idle`), max-wait timeout, overflow target (another Queue / voicemail / IVR flow / external SIP destination), abandon timeout, hold-music profile.
- **FR-Q2.** **Account-to-Queue mapping**: each account is bound to one Queue. A Queue can serve multiple accounts. Tenants typically have a small set of Queues (`primary`, `overflow`, `after_hours`, `medical_priority`).
- **FR-Q3.** **OperatorSkill** entity: per-operator boolean tags (`medical`, `spanish`, `legal`, `senior_qa`, …). Account → required-skill set. Only operators with matching skills receive the call.
- **FR-Q4.** **Queue strategies**:
  - `fifo` — first-in-first-out across eligible operators.
  - `priority` — calls ordered by `priority` field on Call (set by IVR, by VIP CLI, by STAT flag).
  - `sticky_last_operator` — if the caller's last call (same CLI, same account, within configured window, e.g. 7 days) was handled by operator X and X is available, X gets it. Falls back to fifo.
  - `least_recent` — operator who hasn't taken a call for longest gets next.
  - `longest_idle` — operator currently idle longest gets next.
- **FR-Q5.** **Queue capacity**: per-Queue `max_calls_waiting`; over-capacity calls divert to overflow target.
- **FR-Q6.** **Caller experience while queued**: announcement on entry ("All operators are currently busy; you are caller number 3"), periodic position update (every 30 s), hold music, opt-out-to-voicemail DTMF.
- **FR-Q7.** **Overflow chain**: `primary_queue → overflow_queue → voicemail` is configurable; cascades with timeouts.
- **FR-Q8.** **Schedule-based routing**: per-DID and per-account, a schedule says "Mon–Fri 09:00–17:00 → primary_queue, otherwise → after_hours_queue → voicemail". Schedules respect account time zone.
- **FR-Q9.** **Real-time queue visibility**: supervisor dashboard shows per-Queue depth, longest-waiting, abandonment rate, last-N-minutes flow rate.
- **FR-Q10.** **Implementation note**: queueing is implemented in the **NestJS control plane**, not in Asterisk's built-in `Queue()` dialplan app. Reason: per-tenant strategy variation + skills routing + multi-Queue overflow chains exceed what `Queue()` cleanly expresses. Asterisk's role is to hold the call in a Stasis-controlled bridge (`MOH` for music-on-hold, `Playback` for announcements); NestJS decides when to bridge to an operator. This trades a small amount of latency (a few hundred ms on dequeue) for orders-of-magnitude routing flexibility.

### 5.4 Custom forms

- **FR-F1.** Forms authored in a **visual drag-and-drop builder**; not code.
- **FR-F2.** Field types: text, multiline text, dropdown, checkbox, radio, date, time, date+time, phone (auto-format + validate), email, currency, reference number (auto-generated), recipient picker, file attachment, repeating group, display-only label, computed field (formula), call-action chooser.
- **FR-F3.** Required-field enforcement with pink background; configurable `relaxed_on_draft` per field.
- **FR-F4.** Conditional logic: show/hide fields based on prior field values; rules-engine model (predicate → effect).
- **FR-F5.** **Form serialization (NEW in v2):** persisted as JSON document with this structure:
  ```jsonc
  {
    "version": 7,
    "schema": { /* JSON Schema (draft 2020-12) for fields */ },
    "ui_layout": [ /* ordered pages → field references with display hints */ ],
    "logic": [ /* {when: <jsonlogic predicate>, then: {show|hide|require|set} } */ ],
    "delivery_templates": { "email": "...", "sms": "...", "webhook": {...} }
  }
  ```
  JSON Schema for the data shape; **JsonLogic** for predicates (well-supported library; safe to evaluate server-side). The Form Designer compiles drag-drop UI down to this representation; the runtime renders + validates against it.
- **FR-F6.** Form versioning: every save creates a new immutable version. Active version is `current`. Filed Messages reference the version they were filled against (data + schema preserved for accurate replay).
- **FR-F7.** Form preview / test-fill in admin UI without persisting Message.
- **FR-F8.** Per-account form binding: many forms per account, each bound to a specific Call Action.
- **FR-F9.** Hyperlink-command tokens in label text: `[Dial:+15551234]`, `[Search:order#1234]`, `[Client:42]`, `[Contact:99]`.
- **FR-F10.** Form export/import as JSON for inter-tenant template sharing.

### 5.5 On-call schedules

(Unchanged from v1.1.)

- **FR-S1.** Status-driven (per-contact `availability_status` self-managed via portal; nCall parity).
- **FR-S2.** Calendar-driven (RFC 5545 rrule schedules with tier and date overrides; Google + Outlook ICS sync).
- **FR-S3.** `WhoIsOnCall(account_id, at_time)` merges both: calendar overrides status when shift explicitly assigned.
- **FR-S4.** Schedule UI: calendar grid per account; drag-to-reassign; copy-week-forward.
- **FR-S5.** Coverage gap detection; warn at call arrival.
- **FR-S6.** Escalation tier: `escalation_after_minutes` cascades unacked dispatches to next tier.

### 5.6 Dispatch — Message Actions

(Unchanged in shape from v1.1; restated.)

- **FR-D1.** Each contact has zero-or-more **Message Actions**: channel, destination, trigger (immediate / scheduled), filter, template, escalation timeout, priority.
- **FR-D2.** Email channel (SendGrid / SES / Mailgun / generic SMTP; per-tenant DKIM/SPF).
- **FR-D3.** SMS channel (Twilio / Telnyx / generic; delivery receipts via provider webhook).
- **FR-D4.** Outbound phone / patch channel (AMI `Originate`; live bridge with caller or TTS-only; DTMF ACK).
- **FR-D5.** Webhook channel (HTTP POST/PUT/PATCH with templated body, retries with exponential backoff, configurable success criteria).
- **FR-D6.** Mobile push channel (FCM + APNS; encrypted payload; v1.x for the recipient mobile app).
- **FR-D7.** Delivery state machine: `pending` → `sent` → `delivered` | `failed` → `acknowledged`.
- **FR-D8.** STAT/urgent flag (bypasses scheduled queue, fires all channels simultaneously, raises retry frequency, banner in client portal).
- **FR-D9.** Scheduled / recurring messages.
- **FR-D10.** Per-tenant dispatch dashboard (in-flight, attempt count, last error, retry control).

### 5.7 Call recording and PCI redaction

(Unchanged from v1.1.)

- **FR-R1.** Recording on by default; tenant + account toggle.
- **FR-R2.** MixMonitor → WAV → NestJS worker → encrypted → S3.
- **FR-R3.** Envelope encryption: per-file DEK (AES-256-GCM); DEK wrapped with per-tenant KEK in KMS.
- **FR-R4.** PCI pause via UI button (AMI `MixMonitorMute`) or DTMF; redaction intervals stored; post-processed silence via sox.
- **FR-R5.** Retention: 90 days default; 7 years for HIPAA tenants; S3 lifecycle to Glacier after 90 days.
- **FR-R6.** Playback via signed expiring URL through a decrypt-on-the-fly proxy (browser never sees DEK).
- **FR-R7.** Metadata: tenant_id, call_uuid, redaction_intervals, encryption_key_id, codec, file_size.
- **FR-R8.** Audit-log entry on every play/download.
- **FR-R9.** Right-to-be-forgotten workflow: locate recordings → redact form fields → delete or `pii_purged`.

### 5.8 Client portal

(Unchanged from v1.1.) Per-tenant subdomain, white-labelled, role `client_portal_user`. Inbox, message detail (with dispatch history + recording), call history, on-call management (status + calendar), contact mgmt, reports, settings, audit-of-self.

### 5.9 Supervisor real-time dashboard

(Unchanged from v1.1.) Live operator status grid, live queue depth and longest-wait, ChanSpy listen/whisper/barge, real-time recording offset playback, QA-tag, coach private chat.

### 5.10 Operator Home page

(Unchanged from v1.1.) Six panels: Noticeboard, News, Stats, My Calls, To Do, Tasks.

### 5.11 Tenant administration

(Unchanged from v1.1; restated.) Client Account CRUD with templates, Form Designer, Contact CRUD + Message Action editor, On-Call Schedule editor, User & Role mgmt, Billing Scheme editor, DID mgmt, Integration settings, Tenant settings, Audit-log viewer, CSV bulk import.

### 5.12 REST API (two surfaces)

Two coexisting surfaces; see §7.5 for the full inventory.

- **FR-API1.** `/v1/...` — **nCall-compatible**. Verbatim URL contract, HTTP Basic, XML/JSON/HTML content negotiation, `page_offset`/`page_limit`, field=value filtering with `today`/`yesterday`/`tomorrow` and `greater_than`/`less_than`, `output_fields=`, `field_names.{xml|json}`.
- **FR-API2.** `/api/v2/...` — modern. JSON only, OpenAPI 3.1, OAuth2 + PAT, cursor pagination, RFC 9457 problem-details, webhook subscriptions, `?fields=` selection.
- **FR-API3.** Both surfaces serve from the same domain layer; neither is a translation shim.
- **FR-API4.** Outbound **Web Message Actions** (nCall parity): admin-configurable HTTP webhooks fired on Message save.
- **FR-API5.** Webhook subscriptions for `/api/v2`: event subscriptions with HMAC-signed payloads and at-least-once delivery.
- **FR-API6.** **PHI-in-URL avoidance (NEW in v2)**: see §5.14.1.

### 5.13 Tenant-of-clients billing

(Unchanged from v1.1.) Per-tenant billing schemes (per-minute / per-call / per-message / per-SMS / flat / hybrid), inclusive minutes, rounding rules, period config, line-item ledger, CSV export with 50+ fields, transfer-monitor for patch billing.

### 5.14 Audit and compliance log

- **FR-AU1.** Append-only `audit_log` with `tenant_id`, `actor_user_id`, `actor_ip`, `timestamp`, `action`, `resource_type`, `resource_id`, `before_value` (JSONB), `after_value` (JSONB).
- **FR-AU2.** PostgreSQL `RULE`/RLS blocks UPDATE/DELETE on `audit_log`; partitioned by month.
- **FR-AU3.** Every admin CRUD, every recording pause/resume, every API call (logged at gateway), every recording play/download emits an entry.
- **FR-AU4.** Viewer in admin UI with filter; CSV export.

#### 5.14.1 PHI in URL query strings (NEW in v2)

URL query parameters appear in web-server access logs, proxy logs, CDN logs, and browser history. A query like `/v1/Messages.json?CallerName=Jane+Doe&CallerNumber=415-555-1234` writes PHI to logs that are not always in our HIPAA scope.

- **FR-AU5.** For HIPAA-tagged tenants, every API endpoint that filters on potentially-sensitive fields (`CallerName`, `CallerNumber`, `CallerCompany`, message body fields) MUST also accept a `POST /v1/<Resource>/search` form of the same query, with the same field semantics, where filter values are in the request body. The CRM client SHOULD switch to this form for HIPAA tenants.
- **FR-AU6.** For tenants who cannot change their CRM, all access-log lines for the `/v1/*` namespace are passed through a **scrub middleware** that hashes the query string before any log sink ingests it. The hash uses a per-tenant salt. Original query is retained in encrypted application-level audit only.
- **FR-AU7.** CDN / load-balancer logs in front of the API are configured to drop query strings entirely; only the path is logged at the L7 edge.
- **FR-AU8.** Browser-history concern is not applicable since CRM integrations do not run in browsers, but the admin UI itself uses POST-bodies for any sensitive filter to avoid history leakage.

### 5.15 Observability (functional view)

(Unchanged from v1.1.) Real-time call-flow inspector by call UUID; operator-experience monitor; tenant health page.

### 5.16 Voicemail (NEW in v2)

Voicemail is the universal fallback when no operator (and no AI agent) is available. Every call that exits a Queue without being answered lands in voicemail by default, unless explicitly disabled per account.

- **FR-VM1.** **Voicemail box** per account (not per contact): inherits account branding for the greeting recording.
- **FR-VM2.** Greeting: pre-recorded WAV uploaded via admin UI, or TTS-generated from a text greeting per account.
- **FR-VM3.** Recording: callers leave up to 5 minutes (configurable per account). Stored in the same recording pipeline as call recordings — encrypted at rest, retention rules apply.
- **FR-VM4.** **Voicemail Message** entity: a voicemail produces a Message of `kind = voicemail` with attached audio, automatic ASR transcription (provider-pluggable; Whisper / Deepgram / AWS Transcribe), and runs the same Message Action chain as a live operator-taken message (email/SMS/push with the audio + transcript).
- **FR-VM5.** Operator review: voicemails appear in the operator console as a pending-review queue. Operators can listen, edit the transcript, re-dispatch, or mark as actioned.
- **FR-VM6.** Client portal: voicemails appear in the client's inbox alongside operator-taken messages.
- **FR-VM7.** Implementation: Asterisk `Voicemail()` dialplan app is **not** used (limited transcription, awkward integration with our Message model). Instead: Stasis app records via MixMonitor in a one-leg bridge, hangs up on caller hangup or 5-min cap, fires the same recording pipeline.

### 5.17 IVR / auto-attendant (NEW in v2)

IVR is intentionally **minimal in MVP**: enough to route by digit press, play pre-recorded prompts, route to Queue or voicemail. Full NLU-based IVR is v2.

- **FR-IVR1.** **IvrFlow** entity per tenant: a directed acyclic graph of nodes (Play, GetDigit, Goto, Branch, Hangup, RouteToQueue, RouteToVoicemail, RouteToExternal).
- **FR-IVR2.** **Per-DID and per-account binding**: a DID can have an IVR flow run **before** the call reaches a Queue. Example: "Press 1 for medical emergency, 2 for billing, 3 to leave a message".
- **FR-IVR3.** **Prompts** are uploaded WAVs or TTS-generated. Multi-language: each prompt has language variants; root flow can branch on language selection.
- **FR-IVR4.** **Authoring UI**: visual node-graph editor; test-execute mode for admins.
- **FR-IVR5.** **Schedule overrides**: an IVR can branch on time-of-day or day-of-week (e.g. "after hours play 'we are closed' message → voicemail").
- **FR-IVR6.** **Reporting**: per-node analytics (how many callers pressed 1 vs 2 vs hung up).
- **FR-IVR7.** **Implementation**: NestJS executes the flow via Stasis ARI primitives (`Play`, `PlaybackContinue`, `ChannelDtmfReceived`). Persisting partial flow state on the Channel allows the call to survive Asterisk node migration (in the limited sense that NestJS recovers state from PostgreSQL on ARI reconnect).

### 5.18 Inbound SMS (NEW in v2)

Modern answering services receive SMS inbound. nCall does not natively model this.

- **FR-SMS1.** A DID can have **voice** capability, **SMS** capability, or both.
- **FR-SMS2.** Inbound SMS to a tenant DID is delivered via provider webhook (Twilio, Telnyx) into NestJS.
- **FR-SMS3.** NestJS routes the SMS to the right account (by DID) and creates an **inbound Message** of `kind = inbound_sms` with sender CLI, body, optional MMS attachments.
- **FR-SMS4.** **Operator inbox**: inbound SMS appear as conversation threads (grouped by `account + sender CLI`). Operators reply from the operator console — replies are outbound SMS via the same provider, attributed to the operator, threaded.
- **FR-SMS5.** **Auto-reply**: per-account configurable acknowledgement ("Thanks, an operator will respond shortly. Reply STOP to opt out.").
- **FR-SMS6.** **STOP/HELP** compliance: handled automatically per provider conventions; opt-out persisted per CLI.
- **FR-SMS7.** **Dispatch**: an inbound SMS message can trigger Message Actions just like a voice-taken message, including escalation if no operator responds within N minutes.

### 5.19 Tasks and Reminders (filled in for v2)

- **FR-TR1.** **Task** entity (client-assigned billable job): title, description, account, assignee operator, state machine `pending → in_progress → on_hold | completed`, billing mode (`timed` with rate + inclusive minutes, or `fixed` with amount), notes, due_at.
- **FR-TR2.** Time tracking on `timed` tasks: explicit Start/Stop buttons. **Idle protection**: if the operator's state moves to `OnCall` or `Wrapping`, an active task timer auto-pauses (timeline preserves the pause as a gap). If the operator browser tab closes (heartbeat lost ≥ 60 s), timer auto-pauses with an "unclean stop" flag for supervisor review.
- **FR-TR3.** **Reminder** entity: tenant_id, user_id (target operator) or account_id (for all operators on that account), title, body, due_at, fired_at, snooze_until, dismissed_at.
- **FR-TR4.** Reminders fire as: in-app popup with sound (default), browser push if permitted, optional email digest. Snooze: 5 / 15 / 30 / 60 min presets + custom.
- **FR-TR5.** A reminder due-while-the-operator-is-on-a-call is queued and surfaced on next `Available` transition (configurable: surface immediately if `urgent=true`).

### 5.20 Time zones, internationalisation, accessibility (NEW in v2)

- **FR-G1.** **Time zones**: all timestamps stored in UTC at the DB layer. Rendered in:
  - The operator's tenant default time zone (operator UI) — overridable per-user.
  - The account's time zone (Schedule rules, account-scoped reports, account-bound billing periods).
  - The recipient's time zone (dispatched messages and client portal — defaults to account TZ unless the recipient overrides).
- **FR-G2.** Time-zone-aware Schedule rules: an on-call rotation defined in `America/New_York` honours DST; cross-TZ rendering shows local equivalents.
- **FR-G3.** **Internationalisation**: operator UI, admin UI, and client portal externalise strings with `i18next` (or equivalent). MVP ships en-US + en-GB; pseudo-locale flag (`?lang=pseudo`) for visual layout testing.
- **FR-G4.** Number, date, currency formatting via ICU / Intl APIs.
- **FR-G5.** v1.x: ship Spanish (es-MX) and French (fr-CA) — common bilingual TAS verticals (US medical, Canadian TAS).
- **FR-G6.** **Accessibility (WCAG 2.1 AA)**:
  - Operator console keyboard-navigable end-to-end (no mouse required for the inbound-call flow).
  - Screen-reader compatible: ARIA labels on call-control widgets, form field associations, live-region announcements for new call arrival.
  - Colour contrast meets AA against the default theme; do not rely on colour alone for VIP/Ignore/required-field signals (use icons + colour).
  - User-configurable font size (small / medium / large) — large mode preserves layout.
  - Operator desks may use specialised headsets; do not capture `Ctrl`/`Alt`/`Shift` combos that conflict with assistive tech.

---

## 6. Non-Functional Requirements

### 6.1 Performance and scale

(Unchanged from v1.1.) ≥100 concurrent calls / Asterisk node (Opus passthrough); ≥5000 registrations / Kamailio; screen-pop p50 ≤ 300 ms / p95 ≤ 800 ms; dispatch p50 ≤ 3 s / p95 ≤ 10 s; recording upload ≤ 30 s post-call; REST API p95 ≤ 200 ms read / 500 ms write @ 100 RPS / tenant.

### 6.2 Availability and disaster recovery (expanded in v2)

- **NFR-A1.** Platform availability target: **99.9%** MVP, **99.95%** v1.x.
- **NFR-A2.** Kamailio active-active (≥ 2 nodes, DMQ sync of usrloc + htable). Single-node failure does not drop in-flight calls.
- **NFR-A3.** Asterisk pool: stateless from Kamailio. Node failure drops calls on that node only. Drainable for upgrade.
- **NFR-A4.** rtpengine active-active; Kamailio fails over RTP relay on health check.
- **NFR-A5.** **PostgreSQL**: Patroni + etcd primary-replica; RPO ≤ 1 min, RTO ≤ 1 min. Daily logical backups + continuous WAL streaming to S3.
- **NFR-A6.** **S3 / MinIO**: cross-region replication for HIPAA tenants. Versioning enabled. Object-lock for compliance-retained recordings.
- **NFR-A7.** **NATS JetStream**: 3-node cluster with mirrored streams; persistent storage on each node. Stream replay supports recovery up to retention horizon (default 7 days).
- **NFR-A8.** **Redis Sentinel**: 3 Sentinels watching primary + 2 replicas. RDB snapshots every 15 min + AOF appendonly. Recovery: restore RDB → catch up AOF.
- **NFR-A9.** **Homer (SIP capture)**: 30-day SIP-message retention; daily Postgres snapshot of Homer DB. Acceptable RPO: 1 hour (forensic data, not transactional).
- **NFR-A10.** **KMS**: AWS KMS is managed (99.999% SLA); Vault deployments require 3-node Raft cluster + auto-unseal. Per-tenant KEK is multi-region replicated.
- **NFR-A11.** **Quarterly DR drill**: restore from backup into a clean environment; verify operator can place a call end-to-end; document RTO/RPO actuals.

### 6.3 Security and compliance

(Unchanged from v1.1.) TLS 1.2+ everywhere; SRTP mandatory; per-tenant KEK; Argon2id passwords; short-lived sessions; TOTP MFA for admin/supervisor; mTLS between internal services; DB column-level encryption for HIPAA tenants; append-only audit log; BAA chain; 7-year HIPAA retention; GDPR right-to-erasure workflow; PCI delegated capture preferred; Kamailio `pike` + GeoIP + secfilter + toll-fraud monitor.

### 6.4 Observability

(Unchanged from v1.1.) HEPv3 → Homer; Prometheus from every component; Grafana dashboards; OpenTelemetry traces via `X-Call-UUID` propagation; centralised JSON structured logs; Alertmanager-driven PagerDuty.

### 6.5 Maintainability and developer experience

(Unchanged from v1.1.) Single `docker compose` stack is the source of truth; `make dev-up` brings full stack up with zero cloud credentials; stubbed adapters for KMS/SMS/email/push/SIP trunk; integration tests run against the same stack developers use; OpenAPI 3.1 for `/api/v2`; forward-only migrations; feature flags.

### 6.6 Quality of service (added in v2)

- **NFR-Q1.** **Audio quality**: target MOS ≥ 4.0 on Opus end-to-end (PSTN→trunk→our network→browser). Monitor via rtpengine RTCP statistics export to Prometheus.
- **NFR-Q2.** **Packet loss budget**: rtpengine reports per-call PLC ratio; alert at sustained >2% over 30 s.
- **NFR-Q3.** **Jitter budget**: rtpengine reports per-call max jitter; alert at sustained >50 ms.

### 6.7 Operator session semantics (NEW in v2)

- **NFR-OP1.** **Single active session per operator user**: an operator user with two browser tabs / two devices logged in causes a server-side conflict. Newer login wins; older session is force-logged-out with a banner "you have been logged out — you signed in elsewhere". Tenant admins may override (force-logout the newer login instead).
- **NFR-OP2.** **Heartbeat**: operator console pings NestJS every 10 s. Missed-heartbeat threshold = 30 s → operator state moves to `Network_Lost` (visible to supervisor); 90 s → `Logged_Out`.
- **NFR-OP3.** **Browser tab close mid-call**:
  - WebRTC track ends within seconds → Asterisk channel detects RTP timeout → ARI emits `ChannelDestroyed`.
  - NestJS catches the event: caller hears a brief recovery announcement ("Please hold, reconnecting your call"), call is re-queued to the same Queue at the head with `was_in_progress=true`, original operator's state moves to `Network_Lost` then `Logged_Out`. Supervisor sees the disruption.
  - If the same operator logs back in within 30 s, NestJS optionally restores the call to them (rare — depends on caller staying on the line).
- **NFR-OP4.** **Form draft auto-save**: every 5 s while a form is open, the current draft posts to NestJS. On reconnect or session restore, the operator can resume the draft.
- **NFR-OP5.** **Network drop without tab close**: browser detects offline → WebRTC may continue if network briefly returns; if not, same path as tab close. UI shows a clear "Connection lost — reconnecting" overlay.

---

## 7. Technical Architecture

### 7.1 Component diagram

(Unchanged shape from v1.1; coturn deferred to v1.x. Same `docker compose`-first development posture.)

```
                       ┌────────────────────────────────────────────────────────────┐
                       │                       Public Internet                       │
                       └──────┬──────────────────────┬─────────────────┬───────────┘
              SIP/TLS:5061    │   WSS:443 (WebRTC)   │ HTTPS:443        │ HTTPS:443
                              │                      │ (admin/portal)   │ (REST API)
                       ┌──────▼──────────────────────▼─────────────────▼───────────┐
                       │                       L4 / L7 Load Balancers              │
                       └──────┬──────────────────────┬─────────────────┬───────────┘
                              │ SIP                  │ WebSocket        │ HTTP(S)
                       ┌──────▼──────────────────────▼─────────┐ ┌──────▼─────────┐
                       │       Kamailio SBC (active-active)    │ │  NestJS API +  │
                       │  registrar · dispatcher · TLS · WSS   │ │  Admin BFF     │
                       │  pike · topology_hiding · DMQ         │ └──┬─────────────┘
                       └──────┬──────────────────────┬─────────┘    │ ARI WS / AMI
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
                       │       Asterisk Pool                   │◄───┘
                       │   ast-1 · ast-2 · ast-N (Stasis only) │
                       │   per-tenant context · MixMonitor     │
                       └──┬─────────────┬──────────────────────┘
                          │ CDR/CEL     │ recordings (raw WAV)
                  ┌───────▼───────┐  ┌──▼─────────────────────────────────┐
                  │ PostgreSQL    │  │  NestJS Recording Worker           │
                  │ Patroni HA    │  │  encrypt → upload to S3            │
                  └───────┬───────┘  └────────────────┬───────────────────┘
                          │                            │
                          │                       ┌────▼────────────┐
                          │                       │  S3 / MinIO     │
                          │                       └─────────────────┘
                  ┌───────▼─────────────────┐  ┌──────────────────────────┐
                  │  Redis / NATS JetStream │  │  KMS / Vault             │
                  │  - ARI event fanout     │  │  per-tenant KEK          │
                  │  - rate-limit, presence │  └──────────────────────────┘
                  │  - dispatch + queue     │
                  └──────────────────────────┘  ┌──────────────────────────┐
                                                │  Homer + Prometheus      │
                                                │  + Grafana + Loki +      │
                                                │  Jaeger/Tempo            │
                                                └──────────────────────────┘
  (TURN/coturn deferred — see §7.2.4)
```

### 7.2 Telephony plane

#### 7.2.1 Kamailio SBC

(Unchanged from v1.1.) Modules: `tls`, `websocket`, `dispatcher`, `dialog`, `topology_hiding`, `registrar`, `usrloc`, `auth`, `auth_db`, `nathelper`, `rtpengine`, `pike`, `secfilter`, `geoip2`, `htable`, `siptrace`, `dmq`, `dmq_usrloc`, `xhttp`, `xhttp_prom`. Dispatcher algorithm 10 (least-loaded, OPTIONS-probed); `dialog` module persists Asterisk-node binding to Postgres for sticky routing across Kamailio failover.

#### 7.2.2 rtpengine

(Unchanged from v1.1.) Sidecar to each Kamailio node, Unix socket control. In-kernel forwarding; DTLS-SRTP termination; ICE termination; SRTP↔RTP bridging; Opus↔PCMU transcoding when trunk requires. Records via `--recording-method=pcap` or SIPREC for compliance recording where Asterisk MixMonitor is insufficient.

#### 7.2.3 Asterisk pool

(Unchanged from v1.1.) Docker containers, PJSIP via realtime against PostgreSQL, ARI exposed on internal :8088, AMI on :5038, `res_prometheus` `/metrics`, CDR/CEL to Postgres direct, recordings to per-tenant `/recordings` volume. **Model B** multi-tenancy (N tenants per Asterisk with per-tenant context + PJSIP auth/aor/endpoint via realtime); escalate to Model A for HIPAA-strict tenants. **Note (v2)**: queue logic is in NestJS, not Asterisk `Queue()`; Asterisk holds calls in MOH-playing Stasis bridges while NestJS dequeues.

#### 7.2.4 TURN (deferred — not in MVP)

(Unchanged from v1.1.) Not deployed in MVP. rtpengine acts as the public media relay with `ICE=force` server-reflexive candidates; v1.x adds coturn when measurable WebRTC connectivity failures emerge. Design hooks: SIP.js `iceServers` config endpoint returns empty array in MVP; UDP port range 49152–65535 reserved on future TURN host; credential provisioning code path sketched but not implemented.

#### 7.2.5 NestJS control plane

(Unchanged from v1.1.) `AriService` (one WebSocket per Asterisk node via `@ipcom/asterisk-ari`), `AmiService` (bulk admin actions: Originate, MixMonitorMute, ChanSpy, reload), `EventBus` (NATS JetStream), `CallOrchestrator` (per-call state machine). One NestJS replica owns each Asterisk ARI WebSocket via Redis lock; others consume events from NATS.

### 7.3 Application plane

NestJS modular monolith deployed as multiple replicas. Modules: `tenant`, `auth`, `users`, `accounts`, `contacts`, `forms`, `messages`, `calls`, `queues` (new), `voicemail` (new), `ivr` (new), `inbound_sms` (new), `recordings`, `dispatch`, `schedules`, `billing`, `tasks`, `reminders`, `notices`, `news`, `audit`, `api_v1`, `api_v2`, `ari`, `ami`, `events`, `webhooks`, `integrations`. Persistence: Prisma or TypeORM. Caches: Redis. Event bus: NATS JetStream.

**Process-isolation exceptions (v2 clarification)**: while NestJS is a modular monolith for API/admin/control, two worker classes deploy as **separate process groups** for resource isolation:
- **Recording worker** (long-lived encryption + S3 upload jobs; CPU and IO heavy).
- **Dispatch worker** (channel-adapter calls to external providers; high-cardinality, retryable).

Both consume from NATS; both stateless; horizontally scaled independent of the API tier.

### 7.4 Frontend plane

Three React + TypeScript + Vite apps, shared component library (`packages/ui`):
- **Operator Console** — call control widget + account panel + form + Home/Old Calls/Tasks/Reminders tabs; SIP.js softphone; WebSocket from NestJS for screen-pop and queue events.
- **Admin** — tenant admin UI (accounts, forms, schedules, users, billing, integrations).
- **Client Portal** — per-tenant subdomain; client_portal_user scope; inbox, recordings, on-call mgmt.

State management: TanStack Query for server state, Zustand for transient UI state. Theme: light-default with blue accent (nCall parity), per-tenant brand colour override. i18next for translations.

### 7.5 REST API surface

#### 7.5.1 nCall-compatible `/v1` (unchanged from v1.1)

| Resource | Path | Methods |
|----------|------|---------|
| Server time | `/time.{xml\|json}` | GET (unauth) |
| Me | `/v1/me.{xml\|json}` | GET |
| Users | `/v1/Users[.{xml\|json}\|/<id>]` | GET, POST, PUT, DELETE |
| Calls | `/v1/Calls[/<id>\|/kpi]` | GET, POST, PUT, DELETE |
| Messages | `/v1/Messages[/<id>]` | GET, POST, PUT, DELETE |
| Contacts | `/v1/Contacts[/<id>]` | GET, POST, PUT, DELETE |
| Clients | `/v1/Clients[/<id>\|/<id>/billing]` | GET, POST, PUT, DELETE |
| Todo | `/v1/todo[/<id>]` | GET, POST, PUT, DELETE |
| OnCall | `/v1/OnCall?account_id=&at=` | GET |
| Field names | `/v1/<Resource>/field_names.{xml\|json}` | GET |

**Plus (NEW in v2)**: for every list endpoint there exists a POST-body equivalent at `/v1/<Resource>/search` accepting the same field filters in the JSON request body, for HIPAA-PHI-in-URL avoidance (§5.14.1).

**Conventions:** `?field=value` filters with `today` / `yesterday` / `tomorrow` and `greater_than_YYYY-MM-DD` / `less_than_YYYY-MM-DD`; `?page_offset=N&page_limit=M` (1-indexed); `?output_fields=F1,F2`.

#### 7.5.2 Modern `/api/v2` (expanded in v2)

JSON only. OAuth2 (Authorization Code + PKCE for users; Client Credentials for service integrations) + PAT. OpenAPI 3.1 at `/api/v2/openapi.json`. Cursor pagination (`?cursor=&limit=`). Errors per RFC 9457 problem-details. Field selection via `?fields=`.

Resource collections (v2 enumerates the surface):

| Collection | CRUD | Special routes |
|-----------|------|----------------|
| `/api/v2/tenants/me` | GET, PATCH | Current tenant settings |
| `/api/v2/users` | full CRUD + `/me`, `/invite`, `/{id}/reset-password` | |
| `/api/v2/roles` | GET | |
| `/api/v2/accounts` | full CRUD | `/{id}/forms`, `/{id}/contacts`, `/{id}/dids` |
| `/api/v2/contacts` | full CRUD | `/{id}/message-actions`, `/{id}/availability` |
| `/api/v2/forms` | full CRUD + `/{id}/versions/{v}` | `/test-render`, `/import`, `/export` |
| `/api/v2/calls` | GET (read-only via API) | `/{id}/recording`, `/{id}/transcript`, `/search` |
| `/api/v2/messages` | full CRUD | `/{id}/dispatches`, `/search`, `/threads` (SMS threads) |
| `/api/v2/dispatches` | GET, PATCH (retry/cancel) | `/{id}/attempts` |
| `/api/v2/queues` | full CRUD | `/{id}/snapshot` (live depth + waiting calls) |
| `/api/v2/operators/skills` | full CRUD | |
| `/api/v2/schedules` | full CRUD | `/{id}/preview?from=&to=` materialised shifts |
| `/api/v2/oncall` | GET | `?account_id=&at=` |
| `/api/v2/voicemails` | GET, PATCH (mark actioned) | `/{id}/audio`, `/{id}/transcript` |
| `/api/v2/ivr-flows` | full CRUD | `/{id}/test-execute` |
| `/api/v2/dids` | full CRUD | |
| `/api/v2/sip-trunks` | full CRUD | `/{id}/health` |
| `/api/v2/billing/schemes` | full CRUD | |
| `/api/v2/billing/line-items` | GET | `/export.csv` |
| `/api/v2/recordings` | GET | `/{id}/url` signed download |
| `/api/v2/audit-log` | GET | `/export.csv` |
| `/api/v2/webhooks` | full CRUD | `/{id}/deliveries`, `/{id}/replay/{delivery_id}` |
| `/api/v2/integrations/{provider}` | GET, PATCH | OAuth-callback handlers |
| `/api/v2/api-tokens` | full CRUD (PAT mgmt) | `/{id}/scopes` |
| `/api/v2/health` | GET (unauth, basic) | system health probe |

**Webhook events** subscribable per-tenant:
- `call.received`, `call.queued`, `call.answered`, `call.ended`, `call.abandoned`
- `message.created`, `message.dispatched`, `message.acknowledged`, `message.failed`
- `voicemail.created`, `voicemail.transcribed`
- `inbound_sms.received`, `inbound_sms.replied`
- `contact.created`, `contact.updated`, `contact.availability_changed`
- `recording.completed`, `recording.failed`
- `dispatch.failed`, `dispatch.acknowledged`

Payloads HMAC-SHA256 signed; at-least-once delivery; exponential backoff; replayable from the dashboard.

#### 7.5.3 Rate limits and API SLA (NEW in v2)

- **Rate limits** per `api_integration` user (`/v1`) or per OAuth client (`/api/v2`):
  - Read endpoints: 300 RPM sustained, 600 RPM burst.
  - Write endpoints: 60 RPM sustained, 120 RPM burst.
  - Bulk endpoints (CSV import): 5 / minute.
- Exceeding the limit returns HTTP 429 with `Retry-After` header.
- **API stability SLA**:
  - `/v1`: backward-compatible indefinitely (CRM constraint). Field additions only; no field removal or rename.
  - `/api/v2`: backward-compatible for 24 months from publication; deprecations announced 12 months ahead; major version bump (`/api/v3`) introduces breaking changes.
- **Uptime SLA** (production-tier tenants): 99.9% MVP / 99.95% v1.x — measured at the edge load balancer (excludes scheduled maintenance windows announced 14 days ahead).

#### 7.5.4 Caching strategy (NEW in v2)

- Read-mostly resources (Forms, Schedules, BillingSchemes, account metadata) cached in Redis with `ETag`-based revalidation; TTL 5 min; invalidated on mutation via event bus.
- High-cardinality read endpoints (Calls list, Messages list) **not** cached — too tenant-specific and time-windowed.
- CRM polling pattern handled via `ETag` + `Last-Modified` headers so polling clients can avoid full payload retrieval.

### 7.6 Data model (expanded in v2)

PostgreSQL. RLS enabled per tenant. Every domain table has `tenant_id`, `created_at`, `updated_at`. Soft-delete via `deleted_at` for user-facing entities; hard-delete reserved for GDPR erasure with audit trail.

Core entities (carries forward from v1.1):

```
Tenant         id, name, slug, sip_domain, kek_id, retention_default_days,
               compliance_flags (jsonb), branding (jsonb)
User           id, tenant_id, username, email, password_hash, roles[], retired,
               mfa_secret, mfa_required, first_name, last_name, mobile
ClientAccount  id, tenant_id, name, account_number, type, color, greeting_text,
               general_notes, sensitive_notes, time_zone, billing_scheme_id,
               call_actions[3] (jsonb), queue_id, required_skills[]
Contact        id, tenant_id, account_id, first_name, last_name, mobile, email,
               alt_phone, vip, ignore, availability_status, retired
MessageAction  id, tenant_id, contact_id, channel, destination, trigger,
               schedule_offset_seconds, filter, template_id,
               escalation_after_seconds, priority
Form           id, tenant_id, account_id, name, current_version_id
FormVersion    id, form_id, version_number, definition (jsonb), created_by, created_at
Call           id, tenant_id, account_id, did_id, operator_id, form_id,
               pbx_call_id, parent_call_id, call_type, call_priority,
               caller_number, caller_name, caller_company,
               call_start, call_answered, call_end, call_end_operator,
               notes_small, notes_large, notes_sms,
               relay_id, delivered_when, status, no_charge,
               transfer_number, call_finished_id, billable, kind
               (voice | inbound_sms | voicemail)
Message        id, tenant_id, call_id, account_id, form_id, form_version_id,
               operator_id, content (jsonb), timestamp_added, tx_code,
               delivery_state, urgent_flag, kind
Dispatch       id, tenant_id, message_id, contact_id, message_action_id,
               channel, destination, state, attempted_at, delivered_at,
               acknowledged_at, error, retry_count, payload_snapshot
OnCallSchedule id, tenant_id, account_id, tier, rrule, contact_id,
               valid_from, valid_until, source
OnCallShift    id, tenant_id, account_id, contact_id, tier, start_at, end_at, source
Recording      id, tenant_id, call_id, started_at, ended_at, duration_seconds,
               storage_url, encrypted_dek (bytea), kek_id, codec,
               redaction_intervals (jsonb), retention_expires_at, pii_purged
BillingScheme  id, tenant_id, name, model, rate, inclusive_minutes,
               rounding_seconds, period, effective_from, effective_until
BillingLineItem id, tenant_id, account_id, scheme_version_id, call_id,
               message_id, billable_quantity, rate_applied, amount,
               period_start, period_end, generated_at
Task           id, tenant_id, account_id, assignee_user_id, title, description,
               state, billing_mode, rate, inclusive_minutes,
               total_seconds_logged, fixed_amount, started_at, completed_at
Reminder       id, tenant_id, user_id, account_id, title, body, due_at,
               fired_at, snooze_until, dismissed_at, urgent
Notice         id, tenant_id, kind, title, body, scope, pinned, expires_at
AuditLog       (partitioned monthly) id, tenant_id, actor_user_id, actor_ip,
               timestamp, action, resource_type, resource_id,
               before_value (jsonb), after_value (jsonb)
```

**New entities (v2)**:

```
Queue          id, tenant_id, name, strategy, max_wait_seconds,
               overflow_queue_id, overflow_target_kind, overflow_target_id,
               max_calls_waiting, abandon_timeout_seconds, hold_music_profile,
               position_announcement_interval_seconds, opt_out_dtmf_digit

OperatorSkill  id, tenant_id, user_id, skill_tag

DID (IncomingTelNo) id, tenant_id, e164, label, account_id, default_call_action,
               default_ivr_flow_id, voice_capable, sms_capable, sip_trunk_id

SipTrunk       id, tenant_id (nullable for shared), name, provider, sip_uri,
               credentials_secret_id, codec_pref, max_concurrent_calls,
               failover_to_sip_trunk_id, status

Voicemail      id, tenant_id, account_id, call_id, recording_id, transcript,
               greeted_with_id (FK to greeting recording), reviewed_by_user_id,
               reviewed_at, dispatched_message_id

IvrFlow        id, tenant_id, name, definition (jsonb DAG of nodes),
               version, current_version_id
IvrFlowVersion id, ivr_flow_id, version_number, definition, created_by, created_at

InboundSms     id, tenant_id, account_id, did_id, from_e164, body,
               attachments (jsonb), conversation_thread_id, received_at,
               replied_by_user_id, replied_at, message_id

ConversationThread id, tenant_id, account_id, peer_e164, last_message_at, status

Webhook        id, tenant_id, url, secret_hash, event_types[],
               headers (jsonb), active, created_at
WebhookDelivery id, tenant_id, webhook_id, event_type, event_id, payload (jsonb),
               attempt_count, last_attempted_at, status, response_code, response_body

IntegrationConfig id, tenant_id, provider (e.g. 'twilio', 'sendgrid', 'google'),
               config (jsonb), oauth_token_secret_id, status, last_synced_at

OAuthClient    id, tenant_id, client_id, client_secret_hash, name,
               redirect_uris[], grant_types[], scopes[], active
ApiToken       id, tenant_id, user_id, name, token_hash, scopes[],
               expires_at, last_used_at, revoked_at
```

**Index notes** (non-exhaustive; high-traffic queries):

- `Call`: `(tenant_id, account_id, call_start desc)`, `(tenant_id, caller_number, call_start desc)` for caller-history pop, `(tenant_id, status)` for queue views.
- `Message`: `(tenant_id, account_id, timestamp_added desc)`, partial index on `(tenant_id, delivery_state) WHERE delivery_state in ('pending','failed')`.
- `Dispatch`: `(tenant_id, state, attempted_at)` for retry worker; `(message_id)`.
- `Contact`: `(tenant_id, account_id, retired)`; gin trigram index on `(first_name || ' ' || last_name)` for search.
- `OnCallShift`: `(tenant_id, account_id, start_at)`; range exclusion constraint to enforce single primary per tier per window.
- `AuditLog`: partitioned monthly; `(tenant_id, resource_type, resource_id, timestamp)` per partition.
- `Recording`: `(tenant_id, retention_expires_at)` for lifecycle worker.

### 7.7 Recording pipeline

(Unchanged from v1.1.) MixMonitor → WAV → worker → encrypt → S3 → Recording row. PCI pause via AMI `MixMonitorMute`; redaction intervals stored; post-process silence with sox. GDPR purge workflow zeroes recording bytes + deletes encrypted DEK.

### 7.8 Dispatch pipeline

(Unchanged from v1.1.) Form save → Message persist → MessageAction enumeration → NATS dispatch queue → channel adapter → state machine → escalation timer → next-tier fan-out.

### 7.9 Deployment topology

Same as v1.1 (no coturn in MVP). `docker compose` for development; Kubernetes/Nomad for production with identical container images.

Production small/launch:
- 2 × Kamailio (active-active, DMQ) with co-located rtpengine.
- 3 × Asterisk.
- 3 × NestJS API + 2 × NestJS recording-worker + 2 × NestJS dispatch-worker (new in v2).
- Patroni Postgres: 1 primary + 2 replicas + 3 etcd.
- Redis Sentinel: 3 nodes.
- NATS JetStream: 3 nodes.
- S3 (managed) or MinIO (self-host).
- Homer (1 capture + 1 web).
- Prometheus + Grafana + Loki + Jaeger.
- Total: ~25–30 containers; 3–5 physical nodes.

### 7.10 External integrations

(Unchanged from v1.1.) SIP trunks (Telnyx, Twilio, Bandwidth — all sign HIPAA BAA); SMS (Twilio/Telnyx); email (SendGrid/SES/SMTP); push (FCM/APNS); calendar (Google/Microsoft); CRM (Salesforce/HubSpot/webhook); trades FSM (ServiceTitan/HousecallPro) v1.x; IT PSA (ConnectWise/Autotask) v1.x; KMS (AWS KMS / Vault); storage (S3/MinIO/GCS).

### 7.11 Cost monitoring on our side (NEW in v2)

We aggregate provider-side cost data into Prometheus metrics and Grafana:

- **Trunk cost meter**: per-tenant rolling sum of `minute × rate-card` derived from CDR + trunk price tables. Alert at >150% of 7-day rolling average.
- **SMS cost meter**: per-tenant count × provider rate. Alert on sudden 5× spike.
- **AI inference cost**: per-tenant tokens × provider rate (for v1.x transcription + summarisation).
- **Storage cost meter**: per-tenant S3 / Glacier storage growth.
- **Bandwidth meter**: per-tenant RTP-out volume (rtpengine stats).
- **Composite spend report**: per-tenant weekly digest emailed to internal billing team.

This complements the tenant-side anti-fraud monitor (§6.3) — that one protects against tenant abuse of *us*; this one protects against *our* runaway external cost.

---

## 8. Compliance Plan

(Unchanged from v1.1.) HIPAA: BAAs everywhere, encryption in transit + at rest, RLS + column encryption, 7-year retention, append-only audit, no PHI in non-secure SMS. **v2 addition**: PHI not in URL query strings (§5.14.1). GDPR: EU residency for EU-domiciled tenants, DPA template, right to erasure workflow, DPIA per tenant. PCI: delegated capture (Telnyx Pay) preferred, pause+redact fallback, network segmentation, quarterly ASV scans. Baseline: TLS 1.2+, MFA for admins, audit log, quarterly subprocessor review.

---

## 9. Commercial Model

### 9.1 Market positioning

> **Confidence note (v2):** Public price points below are inherited from v1.1 research; only nCall has a third-party-leaked figure (2021); competitor figures come from a 2021 industry article. Treat as **order-of-magnitude** indicators. **Validate with at least 5 prospect conversations before committing.**

| Vendor | Per-seat / month | Setup | Model |
|--------|------------------|-------|-------|
| nSolve nCall | ~$65–80 (2021 leak) | Low | On-prem |
| Amtelco | ~$300 | ~$20k | On-prem |
| Startel CMC | ~$375 | ~$17k | On-prem |
| EVS7 Fox | $149 | Minimal | Cloud |
| Virtual TAS | $89 | $1,495 | Cloud |
| AI-native (Bland.ai etc.) | $25–200 flat | None | AI |

We target **mid-market cloud SaaS** — more capable than EVS7/Virtual TAS, far more affordable than Amtelco/Startel, modern UX + AI built-in, with **nCall REST API compatibility** as a differentiator for migrators.

### 9.2 Pricing axes

(Unchanged from v1.1.) Per concurrent operator seat (primary), tiered. Inclusive bundles per seat. Add-ons: AI agent (per-minute), recording storage beyond default, HIPAA mode, premium support. Telephony pass-through at cost + margin; SMS/push/email same.

### 9.3 Plans (working straw-man)

| Plan | Seat price | Inclusive | Target |
|------|-----------|-----------|--------|
| Starter | $99/seat/mo, 1–10 seats | 500 calls + 200 SMS + 1 GB / seat | Boutique VR, MSP after-hours |
| Growth | $79/seat/mo, 11–25 seats | 1,000 calls + 500 SMS + 5 GB / seat | Mid-size TAS |
| Scale | $59/seat/mo, 26+ seats | 2,500 calls + 1,000 SMS + 20 GB / seat | Established TAS |
| HIPAA add-on | +$20/seat/mo | 7y retention, BAA, residency choice | Medical |
| AI Receptionist | $0.50 / 3-min call | After-hours auto-attendant | Optional |

15% annual discount. Migration assistance bundle $2k–$5k. 30-day free trial, 2 seats, no card, sandbox.

### 9.4 Billing implementation

Stripe Billing for tenant subscriptions; metered usage via Stripe Meters API; self-serve sign-up + checkout for Starter and Growth; sales-assisted for Scale; self-serve cancellation with full data export.

---

## 10. Phased Roadmap

### 10.1 MVP (v1.0) — honest estimate

> **Confidence note (v2):** v1.1 estimated 6–9 months; on reflection this was **aggressive** given the scope (multi-tenant + HIPAA/PCI/GDPR + horizontally-scalable telephony + nCall UX parity + two REST surfaces + queue/voicemail/IVR/inbound-SMS). **Honest estimate: 9–12 months** with a team of **4–5 senior engineers** (1 senior backend / telephony, 1 mid-senior backend, 1 senior frontend, 1 mid-senior frontend, 1 DevOps/SRE) plus a 0.5 product manager and 0.25 QA. Smaller team = pro-rata longer. Estimate volatility ±25%.

**MVP scope:**
- All FRs in §5.1 – §5.20.
- Telephony: Kamailio + rtpengine + Asterisk pool + NATS + Patroni Postgres + Redis Sentinel + Homer + Prometheus + Loki + Jaeger. **No TURN/coturn** (§7.2.4). **No coturn metrics yet.**
- Single-region (US-East). Primary SIP trunk Telnyx, secondary Twilio.
- HIPAA-ready (BAAs), GDPR-compatible (erasure workflow), PCI via delegated capture.
- `docker compose` local-dev gate passes.
- One pilot tenant onboarded with the migration-assistance bundle.

### 10.2 v1.1 — +3 months after MVP

- ServiceTitan + HousecallPro native integrations.
- AI Receptionist (ChatJack-style) using LLM + ASR.
- QA scorecard module (ATSI criteria).
- EU-region deployment for first GDPR-strict tenant.
- Stripe Billing self-serve tenant onboarding.
- **TURN/coturn deployment** when corporate-NAT failures become measurable (§7.2.4).

### 10.3 v1.2 — +3 months

- Native mobile on-call recipient app (iOS + Android).
- Salesforce + HubSpot native.
- Post-call AI summary + sentiment.
- Agent-assist advisory.

### 10.4 v2 — +6 months

- Multi-region active-active.
- Omnichannel inbox (web chat + two-way SMS into operator console).
- Native ConnectWise + Autotask.
- Training mode (shadow + supervised takeover).
- Advanced reporting (cohort analytics, custom dashboards).

---

## 11. Risks and Open Questions

(Carries forward from v1.1, with v2 additions.)

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|-----------|
| CRM integration breakage despite "compatible" API | High | Medium | CI smoke-test against the CRM's known consumed endpoints; dry-run with CRM sandbox before cutover |
| nCall undocumented behaviour surfaces late | Medium | High | "Compatibility sprint" mid-build against a live nCall instance; track deviations as documentation, not bugs |
| Asterisk + rtpengine + Kamailio operational complexity | High | Medium | Senior VoIP engineer for first 6 months; Sipwise NGCP + Wazo as reference; Homer for fast debugging |
| HIPAA + PCI overlap is design-difficult | Medium | Medium | PCI defaults to delegated capture; HIPAA recording-by-default uses pause+redact carefully tested |
| Cost of recording storage at scale | Medium | High | S3 lifecycle to Glacier after 90 days; per-tenant retention defaults; bill overage as metered add-on |
| Single-Asterisk-node failure drops in-flight calls on that node | Low | High | Accepted; redundancy at node level not call level; pool size kept above min-N |
| AI-native competitors commoditise operator workflow | High | Medium (long-term) | AI agent as first-class capability; position as "human-in-the-loop + AI handoff" |
| GDPR EU residency adds infra cost | Medium | Medium | EU stack only when first EU tenant signs |
| Operators reject web UI vs desktop habit | High | Low | Replicate nCall layout to the letter; usability-test with 3 real nCall operators at first MVP demo |
| Kamailio config mis-configuration → outage | High | Medium | Config-as-code in git, peer review, staging cluster mirroring prod, kemi Lua hot-reloadable |
| WebRTC connectivity failures from corporate NAT (no TURN in MVP) | Medium | Low-Medium | Accepted as MVP limitation; monitor failed-ICE rate; v1.1 coturn rollout when threshold breached |
| Local-dev divergence from production | Medium | Medium | Same container images; CI runs against same `docker compose` stack |
| **Queue strategy in NestJS adds latency vs native Asterisk Queue** (v2) | Low | Medium | Measure dequeue latency in load tests; budget 200 ms p95 from queue-arrival to ringing |
| **Voicemail transcription provider lock-in** (v2) | Low | Medium | Provider-pluggable interface; can swap Whisper / Deepgram / AWS Transcribe |
| **IVR DTMF events lost on ARI reconnect** (v2) | Medium | Medium | Persist flow state on Channel variables + Postgres; reconcile on Stasis reconnect |
| **Inbound SMS thread fragmentation across operators** (v2) | Low | Medium | Conversation threads atomically claimed per operator; admin override |
| **9–12 month timeline still slips** (v2) | High | Medium | De-scope from MVP toward v1.1 the moment a critical-path module trends ≥30% over estimate |

### Open questions

1. **Primary SIP trunk?** Recommended: Telnyx (HIPAA BAA, Opus, modern API); Twilio secondary.
2. **Single-region vs EU+US from day one?** Recommended: single-region MVP; EU when first EU tenant signs.
3. **KMS choice tenant-facing?** Recommended: AWS KMS only v1; Vault offered v2 for self-host enterprises.
4. **PCI delegated capture in MVP or v1.1?** Recommended: pause+redact in MVP; Telnyx Pay delegation v1.1.
5. **Web push for portal in MVP?** Recommended: yes; native mobile push v1.2.
6. **Hardware SIP phone auto-provisioning?** Recommended: manual MVP; XML auto-provisioning v1.x.
7. **Calendar OAuth scopes?** Recommended: read-only MVP; two-way sync v1.1.
8. **Tenant SLA?** Recommended: 99.9% MVP, 99.95% v1.x.
9. **(NEW v2)** **Voicemail transcription provider for MVP?** Recommended: Whisper (open-source self-host) for the MVP cost story; offer Deepgram as paid quality-tier v1.x.
10. **(NEW v2)** **AI Receptionist roadmap order — before or after mobile app?** Recommended: AI first (more revenue defence vs Bland.ai-class threats).

---

## 12. Acceptance Criteria for MVP

(Carries forward from v1.1, expanded.)

1. Tenant created with at least 1 account, 3 contacts, 1 form, 1 billing scheme, 1 DID, 1 Queue.
2. PSTN test call → operator browser softphone → screen-pop with correct account, greeting, Call Actions, caller history, VIP/Ignore badges.
3. Operator clicks Call Action → form opens → required fields enforced → save fires Message + Message Actions on **all 5 channels** (email/SMS/outbound/webhook/push) within 10 s.
4. Call recorded → encrypted with tenant KEK → uploaded to S3 → supervisor plays back via signed URL.
5. Pause Recording mid-call → resulting WAV has silence in interval → metadata has matching `redaction_intervals`.
6. CRM smoke-test against all consumed `/v1` endpoints passes 100%.
7. Supervisor dashboard shows operator in `OnCall` state; supervisor `ChanSpy` listen-in works.
8. Client portal user logs in → sees Message in inbox → plays recording → updates contact availability → operator's "Who is on-call" reflects within 5 s.
9. Second Asterisk node joins dispatcher; calls distribute; first node drained without affecting in-flight calls on second.
10. HIPAA + GDPR + PCI checklist signed off against implemented controls.
11. Observability: Homer captures full SIP flow; Prometheus shows live metrics; Jaeger trace spans Kamailio → Asterisk → NestJS → dispatch.
12. Audit log shows complete chain of events for the test call.
13. Documentation: tenant onboarding runbook, operator training quick-start, API integration guide, on-call SRE runbook.
14. **Local-dev parity gate**: fresh clone → `make dev-up` → synthetic test call through sidecar trunk emulator → screen-pop, message, dispatch — within 5 minutes; all visible in local Homer/Prometheus/Jaeger.
15. **(NEW v2)** Queue + Voicemail end-to-end: all operators busy → caller enters queue → 30 s position announcement → max-wait timeout → routed to voicemail → 60 s message recorded → encrypted + transcribed → appears in operator review queue + client portal inbox.
16. **(NEW v2)** IVR end-to-end: caller dials DID with IVR-bound flow → hears prompt → presses 1 → routed to medical_priority Queue with `priority=high`; presses 2 → routed to voicemail.
17. **(NEW v2)** Inbound SMS end-to-end: SMS to tenant DID → appears in operator inbox as thread → operator replies → caller receives outbound SMS attributed to operator.
18. **(NEW v2)** PHI-in-URL avoidance: HIPAA tenant CRM uses `POST /v1/Messages/search` body-filter; access logs verifiably contain no PHI; URL-only path is also functional but logs show only hashed query strings via scrub middleware.
19. **(NEW v2)** Time-zone correctness: a Schedule defined in `Europe/London` is honoured across DST boundary; report rendered in account TZ shows local times; the same data exported in UTC matches.
20. **(NEW v2)** Accessibility audit: operator console keyboard-navigable end-to-end (inbound call flow uses no mouse); axe-core scan reports zero AA violations.

---

## 13. Glossary

(Unchanged from v1.1.)

TAS · TSR · Tenant · Client Account · Contact · DID · CLI/ANI · Call Action · Message · Message Action · Dispatch · On-Call · Patch · STAT · ATSI · CAM-X · NAEO · PHI · PII · PCI · BAA · DPA · SBC · ARI · AMI · PJSIP · HEPv3 · KEK/DEK · WSS · SRTP. **New (v2):** Queue · OperatorSkill · IvrFlow · Voicemail · InboundSms · ConversationThread · Webhook · WebhookDelivery · MoH (Music on Hold) · ASR (Automatic Speech Recognition) · MOS (Mean Opinion Score) · PLC (Packet Loss Concealment) · RLS (Row-Level Security in PostgreSQL).

---

## 14. Appendix A — `/v1` API endpoints

(Carried forward from v1.1; abbreviated. See §7.5.1 for the verbatim contract.)

```
GET    /time.{xml|json}                                  (unauth)
GET    /v1/me.{xml|json}                                 (Basic)
GET    /v1/Users[.{xml|json}|/<id>]                      + POST/PUT/DELETE
GET    /v1/Users/field_names.{xml|json}
GET    /v1/Calls[.{xml|json}|/<id>|/kpi]                 + POST/PUT/DELETE
GET    /v1/Messages[.{xml|json}|/<id>]                   + POST/PUT/DELETE
GET    /v1/Contacts[.{xml|json}|/<id>]                   + POST/PUT/DELETE
GET    /v1/Clients[.{xml|json}|/<id>|/<id>/billing]      + POST/PUT/DELETE
GET    /v1/todo[.json|/<id>]                             + POST/PUT/DELETE
GET    /v1/OnCall.{xml|json}?account_id=&at=

POST   /v1/<Resource>/search           (NEW in v2 — PHI-in-body alternative)
```

Filtering, pagination, field selection conventions per §7.5.1.

---

## 15. Appendix B — Operator screen layout

(Carried forward from v1.1.)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  [≡] Acme Answering Service              [op: jdoe ▾]  [● Available]  [Home]│
├──────────────────────────────┬─────────────────────────────────────────────┤
│ CALL CONTROL                 │  ACCOUNT / CONTACT PANEL                    │
│ ┌──────────────────────────┐ │  ┌───────────────────────────────────────┐  │
│ │ Caller: (415) 555-0124   │ │  │  ACME PROPERTY MGMT     [type: Prop]  │  │
│ │ Name:   Jane Doe         │ │  │  "Good evening, Acme Property…"       │  │
│ │ ┃ 00:42 ON CALL          │ │  │  General notes: emergency-after-hours │  │
│ │ [📞] [🛑]  [Hold] [Swap] │ │  │  Sensitive: <red> tenants with arrears│  │
│ │ [Transfer ▾] [Conf] [⏸ R]│ │  │  Caller history: 2 prior calls        │  │
│ │ Line 2 (held)            │ │  │  ⚑ VIP                                │  │
│ │   Bob Smith   01:12      │ │  │  [1] Take Message  [2] Transfer Mgr   │  │
│ └──────────────────────────┘ │  │  [3] Provide Hours                    │  │
│                              │  └───────────────────────────────────────┘  │
│                              │  RESOURCE PANEL                             │
├──────────────────────────────┴─────────────────────────────────────────────┤
│  MESSAGE FORM — "Emergency Maintenance Intake" v3                          │
│  Tenant name *   Unit # *   Phone *   Issue *   Severity *  When started   │
│  Notes                                                                      │
│  Reassign to: [On-call: Bob Maint. ▾]                                      │
│  [Cancel] [Save Draft] [Save & Dispatch] [Save & Patch on-call]            │
├────────────────────────────────────────────────────────────────────────────┤
│  [Home] [Old Calls] [Tasks] [Reminders] [SMS Inbox (3)] [Voicemails (1)]   │
└────────────────────────────────────────────────────────────────────────────┘
                                       ^ new in v2: SMS Inbox + Voicemails tabs
```

---

## 16. Appendix C — Local-dev quick-start

```
git clone <repo>
cd ncall-clone
make dev-up         # brings up the entire docker-compose stack + seeds tenant
                     # services started:
                     #   kamailio, rtpengine, asterisk-1, postgres, redis, nats,
                     #   minio, homer, prometheus, grafana, loki, jaeger,
                     #   nestjs-api, nestjs-recording-worker, nestjs-dispatch-worker,
                     #   admin-ui, operator-ui, portal-ui, sip-trunk-emulator

open http://localhost:3000/operator      # operator console
open http://localhost:3001/admin         # admin
open http://localhost:3002/portal        # client portal
open http://localhost:9080/              # Homer (SIP traces)
open http://localhost:9090/              # Prometheus
open http://localhost:3030/              # Grafana
open http://localhost:16686/             # Jaeger

# place a test call via the sidecar trunk emulator
make test-call             # synthesizes a SIP INVITE to a seeded DID
                            # observe: screen-pop in operator-ui within 1 s

make dev-down              # cleanly tear down
make dev-reset             # wipe volumes + reseed
```

---

## 17. Confidence and triple-check log

### 17.1 Correctness

All v1.1 correctness anchors carry forward (nCall URL contract, field names, pagination, filter shorthands, content negotiation; nCall desktop UX patterns; Kamailio module choices; rtpengine NAT mandate; Model B Asterisk; MixMonitor + AMI mute; envelope encryption; sticky routing via dispatcher + dialog DB-backed; Wazo + Sipwise NGCP reference). v2 additions are anchored in industry standards (JsonLogic for form rules, Whisper/Deepgram for ASR, JSON Schema for form data, RFC 5545 for schedules, RFC 9457 for API errors, WCAG 2.1 AA for accessibility) — these are well-trodden choices that should not surprise the implementing team.

### 17.2 Comprehensiveness

Sections cover: executive summary, calibration, goals, scope, functional requirements (20 groups, up from 15), non-functional requirements (7 groups, up from 5), technical architecture (11 sub-sections, up from 10, including expanded data model with 11 new entities), compliance plan (with PHI-in-URL addition), commercial model (with explicit confidence note), phased roadmap (with honest team-size + timeline), risks (5 new entries), acceptance criteria (7 new entries), glossary (12 new terms), three appendices.

### 17.3 Internal consistency

- Multi-tenancy thread is continuous: tenant in §5.1 → Asterisk Model B in §7.2.3 → RLS + column encryption in §6.3 → per-tenant KEK in compliance §8.
- Recording-on-by-default + PCI redaction reconciled via delegated capture preference in §8.
- HIPAA + GDPR + PCI handled per-framework in §8 (no double-counting).
- `/v1` and `/api/v2` are both first-class (§5.12 FR-API3) and both backed by the same domain layer (§7.5).
- "Inspired by, not exact clone" stance held throughout.
- Pricing confidence labelled explicitly at point of use (§9.1) rather than only buried in this log.
- Queue strategy in NestJS rather than Asterisk `Queue()` is explained at point of choice (§5.3.5 FR-Q10) and the resulting latency risk is in the risk register (§11).
- Local-dev `docker compose` is a first-class requirement (§6.5) backed by acceptance criterion #14 and Appendix C.

### 17.4 Honest residual uncertainty

The points where I would not bet my career on this PRD being right:

- **9–12 month timeline.** Telephony projects historically slip. The risk register flags this; the recommended mitigation is aggressive de-scoping.
- **Pricing.** $59–$99/seat is a reasonable opening; real prospect conversations will reshape it.
- **nCall undocumented quirks.** A "compatibility sprint" against a live instance is necessary; planning for zero surprises would be naïve.
- **HIPAA/PCI overlap on the same call.** Recording on by default + card-capture happening on the same call requires careful test choreography. Delegated capture mitigates but is not silver.
- **Asterisk queue strategy in NestJS.** Latency budget is plausible but not proven; load tests at 100+ concurrent dequeues should confirm.

If any of these turn into early-build pain, the right response is to reshape the plan, not to push through.

---

*End of PRD v2.0.*
