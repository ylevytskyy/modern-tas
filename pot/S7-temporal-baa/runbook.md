# S7 Runbook

## Step 1: Initial outreach

Send to sales@temporal.io (or the Enterprise contact form):

> Subject: Enterprise tier BAA + EU namespace data residency
>
> Hello — we're evaluating Temporal Cloud Enterprise tier for a multi-tenant healthcare SaaS (HIPAA + GDPR scope). Two questions before proceeding:
>
> 1. Does Enterprise tier include a signed Business Associate Agreement (BAA) covering Temporal as a subprocessor for PHI metadata in workflow Search Attributes?
>
> 2. For an EU-region namespace, does Search Attribute metadata + workflow input metadata stay within EU infrastructure, or does any of it transit to the US control plane (e.g., for billing aggregation, telemetry, audit)?
>
> Happy to share volume estimates and architecture context on a call.

## Step 2: Track correspondence

Log every email/call in `results/correspondence.md` with timestamp, party, summary.

## Step 3: Receive sales letter

When the letter arrives:
- Save the PDF as `results/baa-letter.pdf`.
- Verify both clauses present.
- Write `results/summary.md`:

```
## S7 outcome

Status: Green | Yellow | Red

BAA: <yes/no, terms summary>
EU namespace residency: <yes/no, caveats>

Decision: <accept | escalate to legal | trigger ADR-0015 fallback>
```

## Step 4: Update ADR-0015

- Green: status → Accepted; evidence link to baa-letter.pdf.
- Yellow: status → Accepted with caveat in Consequences/Negative.
- Red: rewrite Decision to self-host Temporal via Helm; status remains Proposed pending Sprint 0 ratification.

## No teardown

Pure correspondence — nothing to tear down.
