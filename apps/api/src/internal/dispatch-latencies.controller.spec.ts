import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DispatchLatenciesController } from './dispatch-latencies.controller';

describe('DispatchLatenciesController', () => {
  let arbiter: { getLatenciesForCall: ReturnType<typeof vi.fn> };
  let controller: DispatchLatenciesController;
  const originalNodeEnv = process.env.NODE_ENV;
  beforeEach(() => {
    arbiter = { getLatenciesForCall: vi.fn().mockReturnValue([10, 20, 30]) };
    controller = new DispatchLatenciesController(arbiter as any);
    process.env.INTERNAL_API_TOKEN = 'local-dev-token';
    delete process.env.NODE_ENV;
  });
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('200: returns samples for callId when token matches', async () => {
    const res = await controller.get('local-dev-token', '11111111-1111-1111-1111-111111111111');
    expect(res).toEqual({ samples: [10, 20, 30] });
    expect(arbiter.getLatenciesForCall).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
  });

  it('401: throws when token missing', async () => {
    await expect(controller.get(undefined, '11111111-1111-1111-1111-111111111111'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401: throws when token wrong', async () => {
    await expect(controller.get('wrong', '11111111-1111-1111-1111-111111111111'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('400: throws when callId query param missing', async () => {
    await expect(controller.get('local-dev-token', undefined))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('404: throws regardless of token in production (defense in depth)', async () => {
    process.env.NODE_ENV = 'production';
    await expect(controller.get('local-dev-token', '11111111-1111-1111-1111-111111111111'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(arbiter.getLatenciesForCall).not.toHaveBeenCalled();
  });
});
