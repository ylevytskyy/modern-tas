# S8 — Caddy 2.10+ permission + LE rate-limit posture

## Hypothesis

The `permission http` endpoint sustains the storage-flood class (certmagic #174) and the LE rate-limit exemption application is in flight.

## Go/no-go signal

The original ADR-0019 target is "1 k unknown-SNI probes/sec sustained for 10 min → Caddy storage RPS stays under 50/sec, HAProxy rate-limits before Caddy". This spike measures a 60-second window per scenario at the same 1k req/sec rate. The 60s window is enough to populate the declined-domain LRU and observe steady-state behaviour; a longer run would only matter for verifying LRU eviction periodicity, which is a Sprint-0 production-hardening concern rather than a Phase-0 architectural one. Document the chosen duration in the evidence dir.

The verdict is computed from the **permission-decision count** in the direct-Caddy scenario — that is the cleanest observable for "Caddy LRU absorbs repeated declined-SNI requests":

- **Green:** Permission-decision count in scenario B (k6 → Caddy direct) stays ≤ 100 even with ≥ 60 k k6 requests (= 1 k/sec × 60 s) — proves the LRU is short-circuiting per-domain after the first decline. Plus: scenario A (k6 → HAProxy → Caddy) shows non-zero HAProxy rejects in the stats CSV.
- **Yellow:** Permission-decision count 100–500 — LRU is leaking or sized too small but tunable.
- **Red:** Permission-decision count > 500 — Caddy is asking per-request, ADR-0019 architecture is broken on this config (likely certmagic #174 has regressed or the `ask` ordering changed in Caddy 2.10).

## Architecture under test

```
k6 ──┬─► HAProxy (172.30.8.30:443) ─► Caddy (172.30.8.20:443) ─► permission:8080
     │       │  rate-limit per-source-IP unknown-SNI > 1k/sec
     │       │  (via stick-table gpc0_rate)
     │       └─► tls passthrough TCP
     │
     └─► Caddy (172.30.8.20:443) [bypasses HAProxy in scenario B]
                 │
                 ├─ tls internal  (local CA, no external LE traffic)
                 ├─ on_demand_tls.ask http://permission:8080/
                 │  └─ permission returns 200 only for the allow-list,
                 │     403 for everything else; Caddy LRU-caches declines
                 └─ /metrics on admin :2019 (Prometheus)
```

## Owner role

SRE.

## Prereqs

- Docker 24+, Docker Compose v2.
- Host: 4 GB RAM, ~2 vCPU free (k6 + Caddy + HAProxy + permission).
- ISRG exemption form is **org-side** — track separately, not gated on this spike's runnable bits.
- No external accounts for the load test (we never hit real LE; Caddy uses `tls internal` against its local PKI).

## Runbook

```
make up                # builds permission, boots stack, waits for health
make test              # runs both scenarios + summariser, writes results/<TS>/
make snapshot-results  # prints latest results dir contents
make teardown          # docker compose down -v
```

`make test` creates `results/<TS>/` and runs `scripts/run-test.sh` which:

1. Smoke-checks Caddy admin :2019 and HAProxy stats :8404 are reachable.
2. Rotates the permission JSONL log.
3. Snapshots Caddy storage dir.
4. Starts a 5 s sampler for Caddy `/metrics` and HAProxy `/stats;csv` in the background.
5. Runs k6 with `--hosts` pointing all 51 hostnames at HAProxy (scenario A).
6. Stops the sampler, snapshots Caddy storage again, captures the per-scenario permission log.
7. Repeats steps 2–6 with `--hosts` pointing at Caddy (scenario B).
8. Runs `scripts/summarise.sh` to compute the verdict.

## Recording protocol

`results/<TS>/`:

- `k6-via-haproxy-summary.json` · `k6-direct-caddy-summary.json` — k6 metrics export per scenario
- `k6-via-haproxy-stdout.txt` · `k6-direct-caddy-stdout.txt` — k6 console output
- `caddy-metrics-via-haproxy.prom` · `caddy-metrics-direct-caddy.prom` — sampled Prometheus exports (5 s intervals)
- `haproxy-stats-via-haproxy.csv` · `haproxy-stats-direct-caddy.csv` — sampled HAProxy stats CSV
- `caddy-storage-pre-*.txt` · `caddy-storage-post-*.txt` — per-scenario storage-dir file counts + listing
- `permission-queries-via-haproxy.jsonl` · `permission-queries-direct-caddy.jsonl` — permission endpoint decision log per scenario
- `smoke.txt` — pre-flight admin-API reachability
- `summary.md` — verdict + numbers
- `isrg-exemption-receipt.pdf` — manually attached when org submits the form

## Yellow remediation

If permission-decision count 100–500 in scenario B: tune Caddy `on_demand_tls` LRU size up (default 100 — explicitly set via JSON config since Caddyfile doesn't expose the knob); document new minimum cache size.

## ADR linkage

Primary evidence for [ADR-0019 (Caddy 2.10+ on-demand TLS posture)](../../docs/adr/0019-caddy-le-posture.md). Status flip Proposed → Accepted requires user authorisation once the readout lands.

## Spike-execution notes (for future maintainers)

The scaffold this spike was authored from was a structural stub:

- `make test` was `@exit 1` with no probe script.
- All three `fixtures/*` subdirectories were empty; compose `:ro`-mounted them so Caddy + HAProxy couldn't boot.
- The original "permission" service was `python -m http.server` which doesn't model ADR-0019's decision API at all (returns 200 for files, 404 otherwise — not 403-by-default-deny).
- No local CA → 10-min flood would have hit production Let's Encrypt against the host's IP.
- No SNI-variation strategy in any (missing) k6 script.
- HAProxy was in compose as a sibling of Caddy, not actually fronting it; the rate-limit layer would have been bypassed by default.

The repair turned the scaffold into a runnable probe with two scenarios so the ADR's defence-in-depth claim is directly testable. The original 10-min duration was reduced to 60 s per scenario because (a) 60 k requests is enough to populate the LRU and observe steady-state, and (b) the 10-min number is more about production eviction behaviour than the architectural property the spike measures.
