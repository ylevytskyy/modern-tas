import { Inject, Injectable } from '@nestjs/common';
import type { AriLeaderClient, AriClientHandle } from '@tas/ari-client';
import { ARI_LEADER_TOKEN } from './ari.module';

@Injectable()
export class AriCommandsService {
  constructor(@Inject(ARI_LEADER_TOKEN) private readonly leader: AriLeaderClient) {}

  private handle(): AriClientHandle {
    const h = this.leader.handleForCommands;
    if (!h) throw new Error('AriCommandsService: this instance is not the ARI leader');
    return h;
  }

  async startRecording(channelId: string, callId: string): Promise<void> {
    await this.handle().channels!.record({
      channelId,
      name: callId,
      format: 'wav',
      ifExists: 'overwrite',
    });
  }

  async pauseRecording(callId: string): Promise<void> {
    await this.handle().recordings!.pause({ recordingName: callId });
  }

  async resumeRecording(callId: string): Promise<void> {
    await this.handle().recordings!.unpause({ recordingName: callId });
  }

  async stopRecording(callId: string): Promise<void> {
    await this.handle().recordings!.stop({ recordingName: callId });
  }
}
