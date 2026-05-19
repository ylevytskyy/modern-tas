import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocketServer } from 'ws';
import { WsOperator } from './wsOperator.js';

let wss: WebSocketServer;
let port: number;
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    wss = new WebSocketServer({ port: 0 });
    wss.on('listening', () => {
      port = (wss.address() as any).port;
      resolve();
    });
  });
  wss.on('connection', (ws) => {
    // Echo the registration frame, then push a synthetic screen-pop.
    ws.once('message', () => {
      ws.send(JSON.stringify({
        event: 'call.screenpop',
        data: { type: 'incoming_call', callId: 'c1', tenantId: 't1', accountId: 'a1', callerE164: '+15551234567' },
      }));
    });
  });
});
afterAll(async () => { await new Promise<void>((r) => wss.close(() => r())); });

describe('WsOperator', () => {
  it('registers and resolves on the next screen-pop event', async () => {
    const op = new WsOperator(`ws://127.0.0.1:${port}`, 'test-jwt');
    await op.register('77777777-7777-7777-7777-777777777771');
    const ev = await op.awaitScreenPop({ timeoutMs: 1000 });
    expect(ev.callId).toBe('c1');
    expect(ev.callerE164).toBe('+15551234567');
    await op.close();
  });

  it('throws on timeout when no screen-pop arrives', async () => {
    const op = new WsOperator(`ws://127.0.0.1:${port}`, 'test-jwt');
    await op.register('77777777-7777-7777-7777-77777777777a');
    await op.awaitScreenPop({ timeoutMs: 100 }); // consume the first synthetic event
    await expect(op.awaitScreenPop({ timeoutMs: 100 }))
      .rejects.toThrow(/timeout/i);
    await op.close();
  });
});
