import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { DispatchLatenciesController } from './dispatch-latencies.controller';

describe('DispatchLatenciesController', () => {
  let arbiter: { getLatenciesForCall: ReturnType<typeof vi.fn> };
  let controller: DispatchLatenciesController;
  beforeEach(() => {
    arbiter = { getLatenciesForCall: vi.fn().mockReturnValue([10, 20, 30]) };
    controller = new DispatchLatenciesController(arbiter as any);
    process.env.INTERNAL_API_TOKEN = 'local-dev-token';
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
});
