import { describe, it, expect, beforeAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FormController } from './form.controller';
import { DB_TOKEN } from '../database/database.module';
import { makeDb } from '@ncall/db/client';
import { account, form, tenant } from '@ncall/db';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const FORM_ID = '55555555-5555-5555-5555-555555555555';
const FORM_SCHEMA = {
  fields: [
    { name: 'caller_name', label: 'Caller name', type: 'text' },
    { name: 'callback_phone', label: 'Callback phone', type: 'tel' },
    { name: 'message_body', label: 'Message', type: 'textarea' },
  ],
};

describe('FormController', () => {
  let controller: FormController;
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    db = makeDb(process.env.DATABASE_URL!);
    await db.insert(tenant).values({ id: TENANT_ID, name: 'demo-tenant' }).onConflictDoNothing();
    await db.insert(account).values({ id: ACCOUNT_ID, tenantId: TENANT_ID, name: 'Demo Account' }).onConflictDoNothing();
    await db.insert(form).values({ id: FORM_ID, accountId: ACCOUNT_ID, name: 'Default', schema: FORM_SCHEMA }).onConflictDoNothing();

    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret' })],
      controllers: [FormController],
      providers: [{ provide: DB_TOKEN, useValue: db }],
    }).compile();

    controller = module.get(FormController);
  });

  it('returns the form with full schema', async () => {
    const req = { user: { sub: 'op-id', tenantId: TENANT_ID, role: 'operator' } };
    const result = await controller.findOne(FORM_ID, req as any);
    expect(result.id).toBe(FORM_ID);
    expect(result.schema.fields).toHaveLength(3);
    expect(result.schema.fields[0].name).toBe('caller_name');
  });

  it('throws NotFoundException when tenant does not match', async () => {
    const req = { user: { sub: 'op-id', tenantId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', role: 'operator' } };
    await expect(controller.findOne(FORM_ID, req as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
