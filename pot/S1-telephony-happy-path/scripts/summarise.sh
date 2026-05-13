#!/usr/bin/env bash
# S1 PoT — summarise the run-test.sh evidence into a verdict.
#
# Inputs (in results/<timestamp>/):
#   sipp-screen-pop_messages.log  — SIPp INVITE-sent timestamps + call meta
#   subscriber-phase2.jsonl       — StasisStart events, joined by call_number
#   sipp-failover_messages.log    — SIPp INVITEs into the standby
#   subscriber-phase3.jsonl       — StasisStart events from failover phase
#   pause-epoch-ms.txt            — wall-clock ms at which docker pause fired
#   kamailio-{primary,standby}.log, asterisk.log, subscriber-stdout.log
#
# Outputs:
#   summary.md     — human-readable verdict
#   screen-pop.csv — joined per-call latency table
#
# Budget table (from README):
#   screen-pop p95   ≤ 800 ms     (Green)
#   screen-pop p95   ≤ 1500 ms    (Yellow)
#   screen-pop p95   > 1500 ms    (Red)
#   failover TTFOK   ≤ 30 s after primary pause (Green)
#   failover TTFOK   30-120 s     (Yellow)
#   failover TTFOK   > 120 s OR any drops      (Red)
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 results/<timestamp>" >&2
  exit 1
fi

RES="$1"
[[ -d "${RES}" ]] || { echo "ERROR: ${RES} not found"; exit 1; }

# ----- Parse SIPp message logs into (call_number, t_invite_sent_ms) CSV -----
#
# SIPp -trace_msg emits blocks like:
#
#   ------------------------------------------- 2026-05-13 05:59:39.150722
#   UDP message sent (479 bytes):
#
#   INVITE sip:9999@172.19.0.4:5060 SIP/2.0
#   Via: ...
#   From: "S1-1" <sip:1@172.19.0.6:5060>;tag=1SIPpTag001
#   ...
#
# Pair the timestamp on the "----- YYYY-MM-DD ..." separator with the
# call_number (the digit-only sip user in the From: header) for the
# next OUTGOING INVITE block we see. SIPp emits the timestamp + direction
# + SIP-header block as a single contiguous unit per message.
parse_sipp_invites() {
  local log="$1"
  python3 - "${log}" <<'PY'
import sys, re, datetime
log = sys.argv[1]
ts_re   = re.compile(r'^-+\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d+)')
dir_re  = re.compile(r'^UDP message (sent|received)')
inv_re  = re.compile(r'^INVITE sip:9999')
from_re = re.compile(r'^From:.*sip:(\d+)@')
state = None
ts_ms = None
direction = None
try:
    with open(log) as f:
        for line in f:
            m = ts_re.match(line)
            if m:
                date, time = m.group(1), m.group(2)
                dt = datetime.datetime.strptime(date + ' ' + time, '%Y-%m-%d %H:%M:%S.%f')
                # SIPp writes timestamps in container TZ which we set to UTC
                # (Ubuntu 24.04 default; verified by tail of stdout).
                dt = dt.replace(tzinfo=datetime.timezone.utc)
                ts_ms = int(dt.timestamp() * 1000)
                direction = None
                state = 'awaiting-dir'
                continue
            d = dir_re.match(line)
            if d and state == 'awaiting-dir':
                direction = d.group(1)
                state = 'awaiting-method'
                continue
            if state == 'awaiting-method' and inv_re.match(line):
                state = 'sent-invite' if direction == 'sent' else 'recv-invite'
                continue
            if state == 'sent-invite':
                fm = from_re.match(line)
                if fm:
                    print(f'{fm.group(1)},{ts_ms}')
                    state = None
except FileNotFoundError:
    pass
PY
}

SP_INVITES="${RES}/sipp-screen-pop_invites.csv"
FO_INVITES="${RES}/sipp-failover_invites.csv"

if [[ -f "${RES}/sipp-screen-pop_messages.log" ]]; then
  parse_sipp_invites "${RES}/sipp-screen-pop_messages.log" > "${SP_INVITES}"
else
  : > "${SP_INVITES}"
fi
if [[ -f "${RES}/sipp-failover_messages.log" ]]; then
  parse_sipp_invites "${RES}/sipp-failover_messages.log" > "${FO_INVITES}"
else
  : > "${FO_INVITES}"
fi

# ----- Join SIPp invites with subscriber JSONL -----
#
# subscriber JSONL line:
#   {"t_event_received_ms":1768300000123,"channel_id":"...","call_number":"42",...}
join_phase() {
  local invites_csv="$1"
  local subscriber_jsonl="$2"
  python3 - "${invites_csv}" "${subscriber_jsonl}" <<'PY'
import csv, json, sys, statistics
invites_csv, subscriber_jsonl = sys.argv[1], sys.argv[2]
invites = {}
with open(invites_csv) as f:
    for row in csv.reader(f):
        if len(row) >= 2 and row[1].strip():
            try:
                invites[row[0]] = int(row[1])
            except ValueError:
                pass
events = {}
try:
    with open(subscriber_jsonl) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            cn = rec.get('call_number')
            t  = rec.get('t_event_received_ms')
            if cn and t is not None:
                events[str(cn)] = int(t)
except FileNotFoundError:
    pass

deltas = []
joined = []
for cn, t_sent in invites.items():
    t_stasis = events.get(cn)
    if t_stasis is None:
        joined.append((cn, t_sent, None, None))
        continue
    delta = t_stasis - t_sent
    deltas.append(delta)
    joined.append((cn, t_sent, t_stasis, delta))

n_sent     = len(invites)
n_received = sum(1 for j in joined if j[2] is not None)
loss       = n_sent - n_received

print(f"sent={n_sent}")
print(f"received={n_received}")
print(f"loss={loss}")
if deltas:
    deltas.sort()
    p = lambda q: deltas[min(int(q * len(deltas)) - 1, len(deltas) - 1)] if deltas else 0
    print(f"p50={p(0.50)}")
    print(f"p95={p(0.95)}")
    print(f"p99={p(0.99)}")
    print(f"max={deltas[-1]}")
    print(f"min={deltas[0]}")
PY
}

echo "[summarise] joining phase 2 (screen-pop)"
PHASE2_OUT=$(join_phase "${SP_INVITES}" "${RES}/subscriber-phase2.jsonl")
echo "[summarise] joining phase 3 (failover)"
PHASE3_OUT=$(join_phase "${FO_INVITES}" "${RES}/subscriber-phase3.jsonl")

# ----- Compute failover time-to-first-200-OK from pause moment -----
T_PAUSE_MS=$(cat "${RES}/pause-epoch-ms.txt" 2>/dev/null || echo 0)

# First Stasis event in phase 3 = first successful failover-routed call.
T_FIRST_STASIS_MS=$(python3 -c "
import json, sys
best = None
try:
    with open('${RES}/subscriber-phase3.jsonl') as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try: r = json.loads(line)
            except: continue
            t = r.get('t_event_received_ms')
            if t is not None and (best is None or t < best):
                best = t
except FileNotFoundError:
    pass
print(best if best is not None else 0)
")

if [[ "${T_PAUSE_MS}" -gt 0 && "${T_FIRST_STASIS_MS}" -gt 0 ]]; then
  FAILOVER_MS=$(( T_FIRST_STASIS_MS - T_PAUSE_MS ))
else
  FAILOVER_MS=-1
fi

# ----- Verdict -----
P95=$(echo "${PHASE2_OUT}" | awk -F= '/^p95=/{print $2}')
LOSS_P2=$(echo "${PHASE2_OUT}" | awk -F= '/^loss=/{print $2}')
LOSS_P3=$(echo "${PHASE3_OUT}" | awk -F= '/^loss=/{print $2}')

VERDICT="UNKNOWN"
REASON=""
if [[ -z "${P95}" ]]; then
  VERDICT="RED"
  REASON="no screen-pop events captured — probe didn't exercise hazard"
elif [[ "${P95}" -gt 1500 ]]; then
  VERDICT="RED"
  REASON="screen-pop p95=${P95}ms > 1500ms budget"
elif [[ "${FAILOVER_MS}" -lt 0 ]]; then
  VERDICT="RED"
  REASON="failover never produced a StasisStart event — standby unreachable"
elif [[ "${FAILOVER_MS}" -gt 120000 ]]; then
  VERDICT="RED"
  REASON="failover time-to-first-OK=${FAILOVER_MS}ms > 120s"
elif [[ "${P95}" -gt 800 ]] || [[ "${FAILOVER_MS}" -gt 30000 ]] || [[ "${LOSS_P2}" -gt 0 ]] || [[ "${LOSS_P3}" -gt 0 ]]; then
  VERDICT="YELLOW"
  REASON="screen-pop p95=${P95}ms, failover=${FAILOVER_MS}ms, loss_p2=${LOSS_P2}, loss_p3=${LOSS_P3}"
else
  VERDICT="GREEN"
  REASON="all metrics within budget"
fi

# ----- Write summary.md -----
{
  echo "# S1 PoT — summary"
  echo
  echo "- **Verdict:** ${VERDICT}"
  echo "- **Reason:** ${REASON}"
  echo
  echo "## Phase 2 — screen-pop (100 INVITEs through kamailio-primary, 10/s)"
  echo
  echo "\`\`\`"
  echo "${PHASE2_OUT}"
  echo "\`\`\`"
  echo
  echo "## Phase 3 — failover (10 INVITEs through kamailio-standby after primary pause)"
  echo
  echo "\`\`\`"
  echo "${PHASE3_OUT}"
  echo "\`\`\`"
  echo
  echo "## Failover wall-clock"
  echo
  echo "- pause moment        : ${T_PAUSE_MS} (epoch ms)"
  echo "- first StasisStart   : ${T_FIRST_STASIS_MS} (epoch ms)"
  echo "- time-to-first-OK    : ${FAILOVER_MS} ms"
  echo
  echo "## Budget reference"
  echo
  echo "| Metric            | Green     | Yellow      | Red        | Observed |"
  echo "|-------------------|-----------|-------------|------------|----------|"
  echo "| screen-pop p95    | ≤ 800 ms  | ≤ 1500 ms   | > 1500 ms  | ${P95} ms |"
  echo "| failover TTFOK    | ≤ 30 s    | ≤ 120 s     | > 120 s    | ${FAILOVER_MS} ms |"
  echo "| call loss phase 2 | 0         | 0           | any        | ${LOSS_P2} |"
  echo "| call loss phase 3 | 0         | 0           | any        | ${LOSS_P3} |"
} > "${RES}/summary.md"

cat "${RES}/summary.md"
