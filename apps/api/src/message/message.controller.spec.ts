import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { MessageController } from './message.controller';
import { DB_TOKEN } from '../database/database.module';
import { TemporalClientService } from '../temporal/temporal-client.service';
import { makeDb } from '@tas/db/client';
import { account, tenant, did, user, call, message } from '@tas/db';
import { eq } from 'drizzle-orm';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const DID_ID = '33333333-3333-3333-3333-333333333333';
const OPERATOR_ID = '66666666-6666-6666-6666-666666666666';
const CALL_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('MessageController', () => {
  let controller: MessageController;
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);
    // Seed prerequisites
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo-tenant' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Demo Account' }).onConflictDoNothing();
    await db.insert(did).values({ id: DID_ID, accountId: ACCOUNT_ID, e164: '+15555550100' }).onConflictDoNothing();
    await db.insert(user).values({ id: OPERATOR_ID, tenantId: TENANT_ID, email: 'operator@demo.test', role: 'operator' }).onConflictDoNothing();
    await db.insert(call).values({
      id: CALL_ID,
      tenantId: TENANT_ID,
      accountId: ACCOUNT_ID,
      didId: DID_ID,
      fromE164: '+15555550200',
      startedAt: new Date(),
    }).onConflictDoNothing();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessageController],
      providers: [
        { provide: DB_TOKEN, useValue: db },
        { provide: TemporalClientService, useValue: { start: vi.fn().mockResolvedValue({ workflowId: 'wf-stub' }) } },
      ],
    }).compile();

    controller = module.get(MessageController);
  });

  it('creates a message and returns 201 with id + createdAt', async () => {
    const req = { user: { sub: OPERATOR_ID, tenantId: TENANT_ID, role: 'operator' } };
    const dto = { callId: CALL_ID, accountId: ACCOUNT_ID, operatorId: OPERATOR_ID, body: 'Test message' };
    const result = await controller.create(dto, req as any);
    expect(typeof result.id).toBe('string');
    expect(typeof result.createdAt).toBe('string');
    // D5 assertion: tenantId must be persisted in the row (required by Chunk 3 assert-tenant helper)
    const [row] = await db.select().from(message).where(eq(message.id, result.id));
    expect(row.tenantId).toBe(TENANT_ID);
  });

  it('starts the DispatchMessage workflow with messageId + operatorId + tenantId', async () => {
    const start = vi.fn().mockResolvedValue({ workflowId: 'wf-x' });
    const temporal = { start } as any;
    const module2: TestingModule = await Test.createTestingModule({
      controllers: [MessageController],
      providers: [
        { provide: DB_TOKEN, useValue: db },
        { provide: TemporalClientService, useValue: temporal },
      ],
    }).compile();
    const c2 = module2.get(MessageController);
    const req = { user: { sub: OPERATOR_ID, tenantId: TENANT_ID, role: 'operator' } };
    const dto = { callId: CALL_ID, accountId: ACCOUNT_ID, operatorId: OPERATOR_ID, body: 'Workflow trigger' };
    const result = await c2.create(dto, req as any);
    expect(start).toHaveBeenCalledOnce();
    const [workflowType, opts] = start.mock.calls[0];
    expect(workflowType).toBe('DispatchMessage');
    expect(opts.taskQueue).toBe('dispatch-message');
    expect(opts.workflowId).toBe(`dispatch-${result.id}`);
    expect(opts.args[0]).toMatchObject({
      messageId: result.id, operatorId: OPERATOR_ID, tenantId: TENANT_ID, callId: CALL_ID,
    });
  });
});
