# Chunk 3 Smoke Runbook

> **Goal:** Manually verify that a SIPp INVITE through the compose stack fires a StasisStart,
> the NestJS arbiter picks the seeded operator, and a WebSocket `incoming_call` event arrives.
> Also verifies `recording` + `queue_call` rows have `tenant_id` and MinIO has the object.

## Prerequisites

- All compose services healthy: `make poc-up` exits 0
- Seed data present: `make poc-seed` exits 0
- API running on host: `make api-dev` running in a terminal (port 3000)
- Kamailio SIP port 5060 published to host (via T21-ports — env-overridable as `KAMAILIO_SIP_HOST_PORT`)
- If `7233` / `8080` collide with k3d: `TEMPORAL_HOST_PORT=7234 TEMPORAL_UI_HOST_PORT=8082 make poc-up`

## Step 1: Verify compose health

```bash
docker compose -f infra/docker-compose.yml ps
```

Expected: all services show `healthy` (or `Exit 0` for `supavisor-migrate`).
Kamailio runs with `init: true` (tini owns PID 1) so its SIGCHLD trap doesn't crash on healthcheck retries.

## Step 2: Verify api booted with leader

API logs (after `make api-dev`):
```
[NestApplication] Nest application successfully started
API listening on port 3000 (WS on /ws)
This API is using a deprecated version of Swagger! ...
```

The Swagger deprecation line is the ari-client npm package introspecting Asterisk — it confirms the AriLeaderClient acquired the Redis lease and opened the ARI WebSocket.

Redis lease check:
```bash
docker exec infra-redis-1 redis-cli get "ncall:ari-leader:asterisk-1"
# Expected: api-<pid>
```

Asterisk app subscription:
```bash
docker exec infra-asterisk-1 asterisk -rx "ari show app ncall"
# Subscriptions: 0  (or 1+ if a stuck channel from a previous test)
```

## Step 3: Connect a WebSocket client

```bash
TOKEN=$(make poc-jwt)
wscat -c "ws://localhost:3000/ws?token=$TOKEN"
# Alternative: websocat "ws://localhost:3000/ws?token=$TOKEN"
```

Expected: connection opens (no output yet).

## Step 4: Send a SIPp INVITE

The portable path: run SIPp on the compose network and target kamailio by IP.
The `host.docker.internal` path is **unreliable** on Docker Desktop macOS — UDP NAT
intermittently drops packets between the SIPp container and the published port.

```bash
KAMAILIO_IP=$(docker inspect infra-kamailio-1 \
  --format '{{range $k,$v := .NetworkSettings.Networks}}{{$v.IPAddress}}{{end}}')

docker run --rm --network infra_default \
  --platform linux/amd64 \
  --entrypoint sipp \
  drachtio/sipp@sha256:a47d473051b8686a68143f36c539acdbefb620bb88ebcfd9e8ee44335a38eca4 \
  -sn uac \
  -d 2000 \
  -m 1 \
  -r 1 \
  -rp 1000 \
  -s +15555550100 \
  "${KAMAILIO_IP}:5060"
```

Notes:
- `--entrypoint sipp`: drachtio/sipp's default entrypoint is `/entrypoint.sh` which runs
  `exec $@`. Bash exec mis-parses SIPp's `-s` flag as its own. Override to invoke the
  binary directly.
- `--platform linux/amd64`: drachtio/sipp is amd64-only; required on arm64 macOS
  (Rosetta handles emulation transparently).
- `--network infra_default`: bypasses Docker Desktop's UDP NAT.
- SIPp will report `Failed call: 1` because the Stasis app doesn't auto-answer the
  INVITE — that's expected. The test we care about is the StasisStart side-effects.

If port 5060 is in use on the host: set `KAMAILIO_SIP_HOST_PORT=5061` in `.env` and
restart compose. The publish is mostly for tools that need to send SIP from the host;
the integration path here is compose-internal.

## Step 5: Observe the WebSocket event

In the wscat terminal, within ~1 second of the INVITE:

```json
{"event":"call.screenpop","data":{"type":"incoming_call","callId":"<uuid>","tenantId":"11111111-1111-1111-1111-111111111111","callerE164":""}}
```

Assert:
- `data.type === "incoming_call"` ✓
- `data.callId` matches UUID v4 pattern ✓
- `data.tenantId === "11111111-1111-1111-1111-111111111111"` ✓
- `data.callerE164` is `""` for now — Chunk 6 populates it from the call row

## Step 6: Verify the NATS message

Run BEFORE the INVITE to observe (in a separate terminal):

```bash
# nats CLI is not in the container; use a Node script:
node -e "
const { connect, StringCodec } = require('./apps/api/node_modules/nats');
const sc = StringCodec();
(async () => {
  const nc = await connect({ servers: 'nats://localhost:4222' });
  nc.subscribe('ncall.>', { callback: (_e, msg) => msg && console.log(msg.subject, sc.decode(msg.data)) });
  setTimeout(() => process.exit(0), 60000);
})();"
```

Expected: JSON payload with `callId`, `tenantId`, `channel`, `accountId` on subject
`ncall.stasis.start`.

## Step 7: Verify DB rows

```bash
CALL_ID=<paste-callId-here>

psql postgres://ncall.ncall:ncall@localhost:6543/ncall -c \
  "SELECT id, tenant_id, call_id, enqueued_at FROM queue_call WHERE call_id = '$CALL_ID';"
# Expected: 1 row, tenant_id = '11111111-1111-1111-1111-111111111111'

psql postgres://ncall.ncall:ncall@localhost:6543/ncall -c \
  "SELECT id, tenant_id, path, started_at FROM recording WHERE call_id = '$CALL_ID';"
# Expected: 1 row, tenant_id = '11111111-1111-1111-1111-111111111111', path = 'recordings/<callId>.wav'
```

## Step 8: Verify MinIO object

```bash
mc alias set local http://localhost:9000 ncall ncall1234
mc stat local/ncall-recordings/recordings/$CALL_ID.wav
```

Expected: object exists (size 0 — placeholder; actual WAV populated by Chunk 7).

## Step 9: Debug attach points

- VS Code "Attach to API" (port 9229): set breakpoint in `stasis-start.handler.ts:handleStasisStart`.
  Fire another INVITE. Breakpoint should hit.
- NATS visible: `docker exec infra-nats-1 nc -z localhost 4222 && echo OK`
- Redis visible: `docker exec infra-redis-1 redis-cli keys 'ncall:ari-leader:*'`
  → `ncall:ari-leader:asterisk-1` present

## Automated equivalent

```bash
make poc-test-chunk3
```

Runs the integration test that exercises every assertion above in ~2 seconds. Requires
the same prerequisites: compose up, seeded, api-dev running.

## Success criteria

- [ ] WS event received within ~1 second of INVITE ✓
- [ ] `event.type === 'incoming_call'` ✓
- [ ] `event.callId` UUID v4 ✓
- [ ] `event.tenantId === '11111111-1111-1111-1111-111111111111'` ✓
- [ ] `queue_call` row with correct `tenant_id` ✓
- [ ] `recording` row with correct `tenant_id` ✓
- [ ] MinIO object exists ✓

## Known gotchas (carried from debug session)

1. **Kamailio dispatcher requires Asterisk reachable at startup.** If kamailio comes up
   before asterisk's container DNS is ready, the dispatcher logs `could not resolve
   asterisk` and the dispatch path stays in "no targets" state. `docker restart
   infra-kamailio-1` after the stack is fully healthy fixes it.
2. **Asterisk's `default` context conflicts with pbx_lua.** The base image ships
   `extensions.lua` that registers an "Alt. Switch: Lua/" on the default context;
   patterns in our `extensions.conf` are shadowed. pjsip.conf now points the kamailio
   endpoint at `ncall-inbound` directly to sidestep this — do not change it back.
3. **`host.docker.internal:5060/udp` is flaky on macOS Docker Desktop.** Use the
   compose-network path (see Step 4) instead.
4. **drachtio/sipp's `/entrypoint.sh` mis-parses SIPp's `-s` flag.** Always use
   `--entrypoint sipp` to bypass the shell wrapper.
5. **SIPp doesn't get a 200 OK from Stasis.** The app doesn't auto-answer; SIPp will
   eventually time out with `UDP retransmission timeout`. The smoke test cares about
   StasisStart side-effects, not the SIP dialog completion.
