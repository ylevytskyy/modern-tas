import { describe, it, expect, vi } from 'vitest';
import { TemporalClientService } from './temporal-client.service';

describe('TemporalClientService', () => {
  it('delegates workflow.start to the injected client', async () => {
    const start = vi.fn().mockResolvedValue({ workflowId: 'wf-1' });
    const fakeClient = { workflow: { start } } as any;
    const svc = new TemporalClientService(fakeClient);
    const handle = await svc.start('DispatchMessage', {
      workflowId: 'wf-1',
      taskQueue: 'dispatch-message',
      args: [{ messageId: 'm-1' }],
    });
    expect(start).toHaveBeenCalledOnce();
    expect(handle.workflowId).toBe('wf-1');
  });
});
