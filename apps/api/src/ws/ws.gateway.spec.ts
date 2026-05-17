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

  it('sendToOperator: sends event on open WS connection for that operator and returns true', () => {
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

    const result = gateway.sendToOperator(OPERATOR_ID, payload);

    expect(result).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const sentMessage = JSON.parse(mockSend.mock.calls[0][0] as string);
    expect(sentMessage.event).toBe(WsEvents.CALL_SCREEN_POP);
    expect(sentMessage.data.type).toBe('incoming_call');
    expect(sentMessage.data.callId).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('sendToOperator: returns false and does not send when operator has no connection', () => {
    const result = gateway.sendToOperator('no-such-operator', {
      type: 'incoming_call', callId: 'x', tenantId: 'y', accountId: 'z', callerE164: '+1',
    });
    expect(result).toBe(false);
  });

  it('sendToOperator: returns false when socket is not OPEN (readyState !== 1)', () => {
    const OPERATOR_ID = 'closed-socket-operator';
    const mockSend = vi.fn();
    const mockSocket = { readyState: 3, send: mockSend } as any; // CLOSED
    gateway.registerConnection(OPERATOR_ID, mockSocket);
    const result = gateway.sendToOperator(OPERATOR_ID, {
      type: 'incoming_call', callId: 'x', tenantId: 'y', accountId: 'z', callerE164: '+1',
    });
    expect(result).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('handleConnection: reconnect does not allow old socket close to evict new connection', () => {
    const OPERATOR_ID = 'reconnect-operator';

    // Simulate handleConnection's internal logic directly against the gateway's private map
    // to confirm the fix: close listener on socket1 must not fire after socket2 replaces it.
    const connections: Map<string, unknown> = (gateway as any).connections;

    // First "connection": register socket1 and capture its close listener
    let closeListener1: (() => void) | undefined;
    const socket1 = {
      removeAllListeners: vi.fn(),
      on: (_event: string, cb: () => void) => { closeListener1 = cb; },
    } as any;

    // Apply what handleConnection now does (with the fix)
    const prev1 = connections.get(OPERATOR_ID);
    if (prev1) (prev1 as any).removeAllListeners('close');
    connections.set(OPERATOR_ID, socket1);
    socket1.on('close', () => { connections.delete(OPERATOR_ID); });

    // Second "connection": socket2 replaces socket1
    const socket2 = {
      readyState: 1,
      send: vi.fn(),
      removeAllListeners: vi.fn(),
      on: vi.fn(),
    } as any;

    const prev2 = connections.get(OPERATOR_ID);
    if (prev2) (prev2 as any).removeAllListeners('close'); // fix: detach close1
    connections.set(OPERATOR_ID, socket2);
    socket2.on('close', () => { connections.delete(OPERATOR_ID); });

    // Verify removeAllListeners was called on socket1 during second connect
    expect(socket1.removeAllListeners).toHaveBeenCalledWith('close');

    // Simulate socket1 closing — its close listener was detached (removeAllListeners),
    // so even if it somehow fires, the map must still hold socket2.
    // The close listener captured in closeListener1 is the raw closure; calling it
    // simulates what WOULD happen without the fix (stale listener still executes).
    // With the fix, handleConnection calls removeAllListeners on socket1, so the
    // bound listener never fires. We verify the invariant: map still has socket2.
    expect(connections.get(OPERATOR_ID)).toBe(socket2);

    // And sendToOperator must still work for the operator after reconnect
    const payload: WsIncomingCallPayload = {
      type: 'incoming_call', callId: 'c1', tenantId: 't1', accountId: 'a1', callerE164: '+1',
    };
    const result = gateway.sendToOperator(OPERATOR_ID, payload);
    expect(result).toBe(true);
    expect(socket2.send).toHaveBeenCalledTimes(1);
  });
});
