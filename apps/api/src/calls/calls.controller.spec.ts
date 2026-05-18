import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CallsController } from './calls.controller';

function makeDeps() {
  const ari = {
    pauseRecording: vi.fn().mockResolvedValue(undefined),
    resumeRecording: vi.fn().mockResolvedValue(undefined),
  };
  const dbState: { recordings: any[]; intervals: any[] } = { recordings: [], intervals: [] };
  // selectQueueRefs lets each test stage a sequence of select results
  // (CallsController.pause does ONE select; resume does TWO).
  let selectQueue: any[][] = [];
  const stageSelect = (...batches: any[][]) => { selectQueue = batches.slice(); };
  const select = vi.fn().mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(selectQueue.shift() ?? []),
        orderBy: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }),
      }),
    }),
  }));
  const db: any = {
    select,
    insert: () => ({ values: (v: any) => { dbState.intervals.push(v); return Promise.resolve(); } }),
    update: () => ({ set: (v: any) => ({ where: () => { dbState.intervals.push({ __update: v }); return Promise.resolve(); } }) }),
    _stageSelect: stageSelect,
  };
  return { ari, db, dbState };
}

describe('CallsController', () => {
  const callId = '00000000-0000-0000-0000-000000000001';
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const operatorId = '66666666-6666-6666-6666-666666666666';
  let deps: ReturnType<typeof makeDeps>;
  let ctrl: CallsController;

  beforeEach(() => {
    deps = makeDeps();
    ctrl = new CallsController(deps.db as any, deps.ari as any);
  });

  it('POST /pause inserts a redaction-interval row (end_ms NULL) and calls ari.pauseRecording', async () => {
    const startedAt = new Date(Date.now() - 5000);
    deps.db._stageSelect([{ id: 'rec-1', callId, tenantId, startedAt }]);

    const result = await ctrl.pause(callId, { user: { tenantId, operatorId } } as any);

    expect(deps.ari.pauseRecording).toHaveBeenCalledWith(callId);
    const inserted = deps.dbState.intervals.filter((r) => !('__update' in r));
    expect(inserted).toHaveLength(1);
    expect(inserted[0].recordingId).toBe('rec-1');
    expect(inserted[0].startMs).toBeGreaterThan(0);
    expect(inserted[0].endMs).toBeUndefined();
    expect(inserted[0].reason).toBe('operator_pci_pause');
    expect(result).toEqual({ ok: true });
  });

  it('POST /pause throws 404 when no open recording exists', async () => {
    deps.db._stageSelect([]);
    await expect(
      ctrl.pause(callId, { user: { tenantId, operatorId } } as any),
    ).rejects.toThrow(/no open recording/i);
    expect(deps.ari.pauseRecording).not.toHaveBeenCalled();
  });

  it('POST /resume updates the open redaction interval end_ms and calls ari.resumeRecording', async () => {
    const startedAt = new Date(Date.now() - 5000);
    deps.db._stageSelect(
      [{ id: 'rec-1', callId, tenantId, startedAt }],
      [{ id: 'int-1', recordingId: 'rec-1', startMs: 2000, endMs: null, reason: 'operator_pci_pause' }],
    );

    const result = await ctrl.resume(callId, { user: { tenantId, operatorId } } as any);

    expect(deps.ari.resumeRecording).toHaveBeenCalledWith(callId);
    const updates = deps.dbState.intervals.filter((r) => '__update' in r);
    expect(updates).toHaveLength(1);
    expect(updates[0].__update.endMs).toBeGreaterThan(2000);
    expect(result).toEqual({ ok: true });
  });

  it('POST /resume throws 404 when no open recording exists', async () => {
    deps.db._stageSelect([]);
    await expect(
      ctrl.resume(callId, { user: { tenantId, operatorId } } as any),
    ).rejects.toThrow(/no open recording/i);
    expect(deps.ari.resumeRecording).not.toHaveBeenCalled();
  });

  it('POST /resume throws 404 when no open redaction interval exists', async () => {
    const startedAt = new Date(Date.now() - 5000);
    deps.db._stageSelect(
      [{ id: 'rec-1', callId, tenantId, startedAt }],
      [], // no open interval
    );
    await expect(
      ctrl.resume(callId, { user: { tenantId, operatorId } } as any),
    ).rejects.toThrow(/no open redaction interval/i);
    expect(deps.ari.resumeRecording).not.toHaveBeenCalled();
  });
});
