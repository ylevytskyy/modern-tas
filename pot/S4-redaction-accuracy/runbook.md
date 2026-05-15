# S4 Runbook (DRAFT — to be expanded when prereqs land)

## Prereq check

```
make check-prereqs
```

Verifies: ASSEMBLYAI_API_KEY env var set, fixtures/ has 30 audio files + ground-truth.jsonl, presidio container builds.

## Setup

```
make up
```

## Test

```
make test
```

What `make test` does (when implemented at spike-execution time):
1. For each fixture in fixtures/: send audio to AssemblyAI Universal-3 Pro Medical, get word-level timestamps + transcript.
2. Run Presidio NER over the transcript.
3. Intersect: produce candidate spans with confidence.
4. For each span with confidence < 0.9, extend to next silence boundary (max +1.5 s).
5. Compare against ground-truth, compute metrics into `results/<ts>/metrics.json`.

## Snapshot

```
make snapshot-results
```

## Teardown

```
make teardown
```
