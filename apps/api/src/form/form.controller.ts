import {
  Controller,
  Get,
  Param,
  NotFoundException,
  UseGuards,
  Req,
  Inject,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DB_TOKEN } from '../database/database.module';
import { form, account } from '@ncall/db';
import type { Db } from '@ncall/db/client';
import type { FormDto } from '@ncall/shared-types';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user.interface';

@Controller('Form')
@UseGuards(JwtAuthGuard)
export class FormController {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ): Promise<FormDto> {
    const [row] = await this.db
      .select({
        id: form.id,
        accountId: form.accountId,
        name: form.name,
        schema: form.schema,
        createdAt: form.createdAt,
      })
      .from(form)
      .innerJoin(account, eq(form.accountId, account.id))
      .where(and(eq(form.id, id), eq(account.tenantId, req.user.tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException(`Form ${id} not found`);
    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      schema: row.schema,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
