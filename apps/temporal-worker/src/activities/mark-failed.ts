import { and, eq, isNull } from 'drizzle-orm';
import { dispatchAttempt } from '@tas/db';
import type { Db } from '@tas/db/client';

// Updates the dispatch_attempt row pre-seeded by MessageController.create();
// does NOT insert (an INSERT would create a second row for the same attempt).

export interface MarkFailedInput {
  messageId: string;
  channel: 'in_app' | 'email' | 'sms' | 'push' | 'voice';
  failureReason: 'caller_hung_up';
}

export function makeMarkFailed(db: Db) {
  return async function markFailed(input: MarkFailedInput): Promise<void> {
    // Update the dispatch_attempt row seeded by the api before the workflow starts.
    await db
      .update(dispatchAttempt)
      .set({ failureReason: input.failureReason })
      .where(
        and(
          eq(dispatchAttempt.messageId, input.messageId),
          eq(dispatchAttempt.channel, input.channel),
          isNull(dispatchAttempt.failureReason),
        ),
      );
  };
}
