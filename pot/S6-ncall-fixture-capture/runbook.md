# S6 Runbook (DRAFT)

## Prereq check

```
make check-prereqs
```

Verifies: NCALL_BASE_URL, NCALL_USER, NCALL_PASS env vars set.

## Capture loop

When prereqs land, the capture script (to be written at spike-execution time) iterates over:
- Resources: `time`, `me`, `Users`, `Calls`, `Messages`, `Contacts`, `Clients`, `todo`, `KPI`, per-client `billing` (per crm-api-compat memory + PRD §7.5).
- Per resource: `field_names.xml`, `find.xml`, `find.xml?<field>=<value>` × known query shapes (today / yesterday / greater_than_X / less_than_X / output_fields=).

For each request, save the raw XML to `fixtures/v1-xml/<resource>/<sanitised-query>.xml`.

## Quirk inventory

After capture, diff observed responses against PRD §7.5 spec. Anything undocumented gets a one-line entry in `results/<ts>/quirks.md`.

## Snapshot

```
make snapshot-results
```

## Teardown

Nothing to tear down — pure curl loop.
