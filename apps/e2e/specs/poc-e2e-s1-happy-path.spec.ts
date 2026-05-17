import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { runScenario } from '../src/run-scenario.js';
import { OperatorPage } from '../pages/OperatorPage.js';
import { waitForWorkflowCompletion } from '../src/lib/temporal.js';
import { getDb, schema, closeDb } from '../src/lib/db.js';
import { objectExists } from '../src/lib/minio.js';
import { assertTenant } from '../src/lib/assert-tenant.js';
import { eq } from 'drizzle-orm';

const SEEDED_TENANT_ID   = '11111111-1111-1111-1111-111111111111';
const SEEDED_OPERATOR_ID = '66666666-6666-6666-6666-666666666666';
const RECORDINGS_BUCKET  = 'tas-recordings';

test.afterAll(async () => { await closeDb(); });

test('S-1 happy path: INVITE → screen-pop → submit → DispatchMessage completed', async ({ page }) => {
  // sipCallId is the SIPp-side Call-ID header — used for forensic correlation
  // in logs only. The system's call.id is Postgres-generated (defaultRandom);
  // we read the real callId off the rendered DOM after screen-pop.
  const sipCallId = uuidv4();
  const op = new OperatorPage(page);

  // 1. Open the operator UI, wait for WS ready BEFORE firing INVITE
  await op.goto(SEEDED_OPERATOR_ID);
  await op.waitForWsOpen();

  // 2. Fire SIPp INVITE asynchronously
  const inviteAt = Date.now();
  const sippPromise = runScenario({ scenario: 'happy-path', callId: sipCallId });

  // 3. Assert screen-pop renders; capture real callId.
  // Timeout: 40s to account for Docker `compose run` container startup and SIPp UDP
  // retransmission behaviour on host-dev. SIPp retransmits the INVITE until Asterisk
  // processes it (~30s on host-dev due to Docker network UDP path). The actual Asterisk
  // StasisStart→NATS→WS→browser pipeline is sub-second once the channel is created.
  const { callId } = await op.waitForScreenPop({ timeoutMs: 40_000 });
  const screenPopMs = Date.now() - inviteAt;
  // 40s soft budget: total E2E from `runScenario()` call to screen-pop on host-dev
  expect(screenPopMs, `screen-pop took ${screenPopMs}ms; budget 40000ms`).toBeLessThan(40_000);

  // 4. Operator accepts, types, submits
  await op.accept();
  await op.fillMessage('S-1 happy-path test message');
  const { status, body } = await op.submit();
  expect(status).toBe(201);
  // API returns { id, createdAt } — id is the messageId
  expect(body.id).toBeTruthy();
  const messageId = body.id;

  // 5. DispatchMessage workflow completes within 30s
  const workflowId = `dispatch-${messageId}`;
  await waitForWorkflowCompletion(workflowId, 30_000);

  // 6. dispatch_attempt.deliveredAt non-null
  const db = getDb();
  const [att] = await db
    .select()
    .from(schema.dispatchAttempt)
    .where(eq((schema.dispatchAttempt as any).messageId, messageId));
  expect(att, 'dispatch_attempt row exists').toBeTruthy();
  expect((att as any).deliveredAt ?? (att as any).delivered_at).toBeTruthy();

  // 7. recording row + MinIO placeholder
  const [rec] = await db
    .select()
    .from(schema.recording)
    .where(eq((schema.recording as any).callId, callId));
  expect(rec, 'recording row exists').toBeTruthy();
  const minioKey = `recordings/${callId}.wav`;
  await expect.poll(() => objectExists(RECORDINGS_BUCKET, minioKey), { timeout: 5000 }).toBe(true);

  // 8. tenant_id matches on every per-tenant table touched
  await assertTenant(SEEDED_TENANT_ID, callId);

  // 9. Let SIPp finish to keep teardown clean
  await sippPromise;
});
