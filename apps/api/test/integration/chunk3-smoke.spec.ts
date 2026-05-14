/**
 * Chunk 3 integration smoke test.
 * @requires-compose — requires `make poc-up`, `make poc-seed`, and `make api-dev` running.
 * Run via: `make poc-test-chunk3`
 *
 * Exit criterion verification (spec lines 111–115):
 * - SIPp INVITE → NATS `stasis_start` message received
 * - WS `call.screenpop` event with `type='incoming_call'` received
 * - NATS→WS chain latency < 800 ms (ADR-0024 budget for queue dequeue latency)
 * - `recording` row has correct `tenant_id` in DB
 * - `queue_call` row has correct `tenant_id` in DB
 * - MinIO object exists at `recordings/<callId>.wav`
 *
 * SIPp image: drachtio/sipp@sha256:a47d473051b8686a68143f36c539acdbefb620bb88ebcfd9e8ee44335a38eca4
 * (amd64-only image; --platform linux/amd64 required on arm64 macOS).
 * Kamailio SIP port published to host via ${KAMAILIO_SIP_HOST_PORT:-5060} (D17).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, StringCodec } from 'nats';
import WebSocket from 'ws';
import { spawn } from 'child_process';
import * as pg from 'postgres';
import * as Minio from 'minio';

const SEEDED_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SEEDED_OPERATOR_ID = '66666666-6666-6666-6666-666666666666';

const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222';
const DB_URL = process.env.DATABASE_URL ?? 'postgres://ncall.ncall:ncall@localhost:6543/ncall';
const API_WS_URL = 'ws://localhost:3000/ws';
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? 'localhost';
const MINIO_PORT = Number(process.env.MINIO_PORT ?? 9000);
const KAMAILIO_SIP_PORT = process.env.KAMAILIO_SIP_HOST_PORT ?? '5060';

// SIPp image pinned to digest (amd64-only; --platform linux/amd64 for arm64 macOS).
// Tag: drachtio/sipp:latest (only tag published; last updated 2018-07-08 — stable).
const SIPP_IMAGE = 'drachtio/sipp@sha256:a47d473051b8686a68143f36c539acdbefb620bb88ebcfd9e8ee44335a38eca4';

function mintOperatorJwt(): string {
  const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
  return jwt.sign(
    { sub: SEEDED_OPERATOR_ID, tenantId: SEEDED_TENANT_ID, role: 'operator' },
    process.env.APP_JWT_SECRET ?? 'poc-only-not-prod',
    { expiresIn: '1h' },
  );
}

/** Wait for a single NATS message on subject, resolve with decoded payload. Times out after `timeoutMs`. */
function waitForNatsMessage(nc: Awaited<ReturnType<typeof connect>>, subject: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.unsubscribe();
      reject(new Error(`NATS timeout: no message on '${subject}' within ${timeoutMs}ms`));
    }, timeoutMs);

    const sc = StringCodec();
    const sub = nc.subscribe(subject, {
      callback: (_err, msg) => {
        if (msg) {
          clearTimeout(timer);
          sub.unsubscribe();
          resolve(JSON.parse(sc.decode(msg.data)));
        }
      },
    });
  });
}

/** Wait for a WS message matching predicate, resolve with parsed data. Times out after `timeoutMs`. */
function waitForWsEvent(ws: WebSocket, predicate: (parsed: any) => boolean, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`WS timeout: no matching event within ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(data: any) {
      const parsed = JSON.parse(data.toString());
      if (predicate(parsed)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(parsed.data);
      }
    }
    ws.on('message', handler);
  });
}

describe('Chunk 3 smoke — SIPp INVITE → NATS + WS + DB + MinIO', () => {
  let nc: Awaited<ReturnType<typeof connect>>;
  let ws: WebSocket;
  let sql: ReturnType<typeof pg.default>;
  let minio: Minio.Client;

  beforeAll(async () => {
    nc = await connect({ servers: NATS_URL });
    ws = new WebSocket(`${API_WS_URL}?token=${mintOperatorJwt()}`);
    await new Promise<void>((res, rej) => {
      ws.on('open', res);
      ws.on('error', rej);
    });
    sql = pg.default(DB_URL);
    minio = new Minio.Client({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'ncall',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'ncall1234',
    });
  });

  afterAll(async () => {
    ws.close();
    await nc.drain();
    await sql.end();
  });

  it(
    'SIPp INVITE fires: NATS stasis_start + WS incoming_call; NATS→WS latency < 800ms; DB rows tenant_id; MinIO object exists',
    async () => {
      // Set up listeners BEFORE firing SIPp (so no events are missed)
      const natsPromise = waitForNatsMessage(nc, 'ncall.stasis.start', 15000);
      const wsPromise = waitForWsEvent(
        ws,
        (parsed) => parsed.event === 'call.screenpop' && parsed.data?.type === 'incoming_call',
        15000,
      );

      // Fire SIPp asynchronously via spawn (D18: do NOT block with execSync).
      // --platform linux/amd64: drachtio/sipp is amd64-only; Rosetta handles on arm64 macOS.
      // host.docker.internal: resolves to macOS host IP from inside Docker Desktop container (D17).
      // --entrypoint sipp: drachtio/sipp's default entrypoint is /entrypoint.sh which runs
      //   `exec $@` — bash exec mis-parses SIPp's `-s` flag. Override to invoke sipp directly.
      const sippArgs = [
        'run', '--rm', '--platform', 'linux/amd64',
        '--entrypoint', 'sipp',
        SIPP_IMAGE,
        '-sn', 'uac',
        '-d', '2000',
        '-m', '1',
        '-r', '1',
        '-rp', '1000',
        '-s', '+15555550100',
        `host.docker.internal:${KAMAILIO_SIP_PORT}`,
      ];
      const sippProc = spawn('docker', sippArgs, { stdio: 'pipe' });
      sippProc.on('error', (err) => {
        // Non-fatal: SIPp process error is reported but does not block the race.
        // The race will time out if SIPp never fires the INVITE.
        console.error('SIPp spawn error:', err);
      });

      // D18: measure NATS→WS chain latency only.
      // Wait for NATS message first, then measure time until WS arrives.
      const natsPayload = await natsPromise;
      const t0 = Date.now();
      const wsPayload = await wsPromise;
      const elapsedNatsToWs = Date.now() - t0;

      // Wait for SIPp to exit (cleanup — do not block assertions on this)
      const sippExitPromise = new Promise<void>((resolve) => sippProc.on('close', () => resolve()));

      // WS payload assertions (spec exit criterion line 113)
      expect(wsPayload.type).toBe('incoming_call');
      expect(wsPayload.callId).toMatch(/^[0-9a-f-]{36}$/);
      expect(wsPayload.tenantId).toBe(SEEDED_TENANT_ID);

      // ADR-0024 NATS→WS latency budget
      expect(elapsedNatsToWs).toBeLessThan(800);

      // NATS payload assertions
      expect(natsPayload.tenantId).toBe(SEEDED_TENANT_ID);
      expect(natsPayload.callId).toMatch(/^[0-9a-f-]{36}$/);

      const callId = natsPayload.callId as string;

      // DB: queue_call row with tenant_id (spec exit criterion line 114)
      const [qcRow] = await sql`
        SELECT tenant_id FROM queue_call WHERE call_id = ${callId}
      `;
      expect(qcRow).toBeDefined();
      expect(qcRow.tenant_id).toBe(SEEDED_TENANT_ID);

      // DB: recording row with tenant_id (spec exit criterion line 114)
      const [recRow] = await sql`
        SELECT tenant_id, path FROM recording WHERE call_id = ${callId}
      `;
      expect(recRow).toBeDefined();
      expect(recRow.tenant_id).toBe(SEEDED_TENANT_ID);

      // MinIO: recording placeholder object exists (spec exit criterion line 114)
      await expect(
        minio.statObject('ncall-recordings', `recordings/${callId}.wav`),
      ).resolves.toBeDefined();

      // Cleanup: wait for SIPp to finish
      await sippExitPromise;
    },
    30000,
  );
});
