#!/usr/bin/env bash
# S2 PoT main probe.
#
# 10-minute SIPp + operator-sim load against the arbiter; snapshots Redis
# INFO commandstats and NATS varz at t=0/5/10 min so we can prove the
# Redis+NATS hazard was actually exercised before reading the CSV.
#
# Expects compose stack already healthy via `make up`.

set -euo pipefail

cd "$(dirname "$0")/.."

TS="${SNAPSHOT_TS:-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT="results/$TS"
mkdir -p "$OUT"
ABS_OUT="$(cd "$OUT" && pwd)"

echo "[run-test] writing to $OUT"

echo "[run-test] resetting Redis state (FLUSHALL)"
docker compose exec -T redis redis-cli FLUSHALL >/dev/null

echo "[run-test] arbiter stats before:"
docker compose logs --no-color --tail=5 arbiter | tee "$OUT/arbiter-pre.log" >/dev/null || true

echo "[run-test] t=0 snapshots"
docker compose exec -T redis redis-cli INFO commandstats > "$OUT/redis-cmdstats-t0.txt"
curl -fsS http://localhost:8222/varz  > "$OUT/nats-varz-t0.txt"
curl -fsS http://localhost:8222/connz > "$OUT/nats-connz-t0.txt"

echo "[run-test] launching operator-sim (10 op WS, 580 s @ 10/s, warmup 20 s)"
docker compose --profile driver run -d --rm \
  --name s2-operator-sim \
  -v "$ABS_OUT:/app/results" \
  operator-sim > /dev/null

echo "[run-test] launching SIPp 200-callers (rate 10/s, max 200 in flight, 6000 calls)"
docker compose --profile driver run -d --rm \
  --name s2-sipp \
  -v "$ABS_OUT:/sipp-out" \
  sipp \
  sipp \
    -r 10 -rp 1000 -l 200 -m 6000 \
    -sf /sipp/200-callers.xml \
    -trace_stat -stf /sipp-out/sipp-stats.csv \
    -trace_err -error_file /sipp-out/sipp-errors.log \
    asterisk:5060 > /dev/null

echo "[run-test] t=5 min snapshot in 300 s"
sleep 300
docker compose exec -T redis redis-cli INFO commandstats > "$OUT/redis-cmdstats-t5.txt"
curl -fsS http://localhost:8222/varz  > "$OUT/nats-varz-t5.txt"
docker compose exec -T arbiter sh -c 'echo {\"type\":\"stats\"} | wscat -c ws://localhost:3000 -x' \
  > "$OUT/arbiter-stats-t5.txt" 2>/dev/null || true

echo "[run-test] t=10 min snapshot in 300 s"
sleep 300
docker compose exec -T redis redis-cli INFO commandstats > "$OUT/redis-cmdstats-t10.txt"
curl -fsS http://localhost:8222/varz  > "$OUT/nats-varz-t10.txt"

echo "[run-test] waiting for operator-sim to exit"
docker wait s2-operator-sim >/dev/null || true

echo "[run-test] capturing arbiter logs"
docker compose logs --no-color arbiter > "$OUT/arbiter.log" 2>&1 || true

echo "[run-test] killing any leftover SIPp"
docker kill s2-sipp 2>/dev/null || true

echo "[run-test] computing summary"
bash scripts/summarise.sh "$OUT" > "$OUT/summary.md"

echo "[run-test] done. evidence at $OUT"
ls -1 "$OUT"
