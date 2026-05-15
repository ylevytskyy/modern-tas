#!/usr/bin/env bash
# S8 test runner.
#
# Orchestrates two SNI-flood scenarios against an already-up stack:
#   A: k6 → HAProxy → Caddy   (validates HAProxy trips before Caddy)
#   B: k6 → Caddy direct      (validates Caddy LRU absorbs declined SNIs
#                              even when HAProxy is bypassed)
#
# Between scenarios, the permission-log is rotated so each scenario's
# decision-RPS can be computed independently. Caddy /metrics and HAProxy
# /stats are sampled every 5 s during each run.
#
# Caller passes the timestamped results dir as $1 (created by Makefile).

set -euo pipefail

TS="${1:?usage: run-test.sh <timestamp>}"
SPIKE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${SPIKE_DIR}/results/${TS}"
LIVE_PERM="${SPIKE_DIR}/results/_live/permission/queries.jsonl"

CADDY_IP="172.30.8.20"
HAPROXY_IP="172.30.8.30"
RATE_RPS="${RATE_RPS:-1000}"
DURATION_SECONDS="${DURATION_SECONDS:-60}"
UNKNOWN_POOL="${UNKNOWN_POOL:-50}"

mkdir -p "$OUT"
mkdir -p "$(dirname "$LIVE_PERM")"
: > "$LIVE_PERM"   # ensure file exists for bind-mount

echo "==> S8 runner: TS=$TS rate=${RATE_RPS}/s duration=${DURATION_SECONDS}s pool=${UNKNOWN_POOL}"

# build_hosts is no longer needed — host mapping is now done inside the k6
# script via the options.hosts object (k6 v0.47+ removed the --hosts CLI flag).
# TARGET_IP env var is passed to k6 at invocation time instead.

sample_loop() {
  local label="$1"
  local interval=5
  while true; do
    local now
    now="$(date -u +%s)"
    {
      printf '\n# ts=%s\n' "$now"
      curl -sS --max-time 3 http://localhost:2019/metrics 2>/dev/null || true
    } >> "$OUT/caddy-metrics-${label}.prom"
    {
      printf '# ts=%s\n' "$now"
      curl -sS --max-time 3 'http://localhost:8404/stats;csv' 2>/dev/null || true
    } >> "$OUT/haproxy-stats-${label}.csv"
    sleep "$interval"
  done
}

snapshot_storage() {
  local label="$1"
  docker compose -f "$SPIKE_DIR/docker-compose.yml" exec -T caddy \
    sh -c 'find /data/caddy -type f | wc -l; echo ---; du -sh /data/caddy 2>/dev/null; echo ---; ls -la /data/caddy/pki/authorities/local/ 2>/dev/null || true; echo ---; ls -la /data/caddy/certificates/ 2>/dev/null || true' \
    > "$OUT/caddy-storage-${label}.txt" 2>&1 || true
}

run_scenario() {
  local label="$1"
  local target_ip="$2"

  echo "==> Scenario $label: target $target_ip"

  # Rotate permission log to isolate this scenario's decisions.
  if [ -s "$LIVE_PERM" ]; then
    mv "$LIVE_PERM" "$OUT/permission-queries-pre-${label}.jsonl"
  fi
  : > "$LIVE_PERM"

  snapshot_storage "pre-${label}"

  sample_loop "$label" &
  local sampler_pid=$!

  # Run k6 in the compose stack; TARGET_IP drives the options.hosts mapping
  # inside the script (--hosts CLI flag was removed in k6 v0.47).
  docker compose -f "$SPIKE_DIR/docker-compose.yml" run --rm \
    -e RATE_RPS="$RATE_RPS" \
    -e DURATION_SECONDS="$DURATION_SECONDS" \
    -e TARGET_IP="$target_ip" \
    -e RESULTS_PATH="/results/${TS}/k6-${label}-summary.json" \
    k6 run \
      /scripts/sni-flood.js \
    > "$OUT/k6-${label}-stdout.txt" 2>&1 || echo "k6 exit non-zero (expected for flood)"

  kill "$sampler_pid" 2>/dev/null || true
  wait "$sampler_pid" 2>/dev/null || true

  snapshot_storage "post-${label}"

  # Capture this scenario's permission decisions.
  cp "$LIVE_PERM" "$OUT/permission-queries-${label}.jsonl"

  echo "==> Scenario $label done. k6 summary: $OUT/k6-${label}-summary.json"
}

# Smoke-verify the stack before flooding.
echo "==> Smoke: permission endpoint allow/deny"
curl -sS -o /dev/null -w 'known=%{http_code}\n' \
  "http://$(docker compose -f "$SPIKE_DIR/docker-compose.yml" port permission 8080 2>/dev/null | head -n1 | awk -F: '{print $1":"$2}')/?domain=tenant-known.spike-s8.test" \
  > "$OUT/smoke-permission.txt" || true
# permission service is on the internal network only; smoke via Caddy admin
{
  echo "caddy admin reachable:"
  curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:2019/config/
  echo "haproxy stats reachable:"
  curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:8404/stats
} > "$OUT/smoke.txt" 2>&1

run_scenario "via-haproxy" "$HAPROXY_IP"
sleep 5
run_scenario "direct-caddy" "$CADDY_IP"

echo "==> Running summariser"
"$SPIKE_DIR/scripts/summarise.sh" "$TS"
echo "==> Done. Summary: $OUT/summary.md"
