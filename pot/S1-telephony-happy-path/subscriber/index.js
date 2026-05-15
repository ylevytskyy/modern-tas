// S1 PoT — ARI WebSocket subscriber. Captures StasisStart events with
// the wall-clock timestamp at which the event arrived at this process,
// plus the call_number passed as Stasis() arg[0] (which is the SIPp
// caller's [call_number] keyword threaded through CALLERID(num)).
//
// Writes one JSON line per event to /work/subscriber.jsonl. The
// summariser joins these against SIPp's per-call INVITE-sent
// timestamps by call_number to compute screen-pop latency.
//
// Intentionally does NOT hang up the channel — letting SIPp drive the
// BYE keeps the dialog lifecycle clean and matches how a real screen-
// pop consumer would behave (observe, decide, possibly forward;
// not always immediately hang up).

const fs = require('node:fs');

const ARI_HOST = process.env.ARI_HOST || 'asterisk';
const ARI_PORT = process.env.ARI_PORT || '8088';
const ARI_USER = process.env.ARI_USER || 'pot';
const ARI_PASS = process.env.ARI_PASS || 'pot';
const ARI_APP = process.env.ARI_APP || 's1-test';
const OUT_FILE = process.env.OUT_FILE || '/work/subscriber.jsonl';

const wsUrl = `ws://${ARI_HOST}:${ARI_PORT}/ari/events?app=${ARI_APP}&api_key=${ARI_USER}:${ARI_PASS}`;
const out = fs.createWriteStream(OUT_FILE, { flags: 'a' });

function emitMeta(event, extra = {}) {
  const line = JSON.stringify({ t_ms: Date.now(), event, ...extra });
  console.log(line);
}

emitMeta('subscriber_starting', { ari_app: ARI_APP, out_file: OUT_FILE });

function connect() {
  const ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    emitMeta('ws_open');
  });

  ws.addEventListener('message', (e) => {
    const t = Date.now();
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch (err) {
      emitMeta('ws_parse_error', { err: String(err) });
      return;
    }
    if (msg.type === 'StasisStart') {
      const record = {
        t_event_received_ms: t,
        channel_id: msg.channel?.id ?? null,
        channel_name: msg.channel?.name ?? null,
        call_number: Array.isArray(msg.args) ? msg.args[0] : null,
        caller_number: msg.channel?.caller?.number ?? null,
        asterisk_id: msg.asterisk_id ?? null,
      };
      out.write(JSON.stringify(record) + '\n');
      // Answer the channel from inside Stasis so SIPp gets its 200
      // OK and proceeds with ACK / BYE. The dialplan deliberately
      // doesn't call Answer() (see fixtures/asterisk/extensions.conf
      // for the rationale).
      const channelId = msg.channel?.id;
      if (channelId) {
        const auth = 'Basic ' + Buffer.from(`${ARI_USER}:${ARI_PASS}`).toString('base64');
        fetch(`http://${ARI_HOST}:${ARI_PORT}/ari/channels/${channelId}/answer`, {
          method: 'POST',
          headers: { 'Authorization': auth },
        }).catch((err) => emitMeta('answer_failed', { id: channelId, err: String(err) }));
      }
    }
  });

  ws.addEventListener('error', (e) => {
    emitMeta('ws_error', { err: e.message ?? String(e) });
  });

  ws.addEventListener('close', (e) => {
    emitMeta('ws_close', { code: e.code, reason: String(e.reason || '') });
    // Reconnect after a short delay so the subscriber survives transient
    // Asterisk restarts during the test sequence. The verification loop
    // doesn't depend on this — it's belt-and-braces.
    setTimeout(connect, 1000);
  });
}

connect();

process.on('SIGTERM', () => { emitMeta('sigterm'); out.end(); process.exit(0); });
process.on('SIGINT',  () => { emitMeta('sigint');  out.end(); process.exit(0); });
