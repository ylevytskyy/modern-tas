# S4 — Two-pass redaction accuracy on 8 kHz μ-law

> **Status: STUB — external dependencies required before this spike runs.** See §Prereqs.

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
