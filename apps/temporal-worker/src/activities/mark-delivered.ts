import { and, eq, isNull } from 'drizzle-orm';
import { dispatchAttempt } from '@tas/db';
import type { Db } from '@tas/db/client';

export interface MarkDeliveredInput {
  messageId: string;
}

export function makeMarkDelivered(db: Db) {
  return async function markDelivered(input: MarkDeliveredInput): Promise<void> {
    await db
      .update(dispatchAttempt)
      .set({ deliveredAt: new Date() })
      .where(and(
        eq(dispatchAttempt.messageId, input.messageId),
        isNull(dispatchAttempt.deliveredAt),
      ));
  };
}
