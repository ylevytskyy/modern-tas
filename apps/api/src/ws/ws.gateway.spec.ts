// RED: fails because WsGateway does not exist.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { WsGateway } from './ws.gateway';
import { WsEvents } from '@tas/shared-types';
import type { WsIncomingCallPayload } from '@tas/shared-types';

describe('WsGateway', () => {
  let gateway: WsGateway;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({ providers: [WsGateway] }).compile();
    gateway = module.get(WsGateway);
  });

  afterAll(async () => { await module.close(); });

  it('sendToOperator: sends event on open WS connection for that operator', () => {
    const OPERATOR_ID = '66666666-6666-6666-6666-666666666666';
    const mockSend = vi.fn();
    const mockSocket = { readyState: 1, send: mockSend } as any;

    gateway.registerConnection(OPERATOR_ID, mockSocket);

    const payload: WsIncomingCallPayload = {
      type: 'incoming_call',
      callId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      tenantId: '11111111-1111-1111-1111-111111111111',
      accountId: '22222222-2222-2222-2222-222222222222',
      callerE164: '+15555550200',
    };

    gateway.sendToOperator(OPERATOR_ID, payload);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const sentMessage = JSON.parse(mockSend.mock.calls[0][0] as string);
    expect(sentMessage.event).toBe(WsEvents.CALL_SCREEN_POP);
    expect(sentMessage.data.type).toBe('incoming_call');
    expect(sentMessage.data.callId).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('sendToOperator: no-ops when operator has no connection', () => {
    expect(() => gateway.sendToOperator('no-such-operator', {
      type: 'incoming_call', callId: 'x', tenantId: 'y', accountId: 'z', callerE164: '+1',
    })).not.toThrow();
  });
});
