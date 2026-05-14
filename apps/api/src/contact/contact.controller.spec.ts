import { describe, it, expect, beforeAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ContactController } from './contact.controller';
import { DB_TOKEN } from '../database/database.module';
import { makeDb } from '@ncall/db/client';
import { account, contact, tenant } from '@ncall/db';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const CONTACT_ID = '44444444-4444-4444-4444-444444444444';

describe('ContactController', () => {
  let controller: ContactController;
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo-tenant' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Demo Account' }).onConflictDoNothing();
    await db.insert(contact).values({ id: CONTACT_ID, accountId: ACCOUNT_ID, name: 'Alice Demo', phone: '+15555550200' }).onConflictDoNothing();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContactController],
      providers: [{ provide: DB_TOKEN, useValue: db }],
    }).compile();

    controller = module.get(ContactController);
  });

  it('returns the contact when found', async () => {
    const req = { user: { sub: 'op-id', tenantId: TENANT_ID, role: 'operator' } };
    const result = await controller.findOne(CONTACT_ID, req as any);
    expect(result.id).toBe(CONTACT_ID);
    expect(result.name).toBe('Alice Demo');
    expect(result.phone).toBe('+15555550200');
  });

  it('throws NotFoundException for wrong tenant scope', async () => {
    const req = { user: { sub: 'op-id', tenantId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', role: 'operator' } };
    await expect(controller.findOne(CONTACT_ID, req as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
