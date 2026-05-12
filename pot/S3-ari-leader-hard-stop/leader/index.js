// PoT S3 leader stub. Tries to hold a Redis lease; if held, opens ARI WS.
// On heartbeat loss, closes WS within 100 ms via process.nextTick.

const ari = require('ari-client');
const Redis = require('ioredis');

const INSTANCE_ID = process.env.INSTANCE_ID;
const REDIS_URL = process.env.REDIS_URL;
const ARI_URL = process.env.ARI_URL;
const ARI_USER = process.env.ARI_USER;
const ARI_PASS = process.env.ARI_PASS;
const ARI_APP = process.env.ARI_APP;
const LEASE_KEY = process.env.LEASE_KEY;
const HEARTBEAT_INTERVAL_MS = 1000;
const LEASE_TTL_MS = 1000;

let ariClient = null;
let isLeader = false;
const redis = new Redis(REDIS_URL);

async function tryAcquire() {
  const result = await redis.set(LEASE_KEY, INSTANCE_ID, 'NX', 'PX', LEASE_TTL_MS);
  return result === 'OK';
}

async function renew() {
  const current = await redis.get(LEASE_KEY);
  if (current !== INSTANCE_ID) return false;
  await redis.pexpire(LEASE_KEY, LEASE_TTL_MS);
  return true;
}

async function becomeLeader() {
  if (isLeader) return;
  isLeader = true;
  console.log(JSON.stringify({ instance: INSTANCE_ID, event: 'acquired', ts: Date.now() }));
  ariClient = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);
  await ariClient.start(ARI_APP);
}

function loseLeadership(reason) {
  if (!isLeader) return;
  const ts = Date.now();
  console.log(JSON.stringify({ instance: INSTANCE_ID, event: 'heartbeat lost', reason, ts }));
  isLeader = false;
  process.nextTick(() => {
    if (ariClient) {
      const closeTs = Date.now();
      console.log(JSON.stringify({ instance: INSTANCE_ID, event: 'ws closing', closeTs, deltaMs: closeTs - ts }));
      ariClient.stop();
      ariClient = null;
    }
  });
}

async function heartbeat() {
  try {
    if (isLeader) {
      const ok = await renew();
      if (!ok) loseLeadership('lease lost');
    } else {
      const acquired = await tryAcquire();
      if (acquired) await becomeLeader();
      else console.log(JSON.stringify({ instance: INSTANCE_ID, event: 'standby', ts: Date.now() }));
    }
  } catch (err) {
    loseLeadership(`heartbeat error: ${err.message}`);
  }
}

setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
heartbeat();
