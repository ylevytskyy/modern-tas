#!/usr/bin/env bash
# S2 PoT — Redis lock-contention probe.
#
# Re-runs a 60-second slice of the same load with `tc qdisc … netem` adding
# 50 ms of delay onto the arbiter container's traffic. The arbiter renews
# the Redis ownership lock on every dequeue, so the injected delay
# propagates 1:1 into accept→ring latency. Result must show a clear shift
# in p95 vs the baseline.
#
# Requires --cap-add=NET_ADMIN on the arbiter container (added by this
# script via `docker exec` with elevated capability isn't possible; we
# instead apply the qdisc on the redis container's loopback-facing iface,
# which `iproute2` in alpine ships).
#
# If your host kernel doesn't have netem (some Docker Desktop hosts), this
# probe will fail loudly — record that and skip.

set -euo pipefail

cd "$(dirname "$0")/.."
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="results/$TS-contention-redis"
mkdir -p "$OUT"
ABS_OUT="$(cd "$OUT" && pwd)"

DELAY_MS="${DELAY_MS:-50}"

echo "[contention-redis] adding ${DELAY_MS}ms netem on redis eth0"
docker compose exec -u root --privileged -T redis sh -c "
  apk add --no-cache iproute2 >/dev/null 2>&1 || true
  tc qdisc add dev eth0 root netem delay ${DELAY_MS}ms
" || { echo "[contention-redis] tc not available — aborting"; exit 1; }

cleanup() {
  echo "[contention-redis] removing netem"
  docker compose exec -u root -T redis sh -c "tc qdisc del dev eth0 root" || true
}
trap cleanup EXIT

echo "[contention-redis] running 60 s probe with operator-sim only (no SIPp)"

# Pre-seed the waiting queue by running a tiny SIPp batch first
docker compose --profile driver run -d --rm \
  --name s2-sipp-seed \
  sipp sipp -r 5 -rp 1000 -l 50 -m 50 -sf /sipp/200-callers.xml asterisk:5060 \
  > /dev/null
sleep 5  # let the queue fill

docker compose --profile driver run --rm \
  -v "$ABS_OUT:/app/results" \
  -e DURATION_MS=60000 \
  -e WARMUP_MS=0 \
  -e ACCEPT_RATE_PER_SEC=10 \
  operator-sim

docker kill s2-sipp-seed 2>/dev/null || true

echo "[contention-redis] computing summary"
bash scripts/summarise.sh "$OUT" > "$OUT/summary.md"

echo "[contention-redis] done. evidence at $OUT"
