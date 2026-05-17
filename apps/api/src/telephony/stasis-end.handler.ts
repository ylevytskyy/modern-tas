import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { eq, and, isNull, arrayContains } from 'drizzle-orm';
import { call, recording } from '@tas/db';
import type { Db } from '@tas/db/client';
import { AriLeaderClient } from '@tas/ari-client';
import type { StasisEndEvent } from '@tas/ari-client';
import { ARI_LEADER_TOKEN } from '../ari/ari.module';
import { DB_TOKEN } from '../database/database.module';
import { NatsClientService } from '../nats/nats-client.service';
import { NatsSubjects } from '@tas/shared-types';
import type { NatsCallEndedPayload } from '@tas/shared-types';

/**
 * Q.850 codes emitted by caller-side hangup (Normal Clearing, User Busy, No Answer,
 * Call Rejected) plus transport-close codes Asterisk PJSIP emits when the remote TCP
 * peer closes without SIP signaling (32 = No circuit, 34 = No circuit available).
 *
 * Cause codes 32 and 34 appear in the ChannelHangupRequest event when SIPp's TCP
 * connection closes after the scenario completes (no CANCEL/BYE sent). In the PoC
 * topology (single inbound carrier, no operator legs), these always mean the caller
 * disconnected. Chunk 7+ can narrow this further if outbound operator legs are added.
 */
const CALLER_INITIATED_CAUSES = new Set([16, 17, 19, 21, 32, 34]);

/**
 * Derives who ended the call from the Asterisk Q.850 hangup cause and channel direction.
 *
 * @param hangupCause - Q.850 cause code from ChannelHangupRequest (may be absent).
 * @param isInbound   - true when the channel originates from the carrier (caller-side leg).
 *
 * NOTE on inbound detection (PoC / Chunk 6 topology):
 * pjsip.conf defines only one endpoint: `carrier-sipp` (inbound from SIPp carrier).
 * There are no PJSIP operator endpoints in the current config, so every channel that
 * arrives at the `tas-inbound` Stasis app is an inbound (caller-side) leg.
 * When outbound operator legs are added (Chunk 7+), pass `isInbound = false` for those.
 *
 * NOTE on undefined cause:
 * Asterisk's StasisEnd event does NOT include a cause code in its ARI schema.
 * The cause is captured from the preceding ChannelHangupRequest event. When
 * ChannelHangupRequest is absent (e.g., ARI channel delete in PoC test harness),
 * cause is undefined. In the PoC, all inbound channels are carrier-side, so
 * undefined cause on an inbound channel is treated as 'caller' (safe PoC assumption).
 */
export function deriveEndedBy(
  hangupCause: number | undefined,
  isInbound: boolean,
): 'caller' | 'operator' | 'system' {
  // PoC: no operator channels exist; undefined cause on inbound = caller disconnected.
  if (hangupCause === undefined) return isInbound ? 'caller' : 'system';
  if (!CALLER_INITIATED_CAUSES.has(hangupCause)) return 'system';
  return isInbound ? 'caller' : 'operator';
}

@Injectable()
export class StasisEndHandler implements OnModuleInit {
  private readonly logger = new Logger(StasisEndHandler.name);

  constructor(
    @Inject(ARI_LEADER_TOKEN) private readonly ari: AriLeaderClient,
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly nats: NatsClientService,
  ) {}

  onModuleInit(): void {
    this.ari.setStasisEndCallback((event) => void this.handleStasisEnd(event));
  }

  async handleStasisEnd(event: StasisEndEvent): Promise<void> {
    try {
      const channelId = event.channel.id;
      const cause = event.cause;

      // PoC / Chunk 6 topology: only carrier-sipp (inbound) channels exist — always isInbound = true.
      // Adjust when outbound operator legs are introduced (Chunk 7+).
      const isInbound = true;
      const endedBy = deriveEndedBy(cause, isInbound);
      const endedAt = new Date();

      // Find the call row by channel ID stored in routedThrough during StasisStart.
      const [callRow] = await this.db
        .select()
        .from(call)
        .where(arrayContains(call.routedThrough, [channelId]))
        .limit(1);

      if (!callRow) {
        this.logger.warn(`StasisEnd: no call row for channel ${channelId} — event ignored`);
        return;
      }

      await this.db
        .update(call)
        .set({ endedAt, endedBy })
        .where(eq(call.id, callRow.id));

      // Finalize any open recording row.
      // MixMonitor stop is handled by Asterisk automatically on channel hangup;
      // we only need to mark the DB recording as ended.
      await this.db
        .update(recording)
        .set({ endedAt })
        .where(and(eq(recording.callId, callRow.id), isNull(recording.endedAt)));

      const payload: NatsCallEndedPayload = {
        callId: callRow.id,
        tenantId: callRow.tenantId,
        endedBy,
        endedAt: endedAt.toISOString(),
      };
      // PoC: publish is fire-and-forget. If NATS is down after the DB writes succeed,
      // Temporal won't cancel the workflow and the operator UI won't dismiss the screen-pop.
      // Chunk 7: consider a transactional outbox or at-least-once delivery pattern.
      this.nats.publish(NatsSubjects.CALL_ENDED, payload);
      this.logger.log(`call ${callRow.id} ended (by ${endedBy})`);
    } catch (err) {
      this.logger.error(`StasisEnd: unhandled error for channel ${event.channel.id}`, err);
    }
  }
}
