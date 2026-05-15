import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Inject,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DB_TOKEN } from '../database/database.module';
import { message } from '@tas/db';
import type { Db } from '@tas/db/client';
import type { CreateMessageDto, MessageCreatedDto } from '@tas/shared-types';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user.interface';

@Controller('Message')
@UseGuards(JwtAuthGuard)
export class MessageController {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateMessageDto,
    @Req() req: Request & { user: RequestUser },
  ): Promise<MessageCreatedDto> {
    const [row] = await this.db
      .insert(message)
      .values({
        tenantId: req.user.tenantId,   // D5: scoped by JWT tenantId
        callId: dto.callId,
        accountId: dto.accountId,
        operatorId: dto.operatorId,
        body: dto.body,
      })
      .returning({ id: message.id, createdAt: message.createdAt });
    return { id: row.id, createdAt: row.createdAt.toISOString() };
  }
}
