import {
  Controller, Post, Param, Req, UseGuards, Inject, NotFoundException, HttpCode,
} from '@nestjs/common';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { DB_TOKEN } from '../database/database.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AriCommandsService } from '../ari/ari-commands.service';
import { recording, recordingRedactionInterval } from '@tas/db';
import type { Db } from '@tas/db/client';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user.interface';

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly ari: AriCommandsService,
  ) {}

  @Post(':id/pause')
  @HttpCode(200)
  async pause(
    @Param('id') callId: string,
    @Req() _req: Request & { user: RequestUser },
  ): Promise<{ ok: true }> {
    const [rec] = await this.db
      .select()
      .from(recording)
      .where(and(eq(recording.callId, callId), isNull(recording.endedAt)))
      .limit(1);
    if (!rec) throw new NotFoundException('no open recording for call');

    const startMs = Date.now() - new Date(rec.startedAt).getTime();

    await this.db.insert(recordingRedactionInterval).values({
      recordingId: rec.id,
      startMs,
      reason: 'operator_pci_pause',
    });

    await this.ari.pauseRecording(callId);
    return { ok: true };
  }

  @Post(':id/resume')
  @HttpCode(200)
  async resume(
    @Param('id') callId: string,
    @Req() _req: Request & { user: RequestUser },
  ): Promise<{ ok: true }> {
    const [rec] = await this.db
      .select()
      .from(recording)
      .where(and(eq(recording.callId, callId), isNull(recording.endedAt)))
      .limit(1);
    if (!rec) throw new NotFoundException('no open recording for call');

    const [open] = await this.db
      .select()
      .from(recordingRedactionInterval)
      .where(and(eq(recordingRedactionInterval.recordingId, rec.id), isNull(recordingRedactionInterval.endMs)))
      .orderBy(desc(recordingRedactionInterval.startMs))
      .limit(1);
    if (!open) throw new NotFoundException('no open redaction interval to close');

    const endMs = Date.now() - new Date(rec.startedAt).getTime();
    await this.db
      .update(recordingRedactionInterval)
      .set({ endMs })
      .where(eq(recordingRedactionInterval.id, open.id));

    await this.ari.resumeRecording(callId);
    return { ok: true };
  }
}
