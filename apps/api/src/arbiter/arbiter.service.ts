import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq, and, notInArray, asc } from 'drizzle-orm';
import { user, call, queueCall } from '@tas/db';
import type {
  NatsStasisStartPayload,
  NatsCallEndedPayload,
  WsIncomingCallPayload,
  WsCallExhaustedPayload,
} from '@tas/shared-types';
import { NatsSubjects } from '@tas/shared-types';
import { NatsClientService } from '../nats/nats-client.service';
import { WsGateway } from '../ws/ws.gateway';
import { DB_TOKEN } from '../database/database.module';
import type { Db } from '@tas/db/client';

@Injectable()
export class ArbiterService implements OnModuleInit {
  private readonly logger = new Logger(ArbiterService.name);

  constructor(
    @Inject(NatsClientService) private readonly nats: NatsClientService,
    @Inject(WsGateway) private readonly wsGateway: WsGateway,
    @Inject(DB_TOKEN) private readonly db: Db,
  ) {}

  private readonly latencyBuffer: Array<{ callId: string; latencyMs: number }> = [];
  private readonly LATENCY_BUFFER_MAX = 100;

  private recordLatency(callId: string, latencyMs: number): void {
    this.latencyBuffer.push({ callId, latencyMs });
    while (this.latencyBuffer.length > this.LATENCY_BUFFER_MAX) {
      this.latencyBuffer.shift();
    }
  }

  getLatenciesForCall(callId: string): number[] {
    return this.latencyBuffer.filter((s) => s.callId === callId).map((s) => s.latencyMs);
  }

  onModuleInit(): void {
    this.nats.subscribe<NatsStasisStartPayload>(
      NatsSubjects.STASIS_START,
      (payload) => void this.dispatch(payload),
    );
    this.nats.subscribe<NatsCallEndedPayload>(
      NatsSubjects.CALL_ENDED,
      (payload) => void this.dispatchCallEnded(payload),
    );
  }

  async dispatch(payload: NatsStasisStartPayload): Promise<void> {
    // SLA window per design §6: dispatch entry to WS send return; includes DB query time.
    const t0 = performance.now();
    const operatorId = await this.selectOperator(payload.callId);
    if (operatorId === null) {
      const exhausted: WsCallExhaustedPayload = {
        callId: payload.callId,
        tenantId: payload.tenantId,
      };
      this.wsGateway.sendCallExhausted(exhausted);
      return;
    }
    const wsPayload: WsIncomingCallPayload = {
      type: 'incoming_call',
      callId: payload.callId,
      tenantId: payload.tenantId,
      accountId: payload.accountId,
      callerE164: payload.fromE164,
    };
    this.wsGateway.sendToOperator(operatorId, wsPayload);
    const t1 = performance.now();
    this.recordLatency(payload.callId, t1 - t0);
  }

  async dispatchByCallId(callId: string): Promise<void> {
    const callRows = await this.db
      .select()
      .from(call)
      .where(eq(call.id, callId))
      .limit(1);
    if (callRows.length === 0) {
      this.logger.warn(`dispatchByCallId: no call row for ${callId} — returning without dispatch`);
      return;
    }
    const row = callRows[0];
    await this.dispatch({
      callId: row.id,
      channel: '',
      tenantId: row.tenantId,
      accountId: row.accountId,
      fromE164: row.fromE164,
    });
  }

  dispatchCallEnded(payload: NatsCallEndedPayload): void {
    // Broadcast to all connected operators; per-operator filtering is a later concern.
    for (const operatorId of this.wsGateway.connectedOperatorIds()) {
      this.wsGateway.sendCallEnded(operatorId, {
        callId: payload.callId,
        endedBy: payload.endedBy,
      });
    }
  }

  private async selectOperator(callId: string): Promise<string | null> {
    const queueRows = await this.db
      .select()
      .from(queueCall)
      .where(eq(queueCall.callId, callId))
      .limit(1);
    const attempted: string[] = queueRows.length === 0
      ? []
      : queueRows[0].attempts
          .map((s: string) => {
            try {
              return (JSON.parse(s) as { operatorId: string }).operatorId;
            } catch {
              return null;
            }
          })
          .filter((x: string | null): x is string => typeof x === 'string');
    const rows = await this.db
      .select({ id: user.id })
      .from(user)
      .where(
        attempted.length === 0
          ? eq(user.role, 'operator')
          : and(eq(user.role, 'operator'), notInArray(user.id, attempted)),
      )
      .orderBy(asc(user.id))
      .limit(1);
    return rows.length === 0 ? null : rows[0].id;
  }
}
