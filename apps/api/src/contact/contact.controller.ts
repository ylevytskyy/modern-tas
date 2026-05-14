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
import { contact, account } from '@ncall/db';
import type { Db } from '@ncall/db/client';
import type { ContactDto } from '@ncall/shared-types';
import type { Request } from 'express';
import type { RequestUser } from '../auth/request-user.interface';

@Controller('Contact')
@UseGuards(JwtAuthGuard)
export class ContactController {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ): Promise<ContactDto> {
    // Join through account to enforce tenant scoping
    const [row] = await this.db
      .select({
        id: contact.id,
        accountId: contact.accountId,
        name: contact.name,
        phone: contact.phone,
        createdAt: contact.createdAt,
      })
      .from(contact)
      .innerJoin(account, eq(contact.accountId, account.id))
      .where(
        and(eq(contact.id, id), eq(account.tenantId, req.user.tenantId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException(`Contact ${id} not found`);
    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      phone: row.phone ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
