// RED: fails because StasisStartHandler does not exist.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { StasisStartHandler } from './stasis-start.handler';
import { DB_TOKEN } from '../database/database.module';
import { ARI_LEADER_TOKEN } from '../ari/ari.module';
import { NatsClientService } from '../nats/nats-client.service';
import { NATS_CLIENT_TOKEN } from '../nats/nats.module';
import { makeDb } from '@ncall/db/client';
import { tenant, account, did, call, queue, queueCall } from '@ncall/db';
import { NatsSubjects } from '@ncall/shared-types';
import { eq } from 'drizzle-orm';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const DID_ID = '33333333-3333-3333-3333-333333333333';
const QUEUE_ID = '77777777-7777-7777-7777-777777777777';

const makeStasisStartEvent = (channelId = 'test-channel-id') => ({
  channel: {
    id: channelId,
    dialplan: { context: 'ncall-inbound', exten: '+15555550100' },
    caller: { number: '+15555550200' },
  },
  application: 'ncall',
});

describe('StasisStartHandler', () => {
  let handler: StasisStartHandler;
  let module: TestingModule;
  let db: ReturnType<typeof makeDb>;

  const mockPublish = vi.fn();
  const mockNc = {
    publish: (sub: string, data: Uint8Array) => {
      mockPublish(sub, JSON.parse(new TextDecoder().decode(data)));
    },
    subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
  };
  const mockAriLeader = {
    start: vi.fn(),
    setStasisStartCallback: vi.fn(),
  };

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);

    // Seed minimum data — ORDER MATTERS (FK dependencies)
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo-tenant' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Demo Account' }).onConflictDoNothing();
    await db.insert(did).values({ id: DID_ID, accountId: ACCOUNT_ID, e164: '+15555550100' }).onConflictDoNothing();
    // C5 fix: insert queue row before handler runs — queueCall references queue.id
    await db.insert(queue).values({
      id: QUEUE_ID,
      accountId: ACCOUNT_ID,
      name: 'main',
      strategy: 'fifo',
    }).onConflictDoNothing();

    module = await Test.createTestingModule({
      providers: [
        StasisStartHandler,
        { provide: DB_TOKEN, useValue: db },
        { provide: NATS_CLIENT_TOKEN, useValue: mockNc },
        NatsClientService,
        { provide: ARI_LEADER_TOKEN, useValue: mockAriLeader },
      ],
    }).compile();

    handler = module.get(StasisStartHandler);
  });

  afterAll(async () => {
    await module.close();
  });

  it('on StasisStart: publishes NATS stasis_start and inserts call + queue_call with tenant_id', async () => {
    const channelId = `channel-${Date.now()}`;
    const event = makeStasisStartEvent(channelId);

    await handler.handleStasisStart(event as any);

    expect(mockPublish).toHaveBeenCalledWith(
      NatsSubjects.STASIS_START,
      expect.objectContaining({
        callId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        channel: channelId,
        tenantId: TENANT_ID,
        accountId: ACCOUNT_ID,
      }),
    );

    const publishedPayload = mockPublish.mock.calls[0][1] as { callId: string };
    const [callRow] = await db.select().from(call).where(eq(call.id, publishedPayload.callId));
    expect(callRow).toBeDefined();
    expect(callRow.tenantId).toBe(TENANT_ID);
    expect(callRow.fromE164).toBe('+15555550200');

    const [qcRow] = await db.select().from(queueCall).where(eq(queueCall.callId, publishedPayload.callId));
    expect(qcRow).toBeDefined();
    expect(qcRow.tenantId).toBe(TENANT_ID);
  });
});
