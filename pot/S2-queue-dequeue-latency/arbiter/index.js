// PoT S2 arbiter stub. Minimal heap + ARI bridge + operator-WS ring emit.
// Throwaway by design — production M30 is rewritten test-first in Sprint 1.

const ari = require('ari-client');
const Redis = require('ioredis');
const { connect: natsConnect } = require('nats');
const { WebSocketServer } = require('ws');

const REDIS_URL = process.env.REDIS_URL;
const NATS_URL = process.env.NATS_URL;
const ARI_URL = process.env.ARI_URL;
const ARI_USER = process.env.ARI_USER;
const ARI_PASS = process.env.ARI_PASS;
const ARI_APP = process.env.ARI_APP;

const waiting = []; // [{ channelId, enqueuedAt }]
const operators = new Map(); // operatorId -> ws
const traceLog = [];

async function main() {
  const redis = new Redis(REDIS_URL);
  const nats = await natsConnect({ servers: NATS_URL });
  const client = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);

  client.on('StasisStart', (event, channel) => {
    const enqueuedAt = Date.now();
    waiting.push({ channelId: channel.id, enqueuedAt });
    traceLog.push({ event: 'enqueue', channelId: channel.id, ts: enqueuedAt });
  });

  const wss = new WebSocketServer({ port: 3000 });
  wss.on('connection', (ws) => {
    let operatorId;
    ws.on('message', async (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'register') {
        operatorId = msg.operatorId;
        operators.set(operatorId, ws);
      } else if (msg.type === 'accept') {
        const acceptAt = Date.now();
        const callee = waiting.shift();
        if (!callee) return;
        const bridge = await client.bridges.create({ type: 'mixing' });
        await bridge.addChannel({ channel: callee.channelId });
        const ringAt = Date.now();
        ws.send(JSON.stringify({
          type: 'ring',
          channelId: callee.channelId,
          dequeueLatencyMs: ringAt - acceptAt,
          totalWaitMs: ringAt - callee.enqueuedAt,
        }));
        traceLog.push({
          event: 'dequeue',
          channelId: callee.channelId,
          enqueuedAt: callee.enqueuedAt,
          acceptAt,
          ringAt,
          dequeueLatencyMs: ringAt - acceptAt,
        });
      }
    });
    ws.on('close', () => operators.delete(operatorId));
  });

  await client.start(ARI_APP);
  console.log(`arbiter started; ARI app=${ARI_APP}; ws on :3000`);

  process.on('SIGTERM', () => {
    console.log(JSON.stringify(traceLog));
    process.exit(0);
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
