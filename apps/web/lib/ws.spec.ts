import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsEvents, type WsIncomingCallPayload } from '@tas/shared-types';
import { createWsClient, type WsClient } from './ws';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(); }
}

describe('createWsClient', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });

  it('routes call.screenpop events to the screen-pop handler', () => {
    const client: WsClient = createWsClient({
      url: 'ws://api.test/ws',
      token: 'tok',
      socketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    const handler = vi.fn();
    client.onScreenPop(handler);

    const sock = FakeSocket.instances[0];
    expect(sock.url).toBe('ws://api.test/ws?token=tok');

    const payload: WsIncomingCallPayload = {
      type: 'incoming_call',
      callId: 'c-1',
      tenantId: 't-1',
      accountId: 'a-1',
      callerE164: '+15555550100',
    };
    sock.onmessage?.({ data: JSON.stringify({ event: WsEvents.CALL_SCREEN_POP, data: payload }) });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('ignores unknown events', () => {
    const client = createWsClient({
      url: 'ws://api.test/ws', token: 'tok',
      socketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    const handler = vi.fn();
    client.onScreenPop(handler);
    const sock = FakeSocket.instances[0];
    sock.onmessage?.({ data: JSON.stringify({ event: 'unknown.event', data: {} }) });
    expect(handler).not.toHaveBeenCalled();
  });

  it('silently drops malformed JSON', () => {
    const client = createWsClient({
      url: 'ws://api.test/ws', token: 'tok',
      socketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    const handler = vi.fn();
    client.onScreenPop(handler);
    const sock = FakeSocket.instances[0];
    expect(() => sock.onmessage?.({ data: 'not-json' })).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
