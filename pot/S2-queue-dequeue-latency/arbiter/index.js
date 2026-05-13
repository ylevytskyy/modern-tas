// PoT S2 arbiter stub.
//
// Throwaway by design — production M30 is rewritten test-first in Sprint 1.
// Mirrors the ADR-0024 architecture closely enough for the probe to exercise
// the named hazards (Redis lock contention, NATS lag):
//
//   - in-memory FIFO (a priority heap would be a strict superset; not needed
//     to measure the dequeue latency budget)
//   - Redis cross-shard ownership lock acquired at start + renewed on every
//     dequeue (per-accept renewal is the hot path the contention probe
//     stresses)
//   - waiting-heap snapshot to Redis every 5 s (matches ADR-0024 recovery
//     snapshot cadence)
//   - NATS publish on every enqueue + dequeue (heap-change events that
//     operator gateways subscribe to in production)
//   - bridge destroyed on StasisEnd so 6 000 calls / 10 min don't leak
//
// The dequeue path that gets timed by the operator-sim is:
//   accept(WS) -> Redis SET XX PX (lock renew) -> ARI bridges.create
//              -> ARI bridge.addChannel -> NATS publish -> WS ring
// All three out-of-process hops (Redis, ARI, NATS) are on the critical path
// so injecting delay into any of them visibly shifts the latency CDF.

const crypto = require('crypto');
const ari = require('ari-client');
const Redis = require('ioredis');
const { connect: natsConnect, StringCodec } = require('nats');
const { WebSocketServer } = require('ws');

const REDIS_URL = process.env.REDIS_URL;
const NATS_URL = process.env.NATS_URL;
const ARI_URL = process.env.ARI_URL;
const ARI_USER = process.env.ARI_USER;
const ARI_PASS = process.env.ARI_PASS;
const ARI_APP = process.env.ARI_APP;
const QUEUE_ID = process.env.QUEUE_ID || 'pot-queue';
const INSTANCE_ID = process.env.HOSTNAME || crypto.randomBytes(4).toString('hex');

const OWNER_KEY = `queue:${QUEUE_ID}:owner`;
const SNAPSHOT_KEY = `queue:${QUEUE_ID}:snapshot`;
const EVENTS_SUBJECT = `queue.${QUEUE_ID}.events`;
const LOCK_TTL_MS = 30000;
const RENEW_INTERVAL_MS = 10000;
const SNAPSHOT_INTERVAL_MS = 5000;

const waiting = [];
const bridgesByChannel = new Map();

let redis;
let natsConn;
let sc;
let ariClient;
let stats = { enqueue: 0, dequeue: 0, staleAccept: 0, ariErrors: 0 };

async function acquireOwnership() {
  const ok = await redis.set(OWNER_KEY, INSTANCE_ID, 'NX', 'PX', LOCK_TTL_MS);
  if (ok !== 'OK') {
    const current = await redis.get(OWNER_KEY);
    throw new Error(`queue ${QUEUE_ID} already owned by ${current}; cannot start`);
  }
}

async function renewOwnership() {
  // On the hot dequeue path this is what the Redis contention probe stresses.
  await redis.set(OWNER_KEY, INSTANCE_ID, 'XX', 'PX', LOCK_TTL_MS);
}

async function snapshotHeap() {
  const payload = JSON.stringify({
    instance: INSTANCE_ID,
    ts: Date.now(),
    depth: waiting.length,
    head: waiting.slice(0, 10).map((c) => ({ id: c.channelId, enq: c.enqueuedAt })),
  });
  await redis.set(SNAPSHOT_KEY, payload, 'EX', 60);
}

async function publishEvent(evt) {
  natsConn.publish(EVENTS_SUBJECT, sc.encode(JSON.stringify(evt)));
}

async function handleAccept(ws, msg) {
  const acceptAt = Date.now();
  const callee = waiting.shift();
  if (!callee) {
    stats.staleAccept++;
    return;
  }
  try {
    await renewOwnership();
    const bridge = await ariClient.bridges.create({ type: 'mixing' });
    await bridge.addChannel({ channel: callee.channelId });
    bridgesByChannel.set(callee.channelId, bridge.id);
    const ringAt = Date.now();
    const dequeueLatencyMs = ringAt - acceptAt;
    const totalWaitMs = ringAt - callee.enqueuedAt;
    await publishEvent({
      type: 'dequeue',
      channelId: callee.channelId,
      operatorId: msg.operatorId,
      enqueuedAt: callee.enqueuedAt,
      acceptAt,
      ringAt,
      dequeueLatencyMs,
      totalWaitMs,
    });
    stats.dequeue++;
    ws.send(JSON.stringify({
      type: 'ring',
      channelId: callee.channelId,
      operatorId: msg.operatorId,
      enqueuedAt: callee.enqueuedAt,
      acceptAt,
      ringAt,
      dequeueLatencyMs,
      totalWaitMs,
    }));
  } catch (err) {
    stats.ariErrors++;
    // Channel likely hung up between enqueue and accept; record the failure
    // but don't blow up the run.
    ws.send(JSON.stringify({
      type: 'ring-failed',
      channelId: callee.channelId,
      acceptAt,
      reason: err.message,
    }));
  }
}

async function main() {
  redis = new Redis(REDIS_URL);
  natsConn = await natsConnect({ servers: NATS_URL });
  sc = StringCodec();
  ariClient = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);

  await acquireOwnership();
  const renewTimer = setInterval(() => renewOwnership().catch(() => {}), RENEW_INTERVAL_MS);
  const snapshotTimer = setInterval(() => snapshotHeap().catch(() => {}), SNAPSHOT_INTERVAL_MS);

  ariClient.on('StasisStart', async (event, channel) => {
    const enqueuedAt = Date.now();
    waiting.push({ channelId: channel.id, enqueuedAt });
    stats.enqueue++;
    await publishEvent({ type: 'enqueue', channelId: channel.id, ts: enqueuedAt }).catch(() => {});
  });

  ariClient.on('StasisEnd', async (event, channel) => {
    // Cleanup: drop from queue if still waiting + destroy any bridge we made.
    const idx = waiting.findIndex((c) => c.channelId === channel.id);
    if (idx >= 0) waiting.splice(idx, 1);
    const bridgeId = bridgesByChannel.get(channel.id);
    if (bridgeId) {
      bridgesByChannel.delete(channel.id);
      try { await ariClient.bridges.destroy({ bridgeId }); } catch (_) {}
    }
  });

  const wss = new WebSocketServer({ port: 3000 });
  wss.on('connection', (ws) => {
    let operatorId;
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      if (msg.type === 'register') {
        operatorId = msg.operatorId;
      } else if (msg.type === 'accept') {
        await handleAccept(ws, { operatorId, ...msg });
      } else if (msg.type === 'stats') {
        ws.send(JSON.stringify({ type: 'stats', stats, depth: waiting.length, instance: INSTANCE_ID }));
      }
    });
  });

  await ariClient.start(ARI_APP);
  console.log(`[arbiter] up. instance=${INSTANCE_ID} queue=${QUEUE_ID} ari_app=${ARI_APP}`);

  const shutdown = async () => {
    clearInterval(renewTimer);
    clearInterval(snapshotTimer);
    console.log(`[arbiter] stats=${JSON.stringify(stats)} depth=${waiting.length}`);
    try { await redis.del(OWNER_KEY); } catch (_) {}
    try { await natsConn.drain(); } catch (_) {}
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => { console.error('[arbiter] fatal', err); process.exit(1); });
