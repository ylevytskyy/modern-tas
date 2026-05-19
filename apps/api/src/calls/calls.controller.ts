import {
  Controller, Post, Param, Req, UseGuards, Inject, NotFoundException, HttpCode,
  ConflictException, ServiceUnavailableException, BadRequestException,
} from '@nestjs/common';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { DB_TOKEN } from '../database/database.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AriCommandsService } from '../ari/ari-commands.service';
import { ArbiterService } from '../arbiter/arbiter.service';
import { recording, recordingRedactionInterval, call, queueCall } from '@tas/db';
import type { Db } from '@tas/db/client';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user.interface';

/**
 * Classify errors thrown by AriCommandsService into NestJS HTTP exceptions.
 *
 * ari-client@2.2.0 error shapes:
 *   - Network unreachable (ECONNREFUSED, ECONNRESET, ETIMEDOUT, ENOTFOUND):
 *     Node.js Error with a truthy `.code` string → 503 ServiceUnavailable
 *   - ARI HTTP error response (4xx from Asterisk, e.g. recording in invalid
 *     state / conflict): ari-client's swaggerError converts the response body
 *     to `new Error(body_text)` with no `.code` → 409 Conflict
 *   - Anything else (e.g. our own bugs): rethrown unchanged → NestJS produces 500
 */
function classifyAriError(e: unknown): never {
  if (e instanceof Error && typeof (e as any).code === 'string') {
    // Node.js network error (ECONNREFUSED, ECONNRESET, ETIMEDOUT, ENOTFOUND)
    throw new ServiceUnavailableException('ARI temporarily unreachable');
  }
  if (e instanceof Error && e.name === 'Error') {
    // Plain Error (not a subclass) with no .code — ari-client wraps Asterisk
    // HTTP 4xx responses as `new Error(responseBody)`, losing the status code.
    // Treat as recording-state conflict (409).
    throw new ConflictException('Recording is in an invalid state for this operation');
  }
  // TypeError, RangeError, or other subclasses are our own bugs — rethrow unchanged
  // so NestJS produces 500 with the original stack trace.
  throw e;
}

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly ari: AriCommandsService,
    private readonly arbiter: ArbiterService,
  ) {}

  @Post(':id/pause')
  @HttpCode(200)
  async pause(
    @Param('id') callId: string,
    @Req() req: Request & { user: RequestUser },
  ): Promise<{ ok: true }> {
    const [rec] = await this.db
      .select()
      .from(recording)
      .where(and(eq(recording.callId, callId), isNull(recording.endedAt), eq(recording.tenantId, req.user.tenantId)))
      .limit(1);
    if (!rec) throw new NotFoundException('no open recording for call');

    const startMs = Date.now() - new Date(rec.startedAt).getTime();

    try {
      await this.ari.pauseRecording(callId);
    } catch (e) {
      classifyAriError(e);
    }

    await this.db.insert(recordingRedactionInterval).values({
      recordingId: rec.id,
      startMs,
      reason: 'operator_pci_pause',
    });

    return { ok: true };
  }

  @Post(':id/resume')
  @HttpCode(200)
  async resume(
    @Param('id') callId: string,
    @Req() req: Request & { user: RequestUser },
  ): Promise<{ ok: true }> {
    const [rec] = await this.db
      .select()
      .from(recording)
      .where(and(eq(recording.callId, callId), isNull(recording.endedAt), eq(recording.tenantId, req.user.tenantId)))
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

    try {
      await this.ari.resumeRecording(callId);
    } catch (e) {
      classifyAriError(e);
    }

    await this.db
      .update(recordingRedactionInterval)
      .set({ endMs })
      .where(eq(recordingRedactionInterval.id, open.id));

    return { ok: true };
  }

  @Post(':id/decline')
  @HttpCode(200)
  async decline(
    @Param('id') callId: string,
    @Req() req: Request & { user: RequestUser },
  ): Promise<{ ok: true }> {
    await this.db.transaction(async (tx) => {
      const callRows = await tx
        .select()
        .from(call)
        .where(and(eq(call.id, callId), eq(call.tenantId, req.user.tenantId)))
        .limit(1);
      if (callRows.length === 0) throw new NotFoundException('call not found');

      const queueRows = await tx
        .select()
        .from(queueCall)
        .where(and(eq(queueCall.callId, callId), eq(queueCall.tenantId, req.user.tenantId)))
        .for('update')
        .limit(1);
      if (queueRows.length === 0) throw new NotFoundException('queue_call not found');

      const attempts = queueRows[0].attempts;
      const parsed = attempts
        .map((s: string) => { try { return JSON.parse(s) as { operatorId: string; outcome: string; at: string }; } catch { return null; } })
        .filter((x: { operatorId: string; outcome: string; at: string } | null): x is { operatorId: string; outcome: string; at: string } => x !== null);

      if (parsed.some((a) => a.outcome === 'accepted')) {
        throw new ConflictException('call-already-accepted');
      }
      if (parsed.some((a) => a.operatorId === req.user.sub && a.outcome === 'declined')) {
        throw new BadRequestException('already-declined');
      }

      const entry = JSON.stringify({
        operatorId: req.user.sub,
        outcome: 'declined',
        at: new Date().toISOString(),
      });

      await tx
        .update(queueCall)
        .set({ attempts: [...attempts, entry] })
        .where(eq(queueCall.id, queueRows[0].id));
    });

    // HAZARD: the decline entry is durably committed above. If dispatchByCallId
    // throws here (DB error, WS send failure), the operator sees a 500 but
    // attempts[] already records their decline — a subsequent retry will hit the
    // 'already-declined' guard. The call is stuck until SIPp CANCEL or manual
    // re-dispatch. Not a problem for the S-4 e2e (single happy path); revisit
    // before any production deploy.
    await this.arbiter.dispatchByCallId(callId);
    return { ok: true };
  }
}
