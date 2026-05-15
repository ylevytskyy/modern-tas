# S6 — `/v1` byte-for-byte fixture capture from live nCall

> **Status: STUB — needs vendor live-instance access before this spike runs.**

## Hypothesis

A read-only test tenant on a real nCall instance can be cloned into golden fixtures sufficient for M25 (the `/v1` compatibility module) to pass round-trip tests.

## Go/no-go signal

- **Green:** 200 captured XML responses (every consumed resource, every consumed query shape) committed to `/contracts/fixtures/v1-xml/`. Unknown-quirk inventory committed to `docs/ncall-compat/quirks.md`.
- **Yellow:** 100–200 fixtures captured; remaining endpoints documented for later capture during Sprint 1.
- **Red:** Vendor blocks the test tenant. Fall back to scraping the existing CRM's response cache (lower fidelity but extractable).

## Owner role

Compliance lead + backend engineer.

## Prereqs (BLOCKED — needs user-side action)

- **Live nCall instance access.** Either an existing tenant where a read-only user can be created, or a vendor-provided sandbox.
- **HTTP Basic Auth credentials** for the test tenant.
- **List of endpoints currently consumed by the existing CRM.** Source: CRM source code, access logs, or developer interview.
- No infra prereqs — the capture is a curl loop.

## Runbook

When prereqs land, see [`runbook.md`](./runbook.md). The capture script template is in `fixtures/capture.sh.template` (write at execution time).

## Recording protocol

- Captured XML lands in `fixtures/v1-xml/<resource>/<query-fingerprint>.xml` — one file per (resource, query-shape) pair.
- Quirks (undocumented behaviour, deviation from PRD §7.5 spec) land in `results/<timestamp>/quirks.md`.
- Capture script lands in `results/<timestamp>/capture.sh` (the actual run, with creds redacted).

## Yellow remediation

Per ARCH §2.3: scrape the existing CRM's response cache. Fidelity is lower (no synthesised query shapes), but cache is sufficient for the endpoints the CRM actually uses today.

## ADR linkage

No ADR — this spike feeds the M25 module spec directly. Carries forward as `/contracts/fixtures/v1-xml/`.
