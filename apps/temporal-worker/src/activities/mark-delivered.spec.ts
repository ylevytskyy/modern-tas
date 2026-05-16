import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '@tas/db/client';
import { tenant, account, did, user, call, message, dispatchAttempt } from '@tas/db';
import { makeMarkDelivered } from './mark-delivered';

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const DID_ID     = '33333333-3333-3333-3333-333333333333';
const OPERATOR_ID = '66666666-6666-6666-6666-666666666666';
const CALL_ID    = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('markDelivered', () => {
  let db: ReturnType<typeof makeDb>;
  let messageId: string;

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Acc' }).onConflictDoNothing();
    await db.insert(did).values({ id: DID_ID, accountId: ACCOUNT_ID, e164: '+15555550100' }).onConflictDoNothing();
    await db.insert(user).values({ id: OPERATOR_ID, tenantId: TENANT_ID, email: 'op@demo.test', role: 'operator' }).onConflictDoNothing();
    await db.insert(call).values({
      id: CALL_ID, tenantId: TENANT_ID, accountId: ACCOUNT_ID, didId: DID_ID,
      fromE164: '+15555550200', startedAt: new Date(),
    }).onConflictDoNothing();
    const [msg] = await db.insert(message).values({
      tenantId: TENANT_ID, callId: CALL_ID, accountId: ACCOUNT_ID, operatorId: OPERATOR_ID, body: 'hi',
    }).returning({ id: message.id });
    messageId = msg.id;
    await db.insert(dispatchAttempt).values({
      messageId, channel: 'in_app',
    });
  });

  it('sets delivered_at on the matching dispatch_attempt row', async () => {
    const activity = makeMarkDelivered(db);
    await activity({ messageId });
    const [row] = await db.select().from(dispatchAttempt).where(eq(dispatchAttempt.messageId, messageId));
    expect(row.deliveredAt).not.toBeNull();
  });

  it('is idempotent: re-running does not blow up and keeps delivered_at non-null', async () => {
    const activity = makeMarkDelivered(db);
    await activity({ messageId });
    await activity({ messageId });
    const [row] = await db.select().from(dispatchAttempt).where(eq(dispatchAttempt.messageId, messageId));
    expect(row.deliveredAt).not.toBeNull();
  });
});
