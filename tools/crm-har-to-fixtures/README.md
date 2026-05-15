# crm-har-to-fixtures

Extract `/v1` XML responses from a CRM-captured HAR file into the
`contracts/fixtures/v1-xml/` layout used by M25 (the `/v1` compatibility
module) round-trip tests.

Sprint-0 carry-over from [S6 — `/v1` byte-for-byte fixture capture](../../pot/S6-tas-fixture-capture/README.md),
adopting the **Yellow fallback path** signed off in
[pot/g0-signoff-proposal.md §S6](../../pot/g0-signoff-proposal.md): capture
the CRM's actual TAS traffic from a browser HAR export rather than
scraping a live TAS instance directly.

## Why HAR

S6's primary path (live TAS instance + curl-loop capture) is blocked
on vendor access. The Phase-0 fallback adopts whatever the existing
CRM uses today — which is exactly what M25 must match for the
drop-in-compatibility constraint ([[crm-api-compat]] memory). A HAR
from the CRM's browser DevTools captures both the request URLs and
response bodies the CRM actually exercises, which is the
authoritative inventory of M25's surface area.

## Capturing the HAR

1. Open the CRM in Chrome / Edge / Firefox.
2. Open DevTools → Network tab.
3. Make sure "Preserve log" is enabled.
4. Make sure "Record" is on (red circle).
5. Drive the CRM through every screen / workflow that calls TAS —
   call lists, contact lookups, KPI dashboards, message threads,
   billing exports, anything backed by a `/v1/...` request.
6. When done: right-click the Network grid → "Save all as HAR with
   content" (or "Export HAR" depending on browser).

> **Important**: pick "with content" — the default HAR export in some
> browsers omits response bodies, which leaves nothing for the
> scraper to extract.

## Usage

```bash
# Default output: writes to <repo>/contracts/fixtures/v1-xml/
node tools/crm-har-to-fixtures/scrape.mjs path/to/capture.har

# Custom output directory
node tools/crm-har-to-fixtures/scrape.mjs path/to/capture.har /tmp/fixtures-out

# Include non-200 responses (default skips them — useful for capturing
# error-response shapes for compat testing of 401, 404, 500 etc.)
node tools/crm-har-to-fixtures/scrape.mjs path/to/capture.har --all-statuses
```

Sample output:

```
Read 247 HAR entries
Matched 89 /v1/...{.xml,.json} entries
Wrote 89 fixtures to /Users/lion/Documents/Projects/mine/tas/contracts/fixtures/v1-xml
Resources seen: Calls, Clients, Contacts, KPI, Messages, Users, me, time
```

## Output layout

Fixtures land at `<outDir>/v1-xml/<Resource>/<fingerprint>.<ext>`,
where `<fingerprint>` encodes the operation and (sorted) query
parameters.

| Captured URL | Fixture path |
|---|---|
| `/v1/me.xml` | `me/_self.xml` |
| `/v1/Calls/find.xml` | `Calls/find.xml` |
| `/v1/Calls/find.xml?today=true` | `Calls/find--today-true.xml` |
| `/v1/Calls/find.xml?today=true&output_fields=CallID,CallTime` | `Calls/find--output_fields-CallID_CallTime--today-true.xml` |
| `/v1/Calls/field_names.xml` | `Calls/field_names.xml` |
| `/v1/Clients/42/billing.xml` | `Clients/42-billing.xml` |

Fingerprint conventions:

- Resource-only URLs (no operation segment) write to `_self.<ext>`.
- Query parameters are sorted alphabetically by key, joined with
  `--`. Within each pair, key and value are joined with `-`.
- Filesystem-unsafe characters (`/ \ : * ? " < > |`) and commas are
  replaced with `_`.
- Filenames longer than 200 characters are truncated and suffixed
  with a 12-character SHA-256 hash for uniqueness.

## What gets skipped

- Non-`/v1/...{.xml,.json}` URLs (CSS, JS, images, REST/v2 calls,
  third-party trackers).
- Responses without a body (e.g. HAR captures that omitted response
  content).
- Non-200 responses, unless `--all-statuses` is passed.

## Quirks documentation

The scraper does not author or update `docs/tas-compat/quirks.md` —
that doc captures *deviations from PRD §7.5*, which requires manual
diffing of the captured fixtures against the PRD spec. The scraper
gives you the raw material; M25 module construction (or a separate
review pass) authors the quirks inventory.

## Tests

```bash
node --test tools/crm-har-to-fixtures/scrape.test.mjs
```

20 unit + integration tests covering URL parsing, fingerprint
computation, HAR filtering, and end-to-end pipeline against
synthetic input.

## Cross-references

- [pot/S6-tas-fixture-capture/README.md](../../pot/S6-tas-fixture-capture/README.md)
  — the original spike spec.
- [pot/g0-signoff-proposal.md §S6](../../pot/g0-signoff-proposal.md)
  — Sprint-0 close-out path that this tool implements.
- [docs/tas-compat/quirks.md](../../docs/tas-compat/quirks.md)
  — downstream quirks inventory (not authored by this tool).
- [PRD §7.5](../../PRD.md) — `/v1` compatibility contract.
