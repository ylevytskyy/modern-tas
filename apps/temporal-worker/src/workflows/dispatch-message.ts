import { proxyActivities } from '@temporalio/workflow';

export interface DispatchMessageInput {
  messageId: string;
  operatorId: string;
  tenantId: string;
  payload: unknown;
}

const { deliverViaWs, markDelivered } = proxyActivities<{
  deliverViaWs(input: {
    messageId: string;
    operatorId: string;
    payload: unknown;
  }): Promise<{ delivered: boolean }>;
  markDelivered(input: { messageId: string }): Promise<void>;
}>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

export async function dispatchMessage(input: DispatchMessageInput): Promise<void> {
  await deliverViaWs({
    messageId: input.messageId,
    operatorId: input.operatorId,
    payload: input.payload,
  });
  await markDelivered({ messageId: input.messageId });
}
