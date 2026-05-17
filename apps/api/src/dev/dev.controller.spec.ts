import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import * as jsonwebtoken from 'jsonwebtoken';
import { DevController } from './dev.controller';
import { makeDb } from '@tas/db/client';
import { DB_TOKEN } from '../database/database.module';
import { tenant, user } from '@tas/db';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OPERATOR_ID = '66666666-6666-6666-6666-666666666666';

describe('DevController', () => {
  let controller: DevController;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    const db = makeDb(process.env.DATABASE_URL!);
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo' }).onConflictDoNothing();
    await db.insert(user).values({ id: OPERATOR_ID, tenantId: TENANT_ID, email: 'op@demo.test', role: 'operator' }).onConflictDoNothing();
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [DevController],
      providers: [{ provide: DB_TOKEN, useValue: db }],
    }).compile();
    controller = mod.get(DevController);
  });

  afterAll(() => { process.env.NODE_ENV = originalNodeEnv; });

  it('mints a JWT for the seeded operator', async () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_JWT_SECRET = 'unit-test-secret';
    const out = await controller.operatorToken(OPERATOR_ID);
    const decoded = jsonwebtoken.verify(out.token, 'unit-test-secret') as any;
    expect(decoded.sub).toBe(OPERATOR_ID);
    expect(decoded.tenantId).toBe(TENANT_ID);
    expect(decoded.role).toBe('operator');
  });

  it('throws NotFound when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(controller.operatorToken(OPERATOR_ID)).rejects.toThrow(/not found/i);
  });

  it('throws NotFound when operator does not exist', async () => {
    process.env.NODE_ENV = 'development';
    await expect(controller.operatorToken('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/not found/i);
  });
});
