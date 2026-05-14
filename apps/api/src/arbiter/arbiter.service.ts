import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { NatsClientService } from '../nats/nats-client.service';
import { WsGateway } from '../ws/ws.gateway';
import { NatsSubjects } from '@ncall/shared-types';
import type { NatsStasisStartPayload, WsIncomingCallPayload } from '@ncall/shared-types';

/** Single seeded operator for Chunk 3 PoC. Chunk 6 replaces with FIFO heap + skill matching. */
const SEEDED_OPERATOR_ID = '66666666-6666-6666-6666-666666666666';

@Injectable()
export class ArbiterService implements OnModuleInit {
  constructor(
    @Inject(NatsClientService) private readonly nats: NatsClientService,
    @Inject(WsGateway) private readonly wsGateway: WsGateway,
  ) {}

  onModuleInit(): void {
    this.nats.subscribe<NatsStasisStartPayload>(
      NatsSubjects.STASIS_START,
      (payload) => void this.dispatch(payload),
    );
  }

  async dispatch(payload: NatsStasisStartPayload): Promise<void> {
    const wsPayload: WsIncomingCallPayload = {
      type: 'incoming_call',
      callId: payload.callId,
      tenantId: payload.tenantId,
      callerE164: '', // TODO Chunk 6: populate from call row
    };
    this.wsGateway.sendToOperator(SEEDED_OPERATOR_ID, wsPayload);
  }
}
