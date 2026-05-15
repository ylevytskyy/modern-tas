#!/usr/bin/env bash
# Compute p50/p95/p99 of dequeue_latency_ms from a results dir's CSV and
# emit a Markdown summary that also names the Go/no-go verdict.
#
# Usage: summarise.sh results/<TS>

set -euo pipefail

OUT="${1:?usage: summarise.sh <results-dir>}"
CSV="$OUT/dequeue-latency.csv"

if [[ ! -s "$CSV" ]]; then
  echo "# S2 summary — INCOMPLETE"
  echo
  echo "No CSV at $CSV — probe did not produce data. Check arbiter.log and sipp-errors.log."
  exit 0
fi

# dequeue_latency_ms is column 5
LATENCIES="$(awk -F, 'NR>1 && $5 ~ /^[0-9]+$/ {print $5}' "$CSV" | sort -n)"
COUNT="$(echo -n "$LATENCIES" | grep -c '' || true)"

if [[ "$COUNT" -eq 0 ]]; then
  echo "# S2 summary — INCOMPLETE"
  echo
  echo "CSV has no successful ring rows (column 5 empty for all). Likely arbiter never bridged. Inspect arbiter.log."
  exit 0
fi

pct() {
  local p="$1"
  # 1-indexed percentile rank, floored.
  local rank
  rank=$(awk -v c="$COUNT" -v p="$p" 'BEGIN { r=int(c*p/100); if (r<1) r=1; if (r>c) r=c; print r }')
  echo "$LATENCIES" | sed -n "${rank}p"
}

P50="$(pct 50)"
P95="$(pct 95)"
P99="$(pct 99)"
MAX="$(echo "$LATENCIES" | tail -n 1)"
MIN="$(echo "$LATENCIES" | head -n 1)"
MEAN="$(echo "$LATENCIES" | awk '{s+=$1} END {printf "%.2f", s/NR}')"

FAILS="$(awk -F, 'NR>1 && $8 == "failed" {c++} END {print c+0}' "$CSV")"

VERDICT="UNKNOWN"
if (( P95 <= 200 )); then
  VERDICT="GREEN (p95 ≤ 200 ms)"
elif (( P95 <= 300 )); then
  VERDICT="YELLOW (200 < p95 ≤ 300 ms — fall back to Asterisk Queue() for FIFO per ADR-0024)"
else
  VERDICT="RED (p95 > 300 ms — ADR-0024 must be renegotiated)"
fi

cat <<EOF
# S2 dequeue latency summary

- **Samples:** $COUNT successful ring events
- **Failed rings:** $FAILS
- **Latency (ms):** min=$MIN  mean=$MEAN  p50=$P50  p95=$P95  p99=$P99  max=$MAX
- **Verdict:** $VERDICT

## Hazard-exercise proof

Compare Redis commandstats and NATS varz growth from t0 → t10 (in this directory):

\`\`\`
$(diff -u "$OUT/redis-cmdstats-t0.txt" "$OUT/redis-cmdstats-t10.txt" 2>/dev/null | head -40 || echo 'redis diff unavailable')
\`\`\`

NATS varz t0 → t10 in_msgs / out_msgs:

\`\`\`
t0:  $(grep -E '"(in|out)_msgs"' "$OUT/nats-varz-t0.txt"  2>/dev/null | tr -d '\n' || echo 'n/a')
t10: $(grep -E '"(in|out)_msgs"' "$OUT/nats-varz-t10.txt" 2>/dev/null | tr -d '\n' || echo 'n/a')
\`\`\`

If Redis cmdstats and NATS in_msgs/out_msgs are flat across the window, the probe did not exercise the hazard and the verdict is invalid regardless of the latency numbers (see [[feedback-pot-scaffolds]]).
EOF
