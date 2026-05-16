import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { dispatchMessage } from '../src/workflows/dispatch-message';
import { resolve } from 'node:path';

describe('DispatchMessage workflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  it('calls deliverViaWs then markDelivered with the message id', async () => {
    const calls: string[] = [];
    const activities = {
      deliverViaWs: async (input: { messageId: string; operatorId: string; payload: unknown }) => {
        calls.push(`deliverViaWs:${input.messageId}`);
        return { delivered: true };
      },
      markDelivered: async (input: { messageId: string }) => {
        calls.push(`markDelivered:${input.messageId}`);
      },
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: 'test',
      workflowsPath: resolve(__dirname, '../src/workflows/dispatch-message.ts'),
      activities,
    });

    const handle = await env.client.workflow.start(dispatchMessage, {
      taskQueue: 'test',
      workflowId: 'wf-test-1',
      args: [{
        messageId: 'm-1',
        operatorId: 'op-1',
        tenantId: 't-1',
        payload: { callId: 'c-1', body: 'hello' },
      }],
    });

    await worker.runUntil(handle.result());

    expect(calls).toEqual(['deliverViaWs:m-1', 'markDelivered:m-1']);
  });
});
