#!/usr/bin/env bash
# S1 PoT — orchestrate the failover + screen-pop probe.
#
# Phases (matching the README's hazard list):
#   1. Wait for the stack to settle (Kamailios both report dispatcher
#      target active, subscriber WS open).
#   2. Screen-pop loop — send 100 INVITEs through kamailio-primary at
#      10/s; SIPp's per-call message log captures INVITE-sent
#      timestamps; the subscriber's JSONL captures StasisStart times.
#   3. Failover — `docker compose pause kamailio-primary`, then send
#      10 INVITEs through kamailio-standby. Record time-to-first-200-OK
#      from the pause moment.
#   4. Snapshot all artifacts into results/<timestamp>/.
set -euo pipefail

cd "$(dirname "$0")/.."

TIMESTAMP="${S1_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
RESULTS_DIR="results/${TIMESTAMP}"
mkdir -p "${RESULTS_DIR}"

# macOS `date` lacks GNU's %N nanosecond extension, so use python for
# epoch-ms timestamps. Available in both macOS and Linux containers.
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }

echo "[run-test] results dir: ${RESULTS_DIR}"

# ----- Phase 1: wait for stack settle -----

echo "[run-test] phase 1: waiting for dispatcher target health"
for i in $(seq 1 30); do
  primary_state=$(docker compose exec -T kamailio-primary kamcmd dispatcher.list 2>/dev/null | awk '/URI::/{getline; print}' | grep -oE 'FLAGS:: [A-Z]+' | head -1 || true)
  standby_state=$(docker compose exec -T kamailio-standby kamcmd dispatcher.list 2>/dev/null | awk '/URI::/{getline; print}' | grep -oE 'FLAGS:: [A-Z]+' | head -1 || true)
  if [[ "${primary_state}" == *"AP"* && "${standby_state}" == *"AP"* ]]; then
    echo "[run-test] both kamailios see asterisk as ACTIVE+PROBING"
    break
  fi
  sleep 1
done

# Confirm the subscriber's ARI WS is open by checking its stdout log.
subscriber_ready=0
for i in $(seq 1 30); do
  if docker compose logs --no-color subscriber 2>/dev/null | grep -q '"event":"ws_open"'; then
    subscriber_ready=1
    break
  fi
  sleep 1
done
if [[ "${subscriber_ready}" -ne 1 ]]; then
  echo "[run-test] ERROR: subscriber WS never opened — aborting"
  docker compose logs subscriber > "${RESULTS_DIR}/subscriber-bootlog.txt"
  exit 1
fi

# Reset the subscriber's JSONL file so the test's events are isolated.
docker compose exec -T subscriber sh -c ': > /work/subscriber.jsonl'

# ----- Phase 2: screen-pop loop -----

echo "[run-test] phase 2: 100 INVITEs through kamailio-primary at 10/s"

docker compose run --rm \
  -v "$(pwd)/fixtures/sipp:/scenarios:ro" \
  -v "$(pwd)/${RESULTS_DIR}:/out" \
  sipp \
  -sf /scenarios/invite-loop.xml \
  -s 9999 \
  -r 10 -rp 1000 \
  -m 100 \
  -trace_msg -trace_stat -trace_screen \
  -message_file /out/sipp-screen-pop_messages.log \
  -stf /out/sipp-screen-pop_stats.csv \
  -screen_file /out/sipp-screen-pop_screen.log \
  -timeout 60 -timeout_error \
  kamailio-primary:5060 \
  || { echo "[run-test] WARN: phase 2 SIPp exited non-zero — continuing to capture evidence"; }

# Give the last few StasisStart events time to land in the subscriber JSONL.
sleep 2

# Snapshot the subscriber JSONL for phase 2.
docker compose exec -T subscriber cat /work/subscriber.jsonl > "${RESULTS_DIR}/subscriber-phase2.jsonl"

# ----- Phase 3: failover -----

echo "[run-test] phase 3: pause kamailio-primary, 10 INVITEs through standby"

# Reset subscriber JSONL again so phase 3 events are clean.
docker compose exec -T subscriber sh -c ': > /work/subscriber.jsonl'

T_PAUSE_MS=$(now_ms)
docker compose pause kamailio-primary
echo "[run-test] kamailio-primary paused at t=${T_PAUSE_MS}ms (epoch ms)"

docker compose run --rm \
  -v "$(pwd)/fixtures/sipp:/scenarios:ro" \
  -v "$(pwd)/${RESULTS_DIR}:/out" \
  sipp \
  -sf /scenarios/invite-loop.xml \
  -s 9999 \
  -r 5 -rp 1000 \
  -m 10 \
  -trace_msg -trace_stat -trace_screen \
  -message_file /out/sipp-failover_messages.log \
  -stf /out/sipp-failover_stats.csv \
  -screen_file /out/sipp-failover_screen.log \
  -timeout 30 -timeout_error \
  kamailio-standby:5060 \
  || { echo "[run-test] WARN: phase 3 SIPp exited non-zero — continuing to capture evidence"; }

sleep 2

docker compose exec -T subscriber cat /work/subscriber.jsonl > "${RESULTS_DIR}/subscriber-phase3.jsonl"

# Unpause for cleanup.
docker compose unpause kamailio-primary

# ----- Phase 4: snapshot -----

echo "[run-test] phase 4: snapshot logs"

docker compose logs kamailio-primary  --no-color > "${RESULTS_DIR}/kamailio-primary.log"  || true
docker compose logs kamailio-standby  --no-color > "${RESULTS_DIR}/kamailio-standby.log"  || true
docker compose logs asterisk          --no-color > "${RESULTS_DIR}/asterisk.log"          || true
docker compose logs subscriber        --no-color > "${RESULTS_DIR}/subscriber-stdout.log" || true

echo "${T_PAUSE_MS}" > "${RESULTS_DIR}/pause-epoch-ms.txt"

echo "[run-test] done — evidence in ${RESULTS_DIR}"
echo "[run-test] run scripts/summarise.sh ${RESULTS_DIR} for the verdict"
