// RED: fails because jwt-auth.guard.ts does not exist yet.
import { describe, it, expect, beforeAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import jwt from 'jsonwebtoken';

// Match the guard's resolution (jwt-auth.guard.ts:26) — when APP_JWT_SECRET is
// set in env (CI), use it; otherwise fall back to the PoC default. A hardcoded
// value here would diverge from the guard whenever env is set.
const SECRET = process.env.APP_JWT_SECRET ?? 'poc-only-not-prod';

function makeContext(token: string | undefined): ExecutionContext {
  const req = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    user: undefined as unknown,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: SECRET, signOptions: { expiresIn: '1h' } })],
      providers: [JwtAuthGuard],
    }).compile();
    guard = module.get(JwtAuthGuard);
  });

  it('passes a valid token and attaches user to request', async () => {
    const payload = {
      sub: '66666666-6666-6666-6666-666666666666',
      tenantId: '11111111-1111-1111-1111-111111111111',
      role: 'operator',
    };
    const token = jwt.sign(payload, SECRET);
    const ctx = makeContext(token);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(ctx.switchToHttp().getRequest().user).toMatchObject(payload);
  });

  it('rejects a missing token', async () => {
    const ctx = makeContext(undefined);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed with a wrong secret', async () => {
    const token = jwt.sign({ sub: 'x', tenantId: 'y', role: 'operator' }, 'wrong-secret');
    const ctx = makeContext(token);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
