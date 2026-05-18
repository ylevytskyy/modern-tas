import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AriCommandsService } from './ari-commands.service';
import type { AriLeaderClient, AriClientHandle } from '@tas/ari-client';

function makeHandle(): AriClientHandle & {
  channels: { record: ReturnType<typeof vi.fn> };
  recordings: {
    pause: ReturnType<typeof vi.fn>;
    unpause: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
} {
  return {
    on: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    channels: { record: vi.fn().mockResolvedValue({ name: 'recording-xyz' }) },
    recordings: {
      pause: vi.fn().mockResolvedValue(undefined),
      unpause: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeLeader(handle: AriClientHandle | null): AriLeaderClient {
  return { handleForCommands: handle } as unknown as AriLeaderClient;
}

describe('AriCommandsService', () => {
  let handle: ReturnType<typeof makeHandle>;
  let svc: AriCommandsService;

  beforeEach(() => {
    handle = makeHandle();
    svc = new AriCommandsService(makeLeader(handle));
  });

  it('startRecording invokes channels.record with the canonical name', async () => {
    await svc.startRecording('chan-1', 'call-abc');
    expect(handle.channels.record).toHaveBeenCalledWith({
      channelId: 'chan-1',
      name: 'call-abc',
      format: 'wav',
      ifExists: 'overwrite',
    });
    expect(handle.recordings.pause).not.toHaveBeenCalled();
    expect(handle.recordings.unpause).not.toHaveBeenCalled();
    expect(handle.recordings.stop).not.toHaveBeenCalled();
  });

  it('pauseRecording calls recordings.pause keyed on callId (canonical recording name)', async () => {
    await svc.pauseRecording('call-abc');
    expect(handle.recordings.pause).toHaveBeenCalledWith({ recordingName: 'call-abc' });
    expect(handle.recordings.unpause).not.toHaveBeenCalled();
    expect(handle.recordings.stop).not.toHaveBeenCalled();
  });

  it('resumeRecording calls recordings.unpause', async () => {
    await svc.resumeRecording('call-abc');
    expect(handle.recordings.unpause).toHaveBeenCalledWith({ recordingName: 'call-abc' });
    expect(handle.recordings.pause).not.toHaveBeenCalled();
    expect(handle.recordings.stop).not.toHaveBeenCalled();
  });

  it('stopRecording calls recordings.stop', async () => {
    await svc.stopRecording('call-abc');
    expect(handle.recordings.stop).toHaveBeenCalledWith({ recordingName: 'call-abc' });
    expect(handle.recordings.pause).not.toHaveBeenCalled();
    expect(handle.recordings.unpause).not.toHaveBeenCalled();
  });

  it('throws when not the leader', async () => {
    const notLeader = new AriCommandsService(makeLeader(null));
    await expect(notLeader.pauseRecording('call-abc')).rejects.toThrow(/not the ARI leader/i);
  });
});
