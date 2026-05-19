/**
 * WsOperator — Node-side WebSocket helper for e2e tests.
 *
 * Uses Node 22's built-in globalThis.WebSocket (no external ws package needed
 * on the client side). The real API gateway (ws.gateway.ts) derives operatorId
 * from the JWT `sub` claim — it does NOT read a register frame. The register()
 * method appends the JWT as a query param and sends a no-op register frame that
 * is safe to receive (the gateway silently ignores unknown frames). The frame is
 * kept for protocol clarity and because the unit-test mock WS server echoes the
 * first message to synchronise test timing.
 */

import { WsEvents } from '@tas/shared-types';

export type ScreenPopEvent = {
  callId: string;
  tenantId: string;
  accountId: string;
  callerE164: string;
};

export class WsOperator {
  private ws: WebSocket | null = null;
  /** Events received before awaitScreenPop() is called. */
  private pending: ScreenPopEvent[] = [];
  /** Resolve callback when awaitScreenPop() is waiting for the next event. */
  private waiter: ((ev: ScreenPopEvent) => void) | null = null;
  // Explicit field assignment (not constructor parameter properties) — Playwright's
  // Node strip-types loader does not support the `constructor(private readonly …)` shorthand.
  private readonly url: string;
  private readonly jwt: string;

  constructor(url: string, jwt: string) {
    this.url = url;
    this.jwt = jwt;
  }

  /**
   * Opens the WebSocket connection (JWT in query param) and sends a no-op
   * register frame so the server-side mock can synchronise timing.
   * The real API gateway identifies the operator via JWT sub, not this frame.
   */
  async register(operatorId: string): Promise<void> {
    const connectUrl = `${this.url}?token=${encodeURIComponent(this.jwt)}`;
    const ws = new globalThis.WebSocket(connectUrl);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener(
        'error',
        (e) => reject(new Error(`WS open failed: ${(e as ErrorEvent).message ?? String(e)}`)),
        { once: true },
      );
    });

    // No-op register frame — ignored by the real gateway, used by test mock.
    ws.send(JSON.stringify({ event: 'register', data: { operatorId } }));

    ws.addEventListener('message', (msg: MessageEvent) => {
      try {
        const raw = typeof msg.data === 'string' ? msg.data : (msg.data as Buffer).toString();
        const parsed = JSON.parse(raw) as { event?: string; data?: unknown };
        if (parsed.event === WsEvents.CALL_SCREEN_POP && parsed.data) {
          const ev = parsed.data as ScreenPopEvent;
          if (this.waiter) {
            const w = this.waiter;
            this.waiter = null;
            w(ev);
          } else {
            this.pending.push(ev);
          }
        }
      } catch {
        // Ignore non-JSON or unrecognised frames.
      }
    });
  }

  /**
   * Returns the next screen-pop event. If one is already buffered (arrived
   * before this call), it is returned immediately. Otherwise waits up to
   * `timeoutMs` ms before rejecting with a timeout error.
   */
  awaitScreenPop({ timeoutMs }: { timeoutMs: number }): Promise<ScreenPopEvent> {
    if (this.pending.length > 0) {
      return Promise.resolve(this.pending.shift()!);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error('awaitScreenPop timeout'));
      }, timeoutMs);
      this.waiter = (ev) => {
        clearTimeout(timer);
        resolve(ev);
      };
    });
  }

  /**
   * POSTs a decline action for the given call via the REST API.
   */
  async decline(apiBaseUrl: string, callId: string): Promise<{ status: number }> {
    const res = await fetch(`${apiBaseUrl}/v1/calls/${callId}/decline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.jwt}`,
      },
    });
    return { status: res.status };
  }

  /**
   * Closes the WebSocket connection. Safe to call multiple times.
   */
  async close(): Promise<void> {
    if (!this.ws) return;
    this.ws.close();
    this.ws = null;
  }
}
