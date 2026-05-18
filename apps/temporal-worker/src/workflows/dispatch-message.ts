import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
  CancellationScope,
  isCancellation,
} from '@temporalio/workflow';

export interface DispatchMessageInput {
  messageId: string;
  operatorId: string;
  tenantId: string;
  callId: string; // Carried for observability (visible in Temporal workflow input); routing happens via DB lookup in worker NATS subscriber.
  payload: unknown;
}

export type DispatchMessageResult =
  | { delivered: true }
  | { delivered: false; reason: 'caller_hung_up' };

const { deliverViaWs, markDelivered, markFailed } = proxyActivities<{
  deliverViaWs(input: {
    messageId: string;
    operatorId: string;
    payload: unknown;
  }): Promise<{ delivered: boolean }>;
  markDelivered(input: { messageId: string }): Promise<void>;
  markFailed(input: {
    messageId: string;
    channel: 'in_app' | 'email' | 'sms' | 'push' | 'voice';
    failureReason: 'caller_hung_up';
  }): Promise<void>;
}>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

/** Signal fired when the caller hangs up mid-delivery. */
export const callEndedSignal = defineSignal('callEnded');

export async function DispatchMessage(input: DispatchMessageInput): Promise<DispatchMessageResult> {
  let cancelled = false;
  setHandler(callEndedSignal, () => {
    cancelled = true;
  });

  // Wrap the delivery sequence in a CancellationScope so we can abort in-flight
  // activities when the callEnded signal fires (Promise.race alone does not cancel
  // already-started Temporal activities — they'd run as orphans).
  const scope = new CancellationScope();
  const delivery = scope.run(async () => {
    await deliverViaWs({
      messageId: input.messageId,
      operatorId: input.operatorId,
      payload: input.payload,
    });
    await markDelivered({ messageId: input.messageId });
    return { delivered: true } as const;
  });

  // Resolves to 'cancelled' as soon as the cancelled flag is set by the signal handler.
  const cancellationGuard = condition(() => cancelled).then(() => 'cancelled' as const);

  const winner = await Promise.race([delivery, cancellationGuard]);

  if (winner === 'cancelled') {
    // Cancel any in-flight activity in the delivery scope.
    scope.cancel();
    // Wait for the scope to settle (catches CancelledFailure; re-throws anything else).
    try {
      await delivery;
    } catch (err) {
      if (!isCancellation(err)) throw err;
    }
    await markFailed({
      messageId: input.messageId,
      channel: 'in_app',
      failureReason: 'caller_hung_up',
    });
    return { delivered: false, reason: 'caller_hung_up' };
  }

  return winner;
}
