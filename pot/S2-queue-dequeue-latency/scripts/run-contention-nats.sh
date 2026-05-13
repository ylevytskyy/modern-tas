#!/usr/bin/env bash
# S2 PoT — NATS lag-contention probe.
#
# Same shape as run-contention-redis.sh but injects delay on the NATS
# container instead. Arbiter publishes a dequeue event to NATS on every
# accept; the publish is on the dequeue critical path so injected delay
# shifts the latency CDF.

set -euo pipefail

cd "$(dirname "$0")/.."
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="results/$TS-contention-nats"
mkdir -p "$OUT"
ABS_OUT="$(cd "$OUT" && pwd)"

DELAY_MS="${DELAY_MS:-50}"

echo "[contention-nats] adding ${DELAY_MS}ms netem on nats eth0"
docker compose exec -u root --privileged -T nats sh -c "
  apk add --no-cache iproute2 >/dev/null 2>&1 || true
  tc qdisc add dev eth0 root netem delay ${DELAY_MS}ms
" || { echo "[contention-nats] tc not available — aborting"; exit 1; }

cleanup() {
  echo "[contention-nats] removing netem"
  docker compose exec -u root -T nats sh -c "tc qdisc del dev eth0 root" || true
}
trap cleanup EXIT

echo "[contention-nats] running 60 s probe"

docker compose --profile driver run -d --rm \
  --name s2-sipp-seed \
  sipp sipp -r 5 -rp 1000 -l 50 -m 50 -sf /sipp/200-callers.xml asterisk:5060 \
  > /dev/null
sleep 5

docker compose --profile driver run --rm \
  -v "$ABS_OUT:/app/results" \
  -e DURATION_MS=60000 \
  -e WARMUP_MS=0 \
  -e ACCEPT_RATE_PER_SEC=10 \
  operator-sim

docker kill s2-sipp-seed 2>/dev/null || true

echo "[contention-nats] computing summary"
bash scripts/summarise.sh "$OUT" > "$OUT/summary.md"

echo "[contention-nats] done. evidence at $OUT"
