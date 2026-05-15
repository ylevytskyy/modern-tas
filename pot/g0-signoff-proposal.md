# G0 Sign-off Proposal — PoT Phase 0 → MVP Construction

> Decision artefact for senior-architect + compliance-lead sign-off. Drafted 2026-05-13 at end of Phase 0 spike execution. Recommends a Phase 0 → Phase 1 (Sprint 0) → Phase 2 (MVP build) transition under a pragmatic reading of ARCH §2.4's G0 gate enum.

---

## TL;DR

Five of eight PoT spikes are Green and ratified. Three are Deferred — vendor / data prereqs that cannot be synthesised without invalidating the named hazard (S4: medical-ASR + telephony PII fixtures; S6: live nCall instance + endpoint inventory; S7: Temporal Cloud BAA). ARCH v0.4 §2.4 declares G0 closeable only on Green / Yellow-with-remediation / Red — "Deferred" is unlisted. We recommend a **pragmatic reading** of the gate (Path B): adopt documented fallbacks for S6 + S7 as MVP-baseline, carve S4 out for an explicit Sprint-0 compliance re-decision, expand the gate enum to include "Deferred-with-fallback-plan" alongside Yellow, and proceed to MVP construction in parallel with the S4 deliberation.

The alternative (Path A — strict reading) blocks MVP kickoff for an estimated 6–12 calendar weeks while S4 fixture capture, S6 vendor access, and S7 sales correspondence resolve, with no compensating reduction in hazard exposure (the three Deferred spikes' fallbacks are documented and the analytic content is captured).

## What this asks for

Two signatures, both required, on three decisions:

| # | Decision | Senior architect | Compliance lead |
|---|---|---|---|
| 1 | G0 enum interpretation: **Path A (Strict)** vs **Path B (Pragmatic)**. | ✓ | ✓ |
| 2 | If Path B: per-Deferred-spike closure (S4: re-decide in Sprint 0; S6: adopt Yellow fallback; S7: adopt self-host fallback). | ✓ | ✓ (S4 specifically — HIPAA load-bearing) |
| 3 | Sprint-0 budget acknowledgment: +0.5–1 FTE platform-engineering for S7 self-host; Sprint-0 calendar carve-out for S4 re-decision; M25 module construction blocked until S6 fallback fixtures land. | ✓ | — |

If both signatures are obtained on this proposal as-written, G0 is declared closed and Sprint 0 commences against the schedule in §"What this binds" below.

---

## State at end of Phase 0

### Per-spike status

| # | Spike | Status | Tag | ADR | Headline finding |
|---|---|---|---|---|---|
| S1 | End-to-end telephony happy path (Layer 1) | **Green** | `pot/S1` | — | screen-pop p95 = 2 ms vs 800 ms budget (400× margin); failover TTFOK = 573 ms vs 30 s (52×); 0 zombies on 110 calls. Layer 2 (rtpengine media smoke) deferred to Sprint 0 — see Open risk #1. |
| S2 | NestJS-arbitrated queue dequeue latency | **Green** | `pot/S2` | ADR-0024 ✓ | p95 = 6 ms vs 200 ms (33× margin); Redis lock contention + NATS lag probes authored but unrun (baseline margin made them optional). |
| S3 | ARI leader 100 ms hard-stop | **Green** | `pot/S3` | ADR-0016 ✓ (amended) | Wire close 1 ms vs 100 ms budget; reconcile 1474 ms vs 7 s. **Two ADR-0016 amendments**: TTL > HB (3:1 ratio), Asterisk accepts multi-WS (better than ADR assumed). |
| S4 | Two-pass redaction accuracy on 8 kHz μ-law | **Deferred** | — | ADR-0013 (Proposed) | Phase-0 blocked: AssemblyAI Universal-3 Pro Medical key + 30 annotated telephony fixtures. **HIPAA-load-bearing**; fallback options are weak. See §S4 detail below. |
| S5 | Supavisor `SET LOCAL` parity | **Green** | `pot/S5` | ADR-0018 ✓ | Same backend pid across transactions; no setting leak across COMMIT boundary on a reused server backend. |
| S6 | `/v1` byte-for-byte fixture capture | **Deferred** | — | (none — feeds M25 module) | Phase-0 blocked: live nCall instance access + CRM-consumed-endpoint inventory. Documented Yellow fallback exists (scrape CRM response cache) — see §S6 detail. |
| S7 | Temporal Cloud BAA + EU namespace | **Deferred** | — | ADR-0015 (Proposed) | Phase-0 blocked: vendor sales/legal correspondence (2–6 week cycle, not initiated). ADR-0015 documents a self-host fallback — see §S7 detail. |
| S8 | Caddy 2.10+ permission + LE rate-limit | **Green** | `pot/S8` | ADR-0019 ✓ (amended) | HAProxy dreq 58 193 / 59 597 (97.6 % rejected at sustained 1000/s unknown-SNI); 0 cert files written for 59 k declined connections. **Three ADR-0019 amendments**: Caddy decline-LRU claim was false (the actual mechanism is storage short-circuit on non-2xx `ask` response); permission endpoint re-attributed as the load-bearing layer 2; threshold tunability footnote on the 1000/s/source production threshold. |

### Per-ADR ratification

| ADR | Subject | Status | Blocked on |
|---|---|---|---|
| ADR-0013 | Two-pass redaction pipeline | Proposed | S4 close-out (this proposal — see §S4) |
| ADR-0015 | Temporal Cloud Enterprise tier | Proposed | S7 close-out (this proposal — see §S7) |
| ADR-0016 | ARI leader design | **Accepted** | — |
| ADR-0018 | Supavisor pooling | **Accepted** | — |
| ADR-0019 | Caddy 2.10+ LE posture | **Accepted** | — |
| ADR-0024 | Queue dequeue budget | **Accepted** | — |

### Tag chain

All five Green spikes are tagged at their final commit on each spike branch:

```
pot/S5 = 3c9696a   (ADR-0018 ratification)
pot/S2 = c755a04   (ADR-0024 ratification)
pot/S3 = 956d6f6   (ADR-0016 ratification)
pot/S1 = 972e71d   (S1 readout — S1 has no ADR)
pot/S8 = 03b3a9d   (ADR-0019 ratification)
```

Per ARCH §2.4: "The 8 spike directories are tagged `pot/<spike>` in git for forensic reference and then deleted from `main` (their fixtures and ADR evidence carry forward)." Tag-chain symmetry is preserved (each tag captures the spike's full work including any ADR amendments + ratification).

The three Deferred spikes (S4, S6, S7) have spike branches but no tags — consistent with the convention that only Green spikes are tagged. If a Deferred spike's fallback is adopted as the close-out, no tag is needed (the fallback is documented in the ADR, not in the spike directory).

---

## The G0 enum problem

ARCHITECTURE v0.4 §2.4 enumerates three Phase-0 outcomes per spike:

> "All 8 spikes Green, **or** any Yellow has a written remediation plan signed by the senior architect + the spike's owner + the on-call compliance lead. **Red blocks MVP kickoff.**"

The enum is { Green, Yellow-with-remediation, Red }. "Deferred" is not on the list. Three of eight spikes (S4, S6, S7) hit a structural barrier the ARCH didn't anticipate: hazards where the measurement *requires* a vendor / data prereq that cannot be synthesised without erasing the hazard itself (any substitute makes the Green verdict meaningless). The Phase-0 deferrals are honest — these spikes' work cannot be done in Phase 0 in good faith — but the gate enum has no slot for them.

Two interpretations are available:

### Path A — Strict reading

"Deferred" maps to "Red" until the prereqs land. G0 cannot close until S4 + S6 + S7 are all resolved one way or another. Realistic only if Sprint 0 can absorb the full vendor / data acquisition cycle in calendar time.

**Cost**:
- S7 sales/legal cycle: 2–6 weeks calendar (outreach → response → BAA review → signature).
- S4 medical-ASR key acquisition: vendor sales cycle (1–4 weeks) + 30-fixture corpus capture and annotation (4–8 weeks if recruiting + recording from scratch).
- S6 vendor access: best-case days (existing tenant + read-only user); worst-case weeks (vendor sandbox request).
- Total: 6–12 calendar weeks before MVP kickoff; many of those weeks are calendar-blocked (sales cycle) rather than effort-blocked.

**Benefit**:
- G0 closes under the literal ARCH §2.4 text. No enum stretching.
- Each Deferred spike either kills its hazard (executes Green) or surfaces an explicit Red, enabling ADR renegotiation pre-MVP.

### Path B — Pragmatic reading

Extend the gate enum with "Deferred-with-fallback-plan", parallel to Yellow-with-remediation. Each Deferred spike has a documented fallback in its spike README or its primary ADR. G0 closes when each Deferred spike's fallback is signed off as acceptable for MVP, with the live-vendor path either landed in Sprint 0 or explicitly tracked as a Sprint-N upgrade.

**Cost**:
- Some hazards remain *un-killed* at G0. If a fallback turns out to be wrong, MVP-construction work bleeds.
- The enum extension is a documented stretch of ARCH §2.4; future architects need to know why "Deferred" is acceptable here but should not become a routine outcome.

**Benefit**:
- Phase 0 → Sprint 0 transition happens on calendar without waiting on vendor cycles.
- Fallback adoption is *itself* a forcing function: the moment the fallback is chosen, the spike's ADR can land at Accepted (referencing the fallback in §Decision) and downstream module construction can proceed.
- The three Deferred fallbacks are *not* uniformly weak — S6 and S7 have well-scoped fallbacks; only S4's fallback is genuinely fraught (see §S4).

---

## Recommendation: Path B (Pragmatic), with conditions

We recommend Path B for the gate, with **three per-Deferred-spike sub-decisions** that close out S4, S6, S7 differently because their fallbacks are not uniformly viable.

The case for Path B over Path A:

1. **Calendar fit.** Phase 0 was scheduled at 4–6 weeks (ARCH §2.4). It has run ~at-budget for the spike-execution work. Path A adds 6–12 weeks before MVP kickoff with no compensating analytical clarity — the spikes' hazards are already characterised in pot-readout.md; the missing piece is *whether the deployed system handles them*, which Phase 0 cannot answer for vendor-blocked spikes.

2. **Fallback quality is per-spike, not uniform.** S6 and S7 have documented fallbacks that genuinely close the hazard (cache scrape captures actual CRM-consumed surface; self-host Helm captures all of Temporal Cloud's functionality with identical SDK code). S4's fallback is weaker (manual-QA-only redaction or de-scope — both have compliance implications). Path A treats all three Deferreds identically; Path B lets us close S6 + S7 cleanly and isolate S4 for explicit additional thought.

3. **Risk asymmetry favours Path B for S6 and S7.** If the S6 cache scrape proves insufficient for some `/v1` endpoint, M25 will surface the gap during construction (compile error, integration test failure) before reaching production. If the S7 self-host proves operationally infeasible, Sprint 0 can pivot back to Temporal Cloud once the BAA letter arrives. Neither is irreversible.

4. **Risk asymmetry favours Path A for S4 *if and only if* the fallback is unacceptable on compliance grounds.** This is the load-bearing question and we want the compliance lead to make it explicitly, with all options stated.

The conditions below operationalise this.

---

## Per-Deferred-spike close-out paths

### S4 — Two-pass redaction (ADR-0013)

**Hazard the spike was killing**: medical-domain ASR + PII boundary accuracy on 8 kHz μ-law telephony audio. ADR-0013 commits to a two-pass pipeline (Whisper / faster-whisper for word boundaries + AssemblyAI Universal-3 Pro Medical for medical-domain entity extraction + Presidio for PII coverage of non-medical entities — digits, addresses, names). The Phase-0 question was: under realistic telephony band-limiting, does this pipeline achieve the F1 score ADR-0013 commits to?

**Why deferred**: AssemblyAI Universal-3 Pro Medical key is gated by vendor sales (medical-tier SKU, not self-serve). 30 annotated telephony fixtures with documented PII spans are not publicly available (HIPAA). Substitution erases the hazard — Whisper-only WER on synthetic TTS audio measures the wrong thing.

**Compliance regime**: HIPAA-load-bearing. Per project memory, recording is on by default with PCI pause; HIPAA tenants generate PHI in recordings. Redaction is the mechanism that makes HIPAA-tenant recording compliant. ADR-0013 is therefore a load-bearing compliance commitment.

**Options:**

| Option | Description | Compliance posture | Cost |
|---|---|---|---|
| A. Land prereqs in Sprint 0 | Acquire AssemblyAI medical key (1–4 weeks sales) + capture + annotate 30 telephony fixtures (4–8 weeks recruiting / recording). Then execute S4 inline. | Compliant by design — ADR-0013 ratifies on real measurement. | 5–12 calendar weeks; ~0.5 FTE compliance + 0.3 FTE backend for fixture capture. |
| B. Manual-QA-only redaction | Every recording reviewed by a human reviewer before being made available to operators. No ML pipeline. | Compliant *if* QA staffing scales with volume. Probably not viable for high-volume HIPAA tenants. | Operational; ~1 FTE per N hours of daily recording, where N depends on review SLA. |
| C. Disable recording on HIPAA tenants | Remove the PHI surface by removing recording entirely on HIPAA-flagged tenants. ADR-0013 becomes a non-HIPAA-only feature. | Compliant trivially; conflicts with the "recording on by default" product posture. | Product-roadmap conflict; HIPAA tenants lose recording-based features (search, transcripts, QA). |
| D. De-scope ADR-0013 entirely | No automatic PII redaction. Recordings exist but operators see raw audio. | Non-compliant for HIPAA tenants under current US HHS interpretation; would require tenant-side BAA opt-out + per-recording manual review on-demand. | Compliance-policy conflict; very likely a non-starter. |

**Recommendation**: Defer the S4 sub-decision to a dedicated Sprint-0 compliance review session, scheduled within 2 weeks of G0 sign-off. The compliance lead drives that session; outputs are either Option A (preferred — start the AssemblyAI sales cycle now in parallel with Sprint 0 work) or a chosen variant of Options B/C with an updated ADR-0013 §Decision. ADR-0013 stays Proposed until that session lands.

**Rationale for the deferred sub-decision**: All four options have material consequences and no obvious dominant choice; rushing this at the G0 gate is worse than spending 2 weeks getting it right with the right people in the room. Option A is the technical default but blocks on calendar; Options B/C/D require explicit compliance-posture sign-off the senior architect alone cannot give.

**G0 implication**: ADR-0013 stays Proposed at G0 sign-off. MVP construction can proceed on non-recording features (everything outside the recording / redaction pipeline) while the S4 sub-decision settles. M25 / M30 modules touching recording pause for the 2-week sub-decision window. Acceptable because recording features land mid-MVP (per ARCH §3 module sequencing), not at MVP-start.

---

### S6 — `/v1` byte-for-byte fixture capture (no ADR; feeds M25 module)

**Hazard the spike was killing**: PRD §7.5 may not match what live nCall actually returns. M25 (the `/v1` compatibility module) builds against a spec; if the spec is wrong, the live CRM will hit incompatibilities the test suite cannot catch.

**Why deferred**: Live nCall instance access (vendor sandbox or read-only tenant) + CRM-consumed-endpoint inventory (from existing CRM source / access logs / dev interview) are not available. Any synthesis (PRD-driven generator, mock server) just echoes the spec back.

**Compliance regime**: GDPR-touch (the live CRM stores EU customer data; fixture capture must redact). Not the load-bearing compliance question.

**Options:**

| Option | Description | M25 fidelity | Cost |
|---|---|---|---|
| A. Land prereqs in Sprint 0 | Get a vendor sandbox or set up read-only tenant; gather endpoint inventory; execute curl-loop capture against ~200 fixture points. | High fidelity — every consumed query shape captured byte-for-byte. | Days–weeks depending on vendor responsiveness; ~0.2 FTE backend. |
| B. Adopt Yellow fallback (CRM cache scrape) | Scrape the existing CRM's HTTP response cache; extract `/v1` XML responses by request URL; land in `/contracts/fixtures/v1-xml/`. | Adequate fidelity for endpoints the CRM uses today; lower fidelity for endpoints/queries the CRM doesn't currently use (those become Sprint-N upgrades). | ~0.1 FTE backend; one-shot scrape script. |

**Recommendation**: Adopt Option B (Yellow fallback) as MVP-baseline. Track live-capture (Option A) as a Sprint-N upgrade. Rationale: M25's compatibility constraint per project memory ([[crm-api-compat]]) is "drop-in compatibility is non-negotiable" — which means matching what the CRM *uses*. The CRM's response cache *is* the authoritative record of what the CRM uses. Option A would capture an additional surface (queries the CRM could theoretically issue but doesn't), but that surface is not load-bearing for MVP — only for resilience against future CRM changes. Sprint-N upgrade absorbs the future-proofing.

**Sprint-0 carry-over**:
- Author `tools/crm-cache-scraper.ts` (or equivalent) that walks the existing CRM's HTTP cache and emits `/contracts/fixtures/v1-xml/<resource>/<query-fingerprint>.xml`.
- Annotate any quirks observed (deviations from PRD §7.5) in `docs/ncall-compat/quirks.md` — this carry-forward already exists in spec.
- M25 module construction uses these fixtures for round-trip tests.

**Live-capture upgrade trigger** (Sprint-N): when one of (a) vendor access becomes available, (b) M25 round-trip tests start failing in production against real CRM consumers, (c) feature work needs an endpoint the cache doesn't cover. At that point execute the original S6 plan with the now-available prereqs.

---

### S7 — Temporal Cloud BAA + EU namespace (ADR-0015)

**Hazard the spike was killing**: does Temporal Cloud sign a HIPAA BAA AND confirm that an EU-namespace's workflow metadata never crosses the EU residency boundary? ADR-0015 commits to Temporal Cloud Enterprise as the workflow engine; both questions must be Yes for MVP.

**Why deferred**: The spike is structurally a sales/legal correspondence — no probe, the verdict *is* the letter from Temporal sales. No outreach has been initiated; calendar turnaround is 2–6 weeks. ADR-0015 documents a self-host fallback (Helm v1.0.0 on EU-residency Kubernetes) as Yellow/Red remediation.

**Compliance regime**: GDPR-load-bearing (EU residency). HIPAA-touch (BAA), but Temporal's BAA willingness is well-established for Enterprise customers — the GDPR residency question is the harder one.

**Options:**

| Option | Description | GDPR posture | Cost |
|---|---|---|---|
| A. Initiate Temporal sales | Send outreach email per `runbook.md`; wait 2–6 weeks; receive (or don't) BAA + EU residency confirmation; ratify ADR-0015 with letter as evidence. | Confirmed by vendor letter. | Vendor cycle (2–6 weeks calendar); no FTE cost during waiting. |
| B. Adopt self-host fallback | Rewrite ADR-0015 §Decision to point at Temporal v1.0.0 self-hosted Helm on EU-residency K8s. Application-layer SDK code is unchanged (claim from ADR-0015; needs validation). | Trivially compliant — full data-plane control. | +0.5–1 FTE platform-engineering (cluster, upgrades, observability, backup). |
| C. Initiate AND adopt fallback (parallel) | Start the sales correspondence (low effort, no waiting cost) AND adopt the self-host fallback in MVP. If the BAA + EU letter arrives during MVP construction, migrate to Cloud as a Sprint-N optimisation. | Trivially compliant from day one; optionally upgradeable. | Same as Option B; sales correspondence is a few emails. |

**Recommendation**: Adopt Option C (parallel — initiate AND adopt fallback). Rationale: the operational cost of self-hosting (+0.5–1 FTE platform-eng) is real but bounded; the calendar cost of waiting for the BAA letter blocks MVP and is not bounded. Option C captures both — MVP starts on the self-host baseline immediately, and if Temporal Cloud Enterprise becomes available mid-MVP we can migrate.

**Sprint-0 carry-overs**:
- Validate the ADR-0015 claim that SDK code is identical between Cloud and self-host paths. Write the smallest workflow (e.g., `HelloWorldWorkflow`) that compiles + runs against both paths. ~0.5 day. **This is the only technical risk introduced by Option C; validate early.**
- Stand up self-hosted Temporal v1.0.0 on EU-residency K8s; baseline Postgres + Elasticsearch backends; basic observability (metrics + logs).
- Send the sales outreach email per `runbook.md` (no waiting cost; the response lands when it lands).
- Rewrite ADR-0015 §Decision to point at self-host as the MVP-baseline path; §Consequences notes the Cloud-migration upgrade trigger; ratify Proposed → Accepted.

---

## What this binds — Sprint-0 plan

If both signatures are obtained on this proposal:

### Within 0–2 weeks of G0

1. **S4 compliance review session.** Compliance lead + senior architect + backend lead. Decide ADR-0013 close-out (Option A / B / C / D from §S4). Pre-meeting reading: ADR-0013, this proposal, project compliance posture memory.
2. **S6 cache-scraper authored.** Backend (~0.1 FTE). Output: `/contracts/fixtures/v1-xml/` populated, quirks.md initial pass.
3. **S7 SDK identity validation.** Platform-eng (~0.5 day). Output: workflow compiles + runs against both Temporal Cloud and self-host.

### Within 2–4 weeks of G0

4. **S7 self-host stood up.** Platform-eng (~1 FTE-week). Output: working EU-residency Temporal cluster; ADR-0015 rewritten to point at self-host; ADR-0015 ratified.
5. **S7 sales outreach** (parallel; low effort). Compliance lead.
6. **S4 sub-decision implemented.** Whichever option the S4 review picked; ADR-0013 rewritten or unchanged + ratified depending on outcome.
7. **S1 Layer 2 (rtpengine) executed on Linux host.** Telephony eng. Closes Open Risk #1.
8. **S8 HAProxy 1000/s threshold re-validated on Linux** (vs 800/s validated on macOS Docker). SRE. Closes Open Risk #3.

### Within 4–8 weeks of G0

9. **MVP construction begins.** All non-recording modules can start immediately at G0; recording / redaction modules unblock when S4 sub-decision lands.
10. **Spike directories deleted from `main`** per ARCH §2.4 ("their fixtures and ADR evidence carry forward"). Tags remain.
11. **G0 → G1 transition.** Sprint 0 closes when all 30 ADRs are at Accepted (currently 5 of 6 PoT-relevant ADRs; ADRs outside PoT scope to be ratified independently) and the two external sign-offs (senior architect + compliance lead on this proposal) are filed.

---

## Open risks the senior architect + compliance lead should explicitly acknowledge

Phase 0 was scoped to specific named hazards. Some risks were out of scope and survive into Sprint 0:

1. **rtpengine media smoke (S1 Layer 2) unverified.** S1 Layer 1 (signalling) is Green; Layer 2 (media-path) was deferred from S1 due to `rtpengine network_mode=host` being a no-op on macOS Docker Desktop. Sprint 0 must execute on a Linux host. Risk: if media-path doesn't work as Layer 1 assumed, ARCH's telephony topology needs amendment — but the failure mode is observable in a Linux smoke test, not surprising.

2. **Permission-endpoint scaling at production volume (S8 surfaced).** PoT validated ~1000/sec on a single-process Python `ThreadingHTTPServer`. ADR-0019 §Decision item 3 now names "horizontal scaling + Redis-backed declined-domain rate-limiter" as MVP-baseline. Risk: at much higher production volume (10x+), permission endpoint becomes the new SPOF; mitigation is in ADR-0019 but not built yet.

3. **HAProxy SNI rate-limit at production 1000/sec threshold on Linux (S8 surfaced).** Validated mechanism at 800/sec on macOS Docker. Sprint 0 should re-run the S8 probe on Linux at 1000/sec to confirm identical behaviour. Risk: low (mechanism is what's validated; throughput is the only variable).

4. **Temporal SDK code identity between Cloud and self-host (S7 surfaced).** Claimed in ADR-0015 but not validated. Sprint 0 validation is in the S7 plan above (§S7 Sprint-0 carry-overs). Risk: if SDK code is not identical (e.g., authentication paths differ in a way that bleeds into application code), Option C's "upgradeable later" claim fails and we are committed to whichever path we start on.

5. **S4 compliance posture (this proposal's load-bearing risk).** Until the S4 sub-decision lands, MVP has no resolved redaction strategy. Mitigation: recording / redaction modules don't ship until mid-MVP (per ARCH §3); the 2-week sub-decision window does not block MVP start. Risk: if the S4 sub-decision delays beyond 2 weeks, recording-module construction slips and the MVP critical path lengthens.

6. **G0 enum precedent.** Adopting Path B sets the precedent that "Deferred-with-fallback-plan" is an acceptable Phase-0 outcome. Future projects might invoke it for spikes that *could* have been executed but weren't. Mitigation: document in this proposal (here) that the three Deferreds were structurally unavoidable (vendor / data prereqs that cannot be synthesised); future deferrals should meet the same bar.

---

## Signatures

By signing below, you accept:
- The G0 enum interpretation chosen (Path A or Path B) and any per-Deferred-spike sub-decisions implied.
- The Sprint-0 plan in §"What this binds" above, including the +0.5–1 FTE platform-engineering allocation if Option C / B is adopted for S7.
- The open risks in §"Open risks" above, with the understanding that mitigations are scheduled in Sprint 0 but not yet built.

**Senior architect**: ____________________ date: ____________

**Compliance lead**: ____________________ date: ____________

**Path chosen**: [ ] A (Strict) [ ] B (Pragmatic — as recommended above)

**If Path B, per-Deferred-spike closures confirmed**:
- [ ] S4: defer sub-decision to dedicated compliance review within 2 weeks (Option A / B / C / D to be chosen at that session)
- [ ] S6: adopt Yellow fallback (CRM cache scrape) as MVP-baseline; live-capture as Sprint-N upgrade
- [ ] S7: adopt parallel Option C (initiate sales AND adopt self-host fallback)

---

## Annex A — Source documents

- [ARCHITECTURE.v0.4 §2](../ARCHITECTURE.v0.4.md) — Phase 0 spec and G0 gate definition.
- [RISKS.v0.2.md](../RISKS.v0.2.md) — what each spike was killing.
- [pot/pot-readout.md](./pot-readout.md) — per-spike measurement evidence.
- [pot/g0-readiness.md](./g0-readiness.md) — readiness snapshot this proposal builds on.
- [docs/adr/](../docs/adr/) — the six ADRs touching Phase-0 evidence.

## Annex B — Spike branches + commits

```
pot/scaffold? (original 8-spike skeleton — unchecked)
 └─ pot/S5-supavisor-set-local         pot/S5 at 3c9696a
     └─ pot/S2-queue-dequeue-latency   pot/S2 at c755a04
         └─ pot/S3-ari-leader-hard-stop pot/S3 at 956d6f6
             └─ pot/S1-telephony-happy-path pot/S1 at 972e71d
                 └─ pot/S4-redaction-accuracy       (Deferred, no tag)
                     └─ pot/S8-caddy-le-posture     pot/S8 at 03b3a9d
                         └─ pot/S7-temporal-baa     (Deferred, no tag)
                             └─ pot/S6-ncall-fixture-capture (Deferred, no tag, current branch)
```

## Annex C — How "Deferred-with-fallback-plan" is captured if Path B is signed

The amendment to ARCH v0.4 §2.4 has been drafted and committed as `b948a9e` (`docs(arch): extend G0 enum with Deferred-with-fallback-plan (pending ratification)`) ahead of this sign-off, so signatories can review the actual amendment text alongside this proposal. It extends the gate enum's first bullet:

> "All 8 spikes Green, **or** any Yellow has a written remediation plan signed by the senior architect + the spike's owner + the on-call compliance lead, **or any Deferred-with-fallback-plan has its documented fallback (in the spike's primary ADR or spike README) adopted as the MVP implementation path and signed off by the same approvers**. **Red blocks MVP kickoff.**"

The amendment also adds an explanatory blockquote scoping the new clause to its intended use (vendor-prereq blocks where synthesis would erase the measurement) and requiring a one-line forensic note in `pot/pot-readout.md` per invocation. Read it inline in [ARCHITECTURE.v0.4.md](../ARCHITECTURE.v0.4.md) §2.4.

Two divergences from the original draft wording that previously appeared here:

- **"Primary ADR or spike README"** instead of just "ADR". S6 has no primary ADR — its fallback is documented in the spike README — so without this generalisation S6's close-out path would be uncovered.
- **A forensic-note-per-invocation requirement** was added. Prevents the enum extension from being misused later as a routine excuse for incomplete PoT work; every Deferred close-out must record *which* fallback was chosen and *why* in `pot/pot-readout.md`.

The amendment is marked **pending G0 sign-off ratification**. Signatures on this proposal legitimise it. If Path A is chosen instead, commit `b948a9e` can be reverted in the same turn the gate decision lands; no other state needs unwinding.

---

*Drafted 2026-05-13 at end of Phase 0 spike execution on branch `pot/S6-ncall-fixture-capture`. To be reviewed and signed in a dedicated G0 sign-off meeting scheduled within 1 week of draft circulation.*
