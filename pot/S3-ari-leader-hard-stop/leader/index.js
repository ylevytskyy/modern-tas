// PoT S3 leader stub.
//
// Throwaway by design — production M30 is rewritten test-first in Sprint 1.
//
// Implements the ADR-0016 hard-stop semantics closely enough for the
// chaos probe to measure both signals:
//
//   close-latency:  detect lease loss → close WS within 100 ms (wire FIN)
//   reconciliation: on takeover, hang up any channels left in our Stasis app
//
// Logs structured JSON to stdout so run-test.sh can grep timestamps
// without parsing a human-language log format.

const ari = require('ari-client');
const Redis = require('ioredis');

const INSTANCE_ID = process.env.INSTANCE_ID;
const REDIS_URL = process.env.REDIS_URL;
const ARI_URL = process.env.ARI_URL;
const ARI_USER = process.env.ARI_USER;
const ARI_PASS = process.env.ARI_PASS;
const ARI_APP = process.env.ARI_APP;
const LEASE_KEY = process.env.LEASE_KEY;
// ADR-0016 literally says "1 s heartbeat, 1 s TTL". That has a race:
// setInterval(1000) fires at exactly the TTL boundary, so renew's GET
// sees the key already evicted and the leader spuriously loses. Both
// leaders then flap once per second. The PoT-side fix is TTL > heartbeat;
// the ADR-side fix is "heartbeat slightly before TTL". We use a 2× ratio
// (heartbeat 500 ms, TTL 1500 ms) so the lease is always alive when the
// renew GET fires. This is noted in pot/pot-readout.md §S3 as a real
// finding the spike surfaced about ADR-0016 wording.
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 500);
const LEASE_TTL_MS = Number(process.env.LEASE_TTL_MS || 1500);

const redis = new Redis(REDIS_URL);

let wantedLeader = false;
let ariClient = null;

function log(event, extra) {
  console.log(JSON.stringify({ instance: INSTANCE_ID, event, ts: Date.now(), ...(extra || {}) }));
}

async function tryAcquire() {
  return (await redis.set(LEASE_KEY, INSTANCE_ID, 'NX', 'PX', LEASE_TTL_MS)) === 'OK';
}

async function renew() {
  const current = await redis.get(LEASE_KEY);
  if (current !== INSTANCE_ID) return false;
  await redis.pexpire(LEASE_KEY, LEASE_TTL_MS);
  return true;
}

async function openWsWithRetry() {
  // Asterisk rejects a second WS for the same Stasis app while the
  // previous one is still alive (ADR-0016 §Consequences). Leader-B will
  // hit that path while leader-A is paused, so we retry until the
  // displaced leader's WS actually closes.
  for (let attempt = 1; attempt <= 60 && wantedLeader; attempt++) {
    try {
      log('ws-open-attempt', { attempt });
      const client = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);
      await client.start(ARI_APP);
      log('ws-open-success', { attempt });
      return client;
    } catch (err) {
      log('ws-open-failed', { attempt, error: String(err && err.message || err) });
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}

async function reconcile(client) {
  log('reconcile-start');
  try {
    // Use GET /ari/applications/{app} to learn which channels Asterisk
    // currently attributes to our Stasis app. The plain GET /ari/channels
    // returns *all* channels Asterisk knows about (regardless of app)
    // and the per-channel `dialplan.app_name` is the dialplan app
    // currently executing (Wait, AppDial2, …), NOT the Stasis app — so
    // filtering by it always returned zero. /applications/<app> is the
    // canonical source for "channels in this Stasis app."
    const app = await client.applications.get({ applicationName: ARI_APP });
    const channelIds = (app && app.channel_ids) || [];
    log('reconcile-enumerate', { mine: channelIds.length });
    for (const id of channelIds) {
      const t0 = Date.now();
      try {
        await client.channels.hangup({ channelId: id });
        log('reconcile-hangup', { channelId: id, ms: Date.now() - t0 });
      } catch (err) {
        log('reconcile-hangup-failed', { channelId: id, error: String(err && err.message || err) });
      }
    }
    log('reconcile-done', { hungUp: channelIds.length });
  } catch (err) {
    log('reconcile-error', { error: String(err && err.message || err) });
  }
}

async function becomeLeader() {
  if (wantedLeader) return;
  wantedLeader = true;
  log('acquired');
  const client = await openWsWithRetry();
  if (!client) {
    log('become-leader-aborted', { reason: 'never opened ws while wanted' });
    wantedLeader = false;
    return;
  }
  ariClient = client;
  await reconcile(client);
}

function loseLeadership(reason) {
  if (!wantedLeader) return;
  const hbLostTs = Date.now();
  log('heartbeat lost', { reason });
  wantedLeader = false;
  const clientRef = ariClient;
  ariClient = null;
  process.nextTick(() => {
    const closeCallTs = Date.now();
    log('ws-close-called', { closeCallMs: closeCallTs - hbLostTs });
    if (clientRef) {
      try {
        // ari-client v2 keeps the WS on a private property. The library's
        // stop() is async + waits for outstanding handlers; we need the
        // FIN to hit the wire immediately, so force the close ourselves.
        if (clientRef._connection && clientRef._connection.ws && typeof clientRef._connection.ws.close === 'function') {
          clientRef._connection.ws.close();
        }
        if (clientRef.WebSocket && typeof clientRef.WebSocket.close === 'function') {
          clientRef.WebSocket.close();
        }
        // Belt and braces — ask the library to stop the app too.
        if (typeof clientRef.stop === 'function') {
          clientRef.stop(ARI_APP);
        }
      } catch (err) {
        log('ws-close-error', { error: String(err && err.message || err) });
      }
      log('ws-close-issued');
    }
  });
}

async function heartbeat() {
  try {
    if (wantedLeader) {
      if (!(await renew())) loseLeadership('renew failed');
    } else {
      if (await tryAcquire()) await becomeLeader();
      else log('standby');
    }
  } catch (err) {
    loseLeadership(`heartbeat error: ${err.message}`);
  }
}

setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
heartbeat();

process.on('SIGTERM', () => { log('sigterm'); process.exit(0); });
process.on('SIGINT',  () => { log('sigint');  process.exit(0); });
