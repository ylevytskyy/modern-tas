// RED: fails because NatsClientService does not exist yet.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NatsClientService } from './nats-client.service';
import { NATS_CLIENT_TOKEN } from './nats.module';

describe('NatsClientService', () => {
  let service: NatsClientService;
  let module: TestingModule;

  const mockNc = {
    publish: vi.fn(),
    subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    closed: Promise.resolve(),
    drain: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        NatsClientService,
        { provide: NATS_CLIENT_TOKEN, useValue: mockNc },
      ],
    }).compile();
    service = module.get(NatsClientService);
  });

  afterAll(async () => {
    await module.close();
  });

  it('publish() calls nc.publish with subject and encoded payload', () => {
    const payload = { callId: 'abc', tenantId: 'tenant-1', channel: 'ch-1', accountId: 'acct-1' };
    service.publish('tas.stasis.start', payload);
    expect(mockNc.publish).toHaveBeenCalledWith(
      'tas.stasis.start',
      expect.any(Uint8Array),
    );
    const encoded = mockNc.publish.mock.calls[0][1] as Uint8Array;
    const decoded = JSON.parse(new TextDecoder().decode(encoded));
    expect(decoded).toMatchObject(payload);
  });

  it('subscribe() calls nc.subscribe and registers callback', () => {
    const handler = vi.fn();
    service.subscribe('tas.stasis.start', handler);
    expect(mockNc.subscribe).toHaveBeenCalledWith(
      'tas.stasis.start',
      expect.objectContaining({ callback: expect.any(Function) }),
    );
  });
});
