import { describe, it, expect, beforeAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AccountController } from './account.controller';
import { DB_TOKEN } from '../database/database.module';
import { makeDb } from '@tas/db/client';
import { account, tenant } from '@tas/db';

// DATABASE_URL is set by vitest.globalSetup.ts (testcontainers)
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';

describe('AccountController', () => {
  let controller: AccountController;
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);
    // Seed minimal data into testcontainers Postgres
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo-tenant' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Demo Account' }).onConflictDoNothing();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [{ provide: DB_TOKEN, useValue: db }],
    }).compile();

    controller = module.get(AccountController);
  });

  it('returns the account when found', async () => {
    const req = { user: { sub: 'op-id', tenantId: TENANT_ID, role: 'operator' } };
    const result = await controller.findOne(ACCOUNT_ID, req as any);
    expect(result.id).toBe(ACCOUNT_ID);
    expect(result.tenantId).toBe(TENANT_ID);
    expect(result.name).toBe('Demo Account');
    expect(typeof result.createdAt).toBe('string');
  });

  it('throws NotFoundException for a wrong tenantId', async () => {
    const req = { user: { sub: 'op-id', tenantId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', role: 'operator' } };
    await expect(controller.findOne(ACCOUNT_ID, req as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException for a non-existent id', async () => {
    const req = { user: { sub: 'op-id', tenantId: TENANT_ID, role: 'operator' } };
    await expect(controller.findOne('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', req as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
