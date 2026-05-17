import { WsEvents, type WsIncomingCallPayload, type WsCallEndedPayload } from '@tas/shared-types';

type ScreenPopHandler = (payload: WsIncomingCallPayload) => void;
type CallEndedHandler = (payload: WsCallEndedPayload) => void;

export interface WsClient {
  onOpen(handler: () => void): void;
  onScreenPop(handler: ScreenPopHandler): void;
  onCallEnded(handler: CallEndedHandler): void;
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
  const callEndedHandlers: CallEndedHandler[] = [];
  const openHandlers: Array<() => void> = [];

  sock.onopen = () => openHandlers.forEach((h) => h());

  sock.onmessage = (ev: MessageEvent) => {
    let parsed: { event: string; data: unknown };
    try { parsed = JSON.parse(String(ev.data)); } catch { return; }
    if (parsed.event === WsEvents.CALL_SCREEN_POP) {
      for (const h of handlers) h(parsed.data as WsIncomingCallPayload);
    }
    if (parsed.event === WsEvents.CALL_ENDED) {
      for (const h of callEndedHandlers) h(parsed.data as WsCallEndedPayload);
    }
  };

  return {
    onOpen(h: () => void) { openHandlers.push(h); },
    onScreenPop(h: ScreenPopHandler) { handlers.push(h); },
    onCallEnded(h: CallEndedHandler) { callEndedHandlers.push(h); },
    close() { sock.close(); },
  };
}
