import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB_TOKEN } from '../database/database.module';
import { ARI_LEADER_TOKEN } from '../ari/ari.module';
import { NatsClientService } from '../nats/nats-client.service';
import { RecordingService } from '../recording/recording.service';
import { did, account, call, queueCall } from '@tas/db';
import { NatsSubjects } from '@tas/shared-types';
import type { NatsStasisStartPayload } from '@tas/shared-types';
import type { Db } from '@tas/db/client';
import type { AriLeaderClient, StasisStartEvent } from '@tas/ari-client';

// Seeded queue ID — single-queue strategy for PoC (Chunk 6 adds dynamic routing)
const SEEDED_QUEUE_ID = '77777777-7777-7777-7777-777777777777';

@Injectable()
export class StasisStartHandler implements OnModuleInit {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @Inject(ARI_LEADER_TOKEN) private readonly ariLeader: AriLeaderClient,
    @Inject(NatsClientService) private readonly nats: NatsClientService,
    @Inject(RecordingService) private readonly recordingService: RecordingService,
  ) {}

  onModuleInit(): void {
    this.ariLeader.setStasisStartCallback((event) => void this.handleStasisStart(event));
    this.ariLeader.start();
  }

  async handleStasisStart(event: StasisStartEvent): Promise<void> {
    const calledE164 = event.channel.dialplan.exten;
    const callerE164 = event.channel.caller.number;
    const channelId = event.channel.id;

    // D16: two sequential queries — DID fetch (id + accountId), then account fetch (tenantId).
    // Avoids original double-DID-query defect while remaining simple and readable at single-row scale.
    const [didRow] = await this.db
      .select({
        id: did.id,
        accountId: did.accountId,
      })
      .from(did)
      .where(eq(did.e164, calledE164))
      .limit(1);

    if (!didRow) {
      console.error(`StasisStartHandler: no DID found for ${calledE164} — ignoring event`);
      return;
    }

    const [accountRow] = await this.db
      .select({ tenantId: account.tenantId })
      .from(account)
      .where(eq(account.id, didRow.accountId))
      .limit(1);

    if (!accountRow) {
      console.error(`StasisStartHandler: no account found for ${didRow.accountId} — ignoring event`);
      return;
    }

    const tenantId = accountRow.tenantId;
    const accountId = didRow.accountId;
    const didId = didRow.id;

    const [callRow] = await this.db
      .insert(call)
      .values({
        tenantId,
        accountId,
        didId,
        fromE164: callerE164,
        startedAt: new Date(),
        routedThrough: [channelId],
      })
      .returning({ id: call.id });

    const callId = callRow.id;

    await this.db.insert(queueCall).values({
      tenantId,
      queueId: SEEDED_QUEUE_ID,
      callId,
      enqueuedAt: new Date(),
    });

    await this.recordingService.startRecording({ callId, channelId, tenantId });

    const payload: NatsStasisStartPayload = {
      callId,
      channel: channelId,
      tenantId,
      accountId,
    };
    this.nats.publish(NatsSubjects.STASIS_START, payload);
  }
}
