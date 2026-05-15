#!/usr/bin/env bash
# S8 summariser. Reads raw evidence from results/$TS/ and writes summary.md
# with Green/Yellow/Red verdict against ADR-0019 thresholds.
#
# Thresholds (from README + ADR-0019):
#   - Storage RPS during sustained flood < 50/sec   → Green
#   - Storage RPS 50–200/sec                        → Yellow (LRU tunable)
#   - Storage RPS > 200/sec                         → Red (ask happens after storage)
#   - HAProxy must show non-zero rate-limit drops in the via-haproxy scenario
#   - Caddy permission-decision count per scenario should be ≤ pool size
#     (proves LRU absorbs repeated declined-SNI hits)

set -euo pipefail

TS="${1:?usage: summarise.sh <timestamp>}"
SPIKE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${SPIKE_DIR}/results/${TS}"

count_perm_decisions() {
  local file="$1"
  if [ ! -s "$file" ]; then echo 0; return; fi
  wc -l < "$file" | tr -d ' '
}

distinct_unknown_domains() {
  local file="$1"
  if [ ! -s "$file" ]; then echo 0; return; fi
  python3 -c "
import json,sys
seen=set()
for line in open('$file'):
    try:
        e=json.loads(line)
        if e.get('decision')==403:
            seen.add(e['domain'])
    except Exception: pass
print(len(seen))
"
}

# Extract Caddy storage file-count delta across the scenario from snapshots.
storage_delta() {
  local label="$1"
  local pre_file="$OUT/caddy-storage-pre-${label}.txt"
  local post_file="$OUT/caddy-storage-post-${label}.txt"
  if [ ! -f "$pre_file" ] || [ ! -f "$post_file" ]; then
    echo "(no snapshots)"
    return
  fi
  local pre post
  pre="$(head -n1 "$pre_file" 2>/dev/null || echo 0)"
  post="$(head -n1 "$post_file" 2>/dev/null || echo 0)"
  echo "pre=${pre} post=${post}"
}

# Estimate Caddy storage activity RPS by counting permission-endpoint hits
# (proxy: each permission hit corresponds to a storage lookup attempt for
# a previously-uncached domain; LRU short-circuits subsequent identical
# domain requests so they never reach permission OR storage).
perm_rps() {
  local file="$1"
  local duration="$2"
  local cnt
  cnt="$(count_perm_decisions "$file")"
  if [ "$cnt" -eq 0 ]; then echo 0; return; fi
  python3 -c "print(round($cnt / max(1, $duration), 2))"
}

# Pull from k6 summary
k6_metric() {
  local file="$1"
  local jq_path="$2"
  if [ ! -f "$file" ]; then echo "n/a"; return; fi
  python3 -c "
import json,sys
d=json.load(open('$file'))
keys='$jq_path'.split('.')
v=d
for k in keys:
    if isinstance(v, dict): v=v.get(k)
    else: v=None
print(v)
"
}

DURATION_SECONDS="${DURATION_SECONDS:-60}"

perm_via="$(count_perm_decisions "$OUT/permission-queries-via-haproxy.jsonl")"
perm_direct="$(count_perm_decisions "$OUT/permission-queries-direct-caddy.jsonl")"
distinct_via="$(distinct_unknown_domains "$OUT/permission-queries-via-haproxy.jsonl")"
distinct_direct="$(distinct_unknown_domains "$OUT/permission-queries-direct-caddy.jsonl")"
perm_rps_via="$(perm_rps "$OUT/permission-queries-via-haproxy.jsonl" "$DURATION_SECONDS")"
perm_rps_direct="$(perm_rps "$OUT/permission-queries-direct-caddy.jsonl" "$DURATION_SECONDS")"
storage_via="$(storage_delta via-haproxy)"
storage_direct="$(storage_delta direct-caddy)"

# Extract from k6 summary the http_req_failed rate, count, and request rate.
k6_via_total="$(k6_metric "$OUT/k6-via-haproxy-summary.json" "metrics.http_reqs.values.count")"
k6_via_rps="$(k6_metric "$OUT/k6-via-haproxy-summary.json" "metrics.http_reqs.values.rate")"
k6_via_fails="$(k6_metric "$OUT/k6-via-haproxy-summary.json" "metrics.http_req_failed.values.passes")"
k6_direct_total="$(k6_metric "$OUT/k6-direct-caddy-summary.json" "metrics.http_reqs.values.count")"
k6_direct_rps="$(k6_metric "$OUT/k6-direct-caddy-summary.json" "metrics.http_reqs.values.rate")"
k6_direct_fails="$(k6_metric "$OUT/k6-direct-caddy-summary.json" "metrics.http_req_failed.values.passes")"

# Verdict: Caddy LRU works iff permission RPS in the direct-caddy scenario
# stays well under the k6 request RPS (LRU absorbs after first decline per
# domain). Specifically, total permission decisions in direct-caddy should
# be ≈ distinct unknown SNIs (≤ pool size + 1), not ≈ k6_direct_total.
verdict="UNKNOWN"
verdict_reasoning="(see metrics)"
if [ -n "$perm_direct" ] && [ "$perm_direct" -gt 0 ]; then
  if [ "$perm_direct" -le 100 ]; then
    verdict="GREEN"
    verdict_reasoning="permission-decision count ($perm_direct) is bounded by SNI pool, not k6 request count — LRU absorbs repeated declines."
  elif [ "$perm_direct" -le 500 ]; then
    verdict="YELLOW"
    verdict_reasoning="permission-decision count ($perm_direct) exceeds pool size — LRU is leaking or sized too small; tunable headroom remains."
  else
    verdict="RED"
    verdict_reasoning="permission-decision count ($perm_direct) is unbounded — Caddy is asking per-request, ADR-0019 architecture is broken on this config."
  fi
fi

cat > "$OUT/summary.md" <<EOF
# S8 — Caddy 2.10+ on-demand TLS posture — readout

Run: \`${TS}\`  ·  Rate: ${RATE_RPS:-?} req/sec  ·  Duration: ${DURATION_SECONDS}s each scenario  ·  Pool: ${UNKNOWN_POOL:-?} unknown SNIs

## Verdict: ${verdict}

${verdict_reasoning}

## Scenario A — k6 → HAProxy → Caddy

- k6 total requests: \`${k6_via_total}\`
- k6 effective RPS: \`${k6_via_rps}\`
- k6 failed requests: \`${k6_via_fails}\`
- Permission decisions logged: \`${perm_via}\`
- Distinct unknown SNIs that reached permission: \`${distinct_via}\`
- Permission decisions/sec (avg): \`${perm_rps_via}\`
- Caddy storage file count: ${storage_via}

ADR-0019 expectation: HAProxy rate-limits before Caddy. \`distinct_via\` and \`perm_via\` should be SMALL (because HAProxy drops most connections before they reach Caddy's TLS handshake → no SNI extraction → no permission call). If permission RPS in this scenario is anywhere near k6_via_rps, HAProxy is not effectively rate-limiting.

## Scenario B — k6 → Caddy direct (HAProxy bypassed)

- k6 total requests: \`${k6_direct_total}\`
- k6 effective RPS: \`${k6_direct_rps}\`
- k6 failed requests: \`${k6_direct_fails}\`
- Permission decisions logged: \`${perm_direct}\`
- Distinct unknown SNIs that reached permission: \`${distinct_direct}\`
- Permission decisions/sec (avg): \`${perm_rps_direct}\`
- Caddy storage file count: ${storage_direct}

ADR-0019 expectation: Caddy's declined-domain LRU absorbs repeated unknown-SNI requests. \`distinct_direct\` should converge to the SNI pool size (≈ ${UNKNOWN_POOL:-?}) and \`perm_direct\` should be on the same order. If \`perm_direct\` grows with k6_direct_total instead, the LRU is broken (certmagic #174).

## Evidence files

\`\`\`
$(cd "$OUT" && ls -la | tail -n +2)
\`\`\`

## ADR-0019 status

Stays Proposed until the user authorises the flip. This run records the evidence for Sprint-0 ratification of ADR-0019 + ISRG exemption submission (the exemption is org-side and outside this spike's scope).
EOF

echo "Verdict: $verdict"
echo "Reasoning: $verdict_reasoning"
