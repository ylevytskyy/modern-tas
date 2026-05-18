import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CallsController } from './calls.controller';

function makeDeps() {
  const ari = {
    pauseRecording: vi.fn().mockResolvedValue(undefined),
    resumeRecording: vi.fn().mockResolvedValue(undefined),
  };
  const arbiter = {
    dispatchByCallId: vi.fn().mockResolvedValue(undefined),
    getLatenciesForCall: vi.fn().mockReturnValue([]),
  };
  const dbState: { recordings: any[]; intervals: any[] } = { recordings: [], intervals: [] };
  // selectQueueRefs lets each test stage a sequence of select results
  // (CallsController.pause does ONE select; resume does TWO).
  let selectQueue: any[][] = [];
  const stageSelect = (...batches: any[][]) => { selectQueue = batches.slice(); };
  // Track whether insert/update were called
  let insertCalled = false;
  let updateCalled = false;
  let lastUpdateSet: any = null;
  const resetCallTrackers = () => { insertCalled = false; updateCalled = false; lastUpdateSet = null; };
  const select = vi.fn().mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(selectQueue.shift() ?? []),
        for: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }),
        orderBy: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }),
      }),
    }),
  }));
  const db: any = {
    select,
    insert: () => ({ values: (v: any) => { insertCalled = true; dbState.intervals.push(v); return Promise.resolve(); } }),
    update: () => ({ set: (v: any) => ({ where: () => { updateCalled = true; lastUpdateSet = v; dbState.intervals.push({ __update: v }); return Promise.resolve(); } }) }),
    _stageSelect: stageSelect,
    _wasInsertCalled: () => insertCalled,
    _wasUpdateCalled: () => updateCalled,
    _getLastUpdateSet: () => lastUpdateSet,
    _resetCallTrackers: resetCallTrackers,
  };
  db.transaction = async (fn: any) => fn(db);
  return { ari, db, arbiter, dbState };
}

describe('CallsController', () => {
  const callId = '00000000-0000-0000-0000-000000000001';
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const operatorId = '66666666-6666-6666-6666-666666666666';
  let deps: ReturnType<typeof makeDeps>;
  let ctrl: CallsController;

  beforeEach(() => {
    deps = makeDeps();
    ctrl = new CallsController(deps.db as any, deps.ari as any, deps.arbiter as any);
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

  // C1: ARI-before-DB ordering in pause
  it('C1: POST /pause — ARI failure does NOT insert a redaction interval row', async () => {
    const startedAt = new Date(Date.now() - 5000);
    deps.db._stageSelect([{ id: 'rec-1', callId, tenantId, startedAt }]);
    // Plain Error with .code → classifyAriError maps to 503; the key invariant is no DB write.
    const networkErr = Object.assign(new Error('ARI timeout'), { code: 'ETIMEDOUT' });
    deps.ari.pauseRecording.mockRejectedValueOnce(networkErr);
    deps.db._resetCallTrackers();

    await expect(
      ctrl.pause(callId, { user: { tenantId, operatorId } } as any),
    ).rejects.toThrow();

    expect(deps.db._wasInsertCalled()).toBe(false);
  });

  // C2: ARI-before-DB ordering in resume
  it('C2: POST /resume — ARI failure does NOT update the redaction interval row', async () => {
    const startedAt = new Date(Date.now() - 5000);
    deps.db._stageSelect(
      [{ id: 'rec-1', callId, tenantId, startedAt }],
      [{ id: 'int-1', recordingId: 'rec-1', startMs: 2000, endMs: null, reason: 'operator_pci_pause' }],
    );
    // Plain Error with .code → classifyAriError maps to 503; the key invariant is no DB write.
    const networkErr = Object.assign(new Error('ARI timeout'), { code: 'ETIMEDOUT' });
    deps.ari.resumeRecording.mockRejectedValueOnce(networkErr);
    deps.db._resetCallTrackers();

    await expect(
      ctrl.resume(callId, { user: { tenantId, operatorId } } as any),
    ).rejects.toThrow();

    expect(deps.db._wasUpdateCalled()).toBe(false);
  });

  // C3: Cross-tenant access returns 404 for pause
  it('C3: POST /pause — cross-tenant operator gets 404 (recording not found under their tenant)', async () => {
    // The mock select returns empty — simulating the tenant filter excluding tenant B's recording
    const otherTenantId = '22222222-2222-2222-2222-222222222222';
    deps.db._stageSelect([]); // no recording found for this (wrong) tenant
    deps.db._resetCallTrackers();

    await expect(
      ctrl.pause(callId, { user: { tenantId: otherTenantId, operatorId } } as any),
    ).rejects.toThrow(/no open recording/i);

    expect(deps.ari.pauseRecording).not.toHaveBeenCalled();
    expect(deps.db._wasInsertCalled()).toBe(false);
  });

  // C3: Cross-tenant access returns 404 for resume
  it('C3: POST /resume — cross-tenant operator gets 404 (recording not found under their tenant)', async () => {
    const otherTenantId = '22222222-2222-2222-2222-222222222222';
    deps.db._stageSelect([]); // no recording found for this (wrong) tenant
    deps.db._resetCallTrackers();

    await expect(
      ctrl.resume(callId, { user: { tenantId: otherTenantId, operatorId } } as any),
    ).rejects.toThrow(/no open recording/i);

    expect(deps.ari.resumeRecording).not.toHaveBeenCalled();
    expect(deps.db._wasUpdateCalled()).toBe(false);
  });

  // I4: ARI error classification — pause
  it('I4: POST /pause — ARI 409 (invalid state) maps to ConflictException (409)', async () => {
    const startedAt = new Date(Date.now() - 5000);
    deps.db._stageSelect([{ id: 'rec-1', callId, tenantId, startedAt }]);
    const ariConflictErr = new Error('{"message":"Recording \'foo\' not in session"}');
    deps.ari.pauseRecording.mockRejectedValueOnce(ariConflictErr);
    deps.db._resetCallTrackers();

    const err: any = await ctrl
      .pause(callId, { user: { tenantId, operatorId } } as any)
      .catch((e: any) => e);

    expect(err?.getStatus?.()).toBe(409);
    expect(deps.db._wasInsertCalled()).toBe(false);
  });

  it('I4: POST /pause — ARI network error (ECONNREFUSED) maps to ServiceUnavailableException (503)', async () => {
    const startedAt = new Date(Date.now() - 5000);
    deps.db._stageSelect([{ id: 'rec-1', callId, tenantId, startedAt }]);
    const networkErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8088'), { code: 'ECONNREFUSED' });
    deps.ari.pauseRecording.mockRejectedValueOnce(networkErr);
    deps.db._resetCallTrackers();

    const err: any = await ctrl
      .pause(callId, { user: { tenantId, operatorId } } as any)
      .catch((e: any) => e);

    expect(err?.getStatus?.()).toBe(503);
    expect(deps.db._wasInsertCalled()).toBe(false);
  });

  it('I4: POST /pause — unrecognized ARI error propagates (becomes 500)', async () => {
    const startedAt = new Date(Date.now() - 5000);
    deps.db._stageSelect([{ id: 'rec-1', callId, tenantId, startedAt }]);
    const unknownErr = new TypeError('Unexpected token in JSON');
    deps.ari.pauseRecording.mockRejectedValueOnce(unknownErr);
    deps.db._resetCallTrackers();

    await expect(
      ctrl.pause(callId, { user: { tenantId, operatorId } } as any),
    ).rejects.toBeInstanceOf(TypeError);
    expect(deps.db._wasInsertCalled()).toBe(false);
  });

  // I4: ARI error classification — resume
  it('I4: POST /resume — ARI 409 (invalid state) maps to ConflictException (409)', async () => {
    const startedAt = new Date(Date.now() - 5000);
    deps.db._stageSelect(
      [{ id: 'rec-1', callId, tenantId, startedAt }],
      [{ id: 'int-1', recordingId: 'rec-1', startMs: 2000, endMs: null, reason: 'operator_pci_pause' }],
    );
    const ariConflictErr = new Error('{"message":"Recording is not paused"}');
    deps.ari.resumeRecording.mockRejectedValueOnce(ariConflictErr);
    deps.db._resetCallTrackers();

    const err: any = await ctrl
      .resume(callId, { user: { tenantId, operatorId } } as any)
      .catch((e: any) => e);

    expect(err?.getStatus?.()).toBe(409);
    expect(deps.db._wasUpdateCalled()).toBe(false);
  });

  it('I4: POST /resume — ARI network error (ECONNREFUSED) maps to ServiceUnavailableException (503)', async () => {
    const startedAt = new Date(Date.now() - 5000);
    deps.db._stageSelect(
      [{ id: 'rec-1', callId, tenantId, startedAt }],
      [{ id: 'int-1', recordingId: 'rec-1', startMs: 2000, endMs: null, reason: 'operator_pci_pause' }],
    );
    const networkErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8088'), { code: 'ECONNREFUSED' });
    deps.ari.resumeRecording.mockRejectedValueOnce(networkErr);
    deps.db._resetCallTrackers();

    const err: any = await ctrl
      .resume(callId, { user: { tenantId, operatorId } } as any)
      .catch((e: any) => e);

    expect(err?.getStatus?.()).toBe(503);
    expect(deps.db._wasUpdateCalled()).toBe(false);
  });

  it('I4: POST /resume — unrecognized ARI error propagates (becomes 500)', async () => {
    const startedAt = new Date(Date.now() - 5000);
    deps.db._stageSelect(
      [{ id: 'rec-1', callId, tenantId, startedAt }],
      [{ id: 'int-1', recordingId: 'rec-1', startMs: 2000, endMs: null, reason: 'operator_pci_pause' }],
    );
    const unknownErr = new TypeError('Unexpected token in JSON');
    deps.ari.resumeRecording.mockRejectedValueOnce(unknownErr);
    deps.db._resetCallTrackers();

    await expect(
      ctrl.resume(callId, { user: { tenantId, operatorId } } as any),
    ).rejects.toBeInstanceOf(TypeError);
    expect(deps.db._wasUpdateCalled()).toBe(false);
  });

  describe('POST /v1/calls/:id/decline', () => {
    it('200: appends decline entry to attempts and calls arbiter.dispatchByCallId', async () => {
      const { ari, db, arbiter } = makeDeps();
      const callId = '11111111-1111-1111-1111-111111111111';
      const operatorId = '66666666-6666-6666-6666-666666666666';
      db._stageSelect(
        [{ id: callId, tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }],
        [{ id: 'qc1', tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', callId, attempts: [] }],
      );
      const controller = new CallsController(db, ari as any, arbiter as any);
      const req: any = { user: { sub: operatorId, tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } };
      const res = await controller.decline(callId, req);
      expect(res).toEqual({ ok: true });
      expect(arbiter.dispatchByCallId).toHaveBeenCalledWith(callId);
      expect(db._wasUpdateCalled()).toBe(true);
      const updateSet = db._getLastUpdateSet();
      expect(Array.isArray(updateSet.attempts)).toBe(true);
      expect(updateSet.attempts).toHaveLength(1);
      const entry = JSON.parse(updateSet.attempts[0]);
      expect(entry).toMatchObject({
        operatorId: '66666666-6666-6666-6666-666666666666',
        outcome: 'declined',
      });
      expect(typeof entry.at).toBe('string');
      expect(() => new Date(entry.at).toISOString()).not.toThrow();
    });

    it('404: returns NotFound when callId does not exist', async () => {
      const { ari, db, arbiter } = makeDeps();
      db._stageSelect([]); // call row lookup empty
      const controller = new CallsController(db, ari as any, arbiter as any);
      const req: any = { user: { sub: '66666666-6666-6666-6666-666666666666', tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } };
      await expect(controller.decline('00000000-0000-0000-0000-000000000000', req))
        .rejects.toMatchObject({ status: 404 });
    });

    it('409: returns Conflict when attempts already contains an accepted entry', async () => {
      const { ari, db, arbiter } = makeDeps();
      const callId = '11111111-1111-1111-1111-111111111111';
      const operatorId = '66666666-6666-6666-6666-666666666666';
      db._stageSelect(
        [{ id: callId, tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }],
        [{ id: 'qc1', tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', callId,
           attempts: [JSON.stringify({ operatorId, outcome: 'accepted', at: '2026-05-18T12:00:00.000Z' })] }],
      );
      const controller = new CallsController(db, ari as any, arbiter as any);
      const req: any = { user: { sub: operatorId, tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } };
      await expect(controller.decline(callId, req)).rejects.toMatchObject({ status: 409 });
      expect(arbiter.dispatchByCallId).not.toHaveBeenCalled();
    });

    it('400: returns BadRequest when caller has already declined (double-decline guard)', async () => {
      const { ari, db, arbiter } = makeDeps();
      const callId = '11111111-1111-1111-1111-111111111111';
      const operatorId = '77777777-7777-7777-7777-777777777771';
      db._stageSelect(
        [{ id: callId, tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }],
        [{ id: 'qc1', tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', callId,
           attempts: [JSON.stringify({ operatorId, outcome: 'declined', at: '2026-05-18T12:00:00.000Z' })] }],
      );
      const controller = new CallsController(db, ari as any, arbiter as any);
      const req: any = { user: { sub: operatorId, tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } };
      await expect(controller.decline(callId, req)).rejects.toMatchObject({ status: 400 });
      expect(arbiter.dispatchByCallId).not.toHaveBeenCalled();
    });
  });
});
