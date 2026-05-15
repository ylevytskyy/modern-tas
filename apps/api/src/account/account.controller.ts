import {
  Controller,
  Get,
  Param,
  NotFoundException,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DB_TOKEN } from '../database/database.module';
import { account } from '@ncall/db';
import type { Db } from '@ncall/db/client';
import type { AccountDto } from '@ncall/shared-types';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user.interface';

@Controller('Account')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ): Promise<AccountDto> {
    const [row] = await this.db
      .select()
      .from(account)
      .where(and(eq(account.id, id), eq(account.tenantId, req.user.tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException(`Account ${id} not found`);
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
