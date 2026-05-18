// NATS subject and WS event type stubs.
// No client wiring in Chunk 2; these are type-only placeholders.
// Chunk 3 imports these subjects — add new subjects here rather than inline in apps/api.

/** NATS subjects */
export const NatsSubjects = {
  MESSAGE_CREATED: 'tas.message.created',
  CALL_STARTED: 'tas.call.started',
  CALL_ENDED: 'tas.call.ended',
  /** Published by Asterisk ARI StasisStart handler (Chunk 3). */
  STASIS_START: 'tas.stasis.start',
  /** Published by Asterisk ARI StasisEnd handler (Chunk 3). */
  STASIS_END: 'tas.stasis.end',
} as const;

/** WS event names (sent to F03 operator UI) */
export const WsEvents = {
  CALL_SCREEN_POP: 'call.screenpop',
  CALL_ENDED: 'call.ended',
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
  /** Caller E.164 (Chunk 6 S-4 HC#4 — closes the `callerE164:''` hardcode). */
  fromE164: string;
}

/**
 * Payload published to NatsSubjects.CALL_ENDED when an ARI StasisEnd event fires.
 * Consumed by Temporal worker (cancels in-flight DispatchMessage workflows) and
 * WS gateway (pushes call.ended to operator browser).
 */
export interface NatsCallEndedPayload {
  callId: string;
  tenantId: string;
  endedBy: 'caller' | 'operator' | 'system';
  endedAt: string;
}

/** WS payload shape for the `call.ended` event (sent to F03 operator UI). */
export interface WsCallEndedPayload {
  callId: string;
  endedBy: 'caller' | 'operator' | 'system';
}

/** WS payload shape for the `call.screenpop` event (sent to F03 operator UI). */
export interface WsIncomingCallPayload {
  /** Discriminator field. Spec exit criterion: event.type === 'incoming_call'. */
  type: 'incoming_call';
  callId: string;
  tenantId: string;
  accountId: string;
  callerE164: string;
}
