#!/usr/bin/env bash
# S3 PoT chaos probe.
#
# Pre-conditions: `make up` healthy, both leader-A and leader-B running,
# one of them holding the lease.
#
# Sequence:
#   1. wait for whichever leader is leader; bind that as $LEADER for the rest
#   2. originate 10 Local channels via ARI into Stasis(pot-leader-test)
#   3. verify they showed up in `core show channels`
#   4. start tcpdump inside asterisk container, capturing port 8088 traffic
#   5. docker compose pause $LEADER for 5 s
#   6. unpause; wait 12 s for close + reconciliation
#   7. stop tcpdump, copy pcap out, capture both leader logs + asterisk channels
#   8. hand off to summarise.sh

set -euo pipefail

cd "$(dirname "$0")/.."

TS="${SNAPSHOT_TS:-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT="results/$TS"
mkdir -p "$OUT"
ABS_OUT="$(cd "$OUT" && pwd)"

echo "[run-test] writing to $OUT"

echo "[run-test] discovering current leader"
LEADER=""
for i in $(seq 1 30); do
  CUR="$(docker compose exec -T redis redis-cli GET pot:ari-leader:asterisk-1 2>/dev/null | tr -d '\r')"
  if [[ -n "$CUR" && "$CUR" != "(nil)" ]]; then
    LEADER="$CUR"
    break
  fi
  sleep 1
done
if [[ -z "$LEADER" ]]; then
  echo "[run-test] no leader after 30s — aborting"
  exit 1
fi
case "$LEADER" in
  leader-a) STANDBY="leader-b" ;;
  leader-b) STANDBY="leader-a" ;;
  *) echo "[run-test] unknown leader value '$LEADER' — aborting"; exit 1 ;;
esac
echo "[run-test] leader=$LEADER  standby=$STANDBY"

ARI_BASE="http://localhost:8088/ari"
ARI_AUTH="pot:pot"

echo "[run-test] originating 10 Local test channels via ARI"
for n in $(seq 1 10); do
  CHID="s3-test-$(printf '%02d' "$n")"
  curl -fsS -u "$ARI_AUTH" -X POST \
    "$ARI_BASE/channels?endpoint=Local/sleep@s3-test&app=pot-leader-test&channelId=$CHID" \
    > /dev/null
done

sleep 2
echo "[run-test] channels in Asterisk:"
docker compose exec -T asterisk asterisk -rx 'core show channels' | tail -3 | tee "$OUT/channels-pre.txt"

echo "[run-test] starting tcpdump inside asterisk container"
docker compose exec -d asterisk \
  tcpdump -i any -U -w /tmp/pause.pcap -s 200 'tcp port 8088'
sleep 1

CHAOS_START_TS="$(date -u +%s.%N)"
echo "[run-test] chaos start ts=$CHAOS_START_TS — pausing $LEADER"
docker compose pause "$LEADER"

sleep 5

echo "[run-test] unpausing $LEADER"
docker compose unpause "$LEADER"
CHAOS_END_TS="$(date -u +%s.%N)"

echo "[run-test] waiting 12 s for close + standby takeover + reconciliation"
sleep 12

echo "[run-test] stopping tcpdump"
docker compose exec -T asterisk pkill -INT tcpdump || true
sleep 1
docker compose cp "asterisk:/tmp/pause.pcap" "$OUT/pause.pcap"

echo "[run-test] capturing leader logs"
docker compose logs --no-color leader-a > "$OUT/leader-a.log" 2>&1 || true
docker compose logs --no-color leader-b > "$OUT/leader-b.log" 2>&1 || true

echo "[run-test] channels in Asterisk after chaos:"
docker compose exec -T asterisk asterisk -rx 'core show channels' | tail -3 | tee "$OUT/channels-post.txt"

echo "{\"chaosStartTs\": $CHAOS_START_TS, \"chaosEndTs\": $CHAOS_END_TS, \"leader\": \"$LEADER\", \"standby\": \"$STANDBY\"}" \
  > "$OUT/chaos-meta.json"

echo "[run-test] computing summary"
bash scripts/summarise.sh "$OUT" > "$OUT/summary.md"

echo "[run-test] done. evidence at $OUT"
ls -1 "$OUT"
