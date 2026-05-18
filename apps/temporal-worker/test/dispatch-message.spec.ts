import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { CancelledFailure } from '@temporalio/common';
import { DispatchMessage, callEndedSignal } from '../src/workflows/dispatch-message';
import { resolve } from 'node:path';

describe('DispatchMessage workflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  it('calls deliverViaWs then markDelivered with the message id and returns {delivered:true}', async () => {
    const calls: string[] = [];
    const activities = {
      deliverViaWs: async (input: { messageId: string; operatorId: string; payload: unknown }) => {
        calls.push(`deliverViaWs:${input.messageId}`);
        return { delivered: true };
      },
      markDelivered: async (input: { messageId: string }) => {
        calls.push(`markDelivered:${input.messageId}`);
      },
      markFailed: async () => {
        calls.push('markFailed');
      },
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: 'test',
      workflowsPath: resolve(__dirname, '../src/workflows/dispatch-message.ts'),
      activities,
    });

    const handle = await env.client.workflow.start(DispatchMessage, {
      taskQueue: 'test',
      workflowId: `wf-test-${Date.now()}`,
      args: [{
        messageId: 'm-1',
        operatorId: 'op-1',
        tenantId: 't-1',
        callId: 'c-1',
        payload: { callId: 'c-1', body: 'hello' },
      }],
    });

    const result = await worker.runUntil(handle.result());

    expect(result).toEqual({ delivered: true });
    expect(calls).toEqual(['deliverViaWs:m-1', 'markDelivered:m-1']);
  });

  it('returns {delivered:false, reason:"caller_hung_up"} when callEnded signal fires before delivery completes', async () => {
    // Track which activities ran.
    const calls: string[] = [];

    // A latch to coordinate signal timing:
    // deliverViaWs will set deliveryGate.ready = true once it starts,
    // and the outer test loop will call handle.signal once it sees that.
    // We use an isCancelled flag injected via closure to let the activity
    // exit early (simulating activity-level cancellation responsiveness).
    let signalSent = false;

    const activities = {
      // Busy-polls until signal is sent, then throws CancelledFailure.
      // isCancellation(err) in the workflow returns true for CancelledFailure,
      // so the cancellation path completes cleanly without re-throwing.
      deliverViaWs: async () => {
        calls.push('deliverViaWs:start');
        // Yield repeatedly until the test sends the signal.
        for (let i = 0; i < 200; i++) {
          await new Promise((r) => setTimeout(r, 50));
          if (signalSent) {
            calls.push('deliverViaWs:saw-signal');
            // Throw CancelledFailure so isCancellation() in the workflow returns true,
            // preventing the rethrow at line 74 of dispatch-message.ts.
            throw new CancelledFailure('simulated cancellation');
          }
        }
        return { delivered: true };
      },
      markDelivered: async () => {
        calls.push('markDelivered');
      },
      markFailed: async (input: { messageId: string; channel: string; failureReason: string }) => {
        calls.push(`markFailed:${input.failureReason}`);
      },
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: 'test-cancel',
      workflowsPath: resolve(__dirname, '../src/workflows/dispatch-message.ts'),
      activities,
    });

    const wfId = `wf-cancel-${Date.now()}`;
    const handle = await env.client.workflow.start(DispatchMessage, {
      taskQueue: 'test-cancel',
      workflowId: wfId,
      args: [{
        messageId: 'm-cancel',
        operatorId: 'op-1',
        tenantId: 't-1',
        callId: 'c-cancel',
        payload: { callId: 'c-cancel', body: 'hello' },
      }],
    });

    // Start the worker running, then — concurrently — wait briefly and send the signal.
    // worker.runUntil resolves once handle.result() resolves.
    const signalTask = (async () => {
      // Give the activity time to start its busy loop.
      await new Promise((r) => setTimeout(r, 200));
      await handle.signal(callEndedSignal);  // signal first → workflow's scope.cancel() fires
      signalSent = true;                      // only then permit the activity to throw
    })();

    const result = await worker.runUntil(
      Promise.all([handle.result(), signalTask]).then(([r]) => r),
    );

    expect(result).toEqual({ delivered: false, reason: 'caller_hung_up' });
    expect(calls).not.toContain('markDelivered');
    expect(calls.some((c) => c.startsWith('markFailed:'))).toBe(true);
  });
}, 120_000);
