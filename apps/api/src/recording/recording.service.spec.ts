// RED: fails because RecordingService does not exist.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { RecordingService } from './recording.service';
import { DB_TOKEN } from '../database/database.module';
import { makeDb } from '@ncall/db/client';
import { tenant, account, did, call, recording } from '@ncall/db';
import { eq } from 'drizzle-orm';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const DID_ID = '33333333-3333-3333-3333-333333333333';
const CALL_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('RecordingService', () => {
  let service: RecordingService;
  let module: TestingModule;
  let db: ReturnType<typeof makeDb>;

  const mockMinioClient = {
    putObject: vi.fn().mockResolvedValue({ etag: 'abc', versionId: null }),
    bucketExists: vi.fn().mockResolvedValue(true),
    makeBucket: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo-tenant' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Demo Account' }).onConflictDoNothing();
    await db.insert(did).values({ id: DID_ID, accountId: ACCOUNT_ID, e164: '+15555550100' }).onConflictDoNothing();
    await db.insert(call).values({
      id: CALL_ID,
      tenantId: TENANT_ID,
      accountId: ACCOUNT_ID,
      didId: DID_ID,
      fromE164: '+15555550200',
      startedAt: new Date(),
    }).onConflictDoNothing();

    module = await Test.createTestingModule({
      providers: [
        RecordingService,
        { provide: DB_TOKEN, useValue: db },
        { provide: 'MINIO_CLIENT', useValue: mockMinioClient },
      ],
    }).compile();
    service = module.get(RecordingService);
  });

  afterAll(async () => { await module.close(); });

  it('startRecording: inserts recording row with correct tenant_id and uploads placeholder to MinIO', async () => {
    await service.startRecording({ callId: CALL_ID, channelId: 'test-channel', tenantId: TENANT_ID });

    const [rec] = await db.select().from(recording).where(eq(recording.callId, CALL_ID));
    expect(rec).toBeDefined();
    expect(rec.tenantId).toBe(TENANT_ID);
    expect(rec.path).toBe(`recordings/${CALL_ID}.wav`);
    expect(rec.startedAt).toBeInstanceOf(Date);

    expect(mockMinioClient.putObject).toHaveBeenCalledWith(
      'ncall-recordings',
      `recordings/${CALL_ID}.wav`,
      expect.any(Buffer),
    );
  });
});
