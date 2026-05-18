import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';
import { DB_TOKEN } from '../database/database.module';
import { AriCommandsService } from '../ari/ari-commands.service';
import { recording } from '@tas/db';
import type { Db } from '@tas/db/client';
import type { Client as MinioClient } from 'minio';

const MINIO_BUCKET = 'tas-recordings';
const ASTERISK_RECORDING_DIR = '/var/spool/asterisk/recording';

export interface StartRecordingParams {
  callId: string;
  channelId: string;
  tenantId: string;
}

@Injectable()
export class RecordingService {
  private readonly logger = new Logger(RecordingService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @Inject('MINIO_CLIENT') private readonly minio: MinioClient,
    private readonly ari: AriCommandsService,
  ) {}

  async startRecording(params: StartRecordingParams): Promise<void> {
    const { callId, channelId, tenantId } = params;
    const minioKey = `recordings/${callId}.wav`;

    const exists = await this.minio.bucketExists(MINIO_BUCKET);
    if (!exists) await this.minio.makeBucket(MINIO_BUCKET, 'us-east-1');

    await this.ari.startRecording(channelId, callId);

    await this.db.insert(recording).values({
      tenantId,
      callId,
      path: minioKey,
      startedAt: new Date(),
    });
  }

  async finalizeRecording(callId: string): Promise<void> {
    const [rec] = await this.db
      .select()
      .from(recording)
      .where(and(eq(recording.callId, callId), isNull(recording.endedAt)))
      .limit(1);
    if (!rec) {
      this.logger.warn(`finalizeRecording: no open recording for call ${callId}`);
      return;
    }

    try {
      await this.ari.stopRecording(callId);
    } catch (err) {
      this.logger.warn(`finalizeRecording: ari.stopRecording failed (likely already stopped): ${String(err)}`);
    }

    const localPath = nodePath.join(ASTERISK_RECORDING_DIR, `${callId}.wav`);
    let wavBytes: Buffer;
    try {
      wavBytes = await fs.readFile(localPath);
    } catch (err) {
      this.logger.error(`finalizeRecording: cannot read ${localPath}: ${String(err)}`);
      await this.db.update(recording).set({ endedAt: new Date() }).where(eq(recording.id, rec.id));
      return;
    }

    if (wavBytes.length === 0) {
      this.logger.warn(`finalizeRecording: WAV for call ${callId} is zero-byte; uploading anyway`);
    }

    try {
      await this.minio.putObject(MINIO_BUCKET, rec.path, wavBytes);
    } catch (err) {
      this.logger.error(`finalizeRecording: minio.putObject failed for call ${callId}: ${String(err)}`);
    }

    await this.db.update(recording).set({ endedAt: new Date() }).where(eq(recording.id, rec.id));
  }
}
