import { Injectable } from '@nestjs/common';
import * as jsonwebtoken from 'jsonwebtoken';
import type { WebSocket } from 'ws';
import { WsEvents } from '@tas/shared-types';
import type { WsIncomingCallPayload } from '@tas/shared-types';

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
      this.connections.set(operatorId, ws);
      ws.on('close', () => { this.connections.delete(operatorId); });
    } catch {
      ws.close(4001, 'Unauthorized');
    }
  }

  registerConnection(operatorId: string, ws: WebSocket): void {
    this.connections.set(operatorId, ws);
  }

  sendToOperator(operatorId: string, payload: WsIncomingCallPayload): void {
    const ws = this.connections.get(operatorId);
    if (!ws || ws.readyState !== 1 /* OPEN */) return;
    ws.send(JSON.stringify({ event: WsEvents.CALL_SCREEN_POP, data: payload }));
  }
}
