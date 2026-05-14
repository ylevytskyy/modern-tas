# ADR-0013: Two-pass redaction pipeline (forced-align + NER + over-bleep)

- **Status:** Accepted
- **Date:** 2026-05-12
- **Deciders:** Backend lead, Compliance lead
- **Consulted:** Telephony lead, Security eng
- **Informed:** All MVP engineers

## Context

PCI-DSS and HIPAA require that PAN, MRN, DOB, account numbers, and similar PII spoken on recorded calls be unrecoverable from stored audio. Forced-aligned bleeping over ASR transcripts is the industry default but has documented blind spots: numbers spoken digit-by-digit, account IDs mixed with letters, accented speakers, and audio recorded at telephony sample rates (8 kHz μ-law) all degrade ASR boundaries. RISKS v0.2 §1 flags this as a load-bearing unknown — no published WER on 8 kHz μ-law for medical PII.

Pure ASR-bleep is insufficient. Pure manual QA is uneconomic at our target scale. We need a layered pipeline that catches each class of failure with a different mechanism.

## Decision

Adopt a two-pass redaction pipeline:

1. **Pass 1 — ASR + forced alignment.** AssemblyAI Universal-3 Pro Medical (or equivalent medical-domain ASR) produces word-level timestamps. Microsoft Presidio's NER recognises PII spans. The intersection produces a high-confidence redaction mask.
2. **Pass 2 — segment-boundary fallback over-bleep.** For any span where Presidio confidence < threshold or the ASR confidence on the boundary words < threshold, the system over-bleeps to the next silence boundary or 1.5 s, whichever is shorter. This trades intelligibility for safety.
3. **Manual QA gate.** A 2% random sample of redacted recordings is queued for human review weekly. Findings feed the threshold-tuning loop.

### Sub-decision (2026-05-14, G0 closure)

Adopted **Option A — full two-pass pipeline**. AssemblyAI Universal-3 Pro Medical key acquisition is in progress (vendor sales cycle 1–4 weeks). MVP Sprint 1–3 builds the ML pipeline against the S4 fixture corpus assembled during Sprint-0. PoC tracer-bullet does NOT exercise this pipeline (PoC spec §5.2 cut).

## Consequences

- **Positive:** Defence-in-depth — three failure modes (ASR misses, NER misses, threshold mistune) require independent failures to leak PII. Manual QA catches the long tail.
- **Negative / cost:** AssemblyAI Universal-3 Pro Medical is a paid API; per-minute cost flows into per-tenant billing. Over-bleep degrades caller intelligibility on recorded playback (operator note review). Manual QA is real headcount.
- **Neutral:** Threshold tuning is an ongoing operations task, not a one-time decision.

## Evidence

Pending PoT spike S4 — see [`pot/S4-redaction-accuracy/results/`](../../pot/S4-redaction-accuracy/results/). Target signal: recall ≥ 95% on 90 planted PII spans across 30 fixtures, F1 ≥ 0.92, mean over-bleep ≤ 1.5 s, manual-QA backlog ≤ 2% of spans.

**Phase-0 status (2026-05-13):** S4 Deferred — vendor + fixtures unavailable; see [`pot/pot-readout.md` §S4](../../pot/pot-readout.md) for the deferral reasoning and Sprint-0 unblock plan. ADR-0013 stays Proposed; ratification gated on Sprint-0 S4 execution or an explicit de-scope decision (skip recording on HIPAA tenants, or accept the operational manual-QA backlog as the redaction strategy and remove the ML pipeline from MVP).

## Alternatives considered

- **Single-pass ASR-bleep only.** Documented to miss digit-by-digit numbers and accented speakers. Rejected: insufficient for HIPAA medical workloads.
- **Delegated capture via Telnyx Pay / Stripe terminal for the entire call.** Works for PCI but not HIPAA — PHI conversation can't be routed to a third-party IVR. Adopted as the PCI-only path for the card-entry segment (see compliance-posture memory); not a general redaction substitute.
- **Disable recording for HIPAA tenants.** Removes the operator-quality and dispute-resolution use cases entirely. Rejected: would close off the medical answering service vertical, the largest target market.
