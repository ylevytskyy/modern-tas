// PoT S2 operator simulator.
//
// Connects to the arbiter via WS, registers N virtual operators, emits
// `accept` at a fixed rate (default 10/sec) for DURATION_MS, and logs every
// `ring` / `ring-failed` event to a CSV at OUTPUT_CSV.
//
// CSV columns mirror the recording protocol in pot/S2/README.md:
//   caller_id,enqueued_at_ms,accept_received_at_ms,ring_emitted_at_ms,
//   dequeue_latency_ms,total_wait_ms,operator_id,status
//
// Stats line written to OUTPUT_DIR/operator-sim-stats.json so the make
// summary step can sanity-check the sample size matches what was driven.

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ARBITER_URL = process.env.ARBITER_URL || 'ws://arbiter:3000';
const ACCEPT_RATE_PER_SEC = Number(process.env.ACCEPT_RATE_PER_SEC || 10);
const OPERATOR_COUNT = Number(process.env.OPERATOR_COUNT || 10);
const DURATION_MS = Number(process.env.DURATION_MS || 10 * 60 * 1000);
const WARMUP_MS = Number(process.env.WARMUP_MS || 0);
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/app/results';
const OUTPUT_CSV = process.env.OUTPUT_CSV || path.join(OUTPUT_DIR, 'dequeue-latency.csv');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const csvHeader = 'caller_id,enqueued_at_ms,accept_received_at_ms,ring_emitted_at_ms,dequeue_latency_ms,total_wait_ms,operator_id,status\n';
fs.writeFileSync(OUTPUT_CSV, csvHeader);
const csv = fs.createWriteStream(OUTPUT_CSV, { flags: 'a' });

const stats = {
  acceptsSent: 0,
  ringsRecv: 0,
  ringFailedRecv: 0,
  startedAt: null,
  finishedAt: null,
};

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(ARBITER_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function connectWithRetry() {
  const deadline = Date.now() + 60_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    try {
      return await connect();
    } catch (err) {
      attempt++;
      if (attempt % 5 === 0) console.log(`[op-sim] waiting for arbiter... attempt ${attempt}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`could not reach arbiter at ${ARBITER_URL} after 60s`);
}

async function main() {
  console.log(`[op-sim] target=${ARBITER_URL} rate=${ACCEPT_RATE_PER_SEC}/s operators=${OPERATOR_COUNT} duration=${DURATION_MS}ms`);
  const ws = await connectWithRetry();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (msg.type === 'ring') {
      stats.ringsRecv++;
      csv.write([
        msg.channelId,
        msg.enqueuedAt,
        msg.acceptAt,
        msg.ringAt,
        msg.dequeueLatencyMs,
        msg.totalWaitMs,
        msg.operatorId || '',
        'ring',
      ].join(',') + '\n');
    } else if (msg.type === 'ring-failed') {
      stats.ringFailedRecv++;
      csv.write([
        msg.channelId,
        '',
        msg.acceptAt,
        '',
        '',
        '',
        msg.operatorId || '',
        'failed',
      ].join(',') + '\n');
    }
  });

  // Register all virtual operators on the single WS.
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    ws.send(JSON.stringify({ type: 'register', operatorId: `op-${i.toString().padStart(3, '0')}` }));
  }

  if (WARMUP_MS > 0) {
    console.log(`[op-sim] warmup ${WARMUP_MS}ms before sending accepts`);
    await new Promise((r) => setTimeout(r, WARMUP_MS));
  }

  stats.startedAt = Date.now();
  const intervalMs = Math.max(1, Math.round(1000 / ACCEPT_RATE_PER_SEC));
  let i = 0;
  const stopAt = Date.now() + DURATION_MS;
  console.log(`[op-sim] sending accepts every ${intervalMs}ms until t+${DURATION_MS}ms`);

  await new Promise((resolve) => {
    const tick = setInterval(() => {
      if (Date.now() >= stopAt) {
        clearInterval(tick);
        resolve();
        return;
      }
      const operatorId = `op-${(i % OPERATOR_COUNT).toString().padStart(3, '0')}`;
      ws.send(JSON.stringify({ type: 'accept', operatorId, sentAt: Date.now() }));
      stats.acceptsSent++;
      i++;
    }, intervalMs);
  });

  // Allow late ring events to land before we close the CSV.
  await new Promise((r) => setTimeout(r, 2000));
  stats.finishedAt = Date.now();

  csv.end();
  fs.writeFileSync(path.join(OUTPUT_DIR, 'operator-sim-stats.json'), JSON.stringify(stats, null, 2));
  console.log(`[op-sim] done. stats=${JSON.stringify(stats)}`);
  ws.close();
  process.exit(0);
}

main().catch((err) => { console.error('[op-sim] fatal', err); process.exit(1); });
