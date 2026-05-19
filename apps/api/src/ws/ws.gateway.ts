import { Injectable } from '@nestjs/common';
import * as jsonwebtoken from 'jsonwebtoken';
import type { WebSocket } from 'ws';
import { WsEvents } from '@tas/shared-types';
import type { WsIncomingCallPayload, WsCallEndedPayload, WsCallExhaustedPayload } from '@tas/shared-types';

@Injectable()
export class WsGateway {
  private readonly connections = new Map<string, WebSocket>();

  handleConnection(ws: WebSocket, token: string): void {
    const secret = process.env.APP_JWT_SECRET ?? 'poc-only-not-prod';
    try {
      const payload = jsonwebtoken.verify(token, secret) as {
        sub: string; tenantId: string; role: string;
      };
      const operatorId = payload.sub;
      const prev = this.connections.get(operatorId);
      if (prev) prev.removeAllListeners('close');
      this.connections.set(operatorId, ws);
      ws.on('close', () => { this.connections.delete(operatorId); });
    } catch {
      ws.close(4001, 'Unauthorized');
    }
  }

  registerConnection(operatorId: string, ws: WebSocket): void {
    this.connections.set(operatorId, ws);
  }

  sendToOperator(operatorId: string, payload: WsIncomingCallPayload): boolean {
    const ws = this.connections.get(operatorId);
    if (!ws || ws.readyState !== 1 /* OPEN */) return false;
    ws.send(JSON.stringify({ event: WsEvents.CALL_SCREEN_POP, data: payload }));
    return true;
  }

  sendCallEnded(operatorId: string, payload: WsCallEndedPayload): boolean {
    const ws = this.connections.get(operatorId);
    if (!ws || ws.readyState !== 1 /* OPEN */) return false;
    ws.send(JSON.stringify({ event: WsEvents.CALL_ENDED, data: payload }));
    return true;
  }

  sendCallExhausted(payload: WsCallExhaustedPayload): void {
    for (const ws of this.connections.values()) {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify({ event: WsEvents.CALL_EXHAUSTED, data: payload }));
      }
    }
  }

  connectedOperatorIds(): string[] {
    return Array.from(this.connections.keys());
  }
}
