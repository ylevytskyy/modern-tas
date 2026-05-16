import {
  Controller, Post, Body, UseGuards, Req, Inject, HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DB_TOKEN } from '../database/database.module';
import { message, dispatchAttempt } from '@tas/db';
import type { Db } from '@tas/db/client';
import type { CreateMessageDto, MessageCreatedDto } from '@tas/shared-types';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user.interface';
import { TemporalClientService } from '../temporal/temporal-client.service';

@Controller('Message')
@UseGuards(JwtAuthGuard)
export class MessageController {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly temporal: TemporalClientService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateMessageDto,
    @Req() req: Request & { user: RequestUser },
  ): Promise<MessageCreatedDto> {
    const [row] = await this.db
      .insert(message)
      .values({
        tenantId: req.user.tenantId,
        callId: dto.callId,
        accountId: dto.accountId,
        operatorId: dto.operatorId,
        body: dto.body,
      })
      .returning({ id: message.id, createdAt: message.createdAt });

    await this.db.insert(dispatchAttempt).values({
      messageId: row.id,
      channel: 'in_app',
    });

    await this.temporal.start('DispatchMessage', {
      workflowId: `dispatch-${row.id}`,
      taskQueue: 'dispatch-message',
      args: [{
        messageId: row.id,
        operatorId: dto.operatorId,
        tenantId: req.user.tenantId,
        payload: { callId: dto.callId, body: dto.body },
      }],
    });

    return { id: row.id, createdAt: row.createdAt.toISOString() };
  }
}
