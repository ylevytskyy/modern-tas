// NATS subject and WS event type stubs.
// No client wiring in Chunk 2; these are type-only placeholders.
// Chunk 3 imports these subjects — add new subjects here rather than inline in apps/api.

/** NATS subjects */
export const NatsSubjects = {
  MESSAGE_CREATED: 'ncall.message.created',
  CALL_STARTED: 'ncall.call.started',
  CALL_ENDED: 'ncall.call.ended',
  /** Published by Asterisk ARI StasisStart handler (Chunk 3). */
  STASIS_START: 'ncall.stasis.start',
  /** Published by Asterisk ARI StasisEnd handler (Chunk 3). */
  STASIS_END: 'ncall.stasis.end',
} as const;

/** WS event names (sent to F03 operator UI) */
export const WsEvents = {
  CALL_SCREEN_POP: 'call.screenpop',
  MESSAGE_SENT: 'message.sent',
} as const;

export interface NatsMessageCreatedPayload {
  messageId: string;
  callId: string;
  accountId: string;
  tenantId: string;
}

/**
 * Payload published to NatsSubjects.STASIS_START when an ARI StasisStart event fires.
 * Spec: docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md lines 107, 113–114.
 * Chunk 3 publishes this; Chunk 5 asserts against it.
 */
export interface NatsStasisStartPayload {
  callId: string;
  /** ARI channel ID (used by Chunk 3 to control the channel). */
  channel: string;
  tenantId: string;
  accountId: string;
}
