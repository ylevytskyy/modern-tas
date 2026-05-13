# S4 — Two-pass redaction accuracy on 8 kHz μ-law

> **Status: DEFERRED (2026-05-13) — Phase 0 attempt skipped because external prereqs are unavailable.** Revisit during Sprint 0 once the AssemblyAI Universal-3 Pro Medical key and the 30-fixture audio corpus land. See §Prereqs for what's blocking. Substituting Whisper for AssemblyAI or TTS-then-downsample for real telephony audio was considered and rejected — it would produce a runnable pipeline whose Green/Red verdict does not bind on ADR-0013 (the substituted ASR's WER on 8 kHz μ-law is the *exact* hazard the spike must measure, and synthetic audio loses the accent + codec artifacts that ADR-0013 calls out as load-bearing). See `pot-readout.md` §S4 for the Sprint-0 carry-over note and G0 implications.

## Hypothesis

AssemblyAI Universal-3 Pro Medical + Microsoft Presidio NER + segment-boundary fallback achieves ≥ 95% recall on planted MRN/DOB/account/phone spans and over-bleeps by ≤ 3 s per false-low-confidence span.

## Go/no-go signal

- **Green:** Recall ≥ 95%, F1 ≥ 0.92, mean over-bleep ≤ 1.5 s, manual-QA backlog ≤ 2% of spans on a 30-fixture test set with 90 planted PII spans (mix of clean, noisy, accented).
- **Yellow:** Recall 90–95% — manual-QA percentage in ADR-0013 increases above 2% to compensate.
- **Red:** Recall < 90% on numbers spans — pipeline design renegotiated, possibly adding redundant per-token confidence-based bleeping.

## Owner role

Backend engineer + compliance lead.

## Prereqs (BLOCKED — needs user-side action)

- **AssemblyAI API key with Universal-3 Pro Medical access.** Contact AssemblyAI sales for medical-tier provisioning.
- **30 audio fixtures @ 8 kHz μ-law** with documented PII span ground-truth (start_ms, end_ms, kind, value). Fixtures must cover: clean studio, telephony noise, accented (5+ accents), digit-by-digit numbers, account IDs with letters. Fixtures do **not** commit to the repo — they go in `fixtures/redaction-audio/` which is gitignored. The user provides them out-of-band.
- **Presidio installed via Docker.** No external acct.
- **Compute:** GPU recommended for batch ASR (1× A10 sufficient); CPU works at 5–10× wall time.

## Runbook

When prereqs land, see [`runbook.md`](./runbook.md). Until then, `make test` prints a checklist and exits 1.

## Recording protocol

`results/<timestamp>/`:
- `predictions.jsonl` — one line per fixture: predicted spans + confidence
- `ground-truth.jsonl` — copy of the ground-truth file used
- `metrics.json` — recall, precision, F1, over-bleep mean/p95, per-PII-class breakdown
- `manual-qa-queue.csv` — spans flagged for review
- `summary.md`

## Yellow remediation

Per ADR-0013: increase manual-QA sample percentage from 2% to whatever rate compensates for the recall gap. Document new operational headcount cost.

## ADR linkage

Primary evidence for [ADR-0013 (two-pass redaction pipeline)](../../docs/adr/0013-redaction-pipeline.md).
