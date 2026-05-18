import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecordingService } from './recording.service';
import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';

vi.mock('node:fs', () => ({
  promises: { readFile: vi.fn() },
}));

function makeDeps() {
  const minio = {
    bucketExists: vi.fn().mockResolvedValue(true),
    makeBucket: vi.fn().mockResolvedValue(undefined),
    putObject: vi.fn().mockResolvedValue({ etag: 'etag-1' }),
  };
  const ari = {
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn().mockResolvedValue(undefined),
    pauseRecording: vi.fn().mockResolvedValue(undefined),
    resumeRecording: vi.fn().mockResolvedValue(undefined),
  };
  const dbState: { rows: any[]; updates: any[]; inserts: any[] } = { rows: [], updates: [], inserts: [] };
  const db: any = {
    insert: () => ({
      values: (v: any) => { dbState.inserts.push(v); return Promise.resolve(); },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(dbState.rows),
        }),
      }),
    }),
    update: () => ({
      set: (v: any) => ({
        where: () => { dbState.updates.push(v); return Promise.resolve(); },
      }),
    }),
  };
  return { minio, ari, db, dbState };
}

describe('RecordingService.finalizeRecording', () => {
  const callId = 'call-abc';
  let deps: ReturnType<typeof makeDeps>;
  let svc: RecordingService;

  beforeEach(() => {
    deps = makeDeps();
    svc = new RecordingService(deps.db as any, deps.minio as any, deps.ari as any);
    vi.mocked(fs.readFile).mockReset();
  });

  it('reads the WAV from the shared volume and uploads to MinIO', async () => {
    deps.dbState.rows.push({ id: 'rec-1', path: `recordings/${callId}.wav`, callId, tenantId: 't' });
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('RIFF....WAVE'));

    await svc.finalizeRecording(callId);

    expect(deps.ari.stopRecording).toHaveBeenCalledWith(callId);
    expect(fs.readFile).toHaveBeenCalledWith(`/var/spool/asterisk/recording/${callId}.wav`);
    expect(deps.minio.putObject).toHaveBeenCalledWith('tas-recordings', `recordings/${callId}.wav`, Buffer.from('RIFF....WAVE'));
    expect(deps.dbState.updates).toHaveLength(1);
    expect(deps.dbState.updates[0].endedAt).toBeInstanceOf(Date);
  });

  it('no-ops when the recording row is missing', async () => {
    await svc.finalizeRecording(callId);
    expect(deps.ari.stopRecording).not.toHaveBeenCalled();
    expect(deps.minio.putObject).not.toHaveBeenCalled();
  });

  it('still marks recording.endedAt when file read fails', async () => {
    deps.dbState.rows.push({ id: 'rec-1', path: `recordings/${callId}.wav`, callId, tenantId: 't' });
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

    await svc.finalizeRecording(callId);

    expect(deps.minio.putObject).not.toHaveBeenCalled();
    expect(deps.dbState.updates).toHaveLength(1);
  });

  it('still marks recording.endedAt and does not propagate when minio.putObject throws', async () => {
    deps.dbState.rows.push({ id: 'rec-1', path: `recordings/${callId}.wav`, callId, tenantId: 't' });
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('RIFF....WAVE'));
    deps.minio.putObject.mockRejectedValue(new Error('MinIO unreachable'));

    // Should not throw
    await expect(svc.finalizeRecording(callId)).resolves.toBeUndefined();

    // endedAt must still be committed
    expect(deps.dbState.updates).toHaveLength(1);
    expect(deps.dbState.updates[0].endedAt).toBeInstanceOf(Date);
  });
});
