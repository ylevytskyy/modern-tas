import { WsEvents, type WsIncomingCallPayload } from '@tas/shared-types';

type ScreenPopHandler = (payload: WsIncomingCallPayload) => void;

export interface WsClient {
  onOpen(handler: () => void): void;
  onScreenPop(handler: ScreenPopHandler): void;
  close(): void;
}

export interface CreateWsClientDeps {
  url: string;
  token: string;
  socketImpl?: typeof WebSocket;
}

export function createWsClient(deps: CreateWsClientDeps): WsClient {
  const SocketCtor = deps.socketImpl ?? WebSocket;
  const sock = new SocketCtor(`${deps.url}?token=${encodeURIComponent(deps.token)}`);
  const handlers: ScreenPopHandler[] = [];
  const openHandlers: Array<() => void> = [];

  sock.onopen = () => openHandlers.forEach((h) => h());

  sock.onmessage = (ev: MessageEvent) => {
    let parsed: { event: string; data: unknown };
    try { parsed = JSON.parse(String(ev.data)); } catch { return; }
    if (parsed.event === WsEvents.CALL_SCREEN_POP) {
      for (const h of handlers) h(parsed.data as WsIncomingCallPayload);
    }
  };

  return {
    onOpen(h: () => void) { openHandlers.push(h); },
    onScreenPop(h: ScreenPopHandler) { handlers.push(h); },
    close() { sock.close(); },
  };
}
