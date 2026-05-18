// RED: fails because ArbiterService does not exist.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ArbiterService } from './arbiter.service';
import { NatsClientService } from '../nats/nats-client.service';
import { NATS_CLIENT_TOKEN } from '../nats/nats.module';
import { WsGateway } from '../ws/ws.gateway';
import type { NatsStasisStartPayload, WsIncomingCallPayload } from '@tas/shared-types';

const SEEDED_OPERATOR_ID = '66666666-6666-6666-6666-666666666666';

describe('ArbiterService', () => {
  let arbiter: ArbiterService;
  let module: TestingModule;

  const mockWsGateway = { sendToOperator: vi.fn(), sendCallEnded: vi.fn() };
  const mockNc = {
    publish: vi.fn(),
    subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        ArbiterService,
        NatsClientService,
        { provide: NATS_CLIENT_TOKEN, useValue: mockNc },
        { provide: WsGateway, useValue: mockWsGateway },
      ],
    }).compile();
    arbiter = module.get(ArbiterService);
  });

  afterAll(async () => { await module.close(); });

  it('dispatch: picks seeded operator, sends WS event with type=incoming_call', async () => {
    const stasisPayload = {
      callId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      channel: 'test-channel',
      tenantId: '11111111-1111-1111-1111-111111111111',
      accountId: '22222222-2222-2222-2222-222222222222',
      fromE164: '',
    };

    await arbiter.dispatch(stasisPayload);

    expect(mockWsGateway.sendToOperator).toHaveBeenCalledWith(
      SEEDED_OPERATOR_ID,
      expect.objectContaining<Partial<WsIncomingCallPayload>>({
        type: 'incoming_call',
        callId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        tenantId: '11111111-1111-1111-1111-111111111111',
        accountId: '22222222-2222-2222-2222-222222222222',
      }),
    );

    const [, wsPayload] = mockWsGateway.sendToOperator.mock.calls[0] as [string, WsIncomingCallPayload];
    expect(wsPayload.type).toBe('incoming_call');
    expect(wsPayload.callId).toMatch(/^[0-9a-f-]{36}$/);
    expect(wsPayload.accountId).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('dispatchCallEnded: forwards call.ended to seeded operator via sendCallEnded', () => {
    arbiter.dispatchCallEnded({
      callId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      tenantId: '11111111-1111-1111-1111-111111111111',
      endedBy: 'caller',
      endedAt: new Date().toISOString(),
    });

    expect(mockWsGateway.sendCallEnded).toHaveBeenCalledWith(
      SEEDED_OPERATOR_ID,
      { callId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', endedBy: 'caller' },
    );
  });

  it('forwards payload.fromE164 as callerE164 on the WS payload (HC#4)', async () => {
    mockWsGateway.sendToOperator.mockClear();
    const payload: NatsStasisStartPayload = {
      callId: '11111111-1111-1111-1111-111111111111',
      channel: 'PJSIP/sipp-00000001',
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      fromE164: '+15551234567',
    };
    await arbiter.dispatch(payload);
    expect(mockWsGateway.sendToOperator).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ callerE164: '+15551234567' }),
    );
  });
});
